export const HB_SOURCE = "HB";

export const HOMEBREW_TYPES = [
	{id: "spell", prop: "spell", label: "Spell", catId: 2},
	{id: "item", prop: "item", label: "Item", catId: 4},
	{id: "monster", prop: "monster", label: "Creature", catId: 1},
	{id: "background", prop: "background", label: "Background", catId: 3},
	{id: "race", prop: "race", label: "Species", catId: 10},
];

const BREW_PROPS = HOMEBREW_TYPES.map(it => it.prop);

let brewJson = emptyBrew();

export function emptyBrew () {
	return {
		_meta: {
			sources: [{
				json: HB_SOURCE,
				abbreviation: "HB",
				full: "Homebrew",
				version: "1.0.0",
			}],
		},
		spell: [],
		item: [],
		monster: [],
		background: [],
		race: [],
	};
}

export function getBrewJson () {
	return copyJson(brewJson);
}

export function setBrewJson (json) {
	brewJson = normalizeBrew(json);
	return getBrewJson();
}

export function homebrewType (typeId) {
	return HOMEBREW_TYPES.find(it => it.id === typeId) || HOMEBREW_TYPES[0];
}

export function listBrewEntities (typeId) {
	const type = homebrewType(typeId);
	return (brewJson[type.prop] || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function getBrewEntity (typeId, name) {
	const needle = String(name || "").toLowerCase();
	if (!needle) return null;
	const type = homebrewType(typeId);
	return (brewJson[type.prop] || []).find(it => String(it.name || "").toLowerCase() === needle) || null;
}

export function upsertEntity (prop, ent, {previousName} = {}) {
	const brew = normalizeBrew(brewJson);
	const list = brew[prop] || [];
	const oldName = String(previousName || ent.name || "").toLowerCase();
	const ix = list.findIndex(it => String(it.name || "").toLowerCase() === oldName);
	if (ix >= 0) list[ix] = ent;
	else list.push(ent);
	brew[prop] = list;
	setBrewJson(brew);
	return ent;
}

export function deleteEntity (prop, name) {
	const brew = normalizeBrew(brewJson);
	const needle = String(name || "").toLowerCase();
	brew[prop] = (brew[prop] || []).filter(it => String(it.name || "").toLowerCase() !== needle);
	setBrewJson(brew);
}

export function brewVaultPath (plugin) {
	const folder = String(plugin?.settings?.notesFolder || "5etools").replace(/\\/g, "/").replace(/\/+$/, "");
	return `${folder}/_homebrew/homebrew.json`;
}

export async function loadHomebrewFromVault (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return getBrewJson();
	const file = vault.getAbstractFileByPath(brewVaultPath(plugin));
	if (!file || file.children) {
		setBrewJson(emptyBrew());
		return getBrewJson();
	}
	try {
		const text = await vault.read(file);
		setBrewJson(JSON.parse(text));
	} catch (_) {
		setBrewJson(emptyBrew());
	}
	return getBrewJson();
}

export async function saveHomebrewToVault (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return getBrewJson();
	const filePath = brewVaultPath(plugin);
	const folder = filePath.replace(/\/[^/]+$/, "");
	await ensureFolder(plugin.app, folder);
	const text = `${JSON.stringify(brewJson, null, "\t")}\n`;
	const existing = vault.getAbstractFileByPath(filePath);
	if (existing && !existing.children) await vault.modify(existing, text);
	else await vault.create(filePath, text);
	return getBrewJson();
}

export function cacheBrewInDataLoader () {
	const DataLoader = globalThis.DataLoader;
	if (!DataLoader?._pCache_addToCache) return;
	DataLoader._pCache_addToCache({
		allDataMerged: getBrewJson(),
		propAllowlist: new Set(BREW_PROPS),
	});
}

export function applyBrewJson (json) {
	setBrewJson(json);
	cacheBrewInDataLoader();
	return getBrewJson();
}

export function hpAverageFromFormula (formula) {
	const raw = String(formula || "").replace(/\s+/g, "");
	if (!raw) return 0;
	const m = raw.match(/^(\d+)d(\d+)(?:([+-])(\d+))?$/i);
	if (!m) {
		const n = Number(raw);
		return Number.isFinite(n) ? Math.floor(n) : 0;
	}
	const n = Number(m[1]);
	const sides = Number(m[2]);
	const bonus = m[4] ? Number(m[4]) * (m[3] === "-" ? -1 : 1) : 0;
	return Math.floor(n * ((sides + 1) / 2) + bonus);
}

export function emptyForm (typeId) {
	switch (homebrewType(typeId).id) {
		case "item": return {
			kind: "magic",
			name: "",
			type: "W",
			rarity: "uncommon",
			attunement: false,
			value: "",
			weight: "",
			damage: "",
			damageType: "",
			armorClass: "",
			entries: "",
		};
		case "monster": return {
			name: "",
			size: "M",
			type: "humanoid",
			alignment: "N",
			ac: "10",
			hpFormula: "2d8+2",
			speed: "30",
			str: "10",
			dex: "10",
			con: "10",
			int: "10",
			wis: "10",
			cha: "10",
			saves: "",
			skills: "",
			senses: "",
			languages: "Common",
			cr: "0",
			traits: "",
			actions: "",
			bonus: "",
			reactions: "",
		};
		case "background": return {
			name: "",
			ability1: "str",
			ability2: "dex",
			ability3: "con",
			feat: "",
			skills: "",
			tool: "",
			equipment: "",
		};
		case "race": return {
			name: "",
			creatureType: "humanoid",
			size: "M",
			speed: "30",
			darkvision: "0",
			traits: "",
		};
		default: return {
			name: "",
			level: "0",
			school: "V",
			timeNumber: "1",
			timeUnit: "action",
			range: "60 feet",
			verbal: true,
			somatic: true,
			material: false,
			materialText: "",
			duration: "instant",
			concentration: false,
			ritual: false,
			classes: "Wizard",
			entries: "",
			higher: "",
		};
	}
}

export function entityToForm (typeId, ent) {
	if (!ent) return emptyForm(typeId);
	switch (homebrewType(typeId).id) {
		case "item": return itemToForm(ent);
		case "monster": return monsterToForm(ent);
		case "background": return backgroundToForm(ent);
		case "race": return raceToForm(ent);
		default: return spellToForm(ent);
	}
}

export function buildEntity (typeId, form) {
	switch (homebrewType(typeId).id) {
		case "item": return buildItem(form);
		case "monster": return buildMonster(form);
		case "background": return buildBackground(form);
		case "race": return buildRace(form);
		default: return buildSpell(form);
	}
}

export function installBrewUtil () {
	globalThis.BrewUtil2 = {
		DISPLAY_NAME: "homebrew",
		hasSourceJson (source) { return isHbSource(source); },
		sourceJsonToSource (source) { return isHbSource(source) ? hbSource() : null; },
		sourceJsonToAbv (source) { return isHbSource(source) ? "HB" : String(source || ""); },
		sourceJsonToFull (source) { return isHbSource(source) ? "Homebrew" : String(source || ""); },
		sourceJsonToDate () { return null; },
		isClassicSource () { return false; },
		async pGetCustomUrl () { return ""; },
		async pGetBrewProcessed () { return getBrewJson(); },
		getBrewProcessedFromCache (prop) { return getBrewJson()[prop] || []; },
		async pAddBrewFromUrl () {},
		getPopoutStyleElementHtml () { return ""; },
		getFileUrl () { return ""; },
		getSources () { return [hbSource()]; },
	};
}

function hbSource () {
	return {
		json: HB_SOURCE,
		abbreviation: "HB",
		full: "Homebrew",
		version: "1.0.0",
	};
}

function isHbSource (source) {
	return String(source?.json || source || "").toLowerCase() === "hb";
}

function normalizeBrew (json) {
	const next = emptyBrew();
	if (!json || typeof json !== "object") return next;
	if (json._meta?.sources?.length) next._meta = copyJson(json._meta);
	for (const prop of BREW_PROPS) {
		next[prop] = Array.isArray(json[prop]) ? json[prop].filter(it => it && it.name) : [];
	}
	return next;
}

function copyJson (value) {
	return JSON.parse(JSON.stringify(value));
}

async function ensureFolder (app, folderPath) {
	const parts = String(folderPath || "").split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(acc)) await app.vault.createFolder(acc);
	}
}

