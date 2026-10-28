import {expectedDamage} from "./dpr-calc.js";

const COLS = 10;
const ROWS = 8;

/**
 * Choose this turn's move and actions for either side.
 * Strikers close. Skirmishers and casters keep out of melee and Disengage to leave it.
 * @returns {{cell: {x: number, y: number}, dash: boolean, dodge: boolean, disengage: "action"|"bonus"|null, action: object|null, bonus: object|null, shortfall: {feet: number, attack: string, target: string}|null}}
 */
export function planTurn (actor, actors) {
	const role = roleOf(actor);
	const foes = (actors || []).filter(it => it.side !== actor.side && it.hp > 0 && !it.dead);
	const friends = (actors || []).filter(it => it.side === actor.side && it !== actor && !it.dead && it.hp < it.max);
	const speed = Math.max(1, Math.floor((actor.speed || 30) / 5));
	const attacks = (actor.options || []).filter(option => option.kind !== "utility");
	const normal = bestAttack(actor, attacks, actors, foes, friends, speed, role);
	let dash = false;
	let choice = normal;
	if (!choice) {
		choice = bestAttack(actor, attacks, actors, foes, friends, speed * 2, role);
		dash = !!choice && feetBetween(actor, choice.cell) > speed * 5;
	}
	if (!choice && foes.length) {
		const goal = nearest(actor, foes);
		const cell = walk(actor, goal, actors, speed * 2).at(-1);
		const attack = attacks[0];
		const reach = rangeOf(attack || {}).feet || 5;
		return {
			cell,
			dash: feetBetween(actor, cell) > speed * 5,
			dodge: false,
			disengage: disengageMode(actor, cell, foes, role),
			action: null,
			bonus: null,
			shortfall: {
				feet: Math.max(0, feetBetween(cell, goal) - reach),
				attack: attack?.name || "an attack",
				target: goal.name,
			},
		};
	}
	const cell = choice?.cell || {x: actor.x, y: actor.y};
	const disengage = disengageMode(actor, cell, foes, role);
	const action = disengage === "action" ? null : choice;
	const bonus = disengage === "bonus" ? null : bestBonus(actor, attacks, actors, foes, friends, cell, role, action);
	const engaged = foes.some(foe => feetBetween(actor, foe) <= 5);
	return {
		cell,
		dash,
		dodge: !action && !bonus && engaged && feetBetween(actor, cell) === 0,
		disengage,
		action,
		bonus,
		shortfall: null,
	};
}

export function roleOf (actor) {
	const text = `${actor?.classes || ""} ${actor?.name || ""}`.toLowerCase();
	if (/wizard|sorcerer|warlock|bard/.test(text)) return "caster";
	if (/cleric|druid/.test(text)) return "priest";
	if (/ranger|rogue|goblin/.test(text)) return "skirmisher";
	if (/fighter|barbarian|paladin|monk/.test(text)) return "striker";
	const options = actor?.options || [];
	const ranged = options.some(option => option.melee === false && option.kind === "attack");
	const melee = options.some(option => option.kind === "attack" && option.melee !== false && !option.spell);
	if (ranged && !melee) return "skirmisher";
	if (options.some(option => option.spell) && !melee) return "caster";
	return "striker";
}

function bestAttack (actor, attacks, actors, foes, friends, steps, role) {
	let best = null;
	for (const option of attacks) {
		if (optionSlot(option) !== "action") continue;
		if (isLeveled(option) && !(actor.pool || []).some(slot => slot.level >= option.level)) continue;
		const found = bestCell(actor, option, actors, foes, friends, steps, role);
		if (found && (!best || found.score > best.score)) best = found;
	}
	return best;
}

function bestBonus (actor, attacks, actors, foes, friends, cell, role, action) {
	const blocked = action?.option && isLeveled(action.option);
	let best = null;
	for (const option of attacks) {
		if (optionSlot(option) !== "bonus") continue;
		if (blocked && isLeveled(option)) continue;
		if (isLeveled(option) && !(actor.pool || []).some(slot => slot.level >= option.level)) continue;
		const range = rangeOf(option);
		const goals = option.kind === "heal" ? friends : foes;
		for (const goal of goals) {
			if (feetBetween(cell, goal) > range.feet) continue;
			let score = swingScore(option, actor, goal, range) + positionBias(role, cell, foes);
			if (role === "priest" && option.kind === "heal" && goal.hp <= goal.max / 2) score += 8;
			if (!best || score > best.score) best = {score, cell, option, targets: targetsFor(cell, goal, range, foes)};
		}
	}
	return best;
}

function bestCell (actor, option, actors, foes, friends, steps, role) {
	const goals = option.kind === "heal" ? friends : foes;
	if (!goals.length) return null;
	const range = rangeOf(option);
	let best = null;
	for (const goal of goals) {
		const toward = walk(actor, goal, actors, steps);
		const away = role === "striker" ? [] : walkAway(actor, foes, actors, steps);
		for (const cell of [...toward, ...away]) {
			if (feetBetween(cell, goal) > range.feet) continue;
			const targets = targetsFor(cell, goal, range, option.kind === "heal" ? friends : foes);
			if (!targets.length) continue;
			let score = 0;
			for (const target of targets) score += swingScore(option, actor, target, range);
			score += positionBias(role, cell, foes);
			if (role === "priest" && option.kind === "heal" && goal.hp <= goal.max / 2) score += 8;
			if (!best || score > best.score) best = {score, cell, option, targets};
		}
	}
	return best;
}

