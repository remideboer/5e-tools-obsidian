import {readPluginJson} from "../plugin-dir.js";
import {dieOfHeader} from "./die-ranges.js";
import {resolveTableRoll} from "./table-roll.js";

const SCREEN_SOURCE = /^(Screen|XScreen)/;
let cache = null;

function cellText (cell) {
	if (cell == null) return "";
	if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") {
		return String(cell);
	}
	if (Array.isArray(cell)) return cell.map(cellText).filter(Boolean).join(" ");
	if (typeof cell === "object") {
		if (cell.row != null) return cellText(cell.row);
		if (cell.entry != null) return cellText(cell.entry);
		if (cell.type === "cell" && cell.entry != null) return cellText(cell.entry);
		if (typeof cell.name === "string") return cell.name;
	}
	return "";
}

function normalizeRow (row, width) {
	let cells;
	if (Array.isArray(row)) cells = row;
	else if (row && typeof row === "object" && Array.isArray(row.row)) cells = row.row;
	else return null;
	const out = cells.map(cellText);
	while (out.length < width) out.push("");
	if (out.length > width) out.length = width;
	return out;
}

function displayName (raw) {
	const name = String(raw?.name || raw?.caption || "").trim();
	if (!name) return "Table";
	const parts = name.split(";").map(part => part.trim()).filter(Boolean);
	return parts.length > 1 ? parts.slice(1).join("; ") : name;
}

function isRollableTable (headers, rows, name, isNameGenerator) {
	if (isNameGenerator) return true;
	if (headers.some(header => dieOfHeader(header))) return true;
	return resolveTableRoll(headers, rows, name)?.mode === "die";
}

function normalizeTable (raw) {
	const source = String(raw?.source || "").trim();
	if (!SCREEN_SOURCE.test(source)) return null;
	const fullName = String(raw?.name || raw?.caption || "").trim();
	if (!fullName) return null;
	const headers = Array.isArray(raw?.colLabels)
		? raw.colLabels.map(cellText).map(h => h || "")
		: [];
	if (!headers.length || !headers.some(Boolean)) return null;
	const rows = [];
	for (const row of raw?.rows || []) {
		const normalized = normalizeRow(row, headers.length);
		if (normalized) rows.push(normalized);
	}
	if (!rows.length) return null;
	const name = displayName(raw);
	const id = `${source}::${fullName}`;
	const rollable = isRollableTable(headers, rows, name, !!raw?.isNameGenerator);
	return {
		kind: "bundled",
		id,
		source,
		name,
		fullName,
		headers,
		rows,
		rollable,
	};
}

/**
 * Load Screen / XScreen tables from bundled gendata-tables.json.
 * @returns {Promise<{kind:"bundled",id:string,source:string,name:string,fullName:string,headers:string[],rows:string[][],rollable:boolean}[]>}
 */
export async function ensureBundledScreenTables (plugin) {
	if (cache) return cache;
	const json = await readPluginJson(plugin, "data", "generated", "gendata-tables.json");
	const out = [];
	const seen = new Set();
	for (const raw of json?.table || []) {
		const table = normalizeTable(raw);
		if (!table || seen.has(table.id)) continue;
		seen.add(table.id);
		out.push(table);
	}
	out.sort((a, b) => {
		const bySource = String(a.source).localeCompare(String(b.source));
		if (bySource) return bySource;
		return String(a.name).localeCompare(String(b.name));
	});
	cache = out;
	return cache;
}

export async function listBundledScreenTables (plugin) {
	return ensureBundledScreenTables(plugin);
}

export async function listBundledRollableScreenTables (plugin) {
	const tables = await ensureBundledScreenTables(plugin);
	return tables.filter(table => table.rollable);
}

export async function getBundledScreenTable (plugin, id) {
	const wanted = String(id || "");
	if (!wanted) return null;
	const tables = await ensureBundledScreenTables(plugin);
	return tables.find(table => table.id === wanted) || null;
}

Object.assign(globalThis.FiveEToolsObsidian ||= {}, {
	listBundledScreenTables,
	listBundledRollableScreenTables,
	getBundledScreenTable,
	ensureBundledScreenTables,
});
