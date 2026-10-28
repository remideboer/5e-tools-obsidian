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

/** One action of attacks from a 5etools creature. Multiattack is still one action. */
export function creatureRound (ent) {
	const actions = Array.isArray(ent?.action) ? ent.action : [];
	const attacks = [];
	for (const action of actions) {
		attacks.push(...attackForms(action));
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
		const matches = attacks.filter(it => {
			const label = it.name.toLowerCase().replace(/\s+\((melee|ranged)\)$/, "");
			return label === name || name.includes(label) || label.includes(name);
		});
		const attack = matches.find(it => it.melee !== false) || matches[0];
		if (!attack) continue;
		for (let i = 0; i < count; i++) picked.push(attack);
	}
	if (picked.length) return picked;
	const word = text.match(/\b(two|three|four|five|six)\b/i);
	const count = word ? COUNT_WORD[word[1].toLowerCase()] : 1;
	if (!attacks[0]) return [];
	return Array.from({length: count}, () => attacks[0]);
}

/** Multiattack as the action, plus one damaging bonus action if the creature has one. */
export function creatureTurn (ent) {
	const swings = creatureRound(ent);
	const actionSwings = swings.map(swing => ({...swing, activation: "action"}));
	const ranged = [];
	for (const action of ent?.action || []) {
		for (const form of attackForms(action)) {
			if (form.melee === false) ranged.push({...form, activation: "action", separate: true});
		}
	}
	const bonus = (Array.isArray(ent?.bonus) ? ent.bonus : []).map(attackFromAction).find(Boolean);
	const utility = [...(ent?.action || []), ...(ent?.bonus || [])]
		.map(action => utilityOption(action, (ent?.bonus || []).includes(action) ? "bonus" : "action"))
		.filter(Boolean);
	return [
		...actionSwings,
		...ranged,
		...(bonus ? [{...bonus, activation: "bonus"}] : []),
		...utility,
	];
}

function attackForms (action) {
	const base = attackFromAction(action);
	if (!base) return [];
	const text = flattenEntries(action?.entries);
	const reach = text.match(/reach\s+(\d+)/i);
	const ranged = text.match(/range\s+(\d+)/i);
	if (reach && ranged && Number(ranged[1]) !== Number(reach[1])) {
		return [
			{...base, name: `${base.name} (melee)`, rangeFeet: Number(reach[1]), melee: true},
			{...base, name: `${base.name} (ranged)`, rangeFeet: Number(ranged[1]), melee: false},
		];
	}
	return [base];
}

function utilityOption (action, activation) {
	const name = String(action?.name || "");
	const text = flattenEntries(action?.entries);
	if (!/disengage|nimble escape/i.test(`${name} ${text}`)) return null;
	return {
		name: "Disengage",
		kind: "utility",
		utility: "disengage",
		activation,
		spell: false,
		blurb: text.slice(0, 160),
	};
}

export function economySlot (activation) {
	const text = String(activation || "").toLowerCase();
	if (/\bbonus\b/.test(text)) return "bonus";
	if (/\breaction\b/.test(text)) return "reaction";
	if (/\b(minute|hour|passive|special)\b/.test(text) || /no action/.test(text)) return "free";
	return "action";
}

/** How many weapon swings the Attack action includes. Extra Attack is still one action. */
export function extraAttackSwings (features, classLabel) {
	const feature = (features || []).find(it => /extra attack/i.test(it?.name || ""));
	if (!feature) return 1;
	const text = `${feature.name} ${feature.snippet || ""}`.toLowerCase();
	let count = 2;
	if (/\bfour\b/.test(text)) count = 4;
	else if (/\bthree\b/.test(text)) count = 3;
	else if (/\b(twice|two)\b/.test(text)) count = 2;
	const fighter = String(classLabel || "").match(/fighter\s+(\d+)/i);
	const level = fighter ? Number(fighter[1]) : 0;
	if (level >= 20) return Math.max(count, 4);
	if (level >= 11) return Math.max(count, 3);
	return count;
}

/**
 * One turn: one action, one bonus action, one reaction.
 * Checked weapon attacks share the Attack action and fill `swings` (Extra Attack).
 * A checked heal takes the bonus action ahead of a bonus attack.
 * A leveled bonus spell leaves room for a cantrip or the Attack action, not another leveled spell.
 */
