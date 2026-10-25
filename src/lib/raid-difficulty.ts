// Heroic / Mythic / Combined scope shared by the log-analysis tools (Death
// Analysis, Mechanics Analysis, Parse Analysis, Raid Comp). Pages read it from
// `?difficulty=heroic|mythic`; no parameter means Combined, so links from
// before the toggle existed keep showing everything.

/** WCL difficulty ids. */
export const HEROIC_DIFFICULTY = 4;
export const MYTHIC_DIFFICULTY = 5;
/** Difficulties every log-analysis sync counts. */
export const TRACKED_DIFFICULTIES = [HEROIC_DIFFICULTY, MYTHIC_DIFFICULTY];
/**
 * Stored on stats rows synced before the tools split by difficulty (the row
 * still holds Heroic + Mythic added together). Combined counts them; the
 * Heroic and Mythic views skip them until the backfill re-syncs that report.
 */
export const UNSPLIT_DIFFICULTY = 0;

export type DifficultyScope = 'combined' | 'heroic' | 'mythic';
export const DIFFICULTY_SCOPES: DifficultyScope[] = ['heroic', 'mythic', 'combined'];

export const DIFFICULTY_SCOPE_LABELS: Record<DifficultyScope, string> = {
  heroic: 'Heroic',
  mythic: 'Mythic',
  combined: 'Combined',
};

export function isDifficultyScope(value: unknown): value is DifficultyScope {
  return value === 'combined' || value === 'heroic' || value === 'mythic';
}

export function parseDifficultyScope(value: string | null | undefined): DifficultyScope {
  return isDifficultyScope(value) ? value : 'combined';
}

/** The single WCL difficulty a split scope covers; null for Combined. */
export function scopeDifficulty(scope: DifficultyScope): number | null {
  if (scope === 'heroic') return HEROIC_DIFFICULTY;
  if (scope === 'mythic') return MYTHIC_DIFFICULTY;
  return null;
}

/** Whether a row stored under `difficulty` counts toward `scope` (Combined includes unsplit rows). */
export function scopeIncludes(scope: DifficultyScope, difficulty: number): boolean {
  const only = scopeDifficulty(scope);
  return only === null ? true : difficulty === only;
}

export function difficultyName(difficulty: number): string {
  if (difficulty === HEROIC_DIFFICULTY) return 'Heroic';
  if (difficulty === MYTHIC_DIFFICULTY) return 'Mythic';
  if (difficulty === 3) return 'Normal';
  return 'Unknown';
}

/** "Heroic", "Mythic", or "Heroic + Mythic" — for page copy that names the scope. */
export function scopeDescription(scope: DifficultyScope): string {
  return scope === 'combined' ? 'Heroic + Mythic' : DIFFICULTY_SCOPE_LABELS[scope];
}

/** The current URL with `difficulty` set to `scope` (dropped for Combined, the default). */
export function hrefForScope(url: URL, scope: DifficultyScope): string {
  const params = new URLSearchParams(url.searchParams);
  if (scope === 'combined') params.delete('difficulty');
  else params.set('difficulty', scope);
  const query = params.toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}
