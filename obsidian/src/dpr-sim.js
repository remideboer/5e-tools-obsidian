import {expectedDamage, spellAtSlot, takeHighestSlot} from "./dpr-calc.js";
import {rollDice} from "./dice-roll.js";

const COLS = 10;
const ROWS = 8;
const MAX_ROUNDS = 12;
const CONDITIONS = ["prone", "restrained", "poisoned", "stunned", "paralyzed"];

export function createFight (party, enemies) {
	const actors = [];
	place(actorsFrom(party, "party"), 1, actors);
	place(actorsFrom(enemies, "enemy"), 6, actors);
	for (const actor of actors) {
		const roll = rollDice(`1d20${signed(actor.initMod)}`);
		actor.init = roll.total ?? 0;
	}
	actors.sort((a, b) => b.init - a.init || (a.side === "party" ? -1 : 1));
	return {
		actors,
		order: actors.map(actor => actor.id),
		round: 1,
		cursor: 0,
		over: false,
		log: [],
		cols: COLS,
		rows: ROWS,
	};
}

export function stepTurn (fight) {
	if (!fight || fight.over) return fight;
	if (fight.round > MAX_ROUNDS || !sideLiving(fight, "party") || !sideLiving(fight, "enemy")) {
		fight.over = true;
		fight.rounds = Math.min(fight.round, MAX_ROUNDS);
		return fight;
	}
	let guard = 0;
	let actor = null;
	while (guard < fight.order.length) {
		actor = fight.actors.find(it => it.id === fight.order[fight.cursor]);
		if (actor && actor.hp > 0) break;
		actor = null;
		advance(fight);
		guard++;
	}
	if (!actor) {
		fight.over = true;
		fight.rounds = fight.round;
		return fight;
	}
	takeTurn(fight, actor);
	advance(fight);
	if (fight.round > MAX_ROUNDS || !sideLiving(fight, "party") || !sideLiving(fight, "enemy")) {
		fight.over = true;
		fight.rounds = Math.min(fight.round, MAX_ROUNDS);
	}
	return fight;
}

export function stepRound (fight) {
	if (!fight || fight.over) return fight;
	const round = fight.round;
	let guard = 0;
	while (!fight.over && fight.round === round && guard < fight.order.length + 2) {
		stepTurn(fight);
		guard++;
	}
	return fight;
}

export function runFight (fight) {
	let guard = 0;
	while (fight && !fight.over && guard < 400) {
		stepTurn(fight);
		guard++;
	}
	return fight;
}

export function summarize (fight) {
	const actors = fight?.actors || [];
	const damage = actors.reduce((sum, actor) => sum + actor.dealt, 0);
	const healing = actors.reduce((sum, actor) => sum + actor.healed, 0);
	return {
		rounds: fight?.rounds || fight?.round || 0,
		damage,
		healing,
		dropped: actors.filter(actor => actor.hp <= 0).map(actor => actor.name),
		actors: actors.map(actor => ({
			name: actor.name,
			side: actor.side,
			damage: actor.dealt,
			healing: actor.healed,
			hits: actor.hits,
			hp: Math.max(0, Math.round(actor.hp)),
			max: actor.max,
		})),
	};
}

export function combineReports (reports) {
	const list = reports || [];
	const stat = (pick) => {
		const values = list.map(pick).filter(n => Number.isFinite(n));
		if (!values.length) return {avg: 0, min: 0, max: 0};
		const sum = values.reduce((total, n) => total + n, 0);
		return {avg: sum / values.length, min: Math.min(...values), max: Math.max(...values)};
	};
	const names = [...new Set(list.flatMap(report => report.actors.map(actor => actor.name)))];
	return {
		runs: list.length,
		rounds: stat(report => report.rounds),
		damage: stat(report => report.damage),
		healing: stat(report => report.healing),
		actors: names.map(name => ({
			name,
			damage: stat(report => report.actors.find(actor => actor.name === name)?.damage || 0),
			healing: stat(report => report.actors.find(actor => actor.name === name)?.healing || 0),
		})),
	};
}

