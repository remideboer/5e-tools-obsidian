export const CREATOR_STEPS = [
	{id: "concept", title: "Character Concept", short: "Concept"},
	{id: "class", title: "Choose a Class", short: "Class"},
	{id: "subclass", title: "Choose a Subclass", short: "Subclass"},
	{id: "abilities", title: "Determine Ability Scores", short: "Abilities"},
	{id: "species", title: "Choose a Species", short: "Species"},
	{id: "background", title: "Choose a Background", short: "Background"},
	{id: "equipment", title: "Determine Starting Equipment", short: "Equipment"},
];

export const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
export const ABILITY_LABELS = {
	str: "Strength",
	dex: "Dexterity",
	con: "Constitution",
	int: "Intelligence",
	wis: "Wisdom",
	cha: "Charisma",
};
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_TOTAL = 27;
export const POINT_BUY_COST = {8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9};

/** Ability method chips: Standard Array, Point Buy, or random Roll. */
export const ABILITY_METHODS = [
	{id: "standard-array", label: "Standard Array"},
	{id: "point-buy", label: "Point Buy"},
	{id: "roll", label: "Roll"},
];

/** Per-stat (and roll-all) dice styles when method is Roll. */
export const ROLL_STYLES = [
	{id: "normal", label: "Normal", notation: "4d6dl1", blurb: "4d6, drop the lowest"},
	{id: "hero", label: "Hero", notation: "3d6+6", blurb: "3d6 + 6"},
];

export const CONCEPT_ARCHETYPES = [
	{id: "martial", label: "Martial"},
	{id: "arcane", label: "Arcane"},
	{id: "divine", label: "Divine"},
	{id: "primal", label: "Primal"},
	{id: "skill", label: "Skill"},
];

const CLASS_ARCHETYPE = {
	Barbarian: "martial",
	Fighter: "martial",
	Monk: "martial",
	Paladin: "divine",
	Ranger: "primal",
	Rogue: "skill",
	Bard: "skill",
	Cleric: "divine",
	Druid: "primal",
	Wizard: "arcane",
	Sorcerer: "arcane",
	Warlock: "arcane",
};

export function defaultDraft () {
	return {
		name: "",
		nameGroup: "",
		nameSuggestions: [],
		notes: "",
		archetype: "",
		className: "",
		classSource: "XPHB",
		subclassName: "",
		subclassSource: "",
		abilityMethod: "standard-array",
		abilities: emptyAbilities(),
		abilityRollStyle: Object.fromEntries(ABILITY_KEYS.map(key => [key, "normal"])),
		abilityRollDetail: Object.fromEntries(ABILITY_KEYS.map(key => [key, null])),
		speciesName: "",
		speciesSource: "XPHB",
		backgroundName: "",
		backgroundSource: "XPHB",
		backgroundAbility: {},
		backgroundAbilityMode: 0,
		backgroundAbilityDone: false,
		equipmentMethod: "packages",
		classPackage: "",
		backgroundPackage: "",
		goldCp: 0,
	};
}

export function emptyAbilities () {
	return Object.fromEntries(ABILITY_KEYS.map(key => [key, null]));
}

export function abilityModifier (score) {
	const n = Number(score);
	if (!Number.isFinite(n)) return 0;
	return Math.floor((n - 10) / 2);
}

export function pointBuySpent (abilities) {
	let spent = 0;
	for (const key of ABILITY_KEYS) {
		const score = Number(abilities?.[key]);
		if (!Number.isFinite(score)) continue;
		spent += POINT_BUY_COST[score] ?? Infinity;
	}
	return spent;
}

export function finalAbilities (draft) {
	const out = {};
	for (const key of ABILITY_KEYS) {
		const base = Number(draft?.abilities?.[key]);
		const bonus = Number(draft?.backgroundAbility?.[key]) || 0;
		out[key] = (Number.isFinite(base) ? base : 10) + bonus;
	}
	return out;
}

export function rollStyleMeta (styleId) {
	return ROLL_STYLES.find(style => style.id === styleId) || ROLL_STYLES[0];
}

export function classArchetype (className) {
	return CLASS_ARCHETYPE[String(className || "").trim()] || "";
}

export function sortClassesByArchetype (classes, archetype) {
	const list = Array.isArray(classes) ? classes.slice() : [];
	if (!archetype) return list.sort((a, b) => a.name.localeCompare(b.name));
	return list.sort((a, b) => {
		const aMatch = classArchetype(a.name) === archetype ? 0 : 1;
		const bMatch = classArchetype(b.name) === archetype ? 0 : 1;
		return aMatch - bMatch || a.name.localeCompare(b.name);
	});
}

/** Steps for the current draft; subclass is omitted when the class has none. */
export function activeSteps (draft, catalog) {
	return CREATOR_STEPS.filter((step) => {
		if (step.id !== "subclass") return true;
		return subclassesFor(draft, catalog).length > 0;
	});
}

