import {ItemView} from "obsidian";
import {LIBRARY_NAV, VIEW_TYPE_FIVEETOOLS_LIBRARY} from "./constants.js";
import {ICON_ID} from "./icon.js";
import {renderEntityPanel} from "./entity-reader.js";
import {listEntities, searchEntities} from "./search-index.js";
import {BESTIARY_FILTER_OPTIONS, emptyBestiaryFilters} from "./bestiary-meta.js";
import {renderLootGenerator} from "./loot-view.js";
import {renderEncounterComposer} from "./encounter-view.js";
import {renderHomebrewEditor} from "./homebrew-view.js";
import {renderCampaignManager, teardownCampaignManager} from "./campaign-view.js";

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
		this.listColEl = null;
		this.listEl = null;
		this.readerEl = null;
		this.searchEl = null;
		this.filterEl = null;
		this.globalSearchEl = null;
		this.bestiaryFilters = emptyBestiaryFilters();
		this._restoring = false;
		this._pendingState = null;
		this._closeBestiaryMenus = null;
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
		this.listColEl = this.contentEl.createDiv({cls: "fiveetools-library__listcol"});
		this.searchEl = this.listColEl.createEl("input", {
			cls: "fiveetools-library__search",
			attr: {type: "search", placeholder: "Filter list…"},
		});
		this.searchEl.addEventListener("input", () => {
			this.query = this.searchEl.value;
			this.refreshList();
		});
		this.filterEl = this.listColEl.createDiv({cls: "fiveetools-bestiary-filters"});
		paintBestiaryFilters(this.filterEl, this.bestiaryFilters, () => this.refreshList());
		this._closeBestiaryMenus = () => closeBestiaryFilterMenus(this.filterEl);
		this.contentEl.addEventListener("click", this._closeBestiaryMenus);
		this.listEl = this.listColEl.createDiv({cls: "fiveetools-library__list"});
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
		if (this._closeBestiaryMenus) this.contentEl.removeEventListener("click", this._closeBestiaryMenus);
		teardownCampaignManager(this.plugin);
		this.readerEl?.removeClass("fiveetools-campaign-reader");
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
		const fromId = this.navId;
		this.navId = navId;
		this.selectedDoc = null;
		this.globalQuery = "";
		this.query = "";
		if (this.globalSearchEl) this.globalSearchEl.value = "";
		if (this.searchEl) this.searchEl.value = "";
		const item = currentNavItem(navId);
		if (item?.tool === "homebrew" && fromId !== navId) {
			this.plugin._homebrewSession = {
				typeId: this.plugin._homebrewSession?.typeId || "spell",
			};
		}
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
		const item = currentNavItem(this.navId);
		this.listColEl?.classList.toggle("fiveetools-library__listcol--encounter", !globalTerm && item?.tool === "encounter");
		this.listColEl?.classList.toggle("fiveetools-library__listcol--homebrew", !globalTerm && item?.tool === "homebrew");
		clearListToolClasses(this.listEl);
		if (item?.tool !== "campaign" || globalTerm.length >= 2) {
			teardownCampaignManager(this.plugin);
			this.readerEl?.removeClass("fiveetools-campaign-reader");
		}
		if (globalTerm.length >= 2) {
			this.searchEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			this.listEl.empty();
			this.docs = searchEntities(globalTerm);
			this.renderDocRows();
			return;
		}

		this.listEl.empty();

		if (item?.tool === "loot") {
			this.searchEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
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
			if (this.filterEl) this.filterEl.style.display = "none";
			const session = this.plugin._encounterSession || {combatants: [], selectedId: null};
			renderEncounterComposer(this.listEl, this.readerEl, {
				session,
				plugin: this.plugin,
				app: this.app,
				onOpenDoc: (doc) => renderEntityPanel(this.readerEl, this.plugin, doc),
				onSessionChange: (next) => { this.plugin._encounterSession = next; },
			});
			this.docs = [];
			return;
		}

		if (item?.tool === "homebrew") {
			this.searchEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			const session = this.plugin._homebrewSession || {typeId: "spell"};
			renderHomebrewEditor(this.listEl, this.readerEl, {
				session,
				plugin: this.plugin,
				app: this.app,
				onOpenDoc: (doc) => renderEntityPanel(this.readerEl, this.plugin, doc),
				onSessionChange: (next) => { this.plugin._homebrewSession = next; },
			});
			this.docs = [];
			return;
		}

		if (item?.tool === "campaign") {
			this.searchEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			const session = this.plugin._campaignSession || {sectionId: "overview"};
			try {
				renderCampaignManager(this.listEl, this.readerEl, {
					session,
					plugin: this.plugin,
					app: this.app,
					onSessionChange: (next) => { this.plugin._campaignSession = next; },
					onOpenComposer: (next) => {
						this.plugin._encounterSession = next;
						this.selectNav("encounter");
					},
				});
			} catch (e) {
				this.listEl.empty();
				this.listEl.createEl("p", {text: e.message || "Could not open Campaigns."});
			}
			this.docs = [];
			return;
		}

		this.searchEl.style.display = "";
		if (this.filterEl) this.filterEl.style.display = item?.id === "bestiary" ? "" : "none";
		this.docs = listEntities({
			categoriesExact: item?.categories || [],
			query: this.query,
			bestiaryFilters: item?.id === "bestiary" ? this.bestiaryFilters : undefined,
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

function clearListToolClasses (el) {
	el?.classList.remove("fiveetools-loot", "fiveetools-encounter", "fiveetools-homebrew", "fiveetools-campaign");
}

function paintBestiaryFilters (hostEl, filters, onChange) {
	hostEl.empty();
	const grid = hostEl;
	addBestiaryFilter(grid, "Type", "types", BESTIARY_FILTER_OPTIONS.types, filters, onChange);
	addBestiaryFilter(grid, "CR", "crs", BESTIARY_FILTER_OPTIONS.crs, filters, onChange);
	addBestiaryFilter(grid, "Size", "sizes", BESTIARY_FILTER_OPTIONS.sizes, filters, onChange);
	addBestiaryFilter(grid, "Alignment", "alignments", BESTIARY_FILTER_OPTIONS.alignments, filters, onChange);
	const clear = hostEl.createEl("button", {
		cls: "fiveetools-bestiary-filters__clear",
		attr: {type: "button"},
		text: "Clear filters",
	});
	clear.addEventListener("click", (ev) => {
		ev.stopPropagation();
		filters.types = [];
		filters.crs = [];
		filters.sizes = [];
		filters.alignments = [];
		paintBestiaryFilters(hostEl, filters, onChange);
		onChange();
	});
}

function addBestiaryFilter (grid, label, key, options, filters, onChange) {
	const wrap = grid.createDiv({cls: "fiveetools-bestiary-filter"});
	const btn = wrap.createEl("button", {
		cls: "fiveetools-bestiary-filter__btn",
		attr: {type: "button"},
	});
	const menu = wrap.createDiv({cls: "fiveetools-bestiary-filter__menu"});
	const syncBtn = () => {
		const n = filters[key]?.length || 0;
		btn.setText(n ? `${label} (${n})` : label);
		btn.classList.toggle("is-active", n > 0);
	};
	for (const opt of options) {
		const row = menu.createEl("label", {cls: "fiveetools-bestiary-filter__opt"});
		const box = row.createEl("input", {attr: {type: "checkbox"}});
		box.checked = (filters[key] || []).includes(opt.id);
		box.addEventListener("change", () => {
			const selected = new Set(filters[key] || []);
			if (box.checked) selected.add(opt.id);
			else selected.delete(opt.id);
			filters[key] = [...selected];
			syncBtn();
			onChange();
		});
		row.createSpan({text: opt.label});
	}
	btn.addEventListener("click", (ev) => {
		ev.stopPropagation();
		const willOpen = !menu.classList.contains("is-open");
		closeBestiaryFilterMenus(grid);
		if (willOpen) menu.classList.add("is-open");
	});
	menu.addEventListener("click", (ev) => ev.stopPropagation());
	syncBtn();
}

function closeBestiaryFilterMenus (hostEl) {
	hostEl?.querySelectorAll(".fiveetools-bestiary-filter__menu.is-open")
		.forEach(el => el.classList.remove("is-open"));
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
