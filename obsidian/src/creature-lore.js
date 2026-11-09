import {appendTextWithDiceRollers, bindDiceRollers, textHasDiceNotation} from "./dice-roll.js";
import {parseItemRef, renderRollResultCards} from "./roll-result-card.js";
import {readRollTableNote} from "./roll-tables/roll-table-store.js";
import {rollTableResults} from "./roll-tables/table-roll.js";
import {rewriteMediaUrls} from "./media-cache.js";
import {
	ensureLootData,
	listLootTables,
	lootTableView,
	rollSelectedTables,
} from "./loot-view.js";

const LOOT_REF_PREFIX = "loot:";

export function isLootTableRef (path) {
	return String(path || "").startsWith(LOOT_REF_PREFIX);
}

export function lootTableRef (id) {
	return `${LOOT_REF_PREFIX}${String(id || "").trim()}`;
}

export function lootTableIdFromRef (path) {
	return String(path || "").slice(LOOT_REF_PREFIX.length);
}

/**
 * Append fluff text (Description / Lore) below the creature stat block.
 */
export async function appendCreatureFluff (body, ent, plugin, {bindInternalLinks} = {}) {
	if (!ent || !body) return;
	let fluff = null;
	try {
		fluff = await Renderer.monster.pGetFluff(ent);
	} catch (_) {
		fluff = ent.fluff || null;
	}
	const entries = fluff?.entries;
	if (!Array.isArray(entries) || !entries.length) return;

	const wrap = body.createDiv({cls: "fiveetools-view__fluff"});
	const content = wrap.createDiv({cls: "fiveetools-view__fluff-body"});
	try {
		content.innerHTML = Renderer.utils.getFluffTabContent({entity: ent, fluff});
	} catch (_) {
		content.createEl("p", {text: "Could not render lore."});
		return;
	}
	bindInternalLinks?.(content, plugin);
	bindDiceRollers(content, plugin);
	await rewriteMediaUrls(plugin, content);
}

/**
 * Append linked vault / loot roll tables for a homebrew creature.
 */
export async function appendCreatureRollTables (body, ent, plugin) {
	const refs = normalizeRollTablePaths(ent?._homebrewRollTables);
	if (!refs.length || !body || !plugin) return;

	const host = body.createDiv({cls: "fiveetools-view__creature-tables"});
	host.createEl("h3", {cls: "fiveetools-view__fluff-title", text: "Roll tables"});

	const lootRefs = refs.filter(isLootTableRef);
	if (lootRefs.length) {
		try {
			await ensureLootData(plugin);
		} catch (_) { /* show per-table errors below */ }
	}

	for (const path of refs) {
		if (isLootTableRef(path)) {
			await appendLootTableBlock(host, path, plugin);
			if (!body.isConnected) return;
			continue;
		}
		await appendVaultTableBlock(host, path, plugin);
		if (!body.isConnected) return;
	}
}

async function appendVaultTableBlock (host, path, plugin) {
	const block = host.createDiv({cls: "fiveetools-view__creature-table"});
	const parsed = await readRollTableNote(plugin, path);
	if (!parsed?.ok) {
		block.createEl("p", {cls: "fiveetools-view__meta", text: `Table not found: ${path}`});
		return;
	}
	const head = block.createDiv({cls: "fiveetools-view__creature-table-head"});
	head.createEl("strong", {text: parsed.name || "Table"});
	const rollBtn = head.createEl("button", {
		text: "Roll",
		cls: "fiveetools-btn",
		attr: {type: "button"},
	});
	const resultEl = block.createDiv({cls: "fiveetools-view__creature-table-result"});
	const tableHost = block.createDiv({cls: "fiveetools-view__creature-table-body"});
	const table = tableHost.createEl("table", {cls: "fiveetools-view__creature-table-grid"});
	const headRow = table.createEl("thead").createEl("tr");
	for (const header of parsed.headers) headRow.createEl("th", {text: header});
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
			const draws = rollTableResults(parsed.headers, parsed.rows, parsed.name);
			const cards = draws.map(draw => drawToCard(draw, parsed.name));
			renderRollResultCards(resultEl, cards, {plugin, emptyText: "Roll failed."});
		} catch (e) {
			resultEl.empty();
			resultEl.createEl("p", {text: e.message || "Roll failed."});
		}
	});
}

