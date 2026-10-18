import {searchEntities} from "./search-index.js";
import {newNamedRow, normalizeMonsterForm} from "./homebrew-store.js";

const SIZES = [
	{id: "T", label: "Tiny"},
	{id: "S", label: "Small"},
	{id: "M", label: "Medium"},
	{id: "L", label: "Large"},
	{id: "H", label: "Huge"},
	{id: "G", label: "Gargantuan"},
];

const CREATURE_TYPES = [
	{id: "aberration", label: "Aberration"},
	{id: "beast", label: "Beast"},
	{id: "celestial", label: "Celestial"},
	{id: "construct", label: "Construct"},
	{id: "dragon", label: "Dragon"},
	{id: "elemental", label: "Elemental"},
	{id: "fey", label: "Fey"},
	{id: "fiend", label: "Fiend"},
	{id: "giant", label: "Giant"},
	{id: "humanoid", label: "Humanoid"},
	{id: "monstrosity", label: "Monstrosity"},
	{id: "ooze", label: "Ooze"},
	{id: "plant", label: "Plant"},
	{id: "undead", label: "Undead"},
];

const ALIGNMENTS = [
	{id: "U", label: "Unaligned"},
	{id: "LG", label: "Lawful Good"},
	{id: "NG", label: "Neutral Good"},
	{id: "CG", label: "Chaotic Good"},
	{id: "LN", label: "Lawful Neutral"},
	{id: "N", label: "Neutral"},
	{id: "CN", label: "Chaotic Neutral"},
	{id: "LE", label: "Lawful Evil"},
	{id: "NE", label: "Neutral Evil"},
	{id: "CE", label: "Chaotic Evil"},
	{id: "A", label: "Any"},
];

const CHALLENGE_RATINGS = [
	"0", "1/8", "1/4", "1/2",
	"1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
	"11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
	"21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
].map(id => ({id, label: id}));

const SPELL_ABILITIES = [
	{id: "int", label: "Intelligence"},
	{id: "wis", label: "Wisdom"},
	{id: "cha", label: "Charisma"},
];

const TRAIT_TEMPLATES = [
	{id: "pack-tactics", name: "Pack Tactics", text: "{name} has Advantage on an attack roll against a creature if at least one of {name}'s allies is within 5 feet of the creature and the ally doesn't have the Incapacitated condition."},
	{id: "amphibious", name: "Amphibious", text: "{name} can breathe air and water."},
	{id: "magic-resistance", name: "Magic Resistance", text: "{name} has Advantage on saving throws against spells and other magical effects."},
	{id: "keen-hearing", name: "Keen Hearing and Smell", text: "{name} has Advantage on Wisdom (Perception) checks that rely on hearing or smell."},
	{id: "flyby", name: "Flyby", text: "{name} doesn't provoke an Opportunity Attack when it flies out of an enemy's reach."},
	{id: "spider-climb", name: "Spider Climb", text: "{name} can climb difficult surfaces, including along ceilings, without needing to make an ability check."},
	{id: "sunlight-sensitivity", name: "Sunlight Sensitivity", text: "While in sunlight, {name} has Disadvantage on attack rolls and Wisdom (Perception) checks that rely on sight."},
	{id: "regeneration", name: "Regeneration", text: "{name} regains 10 Hit Points at the start of its turn. If {name} takes fire damage, this trait doesn't function at the start of {name}'s next turn. {name} dies only if it starts its turn with 0 Hit Points and doesn't regenerate."},
	{id: "legendary-resistance", name: "Legendary Resistance (3/Day)", text: "If {name} fails a saving throw, it can choose to succeed instead."},
	{id: "false-appearance", name: "False Appearance", text: "If {name} is motionless at the start of combat, it has Advantage on its Initiative roll. If {name} wins Initiative, it can take the Surprise action."},
];

const ACTION_TEMPLATES = [
	{id: "multiattack", name: "Multiattack", text: "{name} makes two attacks."},
	{id: "bite", name: "Bite", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d6+2} Piercing damage."},
	{id: "claw", name: "Claw", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d6+2} Slashing damage."},
	{id: "slam", name: "Slam", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d8+2} Bludgeoning damage."},
	{id: "scimitar", name: "Scimitar", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d6+2} Slashing damage."},
	{id: "shortsword", name: "Shortsword", text: "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h} {@damage 1d6+2} Piercing damage."},
	{id: "shortbow", name: "Shortbow", text: "{@atk rw} {@hit 4} to hit, range 80/320 ft., one target. {@h} {@damage 1d6+2} Piercing damage."},
	{id: "longbow", name: "Longbow", text: "{@atk rw} {@hit 4} to hit, range 150/600 ft., one target. {@h} {@damage 1d8+2} Piercing damage."},
	{id: "spear", name: "Spear", text: "{@atk mw,rw} {@hit 4} to hit, reach 5 ft. or range 20/60 ft., one target. {@h} {@damage 1d6+2} Piercing damage."},
	{id: "dagger", name: "Dagger", text: "{@atk mw,rw} {@hit 4} to hit, reach 5 ft. or range 20/60 ft., one target. {@h} {@damage 1d4+2} Piercing damage."},
];

