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

export function homebrewRoot (plugin) {
	const folder = String(plugin?.settings?.notesFolder || "5etools").replace(/\\/g, "/").replace(/\/+$/, "");
	return `${folder}/_homebrew`;
}

/** @deprecated Monolith path; kept for one-time migration. */
export function brewVaultPath (plugin) {
	return `${homebrewRoot(plugin)}/homebrew.json`;
}

export function entitySlug (name) {
	return String(name || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80) || "entity";
}

export function entityVaultPath (plugin, prop, name) {
	return `${homebrewRoot(plugin)}/${prop}/${entitySlug(name)}.json`;
}

export function metaVaultPath (plugin) {
	return `${homebrewRoot(plugin)}/_meta.json`;
}

export async function loadHomebrewFromVault (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return getBrewJson();
	await migrateMonolithHomebrew(plugin);
	const brew = emptyBrew();
	const metaFile = vault.getAbstractFileByPath(metaVaultPath(plugin));
	if (metaFile && !metaFile.children) {
		try {
			const meta = JSON.parse(await vault.read(metaFile));
			if (meta?.sources?.length) brew._meta = meta;
			else if (meta?._meta?.sources?.length) brew._meta = meta._meta;
		} catch (_) { /* keep default meta */ }
	}
	for (const prop of BREW_PROPS) {
		const folder = vault.getAbstractFileByPath(`${homebrewRoot(plugin)}/${prop}`);
		if (!folder?.children) {
			brew[prop] = [];
			continue;
		}
		const list = [];
		for (const child of folder.children) {
			if (child.children || !String(child.path || "").endsWith(".json")) continue;
			try {
				const ent = JSON.parse(await vault.read(child));
				if (ent?.name) list.push(ent);
			} catch (_) { /* skip bad file */ }
		}
		brew[prop] = list;
	}
	setBrewJson(brew);
	return getBrewJson();
}

async function migrateMonolithHomebrew (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return;
	const monolithPath = brewVaultPath(plugin);
	const monolith = vault.getAbstractFileByPath(monolithPath);
	if (!monolith || monolith.children) return;
	let parsed;
	try {
		parsed = JSON.parse(await vault.read(monolith));
	} catch (_) {
		return;
	}
	const brew = normalizeBrew(parsed);
	await ensureFolder(plugin.app, homebrewRoot(plugin));
	await writeVaultJson(plugin, metaVaultPath(plugin), brew._meta);
	for (const prop of BREW_PROPS) {
		await ensureFolder(plugin.app, `${homebrewRoot(plugin)}/${prop}`);
		for (const ent of brew[prop] || []) {
			if (!ent?.name) continue;
			await writeVaultJson(plugin, entityVaultPath(plugin, prop, ent.name), ent);
		}
	}
	const bakPath = `${monolithPath}.bak`;
	const existingBak = vault.getAbstractFileByPath(bakPath);
	if (existingBak && !existingBak.children) await vault.delete(existingBak);
	await vault.rename(monolith, bakPath);
}

export async function saveHomebrewImage (plugin, file) {
	const vault = plugin?.app?.vault;
	if (!vault || !file) throw new Error("Could not save that image.");
	const ext = String(file.name || "").match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "png";
	const stem = String(file.name || "image").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
	const folder = `${homebrewRoot(plugin)}/img`;
	await ensureFolder(plugin.app, folder);
	const path = `${folder}/${stem}-${Date.now().toString(36)}.${ext}`;
	await vault.createBinary(path, await file.arrayBuffer());
	return path;
}

export async function saveHomebrewEntity (plugin, prop, ent, {previousName} = {}) {
	upsertEntity(prop, ent, {previousName});
	const vault = plugin?.app?.vault;
	if (!vault || !ent?.name) return getBrewJson();
	await ensureFolder(plugin.app, `${homebrewRoot(plugin)}/${prop}`);
	await writeVaultJson(plugin, entityVaultPath(plugin, prop, ent.name), ent);
	const prev = String(previousName || "").trim();
	if (prev && entitySlug(prev) !== entitySlug(ent.name)) {
		await deleteVaultFile(plugin, entityVaultPath(plugin, prop, prev));
	}
	await writeVaultJson(plugin, metaVaultPath(plugin), brewJson._meta);
	return getBrewJson();
}

