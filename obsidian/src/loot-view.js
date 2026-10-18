import fs from "fs";
import {findEntityDoc} from "./search-index.js";
import {getConfiguredRoot, getRenderer, joinUnderRoot} from "./fiveetools-host.js";

const TABLE_GROUPS = [
	{kind: "individual", label: "Individual"},
	{kind: "hoard", label: "Hoard"},
	{kind: "dragon", label: "Dragon"},
	{kind: "gems", label: "Gems"},
	{kind: "artObjects", label: "Art objects"},
	{kind: "magicItems", label: "Magic items"},
	{kind: "dragonMundaneItems", label: "Dragon mundane"},
];

// Sum of XDMG Random Magic Items d100 bands (levels 1–4, 5–10, 11–16, 17–20).
const RARITY_WEIGHT = {
	common: 95,
	uncommon: 111,
	rare: 82,
	"very rare": 69,
	legendary: 43,
};

const EYE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;

const MAGIC_TABLE_RARITY = {
	A: "common",
	B: "uncommon",
	C: "rare",
	D: "very rare",
	E: "legendary",
	F: "uncommon",
	G: "rare",
	H: "very rare",
	I: "legendary",
};

let lootCache = null;

export function listLootTables () {
	const loot = loadLootJson();
	const out = [];
	for (const group of TABLE_GROUPS) {
		if (group.kind === "dragonMundaneItems") {
			if (!Array.isArray(loot.dragonMundaneItems)) continue;
			out.push(mundaneTableMeta());
			continue;
		}
		for (const table of loot[group.kind] || []) {
			const source = table.source || "";
			const name = table.name || String(table.type || "Table");
			out.push({
				id: tableId(group.kind, source, name),
				kind: group.kind,
				group: group.label,
				name,
				source,
				type: table.type,
				crMin: table.crMin,
				label: source ? `${name} (${source})` : name,
			});
		}
	}
	return out;
}

export function rollSelectedTables (ids, count = 1) {
	const wanted = (ids || []).map(id => String(id));
	if (!wanted.length) throw new Error("Select at least one loot table.");
	const n = Math.max(1, Math.min(99, Number(count) || 1));
	const loot = loadLootJson();
	const byId = new Map(listLootTables().map(it => [it.id, it]));
	const tables = wanted.map(id => {
		const meta = byId.get(id);
		if (!meta) throw new Error(`Unknown loot table: ${id}`);
		return meta;
	});
	const RollerUtil = globalThis.RollerUtil;
	const items = [];
	for (let i = 0; i < n; i++) {
		const meta = pickWeightedTable(tables, RollerUtil);
		items.push(rollOneItem(loot, meta));
	}
	return {count: n, items};
}

export function lootTableRarityWeight (meta) {
	return RARITY_WEIGHT[rarityForTable(meta)] || RARITY_WEIGHT.uncommon;
}

