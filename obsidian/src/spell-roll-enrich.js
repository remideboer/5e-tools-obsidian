import {loadEntity} from "./entity-loader.js";
import {spellListTag} from "./homebrew-store.js";
import {findEntityDoc} from "./search-index.js";

const spellMetaCache = new Map();

export function spellRollerMetaFromEntity (ent) {
	const hasAttack = Array.isArray(ent?.spellAttack)
		? ent.spellAttack.length > 0
		: Boolean(ent?.spellAttack);
	const text = flattenSpellEntries(ent?.entries);
	const m = text.match(/\{@(?:damage|dice)\s+[^}]+\}/i);
	return {
		hasAttack,
		damageTag: m ? m[0] : "",
		enriched: true,
	};
}

export async function enrichMonsterSpell (spell) {
	if (!spell?.name || spell.enriched) return false;
	const doc = spell.u
		? {n: spell.name, s: spell.source, u: spell.u, c: 2, cf: "Spell"}
		: findEntityDoc(spell.name, {categoriesExact: ["spell"], source: spell.source});
	if (!doc) {
		spell.hasAttack = false;
		spell.damageTag = "";
		spell.enriched = true;
		return true;
	}
	try {
		const {ent} = await loadEntity(doc);
		Object.assign(spell, spellRollerMetaFromEntity(ent));
		if (doc.u && !spell.u) spell.u = doc.u;
	} catch {
		spell.hasAttack = false;
		spell.damageTag = "";
		spell.enriched = true;
	}
	return true;
}

export async function enrichMonsterSpells (draft) {
	if (!draft || !Array.isArray(draft.spells)) return false;
	let changed = false;
	for (const spell of draft.spells) {
		if (await enrichMonsterSpell(spell)) changed = true;
	}
	return changed;
}

/**
 * Copy a monster and append hit/damage rollers onto spell list tags.
 * Does not mutate the DataLoader-cached entity.
 */
export async function enrichCreatureSpellcasting (mon) {
	if (!mon?.spellcasting?.length) return mon;
	const out = JSON.parse(JSON.stringify(mon));
	for (const block of out.spellcasting || []) {
		const hit = hitBonusFromBlock(block, out);
		await enrichSpellArray(block.will, hit);
		await enrichSpellArray(block.constant, hit);
		await enrichSpellArray(block.ritual, hit);
		await enrichSpellMap(block.spells, hit);
		await enrichSpellMap(block.recharge, hit);
		await enrichSpellMap(block.daily, hit);
	}
	return out;
}

async function enrichSpellArray (list, hit) {
	if (!Array.isArray(list)) return;
	for (let i = 0; i < list.length; i++) {
		list[i] = await enrichSpellBlob(list[i], hit);
	}
}

async function enrichSpellMap (map, hit) {
	if (!map || typeof map !== "object" || Array.isArray(map)) return;
	for (const value of Object.values(map)) {
		if (Array.isArray(value)) await enrichSpellArray(value, hit);
		else if (value?.spells) await enrichSpellArray(value.spells, hit);
	}
}

async function enrichSpellBlob (blob, hit) {
	if (typeof blob !== "string") return blob;
	if (/\{@(?:hit|damage|dice)\b/i.test(blob)) return blob;
	const m = blob.match(/\{@spell\s+([^}]+)\}/i);
	if (!m) return blob;
	const [name, source] = m[1].split("|").map(part => part.trim());
	if (!name) return blob;
	const meta = await spellMetaFor(name, source || "");
	if (!meta.hasAttack && !meta.damageTag) return blob;
	const tagged = spellListTag({
		name,
		source: source || meta.source || "XPHB",
		hasAttack: meta.hasAttack,
		damageTag: meta.damageTag,
	}, hit);
	return blob.replace(m[0], tagged);
}

async function spellMetaFor (name, source) {
	const key = `${name}|${source}`.toLowerCase();
	if (spellMetaCache.has(key)) return spellMetaCache.get(key);
	const doc = findEntityDoc(name, {categoriesExact: ["spell"], source});
	let meta = {hasAttack: false, damageTag: "", enriched: true, source: source || "XPHB"};
	if (doc) {
		try {
			const {ent} = await loadEntity(doc);
			meta = {...spellRollerMetaFromEntity(ent), source: ent?.source || doc.s || source || "XPHB"};
		} catch { /* keep empty meta */ }
	}
	spellMetaCache.set(key, meta);
	return meta;
}

function hitBonusFromBlock (block, mon) {
	const header = (block?.headerEntries || []).map(it => String(it || "")).join(" ");
	const m = header.match(/\{@hit\s+([+-]?\d+)/i);
	if (m) return Number(m[1]);
	const ability = String(block?.ability || "int").toLowerCase();
	const score = Number(mon?.[ability]) || 10;
	const mod = Math.floor((score - 10) / 2);
	return mod + crProficiencyBonus(mon?.cr);
}

function crProficiencyBonus (cr) {
	const label = String(cr?.cr ?? cr ?? "0");
	const n = label === "1/8" || label === "1/4" || label === "1/2" ? 0 : (Number(label) || 0);
	if (n < 5) return 2;
	return Math.ceil(n / 4) + 1;
}

function flattenSpellEntries (value) {
	if (value == null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.map(flattenSpellEntries).join(" ");
	if (typeof value === "object") {
		if (Array.isArray(value.entries)) return flattenSpellEntries(value.entries);
		if (value.entry != null) return flattenSpellEntries(value.entry);
	}
	return "";
}
