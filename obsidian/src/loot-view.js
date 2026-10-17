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
		const meta = tables[RollerUtil.randomise(tables.length) - 1];
		items.push(rollOneItem(loot, meta));
	}
	return {count: n, items};
}

export function renderLootGenerator (formEl, resultEl, {onOpenItem} = {}) {
	formEl.empty();
	formEl.addClass("fiveetools-loot");
	formEl.createEl("h3", {text: "Loot Generator"});
	formEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Select tables as a pool, choose how many items, then roll.",
	});

	const form = formEl.createDiv({cls: "fiveetools-loot__form"});
	const countWrap = form.createDiv({cls: "fiveetools-loot__row"});
	countWrap.createEl("span", {text: "Items"});
	const countInput = countWrap.createEl("input", {
		cls: "fiveetools-loot__count",
		attr: {type: "number", min: "1", max: "99", value: "1"},
	});
	const rollBtn = form.createEl("button", {text: "Roll", cls: "fiveetools-btn"});
	const tablesEl = form.createDiv({cls: "fiveetools-loot__tables"});
	const grouped = groupTables(listLootTables());

	for (const group of grouped) {
		const wrap = tablesEl.createDiv({cls: "fiveetools-loot__group"});
		const header = wrap.createEl("label", {cls: "fiveetools-loot__grouphead"});
		const allCb = header.createEl("input", {attr: {type: "checkbox"}});
		header.createSpan({text: group.label});
		const checks = [];
		for (const table of group.tables) {
			const row = wrap.createEl("label", {cls: "fiveetools-loot__opt"});
			const cb = row.createEl("input", {attr: {type: "checkbox", "data-loot-id": table.id}});
			row.createSpan({text: table.label});
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
		});
		for (const cb of checks) cb.addEventListener("change", syncGroup);
	}

	resultEl.empty();
	resultEl.createEl("p", {cls: "fiveetools-view__meta", text: "Select tables and a count, then roll."});

	rollBtn.addEventListener("click", () => {
		const ids = [...formEl.querySelectorAll("input[data-loot-id]:checked")].map(el => el.getAttribute("data-loot-id"));
		if (!ids.length) {
			resultEl.empty();
			resultEl.createEl("p", {text: "Select at least one loot table."});
			return;
		}
		rollBtn.setAttr("disabled", "true");
		resultEl.setText("Rolling…");
		try {
			renderLootResults(resultEl, rollSelectedTables(ids, countInput.value), onOpenItem);
		} catch (e) {
			resultEl.setText(`Failed to roll: ${e.message}`);
		} finally {
			rollBtn.removeAttribute("disabled");
		}
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

if (globalThis.FiveEToolsObsidian) {
	globalThis.FiveEToolsObsidian.listLootTables = listLootTables;
	globalThis.FiveEToolsObsidian.rollSelectedTables = rollSelectedTables;
}
