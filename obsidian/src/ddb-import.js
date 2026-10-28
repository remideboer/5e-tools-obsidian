import {requestUrl} from "obsidian";
import {DEFAULT_SETTINGS} from "./constants.js";

const ABILITIES = [
	{key: "str", id: 1, subType: "strength-score"},
	{key: "dex", id: 2, subType: "dexterity-score"},
	{key: "con", id: 3, subType: "constitution-score"},
	{key: "int", id: 4, subType: "intelligence-score"},
	{key: "wis", id: 5, subType: "wisdom-score"},
	{key: "cha", id: 6, subType: "charisma-score"},
];

export function extractDdbId (input) {
	const text = String(input || "").trim();
	const fromUrl = text.match(/\/characters\/(\d+)/i);
	if (fromUrl) return fromUrl[1];
	return /^\d+$/.test(text) ? text : "";
}

export function ddbProxyBase (plugin) {
	const raw = String(plugin?.settings?.ddbProxyUrl || DEFAULT_SETTINGS.ddbProxyUrl || "").trim();
	return (raw || DEFAULT_SETTINGS.ddbProxyUrl).replace(/\/+$/, "");
}

/** Public character only. Returns a slim card; `avatar` is `{bytes, ext}` or null. */
export async function importDdbCharacter (plugin, idOrUrl) {
	const id = extractDdbId(idOrUrl);
	if (!id) throw new Error("Enter a D&D Beyond character URL or numeric id.");
	const payload = await fetchCharacterPayload(plugin, id);
	const card = mapDdbCharacter(payload, id);
	card.avatar = await fetchAvatar(plugin, payload?.data);
	return card;
}

export function mapDdbCharacter (payload, requestedId) {
	const char = payload?.data;
	if (!char || typeof char !== "object") {
		throw new Error("Unexpected D&D Beyond response. Is the character set to Public?");
	}
	const abilities = abilityScores(char);
	const classes = Array.isArray(char.classes) ? char.classes : [];
	const level = classes.reduce((sum, cl) => sum + (Number(cl?.level) || 0), 0) || 1;
	const conMod = modifier(abilities.con);
	const hp = hitPoints(char, conMod, level);
	const speeds = characterSpeeds(char);
	const walk = speeds.find(it => it.label === "Walk");
	const edition = characterEdition(char);
	const choices = characterChoices(char);
	return {
		ddbId: String(char.id || requestedId || ""),
		name: String(char.name || "Unnamed").trim() || "Unnamed",
		species: String(char.race?.fullName || char.race?.baseName || "").trim(),
		classes: classes.map(classLabel).filter(Boolean).join(" / "),
		level,
		background: String(char.background?.definition?.name || "").trim(),
		ac: armorClass(char, abilities),
		hpMax: hp.max,
		hpCurrent: hp.current,
		tempHp: hp.temp,
		speed: walk ? walk.value : null,
		abilities,
		edition,
		refs: characterRefs(char, edition, choices.feats),
		traits: characterTraits(char),
		rolls: characterRolls(char, abilities, level),
		actions: characterActions(char),
		slots: spellSlotRows(char),
		coins: char.currencies || {},
		conditions: characterConditions(char),
		deathSaves: characterDeathSaves(char),
		inspiration: !!char.inspiration,
		xp: finiteOrNull(char.currentXp),
		xpAdjustment: finiteOrNull(char.adjustmentXp),
		senses: characterSenses(char),
		speeds,
		defenses: characterDefenses(char),
		proficiencies: characterProficiencies(char),
		spellcasting: spellcastingLines(char, abilities, level),
		hitDice: characterHitDice(char),
		choices: choices.labels,
		features: characterFeatures(char),
		companions: characterCompanions(char),
		story: characterStory(char),
		avatar: null,
	};
}

async function fetchCharacterPayload (plugin, id) {
	const url = `${ddbProxyBase(plugin)}/?id=${encodeURIComponent(id)}`;
	const {ok, status, body} = await requestJson(url);
	if (!ok) throw new Error(proxyErrorMessage(status, body));
	if (!body?.data) throw new Error("Unexpected D&D Beyond response. Is the character set to Public?");
	return body;
}

async function fetchAvatar (plugin, char) {
	const remote = avatarSourceUrl(char);
	if (!isDdbImageUrl(remote)) return null;
	try {
		const res = await requestUrl({
			url: `${ddbProxyBase(plugin)}/?img=${encodeURIComponent(remote)}`,
			headers: {Accept: "image/*"},
		});
		if (res.status && res.status >= 400) return null;
		const type = headerValue(res.headers, "content-type").split(";")[0].trim().toLowerCase();
		if (!type.startsWith("image/")) return null;
		const bytes = new Uint8Array(res.arrayBuffer);
		if (!bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024) return null;
		return {bytes, ext: extensionForImage(type)};
	} catch (_) {
		return null;
	}
}

function avatarSourceUrl (char) {
	const dec = char?.decorations || {};
	return dec.avatarUrl
		|| dec.thumbnailBackdropAvatarUrl
		|| dec.defaultBackdrop?.thumbnailBackdropAvatarUrl
		|| "";
}

function isDdbImageUrl (raw) {
	try {
		const url = new URL(raw);
		const host = url.hostname.toLowerCase();
		return url.protocol === "https:" && (host === "dndbeyond.com" || host.endsWith(".dndbeyond.com"));
	} catch (_) {
		return false;
	}
}

function extensionForImage (type) {
	if (type === "image/png") return ".png";
	if (type === "image/jpeg" || type === "image/jpg") return ".jpg";
	if (type === "image/gif") return ".gif";
	return ".webp";
}

function abilityScores (char) {
	const subTypeToId = Object.fromEntries(ABILITIES.map(it => [it.subType, it.id]));
	const lists = ["class", "race", "background", "feat", "item"];
	const modBonuses = lists.flatMap(key => char.modifiers?.[key] || [])
		.filter(mod => mod?.type === "bonus" && subTypeToId[mod.subType] != null && mod.value != null)
		.map(mod => ({id: subTypeToId[mod.subType], value: Number(mod.value) || 0}));
	const bonusStats = [...(char.bonusStats || []).filter(it => it?.value != null), ...modBonuses];
	const stats = char.stats || [];
	const overrides = char.overrideStats || [];
	const score = (id) => {
		const base = stats.find(it => it?.id === id)?.value ?? 10;
		const override = overrides.find(it => it?.id === id)?.value;
		if (override != null) return Number(override) || 0;
		const bonus = bonusStats.filter(it => it.id === id).reduce((sum, it) => sum + (Number(it.value) || 0), 0);
		return (Number(base) || 0) + bonus;
	};
	const out = {};
	for (const ability of ABILITIES) out[ability.key] = score(ability.id);
	return out;
}

