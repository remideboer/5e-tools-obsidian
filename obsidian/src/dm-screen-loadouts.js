import {
	getDmScreenBoard,
	queueSaveDmScreen,
	setDmScreenBoard,
} from "./dm-screen-store.js";

function notesRoot (plugin) {
	return String(plugin?.settings?.notesFolder || "5etools").replace(/\\/g, "/").replace(/\/+$/, "");
}

export function dmScreenLoadoutsFolder (plugin) {
	return `${notesRoot(plugin)}/_dmscreen/loadouts`;
}

function loadoutPath (plugin, id) {
	return `${dmScreenLoadoutsFolder(plugin)}/${id}.json`;
}

function slugify (name) {
	const slug = String(name || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "loadout";
}

async function ensureFolder (app, folderPath) {
	const parts = String(folderPath || "").split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(acc)) await app.vault.createFolder(acc);
	}
}

async function writeJson (plugin, filePath, data) {
	const vault = plugin.app.vault;
	const text = `${JSON.stringify(data, null, "\t")}\n`;
	const existing = vault.getAbstractFileByPath(filePath);
	if (existing && !existing.children) await vault.modify(existing, text);
	else await vault.create(filePath, text);
}

async function readJson (plugin, filePath) {
	const vault = plugin.app.vault;
	const file = vault.getAbstractFileByPath(filePath);
	if (!file || file.children) return null;
	try {
		return JSON.parse(await vault.read(file));
	} catch (_) {
		return null;
	}
}

function uniqueId (vault, folder, base) {
	let id = base;
	let n = 2;
	while (vault.getAbstractFileByPath(`${folder}/${id}.json`)) {
		id = `${base}-${n++}`;
	}
	return id;
}

/**
 * @returns {Promise<{id: string, name: string, path: string}[]>}
 */
export async function listDmScreenLoadouts (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault || typeof vault.getAbstractFileByPath !== "function") return [];
	const folder = dmScreenLoadoutsFolder(plugin);
	const dir = vault.getAbstractFileByPath(folder);
	if (!dir?.children) return [];
	const out = [];
	for (const child of dir.children) {
		if (child.children || !String(child.path || "").endsWith(".json")) continue;
		const id = String(child.name || "").replace(/\.json$/i, "") || "";
		if (!id) continue;
		let name = id;
		try {
			const raw = JSON.parse(await vault.read(child));
			if (raw?.name) name = String(raw.name);
		} catch (_) { /* keep id */ }
		out.push({id, name, path: child.path});
	}
	return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Save the current live board as a named loadout.
 * Overwrites an existing loadout with the same id or same name (case-insensitive).
 * @returns {Promise<{id: string, name: string, path: string, columns: object[], savedAt: string}>}
 */
export async function saveDmScreenLoadout (plugin, {id, name} = {}) {
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	const trimmed = String(name || "").trim();
	if (!trimmed) throw new Error("Name is required.");
	const folder = dmScreenLoadoutsFolder(plugin);
	await ensureFolder(plugin.app, folder);

	const existing = await listDmScreenLoadouts(plugin);
	const needle = trimmed.toLowerCase();
	const byName = existing.find(it => String(it.name || "").toLowerCase() === needle);
	const byId = id ? existing.find(it => it.id === id) : null;
	const hit = byId || byName;
	const nextId = hit?.id || uniqueId(vault, folder, slugify(trimmed));
	const board = getDmScreenBoard();
	const payload = {
		id: nextId,
		name: trimmed,
		columns: board.columns || [],
		savedAt: new Date().toISOString(),
	};
	const path = loadoutPath(plugin, nextId);
	await writeJson(plugin, path, payload);
	return {id: nextId, name: trimmed, path, columns: payload.columns, savedAt: payload.savedAt};
}

/**
 * Replace the live board with a saved loadout and persist board.json.
 */
export async function loadDmScreenLoadout (plugin, id) {
	const needle = String(id || "").trim();
	if (!needle) throw new Error("No loadout selected.");
	const raw = await readJson(plugin, loadoutPath(plugin, needle));
	if (!raw || !Array.isArray(raw.columns)) throw new Error("Loadout not found.");
	const next = setDmScreenBoard({columns: raw.columns});
	if (plugin) plugin._dmScreenBoard = next;
	queueSaveDmScreen(plugin);
	return next;
}

export async function deleteDmScreenLoadout (plugin, id) {
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	const needle = String(id || "").trim();
	if (!needle) throw new Error("No loadout selected.");
	const file = vault.getAbstractFileByPath(loadoutPath(plugin, needle));
	if (!file || file.children) throw new Error("Loadout not found.");
	await vault.delete(file);
}

Object.assign(globalThis.FiveEToolsObsidian ||= {}, {
	listDmScreenLoadouts,
	saveDmScreenLoadout,
	loadDmScreenLoadout,
	deleteDmScreenLoadout,
});