export function renderLootGenerator (formEl, resultEl, {
	onOpenItem,
	selectedIds = [],
	count = 1,
	results = null,
	onSessionChange,
} = {}) {
	formEl.empty();
	formEl.addClass("fiveetools-loot");
	formEl.createEl("h3", {text: "Loot Generator"});
	formEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Select tables as a pool. Rarer tables are drawn less often (2024 treasure chances).",
	});

	const selected = new Set((selectedIds || []).map(id => String(id)));
	let currentResults = results;
	const form = formEl.createDiv({cls: "fiveetools-loot__form"});
	const countWrap = form.createDiv({cls: "fiveetools-loot__row"});
	countWrap.createEl("span", {text: "Items"});
	const countInput = countWrap.createEl("input", {
		cls: "fiveetools-loot__count",
		attr: {type: "number", min: "1", max: "99", value: String(Math.max(1, Math.min(99, Number(count) || 1)))},
	});
	const actions = form.createDiv({cls: "fiveetools-loot__row"});
	const rollBtn = actions.createEl("button", {text: "Roll", cls: "fiveetools-btn"});
	const clearBtn = actions.createEl("button", {text: "Clear results", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const tablesEl = form.createDiv({cls: "fiveetools-loot__tables"});
	const grouped = groupTables(listLootTables());

	const selectedTableIds = () => [...formEl.querySelectorAll("input[data-loot-id]:checked")].map(el => el.getAttribute("data-loot-id"));
	const emitSession = (nextResults = currentResults) => {
		currentResults = nextResults;
		clearBtn.toggleAttribute("disabled", !nextResults?.items?.length);
		onSessionChange?.({
			ids: selectedTableIds(),
			count: Number(countInput.value) || 1,
			results: nextResults,
		});
	};
	const showPlaceholder = () => {
		resultEl.empty();
		resultEl.createEl("p", {cls: "fiveetools-view__meta", text: "Select tables and a count, then roll."});
	};
	const setViewedRow = (rowEl) => {
		formEl.querySelectorAll(".fiveetools-loot__opt.is-selected").forEach((el) => el.removeClass("is-selected"));
		rowEl?.addClass("is-selected");
	};

	for (const group of grouped) {
		const wrap = tablesEl.createDiv({cls: "fiveetools-loot__group"});
		const header = wrap.createEl("label", {cls: "fiveetools-loot__grouphead"});
		const allCb = header.createEl("input", {attr: {type: "checkbox"}});
		header.createSpan({text: group.label});
		const checks = [];
		for (const table of group.tables) {
			const row = wrap.createDiv({cls: "fiveetools-loot__opt"});
			const name = row.createEl("label", {cls: "fiveetools-loot__optname"});
			const cb = name.createEl("input", {attr: {type: "checkbox", "data-loot-id": table.id}});
			if (selected.has(table.id)) cb.checked = true;
			name.createSpan({text: table.label});
			const viewBtn = row.createEl("button", {
				cls: "fiveetools-loot__view",
				attr: {type: "button", title: "View table", "aria-label": "View table"},
			});
			viewBtn.innerHTML = EYE_SVG;
			viewBtn.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				setViewedRow(row);
				try {
					renderLootTableView(resultEl, lootTableView(table));
				} catch (e) {
					resultEl.empty();
					resultEl.createEl("p", {text: e.message || "Could not open table."});
				}
			});
			checks.push(cb);
		}
		const syncGroup = () => {
			const n = checks.filter(cb => cb.checked).length;
			allCb.checked = n === checks.length && n > 0;
			allCb.indeterminate = n > 0 && n < checks.length;
		};
		allCb.addEventListener("change", () => {
			for (const cb of checks) cb.checked = allCb.checked;
			allCb.indeterminate = false;
			emitSession();
		});
		for (const cb of checks) {
			cb.addEventListener("change", () => {
				syncGroup();
				emitSession();
			});
		}
		syncGroup();
	}

	countInput.addEventListener("change", () => emitSession());

	if (currentResults?.items?.length) renderLootResults(resultEl, currentResults, onOpenItem);
	else showPlaceholder();
	clearBtn.toggleAttribute("disabled", !currentResults?.items?.length);

	rollBtn.addEventListener("click", () => {
		const ids = selectedTableIds();
		if (!ids.length) {
			resultEl.empty();
			resultEl.createEl("p", {text: "Select at least one loot table."});
			return;
		}
		rollBtn.setAttr("disabled", "true");
		resultEl.setText("Rolling…");
		try {
			const next = rollSelectedTables(ids, countInput.value);
			setViewedRow(null);
			emitSession(next);
			renderLootResults(resultEl, next, onOpenItem);
		} catch (e) {
			resultEl.setText(`Failed to roll: ${e.message}`);
		} finally {
			rollBtn.removeAttribute("disabled");
		}
	});

	clearBtn.addEventListener("click", () => {
		setViewedRow(null);
		emitSession(null);
		showPlaceholder();
	});
}