function hitPoints (char, conMod, level) {
	let max = null;
	if (char.overrideHitPoints != null) max = Number(char.overrideHitPoints) || 0;
	else if (char.baseHitPoints != null) {
		max = (Number(char.baseHitPoints) || 0) + (Number(char.bonusHitPoints) || 0) + conMod * level;
	}
	if (max == null) return {max: null, current: null, temp: 0};
	const removed = Number(char.removedHitPoints) || 0;
	return {
		max,
		current: Math.max(0, max - removed),
		temp: Math.max(0, Number(char.temporaryHitPoints) || 0),
	};
}

function armorClass (char, abilities) {
	const dex = modifier(abilities.dex);
	const equipped = (Array.isArray(char.inventory) ? char.inventory : [])
		.filter(item => item?.equipped && item.definition);
	const armor = equipped.find(item => isWornArmor(item.definition));
	const shield = equipped.find(item => isShield(item.definition));
	const mods = modifierLists(char).filter(isArmorClassMod);
	const worn = mods.filter(mod => !isUnarmored(mod));
	const unarmored = mods.filter(isUnarmored);
	let ac;
	if (armor) {
		ac = (Number(armor.definition.armorClass) || 0) + dexForArmor(armor.definition.armorTypeId, dex) + magicBonus(armor.definition.name);
		ac += acModifierTotal(worn, abilities);
	} else if (unarmored.length) {
		ac = unarmoredAc(unarmored, abilities) + acModifierTotal(worn, abilities);
	} else {
		ac = 10 + dex + acModifierTotal(worn, abilities);
	}
	if (shield) ac += 2 + magicBonus(shield.definition.name);
	return ac;
}

function isArmorClassMod (mod) {
	const sub = String(mod?.subType || "");
	return sub === "armor-class" || sub === "ac" || sub === "unarmored-armor-class";
}

function isUnarmored (mod) {
	return mod?.subType === "unarmored-armor-class";
}

function acModifierTotal (mods, abilities) {
	let total = 0;
	for (const mod of mods) {
		if (mod?.type !== "bonus") continue;
		if (mod.statId) total += modifier(abilityById(abilities, mod.statId));
		else if (mod.value != null) total += Number(mod.value) || 0;
	}
	return total;
}

function unarmoredAc (mods, abilities) {
	let base = 10;
	let extra = 0;
	let namedDex = false;
	for (const mod of mods) {
		if (Number(mod?.statId) === 2) namedDex = true;
		if (mod?.statId) extra += modifier(abilityById(abilities, mod.statId));
		else if (mod?.type === "set" && mod.value != null) base = Number(mod.value) || 0;
		else if (mod?.value != null) extra += Number(mod.value) || 0;
	}
	if (!namedDex) extra += modifier(abilities.dex);
	return base + extra;
}

function abilityById (abilities, id) {
	const key = ABILITIES.find(it => it.id === Number(id))?.key;
	return key ? abilities[key] : 10;
}

function isWornArmor (def) {
	const id = def?.armorTypeId;
	return id === 1 || id === 2 || id === 3;
}

function isShield (def) {
	return def?.armorTypeId === 4 || /\bshield\b/i.test(def?.name || "");
}

function dexForArmor (typeId, dexMod) {
	if (typeId === 3) return 0;
	if (typeId === 2) return Math.min(dexMod, 2);
	return dexMod;
}

function magicBonus (name) {
	const match = String(name || "").match(/^\+(\d+)\b/);
	return match ? Number(match[1]) : 0;
}

function classLabel (cl) {
	const name = String(cl?.definition?.name || "").trim();
	if (!name) return "";
	const level = Number(cl?.level) || 0;
	const sub = String(cl?.subclassDefinition?.name || "").trim();
	const core = `${name} ${level}`.trim();
	return sub ? `${core} (${sub})` : core;
}

function characterEdition (char) {
	if (char.race?.isLegacy === true) return "classic";
	if (char.race?.isLegacy === false) return "one";
	let legacy = 0;
	let modern = 0;
	for (const def of spellDefs(char)) {
		if (def.isLegacy === true) legacy += 1;
		else if (def.isLegacy === false) modern += 1;
	}
	if (legacy && !modern) return "classic";
	if (modern && !legacy) return "one";
	return legacy >= modern ? "classic" : "one";
}

function entryEdition (isLegacy, edition, {item = false} = {}) {
	if (item) return isLegacy === true ? "classic" : edition;
	if (isLegacy === true) return "classic";
	if (isLegacy === false) return "one";
	return edition;
}

