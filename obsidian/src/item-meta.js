import {getParser, getUrlUtil} from "./fiveetools-host.js";
import {getBrewJson, homebrewType} from "./homebrew-store.js";
import {readPluginJson} from "./plugin-dir.js";

let officialMap = null;
let officialReady = false;

export function resetItemMeta () {
	officialMap = null;
	officialReady = false;
}

export function rarityShort (rarity) {
	const Parser = getParser();
	if (Parser?.itemRarityToShort) return Parser.itemRarityToShort(rarity) || "";
	const r = String(rarity || "").toLowerCase();
	const map = {
		common: "Com.",
		uncommon: "Unc.",
		rare: "Rare",
		"very rare": "V.Rare",
		legendary: "Leg.",
		artifact: "Art.",
		varies: "Var.",
	};
	return map[r] || (rarity ? String(rarity) : "");
}

/**
 * @returns {{rarity: string, rarityShort: string}|null}
 */
export function getItemMeta (doc) {
	const map = ensureMap();
	const hashKey = metaKey(doc?.u, doc?.s);
	if (map.has(hashKey)) return map.get(hashKey);
	const nameKey = metaKey(doc?.n, doc?.s);
	if (map.has(nameKey)) return map.get(nameKey);
	if (String(doc?.s || "").toUpperCase() === "HB") {
		const type = homebrewType("item");
		const UrlUtil = getUrlUtil();
		const hashOf = UrlUtil.URL_TO_HASH_BUILDER[type.prop] || UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_ITEMS];
		const needleHash = String(doc?.u || "").toLowerCase();
		const needleName = String(doc?.n || "").toLowerCase();
		const brew = getBrewJson();
		const pool = [...(brew.item || []), ...(brew.baseitem || [])];
		const ent = pool.find(it => {
			const hash = hashOf ? String(hashOf(it)).toLowerCase() : "";
			return hash === needleHash || String(it.name || "").toLowerCase() === needleName;
		});
		if (ent) return itemMetaFromEnt(ent);
	}
	return null;
}

export async function loadItemMeta (plugin) {
	if (officialReady && officialMap) return officialMap;
	const map = new Map();
	officialMap = map;
	try {
		const UrlUtil = getUrlUtil();
		const hashOf = UrlUtil.URL_TO_HASH_BUILDER.item || UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_ITEMS];
		const files = [
			["data", "items.json"],
			["data", "items-base.json"],
		];
		for (const parts of files) {
			let json;
			try {
				json = await readPluginJson(plugin, ...parts);
			} catch (_) {
				continue;
			}
			const lists = [
				...(json.item || []),
				...(json.baseitem || []),
				...(json.itemGroup || []),
			];
			for (const ent of lists) {
				if (!ent?.name) continue;
				const meta = itemMetaFromEnt(ent);
				if (!meta.rarity) continue;
				const source = ent.source || "";
				const hash = hashOf ? hashOf(ent) : `${ent.name}_${source}`;
				map.set(metaKey(hash, source), meta);
				map.set(metaKey(ent.name, source), meta);
			}
		}
		try {
			const variants = await readPluginJson(plugin, "data", "magicvariants.json");
			for (const ent of variants.magicvariant || []) {
				if (!ent?.name) continue;
				const rarity = ent.inherits?.rarity || ent.rarity || "";
				if (!rarity) continue;
				const meta = {rarity: String(rarity), rarityShort: rarityShort(rarity)};
				const source = ent.source || "";
				let hash = `${ent.name}_${source}`;
				try {
					if (hashOf) hash = hashOf(ent);
				} catch (_) { /* name+source key still set */ }
				map.set(metaKey(hash, source), meta);
				map.set(metaKey(ent.name, source), meta);
			}
		} catch (_) { /* optional variants */ }
	} catch (_) { /* missing items leave rows without rarity */ }
	officialReady = true;
	return map;
}

function itemMetaFromEnt (ent) {
	const rarity = String(ent?.rarity || ent?.inherits?.rarity || "").trim();
	return {
		rarity,
		rarityShort: rarityShort(rarity),
	};
}

function ensureMap () {
	if (!officialMap) officialMap = new Map();
	return officialMap;
}

function metaKey (id, source) {
	return `${String(id || "").toLowerCase()}|${String(source || "").toLowerCase()}`;
}