function buildSpell (form) {
	const name = String(form?.name || "").trim();
	const timeUnit = String(form?.timeUnit || "action").trim() || "action";
	const components = {
		v: !!form?.verbal,
		s: !!form?.somatic,
	};
	if (form?.material) {
		components.m = String(form.materialText || "").trim() || true;
	}
	const ent = {
		name,
		source: HB_SOURCE,
		level: Math.max(0, Math.min(9, Number(form?.level) || 0)),
		school: String(form?.school || "V").slice(0, 1).toUpperCase(),
		time: [{
			number: Math.max(1, Number(form?.timeNumber) || 1),
			unit: timeUnit,
		}],
		range: parseSpellRange(form?.range),
		components,
		duration: parseSpellDuration(form?.duration, form?.concentration),
		entries: splitParagraphs(form?.entries),
	};
	if (form?.ritual) ent.meta = {ritual: true};
	const higher = splitParagraphs(form?.higher);
	if (higher.length) {
		ent.entriesHigherLevel = [{
			type: "entries",
			name: ent.level === 0 ? "Cantrip Upgrade" : "Using a Higher-Level Spell Slot",
			entries: higher,
		}];
	}
	const classes = parseClassList(form?.classes);
	if (classes.length) ent.classes = {fromClassList: classes};
	return ent;
}

