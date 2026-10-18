import fs from "fs";
import path from "path";
import {getConfiguredRoot, getUrlUtil} from "./fiveetools-host.js";
import {getBrewJson, homebrewType} from "./homebrew-store.js";

export const BESTIARY_FILTER_OPTIONS = {
	types: [
		{id: "aberration", label: "Aberration"},
		{id: "beast", label: "Beast"},
		{id: "celestial", label: "Celestial"},
		{id: "construct", label: "Construct"},
		{id: "dragon", label: "Dragon"},
		{id: "elemental", label: "Elemental"},
		{id: "fey", label: "Fey"},
		{id: "fiend", label: "Fiend"},
		{id: "giant", label: "Giant"},
		{id: "humanoid", label: "Humanoid"},
		{id: "monstrosity", label: "Monstrosity"},
		{id: "ooze", label: "Ooze"},
		{id: "plant", label: "Plant"},
		{id: "undead", label: "Undead"},
	],
	crs: [
		"0", "1/8", "1/4", "1/2",
		"1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
		"11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
		"21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
	].map(id => ({id, label: id})),
	sizes: [
		{id: "T", label: "Tiny"},
		{id: "S", label: "Small"},
		{id: "M", label: "Medium"},
		{id: "L", label: "Large"},
		{id: "H", label: "Huge"},
		{id: "G", label: "Gargantuan"},
	],
	alignments: [
		{id: "U", label: "Unaligned"},
		{id: "LG", label: "Lawful Good"},
		{id: "NG", label: "Neutral Good"},
		{id: "CG", label: "Chaotic Good"},
		{id: "LN", label: "Lawful Neutral"},
		{id: "N", label: "Neutral"},
		{id: "CN", label: "Chaotic Neutral"},
		{id: "LE", label: "Lawful Evil"},
		{id: "NE", label: "Neutral Evil"},
		{id: "CE", label: "Chaotic Evil"},
		{id: "G", label: "Any Good"},
		{id: "E", label: "Any Evil"},
		{id: "L", label: "Lawful"},
		{id: "C", label: "Chaotic"},
	],
};

const ALIGNMENT_GROUPS = new Set(["G", "E", "L", "C"]);

let officialMap = null;

export function emptyBestiaryFilters () {
	return {types: [], crs: [], sizes: [], alignments: []};
}

export function hasBestiaryFilters (filters) {
	return !!(filters?.types?.length || filters?.crs?.length || filters?.sizes?.length || filters?.alignments?.length);
}

export function monsterMetaFromEnt (ent) {
	return {
		cr: String(ent?.cr?.cr ?? ent?.cr ?? ""),
		types: typeKeys(ent),
		sizes: sizeKeys(ent),
		alignments: alignmentKeys(ent),
		copy: ent?._copy?.name
			? {name: ent._copy.name, source: ent._copy.source || ent.source}
			: null,
	};
}

export function docMatchesBestiaryFilters (doc, filters) {
	if (!hasBestiaryFilters(filters)) return true;
	const meta = getMonsterMeta(doc);
	if (!meta) return false;
	if (filters.types?.length && !filters.types.some(it => meta.types.includes(it))) return false;
	if (filters.crs?.length && !filters.crs.includes(meta.cr || "0")) return false;
	if (filters.sizes?.length && !filters.sizes.some(it => meta.sizes.includes(it))) return false;
	if (filters.alignments?.length && !alignmentMatches(meta.alignments, filters.alignments)) return false;
	return true;
}

function alignmentMatches (codes, selected) {
	return selected.some(sel => {
		if (ALIGNMENT_GROUPS.has(sel)) return (codes || []).some(code => String(code).includes(sel));
		return (codes || []).includes(sel);
	});
}

export function resetMonsterMeta () {
	officialMap = null;
}

export function ensureMonsterMeta () {
	return ensureOfficialMeta();
}

