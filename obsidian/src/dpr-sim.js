import {planTurn} from "./dpr-ai.js";
import {beamsAt, classLevel, damageFactor, expectedDamage, rageDamage, spellAtSlot, spendSlot} from "./dpr-calc.js";
import {rollDice} from "./dice-roll.js";
import {xpFromCr} from "./encounter-difficulty.js";

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
	const fight = {
		actors,
		order: actors.map(actor => actor.id),
		round: 1,
		cursor: 0,
		over: false,
		xp: 0,
		log: [],
		cols: COLS,
		rows: ROWS,
	};
	log(fight, null, `Initiative: ${actors.map(actor => `${actor.name} ${actor.init}`).join(", ")}.`);
	return fight;
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
		if (actor && !isGone(actor)) break;
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
		xp: partyXp(fight),
		share: partyShare(fight),
		alive: actors.filter(actor => !isGone(actor)).map(actor => actor.name),
		dead: actors.filter(isGone).map(actor => actor.name),
		actors: actors.map(actor => ({
			name: actor.name,
			side: actor.side,
			damage: actor.dealt,
			healing: actor.healed,
			hits: actor.hits,
			hp: Math.max(0, Math.round(actor.hp)),
			max: actor.max,
			dead: isGone(actor),
			dying: !!actor.dying,
			stable: !!actor.stable,
		})),
	};
}

export function combineReports (reports) {
	const list = reports || [];
	const stat = (pick) => {
		const values = list.map(pick).filter(n => Number.isFinite(n));
		if (!values.length) return {mean: 0, median: 0, sd: 0};
		const mean = values.reduce((total, n) => total + n, 0) / values.length;
		const sorted = [...values].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
		const sd = Math.sqrt(values.reduce((total, n) => total + (n - mean) ** 2, 0) / values.length);
		return {mean, median, sd};
	};
	const names = [...new Set(list.flatMap(report => report.actors.map(actor => actor.name)))];
	return {
		runs: list.length,
		rounds: stat(report => report.rounds),
		damage: stat(report => report.damage),
		healing: stat(report => report.healing),
		xp: stat(report => report.xp),
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
		options: (actor.options || []).map(copyOption),
		extraSwings: Math.max(1, Number(actor.extraSwings) || 1),
		characterLevel: Number(actor.characterLevel) || 1,
		pool: (actor.pool || []).map(slot => ({level: slot.level, pact: !!slot.pact})),
		classes: actor.classes || "",
		bonusDisengage: (actor.options || []).some(option => option.utility === "disengage" && (option.activation === "bonus" || option.slot === "bonus")),
		saveMods: actor.saveMods || null,
		type: String(actor.type || ""),
		traits: actor.traits || null,
		legendaryUses: Number(actor.traits?.legendary) || 0,
		chaMod: Number(actor.chaMod) || 0,
		wisMod: Number(actor.wisMod) || 0,
		spellDc: Number(actor.spellDc) || 10,
		...classResources(actor),
		cr: actor.cr || "",
		int: Number.isFinite(Number(actor.int)) ? Number(actor.int) : null,
		defenses: {
			immune: [...(actor.defenses?.immune || [])],
			resist: [...(actor.defenses?.resist || [])],
			vulnerable: [...(actor.defenses?.vulnerable || [])],
		},
		x: 0,
		y: 0,
		conditions: new Set(),
		dead: false,
		dying: false,
		stable: false,
		saves: {success: 0, fail: 0},
		dealt: 0,
		healed: 0,
		hits: 0,
	}));
}

function copyOption (option) {
	return {
		...option,
		scale: option?.scale ? {...option.scale} : option?.scale,
		cantrip: option?.cantrip ? option.cantrip.map(row => ({...row})) : option?.cantrip,
		repeats: option?.repeats ? option.repeats.map(swing => ({...swing})) : option?.repeats,
		beastOptions: option?.beastOptions ? option.beastOptions.map(swing => ({...swing, repeats: swing.repeats?.map(part => ({...part}))})) : option?.beastOptions,
		onHit: option?.onHit ? {...option.onHit, extra: option.onHit.extra ? {...option.onHit.extra} : null, save: option.onHit.save ? {...option.onHit.save} : null, onZero: [...(option.onHit.onZero || [])]} : option?.onHit,
		beams: option?.beams ? option.beams.map(row => ({...row})) : option?.beams,
	};
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
	if (actor.side === "party" && actor.hp <= 0) {
		if (actor.stable) {
			log(fight, actor, `${actor.name} is stable at 0 hit points and skips the turn.`);
			return;
		}
		rollDeathSave(fight, actor);
		return;
	}
	if (actor.conditions.has("stunned") || actor.conditions.has("paralyzed") || actor.conditions.has("incapacitated")) {
		log(fight, actor, `${actor.name} is ${[...actor.conditions][0] || "stunned"} and skips the turn.`);
		return;
	}
	openTurn(fight, actor);
	if (actor.dead) return;
	actor.acted = true;
	if (actor.conditions.has("turned")) {
		const from = fight.actors.find(it => it.id === actor.turnedFrom) || fight.actors.find(it => it.side !== actor.side && it.hp > 0);
		const cell = from ? walkAwayFrom(actor, from) : {x: actor.x, y: actor.y};
		moveActor(fight, actor, cell, true);
		log(fight, actor, `${actor.name} is turned and moves away.`);
		return;
	}
	actor.dodging = false;
	const plan = planTurn(actor, fight.actors);
	const disengaged = plan.disengage === "action" || plan.disengage === "bonus";
	if (plan.disengage === "bonus") log(fight, actor, `${actor.name} takes Disengage as a bonus action.`);
	if (plan.disengage === "action") log(fight, actor, `${actor.name} takes the Disengage action.`);
	if (plan.dash) log(fight, actor, `${actor.name} takes the Dash action.`);
	if (plan.aggressive) log(fight, actor, `${actor.name} uses Aggressive to close in.`);
	if (plan.steady) actor.advantageNext = true;
	moveActor(fight, actor, plan.cell, disengaged);
	if (actor.hp <= 0 || actor.dead) return;
	if (plan.shortfall) {
		log(fight, actor, `${actor.name} is still ${plan.shortfall.feet} ft short of ${plan.shortfall.attack} against ${plan.shortfall.target}.`);
	}
	if (plan.dodge) {
		actor.dodging = true;
		log(fight, actor, `${actor.name} takes the Dodge action.`);
		return;
	}
	const utility = plan.bonus?.option?.utility;
	if (utility && BEFORE_ACTION.has(utility)) {
		actor.bonusSpent = true;
		resolveChoice(fight, actor, plan.bonus);
	}
	if (plan.vow) vowAgainst(fight, actor, plan.vow);
	if (actor.hp <= 0 || actor.dead) return;
	if (plan.action) resolveChoice(fight, actor, plan.action);
	if (actor.hp <= 0 || actor.dead) return;
	if (plan.freeSmite) resolveChoice(fight, actor, {option: (actor.options || []).find(option => option.rider === "smite"), targets: plan.action?.targets || []});
	if (plan.bonus?.option?.rider === "smite" && !actor.bonusSpent) {
		actor.bonusSpent = true;
		resolveChoice(fight, actor, plan.bonus);
	}
	if (plan.surge && (actor.surgeUses || 0) > 0) {
		actor.surgeUses -= 1;
		log(fight, actor, `${actor.name} uses Action Surge.`);
		resolveChoice(fight, actor, plan.surge);
	}
	if (actor.hp <= 0 || actor.dead) return;
	if (utility && !BEFORE_ACTION.has(utility) && plan.bonus?.option?.rider !== "smite" && !actor.bonusSpent) {
		actor.bonusSpent = true;
		resolveChoice(fight, actor, plan.bonus);
	}
	actor.advantageNext = false;
	closeTurn(fight, actor);
}

