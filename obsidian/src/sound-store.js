let library = emptyLibrary();
let loadedPath = "";
let saveTimer = null;
let nextClipId = 1;
let nextPlaylistId = 1;
const listeners = new Set();

const AUDIO_EXT = new Set(["mp3", "ogg", "wav", "m4a", "aac", "flac", "webm", "opus"]);
const VAULT_PREFIX = "vault:";

function emptyLibrary () {
	return {clips: [], playlists: [], folders: [], activePlaylistId: ""};
}

export function soundLibraryPath (plugin) {
	const folder = String(plugin?.settings?.notesFolder || "5etools").replace(/\\/g, "/").replace(/\/+$/, "");
	return `${folder}/_sounds/library.json`;
}

export function getSoundLibrary () {
	return copyJson(library);
}

export function onSoundLibrary (fn) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function getClip (id) {
	const clip = library.clips.find(it => it.id === id);
	if (clip) return copyJson(clip);
	const path = pathFromFolderId(id);
	const folder = path ? folderForPath(path) : null;
	return folder ? virtualClip(path, folder.kind) : null;
}

/** Stored clips plus every audio file under a chosen folder. */
export function listSelectableClips (plugin) {
	const clips = library.clips.map(clip => copyJson(clip));
	const seen = new Set(clips.map(clip => clip.path).filter(Boolean));
	for (const file of filesInFolders(plugin)) {
		if (seen.has(file.path)) continue;
		seen.add(file.path);
		clips.push(virtualClip(file.path, file.kind));
	}
	clips.sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: "base"}));
	return clips;
}

export function addSoundFolder (plugin, path, kind) {
	const clean = cleanPath(path);
	if (!clean) return null;
	const folderKind = kind === "ambience" || kind === "effect" ? kind : "music";
	const existing = library.folders.find(it => it.path === clean);
	if (existing) existing.kind = folderKind;
	else library.folders.push({path: clean, kind: folderKind});
	queueSave(plugin);
	emit();
	return copyJson(library.folders.find(it => it.path === clean));
}

export function removeSoundFolder (plugin, path) {
	const clean = cleanPath(path);
	if (!library.folders.some(it => it.path === clean)) return getSoundLibrary();
	library.folders = library.folders.filter(it => it.path !== clean);
	queueSave(plugin);
	emit();
	return getSoundLibrary();
}

export function activePlaylist () {
	const list = library.playlists.find(it => it.id === library.activePlaylistId);
	return list ? copyJson(list) : null;
}

export async function loadSoundLibrary (plugin) {
	const path = soundLibraryPath(plugin);
	if (loadedPath === path) return getSoundLibrary();
	const vault = plugin?.app?.vault;
	if (!vault) {
		setLibrary(emptyLibrary(), path);
		return getSoundLibrary();
	}
	const file = vault.getAbstractFileByPath(path);
	if (!file || file.children) {
		setLibrary(emptyLibrary(), path);
		return getSoundLibrary();
	}
	try {
		setLibrary(JSON.parse(await vault.read(file)), path);
	} catch (_) {
		setLibrary(emptyLibrary(), path);
	}
	return getSoundLibrary();
}

export async function saveSoundLibrary (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return getSoundLibrary();
	const filePath = soundLibraryPath(plugin);
	const folder = filePath.replace(/\/[^/]+$/, "");
	await ensureFolder(plugin.app, folder);
	const text = `${JSON.stringify(library, null, "\t")}\n`;
	const existing = vault.getAbstractFileByPath(filePath);
	if (existing && !existing.children) await vault.modify(existing, text);
	else await vault.create(filePath, text);
	loadedPath = filePath;
	return getSoundLibrary();
}

export function addClip (plugin, draft) {
	const clip = normalizeClip({...draft, id: freshId("s")});
	if (!clip) return null;
	const dup = library.clips.find(it => clip.source === "url" ? it.url === clip.url : it.path === clip.path);
	if (dup) return copyJson(dup);
	library.clips.push(clip);
	queueSave(plugin);
	emit();
	return copyJson(clip);
}