const BONUS_TEMPLATES = [
	{id: "dash", name: "Dash", text: "{name} moves up to its Speed."},
	{id: "disengage", name: "Disengage", text: "{name}'s movement doesn't provoke Opportunity Attacks for the rest of the turn."},
	{id: "hide", name: "Hide", text: "{name} takes the Hide action."},
];

const REACTION_TEMPLATES = [
	{id: "parry", name: "Parry", text: "{name} adds 2 to its AC against one melee attack that would hit it. To do so, {name} must see the attacker and be wielding a melee weapon."},
];

function monsterStatFields () {
	return [
		{key: "name", label: "Name"},
		{kind: "grid", fields: [
			{key: "size", label: "Size", input: "select", options: SIZES},
			{key: "type", label: "Type", input: "select", options: CREATURE_TYPES},
		]},
		{kind: "grid", fields: [
			{key: "alignment", label: "Alignment", input: "select", options: ALIGNMENTS},
			{key: "ac", label: "Armor class"},
		]},
		{kind: "grid", fields: [
			{key: "hpFormula", label: "HP formula"},
			{key: "speed", label: "Speed"},
		]},
		{kind: "grid", fields: [
			{key: "str", label: "STR"},
			{key: "dex", label: "DEX"},
			{key: "con", label: "CON"},
			{key: "int", label: "INT"},
			{key: "wis", label: "WIS"},
			{key: "cha", label: "CHA"},
		]},
		{key: "saves", label: "Saves (dex +3, wis +2)"},
		{key: "skills", label: "Skills (perception +5)"},
		{key: "passive", label: "Passive Perception"},
		{key: "senses", label: "Senses"},
		{key: "resist", label: "Resistances (fire, cold)"},
		{key: "immune", label: "Immunities (poison, fire)"},
		{key: "conditionImmune", label: "Condition immunities (charmed, frightened)"},
		{kind: "grid", fields: [
			{key: "languages", label: "Languages"},
			{key: "cr", label: "Challenge rating", input: "select", options: CHALLENGE_RATINGS},
		]},
	];
}

export function renderCreatureForm (parent, draft, {onChange} = {}) {
	const next = normalizeMonsterForm(draft);
	for (const key of Object.keys(next)) draft[key] = next[key];

	const emit = () => onChange?.(draft);
	const who = () => String(draft.name || "").trim() || "the creature";

	parent.addClass("fiveetools-creatureform");
	for (const field of monsterStatFields()) {
		if (field.kind === "grid") {
			const grid = parent.createDiv({cls: "fiveetools-homebrew__grid"});
			for (const child of field.fields) addField(grid, child, draft, emit);
			continue;
		}
		addField(parent, field, draft, emit);
	}

	renderNamedSection(parent, "Traits", "traits", TRAIT_TEMPLATES, draft, who, emit);
	renderNamedSection(parent, "Actions", "actions", ACTION_TEMPLATES, draft, who, emit);
	renderNamedSection(parent, "Bonus actions", "bonus", BONUS_TEMPLATES, draft, who, emit);
	renderNamedSection(parent, "Reactions", "reactions", REACTION_TEMPLATES, draft, who, emit);
	renderSpellSection(parent, draft, emit);
}