function rollOneItem (loot, meta) {
	const RollerUtil = globalThis.RollerUtil;
	const Renderer = getRenderer();

	if (meta.kind === "dragonMundaneItems") {
		const {rowRoll, text} = rollMundaneRow(loot.dragonMundaneItems, RollerUtil);
		return itemEntry({label: text, tableLabel: meta.label, rowRoll});
	}

	const table = findRawTable(loot, meta);
	if (!table) throw new Error(`Missing table ${meta.label}`);

	if (meta.kind === "gems" || meta.kind === "artObjects") {
		return listItemEntry(table, meta, RollerUtil);
	}

	if (meta.kind === "magicItems") {
		const {rowRoll, items} = rollMagicItemTable(table, RollerUtil);
		return itemEntry({...items[0], tableLabel: meta.label, rowRoll});
	}

	if (meta.kind === "dragon") {
		const fauxRow = {
			gems: withResolvedType(table.gems, RollerUtil),
			artObjects: withResolvedType(table.artObjects, RollerUtil),
			magicItems: (table.magicItems || []).map(entry => ({
				...entry,
				type: resolveType(entry, RollerUtil),
				amount: "1",
			})),
		};
		const magic = rollMagicItems(fauxRow, loot, Renderer, RollerUtil)[0];
		if (magic) return itemEntry({...magic, tableLabel: meta.label});
		const gems = rollGemsArt({...fauxRow, gems: {...fauxRow.gems, amount: "1"}}, "gems", loot, RollerUtil, Renderer);
		if (gems?.names?.[0]) return namedEntry(gems.names[0], meta);
		const art = rollGemsArt({...fauxRow, artObjects: {...fauxRow.artObjects, amount: "1"}}, "artObjects", loot, RollerUtil, Renderer);
		if (art?.names?.[0]) return namedEntry(art.names[0], meta);
		const mundane = rollMundaneRow(loot.dragonMundaneItems, RollerUtil);
		return itemEntry({label: mundane.text, tableLabel: meta.label, rowRoll: mundane.rowRoll});
	}

	const rowRoll = RollerUtil.randomise(100);
	const row = (table.table || []).find(it => rowRoll >= it.min && rowRoll <= it.max) || {};
	if (meta.kind === "hoard") {
		const magic = rollMagicItems({...row, magicItems: (row.magicItems || []).map(entry => ({...entry, amount: "1"}))}, loot, Renderer, RollerUtil)[0];
		if (magic) return itemEntry({...magic, tableLabel: meta.label, rowRoll});
		const gems = rollGemsArt({...row, gems: row.gems ? {...row.gems, amount: "1"} : null}, "gems", loot, RollerUtil, Renderer);
		if (gems?.names?.[0]) return namedEntry(gems.names[0], meta, rowRoll);
		const art = rollGemsArt({...row, artObjects: row.artObjects ? {...row.artObjects, amount: "1"} : null}, "artObjects", loot, RollerUtil, Renderer);
		if (art?.names?.[0]) return namedEntry(art.names[0], meta, rowRoll);
	}
	const coins = rollCoins(meta.kind === "hoard" ? (table.coins || {}) : (row.coins || {}), Renderer);
	const coinText = Object.entries(coins).map(([type, amount]) => `${amount} ${type}`).join(", ");
	return itemEntry({label: coinText || "Nothing", tableLabel: meta.label, rowRoll});
}

function listItemEntry (table, meta, RollerUtil) {
	const pick = table?.table?.length
		? table.table[RollerUtil.randomise(table.table.length) - 1]
		: table?.name;
	const parsed = parseItemTag(pick);
	return itemEntry({
		label: parsed.name || meta.label,
		name: parsed.name || "",
		source: parsed.source,
		tableLabel: meta.label,
	});
}

function namedEntry (raw, meta, rowRoll = null) {
	const parsed = parseItemTag(raw);
	return itemEntry({
		label: parsed.name || String(raw || meta.label),
		name: parsed.name || "",
		source: parsed.source,
		tableLabel: meta.label,
		rowRoll,
	});
}

function itemEntry ({label, name = "", source = "", tableLabel, rowRoll = null, table = ""}) {
	return {label, name, source, tableLabel, rowRoll, table};
}

function rollCoins (source, Renderer) {
	const coins = {};
	for (const [type, formula] of Object.entries(source || {})) {
		const value = Renderer.dice.parseRandomise2(String(formula));
		if (value) coins[type] = value;
	}
	return coins;
}

function rollGemsArt (row, prop, loot, RollerUtil, Renderer) {
	const meta = withResolvedType(row[prop], RollerUtil);
	if (!meta?.type) return null;
	const count = Math.max(0, Number(Renderer.dice.parseRandomise2(String(meta.amount || "1"))) || 0);
	if (!count) return null;
	const tables = (loot[prop] || []).filter(it => it.type === meta.type);
	const table = tables.find(it => it.source === "DMG") || tables[0];
	const names = [];
	for (let i = 0; i < count; i++) names.push(rollListEntry(table, RollerUtil) || `${meta.type} gp`);
	return {type: meta.type, count, names};
}

