import {ItemView} from "obsidian";
import {LIBRARY_NAV, VIEW_TYPE_FIVEETOOLS_LIBRARY} from "./constants.js";
import {ICON_ID} from "./icon.js";
import {renderEntityPanel} from "./entity-reader.js";
import {listEntities, searchEntities} from "./search-index.js";
import {renderLootGenerator} from "./loot-view.js";
import {renderEncounterComposer} from "./encounter-view.js";

export class FiveEToolsLibraryView extends ItemView {
	constructor (leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = true;
		this.navId = "bestiary";
		this.query = "";
		this.globalQuery = "";
		this.docs = [];
		this.selectedDoc = null;
		this.navEl = null;
		this.navGroupsEl = null;
		this.listEl = null;
		this.readerEl = null;
		this.searchEl = null;
		this.globalSearchEl = null;
		this._restoring = false;
		this._pendingState = null;
	}

	getViewType () {
		return VIEW_TYPE_FIVEETOOLS_LIBRARY;
	}

	getDisplayText () {
		return this.selectedDoc?.n || "5etools library";
	}

	getIcon () {
		return ICON_ID;
	}

	getState () {
		return {
			navId: this.navId,
			query: this.query,
			doc: serializeDoc(this.selectedDoc),
		};
	}

	async setState (state, result) {
		this._pendingState = state || null;
		if (state?.doc && result) result.history = true;
		await super.setState(state, result);
		if (!this.readerEl) return;
		if (!await this.plugin.ensureReady()) return;
		this._restoring = true;
		try {
			await this.applyState(state);
		} finally {
			this._restoring = false;
		}
	}

	async onOpen () {
		this.contentEl.empty();
		this.contentEl.addClass("fiveetools-library");

		this.navEl = this.contentEl.createDiv({cls: "fiveetools-library__nav"});
		this.globalSearchEl = this.navEl.createEl("input", {
			cls: "fiveetools-library__globalsearch",
			attr: {type: "search", placeholder: "Search…"},
		});
		this.globalSearchEl.addEventListener("input", () => {
			this.globalQuery = this.globalSearchEl.value;
			this.refreshList();
		});
		this.navGroupsEl = this.navEl.createDiv({cls: "fiveetools-library__navgroups"});
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

		if (this._pendingState?.doc || this._pendingState?.navId) {
			await this.applyState(this._pendingState);
			this.focusGlobalSearch();
			return;
		}

		this.renderNav();
		this.refreshList();
		this.readerEl.createEl("p", {text: "Choose a category, then an entry to read."});
		this.focusGlobalSearch();
	}

	focusGlobalSearch () {
		this.globalSearchEl?.focus();
	}

	async onClose () {
		this.contentEl.empty();
	}

	async applyState (state) {
		if (!state) return;
		if (state.navId) this.navId = state.navId;
		if (state.query != null) {
			this.query = state.query;
			if (this.searchEl) this.searchEl.value = state.query;
		}
		if (state.doc) {
			await this.showDoc(state.doc);
			return;
		}
		this.selectedDoc = null;
		this.renderNav();
		this.refreshList();
	}

	selectNav (navId) {
		this.navId = navId;
		this.selectedDoc = null;
		this.globalQuery = "";
		if (this.globalSearchEl) this.globalSearchEl.value = "";
		this.renderNav();
		this.refreshList();
	}

	async navigateToDoc (doc) {
		if (!doc) return;
		if (this._restoring || sameDoc(this.selectedDoc, doc)) {
			await this.showDoc(doc);
			return;
		}
		await this.leaf.setViewState({
			type: VIEW_TYPE_FIVEETOOLS_LIBRARY,
			active: true,
			state: libraryStateFromDoc(doc, {query: this.query, navId: this.navId}),
		});
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
		const el = this.navGroupsEl || this.navEl;
		el.empty();
		for (const group of LIBRARY_NAV) {
			el.createEl("div", {cls: "fiveetools-library__group", text: group.group});
			for (const item of group.items) {
				const btn = el.createEl("button", {
					cls: `fiveetools-library__navbtn${item.id === this.navId ? " is-active" : ""}`,
					text: item.label,
				});
				btn.addEventListener("click", () => this.selectNav(item.id));
			}
		}
	}

	refreshList () {
		const globalTerm = String(this.globalQuery || "").trim();
		if (globalTerm.length >= 2) {
			this.searchEl.style.display = "none";
			this.listEl.empty();
			this.docs = searchEntities(globalTerm);
			this.renderDocRows();
			return;
		}

		const item = currentNavItem(this.navId);
		this.listEl.empty();

		if (item?.tool === "loot") {
			this.searchEl.style.display = "none";
			const session = this.plugin._lootSession || {ids: [], count: 1, results: null};
			renderLootGenerator(this.listEl, this.readerEl, {
				selectedIds: session.ids,
				count: session.count,
				results: session.results,
				onOpenItem: (doc) => this.navigateToDoc(doc),
				onSessionChange: (next) => { this.plugin._lootSession = next; },
			});
			this.docs = [];
			return;
		}

		if (item?.tool === "encounter") {
			this.searchEl.style.display = "none";
			const session = this.plugin._encounterSession || {combatants: [], selectedId: null};
			renderEncounterComposer(this.listEl, this.readerEl, {
				session,
				app: this.app,
				onOpenDoc: (doc) => renderEntityPanel(this.readerEl, this.plugin, doc),
				onSessionChange: (next) => { this.plugin._encounterSession = next; },
			});
			this.docs = [];
			return;
		}

		this.searchEl.style.display = "";
		this.docs = listEntities({
			categoriesExact: item?.categories || [],
			query: this.query,
		});

		this.renderDocRows();
	}

	renderDocRows () {
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
			row.addEventListener("click", () => this.navigateToDoc(doc));
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

export function libraryStateFromDoc (doc, {query = "", navId = ""} = {}) {
	const item = navItemForDoc(doc);
	return {
		navId: item?.id || navId || "bestiary",
		query,
		doc: serializeDoc(doc),
	};
}

function serializeDoc (doc) {
	if (!doc) return null;
	return {
		n: doc.n,
		u: doc.u,
		s: doc.s,
		c: doc.c,
		cf: doc.cf,
		sA: doc.sA,
	};
}

function sameDoc (a, b) {
	return !!(a && b && a.u === b.u && a.s === b.s && a.n === b.n);
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