async function appendLootTableBlock (host, path, plugin) {
	const block = host.createDiv({cls: "fiveetools-view__creature-table"});
	const id = lootTableIdFromRef(path);
	let meta = null;
	try {
		meta = listLootTables().find(it => it.id === id) || null;
	} catch (_) {
		meta = null;
	}
	if (!meta) {
		block.createEl("p", {cls: "fiveetools-view__meta", text: `Loot table not found: ${id}`});
		return;
	}

	const head = block.createDiv({cls: "fiveetools-view__creature-table-head"});
	head.createEl("strong", {text: meta.label || meta.name || "Loot table"});
	const rollBtn = head.createEl("button", {
		text: "Roll",
		cls: "fiveetools-btn",
		attr: {type: "button"},
	});
	const resultEl = block.createDiv({cls: "fiveetools-view__creature-table-result"});
	const tableHost = block.createDiv({cls: "fiveetools-view__creature-table-body"});

	try {
		const view = lootTableView(meta);
		const table = tableHost.createEl("table", {cls: "fiveetools-view__creature-table-grid"});
		const headRow = table.createEl("thead").createEl("tr");
		for (const col of view.columns || []) headRow.createEl("th", {text: col});
		const tbody = table.createEl("tbody");
		for (const row of view.rows || []) {
			const tr = tbody.createEl("tr");
			for (const cell of row) tr.createEl("td", {text: cell});
		}
	} catch (e) {
		tableHost.createEl("p", {cls: "fiveetools-view__meta", text: e.message || "Could not show table."});
	}

	rollBtn.addEventListener("click", () => {
		try {
			const results = rollSelectedTables([meta.id], 1);
			const cards = (results.items || []).map(item => ({
				title: item.label || item.name || "Item",
				meta: item.tableLabel || meta.label || "",
				item: item.name
					? {name: item.name, source: item.source || "", label: item.label || item.name}
					: null,
			}));
			renderRollResultCards(resultEl, cards, {
				plugin,
				onOpenItem: (found) => { void plugin?.openPreview?.(found); },
				emptyText: "Roll failed.",
			});
		} catch (e) {
			resultEl.empty();
			resultEl.createEl("p", {text: e.message || "Roll failed."});
		}
	});
}

export function normalizeRollTablePaths (raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	const seen = new Set();
	for (const item of raw) {
		const path = typeof item === "string" ? item.trim() : String(item?.path || "").trim();
		if (!path || seen.has(path)) continue;
		seen.add(path);
		out.push(path);
	}
	return out;
}

function drawToCard (draw, name) {
	const dieBadge = draw.die && draw.total != null
		? `${draw.die.label}: ${draw.total}`
		: (draw.total != null ? String(draw.total) : "");
	if (draw.columnRoll && draw.cells?.[0]) {
		const cell = draw.cells[0];
		const title = cell.text || "—";
		return {
			dieBadge,
			title,
			meta: cell.header || name,
			fields: [],
			item: textHasDiceNotation(title) ? undefined : (parseItemRef(title) || undefined),
		};
	}
	const primary = draw.cells?.[0];
	const title = primary?.text || draw.row?.filter(Boolean).join(" · ") || "—";
	const item = textHasDiceNotation(title) ? null : parseItemRef(title);
	const fields = (draw.cells || []).slice(1).map(cell => ({
		label: cell.header,
		text: cell.text,
		item: textHasDiceNotation(cell.text) ? undefined : (parseItemRef(cell.text) || undefined),
	}));
	return {
		dieBadge,
		title: primary?.text || title,
		meta: name,
		fields,
		item: item || undefined,
	};
}
