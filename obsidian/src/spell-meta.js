import {getUrlUtil} from "./fiveetools-host.js";
import {getBrewJson, homebrewType} from "./homebrew-store.js";
import {readPluginJson} from "./plugin-dir.js";

const CLASS_ABBR = {
	artificer: "Art",
	barbarian: "Bar",
	bard: "Brd",
	cleric: "Clr",
	druid: "Drd",
	fighter: "Ftr",
	monk: "Mnk",
	paladin: "Pal",
	ranger: "Rgr",
	rogue: "Rog",
	sorcerer: "Sor",
	warlock: "War",
	wizard: "Wiz",
	"blood hunter": "BH",
};

let officialMap = null;
let officialReady = false;

export function resetSpellMeta () {
	officialMap = null;
	officialReady = false;
}

export function classAbbr (name) {
	const key = String(name || "").toLowerCase();
	return CLASS_ABBR[key] || String(name || "").slice(0, 3);
}

export function spellLevelShort (level) {
	const n = Number(level);
	if (!Number.isFinite(n) || n < 0) return "";
	if (n === 0) return "Can.";
	const ord = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
	return ord[n] || `${n}th`;
}

export function spellLevelFull (level) {
	const n = Number(level);
	if (!Number.isFinite(n) || n < 0) return "";
	if (n === 0) return "Cantrip";
	const ord = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
	return `${ord[n] || `${n}th`}-level`;
}

/**
 * @returns {{level: number|null, classes: string[], classAbbrs: string[]}|null}
 */
export function getSpellMeta (doc) {
	const map = ensureMap();
	const hashKey = metaKey(doc?.u, doc?.s);
	if (map.has(hashKey)) return map.get(hashKey);
	const nameKey = metaKey(doc?.n, doc?.s);
	if (map.has(nameKey)) return map.get(nameKey);
	if (String(doc?.s || "").toUpperCase() === "HB") {
		const type = homebrewType("spell");
		const UrlUtil = getUrlUtil();
		const hashOf = UrlUtil.URL_TO_HASH_BUILDER[type.prop] || UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_SPELLS];
		const needleHash = String(doc?.u || "").toLowerCase();
		const needleName = String(doc?.n || "").toLowerCase();
		const ent = (getBrewJson().spell || []).find(it => {
			const hash = hashOf ? String(hashOf(it)).toLowerCase() : "";
			return hash === needleHash || String(it.name || "").toLowerCase() === needleName;
		});
		if (ent) return spellMetaFromEnt(ent, []);
	}
	return null;
}

export async function loadSpellMeta (plugin) {
	if (officialReady && officialMap) return officialMap;
	const map = new Map();
	officialMap = map;
	try {
		const index = await readPluginJson(plugin, "data", "spells", "index.json");
		let sources = {};
		try {
			sources = await readPluginJson(plugin, "data", "spells", "sources.json");
		} catch (_) { /* optional */ }
		const UrlUtil = getUrlUtil();
		const hashOf = UrlUtil.URL_TO_HASH_BUILDER.spell || UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_SPELLS];
		for (const file of Object.values(index || {})) {
			if (typeof file !== "string" || !file || file.includes("..")) continue;
			let json;
			try {
				json = await readPluginJson(plugin, "data", "spells", file);
			} catch (_) {
				continue;
			}
			for (const ent of json.spell || []) {
				if (!ent?.name) continue;
				const source = ent.source || "";
				const classList = classesFromSources(sources, source, ent.name);
				const fromEnt = (ent.classes?.fromClassList || []).map(it => it?.name).filter(Boolean);
				const classes = uniqueNames([...classList, ...fromEnt]);
				const meta = {
					level: ent.level == null ? null : Number(ent.level),
					classes,
					classAbbrs: classes.map(classAbbr),
				};
				const hash = hashOf ? hashOf(ent) : `${ent.name}_${source}`;
				map.set(metaKey(hash, source), meta);
				map.set(metaKey(ent.name, source), meta);
			}
		}
	} catch (_) { /* missing spells leave rows without level/classes */ }
	officialReady = true;
	return map;
}

function spellMetaFromEnt (ent, extraClasses = []) {
	const fromEnt = (ent.classes?.fromClassList || []).map(it => it?.name).filter(Boolean);
	const classes = uniqueNames([...extraClasses, ...fromEnt]);
	return {
		level: ent.level == null ? null : Number(ent.level),
		classes,
		classAbbrs: classes.map(classAbbr),
	};
}

function classesFromSources (sources, source, name) {
	const bySource = sources?.[source] || sources?.[String(source || "").toUpperCase()];
	const entry = bySource?.[name];
	if (!entry?.class?.length) return [];
	return entry.class.map(it => it?.name).filter(Boolean);
}

function uniqueNames (names) {
	const seen = new Set();
	const out = [];
	for (const name of names) {
		const key = String(name).toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(name);
	}
	return out;
}

function ensureMap () {
	if (!officialMap) officialMap = new Map();
	return officialMap;
}

function metaKey (id, source) {
	return `${String(id || "").toLowerCase()}|${String(source || "").toLowerCase()}`;
}
