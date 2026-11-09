import {loadEntity} from "./entity-loader.js";
import {findEntityDoc} from "./search-index.js";

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
