/** Flat polyhedral silhouettes (currentColor). viewBox 0 0 64 64. */

const SVG_ATTR = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linejoin="round" aria-hidden="true"';

const ICONS = {
	4: `<svg ${SVG_ATTR}><polygon points="32,6 58,54 6,54"/><line x1="32" y1="6" x2="32" y2="54"/><line x1="6" y1="54" x2="32" y2="28"/><line x1="58" y1="54" x2="32" y2="28"/></svg>`,
	6: `<svg ${SVG_ATTR}><rect x="12" y="12" width="40" height="40" rx="3"/><line x1="12" y1="32" x2="52" y2="32"/><line x1="32" y1="12" x2="32" y2="52"/><circle cx="22" cy="22" r="2.2" fill="currentColor" stroke="none"/><circle cx="42" cy="22" r="2.2" fill="currentColor" stroke="none"/><circle cx="22" cy="42" r="2.2" fill="currentColor" stroke="none"/><circle cx="42" cy="42" r="2.2" fill="currentColor" stroke="none"/><circle cx="32" cy="32" r="2.2" fill="currentColor" stroke="none"/></svg>`,
	8: `<svg ${SVG_ATTR}><polygon points="32,4 58,32 32,60 6,32"/><line x1="6" y1="32" x2="58" y2="32"/><line x1="32" y1="4" x2="20" y2="32"/><line x1="32" y1="4" x2="44" y2="32"/><line x1="32" y1="60" x2="20" y2="32"/><line x1="32" y1="60" x2="44" y2="32"/></svg>`,
	10: `<svg ${SVG_ATTR}><polygon points="32,4 54,20 54,44 32,60 10,44 10,20"/><line x1="32" y1="4" x2="32" y2="60"/><line x1="10" y1="20" x2="54" y2="44"/><line x1="54" y1="20" x2="10" y2="44"/><polygon points="32,16 42,28 32,36 22,28" fill="none"/></svg>`,
	12: `<svg ${SVG_ATTR}><polygon points="32,5 48,12 58,26 55,42 42,55 22,55 9,42 6,26 16,12"/><polygon points="32,18 42,24 42,36 32,42 22,36 22,24"/></svg>`,
	20: `<svg ${SVG_ATTR}><polygon points="32,4 56,18 56,46 32,60 8,46 8,18"/><polygon points="32,14 46,22 46,38 32,46 18,38 18,22"/><line x1="32" y1="4" x2="32" y2="14"/><line x1="56" y1="18" x2="46" y2="22"/><line x1="56" y1="46" x2="46" y2="38"/><line x1="32" y1="60" x2="32" y2="46"/><line x1="8" y1="46" x2="18" y2="38"/><line x1="8" y1="18" x2="18" y2="22"/></svg>`,
	100: `<svg ${SVG_ATTR}><ellipse cx="32" cy="34" rx="24" ry="18"/><ellipse cx="32" cy="34" rx="12" ry="18"/><path d="M14 26c6-4 30-4 36 0"/><path d="M14 42c6 4 30 4 36 0"/><text x="32" y="16" text-anchor="middle" fill="currentColor" stroke="none" font-size="11" font-family="system-ui,sans-serif" font-weight="700">00</text></svg>`,
};

export const DIE_FACES = [4, 6, 8, 10, 12, 20, 100];

export function dieLabel (faces) {
	return `d${faces}`;
}

/** Paint a polyhedral icon into `el` (replaces children). */
export function paintDieIcon (el, faces) {
	if (!el) return;
	el.innerHTML = ICONS[Number(faces)] || ICONS[20];
	const node = el.querySelector("svg");
	if (node) {
		node.setAttribute("width", "100%");
		node.setAttribute("height", "100%");
		node.style.display = "block";
	}
}
