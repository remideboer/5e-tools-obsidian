import {TABLE_LIMITS} from "./table-limits.js";
import {parseTableNote, tableNoteText, tablesFolder} from "./table-note.js";
import {readPastedTable} from "./pasted-table.js";

export {tablesFolder};

function slugify (name) {
	const slug = String(name || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "table";
}

function uniqueFileSlug (vault, folder, base) {
	let slug = base;
	let n = 2;
	while (true) {
		const path = `${folder}/${slug}.md`;
		const existing = vault.getAbstractFileByPath(path);
		if (!existing) return slug;
		slug = `${base}-${n++}`;
	}
}

async function ensureFolder (app, folderPath) {
	const parts = String(folderPath || "").split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(acc)) await app.vault.createFolder(acc);
	}
}

async function writeFile (plugin, filePath, text) {
	const vault = plugin.app.vault;
	const existing = vault.getAbstractFileByPath(filePath);
	if (existing && !existing.children) await vault.modify(existing, text);
	else await vault.create(filePath, text);
}

/**
 * @returns {Promise<{path: string, name: string, stem: string}[]>}
 */
export async function listRollTables (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return [];
	const folder = tablesFolder(plugin);
	const dir = vault.getAbstractFileByPath(folder);
	if (!dir?.children) return [];
	const out = [];
	for (const child of dir.children) {
		if (child.children || !String(child.path || "").endsWith(".md")) continue;
		const stem = String(child.name || "").replace(/\.md$/i, "") || "table";
		let name = stem;
		try {
			const parsed = parseTableNote(await vault.read(child));
			if (parsed.ok && parsed.name) name = parsed.name;
		} catch (_) { /* skip unreadable name */ }
		out.push({path: child.path, name, stem});
	}
	return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Save pasted text as a roll-table note under `{notesFolder}/tables/`.
 * @returns {Promise<{path: string, name: string, stem: string, headers: string[], rows: string[][]}>}
 */
export async function saveRollTableNote (plugin, {name, pasted} = {}) {
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	const trimmed = String(name || "").trim() || "Table";
	const parsed = readPastedTable(pasted);
	if (!parsed.ok) throw new Error(parsed.error);
	if (parsed.rows.length > TABLE_LIMITS.rows) throw new Error(`At most ${TABLE_LIMITS.rows} rows.`);

	const folder = tablesFolder(plugin);
	await ensureFolder(plugin.app, folder);
	const existing = await listRollTables(plugin);
	if (existing.length >= TABLE_LIMITS.tables) {
		throw new Error(`At most ${TABLE_LIMITS.tables} roll tables.`);
	}
	const stem = uniqueFileSlug(vault, folder, slugify(trimmed));
	const text = tableNoteText(trimmed, parsed.headers, parsed.rows);
	if (text.length > TABLE_LIMITS.noteBytes) throw new Error("Note would be too large.");
	const filePath = `${folder}/${stem}.md`;
	await writeFile(plugin, filePath, text);
	return {path: filePath, name: trimmed, stem, headers: parsed.headers, rows: parsed.rows};
}

/**
 * @returns {Promise<{ok: true, path: string, name: string, headers: string[], rows: string[], text: string} | {ok: false, error: string}>}
 */
export async function readRollTableNote (plugin, path) {
	const vault = plugin?.app?.vault;
	if (!vault) return {ok: false, error: "Vault is unavailable."};
	const file = vault.getAbstractFileByPath(path);
	if (!file || file.children) return {ok: false, error: "Table note not found."};
	let text;
	try {
		text = await vault.read(file);
	} catch (e) {
		return {ok: false, error: e.message || "Could not read note."};
	}
	const parsed = parseTableNote(text);
	if (!parsed.ok) return parsed;
	return {ok: true, path, name: parsed.name, headers: parsed.headers, rows: parsed.rows, text};
}

export async function deleteRollTableNote (plugin, path) {
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	const folder = tablesFolder(plugin);
	const normalized = String(path || "").replace(/\\/g, "/");
	if (!normalized.startsWith(`${folder}/`) || !normalized.endsWith(".md")) {
		throw new Error("Not a roll-table note.");
	}
	const file = vault.getAbstractFileByPath(normalized);
	if (!file || file.children) throw new Error("Table note not found.");
	await vault.delete(file);
}
