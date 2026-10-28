import {MarkdownRenderer} from "obsidian";
import {fileStem, listCampaigns, listEntries, parseCampaignMarkdown} from "./campaign-store.js";
import {loadPageForDoc, renderCompactHtml} from "./compact-render.js";
import {CONDITIONS} from "./creature-form.js";
import {appendCreatureStatFooter} from "./creature-stat-footer.js";
import {appendTextWithDiceRollers, bindDiceRollers} from "./dice-roll.js";
import {listRollTables, readRollTableNote} from "./roll-tables/roll-table-store.js";
import {rollOnTable} from "./roll-tables/table-roll.js";
import {allocPanelId, queueSaveDmScreen, setDmScreenBoard} from "./dm-screen-store.js";
import {getEncounterInstance, queueSaveEncountersToVault, setEncounterInstance} from "./encounter-store.js";
import {adjustHp, listKindGroups} from "./encounter-view.js";
import {bindInternalLinks} from "./entity-reader.js";
import {loadEntity} from "./entity-loader.js";
import {HOMEBREW_TYPES, listBrewEntities} from "./homebrew-store.js";
import {resolveTokenImage} from "./image-resolver.js";
import {cachedMediaSrc, rewriteMediaUrls} from "./media-cache.js";
import {brewDocFromEntity, findEntityDoc, searchEntities} from "./search-index.js";
import {ensureTableSession, onTableChange} from "./table-session.js";
import {onInitiativeKey, placedChips, selectTableTurn, castTableWindow, closeTableWindow, tableWindowOpen, clearTableRoster} from "./table-view.js";

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
	const tableBtn = bar.createEl("button", {
		text: "Table",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Open or close the Table window"},
	});
	const syncTableBtn = () => {
		const open = tableWindowOpen(plugin);
		tableBtn.setText(open ? "Close table" : "Table");
		tableBtn.toggleClass("is-selected", open);
		listEl.querySelectorAll(".fiveetools-dmscreen__tabletoggle").forEach(el => {
			el.setText(open ? "Close table" : "Table");
			el.toggleClass("is-selected", open);
		});
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
		text: "Roll table",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Pin a roll table"},
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
		for (const btn of refButtons) {
			btn.el.toggleAttribute("disabled", items().some(panel => panel.type === "reference" && panel.ref === btn.ref));
		}
	};

	const addColumn = (panel) => {
		state.columns.push({id: allocPanelId(), items: [panel]});
		emit();
		paint();
	};

	const paint = () => {
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
			const grip = el.createDiv({
				cls: "fiveetools-dmscreen__colgrip",
				attr: {title: "Drag to move this column", draggable: "true"},
			});
			grip.addEventListener("dragstart", (evt) => {
				dragKind = "column";
				dragId = column.id;
				evt.dataTransfer?.setData("text/plain", column.id);
				if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
				evt.stopPropagation();
			});
			grip.addEventListener("dragend", endDrag);
			for (const panel of column.items) paintCard(el, column, panel);
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
				attr: {type: "button", title: "Add a roll table to this column"},
			});
			entryBtn.addEventListener("click", () => openSearch("entry", column));
			tableBtn.addEventListener("click", () => openSearch("table", column));
			noteBtn.addEventListener("click", () => {
				column.items.push(blankPanel("note", "Note"));
				emit();
				paint();
			});
			counterBtn.addEventListener("click", () => {
				column.items.push(blankPanel("counter", "Counter"));
				emit();
				paint();
			});
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
			? "Search roll tables…"
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
			void listRollTables(plugin).then((tables) => {
				if (token !== hitToken) return;
				hitsEl.empty();
				const needle = term.toLowerCase();
				const hits = (tables || []).filter(table => !needle || String(table.name || "").toLowerCase().includes(needle));
				if (!hits.length) {
					hitsEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No tables."});
					return;
				}
				for (const table of hits) {
					const row = hitsEl.createDiv({cls: "fiveetools-dmscreen__hit"});
					row.createEl("div", {cls: "fiveetools-modal__name", text: table.name || "Table"});
					row.createEl("div", {cls: "fiveetools-modal__sub", text: "Roll table"});
					row.addEventListener("click", () => {
						placePanel({
							id: allocPanelId(),
							type: "rollTable",
							title: table.name || "Roll table",
							doc: null,
							path: table.path,
							text: "",
							value: 0,
						});
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

	const pinReference = (spec) => {
		if (items().some(panel => panel.type === "reference" && panel.ref === spec.ref)) return;
		addColumn({...blankPanel("reference", spec.label), ref: spec.ref});
	};
	searchInput.addEventListener("input", paintHits);

	const paintCard = (parent, column, panel) => {
		const card = parent.createDiv({cls: "fiveetools-dmscreen__card", attr: {"data-id": panel.id}});
		const head = card.createDiv({cls: "fiveetools-dmscreen__head"});
		head.addEventListener("pointerdown", (evt) => {
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
				onOpenEncounter?.();
			});
		} else if (panel.type === "entity" || panel.type === "campaignNote" || panel.type === "reference" || panel.type === "rollTable" || panel.type === "initiative") {
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
			title.addEventListener("click", (evt) => evt.stopPropagation());
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
		else if (panel.type === "initiative") {
			body.addClass("fiveetools-dmscreen__init");
			body.setAttr("tabindex", "0");
			paintInitiative(body, plugin);
			body.addEventListener("keydown", (evt) => onInitiativeKey(plugin, evt));
		}
		else if (panel.type === "reference") void paintReference(body, panel);
		else if (panel.type === "rollTable") void paintRollTable(body, panel);
		else void paintEntity(body, panel);
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
		const parsed = await readRollTableNote(plugin, panel.path);
		if (!body.isConnected) return;
		if (!parsed.ok) {
			tableHost.createEl("p", {text: "Table not found."});
			return;
		}
		if (parsed.name) panel.title = parsed.name;
		const table = tableHost.createEl("table", {cls: "fiveetools-dmscreen__table"});
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
		bindDiceRollers(tableHost, plugin);
		rollBtn.addEventListener("click", () => {
			try {
				const draw = rollOnTable(parsed.headers, parsed.rows, parsed.name);
				const next = {
					dieLabel: draw.die?.label || "",
					total: draw.total,
					cells: (draw.cells || []).map(cell => ({header: cell.header || "", text: String(cell.text || "")})),
				};
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
			attr: {placeholder: "Note"},
		});
		area.value = panel.text || "";
		area.addEventListener("input", () => {
			panel.text = area.value;
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
		const setValue = (next) => {
			panel.value = next;
			valueEl.setText(String(next));
			emit();
		};
		minus.addEventListener("click", () => setValue((Number(panel.value) || 0) - 1));
		plus.addEventListener("click", () => setValue((Number(panel.value) || 0) + 1));
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
		const session = plugin._encounterSession || getEncounterInstance();
		if (!plugin._encounterSession) plugin._encounterSession = session;
		const combatants = session?.combatants || [];
		if (!combatants.length) {
			body.createEl("p", {cls: "fiveetools-view__meta", text: "No creatures in the encounter."});
			return;
		}
		const setHp = (combatant, nextHp) => {
			combatant.hpCurrent = nextHp;
			commitEncounter(session);
			paintEncounter(body);
		};
		for (const group of listKindGroups(combatants)) {
			const headRow = body.createDiv({cls: "fiveetools-dmscreen__encgroup"});
			const name = group.members.length > 1 ? `${group.label} ×${group.members.length}` : group.label;
			headRow.createEl("span", {cls: "fiveetools-dmscreen__encname", text: name});
			headRow.createEl("span", {
				cls: "fiveetools-dmscreen__encinit",
				text: group.initScore != null ? String(group.initScore) : "—",
			});
			for (const combatant of group.members) {
				const row = body.createDiv({cls: "fiveetools-dmscreen__encrow"});
				row.createEl("span", {cls: "fiveetools-dmscreen__encwho", text: combatant.label || group.label});
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
				const extra = [];
				if (Number(combatant.tempHp) > 0) extra.push(`temp ${combatant.tempHp}`);
				const cond = conditionLabel(combatant.condition);
				if (cond) extra.push(cond);
				if (extra.length) row.createEl("span", {cls: "fiveetools-dmscreen__encmeta", text: extra.join("  ")});
				minus.addEventListener("click", (evt) => {
					evt.stopPropagation();
					setHp(combatant, adjustHp(combatant.hpCurrent, combatant.hpMax, -1));
				});
				plus.addEventListener("click", (evt) => {
					evt.stopPropagation();
					setHp(combatant, adjustHp(combatant.hpCurrent, combatant.hpMax, 1));
				});
				input.addEventListener("click", (evt) => evt.stopPropagation());
				input.addEventListener("change", () => {
					const typed = Number(input.value);
					const cap = Number(combatant.hpMax) || 0;
					const next = Number.isFinite(typed) ? Math.max(0, Math.min(cap, typed)) : combatant.hpCurrent;
					setHp(combatant, next);
				});
			}
		}
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
		wrap.innerHTML = renderCompactHtml(loaded.ent, page);
		if (loaded.ent.__prop === "monster") appendCreatureStatFooter(wrap, loaded.ent, plugin);
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
		items: (col.items || []).map(it => ({...it, doc: it.doc ? {...it.doc} : null})),
	})).filter(col => col.items.length);
}

function savedRoll (text) {
	try {
		const data = JSON.parse(text || "");
		if (!data || !Array.isArray(data.cells)) return null;
		return data;
	} catch (_) {
		return null;
	}
}

function blankPanel (type, title) {
	return {
		id: allocPanelId(),
		type,
		title,
		doc: null,
		path: "",
		ref: "",
		text: "",
		value: 0,
	};
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

function paintInitiative (host, plugin) {
	host.empty();
	const actions = host.createDiv({cls: "fiveetools-dmscreen__initactions"});
	const clearBtn = actions.createEl("button", {
		text: "Clear",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Remove every creature, including those on the ruler"},
	});
	clearBtn.addEventListener("click", (evt) => {
		evt.stopPropagation();
		clearTableRoster(plugin);
	});
	const open = tableWindowOpen(plugin);
	const toggle = actions.createEl("button", {
		text: open ? "Close table" : "Table",
		cls: `fiveetools-btn fiveetools-btn--ghost fiveetools-dmscreen__tabletoggle${open ? " is-selected" : ""}`,
		attr: {type: "button", title: "Open or close the Table window"},
	});
	toggle.addEventListener("click", (evt) => {
		evt.stopPropagation();
		if (tableWindowOpen(plugin)) closeTableWindow(plugin);
		else castTableWindow(plugin, {anchorEl: evt.currentTarget, mouseEvent: evt});
		window.setTimeout(() => plugin._syncDmTableBtn?.(), 400);
	});
	const chips = placedChips(ensureTableSession(plugin));
	if (!chips.length) {
		host.createEl("p", {cls: "fiveetools-view__meta", text: "Drag creatures onto the Table ruler."});
		return;
	}
	const session = ensureTableSession(plugin);
	const done = Array.isArray(session.doneKeys) ? session.doneKeys : [];
	const current = chips.some(chip => chip.key === session.turnKey) ? session.turnKey : chips[0].key;
	for (const chip of chips) {
		const row = host.createDiv({
			cls: `fiveetools-init-list__row${chip.key === current ? " is-current" : ""}${done.includes(chip.key) ? " is-done" : ""}`,
			text: chip.label,
		});
		row.addEventListener("click", () => selectTableTurn(plugin, chip.key));
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