function characterRefs (char, edition, extraFeats = []) {
	const refs = [];
	const species = String(char.race?.fullName || char.race?.baseName || "").trim();
	const baseRace = String(char.race?.baseName || char.race?.baseRaceName || "").trim();
	if (species) {
		refs.push({
			kind: "species",
			name: species,
			label: species,
			alt: baseRace && baseRace.toLowerCase() !== species.toLowerCase() ? baseRace : "",
			edition: entryEdition(char.race?.isLegacy, edition),
		});
	}
	for (const cl of Array.isArray(char.classes) ? char.classes : []) {
		const name = String(cl?.definition?.name || "").trim();
		if (name) {
			const level = Number(cl?.level) || 0;
			refs.push({
				kind: "class",
				name,
				label: level ? `${name} ${level}` : name,
				edition: entryEdition(cl?.definition?.isLegacy, edition),
			});
		}
		const sub = String(cl?.subclassDefinition?.name || "").trim();
		if (sub) {
			refs.push({
				kind: "subclass",
				name: sub,
				label: sub,
				alt: name ? `${sub} (${name})` : "",
				edition: entryEdition(cl?.subclassDefinition?.isLegacy, edition),
			});
		}
	}
	const background = String(char.background?.definition?.name || "").trim();
	if (background) {
		refs.push({
			kind: "background",
			name: background,
			label: background,
			edition: entryEdition(char.background?.definition?.isLegacy, edition),
		});
	}
	for (const feat of featEntries(char, extraFeats)) {
		refs.push({
			kind: "feat",
			name: feat.name,
			label: feat.name,
			edition: entryEdition(feat.isLegacy, edition),
		});
	}
	const gear = gearEntries(char);
	gear.sort((a, b) => Number(b.equipped) - Number(a.equipped) || a.label.localeCompare(b.label));
	for (const item of gear) {
		refs.push({
			kind: "item",
			name: item.label,
			label: item.label,
			alts: item.alts,
			edition: entryEdition(item.isLegacy, edition, {item: true}),
			qty: item.qty,
			equipped: item.equipped,
			attunable: !!item.attunable,
			...(item.attuned ? {attuned: true} : {}),
			...(item.rarity ? {rarity: item.rarity} : {}),
			...(item.weight ? {weight: item.weight} : {}),
			...(item.charges ? {charges: item.charges} : {}),
			...(item.snippet ? {snippet: item.snippet} : {}),
		});
	}
	const spells = spellDefs(char);
	spells.sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.name.localeCompare(b.name));
	for (const spell of spells) {
		refs.push({
			kind: "spell",
			name: spell.name,
			label: spell.name,
			edition: entryEdition(spell.isLegacy, edition),
			...(Number.isFinite(Number(spell.level)) ? {level: Number(spell.level)} : {}),
			...(spell.school ? {school: spell.school} : {}),
			...(spell.castingTime ? {castingTime: spell.castingTime} : {}),
			...(spell.range ? {range: spell.range} : {}),
			...(spell.duration ? {duration: spell.duration} : {}),
			...(spell.components ? {components: spell.components} : {}),
			...(spell.concentration ? {concentration: true} : {}),
			...(spell.ritual ? {ritual: true} : {}),
			...(spell.attack ? {attack: spell.attack} : {}),
			...(spell.save ? {save: spell.save} : {}),
			...(spell.prepared ? {prepared: true} : {}),
			...(spell.alwaysPrepared ? {alwaysPrepared: true} : {}),
			...(spell.list ? {list: spell.list} : {}),
		});
	}
	return refs;
}

function featEntries (char, extraFeats = []) {
	const out = [];
	const seen = new Set();
	const push = (entry) => {
		const def = entry?.definition || entry;
		const name = String(def?.name || "").trim();
		if (!name) return;
		const key = name.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		out.push({name, isLegacy: def?.isLegacy});
	};
	for (const feat of char.feats || []) push(feat);
	for (const feat of char.options?.feat || []) push(feat);
	for (const name of extraFeats) push({name});
	return out;
}

function gearEntries (char) {
	const out = [];
	const seen = new Set();
	const push = (item, def, label) => {
		const key = label.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		const alts = [];
		const comma = label.match(/^(.+),\s*(.+)$/);
		if (comma) alts.push(`${comma[2]} ${comma[1]}`.trim());
		if (isWornArmor(def) && !/armor$/i.test(label)) alts.push(`${label} Armor`);
		const bare = label.replace(/^\+\d+\s+/, "").trim();
		if (bare && bare.toLowerCase() !== label.toLowerCase()) alts.push(bare);
		const weight = Number(def?.weight);
		const charges = Number(item?.limitedUse?.maxUses ?? def?.limitedUse?.maxUses);
		const snippet = oneLine(def?.snippet || item?.description || def?.description || "");
		out.push({
			label,
			alts,
			qty: Math.max(1, Number(item?.quantity) || 1),
			equipped: !!item?.equipped,
			isLegacy: def?.isLegacy,
			attunable: itemCanAttune(item, def),
			...(item?.isAttuned ? {attuned: true} : {}),
			...(def?.rarity ? {rarity: String(def.rarity).trim()} : {}),
			...(weight > 0 ? {weight} : {}),
			...(charges > 0 ? {charges} : {}),
			...(snippet ? {snippet} : {}),
		});
	};
	for (const item of Array.isArray(char.inventory) ? char.inventory : []) {
		const def = item?.definition;
		const label = String(def?.name || "").trim();
		if (!label) continue;
		push(item, def, label);
	}
	for (const item of char.customItems || []) {
		const def = item?.definition || item;
		const label = String(def?.name || item?.name || "").trim();
		if (!label) continue;
		push(item, def, label);
	}
	return out;
}

function itemCanAttune (item, def) {
	if (item?.isAttuned) return true;
	if (def?.canAttune) return true;
	if (def?.requiresAttunement) return true;
	const blobs = [
		def?.attunementDescription,
		def?.attunement?.description,
		typeof def?.attunement === "string" ? def.attunement : "",
		def?.filterType,
	];
	for (const filter of Array.isArray(def?.filters) ? def.filters : []) blobs.push(filter?.name || filter);
	return blobs.some(value => /attun/i.test(String(value || "")));
}

function spellDefs (char) {
	return spellEntries(char);
}

function spellEntries (char) {
	const byName = new Map();
	const put = (entry, listName) => {
		const def = entry?.definition || entry;
		const name = String(def?.name || "").trim();
		if (!name) return;
		const key = name.toLowerCase();
		const row = spellRow(entry, def, listName);
		const prev = byName.get(key);
		if (!prev) {
			byName.set(key, row);
			return;
		}
		if (!prev.list && row.list) prev.list = row.list;
		if (row.prepared) prev.prepared = true;
		if (row.alwaysPrepared) prev.alwaysPrepared = true;
		if (row.concentration) prev.concentration = true;
		if (row.ritual) prev.ritual = true;
		if (prev.level == null && row.level != null) prev.level = row.level;
		if (prev.isLegacy == null && row.isLegacy != null) prev.isLegacy = row.isLegacy;
		for (const field of ["school", "castingTime", "range", "duration", "components", "attack", "save"]) {
			if (!prev[field] && row[field]) prev[field] = row[field];
		}
	};
	for (const block of char.classSpells || []) {
		const listName = classNameForSpellBlock(char, block);
		for (const spell of block?.spells || []) put(spell, listName);
	}
	const spells = char.spells || {};
	for (const key of ["class", "race", "feat", "item", "background"]) {
		const label = key === "class" ? "" : titleSub(key);
		for (const spell of spells[key] || []) put(spell, label);
	}
	return [...byName.values()];
}

