import {MarkdownRenderer, Notice} from "obsidian";
import {fileStem, listCampaigns, listEntries, parseCampaignMarkdown} from "./campaign-store.js";
import {characterName, listCharacters, saveCharacterPlay} from "./character-store.js";
import {loadPageForDoc, renderCompactHtml} from "./compact-render.js";
import {CONDITIONS} from "./creature-form.js";
import {appendCreatureStatFooter} from "./creature-stat-footer.js";
import {appendTextWithDiceRollers, bindDiceRollers} from "./dice-roll.js";
import {emptyDiceSession, renderDiceRoller} from "./dice-roller-view.js";
import {renderRollHistoryWidget} from "./roll-history.js";
import {getBundledScreenTable, listBundledScreenTables} from "./roll-tables/bundled-screen-tables.js";
import {listRollTables, readRollTableNote} from "./roll-tables/roll-table-store.js";
import {rollTableResults} from "./roll-tables/table-roll.js";
import {addMinutes, clockParts, DAY_MINUTES, dayColumns, formatClock, LONG_REST, shiftLabel, SHORT_REST, stepsFor, TIME_MODES} from "./dm-time.js";
import {allocPanelId, getDmScreenBoard, queueSaveDmScreen, setDmScreenBoard} from "./dm-screen-store.js";
import {getEncounterInstance, getSavedEncounter, listSavedEncounters, loadEncountersFromVault, queueSaveEncountersToVault, setEncounterInstance} from "./encounter-store.js";
import {addCombatants, adjustHp, appendSavedCombatants, combatantTag, listKindGroups, stepAmount} from "./encounter-view.js";
import {bindInternalLinks} from "./entity-reader.js";
import {attachHoverCard} from "./hover-card.js";
import {characterId} from "./dpr-view.js";
import {loadEntity} from "./entity-loader.js";
import {HOMEBREW_TYPES, listBrewEntities} from "./homebrew-store.js";
import {resolveTokenImage} from "./image-resolver.js";
import {cachedMediaSrc, rewriteMediaUrls} from "./media-cache.js";
import {brewDocFromEntity, findEntityDoc, searchEntities} from "./search-index.js";
import {enrichCreatureSpellcasting} from "./spell-roll-enrich.js";
import {ensureTableSession, onTableChange, refreshTable} from "./table-session.js";
import {tableInitHeightPercent} from "./constants.js";
import {onInitiativeKey, placedChips, selectTableTurn, finishTableTurn, addPlayerRecordsFrom20, addNamedBelowPlayers, addNamedAtEnd, appendInitToken, removeTableGroup, reorderPlacedRoster, castTableWindow, closeTableWindow, tableWindowOpen, clearTableRoster} from "./table-view.js";

const QUICK_REFS = [
	{ref: "conditions", label: "Conditions", name: "", categories: ["condition"]},
	{ref: "cover", label: "Cover", name: "Cover", categories: ["rule"]},
	{ref: "exhaustion", label: "Exhaustion", name: "Exhaustion", categories: ["condition"]},
	{ref: "concentration", label: "Concentration", name: "Concentration", categories: ["status"]},
];

const PIN_CATEGORIES = [
	"bestiary", "spell", "item", "background", "species",
	"condition", "disease", "status", "rule",
];

/**
 * Tools → DM screen: pinned entity / note / counter cards.
 * @param {HTMLElement} listEl
 * @param {HTMLElement} readerEl
 */
