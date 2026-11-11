import {loadEntity} from "./entity-loader.js";
import {spellOptionFromEntity} from "./dpr-view.js";
import {ensureSearchIndex, findEditionDoc, findEntityDoc} from "./search-index.js";

const CONDITIONS = ["prone", "restrained", "poisoned", "stunned", "paralyzed"];
const FREQUENCY = ["daily", "rest", "restLong", "recharge", "weekly"];
const EMPTY = {options: [], pool: [], spellDc: 10, spellAttack: 0, casterLevel: 1};

/**
 * Combat spells from a creature's `spellcasting` blocks: slot pool, at-will,
 * and limited daily/rest/recharge uses. Same option shape as party spells.
 */
export async function creatureSpellKit (plugin, ent) {
	if (!ent?.spellcasting?.length) return {...EMPTY};
	await ensureSearchIndex(plugin);
	const pool = [];
	const options = [];
	const seen = new Set();
	let spellDc = 10;
	let spellAttack = 0;
	let casterLevel = 1;
	const cache = new Map();

	for (const block of ent.spellcasting) {
		const activation = blockActivation(block);
		if (!activation) continue;
		const stats = castingStats(block, ent);
		const level = casterLevelOf(block, ent);
		if (stats.dc > spellDc) spellDc = stats.dc;
		if (stats.hit) spellAttack = stats.hit;
		if (level > casterLevel) casterLevel = level;
		const listed = [];
		collectLeveled(block.spells, activation === "reaction" ? null : pool, listed);
		collectNamed(block.will, listed, null, true);
		collectFrequency(block, listed);
		for (const ref of listed) {
			const key = ref.name.toLowerCase();
			if (seen.has(key)) continue;
			const spellEnt = await loadSpell(cache, ref.name, ref.source);
			const spellLevel = Number.isFinite(Number(spellEnt?.level))
				? Number(spellEnt.level)
				: (Number.isFinite(ref.listedLevel) ? ref.listedLevel : null);
			const option = spellOptionFromEntity(spellEnt, {
				name: ref.name,
				idName: ref.name,
				level: spellLevel,
				castingTime: listedTime(activation, spellEnt),
				attack: hasSpellAttack(spellEnt),
				save: saveAbilityName(spellEnt),
				hit: stats.hit,
				dc: stats.dc,
				range: rangeText(spellEnt?.range),
				characterLevel: level,
				uses: ref.uses,
				usesMax: ref.usesMax,
				atWill: !!ref.atWill,
				abilityMod: stats.mod,
			});
			if (!isCombatSpell(option)) continue;
			seen.add(key);
			options.push(option);
		}
	}

	return {options, pool, spellDc, spellAttack, casterLevel};
}

function blockActivation (block) {
	const as = String(block?.displayAs || "action").toLowerCase();
	if (as === "legendary" || as === "mythic") return null;
	if (as === "reaction") return "reaction";
	if (as === "bonus") return "bonus";
	return "action";
}

function listedTime (activation, spellEnt) {
	const unit = String(spellEnt?.time?.[0]?.unit || "").toLowerCase();
	if (unit === "reaction" || activation === "reaction") return "reaction";
	if (activation === "bonus") return "bonus action";
	return "action";
}

function collectLeveled (spells, pool, listed) {
	if (!spells || typeof spells !== "object") return;
	for (const [key, value] of Object.entries(spells)) {
		const level = Number(key);
		if (!Number.isFinite(level)) continue;
		const row = value && !Array.isArray(value) ? value : {spells: value};
		const slots = Number(row?.slots) || 0;
		if (level > 0 && pool) {
			for (let i = 0; i < slots; i++) pool.push({level, pact: row?.lower != null});
		}
		for (const ref of spellRefs(row?.spells || row)) {
			listed.push({...ref, listedLevel: level, uses: null, usesMax: null});
		}
	}
}

function collectNamed (list, listed, uses, atWill = false) {
	for (const ref of spellRefs(list)) {
		listed.push({...ref, listedLevel: null, uses, usesMax: uses, atWill});
	}
}

function collectFrequency (block, listed) {
	for (const prop of FREQUENCY) {
		const map = block?.[prop];
		if (!map || typeof map !== "object" || Array.isArray(map)) continue;
		for (const [key, list] of Object.entries(map)) {
			const count = Number(String(key).match(/^(\d+)/)?.[1]) || 1;
			const spells = Array.isArray(list) ? list : (list?.spells || []);
			collectNamed(spells, listed, count, false);
		}
	}
}

