import {ItemView, Notice, Platform, setIcon} from "obsidian";
import {LIBRARY_NAV, VIEW_TYPE_FIVEETOOLS_LIBRARY} from "./constants.js";
import {ICON_ID} from "./icon.js";
import {renderEntityPanel} from "./entity-reader.js";
import {listEntities, searchEntities} from "./search-index.js";
import {BESTIARY_FILTER_OPTIONS, emptyBestiaryFilters, habitatFilterOptions} from "./bestiary-meta.js";
import {SPELL_FILTER_OPTIONS, emptySpellFilters} from "./spell-meta.js";
import {ITEM_FILTER_OPTIONS, emptyItemFilters} from "./item-meta.js";
import {
	defaultListSort,
	navSupportsBadgeSort,
	paintLibraryRow,
	sortLibraryDocs,
} from "./library-row.js";
import {ensureLootData, renderLootGenerator} from "./loot-view.js";
import {emptyDiceSession, renderDiceRoller} from "./dice-roller-view.js";
import {renderRollTablesTool} from "./roll-tables/roll-tables-view.js";
import {renderEncounterComposer} from "./encounter-view.js";
import {renderHomebrewEditor} from "./homebrew-view.js";
import {renderCampaignManager, teardownCampaignManager} from "./campaign-view.js";
import {entryFromSavedEncounter, writeEntry} from "./campaign-store.js";
import {renderMapTool, teardownMapView} from "./map-view.js";
import {renderReferenceMaps} from "./map-reference-view.js";

const BADGE_SORT_ICON = {
	bestiary: "swords",
	spell: "sparkles",
	item: "gem",
};

