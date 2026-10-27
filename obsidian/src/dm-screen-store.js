let boardJson = emptyBoard();
let nextPanelId = 1;
let saveTimer = null;

export function emptyBoard () {
	return {columns: []};
}

export function dmScreenVaultPath (plugin) {
	const folder = String(plugin?.settings?.notesFolder || "5etools").replace(/\\/g, "/").replace(/\/+$/, "");
	return `${folder}/_dmscreen/board.json`;
}

export function getDmScreenBoard () {
	return copyJson(boardJson);
}

export function setDmScreenBoard (board) {
	boardJson = normalizeBoard(board);
	return getDmScreenBoard();
}

export function allocPanelId () {
	return `p${nextPanelId++}`;
}

export async function loadDmScreenFromVault (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return getDmScreenBoard();
	const file = vault.getAbstractFileByPath(dmScreenVaultPath(plugin));
	if (!file || file.children) {
		setDmScreenBoard(emptyBoard());
		return getDmScreenBoard();
	}
	try {
		const text = await vault.read(file);
		setDmScreenBoard(JSON.parse(text));
	} catch (_) {
		setDmScreenBoard(emptyBoard());
	}
	return getDmScreenBoard();
}

export async function saveDmScreenToVault (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return getDmScreenBoard();
	const filePath = dmScreenVaultPath(plugin);
	const folder = filePath.replace(/\/[^/]+$/, "");
	await ensureFolder(plugin.app, folder);
	const text = `${JSON.stringify(boardJson, null, "\t")}\n`;
	const existing = vault.getAbstractFileByPath(filePath);
	if (existing && !existing.children) await vault.modify(existing, text);
	else await vault.create(filePath, text);
	return getDmScreenBoard();
}

export function queueSaveDmScreen (plugin, delay = 250) {
	if (!plugin?.app?.vault) return;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		saveTimer = null;
		saveDmScreenToVault(plugin).catch(() => {});
	}, delay);
}

export async function flushDmScreenSave (plugin) {
	if (saveTimer) {
		clearTimeout(saveTimer);
		saveTimer = null;
	}
	return saveDmScreenToVault(plugin);
}

function normalizeBoard (raw) {
	const source = Array.isArray(raw?.columns)
		? raw.columns
		: (raw?.panels || []).map(panel => ({items: [panel]}));
	const columns = source.map(normalizeColumn).filter(col => col.items.length);
	bumpIds(columns);
	return {columns};
}

function normalizeColumn (raw) {
	const items = (raw?.items || []).map(normalizePanel).filter(Boolean);
	return {
		id: String(raw?.id || allocPanelId()),
		items,
	};
}

const PANEL_TYPES = new Set(["entity", "counter", "campaignNote", "note", "encounter", "reference", "rollTable"]);
const REFERENCE_IDS = new Set(["conditions", "cover", "exhaustion", "concentration"]);

function normalizePanel (raw) {
	if (!raw || typeof raw !== "object") return null;
	const type = PANEL_TYPES.has(raw.type) ? raw.type : "note";
	const doc = slimDoc(raw.doc);
	const path = String(raw.path || "");
	const ref = String(raw.ref || "");
	if (type === "entity" && !doc) return null;
	if ((type === "campaignNote" || type === "rollTable") && !path) return null;
	if (type === "reference" && !REFERENCE_IDS.has(ref)) return null;
	return {
		id: String(raw.id || allocPanelId()),
		type,
		title: String(raw.title || defaultTitle(type, doc, ref)).trim() || defaultTitle(type, doc, ref),
		doc,
		path,
		ref,
		text: String(raw.text || ""),
		value: Number.isFinite(Number(raw.value)) ? Math.trunc(Number(raw.value)) : 0,
	};
}

function defaultTitle (type, doc, ref) {
	if (type === "entity") return doc?.n || "Entry";
	if (type === "counter") return "Counter";
	if (type === "encounter") return "Encounter";
	if (type === "reference") return ref ? ref.charAt(0).toUpperCase() + ref.slice(1) : "Reference";
	if (type === "rollTable") return "Roll table";
	return "Note";
}

function slimDoc (doc) {
	if (!doc?.u && !doc?.n) return null;
	return {
		n: doc.n || "",
		u: doc.u || "",
		s: doc.s || "",
		c: doc.c ?? null,
		cf: doc.cf || "",
		sA: doc.sA || "",
	};
}

function bumpIds (columns) {
	const consider = (id) => {
		const n = Number(String(id || "").replace(/^[a-z]+/i, ""));
		if (Number.isFinite(n) && n >= nextPanelId) nextPanelId = n + 1;
	};
	for (const col of columns || []) {
		consider(col.id);
		for (const it of col.items || []) consider(it.id);
	}
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