function rollMagicItems (row, loot, Renderer, RollerUtil) {
	const entries = [];
	for (const magic of row.magicItems || []) {
		const amountRaw = magic.amount == null ? "1" : String(magic.amount);
		const count = Math.max(0, Number(Renderer.dice.parseRandomise2(amountRaw)) || 0);
		if (!count) continue;
		const type = resolveType(magic, RollerUtil);
		if (!type || type === "randomByLevel") {
			entries.push({label: `${count} magic item${count === 1 ? "" : "s"}`});
			continue;
		}
		const tables = (loot.magicItems || []).filter(it => it.type === type);
		const table = tables.find(it => it.source === "DMG") || tables[0];
		if (!table?.table?.length) {
			entries.push({label: `${count}× Table ${type}`});
			continue;
		}
		for (let i = 0; i < count; i++) {
			entries.push(...rollMagicItemTable(table, RollerUtil).items);
		}
	}
	return entries;
}

function rollMagicItemTable (table, RollerUtil) {
	const rowRoll = RollerUtil.randomise(100);
	const hit = (table.table || []).find(it => rowRoll >= it.min && rowRoll <= it.max);
	const matching = hit?.choose?.fromMatching;
	if (matching) {
		const rarity = String(matching.rarity || "magic");
		return {
			rowRoll,
			items: [{label: `${capitalize(rarity)} magic item`, table: table.type}],
		};
	}
	const parsed = parseItemTag(hit?.item);
	return {
		rowRoll,
		items: [{
			label: parsed.name || table.name || `Table ${table.type || ""}`.trim(),
			name: parsed.name || "",
			source: parsed.source,
			table: table.type,
		}],
	};
}

function rollListEntry (table, RollerUtil) {
	const rows = table?.table || [];
	if (!rows.length) return table?.name || "";
	const pick = rows[RollerUtil.randomise(rows.length) - 1];
	return parseItemTag(pick).name || String(pick || table.name || "");
}

function rollMundaneRow (rows, RollerUtil) {
	const rowRoll = RollerUtil.randomise(100);
	const hit = (rows || []).find(it => rowRoll >= it.min && rowRoll <= it.max);
	return {rowRoll, text: hit?.item || "Mundane item"};
}

function withResolvedType (meta, RollerUtil) {
	if (!meta) return null;
	const type = resolveType(meta, RollerUtil);
	if (!type) return meta;
	return {...meta, type};
}

function resolveType (meta, RollerUtil) {
	if (!meta) return null;
	if (meta.type) return meta.type;
	if (!meta.typeTable?.length) return null;
	const roll = RollerUtil.randomise(100);
	return meta.typeTable.find(it => roll >= it.min && roll <= it.max)?.type || null;
}

function parseItemTag (raw) {
	const text = String(raw || "");
	const match = text.match(/\{@item ([^|}]+)(?:\|([^|}]+))?/i);
	if (match) return {name: match[1].trim(), source: (match[2] || "").trim()};
	return {name: text.replace(/\{@[^}]+\}/g, "").trim(), source: ""};
}

function loadLootJson () {
	if (lootCache) return lootCache;
	const filePath = joinUnderRoot(getConfiguredRoot(), "data", "loot.json");
	lootCache = JSON.parse(fs.readFileSync(filePath, "utf8"));
	return lootCache;
}

function tableId (kind, source, name) {
	return `${kind}:${source}:${name}`;
}

function mundaneTableMeta () {
	return {
		id: tableId("dragonMundaneItems", "FTD", "Dragon Mundane Items"),
		kind: "dragonMundaneItems",
		group: "Dragon mundane",
		name: "Dragon Mundane Items",
		source: "FTD",
		label: "Dragon Mundane Items (FTD)",
	};
}

function findRawTable (loot, meta) {
	return (loot[meta.kind] || []).find(it => {
		const name = it.name || String(it.type || "Table");
		return tableId(meta.kind, it.source || "", name) === meta.id;
	});
}