function spellToForm (ent) {
	const form = emptyForm("spell");
	form.name = ent.name || "";
	form.level = String(ent.level ?? 0);
	form.school = ent.school || "V";
	form.timeNumber = String(ent.time?.[0]?.number || 1);
	form.timeUnit = ent.time?.[0]?.unit || "action";
	form.range = spellRangeToText(ent.range);
	form.verbal = !!ent.components?.v;
	form.somatic = !!ent.components?.s;
	form.material = ent.components?.m != null && ent.components?.m !== false;
	form.materialText = typeof ent.components?.m === "string" ? ent.components.m : "";
	form.duration = spellDurationToText(ent.duration);
	form.concentration = !!(ent.duration || []).some(it => it.concentration);
	form.ritual = !!ent.meta?.ritual;
	form.classes = (ent.classes?.fromClassList || []).map(it => it.name).join(", ");
	form.entries = entriesToText(ent.entries);
	form.higher = entriesToText(ent.entriesHigherLevel?.[0]?.entries || ent.entriesHigherLevel);
	return form;
}

function buildItem (form) {
	const kind = form?.kind === "gear" ? "gear" : "magic";
	const type = String(form?.type || (kind === "gear" ? "G" : "W")).split("|")[0];
	const ent = {
		name: String(form?.name || "").trim(),
		source: HB_SOURCE,
		type,
		rarity: kind === "gear" ? "none" : (String(form?.rarity || "uncommon").toLowerCase() || "none"),
		entries: splitParagraphs(form?.entries),
	};
	if (form?.attunement) ent.reqAttune = true;
	const valueGp = Number(form?.value);
	if (Number.isFinite(valueGp) && valueGp > 0) ent.value = Math.round(valueGp * 100);
	const weight = Number(form?.weight);
	if (Number.isFinite(weight) && weight > 0) ent.weight = weight;
	if (type === "W") ent.wondrous = true;
	if (["M", "R"].includes(type)) {
		ent.weapon = true;
		if (form?.damage) ent.dmg1 = String(form.damage).trim();
		if (form?.damageType) ent.dmgType = String(form.damageType).trim().slice(0, 1).toUpperCase();
	}
	if (["LA", "MA", "HA", "S"].includes(type) && form?.armorClass) {
		const ac = Number(form.armorClass);
		if (Number.isFinite(ac)) ent.ac = ac;
	}
	return ent;
}

