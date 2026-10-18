import {hpAverageFromFormula} from "./homebrew-store.js";

const WORD_COUNTS = {two: 2, three: 3, four: 4, five: 5, six: 6};

const CR_TABLE = [
	["0", 13, 1, 6, 3, 0, 1, 13],
	["1/8", 13, 7, 35, 3, 2, 3, 13],
	["1/4", 13, 36, 49, 3, 4, 5, 13],
	["1/2", 13, 50, 70, 3, 6, 8, 13],
	["1", 13, 71, 85, 3, 9, 14, 13],
	["2", 13, 86, 100, 3, 15, 20, 13],
	["3", 13, 101, 115, 4, 21, 26, 13],
	["4", 14, 116, 130, 5, 27, 32, 14],
	["5", 15, 131, 145, 6, 33, 38, 15],
	["6", 15, 146, 160, 6, 39, 44, 15],
	["7", 15, 161, 175, 6, 45, 50, 15],
	["8", 16, 176, 190, 7, 51, 56, 16],
	["9", 16, 191, 205, 7, 57, 62, 16],
	["10", 17, 206, 220, 7, 63, 68, 16],
	["11", 17, 221, 235, 8, 69, 74, 17],
	["12", 17, 236, 250, 8, 75, 80, 18],
	["13", 18, 251, 265, 8, 81, 86, 18],
	["14", 18, 266, 280, 8, 87, 92, 18],
	["15", 18, 281, 295, 8, 93, 98, 18],
	["16", 18, 296, 310, 9, 99, 104, 18],
	["17", 19, 311, 325, 10, 105, 110, 19],
	["18", 19, 326, 340, 10, 111, 116, 19],
	["19", 19, 341, 355, 10, 117, 122, 19],
	["20", 19, 356, 400, 10, 123, 140, 19],
	["21", 19, 401, 445, 11, 141, 158, 20],
	["22", 19, 446, 490, 11, 159, 176, 20],
	["23", 19, 491, 535, 11, 177, 194, 20],
	["24", 19, 536, 580, 11, 195, 212, 21],
	["25", 19, 581, 625, 12, 213, 230, 21],
	["26", 19, 626, 670, 12, 231, 248, 21],
	["27", 19, 671, 715, 13, 249, 266, 22],
	["28", 19, 716, 760, 13, 267, 284, 22],
	["29", 19, 760, 805, 13, 285, 302, 22],
	["30", 19, 805, 850, 14, 303, 320, 23],
].map(([cr, ac, hpMin, hpMax, attackBonus, dprMin, dprMax, saveDc]) => ({
	cr, ac, hpMin, hpMax, attackBonus, dprMin, dprMax, saveDc,
}));

export function applyCalculatedCr (draft) {
	if (draft?.crOverride) return draft?.cr || "";
	const info = estimateCreatureCr(draft);
	if (info.cr) draft.cr = info.cr;
	return draft?.cr || "";
}

export function estimateCreatureCr (form = {}) {
	const hpBase = hpAverageFromFormula(form.hpFormula);
	const acBase = Number(form.ac);
	const hasHp = hpBase > 0;
	const hasAc = Number.isFinite(acBase) && acBase > 0;
	const offense = offenseFromForm(form);
	if (!hasHp && !hasAc && !offense.dpr) {
		return {cr: "", defensive: "", offensive: "", hp: 0, ac: 0, dpr: 0, attackBonus: 0};
	}

	let ac = (hasAc ? acBase : 13) + countSaves(form.saves) + (hasFly(form.speed) ? 2 : 0);
	let hp = hasHp ? hpBase : 0;
	if (hp) hp = adjustHpForProtection(hp, crNumber(guessDefensiveCr(hp, ac)), form);

	const defensive = hasHp ? crByHpAc(hp, ac) : "";
	const offensive = offense.dpr
		? crByDprAtk(offense.dpr, offense.attackBonus, offense.useSaveDc)
		: "";
	const cr = averageCr(defensive, offensive);
	return {
		cr,
		defensive,
		offensive,
		hp,
		ac,
		dpr: offense.dpr,
		attackBonus: offense.attackBonus,
	};
}

function offenseFromForm (form) {
	const rows = [...(form.actions || []), ...(form.bonus || [])];
	const attacks = [];
	let multi = 1;
	for (const row of rows) {
		const text = String(row?.text || "");
		const name = String(row?.name || "");
		const count = multiattackCount(name, text);
		if (count > 1) multi = Math.max(multi, count);
		const dpr = damageFromText(text);
		if (!dpr) continue;
		const hit = hitFromText(text);
		const dc = saveDcFromText(text);
		attacks.push({dpr, hit, dc});
	}
	if (!attacks.length) return {dpr: 0, attackBonus: 0, useSaveDc: false};
	const best = attacks.slice().sort((a, b) => b.dpr - a.dpr)[0];
	const useSaveDc = best.dc != null && best.hit == null;
	return {
		dpr: Math.floor(best.dpr * multi),
		attackBonus: useSaveDc ? best.dc : (best.hit ?? 3),
		useSaveDc,
	};
}