export function lootTableView (meta) {
	const loot = loadLootJson();
	if (meta?.kind === "dragonMundaneItems") {
		return {
			caption: meta.label,
			columns: ["d100", "Item"],
			rows: (loot.dragonMundaneItems || []).map(row => [diceRange(row), stripItemTag(row.item)]),
		};
	}
	const table = findRawTable(loot, meta);
	if (!table) throw new Error(`Missing table ${meta?.label || "unknown"}`);
	const rows = table.table;
	if (Array.isArray(rows) && rows.length && typeof rows[0] === "string") {
		return {
			caption: meta.label,
			columns: ["#", "Item"],
			rows: rows.map((it, i) => [String(i + 1), stripItemTag(it)]),
		};
	}
	if (Array.isArray(rows) && rows.length) {
		const out = rows.map(row => [diceRange(row), formatLootRowText(row)]);
		if (table.coins) out.unshift(["Always", formatCoins(table.coins)]);
		return {caption: meta.label, columns: ["d100", "Result"], rows: out};
	}
	const summary = [];
	if (table.coins) summary.push(["Coins", formatCoins(table.coins)]);
	if (table.dragonMundaneItems) summary.push(["Mundane", formatLootRowText({dragonMundaneItems: table.dragonMundaneItems})]);
	if (table.gems) summary.push(["Gems", formatLootRowText({gems: table.gems})]);
	if (table.artObjects) summary.push(["Art", formatLootRowText({artObjects: table.artObjects})]);
	if (table.magicItems) summary.push(["Magic items", formatLootRowText({magicItems: table.magicItems})]);
	return {caption: meta.label, columns: ["Part", "Result"], rows: summary};
}

export function formatLootRowText (row) {
	if (typeof row === "string") return stripItemTag(row);
	if (!row || typeof row !== "object") return "—";
	if (row.item) return stripItemTag(row.item);
	if (row.choose?.fromMatching?.rarity) return `${capitalize(row.choose.fromMatching.rarity)} magic item`;
	const parts = [];
	if (row.coins) parts.push(formatCoins(row.coins));
	if (row.gems) parts.push(formatGemsArt(row.gems, "gems"));
	if (row.artObjects) parts.push(formatGemsArt(row.artObjects, "art objects"));
	if (row.dragonMundaneItems) parts.push(`${row.dragonMundaneItems.amount || "1"}× mundane items`);
	for (const magic of row.magicItems || []) parts.push(formatMagicEntry(magic));
	return parts.filter(Boolean).join("; ") || "—";
}

function stripItemTag (raw) {
	return String(raw || "")
		.replace(/\{@item ([^|}]+)(?:\|[^}]*)?\}/gi, "$1")
		.replace(/\{@[^}]+\}/g, "")
		.trim();
}

function diceRange (row) {
	if (row?.min == null) return "—";
	if (row.max == null || row.max === row.min) return String(row.min);
	return `${row.min}–${row.max}`;
}

function formatCoins (coins) {
	return Object.entries(coins || {})
		.map(([type, formula]) => `${formula} ${type}`)
		.join(", ");
}

function formatGemsArt (meta, label) {
	if (!meta) return "";
	const amount = meta.amount || "1";
	if (meta.type != null) return `${amount}× ${meta.type} gp ${label}`;
	if (meta.typeTable?.length) {
		const types = meta.typeTable.map(it => `${diceRange(it)} ${it.type} gp`).join(", ");
		return `${amount}× ${label} (${types})`;
	}
	return `${amount}× ${label}`;
}

function formatMagicEntry (entry) {
	if (!entry) return "";
	const amount = entry.amount || "1";
	if (entry.type === "randomByLevel") return `${amount}× magic item (by level)`;
	if (entry.type) return `${amount}× Table ${entry.type}`;
	if (entry.typeTable?.length) {
		const types = entry.typeTable.map(it => `${diceRange(it)} Table ${it.type}`).join(", ");
		return `${amount}× magic items (${types})`;
	}
	return `${amount}× magic items`;
}

function renderLootTableView (el, view) {
	el.empty();
	el.addClass("fiveetools-loot__result");
	el.createEl("h3", {text: view.caption || "Loot table"});
	if (!view.rows?.length) {
		el.createEl("p", {cls: "fiveetools-view__meta", text: "This table has no rows."});
		return;
	}
	const tableEl = el.createEl("table", {cls: "fiveetools-loot__table"});
	const head = tableEl.createEl("thead").createEl("tr");
	for (const col of view.columns || []) head.createEl("th", {text: col});
	const body = tableEl.createEl("tbody");
	for (const row of view.rows) {
		const tr = body.createEl("tr");
		for (const cell of row) tr.createEl("td", {text: cell});
	}
}