const BEFORE_ACTION = new Set(["rage", "wildshape", "mark", "move-mark", "steady", "duplicity", "harness", "extend-rage"]);

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
	const friends = actors.filter(it => it.side === actor.side && !isGone(it) && it.hp < it.max);
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

function moveActor (fight, actor, cell, disengaged) {
	const dest = cell || {x: actor.x, y: actor.y};
	const from = {x: actor.x, y: actor.y};
	let guard = 0;
	while ((actor.x !== dest.x || actor.y !== dest.y) && guard < 20) {
		const next = {
			x: actor.x + Math.sign(dest.x - actor.x),
			y: actor.y + Math.sign(dest.y - actor.y),
		};
		if (!disengaged) opportunity(fight, actor, next);
		if (actor.hp <= 0 || actor.dead) return;
		actor.x = next.x;
		actor.y = next.y;
		guard++;
	}
	const moved = feetBetween(from, actor);
	actor.moved = (actor.moved || 0) + moved;
	if (moved > 0) log(fight, actor, `${actor.name} moves ${moved} ft.`);
}

function opportunity (fight, actor, next) {
	if (actor.traits?.flyby) return;
	const enemies = fight.actors.filter(it => it.side !== actor.side && it.hp > 0 && feetBetween(actor, it) <= 5 && feetBetween(next, it) > 5);
	for (const enemy of enemies) {
		const melee = (enemy.options || []).find(option => option.kind === "attack" && option.melee !== false && !option.spell && (option.rangeFeet || 5) <= 10 && !option.repeats);
		const swing = melee || (enemy.options || []).find(option => option.repeats)?.repeats?.find(option => option.melee !== false);
		if (!swing) continue;
		log(fight, enemy, `${enemy.name} makes an opportunity attack against ${actor.name}.`);
		applyCast(fight, enemy, swing, actor, {feet: 5, melee: true, aoe: 0}, [actor]);
		if (actor.hp <= 0 || actor.dead) return;
	}
}

function resolveChoice (fight, actor, choice) {
	let cast = choice?.option;
	if (!cast) return;
	if (resolveFeature(fight, actor, choice)) return;
	if (isLeveled(cast)) {
		const missing = cast.kind === "heal" ? missingHp(choice.targets) : Infinity;
		const slot = spendSlot(actor.pool, cast, {missing, disciple: !!actor.disciple, characterLevel: actor.characterLevel});
		if (!slot) return;
		actor.spent.push({level: slot.level, pact: !!slot.pact});
		cast = spellAtSlot(cast, slot.level, actor.characterLevel);
		cast.castLevel = slot.level;
		if (cast.kind === "heal" && actor.disciple && slot.level > 0) cast.flat = (cast.flat || 0) + 2 + slot.level;
	} else if (cast.spell && !(cast.level > 0)) {
		cast = spellAtSlot(cast, 0, actor.characterLevel);
	}
	if (cast.beams?.length) {
		const count = beamsAt(cast.beams, actor.characterLevel);
		const one = {...cast, beams: null, repeats: null, flat: (cast.flat || 0) + (cast.name && /eldritch blast/i.test(cast.name) && actor.agonizing ? actor.chaMod : 0)};
		cast = {...cast, repeats: Array.from({length: count}, () => ({...one}))};
	}
	actor.landed = null;
	const range = optionRange(cast);
	const list = cast.repeats?.length ? cast.repeats : [cast];
	const times = !cast.spell && cast.activation !== "bonus" && !cast.repeats ? actor.extraSwings : 1;
	for (let n = 0; n < times; n++) {
		for (const swing of list) {
			const target = swing.kind === "heal"
				? choice.targets.find(it => !isGone(it) && it.hp < it.max)
				: choice.targets.find(it => !it.dead && (it.hp > 0 || it.dying || it.stable));
			if (!target) break;
			applyCast(fight, actor, swing, target, range, choice.targets);
		}
	}
}

