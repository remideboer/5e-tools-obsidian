import {attackCountForCr, crNumber} from "./creature-scale.js";
import {classicMultiplier, partyBudget, xpFromCr} from "./encounter-difficulty.js";

export const SIZE_CRS = [
	"0", "1/8", "1/4", "1/2",
	"1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
	"11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
];

export const MAX_MONSTERS = 20;

function partyAttacks (level) {
	return level >= 5 ? 2 : 1;
}

function adjustedXp ({n, xp, attacks, partyCount, partyStrike, style}) {
	const enemyAttacks = n * attacks;
	const share = partyStrike > 0 ? enemyAttacks / (enemyAttacks + partyStrike) : 1;
	const raw = xp * n * share;
	if (style === "one") return raw;
	const slots = partyStrike > 0
		? Math.max(1, Math.round(enemyAttacks * share))
		: enemyAttacks;
	return raw * classicMultiplier(slots, partyCount);
}

/**
 * Largest monster count (1–20) whose adjusted XP still fits the party budget.
 * Null when one monster is already over budget.
 * Standard initiative multiplies by attack actions, not bodies.
 * Players first keeps only the share of those attacks that still happen after the party goes.
 */
export function monsterCount ({level, cr, partyCount, difficulty, playersFirst = false, style = "classic"} = {}) {
	const xp = xpFromCr(cr);
	const budget = partyBudget(style, level, partyCount, difficulty);
	if (!(xp > 0) || !(budget > 0)) return null;
	const attacks = attackCountForCr(crNumber(cr) ?? 0);
	const partyStrike = playersFirst ? partyCount * partyAttacks(level) : 0;
	for (let n = MAX_MONSTERS; n >= 1; n--) {
		const adjusted = adjustedXp({n, xp, attacks, partyCount, partyStrike, style});
		if (adjusted <= budget) return n;
	}
	return null;
}