function itemToForm (ent) {
	const form = emptyForm("item");
	form.name = ent.name || "";
	form.type = String(ent.type || "W").split("|")[0];
	form.rarity = ent.rarity || "none";
	form.kind = form.rarity === "none" && !ent.reqAttune ? "gear" : "magic";
	form.attunement = !!ent.reqAttune;
	form.value = ent.value != null ? String(ent.value / 100) : "";
	form.weight = ent.weight != null ? String(ent.weight) : "";
	form.damage = ent.dmg1 || "";
	form.damageType = ent.dmgType || "";
	form.armorClass = ent.ac != null ? String(ent.ac) : "";
	form.entries = entriesToText(ent.entries);
	return form;
}

function buildMonster (form) {
	const hpFormula = String(form?.hpFormula || "").trim() || "2d8";
	const wis = numStat(form?.wis, 10);
	const ent = {
		name: String(form?.name || "").trim(),
		source: HB_SOURCE,
		edition: "one",
		size: [String(form?.size || "M").slice(0, 1).toUpperCase()],
		type: String(form?.type || "humanoid").trim() || "humanoid",
		alignment: parseAlignment(form?.alignment),
		ac: [Math.max(1, Number(form?.ac) || 10)],
		hp: {
			formula: hpFormula,
			average: hpAverageFromFormula(hpFormula),
		},
		speed: parseSpeed(form?.speed),
		str: numStat(form?.str, 10),
		dex: numStat(form?.dex, 10),
		con: numStat(form?.con, 10),
		int: numStat(form?.int, 10),
		wis,
		cha: numStat(form?.cha, 10),
		passive: 10 + Math.floor((wis - 10) / 2),
		languages: splitComma(form?.languages),
		cr: String(form?.cr || "0").trim() || "0",
	};
	const save = parseBonusMap(form?.saves);
	if (Object.keys(save).length) ent.save = save;
	const skill = parseBonusMap(form?.skills);
	if (Object.keys(skill).length) ent.skill = skill;
	const senses = parseSenses(form?.senses);
	if (senses.darkvision) ent.darkvision = senses.darkvision;
	if (senses.senses.length) ent.senses = senses.senses;
	const trait = parseNamedEntries(form?.traits);
	if (trait.length) ent.trait = trait;
	const action = parseNamedEntries(form?.actions);
	if (action.length) ent.action = action;
	const bonus = parseNamedEntries(form?.bonus);
	if (bonus.length) ent.bonus = bonus;
	const reaction = parseNamedEntries(form?.reactions);
	if (reaction.length) ent.reaction = reaction;
	return ent;
}

function monsterToForm (ent) {
	const form = emptyForm("monster");
	form.name = ent.name || "";
	form.size = ent.size?.[0] || "M";
	form.type = typeof ent.type === "string" ? ent.type : (ent.type?.type || "humanoid");
	form.alignment = Array.isArray(ent.alignment) ? ent.alignment.join("") : (ent.alignment?.special || "N");
	form.ac = String(Array.isArray(ent.ac) ? (ent.ac[0]?.ac ?? ent.ac[0]) : (ent.ac?.ac ?? ent.ac ?? 10));
	form.hpFormula = ent.hp?.formula || String(ent.hp?.average || "2d8+2");
	form.speed = speedToText(ent.speed);
	form.str = String(ent.str ?? 10);
	form.dex = String(ent.dex ?? 10);
	form.con = String(ent.con ?? 10);
	form.int = String(ent.int ?? 10);
	form.wis = String(ent.wis ?? 10);
	form.cha = String(ent.cha ?? 10);
	form.saves = bonusMapToText(ent.save);
	form.skills = bonusMapToText(ent.skill);
	form.senses = (ent.senses || []).join(", ");
	form.languages = (ent.languages || []).join(", ");
	form.cr = String(ent.cr?.cr ?? ent.cr ?? "0");
	form.traits = namedEntriesToText(ent.trait);
	form.actions = namedEntriesToText(ent.action);
	form.bonus = namedEntriesToText(ent.bonus);
	form.reactions = namedEntriesToText(ent.reaction);
	return form;
}