export function resolveTurn (sources, swings = 1) {
	const bySlot = {action: [], bonus: [], reaction: [], free: []};
	for (const source of sources || []) {
		const slot = bySlot[source?.slot] ? source.slot : "action";
		bySlot[slot].push(source);
	}
	bySlot.bonus.sort((a, b) => (a.kind === "heal" ? 0 : 1) - (b.kind === "heal" ? 0 : 1));
	const used = [];
	const skipped = [];
	if (bySlot.bonus[0]) used.push(bySlot.bonus[0]);
	skipped.push(...bySlot.bonus.slice(1));
	if (bySlot.reaction[0]) used.push(bySlot.reaction[0]);
	skipped.push(...bySlot.reaction.slice(1));
	used.push(...bySlot.free);

	const bonusSpell = bySlot.bonus[0] && bySlot.bonus[0].kind !== "attack" && bySlot.bonus[0].level > 0;
	const attacks = bySlot.action.filter(source => source.kind === "attack" && !source.spell);
	let others = bySlot.action.filter(source => !(source.kind === "attack" && !source.spell));
	if (bonusSpell) {
		const leveled = others.filter(source => source.level > 0);
		skipped.push(...leveled);
		others = others.filter(source => !(source.level > 0));
	}
	if (attacks.length) {
		const count = Math.max(1, Number(swings) || 1);
		for (let i = 0; i < count; i++) used.push(attacks[i % attacks.length]);
		if (attacks.length > count) skipped.push(...attacks.slice(count));
		skipped.push(...others);
	} else if (others[0]) {
		used.push(others[0]);
		skipped.push(...others.slice(1));
	}
	return {used, skipped};
}

/** Rebuild a typical monster swing so a different AC changes the expected damage. */
export function attackFromCr (profile) {
	const odds = attackOdds(profile.attack, profile.ac, "normal");
	const weight = odds.normal + odds.crit * 2;
	const dice = weight > 0 ? profile.dpr / weight : profile.dpr;
	return {kind: "attack", bonus: profile.attack, dice, flat: 0, name: `CR ${profile.cr}`};
}

/**
 * Each creature keeps its own HP and AC. A downed character stops attacking.
 * Attacks focus the living target with the lowest HP. Healing lands on the
 * most wounded ally and stops at that ally's own maximum.
 */
export function simulateFight ({party = [], enemies = [], limit = 12, mode = "normal", saveBonus = 0, useHeals = true} = {}) {
	const pcs = party.map(member => ({
		name: member.name,
		ac: member.ac,
		max: Math.max(0, Number(member.max) || 0),
		hp: Math.max(0, Number(member.max) || 0),
		checked: member.checked || [],
		extraSwings: member.extraSwings || member.swings || 1,
		characterLevel: member.characterLevel || 1,
		pool: (member.pool || []).map(slot => ({level: slot.level, pact: !!slot.pact})),
		casts: [],
	}));
	const foes = enemies.map(enemy => ({
		name: enemy.name,
		ac: enemy.ac,
		max: Math.max(0, Number(enemy.max) || 0),
		hp: Math.max(0, Number(enemy.max) || 0),
		swings: enemy.swings || [],
	}));
	const series = pcs.map(pc => [pc.hp]);
	let rounds = null;
	let clearRound = null;
	const steps = Math.max(1, limit);
	for (let round = 1; round <= steps; round++) {
		const heals = [];
		for (const pc of living(pcs)) {
			const casts = roundCasts(pc, useHeals);
			pc.casts.push(casts);
			for (const swing of casts) {
				if (swing.kind === "heal") {
					heals.push(swing);
					continue;
				}
				const foe = lowest(living(foes));
				if (!foe) break;
				foe.hp -= expectedDamage(swing, {ac: foe.ac, mode, saveBonus});
				if (foe.hp < 0) foe.hp = 0;
			}
		}
		if (!clearRound && foes.length && !living(foes).length) clearRound = round;
		for (const foe of living(foes)) {
			for (const swing of foe.swings) {
				const pc = lowest(living(pcs));
				if (!pc) break;
				pc.hp -= expectedDamage(swing, {ac: pc.ac, mode: "normal", saveBonus: 0});
				if (pc.hp < 0) pc.hp = 0;
			}
		}
		if (useHeals) {
			for (const swing of heals) {
				const target = [...pcs].filter(it => it.hp < it.max).sort((a, b) => a.hp - b.hp)[0];
				if (!target) continue;
				target.hp = Math.min(target.max, target.hp + (Number(swing.dice) || 0) + (Number(swing.flat) || 0));
			}
		}
		for (let i = 0; i < pcs.length; i++) series[i].push(pcs[i].hp);
		if (!rounds && pcs.length && !living(pcs).length) rounds = round;
		if (rounds && clearRound) break;
	}
	return {
		rounds,
		clearRound,
		people: pcs.map((pc, i) => ({
			name: pc.name,
			ac: pc.ac,
			max: pc.max,
			casts: pc.casts,
			series: padSeries(series[i], steps),
		})),
	};
}

