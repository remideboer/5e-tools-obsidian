import {searchEntities} from "./search-index.js";
import {newNamedRow, normalizeMonsterForm, parseSpeed, speedToText} from "./homebrew-store.js";
import {applyCalculatedCr, estimateCreatureCr} from "./creature-cr.js";
import {
	ACTION_TEMPLATES,
	BONUS_TEMPLATES,
	POPULAR_ACTIONS,
	POPULAR_BONUS,
	POPULAR_REACTIONS,
	POPULAR_TRAITS,
	REACTION_TEMPLATES,
	searchTemplates,
	templateById,
	TRAIT_TEMPLATES,
} from "./creature-templates.js";
import {loadEntity} from "./entity-loader.js";
import {enrichMonsterSpells, spellRollerMetaFromEntity} from "./spell-roll-enrich.js";
import {getParser} from "./fiveetools-host.js";
import {listRollTables} from "./roll-tables/roll-table-store.js";
import {ensureLootData, listLootTables} from "./loot-view.js";
import {lootTableRef, isLootTableRef} from "./creature-lore.js";

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

const SPELL_KINDS = [
	{id: "spellcasting", label: "Spellcasting"},
	{id: "innate", label: "Innate Spellcasting"},
];

const RECHARGE_OPTIONS = [
	{id: "", label: "No recharge"},
	{id: "6", label: "Recharge 6"},
	{id: "5", label: "Recharge 5–6"},
	{id: "4", label: "Recharge 4–6"},
	{id: "3", label: "Recharge 3–6"},
	{id: "2", label: "Recharge 2–6"},
];

const SPELL_USAGE_OPTIONS = [
	{id: "will", label: "At will"},
	{id: "slot", label: "Spell slot"},
	{id: "recharge", label: "Recharge"},
];

const SLOT_LEVELS = [
	{id: "0", label: "Cantrip"},
	...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({id: String(n), label: `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`})),
];

function numberedOptions (min, max, step = 1) {
	const out = [];
	for (let n = min; n <= max; n += step) out.push({id: String(n), label: String(n)});
	return out;
}

const ABILITY_SCORES = numberedOptions(1, 30);
const ARMOR_CLASSES = numberedOptions(1, 30);
const SPEEDS = numberedOptions(0, 120, 5).map(it => ({id: it.id, label: `${it.label} ft.`}));
const SPEED_MODES = [
	{id: "fly", label: "Fly"},
	{id: "swim", label: "Swim"},
	{id: "climb", label: "Climb"},
	{id: "burrow", label: "Burrow"},
];
const SLOT_COUNTS = numberedOptions(1, 6);

const DAMAGE_TYPES = [
	{id: "acid", label: "Acid"},
	{id: "bludgeoning", label: "Bludgeoning"},
	{id: "cold", label: "Cold"},
	{id: "fire", label: "Fire"},
	{id: "force", label: "Force"},
	{id: "lightning", label: "Lightning"},
	{id: "necrotic", label: "Necrotic"},
	{id: "piercing", label: "Piercing"},
	{id: "poison", label: "Poison"},
	{id: "psychic", label: "Psychic"},
	{id: "radiant", label: "Radiant"},
	{id: "slashing", label: "Slashing"},
	{id: "thunder", label: "Thunder"},
];

export const CONDITIONS = [
	{id: "blinded", label: "Blinded"},
	{id: "charmed", label: "Charmed"},
	{id: "deafened", label: "Deafened"},
	{id: "exhaustion", label: "Exhaustion"},
	{id: "frightened", label: "Frightened"},
	{id: "grappled", label: "Grappled"},
	{id: "incapacitated", label: "Incapacitated"},
	{id: "invisible", label: "Invisible"},
	{id: "paralyzed", label: "Paralyzed"},
	{id: "petrified", label: "Petrified"},
	{id: "poisoned", label: "Poisoned"},
	{id: "prone", label: "Prone"},
	{id: "restrained", label: "Restrained"},
	{id: "stunned", label: "Stunned"},
	{id: "unconscious", label: "Unconscious"},
];