function classNameForSpellBlock (char, block) {
	const id = block?.characterClassId ?? block?.classId;
	if (id == null) return "";
	const match = (char.classes || []).find(cl => cl?.id === id || cl?.definition?.id === id);
	return String(match?.definition?.name || "").trim();
}

function spellRow (entry, def, listName) {
	const level = Number(def?.level);
	const school = spellSchool(def?.school);
	const castingTime = String(def?.castingTimeDescription || activationLabel(def?.activation) || "").trim();
	const range = spellRange(def);
	const duration = spellDuration(def);
	const components = spellComponents(def);
	const attack = def?.requiresAttackRoll ? "spell attack" : "";
	const save = def?.requiresSavingThrow ? spellSave(def) : "";
	return {
		name: String(def.name).trim(),
		isLegacy: def?.isLegacy,
		...(Number.isFinite(level) ? {level} : {}),
		...(school ? {school} : {}),
		...(castingTime ? {castingTime} : {}),
		...(range ? {range} : {}),
		...(duration ? {duration} : {}),
		...(components ? {components} : {}),
		...(def?.concentration ? {concentration: true} : {}),
		...(def?.ritual ? {ritual: true} : {}),
		...(attack ? {attack} : {}),
		...(save ? {save} : {}),
		...(entry?.prepared ? {prepared: true} : {}),
		...(entry?.alwaysPrepared ? {alwaysPrepared: true} : {}),
		...(listName ? {list: listName} : {}),
	};
}

function spellSchool (school) {
	if (!school) return "";
	if (typeof school === "string") return school.trim();
	return String(school.name || "").trim();
}

function spellRange (def) {
	if (typeof def?.rangeArea === "string" && def.rangeArea.trim()) return def.rangeArea.trim();
	const range = def?.range;
	if (!range) return "";
	if (typeof range === "string") return range.trim();
	const origin = String(range.origin || "");
	const value = Number(range.rangeValue);
	const aoe = range.aoeValue ? `${range.aoeValue} ft ${range.aoeType || ""}`.trim() : "";
	if (/touch/i.test(origin)) return aoe ? `Touch (${aoe})` : "Touch";
	if (/self/i.test(origin) && !(value > 0)) return aoe ? `Self (${aoe})` : "Self";
	if (value > 0) return aoe ? `${value} ft (${aoe})` : `${value} ft`;
	return origin || aoe;
}

function spellDuration (def) {
	const duration = def?.duration;
	if (!duration) return "";
	if (typeof duration === "string") return duration.trim();
	const type = String(duration.durationType || "");
	if (/instant/i.test(type)) return "Instantaneous";
	if (/dispel/i.test(type)) return "Until dispelled";
	const n = Number(duration.durationInterval) || 0;
	const unit = String(duration.durationUnit || "").trim();
	if (n && unit) {
		const name = unit.toLowerCase();
		return n === 1 || name.endsWith("s") ? `${n} ${name}` : `${n} ${name}s`;
	}
	return type;
}

function spellComponents (def) {
	const parts = [];
	for (const part of def?.components || []) {
		const id = typeof part === "number" ? part : Number(part?.id ?? part?.componentType);
		const name = typeof part === "string" ? part : String(part?.name || "");
		if (id === 1 || /verbal/i.test(name)) parts.push("V");
		else if (id === 2 || /somatic/i.test(name)) parts.push("S");
		else if (id === 3 || /material/i.test(name)) parts.push("M");
	}
	const unique = [...new Set(parts)];
	if (unique.length) return unique.join(", ");
	return String(def?.componentsDescription || "").replace(/\s+/g, " ").trim();
}

function spellSave (def) {
	const ability = ABILITY_NAME[Number(def?.saveDcAbilityId)];
	return ability ? `${ability} save` : "save";
}

const SAVES = [
	{key: "str", sub: "strength-saving-throws", label: "Strength"},
	{key: "dex", sub: "dexterity-saving-throws", label: "Dexterity"},
	{key: "con", sub: "constitution-saving-throws", label: "Constitution"},
	{key: "int", sub: "intelligence-saving-throws", label: "Intelligence"},
	{key: "wis", sub: "wisdom-saving-throws", label: "Wisdom"},
	{key: "cha", sub: "charisma-saving-throws", label: "Charisma"},
];

const SKILLS = [
	{name: "Athletics", ability: "str", sub: "athletics"},
	{name: "Acrobatics", ability: "dex", sub: "acrobatics"},
	{name: "Sleight of Hand", ability: "dex", sub: "sleight-of-hand"},
	{name: "Stealth", ability: "dex", sub: "stealth"},
	{name: "Arcana", ability: "int", sub: "arcana"},
	{name: "History", ability: "int", sub: "history"},
	{name: "Investigation", ability: "int", sub: "investigation"},
	{name: "Nature", ability: "int", sub: "nature"},
	{name: "Religion", ability: "int", sub: "religion"},
	{name: "Animal Handling", ability: "wis", sub: "animal-handling"},
	{name: "Insight", ability: "wis", sub: "insight"},
	{name: "Medicine", ability: "wis", sub: "medicine"},
	{name: "Perception", ability: "wis", sub: "perception"},
	{name: "Survival", ability: "wis", sub: "survival"},
	{name: "Deception", ability: "cha", sub: "deception"},
	{name: "Intimidation", ability: "cha", sub: "intimidation"},
	{name: "Performance", ability: "cha", sub: "performance"},
	{name: "Persuasion", ability: "cha", sub: "persuasion"},
];

