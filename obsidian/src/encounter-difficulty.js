import {getStyleHint} from "./fiveetools-host.js";

const XP_ONE = {
	low: [0, 50, 100, 150, 250, 500, 600, 750, 1000, 1300, 1600, 1900, 2200, 2600, 2900, 3300, 3800, 4500, 5000, 5500, 6400],
	moderate: [0, 75, 150, 225, 375, 750, 1000, 1300, 1700, 2000, 2300, 2900, 3700, 4200, 4900, 5400, 6100, 7200, 8700, 10700, 13200],
	high: [0, 100, 200, 400, 500, 1100, 1400, 1700, 2100, 2600, 3100, 4100, 4700, 5400, 6200, 7800, 9800, 11700, 14200, 17200, 22000],
};

const XP_CLASSIC = {
	easy: [0, 25, 50, 75, 125, 250, 300, 350, 450, 550, 600, 800, 1000, 1100, 1250, 1400, 1600, 2000, 2100, 2400, 2800],
	medium: [0, 50, 100, 150, 250, 500, 600, 750, 900, 1100, 1200, 1600, 2000, 2200, 2500, 2800, 3200, 3900, 4100, 4900, 5700],
	hard: [0, 75, 150, 225, 375, 750, 900, 1100, 1400, 1600, 1900, 2400, 3000, 3400, 3800, 4300, 4800, 5900, 6300, 7300, 8500],
	deadly: [0, 100, 200, 400, 500, 1100, 1400, 1700, 2100, 2400, 2800, 3600, 4500, 5100, 5700, 6400, 7200, 8800, 9500, 10900, 12700],
};

const CLASSIC_MULT = [1, 1.5, 2, 2, 2, 2, 2.5, 2.5, 2.5, 2.5, 3, 3, 3, 3, 4];
const TIERS_ONE = ["low", "moderate", "high", "absurd"];

export function normalizeParty (raw) {
	return {
		count: clampInt(raw?.count, 1, 12, 4),
		level: clampInt(raw?.level, 1, 20, 1),
	};
}

export function xpFromCr (cr) {
	const Parser = globalThis.Parser;
	if (!Parser?.crToXpNumber) return 0;
	const n = Parser.crToXpNumber(cr);
	return Number.isFinite(n) ? n : 0;
}

export function encounterDifficulty ({combatants = [], party, style} = {}) {
	const {count, level} = normalizeParty(party);
	const styleHint = style || getStyleHint() || "one";
	const xpValues = (combatants || []).map(it => xpFromCr(it?.cr)).filter(n => n > 0);
	const totalXp = xpValues.reduce((sum, n) => sum + n, 0);
	const xpPerPlayer = count ? Math.floor(totalXp / count) : 0;
	const empty = {
		count,
		level,
		style: styleHint,
		totalXp,
		xpPerPlayer,
		adjustedXp: totalXp,
		difficulty: "",
		label: "—",
		budgets: {},
	};
	if (!xpValues.length) return empty;

	if (styleHint === "one") {
		const budgets = scaleBudgets(XP_ONE, level, count);
		budgets.absurd = budgets.high + (budgets.high - budgets.moderate);
		let difficulty = "absurd";
		for (const tier of TIERS_ONE) {
			if (totalXp <= budgets[tier]) {
				difficulty = tier;
				break;
			}
		}
		return {
			count,
			level,
			style: styleHint,
			totalXp,
			xpPerPlayer,
			adjustedXp: totalXp,
			difficulty,
			label: titleCase(difficulty),
			budgets,
		};
	}

	const budgets = scaleBudgets(XP_CLASSIC, level, count);
	budgets.absurd = budgets.deadly + (budgets.deadly - budgets.hard);
	const adjustedXp = Math.floor(totalXp * classicMultiplier(xpValues.length, count));
	let difficulty = "trivial";
	if (adjustedXp >= budgets.absurd) difficulty = "absurd";
	else {
		for (const tier of ["deadly", "hard", "medium", "easy"]) {
			if (adjustedXp >= budgets[tier]) {
				difficulty = tier;
				break;
			}
		}
	}
	return {
		count,
		level,
		style: styleHint,
		totalXp,
		xpPerPlayer,
		adjustedXp,
		difficulty,
		label: titleCase(difficulty),
		budgets,
	};
}

function scaleBudgets (table, level, count) {
	const out = {};
	for (const [tier, arr] of Object.entries(table)) {
		out[tier] = (arr[level] || 0) * count;
	}
	return out;
}

function classicMultiplier (monsterCount, playerCount) {
	let base = monsterCount <= 0
		? CLASSIC_MULT[0]
		: (monsterCount >= CLASSIC_MULT.length ? CLASSIC_MULT[CLASSIC_MULT.length - 1] : CLASSIC_MULT[monsterCount - 1]);
	if (playerCount < 3) return base >= 3 ? base + 1 : base + 0.5;
	if (playerCount > 5) return base === 4 ? 3 : base - 0.5;
	return base;
}

function clampInt (value, min, max, fallback) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, Math.round(n)));
}

function titleCase (value) {
	return String(value || "").replace(/^./, ch => ch.toUpperCase());
}
