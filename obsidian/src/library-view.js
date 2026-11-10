import {ItemView, Notice, Platform, setIcon} from "obsidian";
import {LIBRARY_NAV, VIEW_TYPE_FIVEETOOLS_LIBRARY} from "./constants.js";
import {ICON_ID} from "./icon.js";
import {renderEntityPanel} from "./entity-reader.js";
import {fulltextSourceDocs, listEntities, searchEntities} from "./search-index.js";
import {ensureFulltextIndex, fulltextReady, stopFulltextBuild} from "./fulltext-index.js";
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
import {bindTableImageMenu, renderTableTool} from "./table-view.js";
import {renderRollTablesTool} from "./roll-tables/roll-tables-view.js";
import {renderEncounterComposer} from "./encounter-view.js";
import {renderDprTool} from "./dpr-view.js";
import {renderEncounterSize} from "./encounter-size-view.js";
import {renderRandomTool} from "./random-view.js";
import {renderSimTool, stopSimTimer} from "./sim-view.js";
import {renderDmScreen} from "./dm-screen-view.js";
import {getDmScreenBoard} from "./dm-screen-store.js";
import {renderHomebrewEditor} from "./homebrew-view.js";
import {closeEmbeddedNote} from "./campaign-editor.js";
import {renderCampaignManager, teardownCampaignManager} from "./campaign-view.js";
import {renderCharacterManager} from "./character-view.js";
import {renderNotesManager, teardownNotesManager} from "./notes-view.js";
import {entryFromSavedEncounter, writeEntry} from "./campaign-store.js";
import {clearSearchInput, createSearchInput} from "./search-field.js";
import {createQuickNote, listQuickNotes} from "./quick-note-store.js";
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

function openOnDmScreen (plugin) {
	return plugin?.settings?.dmScreenOnStart !== false;
}