function actorsFrom (list, side) {
	return (list || []).map((actor, index) => ({
		id: `${side}-${index}-${actor.name}`,
		name: actor.name || side,
		side,
		ac: Number(actor.ac) || 10,
		hp: Math.max(1, Number(actor.max ?? actor.hp) || 1),
		max: Math.max(1, Number(actor.max ?? actor.hp) || 1),
		speed: Math.max(5, Number(actor.speed) || 30),
		initMod: Number(actor.initMod) || 0,
		saveBonus: Number(actor.saveBonus) || 0,
		image: actor.image || "",
		options: actor.options || [],
		extraSwings: Math.max(1, Number(actor.extraSwings) || 1),
		characterLevel: Number(actor.characterLevel) || 1,
		pool: (actor.pool || []).map(slot => ({level: slot.level, pact: !!slot.pact})),
		x: 0,
		y: 0,
		conditions: new Set(),
		dealt: 0,
		healed: 0,
		hits: 0,
	}));
}

function place (group, col, actors) {
	const start = Math.max(0, Math.floor((ROWS - group.length) / 2));
	group.forEach((actor, index) => {
		actor.x = col;
		actor.y = Math.min(ROWS - 1, start + index);
		actors.push(actor);
	});
}

function takeTurn (fight, actor) {
	if (actor.conditions.has("stunned") || actor.conditions.has("paralyzed")) {
		log(fight, actor, `${actor.name} is ${actor.conditions.has("paralyzed") ? "paralyzed" : "stunned"} and skips the turn.`);
		return;
	}
	const action = bestOption(actor, fight.actors, "action");
	const bonusBlocked = action?.option && isLeveled(action.option);
	const bonus = bestOption(actor, fight.actors, "bonus", bonusBlocked);
	if (!action && !bonus) {
		log(fight, actor, `${actor.name} has nothing in reach.`);
		return;
	}
	if (action) resolveChoice(fight, actor, action);
	if (bonus) resolveChoice(fight, actor, bonus);
}

function bestOption (actor, actors, slot, blockLeveled) {
	let best = null;
	for (const option of actor.options) {
		const optionSlot = option.activation === "bonus" || option.slot === "bonus" ? "bonus" : "action";
		if (optionSlot !== slot) continue;
		if (blockLeveled && isLeveled(option)) continue;
		if (isLeveled(option) && !actor.pool.some(item => item.level >= option.level)) continue;
		const scored = scoreOption(actor, option, actors);
		if (!scored) continue;
		if (!best || scored.score > best.score) best = scored;
	}
	return best;
}

function scoreOption (actor, option, actors) {
	const range = optionRange(option);
	const foes = actors.filter(it => it.side !== actor.side && it.hp > 0);
	const friends = actors.filter(it => it.side === actor.side && it.hp > 0 && it.hp < it.max);
	const goals = option.kind === "heal" ? friends : foes;
	if (!goals.length) return null;
	let best = null;
	for (const goal of goals) {
		for (const cell of approach(actor, goal, actors)) {
			if (feetBetween(cell, goal) > range.feet) continue;
			const targets = targetsFor(cell, goal, range, option.kind === "heal" ? actors.filter(it => it.side === actor.side) : foes);
			if (!targets.length) continue;
			let score = 0;
			for (const target of targets) {
				score += optionScore(option, actor, target, range);
			}
			if (conditionName(option) && !goal.conditions.has(conditionName(option))) score += 2;
			if (!best || score > best.score) best = {score, cell, goal, option, targets};
		}
	}
	return best;
}

function optionScore (option, actor, target, range) {
	const list = option.repeats?.length ? option.repeats : [option];
	const times = !option.spell && option.activation !== "bonus" && !option.repeats ? actor.extraSwings : 1;
	let score = 0;
	for (let n = 0; n < times; n++) {
		for (const swing of list) {
			if (swing.kind === "heal") score += (swing.dice || 0) + (swing.flat || 0);
			else score += expectedDamage(swing, {
				ac: target.ac,
				mode: attackMode(actor, target, range.melee),
				saveBonus: target.saveBonus,
			});
		}
	}
	return score;
}