export function subclassesFor (draft, catalog) {
	if (!draft?.className || !catalog?.subclasses) return [];
	return catalog.subclasses.filter(sub => (
		sub.className === draft.className
		&& sub.classSource === (draft.classSource || "XPHB")
	));
}

export function stepIndex (stepId, draft, catalog) {
	const steps = activeSteps(draft, catalog);
	const index = steps.findIndex(step => step.id === stepId);
	return index < 0 ? 0 : index;
}

export function stepMessage (stepId, draft, catalog) {
	switch (stepId) {
		case "concept":
			return String(draft?.name || "").trim() ? "" : "Enter a character name.";
		case "class":
			return draft?.className ? "" : "Choose a class.";
		case "subclass":
			if (!subclassesFor(draft, catalog).length) return "";
			return draft?.subclassName ? "" : "Choose a subclass.";
		case "abilities":
			return abilitiesValid(draft) ? "" : abilityError(draft);
		case "species":
			return draft?.speciesName ? "" : "Choose a species.";
		case "background":
			if (!draft?.backgroundName) return "Choose a background.";
			if (!draft?.backgroundAbilityDone) return "Assign the background ability bonuses.";
			return "";
		case "equipment":
			if (draft?.equipmentMethod === "wealth") return "";
			if (!draft?.classPackage) return "Choose a class equipment package.";
			if (!draft?.backgroundPackage) return "Choose a background equipment package.";
			return "";
		default:
			return "";
	}
}

export function stepValid (stepId, draft, catalog) {
	return !stepMessage(stepId, draft, catalog);
}

export function canEnterStep (draft, targetId, catalog) {
	const steps = activeSteps(draft, catalog);
	const target = steps.findIndex(step => step.id === targetId);
	if (target < 0) return false;
	for (let i = 0; i < target; i++) {
		if (!stepValid(steps[i].id, draft, catalog)) return false;
	}
	return true;
}

function abilitiesValid (draft) {
	const scores = ABILITY_KEYS.map(key => Number(draft?.abilities?.[key]));
	if (scores.some(score => !Number.isFinite(score))) return false;
	if (draft?.abilityMethod === "point-buy") {
		return scores.every(score => score >= 8 && score <= 15)
			&& pointBuySpent(draft.abilities) === POINT_BUY_TOTAL;
	}
	if (draft?.abilityMethod === "roll") {
		return scores.every(score => score >= 3 && score <= 18);
	}
	const sorted = scores.slice().sort((a, b) => b - a);
	return STANDARD_ARRAY.every((value, index) => sorted[index] === value);
}

function abilityError (draft) {
	const scores = ABILITY_KEYS.map(key => Number(draft?.abilities?.[key]));
	if (scores.some(score => !Number.isFinite(score))) {
		return draft?.abilityMethod === "roll"
			? "Roll a score for every ability."
			: "Assign a score to every ability.";
	}
	if (draft?.abilityMethod === "point-buy") {
		const spent = pointBuySpent(draft.abilities);
		if (spent > POINT_BUY_TOTAL) return "Point buy is over budget.";
		if (spent < POINT_BUY_TOTAL) return `Spend all ${POINT_BUY_TOTAL} points (${POINT_BUY_TOTAL - spent} left).`;
		return "Ability scores must be between 8 and 15.";
	}
	if (draft?.abilityMethod === "roll") return "Rolled scores must be between 3 and 18.";
	return "Use each standard-array value once (15, 14, 13, 12, 10, 8).";
}

/** All weighted ASI rows on a background (2024: usually +2/+1 or +1/+1/+1). */
export function backgroundAbilityOptionsList (background) {
	const block = Array.isArray(background?.ability) ? background.ability : [];
	const out = [];
	for (const entry of block) {
		const weighted = entry?.choose?.weighted;
		if (weighted?.from?.length && weighted?.weights?.length) {
			out.push({
				from: weighted.from.map(key => String(key).toLowerCase()),
				weights: weighted.weights.map(Number),
			});
		}
	}
	return out;
}

/** Preferred row: selected index, else first. */
export function backgroundAbilityOptions (background, modeIndex = 0) {
	const list = backgroundAbilityOptionsList(background);
	if (!list.length) return null;
	return list[Math.max(0, Math.min(list.length - 1, Number(modeIndex) || 0))] || list[0];
}

/** True when `assigned` matches one of the background's weighted ability rows. */
export function backgroundAbilityMatches (options, assigned) {
	if (!options) return true;
	const used = new Map();
	for (const key of options.from) {
		const value = Number(assigned?.[key]) || 0;
		if (!value) continue;
		used.set(key, value);
	}
	const weights = options.weights.slice().sort((a, b) => b - a);
	const values = [...used.values()].sort((a, b) => b - a);
	if (values.length !== weights.length) return false;
	return weights.every((weight, index) => values[index] === weight)
		&& [...used.keys()].every(key => options.from.includes(key));
}

export function normalizeBackgroundAbility (options, current = {}) {
	if (!options) return {};
	const next = {};
	for (const key of options.from) {
		const value = Number(current?.[key]) || 0;
		if (value) next[key] = value;
	}
	return next;
}