function characterRolls (char, abilities, level) {
	const prof = 2 + Math.floor((Math.max(1, level) - 1) / 4);
	const mods = modifierLists(char);
	const bonus = (subType) => mods
		.filter(mod => mod?.type === "bonus" && mod.subType === subType && mod.value != null)
		.reduce((sum, mod) => sum + (Number(mod.value) || 0), 0);
	const skills = SKILLS.map(skill => {
		const mult = skillProficiency(mods, skill.sub);
		const half = mult === 0 && hasHalfProf(mods, skill.sub);
		const edge = rollEdge(mods, skill.sub);
		return {
			name: skill.name,
			ability: skill.ability,
			mod: modifier(abilities[skill.ability]) + mult * prof + (half ? Math.floor(prof / 2) : 0) + bonus(skill.sub),
			proficient: mult >= 1,
			...(mult >= 2 ? {expertise: true} : {}),
			...(half ? {half: true} : {}),
			...(edge ? {edge} : {}),
		};
	});
	const perception = skills.find(skill => skill.name === "Perception");
	const perceptionEdge = perception?.edge || "";
	const initiativeEdge = rollEdge(mods, "initiative");
	const initiativeHalf = hasHalfProf(mods, "initiative");
	return {
		proficiency: prof,
		initiative: modifier(abilities.dex) + bonus("initiative") + (initiativeHalf ? Math.floor(prof / 2) : 0),
		...(initiativeEdge ? {initiativeEdge} : {}),
		passivePerception: 10 + (perception?.mod || 0) + (perceptionEdge === "adv" ? 5 : perceptionEdge === "dis" ? -5 : 0),
		saves: SAVES.map(save => {
			const mult = skillProficiency(mods, save.sub, laterClassProficiencyIds(char));
			const half = mult === 0 && hasHalfProf(mods, save.sub);
			const edge = rollEdge(mods, save.sub);
			return {
				key: save.key,
				label: save.label,
				mod: modifier(abilities[save.key]) + mult * prof + (half ? Math.floor(prof / 2) : 0) + bonus(save.sub),
				proficient: mult >= 1,
				...(half ? {half: true} : {}),
				...(edge ? {edge} : {}),
			};
		}),
		skills,
	};
}

function rollEdge (mods, subType) {
	const match = (mod) => {
		const sub = mod?.subType || "";
		return sub === subType || sub === "ability-checks";
	};
	const adv = mods.some(mod => mod?.type === "advantage" && match(mod));
	const dis = mods.some(mod => mod?.type === "disadvantage" && match(mod));
	if (adv && !dis) return "adv";
	if (dis && !adv) return "dis";
	return "";
}

function hasHalfProf (mods, subType) {
	return mods.some(mod => {
		if (!String(mod?.type || "").startsWith("half-proficiency")) return false;
		const sub = mod?.subType || "";
		return !sub || sub === subType || sub === "ability-checks" || sub === "skills";
	});
}

function skillProficiency (mods, subType, skipComponents) {
	const relevant = mods.filter(mod => mod?.subType === subType && !skipComponents?.has(mod.componentId));
	const types = new Set(relevant.map(mod => mod.type));
	if (types.has("expertise")) return 2;
	if (types.has("proficiency")) return 1;
	return 0;
}

/** Multiclass characters only keep the first class's saving throw proficiencies. */
function laterClassProficiencyIds (char) {
	const classes = char.classes || [];
	const starting = classes.find(cl => cl.isStartingClass) || classes[0];
	const ids = new Set();
	for (const cl of classes) {
		if (!cl || cl === starting) continue;
		for (const feature of [...(cl.classFeatures || []), ...(cl.definition?.classFeatures || [])]) {
			if (/^proficiencies$/i.test(String(feature?.name || "").trim())) ids.add(feature.id);
		}
	}
	return ids;
}

function spellSlotRows (char) {
	const classes = Array.isArray(char.classes) ? char.classes : [];
	const casters = classes.filter(cl => Number(cl?.definition?.spellRules?.multiClassSpellSlotDivisor) > 0 && !isWarlock(cl));
	let counts = [];
	if (casters.length === 1) {
		const cl = casters[0];
		const row = cl.definition.spellRules.levelSpellSlots?.[Number(cl.level) || 0];
		counts = Array.isArray(row) ? row.slice(0, 9).map(n => Number(n) || 0) : [];
	} else if (casters.length > 1) {
		const casterLevel = Math.floor(casters.reduce((sum, cl) => {
			const divisor = Number(cl.definition.spellRules.multiClassSpellSlotDivisor) || 1;
			return sum + (Number(cl.level) || 0) / divisor;
		}, 0));
		counts = (FULL_CASTER_SLOTS[Math.min(20, Math.max(0, casterLevel))] || []).slice();
	}
	const used = new Map((char.spellSlots || []).map(slot => [Number(slot.level), Number(slot.used) || 0]));
	const slots = counts.map((max, index) => ({level: index + 1, max, spent: 0}))
		.filter(slot => slot.max > 0)
		.map(slot => ({...slot, spent: Math.max(0, Math.min(slot.max, used.get(slot.level) || 0))}));
	liftAvailable(slots, char.spellSlots, false);
	for (const cl of classes.filter(isWarlock)) {
		const row = cl.definition?.spellRules?.levelSpellSlots?.[Number(cl.level) || 0];
		if (!Array.isArray(row)) continue;
		row.forEach((max, index) => {
			const count = Number(max) || 0;
			if (!count) return;
			const level = index + 1;
			const remote = (char.pactMagic || []).find(slot => Number(slot.level) === level);
			const spent = Math.max(0, Math.min(count, Number(remote?.used) || 0));
			slots.push({level, max: count, spent, pact: true});
		});
	}
	liftAvailable(slots, char.pactMagic, true);
	return slots;
}

function liftAvailable (slots, remote, pact) {
	for (const remoteSlot of remote || []) {
		const level = Number(remoteSlot?.level);
		const available = Number(remoteSlot?.available);
		if (!level || !(available > 0)) continue;
		const slot = slots.find(it => it.level === level && !!it.pact === !!pact);
		if (slot) slot.max = Math.max(slot.max, available);
		else slots.push({
			level,
			max: available,
			spent: Math.max(0, Math.min(available, Number(remoteSlot.used) || 0)),
			...(pact ? {pact: true} : {}),
		});
	}
}

function isWarlock (cl) {
	return /warlock/i.test(cl?.definition?.name || "");
}

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

