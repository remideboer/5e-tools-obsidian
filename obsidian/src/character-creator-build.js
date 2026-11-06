import {findBackground, findClass, findSpecies, findSubclass, formatGp, parseGoldAlternative} from "./character-creator-data.js";
import {ABILITY_KEYS, ABILITY_LABELS, abilityModifier, finalAbilities} from "./character-creator-state.js";

const SKILLS = [
	{name: "Athletics", ability: "str"},
	{name: "Acrobatics", ability: "dex"},
	{name: "Sleight of Hand", ability: "dex"},
	{name: "Stealth", ability: "dex"},
	{name: "Arcana", ability: "int"},
	{name: "History", ability: "int"},
	{name: "Investigation", ability: "int"},
	{name: "Nature", ability: "int"},
	{name: "Religion", ability: "int"},
	{name: "Animal Handling", ability: "wis"},
	{name: "Insight", ability: "wis"},
	{name: "Medicine", ability: "wis"},
	{name: "Perception", ability: "wis"},
	{name: "Survival", ability: "wis"},
	{name: "Deception", ability: "cha"},
	{name: "Intimidation", ability: "cha"},
	{name: "Performance", ability: "cha"},
	{name: "Persuasion", ability: "cha"},
];

export function buildLocalCharacterCard (draft, catalog) {
	const name = String(draft?.name || "").trim() || "Unnamed";
	const cls = findClass(catalog, draft.className, draft.classSource);
	const subclass = draft.subclassName
		? findSubclass(catalog, draft.subclassName, draft.subclassSource, draft.className)
		: null;
	const species = findSpecies(catalog, draft.speciesName, draft.speciesSource);
	const background = findBackground(catalog, draft.backgroundName, draft.backgroundSource);
	if (!cls || !species || !background) throw new Error("Character draft is incomplete.");

	const abilities = finalAbilities(draft);
	const level = 1;
	const prof = 2;
	const conMod = abilityModifier(abilities.con);
	const hdFaces = cls.hdFaces || 8;
	const hpMax = hdFaces + conMod;
	const speed = species.speed || 30;
	const skillProfs = collectSkills(cls, background);
	const saveProfs = new Set((cls.raw?.proficiency || []).map(key => String(key).toLowerCase()));
	const gear = collectGear(draft, cls, background);
	const coins = collectCoins(draft, cls, background, gear);
	const ac = estimateAc(abilities, gear);
	const rolls = buildRolls(abilities, skillProfs, saveProfs, prof);
	const features = buildFeatures(cls, subclass, species, background);
	const choices = buildChoices(draft, cls, subclass, background, skillProfs);
	const refs = buildRefs(draft, cls, subclass, species, background, gear);
	const id = localCharacterId(name);
	const classLabel = subclass
		? `${cls.name} ${level} (${subclass.shortName || subclass.name})`
		: `${cls.name} ${level}`;

	return {
		ddbId: id,
		name,
		species: species.name,
		classes: classLabel,
		level,
		background: background.name,
		ac,
		hpMax,
		hpCurrent: hpMax,
		tempHp: 0,
		speed,
		abilities,
		edition: "one",
		refs,
		traits: null,
		rolls,
		actions: [],
		slots: [],
		coins,
		conditions: [],
		deathSaves: {success: 0, fail: 0, stable: false},
		inspiration: false,
		xp: 0,
		xpAdjustment: null,
		senses: speciesSenses(species),
		speeds: [{label: "Walk", value: speed}],
		defenses: speciesDefenses(species),
		proficiencies: buildProficiencyLines(cls, background, skillProfs),
		spellcasting: [],
		hitDice: [{className: cls.name, dice: `1d${hdFaces}`, max: 1, spent: 0}],
		choices,
		features,
		companions: [],
		story: {
			personalityTraits: [],
			ideals: [],
			bonds: [],
			flaws: [],
			allies: "",
			organizations: "",
			enemies: "",
			backstory: String(draft?.notes || "").trim(),
			notes: "Created in the Obsidian character creator (2024). Spell lists are empty in v1.",
		},
		avatar: null,
	};
}

function localCharacterId (name) {
	const slug = String(name || "hero")
		.toLowerCase()
		.replace(/['']/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40) || "hero";
	const suffix = Math.random().toString(36).slice(2, 8);
	return `local-${slug}-${suffix}`;
}

function collectSkills (cls, background) {
	const set = new Set(background.skills || []);
	for (const skill of cls.fixedSkills || []) set.add(skill);
	const choice = cls.skillChoices;
	if (choice?.from?.length) {
		let taken = 0;
		for (const skill of choice.from) {
			if (taken >= (choice.count || 0)) break;
			if (set.has(skill)) continue;
			set.add(skill);
			taken += 1;
		}
	}
	return set;
}