function groupTables (tables) {
	const byGroup = new Map();
	for (const group of TABLE_GROUPS) byGroup.set(group.label, []);
	for (const table of tables) {
		(byGroup.get(table.group) || []).push(table);
	}
	return TABLE_GROUPS
		.map(group => ({label: group.label, tables: byGroup.get(group.label) || []}))
		.filter(group => group.tables.length);
}

function renderLootResults (el, results, onOpenItem) {
	el.empty();
	el.addClass("fiveetools-loot__result");
	const items = results?.items || [];
	if (!items.length) {
		el.createEl("p", {text: "Select at least one loot table."});
		return;
	}
	el.createEl("h3", {text: items.length === 1 ? "1 item" : `${items.length} items`});
	const list = el.createEl("ul", {cls: "fiveetools-loot__items"});
	for (const item of items) {
		const li = list.createEl("li", {cls: "fiveetools-loot__hit"});
		if (item.name && onOpenItem) {
			const btn = li.createEl("button", {text: item.label, cls: "fiveetools-loot__item"});
			btn.addEventListener("click", () => {
				const doc = findEntityDoc(item.name, {categoriesExact: ["item"]});
				if (doc) onOpenItem(doc);
			});
		} else {
			li.createSpan({text: item.label});
		}
		if (item.tableLabel) {
			li.createEl("div", {cls: "fiveetools-view__meta", text: item.tableLabel});
		}
	}
}

function capitalize (value) {
	const text = String(value || "");
	return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function rarityForTable (meta) {
	const type = String(meta?.type || "");
	const letter = MAGIC_TABLE_RARITY[type];
	if (letter) return letter;

	const typeTail = type.split(".").pop()?.toLowerCase().replace(/_/g, " ");
	if (typeTail && RARITY_WEIGHT[typeTail]) return typeTail;
	if (type.startsWith("byLevel.")) {
		if (type.includes("1-4")) return "common";
		if (type.includes("5-10")) return "uncommon";
		if (type.includes("11-16")) return "rare";
		return "very rare";
	}

	const name = String(meta?.name || "").toLowerCase();
	if (name.includes("legendary") || name === "ancient") return "legendary";
	if (name.includes("very rare")) return "very rare";
	if (/\brare\b/.test(name)) return "rare";
	if (name.includes("uncommon") || name === "young") return "uncommon";
	if (name.includes("common") || name === "wyrmling" || name === "adult") {
		if (name === "adult") return "rare";
		return "common";
	}
	if (/table a\b/.test(name)) return "common";
	if (/table [bf]\b/.test(name)) return "uncommon";
	if (/table [cg]\b/.test(name)) return "rare";
	if (/table [dh]\b/.test(name)) return "very rare";
	if (/table [ei]\b/.test(name)) return "legendary";

	if (meta?.kind === "gems" || meta?.kind === "artObjects") {
		const gp = Number(meta.type);
		if (gp >= 5000) return "legendary";
		if (gp >= 1000) return "very rare";
		if (gp >= 500) return "rare";
		if (gp >= 100) return "uncommon";
		return "common";
	}

	const cr = Number(meta?.crMin);
	if (Number.isFinite(cr)) {
		if (cr >= 17) return "very rare";
		if (cr >= 11) return "rare";
		if (cr >= 5) return "uncommon";
		return "common";
	}

	if (meta?.kind === "dragonMundaneItems") return "common";
	return "uncommon";
}

function pickWeightedTable (tables, RollerUtil) {
	if (tables.length === 1) return tables[0];
	const weights = tables.map(meta => lootTableRarityWeight(meta));
	let tick = RollerUtil.randomise(weights.reduce((sum, w) => sum + w, 0));
	for (let i = 0; i < tables.length; i++) {
		tick -= weights[i];
		if (tick <= 0) return tables[i];
	}
	return tables[tables.length - 1];
}

if (globalThis.FiveEToolsObsidian) {
	globalThis.FiveEToolsObsidian.listLootTables = listLootTables;
	globalThis.FiveEToolsObsidian.rollSelectedTables = rollSelectedTables;
	globalThis.FiveEToolsObsidian.lootTableRarityWeight = lootTableRarityWeight;
	globalThis.FiveEToolsObsidian.lootTableView = lootTableView;
	globalThis.FiveEToolsObsidian.formatLootRowText = formatLootRowText;
}