export async function deleteHomebrewEntity (plugin, prop, name) {
	deleteEntity(prop, name);
	await deleteVaultFile(plugin, entityVaultPath(plugin, prop, name));
	return getBrewJson();
}

/** @deprecated Prefer saveHomebrewEntity / deleteHomebrewEntity. Writes every entity file. */
export async function saveHomebrewToVault (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return getBrewJson();
	await ensureFolder(plugin.app, homebrewRoot(plugin));
	await writeVaultJson(plugin, metaVaultPath(plugin), brewJson._meta);
	for (const prop of BREW_PROPS) {
		await ensureFolder(plugin.app, `${homebrewRoot(plugin)}/${prop}`);
		for (const ent of brewJson[prop] || []) {
			if (!ent?.name) continue;
			await writeVaultJson(plugin, entityVaultPath(plugin, prop, ent.name), ent);
		}
	}
	return getBrewJson();
}

async function writeVaultJson (plugin, filePath, value) {
	const vault = plugin?.app?.vault;
	if (!vault) return;
	const folder = filePath.replace(/\/[^/]+$/, "");
	await ensureFolder(plugin.app, folder);
	const text = `${JSON.stringify(value, null, "\t")}\n`;
	const existing = vault.getAbstractFileByPath(filePath);
	if (existing && !existing.children) await vault.modify(existing, text);
	else await vault.create(filePath, text);
}

async function deleteVaultFile (plugin, filePath) {
	const vault = plugin?.app?.vault;
	if (!vault) return;
	const existing = vault.getAbstractFileByPath(filePath);
	if (existing && !existing.children) await vault.delete(existing);
}

export function cacheBrewInDataLoader () {
	const DataLoader = globalThis.DataLoader;
	if (!DataLoader?._pCache_addToCache) return;
	DataLoader._pCache_addToCache({
		allDataMerged: getBrewJson(),
		propAllowlist: new Set(BREW_PROPS),
	});
}