function characterActions (char) {
	const spells = new Set(spellDefs(char).map(spell => spell.name.toLowerCase()));
	const out = [];
	const seen = new Set();
	const lists = [];
	for (const key of ["class", "race", "feat", "background", "item"]) {
		if (Array.isArray(char.actions?.[key])) lists.push(char.actions[key]);
	}
	if (Array.isArray(char.customActions)) lists.push(char.customActions);
	for (const list of lists) {
		for (const action of list) {
			const name = String(action?.name || "").trim();
			if (!name) continue;
			const id = name.toLowerCase();
			if (seen.has(id) || spells.has(id)) continue;
			seen.add(id);
			const uses = Number(action.limitedUse?.maxUses);
			const activation = activationLabel(action.activation);
			const dice = actionDice(action);
			const damage = DAMAGE[Number(action?.damageTypeId)] || "";
			const attack = actionAttack(action);
			const range = actionRange(action);
			const save = actionSave(action);
			const snippet = oneLine(action?.snippet || action?.description || "");
			out.push({
				name,
				...(Number.isFinite(uses) && uses > 0 ? {uses} : {}),
				...(activation ? {activation} : {}),
				...(dice ? {dice} : {}),
				...(damage ? {damage} : {}),
				...(attack ? {attack} : {}),
				...(range ? {range} : {}),
				...(save ? {save} : {}),
				...(snippet ? {snippet} : {}),
			});
		}
	}
	return out;
}

const ACTIVATION = {
	1: "action",
	2: "no action",
	3: "bonus",
	4: "reaction",
	5: "minute",
	6: "hour",
	7: "special",
	8: "passive",
};

const ABILITY_NAME = {1: "Str", 2: "Dex", 3: "Con", 4: "Int", 5: "Wis", 6: "Cha"};

const DAMAGE = {
	1: "Acid",
	2: "Bludgeoning",
	3: "Cold",
	4: "Fire",
	5: "Force",
	6: "Lightning",
	7: "Necrotic",
	8: "Piercing",
	9: "Poison",
	10: "Psychic",
	11: "Radiant",
	12: "Slashing",
	13: "Thunder",
};

function activationLabel (activation) {
	const type = Number(activation?.activationType);
	const label = ACTIVATION[type] || "";
	if (!label) return "";
	const time = Number(activation?.activationTime);
	if (time > 1) return `${time} ${label}${label.endsWith("s") ? "" : "s"}`;
	return label;
}

function actionAttack (action) {
	const raw = action?.toHitBonus ?? action?.attackBonus ?? action?.fixedToHit;
	if (raw == null || raw === "") return "";
	const n = Number(raw);
	if (!Number.isFinite(n)) return "";
	return n >= 0 ? `+${n}` : String(n);
}

function actionRange (action) {
	const range = action?.range;
	if (!range) return "";
	if (typeof range === "string") return range.trim();
	const near = Number(range.range ?? range.rangeValue);
	const far = Number(range.longRange);
	if (near > 0 && far > near) return `${near}/${far} ft`;
	if (near > 0) return `${near} ft`;
	if (range.aoeType && range.aoeSize) return `${range.aoeSize} ft ${range.aoeType}`;
	return "";
}

function actionSave (action) {
	const ability = ABILITY_NAME[Number(action?.saveDcAbilityId)];
	const dc = action?.fixedSaveDc ?? action?.saveDc;
	if (dc != null && dc !== "" && ability) return `DC ${dc} ${ability}`;
	if (ability) return `${ability} save`;
	if (dc != null && dc !== "") return `DC ${dc}`;
	return "";
}

function actionDice (action) {
	const dice = action?.dice;
	if (!dice) return "";
	if (typeof dice === "string") return dice.trim();
	return String(dice.diceString || dice.dice || "").trim();
}

function modifierLists (char) {
	return Object.values(char.modifiers || {}).filter(Array.isArray).flat();
}

const SENSE_LABELS = {
	darkvision: "Darkvision",
	blindsight: "Blindsight",
	tremorsense: "Tremorsense",
	truesight: "Truesight",
};

const SPEED_LABELS = [
	["walk", "Walk"],
	["burrow", "Burrow"],
	["climb", "Climb"],
	["fly", "Fly"],
	["swim", "Swim"],
];

const SPEED_BY_ID = {1: "Walk", 2: "Burrow", 3: "Climb", 4: "Fly", 5: "Swim"};

const CONDITION_BY_ID = {
	1: "blinded",
	2: "charmed",
	3: "deafened",
	4: "exhaustion",
	5: "frightened",
	6: "grappled",
	7: "incapacitated",
	8: "invisible",
	9: "paralyzed",
	10: "petrified",
	11: "poisoned",
	12: "prone",
	13: "restrained",
	14: "stunned",
	15: "unconscious",
};

const ALIGNMENT = {
	1: "Lawful Good",
	2: "Neutral Good",
	3: "Chaotic Good",
	4: "Lawful Neutral",
	5: "Neutral",
	6: "Chaotic Neutral",
	7: "Lawful Evil",
	8: "Neutral Evil",
	9: "Chaotic Evil",
};

const LIFESTYLE = {
	1: "Wretched",
	2: "Squalid",
	3: "Poor",
	4: "Modest",
	5: "Comfortable",
	6: "Wealthy",
	7: "Aristocratic",
};

const DEFENSE_KIND = {1: "Resistance", 2: "Immunity", 3: "Vulnerability"};

function characterSpeeds (char) {
	const normal = char.race?.weightSpeeds?.normal || {};
	const out = [];
	for (const [key, label] of SPEED_LABELS) {
		const n = Number(normal[key]);
		if (n > 0) out.push({label, value: n});
	}
	for (const mod of modifierLists(char)) {
		if (mod?.type !== "bonus" || mod.value == null) continue;
		const label = SPEED_LABELS.find(([key]) => key === mod.subType)?.[1];
		if (!label) continue;
		const add = Number(mod.value) || 0;
		if (!add) continue;
		const hit = out.find(it => it.label === label);
		if (hit) hit.value += add;
		else out.push({label, value: add});
	}
	for (const custom of char.customSpeeds || []) {
		const label = String(custom?.name || SPEED_BY_ID[custom?.movementId] || "Speed").trim();
		const value = Number(custom?.distance ?? custom?.value ?? custom?.speed);
		if (!label || !(value > 0)) continue;
		const hit = out.find(it => it.label.toLowerCase() === label.toLowerCase());
		if (hit) hit.value += value;
		else out.push({label, value});
	}
	return out;
}

