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

export function encountersVaultPath (plugin) {
	const folder = String(plugin?.settings?.notesFolder || "5etools").replace(/\\/g, "/").replace(/\/+$/, "");
	return `${folder}/_encounters/encounters.json`;
}

export async function loadEncountersFromVault (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return getEncountersJson();
	const file = vault.getAbstractFileByPath(encountersVaultPath(plugin));
	if (!file || file.children) {
		setEncountersJson(emptyCatalog());
		return getEncountersJson();
	}
	try {
		const text = await vault.read(file);
		setEncountersJson(JSON.parse(text));
	} catch (_) {
		setEncountersJson(emptyCatalog());
	}
	return getEncountersJson();
}

export async function saveEncountersToVault (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return getEncountersJson();
	const filePath = encountersVaultPath(plugin);
	const folder = filePath.replace(/\/[^/]+$/, "");
	await ensureFolder(plugin.app, folder);
	const text = `${JSON.stringify(catalogJson, null, "\t")}\n`;
	const existing = vault.getAbstractFileByPath(filePath);
	if (existing && !existing.children) await vault.modify(existing, text);
	else await vault.create(filePath, text);
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
		saveEncountersToVault(plugin).catch(() => {});
	}, delay);
}

export async function flushEncounterSave (plugin) {
	if (saveTimer) {
		clearTimeout(saveTimer);
		saveTimer = null;
	}
	return saveEncountersToVault(plugin);
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

export function upsertSavedEncounter ({id, name, combatants, selectedId, party} = {}) {
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

if (globalThis.FiveEToolsObsidian) {
	globalThis.FiveEToolsObsidian.applyEncountersJson = applyEncountersJson;
	globalThis.FiveEToolsObsidian.listSavedEncounters = listSavedEncounters;
	globalThis.FiveEToolsObsidian.getSavedEncounter = getSavedEncounter;
	globalThis.FiveEToolsObsidian.upsertSavedEncounter = upsertSavedEncounter;
	globalThis.FiveEToolsObsidian.deleteSavedEncounter = deleteSavedEncounter;
	globalThis.FiveEToolsObsidian.getEncounterInstance = getEncounterInstance;
	globalThis.FiveEToolsObsidian.setEncounterInstance = setEncounterInstance;
}