export function renderDmScreen (listEl, readerEl, {plugin, board, onBoardChange, onOpenEncounter} = {}) {
	listEl.empty();
	listEl.addClass("fiveetools-dmscreen");
	readerEl?.empty();

	const state = {
		columns: copyColumns(board),
	};

	const emit = () => {
		const next = setDmScreenBoard({columns: state.columns});
		onBoardChange?.(next);
		queueSaveDmScreen(plugin);
	};

	const bar = listEl.createDiv({cls: "fiveetools-dmscreen__bar"});
	bar.addEventListener("pointerdown", (evt) => evt.stopPropagation());
	const tableBtn = bar.createEl("button", {
		text: "Table",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Open or close the Table window"},
	});
	const syncTableBtn = () => {
		const open = tableWindowOpen(plugin);
		tableBtn.setText(open ? "Close table" : "Table");
		tableBtn.toggleClass("is-selected", open);
	};
	syncTableBtn();
	plugin._syncDmTableBtn = syncTableBtn;
	if (!plugin._dmTableLayout) {
		plugin._dmTableLayout = true;
		plugin.registerEvent(plugin.app.workspace.on("layout-change", () => plugin._syncDmTableBtn?.()));
	}
	tableBtn.addEventListener("click", (evt) => {
		if (tableWindowOpen(plugin)) closeTableWindow(plugin);
		else castTableWindow(plugin, {anchorEl: evt.currentTarget, mouseEvent: evt});
		window.setTimeout(syncTableBtn, 400);
	});
	plugin._dmTurnUnsub?.();
	plugin._dmTurnUnsub = onTableChange(() => {
		if (!listEl.isConnected) return;
		listEl.querySelectorAll(".fiveetools-dmscreen__init").forEach(el => paintInitiative(el, plugin));
	});
	const addEntityBtn = bar.createEl("button", {
		text: "Entry / note",
		cls: "fiveetools-btn",
		attr: {type: "button"},
	});
	const addNoteBtn = bar.createEl("button", {
		text: "Note",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	const addCounterBtn = bar.createEl("button", {
		text: "Counter",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	const addTableBtn = bar.createEl("button", {
		text: "Table",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Pin a roll or reference table"},
	});
	const addEncounterBtn = bar.createEl("button", {
		text: "Encounter",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Pin the current encounter roster"},
	});
	const addInitBtn = bar.createEl("button", {
		text: "Initiative",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Add the initiative roster"},
	});
	const addPlayersBtn = bar.createEl("button", {
		text: "Players",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Add player stat cards"},
	});
	const addTimeBtn = bar.createEl("button", {
		text: "Time",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Add the day timeline"},
	});
	const addDiceBtn = bar.createEl("button", {
		text: "Dice",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Add the dice roller"},
	});
	const addRollHistBtn = bar.createEl("button", {
		text: "Roll log",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Add the last-five roll history"},
	});
	const refButtons = QUICK_REFS.map((spec) => {
		const el = bar.createEl("button", {
			text: spec.label,
			cls: "fiveetools-btn fiveetools-btn--ghost",
			attr: {type: "button", title: `Pin ${spec.label}`},
		});
		el.addEventListener("click", () => pinReference(spec));
		return {ref: spec.ref, el};
	});

	const searchEl = listEl.createDiv({cls: "fiveetools-dmscreen__search is-hidden"});
	const searchInput = searchEl.createEl("input", {
		cls: "fiveetools-dmscreen__searchinput",
		attr: {type: "search", placeholder: "Search creatures, items, homebrew, campaign notes…"},
	});
	const hitsEl = searchEl.createDiv({cls: "fiveetools-dmscreen__hits"});

	const grid = listEl.createDiv({cls: "fiveetools-dmscreen__grid"});

	const items = () => state.columns.flatMap(col => col.items);

	const syncBar = () => {
		addEncounterBtn.toggleAttribute("disabled", items().some(panel => panel.type === "encounter"));
		addInitBtn.toggleAttribute("disabled", items().some(panel => panel.type === "initiative"));
		addPlayersBtn.toggleAttribute("disabled", items().some(panel => panel.type === "players"));
		addTimeBtn.toggleAttribute("disabled", items().some(panel => panel.type === "time"));
		addDiceBtn.toggleAttribute("disabled", items().some(panel => panel.type === "dice"));
		addRollHistBtn.toggleAttribute("disabled", items().some(panel => panel.type === "rollHistory"));
		for (const btn of refButtons) {
			btn.el.toggleAttribute("disabled", items().some(panel => panel.type === "reference" && panel.ref === btn.ref));
		}
	};

	const addColumn = (panel) => {
		try {
			state.columns.push({id: allocPanelId(), collapsed: false, items: [panel]});
			emit();
			paint();
			grid.scrollLeft = grid.scrollWidth;
		} catch (e) {
			new Notice(e?.message || "Could not add that widget.");
			console.error(e);
		}
	};

	const paint = () => {
		plugin._dmNoteFit?.forEach(stop => stop());
		plugin._dmNoteFit = [];
		const gridScroll = grid.scrollLeft;
		const scrolls = [...grid.querySelectorAll(".fiveetools-dmscreen__column")].map(el => el.scrollTop);
		grid.empty();
		syncBar();
		if (!state.columns.length) {
			grid.createEl("p", {cls: "fiveetools-view__meta", text: "No panels yet."});
			return;
		}
		state.columns.forEach((column, index) => {
			const el = grid.createDiv({cls: "fiveetools-dmscreen__column"});
			if (column.collapsed) el.addClass("is-collapsed");
			const setCollapsed = (collapsed) => {
				column.collapsed = !!collapsed;
				el.toggleClass("is-collapsed", column.collapsed);
				emit();
			};
			el.addEventListener("click", (evt) => {
				if (!column.collapsed) return;
				if (evt.target.closest(".fiveetools-dmscreen__colactions, button, input, textarea, select, a")) return;
				setCollapsed(false);
			});
			const grip = el.createDiv({cls: "fiveetools-dmscreen__colgrip"});
			const colFold = grip.createEl("button", {
				text: "‹",
				cls: "fiveetools-dmscreen__fold fiveetools-iconbtn fiveetools-iconbtn--collapse",
				attr: {type: "button", title: "Collapse column"},
			});
			colFold.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				setCollapsed(true);
			});
			const gripBar = grip.createDiv({
				cls: "fiveetools-dmscreen__gripbar",
				attr: {title: "Drag to move this column", draggable: "true"},
			});
			gripBar.addEventListener("dragstart", (evt) => {
				dragKind = "column";
				dragId = column.id;
				evt.dataTransfer?.setData("text/plain", column.id);
				if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
				evt.stopPropagation();
			});
			gripBar.addEventListener("dragend", endDrag);
			for (const panel of column.items) paintCard(el, column, panel, setCollapsed);
			el.addEventListener("dragover", (evt) => {
				if (dragKind === "column") {
					if (dragId === column.id) {
						clearMarks();
						return;
					}
					evt.preventDefault();
					const rect = el.getBoundingClientRect();
					const after = evt.clientX > rect.left + rect.width / 2;
					markDrop(el, after ? "is-drop-after" : "is-drop-before");
					if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
					return;
				}
				if (dragKind !== "card") return;
				evt.preventDefault();
				markDrop(el, "is-drop-end");
				if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
			});
			el.addEventListener("drop", (evt) => {
				if (!dragKind) return;
				evt.preventDefault();
				evt.stopPropagation();
				const kind = dragKind;
				const id = dragId;
				const rect = el.getBoundingClientRect();
				const after = evt.clientX > rect.left + rect.width / 2;
				endDrag();
				if (kind === "column") moveColumn(id, column.id, after);
				else moveCard(id, column.id, null, false);
			});
			const actions = el.createDiv({cls: "fiveetools-dmscreen__colactions"});
			actions.addEventListener("pointerdown", (evt) => evt.stopPropagation());
			const entryBtn = actions.createEl("button", {
				text: "Entry",
				cls: "fiveetools-btn fiveetools-btn--ghost",
				attr: {type: "button", title: "Add an entry to this column"},
			});
			const noteBtn = actions.createEl("button", {
				text: "Note",
				cls: "fiveetools-btn fiveetools-btn--ghost",
				attr: {type: "button", title: "Add a note to this column"},
			});
			const counterBtn = actions.createEl("button", {
				text: "Counter",
				cls: "fiveetools-btn fiveetools-btn--ghost",
				attr: {type: "button", title: "Add a counter to this column"},
			});
			const tableBtn = actions.createEl("button", {
				text: "Table",
				cls: "fiveetools-btn fiveetools-btn--ghost",
				attr: {type: "button", title: "Add a table to this column"},
			});
			const addToColumn = (evt, panel) => {
				evt.preventDefault();
				evt.stopPropagation();
				try {
					column.items.push(panel);
					emit();
					paint();
				} catch (e) {
					new Notice(e?.message || "Could not add that widget.");
					console.error(e);
				}
			};
			entryBtn.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				openSearch("entry", column);
			});
			tableBtn.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				openSearch("table", column);
			});
			noteBtn.addEventListener("click", (evt) => addToColumn(evt, blankPanel("note", "Note")));
			counterBtn.addEventListener("click", (evt) => addToColumn(evt, blankPanel("counter", "Counter")));
			if (scrolls[index]) el.scrollTop = scrolls[index];
		});
		const lane = grid.createDiv({cls: "fiveetools-dmscreen__newcol", attr: {title: "Drop to make a new column"}});
		lane.createSpan({text: "New column"});
		lane.addEventListener("dragover", (evt) => {
			if (dragKind !== "card") return;
			evt.preventDefault();
			evt.stopPropagation();
			markDrop(lane, "is-drop-end");
			if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
		});
		lane.addEventListener("drop", (evt) => {
			if (dragKind !== "card") return;
			evt.preventDefault();
			evt.stopPropagation();
			const id = dragId;
			endDrag();
			moveCardToNewColumn(id);
		});
		grid.scrollLeft = gridScroll;
	};

	let dragKind = null;
	let dragId = null;

	const clearMarks = () => {
		grid.querySelectorAll(".is-drop-before, .is-drop-after, .is-drop-end").forEach(node => {
			node.classList.remove("is-drop-before", "is-drop-after", "is-drop-end");
		});
	};

	const markDrop = (el, cls) => {
		clearMarks();
		el.classList.add(cls);
	};

	const endDrag = () => {
		dragKind = null;
		dragId = null;
		clearMarks();
		grid.querySelector(".fiveetools-dmscreen__newcol")?.classList.remove("is-open");
	};

	const openNewColumnLane = () => {
		const lane = grid.querySelector(".fiveetools-dmscreen__newcol");
		if (!lane) return;
		lane.classList.add("is-open");
		const extra = lane.getBoundingClientRect().right - grid.getBoundingClientRect().right;
		if (extra > 0) grid.scrollLeft += extra + 8;
	};

	const moveColumn = (id, targetId, after) => {
		const from = state.columns.findIndex(column => column.id === id);
		const to = state.columns.findIndex(column => column.id === targetId);
		if (from < 0 || to < 0) return;
		let insert = after ? to + 1 : to;
		if (from < insert) insert -= 1;
		if (insert === from) return;
		const [column] = state.columns.splice(from, 1);
		state.columns.splice(insert, 0, column);
		emit();
		paint();
	};

	const moveCard = (panelId, targetColumnId, beforePanelId, after) => {
		let fromColumn = null;
		let fromIndex = -1;
		for (const column of state.columns) {
			const index = column.items.findIndex(panel => panel.id === panelId);
			if (index < 0) continue;
			fromColumn = column;
			fromIndex = index;
			break;
		}
		const toColumn = state.columns.find(column => column.id === targetColumnId);
		if (!fromColumn || !toColumn) return;
		let insert = toColumn.items.length;
		if (beforePanelId) {
			const at = toColumn.items.findIndex(panel => panel.id === beforePanelId);
			insert = at < 0 ? toColumn.items.length : (after ? at + 1 : at);
		}
		if (fromColumn === toColumn && fromIndex < insert) insert -= 1;
		if (fromColumn === toColumn && insert === fromIndex) return;
		const [panel] = fromColumn.items.splice(fromIndex, 1);
		toColumn.items.splice(insert, 0, panel);
		state.columns = state.columns.filter(column => column.items.length);
		emit();
		paint();
	};

	const moveCardToNewColumn = (panelId) => {
		let fromColumn = null;
		let fromIndex = -1;
		for (const column of state.columns) {
			const index = column.items.findIndex(panel => panel.id === panelId);
			if (index < 0) continue;
			fromColumn = column;
			fromIndex = index;
			break;
		}
		if (!fromColumn) return;
		const aloneAtEnd = fromColumn.items.length === 1 && state.columns[state.columns.length - 1] === fromColumn;
		if (aloneAtEnd) return;
		const [panel] = fromColumn.items.splice(fromIndex, 1);
		state.columns = state.columns.filter(column => column.items.length);
		state.columns.push({id: allocPanelId(), items: [panel]});
		emit();
		paint();
	};

	grid.addEventListener("dragover", (evt) => {
		if (dragKind !== "card") return;
		if (evt.target.closest(".fiveetools-dmscreen__column, .fiveetools-dmscreen__newcol")) return;
		evt.preventDefault();
		const lane = grid.querySelector(".fiveetools-dmscreen__newcol");
		if (lane) markDrop(lane, "is-drop-end");
		if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
	});
	grid.addEventListener("drop", (evt) => {
		if (dragKind !== "card") return;
		if (evt.target.closest(".fiveetools-dmscreen__column, .fiveetools-dmscreen__newcol")) return;
		evt.preventDefault();
		const id = dragId;
		endDrag();
		moveCardToNewColumn(id);
	});

	plugin._dmScreenColumnObserver?.disconnect();
	plugin._dmScreenColumnObserver = null;

	let pinColumn = null;
	let searchMode = "entry";
	let hitToken = 0;

	const openSearch = (mode, column) => {
		searchMode = mode;
		pinColumn = column || null;
		searchInput.placeholder = mode === "table"
			? "Search tables…"
			: "Search creatures, items, homebrew, campaign notes…";
		searchEl.removeClass("is-hidden");
		searchInput.focus();
		paintHits();
	};

	const paintHits = () => {
		const token = ++hitToken;
		hitsEl.empty();
		const term = String(searchInput.value || "").trim();
		if (searchMode === "table") {
			void Promise.all([listRollTables(plugin), listBundledScreenTables(plugin)]).then(([vault, bundled]) => {
				if (token !== hitToken) return;
				hitsEl.empty();
				const needle = term.toLowerCase();
				const tables = [
					...(vault || []).map(table => ({...table, kind: "vault"})),
					...(bundled || []),
				];
				const hits = tables.filter((table) => {
					if (!needle) return true;
					const hay = [
						table.name,
						table.source,
						table.fullName,
						table.stem,
						table.path,
					].filter(Boolean).join(" ").toLowerCase();
					return hay.includes(needle);
				});
				if (!hits.length) {
					hitsEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No tables."});
					return;
				}
				for (const table of hits) {
					const row = hitsEl.createDiv({cls: "fiveetools-dmscreen__hit"});
					row.createEl("div", {cls: "fiveetools-modal__name", text: table.name || "Table"});
					const sub = table.kind === "bundled"
						? (table.rollable ? "DM Screen · roll" : "DM Screen · reference")
						: "Roll table";
					row.createEl("div", {cls: "fiveetools-modal__sub", text: sub});
					row.addEventListener("click", () => {
						const isRef = table.kind === "bundled" && !table.rollable;
						const panel = {
							id: allocPanelId(),
							type: isRef ? "refTable" : "rollTable",
							title: table.name || (isRef ? "Reference table" : "Roll table"),
							doc: null,
							path: table.kind === "vault" ? table.path : "",
							text: "",
							value: 0,
						};
						if (table.kind === "bundled") panel.bundledId = table.id;
						placePanel(panel);
					});
				}
			});
			return;
		}
		if (term.length < 2) return;
		const docs = pinDocs(term);
		void findCampaignNotes(plugin, term).then((notes) => {
			if (token !== hitToken) return;
			hitsEl.empty();
			if (!docs.length && !notes.length) {
				hitsEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No matches."});
				return;
			}
			for (const note of notes) {
				const row = hitsEl.createDiv({cls: "fiveetools-dmscreen__hit"});
				row.createEl("div", {cls: "fiveetools-modal__name", text: note.title});
				row.createEl("div", {
					cls: "fiveetools-modal__sub",
					text: ["Note", note.campaign].filter(Boolean).join(" · "),
				});
				row.addEventListener("click", () => pinCampaignNote(note));
			}
			for (const doc of docs) {
				const row = hitsEl.createDiv({cls: "fiveetools-dmscreen__hit"});
				row.createEl("div", {cls: "fiveetools-modal__name", text: doc.n});
				row.createEl("div", {
					cls: "fiveetools-modal__sub",
					text: [doc.s === "HB" ? "Homebrew" : null, doc.cf, doc.sA || doc.s].filter(Boolean).join(" · "),
				});
				row.addEventListener("click", () => pinEntity(doc));
			}
		});
	};

	const closeSearch = () => {
		pinColumn = null;
		searchMode = "entry";
		searchInput.placeholder = "Search creatures, items, homebrew, campaign notes…";
		searchInput.value = "";
		hitsEl.empty();
		searchEl.addClass("is-hidden");
	};

	const placePanel = (panel) => {
		const column = pinColumn && state.columns.includes(pinColumn) ? pinColumn : null;
		pinColumn = null;
		if (column) column.items.push(panel);
		else state.columns.push({id: allocPanelId(), items: [panel]});
		closeSearch();
		emit();
		paint();
	};

	const pinEntity = (doc) => {
		placePanel({
			id: allocPanelId(),
			type: "entity",
			title: doc.n || "Entry",
			doc: slimDoc(doc),
			path: "",
			text: "",
			value: 0,
		});
	};

	const pinCampaignNote = (note) => {
		placePanel({
			id: allocPanelId(),
			type: "campaignNote",
			title: note.title || "Note",
			doc: null,
			path: note.path,
			text: "",
			value: 0,
		});
	};

	addEntityBtn.addEventListener("click", () => {
		if (!searchEl.hasClass("is-hidden") && searchMode === "entry" && !pinColumn) closeSearch();
		else openSearch("entry", null);
	});
	addTableBtn.addEventListener("click", () => {
		if (!searchEl.hasClass("is-hidden") && searchMode === "table" && !pinColumn) closeSearch();
		else openSearch("table", null);
	});
	addNoteBtn.addEventListener("click", () => {
		addColumn(blankPanel("note", "Note"));
	});
	addCounterBtn.addEventListener("click", () => {
		addColumn(blankPanel("counter", "Counter"));
	});
	addEncounterBtn.addEventListener("click", () => {
		if (items().some(panel => panel.type === "encounter")) return;
		addColumn(blankPanel("encounter", "Encounter"));
	});
	addInitBtn.addEventListener("click", () => {
		if (items().some(panel => panel.type === "initiative")) return;
		addColumn(blankPanel("initiative", "Initiative"));
	});
	addPlayersBtn.addEventListener("click", () => {
		if (items().some(panel => panel.type === "players")) return;
		addColumn(blankPanel("players", "Players"));
	});
	addTimeBtn.addEventListener("click", () => {
		if (items().some(panel => panel.type === "time")) return;
		addColumn(blankPanel("time", "Time"));
	});
	addDiceBtn.addEventListener("click", () => {
		if (items().some(panel => panel.type === "dice")) return;
		addColumn(blankPanel("dice", "Dice"));
	});
	addRollHistBtn.addEventListener("click", () => {
		if (items().some(panel => panel.type === "rollHistory")) return;
		addColumn(blankPanel("rollHistory", "Roll history"));
	});

	const pinReference = (spec) => {
		if (items().some(panel => panel.type === "reference" && panel.ref === spec.ref)) return;
		addColumn({...blankPanel("reference", spec.label), ref: spec.ref});
	};
	searchInput.addEventListener("input", paintHits);

	const paintCard = (parent, column, panel, setCollapsed) => {
		const card = parent.createDiv({cls: "fiveetools-dmscreen__card", attr: {"data-id": panel.id}});
		if (panel.collapsed) card.addClass("is-collapsed");
		const head = card.createDiv({cls: "fiveetools-dmscreen__head"});
		head.addEventListener("pointerdown", (evt) => {
			if (column.collapsed || panel.collapsed) {
				head.draggable = false;
				return;
			}
			head.draggable = !evt.target.closest("button, input, textarea");
		});
		head.addEventListener("dragstart", (evt) => {
			if (!head.draggable) {
				evt.preventDefault();
				return;
			}
			dragKind = "card";
			dragId = panel.id;
			openNewColumnLane();
			evt.dataTransfer?.setData("text/plain", panel.id);
			if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
			evt.stopPropagation();
		});
		head.addEventListener("dragend", endDrag);
		const fold = head.createEl("button", {
			text: panel.collapsed ? "▾" : "▴",
			cls: "fiveetools-dmscreen__fold fiveetools-iconbtn fiveetools-iconbtn--collapse",
			attr: {type: "button", title: panel.collapsed ? "Expand" : "Collapse"},
		});
		const setCardCollapsed = (collapsed) => {
			panel.collapsed = !!collapsed;
			card.toggleClass("is-collapsed", panel.collapsed);
			fold.setText(panel.collapsed ? "▾" : "▴");
			fold.setAttr("title", panel.collapsed ? "Expand" : "Collapse");
			emit();
		};
		fold.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			setCardCollapsed(!panel.collapsed);
		});
		head.addEventListener("click", (evt) => {
			if (!panel.collapsed || evt.target.closest("button")) return;
			setCardCollapsed(false);
		});
		card.addEventListener("dragover", (evt) => {
			if (dragKind !== "card") return;
			evt.preventDefault();
			evt.stopPropagation();
			if (dragId === panel.id) {
				clearMarks();
				return;
			}
			const rect = card.getBoundingClientRect();
			const after = evt.clientY > rect.top + rect.height / 2;
			markDrop(card, after ? "is-drop-after" : "is-drop-before");
			if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
		});
		card.addEventListener("drop", (evt) => {
			if (dragKind !== "card") return;
			evt.preventDefault();
			evt.stopPropagation();
			if (dragId === panel.id) {
				endDrag();
				return;
			}
			const id = dragId;
			const rect = card.getBoundingClientRect();
			const after = evt.clientY > rect.top + rect.height / 2;
			endDrag();
			moveCard(id, column.id, panel.id, after);
		});
		if (panel.type === "encounter") {
			const title = head.createEl("button", {
				cls: "fiveetools-dmscreen__title fiveetools-dmscreen__titlebtn",
				text: panel.title || "Encounter",
				attr: {type: "button", title: "Open encounter"},
			});
			title.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				if (column.collapsed) {
					setCollapsed(false);
					return;
				}
				if (panel.collapsed) {
					setCardCollapsed(false);
					return;
				}
				onOpenEncounter?.();
			});
		} else if (panel.type === "entity" || panel.type === "campaignNote" || panel.type === "reference" || panel.type === "rollTable" || panel.type === "refTable" || panel.type === "initiative" || panel.type === "time" || panel.type === "dice" || panel.type === "rollHistory") {
			head.createEl("div", {cls: "fiveetools-dmscreen__title", text: panel.title || panel.doc?.n || "Entry"});
		} else {
			const title = head.createEl("input", {
				cls: "fiveetools-dmscreen__titleinput",
				attr: {type: "text", value: panel.title || ""},
			});
			title.addEventListener("input", () => {
				panel.title = title.value;
				emit();
			});
			title.addEventListener("click", (evt) => {
				if (!panel.collapsed) {
					evt.stopPropagation();
					return;
				}
				evt.preventDefault();
				setCardCollapsed(false);
			});
		}
		const remove = head.createEl("button", {
			text: "×",
			cls: "fiveetools-dmscreen__remove",
			attr: {type: "button", title: "Remove panel"},
		});
		remove.addEventListener("click", (evt) => {
			evt.stopPropagation();
			for (const column of state.columns) {
				column.items = column.items.filter(it => it.id !== panel.id);
			}
			state.columns = state.columns.filter(column => column.items.length);
			emit();
			paint();
		});

		const body = card.createDiv({cls: "fiveetools-dmscreen__body"});
		if (panel.type === "note") paintNote(body, panel);
		else if (panel.type === "counter") paintCounter(body, panel);
		else if (panel.type === "campaignNote") void paintCampaignNote(body, panel);
		else if (panel.type === "encounter") paintEncounter(body);
		else if (panel.type === "players") void paintPlayers(body, panel);
		else if (panel.type === "time") paintTime(body, panel);
		else if (panel.type === "dice") paintDice(body, panel);
		else if (panel.type === "rollHistory") paintRollHistory(body);
		else if (panel.type === "initiative") {
			body.addClass("fiveetools-dmscreen__init");
			body.setAttr("tabindex", "0");
			paintInitiative(body, plugin);
			body.addEventListener("keydown", (evt) => onInitiativeKey(plugin, evt));
		}
		else if (panel.type === "reference") void paintReference(body, panel);
		else if (panel.type === "rollTable") void paintRollTable(body, panel);
		else if (panel.type === "refTable") void paintRefTable(body, panel);
		else void paintEntity(body, panel);
	};

	const paintDice = (body, panel) => {
		body.empty();
		if (!panel.dice) panel.dice = emptyDiceSession();
		const controls = body.createDiv();
		const history = body.createDiv({cls: "fiveetools-dmscreen__dicehist"});
		renderDiceRoller(controls, history, {
			plugin,
			session: panel.dice,
			compact: true,
			onSessionChange: (next) => {
				panel.dice = next;
				emit();
			},
		});
	};

	const paintRollHistory = (body) => {
		body._rollHistOff?.();
		body._rollHistOff = renderRollHistoryWidget(body);
	};

	const paintTime = (body, panel) => {
		body.empty();
		const time = {
			timeMinute: Number.isFinite(Number(panel.timeMinute)) ? Math.max(0, Math.trunc(panel.timeMinute)) : 0,
			timeMode: panel.timeMode,
			timeStep: panel.timeStep,
		};
		const steps = stepsFor(time.timeMode);
		if (!steps.some(step => step.id === time.timeStep)) time.timeStep = steps[0].id;
		panel.timeMinute = time.timeMinute;
		panel.timeMode = TIME_MODES.some(mode => mode.id === time.timeMode) ? time.timeMode : "explore";
		panel.timeStep = stepsFor(panel.timeMode).some(step => step.id === time.timeStep)
			? time.timeStep
			: stepsFor(panel.timeMode)[0].id;
		const parts = clockParts(panel.timeMinute);

		const head = body.createDiv({cls: "fiveetools-dmscreen__timehead"});
		head.createEl("div", {cls: "fiveetools-dmscreen__timeclock", text: `Day ${parts.day} · ${formatClock(parts)}`});
		head.createEl("div", {cls: "fiveetools-dmscreen__timeshift", text: shiftLabel(parts.shift)});

		const controls = body.createDiv({cls: "fiveetools-dmscreen__timecontrols"});
		const modeSel = controls.createEl("select", {attr: {title: "Mode"}});
		for (const mode of TIME_MODES) {
			modeSel.createEl("option", {attr: {value: mode.id}, text: mode.label});
		}
		modeSel.value = panel.timeMode;
		const stepSel = controls.createEl("select", {attr: {title: "Step"}});
		for (const step of stepsFor(panel.timeMode)) {
			stepSel.createEl("option", {attr: {value: String(step.id)}, text: step.label});
		}
		stepSel.value = String(panel.timeStep);

		const move = (delta) => {
			panel.timeMinute = addMinutes(panel.timeMinute, delta);
			emit();
			paintTime(body, panel);
		};
		const row = controls.createDiv({cls: "fiveetools-dmscreen__timerowbtns"});
		const minus = row.createEl("button", {text: "−", cls: "fiveetools-dmscreen__countbtn", attr: {type: "button", title: "Back"}});
		const plus = row.createEl("button", {text: "+", cls: "fiveetools-dmscreen__countbtn", attr: {type: "button", title: "Forward"}});
		minus.addEventListener("click", () => move(-panel.timeStep));
		plus.addEventListener("click", () => move(panel.timeStep));
		const shortBtn = row.createEl("button", {text: "Short rest", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Add 1 hour"}});
		const longBtn = row.createEl("button", {text: "Long rest", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Add 8 hours"}});
		shortBtn.addEventListener("click", () => move(SHORT_REST));
		longBtn.addEventListener("click", () => move(LONG_REST));

		modeSel.addEventListener("change", () => {
			panel.timeMode = modeSel.value;
			panel.timeStep = stepsFor(panel.timeMode)[0].id;
			emit();
			paintTime(body, panel);
		});
		stepSel.addEventListener("change", () => {
			panel.timeStep = Number(stepSel.value);
			emit();
			paintTime(body, panel);
		});

		const table = body.createDiv({cls: "fiveetools-dmscreen__timetable"});
		let marked = null;
		const dayBase = (parts.day - 1) * DAY_MINUTES;
		for (const column of dayColumns()) {
			const col = table.createDiv({
				cls: `fiveetools-dmscreen__timecol${column.shift === parts.shift ? " is-shift" : ""}`,
			});
			col.createDiv({
				cls: "fiveetools-dmscreen__timecolhead",
				text: column.rows[0].label,
				attr: {title: column.label},
			});
			for (const slot of column.rows) {
				const isNow = column.shift === parts.shift
					&& slot.minuteOfDay === parts.shift * 6 * 60 + parts.row * 10;
				const line = col.createDiv({
					cls: `fiveetools-dmscreen__timerow${slot.hour ? " is-hour" : ""}${isNow ? " is-now" : ""}`,
					text: slot.label,
					attr: {title: `Set time to ${slot.label}`},
				});
				line.addEventListener("click", () => {
					panel.timeMinute = dayBase + slot.minuteOfDay;
					emit();
					paintTime(body, panel);
				});
				if (isNow) marked = line;
			}
		}
		if (marked) {
			const rowTop = marked.getBoundingClientRect().top - table.getBoundingClientRect().top + table.scrollTop;
			table.scrollTop = Math.max(0, rowTop - table.clientHeight / 2);
		}
	};

	const paintPlayers = async (body, panel) => {
		body.empty();
		if (!Array.isArray(panel.characters)) panel.characters = [];
		const menus = body.createDiv({cls: "fiveetools-dmscreen__playermenus"});
		const characterSel = menus.createEl("select", {attr: {title: "Add a character"}});
		characterSel.createEl("option", {attr: {value: ""}, text: "Character"});
		const campaignSel = menus.createEl("select", {attr: {title: "Add a campaign's characters"}});
		campaignSel.createEl("option", {attr: {value: ""}, text: "Campaign"});
		const list = body.createDiv({cls: "fiveetools-dmscreen__playerlist"});

		const addIds = (nextIds) => {
			if (!state.columns.some(col => col.items.includes(panel))) return;
			const have = new Set(panel.characters);
			let changed = false;
			for (const id of nextIds) {
				const key = String(id || "").trim();
				if (!key || have.has(key)) continue;
				have.add(key);
				panel.characters.push(key);
				changed = true;
			}
			if (!changed) return;
			emit();
			paint();
		};
		characterSel.addEventListener("change", () => {
			const id = characterSel.value;
			characterSel.value = "";
			if (id) addIds([id]);
		});
		campaignSel.addEventListener("change", () => {
			const slug = campaignSel.value;
			campaignSel.value = "";
			if (!slug) return;
			void listEntries(plugin, slug, "players").then(entries => {
				addIds((entries || []).map(it => it.fields?.character));
			}).catch(e => {
				new Notice(e.message || "Could not load that campaign.");
			});
		});

		let characters = [];
		let campaigns = [];
		try {
			[characters, campaigns] = await Promise.all([
				listCharacters(plugin),
				listCampaigns(plugin),
			]);
		} catch (e) {
			if (!body.isConnected) return;
			list.createEl("p", {text: e.message || "Could not load characters."});
			return;
		}
		if (!body.isConnected) return;

		const have = new Set(panel.characters);
		for (const record of characters) {
			const id = String(record.fields?.ddb_id || "").trim();
			if (!id || have.has(id)) continue;
			characterSel.createEl("option", {attr: {value: id}, text: characterName(record)});
		}
		for (const campaign of campaigns) {
			campaignSel.createEl("option", {attr: {value: campaign.slug}, text: campaign.name});
		}

		if (!panel.characters.length) {
			list.createEl("p", {cls: "fiveetools-dmscreen__playerempty", text: "No characters yet."});
			return;
		}
		const byId = new Map(characters.map(record => [String(record.fields?.ddb_id || ""), record]));
		for (const id of panel.characters) paintPlayerCard(list, panel, id, byId.get(id));
	};

	const paintPlayerCard = (list, panel, id, record) => {
		const card = list.createDiv({cls: "fiveetools-dmscreen__player"});
		const head = card.createDiv({cls: "fiveetools-dmscreen__playerhead"});
		head.createEl("div", {cls: "fiveetools-dmscreen__playername", text: record ? characterName(record) : id});
		const select = head.createEl("select", {
			cls: "fiveetools-dmscreen__playercond",
			attr: {title: "Condition"},
		});
		select.createEl("option", {attr: {value: ""}, text: "—"});
		for (const cond of CONDITIONS) select.createEl("option", {attr: {value: cond.id}, text: cond.label});
		const play = playFor(record);
		const current = play?.conditions?.[0] || "";
		if (current) select.value = current;
		if (!record?.snapshot) select.setAttr("disabled", "true");
		select.addEventListener("change", () => {
			const next = playFor(record);
			if (!next) return;
			next.conditions = select.value ? [select.value] : [];
			void saveCharacterPlay(plugin, id, next).catch(e => {
				new Notice(e.message || "Could not save the condition.");
			});
		});
		const remove = head.createEl("button", {
			text: "×",
			cls: "fiveetools-dmscreen__remove",
			attr: {type: "button", title: "Remove from this panel"},
		});
		remove.addEventListener("click", () => {
			panel.characters = (panel.characters || []).filter(it => it !== id);
			emit();
			paint();
		});

		const stats = card.createDiv({cls: "fiveetools-dmscreen__playerstats"});
		const stat = (label, value) => {
			const box = stats.createDiv({cls: "fiveetools-dmscreen__playerstat"});
			box.createSpan({cls: "fiveetools-dmscreen__playerstat-label", text: label});
			box.createSpan({cls: "fiveetools-dmscreen__playerstat-value", text: value});
		};
		const fields = record?.fields || {};
		const hp = play?.hpMax != null && play.hpMax !== "" ? play.hpMax : fields.hp_max;
		stat("AC", statText(fields.ac));
		stat("HP", statText(hp));
		stat("PP", statText(record?.snapshot?.rolls?.passivePerception));
	};

	const loadPanelTable = async (panel) => {
		if (panel.bundledId) {
			const bundled = await getBundledScreenTable(plugin, panel.bundledId);
			return bundled
				? {ok: true, name: bundled.name, headers: bundled.headers, rows: bundled.rows}
				: {ok: false};
		}
		return readRollTableNote(plugin, panel.path);
	};

	const paintTableGrid = (host, parsed) => {
		const table = host.createEl("table", {cls: "fiveetools-dmscreen__table"});
		const head = table.createEl("thead").createEl("tr");
		for (const header of parsed.headers) head.createEl("th", {text: header});
		const tbody = table.createEl("tbody");
		for (const cells of parsed.rows) {
			const tr = tbody.createEl("tr");
			for (const cell of cells) {
				const td = tr.createEl("td");
				appendTextWithDiceRollers(td, cell);
			}
		}
		bindDiceRollers(host, plugin);
	};

	const paintRefTable = async (body, panel) => {
		body.empty();
		const tableHost = body.createDiv({cls: "fiveetools-dmscreen__rolltable"});
		const parsed = await loadPanelTable(panel);
		if (!body.isConnected) return;
		if (!parsed.ok) {
			tableHost.createEl("p", {text: "Table not found."});
			return;
		}
		if (parsed.name) panel.title = parsed.name;
		paintTableGrid(tableHost, parsed);
	};

	const paintRollTable = async (body, panel) => {
		body.empty();
		const rollBtn = body.createEl("button", {
			text: "Roll",
			cls: "fiveetools-btn fiveetools-dmscreen__rollbtn",
			attr: {type: "button"},
		});
		const resultEl = body.createDiv({cls: "fiveetools-dmscreen__rollresult"});
		const saved = savedRoll(panel.text);
		if (saved) showRollResult(resultEl, saved);
		const tableHost = body.createDiv({cls: "fiveetools-dmscreen__rolltable"});
		const parsed = await loadPanelTable(panel);
		if (!body.isConnected) return;
		if (!parsed.ok) {
			tableHost.createEl("p", {text: "Table not found."});
			return;
		}
		if (parsed.name) panel.title = parsed.name;
		paintTableGrid(tableHost, parsed);
		rollBtn.addEventListener("click", () => {
			try {
				const draws = rollTableResults(parsed.headers, parsed.rows, parsed.name);
				const next = draws.length > 1
					? {results: draws.map(packRoll)}
					: packRoll(draws[0]);
				panel.text = JSON.stringify(next);
				resultEl.empty();
				showRollResult(resultEl, next);
				emit();
			} catch (e) {
				resultEl.empty();
				resultEl.createEl("p", {text: e.message || "Roll failed."});
			}
		});
	};

	const showRollResult = (host, roll) => {
		if (Array.isArray(roll?.results)) {
			for (const part of roll.results) showRollResult(host, part);
			return;
		}
		const badge = roll.dieLabel && roll.total != null
			? `${roll.dieLabel}: ${roll.total}`
			: (roll.total != null ? String(roll.total) : "");
		if (badge) host.createEl("div", {cls: "fiveetools-dmscreen__rolldie", text: badge});
		for (const cell of roll.cells || []) {
			const line = host.createDiv({cls: "fiveetools-dmscreen__rollline"});
			if (cell.header) line.createEl("span", {cls: "fiveetools-dmscreen__rolllabel", text: cell.header});
			const value = line.createSpan();
			appendTextWithDiceRollers(value, cell.text || "");
		}
		bindDiceRollers(host, plugin);
	};

	const paintNote = (body, panel) => {
		const area = body.createEl("textarea", {
			cls: "fiveetools-dmscreen__note",
			attr: {placeholder: "Note", rows: "1"},
		});
		const fit = () => {
			area.style.height = "auto";
			area.style.height = `${area.scrollHeight}px`;
		};
		area.value = panel.text || "";
		fit();
		let width = body.clientWidth;
		const observer = new ResizeObserver(() => {
			if (!area.isConnected) {
				observer.disconnect();
				return;
			}
			if (body.clientWidth === width) return;
			width = body.clientWidth;
			fit();
		});
		observer.observe(body);
		plugin._dmNoteFit.push(() => observer.disconnect());
		area.addEventListener("input", () => {
			panel.text = area.value;
			fit();
			emit();
		});
	};

	const paintCounter = (body, panel) => {
		const row = body.createDiv({cls: "fiveetools-dmscreen__counter"});
		const minus = row.createEl("button", {
			text: "−",
			cls: "fiveetools-dmscreen__countbtn",
			attr: {type: "button", title: "−1"},
		});
		const valueEl = row.createEl("span", {
			cls: "fiveetools-dmscreen__count",
			text: String(panel.value || 0),
		});
		const plus = row.createEl("button", {
			text: "+",
			cls: "fiveetools-dmscreen__countbtn",
			attr: {type: "button", title: "+1"},
		});
		const step = row.createEl("input", {
			cls: "fiveetools-dmscreen__countstep",
			attr: {type: "number", title: "Amount to add or subtract"},
		});
		const amount = () => stepAmount(step.value);
		const setValue = (next) => {
			panel.value = next;
			valueEl.setText(String(next));
			step.value = "";
			emit();
		};
		minus.addEventListener("click", () => setValue((Number(panel.value) || 0) - amount()));
		plus.addEventListener("click", () => setValue((Number(panel.value) || 0) + amount()));
	};

	const paintCampaignNote = async (body, panel) => {
		body.setText("Loading…");
		try {
			const entry = await readCampaignNote(plugin, panel.path);
			if (!body.isConnected) return;
			body.empty();
			if (!entry) {
				body.createEl("p", {text: "Note not found."});
				return;
			}
			const host = body.createDiv({cls: "fiveetools-dmscreen__markdown"});
			await MarkdownRenderer.render(plugin.app, entry.body || "", host, panel.path, plugin);
		} catch (e) {
			if (!body.isConnected) return;
			body.empty();
			body.createEl("p", {text: e.message || "Could not load note."});
		}
	};

	const commitEncounter = (session) => {
		plugin._encounterSession = session;
		setEncounterInstance(session);
		queueSaveEncountersToVault(plugin);
	};

	const paintEncounter = (body) => {
		body.empty();
		let session = plugin._encounterSession || getEncounterInstance();
		if (!plugin._encounterSession) plugin._encounterSession = session;

		const tools = body.createDiv({cls: "fiveetools-dmscreen__enctools"});
		const search = tools.createEl("input", {
			cls: "fiveetools-dmscreen__encsearch",
			attr: {type: "search", placeholder: "Add creature", title: "Search creatures"},
		});
		const savedSel = tools.createEl("select", {
			cls: "fiveetools-dmscreen__encsaved",
			attr: {title: "Add a saved encounter"},
		});
		savedSel.createEl("option", {attr: {value: ""}, text: "Saved encounter"});
		const hits = body.createDiv({cls: "fiveetools-dmscreen__enchits"});
		const roster = body.createDiv({cls: "fiveetools-dmscreen__encroster"});
		let hitDocs = [];
		let hitIndex = 0;

		const paintRoster = () => {
			roster.empty();
			const combatants = session?.combatants || [];
			if (!combatants.length) {
				roster.createEl("p", {cls: "fiveetools-view__meta", text: "No creatures in the encounter."});
				return;
			}
			const setHp = (combatant, nextHp) => {
				combatant.hpCurrent = nextHp;
				commitEncounter(session);
				paintRoster();
			};
			for (const group of listKindGroups(combatants)) {
				const headRow = roster.createDiv({cls: "fiveetools-dmscreen__encgroup"});
				const name = group.members.length > 1 ? `${group.label} ×${group.members.length}` : group.label;
				headRow.createEl("span", {cls: "fiveetools-dmscreen__encname", text: name});
				bindEncounterHover(headRow, plugin, group.members[0]?.doc, group.members[0]?.ent);
				headRow.createEl("span", {
					cls: "fiveetools-dmscreen__encinit",
					text: group.initScore != null ? String(group.initScore) : "—",
				});
				for (const combatant of group.members) {
					const row = roster.createDiv({cls: "fiveetools-dmscreen__encrow"});
					const who = row.createEl("span", {cls: "fiveetools-dmscreen__encwho"});
					const remove = who.createEl("button", {
						text: "×",
						cls: "fiveetools-dmscreen__encremove",
						attr: {type: "button", title: `Remove ${combatant.label || group.label}`},
					});
					who.createEl("span", {
						cls: "fiveetools-dmscreen__enclabel",
						text: combatantTag(combatant),
						attr: {title: combatant.label || group.label},
					});
					const hp = row.createDiv({cls: "fiveetools-dmscreen__enchp"});
					const minus = hp.createEl("button", {
						text: "−",
						cls: "fiveetools-dmscreen__countbtn",
						attr: {type: "button", title: "−1 HP"},
					});
					const input = hp.createEl("input", {
						cls: "fiveetools-dmscreen__hpinput",
						attr: {type: "number", value: String(combatant.hpCurrent ?? 0), title: "Current HP"},
					});
					hp.createEl("span", {cls: "fiveetools-dmscreen__hpmax", text: `/${combatant.hpMax ?? 0}`});
					const plus = hp.createEl("button", {
						text: "+",
						cls: "fiveetools-dmscreen__countbtn",
						attr: {type: "button", title: "+1 HP"},
					});
					const step = hp.createEl("input", {
						cls: "fiveetools-dmscreen__countstep",
						attr: {type: "number", title: "Amount to add or subtract"},
					});
					const extra = [];
					if (Number(combatant.tempHp) > 0) extra.push(`temp ${combatant.tempHp}`);
					const cond = conditionLabel(combatant.condition);
					if (cond) extra.push(cond);
					if (extra.length) row.createEl("span", {cls: "fiveetools-dmscreen__encmeta", text: extra.join("  ")});
					minus.addEventListener("click", (evt) => {
						evt.stopPropagation();
						setHp(combatant, adjustHp(combatant.hpCurrent, combatant.hpMax, -stepAmount(step.value)));
					});
					plus.addEventListener("click", (evt) => {
						evt.stopPropagation();
						setHp(combatant, adjustHp(combatant.hpCurrent, combatant.hpMax, stepAmount(step.value)));
					});
					input.addEventListener("click", (evt) => evt.stopPropagation());
					step.addEventListener("click", (evt) => evt.stopPropagation());
					input.addEventListener("change", () => {
						const typed = Number(input.value);
						const cap = Number(combatant.hpMax) || 0;
						const next = Number.isFinite(typed) ? Math.max(0, Math.min(cap, typed)) : combatant.hpCurrent;
						setHp(combatant, next);
					});
					remove.addEventListener("click", (evt) => {
						evt.stopPropagation();
						const combatants = (session.combatants || []).filter(it => it.id !== combatant.id);
						let initOrderBaseline = session.initOrderBaseline;
						if (Array.isArray(initOrderBaseline)) {
							initOrderBaseline = initOrderBaseline.filter(id => id !== combatant.id);
							if (!initOrderBaseline.length) initOrderBaseline = null;
						}
						session = {
							...session,
							combatants,
							selectedId: session.selectedId === combatant.id
								? (combatants[combatants.length - 1]?.id || null)
								: session.selectedId,
							initOrderBaseline,
						};
						commitEncounter(session);
						paintRoster();
					});
				}
			}
		};

		const markHit = () => {
			[...hits.children].forEach((row, index) => row.classList.toggle("is-selected", index === hitIndex));
		};
		const paintHits = () => {
			hits.empty();
			hitIndex = 0;
			const term = String(search.value || "").trim();
			if (term.length < 2) {
				hitDocs = [];
				return;
			}
			hitDocs = searchEntities(term, {categoriesExact: ["bestiary"], limit: 8});
			if (!hitDocs.length) {
				hits.createEl("div", {cls: "fiveetools-modal__empty", text: "No creatures."});
				return;
			}
			hitDocs.forEach((doc, index) => {
				const row = hits.createDiv({cls: `fiveetools-dmscreen__hit${index === 0 ? " is-selected" : ""}`});
				row.createEl("div", {cls: "fiveetools-modal__name", text: doc.n});
				row.createEl("div", {cls: "fiveetools-modal__sub", text: [doc.sA || doc.s, doc.cf].filter(Boolean).join(" · ")});
				row.addEventListener("click", () => { void addCreature(doc); });
			});
		};
		const addCreature = async (doc) => {
			if (!doc) return;
			try {
				const next = await addCombatants(session, doc, 1);
				session = {...session, combatants: next.combatants, selectedId: next.selectedId};
				commitEncounter(session);
				search.value = "";
				hitDocs = [];
				hits.empty();
				search.focus();
				paintRoster();
			} catch (e) {
				new Notice(e.message || "Could not add that creature.");
			}
		};
		search.addEventListener("input", paintHits);
		search.addEventListener("keydown", (evt) => {
			if (evt.key === "ArrowDown" || evt.key === "ArrowUp") {
				if (!hitDocs.length) return;
				evt.preventDefault();
				const next = evt.key === "ArrowDown" ? hitIndex + 1 : hitIndex - 1;
				hitIndex = Math.max(0, Math.min(hitDocs.length - 1, next));
				markHit();
				return;
			}
			if (evt.key !== "Enter") return;
			evt.preventDefault();
			void addCreature(hitDocs[hitIndex]);
		});

		savedSel.addEventListener("change", () => {
			const id = savedSel.value;
			savedSel.value = "";
			if (!id) return;
			const saved = getSavedEncounter(id);
			if (!saved?.combatants?.length) {
				new Notice("That encounter has no creatures.");
				return;
			}
			session = appendSavedCombatants(session, saved);
			commitEncounter(session);
			paintRoster();
		});
		void loadEncountersFromVault(plugin).then(() => {
			if (!savedSel.isConnected) return;
			for (const encounter of listSavedEncounters()) {
				savedSel.createEl("option", {attr: {value: encounter.id}, text: encounter.name || "Encounter"});
			}
		}).catch(() => {});

		paintRoster();
	};

	const paintReference = async (body, panel) => {
		body.setText("Loading…");
		try {
			if (panel.ref === "conditions") {
				if (!body.isConnected) return;
				body.empty();
				for (const cond of CONDITIONS) {
					const doc = findEntityDoc(cond.label, {categoriesExact: ["condition"]});
					const block = body.createDiv({cls: "fiveetools-dmscreen__refblock"});
					block.createEl("div", {cls: "fiveetools-dmscreen__refname", text: cond.label});
					if (!doc) {
						block.createEl("p", {text: "Not found."});
						continue;
					}
					await renderDocInto(block, doc);
					if (!body.isConnected) return;
				}
				return;
			}
			const spec = QUICK_REFS.find(it => it.ref === panel.ref);
			const doc = spec?.name
				? findEntityDoc(spec.name, {categoriesExact: spec.categories})
				: null;
			if (!body.isConnected) return;
			body.empty();
			if (!doc) {
				body.createEl("p", {text: "Not found."});
				return;
			}
			await renderDocInto(body, doc);
		} catch (e) {
			if (!body.isConnected) return;
			body.empty();
			body.createEl("p", {text: e.message || "Could not load reference."});
		}
	};

	const renderDocInto = async (host, doc) => {
		const loaded = await loadEntity(doc);
		if (!host.isConnected) return;
		if (!loaded?.ent) {
			host.createEl("p", {text: `No JSON found for ${doc?.n || "entry"}.`});
			return;
		}
		if (loaded.ent.__prop === "monster") {
			const token = resolveTokenImage(loaded.ent, {imageBaseUrl: plugin?.settings?.imageBaseUrl});
			const src = token?.url ? await cachedMediaSrc(plugin, token.url) : "";
			if (!host.isConnected) return;
			if (src) {
				host.createEl("img", {
					cls: "fiveetools-dmscreen__token",
					attr: {src, alt: loaded.ent.name || doc?.n || ""},
				});
			}
		}
		const page = loadPageForDoc(doc);
		const wrap = host.createDiv({cls: "fiveetools-view__stats"});
		const ent = loaded.ent.__prop === "monster"
			? await enrichCreatureSpellcasting(loaded.ent)
			: loaded.ent;
		if (!host.isConnected) return;
		wrap.innerHTML = renderCompactHtml(ent, page);
		if (ent.__prop === "monster") appendCreatureStatFooter(wrap, ent, plugin);
		bindInternalLinks(wrap, plugin);
		bindDiceRollers(wrap, plugin);
		await rewriteMediaUrls(plugin, wrap);
	};

	const paintEntity = async (body, panel) => {
		body.setText("Loading…");
		try {
			if (!body.isConnected) return;
			body.empty();
			await renderDocInto(body, panel.doc);
		} catch (e) {
			if (!body.isConnected) return;
			body.empty();
			body.createEl("p", {text: e.message || "Could not load entry."});
		}
	};

	paint();
}

function copyColumns (board) {
	const source = Array.isArray(board?.columns)
		? board.columns
		: (board?.panels || []).map(panel => ({id: "", items: [panel]}));
	return source.map(col => ({
		id: col.id || allocPanelId(),
		collapsed: !!col.collapsed,
		items: (col.items || []).map(it => ({...it, doc: it.doc ? {...it.doc} : null})),
	})).filter(col => col.items.length);
}

function savedRoll (text) {
	try {
		const data = JSON.parse(text || "");
		if (!data) return null;
		if (Array.isArray(data.results)) return data;
		if (!Array.isArray(data.cells)) return null;
		return data;
	} catch (_) {
		return null;
	}
}

function packRoll (draw) {
	return {
		dieLabel: draw?.die?.label || "",
		total: draw?.total,
		cells: (draw?.cells || []).map(cell => ({header: cell.header || "", text: String(cell.text || "")})),
	};
}

function bindEncounterHover (el, plugin, doc, ent) {
	if ((!doc || (!doc.n && !doc.u)) && !ent) return;
	attachHoverCard(el, plugin, () => ({doc, ent}));
}

function playFor (record) {
	const snap = record?.snapshot;
	if (!snap) return null;
	if (snap.play) {
		if (!Array.isArray(snap.play.conditions)) snap.play.conditions = [];
		return snap.play;
	}
	const fields = record.fields || {};
	const numberOrNull = (value) => {
		if (value == null || value === "") return null;
		const n = Number(value);
		return Number.isFinite(n) ? n : null;
	};
	snap.play = {
		hpCurrent: numberOrNull(fields.hp_current),
		hpMax: numberOrNull(fields.hp_max),
		tempHp: 0,
		conditions: [],
		deathSaves: {success: 0, fail: 0, stable: false},
		inspiration: false,
		xp: null,
		prepared: [],
		hitDiceSpent: {},
		coins: {},
		gear: [],
	};
	return snap.play;
}

function statText (value) {
	if (value == null || value === "") return "—";
	return String(value);
}

function blankPanel (type, title) {
	const panel = {
		id: allocPanelId(),
		type,
		title,
		doc: null,
		path: "",
		ref: "",
		text: "",
		value: 0,
	};
	if (type === "players") panel.characters = [];
	if (type === "time") {
		panel.timeMinute = 0;
		panel.timeMode = "explore";
		panel.timeStep = 10;
	}
	if (type === "dice") panel.dice = emptyDiceSession();
	return panel;
}

function conditionLabel (id) {
	const key = String(id || "");
	if (!key) return "";
	return CONDITIONS.find(it => it.id === key)?.label || key;
}

function pinDocs (term) {
	const needle = String(term || "").trim().toLowerCase();
	const brew = [];
	for (const type of HOMEBREW_TYPES) {
		for (const ent of listBrewEntities(type.id)) {
			if (!String(ent?.name || "").toLowerCase().includes(needle)) continue;
			brew.push(brewDocFromEntity(ent, type));
		}
	}
	const rest = searchEntities(term, {categoriesExact: PIN_CATEGORIES, limit: 12});
	const seen = new Set();
	const out = [];
	for (const doc of [...brew, ...rest]) {
		const key = `${doc.s}|${doc.u}|${doc.c}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(doc);
		if (out.length >= 8) break;
	}
	return out;
}

async function findCampaignNotes (plugin, term) {
	const needle = String(term || "").trim().toLowerCase();
	if (needle.length < 2) return [];
	const campaigns = await listCampaigns(plugin);
	const out = [];
	for (const camp of campaigns) {
		const entries = await listEntries(plugin, camp.slug, "notes");
		for (const entry of entries) {
			const fromFile = fileStem(entry.path);
			const title = String(entry.fields?.name || "").trim() || fromFile || "Note";
			const blob = `${title}\n${fromFile}\n${entry.body || ""}`.toLowerCase();
			if (!blob.includes(needle)) continue;
			out.push({
				title,
				path: entry.path,
				campaign: camp.name,
				rank: title.toLowerCase().includes(needle) ? 0 : 1,
			});
		}
	}
	out.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
	return out.slice(0, 8);
}

async function readCampaignNote (plugin, filePath) {
	const vault = plugin?.app?.vault;
	if (!vault || !filePath) return null;
	const file = vault.getAbstractFileByPath(filePath);
	if (!file || file.children) return null;
	return parseCampaignMarkdown(await vault.read(file));
}

function playerIdsOnBoard (plugin) {
	const board = plugin?._dmScreenBoard || getDmScreenBoard();
	const ids = [];
	const seen = new Set();
	for (const column of board?.columns || []) {
		for (const panel of column.items || []) {
			if (panel.type !== "players") continue;
			for (const id of panel.characters || []) {
				const key = String(id || "").trim();
				if (!key || seen.has(key)) continue;
				seen.add(key);
				ids.push(key);
			}
		}
	}
	return ids;
}

async function addBoardPlayers (plugin) {
	const ids = playerIdsOnBoard(plugin);
	if (!ids.length) {
		new Notice("The Players card has no characters.");
		return;
	}
	let characters = [];
	try {
		characters = await listCharacters(plugin);
	} catch (e) {
		new Notice(e?.message || "Could not load characters.");
		return;
	}
	const byId = new Map(characters.map(record => [characterId(record), record]));
	const records = ids.map(id => byId.get(id)).filter(Boolean);
	if (!records.length) {
		new Notice("The Players card has no characters.");
		return;
	}
	if (!addPlayerRecordsFrom20(plugin, records)) new Notice("Those players are already on the table.");
}

function childWithClass (host, cls) {
	return [...host.children].find(el => el.classList.contains(cls)) || null;
}

function initRowClass (chip, current, done) {
	return `fiveetools-init-list__row${chip.key === current ? " is-current" : ""}${done.includes(chip.key) ? " is-done" : ""}`;
}

function paintInitiative (host, plugin) {
	let actions = childWithClass(host, "fiveetools-dmscreen__initactions");
	if (!actions) {
		actions = host.createDiv({cls: "fiveetools-dmscreen__initactions"});
		const clearBtn = actions.createEl("button", {
			text: "Clear",
			cls: "fiveetools-btn fiveetools-btn--ghost",
			attr: {type: "button", title: "Remove every creature, including those on the ruler"},
		});
		clearBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			clearTableRoster(plugin);
		});
		const toggle = actions.createEl("button", {
			cls: "fiveetools-btn fiveetools-btn--ghost",
			attr: {type: "button", title: "Show or hide the initiative roster on the Table", "data-role": "roster-toggle"},
		});
		toggle.addEventListener("click", (evt) => {
			evt.stopPropagation();
			const live = ensureTableSession(plugin);
			live.showRoster = live.showRoster === false;
			refreshTable(plugin);
		});
		const addBtn = actions.createEl("button", {
			text: "Players",
			cls: "fiveetools-btn fiveetools-btn--ghost",
			attr: {type: "button", title: "Add the Players card from 20 downward"},
		});
		addBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			void addBoardPlayers(plugin);
		});
		const dmBtn = actions.createEl("button", {
			text: "DM",
			cls: "fiveetools-btn fiveetools-btn--ghost",
			attr: {type: "button", title: "Add Enemies at the end of the roster"},
		});
		dmBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			addNamedAtEnd(plugin, "Enemies");
		});
		const nameEl = actions.createEl("input", {
			cls: "fiveetools-dmscreen__initname",
			attr: {type: "text", placeholder: "Name, then Enter", title: "Add this name under the players"},
		});
		nameEl.addEventListener("keydown", (evt) => {
			if (evt.key !== "Enter") return;
			evt.preventDefault();
			evt.stopPropagation();
			addNamedBelowPlayers(plugin, nameEl.value);
			nameEl.value = "";
			nameEl.focus();
		});
		nameEl.addEventListener("click", (evt) => evt.stopPropagation());
		const sizeRow = host.createDiv({cls: "fiveetools-dmscreen__initsize"});
		sizeRow.createSpan({text: "Size"});
		const size = sizeRow.createEl("input", {
			attr: {type: "range", min: "1", max: "15", step: "1", title: "Table roster size"},
		});
		const sizeValue = sizeRow.createSpan({cls: "fiveetools-dmscreen__initsize-value"});
		const showSize = (value) => {
			size.value = String(value);
			sizeValue.setText(String(value));
		};
		showSize(tableInitHeightPercent(plugin.settings));
		size.addEventListener("input", () => {
			const value = tableInitHeightPercent({tableInitHeight: size.value});
			plugin.settings.tableInitHeight = value;
			showSize(value);
			void plugin.saveSettings?.();
			refreshTable(plugin);
		});
		size.addEventListener("click", (evt) => evt.stopPropagation());
	}
	const session = ensureTableSession(plugin);
	const shown = session.showRoster !== false;
	const toggle = actions.querySelector("[data-role='roster-toggle']");
	toggle.textContent = shown ? "Hide" : "Show";
	toggle.className = `fiveetools-btn fiveetools-btn--ghost${shown ? " is-selected" : ""}`;
	const chips = placedChips(session);
	let list = childWithClass(host, "fiveetools-init-list");
	const empty = childWithClass(host, "fiveetools-view__meta");
	if (!chips.length) {
		list?.remove();
		if (!empty) host.createEl("p", {cls: "fiveetools-view__meta", text: "Drag creatures onto the Table ruler."});
		return;
	}
	empty?.remove();
	if (!list) list = host.createDiv({cls: "fiveetools-init-list"});
	const done = Array.isArray(session.doneKeys) ? session.doneKeys : [];
	const current = chips.some(chip => chip.key === session.turnKey) ? session.turnKey : chips[0].key;
	const rows = [...list.children];
	const same = rows.length === chips.length && chips.every((chip, i) => {
		const name = rows[i].querySelector(".fiveetools-init-list__name");
		const token = rows[i].querySelector(".fiveetools-init-list__token");
		const src = chip.members?.find(member => member.image)?.image || "";
		const tokenOk = src ? token?.getAttribute("src") === src : token?.classList.contains("fiveetools-init-list__fallback");
		return rows[i].dataset.key === chip.key && name?.textContent === chip.label && tokenOk;
	});
	if (same) {
		chips.forEach((chip, i) => { rows[i].className = initRowClass(chip, current, done); });
		return;
	}
	list.empty();
	for (const chip of chips) {
		const row = list.createDiv({
			cls: initRowClass(chip, current, done),
			attr: {"data-key": chip.key, title: "Double-click to mark this turn. Again, before the round ends, unmarks this row."},
		});
		appendInitToken(row, chip);
		const name = row.createSpan({
			cls: "fiveetools-init-list__name",
			text: chip.label,
			attr: {draggable: "true", title: "Drag to reorder. Double-click to mark this turn. Again, before the round ends, unmarks this row."},
		});
		name.addEventListener("dragstart", (evt) => {
			evt.stopPropagation();
			evt.dataTransfer.setData("text/plain", JSON.stringify({rosterKey: chip.key}));
			evt.dataTransfer.effectAllowed = "move";
		});
		row.addEventListener("dragover", (evt) => {
			evt.preventDefault();
			const after = evt.clientY > row.getBoundingClientRect().top + row.clientHeight / 2;
			row.classList.toggle("is-drop-before", !after);
			row.classList.toggle("is-drop-after", after);
		});
		row.addEventListener("dragleave", (evt) => {
			if (row.contains(evt.relatedTarget)) return;
			row.classList.remove("is-drop-before", "is-drop-after");
		});
		row.addEventListener("drop", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			const after = row.classList.contains("is-drop-after");
			row.classList.remove("is-drop-before", "is-drop-after");
			let payload = null;
			try { payload = JSON.parse(evt.dataTransfer?.getData("text/plain") || ""); } catch (_) { return; }
			if (!payload?.rosterKey) return;
			reorderPlacedRoster(plugin, payload.rosterKey, chip.key, after);
		});
		const remove = row.createEl("button", {
			text: "×",
			cls: "fiveetools-init-list__x",
			attr: {type: "button", title: `Remove ${chip.label}`},
		});
		remove.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			removeTableGroup(plugin, chip.key);
		});
		remove.addEventListener("dblclick", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
		});
		row.addEventListener("click", () => selectTableTurn(plugin, chip.key));
		row.addEventListener("dblclick", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			finishTableTurn(plugin, chip.key);
		});
	}
}

function slimDoc (doc) {
	return {
		n: doc.n || "",
		u: doc.u || "",
		s: doc.s || "",
		c: doc.c ?? null,
		cf: doc.cf || "",
		sA: doc.sA || "",
	};
}
