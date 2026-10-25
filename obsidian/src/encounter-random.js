import {listEntities} from "./search-index.js";
import {getMonsterMeta, habitatFilterOptions} from "./bestiary-meta.js";
import {encounterDifficulty, normalizeParty, xpBudgetRange, xpFromCr} from "./encounter-difficulty.js";
import {getParser} from "./fiveetools-host.js";

export const ENCOUNTER_TYPES = [
	{id: "boss", label: "Boss"},
	{id: "boss-minions", label: "Boss + minions"},
	{id: "group", label: "Group"},
];

export const DIFFICULTY_OPTIONS = [
	{id: "low", label: "Low"},
	{id: "moderate", label: "Moderate"},
	{id: "high", label: "High"},
];

export const SETTING_OPTIONS = [
	{id: "", label: "Any"},
	{id: "wilderness", label: "Wilderness"},
	{id: "urban", label: "Urban"},
	{id: "underdark", label: "Underdark / dungeon"},
	{id: "aquatic", label: "Aquatic"},
	{id: "planar", label: "Planar"},
];

export const THEME_OPTIONS = [
	{id: "", label: "Any"},
	{id: "undead", label: "Undead"},
	{id: "fey", label: "Fey"},
	{id: "dragon", label: "Dragon"},
	{id: "cosmic", label: "Cosmic horror"},
	{id: "demonic", label: "Demonic"},
	{id: "planar", label: "Planar"},
	{id: "underdark", label: "Underdark"},
	{id: "pirate", label: "Pirate"},
	{id: "bandit", label: "Bandit"},
	{id: "evil", label: "Evil"},
	{id: "social", label: "Social"},
];

const SETTING_ENVS = {
	wilderness: ["arctic", "coastal", "desert", "forest", "grassland", "hill", "mountain", "swamp"],
	urban: ["urban"],
	underdark: ["underdark"],
	aquatic: ["coastal", "underwater"],
};

const PIRATE_RE = /\b(pirate|buccaneer|corsair|sahuagin|merfolk|sea\s*spawn|kraken)\b/i;
const BANDIT_RE = /\b(bandit|brigand|thug|raider|scout|assassin|cutthroat|highway)\b/i;

/**
 * @param {{setting?: string, habitat?: string, theme?: string}} opts
 */
export function buildBestiaryFilters ({setting = "", habitat = "", theme = ""} = {}) {
	const filters = {
		types: [],
		crs: [],
		sizes: [],
		alignments: [],
		environments: [],
	};

	if (habitat) {
		filters.environments = [habitat];
	} else if (setting === "planar") {
		filters.environments = planarEnvironmentIds();
	} else if (setting && SETTING_ENVS[setting]) {
		filters.environments = [...SETTING_ENVS[setting]];
	}

	const t = String(theme || "");
	if (t === "undead") filters.types = ["undead"];
	else if (t === "fey") filters.types = ["fey"];
	else if (t === "dragon") filters.types = ["dragon"];
	else if (t === "cosmic") filters.types = ["aberration"];
	else if (t === "demonic") filters.types = ["fiend"];
	else if (t === "social" || t === "bandit") filters.types = ["humanoid"];
	else if (t === "evil") filters.alignments = ["E"];
	else if (t === "underdark" && !filters.environments.length) filters.environments = ["underdark"];
	else if (t === "planar" && !filters.environments.length) {
		filters.types = ["celestial", "fiend", "elemental"];
	} else if (t === "pirate" && !filters.environments.length) {
		filters.environments = ["coastal", "underwater"];
	}

	return filters;
}

export function habitatSelectOptions () {
	return [{id: "", label: "Any"}, ...habitatFilterOptions()];
}

/**
 * @param {{
 *   party: object,
 *   difficulty?: string,
 *   type?: string,
 *   setting?: string,
 *   habitat?: string,
 *   theme?: string,
 * }} opts
 */