const BADGE_SORT_LABEL = {
	bestiary: "CR",
	spell: "level",
	item: "rarity",
};

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
		this.searchRowEl = null;
		this.sortEl = null;
		this.filterEl = null;
		this.globalSearchEl = null;
		this._listToken = 0;
		this.bestiaryFilters = emptyBestiaryFilters();
		this.spellFilters = emptySpellFilters();
		this.itemFilters = emptyItemFilters();
		this._restoring = false;
		this._pendingState = null;
		this._closeFilterMenus = null;
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
		this.searchRowEl = this.listColEl.createDiv({cls: "fiveetools-library__searchrow"});
		this.searchEl = this.searchRowEl.createEl("input", {
			cls: "fiveetools-library__search",
			attr: {type: "search", placeholder: "Filter list…"},
		});
		this.searchEl.addEventListener("input", () => {
			this.query = this.searchEl.value;
			this.refreshList();
		});
		this.sortEl = this.searchRowEl.createDiv({cls: "fiveetools-library__sort"});
		this.filterEl = this.listColEl.createDiv({cls: "fiveetools-bestiary-filters"});
		this.paintNavFilters();
		this._closeFilterMenus = () => closeLibraryFilterMenus(this.filterEl);
		this.contentEl.addEventListener("click", this._closeFilterMenus);
		this.listEl = this.listColEl.createDiv({cls: "fiveetools-library__list"});
		this.readerEl = this.contentEl.createDiv({cls: "fiveetools-library__reader fiveetools-view"});

		if (!await this.plugin.ensureReady()) {
			this.readerEl.createEl("p", {text: "Could not load bundled 5etools data."});
			return;
		}

		if (this.plugin._pendingBestiaryFilters) {
			this.applyBestiaryFilters(this.plugin._pendingBestiaryFilters);
			this.plugin._pendingBestiaryFilters = null;
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
		if (this._closeFilterMenus) this.contentEl.removeEventListener("click", this._closeFilterMenus);
		teardownCampaignManager(this.plugin);
		teardownMapView(this.plugin, {closePlayer: true});
		this.readerEl?.removeClass("fiveetools-campaign-reader");
		this.readerEl?.removeClass("fiveetools-campaign-encounter");
		this.readerEl?.removeClass("fiveetools-map-stage");
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
		if (fromId === "encounter" && navId !== "encounter") this.plugin._campaignReturn = null;
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

	/** Replace bestiary filter facets (habitat deep-links from creature stats). */
	applyBestiaryFilters (partial = {}) {
		const next = emptyBestiaryFilters();
		for (const key of Object.keys(next)) {
			if (Array.isArray(partial[key])) next[key] = [...partial[key]];
		}
		this.bestiaryFilters = next;
		if (this.navId === "bestiary" && this.filterEl) {
			this.paintNavFilters();
		}
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
		const navChanged = !!(navItem && navItem.id !== this.navId);
		if (navItem) this.navId = navItem.id;
		this.selectedDoc = doc;
		this.renderNav();
		const inList = (this.docs || []).some(it => sameDoc(it, doc));
		if (navChanged || !inList) this.refreshList();
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

	listSortForNav (navId = this.navId) {
		if (!this.plugin._libraryListSort) this.plugin._libraryListSort = {};
		const map = this.plugin._libraryListSort;
		if (!map[navId]) map[navId] = defaultListSort();
		return map[navId];
	}

	setListSort (patch = {}) {
		const cur = this.listSortForNav();
		Object.assign(cur, patch);
		this.paintSortToolbar();
		this.refreshList();
	}

	paintSortToolbar () {
		const el = this.sortEl;
		if (!el) return;
		el.empty();
		const show = navSupportsBadgeSort(this.navId) && String(this.globalQuery || "").trim().length < 2;
		el.style.display = show ? "" : "none";
		if (!show) return;

		const sort = this.listSortForNav();
		const badgeIcon = BADGE_SORT_ICON[this.navId] || "hash";
		const badgeLabel = BADGE_SORT_LABEL[this.navId] || "value";
		const fieldBtn = el.createEl("button", {
			cls: `fiveetools-library__sortbtn${sort.key === "badge" ? " is-active" : ""}`,
			attr: {
				type: "button",
				title: sort.key === "name"
					? `Sorted by name (click for ${badgeLabel})`
					: `Sorted by ${badgeLabel} (click for name)`,
				"aria-label": sort.key === "name" ? "Sort by name" : `Sort by ${badgeLabel}`,
			},
		});
		setIcon(fieldBtn, sort.key === "name" ? "case-sensitive" : badgeIcon);
		fieldBtn.addEventListener("click", (evt) => {
			evt.preventDefault();
			this.setListSort({key: sort.key === "name" ? "badge" : "name"});
		});

		const dirBtn = el.createEl("button", {
			cls: "fiveetools-library__sortbtn",
			attr: {
				type: "button",
				title: sort.dir === "asc" ? "Ascending (click for descending)" : "Descending (click for ascending)",
				"aria-label": sort.dir === "asc" ? "Ascending" : "Descending",
			},
		});
		setIcon(dirBtn, sort.dir === "asc" ? "arrow-up-narrow-wide" : "arrow-down-wide-narrow");
		dirBtn.addEventListener("click", (evt) => {
			evt.preventDefault();
			this.setListSort({dir: sort.dir === "asc" ? "desc" : "asc"});
		});
	}

	refreshList () {
		const listToken = ++this._listToken;
		const scrollTop = this.listEl?.scrollTop || 0;
		const globalTerm = String(this.globalQuery || "").trim();
		const item = currentNavItem(this.navId);
		this.listColEl?.classList.toggle("fiveetools-library__listcol--encounter", !globalTerm && item?.tool === "encounter");
		this.listColEl?.classList.toggle("fiveetools-library__listcol--homebrew", !globalTerm && item?.tool === "homebrew");
		clearListToolClasses(this.listEl);
		if (item?.tool !== "campaign" || globalTerm.length >= 2) {
			teardownCampaignManager(this.plugin);
			this.readerEl?.removeClass("fiveetools-campaign-reader");
			this.readerEl?.removeClass("fiveetools-campaign-encounter");
		}
		if (item?.tool !== "map" || globalTerm.length >= 2) {
			teardownMapView(this.plugin);
			this.readerEl?.removeClass("fiveetools-map-stage");
		}
		this.paintSortToolbar();
		if (globalTerm.length >= 2) {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			this.listEl.empty();
			this.docs = searchEntities(globalTerm);
			this.renderDocRows();
			this.listEl.scrollTop = scrollTop;
			return;
		}

		this.listEl.empty();

		if (item?.tool === "dice") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			const session = this.plugin._diceSession || emptyDiceSession();
			renderDiceRoller(this.listEl, this.readerEl, {
				plugin: this.plugin,
				session,
				onSessionChange: (next) => { this.plugin._diceSession = next; },
			});
			this.docs = [];
			return;
		}

		if (item?.tool === "loot") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			const session = this.plugin._lootSession || {ids: [], count: 1, results: null};
			this.readerEl?.empty();
			this.listEl.createEl("p", {text: "Loading loot tables…"});
			void this.openLoot(session, listToken);
			this.docs = [];
			return;
		}

		if (item?.tool === "rolltables") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			const session = this.plugin._rolltablesSession || {
				selectedPath: "",
				count: 1,
				results: null,
				importDraft: null,
			};
			renderRollTablesTool(this.listEl, this.readerEl, {
				session,
				plugin: this.plugin,
				onOpenItem: (doc) => { void this.plugin.openPreview(doc); },
				onSessionChange: (next) => { this.plugin._rolltablesSession = next; },
			});
			this.docs = [];
			return;
		}

		if (item?.tool === "encounter") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			const session = this.plugin._encounterSession || {combatants: [], selectedId: null};
			renderEncounterComposer(this.listEl, this.readerEl, {
				session,
				plugin: this.plugin,
				app: this.app,
				onOpenDoc: (doc) => this.openEntityPanel(doc),
				onSessionChange: (next) => { this.plugin._encounterSession = next; },
				onSaved: async (saved) => {
					const ret = this.plugin._campaignReturn;
					if (!ret?.slug) return;
					try {
						const written = await writeEntry(this.plugin, ret.slug, "encounters", {
							...entryFromSavedEncounter(saved),
							path: ret.selectedPath || undefined,
						});
						this.plugin._campaignReturn = null;
						this.plugin._campaignSession = {
							slug: ret.slug,
							sectionId: "encounters",
							selectedPath: written.path,
						};
						this.selectNav("campaign");
					} catch (e) {
						new Notice(e.message || "Could not import encounter.");
					}
				},
			});
			this.docs = [];
			return;
		}

		if (item?.tool === "homebrew") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			const session = this.plugin._homebrewSession || {typeId: "spell"};
			renderHomebrewEditor(this.listEl, this.readerEl, {
				session,
				plugin: this.plugin,
				app: this.app,
				onOpenDoc: (doc) => this.openEntityPanel(doc),
				onSessionChange: (next) => { this.plugin._homebrewSession = next; },
			});
			this.docs = [];
			return;
		}

		if (item?.tool === "campaign") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			const session = this.plugin._campaignSession || {sectionId: "overview"};
			try {
				renderCampaignManager(this.listEl, this.readerEl, {
					session,
					plugin: this.plugin,
					app: this.app,
					onSessionChange: (next) => { this.plugin._campaignSession = next; },
					onOpenComposer: (next, ret) => {
						this.plugin._encounterSession = next;
						this.plugin._campaignReturn = ret?.slug
							? {slug: ret.slug, selectedPath: ret.selectedPath || ""}
							: null;
						this.selectNav("encounter");
					},
					onOpenMap: () => this.selectNav("map"),
				});
			} catch (e) {
				this.listEl.empty();
				this.listEl.createEl("p", {text: e.message || "Could not open Campaigns."});
			}
			this.docs = [];
			return;
		}

		if (item?.tool === "map") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			if (Platform.isMobile) {
				this.renderMobileOnly("Maps are available in the desktop app.");
				this.docs = [];
				return;
			}
			const session = this.plugin._mapSession || {};
			renderMapTool(this.listEl, this.readerEl, {
				session,
				plugin: this.plugin,
				app: this.app,
				onSessionChange: (next) => { this.plugin._mapSession = next; },
			});
			this.docs = [];
			return;
		}

		if (item?.tool === "maps") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			if (Platform.isMobile) {
				this.renderMobileOnly("Maps are available in the desktop app.");
				this.docs = [];
				return;
			}
			const session = this.plugin._referenceMapSession || {};
			renderReferenceMaps(this.listEl, this.readerEl, {
				session,
				plugin: this.plugin,
				onSessionChange: (next) => { this.plugin._referenceMapSession = next; },
				onOpenMap: () => this.selectNav("map"),
			});
			this.docs = [];
			return;
		}

		this.searchRowEl.style.display = "";
		const showFilters = item?.id === "bestiary" || item?.id === "spell" || item?.id === "item";
		if (this.filterEl) {
			const navChanged = this._filterNavId !== item?.id;
			this.filterEl.style.display = showFilters ? "" : "none";
			if (showFilters && navChanged) {
				this._filterNavId = item.id;
				this.paintNavFilters();
			}
			if (!showFilters) this._filterNavId = "";
		}
		let docs = listEntities({
			categoriesExact: item?.categories || [],
			query: this.query,
			bestiaryFilters: item?.id === "bestiary" ? this.bestiaryFilters : undefined,
			spellFilters: item?.id === "spell" ? this.spellFilters : undefined,
			itemFilters: item?.id === "item" ? this.itemFilters : undefined,
		});
		if (navSupportsBadgeSort(item?.id)) {
			const sort = this.listSortForNav(item.id);
			docs = sortLibraryDocs(docs, {key: sort.key, dir: sort.dir, kind: item.id});
		}
		this.docs = docs;

		this.renderDocRows();
		this.listEl.scrollTop = scrollTop;
	}

	paintNavFilters () {
		const host = this.filterEl;
		if (!host) return;
		const onChange = () => this.refreshList();
		if (this.navId === "spell") {
			paintSpellFilters(host, this.spellFilters, onChange);
			return;
		}
		if (this.navId === "item") {
			paintItemFilters(host, this.itemFilters, onChange);
			return;
		}
		paintBestiaryFilters(host, this.bestiaryFilters, onChange);
	}

	renderMobileOnly (text) {
		this.readerEl?.empty();
		this.listEl.createEl("p", {text});
	}

	async openLoot (session, listToken) {
		try {
			await ensureLootData(this.plugin);
		} catch (e) {
			if (listToken !== this._listToken) return;
			this.listEl.empty();
			this.listEl.createEl("p", {text: e.message || "Could not load loot tables."});
			return;
		}
		if (listToken !== this._listToken) return;
		this.listEl.empty();
		renderLootGenerator(this.listEl, this.readerEl, {
			selectedIds: session.ids,
			count: session.count,
			results: session.results,
			viewId: session.viewId || "",
			onOpenItem: (doc) => { void this.plugin.openPreview(doc); },
			onSessionChange: (next) => {
				this.plugin._lootSession = {
					...next,
					viewId: next.results?.items?.length ? "" : (session.viewId || ""),
				};
			},
		});
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
			paintLibraryRow(row, doc);
			row.addEventListener("click", () => this.navigateToDoc(doc));
		}
	}

	async openDoc (doc) {
		this.selectedDoc = doc;
		this.leaf.tabHeaderInnerTitleEl?.setText?.(doc.n || "5etools library");
		this.listEl.querySelectorAll(".fiveetools-library__row").forEach(el => el.classList.remove("is-selected"));
		const idx = this.docs.findIndex(it => it.u === doc.u && it.s === doc.s && it.n === doc.n);
		if (idx >= 0) this.listEl.children[idx]?.classList.add("is-selected");
		await this.openEntityPanel(doc);
	}

	openEntityPanel (doc) {
		return renderEntityPanel(this.readerEl, this.plugin, doc, {
			onAddedToEncounter: () => {
				if (this.navId === "encounter") this.selectNav("encounter");
			},
		});
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
	el?.classList.remove(
		"fiveetools-loot",
		"fiveetools-dice-roller",
		"fiveetools-rolltables",
		"fiveetools-encounter",
		"fiveetools-homebrew",
		"fiveetools-campaign",
		"fiveetools-map",
		"fiveetools-refmaps",
	);
}