function applyCast (fight, actor, cast, target, range, area) {
	const mode = attackMode(actor, target, range.melee, fight.actors);
	if (target.openBy) target.openBy = "";
	if (cast.kind === "heal") {
		const amount = rollAmount(cast, false);
		const ally = [...area].filter(it => !isGone(it) && it.hp < it.max).sort((a, b) => a.hp - b.hp)[0] || target;
		const before = ally.hp;
		ally.hp = Math.min(ally.max, ally.hp + amount);
		actor.healed += ally.hp - before;
		log(fight, actor, `${actor.name} heals ${ally.name} with ${cast.name} for ${amount} (${Math.round(ally.hp)}/${ally.max}).`);
		wake(ally);
		return;
	}
	if (cast.kind === "save" || cast.kind === "auto") {
		const victims = range.aoe ? area.filter(it => feetBetween(target, it) <= range.aoe) : [target];
		for (const victim of victims) {
			const rolled = adjustedAmount(cast, victim, false);
			if (cast.kind === "auto") {
				hurt(fight, actor, victim, rolled.amount, false, false, cast.damage);
				log(fight, actor, `${actor.name} hits ${victim.name} with ${cast.name} for ${rolled.amount}${rolled.note}.`);
				continue;
			}
			const rolledSave = rollSave(fight, victim, cast.saveAbility, cast.dc || 10, {spell: !!cast.spell, matters: rolled.amount > 0 || !!conditionName(cast)});
			const failed = rolledSave.failed;
			const dealt = failed ? rolled.amount : Math.floor(rolled.amount / 2);
			hurt(fight, actor, victim, dealt, false, false, cast.damage);
			const named = failed ? applyCondition(victim, cast) : "";
			log(fight, actor, `${actor.name} casts ${cast.name}. ${victim.name} ${failed ? "fails" : "saves"} DC ${cast.dc || 10} (${rolledSave.save.total}) and takes ${dealt}${rolled.note}${named}.`);
		}
		return;
	}
	let swing = cast;
	if (actor.raging && !cast.spell && range.melee !== false && cast.kind === "attack") {
		swing = {...cast, flat: (cast.flat || 0) + (actor.rageBonus || 0)};
		actor.rageAttacked = true;
	} else if (!cast.spell && cast.kind === "attack") actor.rageAttacked = true;
	if (cast.kind === "save") actor.rageForced = true;
	const attack = rollD20(swing.bonus || 0, mode);
	const close = feetBetween(actor, target) <= 5;
	const unconscious = target.hp <= 0 && !target.dead && (target.dying || target.stable);
	const autoCrit = (range.melee && (target.conditions.has("paralyzed") || target.conditions.has("stunned")))
		|| (unconscious && close);
	const crit = attack.nat === 20 || (autoCrit && attack.nat !== 1 && attack.total >= target.ac);
	const hit = attack.nat !== 1 && (attack.nat === 20 || attack.total >= target.ac);
	if (!hit) {
		log(fight, actor, `${actor.name} misses ${target.name} with ${cast.name} (${attack.total} vs AC ${target.ac}).`);
		return;
	}
	const rolled = adjustedAmount(swing, target, crit);
	hurt(fight, actor, target, rolled.amount, crit, false, swing.damage);
	actor.hits += 1;
	actor.landed = {target, melee: range.melee !== false, weapon: !cast.spell && cast.kind === "attack", crit};
	log(fight, actor, `${actor.name} hits ${target.name} with ${cast.name} for ${rolled.amount}${crit ? " (critical)" : ""}${rolled.note}.`);
	applyOnHit(fight, actor, swing, target, crit);
	if (!cast.spell && cast.kind === "attack") applySneak(fight, actor, target, mode, range);
	applyMark(fight, actor, target, crit);
	if (actor.landed.weapon && range.melee !== false) tryStun(fight, actor, target);
	if (!cast.spell && range.melee !== false) pounce(fight, actor, target);
	if (!cast.spell && range.melee !== false && (target.hp <= 0 || target.dead)) rampage(fight, actor);
}

function adjustedAmount (cast, target, crit) {
	const factor = damageFactor(cast.damage, target.defenses);
	return {
		amount: Math.floor(rollAmount(cast, crit) * factor),
		note: factor === 0 ? " (immune)" : factor === 0.5 ? " (resisted)" : factor === 2 ? " (vulnerable)" : "",
	};
}

function hurt (fight, actor, target, amount, crit, holdDeath, type) {
	if (target.hp <= 0 && !target.dead && (target.dying || target.stable)) {
		actor.dealt += amount;
		if (amount > 0 && amount >= target.max) {
			log(fight, target, `${target.name} takes ${amount} damage at 0 hit points and dies.`);
			markDead(fight, target);
			return;
		}
		const wasStable = !!target.stable;
		target.stable = false;
		target.dying = true;
		if (wasStable || !target.saves) target.saves = {success: 0, fail: 0};
		addDeathFail(fight, target, crit ? 2 : 1, wasStable);
		return;
	}
	const before = target.hp;
	target.hp = Math.max(0, before - amount);
	actor.dealt += amount;
	noteRegen(target, type, amount);
	if (amount > 0 && target.conditions.has("turned")) {
		target.conditions.delete("turned");
		log(fight, target, `${target.name} is no longer turned.`);
	}
	if (amount > 0 && target.raging) target.rageHurt = true;
	if (target.hp > 0) return;
	if (fortitude(fight, target, amount, crit, type)) return;
	if (holdDeath) {
		target.hp = 0;
		return;
	}
	if (target.traits?.regen?.holdDeath) {
		target.hp = 0;
		log(fight, target, `${target.name} drops to 0 hit points and does not die yet.`);
		return;
	}
	const overflow = amount - before;
	if (target.side === "party" && overflow >= target.max && target.max > 0) {
		log(fight, target, `${target.name} takes ${amount} damage and dies.`);
		markDead(fight, target);
		return;
	}
	if (target.side === "enemy") markDead(fight, target);
	else knockOut(fight, target);
}