function openingState (view, state) {
	if (!openOnDmScreen(view?.plugin) || view?._settled) return state || null;
	return {...(state || {}), navId: "dmscreen", doc: null, query: ""};
}

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
		this.navFoldEl = null;
		this.navCollapsed = false;
		this.listColEl = null;
		this.listFoldEl = null;
		this.listCollapsed = false;
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
			navCollapsed: this.navCollapsed,
			listCollapsed: this.listCollapsed,
		};
	}

	async setState (state, result) {
		state = openingState(this, state);
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
		this._settled = false;
		this.contentEl.empty();
		this.contentEl.addClass("fiveetools-library");

		this.navEl = this.contentEl.createDiv({cls: "fiveetools-library__nav"});
		this.navFoldEl = this.mountFold(this.navEl, "nav");
		this.globalSearchEl = createSearchInput(this.navEl, {
			cls: "fiveetools-library__globalsearch",
			placeholder: "Search…",
		});
		const newNoteBtn = this.navEl.createEl("button", {
			text: "+",
			cls: "fiveetools-btn fiveetools-btn--ghost fiveetools-library__newnote",
			attr: {type: "button", title: "New note"},
		});
		newNoteBtn.addEventListener("click", async () => {
			try {
				const file = await createQuickNote(this.plugin);
				this.plugin._notesSession = {
					...(this.plugin._notesSession || {}),
					selectedPath: file.path,
				};
				this.selectNav("notes");
			} catch (e) {
				new Notice(e?.message || "Could not create that note.");
				console.error(e);
			}
		});
		const fulltextRow = this.navEl.createEl("label", {cls: "fiveetools-library__fulltext"});
		this.fulltextBox = fulltextRow.createEl("input", {
			attr: {type: "checkbox", title: "Also search spell, creature, and item text"},
		});
		this.fulltextLabel = fulltextRow.createEl("span", {text: "Text"});
		this.fulltextBox.checked = !!this.plugin.settings?.fulltextSearch;
		this.globalSearchEl.addEventListener("input", () => {
			this.globalQuery = this.globalSearchEl.value;
			this.refreshList();
		});
		this.fulltextBox.addEventListener("change", () => {
			const on = !!this.fulltextBox.checked;
			this.plugin.settings.fulltextSearch = on;
			void this.plugin.saveSettings?.();
			if (on) this.startFulltext();
			else stopFulltextBuild();
			this.refreshList();
		});
		this.navGroupsEl = this.navEl.createDiv({cls: "fiveetools-library__navgroups"});
		this.listColEl = this.contentEl.createDiv({cls: "fiveetools-library__listcol"});
		this.listFoldEl = this.mountFold(this.listColEl, "list");
		this.searchRowEl = this.listColEl.createDiv({cls: "fiveetools-library__searchrow"});
		this.searchEl = createSearchInput(this.searchRowEl, {
			cls: "fiveetools-library__search",
			placeholder: "Filter list…",
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
		this._onListArrow = (evt) => this.onListArrow(evt);
		this.contentEl.addEventListener("keydown", this._onListArrow);
		this.readerEl = this.contentEl.createDiv({cls: "fiveetools-library__reader fiveetools-view"});
		bindTableImageMenu(this.contentEl, this.plugin);
		this.applyFolds();

		if (!await this.plugin.ensureReady()) {
			this.readerEl.createEl("p", {text: "Could not load bundled 5etools data."});
			return;
		}
		if (this.plugin.settings?.fulltextSearch) this.startFulltext();

		if (openOnDmScreen(this.plugin)) {
			this.navId = "dmscreen";
			this.selectedDoc = null;
			this.query = "";
			this._pendingState = openingState(this, this._pendingState);
		}

		if (this.plugin._pendingBestiaryFilters) {
			this.applyBestiaryFilters(this.plugin._pendingBestiaryFilters);
			this.plugin._pendingBestiaryFilters = null;
		}

		if (this._pendingState?.doc || this._pendingState?.navId) {
			await this.applyState(this._pendingState);
			this.focusGlobalSearch();
			this.settleOpen();
			return;
		}

		this.renderNav();
		this.refreshList();
		this.applyFolds();
		if (!currentNavItem(this.navId)?.tool) {
			this.readerEl.createEl("p", {text: "Choose a category, then an entry to read."});
		}
		this.focusGlobalSearch();
		this.settleOpen();
	}

	settleOpen () {
		window.setTimeout(() => { this._settled = true; }, 0);
	}

	mountFold (parent, key) {
		const button = parent.createEl("button", {
			cls: "fiveetools-library__fold fiveetools-iconbtn fiveetools-iconbtn--collapse",
			attr: {type: "button"},
		});
		button.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			this.toggleFold(key);
		});
		return button;
	}

	toggleFold (key) {
		if (key === "nav") this.navCollapsed = !this.navCollapsed;
		else this.listCollapsed = !this.listCollapsed;
		this.applyFolds();
		this.app.workspace.requestSaveLayout?.();
	}

	applyFolds () {
		this.paintFold(this.navEl, this.navFoldEl, this.navCollapsed, "navigation");
		this.paintFold(this.listColEl, this.listFoldEl, this.listCollapsed, "list");
	}

	paintFold (col, button, collapsed, label) {
		if (!col || !button) return;
		col.classList.toggle("is-collapsed", !!collapsed);
		const action = collapsed ? `Expand ${label}` : `Collapse ${label}`;
		button.setAttr("aria-expanded", collapsed ? "false" : "true");
		button.setAttr("title", action);
		button.setAttr("aria-label", action);
		button.setText(collapsed ? "›" : "‹");
	}

	focusGlobalSearch () {
		this.globalSearchEl?.focus();
	}

	async onClose () {
		if (this._onListArrow) this.contentEl.removeEventListener("keydown", this._onListArrow);
		if (this._closeFilterMenus) this.contentEl.removeEventListener("click", this._closeFilterMenus);
		teardownCampaignManager(this.plugin);
		teardownNotesManager(this.plugin);
		teardownMapView(this.plugin, {closePlayer: true});
		this.readerEl?.removeClass("fiveetools-campaign-reader");
		this.readerEl?.removeClass("fiveetools-campaign-encounter");
		this.readerEl?.removeClass("fiveetools-map-stage");
		this.contentEl.empty();
	}

	async applyState (state) {
		if (!state) return;
		if (typeof state.navCollapsed === "boolean") this.navCollapsed = state.navCollapsed;
		if (typeof state.listCollapsed === "boolean") this.listCollapsed = state.listCollapsed;
		this.applyFolds();
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
		if (this.globalSearchEl) clearSearchInput(this.globalSearchEl);
		if (this.searchEl) clearSearchInput(this.searchEl);
		const item = currentNavItem(navId);
		if (item?.tool === "homebrew" && fromId !== navId) {
			this.plugin._homebrewSession = {
				typeId: this.plugin._homebrewSession?.typeId || "spell",
			};
		}
		this.renderNav();
		this.refreshList();
		this.focusLibraryList();
	}

	focusLibraryList () {
		if (this.plugin?.settings?.focusListOnNav === false) return;
		const list = this.listEl;
		if (!list) return;
		list.setAttr("tabindex", "0");
		list.focus();
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

	startFulltext () {
		if (fulltextReady()) {
			if (this.fulltextLabel) this.fulltextLabel.setText("Text");
			return;
		}
		void ensureFulltextIndex(this.plugin, fulltextSourceDocs(), {
			onProgress: () => {
				if (this.fulltextLabel?.isConnected) this.fulltextLabel.setText("Indexing…");
			},
			onReady: () => {
				if (!this.fulltextBox?.isConnected) return;
				if (this.fulltextLabel) this.fulltextLabel.setText("Text");
				if (this.plugin.settings?.fulltextSearch && String(this.globalQuery || "").trim().length >= 2) this.refreshList();
			},
		});
	}

	refreshList () {
		const listToken = ++this._listToken;
		const scrollTop = this.listEl?.scrollTop || 0;
		const globalTerm = String(this.globalQuery || "").trim();
		const item = currentNavItem(this.navId);
		this.listColEl?.classList.toggle("fiveetools-library__listcol--encounter", !globalTerm && item?.tool === "encounter");
		this.listColEl?.classList.toggle("fiveetools-library__listcol--dpr", !globalTerm && item?.tool === "dpr");
		this.listColEl?.classList.toggle("fiveetools-library__listcol--sim", !globalTerm && item?.tool === "sim");
		this.listColEl?.classList.toggle("fiveetools-library__listcol--size", !globalTerm && item?.tool === "size");
		this.listColEl?.classList.toggle("fiveetools-library__listcol--random", !globalTerm && item?.tool === "random");
		this.listColEl?.classList.toggle("fiveetools-library__listcol--table", !globalTerm && item?.tool === "table");
		this.listColEl?.classList.toggle("fiveetools-library__listcol--homebrew", !globalTerm && item?.tool === "homebrew");
		this.listColEl?.classList.toggle("fiveetools-library__listcol--dmscreen", !globalTerm && item?.tool === "dmscreen");
		this.contentEl?.classList.toggle("is-dmscreen", !globalTerm && item?.tool === "dmscreen");
		clearListToolClasses(this.listEl);
		if (item?.tool !== "campaign" || globalTerm.length >= 2) {
			teardownCampaignManager(this.plugin);
			this.readerEl?.removeClass("fiveetools-campaign-reader");
			this.readerEl?.removeClass("fiveetools-campaign-encounter");
		}
		if (item?.tool !== "notes" || globalTerm.length >= 2) {
			teardownNotesManager(this.plugin);
			if (item?.tool !== "campaign") this.readerEl?.removeClass("fiveetools-campaign-reader");
		}
		if (item?.tool !== "dpr" && this.readerEl?.hasClass("fiveetools-dpr-reader")) {
			this.readerEl.empty();
			this.readerEl.removeClass("fiveetools-dpr-reader");
		}
		if (item?.tool !== "sim") stopSimTimer(this.plugin);
	if (item?.tool !== "sim" && this.readerEl?.hasClass("fiveetools-sim-reader")) {
		this.readerEl.empty();
		this.readerEl.removeClass("fiveetools-sim-reader");
	}
		if (item?.tool !== "size" && this.readerEl?.hasClass("fiveetools-size-reader")) {
			this.readerEl.empty();
			this.readerEl.removeClass("fiveetools-size-reader");
		}
		if (item?.tool !== "random" && this.readerEl?.hasClass("fiveetools-random-reader")) {
			this.readerEl.empty();
			this.readerEl.removeClass("fiveetools-random-reader");
		}
	if (item?.tool !== "table") {
		this.plugin._tableMirrorCleanup?.();
		this.plugin._tableToolUnsub?.();
		this.plugin._tableToolUnsub = null;
		this.readerEl?.removeClass("fiveetools-table-stage");
	}
		if ((item?.tool !== "characters" || globalTerm.length >= 2) && this.readerEl?.hasClass("fiveetools-characters-reader")) {
			this.readerEl.empty();
			this.readerEl.removeClass("fiveetools-characters-reader");
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
			this.docs = searchEntities(globalTerm, {fulltext: !!this.plugin.settings?.fulltextSearch && fulltextReady()});
			void listQuickNotes(this.plugin, globalTerm).then((notes) => {
				if (listToken !== this._listToken) return;
				this.listEl.empty();
				this.paintQuickNoteRows(notes);
				this.renderDocRows({allowEmpty: !!notes.length});
				this.listEl.scrollTop = scrollTop;
			});
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
				selectedBundledId: "",
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

		if (item?.tool === "dmscreen") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			const board = this.plugin._dmScreenBoard || getDmScreenBoard();
			this.readerEl?.empty();
			renderDmScreen(this.listEl, this.readerEl, {
				plugin: this.plugin,
				board,
				onBoardChange: (next) => { this.plugin._dmScreenBoard = next; },
				onOpenEncounter: () => this.selectNav("encounter"),
			});
			this.docs = [];
			return;
		}

		if (item?.tool === "dpr") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			renderDprTool(this.listEl, this.readerEl, {
				plugin: this.plugin,
				session: this.plugin._dprSession || {},
				onSessionChange: (next) => { this.plugin._dprSession = next; },
			});
			this.docs = [];
			return;
		}

		if (item?.tool === "size") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			renderEncounterSize(this.listEl, this.readerEl, {
				session: this.plugin._sizeSession || {},
				onSessionChange: (next) => { this.plugin._sizeSession = next; },
			});
			this.docs = [];
			return;
		}

		if (item?.tool === "random") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			void this.openRandom(this.plugin._randomSession || {}, listToken);
			this.docs = [];
			return;
		}

		if (item?.tool === "sim") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			renderSimTool(this.listEl, this.readerEl, {
				plugin: this.plugin,
				session: this.plugin._simSession || {},
				onSessionChange: (next) => { this.plugin._simSession = next; },
				onOpenEncounter: () => {
					try { this.app.workspace.revealLeaf(this.leaf); } catch (_) { /* the library leaf is already showing */ }
					this.selectNav("encounter");
				},
			});
			this.docs = [];
			return;
		}

		if (item?.tool === "table") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			renderTableTool(this.listEl, this.readerEl, {plugin: this.plugin});
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
				onOpenDoc: (doc, opts) => this.openEntityPanel(doc, opts),
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

		if (item?.tool === "characters") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			const session = this.plugin._characterSession || {selectedId: ""};
			renderCharacterManager(this.listEl, this.readerEl, {
				plugin: this.plugin,
				session,
				onSessionChange: (next) => { this.plugin._characterSession = next; },
			});
			this.docs = [];
			return;
		}

		if (item?.tool === "notes") {
			this.searchRowEl.style.display = "none";
			if (this.filterEl) this.filterEl.style.display = "none";
			const session = this.plugin._notesSession || {selectedPath: "", filter: ""};
			try {
				renderNotesManager(this.listEl, this.readerEl, {
					plugin: this.plugin,
					session,
					onSessionChange: (next) => { this.plugin._notesSession = next; },
				});
			} catch (e) {
				this.listEl.empty();
				this.listEl.createEl("p", {text: e.message || "Could not open Notes."});
			}
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
					onOpenSim: () => this.selectNav("sim"),
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

	async openRandom (session, listToken) {
		await renderRandomTool(this.listEl, this.readerEl, {
			plugin: this.plugin,
			session,
			listToken,
			isCurrent: (token) => token === this._listToken,
			onSessionChange: (next) => { this.plugin._randomSession = next; },
			onOpenEncounter: () => this.selectNav("encounter"),
		});
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
			plugin: this.plugin,
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

	paintQuickNoteRows (notes) {
		for (const note of notes || []) {
			const row = this.listEl.createEl("button", {
				cls: "fiveetools-library__row fiveetools-library__row--note",
				attr: {type: "button"},
			});
			const top = row.createDiv({cls: "fiveetools-library__row-top"});
			top.createEl("div", {cls: "fiveetools-library__row-name", text: note.title});
			row.createEl("div", {cls: "fiveetools-library__row-sub", text: "Note"});
			row.addEventListener("click", () => {
				this.plugin._notesSession = {
					...(this.plugin._notesSession || {}),
					selectedPath: note.path,
				};
				this.selectNav("notes");
			});
		}
	}

	renderDocRows ({allowEmpty = false} = {}) {
		if (!this.docs.length) {
			if (!allowEmpty) {
				this.listEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No entries."});
				if (!this.selectedDoc) {
					closeEmbeddedNote(this.plugin);
					this.readerEl.empty();
				}
			}
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

	onListArrow (evt) {
		if (evt.key !== "ArrowUp" && evt.key !== "ArrowDown") return;
		if (!this.listColEl?.contains(evt.target)) return;
		const tag = evt.target?.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || evt.target?.isContentEditable) return;
		const selector = ".fiveetools-library__row, .fiveetools-homebrew__hit, .fiveetools-rolltables__hit";
		const focused = evt.target?.closest?.(selector);
		const root = focused?.parentElement || this.listEl;
		const rows = [...(root?.querySelectorAll(selector) || [])];
		if (!rows.length) return;
		evt.preventDefault();
		const current = rows.findIndex(row => row.classList.contains("is-selected"));
		let next = current;
		if (evt.key === "ArrowDown") next = current < 0 ? 0 : Math.min(rows.length - 1, current + 1);
		else next = current < 0 ? rows.length - 1 : Math.max(0, current - 1);
		const row = rows[next];
		if (!row || next === current) return;
		const libraryRows = rows.every(item => item.classList.contains("fiveetools-library__row"));
		if (libraryRows && this.docs?.length === rows.length) void this.openDoc(this.docs[next]);
		else row.click();
		row.scrollIntoView({block: "nearest"});
	}

	async openDoc (doc) {
		closeEmbeddedNote(this.plugin);
		this.selectedDoc = doc;
		this.leaf.tabHeaderInnerTitleEl?.setText?.(doc.n || "5etools library");
		this.listEl.querySelectorAll(".fiveetools-library__row").forEach(el => el.classList.remove("is-selected"));
		const idx = this.docs.findIndex(it => it.u === doc.u && it.s === doc.s && it.n === doc.n);
		if (idx >= 0) {
			const entityRows = [...this.listEl.querySelectorAll(".fiveetools-library__row:not(.fiveetools-library__row--note)")];
			entityRows[idx]?.classList.add("is-selected");
		}
		await this.openEntityPanel(doc);
	}

	openEntityPanel (doc, opts = {}) {
		return renderEntityPanel(this.readerEl, this.plugin, doc, {
			onAddedToEncounter: () => {
				if (this.navId === "encounter") this.selectNav("encounter");
			},
			...opts,
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
		"fiveetools-dpr",
		"fiveetools-sim",
		"fiveetools-size",
		"fiveetools-random",
		"fiveetools-dmscreen",
		"fiveetools-homebrew",
		"fiveetools-campaign",
		"fiveetools-notes",
		"fiveetools-characters",
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
	return LIBRARY_NAV[1].items.find(it => it.id === "class") || LIBRARY_NAV[1].items[0];
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
