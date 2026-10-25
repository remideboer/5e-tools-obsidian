import {Notice, setIcon} from "obsidian";
import {TABLE_LIMITS} from "./table-limits.js";
import {previewPastedNote} from "./table-note.js";
import {rollOnTable} from "./table-roll.js";
import {
	deleteRollTableNote,
	listRollTables,
	readRollTableNote,
	saveRollTableNote,
} from "./roll-table-store.js";
import {parseItemRef, renderRollResultCards} from "../roll-result-card.js";
import {appendTextWithDiceRollers, bindDiceRollers, textHasDiceNotation} from "../dice-roll.js";

/**
 * Tools → Roll tables: list vault notes, paste import, roll → result cards.
 * Per-row Roll / View mirrors the loot generator; count is shared like loot Items.
 */
export function renderRollTablesTool (listEl, readerEl, {
	session = {},
	plugin,
	onSessionChange,
	onOpenItem,
} = {}) {
	listEl.empty();
	listEl.addClass("fiveetools-rolltables");
	readerEl?.empty();

	const state = {
		selectedPath: session.selectedPath || "",
		count: Math.max(1, Math.min(TABLE_LIMITS.results, Number(session.count) || 1)),
		results: session.results || null,
		importDraft: session.importDraft || null,
		tables: [],
		parsed: null,
		mode: "browse", // browse | import
	};

	const emit = (patch = {}) => {
		Object.assign(state, patch);
		onSessionChange?.({
			selectedPath: state.selectedPath,
			count: state.count,
			results: state.results,
			importDraft: state.importDraft,
		});
		clearBtn.toggleAttribute("disabled", !state.results?.length);
	};

	const toolbar = listEl.createDiv({cls: "fiveetools-rolltables__toolbar"});
	toolbar.createEl("h3", {text: "Roll tables"});
	const actions = toolbar.createDiv({cls: "fiveetools-rolltables__actions"});
	const importBtn = actions.createEl("button", {text: "Import", cls: "fiveetools-btn", attr: {type: "button"}});
	const refreshBtn = actions.createEl("button", {
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Refresh", "aria-label": "Refresh"},
	});
	setIcon(refreshBtn, "refresh-cw");

	const rollControls = listEl.createDiv({cls: "fiveetools-rolltables__rollbar"});
	const countWrap = rollControls.createDiv({cls: "fiveetools-rolltables__row"});
	countWrap.createEl("span", {text: "Rolls"});
	const countSel = countWrap.createEl("select", {cls: "fiveetools-rolltables__count"});
	for (let i = 1; i <= 10; i++) {
		const opt = countSel.createEl("option", {text: String(i), attr: {value: String(i)}});
		if (i === state.count) opt.selected = true;
	}
	const clearBtn = rollControls.createEl("button", {
		text: "Clear results",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	clearBtn.toggleAttribute("disabled", !state.results?.length);

	const listHost = listEl.createDiv({cls: "fiveetools-rolltables__list"});
	const importHost = listEl.createDiv({cls: "fiveetools-rolltables__import"});
	importHost.style.display = "none";

	const syncListSelection = () => {
		listHost.querySelectorAll(".fiveetools-rolltables__hit").forEach((el) => {
			el.classList.toggle("is-selected", el.dataset.path === state.selectedPath);
		});
	};

	const setViewedRow = (path) => {
		state.selectedPath = path || "";
		syncListSelection();
	};

	const renderTablePreview = (parsed) => {
		readerEl.empty();
		readerEl.addClass("fiveetools-rolltables__reader");
		if (!parsed?.ok) {
			readerEl.createEl("p", {cls: "fiveetools-view__meta", text: parsed?.error || "Select a table."});
			return;
		}
		readerEl.createEl("h3", {text: parsed.name});
		const wrap = readerEl.createDiv({cls: "fiveetools-rolltables__tablewrap"});
		const table = wrap.createEl("table", {cls: "fiveetools-rolltables__table"});
		const thead = table.createEl("thead");
		const hr = thead.createEl("tr");
		for (const h of parsed.headers) hr.createEl("th", {text: h});
		const tbody = table.createEl("tbody");
		for (const row of parsed.rows) {
			const tr = tbody.createEl("tr");
			for (const cell of row) {
				const td = tr.createEl("td");
				appendTextWithDiceRollers(td, cell);
			}
		}
		if (plugin) bindDiceRollers(readerEl, plugin);
	};

	const renderResults = (draws, tableName = "") => {
		readerEl.empty();
		readerEl.addClass("fiveetools-rolltables__reader");
		const name = tableName || state.parsed?.name || "";
		const cards = (draws || []).map((draw) => {
			const primary = draw.cells?.[0];
			const title = primary?.text || draw.row?.filter(Boolean).join(" · ") || "—";
			const item = textHasDiceNotation(title) ? null : parseItemRef(title);
			const fields = (draw.cells || []).slice(1).map(cell => ({
				label: cell.header,
				text: cell.text,
				item: textHasDiceNotation(cell.text) ? undefined : (parseItemRef(cell.text) || undefined),
			}));
			const dieBadge = draw.die && draw.total != null
				? `${draw.die.label}: ${draw.total}`
				: (draw.total != null ? String(draw.total) : "");
			return {
				dieBadge,
				title: primary?.text || title,
				meta: name,
				fields,
				item: item || undefined,
			};
		});
		renderRollResultCards(readerEl, cards, {
			onOpenItem,
			plugin,
			emptyText: "Roll a table to see results.",
		});
	};

	const showPlaceholder = () => {
		readerEl.empty();
		readerEl.createEl("p", {
			cls: "fiveetools-view__meta",
			text: "Pick a table to view, or roll using the dice button.",
		});
	};

	const showSelected = async () => {
		if (!state.selectedPath) {
			state.parsed = null;
			if (state.results?.length) renderResults(state.results);
			else showPlaceholder();
			return;
		}
		const parsed = await readRollTableNote(plugin, state.selectedPath);
		state.parsed = parsed.ok ? parsed : null;
		if (!parsed.ok) {
			readerEl.empty();
			readerEl.createEl("p", {text: parsed.error || "Could not read table."});
			return;
		}
		if (state.results?.length) renderResults(state.results, parsed.name);
		else renderTablePreview(parsed);
	};

	const rollTableAt = async (path) => {
		const parsed = await readRollTableNote(plugin, path);
		if (!parsed.ok) {
			new Notice(parsed.error || "Could not read table.");
			return;
		}
		const n = Math.max(1, Math.min(TABLE_LIMITS.results, Number(countSel.value) || 1));
		try {
			const draws = [];
			for (let i = 0; i < n; i++) {
				draws.push(rollOnTable(parsed.headers, parsed.rows, parsed.name));
			}
			state.parsed = parsed;
			emit({selectedPath: path, count: n, results: draws});
			syncListSelection();
			renderResults(draws, parsed.name);
		} catch (e) {
			new Notice(e.message || "Roll failed.");
		}
	};

	const viewTableAt = async (path) => {
		emit({selectedPath: path, results: null});
		syncListSelection();
		const parsed = await readRollTableNote(plugin, path);
		state.parsed = parsed.ok ? parsed : null;
		if (!parsed.ok) {
			readerEl.empty();
			readerEl.createEl("p", {text: parsed.error || "Could not read table."});
			return;
		}
		renderTablePreview(parsed);
	};

	const rebuildList = async () => {
		const scrollTop = listHost.scrollTop;
		listHost.empty();
		try {
			state.tables = await listRollTables(plugin);
		} catch (e) {
			listHost.createEl("p", {text: e.message || "Could not list tables."});
			return;
		}
		if (!state.tables.length) {
			listHost.createEl("p", {cls: "fiveetools-view__meta", text: "No tables yet. Import a paste."});
			listHost.scrollTop = scrollTop;
			return;
		}
		for (const table of state.tables) {
			const row = listHost.createDiv({
				cls: `fiveetools-rolltables__hit${table.path === state.selectedPath ? " is-selected" : ""}`,
				attr: {"data-path": table.path},
			});
			row.createSpan({cls: "fiveetools-rolltables__hitname", text: table.name});

			const rollOneBtn = row.createEl("button", {
				cls: "fiveetools-rolltables__roll",
				attr: {type: "button", title: "Roll table", "aria-label": "Roll table"},
			});
			setIcon(rollOneBtn, "dices");
			rollOneBtn.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				void rollTableAt(table.path);
			});

			const viewBtn = row.createEl("button", {
				cls: "fiveetools-rolltables__view",
				attr: {type: "button", title: "View table", "aria-label": "View table"},
			});
			setIcon(viewBtn, "eye");
			viewBtn.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				setViewedRow(table.path);
				void viewTableAt(table.path);
			});

			const del = row.createEl("button", {
				cls: "fiveetools-rolltables__del",
				attr: {type: "button", title: "Delete", "aria-label": "Delete"},
			});
			setIcon(del, "trash");
			del.addEventListener("click", async (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				if (typeof window !== "undefined" && !window.confirm(`Delete table “${table.name}”?`)) return;
				try {
					await deleteRollTableNote(plugin, table.path);
					if (state.selectedPath === table.path) {
						emit({selectedPath: "", results: null});
						state.parsed = null;
					}
					await rebuildList();
					await showSelected();
					new Notice("Table deleted.");
				} catch (e) {
					new Notice(e.message || "Could not delete.");
				}
			});
		}
		listHost.scrollTop = scrollTop;
	};

	countSel.addEventListener("change", () => emit({count: Number(countSel.value) || 1}));

	clearBtn.addEventListener("click", () => {
		emit({results: null});
		void showSelected();
	});

	const paintImport = () => {
		importHost.empty();
		importHost.createEl("h4", {text: "Import paste"});
		importHost.createEl("p", {
			cls: "fiveetools-view__meta",
			text: "Markdown table, tab-separated rows, or a numbered list.",
		});
		const nameRow = importHost.createDiv({cls: "fiveetools-rolltables__row"});
		nameRow.createEl("span", {text: "Name"});
		const nameInput = nameRow.createEl("input", {
			cls: "fiveetools-rolltables__name",
			attr: {type: "text", placeholder: "Table name"},
		});
		nameInput.value = state.importDraft?.name || "";
		const paste = importHost.createEl("textarea", {
			cls: "fiveetools-rolltables__paste",
			attr: {rows: "10", placeholder: "1. Goblin\n2. Orc\n3. Owlbear"},
		});
		paste.value = state.importDraft?.pasted || "";
		const previewEl = importHost.createDiv({cls: "fiveetools-rolltables__preview"});
		const btnRow = importHost.createDiv({cls: "fiveetools-rolltables__row"});
		const saveBtn = btnRow.createEl("button", {text: "Save", cls: "fiveetools-btn", attr: {type: "button"}});
		const cancelBtn = btnRow.createEl("button", {
			text: "Cancel",
			cls: "fiveetools-btn fiveetools-btn--ghost",
			attr: {type: "button"},
		});

		const updatePreview = () => {
			const draft = {name: nameInput.value, pasted: paste.value};
			emit({importDraft: draft});
			previewEl.empty();
			if (!paste.value.trim()) {
				previewEl.createEl("p", {cls: "fiveetools-view__meta", text: "Paste to preview."});
				return;
			}
			const preview = previewPastedNote(nameInput.value || "Table", paste.value);
			if (!preview.ok) {
				previewEl.createEl("p", {text: preview.error});
				return;
			}
			previewEl.createEl("p", {
				cls: "fiveetools-view__meta",
				text: `${preview.rows.length} rows × ${preview.headers.length} columns`,
			});
			const wrap = previewEl.createDiv({cls: "fiveetools-rolltables__tablewrap"});
			const table = wrap.createEl("table", {cls: "fiveetools-rolltables__table"});
			const thead = table.createEl("thead");
			const hr = thead.createEl("tr");
			for (const h of preview.headers) hr.createEl("th", {text: h});
			const tbody = table.createEl("tbody");
			for (const row of preview.rows.slice(0, 8)) {
				const tr = tbody.createEl("tr");
				for (const cell of row) tr.createEl("td", {text: cell});
			}
			if (preview.rows.length > 8) {
				previewEl.createEl("p", {cls: "fiveetools-view__meta", text: `…and ${preview.rows.length - 8} more`});
			}
		};

		nameInput.addEventListener("input", updatePreview);
		paste.addEventListener("input", updatePreview);
		updatePreview();

		saveBtn.addEventListener("click", async () => {
			try {
				const saved = await saveRollTableNote(plugin, {
					name: nameInput.value,
					pasted: paste.value,
				});
				emit({
					selectedPath: saved.path,
					results: null,
					importDraft: null,
					mode: "browse",
				});
				importHost.style.display = "none";
				listHost.style.display = "";
				rollControls.style.display = "";
				importBtn.setText("Import");
				await rebuildList();
				await showSelected();
				new Notice(`Saved “${saved.name}”.`);
			} catch (e) {
				new Notice(e.message || "Could not save.");
			}
		});

		cancelBtn.addEventListener("click", () => {
			emit({importDraft: null, mode: "browse"});
			importHost.style.display = "none";
			listHost.style.display = "";
			rollControls.style.display = "";
			importBtn.setText("Import");
			void showSelected();
		});
	};

	importBtn.addEventListener("click", () => {
		if (state.mode === "import") {
			emit({mode: "browse"});
			importHost.style.display = "none";
			listHost.style.display = "";
			rollControls.style.display = "";
			importBtn.setText("Import");
			void showSelected();
			return;
		}
		emit({mode: "import"});
		listHost.style.display = "none";
		rollControls.style.display = "none";
		importHost.style.display = "";
		importBtn.setText("Browse");
		paintImport();
	});

	refreshBtn.addEventListener("click", async () => {
		await rebuildList();
		await showSelected();
	});

	if (state.importDraft?.pasted && !state.selectedPath) {
		emit({mode: "import"});
		listHost.style.display = "none";
		rollControls.style.display = "none";
		importHost.style.display = "";
		importBtn.setText("Browse");
		paintImport();
	}

	void (async () => {
		await rebuildList();
		if (state.mode !== "import") await showSelected();
	})();
}