function damageFromText (text) {
	let total = 0;
	for (const m of String(text || "").matchAll(/\{@damage ([^}]+)\}/gi)) {
		total += averageDiceExpr(m[1]);
	}
	return total;
}

function hitFromText (text) {
	const m = String(text || "").match(/\{@hit (-?\d+)\}/i);
	return m ? Number(m[1]) : null;
}

function saveDcFromText (text) {
	const m = String(text || "").match(/\{@dc (\d+)\}/i);
	return m ? Number(m[1]) : null;
}

function multiattackCount (name, text) {
	const blob = `${name} ${text}`;
	if (!/multiattack/i.test(name) && !/makes\s+\S+\s+attacks/i.test(blob)) return 1;
	const m = blob.match(/makes\s+(two|three|four|five|six|\d+)\s+attacks/i);
	if (!m) return 2;
	return WORD_COUNTS[m[1].toLowerCase()] || Math.max(1, Number(m[1]) || 2);
}

function averageDiceExpr (raw) {
	const compact = String(raw || "").replace(/\s+/g, "");
	if (!compact) return 0;
	if (/^\d+d\d+([+-]\d+)?$/i.test(compact) || /^-?\d+$/.test(compact)) {
		return hpAverageFromFormula(compact);
	}
	let total = 0;
	let used = false;
	for (const m of compact.matchAll(/(\d+)d(\d+)/gi)) {
		used = true;
		total += Number(m[1]) * ((Number(m[2]) + 1) / 2);
	}
	if (!used) return hpAverageFromFormula(compact);
	for (const m of compact.replace(/\d+d\d+/gi, "").matchAll(/([+-]\d+)/g)) {
		total += Number(m[1]);
	}
	return Math.floor(total);
}

function countSaves (raw) {
	return String(raw || "").split(",").map(it => it.trim()).filter(Boolean).length;
}

function hasFly (speed) {
	return /\bfly\b/i.test(String(speed || ""));
}

function adjustHpForProtection (hp, expected, form) {
	let next = hp;
	if (String(form.immune || "").trim()) {
		if (expected <= 4) next *= 2;
		else if (expected <= 10) next *= 2;
		else if (expected <= 16) next *= 1.5;
		else next *= 1.25;
	} else if (String(form.resist || "").trim()) {
		if (expected <= 4) next *= 2;
		else if (expected <= 10) next *= 1.5;
		else if (expected <= 16) next *= 1.25;
	}
	return Math.floor(next);
}

function guessDefensiveCr (hp, ac) {
	return crNumber(crByHpAc(hp, ac) || "0");
}

function crByHpAc (hp, ac) {
	const capped = Math.min(850, Math.max(0, hp));
	const ix = CR_TABLE.findIndex(row => capped >= row.hpMin && capped <= row.hpMax);
	if (ix < 0) return capped > 850 ? "30" : "";
	return shiftedCr(ix, CR_TABLE[ix].ac - ac);
}

function crByDprAtk (dpr, attackBonus, useSaveDc) {
	const capped = Math.min(320, Math.max(0, dpr));
	const ix = CR_TABLE.findIndex(row => capped >= row.dprMin && capped <= row.dprMax);
	if (ix < 0) return capped > 320 ? "30" : "0";
	const expected = useSaveDc ? CR_TABLE[ix].saveDc : CR_TABLE[ix].attackBonus;
	return shiftedCr(ix, expected - attackBonus);
}

function shiftedCr (index, rawDiff) {
	let diff = rawDiff;
	if (diff > 0) diff = Math.floor(diff / 2);
	if (diff < 0) diff = Math.ceil(diff / 2);
	const next = Math.max(0, Math.min(CR_TABLE.length - 1, index - diff));
	return CR_TABLE[next].cr;
}

function averageCr (defensive, offensive) {
	if (defensive && !offensive) return defensive;
	if (offensive && !defensive) return offensive;
	if (!defensive && !offensive) return "";
	const mean = (crNumber(defensive) + crNumber(offensive)) / 2;
	return nearestCr(mean);
}

function crNumber (cr) {
	if (cr === "0" || !cr) return 0;
	if (String(cr).includes("/")) {
		const [a, b] = String(cr).split("/").map(Number);
		return b ? a / b : 0;
	}
	return Number(cr) || 0;
}

function nearestCr (value) {
	let best = CR_TABLE[0].cr;
	let gap = Infinity;
	for (const row of CR_TABLE) {
		const d = Math.abs(crNumber(row.cr) - value);
		if (d < gap) {
			gap = d;
			best = row.cr;
		}
	}
	return best;
}

if (globalThis.FiveEToolsObsidian) {
	globalThis.FiveEToolsObsidian.estimateCreatureCr = estimateCreatureCr;
	globalThis.FiveEToolsObsidian.applyCalculatedCr = applyCalculatedCr;
}
