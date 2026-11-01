import {Notice} from "obsidian";
import {attachHoverCard} from "./hover-card.js";
import {appendTextWithDiceRollers, bindDiceRollers, presentRoll, rollPacked} from "./dice-roll.js";
import {addCombatants} from "./encounter-view.js";
import {generateRandom, randomHabitats} from "./random-generate.js";
import {resolveCardItem} from "./roll-result-card.js";
import {ensureSearchIndex, listEntities} from "./search-index.js";

const TYPES = [
	{group: "Adventure Elements", items: [
		["encounter", "Encounters"],
		["trap", "Traps"],
		["treasure", "Treasure"],
	]},
	{group: "Characters", items: [["npc", "NPCs"]]},
	{group: "Mundane Items", items: [
		["trinket", "Trinkets"],
		["art_object", "Art Objects"],
	]},
	{group: "Magic Items", items: [
		["magic_item", "Magic Items"],
		["spellbook", "Spellbook"],
	]},
	{group: "Magic Effects", items: [["wild_surge", "Wild Magic Surges"]]},
	{group: "Bastions", items: [["bastion", "Bastion Events"]]},
];

const LEVELS = Array.from({length: 20}, (_, i) => [String(i + 1), String(i + 1)]);
const PARTY = Array.from({length: 12}, (_, i) => [String(i + 1), String(i + 1)]);
const CRS = ["0", "1/8", "1/4", "1/2", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20"]
	.map(cr => [cr, cr === "20" ? "CR 20+" : `CR ${cr}`]);

export async function renderRandomTool (listEl, readerEl, {plugin, session = {}, onSessionChange, onOpenEncounter, listToken, isCurrent} = {}) {
	listEl.empty();
	listEl.addClass("fiveetools-random");
	readerEl?.empty();
	readerEl?.addClass("fiveetools-random-reader");
	listEl.createEl("p", {cls: "fiveetools-view__meta", text: "Loading the library…"});
	try {
		await ensureSearchIndex(plugin);
	} catch (e) {
		if (isCurrent && !isCurrent(listToken)) return;
		listEl.empty();
		listEl.createEl("p", {text: e.message || "Could not load the library."});
		return;
	}
	if (isCurrent && !isCurrent(listToken)) return;
	paint(listEl, readerEl, {plugin, session, onSessionChange, onOpenEncounter});
}

function paint (listEl, readerEl, {plugin, session, onSessionChange, onOpenEncounter}) {
	listEl.empty();
	const species = listEntities({categoriesExact: ["species"]}).map(doc => [doc.n, doc.n]);
	const classes = listEntities({categoriesExact: ["class"]}).map(doc => [doc.n, doc.n]);
	const state = {
		type: knownType(session.type) ? session.type : "encounter",
		fields: {...(session.fields || {})},
		result: session.result || null,
	};

	const emit = () => onSessionChange?.({
		type: state.type,
		fields: {...state.fields},
		result: state.result,
	});

	listEl.createEl("h3", {text: "Random"});
	listEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Generator list from donjon’s 5.5 Random Generator by drow.",
	});

	const typeWrap = listEl.createDiv({cls: "fiveetools-size__field"});
	typeWrap.createEl("label", {text: "Generator"});
	const typeSelect = typeWrap.createEl("select");
	for (const group of TYPES) {
		const optgroup = typeSelect.createEl("optgroup", {attr: {label: group.group}});
		for (const [id, label] of group.items) {
			optgroup.createEl("option", {text: label, attr: {value: id}});
		}
	}
	typeSelect.value = state.type;

	const fieldsHost = listEl.createDiv();
	const resultHost = readerEl || listEl.createDiv();

	const generate = async () => {
		try {
			state.result = await generateRandom(plugin, {type: state.type, ...state.fields});
			emit();
			paintResult();
		} catch (e) {
			new Notice(e.message || "Could not generate.");
		}
	};

	typeSelect.addEventListener("change", () => {
		state.type = typeSelect.value;
		state.fields = {};
		state.result = null;
		emit();
		paintFields();
		paintResult();
	});

	const roll = listEl.createEl("button", {text: "Generate", cls: "fiveetools-btn", attr: {type: "button"}});
	roll.addEventListener("click", () => { void generate(); });

	function paintFields () {
		fieldsHost.empty();
		for (const field of fieldsFor(state.type, species, classes, state.fields)) {
			const current = state.fields[field.id] ?? field.options[0]?.[0] ?? "";
			state.fields[field.id] = current;
			const select = labeledSelect(fieldsHost, field.label, current, field.options);
			select.addEventListener("change", () => {
				state.fields[field.id] = select.value;
				if (field.id === "lootType" && !/hoard|with items|salvage/i.test(select.value)) {
					delete state.fields.rarity;
					delete state.fields.theme;
					delete state.fields.level;
				}
				if (field.id === "rarity" && select.value) delete state.fields.level;
				emit();
				if (field.id === "lootType" || field.id === "rarity") paintFields();
			});
		}
	}

	function paintResult () {
		resultHost.empty();
		const result = state.result;
		if (!result?.rows?.length) {
			resultHost.createEl("p", {cls: "fiveetools-view__meta", text: "Choose the dropdowns, then Generate."});
			return;
		}
		resultHost.createEl("h3", {text: result.title || "Result"});
		const die = resultHost.createDiv({cls: "fiveetools-random__die"});
		die.appendText("Roll ");
		const roller = die.createEl("span", {
			cls: "render-roller ve-roller",
			text: "1d10",
			attr: {title: "Click to roll.", "data-packed-dice": JSON.stringify({toRoll: "1d10"})},
		});
		const rowEls = [];
		for (const row of result.rows) {
			const el = resultHost.createDiv({cls: "fiveetools-random__row", attr: {"data-face": String(row.face)}});
			el.createSpan({cls: "fiveetools-random__face", text: String(row.face)});
			const body = el.createDiv({cls: "fiveetools-random__body"});
			if (row.caption) body.createEl("p", {cls: "fiveetools-view__meta", text: row.caption});
			if (row.warning) body.createEl("p", {cls: "fiveetools-view__meta", text: row.warning});
			for (const line of row.lines || []) paintLine(body, line, plugin);
			rowEls.push(el);
		}
		const mark = (face) => {
			for (const el of rowEls) {
				const on = Number(el.dataset.face) === face;
				el.classList.toggle("is-selected", on);
				el.querySelector(".fiveetools-random__add")?.remove();
				if (!on) continue;
				const row = result.rows.find(item => item.face === face);
				if (row?.combatants?.length) {
					const add = el.createEl("button", {
						text: "Add to encounter",
						cls: "fiveetools-btn fiveetools-random__add",
						attr: {type: "button"},
					});
					add.addEventListener("click", () => { void addEncounter(plugin, row.combatants, onOpenEncounter); });
				}
				el.scrollIntoView({block: "nearest"});
			}
		};
		let rollToken = 0;
		roller.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			const rolled = rollPacked({toRoll: "1d10", name: "Random"}, evt);
			if (rolled.total == null) {
				new Notice("Could not roll.");
				return;
			}
			const token = ++rollToken;
			void presentRoll(plugin, rolled).then(() => {
				if (token !== rollToken) return;
				mark(rolled.total);
			});
		});
	}

	paintFields();
	emit();
	paintResult();
}