function characterSenses (char) {
	const out = [];
	const seen = new Set();
	const push = (label, range) => {
		const text = range > 0 ? `${label} ${range} ft` : label;
		const key = text.toLowerCase();
		if (!label || seen.has(key)) return;
		seen.add(key);
		out.push(text);
	};
	for (const mod of modifierLists(char)) {
		const sub = String(mod?.subType || "").toLowerCase();
		const named = String(mod?.friendlySubtypeName || "").trim();
		const label = SENSE_LABELS[sub] || SENSE_LABELS[named.toLowerCase()] || "";
		if (!label) continue;
		push(label, Number(mod.value) || 0);
	}
	for (const custom of char.customSenses || []) {
		const label = String(custom?.name || SENSE_LABELS[custom?.senseId] || "Sense").trim();
		push(label, Number(custom?.distance ?? custom?.value) || 0);
	}
	return out;
}

function characterDefenses (char) {
	const out = [];
	const seen = new Set();
	const push = (kind, label) => {
		const text = `${kind} ${label}`.trim();
		const key = text.toLowerCase();
		if (!label || seen.has(key)) return;
		seen.add(key);
		out.push(text);
	};
	for (const mod of modifierLists(char)) {
		const kind = mod?.type === "resistance" ? "Resistance"
			: mod?.type === "immunity" ? "Immunity"
				: mod?.type === "vulnerability" ? "Vulnerability"
					: "";
		if (!kind) continue;
		const label = String(mod.friendlySubtypeName || titleSub(mod.subType) || "").trim();
		if (/armor class/i.test(label)) continue;
		push(kind, label);
	}
	for (const adj of char.customDefenseAdjustments || []) {
		const kind = DEFENSE_KIND[Number(adj?.type)] || titleSub(adj?.typeName || adj?.type || "Defense");
		const label = String(adj?.name || DAMAGE[Number(adj?.adjustmentId)] || "").trim();
		push(kind, label);
	}
	return out;
}

function characterProficiencies (char) {
	const skip = new Set([
		...SKILLS.map(skill => skill.sub),
		...SAVES.map(save => save.sub),
		"initiative",
		"armor-class",
		"unarmored-armor-class",
		"ac",
		...Object.keys(SENSE_LABELS),
		"spell-attacks",
		"spell-save-dc",
		"hit-points",
		"speed",
		"fly",
		"climb",
		"swim",
		"burrow",
	]);
	const out = [];
	const seen = new Set();
	const push = (label) => {
		const text = String(label || "").trim();
		const key = text.toLowerCase();
		if (!text || seen.has(key) || /^choose\b/i.test(text)) return;
		seen.add(key);
		out.push(text);
	};
	for (const mod of modifierLists(char)) {
		const type = mod?.type;
		if (type !== "language" && type !== "proficiency" && type !== "expertise") continue;
		const sub = String(mod?.subType || "");
		if (skip.has(sub) || /^choose\b/i.test(sub)) continue;
		const label = String(mod.friendlySubtypeName || titleSub(sub) || "").trim();
		push(type === "expertise" ? `${label} (expertise)` : label);
	}
	for (const custom of char.customProficiencies || []) {
		push(typeof custom === "string" ? custom : (custom?.name || custom?.proficiency || ""));
	}
	out.sort((a, b) => a.localeCompare(b));
	return out;
}

function spellcastingLines (char, abilities, level) {
	const prof = 2 + Math.floor((Math.max(1, level) - 1) / 4);
	const mods = modifierLists(char);
	const bonus = (subType) => mods
		.filter(mod => mod?.type === "bonus" && mod.subType === subType && mod.value != null)
		.reduce((sum, mod) => sum + (Number(mod.value) || 0), 0);
	const attackBonus = bonus("spell-attacks");
	const dcBonus = bonus("spell-save-dc");
	const out = [];
	const seen = new Set();
	for (const cl of char.classes || []) {
		const abilityId = Number(cl?.definition?.spellCastingAbilityId);
		const key = ABILITIES.find(it => it.id === abilityId)?.key;
		const className = String(cl?.definition?.name || "").trim();
		if (!key || !className || seen.has(className)) continue;
		seen.add(className);
		const mod = modifier(abilities[key]);
		out.push({
			className,
			attack: mod + prof + attackBonus,
			dc: 8 + mod + prof + dcBonus,
		});
	}
	return out;
}

function characterHitDice (char) {
	const out = [];
	for (const cl of char.classes || []) {
		const className = String(cl?.definition?.name || "").trim();
		const die = Number(cl?.definition?.hitDice);
		const count = Number(cl?.level) || 0;
		if (!className || !die || !count) continue;
		const spent = Math.max(0, Number(cl.hitDiceUsed) || 0);
		out.push({className, die, count, spent: Math.min(count, spent)});
	}
	return out;
}

function characterFeatures (char) {
	const out = [];
	const seen = new Set();
	const push = (group, feature, levelCap) => {
		const def = feature?.definition || feature;
		const name = String(def?.name || "").trim();
		if (!name) return;
		const required = Number(def?.requiredLevel ?? feature?.requiredLevel ?? def?.level ?? 0);
		if (levelCap != null && required > levelCap) return;
		const key = name.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		const snippet = oneLine(def?.snippet || def?.description || feature?.snippet || "");
		out.push({group, name, ...(snippet ? {snippet} : {})});
	};
	for (const trait of char.race?.racialTraits || []) push("Species", trait, null);
	for (const cl of char.classes || []) {
		const cap = Number(cl?.level) || 0;
		const className = String(cl?.definition?.name || "Class").trim();
		const classList = cl?.classFeatures?.length ? cl.classFeatures : (cl?.definition?.classFeatures || []);
		for (const feature of classList) push(className, feature, cap);
		const subName = String(cl?.subclassDefinition?.name || "").trim();
		for (const feature of cl?.subclassDefinition?.classFeatures || []) push(subName || "Subclass", feature, cap);
	}
	return out;
}

