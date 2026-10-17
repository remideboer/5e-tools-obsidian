import {CORPUS_PAGES} from "./constants.js";
import {getRenderer, getUrlUtil} from "./fiveetools-host.js";

export function pageForDoc (doc) {
	const UrlUtil = getUrlUtil();
	return UrlUtil.CAT_TO_PAGE[doc.c] || null;
}

export function loadPageForDoc (doc) {
	const UrlUtil = getUrlUtil();
	return UrlUtil.CAT_TO_HOVER_PAGE?.[doc.c] || UrlUtil.CAT_TO_PAGE[doc.c] || null;
}

export function isCorpusPage (page) {
	return CORPUS_PAGES.has(page);
}

export function renderCompactHtml (ent, page) {
	const Renderer = getRenderer();
	if (!ent) return `<p>No data.</p>`;
	if (!page || isCorpusPage(page)) {
		return `<p><strong>${escapeHtml(ent.name || "Unknown")}</strong></p>`;
	}

	try {
		const fn = Renderer.hover.getFnRenderCompact(page, {isStatic: true});
		if (!fn) {
			return `<p><strong>${escapeHtml(ent.name || "Unknown")}</strong></p>`;
		}
		const inner = fn(ent);
		const html = typeof inner === "string" ? inner : (inner?.outerHTML || String(inner));
		if (html.includes("ve-stats")) return html;
		return `<table class="ve-w-100 ve-stats">${html}</table>`;
	} catch (e) {
		return `<p>Could not render ${escapeHtml(ent.name || "")}: ${escapeHtml(e.message)}</p>`;
	}
}

export function renderCompactMarkdown (ent, page) {
	const RendererMarkdown = globalThis.RendererMarkdown;
	if (!ent) return "";
	const prop = ent.__prop;
	try {
		const opts = {meta: {depth: 2}};
		const impl = prop ? RendererMarkdown[prop] : null;
		if (impl?.getCompactRenderedString) {
			const md = String(impl.getCompactRenderedString(ent, opts) || "");
			if (md.trim()) return md;
		}
		if (ent.entries && RendererMarkdown.generic?.getCompactRenderedString) {
			const md = String(RendererMarkdown.generic.getCompactRenderedString(ent, opts) || "");
			if (md.trim()) return md;
		}
	} catch (_) { /* fall through to HTML-derived markdown */ }

	try {
		const html = renderCompactHtml(ent, page);
		const text = htmlToPlain(html);
		if (text) return `# ${ent.name || "Unknown"}\n\n${text}\n`;
	} catch (_) { /* ignore */ }

	return `# ${ent.name || "Unknown"}\n`;
}

function htmlToPlain (html) {
	return String(html || "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|tr|h[1-6]|li|div)>/gi, "\n")
		.replace(/<h[1-6][^>]*>/gi, "\n## ")
		.replace(/<li[^>]*>/gi, "- ")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, "\"")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function escapeHtml (value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function siteUrlForDoc (doc, imageBaseUrl) {
	const page = pageForDoc(doc);
	if (!page || !doc.u) return (imageBaseUrl || "https://5e.tools").replace(/\/+$/, "");
	return `${(imageBaseUrl || "https://5e.tools").replace(/\/+$/, "")}/${page}#${doc.u}`;
}