function resolveChoice (fight, actor, choice) {
	actor.x = choice.cell.x;
	actor.y = choice.cell.y;
	let cast = choice.option;
	if (isLeveled(cast)) {
		const slot = takeHighestSlot(actor.pool, cast.level);
		if (!slot) return;
		cast = spellAtSlot(cast, slot.level, actor.characterLevel);
	} else if (cast.spell && !(cast.level > 0)) {
		cast = spellAtSlot(cast, 0, actor.characterLevel);
	}
	const range = optionRange(cast);
	const list = cast.repeats?.length ? cast.repeats : [cast];
	const times = !cast.spell && cast.activation !== "bonus" && !cast.repeats ? actor.extraSwings : 1;
	for (let n = 0; n < times; n++) {
		for (const swing of list) {
			const target = choice.targets.find(it => it.hp > 0) || choice.targets[0];
			if (!target || target.hp <= 0) break;
			applyCast(fight, actor, swing, target, range, choice.targets);
		}
	}
}

function applyCast (fight, actor, cast, target, range, area) {
	const mode = attackMode(actor, target, range.melee);
	if (cast.kind === "heal") {
		const amount = rollAmount(cast, false);
		const ally = [...area].filter(it => it.hp > 0 && it.hp < it.max).sort((a, b) => a.hp - b.hp)[0] || target;
		const before = ally.hp;
		ally.hp = Math.min(ally.max, ally.hp + amount);
		actor.healed += ally.hp - before;
		log(fight, actor, `${actor.name} heals ${ally.name} for ${amount} (${ally.hp}/${ally.max}).`);
		return;
	}
	if (cast.kind === "save" || cast.kind === "auto") {
		const victims = range.aoe ? area.filter(it => feetBetween(target, it) <= range.aoe) : [target];
		const amount = rollAmount(cast, false);
		for (const victim of victims) {
			if (cast.kind === "auto") {
				hurt(actor, victim, amount);
				log(fight, actor, `${actor.name} hits ${victim.name} for ${amount}.`);
				continue;
			}
			const save = rollD20(victim.saveBonus, "normal");
			const failed = save.nat === 1 || (save.nat !== 20 && save.total < (cast.dc || 10));
			const dealt = failed ? amount : Math.floor(amount / 2);
			hurt(actor, victim, dealt);
			const named = failed ? applyCondition(victim, cast) : "";
			log(fight, actor, `${victim.name} ${failed ? "fails" : "saves"} DC ${cast.dc || 10} (${save.total}) and takes ${dealt}${named}.`);
		}
		return;
	}
	const attack = rollD20(cast.bonus || 0, mode);
	const autoCrit = range.melee && (target.conditions.has("paralyzed") || target.conditions.has("stunned"));
	const crit = attack.nat === 20 || (autoCrit && attack.nat !== 1 && attack.total >= target.ac);
	const hit = attack.nat !== 1 && (attack.nat === 20 || attack.total >= target.ac);
	if (!hit) {
		log(fight, actor, `${actor.name} misses ${target.name} (${attack.total} vs AC ${target.ac}).`);
		return;
	}
	const amount = rollAmount(cast, crit);
	hurt(actor, target, amount);
	actor.hits += 1;
	log(fight, actor, `${actor.name} ${crit ? "crits" : "hits"} ${target.name} (${attack.total}) for ${amount}.`);
}

function hurt (actor, target, amount) {
	target.hp = Math.max(0, target.hp - amount);
	actor.dealt += amount;
}

function applyCondition (target, cast) {
	const name = conditionName(cast);
	if (!name || target.conditions.has(name)) return "";
	target.conditions.add(name);
	return ` and is ${name}`;
}

function conditionName (option) {
	const text = `${option?.name || ""} ${option?.blurb || ""}`.toLowerCase();
	return CONDITIONS.find(name => text.includes(name)) || "";
}