function buildBackground (form) {
	const abilities = parseAbilities([form?.ability1, form?.ability2, form?.ability3].filter(Boolean).join(", ") || form?.abilities);
	const skills = parseProfMap(form?.skills);
	const toolName = String(form?.tool || "").trim();
	const featName = String(form?.feat || "").trim();
	const equipment = String(form?.equipment || "").trim();
	const skillNames = Object.keys(skills);
	const ent = {
		name: String(form?.name || "").trim(),
		source: HB_SOURCE,
		edition: "one",
		ability: backgroundAbility(abilities),
		entries: [{
			type: "list",
			style: "list-hang-notitle",
			items: [
				{
					type: "item",
					name: "Ability Scores:",
					entry: abilities.map(abv => titleCase(abv)).join(", ") || "Strength, Dexterity, Constitution",
				},
				{
					type: "item",
					name: "Feat:",
					entry: featName ? featEntry(featName) : "None",
				},
				{
					type: "item",
					name: "Skill Proficiencies:",
					entry: skillNames.length ? skillNames.map(name => `{@skill ${titleCase(name)}|XPHB}`).join(", ") : "None",
				},
				{
					type: "item",
					name: "Tool Proficiency:",
					entry: toolName ? `{@item ${toolName}|XPHB}` : "None",
				},
				{
					type: "item",
					name: "Equipment:",
					entry: equipment || "None",
				},
			],
		}],
	};
	if (featName) ent.feats = [{[featKey(featName)]: true}];
	if (skillNames.length) ent.skillProficiencies = [skills];
	if (toolName) ent.toolProficiencies = [{[toolName.toLowerCase()]: true}];
	if (equipment) ent.startingEquipment = [{A: [{special: equipment}]}];
	return ent;
}

function backgroundToForm (ent) {
	const form = emptyForm("background");
	form.name = ent.name || "";
	const from = ent.ability?.[0]?.choose?.weighted?.from || [];
	form.ability1 = from[0] || "str";
	form.ability2 = from[1] || "dex";
	form.ability3 = from[2] || "con";
	const featKeyName = Object.keys(ent.feats?.[0] || {})[0] || "";
	form.feat = featKeyName.split("|")[0];
	form.skills = Object.keys(ent.skillProficiencies?.[0] || {}).filter(k => k !== "choose").join(", ");
	form.tool = Object.keys(ent.toolProficiencies?.[0] || {})[0] || "";
	form.equipment = ent.startingEquipment?.[0]?.A?.[0]?.special
		|| entriesToText(ent.entries?.[0]?.items?.find(it => it.name === "Equipment:")?.entry);
	return form;
}

function buildRace (form) {
	const darkvision = Math.max(0, Number(form?.darkvision) || 0);
	const traits = parseNamedEntries(form?.traits, {asEntries: true});
	if (darkvision && !traits.some(it => /darkvision/i.test(it.name))) {
		traits.unshift({
			type: "entries",
			name: "Darkvision",
			entries: [`You have {@sense Darkvision|XPHB} with a range of ${darkvision} feet.`],
		});
	}
	const ent = {
		name: String(form?.name || "").trim(),
		source: HB_SOURCE,
		edition: "one",
		creatureTypes: [String(form?.creatureType || "humanoid").trim() || "humanoid"],
		size: [String(form?.size || "M").slice(0, 1).toUpperCase()],
		speed: Math.max(0, Number(form?.speed) || 30),
		entries: traits,
	};
	if (darkvision) ent.darkvision = darkvision;
	return ent;
}

