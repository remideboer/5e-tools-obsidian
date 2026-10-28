import {attackOdds, classLevel, damageFactor, expectedDamage, failChance, peekSlot, rageDamage, spellAtSlot} from "./dpr-calc.js";

const COLS = 10;
const ROWS = 8;

/**
 * Choose this turn's move and actions for either side.
 * Strikers close. Skirmishers and casters keep out of melee and Disengage to leave it.
 * @returns {{cell: {x: number, y: number}, dash: boolean, dodge: boolean, disengage: "action"|"bonus"|null, action: object|null, bonus: object|null, shortfall: {feet: number, attack: string, target: string}|null}}
 */
export function planTurn (actor, actors) {
	const role = roleOf(actor);
	const foes = (actors || []).filter(it => it.side !== actor.side && !it.dead && (it.hp > 0 || it.dying || it.stable));
	const standing = foes.filter(it => it.hp > 0);
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
		const pool = standing.length ? standing : foes;
		const goal = focusGoals(actor, pool, actors)[0] || nearest(actor, pool);
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
	const shape = considerWildShape(actor, choice, actors, foes);
	if (shape) {
		return {
			cell: shape.cell,
			dash: false,
			dodge: false,
			disengage: null,
			action: shape.action,
			bonus: shape.bonus,
			shortfall: null,
		};
	}
	const disengage = disengageMode(actor, cell, foes, role);
	const action = disengage === "action" ? null : choice;
	const bonus = disengage === "bonus" ? null : bestBonus(actor, attacks, actors, foes, friends, cell, role, action);
	const engaged = standing.some(foe => feetBetween(actor, foe) <= 5);
	const planned = {
		cell,
		dash,
		dodge: !action && !bonus && engaged && feetBetween(actor, cell) === 0,
		disengage,
		action,
		bonus,
		shortfall: null,
		surge: null,
		vow: null,
		steady: false,
	};
	return finishPlan(actor, planned, actors, foes, attacks);
}