function collectGear (draft, cls, background) {
	if (draft.equipmentMethod === "wealth") return [];
	const items = [];
	const classPkg = (cls.packages || []).find(pkg => pkg.id === draft.classPackage);
	const bgPkg = (background.packages || []).find(pkg => pkg.id === draft.backgroundPackage);
	for (const pkg of [classPkg, bgPkg]) {
		if (!pkg) continue;
		for (const item of pkg.items || []) {
			if (!item.name && !item.uid) continue;
			items.push({
				name: item.name || item.uid,
				uid: item.uid,
				qty: item.quantity || 1,
				equipped: isLikelyEquipped(item.name || item.uid),
			});
		}
	}
	return items;
}

function collectCoins (draft, cls, background, gear) {
	const coins = {gp: 0, sp: 0, cp: 0, ep: 0, pp: 0};
	if (draft.equipmentMethod === "wealth") {
		const cp = parseGoldAlternative(cls.goldAlternative) || draft.goldCp || 0;
		coins.gp = Math.floor(cp / 100);
		coins.sp = Math.floor((cp % 100) / 10);
		coins.cp = cp % 10;
		return coins;
	}
	let cp = 0;
	const classPkg = (cls.packages || []).find(pkg => pkg.id === draft.classPackage);
	const bgPkg = (background.packages || []).find(pkg => pkg.id === draft.backgroundPackage);
	for (const pkg of [classPkg, bgPkg]) {
		for (const item of pkg?.items || []) cp += Number(item.valueCp) || 0;
	}
	coins.gp = Math.floor(cp / 100);
	coins.sp = Math.floor((cp % 100) / 10);
	coins.cp = cp % 10;
	return coins;
}

function isLikelyEquipped (name) {
	return /\b(armor|mail|leather|shield|sword|axe|bow|staff|dagger|mace|hammer|spear|crossbow|rapier|scimitar|flail|trident|whip|club|javelin)\b/i.test(String(name || ""));
}

function estimateAc (abilities, gear) {
	const dex = abilityModifier(abilities.dex);
	let best = 10 + dex;
	let shield = 0;
	for (const item of gear) {
		const label = String(item.name || "").toLowerCase();
		if (/\bshield\b/.test(label)) shield = 2;
		const armor = armorBase(label);
		if (armor) {
			const value = armor.base + Math.min(dex, armor.dexCap);
			if (value > best) best = value;
		}
	}
	return best + shield;
}

function armorBase (label) {
	if (/plate/.test(label)) return {base: 18, dexCap: 0};
	if (/splint/.test(label)) return {base: 17, dexCap: 0};
	if (/chain mail/.test(label)) return {base: 16, dexCap: 0};
	if (/ring mail/.test(label)) return {base: 14, dexCap: 0};
	if (/half plate/.test(label)) return {base: 15, dexCap: 2};
	if (/breastplate/.test(label)) return {base: 14, dexCap: 2};
	if (/scale|hide|chain shirt/.test(label)) return {base: 13, dexCap: 2};
	if (/studded/.test(label)) return {base: 12, dexCap: 99};
	if (/leather|padded/.test(label)) return {base: 11, dexCap: 99};
	return null;
}

function buildRolls (abilities, skillProfs, saveProfs, prof) {
	const skills = SKILLS.map(skill => {
		const proficient = skillProfs.has(skill.name);
		return {
			name: skill.name,
			ability: skill.ability,
			mod: abilityModifier(abilities[skill.ability]) + (proficient ? prof : 0),
			proficient,
		};
	});
	const perception = skills.find(skill => skill.name === "Perception");
	return {
		proficiency: prof,
		initiative: abilityModifier(abilities.dex),
		passivePerception: 10 + (perception?.mod || 0),
		saves: ABILITY_KEYS.map(key => ({
			key,
			label: ABILITY_LABELS[key],
			mod: abilityModifier(abilities[key]) + (saveProfs.has(key) ? prof : 0),
			proficient: saveProfs.has(key),
		})),
		skills,
	};
}

function buildFeatures (cls, subclass, species, background) {
	const out = [];
	for (const name of species.traits || []) out.push({name, group: species.name, snippet: "Species trait"});
	if (background.feat) out.push({name: background.feat, group: background.name, snippet: "Origin feat"});
	for (const entry of cls.raw?.classFeatures || []) {
		const text = typeof entry === "string" ? entry : entry?.classFeature || "";
		const parts = String(text).split("|");
		const level = Number(parts[parts.length - 1]) || 0;
		if (level !== 1) continue;
		const name = parts[0].trim();
		if (name && !/proficienc/i.test(name)) out.push({name, group: cls.name, snippet: "Class feature"});
	}
	if (subclass) {
		for (const entry of subclass.raw?.subclassFeatures || []) {
			const text = typeof entry === "string" ? entry : "";
			const parts = String(text).split("|");
			const level = Number(parts[parts.length - 1]) || 0;
			if (level > 1) continue;
			const name = parts[0].trim();
			if (name) out.push({name, group: subclass.shortName || subclass.name, snippet: "Subclass feature"});
		}
	}
	return out;
}