function knockOut (fight, target) {
	target.hp = 0;
	target.dying = true;
	target.stable = false;
	target.dead = false;
	target.saves = {success: 0, fail: 0};
	log(fight, target, `${target.name} falls unconscious and is dying.`);
}

function markDead (fight, target) {
	if (target.dead) return;
	target.hp = 0;
	target.dead = true;
	target.dying = false;
	target.stable = false;
	if (target.side === "enemy" && !target.xpGiven) {
		target.xpGiven = true;
		fight.xp += xpFromCr(target.cr);
	}
	log(fight, target, `${target.name} dies.`);
	deathBurst(fight, target);
}

function addDeathFail (fight, target, count, wasStable) {
	target.saves.fail += count;
	const blows = count === 2 ? "two death save failures" : "a death save failure";
	const lead = wasStable ? `${target.name} is no longer stable and takes` : `${target.name} takes damage while dying,`;
	log(fight, target, `${lead} ${blows}.`);
	if (target.saves.fail >= 3) markDead(fight, target);
}

function rollDeathSave (fight, actor) {
	const roll = rollDice("1d20");
	const nat = roll.total || 1;
	if (nat === 20) {
		actor.hp = 1;
		actor.dying = false;
		actor.stable = false;
		actor.saves = {success: 0, fail: 0};
		log(fight, actor, `${actor.name} rolls a death save: 20. ${actor.name} wakes with 1 hit point.`);
		return;
	}
	if (nat === 1) actor.saves.fail += 2;
	else if (nat >= 10) actor.saves.success += 1;
	else actor.saves.fail += 1;
	const mark = nat >= 10 ? "success" : "failure";
	log(fight, actor, `${actor.name} rolls a death save: ${nat} (${mark}). ${actor.saves.success} successes, ${actor.saves.fail} failures.`);
	if (actor.saves.success >= 3) {
		actor.dying = false;
		actor.stable = true;
		actor.saves = {success: 0, fail: 0};
		log(fight, actor, `${actor.name} is stable at 0 hit points.`);
	}
	if (actor.saves.fail >= 3) markDead(fight, actor);
}

function wake (actor) {
	if (actor.hp <= 0 || actor.dead) return;
	actor.dying = false;
	actor.stable = false;
	actor.saves = {success: 0, fail: 0};
}

function isGone (actor) {
	if (actor?.dead) return true;
	if (actor?.side === "enemy" && actor.hp <= 0) return !actor.traits?.regen?.holdDeath;
	return false;
}

function partyXp (fight) {
	const party = (fight?.actors || []).filter(actor => actor.side === "party");
	if (!party.length || party.every(actor => actor.dead)) return 0;
	return fight?.xp || 0;
}

