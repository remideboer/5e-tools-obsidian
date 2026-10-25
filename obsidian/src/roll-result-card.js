import {Notice} from "obsidian";
import {findEntityDoc} from "./search-index.js";

/**
 * Parse a cell that may be a wikilink or plain entity name.
 * @returns {{name: string, source: string, label: string}|null}
 */
export function parseItemRef (text) {
	const raw = String(text || "").trim();
	if (!raw) return null;
	const wiki = /^\[\[([^\]]+)\]\]$/.exec(raw);
	const inner = wiki ? wiki[1].trim() : raw;
	const pipe = inner.indexOf("|");
	const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
	const label = (pipe >= 0 ? inner.slice(pipe + 1) : target).trim() || target;
	if (!target || target.length > 200) return null;
	const hash = target.indexOf("#");
	const pathPart = hash >= 0 ? target.slice(0, hash) : target;
	const srcSplit = pathPart.indexOf("|");
	let name = pathPart;
	let source = "";
	if (srcSplit >= 0) {
		name = pathPart.slice(0, srcSplit).trim();
		source = pathPart.slice(srcSplit + 1).trim();
	} else {
		const at = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(pathPart);
		if (at) {
			name = at[1].trim();
			source = at[2].trim();
		}
	}
	name = name.replace(/^.*\//, "").trim();
	if (!name || /[.\/\\]/.test(name) && !wiki) return null;
	return {name, source, label: label || name};
}

/**
 * @param {HTMLElement} el
 * @param {object[]} cards
 * @param {{
 *   onOpenItem?: (doc: object) => void,
 *   resolveItem?: (item: object) => object|null,
 *   emptyText?: string,
 * }} [opts]
 *
 * Card shape:
 * - dieBadge?: string
 * - title: string
 * - meta?: string
 * - fields?: {label: string, text: string, item?: object}[]
 * - item?: {name: string, source?: string, label?: string}
 */
export function renderRollResultCards (el, cards, {
	onOpenItem,
	resolveItem = resolveCardItem,
	emptyText = "No results.",
} = {}) {
	el.empty();
	el.addClass("fiveetools-roll-results");
	const list = Array.isArray(cards) ? cards : [];
	if (!list.length) {
		el.createEl("p", {cls: "fiveetools-view__meta", text: emptyText});
		return;
	}
	const host = el.createDiv({cls: "fiveetools-roll-results__list"});
	for (const card of list) {
		const row = host.createDiv({cls: "fiveetools-roll-result"});
		if (card.dieBadge) {
			row.createEl("span", {cls: "fiveetools-roll-result__die", text: String(card.dieBadge)});
		}
		const body = row.createDiv({cls: "fiveetools-roll-result__body"});
		const titleText = String(card.title || "").trim() || "—";
		if (card.item && onOpenItem) {
			const btn = body.createEl("button", {
				cls: "fiveetools-roll-result__title fiveetools-roll-result__title--link",
				text: card.item.label || titleText,
				attr: {type: "button"},
			});
			btn.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				const doc = resolveItem(card.item);
				if (!doc) {
					new Notice(`Could not open: ${card.item.name || titleText}`);
					return;
				}
				onOpenItem(doc);
			});
		} else {
			body.createEl("div", {cls: "fiveetools-roll-result__title", text: titleText});
		}
		if (card.meta) {
			body.createEl("div", {cls: "fiveetools-roll-result__meta", text: String(card.meta)});
		}
		if (card.fields?.length) {
			const fields = body.createDiv({cls: "fiveetools-roll-result__fields"});
			for (const field of card.fields) {
				const line = fields.createDiv({cls: "fiveetools-roll-result__field"});
				if (field.label) line.createEl("span", {cls: "fiveetools-roll-result__fieldlabel", text: `${field.label}: `});
				const value = String(field.text || "");
				const ref = field.item || parseItemRef(value);
				if (ref && onOpenItem) {
					const link = line.createEl("button", {
						cls: "fiveetools-roll-result__link",
						text: ref.label || value,
						attr: {type: "button"},
					});
					link.addEventListener("click", (evt) => {
						evt.preventDefault();
						evt.stopPropagation();
						const doc = resolveItem(ref);
						if (!doc) {
							new Notice(`Could not open: ${ref.name}`);
							return;
						}
						onOpenItem(doc);
					});
				} else {
					line.createSpan({text: value});
				}
			}
		}
	}
}

export function resolveCardItem (item) {
	const name = String(item?.name || "").trim();
	if (!name) return null;
	const source = String(item?.source || "").trim();
	const cats = item?.categories;
	if (cats?.length) {
		const hit = findEntityDoc(name, {categoriesExact: cats, source});
		if (hit) return hit;
	}
	return findEntityDoc(name, {categoriesExact: ["item"], source})
		|| findEntityDoc(name, {categoriesExact: ["spell"], source})
		|| findEntityDoc(name, {source});
}
