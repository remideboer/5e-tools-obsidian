import {normalizeParty} from "./encounter-difficulty.js";

let catalogJson = emptyCatalog();
let nextEncounterId = 1;
let saveTimer = null;

export function emptyCatalog () {
	return {encounters: [], instance: emptyInstance()};
}

export function emptyInstance () {
	return {
		name: "",
		savedId: null,
		pickedId: null,
		selectedId: null,
		party: normalizeParty(),
		combatants: [],
		showBlank: false,
		blankDraft: null,
		saveToHomebrew: false,
		initOrderBaseline: null,
	};
}

export function getEncountersJson () {
	return copyJson(catalogJson);
}

export function setEncountersJson (json) {
	catalogJson = normalizeCatalog(json);
	bumpEncounterId(catalogJson.encounters);
	return getEncountersJson();
}

export function applyEncountersJson (json) {
	return setEncountersJson(json);
}

export function encountersRoot (plugin) {
	const folder = String(plugin?.settings?.notesFolder || "5etools").replace(/\\/g, "/").replace(/\/+$/, "");
	return `${folder}/_encounters`;
}

/** @deprecated Monolith path; kept for one-time migration. */
export function encountersVaultPath (plugin) {
	return `${encountersRoot(plugin)}/encounters.json`;
}

export function savedEncounterPath (plugin, id) {
	const safe = String(id || "").trim().replace(/[^\w.-]+/g, "-") || "encounter";
	return `${encountersRoot(plugin)}/${safe}.json`;
}

export function instanceVaultPath (plugin) {
	return `${encountersRoot(plugin)}/_instance.json`;
}

export async function loadEncountersFromVault (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return getEncountersJson();
	await migrateMonolithEncounters(plugin);
	const encounters = [];
	const folder = vault.getAbstractFileByPath(encountersRoot(plugin));
	if (folder?.children) {
		for (const child of folder.children) {
			if (child.children || !String(child.path || "").endsWith(".json")) continue;
			const base = String(child.name || "").replace(/\.json$/i, "");
			if (base === "_instance" || base.endsWith(".bak") || base === "encounters") continue;
			try {
				const raw = JSON.parse(await vault.read(child));
				const saved = normalizeEncounter(raw);
				if (saved) encounters.push(saved);
			} catch (_) { /* skip */ }
		}
	}
	let instance = emptyInstance();
	const instFile = vault.getAbstractFileByPath(instanceVaultPath(plugin));
	if (instFile && !instFile.children) {
		try {
			instance = normalizeInstance(JSON.parse(await vault.read(instFile)));
		} catch (_) { /* keep empty */ }
	}
	setEncountersJson({encounters, instance});
	return getEncountersJson();
}

async function migrateMonolithEncounters (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return;
	const monolithPath = encountersVaultPath(plugin);
	const monolith = vault.getAbstractFileByPath(monolithPath);
	if (!monolith || monolith.children) return;
	let parsed;
	try {
		parsed = JSON.parse(await vault.read(monolith));
	} catch (_) {
		return;
	}
	const catalog = normalizeCatalog(parsed);
	await ensureFolder(plugin.app, encountersRoot(plugin));
	for (const saved of catalog.encounters) {
		await writeVaultJson(plugin, savedEncounterPath(plugin, saved.id), saved);
	}
	await writeVaultJson(plugin, instanceVaultPath(plugin), catalog.instance);
	const bakPath = `${monolithPath}.bak`;
	const existingBak = vault.getAbstractFileByPath(bakPath);
	if (existingBak && !existingBak.children) await vault.delete(existingBak);
	await vault.rename(monolith, bakPath);
}

export async function saveInstanceToVault (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return getEncounterInstance();
	await ensureFolder(plugin.app, encountersRoot(plugin));
	await writeVaultJson(plugin, instanceVaultPath(plugin), catalogJson.instance || emptyInstance());
	return getEncounterInstance();
}

export async function saveSavedEncounter (plugin, saved) {
	const vault = plugin?.app?.vault;
	if (!vault || !saved?.id) return saved;
	await ensureFolder(plugin.app, encountersRoot(plugin));
	await writeVaultJson(plugin, savedEncounterPath(plugin, saved.id), saved);
	return saved;
}

/** Persist instance only (composer edits). Prefer saveSavedEncounter when saving a named roster. */
export async function saveEncountersToVault (plugin) {
	await saveInstanceToVault(plugin);
	return getEncountersJson();
}

export function getEncounterInstance () {
	return copyJson(catalogJson.instance || emptyInstance());
}

export function setEncounterInstance (session) {
	const catalog = normalizeCatalog(catalogJson);
	catalog.instance = normalizeInstance(session);
	catalogJson = catalog;
	return getEncounterInstance();
}

export function queueSaveEncountersToVault (plugin, delay = 250) {
	if (!plugin?.app?.vault) return;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		saveTimer = null;
		saveInstanceToVault(plugin).catch(() => {});
	}, delay);
}

export async function flushEncounterSave (plugin) {
	if (saveTimer) {
		clearTimeout(saveTimer);
		saveTimer = null;
	}
	return saveInstanceToVault(plugin);
}