function raceToForm (ent) {
	const form = emptyForm("race");
	form.name = ent.name || "";
	form.creatureType = ent.creatureTypes?.[0] || (typeof ent.type === "string" ? ent.type : "humanoid");
	form.size = ent.size?.[0] || "M";
	form.speed = String(typeof ent.speed === "number" ? ent.speed : (ent.speed?.walk || 30));
	form.darkvision = String(ent.darkvision || 0);
	form.traits = namedEntriesToText(ent.entries);
	return form;
}

function parseSpellRange (raw) {
	const text = String(raw || "").trim().toLowerCase();
	if (!text || text === "self") return {type: "point", distance: {type: "self"}};
	if (text === "touch") return {type: "point", distance: {type: "touch"}};
	const mile = text.match(/(\d+)\s*miles?/);
	if (mile) return {type: "point", distance: {type: "miles", amount: Number(mile[1])}};
	const feet = text.match(/(\d+)/);
	return {
		type: "point",
		distance: {
			type: "feet",
			amount: feet ? Number(feet[1]) : 30,
		},
	};
}

function spellRangeToText (range) {
	const dist = range?.distance;
	if (!dist) return "60 feet";
	if (dist.type === "self" || dist.type === "touch") return dist.type;
	if (dist.amount != null) {
		const unit = dist.type === "miles" || dist.type === "mile"
			? (Number(dist.amount) === 1 ? "mile" : "miles")
			: (dist.type || "feet");
		return `${dist.amount} ${unit}`;
	}
	return dist.type || "60 feet";
}

function parseSpellDuration (raw, concentration) {
	const text = String(raw || "").trim().toLowerCase();
	if (!text || text.startsWith("instant")) return [{type: "instant"}];
	const timed = text.match(/(\d+)\s*(minute|hour|round|day)s?/);
	if (timed) {
		const out = {
			type: "timed",
			duration: {type: timed[2], amount: Number(timed[1])},
		};
		if (concentration) out.concentration = true;
		return [out];
	}
	if (concentration) {
		return [{type: "timed", duration: {type: "minute", amount: 1}, concentration: true}];
	}
	return [{type: "instant"}];
}

function spellDurationToText (duration) {
	const first = duration?.[0];
	if (!first || first.type === "instant") return "instant";
	if (first.duration?.amount) return `${first.duration.amount} ${first.duration.type}${first.duration.amount === 1 ? "" : "s"}`;
	return first.type || "instant";
}

function parseClassList (raw) {
	return splitComma(raw).map(name => ({name, source: "XPHB"}));
}

function parseSpeed (raw) {
	const text = String(raw || "").trim();
	const out = {};
	const walk = text.match(/^(\d+)/);
	out.walk = walk ? Number(walk[1]) : 30;
	for (const mode of ["fly", "swim", "climb", "burrow"]) {
		const m = text.match(new RegExp(`${mode}\\s+(\\d+)`, "i"));
		if (m) out[mode] = Number(m[1]);
	}
	return out;
}

function speedToText (speed) {
	if (speed == null) return "30";
	if (typeof speed === "number") return String(speed);
	const parts = [String(speed.walk || 30)];
	for (const mode of ["fly", "swim", "climb", "burrow"]) {
		if (speed[mode]) parts.push(`${mode} ${speed[mode]}`);
	}
	return parts.join(", ");
}

function parseAlignment (raw) {
	const text = String(raw || "N").trim();
	if (!text) return ["N"];
	const letters = text.toUpperCase().replace(/[^LCNEGAU]/g, "");
	if (letters.length) return letters.split("");
	return [{special: text}];
}

function parseBonusMap (raw) {
	const out = {};
	String(raw || "").split(",").map(it => it.trim()).filter(Boolean).forEach(part => {
		const m = part.match(/^([a-z ]+)\s*([+-]\d+)$/i);
		if (!m) return;
		out[m[1].trim().toLowerCase()] = m[2];
	});
	return out;
}

function bonusMapToText (map) {
	if (!map) return "";
	return Object.entries(map).map(([k, v]) => `${k} ${v}`).join(", ");
}