export function getMonsterMeta (doc) {
	const map = ensureOfficialMeta();
	const hashKey = metaKey(doc?.u, doc?.s);
	if (map.has(hashKey)) return map.get(hashKey);
	const nameKey = metaKey(doc?.n, doc?.s);
	if (map.has(nameKey)) return map.get(nameKey);
	if (String(doc?.s || "").toUpperCase() === "HB") {
		const type = homebrewType("monster");
		const UrlUtil = getUrlUtil();
		const hashOf = UrlUtil.URL_TO_HASH_BUILDER[type.prop] || UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY];
		const needleHash = String(doc?.u || "").toLowerCase();
		const needleName = String(doc?.n || "").toLowerCase();
		const ent = (getBrewJson().monster || []).find(it => {
			const hash = hashOf ? String(hashOf(it)).toLowerCase() : "";
			return hash === needleHash || String(it.name || "").toLowerCase() === needleName;
		});
		if (ent) return inheritMeta(monsterMetaFromEnt(ent), map);
	}
	return null;
}

function ensureOfficialMeta () {
	if (officialMap) return officialMap;
	officialMap = new Map();
	const root = String(getConfiguredRoot() || "").replace(/\/+$/, "");
	if (!root) return officialMap;
	const indexPath = path.join(root, "data", "bestiary", "index.json");
	if (!fs.existsSync(indexPath)) return officialMap;
	let index;
	try {
		index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
	} catch (_) {
		return officialMap;
	}
	const UrlUtil = getUrlUtil();
	const hashOf = UrlUtil.URL_TO_HASH_BUILDER.monster || UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY];
	for (const file of Object.values(index || {})) {
		const filePath = path.join(root, "data", "bestiary", file);
		if (!fs.existsSync(filePath)) continue;
		let json;
		try {
			json = JSON.parse(fs.readFileSync(filePath, "utf8"));
		} catch (_) {
			continue;
		}
		for (const ent of json.monster || []) {
			if (!ent?.name) continue;
			const meta = monsterMetaFromEnt(ent);
			const source = ent.source || "";
			const hash = hashOf ? hashOf(ent) : `${ent.name}_${source}`;
			officialMap.set(metaKey(hash, source), meta);
			officialMap.set(metaKey(ent.name, source), meta);
		}
	}
	for (const meta of officialMap.values()) inheritMeta(meta, officialMap);
	return officialMap;
}

function metaKey (id, source) {
	return `${String(id || "").toLowerCase()}|${String(source || "").toLowerCase()}`;
}

function inheritMeta (meta, map, depth = 0) {
	if (!meta || depth > 6) return meta;
	if (meta.cr && meta.types.length && meta.sizes.length && meta.alignments.length) return meta;
	if (!meta.copy) {
		if (!meta.cr) meta.cr = "0";
		return meta;
	}
	const parent = map.get(metaKey(meta.copy.name, meta.copy.source));
	if (!parent || parent === meta) {
		if (!meta.cr) meta.cr = "0";
		return meta;
	}
	inheritMeta(parent, map, depth + 1);
	if (!meta.cr) meta.cr = parent.cr;
	if (!meta.types.length) meta.types = [...parent.types];
	if (!meta.sizes.length) meta.sizes = [...parent.sizes];
	if (!meta.alignments.length) meta.alignments = [...parent.alignments];
	if (!meta.cr) meta.cr = "0";
	return meta;
}

function typeKeys (ent) {
	const t = ent?.type;
	if (!t) return [];
	if (typeof t === "string") return [t.toLowerCase()];
	if (typeof t.type === "string") return [t.type.toLowerCase()];
	return [];
}

function sizeKeys (ent) {
	if (Array.isArray(ent?.size)) return ent.size.map(it => String(it));
	if (ent?.size) return [String(ent.size)];
	return [];
}

function alignmentKeys (ent) {
	const raw = ent?.alignment;
	if (!raw) return ["U"];
	if (!Array.isArray(raw)) return ["U"];
	if (raw.some(it => it && typeof it === "object")) return ["A"];
	const letters = raw.filter(it => typeof it === "string").join("");
	return [letters || "U"];
}

if (globalThis.FiveEToolsObsidian) {
	globalThis.FiveEToolsObsidian.docMatchesBestiaryFilters = docMatchesBestiaryFilters;
	globalThis.FiveEToolsObsidian.getMonsterMeta = getMonsterMeta;
	globalThis.FiveEToolsObsidian.hasBestiaryFilters = hasBestiaryFilters;
	globalThis.FiveEToolsObsidian.ensureMonsterMeta = ensureMonsterMeta;
}
