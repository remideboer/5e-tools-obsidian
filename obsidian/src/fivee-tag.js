import {Decoration, ViewPlugin, WidgetType} from "@codemirror/view";
import {Prec, RangeSetBuilder} from "@codemirror/state";
import {pageForDoc} from "./compact-render.js";
import {getParser} from "./fiveetools-host.js";
import {docFromVetLink, searchEntities} from "./search-index.js";

const ITALIC_TAGS = new Set(["item", "spell", "psionic"]);
const BOLD_TAGS = new Set(["creature", "deity"]);
const TAG_RE = /\{@[a-zA-Z0-9]+ [^}]+\}/g;

export function fiveETagForDoc (doc) {
	const Parser = getParser();
	const prop = Parser.CAT_ID_TO_PROP?.[doc?.c];
	const tag = Parser.getPropTag?.(prop) || prop;
	const name = String(doc?.n || "").trim();
	const source = String(doc?.s || "").trim();
	if (!tag || !name) return "";
	return source ? `{@${tag} ${name}|${source}}` : `{@${tag} ${name}}`;
}

export function parseFiveETag (raw) {
	const match = String(raw || "").match(/^\{@([a-zA-Z0-9]+) ([^}]+)\}$/);
	if (!match) return null;
	const parts = match[2].split("|");
	const name = String(parts[0] || "").trim();
	const source = String(parts[1] || "").trim();
	const display = String(parts[2] || name).trim() || name;
	if (!name) return null;
	return {tag: match[1], name, source, display, raw: match[0]};
}

export function docFromFiveETag (parsed) {
	if (!parsed?.name) return null;
	const hits = searchEntities(parsed.name, {limit: 20});
	const source = String(parsed.source || "").toLowerCase();
	const name = parsed.name.toLowerCase();
	return hits.find(doc => String(doc.n || "").toLowerCase() === name && (!source || String(doc.s || "").toLowerCase() === source))
		|| hits.find(doc => String(doc.n || "").toLowerCase() === name)
		|| hits[0]
		|| null;
}

export function enhanceFiveETags (rootEl, plugin) {
	if (!rootEl) return;
	const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
	const nodes = [];
	while (walker.nextNode()) nodes.push(walker.currentNode);
	for (const node of nodes) {
		const text = node.nodeValue || "";
		if (!text.includes("{@")) continue;
		if (node.parentElement?.closest("code, pre, a.fiveetools-inline-link")) continue;
		TAG_RE.lastIndex = 0;
		if (!TAG_RE.test(text)) continue;
		const wrap = document.createElement("span");
		wrap.className = "fiveetools-inline-tags";
		TAG_RE.lastIndex = 0;
		let last = 0;
		let match;
		while ((match = TAG_RE.exec(text))) {
			if (match.index > last) wrap.appendChild(document.createTextNode(text.slice(last, match.index)));
			wrap.appendChild(tagAnchor(match[0]));
			last = match.index + match[0].length;
		}
		if (last < text.length) wrap.appendChild(document.createTextNode(text.slice(last)));
		node.parentNode.replaceChild(wrap, node);
	}
	if (rootEl.dataset.fiveetoolsTagsBound) return;
	rootEl.dataset.fiveetoolsTagsBound = "1";
	rootEl.addEventListener("click", (evt) => {
		const a = evt.target.closest?.("a.fiveetools-inline-link");
		if (!a || !rootEl.contains(a)) return;
		evt.preventDefault();
		evt.stopPropagation();
		void openTaggedDoc(plugin, a);
	}, true);
}

export function registerFiveETagPostProcessor (plugin) {
	plugin.registerMarkdownPostProcessor((el) => enhanceFiveETags(el, plugin));
	plugin.registerEditorExtension(Prec.highest(fiveETagViewPlugin(plugin)));
}

class FiveETagWidget extends WidgetType {
	constructor (raw, plugin) {
		super();
		this.raw = raw;
		this.plugin = plugin;
	}

	eq (other) {
		return other instanceof FiveETagWidget && other.raw === this.raw;
	}

	toDOM () {
		const a = tagAnchor(this.raw);
		a.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			void openTaggedDoc(this.plugin, a);
		});
		a.addEventListener("mousedown", (evt) => evt.preventDefault());
		return a;
	}

	ignoreEvent (evt) {
		return evt.type !== "click" && evt.type !== "mousedown" && evt.type !== "mouseup";
	}
}

function fiveETagViewPlugin (plugin) {
	return ViewPlugin.fromClass(class {
		constructor (view) {
			this.decorations = buildTagDecorations(view, plugin);
		}

		update (update) {
			if (update.docChanged || update.viewportChanged || update.selectionSet) {
				this.decorations = buildTagDecorations(update.view, plugin);
			}
		}
	}, {decorations: (v) => v.decorations});
}

function buildTagDecorations (view, plugin) {
	const builder = new RangeSetBuilder();
	const re = new RegExp(TAG_RE.source, "g");
	for (const {from, to} of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);
		re.lastIndex = 0;
		let match;
		while ((match = re.exec(text))) {
			const start = from + match.index;
			const end = start + match[0].length;
			if (selectionTouches(view, start, end)) continue;
			builder.add(start, end, Decoration.replace({
				widget: new FiveETagWidget(match[0], plugin),
				inclusive: false,
			}));
		}
	}
	return builder.finish();
}

function selectionTouches (view, from, to) {
	for (const range of view.state.selection.ranges) {
		if (range.empty && range.from === to) continue;
		if (range.from < to && range.to > from) return true;
	}
	return false;
}

function tagAnchor (raw) {
	const parsed = parseFiveETag(raw);
	const a = document.createElement("a");
	a.className = "fiveetools-inline-link";
	a.href = "#";
	const doc = parsed ? docFromFiveETag(parsed) : null;
	const source = doc?.s || parsed?.source || "";
	if (source) a.classList.add(`source-${source}`);
	const label = parsed?.display || parsed?.name || raw;
	const tag = parsed?.tag || "";
	if (ITALIC_TAGS.has(tag)) {
		const em = document.createElement("em");
		em.textContent = label;
		a.appendChild(em);
	} else if (BOLD_TAGS.has(tag)) {
		const strong = document.createElement("strong");
		strong.textContent = label;
		a.appendChild(strong);
	} else a.textContent = label;
	if (doc) {
		const page = pageForDoc(doc);
		if (page) a.setAttribute("data-vet-page", page);
		if (doc.s) a.setAttribute("data-vet-source", doc.s);
		if (doc.u) a.setAttribute("data-vet-hash", doc.u);
	} else if (parsed) {
		a.setAttribute("data-vet-name", parsed.name);
		if (parsed.source) a.setAttribute("data-vet-source", parsed.source);
		a.setAttribute("data-vet-tag", parsed.tag);
	}
	return a;
}

async function openTaggedDoc (plugin, a) {
	if (!await plugin.ensureReady()) return;
	const doc = docFromVetLink({
		page: a.getAttribute("data-vet-page"),
		source: a.getAttribute("data-vet-source"),
		hash: a.getAttribute("data-vet-hash"),
		linkText: (a.textContent || "").trim(),
	}) || docFromFiveETag({
		name: a.getAttribute("data-vet-name"),
		source: a.getAttribute("data-vet-source"),
		tag: a.getAttribute("data-vet-tag"),
	});
	if (doc) await plugin.openLibrary({doc});
}

if (globalThis.FiveEToolsObsidian) {
	globalThis.FiveEToolsObsidian.fiveETagForDoc = fiveETagForDoc;
	globalThis.FiveEToolsObsidian.parseFiveETag = parseFiveETag;
}