export function listSavedEncounters () {
	return (catalogJson.encounters || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function getSavedEncounter (id) {
	const needle = String(id || "");
	if (!needle) return null;
	const hit = (catalogJson.encounters || []).find(it => it.id === needle);
	return hit ? copyJson(hit) : null;
}

export function upsertSavedEncounter ({id, name, combatants, selectedId, party, initOrderBaseline} = {}) {
	const trimmed = String(name || "").trim();
	if (!trimmed) throw new Error("Name is required.");
	const catalog = normalizeCatalog(catalogJson);
	const needle = trimmed.toLowerCase();
	const byName = catalog.encounters.findIndex(it => String(it.name || "").toLowerCase() === needle);
	const byId = id ? catalog.encounters.findIndex(it => it.id === id) : -1;
	const ix = byName >= 0 ? byName : byId;
	const saved = {
		id: ix >= 0 ? catalog.encounters[ix].id : nextId(),
		name: trimmed,
		updated: new Date().toISOString(),
		selectedId: selectedId || null,
		party: normalizeParty(party),
		combatants: cloneCombatants(combatants),
		initOrderBaseline: Array.isArray(initOrderBaseline) ? initOrderBaseline.map(String) : null,
	};
	if (ix >= 0) catalog.encounters[ix] = saved;
	else catalog.encounters.push(saved);
	setEncountersJson(catalog);
	return copyJson(saved);
}

export function deleteSavedEncounter (id) {
	const needle = String(id || "");
	if (!needle) return getEncountersJson();
	const catalog = normalizeCatalog(catalogJson);
	catalog.encounters = catalog.encounters.filter(it => it.id !== needle);
	setEncountersJson(catalog);
	return getEncountersJson();
}

export async function deleteSavedEncounterFromVault (plugin, id) {
	deleteSavedEncounter(id);
	await deleteVaultFile(plugin, savedEncounterPath(plugin, id));
	return getEncountersJson();
}

function normalizeCatalog (json) {
	const encounters = Array.isArray(json?.encounters) ? json.encounters : [];
	return {
		encounters: encounters.map(normalizeEncounter).filter(Boolean),
		instance: normalizeInstance(json?.instance),
	};
}

function normalizeEncounter (raw) {
	if (!raw || typeof raw !== "object") return null;
	const name = String(raw.name || "").trim();
	if (!name) return null;
	const id = String(raw.id || "").trim() || nextId();
	return {
		id,
		name,
		updated: String(raw.updated || "") || new Date().toISOString(),
		selectedId: raw.selectedId || null,
		party: normalizeParty(raw.party),
		combatants: cloneCombatants(raw.combatants),
		initOrderBaseline: Array.isArray(raw.initOrderBaseline) ? raw.initOrderBaseline.map(String) : null,
	};
}

function normalizeInstance (raw) {
	if (!raw || typeof raw !== "object") return emptyInstance();
	return {
		name: String(raw.name || ""),
		savedId: raw.savedId || null,
		pickedId: raw.pickedId || null,
		selectedId: raw.selectedId || null,
		party: normalizeParty(raw.party),
		combatants: cloneCombatants(raw.combatants),
		showBlank: !!raw.showBlank,
		blankDraft: raw.blankDraft ? copyJson(raw.blankDraft) : null,
		saveToHomebrew: !!raw.saveToHomebrew,
		initOrderBaseline: Array.isArray(raw.initOrderBaseline) ? raw.initOrderBaseline.map(String) : null,
	};
}

function nextId () {
	return `e${nextEncounterId++}`;
}

function bumpEncounterId (encounters) {
	for (const it of encounters || []) {
		const n = Number(String(it.id || "").replace(/^e/, ""));
		if (Number.isFinite(n) && n >= nextEncounterId) nextEncounterId = n + 1;
	}
}

function cloneCombatants (combatants) {
	return (combatants || []).map(it => ({
		...it,
		doc: it.doc ? {...it.doc} : null,
		ent: it.ent ? JSON.parse(JSON.stringify(it.ent)) : null,
		scaleBase: it.scaleBase ? JSON.parse(JSON.stringify(it.scaleBase)) : null,
	}));
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

async function writeVaultJson (plugin, filePath, value) {
	const vault = plugin?.app?.vault;
	if (!vault) return;
	const folder = filePath.replace(/\/[^/]+$/, "");
	await ensureFolder(plugin.app, folder);
	const text = `${JSON.stringify(value, null, "\t")}\n`;
	const existing = vault.getAbstractFileByPath(filePath);
	if (existing && !existing.children) await vault.modify(existing, text);
	else await vault.create(filePath, text);
}

async function deleteVaultFile (plugin, filePath) {
	const vault = plugin?.app?.vault;
	if (!vault) return;
	const existing = vault.getAbstractFileByPath(filePath);
	if (existing && !existing.children) await vault.delete(existing);
}

Object.assign(globalThis.FiveEToolsObsidian ||= {}, {
	applyEncountersJson,
	listSavedEncounters,
	getSavedEncounter,
	upsertSavedEncounter,
	deleteSavedEncounter,
	getEncounterInstance,
	setEncounterInstance,
});
