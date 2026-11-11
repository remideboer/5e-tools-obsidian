import {Platform} from "obsidian";
import {escapeHtml} from "./compact-render.js";

const CARD_W = "12.5cm";
const CARD_H = "8.7cm";

const CARD_RULES = `
.card {
	box-sizing: border-box;
	width: ${CARD_W};
	height: ${CARD_H};
	padding: 0.3cm;
	overflow: hidden;
	display: flex;
	gap: 0.25cm;
	background: #fdf1dc;
	color: #1a1a1a;
	font: 8pt "Times New Roman", Times, serif;
}
.card__art {
	flex: 0 0 2.6cm;
	max-height: 100%;
}
.card__art img {
	display: block;
	width: 100%;
	height: auto;
	max-height: 8.1cm;
	object-fit: contain;
}
.card__body {
	flex: 1;
	min-width: 0;
	overflow: hidden;
}
.ve-stats {
	width: 100%;
	table-layout: fixed;
	border-collapse: collapse;
	background: #fdf1dc;
	color: #1a1a1a;
}
.ve-stats th, .ve-stats td { padding: 1px 4px; vertical-align: top; }
.ve-stats table { width: 100%; table-layout: fixed; border-collapse: collapse; }
.ve-w-100 { width: 100%; }
.ve-col-2 { width: 16.6667%; }
.ve-pt-0 { padding-top: 0; }
.ve-pb-3 { padding-bottom: 0.3rem; }
.ve-stats-tbl-ability-scores__lbl-abv,
.ve-stats-tbl-ability-scores__lbl-score,
.ve-stats-tbl-ability-scores__lbl-spacer {
	padding: 1px 2px;
	vertical-align: middle;
}
.ve-stats-tbl-ability-scores__lbl-abv { width: 12.33333333%; }
.ve-stats-tbl-ability-scores__lbl-score { width: 7%; }
.ve-stats__disp-as-score--physical { background: rgba(102, 102, 102, 0.2); }
.ve-stats__disp-as-score--mental { background: rgba(153, 153, 153, 0.2); }
.ve-stats__disp-as-bonus--physical { background: rgba(122, 122, 122, 0.14); }
.ve-stats__disp-as-bonus--mental { background: rgba(173, 173, 173, 0.14); }
.ve-stats__h-name, .ve-stats__sect-header-inner, .ve-rd__h,
.ve-stats h1, .ve-stats h2, .ve-stats h3 {
	color: #922610;
	font-variant: small-caps;
	margin: 0;
}
.ve-stats__th-name { font-size: 1.35em; font-weight: 500; }
.ve-stats__sect-header-inner { border-bottom: 1px solid #922610; display: block; margin-top: 3px; }
.ve-tbl-border, .ve-tbl-divider { height: 1px; background: #922610; }
.ve-flex, .ve-flex-v-center, .ve-flex-v-baseline, .ve-split-v-end {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 4px;
}
.ve-text-center { text-align: center; }
.ve-text-left { text-align: left; }
.ve-text-right { text-align: right; }
.ve-bold { font-weight: 700; }
.ve-small { font-size: 0.85em; }
.ve-small-caps { font-variant: small-caps; }
.ve-no-wrap { white-space: nowrap; }
.ve-muted { opacity: 0.7; }
.ve-rd__b { margin-bottom: 3px; }
.ve-rd__list { margin: 0 0 3px 1em; }
.ve-print__hidden { display: none !important; }
a { color: inherit; text-decoration: none; }
[class*="source-"] { color: #922610; font-weight: 700; }
`;

const PRINT_CSS = `
@page {
	size: ${CARD_W} ${CARD_H};
	margin: 0;
}
html, body {
	margin: 0;
	padding: 0;
	background: #fff;
	-webkit-print-color-adjust: exact;
	print-color-adjust: exact;
}
${CARD_RULES}
`;

function scopeCss (css, prefix) {
	return String(css || "").replace(/([^{}]+)\{/g, (full, selectors) => {
		const trimmed = String(selectors || "").trim();
		if (!trimmed || trimmed.startsWith("@")) return full;
		const scoped = trimmed.split(",").map((part) => {
			const sel = part.trim();
			return sel ? `${prefix} ${sel}` : sel;
		}).join(", ");
		return `${scoped} {`;
	});
}

/** Scope card selectors under the mobile print root. */
const MOBILE_PRINT_CSS = `
@page {
	size: ${CARD_W} ${CARD_H};
	margin: 0;
}
${scopeCss(CARD_RULES, ".fiveetools-print-root")}
`;

function cardMarkup ({html, imageSrc} = {}) {
	const art = imageSrc
		? `<div class="card__art"><img src="${escapeHtml(imageSrc)}" alt=""></div>`
		: "";
	return `<div class="card">${art}<div class="card__body">${html || ""}</div></div>`;
}

export function printEntityCard ({html, imageSrc} = {}) {
	if (Platform.isMobile) printOnMainWindow({html, imageSrc});
	else printInIframe({html, imageSrc});
}

function printInIframe ({html, imageSrc} = {}) {
	const frame = document.createElement("iframe");
	frame.setAttribute("aria-hidden", "true");
	frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
	document.body.appendChild(frame);

	const doc = frame.contentDocument;
	doc.open();
	doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print card</title><style>${PRINT_CSS}</style></head><body>${cardMarkup({html, imageSrc})}</body></html>`);
	doc.close();

	const win = frame.contentWindow;
	const cleanup = () => frame.remove();
	win.addEventListener("afterprint", cleanup);
	window.setTimeout(cleanup, 60_000);

	const run = () => {
		win.focus();
		win.print();
	};
	if (imagesReady(doc)) run();
	else waitForImages(doc).then(run);
}

function printOnMainWindow ({html, imageSrc} = {}) {
	document.querySelectorAll(".fiveetools-print-root, .fiveetools-print-style").forEach((el) => el.remove());
	document.body.classList.remove("fiveetools-printing");

	const style = document.createElement("style");
	style.className = "fiveetools-print-style";
	style.textContent = MOBILE_PRINT_CSS;
	document.head.appendChild(style);

	const root = document.createElement("div");
	root.className = "fiveetools-print-root";
	root.setAttribute("aria-hidden", "true");
	root.innerHTML = cardMarkup({html, imageSrc});
	document.body.appendChild(root);
	document.body.classList.add("fiveetools-printing");

	const cleanup = () => {
		root.remove();
		style.remove();
		document.body.classList.remove("fiveetools-printing");
	};
	window.addEventListener("afterprint", cleanup, {once: true});
	window.setTimeout(cleanup, 60_000);

	const run = () => {
		window.focus();
		window.print();
	};
	if (imagesReady(root)) run();
	else waitForImages(root).then(run);
}

function listImages (root) {
	if (root?.images) return [...root.images];
	return [...(root?.querySelectorAll?.("img") || [])];
}

function imagesReady (root) {
	return listImages(root).every((img) => img.complete);
}

function waitForImages (root) {
	const images = listImages(root);
	if (!images.length) return Promise.resolve();
	return Promise.all(images.map((img) => {
		if (img.complete) return Promise.resolve();
		return new Promise((resolve) => {
			img.addEventListener("load", resolve, {once: true});
			img.addEventListener("error", resolve, {once: true});
		});
	}));
}
