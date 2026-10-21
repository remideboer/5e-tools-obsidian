import {Modal} from "obsidian";
import {searchEntities} from "./search-index.js";

const TOKEN_DRAG = "fiveetools-token:";

export function openTokenPicker (app, plugin, {onPlace} = {}) {
	new TokenPickerModal(app, plugin, onPlace).open();
}

export function tokenDragDoc (dataTransfer) {
	const text = dataTransfer?.getData?.("text/plain") || "";
	if (!text.startsWith(TOKEN_DRAG)) return null;
	try {
		const doc = JSON.parse(text.slice(TOKEN_DRAG.length));
		if (!doc?.u || !doc?.s) return null;
		return doc;
	} catch (_) {
		return null;
	}
}

class TokenPickerModal extends Modal {
	constructor (app, plugin, onPlace) {
		super(app);
		this.plugin = plugin;
		this.onPlace = onPlace;
		this.results = [];
	}

	onOpen () {
		this.modalEl.addClass("fiveetools-modal");
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl("h2", {text: "Insert token"});
		contentEl.createEl("p", {
			cls: "fiveetools-view__meta",
			text: "Click a creature to place it at the cursor, or drag it onto the map.",
		});
		const input = contentEl.createEl("input", {
			cls: "fiveetools-modal__search",
			attr: {type: "search", placeholder: "Search the bestiary"},
		});
		const list = contentEl.createDiv({cls: "fiveetools-modal__results"});
		const paint = () => {
			this.results = searchEntities(input.value, {categoriesExact: ["bestiary"], limit: 40});
			list.empty();
			if (!this.results.length) {
				list.createEl("div", {cls: "fiveetools-modal__empty", text: "No creatures."});
				return;
			}
			for (const doc of this.results) {
				const row = list.createEl("button", {
					cls: "fiveetools-modal__row",
					attr: {type: "button", draggable: "true"},
				});
				row.createEl("div", {cls: "fiveetools-modal__name", text: doc.n || "Creature"});
				row.createEl("div", {
					cls: "fiveetools-modal__sub",
					text: [doc.cf, doc.sA || doc.s].filter(Boolean).join(" · "),
				});
				let dragged = false;
				row.addEventListener("dragstart", (evt) => {
					dragged = true;
					evt.dataTransfer?.setData("text/plain", `${TOKEN_DRAG}${JSON.stringify(docRef(doc))}`);
					if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "copy";
					document.body.classList.add("fiveetools-token-dragging");
				});
				row.addEventListener("dragend", () => {
					document.body.classList.remove("fiveetools-token-dragging");
				});
				row.addEventListener("click", () => {
					if (dragged) {
						dragged = false;
						return;
					}
					const place = this.onPlace;
					this.close();
					place?.(docRef(doc));
				});
			}
		};
		input.addEventListener("input", () => paint());
		paint();
		input.focus();
	}

	onClose () {
		document.body.classList.remove("fiveetools-token-dragging");
		this.contentEl.empty();
	}
}

function docRef (doc) {
	return {
		u: doc.u,
		s: doc.s,
		n: doc.n,
		c: doc.c,
		cf: doc.cf,
		sA: doc.sA,
	};
}