export function removeClip (plugin, id) {
	const needle = String(id || "");
	if (!library.clips.some(it => it.id === needle)) return getSoundLibrary();
	library.clips = library.clips.filter(it => it.id !== needle);
	for (const list of library.playlists) list.clipIds = list.clipIds.filter(clipId => clipId !== needle);
	queueSave(plugin);
	emit();
	return getSoundLibrary();
}

export function addPlaylist (plugin, name) {
	const trimmed = String(name || "").trim();
	if (!trimmed) return null;
	const list = {id: freshId("pl"), name: trimmed, clipIds: []};
	library.playlists.push(list);
	library.activePlaylistId = list.id;
	queueSave(plugin);
	emit();
	return copyJson(list);
}

export function removePlaylist (plugin, id) {
	const needle = String(id || "");
	if (!library.playlists.some(it => it.id === needle)) return getSoundLibrary();
	library.playlists = library.playlists.filter(it => it.id !== needle);
	if (library.activePlaylistId === needle) library.activePlaylistId = "";
	queueSave(plugin);
	emit();
	return getSoundLibrary();
}

export function setActivePlaylist (plugin, id) {
	if (loadedPath !== soundLibraryPath(plugin)) return getSoundLibrary();
	const needle = String(id || "");
	if (needle && !library.playlists.some(it => it.id === needle)) return getSoundLibrary();
	if (library.activePlaylistId === needle) return getSoundLibrary();
	library.activePlaylistId = needle;
	queueSave(plugin);
	emit();
	return getSoundLibrary();
}

export function addClipToPlaylist (plugin, playlistId, clipId) {
	const list = library.playlists.find(it => it.id === playlistId);
	const clip = getClip(clipId);
	if (!list || !clip || list.clipIds.includes(clip.id)) return getSoundLibrary();
	list.clipIds.push(clip.id);
	queueSave(plugin);
	emit();
	return getSoundLibrary();
}

export function removeClipFromPlaylist (plugin, playlistId, clipId) {
	const list = library.playlists.find(it => it.id === playlistId);
	if (!list) return getSoundLibrary();
	const next = list.clipIds.filter(id => id !== clipId);
	if (next.length === list.clipIds.length) return getSoundLibrary();
	list.clipIds = next;
	queueSave(plugin);
	emit();
	return getSoundLibrary();
}

export function moveClipInPlaylist (plugin, playlistId, clipId, delta) {
	const list = library.playlists.find(it => it.id === playlistId);
	if (!list) return getSoundLibrary();
	const ix = list.clipIds.indexOf(clipId);
	const to = ix + delta;
	if (ix < 0 || to < 0 || to >= list.clipIds.length) return getSoundLibrary();
	const [item] = list.clipIds.splice(ix, 1);
	list.clipIds.splice(to, 0, item);
	queueSave(plugin);
	emit();
	return getSoundLibrary();
}

function setLibrary (raw, path) {
	library = normalizeLibrary(raw);
	loadedPath = path;
	emit();
}

function emit () {
	const snapshot = getSoundLibrary();
	for (const fn of [...listeners]) fn(snapshot);
}

function queueSave (plugin) {
	if (!plugin?.app?.vault || loadedPath !== soundLibraryPath(plugin)) return;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		saveTimer = null;
		saveSoundLibrary(plugin).catch(() => {});
	}, 250);
}

function normalizeLibrary (raw) {
	const clips = [];
	const seen = new Set();
	for (const rawClip of Array.isArray(raw?.clips) ? raw.clips : []) {
		const clip = normalizeClip(rawClip);
		if (!clip || seen.has(clip.id)) continue;
		seen.add(clip.id);
		clips.push(clip);
	}
	const ids = new Set(clips.map(clip => clip.id));
	const playlists = [];
	const seenLists = new Set();
	for (const rawList of Array.isArray(raw?.playlists) ? raw.playlists : []) {
		const name = String(rawList?.name || "").trim();
		const id = String(rawList?.id || "").trim();
		if (!name || !id || seenLists.has(id)) continue;
		seenLists.add(id);
		const clipIds = [];
		const used = new Set();
		for (const clipId of Array.isArray(rawList.clipIds) ? rawList.clipIds : []) {
			const key = String(clipId || "");
			if (used.has(key) || !keepClipId(key, ids)) continue;
			used.add(key);
			clipIds.push(key);
		}
		playlists.push({id, name, clipIds});
	}
	bumpIds(clips, playlists);
	const active = playlists.some(it => it.id === raw?.activePlaylistId) ? raw.activePlaylistId : "";
	return {clips, playlists, folders: normalizeFolders(raw?.folders), activePlaylistId: active};
}