function parseSenses (raw) {
	const senses = splitComma(raw);
	const dark = String(raw || "").match(/darkvision\s+(\d+)/i);
	return {
		senses,
		darkvision: dark ? Number(dark[1]) : 0,
	};
}

function parseNamedEntries (raw, {asEntries = false} = {}) {
	return String(raw || "").split(/\n\s*\n/).map(block => block.trim()).filter(Boolean).map(block => {
		const m = block.match(/^([^.\n]+)\.\s*([\s\S]*)$/);
		const name = (m ? m[1] : block.split("\n")[0]).trim();
		const body = (m ? m[2] : block.split("\n").slice(1).join("\n")).trim();
		const entries = body ? [body] : [""];
		return asEntries ? {type: "entries", name, entries} : {name, entries};
	});
}

function namedEntriesToText (list) {
	return (list || []).map(it => {
		const body = entriesToText(it.entries);
		return body ? `${it.name}. ${body}` : `${it.name}.`;
	}).join("\n\n");
}

function parseAbilities (raw) {
	const known = new Set(["str", "dex", "con", "int", "wis", "cha"]);
	const found = splitComma(raw).map(it => {
		const low = it.toLowerCase();
		if (known.has(low)) return low;
		if (low.startsWith("str")) return "str";
		if (low.startsWith("dex")) return "dex";
		if (low.startsWith("con")) return "con";
		if (low.startsWith("int")) return "int";
		if (low.startsWith("wis")) return "wis";
		if (low.startsWith("cha")) return "cha";
		return "";
	}).filter(Boolean);
	const unique = [...new Set(found)];
	return unique.slice(0, 3);
}

function backgroundAbility (abilities) {
	const from = abilities.length ? abilities : ["str", "dex", "con"];
	const out = [{choose: {weighted: {from, weights: [2, 1]}}}];
	if (from.length >= 3) out.push({choose: {weighted: {from, weights: [1, 1, 1]}}});
	return out;
}

function parseProfMap (raw) {
	const out = {};
	splitComma(raw).forEach(name => { out[name.toLowerCase()] = true; });
	return out;
}

function featKey (name) {
	const raw = String(name || "").trim();
	if (raw.includes("|")) return raw.toLowerCase();
	return `${raw.toLowerCase()}|xphb`;
}

function featEntry (name) {
	const raw = String(name || "").trim();
	const [label, source] = raw.split("|");
	return `{@feat ${titleCase(label)}${source ? `|${source.toUpperCase()}` : "|XPHB"}}`;
}

function splitParagraphs (raw) {
	return String(raw || "").split(/\n\s*\n/).map(it => it.trim()).filter(Boolean);
}

function entriesToText (entries) {
	if (entries == null) return "";
	if (typeof entries === "string") return entries;
	if (!Array.isArray(entries)) return String(entries);
	return entries.map(it => {
		if (typeof it === "string") return it;
		if (it?.entry) return it.entry;
		if (it?.entries) return entriesToText(it.entries);
		return "";
	}).filter(Boolean).join("\n\n");
}

function splitComma (raw) {
	return String(raw || "").split(",").map(it => it.trim()).filter(Boolean);
}

function numStat (value, fallback) {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function titleCase (value) {
	return String(value || "").replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

installBrewUtil();

if (globalThis.FiveEToolsObsidian) {
	globalThis.FiveEToolsObsidian.hpAverageFromFormula = hpAverageFromFormula;
	globalThis.FiveEToolsObsidian.emptyBrew = emptyBrew;
	globalThis.FiveEToolsObsidian.buildEntity = buildEntity;
	globalThis.FiveEToolsObsidian.applyBrewJson = applyBrewJson;
	globalThis.FiveEToolsObsidian.getBrewJson = getBrewJson;
	globalThis.FiveEToolsObsidian.upsertEntity = upsertEntity;
	globalThis.FiveEToolsObsidian.cacheBrewInDataLoader = cacheBrewInDataLoader;
}