function spellRefs (list) {
	const out = [];
	const items = Array.isArray(list) ? list : [];
	for (const item of items) {
		if (item?.hidden) continue;
		const text = typeof item === "string" ? item : String(item?.entry || "");
		const re = /\{@spell\s+([^}]+)\}/gi;
		let match;
		while ((match = re.exec(text))) {
			const [name, source] = match[1].split("|").map(part => part.trim());
			if (name) out.push({name, source: source || ""});
		}
	}
	return out;
}

async function loadSpell (cache, name, source) {
	const key = `${name}|${source}`.toLowerCase();
	if (cache.has(key)) return cache.get(key);
	let doc = source ? findEntityDoc(name, {categoriesExact: ["spell"], source}) : null;
	if (!doc) doc = findEditionDoc(name, {categoriesExact: ["spell"], edition: "classic"});
	if (!doc) doc = findEditionDoc(name, {categoriesExact: ["spell"], edition: "one"});
	if (!doc) doc = findEntityDoc(name, {categoriesExact: ["spell"]});
	let ent = null;
	if (doc) {
		try { ent = (await loadEntity(doc))?.ent || null; } catch (_) { ent = null; }
	}
	cache.set(key, ent);
	return ent;
}

function castingStats (block, ent) {
	const header = (block?.headerEntries || []).map(it => String(it || "")).join(" ");
	const dcMatch = header.match(/\{@dc\s+(\d+)/i);
	const hitMatch = header.match(/\{@hit\s+([+-]?\d+)/i);
	const ability = String(block?.ability || "int").toLowerCase();
	const score = Number(ent?.[ability]) || 10;
	const mod = Math.floor((score - 10) / 2);
	const pb = crProficiency(ent?.cr);
	return {
		dc: dcMatch ? Number(dcMatch[1]) : 8 + mod + pb,
		hit: hitMatch ? Number(hitMatch[1]) : mod + pb,
		mod,
	};
}

function casterLevelOf (block, ent) {
	const header = (block?.headerEntries || []).map(it => String(it || "")).join(" ");
	const match = header.match(/(\d+)(?:st|nd|rd|th)?[- ]level/i);
	if (match) return Math.max(1, Number(match[1]) || 1);
	return Math.max(1, crNumber(ent?.cr) || 1);
}

function crNumber (cr) {
	const label = String(cr?.cr ?? cr ?? "");
	if (label === "1/8" || label === "1/4" || label === "1/2") return 1;
	const n = Number(label);
	return Number.isFinite(n) ? n : 1;
}

function crProficiency (cr) {
	const n = crNumber(cr);
	if (n < 5) return 2;
	return Math.ceil(n / 4) + 1;
}

function hasSpellAttack (ent) {
	if (Array.isArray(ent?.spellAttack)) return ent.spellAttack.length > 0;
	return !!ent?.spellAttack;
}

function saveAbilityName (ent) {
	const save = ent?.savingThrow;
	if (Array.isArray(save) && save.length) return String(save[0] || "");
	return "";
}

function rangeText (range) {
	if (!range) return "";
	if (typeof range === "string") return range;
	if (range.type === "touch") return "touch";
	if (range.type === "self") return "self";
	const dist = range.distance;
	if (!dist?.amount) return "";
	const unit = dist.type === "miles" ? "miles" : "ft";
	const shape = range.type && range.type !== "point" ? `${range.type} ` : "";
	return `${shape}${dist.amount} ${unit}`.trim();
}

function isCombatSpell (option) {
	if (!option || option.rider || option.kind === "rider" || option.kind === "utility") return false;
	if (option.effect) return true;
	if (option.hidden) return false;
	if (option.kind === "heal") return true;
	if (hasCondition(option)) return true;
	const harm = (Number(option.baseDice) || Number(option.dice) || 0) + Math.abs(Number(option.baseFlat) || 0);
	return (option.kind === "attack" || option.kind === "save" || option.kind === "auto") && harm > 0;
}

function hasCondition (option) {
	const text = `${option?.name || ""} ${option?.blurb || ""}`.toLowerCase();
	return CONDITIONS.some(name => text.includes(name));
}
