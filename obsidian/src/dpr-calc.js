/**
 * Expected damage and party survival. A 20 always hits and crits (dice only).
 * A 1 always misses. Saves deal full damage on a failure and half on a success.
 */

const COUNT_WORD = {one: 1, two: 2, three: 3, four: 4, five: 5, six: 6};

/** DMG monster statistics by CR. `save` is attack bonus minus proficiency. */
const CR_TABLE = [
	{cr: "0", ac: 13, hp: 4, attack: 3, dpr: 1, pb: 2},
	{cr: "1/8", ac: 13, hp: 21, attack: 3, dpr: 3, pb: 2},
	{cr: "1/4", ac: 13, hp: 42, attack: 3, dpr: 5, pb: 2},
	{cr: "1/2", ac: 13, hp: 60, attack: 3, dpr: 7, pb: 2},
	{cr: "1", ac: 13, hp: 78, attack: 3, dpr: 12, pb: 2},
	{cr: "2", ac: 13, hp: 93, attack: 3, dpr: 18, pb: 2},
	{cr: "3", ac: 13, hp: 108, attack: 4, dpr: 24, pb: 2},
	{cr: "4", ac: 14, hp: 123, attack: 5, dpr: 30, pb: 2},
	{cr: "5", ac: 15, hp: 138, attack: 6, dpr: 36, pb: 3},
	{cr: "6", ac: 15, hp: 153, attack: 6, dpr: 42, pb: 3},
	{cr: "7", ac: 15, hp: 168, attack: 6, dpr: 48, pb: 3},
	{cr: "8", ac: 16, hp: 183, attack: 7, dpr: 54, pb: 3},
	{cr: "9", ac: 16, hp: 198, attack: 7, dpr: 60, pb: 4},
	{cr: "10", ac: 17, hp: 213, attack: 7, dpr: 66, pb: 4},
	{cr: "11", ac: 17, hp: 228, attack: 8, dpr: 72, pb: 4},
	{cr: "12", ac: 17, hp: 243, attack: 8, dpr: 78, pb: 4},
	{cr: "13", ac: 18, hp: 258, attack: 8, dpr: 84, pb: 5},
	{cr: "14", ac: 18, hp: 273, attack: 8, dpr: 90, pb: 5},
	{cr: "15", ac: 18, hp: 288, attack: 8, dpr: 96, pb: 5},
	{cr: "16", ac: 18, hp: 303, attack: 9, dpr: 102, pb: 5},
	{cr: "17", ac: 19, hp: 318, attack: 10, dpr: 108, pb: 6},
	{cr: "18", ac: 19, hp: 333, attack: 10, dpr: 114, pb: 6},
	{cr: "19", ac: 19, hp: 348, attack: 10, dpr: 120, pb: 6},
	{cr: "20", ac: 19, hp: 378, attack: 10, dpr: 132, pb: 6},
];

export function crOptions () {
	return CR_TABLE.map(row => row.cr);
}

export function crProfile (cr) {
	const key = String(cr ?? "").trim();
	const row = CR_TABLE.find(it => it.cr === key);
	if (!row) return null;
	return {...row, save: row.attack - row.pb};
}