const SECTION_META = {
	traits: {label: "Traits", templates: TRAIT_TEMPLATES, popular: POPULAR_TRAITS, singular: "trait"},
	actions: {label: "Actions", templates: ACTION_TEMPLATES, popular: POPULAR_ACTIONS, singular: "action"},
	bonus: {label: "Bonus actions", templates: BONUS_TEMPLATES, popular: POPULAR_BONUS, singular: "bonus action"},
	reactions: {label: "Reactions", templates: REACTION_TEMPLATES, popular: POPULAR_REACTIONS, singular: "reaction"},
};

function monsterStatFields () {
	return [
		{key: "name", label: "Name"},
		{kind: "grid", fields: [
			{key: "size", label: "Size", input: "select", options: SIZES},
			{key: "type", label: "Type", input: "select", options: CREATURE_TYPES},
		]},
		{kind: "grid", fields: [
			{key: "alignment", label: "Alignment", input: "select", options: ALIGNMENTS},
			{key: "ac", label: "Armor class", input: "select", options: ARMOR_CLASSES, fallback: "10"},
		]},
		{key: "hpFormula", label: "HP formula"},
		{kind: "speed"},
		{kind: "grid", cols: 3, fields: [
			{key: "str", label: "STR", input: "select", options: ABILITY_SCORES, fallback: "10"},
			{key: "dex", label: "DEX", input: "select", options: ABILITY_SCORES, fallback: "10"},
			{key: "con", label: "CON", input: "select", options: ABILITY_SCORES, fallback: "10"},
			{key: "int", label: "INT", input: "select", options: ABILITY_SCORES, fallback: "10"},
			{key: "wis", label: "WIS", input: "select", options: ABILITY_SCORES, fallback: "10"},
			{key: "cha", label: "CHA", input: "select", options: ABILITY_SCORES, fallback: "10"},
		]},
		{key: "saves", label: "Saves (dex +3, wis +2)"},
		{key: "skills", label: "Skills (perception +5)"},
		{key: "passive", label: "Passive Perception"},
		{key: "senses", label: "Senses"},
		{key: "resist", label: "Resistances", input: "picklist", options: DAMAGE_TYPES, placeholder: "or type a custom resistance"},
		{key: "immune", label: "Immunities", input: "picklist", options: DAMAGE_TYPES, placeholder: "or type a custom immunity"},
		{key: "conditionImmune", label: "Condition immunities", input: "picklist", options: CONDITIONS, placeholder: "or type a custom condition"},
		{key: "languages", label: "Languages"},
		{kind: "cr"},
	];
}

export function renderCreatureForm (parent, draft, {onChange, plugin} = {}) {
	const next = normalizeMonsterForm(draft);
	for (const key of Object.keys(next)) draft[key] = next[key];

	let paintCr = () => {};
	let paintSpellSummary = () => {};
	const emit = () => {
		applyCalculatedCr(draft);
		paintCr();
		paintSpellSummary();
		onChange?.(draft);
	};
	const who = () => String(draft.name || "").trim() || "the creature";

	parent.addClass("fiveetools-creatureform");
	for (const field of monsterStatFields()) {
		if (field.kind === "grid") {
			const grid = parent.createDiv({cls: field.cols === 3 ? "fiveetools-homebrew__grid fiveetools-homebrew__grid--3" : "fiveetools-homebrew__grid"});
			for (const child of field.fields) addField(grid, child, draft, emit);
			continue;
		}
		if (field.kind === "cr") {
			paintCr = addCrField(parent, draft, emit);
			continue;
		}
		if (field.kind === "speed") {
			addSpeedField(parent, draft, emit);
			continue;
		}
		addField(parent, field, draft, emit);
	}
	applyCalculatedCr(draft);
	paintCr();

	addTextAreaField(parent, {
		key: "description",
		label: "Description",
		placeholder: "Short physical description…",
		rows: "3",
	}, draft, emit);
	addTextAreaField(parent, {
		key: "lore",
		label: "Lore",
		placeholder: "Background and lore…",
		rows: "5",
	}, draft, emit);
	renderRollTableSection(parent, draft, emit, plugin);

	for (const key of ["traits", "actions", "bonus", "reactions"]) {
		renderNamedSection(parent, key, draft, who, emit, {
			onInnate: () => {
				draft.spellKind = "innate";
				emit();
				paintSpellSummary();
			},
		});
	}
	paintSpellSummary = renderSpellSection(parent, draft, emit);
}