/**
 * Dice for one cast. Cantrips scale with character level. A higher slot adds
 * the book's per-step dice above `scale.from`. No scale text keeps the base dice.
 */
export function spellAtSlot (spell, slotLevel, characterLevel) {
	if (spell?.cantrip?.length) {
		const level = Math.max(1, Number(characterLevel) || 1);
		let pick = spell.cantrip[0];
		for (const row of spell.cantrip) {
			if (row.level <= level) pick = row;
		}
		return {...spell, dice: pick.dice, flat: pick.flat, count: pick.count || spell.count || 0, faces: pick.faces || spell.faces || 0, castLevel: 0};
	}
	const slot = Number(slotLevel) || Number(spell?.level) || 0;
	let dice = Number(spell?.dice) || 0;
	let flat = Number(spell?.flat) || 0;
	let count = Number(spell?.count) || 0;
	let faces = Number(spell?.faces) || 0;
	const scale = spell?.scale;
	if (scale && slot > scale.from) {
		const steps = Math.floor((slot - scale.from) / (scale.every || 1));
		dice += steps * (Number(scale.dice) || 0);
		flat += steps * (Number(scale.flat) || 0);
		count += steps * (Number(scale.count) || 0);
		faces = faces || scale.faces || 0;
	}
	return {...spell, dice, flat, count, faces, castLevel: slot};
}

/** `{@scaledice 1d8|1-9|1d8}` adds the last dice once per step above the first number. */
export function scaleFromText (text) {
	const match = String(text || "").match(/\{@(?:scaledamage|scaledice)\s+([^}]+)\}/i);
	if (!match) return null;
	const parts = match[1].split("|");
	const add = averageFromText(parts[2] || "");
	if (!add) return null;
	const progression = String(parts[1] || "");
	const span = progression.match(/(\d+)\s*-\s*(\d+)/);
	let from = span ? Number(span[1]) : 0;
	let every = 1;
	if (!span) {
		const nums = progression.split(/[^\d]+/).map(Number).filter(n => n > 0);
		if (!nums.length) return null;
		const sorted = [...new Set(nums)].sort((a, b) => a - b);
		from = sorted[0];
		if (sorted.length > 1) {
			const step = sorted[1] - sorted[0];
			if (sorted.every((n, i) => i === 0 || n - sorted[i - 1] === step)) every = step;
		}
	}
	const shape = diceShape(parts[2] || "");
	return {from, every, dice: add.dice, flat: add.flat, count: shape?.count || 0, faces: shape?.faces || 0, label: String(parts[2] || "").replace(/\s+/g, "")};
}

export function cantripRows (scaling) {
	if (!scaling || typeof scaling !== "object") return [];
	return Object.entries(scaling)
		.map(([level, dice]) => {
			const parts = averageFromText(dice);
			const shape = diceShape(dice);
			return parts ? {level: Number(level), dice: parts.dice, flat: parts.flat, count: shape?.count || 0, faces: shape?.faces || 0, label: String(dice).replace(/\s+/g, "")} : null;
		})
		.filter(row => row && row.level > 0)
		.sort((a, b) => a.level - b.level);
}

/** One turn after spending the highest slot that can still cast each leveled spell. */
export function roundCasts (pc, useHeals = true) {
	const checked = (pc?.checked || []).filter(source => useHeals || source?.kind !== "heal");
	const pool = pc?.pool || [];
	const leveled = checked.filter(source => isLeveled(source) && hasSlot(pool, source.level));
	const cantrips = checked.filter(isCantrip);
	const weapons = checked.filter(isWeapon);
	const bonusLeveled = bestLeveled(leveled.filter(source => source.slot === "bonus"), pool);
	const actionLeveled = bestLeveled(leveled.filter(source => source.slot !== "bonus" && source.slot !== "reaction"), pool);
	const offered = [];
	if (bonusLeveled) offered.push(bonusLeveled);
	else {
		const bonusCantrip = cantrips.find(source => source.slot === "bonus");
		if (bonusCantrip) offered.push(bonusCantrip);
		else offered.push(...checked.filter(source => !source.spell && source.slot === "bonus"));
	}
	if (bonusLeveled) {
		offered.push(...weapons);
		if (!weapons.length) offered.push(...cantrips.filter(source => source.slot !== "bonus"));
	} else if (actionLeveled) {
		offered.push(actionLeveled);
	} else {
		offered.push(...weapons);
		if (!weapons.length) offered.push(...cantrips.filter(source => source.slot !== "bonus"));
		offered.push(...checked.filter(source => !source.spell && source.kind !== "attack" && source.slot !== "bonus"));
	}
	offered.push(...checked.filter(source => source.slot === "reaction"));
	const turn = resolveTurn(offered, pc?.extraSwings || 1);
	return turn.used.map(source => spendCast(source, pc)).filter(Boolean);
}