function renderNamedSection (parent, label, key, templates, draft, who, emit) {
	const wrap = parent.createDiv({cls: "fiveetools-creatureform__section"});
	wrap.createEl("label", {text: label});
	const listEl = wrap.createDiv({cls: "fiveetools-creatureform__list"});
	const addBtn = wrap.createEl("button", {text: `Add ${label.toLowerCase().replace(/s$/, "")}`, cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button"}});

	const paint = () => {
		listEl.empty();
		for (const row of draft[key]) {
			renderNamedRow(listEl, row, templates, draft, key, who, () => {
				emit();
				paint();
			}, emit);
		}
	};
	addBtn.addEventListener("click", (evt) => {
		evt.preventDefault();
		draft[key] = [...draft[key], newNamedRow()];
		emit();
		paint();
	});
	paint();
}

function renderNamedRow (parent, row, templates, draft, key, who, onListChange, emit) {
	const el = parent.createDiv({cls: "fiveetools-creatureform__namedrow"});
	const pick = el.createEl("select");
	pick.createEl("option", {attr: {value: ""}, text: "Custom"});
	for (const opt of templates) pick.createEl("option", {attr: {value: opt.id}, text: opt.name});
	if (row.template && !templates.some(it => it.id === row.template)) {
		pick.createEl("option", {attr: {value: row.template}, text: row.name || row.template});
	}
	pick.value = row.template || "";
	pick.addEventListener("change", () => {
		row.template = pick.value;
		const hit = templates.find(it => it.id === pick.value);
		if (hit) {
			row.name = hit.name;
			row.text = fillName(hit.text, who());
			nameEl.value = row.name;
			textEl.value = row.text;
		}
		emit();
	});

	const nameEl = el.createEl("input", {attr: {type: "text", placeholder: "Name", value: row.name}});
	nameEl.addEventListener("input", () => {
		row.name = nameEl.value;
		row.template = "";
		pick.value = "";
		emit();
	});
	const textEl = el.createEl("textarea", {attr: {rows: "3", placeholder: "Text"}});
	textEl.value = row.text;
	textEl.addEventListener("input", () => {
		row.text = textEl.value;
		emit();
	});
	const remove = el.createEl("button", {text: "×", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Remove"}});
	remove.addEventListener("click", (evt) => {
		evt.preventDefault();
		draft[key] = draft[key].filter(it => it.id !== row.id);
		onListChange();
	});
}

function renderSpellSection (parent, draft, emit) {
	const wrap = parent.createDiv({cls: "fiveetools-creatureform__section"});
	wrap.createEl("label", {text: "Spells"});
	const abilityWrap = wrap.createDiv({cls: "fiveetools-homebrew__field"});
	abilityWrap.createEl("label", {text: "Spellcasting ability"});
	const ability = abilityWrap.createEl("select");
	for (const opt of SPELL_ABILITIES) ability.createEl("option", {attr: {value: opt.id}, text: opt.label});
	ability.value = draft.spellAbility || "int";
	ability.addEventListener("change", () => {
		draft.spellAbility = ability.value;
		emit();
	});

	const searchEl = wrap.createEl("input", {
		cls: "fiveetools-creatureform__search",
		attr: {type: "search", placeholder: "Add spell…"},
	});
	const hitsEl = wrap.createDiv({cls: "fiveetools-creatureform__hits"});
	const listEl = wrap.createDiv({cls: "fiveetools-creatureform__list"});

	const paintSpells = () => {
		listEl.empty();
		if (!draft.spells.length) {
			listEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No spells."});
			return;
		}
		for (const spell of draft.spells) {
			const row = listEl.createDiv({cls: "fiveetools-creatureform__spell"});
			row.createEl("div", {cls: "fiveetools-modal__name", text: spell.name});
			row.createEl("div", {cls: "fiveetools-modal__sub", text: spell.source});
			const remove = row.createEl("button", {text: "×", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Remove"}});
			remove.addEventListener("click", (evt) => {
				evt.preventDefault();
				draft.spells = draft.spells.filter(it => it.id !== spell.id);
				emit();
				paintSpells();
			});
		}
	};

	const paintHits = () => {
		hitsEl.empty();
		const term = String(searchEl.value || "").trim();
		if (term.length < 2) return;
		const docs = searchEntities(term, {categoriesExact: ["spell"], limit: 8});
		if (!docs.length) {
			hitsEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No spells."});
			return;
		}
		for (const doc of docs) {
			const row = hitsEl.createDiv({cls: "fiveetools-creatureform__hit"});
			const meta = row.createDiv({cls: "fiveetools-creatureform__hitmeta"});
			meta.createEl("div", {cls: "fiveetools-modal__name", text: doc.n});
			meta.createEl("div", {cls: "fiveetools-modal__sub", text: doc.sA || doc.s});
			row.addEventListener("click", () => {
				const key = `${doc.n}|${doc.s}`.toLowerCase();
				if (draft.spells.some(it => `${it.name}|${it.source}`.toLowerCase() === key)) return;
				draft.spells = [...draft.spells, {
					id: newNamedRow().id,
					name: doc.n,
					source: doc.s,
					u: doc.u,
				}];
				searchEl.value = "";
				hitsEl.empty();
				emit();
				paintSpells();
			});
		}
	};

	searchEl.addEventListener("input", () => paintHits());
	paintSpells();
}

function addField (parent, field, draft, emit) {
	const wrap = parent.createDiv({cls: "fiveetools-homebrew__field"});
	wrap.createEl("label", {text: field.label});
	let el;
	if (field.input === "select") {
		el = wrap.createEl("select");
		const current = draft[field.key] ?? "";
		const opts = [...(field.options || [])];
		if (current !== "" && !opts.some(opt => opt.id === current)) opts.push({id: current, label: current});
		for (const opt of opts) el.createEl("option", {attr: {value: opt.id}, text: opt.label});
		el.value = current || opts[0]?.id || "";
		draft[field.key] = el.value;
	} else {
		el = wrap.createEl("input", {
			attr: {type: field.input || "text", value: draft[field.key] ?? ""},
		});
	}
	el.addEventListener("input", () => {
		draft[field.key] = el.value;
		emit();
	});
	el.addEventListener("change", () => {
		draft[field.key] = el.value;
		emit();
	});
}

function fillName (text, name) {
	return String(text || "").replace(/\{name\}/g, name);
}