function partyShare (fight) {
	const survivors = (fight?.actors || []).filter(actor => actor.side === "party" && !actor.dead);
	const xp = partyXp(fight);
	if (!survivors.length || !xp) return 0;
	return Math.floor(xp / survivors.length);
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

function attackMode (actor, target, melee, actors) {
	let lean = 0;
	if (actor.conditions.has("poisoned") || actor.conditions.has("prone") || actor.conditions.has("restrained") || actor.conditions.has("frightened")) lean--;
	if (target.conditions.has("restrained") || target.conditions.has("paralyzed") || target.conditions.has("stunned")) lean++;
	if (actor.advantageNext || actor.duplicity || actor.vowId === target.id || target.openBy) lean++;
	if (actor.traits?.pack && allyNear(actor, target, actors)) lean++;
	if (actor.traits?.frenzy && melee && target.hp < target.max) lean++;
	if (actor.traits?.ambush && !target.acted) lean++;
	if (target.conditions.has("prone")) lean += melee ? 1 : -1;
	if (target.hp <= 0 && !target.dead && (target.dying || target.stable)) {
		if (melee) lean++;
	}
	if (target.dodging) lean--;
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
	return fight.actors.some(actor => actor.side === side && !isGone(actor));
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
}

function signed (mod) {
	const n = Number(mod) || 0;
	return n >= 0 ? `+${n}` : `${n}`;
}

function clamp (n, min, max) {
	return Math.min(max, Math.max(min, n));
}

function classResources (actor) {
	const option = (utility) => (actor.options || []).find(item => item.utility === utility);
	const rage = option("rage");
	const barb = classLevel(actor.classes, "barbarian");
	const surge = option("surge");
	const ki = option("ki");
	const monk = classLevel(actor.classes, "monk");
	const stun = (actor.options || []).some(item => item.rider === "stun");
	const lay = option("lay");
	const pool = option("channel-pool");
	return {
		disciple: (actor.options || []).some(item => item.utility === "disciple"),
		agonizing: (actor.options || []).some(item => item.utility === "agonizing"),
		rageUses: rage ? (rage.uses > 0 ? rage.uses : rageUsesFor(barb)) : 0,
		rageBonus: rageDamage(barb || 1),
		rageEdition: rage?.edition || "classic",
		rageAdded: [],
		surgeUses: surge ? (surge.uses || 1) : 0,
		ki: ki?.uses > 0 ? ki.uses : (stun ? monk : 0),
		layPool: lay ? classLevel(actor.classes, "paladin") * 5 : 0,
		channelUses: pool?.uses || ((actor.options || []).some(item => /spark|turn|preserve|vow|harness|duplicity/.test(item.utility || "")) ? 1 : 0),
		spent: [],
		markId: "",
		markPacket: null,
		raging: false,
		duplicity: false,
		vowId: "",
		pb: Number(actor.pb) || 2,
	};
}

function rageUsesFor (level) {
	if (level >= 17) return 6;
	if (level >= 12) return 5;
	if (level >= 6) return 4;
	if (level >= 3) return 3;
	return level > 0 ? 2 : 0;
}

function openTurn (fight, actor) {
	actor.moved = 0;
	actor.turnX = actor.x;
	actor.turnY = actor.y;
	regenerate(fight, actor);
	if (actor.dead) return;
	if (actor.raging && actor.ragePendingCheck) {
		const kept = actor.rageEdition === "one"
			? (actor.rageAttacked || actor.rageForced || actor.rageExtended)
			: (actor.rageAttacked || actor.rageHurt);
		if (!kept) endRage(fight, actor);
	}
	actor.ragePendingCheck = !!actor.raging;
	actor.rageAttacked = false;
	actor.rageForced = false;
	actor.rageExtended = false;
	actor.rageHurt = false;
	actor.sneakUsed = false;
	actor.smiteUsed = false;
	actor.stunUsed = false;
	actor.advantageNext = false;
	actor.bonusSpent = false;
	actor.rampaged = false;
	for (const other of fight.actors) {
		if (other.slowedBy === actor.id) {
			other.speed = other.speedFull || other.speed;
			other.slowedBy = "";
		}
		if (other.stunBy === actor.id && !other.stunFresh) {
			other.conditions.delete("stunned");
			other.stunBy = "";
		}
		if (other.stunBy === actor.id) other.stunFresh = false;
	}
}

function closeTurn (fight, actor) {
	for (const other of fight.actors) {
		if (other.stunBy === actor.id && other.stunFresh) other.stunFresh = false;
	}
}

function endRage (fight, actor) {
	actor.raging = false;
	for (const type of actor.rageAdded || []) {
		const index = actor.defenses.resist.indexOf(type);
		if (index >= 0) actor.defenses.resist.splice(index, 1);
	}
	actor.rageAdded = [];
	log(fight, actor, `${actor.name}'s rage ends.`);
}

function vowAgainst (fight, actor, targetId) {
	if (!(actor.channelUses > 0) || actor.vowId) return;
	actor.channelUses -= 1;
	actor.vowId = targetId;
	const target = fight.actors.find(it => it.id === targetId);
	log(fight, actor, `${actor.name} vows enmity against ${target?.name || "a foe"}.`);
}

function walkAwayFrom (actor, from) {
	const steps = Math.max(1, Math.floor((actor.speed || 30) / 5));
	let x = actor.x;
	let y = actor.y;
	for (let i = 0; i < steps; i++) {
		const nextX = x + (Math.sign(x - from.x) || 1);
		const nextY = y + Math.sign(y - from.y);
		x = clamp(nextX, 0, 9);
		y = clamp(nextY, 0, 7);
	}
	return {x, y};
}

function missingHp (targets) {
	const list = (targets || []).filter(it => it && it.hp < it.max);
	if (!list.length) return Infinity;
	return Math.max(...list.map(it => it.max - it.hp));
}

function resolveFeature (fight, actor, choice) {
	const cast = choice.option;
	if (cast.utility === "wildshape") {
		actor.shaped = true;
		const beast = (cast.beastOptions || []).map(copyOption);
		const keep = (actor.options || []).filter(option => option.hidden || option.rider || option.utility);
		const spells = actor.characterLevel >= 18 ? (actor.options || []).filter(option => option.spell && !option.rider) : [];
		actor.options = [...keep, ...spells, ...beast];
		log(fight, actor, `${actor.name} uses ${cast.name} and becomes ${cast.beastName}.`);
		return true;
	}
	if (cast.utility === "rage") return enterRage(fight, actor);
	if (cast.utility === "extend-rage") {
		actor.rageExtended = true;
		log(fight, actor, `${actor.name} extends the rage.`);
		return true;
	}
	if (cast.utility === "steady") {
		log(fight, actor, `${actor.name} takes Steady Aim.`);
		return true;
	}
	if (cast.rider === "smite") return castSmite(fight, actor, cast);
	if (cast.utility === "mark" || cast.rider === "mark") return castMark(fight, actor, choice);
	if (cast.utility === "move-mark") {
		const target = choice.targets?.[0];
		if (target) {
			actor.markId = target.id;
			log(fight, actor, `${actor.name} moves ${cast.name} to ${target.name}.`);
		}
		return true;
	}
	if (cast.utility === "duplicity") return spendChannel(fight, actor, () => {
		actor.duplicity = true;
		log(fight, actor, `${actor.name} invokes a duplicate. Attacks have advantage.`);
	});
	if (cast.utility === "harness") return spendChannel(fight, actor, () => harnessSlot(fight, actor));
	if (cast.utility === "turn") return spendChannel(fight, actor, () => turnUndead(fight, actor, choice));
	if (cast.utility === "preserve") return spendChannel(fight, actor, () => preserveLife(fight, actor, choice));
	if (cast.utility === "spark") return spendChannel(fight, actor, () => spark(fight, actor, choice));
	if (cast.utility === "lay") return layOnHands(fight, actor, choice);
	if (cast.utility === "shape-heal") return shapeHeal(fight, actor);
	if (cast.utility === "channel") {
		if (!(actor.channelUses > 0)) return true;
		actor.channelUses -= 1;
		return false;
	}
	return false;
}

function enterRage (fight, actor) {
	if (actor.raging || !(actor.rageUses > 0)) return true;
	actor.raging = true;
	actor.rageUses -= 1;
	actor.ragePendingCheck = false;
	actor.markId = "";
	for (const type of ["bludgeoning", "piercing", "slashing"]) {
		if (!actor.defenses.resist.includes(type)) {
			actor.defenses.resist.push(type);
			actor.rageAdded.push(type);
		}
	}
	log(fight, actor, `${actor.name} enters a rage.`);
	return true;
}

function spendChannel (fight, actor, run) {
	if (!(actor.channelUses > 0)) return true;
	actor.channelUses -= 1;
	run();
	return true;
}

function castSmite (fight, actor, cast) {
	const landed = actor.landed;
	if (!landed?.weapon || !landed.melee || !landed.target || actor.smiteUsed || landed.target.dead) return true;
	const slot = spendSlot(actor.pool, cast, {characterLevel: actor.characterLevel});
	if (!slot) return true;
	actor.spent.push({level: slot.level, pact: !!slot.pact});
	let scaled = spellAtSlot(cast, slot.level, actor.characterLevel);
	let count = scaled.count || 2;
	const cap = Number(cast.cap) || 0;
	if (cap > 0) count = Math.min(count, cap);
	if ((landed.target.type === "fiend" || landed.target.type === "undead") && (scaled.faces || 8)) {
		count += 1;
		if (cap > 0) count = Math.min(count, cap + 1);
	}
	const faces = scaled.faces || 8;
	const packet = {...scaled, count, faces, dice: count * (faces + 1) / 2, flat: 0, damage: "radiant", kind: "auto", name: cast.name};
	const rolled = adjustedAmount(packet, landed.target, !!landed.crit);
	hurt(fight, actor, landed.target, rolled.amount, !!landed.crit, false, "radiant");
	actor.smiteUsed = true;
	log(fight, actor, `${actor.name} smites ${landed.target.name} for ${rolled.amount}${rolled.note}.`);
	return true;
}

function castMark (fight, actor, choice) {
	const cast = choice.option;
	if (cast.utility === "move-mark") return false;
	const slot = spendSlot(actor.pool, cast, {characterLevel: actor.characterLevel});
	if (!slot) return true;
	actor.spent.push({level: slot.level, pact: !!slot.pact});
	const target = choice.targets?.[0];
	if (!target) return true;
	actor.markId = target.id;
	actor.markPacket = {name: cast.name, count: cast.count || 1, faces: cast.faces || 6, flat: cast.flat || 0, dice: cast.dice || 0, damage: cast.damage || "necrotic"};
	log(fight, actor, `${actor.name} marks ${target.name} with ${cast.name}.`);
	return true;
}

function harnessSlot (fight, actor) {
	const cap = Math.max(1, Math.ceil((actor.pb || 2) / 2));
	const index = actor.spent.findIndex(slot => slot.level > 0 && slot.level <= cap);
	if (index < 0) {
		log(fight, actor, `${actor.name} channels divinity, but no spell slot returns.`);
		return;
	}
	const slot = actor.spent.splice(index, 1)[0];
	actor.pool.push({level: slot.level, pact: !!slot.pact});
	log(fight, actor, `${actor.name} regains a ${slot.level}${slot.level === 1 ? "st" : slot.level === 2 ? "nd" : slot.level === 3 ? "rd" : "th"}-level spell slot.`);
}

function turnUndead (fight, actor, choice) {
	for (const target of choice.targets || []) {
		if (target.type !== "undead" || target.hp <= 0) continue;
		const rolledSave = rollSave(fight, target, "wis", actor.spellDc || 10, {condition: "frightened", matters: true});
		const failed = rolledSave.failed;
		if (!failed) {
			log(fight, actor, `${target.name} saves against Turn Undead (${rolledSave.save.total}).`);
			continue;
		}
		target.conditions.add("turned");
		target.conditions.add("frightened");
		target.conditions.add("incapacitated");
		target.turnedFrom = actor.id;
		log(fight, actor, `${target.name} fails against Turn Undead and is turned.`);
	}
}

function preserveLife (fight, actor, choice) {
	let pool = 5 * Math.max(1, classLevel(actor.classes, "cleric"));
	for (const ally of choice.targets || []) {
		if (!(pool > 0) || ally.hp >= ally.max / 2) continue;
		const amount = Math.min(pool, Math.floor(ally.max / 2) - ally.hp);
		if (!(amount > 0)) continue;
		ally.hp += amount;
		pool -= amount;
		actor.healed += amount;
		log(fight, actor, `${actor.name} restores ${amount} hit points to ${ally.name} (${Math.round(ally.hp)}/${ally.max}).`);
	}
}

function spark (fight, actor, choice) {
	const cast = choice.option;
	const target = choice.targets?.[0];
	if (!target) return;
	const flat = actor.wisMod || 0;
	if (cast.kind === "heal") {
		applyCast(fight, actor, {...cast, kind: "heal", flat, spell: false}, target, {feet: 30, melee: false, aoe: 0}, [target]);
		return;
	}
	applyCast(fight, actor, {...cast, kind: "save", flat, dc: actor.spellDc || 10, spell: false, damage: cast.damage || "radiant"}, target, {feet: 30, melee: false, aoe: 0}, [target]);
}

function layOnHands (fight, actor, choice) {
	const target = (choice.targets || []).find(it => it && it.type !== "undead" && it.type !== "construct" && (it.hp < it.max || it.conditions.has("poisoned"))) || null;
	if (!target || !(actor.layPool > 0)) return true;
	if (target.conditions.has("poisoned") && actor.layPool >= 5) {
		actor.layPool -= 5;
		target.conditions.delete("poisoned");
		log(fight, actor, `${actor.name} removes poison from ${target.name}.`);
	}
	const amount = Math.min(actor.layPool || 0, Math.max(0, target.max - target.hp));
	if (amount > 0) {
		actor.layPool -= amount;
		target.hp += amount;
		actor.healed += amount;
		wake(target);
		log(fight, actor, `${actor.name} lays on hands and restores ${amount} hit points to ${target.name} (${Math.round(target.hp)}/${target.max}).`);
	}
	return true;
}

function shapeHeal (fight, actor) {
	if (!actor.shaped) return true;
	const slot = spendSlot(actor.pool, {level: 1, scale: {from: 0, every: 1, dice: 4.5, flat: 0, count: 1, faces: 8}}, {characterLevel: actor.characterLevel});
	if (!slot) return true;
	actor.spent.push({level: slot.level, pact: !!slot.pact});
	const packet = {name: "Combat Wild Shape", kind: "heal", count: slot.level, faces: 8, dice: slot.level * 4.5, flat: 0};
	const amount = rollAmount(packet, false);
	const before = actor.hp;
	actor.hp = Math.min(actor.max, actor.hp + amount);
	actor.healed += actor.hp - before;
	log(fight, actor, `${actor.name} spends a ${slot.level}${slot.level === 1 ? "st" : "nd"}-level slot and regains ${actor.hp - before} hit points.`);
	return true;
}

function applyOnHit (fight, actor, cast, target, crit) {
	const hit = cast?.onHit;
	if (!hit) return;
	if (hit.extra?.always) landExtra(fight, actor, target, hit, hit.extra, crit, true);
	if (!hit.save) {
		if (hit.conditionOnHit && hit.condition) addNamed(target, hit.condition, fight, actor);
		return;
	}
	const rolledSave = rollSave(fight, target, hit.save.ability, hit.save.dc, {spell: !!cast.spell, condition: hit.condition, matters: !!(hit.extra || hit.condition)});
	const save = rolledSave.save;
	const failed = rolledSave.failed;
	actor.rageForced = true;
	if (hit.extra && !hit.extra.always && (failed || hit.half)) landExtra(fight, actor, target, hit, hit.extra, crit, failed);
	if (failed && hit.conditionOnFail && hit.condition) addNamed(target, hit.condition, fight, actor);
	log(fight, actor, `${target.name} ${failed ? "fails" : "saves"} DC ${hit.save.dc} ${hit.save.ability.toUpperCase()} (${save.total}).`);
}

function landExtra (fight, actor, target, hit, packet, crit, failed) {
	let amount = Math.floor(rollAmount(packet, crit) * damageFactor(packet.damage, target.defenses));
	if (!failed && hit.half) amount = Math.floor(amount / 2);
	if (!(amount > 0) && !hit.onZero?.length) return;
	const before = target.hp;
	hurt(fight, actor, target, amount, crit, !!hit.onZero?.length, packet.damage);
	log(fight, actor, `${target.name} takes ${amount} ${packet.damage} damage${failed ? "" : " (saved)"}.`);
	if (hit.onZero?.length && before > 0 && target.hp <= 0 && !target.dead) {
		target.stable = true;
		target.dying = false;
		target.hp = 0;
		for (const name of hit.onZero) target.conditions.add(name);
		log(fight, target, `${target.name} is stable at 0 hit points and ${hit.onZero.join(" and ")}.`);
	}
}

function applySneak (fight, actor, target, mode, range) {
	if (actor.sneakUsed || range?.melee == null) return;
	const sneak = (actor.options || []).find(option => option.rider === "sneak");
	if (!sneak) return;
	const ally = fight.actors.some(it => it !== actor && it.side === actor.side && it.hp > 0 && !it.dead && feetBetween(it, target) <= 5);
	if (mode !== "advantage" && !ally) return;
	actor.sneakUsed = true;
	const rolled = adjustedAmount({...sneak, damage: sneak.damage || ""}, target, false);
	hurt(fight, actor, target, rolled.amount, false, false, sneak.damage);
	log(fight, actor, `${actor.name} deals ${rolled.amount} sneak attack damage to ${target.name}.`);
}

function applyMark (fight, actor, target, crit) {
	if (!actor.markPacket || actor.markId !== target.id) return;
	const rolled = adjustedAmount(actor.markPacket, target, crit);
	hurt(fight, actor, target, rolled.amount, crit, false, actor.markPacket.damage);
	log(fight, actor, `${actor.markPacket.name} deals ${rolled.amount} to ${target.name}${rolled.note}.`);
}

function tryStun (fight, actor, target) {
	const stun = (actor.options || []).find(option => option.rider === "stun");
	if (!stun || actor.stunUsed || !(actor.ki > 0) || target.dead) return;
	actor.ki -= 1;
	actor.stunUsed = true;
	const rolledSave = rollSave(fight, target, "con", actor.spellDc || 10, {condition: "stunned", matters: true});
	const failed = rolledSave.failed;
	actor.rageForced = true;
	if (failed) {
		target.conditions.add("stunned");
		target.stunBy = actor.id;
		target.stunFresh = true;
		log(fight, actor, `${target.name} fails DC ${actor.spellDc} Constitution (${rolledSave.save.total}) and is stunned.`);
		return;
	}
	log(fight, actor, `${target.name} saves against Stunning Strike (${rolledSave.save.total}).`);
	if (stun.edition === "one") {
		if (!target.speedFull) target.speedFull = target.speed;
		target.speed = Math.max(5, Math.floor((target.speedFull || target.speed) / 2));
		target.slowedBy = actor.id;
		target.openBy = actor.id;
	}
}

function addNamed (target, name, fight, actor) {
	if (!name || target.conditions.has(name)) return;
	target.conditions.add(name);
	log(fight, actor, `${target.name} is ${name}.`);
}

function saveOf (target, ability) {
	if (ability && target?.saveMods && Number.isFinite(Number(target.saveMods[ability]))) return Number(target.saveMods[ability]);
	return Number(target?.saveBonus) || 0;
}

function allyNear (actor, target, actors) {
	return (actors || []).some(it => it !== actor && it.side === actor.side && it.hp > 0 && !it.dead
		&& !it.conditions?.has?.("incapacitated") && !it.conditions?.has?.("stunned") && !it.conditions?.has?.("paralyzed")
		&& feetBetween(it, target) <= 5);
}

function saveMode (target, detail) {
	if (detail?.spell && target?.traits?.magicResist) return "advantage";
	if (target?.traits?.brave && /fright/i.test(detail?.condition || "")) return "advantage";
	return "normal";
}

function rollSave (fight, target, ability, dc, detail) {
	const save = rollD20(saveOf(target, ability), saveMode(target, detail));
	let failed = save.nat === 1 || (save.nat !== 20 && save.total < (Number(dc) || 10));
	if (failed && detail?.matters && target.legendaryUses > 0) {
		target.legendaryUses -= 1;
		failed = false;
		log(fight, target, `${target.name} uses Legendary Resistance (${target.legendaryUses} left).`);
	}
	return {save, failed};
}

function noteRegen (target, type, amount) {
	const regen = target?.traits?.regen;
	if (!(amount > 0) || !regen || !type) return;
	if ((regen.suppress || []).includes(String(type).toLowerCase())) target.regenBlocked = true;
}

function regenerate (fight, actor) {
	const regen = actor.traits?.regen;
	if (!regen || actor.dead) return;
	const blocked = !!actor.regenBlocked;
	actor.regenBlocked = false;
	if (regen.onlyAlive && actor.hp <= 0) return;
	if (blocked) {
		if (actor.hp <= 0 && regen.holdDeath) {
			log(fight, actor, `${actor.name} does not regenerate and dies.`);
			markDead(fight, actor);
		}
		return;
	}
	if (actor.hp >= actor.max) return;
	const before = actor.hp;
	actor.hp = Math.min(actor.max, before + regen.amount);
	if (actor.hp > before) log(fight, actor, `${actor.name} regenerates ${actor.hp - before} hit points (${Math.round(actor.hp)}/${actor.max}).`);
}

function fortitude (fight, target, amount, crit, type) {
	if (!target.traits?.fortitude || crit || String(type || "").toLowerCase() === "radiant") return false;
	const dc = 5 + Math.max(0, amount);
	const rolled = rollSave(fight, target, "con", dc, {matters: true, condition: ""});
	if (rolled.failed) return false;
	target.hp = 1;
	log(fight, target, `${target.name} uses Undead Fortitude and drops to 1 hit point (${rolled.save.total} vs DC ${dc}).`);
	return true;
}

function movedToward (actor, target) {
	if ((actor.moved || 0) < 20 || actor.turnX == null) return false;
	const before = feetBetween({x: actor.turnX, y: actor.turnY}, target);
	return before - feetBetween(actor, target) >= 20;
}

function pounce (fight, actor, target) {
	const pounceTrait = actor.traits?.pounce;
	if (!pounceTrait || !movedToward(actor, target) || target.dead) return;
	if (pounceTrait.prone) {
		const rolled = rollSave(fight, target, "str", pounceTrait.dc, {matters: true, condition: "prone"});
		if (rolled.failed) {
			target.conditions.add("prone");
			log(fight, actor, `${target.name} is knocked prone (${rolled.save.total} vs DC ${pounceTrait.dc}).`);
		} else log(fight, actor, `${target.name} stays standing (${rolled.save.total} vs DC ${pounceTrait.dc}).`);
	}
	if (pounceTrait.extra) {
		const rolled = adjustedAmount(pounceTrait.extra, target, false);
		hurt(fight, actor, target, rolled.amount, false, false, pounceTrait.extra.damage);
		log(fight, actor, `${actor.name} deals ${rolled.amount} extra ${pounceTrait.extra.damage} damage.`);
	}
}

function rampage (fight, actor) {
	const rampageTrait = actor.traits?.rampage;
	if (!rampageTrait || actor.bonusSpent || actor.rampaged) return;
	actor.rampaged = true;
	actor.bonusSpent = true;
	const label = String(rampageTrait.attack || "bite");
	const swings = (actor.options || []).flatMap(option => option.repeats?.length ? option.repeats : [option]);
	const bite = swings.find(option => option.kind === "attack" && new RegExp(label, "i").test(option.name || ""));
	const foe = fight.actors.filter(it => it.side !== actor.side && it.hp > 0 && !it.dead)
		.sort((a, b) => feetBetween(actor, a) - feetBetween(actor, b))[0];
	if (!bite || !foe) return;
	const steps = Math.max(0, Math.floor((actor.speed || 30) / 10));
	let guard = 0;
	while (feetBetween(actor, foe) > (bite.rangeFeet || 5) && guard < steps) {
		actor.x = clamp(actor.x + Math.sign(foe.x - actor.x), 0, 9);
		actor.y = clamp(actor.y + Math.sign(foe.y - actor.y), 0, 7);
		guard++;
	}
	if (feetBetween(actor, foe) > (bite.rangeFeet || 5)) return;
	log(fight, actor, `${actor.name} rampages toward ${foe.name}.`);
	applyCast(fight, actor, bite, foe, {feet: bite.rangeFeet || 5, melee: bite.melee !== false, aoe: 0}, [foe]);
}

function deathBurst (fight, target) {
	const burst = target.traits?.burst;
	if (!burst || target.burstDone) return;
	target.burstDone = true;
	log(fight, target, `${target.name} bursts.`);
	for (const other of fight.actors) {
		if (other === target || other.dead) continue;
		if (feetBetween(target, other) > burst.feet) continue;
		const packet = burst.extra || {dice: 0, flat: 0, count: 0, faces: 0, damage: ""};
		const rolled = adjustedAmount(packet, other, false);
		const save = rollSave(fight, other, burst.ability, burst.dc, {matters: rolled.amount > 0, spell: false});
		const dealt = save.failed || !burst.half ? rolled.amount : Math.floor(rolled.amount / 2);
		hurt(fight, target, other, dealt, false, false, packet.damage);
		log(fight, target, `${other.name} ${save.failed ? "fails" : "saves"} and takes ${dealt}${rolled.note}.`);
	}
}
