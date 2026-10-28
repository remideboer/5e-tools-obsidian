import {Modal, Notice} from "obsidian";
import {
	buildEntity,
	cacheBrewInDataLoader,
	cacheEntityInDataLoader,
	deleteEntity,
	emptyForm,
	entityToForm,
	getBrewEntity,
	homebrewType,
	HOMEBREW_TYPES,
	listBrewEntities,
	normalizeMonsterForm,
	saveHomebrewImage,
	saveHomebrewToVault,
	upsertEntity,
} from "./homebrew-store.js";
import {loadEntity} from "./entity-loader.js";
import {brewDocFromEntity, indexHomebrewDocs, searchEntities} from "./search-index.js";
import {renderCreatureForm} from "./creature-form.js";

export function renderHomebrewEditor (formEl, resultEl, {
	session,
	plugin,
	app,
	onOpenDoc,
	onSessionChange,
} = {}) {
	formEl.empty();
	formEl.addClass("fiveetools-homebrew");

	let typeId = session?.typeId || "spell";
	let selectedName = session?.selectedName || "";
	let draft = session?.draft && session.typeId === typeId
		? {...session.draft}
		: emptyForm(typeId);
	if (typeId === "monster") draft = normalizeMonsterForm(draft);
	if (typeId === "background" && draft.abilities && !draft.ability1) {
		const parts = String(draft.abilities).split(",").map(it => it.trim().toLowerCase()).filter(Boolean);
		draft.ability1 = parts[0] || "str";
		draft.ability2 = parts[1] || "dex";
		draft.ability3 = parts[2] || "con";
	}
	let previousName = session?.previousName || "";
	let previewKey = "";

	const catalogEl = formEl.createDiv({cls: "fiveetools-homebrew__catalog"});
	catalogEl.createEl("h3", {text: "Homebrew"});
	catalogEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Search the library and Use an entry as a starter, or create one from scratch. Saved entries appear with source HB.",
	});
	const tabs = catalogEl.createDiv({cls: "fiveetools-homebrew__tabs"});
	const searchEl = catalogEl.createEl("input", {
		cls: "fiveetools-homebrew__search",
		attr: {type: "search", placeholder: "Search library…"},
	});
	const hitsEl = catalogEl.createDiv({cls: "fiveetools-homebrew__results"});
	const listEl = catalogEl.createDiv({cls: "fiveetools-homebrew__list"});
	const actions = catalogEl.createDiv({cls: "fiveetools-homebrew__row"});
	const newBtn = actions.createEl("button", {text: "New", cls: "fiveetools-btn"});
	const editBtn = actions.createEl("button", {text: "Edit", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const deleteBtn = actions.createEl("button", {text: "Delete", cls: "fiveetools-btn fiveetools-btn--ghost"});

	const creatorEl = formEl.createDiv({cls: "fiveetools-homebrew__creator"});
	const formWrap = creatorEl.createDiv({cls: "fiveetools-homebrew__form"});
	const saveRow = creatorEl.createDiv({cls: "fiveetools-homebrew__row"});
	const previewBtn = saveRow.createEl("button", {text: "Preview", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const saveBtn = saveRow.createEl("button", {text: "Save", cls: "fiveetools-btn"});

	const emit = () => {
		onSessionChange?.({
			typeId,
			selectedName,
			draft: {...draft},
			previousName,
		});
	};

	const showPlaceholder = () => {
		resultEl.empty();
		resultEl.createEl("p", {
			cls: "fiveetools-view__meta",
			text: "Search for an entry to preview and Use as a starter, or fill the form to see a live statblock.",
		});
	};

	let previewTimer = null;
	const cancelPreview = () => {
		if (previewTimer) {
			clearTimeout(previewTimer);
			previewTimer = null;
		}
	};
	const previewEntity = (ent) => {
		if (!ent?.name) {
			showPlaceholder();
			return;
		}
		const type = homebrewType(typeId);
		cacheEntityInDataLoader(ent, type.prop);
		onOpenDoc?.(brewDocFromEntity(ent, type));
	};
	const previewDraft = () => {
		previewEntity(buildEntity(typeId, draft));
	};
	const schedulePreview = () => {
		cancelPreview();
		previewTimer = setTimeout(previewDraft, 200);
	};

	const renderTabs = () => {
		tabs.empty();
		for (const type of HOMEBREW_TYPES) {
			const btn = tabs.createEl("button", {
				cls: `fiveetools-homebrew__tab${type.id === typeId ? " is-active" : ""}`,
				text: type.label,
			});
			btn.addEventListener("click", () => {
				typeId = type.id;
				selectedName = "";
				previousName = "";
				previewKey = "";
				searchEl.value = "";
				draft = emptyForm(typeId);
				cancelPreview();
				searchEl.setAttr("placeholder", `Start from ${type.label.toLowerCase()}…`);
				renderTabs();
				paintHits();
				renderList();
				renderForm();
				showPlaceholder();
				emit();
			});
		}
	};

	const syncListSelection = () => {
		editBtn.toggleAttribute("disabled", !selectedName);
		deleteBtn.toggleAttribute("disabled", !selectedName);
		listEl.querySelectorAll(".fiveetools-homebrew__hit").forEach((el) => {
			el.classList.toggle("is-selected", el.dataset.name === selectedName);
		});
	};

	const renderList = () => {
		const scrollTop = listEl.scrollTop || 0;
		listEl.empty();
		const ents = listBrewEntities(typeId);
		if (!ents.length) {
			listEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No saved entries."});
			syncListSelection();
			return;
		}
		for (const ent of ents) {
			const row = listEl.createEl("button", {
				cls: `fiveetools-homebrew__hit${ent.name === selectedName ? " is-selected" : ""}`,
				attr: {"data-name": ent.name},
			});
			row.createEl("div", {cls: "fiveetools-modal__name", text: ent.name});
			row.addEventListener("click", () => {
				selectedName = ent.name;
				previousName = ent.name;
				previewKey = "";
				draft = entityToForm(typeId, ent);
				paintHits();
				syncListSelection();
				renderForm();
				previewEntity(ent);
				emit();
			});
		}
		listEl.scrollTop = scrollTop;
		syncListSelection();
	};

	const bindText = (el, key) => {
		el.addEventListener("input", () => {
			draft[key] = el.type === "checkbox" ? el.checked : el.value;
			emit();
			schedulePreview();
		});
	};

	const addImageField = (parent) => {
		const row = parent.createDiv({cls: "fiveetools-homebrew__image"});
		row.createEl("div", {cls: "fiveetools-homebrew__label", text: "Image"});
		const path = String(draft.image || "").trim();
		if (path) {
			let src = path;
			try { src = plugin.app.vault.adapter.getResourcePath(path) || path; } catch (_) { /* keep the stored path */ }
			row.createEl("img", {cls: "fiveetools-homebrew__thumb", attr: {src, alt: ""}});
		}
		const controls = row.createDiv({cls: "fiveetools-homebrew__row"});
		const pick = controls.createEl("button", {text: path ? "Replace image" : "Add image", cls: "fiveetools-btn", attr: {type: "button"}});
		const file = row.createEl("input", {attr: {type: "file", accept: "image/*"}});
		file.style.display = "none";
		pick.addEventListener("click", () => file.click());
		file.addEventListener("change", async () => {
			const chosen = file.files?.[0];
			if (!chosen) return;
			try {
				draft.image = await saveHomebrewImage(plugin, chosen);
				emit();
				renderForm();
				schedulePreview();
			} catch (err) {
				new Notice(err?.message || "Could not save that image.");
			}
		});
		if (path) {
			const clear = controls.createEl("button", {text: "Remove image", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button"}});
			clear.addEventListener("click", () => {
				draft.image = "";
				emit();
				renderForm();
				schedulePreview();
			});
		}
	};

	const renderForm = () => {
		formWrap.empty();
		addImageField(formWrap);
		if (homebrewType(typeId).id === "monster") {
			renderCreatureForm(formWrap, draft, {
				onChange: () => {
					emit();
					schedulePreview();
				},
			});
			return;
		}
		const fields = formFields(typeId, draft);
		for (const field of fields) {
			if (field.kind === "grid") {
				const grid = formWrap.createDiv({cls: field.cols === 3 ? "fiveetools-homebrew__grid fiveetools-homebrew__grid--3" : "fiveetools-homebrew__grid"});
				for (const child of field.fields) addField(grid, child, draft, bindText);
				continue;
			}
			if (field.kind === "checks") {
				const wrap = formWrap.createDiv({cls: "fiveetools-homebrew__checks"});
				for (const child of field.fields) addCheck(wrap, child, draft, bindText);
				continue;
			}
			addField(formWrap, field, draft, bindText);
		}
	};

	const paintHits = () => {
		hitsEl.empty();
		const term = String(searchEl.value || "").trim();
		if (term.length < 2) return;
		const docs = searchEntities(term, {categoriesExact: [searchCategory(typeId)], limit: 8});
		if (!docs.length) {
			hitsEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No matching entries."});
			return;
		}
		for (const doc of docs) {
			const row = hitsEl.createDiv({
				cls: `fiveetools-homebrew__result${previewKey === docKey(doc) ? " is-selected" : ""}`,
			});
			const meta = row.createDiv({cls: "fiveetools-homebrew__resultmeta"});
			meta.createEl("div", {cls: "fiveetools-modal__name", text: doc.n});
			meta.createEl("div", {
				cls: "fiveetools-modal__sub",
				text: [doc.sA || doc.s, doc.cf].filter(Boolean).join(" · "),
			});
			row.addEventListener("click", (evt) => {
				if (evt.target.closest("button")) return;
				previewKey = docKey(doc);
				paintHits();
				onOpenDoc?.(doc);
			});
			const useBtn = row.createEl("button", {text: "Use", cls: "fiveetools-btn"});
			useBtn.addEventListener("click", async (evt) => {
				evt.stopPropagation();
				useBtn.setAttr("disabled", "true");
				try {
					const loaded = await loadEntity(doc);
					if (!loaded.ent) throw new Error(`No JSON found for ${doc.n || "entry"}.`);
					draft = entityToForm(typeId, loaded.ent);
					selectedName = "";
					previousName = "";
					previewKey = docKey(doc);
					paintHits();
					renderList();
					renderForm();
					previewEntity(buildEntity(typeId, draft));
					emit();
				} catch (e) {
					resultEl.empty();
					resultEl.createEl("p", {text: e.message || "Could not use this entry."});
				} finally {
					useBtn.removeAttribute("disabled");
				}
			});
		}
	};

	searchEl.addEventListener("input", () => paintHits());

	newBtn.addEventListener("click", () => {
		selectedName = "";
		previousName = "";
		previewKey = "";
		draft = emptyForm(typeId);
		cancelPreview();
		paintHits();
		renderList();
		renderForm();
		showPlaceholder();
		emit();
	});

	editBtn.addEventListener("click", () => {
		const ent = getBrewEntity(typeId, selectedName);
		if (!ent) return;
		previousName = ent.name;
		draft = entityToForm(typeId, ent);
		renderForm();
		previewEntity(ent);
		emit();
	});

	deleteBtn.addEventListener("click", () => {
		const name = selectedName;
		if (!name) return;
		confirmDelete(app, name, async () => {
			deleteEntity(homebrewType(typeId).prop, name);
			await saveHomebrewToVault(plugin);
			cacheBrewInDataLoader();
			indexHomebrewDocs();
			selectedName = "";
			previousName = "";
			draft = emptyForm(typeId);
			cancelPreview();
			renderList();
			renderForm();
			showPlaceholder();
			emit();
		});
	});

	previewBtn.addEventListener("click", () => {
		cancelPreview();
		const ent = buildEntity(typeId, draft);
		if (!ent.name) {
			new Notice("Name is required.");
			previewEntity(ent);
			return;
		}
		previewDraft();
	});

	saveBtn.addEventListener("click", async () => {
		const ent = buildEntity(typeId, draft);
		if (!ent.name) {
			new Notice("Name is required.");
			return;
		}
		upsertEntity(homebrewType(typeId).prop, ent, {previousName: previousName || selectedName});
		await saveHomebrewToVault(plugin);
		cacheBrewInDataLoader();
		indexHomebrewDocs();
		selectedName = ent.name;
		previousName = ent.name;
		renderList();
		previewEntity(ent);
		emit();
		new Notice(`Saved ${ent.name} (HB).`);
	});

	searchEl.setAttr("placeholder", `Start from ${homebrewType(typeId).label.toLowerCase()}…`);
	renderTabs();
	paintHits();
	renderList();
	renderForm();
	if (selectedName) {
		const ent = getBrewEntity(typeId, selectedName);
		if (ent) previewEntity(ent);
		else showPlaceholder();
	} else {
		showPlaceholder();
	}
}

function formFields (typeId, draft) {
	switch (homebrewType(typeId).id) {
		case "item": return itemFields(draft);
		case "background": return backgroundFields();
		case "race": return raceFields();
		default: return spellFields();
	}
}

function spellFields () {
	return [
		{key: "name", label: "Name"},
		{kind: "grid", fields: [
			{key: "level", label: "Level", input: "select", options: LEVELS},
			{key: "school", label: "School", input: "select", options: SCHOOLS},
		]},
		{kind: "grid", fields: [
			{key: "timeNumber", label: "Casting number", input: "number"},
			{key: "timeUnit", label: "Casting unit", input: "select", options: TIME_UNITS},
		]},
		{key: "range", label: "Range", input: "select", options: RANGES},
		{kind: "checks", fields: [
			{key: "verbal", label: "V"},
			{key: "somatic", label: "S"},
			{key: "material", label: "M"},
			{key: "concentration", label: "Concentration"},
			{key: "ritual", label: "Ritual"},
		]},
		{key: "materialText", label: "Material"},
		{key: "duration", label: "Duration", input: "select", options: DURATIONS},
		{key: "classes", label: "Classes"},
		{key: "entries", label: "Description", input: "textarea"},
		{key: "higher", label: "Higher level", input: "textarea"},
	];
}

function itemFields (draft) {
	return [
		{kind: "grid", fields: [
			{key: "kind", label: "Kind", input: "select", options: ITEM_KINDS},
			{key: "name", label: "Name"},
		]},
		{kind: "grid", fields: [
			{key: "type", label: "Type", input: "select", options: ITEM_TYPES},
			{key: "rarity", label: "Rarity", input: "select", options: draft.kind === "gear" ? GEAR_RARITIES : MAGIC_RARITIES},
		]},
		{kind: "checks", fields: [{key: "attunement", label: "Requires attunement"}]},
		{kind: "grid", fields: [
			{key: "value", label: "Value (gp)"},
			{key: "weight", label: "Weight (lb)"},
		]},
		{kind: "grid", fields: [
			{key: "damage", label: "Damage"},
			{key: "damageType", label: "Damage type", input: "select", options: DAMAGE_TYPES},
		]},
		{key: "armorClass", label: "Armor class"},
		{key: "entries", label: "Description", input: "textarea"},
	];
}

function backgroundFields () {
	return [
		{key: "name", label: "Name"},
		{kind: "grid", cols: 3, fields: [
			{key: "ability1", label: "Ability 1", input: "select", options: ABILITIES},
			{key: "ability2", label: "Ability 2", input: "select", options: ABILITIES},
			{key: "ability3", label: "Ability 3", input: "select", options: ABILITIES},
		]},
		{key: "feat", label: "Origin feat"},
		{key: "skills", label: "Skills"},
		{key: "tool", label: "Tool"},
		{key: "equipment", label: "Equipment", input: "textarea"},
	];
}

function raceFields () {
	return [
		{key: "name", label: "Name"},
		{kind: "grid", fields: [
			{key: "creatureType", label: "Creature type", input: "select", options: CREATURE_TYPES},
			{key: "size", label: "Size", input: "select", options: SIZES},
		]},
		{kind: "grid", fields: [
			{key: "speed", label: "Speed"},
			{key: "darkvision", label: "Darkvision", input: "select", options: DARKVISION},
		]},
		{key: "traits", label: "Traits (Name. Text)", input: "textarea"},
	];
}

function addField (parent, field, draft, bindText) {
	const wrap = parent.createDiv({cls: "fiveetools-homebrew__field"});
	wrap.createEl("label", {text: field.label});
	let el;
	if (field.input === "textarea") {
		el = wrap.createEl("textarea", {attr: {rows: "4"}});
		el.value = draft[field.key] ?? "";
	} else if (field.input === "select") {
		el = wrap.createEl("select");
		const current = draft[field.key] ?? "";
		const opts = [...(field.options || [])];
		if (current !== "" && !opts.some(opt => opt.id === current)) opts.push({id: current, label: current});
		for (const opt of opts) {
			el.createEl("option", {attr: {value: opt.id}, text: opt.label});
		}
		el.value = current || opts[0]?.id || "";
		draft[field.key] = el.value;
	} else {
		el = wrap.createEl("input", {
			attr: {
				type: field.input || "text",
				value: draft[field.key] ?? "",
			},
		});
	}
	bindText(el, field.key);
}

function addCheck (parent, field, draft, bindText) {
	const wrap = parent.createEl("label", {cls: "fiveetools-homebrew__check"});
	const el = wrap.createEl("input", {attr: {type: "checkbox"}});
	el.checked = !!draft[field.key];
	wrap.createSpan({text: field.label});
	bindText(el, field.key);
}

class ConfirmDeleteModal extends Modal {
	constructor (app, label, onConfirm) {
		super(app);
		this.label = label;
		this.onConfirm = onConfirm;
	}

	onOpen () {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl("h2", {text: "Delete homebrew"});
		contentEl.createEl("p", {text: `Delete ${this.label}? This cannot be undone.`});
		const actions = contentEl.createDiv({cls: "fiveetools-homebrew__row"});
		const cancel = actions.createEl("button", {text: "Cancel", cls: "fiveetools-btn fiveetools-btn--ghost"});
		const ok = actions.createEl("button", {text: "Delete", cls: "fiveetools-btn"});
		cancel.addEventListener("click", () => this.close());
		ok.addEventListener("click", () => {
			this.close();
			this.onConfirm?.();
		});
	}

	onClose () {
		this.contentEl.empty();
	}
}

function searchCategory (typeId) {
	switch (homebrewType(typeId).id) {
		case "monster": return "bestiary";
		case "race": return "species";
		default: return homebrewType(typeId).id;
	}
}

function docKey (doc) {
	return `${doc?.u || ""}|${doc?.s || ""}`;
}

function confirmDelete (app, label, onConfirm) {
	if (!app) {
		if (typeof window !== "undefined" && window.confirm(`Delete ${label}?`)) onConfirm?.();
		return;
	}
	new ConfirmDeleteModal(app, label, onConfirm).open();
}

const LEVELS = [
	{id: "0", label: "Cantrip"},
	{id: "1", label: "1st"},
	{id: "2", label: "2nd"},
	{id: "3", label: "3rd"},
	{id: "4", label: "4th"},
	{id: "5", label: "5th"},
	{id: "6", label: "6th"},
	{id: "7", label: "7th"},
	{id: "8", label: "8th"},
	{id: "9", label: "9th"},
];

const SCHOOLS = [
	{id: "A", label: "Abjuration"},
	{id: "C", label: "Conjuration"},
	{id: "D", label: "Divination"},
	{id: "E", label: "Enchantment"},
	{id: "V", label: "Evocation"},
	{id: "I", label: "Illusion"},
	{id: "N", label: "Necromancy"},
	{id: "T", label: "Transmutation"},
];

const TIME_UNITS = [
	{id: "action", label: "Action"},
	{id: "bonus", label: "Bonus action"},
	{id: "reaction", label: "Reaction"},
	{id: "minute", label: "Minute"},
	{id: "hour", label: "Hour"},
];

const ITEM_KINDS = [
	{id: "gear", label: "Gear"},
	{id: "magic", label: "Magic item"},
];

const ITEM_TYPES = [
	{id: "G", label: "Adventuring gear"},
	{id: "M", label: "Melee weapon"},
	{id: "R", label: "Ranged weapon"},
	{id: "LA", label: "Light armor"},
	{id: "MA", label: "Medium armor"},
	{id: "HA", label: "Heavy armor"},
	{id: "S", label: "Shield"},
	{id: "P", label: "Potion"},
	{id: "RG", label: "Ring"},
	{id: "ST", label: "Staff"},
	{id: "WD", label: "Wand"},
	{id: "SC", label: "Scroll"},
	{id: "W", label: "Wondrous item"},
];

const MAGIC_RARITIES = [
	{id: "common", label: "Common"},
	{id: "uncommon", label: "Uncommon"},
	{id: "rare", label: "Rare"},
	{id: "very rare", label: "Very rare"},
	{id: "legendary", label: "Legendary"},
	{id: "artifact", label: "Artifact"},
];

const GEAR_RARITIES = [{id: "none", label: "None"}];

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

const DAMAGE_TYPES = [
	{id: "", label: "—"},
	{id: "B", label: "Bludgeoning"},
	{id: "P", label: "Piercing"},
	{id: "S", label: "Slashing"},
	{id: "A", label: "Acid"},
	{id: "C", label: "Cold"},
	{id: "F", label: "Fire"},
	{id: "O", label: "Force"},
	{id: "L", label: "Lightning"},
	{id: "N", label: "Necrotic"},
	{id: "I", label: "Poison"},
	{id: "Y", label: "Psychic"},
	{id: "R", label: "Radiant"},
	{id: "T", label: "Thunder"},
];

const DARKVISION = [
	{id: "0", label: "None"},
	{id: "30", label: "30 ft."},
	{id: "60", label: "60 ft."},
	{id: "90", label: "90 ft."},
	{id: "120", label: "120 ft."},
];

const RANGES = [
	{id: "self", label: "Self"},
	{id: "touch", label: "Touch"},
	{id: "5 feet", label: "5 feet"},
	{id: "10 feet", label: "10 feet"},
	{id: "30 feet", label: "30 feet"},
	{id: "60 feet", label: "60 feet"},
	{id: "90 feet", label: "90 feet"},
	{id: "120 feet", label: "120 feet"},
	{id: "150 feet", label: "150 feet"},
	{id: "300 feet", label: "300 feet"},
	{id: "1 mile", label: "1 mile"},
];

const DURATIONS = [
	{id: "instant", label: "Instantaneous"},
	{id: "1 round", label: "1 round"},
	{id: "1 minute", label: "1 minute"},
	{id: "10 minutes", label: "10 minutes"},
	{id: "1 hour", label: "1 hour"},
	{id: "8 hours", label: "8 hours"},
	{id: "24 hours", label: "24 hours"},
];

const ABILITIES = [
	{id: "str", label: "Strength"},
	{id: "dex", label: "Dexterity"},
	{id: "con", label: "Constitution"},
	{id: "int", label: "Intelligence"},
	{id: "wis", label: "Wisdom"},
	{id: "cha", label: "Charisma"},
];