function fieldsFor (type, species, classes, current) {
	if (type === "encounter") {
		return [
			{id: "partyCount", label: "Number of PCs", options: PARTY},
			{id: "level", label: "PC level", options: LEVELS},
			{id: "difficulty", label: "Difficulty", options: [["any", "Any"], ["low", "Low"], ["moderate", "Moderate"], ["high", "High"]]},
			{id: "environment", label: "Environment", options: randomHabitats().map(it => [it.id, it.label])},
			{id: "loot", label: "Treasure", options: [["", "No treasure"], ["Individual Treasure", "Individual Treasure"], ["Treasure Hoard", "Treasure Hoard"]]},
		];
	}
	if (type === "trap") {
		return [
			{id: "level", label: "Level", options: LEVELS},
			{id: "danger", label: "Danger", options: [["", "Any"], ["nuisance", "Nuisance"], ["deadly", "Deadly"]]},
		];
	}
	if (type === "treasure") {
		const fields = [
			{id: "cr", label: "Challenge rating", options: CRS},
			{id: "lootType", label: "Type", options: [
				["Individual Treasure", "Individual Treasure"],
				["Individual Treasure with Items", "Individual Treasure with Items"],
				["Treasure Hoard", "Treasure Hoard"],
				["Treasure Hoard with Salvage", "Treasure Hoard with Salvage"],
			]},
		];
		const lootType = current?.lootType || "Individual Treasure";
		if (/hoard|with items|salvage/i.test(lootType)) fields.push(...magicFields(current));
		return fields;
	}
	if (type === "npc") {
		return [
			{id: "gender", label: "Gender", options: [["", "Any"], ["Female", "Female"], ["Male", "Male"]]},
			{id: "species", label: "Species", options: [["", "Any"], ...species]},
			{id: "classId", label: "Class", options: [["", "Any"], ...classes]},
		];
	}
	if (type === "art_object") {
		return [
			{id: "quality", label: "Value", options: [["", "Any"], ["Crafted", "25 gp"], ["Fancy", "250 gp"], ["Exceptional", "750 gp"], ["Fine", "2,500 gp"], ["Superior", "7,500 gp"]]},
			{id: "material", label: "Material", options: [["", "Any"], ["Bone", "Bone/Ivory"], ["Ceramic", "Ceramic"], ["Cloth", "Cloth"], ["Jewelry", "Jewelry"], ["Leather", "Leather"], ["Metal", "Metal"], ["Stone", "Stone"], ["Wood", "Wood"]]},
		];
	}
	if (type === "magic_item") return magicFields(current);
	if (type === "spellbook") {
		return [
			{id: "level", label: "Level", options: LEVELS},
			{id: "spec", label: "Specialization", options: [
				["", "Generalist"],
				["Abjuration", "Abjurer"],
				["Conjuration", "Conjurer"],
				["Divination", "Diviner"],
				["Enchantment", "Enchanter"],
				["Evocation", "Evoker"],
				["Illusion", "Illusionist"],
				["Necromancy", "Necromancer"],
				["Transmutation", "Transmuter"],
			]},
		];
	}
	if (type === "wild_surge") {
		return [{id: "level", label: "Trigger", options: Array.from({length: 9}, (_, i) => [String(i + 1), `${ordinal(i + 1)} level`])}];
	}
	return [];
}

