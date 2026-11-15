// Delegated replacements for the inline `on*=` attributes the site used to
// have, which a Content-Security-Policy without 'unsafe-inline' would block.
// Loaded once from Layout.astro. Markup opts in with data attributes:
//
//   data-confirm="msg"        on a <form> (submit) or a <button> (click): ask first
//   data-auto-submit          on a <select>/<input>: submit its form on change
//   data-close-details        on a <button>: close the enclosing <details>
//   data-fallback-src="url"   on an <img>: swap to this URL once if it fails to load
//   data-fallback-mark        on an <img>: if there is no fallback (left), hide the
//                             image and append a "?" placeholder to its parent

document.addEventListener('submit', (event) => {
	const form = event.target;
	if (!(form instanceof HTMLFormElement)) return;
	const message = form.dataset.confirm;
	if (message && !window.confirm(message)) event.preventDefault();
});

document.addEventListener('click', (event) => {
	if (!(event.target instanceof Element)) return;

	const confirmTarget = event.target.closest<HTMLElement>('button[data-confirm], input[data-confirm]');
	if (confirmTarget?.dataset.confirm && !window.confirm(confirmTarget.dataset.confirm)) {
		event.preventDefault();
		return;
	}

	const closer = event.target.closest<HTMLElement>('[data-close-details]');
	closer?.closest('details')?.removeAttribute('open');
});

document.addEventListener('change', (event) => {
	const target = event.target;
	if (target instanceof HTMLElement && target.hasAttribute('data-auto-submit')) {
		(target as HTMLSelectElement).form?.submit();
	}
});

function handleImageFailure(img: HTMLImageElement): void {
	const fallback = img.dataset.fallbackSrc;
	if (fallback) {
		img.dataset.fallbackSrc = '';
		img.src = fallback;
		return;
	}
	if (img.hasAttribute('data-fallback-mark')) {
		img.removeAttribute('data-fallback-mark');
		img.style.display = 'none';
		const parent = img.parentElement;
		if (parent) {
			const span = document.createElement('span');
			span.className = 'icon-fallback';
			span.textContent = '?';
			parent.appendChild(span);
		}
	}
}

// `error` doesn't bubble, so listen in the capture phase.
document.addEventListener(
	'error',
	(event) => {
		if (event.target instanceof HTMLImageElement) handleImageFailure(event.target);
	},
	true
);

// Images that failed before this script ran never reach the listener above.
for (const img of document.querySelectorAll<HTMLImageElement>('img[data-fallback-src], img[data-fallback-mark]')) {
	if (img.complete && img.naturalWidth === 0 && img.currentSrc) handleImageFailure(img);
}