function normalizeFolders (raw) {
	const out = [];
	const seen = new Set();
	for (const item of Array.isArray(raw) ? raw : []) {
		const path = cleanPath(typeof item === "string" ? item : item?.path);
		if (!path || seen.has(path)) continue;
		seen.add(path);
		const kind = item?.kind === "ambience" || item?.kind === "effect" ? item.kind : "music";
		out.push({path, kind});
	}
	return out;
}

function keepClipId (key, ids) {
	if (ids.has(key)) return true;
	return !!pathFromFolderId(key);
}

function pathFromFolderId (id) {
	const text = String(id || "");
	if (!text.startsWith(VAULT_PREFIX)) return "";
	return cleanPath(text.slice(VAULT_PREFIX.length));
}

function folderForPath (path) {
	let best = null;
	for (const folder of library.folders) {
		if (path !== folder.path && !path.startsWith(`${folder.path}/`)) continue;
		if (!best || folder.path.length > best.path.length) best = folder;
	}
	return best;
}

function virtualClip (path, kind) {
	const base = path.split("/").pop() || path;
	const name = base.replace(/\.[^.]+$/, "") || base;
	return {
		id: `${VAULT_PREFIX}${path}`,
		name,
		kind: kind === "ambience" || kind === "effect" ? kind : "music",
		source: "vault",
		path,
		url: "",
		fromFolder: true,
	};
}

function filesInFolders (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault || !library.folders.length) return [];
	const out = [];
	const seen = new Set();
	for (const source of library.folders) {
		const dir = vault.getAbstractFileByPath(source.path);
		if (!dir?.children) continue;
		walkFiles(dir, (file) => {
			const ext = String(file.extension || "").toLowerCase();
			const path = cleanPath(file.path);
			if (!AUDIO_EXT.has(ext) || !path || seen.has(path)) return;
			seen.add(path);
			const folder = folderForPath(path);
			out.push({path, kind: folder?.kind || source.kind});
		});
	}
	return out;
}

function walkFiles (folder, visit) {
	for (const child of folder.children || []) {
		if (child.children) walkFiles(child, visit);
		else visit(child);
	}
}

function cleanPath (path) {
	return String(path || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeClip (raw) {
	if (!raw || typeof raw !== "object") return null;
	const source = raw.source === "url" ? "url" : "vault";
	const path = String(raw.path || "").replace(/\\/g, "/").trim();
	const url = String(raw.url || "").trim();
	if (source === "vault" && !path) return null;
	if (source === "url" && !/^https?:\/\//i.test(url)) return null;
	const kind = raw.kind === "ambience" || raw.kind === "effect" ? raw.kind : "music";
	const fallback = source === "vault" ? path.split("/").pop() : "Link";
	const name = String(raw.name || "").trim() || fallback || "Clip";
	const id = String(raw.id || "").trim() || freshId("s");
	return {
		id,
		name,
		kind,
		source,
		path: source === "vault" ? path : "",
		url: source === "url" ? url : "",
	};
}

function bumpIds (clips, playlists) {
	for (const clip of clips) bumpOne("s", clip.id);
	for (const list of playlists) bumpOne("pl", list.id);
}

function bumpOne (prefix, id) {
	const n = Number(String(id || "").replace(prefix === "pl" ? /^pl/ : /^s/, ""));
	if (!Number.isFinite(n)) return;
	if (prefix === "pl") {
		if (n >= nextPlaylistId) nextPlaylistId = n + 1;
	} else if (n >= nextClipId) nextClipId = n + 1;
}

function freshId (prefix) {
	if (prefix === "pl") return `pl${nextPlaylistId++}`;
	return `s${nextClipId++}`;
}

function copyJson (value) {
	return JSON.parse(JSON.stringify(value));
}

async function ensureFolder (app, folderPath) {
	const parts = String(folderPath || "").split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(acc)) await app.vault.createFolder(acc);
	}
}