function spendCast (source, pc) {
	if (isLeveled(source)) {
		const slot = takeHighestSlot(pc.pool, source.level);
		if (!slot) return null;
		return spellAtSlot(source, slot.level, pc.characterLevel);
	}
	if (isCantrip(source)) return spellAtSlot(source, 0, pc.characterLevel);
	return source;
}

function bestLeveled (sources, pool) {
	if (!sources.length) return null;
	return [...sources].sort((a, b) => bestSlotLevel(pool, b.level) - bestSlotLevel(pool, a.level) || b.level - a.level)[0];
}

function bestSlotLevel (pool, minLevel) {
	let best = 0;
	for (const slot of pool || []) {
		if (slot.level >= minLevel && slot.level > best) best = slot.level;
	}
	return best;
}

function hasSlot (pool, minLevel) {
	return (pool || []).some(slot => slot.level >= minLevel);
}

export function takeHighestSlot (pool, minLevel) {
	let index = -1;
	let best = -1;
	let bestPact = true;
	for (let i = 0; i < pool.length; i++) {
		const slot = pool[i];
		if (slot.level < minLevel) continue;
		if (slot.level > best || (slot.level === best && bestPact && !slot.pact)) {
			best = slot.level;
			bestPact = !!slot.pact;
			index = i;
		}
	}
	if (index < 0) return null;
	return pool.splice(index, 1)[0];
}

function isWeapon (source) {
	return source?.kind === "attack" && !source.spell;
}

function isCantrip (source) {
	return !!(source?.spell && !(source.level > 0));
}

function isLeveled (source) {
	return !!(source?.spell && source.level > 0);
}

export function spellExtras (ent) {
	return {
		base: firstSpellDice(ent),
		scale: scaleFromText(flattenEntries(ent?.entriesHigherLevel)),
		cantrip: cantripRows(ent?.scalingLevelDice?.scaling),
		text: `${spellText(ent)} ${flattenEntries(ent?.entriesHigherLevel)}`.trim(),
	};
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

function attackFromAction (action) {
	if (/multiattack/i.test(action?.name || "")) return null;
	const text = flattenEntries(action?.entries);
	const hit = text.match(/\{@hit\s+(-?\d+)/i) || text.match(/([+-]\d+)\s+to hit/i);
	const tagged = text.match(/\{@damage\s+([^}]+)\}/i);
	const parts = averageFromText(tagged ? tagged[1] : text);
	if (!parts || (!hit && !tagged)) return null;
	const shape = diceShape(tagged ? tagged[1] : "");
	const reach = text.match(/reach\s+(\d+)/i);
	const ranged = text.match(/range\s+(\d+)/i);
	return {
		name: String(action?.name || "Attack"),
		bonus: hit ? Number(hit[1]) : 0,
		kind: hit ? "attack" : "auto",
		...parts,
		count: shape?.count || 0,
		faces: shape?.faces || 0,
		flat: shape?.flat ?? parts.flat,
		rangeFeet: reach ? Number(reach[1]) : (ranged ? Number(ranged[1]) : (hit ? 5 : 60)),
		melee: !!reach || !ranged,
		blurb: text.slice(0, 240),
	};
}

export function diceShape (text) {
	const raw = String(text || "");
	const match = raw.match(/(\d*)d(\d+)/i);
	if (!match) return null;
	const count = Number(match[1] || 1);
	const faces = Number(match[2]);
	const rest = raw.slice((match.index || 0) + match[0].length);
	const flatMatch = rest.match(/([+-])\s*(\d+)/);
	const flat = flatMatch ? (flatMatch[1] === "-" ? -1 : 1) * Number(flatMatch[2]) : 0;
	return {count, faces, flat};
}

function living (list) {
	return list.filter(it => it.hp > 0);
}

function lowest (list) {
	if (!list.length) return null;
	return [...list].sort((a, b) => a.hp - b.hp)[0];
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
