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
	const speed = char.race?.weightSpeeds?.normal?.walk;
	const edition = characterEdition(char);
	return {
		ddbId: String(char.id || requestedId || ""),
		name: String(char.name || "Unnamed").trim() || "Unnamed",
		species: String(char.race?.fullName || char.race?.baseName || "").trim(),
		classes: classes.map(classLabel).filter(Boolean).join(" / "),
		level,
		background: String(char.background?.definition?.name || "").trim(),
		ac: armorClass(char, abilities.dex),
		hpMax: hp.max,
		hpCurrent: hp.current,
		tempHp: hp.temp,
		speed: Number.isFinite(Number(speed)) ? Number(speed) : null,
		abilities,
		edition,
		refs: characterRefs(char, edition),
		traits: characterTraits(char),
		rolls: characterRolls(char, abilities, level),
		actions: characterActions(char),
		slots: spellSlotRows(char),
		coins: char.currencies || {},
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

function armorClass (char, dexScore) {
	const dex = modifier(dexScore);
	const equipped = (Array.isArray(char.inventory) ? char.inventory : [])
		.filter(item => item?.equipped && item.definition);
	const armor = equipped.find(item => isWornArmor(item.definition));
	const shield = equipped.find(item => isShield(item.definition));
	let ac = 10 + dex;
	if (armor) {
		ac = (Number(armor.definition.armorClass) || 0) + dexForArmor(armor.definition.armorTypeId, dex) + magicBonus(armor.definition.name);
	}
	if (shield) ac += 2 + magicBonus(shield.definition.name);
	return ac;
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

function characterRefs (char, edition) {
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
	for (const feat of featEntries(char)) {
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
		});
	}
	return refs;
}

function featEntries (char) {
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
	return out;
}

function gearEntries (char) {
	const out = [];
	for (const item of Array.isArray(char.inventory) ? char.inventory : []) {
		const def = item?.definition;
		const label = String(def?.name || "").trim();
		if (!label) continue;
		const alts = [];
		const comma = label.match(/^(.+),\s*(.+)$/);
		if (comma) alts.push(`${comma[2]} ${comma[1]}`.trim());
		if (isWornArmor(def) && !/armor$/i.test(label)) alts.push(`${label} Armor`);
		const bare = label.replace(/^\+\d+\s+/, "").trim();
		if (bare && bare.toLowerCase() !== label.toLowerCase()) alts.push(bare);
		out.push({
			label,
			alts,
			qty: Math.max(1, Number(item.quantity) || 1),
			equipped: !!item.equipped,
			isLegacy: def?.isLegacy,
		});
	}
	return out;
}

function spellDefs (char) {
	const out = [];
	const seen = new Set();
	const push = (list) => {
		for (const entry of list || []) {
			const def = entry?.definition || entry;
			const name = String(def?.name || "").trim();
			if (!name) continue;
			const key = name.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({
				name,
				isLegacy: def?.isLegacy,
				...(Number.isFinite(Number(def?.level)) ? {level: Number(def.level)} : {}),
			});
		}
	};
	const spells = char.spells || {};
	push(spells.class);
	push(spells.race);
	push(spells.feat);
	push(spells.item);
	push(spells.background);
	for (const block of char.classSpells || []) push(block?.spells);
	return out;
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
		return {
			name: skill.name,
			ability: skill.ability,
			mod: modifier(abilities[skill.ability]) + mult * prof + bonus(skill.sub),
			proficient: mult >= 1,
			...(mult >= 2 ? {expertise: true} : {}),
		};
	});
	const perception = skills.find(skill => skill.name === "Perception");
	const advantage = mods.some(mod => mod?.type === "advantage" && mod?.subType === "perception");
	return {
		proficiency: prof,
		initiative: modifier(abilities.dex) + bonus("initiative"),
		passivePerception: 10 + (perception?.mod || 0) + (advantage ? 5 : 0),
		saves: SAVES.map(save => {
			const isProf = skillProficiency(mods, save.sub, laterClassProficiencyIds(char)) >= 1;
			return {
				key: save.key,
				label: save.label,
				mod: modifier(abilities[save.key]) + (isProf ? prof : 0) + bonus(save.sub),
				proficient: isProf,
			};
		}),
		skills,
	};
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
	return slots;
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
	for (const key of ["class", "race", "feat", "background", "item"]) {
		const list = char.actions?.[key];
		if (!Array.isArray(list)) continue;
		for (const action of list) {
			const name = String(action?.name || "").trim();
			if (!name) continue;
			const id = name.toLowerCase();
			if (seen.has(id) || spells.has(id)) continue;
			seen.add(id);
			const uses = Number(action.limitedUse?.maxUses);
			const activation = Number(action.activation?.activationType);
			const dice = actionDice(action);
			out.push({
				name,
				...(Number.isFinite(uses) && uses > 0 ? {uses} : {}),
				...(activation === 3 ? {activation: "bonus"} : {}),
				...(activation === 4 ? {activation: "reaction"} : {}),
				...(dice ? {dice} : {}),
			});
		}
	}
	return out;
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
	return text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
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
