import {openEmbeddedNote} from "./campaign-editor.js";

function notesRoot (plugin) {
	return String(plugin?.settings?.notesFolder || "5etools").replace(/\\/g, "/").replace(/\/+$/, "");
}

export function quickNotesFolder (plugin) {
	return `${notesRoot(plugin)}/notes`;
}

async function ensureFolder (app, folderPath) {
	const parts = String(folderPath || "").split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(acc)) await app.vault.createFolder(acc);
	}
}

export function safeNoteTitle (name) {
	return String(name || "")
		.trim()
		.replace(/[\\/:*?"<>|#]/g, "")
		.replace(/\s+/g, " ")
		.replace(/\.md$/i, "")
		|| "Untitled";
}

function nameCollisionError (title) {
	const err = new Error(`A note named "${title}" already exists.`);
	err.code = "NAME_COLLISION";
	return err;
}

/** Create-only: auto-suffix Untitled / Untitled 2 / … */
function uniqueTitlePath (vault, folder, title, excludePath = "") {
	const base = safeNoteTitle(title);
	const first = `${folder}/${base}.md`;
	if (!vault.getAbstractFileByPath(first) || first === excludePath) return {path: first, title: base};
	let n = 2;
	while (true) {
		const nextTitle = `${base} ${n}`;
		const path = `${folder}/${nextTitle}.md`;
		if (!vault.getAbstractFileByPath(path) || path === excludePath) return {path, title: nextTitle};
		n++;
	}
}

function uniqueUntitledPath (vault, folder) {
	return uniqueTitlePath(vault, folder, "Untitled");
}

/** Rename / live sync: exact title only; throws NAME_COLLISION if taken. */
export function exactTitlePath (vault, folder, title, excludePath = "") {
	const base = safeNoteTitle(title);
	const path = `${folder}/${base}.md`;
	const existing = vault.getAbstractFileByPath(path);
	if (existing && path !== excludePath) throw nameCollisionError(base);
	return {path, title: base};
}

function withHeading (text, title) {
	const body = String(text || "");
	if (/^#\s+.+/m.test(body)) return body.replace(/^#\s+.+/m, `# ${title}`);
	return `# ${title}\n\n${body}`;
}

/**
 * First markdown `# ` heading, sanitized; empty string if none.
 */
export function headingTitleFromText (text) {
	const match = String(text || "").match(/^#\s+(.+)$/m);
	if (!match) return "";
	const raw = String(match[1] || "").trim();
	if (!raw) return "";
	return safeNoteTitle(raw);
}

/**
 * Create a vault note under `{notesFolder}/notes/` and return the TFile.
 */
export async function createQuickNote (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	const folder = quickNotesFolder(plugin);
	await ensureFolder(plugin.app, folder);
	const {path, title} = uniqueUntitledPath(vault, folder);
	return vault.create(path, `# ${title}\n\n`);
}

/**
 * @param {string} [term]
 * @param {{limit?: number}} [opts] pass `{limit: 0}` for all notes; default cap is 12 (search/DM)
 * @returns {Promise<{path: string, title: string}[]>}
 */
export async function listQuickNotes (plugin, term = "", opts = {}) {
	const vault = plugin?.app?.vault;
	if (!vault || typeof vault.getAbstractFileByPath !== "function") return [];
	const folder = quickNotesFolder(plugin);
	const dir = vault.getAbstractFileByPath(folder);
	if (!dir?.children) return [];
	const needle = String(term || "").trim().toLowerCase();
	const out = [];
	for (const child of dir.children) {
		if (child.children || !String(child.path || "").endsWith(".md")) continue;
		const title = String(child.basename || child.name || "").replace(/\.md$/i, "") || "Untitled";
		if (needle && !title.toLowerCase().includes(needle)) continue;
		out.push({path: child.path, title});
	}
	const sorted = out.sort((a, b) => a.title.localeCompare(b.title));
	if (opts.limit === 0) return sorted;
	return sorted.slice(0, opts.limit ?? 12);
}

/**
 * Open a quick note in the 5etools reader pane (embedded Obsidian editor).
 * @param {HTMLElement} parentEl library reader host
 */
export async function openQuickNote (plugin, fileOrPath, parentEl) {
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	if (!parentEl) throw new Error("Reader pane is unavailable.");
	const file = typeof fileOrPath === "string"
		? vault.getAbstractFileByPath(fileOrPath)
		: fileOrPath;
	if (!file || file.children) throw new Error("Note not found.");
	parentEl.classList?.add("fiveetools-campaign-reader");
	await openEmbeddedNote(plugin, parentEl, file);
	return file;
}

/**
 * Rename a quick note so the vault filename matches the title, and sync the `#` heading.
 * @returns {Promise<import("obsidian").TFile>}
 */
export async function renameQuickNote (plugin, fileOrPath, nextTitle, {syncHeading = true} = {}) {
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	const file = typeof fileOrPath === "string"
		? vault.getAbstractFileByPath(fileOrPath)
		: fileOrPath;
	if (!file || file.children) throw new Error("Note not found.");
	const folder = quickNotesFolder(plugin);
	const {path, title} = exactTitlePath(vault, folder, nextTitle, file.path);
	if (syncHeading) {
		const text = withHeading(await vault.read(file), title);
		if (path !== file.path) {
			await vault.modify(file, text);
			await vault.rename(file, path);
			return vault.getAbstractFileByPath(path) || file;
		}
		await vault.modify(file, text);
		return file;
	}
	if (path === file.path) return file;
	await vault.rename(file, path);
	return vault.getAbstractFileByPath(path) || file;
}

/**
 * If the file's first `#` heading differs from the basename, rename to match.
 * Does not rewrite the heading. Throws NAME_COLLISION if the target name is taken.
 */
export async function syncQuickNoteTitleFromFile (plugin, fileOrPath) {
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	const file = typeof fileOrPath === "string"
		? vault.getAbstractFileByPath(fileOrPath)
		: fileOrPath;
	if (!file || file.children) throw new Error("Note not found.");
	const heading = headingTitleFromText(await vault.read(file));
	if (!heading) return file;
	const basename = String(file.basename || "").replace(/\.md$/i, "") || "Untitled";
	if (heading === basename) return file;
	return renameQuickNote(plugin, file, heading, {syncHeading: false});
}

export async function deleteQuickNote (plugin, fileOrPath) {
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	const file = typeof fileOrPath === "string"
		? vault.getAbstractFileByPath(fileOrPath)
		: fileOrPath;
	if (!file || file.children) throw new Error("Note not found.");
	if (typeof vault.trash === "function") await vault.trash(file, true);
	else await vault.delete(file);
}

Object.assign(globalThis.FiveEToolsObsidian ||= {}, {
	createQuickNote,
	listQuickNotes,
	renameQuickNote,
	deleteQuickNote,
	syncQuickNoteTitleFromFile,
	quickNotesFolder,
});
