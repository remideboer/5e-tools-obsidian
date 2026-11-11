import html2canvas from "html2canvas-pro";
import {Modal, Notice, Platform} from "obsidian";
import {escapeHtml} from "./compact-render.js";
import {readCachedBytes} from "./media-cache.js";

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

let preparedCard = {key: "", file: null, promise: null};

function cardKey ({html, imageSrc, imageUrl} = {}) {
	return `${imageUrl || ""}\0${imageSrc || ""}\0${html || ""}`;
}

/** Start the iPad card image while the stat block is open, so Print can share on the tap. */
export function prepareCardPrint (args = {}) {
	if (!Platform.isIosApp) return;
	const key = cardKey(args);
	if (preparedCard.key === key && (preparedCard.file || preparedCard.promise)) return;
	const promise = renderCardFile(args).then((file) => {
		if (preparedCard.promise !== promise) return file;
		preparedCard.file = file;
		preparedCard.promise = null;
		return file;
	}).catch(() => {
		if (preparedCard.promise === promise) {
			preparedCard.file = null;
			preparedCard.promise = null;
		}
		return null;
	});
	preparedCard = {key, file: null, promise};
}

export function printEntityCard (args = {}) {
	if (Platform.isIosApp) {
		shareIosCard(args);
		return;
	}
	const {html, imageSrc} = args;
	if (Platform.isMobile) printOnMainWindow({html, imageSrc});
	else printInIframe({html, imageSrc});
}

function shareIosCard (args) {
	const key = cardKey(args);
	if (preparedCard.key === key && preparedCard.file) {
		shareCardFile(preparedCard.file);
		return;
	}
	prepareCardPrint(args);
	const promise = preparedCard.key === key ? preparedCard.promise : null;
	if (!promise) {
		if (preparedCard.key === key && preparedCard.file) shareCardFile(preparedCard.file);
		else new Notice("Could not prepare the card.");
		return;
	}
	void promise.then((file) => {
		if (preparedCard.key !== key) return;
		if (!file) {
			new Notice("Could not prepare the card.");
			return;
		}
		const app = args.plugin?.app;
		if (!app) {
			new Notice("Could not open the share sheet.");
			return;
		}
		new IosPrintModal(app, file).open();
	});
}

class IosPrintModal extends Modal {
	constructor (app, file) {
		super(app);
		this.file = file;
	}

	onOpen () {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl("h2", {text: "Ready to print"});
		contentEl.createEl("p", {text: "Open the share sheet, then choose Print."});
		const button = contentEl.createEl("button", {text: "Continue to print", cls: "fiveetools-btn"});
		button.addEventListener("click", () => {
			if (shareCardFile(this.file)) this.close();
		});
	}

	onClose () {
		this.contentEl.empty();
	}
}

function shareCardFile (file) {
	if (!file || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
		new Notice("This device cannot share the card.");
		return false;
	}
	let allowed = false;
	try { allowed = navigator.canShare({files: [file]}); }
	catch (_) { allowed = false; }
	if (!allowed) {
		new Notice("This device cannot share the card.");
		return false;
	}
	try {
		const pending = navigator.share({files: [file], title: "Print card"});
		void Promise.resolve(pending).catch((error) => {
			if (error?.name === "AbortError") return;
			new Notice("Could not open the share sheet.");
		});
		return true;
	} catch (_) {
		new Notice("Could not open the share sheet.");
		return false;
	}
}

async function renderCardFile ({html, imageSrc, imageUrl, plugin} = {}) {
	const src = await iosImageSrc({plugin, imageUrl, imageSrc});
	const frame = document.createElement("iframe");
	frame.className = "fiveetools-print-frame";
	frame.setAttribute("aria-hidden", "true");
	frame.style.cssText = `position:fixed;left:0;top:0;width:${CARD_W};height:${CARD_H};border:0;pointer-events:none;z-index:-1;`;
	document.body.appendChild(frame);
	try {
		const doc = frame.contentDocument;
		if (!doc) return null;
		doc.open();
		doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print card</title><style>${PRINT_CSS}</style></head><body>${cardMarkup({html, imageSrc: src})}</body></html>`);
		doc.close();
		if (!imagesReady(doc)) {
			await Promise.race([
				waitForImages(doc),
				new Promise((resolve) => window.setTimeout(resolve, 1500)),
			]);
		}
		const card = doc.querySelector(".card");
		if (!card) return null;
		const canvas = await html2canvas(card, {
			backgroundColor: "#fdf1dc",
			scale: 2,
			useCORS: true,
			allowTaint: false,
			logging: false,
		});
		const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
		if (!blob) return null;
		return new File([blob], "card.png", {type: "image/png"});
	} finally {
		frame.remove();
	}
}

async function iosImageSrc ({plugin, imageUrl, imageSrc}) {
	if (plugin && imageUrl) {
		const bytes = await readCachedBytes(plugin, imageUrl);
		const url = await dataUrlFromBytes(bytes);
		if (url) return url;
	}
	return imageSrc || "";
}

async function dataUrlFromBytes (bytes) {
	if (!bytes || !bytes.byteLength) return "";
	const blob = new Blob([bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)], {type: imageMime(bytes)});
	return await new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
		reader.onerror = () => resolve("");
		reader.readAsDataURL(blob);
	});
}

function imageMime (bytes) {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	if (view[0] === 0x89 && view[1] === 0x50) return "image/png";
	if (view[0] === 0xff && view[1] === 0xd8) return "image/jpeg";
	if (view[0] === 0x47 && view[1] === 0x49) return "image/gif";
	if (view[0] === 0x52 && view[1] === 0x49) return "image/webp";
	return "image/png";
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

	window.focus();
	window.print();
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
