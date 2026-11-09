/** Curated known trait/action templates for the homebrew creature builder. */

export const TRAIT_TEMPLATES = [
	{id: "aggressive", name: "Aggressive", text: "As a Bonus Action, {name} moves up to its Speed toward an enemy of its choice that it can see or hear."},
	{id: "ambusher", name: "Ambusher", text: "{name} has Advantage on attack rolls against any creature it has surprised."},
	{id: "amorphous", name: "Amorphous", text: "{name} can move through a space as narrow as 1 inch without squeezing."},
	{id: "amphibious", name: "Amphibious", text: "{name} can breathe air and water."},
	{id: "antimagic-susceptibility", name: "Antimagic Susceptibility", text: "{name} is Incapacitated while in the area of an Antimagic Field. If targeted by Dispel Magic, {name} must succeed on a Constitution saving throw against the caster's spell save DC or fall Unconscious for 1 minute."},
	{id: "brute", name: "Brute", text: "A melee weapon deals one extra die of its damage when {name} hits with it (included in the attack)."},
	{id: "charge", name: "Charge", text: "If {name} moves at least 20 feet straight toward a target and then hits it with a melee attack on the same turn, the target takes an extra {@damage 2d6} damage. If the target is a creature, it must succeed on a DC 13 Strength saving throw or have the Prone condition."},
	{id: "damage-absorption", name: "Damage Absorption", text: "Whenever {name} is subjected to a damage type of your choice, it takes no damage and instead regains a number of Hit Points equal to the damage dealt."},
	{id: "death-burst", name: "Death Burst", text: "When {name} dies, it explodes. Each creature in a 10-foot Emanation originating from {name} must make a DC 12 Dexterity saving throw, taking {@damage 2d6} Fire damage on a failed save or half as much damage on a successful one."},
	{id: "devils-sight", name: "Devil's Sight", text: "Magical Darkness doesn't impede {name}'s Darkvision."},
	{id: "false-appearance", name: "False Appearance", text: "If {name} is motionless at the start of combat, it has Advantage on its Initiative roll. If {name} wins Initiative, it can take the Surprise action."},
	{id: "fey-ancestry", name: "Fey Ancestry", text: "{name} has Advantage on saving throws it makes to avoid or end the Charmed condition, and magic can't put it to sleep."},
	{id: "flyby", name: "Flyby", text: "{name} doesn't provoke an Opportunity Attack when it flies out of an enemy's reach."},
	{id: "hold-breath", name: "Hold Breath", text: "{name} can hold its breath for 30 minutes."},
	{id: "illumination", name: "Illumination", text: "{name} sheds Bright Light in a 10-foot radius and Dim Light for an additional 10 feet."},
	{id: "immutable-form", name: "Immutable Form", text: "{name} is immune to any spell or effect that would alter its form."},
	{id: "incorporeal-movement", name: "Incorporeal Movement", text: "{name} can move through other creatures and Objects as if they were Difficult Terrain. It takes {@damage 1d10} Force damage if it ends its turn inside an object."},
	{id: "innate-spellcasting", name: "Innate Spellcasting", text: "", special: "innate"},
	{id: "keen-hearing", name: "Keen Hearing", text: "{name} has Advantage on Wisdom (Perception) checks that rely on hearing."},
	{id: "keen-senses", name: "Keen Senses", text: "{name} has Advantage on Wisdom (Perception) checks that rely on sight, hearing, or smell."},
	{id: "keen-smell", name: "Keen Smell", text: "{name} has Advantage on Wisdom (Perception) checks that rely on smell."},
	{id: "legendary-resistance", name: "Legendary Resistance (3/Day)", text: "If {name} fails a saving throw, it can choose to succeed instead."},
	{id: "light-sensitivity", name: "Light Sensitivity", text: "While in Bright Light, {name} has Disadvantage on attack rolls and Wisdom (Perception) checks that rely on sight."},
	{id: "magic-resistance", name: "Magic Resistance", text: "{name} has Advantage on saving throws against spells and other magical effects."},
	{id: "magic-weapons", name: "Magic Weapons", text: "{name}'s weapon attacks are magical."},
	{id: "pack-tactics", name: "Pack Tactics", text: "{name} has Advantage on an attack roll against a creature if at least one of {name}'s allies is within 5 feet of the creature and the ally doesn't have the Incapacitated condition."},
	{id: "pounce", name: "Pounce", text: "If {name} moves at least 20 feet straight toward a creature and then hits it with a claw attack on the same turn, that target must succeed on a DC 13 Strength saving throw or have the Prone condition. If the target is Prone, {name} can make one Bite attack against it as a Bonus Action."},
	{id: "rampage", name: "Rampage", text: "When {name} reduces a creature to 0 Hit Points with a melee attack on its turn, {name} can take a Bonus Action to move up to half its Speed and make a melee attack."},
	{id: "reckless", name: "Reckless", text: "At the start of its turn, {name} can gain Advantage on all melee weapon attack rolls it makes during that turn, but attack rolls against it have Advantage until the start of its next turn."},
	{id: "regeneration", name: "Regeneration", text: "{name} regains 10 Hit Points at the start of its turn. If {name} takes fire damage, this trait doesn't function at the start of {name}'s next turn. {name} dies only if it starts its turn with 0 Hit Points and doesn't regenerate."},
	{id: "rejuvenation", name: "Rejuvenation", text: "If {name} is destroyed, it reforms in {@dice 1d10} days, regaining all its Hit Points. This trait doesn't function if {name}'s remains are sprinkled with holy water or if a Remove Curse spell is cast on them."},
	{id: "shapechanger", name: "Shapechanger", text: "{name} can use an action to polymorph into a form of your choice, or back into its true form. Its statistics are the same in each form. Any equipment it is wearing or carrying isn't transformed. It reverts to its true form if it dies."},
	{id: "siege-monster", name: "Siege Monster", text: "{name} deals double damage to objects and structures."},
	{id: "sneak-attack", name: "Sneak Attack (1/Turn)", text: "{name} deals an extra {@damage 2d6} damage when it hits a target with a weapon attack and has Advantage on the attack roll, or when the target is within 5 feet of an ally of {name} that isn't Incapacitated and {name} doesn't have Disadvantage on the attack roll."},
	{id: "spider-climb", name: "Spider Climb", text: "{name} can climb difficult surfaces, including along ceilings, without needing to make an ability check."},
	{id: "sunlight-sensitivity", name: "Sunlight Sensitivity", text: "While in sunlight, {name} has Disadvantage on attack rolls and Wisdom (Perception) checks that rely on sight."},
	{id: "sure-footed", name: "Sure-Footed", text: "{name} has Advantage on Strength and Dexterity saving throws made against effects that would knock it Prone."},
	{id: "tunneler", name: "Tunneler", text: "{name} can burrow through solid rock at half its Burrow Speed, leaving a 5-foot-diameter tunnel in its wake."},
	{id: "turn-immunity", name: "Turn Immunity", text: "{name} is immune to effects that turn Undead."},
	{id: "turn-resistance", name: "Turn Resistance", text: "{name} has Advantage on saving throws against any effect that turns Undead."},
	{id: "undead-fortitude", name: "Undead Fortitude", text: "If damage reduces {name} to 0 Hit Points, it must make a Constitution saving throw with a DC of 5 plus the damage taken, unless the damage is Radiant or from a Critical Hit. On a success, {name} drops to 1 Hit Point instead."},
	{id: "water-breathing", name: "Water Breathing", text: "{name} can breathe only underwater."},
	{id: "web-sense", name: "Web Sense", text: "While in contact with a web, {name} knows the exact location of any other creature in contact with the same web."},
	{id: "web-walker", name: "Web Walker", text: "{name} ignores movement restrictions caused by webs."},
];

