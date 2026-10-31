import {loadEntity} from "./entity-loader.js";
import {getElasticlunr, getParser, getSearchUtil} from "./fiveetools-host.js";
import {pluginVaultPath} from "./plugin-dir.js";

const VERSION = 1;
const TEXT_CAP = 4000;
const TEXT_KEYS = ["entries", "entriesHigherLevel", "additionalEntries", "trait", "action", "bonus", "reaction", "legendary", "mythic", "spellcasting"];

let bodyIndex = null;
let generation = 0;

export function fulltextReady () {
	return !!bodyIndex;
}

export function stopFulltextBuild () {
	generation += 1;
}

export function searchFulltextIds (term) {
	const query = String(term || "").trim();
	if (!bodyIndex || query.length < 2) return [];
	try {
		return bodyIndex.search(query, {
			fields: {body: {boost: 1}},
			bool: "AND",
			expand: false,
		}).map(hit => hit.ref);
	} catch (_) {
		return [];
	}
}

export async function ensureFulltextIndex (plugin, docs, {onProgress, onReady} = {}) {
	if (bodyIndex) {
		onReady?.();
		return;
	}
	const token = ++generation;
	try {
		const stamp = await indexStamp(plugin);
		if (token !== generation) return;
		const cached = await readCache(plugin);
		if (token !== generation) return;
		if (cached?.version === VERSION && cached.stamp === stamp && cached.index) {
			bodyIndex = loadBodyIndex(cached.index);
			onReady?.();
			return;
		}
		onProgress?.("indexing");
		const index = createBodyIndex();
		const list = Array.isArray(docs) ? docs : [];
		for (let i = 0; i < list.length; i++) {
			if (token !== generation) return;
			try {
				const text = await entityText(list[i]);
				if (text) index.addDoc({id: String(list[i].id), body: text});
			} catch (_) { /* one bad entry does not stop the rest */ }
			if (i % 20 === 19) await yieldThread();
		}
		if (token !== generation) return;
		bodyIndex = index;
		await writeCache(plugin, stamp, index);
		if (token !== generation) return;
		onReady?.();
	} catch (_) { /* name search still works */ }
}

function createBodyIndex () {
	const elasticlunr = getElasticlunr();
	elasticlunr.clearStopWords();
	const index = elasticlunr(function () {
		this.addField("body");
		this.setRef("id");
		this.saveDocument(false);
	});
	getSearchUtil().removeStemmer(index);
	return index;
}

function loadBodyIndex (raw) {
	const elasticlunr = getElasticlunr();
	elasticlunr.clearStopWords();
	return elasticlunr.Index.load(raw);
}

async function entityText (doc) {
	const loaded = await loadEntity(doc);
	const ent = loaded?.ent;
	if (!ent) return "";
	const parts = [];
	const state = {n: 0};
	for (const key of TEXT_KEYS) collectText(ent[key], parts, state);
	return parts.join(" ").replace(/\s+/g, " ").trim();
}

function collectText (value, parts, state) {
	if (state.n >= TEXT_CAP || value == null) return;
	if (typeof value === "string") {
		const clean = cleanTag(value).replace(/\s+/g, " ").trim();
		if (!clean) return;
		const slice = clean.slice(0, TEXT_CAP - state.n);
		parts.push(slice);
		state.n += slice.length + 1;
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectText(item, parts, state);
		return;
	}
	if (typeof value !== "object") return;
	if (typeof value.name === "string") collectText(value.name, parts, state);
	if (typeof value.entry === "string") collectText(value.entry, parts, state);
	if (value.entries) collectText(value.entries, parts, state);
	if (value.headerEntries) collectText(value.headerEntries, parts, state);
	if (value.footerEntries) collectText(value.footerEntries, parts, state);
	if (value.items) collectText(value.items, parts, state);
}

function cleanTag (text) {
	return String(text || "")
		.replace(/\{@\w+\s+([^}|]+)(?:\|[^}]*)?\}/g, (_, name) => String(name || "").trim())
		.replace(/\{@\w+\}/g, "");
}

export function fulltextCategories () {
	const Parser = getParser();
	return new Set([Parser.CAT_ID_CREATURE, Parser.CAT_ID_SPELL, Parser.CAT_ID_ITEM]);
}

async function indexStamp (plugin) {
	const path = pluginVaultPath(plugin, "search", "index.json");
	try {
		const stat = await plugin?.app?.vault?.adapter?.stat?.(path);
		return `${VERSION}:${stat?.size || 0}:${stat?.mtime || 0}`;
	} catch (_) {
		return `${VERSION}:0:0`;
	}
}

function cachePath (plugin) {
	const folder = String(plugin?.settings?.notesFolder || "5etools").replace(/\\/g, "/").replace(/\/+$/, "");
	return `${folder}/_cache/fulltext.json`;
}

async function readCache (plugin) {
	const adapter = plugin?.app?.vault?.adapter;
	if (!adapter?.read) return null;
	try {
		return JSON.parse(await adapter.read(cachePath(plugin)));
	} catch (_) {
		return null;
	}
}

async function writeCache (plugin, stamp, index) {
	const adapter = plugin?.app?.vault?.adapter;
	const app = plugin?.app;
	if (!adapter?.write || !app) return;
	try {
		const path = cachePath(plugin);
		await ensureFolder(app, path.split("/").slice(0, -1).join("/"));
		await adapter.write(path, JSON.stringify({version: VERSION, stamp, index: index.toJSON()}));
	} catch (_) { /* the in-memory index still works this session */ }
}

async function ensureFolder (app, folderPath) {
	const parts = String(folderPath || "").split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(acc)) await app.vault.createFolder(acc);
	}
}

function yieldThread () {
	return new Promise(resolve => setTimeout(resolve, 0));
}