export function formatNum (n) {
	if (!Number.isFinite(Number(n))) return "—";
	const rounded = Math.round(Number(n) * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Average of every NdM in the text, plus signed flats that are not a die count. */
export function averageFromText (text) {
	const raw = String(text || "");
	const diceRe = /(\d*)d(\d+)/gi;
	let dice = 0;
	let found = false;
	let match;
	while ((match = diceRe.exec(raw))) {
		const count = Number(match[1] || 1);
		const faces = Number(match[2]);
		if (!count || !faces) continue;
		found = true;
		dice += count * (faces + 1) / 2;
	}
	if (!found) return null;
	const rest = raw.replace(/(\d*)d(\d+)/gi, " ");
	let flat = 0;
	const modRe = /([+-])\s*(\d+)/g;
	while ((match = modRe.exec(rest))) {
		flat += (match[1] === "-" ? -1 : 1) * Number(match[2]);
	}
	return {dice, flat, average: dice + flat};
}

export function attackOdds (bonus, ac, mode = "normal") {
	const score = Number(bonus) || 0;
	const target = Number(ac) || 0;
	const pick = mode === "advantage" ? Math.max : mode === "disadvantage" ? Math.min : null;
	let hits = 0;
	let crits = 0;
	let total = 0;
	const add = (face) => {
		total++;
		if (face === 1) return;
		if (face === 20 || face + score >= target) {
			if (face === 20) crits++;
			else hits++;
		}
	};
	if (!pick) {
		for (let face = 1; face <= 20; face++) add(face);
	} else {
		for (let a = 1; a <= 20; a++) {
			for (let b = 1; b <= 20; b++) add(pick(a, b));
		}
	}
	return {normal: hits / total, crit: crits / total};
}

export function failChance (dc, saveBonus) {
	const need = Number(dc) || 0;
	const bonus = Number(saveBonus) || 0;
	let fails = 0;
	for (let face = 1; face <= 20; face++) {
		if (face === 1 || (face !== 20 && face + bonus < need)) fails++;
	}
	return fails / 20;
}

export function expectedDamage (source, {ac = 15, mode = "normal", saveBonus = 0} = {}) {
	const dice = Number(source?.dice) || 0;
	const flat = Number(source?.flat) || 0;
	const full = dice + flat;
	if (source?.kind === "heal" || source?.kind === "auto") return full;
	if (source?.kind === "save") {
		const fail = failChance(source.dc, saveBonus);
		return fail * full + (1 - fail) * (full / 2);
	}
	const odds = attackOdds(source?.bonus, ac, mode);
	return odds.normal * full + odds.crit * (dice * 2 + flat);
}

export function dprByAc (sources, {mode = "normal", saveBonus = 0, acMin = 10, acMax = 25} = {}) {
	const points = [];
	for (let ac = acMin; ac <= acMax; ac++) {
		let dpr = 0;
		for (const source of sources || []) dpr += expectedDamage(source, {ac, mode, saveBonus});
		points.push({ac, dpr});
	}
	return points;
}

/**
 * Party HP after each round. Damage lands first; healing then fills up to max.
 * `rounds` is null when the party is still up at the end of the series.
 */
export function hpOverRounds (maxHp, incoming, healing, limit = 12) {
	const cap = Math.max(0, Number(maxHp) || 0);
	const hurt = Math.max(0, Number(incoming) || 0);
	const heal = Math.max(0, Number(healing) || 0);
	const series = [cap];
	if (!cap || !hurt) return {rounds: null, series: padSeries(series, limit)};
	let hp = cap;
	let rounds = null;
	for (let round = 1; round <= limit; round++) {
		hp -= hurt;
		if (hp <= 0) {
			series.push(0);
			rounds = round;
			break;
		}
		hp = Math.min(cap, hp + heal);
		series.push(hp);
	}
	return {rounds, series: padSeries(series, limit)};
}

export function roundsToClear (enemyHp, dpr) {
	const hp = Number(enemyHp) || 0;
	const damage = Number(dpr) || 0;
	if (hp <= 0 || damage <= 0) return null;
	return Math.ceil(hp / damage);
}

/** One round of attacks from a 5etools creature, honoring Multiattack when it names them. */
export function creatureRound (ent) {
	const actions = Array.isArray(ent?.action) ? ent.action : [];
	const attacks = [];
	for (const action of actions) {
		if (/multiattack/i.test(action?.name || "")) continue;
		const text = flattenEntries(action?.entries);
		const hit = text.match(/\{@hit\s+(-?\d+)/i) || text.match(/([+-]\d+)\s+to hit/i);
		const tagged = text.match(/\{@damage\s+([^}]+)\}/i);
		const parts = averageFromText(tagged ? tagged[1] : text);
		if (!hit || !parts) continue;
		attacks.push({name: String(action?.name || "Attack"), bonus: Number(hit[1]), ...parts});
	}
	const multi = actions.find(action => /multiattack/i.test(action?.name || ""));
	if (!multi) return attacks.slice(0, 1);
	const text = flattenEntries(multi.entries);
	const picked = [];
	const re = /(?:\b(one|two|three|four|five|six)\b\s+)?\{@act\s+([^}|]+)/gi;
	let match;
	while ((match = re.exec(text))) {
		const count = COUNT_WORD[(match[1] || "one").toLowerCase()] || 1;
		const name = match[2].trim().toLowerCase();
		const attack = attacks.find(it => {
			const label = it.name.toLowerCase();
			return label === name || name.includes(label) || label.includes(name);
		});
		if (!attack) continue;
		for (let i = 0; i < count; i++) picked.push(attack);
	}
	if (picked.length) return picked;
	const word = text.match(/\b(two|three|four|five|six)\b/i);
	const count = word ? COUNT_WORD[word[1].toLowerCase()] : 1;
	if (!attacks[0]) return [];
	return Array.from({length: count}, () => attacks[0]);
}

export function firstSpellDice (ent) {
	const entries = ent?.entries;
	const text = Array.isArray(entries) && entries.length ? flattenEntries(entries[0]) : flattenEntries(entries);
	const tagged = text.match(/\{@(?:dice|damage)\s+([^}]+)\}/i);
	return averageFromText(tagged ? tagged[1] : text);
}

export function spellText (ent) {
	const entries = ent?.entries;
	return Array.isArray(entries) && entries.length ? flattenEntries(entries[0]) : flattenEntries(entries);
}

function padSeries (series, limit) {
	const out = series.slice();
	const last = out[out.length - 1] ?? 0;
	while (out.length <= limit) out.push(last);
	return out;
}

function flattenEntries (value) {
	if (value == null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.map(flattenEntries).join(" ");
	if (typeof value === "object") {
		return [value.entries, value.entry, value.items, value.header, value.name]
			.map(flattenEntries)
			.filter(Boolean)
			.join(" ");
	}
	return "";
}