export async function generateRandomEncounter ({
	party,
	difficulty = "moderate",
	type = "group",
	setting = "",
	habitat = "",
	theme = "",
} = {}) {
	const normalized = normalizeParty(party);
	const budget = xpBudgetRange(normalized, difficulty);
	const filters = buildBestiaryFilters({setting, habitat, theme});
	const docs = listEntities({
		categoriesExact: ["bestiary"],
		bestiaryFilters: filters,
	});
	const pool = docs
		.map(doc => toCandidate(doc, theme, normalized.level))
		.filter(Boolean);

	if (!pool.length) {
		throw new Error("No creatures match those filters (including homebrew).");
	}

	const shape = String(type || "group");
	let best = null;
	const attempts = 10;
	for (let i = 0; i < attempts; i++) {
		const picks = shape === "boss"
			? pickBoss(pool, budget, normalized)
			: shape === "boss-minions"
				? pickBossMinions(pool, budget, normalized)
				: pickGroup(pool, budget, normalized);
		if (!picks?.length) continue;
		const totalXp = picks.reduce((sum, p) => sum + p.xp * p.count, 0);
		const score = Math.abs(totalXp - budget.target);
		if (!best || score < best.score) best = {picks, totalXp, score};
		if (totalXp >= budget.min && totalXp <= budget.max) break;
	}

	if (!best?.picks?.length) {
		throw new Error("Could not build an encounter in that XP budget. Try looser filters.");
	}

	const {addCombatants} = await import("./encounter-view.js");
	let session = {combatants: []};
	let selectedId = null;
	for (const pick of best.picks) {
		const next = await addCombatants(session, pick.doc, pick.count);
		session = {combatants: next.combatants};
		selectedId = next.selectedId;
	}

	const info = encounterDifficulty({
		combatants: session.combatants,
		party: normalized,
		style: "one",
	});

	return {
		combatants: session.combatants,
		selectedId,
		party: normalized,
		info,
		budget,
		warning: best.totalXp < budget.min || best.totalXp > budget.max
			? `Built ${best.totalXp.toLocaleString()} XP (target ${budget.target.toLocaleString()}).`
			: "",
	};
}

function planarEnvironmentIds () {
	const fromHabitats = habitatFilterOptions()
		.map(it => it.id)
		.filter(id => String(id).startsWith("planar"));
	if (fromHabitats.length) return fromHabitats;
	return ["planar, feywild", "planar, shadowfell", "planar, astral", "planar, ethereal"];
}

function toCandidate (doc, theme, partyLevel) {
	const meta = getMonsterMeta(doc);
	if (!meta) return null;
	if (!themeMatches(doc, meta, theme, partyLevel)) return null;
	const cr = meta.cr || "0";
	const crNum = crNumber(cr);
	if (!Number.isFinite(crNum) || crNum >= 900) return null;
	const xp = xpFromCr(cr);
	if (!(xp > 0)) return null;
	return {doc, meta, cr, crNum, xp};
}

function themeMatches (doc, meta, theme, partyLevel) {
	const t = String(theme || "");
	if (!t) return true;
	const name = String(doc?.n || "");
	const types = meta.types || [];
	const envs = meta.environments || [];
	const alignments = meta.alignments || [];

	if (t === "pirate") {
		return envs.some(e => e === "coastal" || e === "underwater") || PIRATE_RE.test(name);
	}
	if (t === "bandit") {
		return types.includes("humanoid") && (BANDIT_RE.test(name) || crNumber(meta.cr) <= partyLevel + 1);
	}
	if (t === "social") {
		if (!types.includes("humanoid")) return false;
		return meta.cr == null || crNumber(meta.cr) <= partyLevel + 2;
	}
	if (t === "evil") {
		return alignments.some(code => String(code).includes("E"));
	}
	if (t === "planar") {
		return envs.some(e => String(e).startsWith("planar"))
			|| types.some(ty => ty === "celestial" || ty === "fiend" || ty === "elemental");
	}
	if (t === "underdark") return envs.includes("underdark");
	// Type-based themes already applied in bestiaryFilters; keep if type present.
	if (t === "undead") return types.includes("undead");
	if (t === "fey") return types.includes("fey");
	if (t === "dragon") return types.includes("dragon");
	if (t === "cosmic") return types.includes("aberration");
	if (t === "demonic") return types.includes("fiend");
	return true;
}