export const ACTION_TEMPLATES = [
	{id: "multiattack", name: "Multiattack", text: "{name} makes two attacks."},
	{id: "bite", name: "Bite", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d6+2} Piercing damage."},
	{id: "claw", name: "Claw", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d6+2} Slashing damage."},
	{id: "slam", name: "Slam", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d8+2} Bludgeoning damage."},
	{id: "gore", name: "Gore", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 2d6+2} Piercing damage."},
	{id: "tentacle", name: "Tentacle", text: "{@atk mw} {@hit 4} to hit, reach 10 ft., one target. {@h} {@damage 1d8+2} Bludgeoning damage. If the target is a creature, {name} can pull it up to 5 feet closer."},
	{id: "tentacles", name: "Tentacles", text: "{@atk mw} {@hit 4} to hit, reach 10 ft., one target. {@h} {@damage 2d6+2} Bludgeoning damage, and the target has the Grappled condition (escape DC 13). Until this grapple ends, the target is Restrained."},
	{id: "scimitar", name: "Scimitar", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d6+2} Slashing damage."},
	{id: "shortsword", name: "Shortsword", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d6+2} Piercing damage."},
	{id: "longsword", name: "Longsword", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d8+2} Slashing damage."},
	{id: "greatsword", name: "Greatsword", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 2d6+2} Slashing damage."},
	{id: "greataxe", name: "Greataxe", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d12+2} Slashing damage."},
	{id: "warhammer", name: "Warhammer", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d8+2} Bludgeoning damage."},
	{id: "club", name: "Club", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d4+2} Bludgeoning damage."},
	{id: "dagger", name: "Dagger", text: "{@atk mw,rw} {@hit 4} to hit, reach 5 ft. or range 20/60 ft., one target. {@h} {@damage 1d4+2} Piercing damage."},
	{id: "spear", name: "Spear", text: "{@atk mw,rw} {@hit 4} to hit, reach 5 ft. or range 20/60 ft., one target. {@h} {@damage 1d6+2} Piercing damage."},
	{id: "javelin", name: "Javelin", text: "{@atk mw,rw} {@hit 4} to hit, reach 5 ft. or range 30/120 ft., one target. {@h} {@damage 1d6+2} Piercing damage."},
	{id: "shortbow", name: "Shortbow", text: "{@atk rw} {@hit 4} to hit, range 80/320 ft., one target. {@h} {@damage 1d6+2} Piercing damage."},
	{id: "longbow", name: "Longbow", text: "{@atk rw} {@hit 4} to hit, range 150/600 ft., one target. {@h} {@damage 1d8+2} Piercing damage."},
	{id: "crossbow", name: "Light Crossbow", text: "{@atk rw} {@hit 4} to hit, range 80/320 ft., one target. {@h} {@damage 1d8+2} Piercing damage."},
	{id: "rock", name: "Rock", text: "{@atk rw} {@hit 4} to hit, range 60/240 ft., one target. {@h} {@damage 2d10+2} Bludgeoning damage."},
	{id: "fire-breath", name: "Fire Breath", text: "Dexterity Saving Throw: DC 13, each creature in a 15-foot Cone. Failure: {@damage 4d6} Fire damage. Success: Half damage."},
	{id: "cold-breath", name: "Cold Breath", text: "Constitution Saving Throw: DC 13, each creature in a 15-foot Cone. Failure: {@damage 4d6} Cold damage. Success: Half damage."},
	{id: "lightning-breath", name: "Lightning Breath", text: "Dexterity Saving Throw: DC 13, each creature in a 30-foot Line that is 5 feet wide. Failure: {@damage 4d6} Lightning damage. Success: Half damage."},
	{id: "acid-breath", name: "Acid Breath", text: "Dexterity Saving Throw: DC 13, each creature in a 30-foot Line that is 5 feet wide. Failure: {@damage 4d6} Acid damage. Success: Half damage."},
	{id: "poison-breath", name: "Poison Breath", text: "Constitution Saving Throw: DC 13, each creature in a 15-foot Cone. Failure: {@damage 4d6} Poison damage. Success: Half damage."},
	{id: "frightful-presence", name: "Frightful Presence", text: "Wisdom Saving Throw: DC 13, each creature of {name}'s choice in a 30-foot Emanation originating from {name}. Failure: The target has the Frightened condition for 1 minute. The target can repeat the save at the end of each of its turns, ending the effect on itself on a success. If a target's save is successful or the effect ends for it, the target is immune to {name}'s Frightful Presence for the next 24 hours."},
	{id: "swallow", name: "Swallow", text: "{name} makes one Bite attack against a Medium or smaller creature it is grappling. If the attack hits, the target is swallowed, and the grapple ends. While swallowed, the target has the Blinded and Restrained conditions, and it has Total Cover against attacks and other effects outside {name}. {name} can have only one creature swallowed at a time.\n\nIf {name} takes 20 damage or more on a single turn from the swallowed creature, {name} must succeed on a DC 14 Constitution saving throw at the end of that turn or regurgitate the creature, which falls Prone in a space within 5 feet of {name}. If {name} dies, a swallowed creature is no longer Restrained by it and can escape from the corpse using 10 feet of movement, exiting Prone."},
	{id: "teleport", name: "Teleport", text: "{name} teleports, along with any equipment it is wearing or carrying, up to 60 feet to an unoccupied space it can see."},
];