function swingScore (option, actor, target, range) {
	const list = option.repeats?.length ? option.repeats : [option];
	const times = !option.spell && option.activation !== "bonus" && !option.repeats ? actor.extraSwings || 1 : 1;
	let score = 0;
	for (let n = 0; n < times; n++) {
		for (const swing of list) {
			if (swing.kind === "heal") score += (swing.dice || 0) + (swing.flat || 0);
			else score += expectedDamage(swing, {
				ac: target.ac,
				mode: "normal",
				saveBonus: target.saveBonus,
			});
		}
	}
	if (range.melee && target.hp > 0) score += 0;
	return score;
}

function positionBias (role, cell, foes) {
	if (!foes.length) return 0;
	const nearest = Math.min(...foes.map(foe => feetBetween(cell, foe)));
	if (role === "striker") return (100 - nearest) * 0.02;
	if (nearest <= 5) return -6;
	return 0;
}

function disengageMode (actor, cell, foes, role) {
	const wasEngaged = foes.some(foe => feetBetween(actor, foe) <= 5);
	const still = foes.some(foe => feetBetween(cell, foe) <= 5);
	if (!wasEngaged || still) return null;
	if (actor.bonusDisengage) return "bonus";
	if (role === "striker") return null;
	return "action";
}

function walk (actor, goal, actors, steps) {
	return march(actor, goal, actors, steps, 1);
}

function walkAway (actor, foes, actors, steps) {
	const foe = nearest(actor, foes);
	if (!foe) return [{x: actor.x, y: actor.y}];
	return march(actor, foe, actors, steps, -1);
}

function march (actor, goal, actors, steps, direction) {
	const cells = [{x: actor.x, y: actor.y}];
	let x = actor.x;
	let y = actor.y;
	for (let i = 0; i < steps; i++) {
		let dx = Math.sign(goal.x - x) * direction;
		let dy = Math.sign(goal.y - y) * direction;
		if (!dx && !dy) {
			dx = direction > 0 ? 0 : 1;
		}
		const nx = clamp(x + dx, 0, COLS - 1);
		const ny = clamp(y + dy, 0, ROWS - 1);
		const blocked = (spot) => (actors || []).some(it => it.hp > 0 && it !== actor && it.x === spot.x && it.y === spot.y);
		let next = {x: nx, y: ny};
		if (blocked(next)) {
			const side = [{x: clamp(x + dx, 0, COLS - 1), y}, {x, y: clamp(y + dy, 0, ROWS - 1)}]
				.find(spot => (spot.x !== x || spot.y !== y) && !blocked(spot));
			if (!side) break;
			next = side;
		}
		if (next.x === x && next.y === y) break;
		x = next.x;
		y = next.y;
		cells.push({x, y});
	}
	return cells;
}

function nearest (actor, goals) {
	return [...goals].sort((a, b) => feetBetween(actor, a) - feetBetween(actor, b))[0];
}

function targetsFor (cell, goal, range, foes) {
	if (feetBetween(cell, goal) > range.feet) return [];
	if (range.aoe) return foes.filter(it => it.hp > 0 && feetBetween(goal, it) <= range.aoe);
	return [goal];
}

function rangeOf (option) {
	if (option?.rangeFeet) return {feet: option.rangeFeet, melee: !!option.melee, aoe: option.aoe || 0};
	const text = `${option?.range || ""} ${option?.blurb || ""}`;
	const aoeMatch = text.match(/(\d+)\s*-?\s*foot[-\s]?(?:radius|sphere|emanation|cube)/i);
	const aoe = aoeMatch ? Number(aoeMatch[1]) : 0;
	const reach = text.match(/reach\s+(\d+)/i);
	const ranged = text.match(/range\s+(\d+)/i);
	if (reach && ranged) return {feet: Number(ranged[1]), melee: false, aoe};
	if (reach) return {feet: Number(reach[1]), melee: true, aoe};
	const slash = text.match(/(\d+)\s*\/\s*\d+/);
	if (slash) return {feet: Number(slash[1]), melee: false, aoe};
	const feet = text.match(/(\d+)\s*ft/i);
	if (feet) {
		const n = Number(feet[1]);
		return {feet: n, melee: n <= 10 && !aoe, aoe};
	}
	if (option?.kind === "attack" && !option?.spell) return {feet: 5, melee: true, aoe: 0};
	return {feet: 60, melee: false, aoe};
}

function optionSlot (option) {
	if (option?.activation === "bonus" || option?.slot === "bonus") return "bonus";
	return "action";
}

function isLeveled (option) {
	return !!(option?.spell && option.level > 0);
}

function feetBetween (a, b) {
	return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;
}

function clamp (n, min, max) {
	return Math.min(max, Math.max(min, n));
}