export function cacheEntityInDataLoader (ent, prop) {
	const DataLoader = globalThis.DataLoader;
	const UrlUtil = globalThis.UrlUtil;
	const typeProp = prop || ent?.__prop;
	if (!ent?.name || !typeProp || !DataLoader) return;
	ent.__prop = typeProp;
	const hashBuilder = UrlUtil?.URL_TO_HASH_BUILDER?.[typeProp];
	if (DataLoader._pCache_addEntityToCache && hashBuilder) {
		DataLoader._pCache_addEntityToCache({prop: typeProp, hashBuilder, ent});
		return;
	}
	DataLoader._pCache_addToCache?.({
		allDataMerged: {[typeProp]: [ent]},
		propAllowlist: new Set([typeProp]),
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
			passive: "10",
			senses: "",
			resist: "",
			immune: "",
			conditionImmune: "",
			languages: "Common",
			cr: "0",
			crOverride: false,
			traits: [],
			actions: [],
			bonus: [],
			reactions: [],
			spells: [],
			spellAbility: "int",
			spellKind: "spellcasting",
			description: "",
			lore: "",
			rollTables: [],
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
	let form;
	switch (homebrewType(typeId).id) {
		case "item": form = itemToForm(ent); break;
		case "monster": form = monsterToForm(ent); break;
		case "background": form = backgroundToForm(ent); break;
		case "race": form = raceToForm(ent); break;
		default: form = spellToForm(ent);
	}
	form.image = String(ent._homebrewImage || "");
	return form;
}

let nextNamedRowId = 1;

export function normalizeMonsterForm (form) {
	const next = {...emptyForm("monster"), ...(form || {})};
	next.traits = coerceNamedRows(form?.traits);
	next.actions = coerceNamedRows(form?.actions);
	next.bonus = coerceNamedRows(form?.bonus);
	next.reactions = coerceNamedRows(form?.reactions);
	next.spells = coerceSpells(form?.spells);
	next.spellAbility = String(form?.spellAbility || "int").toLowerCase();
	if (!["int", "wis", "cha"].includes(next.spellAbility)) next.spellAbility = "int";
	next.spellKind = String(form?.spellKind || "spellcasting").toLowerCase() === "innate" ? "innate" : "spellcasting";
	next.crOverride = !!form?.crOverride;
	next.description = String(form?.description || "");
	next.lore = String(form?.lore || "");
	next.rollTables = coerceRollTables(form?.rollTables);
	bumpNamedRowId([next.traits, next.actions, next.bonus, next.reactions, next.spells].flat());
	return next;
}

export function newNamedRow (partial = {}) {
	const recharge = partial.recharge == null || partial.recharge === ""
		? null
		: Math.max(2, Math.min(6, Number(partial.recharge) || 6));
	return {
		id: partial.id || `r${nextNamedRowId++}`,
		name: String(partial.name || ""),
		text: String(partial.text || ""),
		template: String(partial.template || ""),
		recharge,
	};
}

export function buildEntity (typeId, form) {
	const type = homebrewType(typeId);
	let ent;
	switch (type.id) {
		case "item": ent = buildItem(form); break;
		case "monster": ent = buildMonster(form); break;
		case "background": ent = buildBackground(form); break;
		case "race": ent = buildRace(form); break;
		default: ent = buildSpell(form);
	}
	if (ent) ent.__prop = type.prop;
	const image = String(form?.image || "").trim();
	if (ent && image) ent._homebrewImage = image;
	if (ent && type.id === "monster") {
		const paths = coerceRollTables(form?.rollTables).map(it => it.path).filter(Boolean);
		if (paths.length) ent._homebrewRollTables = paths;
	}
	return ent;
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
		passive: parsePassive(form?.passive, wis),
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
	const resist = splitComma(form?.resist).map(it => it.toLowerCase());
	if (resist.length) ent.resist = resist;
	const immune = splitComma(form?.immune).map(it => it.toLowerCase());
	if (immune.length) ent.immune = immune;
	const conditionImmune = splitComma(form?.conditionImmune).map(it => it.toLowerCase());
	if (conditionImmune.length) ent.conditionImmune = conditionImmune;
	const trait = namedRowsToEntries(form?.traits);
	if (trait.length) ent.trait = trait;
	const action = namedRowsToEntries(form?.actions);
	if (action.length) ent.action = action;
	const bonus = namedRowsToEntries(form?.bonus);
	if (bonus.length) ent.bonus = bonus;
	const reaction = namedRowsToEntries(form?.reactions);
	if (reaction.length) ent.reaction = reaction;
	const spells = coerceSpells(form?.spells).filter(it => it.name);
	if (spells.length) {
		const ability = String(form?.spellAbility || "int").toLowerCase();
		const abilityKey = ["int", "wis", "cha"].includes(ability) ? ability : "int";
		const abilityLabel = abilityKey === "wis" ? "Wisdom" : abilityKey === "cha" ? "Charisma" : "Intelligence";
		const who = ent.name || "creature";
		const innate = String(form?.spellKind || "").toLowerCase() === "innate";
		const score = Number(ent[abilityKey]) || 10;
		const mod = Math.floor((score - 10) / 2);
		const pb = crProficiencyBonus(ent.cr);
		const hit = mod + pb;
		const dc = 8 + mod + pb;
		const block = {
			name: innate ? "Innate Spellcasting" : "Spellcasting",
			type: "spellcasting",
			ability: abilityKey,
			headerEntries: [
				`The ${who} casts one of the following spells, using ${abilityLabel} as the spellcasting ability (spell save {@dc ${dc}}, {@hit ${hit}} to hit with spell attacks):`,
			],
		};
		if (!innate) block.displayAs = "action";
		const will = [];
		const slots = {};
		const recharge = {};
		for (const spell of spells) {
			const tag = spellListTag(spell, hit);
			const usage = String(spell.usage || "will").toLowerCase();
			if (usage === "slot") {
				const level = Math.max(0, Math.min(9, Number(spell.slotLevel) || 0));
				const key = String(level);
				if (!slots[key]) slots[key] = {slots: Math.max(0, Number(spell.slots) || (level === 0 ? 0 : 1)), spells: []};
				if (level > 0) slots[key].slots = Math.max(1, Number(spell.slots) || slots[key].slots || 1);
				else delete slots[key].slots;
				slots[key].spells.push(tag);
			} else if (usage === "recharge") {
				const n = Math.max(2, Math.min(6, Number(spell.recharge) || 6));
				const key = String(n);
				if (!recharge[key]) recharge[key] = [];
				recharge[key].push(tag);
			} else {
				will.push(tag);
			}
		}
		if (will.length) block.will = will;
		if (Object.keys(slots).length) block.spells = slots;
		if (Object.keys(recharge).length) block.recharge = recharge;
		ent.spellcasting = [block];
	}
	const fluffEntries = buildMonsterFluffEntries(form);
	if (fluffEntries.length) ent.fluff = {entries: fluffEntries};
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
	form.passive = String(ent.passive ?? (10 + Math.floor(((ent.wis ?? 10) - 10) / 2)));
	form.senses = (ent.senses || []).join(", ");
	form.resist = protToText(ent.resist);
	form.immune = protToText(ent.immune);
	form.conditionImmune = protToText(ent.conditionImmune);
	form.languages = (ent.languages || []).join(", ");
	form.cr = String(ent.cr?.cr ?? ent.cr ?? "0");
	form.crOverride = true;
	form.traits = namedEntriesToRows(ent.trait);
	form.actions = namedEntriesToRows(ent.action);
	form.bonus = namedEntriesToRows(ent.bonus);
	form.reactions = namedEntriesToRows(ent.reaction);
	form.spells = spellsFromEnt(ent);
	form.spellAbility = ent.spellcasting?.[0]?.ability || "int";
	const cast = ent.spellcasting?.[0];
	if (!cast) form.spellKind = "spellcasting";
	else if (cast.displayAs === "action") form.spellKind = "spellcasting";
	else if (/innate/i.test(String(cast.name || "")) || cast.displayAs === "trait" || cast.displayAs == null) {
		form.spellKind = "innate";
	} else form.spellKind = "spellcasting";
	const fluffParts = fluffToDescriptionLore(ent.fluff?.entries);
	form.description = fluffParts.description;
	form.lore = fluffParts.lore;
	form.rollTables = coerceRollTables(ent._homebrewRollTables);
	return form;
}

function buildMonsterFluffEntries (form) {
	const entries = [];
	for (const para of splitParagraphs(form?.description)) entries.push(para);
	const lore = splitParagraphs(form?.lore);
	if (lore.length) {
		entries.push({
			type: "entries",
			name: "Lore",
			entries: lore,
		});
	}
	return entries;
}

function fluffToDescriptionLore (entries) {
	const desc = [];
	const lore = [];
	for (const entry of entries || []) {
		if (typeof entry === "string") {
			desc.push(entry);
			continue;
		}
		if (entry && typeof entry === "object") {
			const name = String(entry.name || "").trim();
			if (/^lore$/i.test(name) && Array.isArray(entry.entries)) {
				lore.push(entriesToText(entry.entries));
				continue;
			}
			const text = entriesToText(entry.entries != null ? entry.entries : entry);
			if (text) desc.push(text);
		}
	}
	return {
		description: desc.filter(Boolean).join("\n\n"),
		lore: lore.filter(Boolean).join("\n\n"),
	};
}

function coerceRollTables (raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	const seen = new Set();
	for (const item of raw) {
		const path = typeof item === "string" ? item.trim() : String(item?.path || "").trim();
		if (!path || seen.has(path)) continue;
		seen.add(path);
		let name = typeof item === "string" ? "" : String(item?.name || "").trim();
		if (!name) {
			if (path.startsWith("loot:")) name = path.slice("loot:".length);
			else name = path.replace(/^.*\//, "").replace(/\.md$/i, "");
		}
		out.push({path, name});
	}
	return out;
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

export function parseSpeed (raw) {
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

export function speedToText (speed) {
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

function coerceNamedRows (raw) {
	if (Array.isArray(raw)) {
		return raw.map(it => newNamedRow({
			id: it?.id,
			name: it?.name,
			text: it?.text != null ? it.text : entriesToText(it?.entries),
			template: it?.template,
			recharge: it?.recharge,
		})).filter(it => it.id);
	}
	return parseNamedEntries(raw).map(it => newNamedRow({
		name: it.name,
		text: entriesToText(it.entries),
	}));
}

function namedRowsToEntries (raw) {
	return coerceNamedRows(raw).filter(it => String(it.name || "").trim()).map((it) => {
		const base = String(it.name).trim().replace(/\s*\{@recharge(?:\s+\d+)?(?:\|[^}]*)?\}\s*$/i, "").trim();
		const recharge = it.recharge == null ? null : Math.max(2, Math.min(6, Number(it.recharge) || 6));
		const tag = recharge == null ? "" : (recharge === 6 ? " {@recharge}" : ` {@recharge ${recharge}}`);
		return {
			name: `${base}${tag}`.trim(),
			entries: String(it.text || "").trim() ? [String(it.text).trim()] : [""],
		};
	});
}

function namedEntriesToRows (list) {
	return (list || []).map((it) => {
		const rawName = String(it?.name || "");
		const rechargeMatch = rawName.match(/\{@recharge(?:\s+(\d+))?(?:\|[^}]*)?\}/i);
		const recharge = rechargeMatch ? Number(rechargeMatch[1] || 6) : null;
		const name = rawName.replace(/\s*\{@recharge(?:\s+\d+)?(?:\|[^}]*)?\}\s*/gi, " ").replace(/\s+/g, " ").trim();
		return newNamedRow({
			name,
			text: entriesToText(it?.entries),
			recharge,
		});
	});
}

function coerceSpells (raw) {
	if (!Array.isArray(raw)) return [];
	return raw.map((it) => {
		const usage = ["will", "slot", "recharge"].includes(String(it?.usage || "").toLowerCase())
			? String(it.usage).toLowerCase()
			: "will";
		return {
			id: it?.id || `r${nextNamedRowId++}`,
			name: String(it?.name || "").trim(),
			source: String(it?.source || it?.s || "XPHB").trim() || "XPHB",
			u: it?.u || "",
			usage,
			slotLevel: Math.max(0, Math.min(9, Number(it?.slotLevel) || 0)),
			slots: Math.max(1, Number(it?.slots) || 1),
			recharge: Math.max(2, Math.min(6, Number(it?.recharge) || 6)),
			hasAttack: Boolean(it?.hasAttack),
			damageTag: typeof it?.damageTag === "string" ? it.damageTag : "",
			enriched: Boolean(it?.enriched),
		};
	}).filter(it => it.name);
}

export function spellListTag (spell, hit) {
	const base = `{@spell ${spell.name}|${spell.source || "XPHB"}}`;
	const label = String(spell.name || "").trim();
	const parts = [];
	if (spell.hasAttack) parts.push(label ? `{@hit ${hit}||${label}}` : `{@hit ${hit}}`);
	if (spell.damageTag) parts.push(namedDamageTag(spell.damageTag, label));
	if (!parts.length) return base;
	return `${base} (${parts.join(", ")})`;
}

function namedDamageTag (damageTag, label) {
	const raw = String(damageTag || "").trim();
	if (!raw || !label) return raw;
	const m = raw.match(/^\{@(damage|dice)\s+([^}|]+)(?:\|([^}]*)?)?\}$/i);
	if (!m) return raw;
	const kind = m[1].toLowerCase();
	const dice = m[2].trim();
	const rest = String(m[3] || "");
	const parts = rest.split("|").map(p => p.trim());
	// Tag shape: {@damage dice|display|name|damageType}
	// Keep a trailing damage type if present (often sole segment when we stash |||type).
	const type = parts.reverse().find(p => p && !p.includes(" ") && DAMAGE_TYPE_SET.has(p.toLowerCase())) || "";
	if (kind === "damage" && type) return `{@damage ${dice}||${label}|${type.toLowerCase()}}`;
	return `{@${kind} ${dice}||${label}}`;
}

const DAMAGE_TYPE_SET = new Set([
	"acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
	"piercing", "poison", "psychic", "radiant", "slashing", "thunder",
]);

function spellsFromEnt (ent) {
	const out = [];
	const seen = new Set();
	const push = (blob, usage, extra = {}) => {
		const text = typeof blob === "string" ? blob : "";
		for (const m of text.matchAll(/\{@spell ([^}]+)\}/gi)) {
			const [name, source] = m[1].split("|").map(part => part.trim());
			if (!name) continue;
			const src = source || "XPHB";
			const key = `${name.toLowerCase()}|${src.toLowerCase()}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const damageTag = (text.match(/\{@damage\s+[^}]+\}/i) || text.match(/\{@dice\s+[^}]+\}/i) || [""])[0];
			const hasAttack = /\{@hit\b/i.test(text);
			const enriched = hasAttack || Boolean(damageTag);
			out.push({
				id: `r${nextNamedRowId++}`,
				name,
				source: src,
				u: "",
				usage,
				slotLevel: extra.slotLevel ?? 1,
				slots: extra.slots ?? 1,
				recharge: extra.recharge ?? 6,
				hasAttack,
				damageTag,
				enriched,
			});
		}
	};
	for (const block of ent?.spellcasting || []) {
		for (const blob of block.will || []) push(blob, "will");
		if (block.spells && typeof block.spells === "object") {
			for (const [level, slot] of Object.entries(block.spells)) {
				const list = Array.isArray(slot) ? slot : slot?.spells;
				const slots = Array.isArray(slot) ? 1 : Math.max(1, Number(slot?.slots) || 1);
				if (!Array.isArray(list)) continue;
				for (const blob of list) push(blob, "slot", {slotLevel: Number(level) || 0, slots});
			}
		}
		if (block.recharge && typeof block.recharge === "object") {
			for (const [n, list] of Object.entries(block.recharge)) {
				if (!Array.isArray(list)) continue;
				for (const blob of list) push(blob, "recharge", {recharge: Number(n) || 6});
			}
		}
		for (const blob of Object.values(block.daily || {}).flat()) push(blob, "will");
	}
	return out;
}

function crProficiencyBonus (cr) {
	const label = String(cr?.cr ?? cr ?? "0");
	const n = label === "1/8" || label === "1/4" || label === "1/2" ? 0 : (Number(label) || 0);
	if (n < 5) return 2;
	return Math.ceil(n / 4) + 1;
}

function bumpNamedRowId (rows) {
	for (const it of rows || []) {
		const n = Number(String(it.id || "").replace(/^r/, ""));
		if (Number.isFinite(n) && n >= nextNamedRowId) nextNamedRowId = n + 1;
	}
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

function parsePassive (value, wis) {
	const auto = 10 + Math.floor((wis - 10) / 2);
	if (value == null || String(value).trim() === "") return auto;
	const n = Number(value);
	return Number.isFinite(n) ? n : auto;
}

function protToText (list) {
	return (list || []).map(it => {
		if (typeof it === "string") return it;
		const types = it?.resist || it?.immune || it?.vulnerable || [];
		const bits = [];
		if (it?.preNote) bits.push(it.preNote);
		if (types.length) bits.push(types.join(", "));
		if (it?.note) bits.push(it.note);
		return bits.filter(Boolean).join(" ");
	}).filter(Boolean).join(", ");
}

function titleCase (value) {
	return String(value || "").replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

installBrewUtil();

Object.assign(globalThis.FiveEToolsObsidian ||= {}, {
	hpAverageFromFormula,
	emptyBrew,
	entityToForm,
	buildEntity,
	applyBrewJson,
	getBrewJson,
	upsertEntity,
	cacheBrewInDataLoader,
	cacheEntityInDataLoader,
});