export const BONUS_TEMPLATES = [
	{id: "dash", name: "Dash", text: "{name} moves up to its Speed."},
	{id: "disengage", name: "Disengage", text: "{name}'s movement doesn't provoke Opportunity Attacks for the rest of the turn."},
	{id: "hide", name: "Hide", text: "{name} takes the Hide action."},
	{id: "nimble-escape", name: "Nimble Escape", text: "{name} takes the Disengage or Hide action."},
	{id: "attack", name: "Attack", text: "{name} makes one weapon attack."},
	{id: "second-wind", name: "Second Wind", text: "{name} regains {@dice 1d10 + 5} Hit Points."},
];

export const REACTION_TEMPLATES = [
	{id: "parry", name: "Parry", text: "{name} adds 2 to its AC against one melee attack that would hit it. To do so, {name} must see the attacker and be wielding a melee weapon."},
	{id: "opportunity", name: "Opportunity Attack", text: "{name} makes one melee attack against the provoking creature."},
	{id: "shield", name: "Shield", text: "{name} casts Shield (included in its spells)."},
	{id: "relentless", name: "Relentless", text: "If {name} takes damage that reduces it to 0 Hit Points, it can drop to 1 Hit Point instead. Once {name} uses this reaction, it can't do so again until it finishes a Short or Long Rest."},
];

export const POPULAR_TRAITS = ["pack-tactics", "magic-resistance", "amphibious", "flyby", "legendary-resistance", "innate-spellcasting"];
export const POPULAR_ACTIONS = ["multiattack", "bite", "claw", "scimitar", "shortbow", "fire-breath", "frightful-presence"];
export const POPULAR_BONUS = ["dash", "disengage", "hide", "nimble-escape"];
export const POPULAR_REACTIONS = ["parry", "opportunity"];

export function searchTemplates (templates, query, limit = 12) {
	const needle = String(query || "").trim().toLowerCase();
	if (needle.length < 2) return [];
	const scored = [];
	for (const it of templates) {
		const name = String(it.name || "").toLowerCase();
		const id = String(it.id || "").toLowerCase();
		let score = 0;
		if (name === needle || id === needle) score = 100;
		else if (name.startsWith(needle) || id.startsWith(needle)) score = 80;
		else if (name.includes(needle) || id.includes(needle)) score = 50;
		else continue;
		scored.push({score, it});
	}
	scored.sort((a, b) => b.score - a.score || a.it.name.localeCompare(b.it.name));
	return scored.slice(0, limit).map(it => it.it);
}

export function templateById (templates, id) {
	return templates.find(it => it.id === id) || null;
}