function pickBoss (pool, budget, party) {
	const lo = budget.target * 0.75;
	const hi = budget.max;
	const level = party.level;
	const matches = pool.filter(c => c.xp >= lo && c.xp <= hi && c.crNum >= level - 2 && c.crNum <= level + 4);
	const fallback = pool.filter(c => c.xp >= lo * 0.7 && c.xp <= hi);
	const list = matches.length ? matches : fallback;
	if (!list.length) return null;
	const pick = weightedNearLevel(list, level);
	return pick ? [{doc: pick.doc, count: 1, xp: pick.xp}] : null;
}

function pickBossMinions (pool, budget, party) {
	const bossLo = budget.target * 0.45;
	const bossHi = budget.target * 0.65;
	const level = party.level;
	const bosses = pool.filter(c => c.xp >= bossLo && c.xp <= bossHi && c.crNum >= level - 3 && c.crNum <= level + 3);
	const bossPool = bosses.length ? bosses : pool.filter(c => c.xp >= bossLo * 0.7 && c.xp <= bossHi * 1.2);
	if (!bossPool.length) return null;
	const boss = weightedNearLevel(bossPool, level);
	if (!boss) return null;

	const remain = Math.max(0, budget.target - boss.xp);
	const minionCount = randInt(party.count, Math.max(party.count, party.count * 2));
	const maxMinionXp = Math.max(10, Math.floor(remain / Math.max(1, minionCount)));
	const minions = pool.filter(c => c.xp > 0 && c.xp <= maxMinionXp && c.crNum <= Math.max(0, level - 1) && c.doc.u !== boss.doc.u);
	if (!minions.length) return [{doc: boss.doc, count: 1, xp: boss.xp}];
	const minion = pickRandom(minions);
	const affordable = Math.max(1, Math.min(minionCount, Math.floor(remain / minion.xp) || 1));
	return [
		{doc: boss.doc, count: 1, xp: boss.xp},
		{doc: minion.doc, count: affordable, xp: minion.xp},
	];
}

function pickGroup (pool, budget, party) {
	const level = party.level;
	let count;
	if (party.count <= 3) count = 2;
	else if (party.count <= 5) count = 3;
	else count = randInt(party.count + 2, party.count * 3);

	const per = budget.target / count;
	const near = pool.filter(c => c.xp >= per * 0.55 && c.xp <= per * 1.45 && c.crNum >= level - 3 && c.crNum <= level + 2);
	const loose = pool.filter(c => c.xp >= per * 0.4 && c.xp <= per * 1.8);
	const list = near.length ? near : loose;
	if (!list.length) return null;
	const pick = weightedNearLevel(list, level);
	if (!pick) return null;
	let n = count;
	while (n > 1 && pick.xp * n > budget.max) n--;
	while (n < 12 && pick.xp * (n + 1) <= budget.max && pick.xp * n < budget.min) n++;
	return [{doc: pick.doc, count: Math.max(1, n), xp: pick.xp}];
}

function weightedNearLevel (list, level) {
	if (!list.length) return null;
	const scored = list.map(c => ({
		c,
		w: 1 / (1 + Math.abs(c.crNum - level)),
	}));
	const total = scored.reduce((sum, it) => sum + it.w, 0);
	let tick = Math.random() * total;
	for (const it of scored) {
		tick -= it.w;
		if (tick <= 0) return it.c;
	}
	return scored[scored.length - 1].c;
}

function pickRandom (list) {
	if (!list.length) return null;
	return list[Math.floor(Math.random() * list.length)];
}

function randInt (min, max) {
	const a = Math.min(min, max);
	const b = Math.max(min, max);
	return a + Math.floor(Math.random() * (b - a + 1));
}

function crNumber (cr) {
	const Parser = getParser();
	if (typeof Parser.crToNumber === "function") {
		const n = Number(Parser.crToNumber(cr));
		if (Number.isFinite(n)) return n;
	}
	const raw = String(cr?.cr ?? cr ?? "0").trim();
	if (raw.includes("/")) {
		const [a, b] = raw.split("/").map(Number);
		if (b) return a / b;
	}
	const n = Number(raw);
	return Number.isFinite(n) ? n : NaN;
}
