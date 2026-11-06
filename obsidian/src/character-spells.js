import {loadEntity} from "./entity-loader.js";
import {getParser} from "./fiveetools-host.js";
import {ensureSearchIndex, findEditionDoc, listEntities} from "./search-index.js";
import {getSpellMeta, loadSpellMeta, spellLevelFull} from "./spell-meta.js";

const FULL_CASTER_SLOTS = [
	[],
	[2],
	[3],
	[4, 2],
	[4, 3],
	[4, 3, 2],
	[4, 3, 3],
	[4, 3, 3, 1],
	[4, 3, 3, 2],
	[4, 3, 3, 3, 1],
	[4, 3, 3, 3, 2],
	[4, 3, 3, 3, 2, 1],
	[4, 3, 3, 3, 2, 1],
	[4, 3, 3, 3, 2, 1, 1],
	[4, 3, 3, 3, 2, 1, 1],
	[4, 3, 3, 3, 2, 1, 1, 1],
	[4, 3, 3, 3, 2, 1, 1, 1],
	[4, 3, 3, 3, 2, 1, 1, 1, 1],
	[4, 3, 3, 3, 3, 1, 1, 1, 1],
	[4, 3, 3, 3, 3, 2, 1, 1, 1],
	[4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const HALF_CASTER_SLOTS = [
	[],
	[],
	[2],
	[3],
	[3],
	[4, 2],
	[4, 2],
	[4, 3],
	[4, 3],
	[4, 3, 2],
	[4, 3, 2],
	[4, 3, 3],
	[4, 3, 3],
	[4, 3, 3, 1],
	[4, 3, 3, 1],
	[4, 3, 3, 2],
	[4, 3, 3, 2],
	[4, 3, 3, 3, 1],
	[4, 3, 3, 3, 1],
	[4, 3, 3, 3, 2],
	[4, 3, 3, 3, 2],
];

const THIRD_CASTER_SLOTS = [
	[],
	[],
	[],
	[2],
	[3],
	[3],
	[3],
	[4, 2],
	[4, 2],
	[4, 2],
	[4, 3],
	[4, 3],
	[4, 3],
	[4, 3, 2],
	[4, 3, 2],
	[4, 3, 2],
	[4, 3, 3],
	[4, 3, 3],
	[4, 3, 3],
	[4, 3, 3, 1],
	[4, 3, 3, 1],
];

const PACT_SLOTS = [
	[],
	[1],
	[2],
	[2],
	[2],
	[2],
	[2],
	[2],
	[2],
	[2],
	[2],
	[3],
	[3],
	[3],
	[3],
	[3],
	[3],
	[4],
	[4],
	[4],
	[4],
];

const PACT_LEVEL = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];

/**
 * Primary casting class from a character record (first class token).
 */
export function castingClassFromRecord (record) {
	const edition = record?.snapshot?.edition === "one" ? "one" : "classic";
	const level = Math.max(1, Number(record?.fields?.level) || 1);
	const fromRef = (record?.snapshot?.refs || []).find(ref => ref?.kind === "class");
	const raw = String(record?.fields?.classes || fromRef?.name || "").trim();
	const match = raw.match(/^([^(]+?)(?:\s+(\d+))?(?:\s*\(|$)/);
	const name = String(match?.[1] || fromRef?.name || "").trim();
	const classLevel = Number(match?.[2]) || level;
	if (!name) return null;
	return {name, level: classLevel, edition};
}

export async function loadCasterProfile (plugin, record) {
	await ensureSearchIndex(plugin);
	const info = castingClassFromRecord(record);
	if (!info) return null;
	const doc = findEditionDoc(info.name, {categoriesExact: ["class"], edition: info.edition});
	if (!doc) return null;
	const {ent} = await loadEntity(doc);
	if (!ent || !ent.casterProgression && !ent.spellcastingAbility && !ent.cantripProgression) {
		return null;
	}
	const level = Math.min(20, Math.max(1, info.level));
	const cantripsMax = Number(ent.cantripProgression?.[level - 1]) || 0;
	const preparedMax = Array.isArray(ent.preparedSpellsProgression)
		? Number(ent.preparedSpellsProgression[level - 1]) || 0
		: 0;
	const knownMax = Array.isArray(ent.spellsKnownProgression)
		? Number(ent.spellsKnownProgression[level - 1]) || 0
		: knownFromFixed(ent, level);
	const mode = preparedMax > 0 ? "prepared" : (knownMax > 0 ? "known" : (cantripsMax > 0 ? "prepared" : null));
	if (!mode && !cantripsMax) return null;
	const progression = String(ent.casterProgression || "").toLowerCase();
	const slots = slotRowsFor(progression, level);
	const maxLevel = maxSlotLevel(slots);
	return {
		className: ent.name || info.name,
		classSource: ent.source || doc.s,
		level,
		edition: info.edition,
		ability: ent.spellcastingAbility || "",
		mode: mode || "prepared",
		cantripsMax,
		preparedMax,
		knownMax: mode === "known" ? knownMax : 0,
		progression,
		slots,
		maxLevel,
		ent,
	};
}

function knownFromFixed (ent, level) {
	const fixed = ent.spellsKnownProgressionFixed;
	if (!Array.isArray(fixed) || !fixed.length) return 0;
	let total = 0;
	for (let i = 0; i < level && i < fixed.length; i++) total += Number(fixed[i]) || 0;
	return total;
}

export function slotRowsFor (progression, level) {
	const lv = Math.min(20, Math.max(0, level));
	if (progression === "pact") {
		const count = PACT_SLOTS[lv]?.[0] || 0;
		const slotLevel = PACT_LEVEL[lv] || 1;
		return count ? [{level: slotLevel, max: count, spent: 0, pact: true}] : [];
	}
	const table = progression === "1/2" || progression === "half"
		? HALF_CASTER_SLOTS
		: progression === "1/3" || progression === "third"
			? THIRD_CASTER_SLOTS
			: FULL_CASTER_SLOTS;
	const counts = table[lv] || [];
	return counts
		.map((max, index) => ({level: index + 1, max: Number(max) || 0, spent: 0}))
		.filter(slot => slot.max > 0);
}

function maxSlotLevel (slots) {
	let max = 0;
	for (const slot of slots || []) {
		if ((Number(slot.max) || 0) > 0) max = Math.max(max, Number(slot.level) || 0);
	}
	return max;
}

export function spellCounts (record) {
	const refs = (record?.snapshot?.refs || []).filter(ref => ref?.kind === "spell");
	const play = record?.snapshot?.play || {};
	const preparedSet = new Set(play.prepared || []);
	let cantrips = 0;
	let knownLeveled = 0;
	let prepared = 0;
	for (const ref of refs) {
		const level = Number(ref.level);
		const name = String(ref.name || ref.label || "").trim();
		if (level === 0) {
			cantrips += 1;
			continue;
		}
		knownLeveled += 1;
		if (ref.alwaysPrepared || preparedSet.has(name)) prepared += 1;
	}
	return {cantrips, knownLeveled, prepared, total: refs.length};
}

export function capsSummary (profile, counts) {
	if (!profile) return "";
	const parts = [];
	if (profile.cantripsMax) parts.push(`Cantrips ${counts.cantrips}/${profile.cantripsMax}`);
	if (profile.mode === "prepared" && profile.preparedMax) {
		parts.push(`Prepared ${counts.prepared}/${profile.preparedMax}`);
		parts.push(`In list ${counts.knownLeveled}`);
	} else if (profile.mode === "known" && profile.knownMax) {
		parts.push(`Known ${counts.knownLeveled}/${profile.knownMax}`);
	}
	return parts.join(" · ");
}

export async function listClassSpellDocs (plugin, profile, {query = ""} = {}) {
	if (!profile) return [];
	await ensureSearchIndex(plugin);
	await loadSpellMeta(plugin);
	const classKey = String(profile.className || "").toLowerCase();
	const docs = listEntities({
		categoriesExact: ["spell"],
		query,
		spellFilters: {classes: [classKey], levels: []},
	});
	const edition = profile.edition === "one" ? "one" : "classic";
	const Parser = getParser();
	const modern = new Set([Parser.SRC_XPHB, Parser.SRC_XDMG, Parser.SRC_XMM].filter(Boolean));
	const byName = new Map();
	for (const doc of docs) {
		const meta = getSpellMeta(doc);
		const level = meta?.level;
		if (level == null) continue;
		if (level > 0 && profile.maxLevel > 0 && level > profile.maxLevel) continue;
		const name = String(doc.n || "").toLowerCase();
		const preferModern = edition === "one";
		const isModern = modern.has(doc.s);
		const prev = byName.get(name);
		if (!prev) {
			byName.set(name, doc);
			continue;
		}
		const prevModern = modern.has(prev.s);
		if (preferModern && isModern && !prevModern) byName.set(name, doc);
		else if (!preferModern && !isModern && prevModern) byName.set(name, doc);
	}
	return [...byName.values()].sort((a, b) => {
		const la = getSpellMeta(a)?.level ?? 99;
		const lb = getSpellMeta(b)?.level ?? 99;
		return la - lb || String(a.n || "").localeCompare(String(b.n || ""));
	});
}

export async function spellRefFromDoc (doc, {listName = "", edition = "one"} = {}) {
	const {ent} = await loadEntity(doc);
	if (!ent?.name) return null;
	return spellRefFromEntity(ent, {listName, edition});
}

export function spellRefFromEntity (ent, {listName = "", edition = "one"} = {}) {
	const Parser = getParser();
	const level = Number(ent.level) || 0;
	const school = Parser.spSchoolAbvToFull?.(ent.school) || ent.school || "";
	const castingTime = Array.isArray(ent.time)
		? ent.time.map(t => Parser.getTimeToFull?.(t) || `${t.number || ""} ${t.unit || ""}`.trim()).filter(Boolean).join(" or ")
		: "";
	const range = Parser.spRangeToFull?.(ent.range) || "";
	const duration = Parser.spDurationToFull?.(ent.duration) || "";
	const components = Parser.spComponentsToFull?.(ent.components, level) || componentsFallback(ent.components);
	const concentration = Array.isArray(ent.duration) && ent.duration.some(d => d?.concentration);
	const ritual = !!(ent.meta?.ritual || ent.ritual);
	const snippet = firstSnippet(ent);
	return {
		kind: "spell",
		name: ent.name,
		label: ent.name,
		edition: edition === "one" ? "one" : "classic",
		level,
		...(school ? {school} : {}),
		...(castingTime ? {castingTime} : {}),
		...(range ? {range} : {}),
		...(duration ? {duration} : {}),
		...(components ? {components} : {}),
		...(concentration ? {concentration: true} : {}),
		...(ritual ? {ritual: true} : {}),
		...(snippet ? {snippet} : {}),
		...(listName ? {list: listName} : {}),
	};
}

function componentsFallback (components) {
	if (!components || typeof components !== "object") return "";
	const parts = [];
	if (components.v) parts.push("V");
	if (components.s) parts.push("S");
	if (components.m) parts.push("M");
	return parts.join(", ");
}

function firstSnippet (ent) {
	const entry = ent?.entries?.[0];
	if (typeof entry === "string") return entry.replace(/\{@[^}]+\}/g, "").slice(0, 160);
	return "";
}

export function mergeSlotSpent (nextSlots, previousSlots) {
	const prev = new Map((previousSlots || []).map(slot => [`${slot.level}:${slot.pact ? "pact" : "slot"}`, slot]));
	return (nextSlots || []).map((slot) => {
		const old = prev.get(`${slot.level}:${slot.pact ? "pact" : "slot"}`);
		const spent = Math.max(0, Math.min(Number(slot.max) || 0, Number(old?.spent) || 0));
		return {...slot, spent};
	});
}

export function recordToCard (record) {
	const fields = record?.fields || {};
	const snap = record?.snapshot || {};
	const play = snap.play || {};
	return {
		ddbId: String(fields.ddb_id || "").trim(),
		name: fields.name || "Unnamed",
		species: fields.species || "",
		classes: fields.classes || "",
		level: fields.level ?? "",
		background: fields.background || "",
		ac: fields.ac ?? "",
		hpMax: play.hpMax ?? fields.hp_max ?? null,
		hpCurrent: play.hpCurrent ?? fields.hp_current ?? null,
		tempHp: play.tempHp ?? 0,
		speed: fields.speed ?? "",
		abilities: snap.abilities || null,
		edition: snap.edition || "classic",
		refs: (snap.refs || []).map(ref => ({...ref})),
		traits: snap.traits || null,
		rolls: snap.rolls || null,
		actions: snap.actions || [],
		slots: (snap.slots || []).map(slot => ({...slot})),
		coins: play.coins || snap.coins || {},
		conditions: play.conditions || [],
		deathSaves: play.deathSaves || {success: 0, fail: 0, stable: false},
		inspiration: !!play.inspiration,
		xp: play.xp ?? null,
		xpAdjustment: snap.xpAdjustment ?? null,
		senses: snap.senses || [],
		speeds: snap.speeds || [],
		defenses: snap.defenses || [],
		proficiencies: snap.proficiencies || [],
		spellcasting: snap.spellcasting || [],
		hitDice: snap.hitDice || [],
		choices: snap.choices || [],
		features: snap.features || [],
		companions: snap.companions || [],
		story: snap.story || null,
		avatar: null,
	};
}

export function levelLabel (level) {
	return spellLevelFull(level) || (level === 0 ? "Cantrip" : `Level ${level}`);
}

export function canLearnSpell (profile, counts, level) {
	if (!profile) return false;
	const lvl = Number(level) || 0;
	if (lvl === 0) return counts.cantrips < (profile.cantripsMax || 0);
	if (profile.mode === "known") return counts.knownLeveled < (profile.knownMax || 0);
	// prepared casters: spellbook/list size is soft; allow adds (prepare cap is separate)
	return true;
}

export function canPrepareSpell (profile, counts) {
	if (!profile || profile.mode !== "prepared") return false;
	return counts.prepared < (profile.preparedMax || 0);
}