function paintBestiaryFilters (hostEl, filters, onChange) {
	if (!Array.isArray(filters.environments)) filters.environments = [];
	paintLibraryFilters(hostEl, filters, onChange, [
		{label: "Type", key: "types", options: BESTIARY_FILTER_OPTIONS.types},
		{label: "CR", key: "crs", options: BESTIARY_FILTER_OPTIONS.crs},
		{label: "Size", key: "sizes", options: BESTIARY_FILTER_OPTIONS.sizes},
		{label: "Alignment", key: "alignments", options: BESTIARY_FILTER_OPTIONS.alignments},
		{label: "Habitat", key: "environments", options: habitatFilterOptions()},
	], () => {
		filters.types = [];
		filters.crs = [];
		filters.sizes = [];
		filters.alignments = [];
		filters.environments = [];
	});
}

function paintSpellFilters (hostEl, filters, onChange) {
	paintLibraryFilters(hostEl, filters, onChange, [
		{label: "Level", key: "levels", options: SPELL_FILTER_OPTIONS.levels},
		{label: "Class", key: "classes", options: SPELL_FILTER_OPTIONS.classes},
	], () => {
		filters.levels = [];
		filters.classes = [];
	});
}

function paintItemFilters (hostEl, filters, onChange) {
	paintLibraryFilters(hostEl, filters, onChange, [
		{label: "Rarity", key: "rarities", options: ITEM_FILTER_OPTIONS.rarities},
		{label: "Type", key: "types", options: ITEM_FILTER_OPTIONS.types},
	], () => {
		filters.rarities = [];
		filters.types = [];
	});
}

function paintLibraryFilters (hostEl, filters, onChange, dimensions, clearFn) {
	hostEl.empty();
	const grid = hostEl;
	for (const dim of dimensions) {
		addLibraryFilter(grid, dim.label, dim.key, dim.options, filters, onChange);
	}
	const clear = hostEl.createEl("button", {
		cls: "fiveetools-bestiary-filters__clear",
		attr: {type: "button"},
		text: "Clear filters",
	});
	clear.addEventListener("click", (ev) => {
		ev.stopPropagation();
		clearFn?.();
		paintLibraryFilters(hostEl, filters, onChange, dimensions, clearFn);
		onChange();
	});
}

function addLibraryFilter (grid, label, key, options, filters, onChange) {
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
		closeLibraryFilterMenus(grid);
		if (willOpen) menu.classList.add("is-open");
	});
	menu.addEventListener("click", (ev) => ev.stopPropagation());
	syncBtn();
}

function closeLibraryFilterMenus (hostEl) {
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