function skipOption (option, actor) {
	if (!option || option.rider || option.kind === "rider") return true;
	if (option.utility === "shape-heal" && !actor?.shaped) return true;
	if (option.utility === "lay" && !(actor?.layPool > 0)) return true;
	if (actor?.raging && option.spell) return true;
	return false;
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

function considerWildShape (actor, choice, actors, foes) {
	if (actor.shaped) return null;
	const shape = (actor.options || []).find(option => option.utility === "wildshape" && option.beastOptions?.length);
	if (!shape || !foes.length) return null;
	const steps = Math.max(1, Math.floor((actor.speed || 30) / 5));
	let best = null;
	for (const option of shape.beastOptions) {
		if (option.kind === "utility") continue;
		const found = bestCell(actor, {...option, activation: "action", slot: "action"}, actors, foes, [], steps, "striker");
		if (found && (!best || found.score > best.score)) best = found;
	}
	if (!best || best.score <= (choice?.score || 0)) return null;
	return {
		cell: best.cell,
		action: best,
		bonus: {score: best.score, cell: best.cell, option: shape, targets: best.targets},
	};
}

function bestAttack (actor, attacks, actors, foes, friends, steps, role) {
	let best = null;
	for (const option of attacks) {
		if (skipOption(option, actor)) continue;
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
		if (skipOption(option, actor)) continue;
		if (optionSlot(option) !== "bonus") continue;
		if (blocked && isLeveled(option)) continue;
		if (isLeveled(option) && !(actor.pool || []).some(slot => slot.level >= option.level)) continue;
		const range = rangeOf(option);
		const groups = fightGoals(option, foes, friends);
		let picked = null;
		for (const goals of groups) {
			for (const goal of (option.kind === "heal" ? goals : focusGoals(actor, goals, actors))) {
				if (feetBetween(cell, goal) > range.feet) continue;
				let score = swingScore(option, actor, goal, range, actors) + positionBias(role, cell, foes);
				score += aimBias(actor, goal, actors);
				if (role === "priest" && option.kind === "heal" && goal.hp <= goal.max / 2) score += 8;
				if (!picked || score > picked.score) picked = {score, cell, option, targets: targetsFor(cell, goal, range, option.kind === "heal" ? friends : foes)};
			}
			if (picked && option.kind !== "heal") break;
		}
		if (picked && (!best || picked.score > best.score)) best = picked;
	}
	return best;
}

function bestCell (actor, option, actors, foes, friends, steps, role) {
	const range = rangeOf(option);
	const groups = fightGoals(option, foes, friends);
	let best = null;
	for (const goals of groups) {
		if (!goals.length) continue;
		for (const goal of (option.kind === "heal" ? goals : focusGoals(actor, goals, actors))) {
			const toward = walk(actor, goal, actors, steps);
			const away = role === "striker" ? [] : walkAway(actor, foes.filter(it => it.hp > 0), actors, steps);
			for (const cell of [...toward, ...away]) {
				if (feetBetween(cell, goal) > range.feet) continue;
				const area = option.kind === "heal" ? friends : foes;
				const targets = targetsFor(cell, goal, range, area);
				if (!targets.length) continue;
				let score = 0;
				for (const target of targets) score += swingScore(option, actor, target, range, actors);
				score += positionBias(role, cell, foes);
				score += aimBias(actor, goal, actors);
				if (role === "priest" && option.kind === "heal" && goal.hp <= goal.max / 2) score += 8;
				if (!best || score > best.score) best = {score, cell, option, targets};
			}
		}
		if (best && option.kind !== "heal") return best;
	}
	return best;
}

function fightGoals (option, foes, friends) {
	if (option?.kind === "heal") return [friends];
	const standing = (foes || []).filter(it => it.hp > 0);
	if (standing.length) return [standing];
	return [(foes || []).filter(it => it.hp <= 0)];
}

function intellect (actor) {
	const score = Number(actor?.int);
	if (!Number.isFinite(score)) return 0;
	return Math.min(1, Math.max(0, (score - 6) / 8));
}

function outgoingDamage (actor) {
	let best = 0;
	for (const option of actor?.options || []) {
		if (option.kind === "heal" || option.kind === "utility") continue;
		const swings = option.repeats?.length ? option.repeats : [option];
		const times = !option.spell && option.activation !== "bonus" && !option.repeats ? (actor.extraSwings || 1) : 1;
		let total = 0;
		for (let n = 0; n < times; n++) {
			for (const swing of swings) total += (Number(swing.dice) || 0) + (Number(swing.flat) || 0);
		}
		if (total > best) best = total;
	}
	return best;
}

function aimBias (actor, goal, actors) {
	const smart = intellect(actor);
	const near = Math.max(0, 120 - feetBetween(actor, goal));
	let score = (1 - smart) * near * 0.5 + smart * outgoingDamage(goal) * 3;
	if (actor?.traits?.pack && (actors || []).some(it => it !== actor && it.side === actor.side && it.hp > 0 && !it.dead && feetBetween(it, goal) <= 5)) score += 30;
	if (actor?.traits?.frenzy && goal.hp < goal.max) score += 12;
	return score;
}

function focusGoals (actor, goals, actors) {
	const list = (goals || []).filter(Boolean);
	if (!list.length) return [];
	const boss = bossOf(actor, actors);
	if (boss) {
		const marked = [...list].sort((a, b) => outgoingDamage(b) - outgoingDamage(a) || feetBetween(actor, a) - feetBetween(actor, b))[0];
		return marked ? [marked] : [];
	}
	const ranked = [...list].sort((a, b) => aimBias(actor, b, actors) - aimBias(actor, a, actors) || feetBetween(actor, a) - feetBetween(actor, b));
	const smart = intellect(actor);
	if (smart <= 0.2 || smart >= 0.8) return [ranked[0]];
	return ranked;
}

function bossOf (actor, actors) {
	let boss = null;
	for (const ally of actors || []) {
		if (ally === actor || ally.side !== actor.side || ally.hp <= 0 || ally.dead) continue;
		const score = Number(ally.int);
		if (!Number.isFinite(score) || score < 12) continue;
		if (!boss || score > Number(boss.int)) boss = ally;
	}
	if (!boss) return null;
	const mine = Number(actor.int);
	if (Number.isFinite(mine) && mine >= Number(boss.int)) return null;
	return boss;
}

function castAtPool (swing, actor, target) {
	if (!swing?.spell && swing?.utility !== "spark") return swing;
	if (swing.cantrip?.length || !(swing.level > 0)) return spellAtSlot(swing, 0, actor.characterLevel);
	const missing = target ? Math.max(0, target.max - target.hp) : Infinity;
	const slot = peekSlot(actor.pool, swing, {missing, disciple: !!actor.disciple, characterLevel: actor.characterLevel});
	if (!slot) return swing;
	const cast = spellAtSlot(swing, slot.level, actor.characterLevel);
	if (swing.kind === "heal" && actor.disciple && slot.level > 0) cast.flat = (cast.flat || 0) + 2 + slot.level;
	if (swing.cap > 0 && cast.count > swing.cap) {
		const faces = cast.faces || 8;
		cast.count = swing.cap;
		cast.dice = swing.cap * (faces + 1) / 2;
		cast.flat = 0;
	}
	return cast;
}

function swingScore (option, actor, target, range, actors) {
	const list = option.repeats?.length ? option.repeats : [option];
	const times = !option.spell && option.activation !== "bonus" && !option.repeats ? actor.extraSwings || 1 : 1;
	let score = 0;
	for (let n = 0; n < times; n++) {
		for (const swing of list) {
			const cast = castAtPool(swing, actor, target);
			if (cast.utility === "lay") {
				score += Math.min(actor.layPool || 0, Math.max(0, target.max - target.hp));
				continue;
			}
			if (cast.utility === "spark") {
				const heal = (cast.dice || 0) + (actor.wisMod || 0);
				const harm = expectedDamage({...cast, kind: "save", dc: actor.spellDc || 10}, {saveBonus: saveOf(target, "con")});
				score += Math.max(Math.min(heal, Math.max(0, target.max - target.hp)), harm);
				continue;
			}
			if (cast.kind === "heal") score += Math.min((cast.dice || 0) + (cast.flat || 0), Math.max(0, target.max - target.hp));
			else {
				score += expectedDamage(cast, {
					ac: target.ac,
					mode: "normal",
					saveBonus: saveOf(target, cast.saveAbility),
				}) * damageFactor(cast.damage, target.defenses);
				score += onHitScore(cast, target) * hitChance(cast, target);
			}
			score += riderScore(cast, actor, target, actors);
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
		const blocked = (spot) => (actors || []).some(it => it !== actor && !it.dead && (it.hp > 0 || it.dying || it.stable) && it.x === spot.x && it.y === spot.y);
		let next = {x: nx, y: ny};
		if (blocked(next) || (next.x === x && next.y === y)) {
			const options = [
				{x: clamp(x + 1, 0, COLS - 1), y},
				{x: clamp(x - 1, 0, COLS - 1), y},
				{x, y: clamp(y + 1, 0, ROWS - 1)},
				{x, y: clamp(y - 1, 0, ROWS - 1)},
			].filter(spot => (spot.x !== x || spot.y !== y) && !blocked(spot));
			options.sort((a, b) => (feetBetween(a, goal) - feetBetween(b, goal)) * direction);
			if (!options.length) break;
			next = options[0];
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
	if (range.aoe) return foes.filter(it => (it.hp > 0 || it.dying || it.stable) && feetBetween(goal, it) <= range.aoe);
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

function byUtility (actor, utility) {
	return (actor?.options || []).find(option => option.utility === utility) || null;
}

function byRider (actor, rider) {
	const found = (actor?.options || []).filter(option => option.rider === rider);
	return found.find(option => option.bonusAction) || found[0] || null;
}

function finishPlan (actor, plan, actors, foes, attacks) {
	let action = plan.action;
	let bonus = plan.bonus;
	let cell = plan.cell;
	const channel = (actor.channelUses || 0) > 0;
	let spentChannel = false;
	const useChannel = () => {
		if (!channel || spentChannel) return false;
		spentChannel = true;
		return true;
	};

	const rage = byUtility(actor, "rage");
	if (rage && !actor.raging && (actor.rageUses || 0) > 0) {
		const weapon = bestAttack(actor, attacks.filter(option => !option.spell), actors, foes, [], Math.max(1, Math.floor((actor.speed || 30) / 5)), "striker");
		const extra = weapon ? rageDamage(classLevel(actor.classes, "barbarian")) * hitChance(weapon.option, weapon.targets?.[0] || foes[0] || actor) : 0;
		const spellScore = action?.option?.spell ? action.score : -1;
		if (weapon && weapon.score + extra >= spellScore && extra >= (bonus?.score || 0)) {
			action = weapon;
			bonus = {score: extra, cell: weapon.cell, option: rage, targets: weapon.targets};
			cell = weapon.cell;
		}
	}

	const smite = byRider(actor, "smite");
	const melee = action?.option && !action.option.spell && action.option.kind === "attack" && action.option.melee !== false;
	if (smite && melee && !actor.smiteUsed && peekSlot(actor.pool, smite, {characterLevel: actor.characterLevel})) {
		const target = action.targets?.[0];
		const cast = castAtPool(smite, actor, target);
		const gain = target ? expectedDamage({...cast, kind: "attack", bonus: action.option.bonus}, {ac: target.ac}) * damageFactor("radiant", target.defenses) : (cast.dice || 0);
		if (smite.bonusAction !== false) {
			if (!bonus || gain > bonus.score) bonus = {score: gain, cell, option: smite, targets: action.targets};
		} else plan.freeSmite = true;
	}

	const mark = (actor.options || []).find(option => option.rider === "mark");
	const marked = (actors || []).find(it => it.id === actor.markId);
	const nextFoe = (foes || []).find(it => it.hp > 0);
	const markGain = ((mark?.dice || 0) + (mark?.flat || 0)) * 2;
	if (mark && actor.markId && nextFoe && (!marked || marked.dead || marked.hp <= 0) && (!bonus || markGain > bonus.score)) {
		bonus = {score: markGain, cell, option: {utility: "move-mark", name: mark.name, rider: "mark"}, targets: [nextFoe]};
	} else if (mark && !actor.markId && nextFoe && peekSlot(actor.pool, mark, {characterLevel: actor.characterLevel}) && (!bonus || markGain > bonus.score)) {
		bonus = {score: markGain, cell, option: {...mark, utility: "mark"}, targets: [nextFoe]};
	}

	const steady = byUtility(actor, "steady");
	const sneak = byRider(actor, "sneak");
	if (steady && sneak && melee && action?.targets?.[0] && !sneakReady(actor, action.targets[0], actors)) {
		const here = rangeOf(action.option);
		if (feetBetween(actor, action.targets[0]) <= here.feet && (!bonus || (sneak.dice || 0) > bonus.score)) {
			bonus = {score: sneak.dice || 0, cell: {x: actor.x, y: actor.y}, option: steady, targets: action.targets};
			cell = {x: actor.x, y: actor.y};
			plan.steady = true;
			plan.dash = false;
		}
	}

	if (!spentChannel && byUtility(actor, "spark")) {
		const spark = byUtility(actor, "spark");
		const foe = (foes || []).find(it => it.hp > 0);
		const ally = (actors || []).filter(it => it.side === actor.side && it.hp < it.max).sort((a, b) => a.hp - b.hp)[0];
		const harm = foe ? expectedDamage({...spark, kind: "save", dc: actor.spellDc || 10}, {saveBonus: saveOf(foe, "con")}) : 0;
		const heal = ally ? Math.min((spark.dice || 0) + (actor.wisMod || 0), ally.max - ally.hp) : 0;
		if (Math.max(harm, heal) > (action?.score || 0) && useChannel()) {
			const healing = heal >= harm && ally;
			action = {score: Math.max(harm, heal), cell, option: {...spark, kind: healing ? "heal" : "save"}, targets: [healing ? ally : foe]};
		}
	}

	if (!spentChannel && byUtility(actor, "turn")) {
		const undead = (foes || []).filter(it => it.hp > 0 && it.type === "undead" && feetBetween(cell, it) <= 30);
		if (undead.length && undead.length * 12 > (action?.score || 0) && useChannel()) {
			action = {score: undead.length * 12, cell, option: byUtility(actor, "turn"), targets: undead};
		}
	}

	if (!spentChannel && byUtility(actor, "preserve")) {
		const allies = (actors || []).filter(it => it.side === actor.side && it.hp < it.max / 2 && feetBetween(cell, it) <= 30);
		const pool = 5 * (classLevel(actor.classes, "cleric") || 1);
		if (allies.length && pool > (action?.score || 0) && useChannel()) {
			action = {score: pool, cell, option: byUtility(actor, "preserve"), targets: allies};
		}
	}

	const duplicity = byUtility(actor, "duplicity");
	if (!spentChannel && duplicity && !actor.duplicity && (!bonus || 4 > bonus.score) && useChannel()) {
		bonus = {score: 4, cell, option: duplicity, targets: action?.targets || []};
	}

	const harness = byUtility(actor, "harness");
	if (!spentChannel && harness && (actor.spent || []).length && !(actor.pool || []).some(slot => slot.level > 0) && (!bonus || 6 > bonus.score) && useChannel()) {
		bonus = {score: 6, cell, option: harness, targets: []};
	}

	const vow = byUtility(actor, "vow");
	const vowTarget = action?.targets?.find(it => it.hp > 0 && feetBetween(cell, it) <= 30);
	if (!spentChannel && vow && !actor.vowId && melee && vowTarget && useChannel()) plan.vow = vowTarget.id;

	const surge = byUtility(actor, "surge");
	const surgedSpell = action?.option?.spell && (surge?.edition === "one" || actor.surgeEdition === "one");
	if (surge && (actor.surgeUses || 0) > 0 && action?.option && !surgedSpell && action.option.kind !== "heal") {
		plan.surge = action;
	}
	if (actor.traits?.aggressive && plan.dash && action && !bonus) {
		plan.dash = false;
		plan.aggressive = true;
	}

	plan.action = action;
	plan.bonus = bonus;
	plan.cell = cell;
	return plan;
}

function riderScore (cast, actor, target, actors) {
	if (!cast || cast.spell || cast.kind === "heal" || cast.kind === "rider") return 0;
	let extra = 0;
	const sneak = byRider(actor, "sneak");
	if (sneak && !actor.sneakUsed && sneakReady(actor, target, actors)) extra += (sneak.dice || 0) + (sneak.flat || 0);
	if (actor.markId === target?.id) extra += actor.markDice || 0;
	if (actor.raging && cast.melee !== false) extra += actor.rageBonus || rageDamage(classLevel(actor.classes, "barbarian"));
	return extra * hitChance(cast, target);
}

function sneakReady (actor, target, actors) {
	if (!target) return false;
	if ((actor.vowId && actor.vowId === target.id) || actor.duplicity || actor.advantageNext) return true;
	return (actors || []).some(it => it !== actor && it.side === actor.side && it.hp > 0 && !it.dead && feetBetween(it, target) <= 5);
}

function onHitScore (cast, target) {
	const hit = cast?.onHit;
	if (!hit?.extra) return 0;
	const full = ((hit.extra.dice || 0) + (hit.extra.flat || 0)) * damageFactor(hit.extra.damage, target?.defenses);
	if (hit.extra.always || !hit.save) return full;
	const fail = failChance(hit.save.dc, saveOf(target, hit.save.ability));
	return fail * full + (hit.half ? (1 - fail) * full / 2 : 0);
}

function hitChance (cast, target) {
	if (!cast || cast.kind === "auto" || cast.kind === "save" || cast.kind === "heal") return 1;
	const odds = attackOdds(cast.bonus || 0, target?.ac || 10, "normal");
	return odds.normal + odds.crit;
}

function saveOf (target, ability) {
	if (ability && target?.saveMods && Number.isFinite(Number(target.saveMods[ability]))) return Number(target.saveMods[ability]);
	return Number(target?.saveBonus) || 0;
}