function addTextAreaField (parent, field, draft, emit) {
	const wrap = parent.createDiv({cls: "fiveetools-homebrew__field"});
	wrap.createEl("label", {text: field.label});
	const el = wrap.createEl("textarea", {
		attr: {
			rows: field.rows || "3",
			placeholder: field.placeholder || "",
		},
	});
	el.value = draft[field.key] ?? "";
	el.addEventListener("input", () => {
		draft[field.key] = el.value;
		emit();
	});
}

function renderRollTableSection (parent, draft, emit, plugin) {
	const wrap = parent.createDiv({cls: "fiveetools-creatureform__section"});
	wrap.createEl("label", {text: "Roll tables"});
	wrap.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Link vault tables or loot generator tables.",
	});

	const attachedEl = wrap.createDiv({cls: "fiveetools-creatureform__tables"});
	const searchEl = wrap.createEl("input", {
		cls: "fiveetools-creatureform__search",
		attr: {type: "search", placeholder: "Search roll tables…"},
	});
	const hitsEl = wrap.createDiv({cls: "fiveetools-creatureform__hits"});

	const paintAttached = () => {
		attachedEl.empty();
		const rows = Array.isArray(draft.rollTables) ? draft.rollTables : [];
		if (!rows.length) {
			attachedEl.createEl("div", {cls: "fiveetools-view__meta", text: "No tables linked."});
			return;
		}
		for (const row of rows) {
			const item = attachedEl.createDiv({cls: "fiveetools-creatureform__tablerow"});
			const label = item.createDiv();
			label.createEl("div", {text: row.name || row.path});
			label.createEl("div", {
				cls: "fiveetools-view__meta",
				text: isLootTableRef(row.path) ? "Loot generator" : "Vault table",
			});
			const remove = item.createEl("button", {
				text: "Remove",
				cls: "fiveetools-btn fiveetools-btn--ghost",
				attr: {type: "button"},
			});
			remove.addEventListener("click", () => {
				draft.rollTables = (draft.rollTables || []).filter(it => it.path !== row.path);
				emit();
				paintAttached();
			});
		}
	};

	let tables = [];
	let highlight = 0;
	const filtered = () => {
		const needle = String(searchEl.value || "").trim().toLowerCase();
		const linked = new Set((draft.rollTables || []).map(it => it.path));
		return tables.filter((table) => {
			if (linked.has(table.path)) return false;
			if (!needle) return true;
			return String(table.name || "").toLowerCase().includes(needle)
				|| String(table.sub || "").toLowerCase().includes(needle)
				|| String(table.path || "").toLowerCase().includes(needle);
		}).slice(0, 12);
	};

	const applyHit = (hit) => {
		if (!hit?.path) return;
		const rows = Array.isArray(draft.rollTables) ? draft.rollTables : [];
		if (rows.some(it => it.path === hit.path)) return;
		draft.rollTables = [...rows, {path: hit.path, name: hit.name || hit.path}];
		emit();
		searchEl.value = "";
		hitsEl.empty();
		paintAttached();
		queueMicrotask(() => searchEl.focus());
	};

	const paintHits = () => {
		hitsEl.empty();
		const hits = filtered();
		if (!hits.length) {
			if (String(searchEl.value || "").trim().length >= 1) {
				hitsEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No matches."});
			}
			highlight = 0;
			return;
		}
		highlight = Math.min(highlight, hits.length - 1);
		hits.forEach((hit, index) => {
			const row = hitsEl.createDiv({
				cls: `fiveetools-creatureform__hit${index === highlight ? " is-selected" : ""}`,
			});
			row.createEl("div", {cls: "fiveetools-modal__name", text: hit.name});
			row.createEl("div", {cls: "fiveetools-modal__sub", text: hit.sub || hit.path});
			row.addEventListener("click", () => applyHit(hit));
		});
	};

	searchEl.addEventListener("input", () => {
		highlight = 0;
		paintHits();
	});
	searchEl.addEventListener("keydown", (evt) => {
		const hits = filtered();
		if (!hits.length) return;
		if (evt.key === "ArrowDown") {
			evt.preventDefault();
			highlight = (highlight + 1) % hits.length;
			paintHits();
		} else if (evt.key === "ArrowUp") {
			evt.preventDefault();
			highlight = (highlight - 1 + hits.length) % hits.length;
			paintHits();
		} else if (evt.key === "Enter") {
			evt.preventDefault();
			applyHit(hits[highlight] || hits[0]);
		}
	});

	paintAttached();
	if (plugin) {
		void (async () => {
			const vault = await listRollTables(plugin);
			const vaultHits = (vault || []).map(table => ({
				path: table.path,
				name: table.name || table.stem || table.path,
				sub: "Vault table",
			}));
			let lootHits = [];
			try {
				await ensureLootData(plugin);
				lootHits = listLootTables().map(table => ({
					path: lootTableRef(table.id),
					name: table.label || table.name,
					sub: `Loot · ${table.group || "Generator"}`,
				}));
			} catch (_) { /* loot data optional in editor */ }
			tables = [...vaultHits, ...lootHits]
				.sort((a, b) => String(a.name).localeCompare(String(b.name)));
			paintHits();
		})();
	}
}