function buildChoices (draft, cls, subclass, background, skillProfs) {
	const lines = [];
	if (draft.notes) lines.push(`Concept: ${draft.notes}`);
	if (subclass) lines.push(`Subclass: ${subclass.name}`);
	lines.push(`Ability method: ${draft.abilityMethod}`);
	if (draft.abilityMethod === "roll") {
		const styles = ABILITY_KEYS.map(key => `${key.toUpperCase()} ${(draft.abilityRollStyle?.[key] || "normal")}`);
		lines.push(`Roll styles: ${styles.join(", ")}`);
	}
	const bonuses = Object.entries(draft.backgroundAbility || {})
		.filter(([, value]) => Number(value))
		.map(([key, value]) => `${ABILITY_LABELS[key]} ${Number(value) > 0 ? "+" : ""}${value}`);
	if (bonuses.length) lines.push(`Background ASI: ${bonuses.join(", ")}`);
	lines.push(`Skills: ${[...skillProfs].sort().join(", ") || "—"}`);
	if (draft.equipmentMethod === "wealth") {
		lines.push(`Equipment: starting wealth (${cls.goldAlternative || "gold"})`);
	} else {
		lines.push(`Class package ${draft.classPackage}; background package ${draft.backgroundPackage}`);
	}
	lines.push("Spellcasting not chosen in the creator (v1).");
	return lines;
}

function buildRefs (draft, cls, subclass, species, background, gear) {
	const refs = [
		{kind: "species", name: species.name, label: species.name, edition: "one"},
		{kind: "class", name: cls.name, label: `${cls.name} 1`, edition: "one"},
		{kind: "background", name: background.name, label: background.name, edition: "one"},
	];
	if (subclass) {
		refs.push({
			kind: "subclass",
			name: subclass.name,
			label: subclass.shortName || subclass.name,
			edition: "one",
		});
	}
	if (background.feat) {
		refs.push({kind: "feat", name: background.feat, label: background.feat, edition: "one"});
	}
	for (const item of gear) {
		refs.push({
			kind: "item",
			name: item.name,
			label: item.name,
			edition: "one",
			qty: item.qty,
			equipped: !!item.equipped,
			attunable: false,
		});
	}
	return refs;
}

function buildProficiencyLines (cls, background, skillProfs) {
	const lines = [];
	const armor = cls.raw?.startingProficiencies?.armor;
	const weapons = cls.raw?.startingProficiencies?.weapons;
	if (Array.isArray(armor) && armor.length) lines.push(`Armor: ${armor.join(", ")}`);
	if (Array.isArray(weapons) && weapons.length) lines.push(`Weapons: ${weapons.join(", ")}`);
	if (skillProfs.size) lines.push(`Skills: ${[...skillProfs].sort().join(", ")}`);
	if (background.tools?.length) lines.push(`Tools: ${background.tools.join(", ")}`);
	return lines;
}

function speciesSenses (species) {
	const darkvision = Number(species.raw?.darkvision) || 0;
	if (!darkvision) return [];
	return [`Darkvision ${darkvision} ft.`];
}

function speciesDefenses (species) {
	const resist = species.raw?.resist;
	if (!Array.isArray(resist) || !resist.length) return [];
	return [`Resistance: ${resist.join(", ")}`];
}

export function estimatedHp (draft, catalog) {
	const cls = findClass(catalog, draft.className, draft.classSource);
	if (!cls) return null;
	const abilities = finalAbilities(draft);
	return (cls.hdFaces || 8) + abilityModifier(abilities.con);
}

export function draftSummaryLines (draft, catalog) {
	const lines = [];
	if (draft.name) lines.push(["Name", draft.name]);
	if (draft.className) lines.push(["Class", draft.className]);
	if (draft.subclassName) lines.push(["Subclass", draft.subclassName]);
	const abs = finalAbilities(draft);
	if (ABILITY_KEYS.every(key => draft.abilities?.[key] != null)) {
		lines.push(["Abilities", ABILITY_KEYS.map(key => `${key.toUpperCase()} ${abs[key]}`).join(" ")]);
	}
	if (draft.speciesName) lines.push(["Species", draft.speciesName]);
	if (draft.backgroundName) lines.push(["Background", draft.backgroundName]);
	if (draft.equipmentMethod === "wealth") lines.push(["Equipment", "Starting wealth"]);
	else if (draft.classPackage || draft.backgroundPackage) {
		lines.push(["Equipment", `Class ${draft.classPackage || "—"} / BG ${draft.backgroundPackage || "—"}`]);
	}
	const hp = estimatedHp(draft, catalog);
	if (hp != null && draft.className) lines.push(["Est. HP", String(hp)]);
	return lines;
}

export {formatGp};
