import {ItemView} from "obsidian";
import {LIBRARY_NAV, VIEW_TYPE_FIVEETOOLS_LIBRARY} from "./constants.js";
import {renderEntityPanel} from "./entity-reader.js";
import {listEntities} from "./search-index.js";
import {renderLootGenerator} from "./loot-view.js";

export class FiveEToolsLibraryView extends ItemView {
	constructor (leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.navId = "bestiary";
		this.query = "";
		this.docs = [];
		this.selectedDoc = null;
		this.navEl = null;
		this.listEl = null;
		this.readerEl = null;
		this.searchEl = null;
	}

	getViewType () {
		return VIEW_TYPE_FIVEETOOLS_LIBRARY;
	}

	getDisplayText () {
		return this.selectedDoc?.n || "5etools library";
	}

	getIcon () {
		return "library";
	}

	async onOpen () {
		this.contentEl.empty();
		this.contentEl.addClass("fiveetools-library");

		this.navEl = this.contentEl.createDiv({cls: "fiveetools-library__nav"});
		const listCol = this.contentEl.createDiv({cls: "fiveetools-library__listcol"});
		this.searchEl = listCol.createEl("input", {
			cls: "fiveetools-library__search",
			attr: {type: "search", placeholder: "Filter list…"},
		});
		this.searchEl.addEventListener("input", () => {
			this.query = this.searchEl.value;
			this.refreshList();
		});
		this.listEl = listCol.createDiv({cls: "fiveetools-library__list"});
		this.readerEl = this.contentEl.createDiv({cls: "fiveetools-library__reader fiveetools-view"});

		if (!await this.plugin.ensureReady()) {
			this.readerEl.createEl("p", {text: "Could not load bundled 5etools data."});
			return;
		}

		this.renderNav();
		this.refreshList();
		this.readerEl.createEl("p", {text: "Choose a category, then an entry to read."});
	}

	async onClose () {
		this.contentEl.empty();
	}

	selectNav (navId) {
		this.navId = navId;
		this.selectedDoc = null;
		this.renderNav();
		this.refreshList();
	}

	async showDoc (doc) {
		if (!doc) return;
		const navItem = navItemForDoc(doc);
		if (navItem) this.navId = navItem.id;
		this.selectedDoc = doc;
		this.renderNav();
		this.refreshList();
		await this.openDoc(doc);
	}

	renderNav () {
		this.navEl.empty();
		for (const group of LIBRARY_NAV) {
			this.navEl.createEl("div", {cls: "fiveetools-library__group", text: group.group});
			for (const item of group.items) {
				const btn = this.navEl.createEl("button", {
					cls: `fiveetools-library__navbtn${item.id === this.navId ? " is-active" : ""}`,
					text: item.label,
				});
				btn.addEventListener("click", () => {
					if (item.tool === "search") {
						this.plugin.openSearch();
						return;
					}
					this.selectNav(item.id);
				});
			}
		}
	}

	refreshList () {
		const item = currentNavItem(this.navId);
		this.listEl.empty();

		if (item?.tool === "loot") {
			this.searchEl.style.display = "none";
			renderLootGenerator(this.listEl, this.readerEl, {
				onOpenItem: (doc) => this.openDoc(doc),
			});
			this.docs = [];
			return;
		}

		this.searchEl.style.display = "";
		this.docs = listEntities({
			categoriesExact: item?.categories || [],
			query: this.query,
		});

		if (!this.docs.length) {
			this.listEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No entries."});
			if (!this.selectedDoc) this.readerEl.empty();
			return;
		}

		for (const doc of this.docs) {
			const active = this.selectedDoc && this.selectedDoc.u === doc.u && this.selectedDoc.s === doc.s;
			const row = this.listEl.createEl("button", {
				cls: `fiveetools-library__row${active ? " is-selected" : ""}`,
			});
			row.createEl("div", {cls: "fiveetools-modal__name", text: doc.n});
			row.createEl("div", {
				cls: "fiveetools-modal__sub",
				text: [doc.cf, doc.sA || doc.s].filter(Boolean).join(" · "),
			});
			row.addEventListener("click", () => this.openDoc(doc));
		}
	}

	async openDoc (doc) {
		this.selectedDoc = doc;
		this.leaf.tabHeaderInnerTitleEl?.setText?.(doc.n || "5etools library");
		this.listEl.querySelectorAll(".fiveetools-library__row").forEach(el => el.classList.remove("is-selected"));
		const idx = this.docs.findIndex(it => it.u === doc.u && it.s === doc.s && it.n === doc.n);
		if (idx >= 0) this.listEl.children[idx]?.classList.add("is-selected");
		await renderEntityPanel(this.readerEl, this.plugin, doc);
	}
}

function currentNavItem (navId) {
	for (const group of LIBRARY_NAV) {
		const item = group.items.find(it => it.id === navId);
		if (item) return item;
	}
	return LIBRARY_NAV[1].items[0];
}

function navItemForDoc (doc) {
	const category = String(doc?.cf || "").toLowerCase();
	for (const group of LIBRARY_NAV) {
		for (const item of group.items) {
			if ((item.categories || []).includes(category)) return item;
		}
	}
	return null;
}