function renderNamedSection (parent, key, draft, who, emit, {onInnate} = {}) {
	const meta = SECTION_META[key];
	const wrap = parent.createDiv({cls: "fiveetools-creatureform__section"});
	wrap.createEl("label", {text: meta.label});

	const searchEl = wrap.createEl("input", {
		cls: "fiveetools-creatureform__search",
		attr: {type: "search", placeholder: `Search ${meta.label.toLowerCase()}…`},
	});
	const hitsEl = wrap.createDiv({cls: "fiveetools-creatureform__hits"});
	const chips = wrap.createDiv({cls: "fiveetools-creatureform__chips"});
	for (const id of meta.popular) {
		const hit = templateById(meta.templates, id);
		if (!hit) continue;
		const chip = chips.createEl("button", {
			text: hit.name,
			cls: "fiveetools-btn fiveetools-btn--ghost fiveetools-creatureform__chip",
			attr: {type: "button"},
		});
		chip.addEventListener("click", (evt) => {
			evt.preventDefault();
			applyTemplate(draft, key, hit, who, emit, onInnate);
			paint();
			searchEl.value = "";
			hitsEl.empty();
			searchEl.focus();
		});
	}

	const listEl = wrap.createDiv({cls: "fiveetools-creatureform__list"});
	const addBtn = wrap.createEl("button", {
		text: `Add custom ${meta.singular}`,
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});

	const paint = () => {
		listEl.empty();
		for (const row of draft[key]) {
			renderNamedRow(listEl, row, draft, key, () => {
				emit();
				paint();
			}, emit);
		}
	};

	const applyHit = (hit) => {
		applyTemplate(draft, key, hit, who, emit, onInnate);
		searchEl.value = "";
		hitsEl.empty();
		paint();
		queueMicrotask(() => searchEl.focus());
	};

	let highlight = 0;
	const paintHits = () => {
		hitsEl.empty();
		const hits = searchTemplates(meta.templates, searchEl.value, 10);
		if (!hits.length) {
			if (String(searchEl.value || "").trim().length >= 2) {
				hitsEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No matches."});
			}
			highlight = 0;
			return;
		}
		highlight = Math.min(highlight, hits.length - 1);
		hits.forEach((hit, index) => {
			const row = hitsEl.createDiv({
				cls: `fiveetools-creatureform__hit${index === highlight ? " is-selected" : ""}`,
			});
			const metaEl = row.createDiv({cls: "fiveetools-creatureform__hitmeta"});
			metaEl.createEl("div", {cls: "fiveetools-modal__name", text: hit.name});
			if (hit.special === "innate") {
				metaEl.createEl("div", {cls: "fiveetools-modal__sub", text: "Sets Innate Spellcasting"});
			}
			row.addEventListener("click", () => applyHit(hit));
		});
	};

	searchEl.addEventListener("input", () => {
		highlight = 0;
		paintHits();
	});
	searchEl.addEventListener("keydown", (evt) => {
		const hits = searchTemplates(meta.templates, searchEl.value, 10);
		if (!hits.length) return;
		if (evt.key === "ArrowDown") {
			evt.preventDefault();
			highlight = (highlight + 1) % hits.length;
			paintHits();
		} else if (evt.key === "ArrowUp") {
			evt.preventDefault();
			highlight = (highlight - 1 + hits.length) % hits.length;
			paintHits();
		} else if (evt.key === "Enter") {
			evt.preventDefault();
			applyHit(hits[highlight] || hits[0]);
		}
	});

	addBtn.addEventListener("click", (evt) => {
		evt.preventDefault();
		draft[key] = [...draft[key], newNamedRow()];
		emit();
		paint();
	});
	paint();
}