function magicFields (current) {
	const fields = [
		{id: "rarity", label: "Rarity", options: [["", "By level"], ["Common", "Common"], ["Uncommon", "Uncommon"], ["Rare", "Rare"], ["Very Rare", "Very Rare"], ["Legendary", "Legendary"]]},
	];
	if (!current?.rarity) fields.push({id: "level", label: "Level", options: LEVELS});
	fields.push({id: "theme", label: "Theme", options: [["", "Any"], ["Arcana", "Arcana"], ["Armaments", "Armaments"], ["Implements", "Implements"], ["Relics", "Relics"]]});
	return fields;
}

function paintLine (parent, line, plugin) {
	const row = parent.createDiv({cls: "fiveetools-roll-result"});
	const body = row.createDiv({cls: "fiveetools-roll-result__body"});
	const host = body.createDiv({cls: "fiveetools-roll-result__title"});
	const parts = line.parts || [line];
	for (const part of parts) paintPart(host, part, plugin);
	if (plugin) bindDiceRollers(host, plugin);
}

function paintPart (parent, line, plugin) {
	const open = (doc) => {
		if (!doc) {
			new Notice(`Could not open: ${line.text}`);
			return;
		}
		void plugin?.openPreview?.(doc);
	};
	const resolve = () => line.doc || (line.item ? resolveCardItem(line.item) : null);
	if (line.doc || line.item) {
		const button = parent.createEl("button", {
			cls: "fiveetools-roll-result__title fiveetools-roll-result__title--link",
			text: line.text,
			attr: {type: "button"},
		});
		button.addEventListener("click", (evt) => {
			evt.preventDefault();
			open(resolve());
		});
		if (plugin) attachHoverCard(button, plugin, resolve);
		return;
	}
	appendTextWithDiceRollers(parent, line.text || "—");
}

async function addEncounter (plugin, combatants, onOpenEncounter) {
	const session = plugin._encounterSession || {combatants: [], selectedId: null};
	let next = {...session, combatants: [...(session.combatants || [])]};
	try {
		for (const group of groupsFrom(combatants)) {
			if (!group.doc) continue;
			let left = group.count;
			while (left > 0) {
				const step = Math.min(10, left);
				const added = await addCombatants(next, group.doc, step);
				next = {...next, combatants: added.combatants, selectedId: added.selectedId};
				left -= step;
			}
		}
	} catch (e) {
		new Notice(e.message || "Could not add the encounter.");
		return;
	}
	plugin._encounterSession = next;
	onOpenEncounter?.();
}

function groupsFrom (combatants) {
	const groups = [];
	for (const combatant of combatants || []) {
		const key = combatant.doc?.u || combatant.label;
		const found = groups.find(group => group.key === key);
		if (found) found.count += 1;
		else groups.push({key, doc: combatant.doc, count: 1});
	}
	return groups;
}

function labeledSelect (parent, label, value, options) {
	const wrap = parent.createDiv({cls: "fiveetools-size__field"});
	wrap.createEl("label", {text: label});
	const select = wrap.createEl("select");
	for (const [id, text] of options) {
		select.createEl("option", {text, attr: {value: id}});
	}
	select.value = String(value);
	return select;
}

function knownType (type) {
	return TYPES.some(group => group.items.some(([id]) => id === type));
}

function ordinal (n) {
	const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
	return `${n}${suffix}`;
}