function rollAmount (cast, crit) {
	const count = Math.max(0, Number(cast.count) || 0) * (crit ? 2 : 1);
	const faces = Number(cast.faces) || 0;
	if (!count || !faces) return Math.max(0, Math.round((cast.dice || 0) + (cast.flat || 0)));
	const rolled = rollDice(`${count}d${faces}`);
	return Math.max(0, (rolled.total || 0) + (Number(cast.flat) || 0));
}

function rollD20 (bonus, mode) {
	const first = rollDice("1d20");
	const second = rollDice("1d20");
	let nat = first.total || 1;
	if (mode === "advantage") nat = Math.max(first.total || 1, second.total || 1);
	if (mode === "disadvantage") nat = Math.min(first.total || 1, second.total || 1);
	return {nat, total: nat + (Number(bonus) || 0)};
}

function attackMode (actor, target, melee) {
	let lean = 0;
	if (actor.conditions.has("poisoned") || actor.conditions.has("prone") || actor.conditions.has("restrained")) lean--;
	if (target.conditions.has("restrained") || target.conditions.has("paralyzed") || target.conditions.has("stunned")) lean++;
	if (target.conditions.has("prone")) lean += melee ? 1 : -1;
	if (lean > 0) return "advantage";
	if (lean < 0) return "disadvantage";
	return "normal";
}

function optionRange (option) {
	if (option.rangeFeet) return {feet: option.rangeFeet, melee: !!option.melee, aoe: option.aoe || 0};
	const text = `${option.range || ""} ${option.blurb || ""}`;
	const aoeMatch = text.match(/(\d+)\s*-?\s*foot[-\s]?(?:radius|sphere|emanation|cube)/i);
	const aoe = aoeMatch ? Number(aoeMatch[1]) : 0;
	const reach = text.match(/reach\s+(\d+)/i);
	if (reach) return {feet: Number(reach[1]), melee: true, aoe};
	const slash = text.match(/(\d+)\s*\/\s*\d+/);
	if (slash) return {feet: Number(slash[1]), melee: false, aoe};
	const feet = text.match(/(\d+)\s*ft/i);
	if (feet) {
		const n = Number(feet[1]);
		return {feet: n, melee: n <= 10 && !aoe, aoe};
	}
	if (option.kind === "attack" && !option.spell) return {feet: 5, melee: true, aoe: 0};
	return {feet: 60, melee: false, aoe};
}

function approach (actor, goal, actors) {
	const cells = [{x: actor.x, y: actor.y}];
	let x = actor.x;
	let y = actor.y;
	const steps = Math.max(0, Math.floor((actor.speed || 30) / 5));
	for (let i = 0; i < steps; i++) {
		const dx = Math.sign(goal.x - x);
		const dy = Math.sign(goal.y - y);
		if (!dx && !dy) break;
		const nx = clamp(x + dx, 0, COLS - 1);
		const ny = clamp(y + dy, 0, ROWS - 1);
		if (actors.some(it => it.hp > 0 && it !== actor && it.x === nx && it.y === ny)) break;
		x = nx;
		y = ny;
		cells.push({x, y});
	}
	return cells;
}

function feetBetween (a, b) {
	return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;
}

function targetsFor (cell, goal, range, foes) {
	if (feetBetween(cell, goal) > range.feet) return [];
	if (range.aoe) return foes.filter(it => it.hp > 0 && feetBetween(goal, it) <= range.aoe);
	return [goal];
}

function isLeveled (option) {
	return !!(option?.spell && option.level > 0);
}

function sideLiving (fight, side) {
	return fight.actors.some(actor => actor.side === side && actor.hp > 0);
}

function advance (fight) {
	fight.cursor++;
	if (fight.cursor >= fight.order.length) {
		fight.cursor = 0;
		fight.round++;
	}
}

function log (fight, actor, text) {
	fight.log.push({round: fight.round, name: actor?.name || "", text});
	if (fight.log.length > 80) fight.log.shift();
}

function signed (mod) {
	const n = Number(mod) || 0;
	return n >= 0 ? `+${n}` : `${n}`;
}

function clamp (n, min, max) {
	return Math.min(max, Math.max(min, n));
}