function applyTemplate (draft, key, hit, who, emit, onInnate) {
	if (hit?.special === "innate") {
		onInnate?.();
		return;
	}
	const row = newNamedRow({
		name: hit.name,
		text: fillName(hit.text, who()),
		template: hit.id,
	});
	draft[key] = [...draft[key], row];
	emit();
}

function renderNamedRow (parent, row, draft, key, onListChange, emit) {
	const el = parent.createDiv({cls: "fiveetools-creatureform__namedrow"});
	const nameEl = el.createEl("input", {attr: {type: "text", placeholder: "Name", value: row.name}});
	nameEl.addEventListener("input", () => {
		row.name = nameEl.value;
		row.template = "";
		emit();
	});

	const recharge = el.createEl("select", {attr: {title: "Recharge"}});
	for (const opt of RECHARGE_OPTIONS) {
		recharge.createEl("option", {attr: {value: opt.id}, text: opt.label});
	}
	recharge.value = row.recharge ? String(row.recharge) : "";
	recharge.addEventListener("change", () => {
		row.recharge = recharge.value ? Number(recharge.value) : null;
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

	const kindWrap = wrap.createDiv({cls: "fiveetools-homebrew__field"});
	kindWrap.createEl("label", {text: "Kind"});
	const kind = kindWrap.createEl("select");
	for (const opt of SPELL_KINDS) kind.createEl("option", {attr: {value: opt.id}, text: opt.label});
	kind.value = draft.spellKind === "innate" ? "innate" : "spellcasting";
	kind.addEventListener("change", () => {
		draft.spellKind = kind.value;
		emit();
	});

	const abilityWrap = wrap.createDiv({cls: "fiveetools-homebrew__field"});
	abilityWrap.createEl("label", {text: "Spellcasting ability"});
	const ability = abilityWrap.createEl("select");
	for (const opt of SPELL_ABILITIES) ability.createEl("option", {attr: {value: opt.id}, text: opt.label});
	ability.value = draft.spellAbility || "int";
	ability.addEventListener("change", () => {
		draft.spellAbility = ability.value;
		emit();
	});
	const summary = abilityWrap.createEl("div", {cls: "fiveetools-creatureform__spellstats"});

	const paintSummary = () => {
		kind.value = draft.spellKind === "innate" ? "innate" : "spellcasting";
		ability.value = draft.spellAbility || "int";
		const stats = spellAttackAndDc(draft);
		summary.setText(`Spell attack +${stats.hit} · Save DC ${stats.dc}`);
	};

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
			const head = row.createDiv({cls: "fiveetools-creatureform__spellhead"});
			head.createEl("div", {cls: "fiveetools-modal__name", text: spell.name});
			head.createEl("div", {cls: "fiveetools-modal__sub", text: spell.source});
			const remove = head.createEl("button", {text: "×", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Remove"}});
			remove.addEventListener("click", (evt) => {
				evt.preventDefault();
				draft.spells = draft.spells.filter(it => it.id !== spell.id);
				emit();
				paintSpells();
			});

			const usageRow = row.createDiv({cls: "fiveetools-creatureform__spellusage"});
			const usage = usageRow.createEl("select", {attr: {title: "Usage"}});
			for (const opt of SPELL_USAGE_OPTIONS) usage.createEl("option", {attr: {value: opt.id}, text: opt.label});
			usage.value = spell.usage || "will";

			const slotLevel = usageRow.createEl("select", {attr: {title: "Slot level"}});
			for (const opt of SLOT_LEVELS) slotLevel.createEl("option", {attr: {value: opt.id}, text: opt.label});
			slotLevel.value = String(spell.slotLevel ?? 1);

			const slots = usageRow.createEl("select", {attr: {title: "Slots"}});
			for (const opt of SLOT_COUNTS) slots.createEl("option", {attr: {value: opt.id}, text: `${opt.label} slot${opt.id === "1" ? "" : "s"}`});
			slots.value = String(spell.slots || 1);

			const recharge = usageRow.createEl("select", {attr: {title: "Recharge"}});
			for (const opt of RECHARGE_OPTIONS.filter(it => it.id)) {
				recharge.createEl("option", {attr: {value: opt.id}, text: opt.label});
			}
			recharge.value = String(spell.recharge || 6);

			const syncUsageUi = () => {
				const mode = usage.value;
				slotLevel.style.display = mode === "slot" ? "" : "none";
				slots.style.display = mode === "slot" && Number(slotLevel.value) > 0 ? "" : "none";
				recharge.style.display = mode === "recharge" ? "" : "none";
			};
			syncUsageUi();

			usage.addEventListener("change", () => {
				spell.usage = usage.value;
				if (spell.usage === "slot" && spell.slotLevel == null) spell.slotLevel = 1;
				if (spell.usage === "recharge" && !spell.recharge) spell.recharge = 6;
				syncUsageUi();
				emit();
			});
			slotLevel.addEventListener("change", () => {
				spell.slotLevel = Number(slotLevel.value) || 0;
				syncUsageUi();
				emit();
			});
			slots.addEventListener("change", () => {
				spell.slots = Math.max(1, Number(slots.value) || 1);
				emit();
			});
			recharge.addEventListener("change", () => {
				spell.recharge = Number(recharge.value) || 6;
				emit();
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
				const spell = {
					id: newNamedRow().id,
					name: doc.n,
					source: doc.s,
					u: doc.u,
					usage: "will",
					slotLevel: 1,
					slots: 1,
					recharge: 6,
					hasAttack: false,
					damageTag: "",
					enriched: false,
				};
				draft.spells = [...draft.spells, spell];
				searchEl.value = "";
				hitsEl.empty();
				emit();
				paintSpells();
				queueMicrotask(() => searchEl.focus());
				void loadEntity(doc).then(({ent}) => {
					Object.assign(spell, spellRollerMetaFromEntity(ent));
					emit();
				}).catch(() => {
					spell.enriched = true;
					emit();
				});
			});
		}
	};

	searchEl.addEventListener("input", () => paintHits());
	paintSpells();
	paintSummary();
	void enrichMonsterSpells(draft).then((changed) => {
		if (!changed) return;
		paintSpells();
		emit();
	});
	return paintSummary;
}

function spellAttackAndDc (draft) {
	const ability = String(draft.spellAbility || "int").toLowerCase();
	const score = Number(draft[ability]) || 10;
	const mod = Math.floor((score - 10) / 2);
	const pb = proficiencyBonus(draft.cr);
	return {hit: mod + pb, dc: 8 + mod + pb};
}

function proficiencyBonus (cr) {
	try {
		const Parser = getParser();
		const pb = Parser?.crToPb?.(cr);
		if (Number.isFinite(pb) && pb > 0) return pb;
	} catch (_) { /* fall through */ }
	const n = Number(String(cr || "0").includes("/") ? 0 : cr) || 0;
	if (n < 5) return 2;
	return Math.ceil(n / 4) + 1;
}

function addSpeedField (parent, draft, emit) {
	const wrap = parent.createDiv({cls: "fiveetools-homebrew__field"});
	wrap.createEl("label", {text: "Speed"});
	const listEl = wrap.createDiv({cls: "fiveetools-creatureform__speeds"});
	const addRow = wrap.createDiv({cls: "fiveetools-creatureform__speedadd"});
	const addPick = addRow.createEl("select", {attr: {title: "Add speed"}});
	addPick.createEl("option", {attr: {value: ""}, text: "Add speed…"});

	const readSpeeds = () => parseSpeed(draft.speed);
	const writeSpeeds = (speeds) => {
		draft.speed = speedToText(speeds);
		emit();
		paint();
	};

	const paint = () => {
		const speeds = readSpeeds();
		listEl.empty();

		const walkRow = listEl.createDiv({cls: "fiveetools-creatureform__speedrow"});
		walkRow.createSpan({cls: "fiveetools-creatureform__speedlabel", text: "Walk"});
		const walkSel = walkRow.createEl("select", {attr: {title: "Walk speed"}});
		for (const opt of SPEEDS) walkSel.createEl("option", {attr: {value: opt.id}, text: opt.label});
		walkSel.value = String(speeds.walk ?? 30);
		if (![...walkSel.options].some(o => o.value === walkSel.value)) {
			walkSel.createEl("option", {attr: {value: walkSel.value}, text: `${walkSel.value} ft.`});
		}
		walkSel.addEventListener("change", () => {
			const next = readSpeeds();
			next.walk = Number(walkSel.value) || 0;
			writeSpeeds(next);
		});

		for (const mode of SPEED_MODES) {
			if (speeds[mode.id] == null) continue;
			const row = listEl.createDiv({cls: "fiveetools-creatureform__speedrow"});
			row.createSpan({cls: "fiveetools-creatureform__speedlabel", text: mode.label});
			const sel = row.createEl("select", {attr: {title: `${mode.label} speed`}});
			for (const opt of SPEEDS) sel.createEl("option", {attr: {value: opt.id}, text: opt.label});
			sel.value = String(speeds[mode.id]);
			if (![...sel.options].some(o => o.value === sel.value)) {
				sel.createEl("option", {attr: {value: sel.value}, text: `${sel.value} ft.`});
			}
			sel.addEventListener("change", () => {
				const next = readSpeeds();
				next[mode.id] = Number(sel.value) || 0;
				if (!next[mode.id]) delete next[mode.id];
				writeSpeeds(next);
			});
			const remove = row.createEl("button", {
				text: "×",
				cls: "fiveetools-btn fiveetools-btn--ghost",
				attr: {type: "button", title: `Remove ${mode.label.toLowerCase()}`},
			});
			remove.addEventListener("click", (evt) => {
				evt.preventDefault();
				const next = readSpeeds();
				delete next[mode.id];
				writeSpeeds(next);
			});
		}

		addPick.empty();
		addPick.createEl("option", {attr: {value: ""}, text: "Add speed…"});
		for (const mode of SPEED_MODES) {
			if (speeds[mode.id] != null) continue;
			addPick.createEl("option", {attr: {value: mode.id}, text: mode.label});
		}
		addPick.value = "";
		addPick.disabled = SPEED_MODES.every(mode => speeds[mode.id] != null);
	};

	addPick.addEventListener("change", () => {
		const mode = addPick.value;
		addPick.value = "";
		if (!mode) return;
		const next = readSpeeds();
		if (next[mode] != null) return;
		next[mode] = Number(next.walk) || 30;
		writeSpeeds(next);
	});

	paint();
}

function addCrField (parent, draft, emit) {
	const wrap = parent.createDiv({cls: "fiveetools-homebrew__field"});
	wrap.createEl("label", {text: "Challenge rating"});
	const hint = wrap.createEl("div", {cls: "fiveetools-creatureform__crhint"});
	const row = wrap.createDiv({cls: "fiveetools-creatureform__cr"});
	const select = row.createEl("select", {attr: {title: "Challenge rating"}});
	for (const opt of CHALLENGE_RATINGS) {
		select.createEl("option", {attr: {value: opt.id}, text: opt.label});
	}
	const checkWrap = row.createEl("label", {cls: "fiveetools-homebrew__check", attr: {title: "Keep this CR instead of the calculated value"}});
	const cb = checkWrap.createEl("input", {attr: {type: "checkbox"}});
	checkWrap.createSpan({text: "Override calculated CR"});

	const paint = () => {
		const info = estimateCreatureCr(draft);
		if (info.cr) {
			const bits = [`Calculated CR ${info.cr}`];
			if (info.defensive || info.offensive) {
				bits.push(`(Def ${info.defensive || "—"} · Off ${info.offensive || "—"})`);
			}
			hint.setText(bits.join(" "));
		} else {
			hint.setText("Calculated CR — (needs HP/AC or attack damage)");
		}
		select.value = draft.cr || "0";
		select.toggleAttribute("disabled", !draft.crOverride);
		cb.checked = !!draft.crOverride;
	};

	cb.addEventListener("change", () => {
		draft.crOverride = cb.checked;
		emit();
	});
	select.addEventListener("change", () => {
		draft.crOverride = true;
		draft.cr = select.value;
		emit();
	});
	return paint;
}

function addField (parent, field, draft, emit) {
	const wrap = parent.createDiv({cls: "fiveetools-homebrew__field"});
	wrap.createEl("label", {text: field.label});
	if (field.input === "picklist") {
		addPickList(wrap, field, draft, emit);
		return;
	}
	let el;
	if (field.input === "select") {
		el = wrap.createEl("select");
		const current = draft[field.key] ?? "";
		const opts = [...(field.options || [])];
		if (current !== "" && !opts.some(opt => opt.id === current)) opts.push({id: current, label: current});
		for (const opt of opts) el.createEl("option", {attr: {value: opt.id}, text: opt.label});
		el.value = current || field.fallback || opts[0]?.id || "";
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

function addPickList (wrap, field, draft, emit) {
	const row = wrap.createDiv({cls: "fiveetools-creatureform__picklist"});
	const pick = row.createEl("select");
	pick.createEl("option", {attr: {value: ""}, text: "Add…"});
	for (const opt of field.options || []) pick.createEl("option", {attr: {value: opt.id}, text: opt.label});
	const el = row.createEl("input", {
		attr: {
			type: "text",
			value: draft[field.key] ?? "",
			placeholder: field.placeholder || "or type a custom value",
		},
	});
	pick.addEventListener("change", () => {
		const token = pick.value;
		pick.value = "";
		if (!token) return;
		draft[field.key] = appendToken(el.value, token);
		el.value = draft[field.key];
		emit();
	});
	el.addEventListener("input", () => {
		draft[field.key] = el.value;
		emit();
	});
}

function appendToken (raw, token) {
	const parts = String(raw || "").split(",").map(it => it.trim()).filter(Boolean);
	if (parts.some(it => it.toLowerCase() === token.toLowerCase())) return parts.join(", ");
	parts.push(token);
	return parts.join(", ");
}

function fillName (text, name) {
	return String(text || "").replace(/\{name\}/g, name);
}