function characterChoices (char) {
	const optionLabel = new Map();
	for (const def of char.choices?.choiceDefinitions || []) {
		for (const opt of def?.options || []) {
			if (opt?.id != null && opt.label) optionLabel.set(Number(opt.id), String(opt.label).trim());
		}
	}
	const featIds = new Set();
	const mapped = new Map();
	for (const [key, name] of Object.entries(char.choices?.definitionKeyNameMap || {})) {
		const id = Number(String(key).split(":").pop());
		const label = String(name || "").trim();
		if (!Number.isFinite(id) || !label) continue;
		mapped.set(id, label);
		if (String(key).startsWith("feat:")) featIds.add(id);
	}
	const labels = [];
	const feats = [];
	const seen = new Set();
	const seenFeats = new Set();
	for (const bucket of ["race", "class", "background", "feat", "item"]) {
		const list = char.choices?.[bucket];
		if (!Array.isArray(list)) continue;
		for (const choice of list) {
			const id = Number(choice?.optionValue);
			const label = optionLabel.get(id) || mapped.get(id) || "";
			if (!label || /^choose\b/i.test(label)) continue;
			const key = label.toLowerCase();
			if (!seen.has(key)) {
				seen.add(key);
				labels.push(label);
			}
			if ((bucket === "feat" || featIds.has(id)) && !seenFeats.has(key)) {
				seenFeats.add(key);
				feats.push(label);
			}
		}
	}
	return {labels, feats};
}

function characterCompanions (char) {
	const out = [];
	for (const creature of char.creatures || []) {
		const name = String(creature?.name || creature?.definition?.name || "").trim();
		if (!name) continue;
		const max = creature.maxHitPoints ?? creature.hitPointMax ?? creature.definition?.averageHitPoints;
		const bits = [];
		if (max != null && max !== "") {
			const removed = Number(creature.removedHitPoints) || 0;
			const top = Number(max) || 0;
			bits.push(`HP ${Math.max(0, top - removed)}/${top}`);
		}
		const snippet = oneLine(creature?.description || creature?.definition?.snippet || "");
		out.push({name, ...(bits.length ? {line: bits.join(" · ")} : {}), ...(snippet ? {snippet} : {})});
	}
	return out;
}

function characterConditions (char) {
	const known = new Set(Object.values(CONDITION_BY_ID));
	const out = [];
	const seen = new Set();
	for (const cond of char.conditions || []) {
		const named = String(cond?.definition?.name || cond?.name || "").trim().toLowerCase();
		const id = known.has(named) ? named : CONDITION_BY_ID[Number(cond?.id)];
		if (!id || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

function characterDeathSaves (char) {
	const saves = char.deathSaves || {};
	return {
		success: clampCount(saves.successCount),
		fail: clampCount(saves.failCount),
		stable: !!saves.isStabilized,
	};
}

function clampCount (value) {
	const n = Number(value) || 0;
	return Math.max(0, Math.min(3, n));
}

function characterStory (char) {
	const traits = char.traits || {};
	const notes = char.notes || {};
	const lifestyle = typeof char.lifestyle === "string"
		? char.lifestyle
		: (char.lifestyle?.name || LIFESTYLE[Number(char.lifestyleId)] || "");
	return {
		gender: textField(char.gender),
		faith: textField(char.faith),
		age: char.age != null && char.age !== "" ? String(char.age) : "",
		hair: textField(char.hair),
		eyes: textField(char.eyes),
		skin: textField(char.skin),
		height: textField(char.height),
		weight: char.weight != null && char.weight !== "" ? String(char.weight) : "",
		alignment: ALIGNMENT[Number(char.alignmentId)] || "",
		lifestyle: textField(lifestyle),
		appearance: plainTrait(traits.appearance),
		backstory: plainTrait(notes.backstory),
		allies: plainTrait(notes.allies),
		organizations: plainTrait(notes.organizations),
		enemies: plainTrait(notes.enemies),
		otherNotes: [notes.otherNotes, notes.otherHoldings, notes.additionalNotes].map(plainTrait).filter(Boolean).join("\n\n"),
		possessions: plainTrait(notes.personalPossessions),
	};
}

function textField (value) {
	return String(value || "").trim();
}

function titleSub (value) {
	return String(value || "")
		.replace(/[-_]+/g, " ")
		.replace(/\b\w/g, (ch) => ch.toUpperCase())
		.trim();
}

function oneLine (value) {
	return plainTrait(value).replace(/\s+/g, " ").slice(0, 160);
}

function finiteOrNull (value) {
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function characterTraits (char) {
	const traits = char.traits || {};
	const personality = plainTrait(traits.personalityTraits);
	const ideals = plainTrait(traits.ideals);
	const bonds = plainTrait(traits.bonds);
	const flaws = plainTrait(traits.flaws);
	if (!personality && !ideals && !bonds && !flaws) return null;
	return {personality, ideals, bonds, flaws};
}

function plainTrait (value) {
	if (value == null) return "";
	if (Array.isArray(value)) return value.map(plainTrait).filter(Boolean).join("\n");
	const text = typeof value === "string"
		? value
		: String(value.text || value.value || value.definition?.name || "");
	return text
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function modifier (score) {
	return Math.floor(((Number(score) || 10) - 10) / 2);
}

function proxyErrorMessage (status, body) {
	const code = body?.error;
	if (code === "private" || status === 403) {
		return "Character is private. Set it to Public on D&D Beyond, then try again.";
	}
	if (code === "not_found" || status === 404) return "Character not found on D&D Beyond.";
	if (body?.message && code !== "upstream_error") return String(body.message);
	if (status) return `D&D Beyond returned HTTP ${status}.`;
	return "Could not reach the D&D Beyond proxy.";
}

async function requestJson (url) {
	try {
		const res = await requestUrl({url, headers: {Accept: "application/json"}});
		const body = jsonBody(res);
		if (res.status && res.status >= 400) return {ok: false, status: res.status, body};
		return {ok: true, status: res.status || 200, body};
	} catch (err) {
		const status = Number(err?.status) || 0;
		const body = jsonBody(err);
		if (status) return {ok: false, status, body};
		throw new Error(err?.message || "Could not reach the D&D Beyond proxy.");
	}
}

function jsonBody (res) {
	if (res?.json && typeof res.json === "object") return res.json;
	try { return JSON.parse(String(res?.text || "")); } catch (_) { return null; }
}

function headerValue (headers, name) {
	if (!headers) return "";
	if (typeof headers.get === "function") return String(headers.get(name) || headers.get(name.toLowerCase()) || "");
	const target = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (String(key).toLowerCase() === target) return String(value || "");
	}
	return "";
}
