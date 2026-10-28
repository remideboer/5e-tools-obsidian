import {MarkdownRenderer, Notice} from "obsidian";
import {characterName, coinBag, deleteCharacter, fillGearAttunable, gearFromRefs, listCharacters, readCharacter, REF_CATEGORIES, saveCharacter, saveCharacterPlay, saveCharacterSlots} from "./character-store.js";
import {CONDITIONS} from "./creature-form.js";
import {importDdbCharacter} from "./ddb-import.js";
import {cardFromPdf} from "./pdf-character.js";
import {appendTextWithDiceRollers, bindDiceRollers} from "./dice-roll.js";
import {loadEntity} from "./entity-loader.js";
import {ensureSearchIndex, findEditionDoc, findEntityDoc, findNamedFeature, indexHomebrewDocs, searchEntities, sourceAbbr} from "./search-index.js";
import {paintPackedLibraryRow} from "./library-row.js";
import {getSpellMeta} from "./spell-meta.js";

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

export async function renderCharacterCard (host, plugin, ddbId) {
	host.empty();
	host.addClass("fiveetools-character-card");
	const record = await readCharacter(plugin, ddbId);
	if (!record) {
		host.createEl("p", {cls: "fiveetools-view__meta", text: "Character not found."});
		return null;
	}
	const refs = record.snapshot?.refs;
	if (!Array.isArray(refs)) {
		const body = host.createDiv({cls: "fiveetools-character-card__body"});
		const markdown = String(record.body || "").trim() || `# ${characterName(record)}`;
		await MarkdownRenderer.render(plugin.app, markdown, body, record.path, plugin);
		return record;
	}
	await ensureSearchIndex(plugin);
	paintLinkedCard(host, plugin, record);
	return record;
}

function paintLinkedCard (host, plugin, record) {
	const fields = record.fields || {};
	const snapshot = record.snapshot || {};
	const refs = snapshot.refs || [];
	const edition = snapshot.edition === "one" ? "one" : "classic";
	const sheet = host.createDiv({cls: "fiveetools-character-card__sheet"});
	paintSheetHeader(sheet, plugin, record, refs, edition);
	const columns = sheet.createDiv({cls: "fiveetools-character-card__columns"});
	paintCombatColumn(makeColumn(columns, "Combat"), plugin, record);
	paintAbilityColumn(makeColumn(columns, "Abilities"), snapshot);
	paintSpellColumn(makeColumn(columns, "Spells"), plugin, record, edition);
	if (snapshot.actions?.length) {
		paintActions(makeColumn(columns, "Actions"), plugin, snapshot.actions, {
			edition,
			prefer: preferNames(refs),
		});
	}
	paintGearColumn(makeColumn(columns, "Gear"), plugin, record);
	if (hasFeatures(snapshot, refs)) paintFeatureColumn(makeColumn(columns, "Features"), plugin, record, edition);
	paintStory(columns, snapshot.story, snapshot.traits);
	bindDiceRollers(host, plugin);
}

function makeColumn (parent, title) {
	const col = parent.createDiv({cls: "fiveetools-character-card__col"});
	col.createEl("h3", {cls: "fiveetools-character-card__col-title", text: title});
	return col;
}

function paintSheetHeader (sheet, plugin, record, refs, edition) {
	const fields = record.fields || {};
	const header = sheet.createDiv({cls: "fiveetools-character-card__header"});
	const src = avatarSrc(plugin, record.body);
	if (src) header.createEl("img", {attr: {src, alt: characterName(record)}});
	const text = header.createDiv({cls: "fiveetools-character-card__header-text"});
	text.createEl("h2", {text: characterName(record)});
	const identity = text.createDiv({cls: "fiveetools-character-card__identity"});
	const identityRefs = ["species", "class", "subclass"].flatMap(kind => refs.filter(ref => ref.kind === kind));
	paintRefRow(identity, plugin, identityRefs, refs, edition);
	const level = fields.level != null && fields.level !== "" ? `Level ${fields.level}` : "";
	if (level) identity.createSpan({cls: "fiveetools-view__meta", text: identity.childNodes.length ? ` · ${level}` : level});
	const background = refs.find(ref => ref.kind === "background");
	if (background) {
		const line = text.createDiv({cls: "fiveetools-character-card__identity"});
		line.createSpan({text: "Background: "});
		paintRefRow(line, plugin, [background], refs, edition);
	}
}

function paintCombatColumn (col, plugin, record) {
	const fields = record.fields || {};
	const snapshot = record.snapshot || {};
	const vitals = col.createDiv({cls: "fiveetools-character-card__vitals"});
	paintCombatStats(vitals, fields, snapshot.rolls, snapshot.speeds);
	const hp = vitals.createDiv({cls: "fiveetools-character-card__vital fiveetools-character-card__vital--hp"});
	hp.createSpan({cls: "fiveetools-character-card__vital-label", text: "HP"});
	paintHpEditor(hp, plugin, record);
	paintLabeledList(col, "Senses", snapshot.senses);
	paintLabeledList(col, "Defenses", snapshot.defenses);
	paintConditions(col, plugin, record);
	paintDeathSaves(col, plugin, record);
	paintInspiration(col, plugin, record);
	paintXp(col, plugin, record);
}

function paintAbilityColumn (col, snapshot) {
	paintAbilities(col, snapshot.abilities, snapshot.rolls);
	if (snapshot.rolls?.skills?.length) paintSkills(col, snapshot.rolls);
	paintLabeledList(col, "Proficiencies", snapshot.proficiencies);
}

function paintSpellColumn (col, plugin, record, edition) {
	const spells = (record.snapshot?.refs || []).filter(ref => ref.kind === "spell");
	paintSlots(col, plugin, record);
	paintSpellcasting(col, record.snapshot?.spellcasting);
	if (!spells.length) return;
	const play = playState(record);
	const preparedBox = col.createDiv();
	const preparedTitle = preparedBox.createEl("h3", {text: "Prepared"});
	const preparedList = preparedBox.createDiv({cls: "fiveetools-character-card__rows"});
	const restBox = col.createDiv();
	const levelLists = new Map();
	const levels = [...new Set(spells.map(spell => spellLevel(spell, edition)))].sort((a, b) => a - b);
	for (const level of levels) {
		const frame = restBox.createDiv({cls: "fiveetools-character-card__spell-level"});
		frame.createDiv({cls: "fiveetools-character-card__spell-level-label", text: spellLevelLabel(level)});
		const list = frame.createDiv({cls: "fiveetools-character-card__rows"});
		levelLists.set(level, {frame, list});
	}
	const syncGroups = () => {
		preparedTitle.style.display = preparedList.childElementCount ? "" : "none";
		preparedBox.style.display = preparedList.childElementCount ? "" : "none";
		for (const {frame, list} of levelLists.values()) frame.style.display = list.childElementCount ? "" : "none";
	};
	const place = (spell, row) => {
		if (spellIsPrepared(spell, play)) preparedList.append(row);
		else levelLists.get(spellLevel(spell, edition)).list.append(row);
		syncGroups();
	};
	const ordered = spells.slice().sort((a, b) => spellLevel(a, edition) - spellLevel(b, edition) || String(a.label || a.name).localeCompare(String(b.label || b.name)));
	for (const spell of ordered) {
		const row = paintSpellRow(preparedList, plugin, spell, edition, play);
		const box = row.querySelector("input");
		if (box && !spell.alwaysPrepared) {
			box.addEventListener("change", () => {
				const name = spell.name || spell.label;
				const set = new Set(play.prepared || []);
				if (box.checked) set.add(name);
				else set.delete(name);
				play.prepared = [...set];
				place(spell, row);
				persistPlay(plugin, record);
			});
		}
		place(spell, row);
	}
}

function paintSpellRow (parent, plugin, spell, edition, play) {
	const row = parent.createDiv({cls: "fiveetools-character-card__twoline"});
	const line = row.createDiv({cls: "fiveetools-character-card__twoline-line"});
	const box = line.createEl("input", {
		cls: "fiveetools-character-card__check",
		attr: {type: "checkbox", title: spell.alwaysPrepared ? "Always prepared" : "Prepared"},
	});
	box.checked = spellIsPrepared(spell, play);
	box.disabled = !!spell.alwaysPrepared;
	const linked = linkRef(spell, [], spell.edition || edition);
	paintRefButton(line, plugin, linked, spell.label || spell.name || "Spell");
	const meta = [spell.list, spell.school, spell.concentration ? "concentration" : "", spell.ritual ? "ritual" : ""].filter(Boolean);
	if (meta.length) line.createSpan({cls: "fiveetools-character-card__source", text: ` · ${meta.join(" · ")}`});
	const detail = [spell.castingTime, spell.range, spell.duration, spell.components, spell.attack, spell.save].filter(Boolean);
	if (detail.length) {
		row.createDiv({
			cls: "fiveetools-character-card__twoline-line fiveetools-character-card__source",
			text: detail.join(" · "),
		});
	}
	setRowTip(row, [
		spell.label || spell.name,
		spellTipLevel(spell),
		spell.school,
		spell.list,
		spell.castingTime,
		spell.range,
		spell.duration,
		spell.components,
		spell.concentration ? "concentration" : "",
		spell.ritual ? "ritual" : "",
		spell.attack,
		spell.save,
		spell.snippet,
	]);
	return row;
}

function setRowTip (row, parts) {
	const text = (parts || []).map(part => String(part || "").trim()).filter(Boolean).join(" · ");
	if (text) row.setAttr("title", text);
}

function spellTipLevel (spell) {
	const level = Number(spell?.level);
	if (!Number.isFinite(level)) return "";
	if (level === 0) return "Cantrip";
	return spellLevelLabel(level);
}

const COIN_FIELDS = [["gp", "GP"], ["sp", "SP"], ["cp", "CP"], ["ep", "EP"], ["pp", "PP"]];

function paintGearColumn (col, plugin, record) {
	const play = playState(record);
	if (!play.coins) play.coins = coinBag(record.snapshot?.coins);
	if (!Array.isArray(play.gear)) play.gear = gearFromRefs(record.snapshot?.refs);
	fillGearAttunable(play.gear, record.snapshot?.refs);
	indexHomebrewDocs();
	paintCoinFields(col, plugin, record, play);
	const add = col.createDiv({cls: "fiveetools-character-card__gearadd"});
	const input = add.createEl("input", {
		cls: "fiveetools-character-card__gearadd-input",
		attr: {type: "text", placeholder: "Add item"},
	});
	const plus = add.createEl("button", {
		text: "+",
		cls: "fiveetools-encounter__hpbtn",
		attr: {type: "button", title: "Add item"},
	});
	const hits = col.createDiv({cls: "fiveetools-creatureform__hits"});
	const frame = col.createDiv({cls: "fiveetools-character-card__gearframe is-hidden"});
	frame.createEl("h3", {text: "Attuned"});
	const attuned = frame.createDiv({cls: "fiveetools-character-card__rows"});
	const rest = col.createDiv({cls: "fiveetools-character-card__rows"});
	const buckets = {frame, attuned, rest};
	const place = (row, item) => placeGearRow(buckets, row, item);
	place.sync = () => buckets.frame.classList.toggle("is-hidden", buckets.attuned.childElementCount === 0);
	let hitsDocs = [];
	const addCustom = (label) => {
		const item = {
			id: `custom-${Date.now()}-${play.gear.length}`,
			name: label,
			label,
			edition: record.snapshot?.edition === "one" ? "one" : "classic",
			qty: 1,
			equipped: false,
			attuned: false,
			attunable: false,
		};
		play.gear.push(item);
		input.value = "";
		hits.empty();
		hitsDocs = [];
		place(paintInventoryRow(rest, plugin, record, item, place), item);
		persistPlay(plugin, record);
	};
	const addFromDoc = async (doc) => {
		const label = String(doc?.n || "").trim();
		if (!label) return;
		let attunable = false;
		try {
			const loaded = await loadEntity(doc);
			attunable = !!(loaded?.ent?.reqAttune || loaded?.ent?.reqAttuneAlt);
		} catch (_) { /* unmatched entity stays not attunable */ }
		const item = {
			id: `custom-${Date.now()}-${play.gear.length}`,
			name: label,
			label,
			source: doc.s || "",
			edition: record.snapshot?.edition === "one" ? "one" : "classic",
			qty: 1,
			equipped: false,
			attuned: false,
			attunable,
		};
		play.gear.push(item);
		input.value = "";
		hits.empty();
		hitsDocs = [];
		place(paintInventoryRow(rest, plugin, record, item, place), item);
		persistPlay(plugin, record);
	};
	const addItem = () => {
		const label = String(input.value || "").trim();
		if (!label) return;
		const exact = hitsDocs.filter(doc => String(doc.n || "").trim().toLowerCase() === label.toLowerCase());
		if (exact.length === 1) {
			void addFromDoc(exact[0]);
			return;
		}
		addCustom(label);
	};
	const paintHits = () => {
		hits.empty();
		const term = String(input.value || "").trim();
		hitsDocs = term.length < 2 ? [] : searchEntities(term, {categoriesExact: ["Item"], limit: 8});
		for (const doc of hitsDocs) {
			const row = hits.createDiv({cls: "fiveetools-creatureform__hit"});
			const meta = row.createDiv({cls: "fiveetools-creatureform__hitmeta"});
			meta.createEl("div", {cls: "fiveetools-modal__name", text: doc.n});
			meta.createEl("div", {cls: "fiveetools-modal__sub", text: doc.sA || doc.s || ""});
			row.addEventListener("click", () => { void addFromDoc(doc); });
		}
	};
	plus.addEventListener("click", addItem);
	input.addEventListener("input", paintHits);
	input.addEventListener("keydown", (evt) => {
		if (evt.key !== "Enter") return;
		evt.preventDefault();
		addItem();
	});
	for (const item of sortedGear(play.gear)) place(paintInventoryRow(rest, plugin, record, item, place), item);
}

function paintCoinFields (col, plugin, record, play) {
	const row = col.createDiv({cls: "fiveetools-character-card__coins"});
	for (const [key, label] of COIN_FIELDS) {
		const field = row.createEl("label", {cls: "fiveetools-character-card__coin"});
		field.createSpan({text: label});
		const input = field.createEl("input", {
			cls: "fiveetools-encounter__hpinput",
			attr: {type: "number", min: "0", value: String(play.coins[key] || 0), title: label},
		});
		input.addEventListener("change", () => {
			play.coins[key] = Math.max(0, Math.floor(Number(input.value) || 0));
			input.value = String(play.coins[key]);
			persistPlay(plugin, record);
		});
	}
}

function paintInventoryRow (parent, plugin, record, item, place) {
	const row = parent.createDiv({cls: "fiveetools-character-card__twoline"});
	const line = row.createDiv({cls: "fiveetools-character-card__gearline"});
	const equip = gearFlag(line, "Equip", !!item.equipped);
	const attune = item.attunable ? gearFlag(line, "Attune", !!item.attuned) : null;
	const name = line.createDiv({cls: "fiveetools-character-card__gearname"});
	const linked = linkRef({...item, kind: "item"}, [], item.edition);
	paintRefButton(name, plugin, linked, item.label || item.name || "Item");
	const extra = [];
	if (Number(item.qty) > 1) extra.push(`×${item.qty}`);
	if (item.rarity) extra.push(item.rarity);
	if (extra.length) name.createSpan({cls: "fiveetools-character-card__source", text: ` · ${extra.join(" · ")}`});
	const remove = line.createEl("button", {
		text: "×",
		cls: "fiveetools-encounter__hpbtn",
		attr: {type: "button", title: "Remove item"},
	});
	const detail = [];
	if (Number(item.weight) > 0) detail.push(`${item.weight} lb`);
	if (Number(item.charges) > 0) detail.push(`${item.charges} charges`);
	if (item.snippet) detail.push(item.snippet);
	if (detail.length) {
		row.createDiv({
			cls: "fiveetools-character-card__twoline-line fiveetools-character-card__source",
			text: detail.join(" · "),
		});
	}
	setRowTip(row, [
		item.label || item.name,
		item.rarity,
		Number(item.qty) > 1 ? `×${item.qty}` : "",
		Number(item.weight) > 0 ? `${item.weight} lb` : "",
		Number(item.charges) > 0 ? `${item.charges} charges` : "",
		item.attuned ? "attuned" : (item.attunable ? "attunement" : ""),
		item.snippet,
	]);
	equip.addEventListener("change", () => {
		item.equipped = equip.checked;
		place(row, item);
		persistPlay(plugin, record);
	});
	attune?.addEventListener("change", () => {
		item.attuned = attune.checked;
		place(row, item);
		persistPlay(plugin, record);
	});
	remove.addEventListener("click", () => {
		const play = playState(record);
		play.gear = (play.gear || []).filter(it => it.id !== item.id);
		row.remove();
		place.sync?.();
		persistPlay(plugin, record);
	});
	return row;
}

function gearFlag (parent, label, checked) {
	const field = parent.createEl("label", {cls: "fiveetools-character-card__gearflag", attr: {title: label}});
	const box = field.createEl("input", {attr: {type: "checkbox", title: label}});
	box.checked = checked;
	field.createSpan({text: label});
	return box;
}

function sortedGear (items) {
	return (items || []).slice().sort((a, b) => Number(!!b.equipped) - Number(!!a.equipped) || String(a.label || a.name).localeCompare(String(b.label || b.name)));
}

function placeGearRow (buckets, row, item) {
	const name = String(item.label || item.name || "");
	row.dataset.equipped = item.equipped ? "1" : "0";
	row.dataset.name = name;
	const list = item.attuned && item.attunable ? buckets.attuned : buckets.rest;
	const others = [...list.children].filter(el => el !== row);
	const equipped = others.filter(el => el.dataset.equipped === "1");
	const rest = others.filter(el => el.dataset.equipped !== "1");
	const bucket = item.equipped ? equipped : rest;
	let before = null;
	for (const el of bucket) {
		if (name.localeCompare(el.dataset.name || "") < 0) {
			before = el;
			break;
		}
	}
	if (!before && item.equipped) before = rest[0] || null;
	if (before) list.insertBefore(row, before);
	else list.append(row);
	buckets.frame.classList.toggle("is-hidden", buckets.attuned.childElementCount === 0);
}

function paintGearRow (parent, plugin, ref) {
	const row = parent.createDiv({cls: "fiveetools-character-card__twoline"});
	const line = row.createDiv({cls: "fiveetools-character-card__twoline-line"});
	const linked = linkRef(ref, [], ref.edition);
	paintRefButton(line, plugin, linked, ref.label || ref.name || "Item");
	const extra = [];
	if (ref.equipped) extra.push("equipped");
	if (ref.attuned) extra.push("attuned");
	if (Number(ref.qty) > 1) extra.push(`×${ref.qty}`);
	if (ref.rarity) extra.push(ref.rarity);
	if (extra.length) line.createSpan({cls: "fiveetools-character-card__source", text: ` · ${extra.join(" · ")}`});
	const detail = [];
	if (Number(ref.weight) > 0) detail.push(`${ref.weight} lb`);
	if (Number(ref.charges) > 0) detail.push(`${ref.charges} charges`);
	if (ref.snippet) detail.push(ref.snippet);
	if (detail.length) {
		row.createDiv({
			cls: "fiveetools-character-card__twoline-line fiveetools-character-card__source",
			text: detail.join(" · "),
		});
	}
	setRowTip(row, [
		ref.label || ref.name,
		ref.rarity,
		Number(ref.qty) > 1 ? `×${ref.qty}` : "",
		Number(ref.weight) > 0 ? `${ref.weight} lb` : "",
		Number(ref.charges) > 0 ? `${ref.charges} charges` : "",
		ref.attuned ? "attuned" : (ref.attunable ? "attunement" : ""),
		ref.snippet,
	]);
}

function hasFeatures (snapshot, refs) {
	return !!(snapshot.features?.length || snapshot.choices?.length || snapshot.hitDice?.length || snapshot.companions?.length || refs.some(ref => ref.kind === "feat"));
}

function paintFeatureColumn (col, plugin, record, edition) {
	const snapshot = record.snapshot || {};
	paintHitDice(col, plugin, record);
	const feats = (snapshot.refs || []).filter(ref => ref.kind === "feat");
	if (feats.length) {
		col.createEl("h3", {text: "Feats"});
		const list = col.createDiv({cls: "fiveetools-character-card__rows"});
		for (const feat of feats) paintGearRow(list, plugin, feat);
	}
	if (snapshot.features?.length) {
		col.createEl("h3", {text: "Traits and features"});
		const list = col.createDiv({cls: "fiveetools-character-card__rows"});
		for (const feature of snapshot.features) paintFeatureRow(list, plugin, feature, edition, preferNames(snapshot.refs));
	}
	if (snapshot.choices?.length) paintLabeledList(col, "Choices", snapshot.choices);
	if (snapshot.companions?.length) {
		col.createEl("h3", {text: "Companions"});
		const list = col.createDiv({cls: "fiveetools-character-card__rows"});
		for (const companion of snapshot.companions) {
			const row = list.createDiv({cls: "fiveetools-character-card__twoline"});
			const bits = [companion.name, companion.line].filter(Boolean);
			row.createDiv({cls: "fiveetools-character-card__twoline-line", text: bits.join(" · ")});
			if (companion.snippet) {
				row.createDiv({cls: "fiveetools-character-card__twoline-line fiveetools-character-card__source", text: companion.snippet});
			}
			setRowTip(row, [companion.name, companion.line, companion.snippet]);
		}
	}
}

function paintFeatureRow (parent, plugin, feature, edition, prefer) {
	const row = parent.createDiv({cls: "fiveetools-character-card__twoline"});
	const line = row.createDiv({cls: "fiveetools-character-card__twoline-line"});
	const doc = findNamedFeature(feature.name, {edition, prefer});
	const ref = doc?.n && doc.s
		? {kind: String(doc.cf || "").toLowerCase(), name: doc.n, source: doc.s}
		: {name: feature.name};
	paintRefButton(line, plugin, ref, feature.name);
	if (feature.group) line.createSpan({cls: "fiveetools-character-card__source", text: ` · ${feature.group}`});
	if (feature.snippet) {
		row.createDiv({cls: "fiveetools-character-card__twoline-line fiveetools-character-card__source", text: feature.snippet});
	}
	setRowTip(row, [feature.name, feature.group, feature.snippet]);
}

function paintStory (columns, story, traits) {
	const rows = storyRows(story);
	if (!rows.length && !traits) return;
	const col = makeColumn(columns, "Person and story");
	if (traits) paintTraits(col, traits);
	for (const [label, text] of rows) {
		const block = col.createDiv({cls: "fiveetools-character-card__note"});
		block.createEl("strong", {text: label});
		const body = block.createDiv({cls: "fiveetools-character-card__note-body"});
		for (const part of String(text).trim().split(/\n+/)) {
			const line = part.trim();
			if (line) body.createEl("p", {text: line});
		}
	}
}

function storyRows (story) {
	if (!story) return [];
	return [
		["Gender", story.gender],
		["Faith", story.faith],
		["Age", story.age],
		["Hair", story.hair],
		["Eyes", story.eyes],
		["Skin", story.skin],
		["Height", story.height],
		["Weight", story.weight],
		["Alignment", story.alignment],
		["Lifestyle", story.lifestyle],
		["Appearance", story.appearance],
		["Backstory", story.backstory],
		["Allies", story.allies],
		["Organizations", story.organizations],
		["Enemies", story.enemies],
		["Other notes", story.otherNotes],
		["Personal possessions", story.possessions],
	].filter(([, text]) => String(text || "").trim());
}

function paintHpEditor (host, plugin, record) {
	const play = playState(record);
	const controls = host.createDiv({cls: "fiveetools-character-card__hp"});
	const hp = controls.createDiv({cls: "fiveetools-encounter__hp"});
	const minus = hp.createEl("button", {text: "−", cls: "fiveetools-encounter__hpbtn", attr: {type: "button", title: "−1 HP"}});
	const input = hp.createEl("input", {
		cls: "fiveetools-encounter__hpinput",
		attr: {type: "number", value: String(play.hpCurrent ?? 0), title: "Current HP"},
	});
	hp.createSpan({cls: "fiveetools-encounter__hpmax", text: "/"});
	const max = hp.createEl("input", {
		cls: "fiveetools-encounter__hpinput",
		attr: {type: "number", min: "0", value: String(play.hpMax ?? 0), title: "Max HP"},
	});
	const plus = hp.createEl("button", {text: "+", cls: "fiveetools-encounter__hpbtn", attr: {type: "button", title: "+1 HP"}});
	const temp = controls.createEl("input", {
		cls: "fiveetools-encounter__tempinput",
		attr: {type: "number", min: "0", value: String(play.tempHp ?? 0), title: "Temporary HP", placeholder: "Temp"},
	});
	const writeCurrent = (value) => {
		const cap = Number(play.hpMax) || 0;
		const next = Number(value);
		const current = Number.isFinite(next) ? next : (Number(play.hpCurrent) || 0);
		play.hpCurrent = Math.max(0, cap > 0 ? Math.min(cap, current) : current);
		input.value = String(play.hpCurrent);
		persistPlay(plugin, record);
	};
	minus.addEventListener("click", () => writeCurrent((Number(play.hpCurrent) || 0) - 1));
	plus.addEventListener("click", () => writeCurrent((Number(play.hpCurrent) || 0) + 1));
	input.addEventListener("change", () => writeCurrent(input.value));
	max.addEventListener("change", () => {
		play.hpMax = Math.max(0, Math.floor(Number(max.value) || 0));
		max.value = String(play.hpMax);
		if ((Number(play.hpCurrent) || 0) > play.hpMax) writeCurrent(play.hpMax);
		else persistPlay(plugin, record);
	});
	temp.addEventListener("change", () => {
		play.tempHp = Math.max(0, Math.floor(Number(temp.value) || 0));
		temp.value = String(play.tempHp);
		persistPlay(plugin, record);
	});
}

function paintCombatStats (host, fields, rolls, speeds) {
	const tile = (label) => {
		const box = host.createDiv({cls: "fiveetools-character-card__vital"});
		box.createSpan({cls: "fiveetools-character-card__vital-label", text: label});
		return box.createSpan({cls: "fiveetools-character-card__vital-value"});
	};
	if (fields.ac != null && fields.ac !== "") tile("AC").setText(String(fields.ac));
	const listed = (speeds || []).filter(speed => Number(speed?.value) > 0);
	if (listed.length) {
		for (const speed of listed) tile(speed.label || "Speed").setText(String(speed.value));
	} else if (fields.speed != null && fields.speed !== "") {
		tile("Speed").setText(String(fields.speed));
	}
	if (rolls && rolls.initiative != null) {
		const value = tile("Initiative");
		paintRoll(value, "Initiative", rolls.initiative);
		if (rolls.initiativeEdge) value.createSpan({cls: "fiveetools-character-card__source", text: rolls.initiativeEdge === "adv" ? " adv" : " dis"});
	}
	if (rolls?.proficiency != null) tile("PB").setText(signed(rolls.proficiency));
	if (rolls?.passivePerception != null) tile("Passive Perception").setText(String(rolls.passivePerception));
}

function paintLabeledList (host, title, values) {
	const text = (values || []).map(value => String(value || "").trim()).filter(Boolean);
	if (!text.length) return;
	host.createEl("h3", {text: title});
	host.createEl("p", {text: text.join(", ")});
}

function paintConditions (host, plugin, record) {
	const play = playState(record);
	if (!Array.isArray(play.conditions)) play.conditions = [];
	host.createEl("h3", {text: "Conditions"});
	const chips = host.createDiv({cls: "fiveetools-character-card__chips"});
	const select = host.createEl("select", {cls: "fiveetools-encounter__condition", attr: {title: "Condition"}});
	select.createEl("option", {attr: {value: ""}, text: "Add condition"});
	for (const cond of CONDITIONS) select.createEl("option", {attr: {value: cond.id}, text: cond.label});
	const paintChips = () => {
		chips.empty();
		for (const id of play.conditions) {
			const label = CONDITIONS.find(cond => cond.id === id)?.label || id;
			const chip = chips.createEl("button", {
				cls: "fiveetools-character-card__chip",
				attr: {type: "button", title: `Remove ${label}`},
				text: `${label} ×`,
			});
			chip.addEventListener("click", () => {
				play.conditions = play.conditions.filter(it => it !== id);
				paintChips();
				persistPlay(plugin, record);
			});
		}
	};
	paintChips();
	select.addEventListener("change", () => {
		const id = select.value;
		select.value = "";
		if (!id || play.conditions.includes(id)) return;
		play.conditions.push(id);
		paintChips();
		persistPlay(plugin, record);
	});
}

function paintDeathSaves (host, plugin, record) {
	const play = playState(record);
	play.deathSaves = play.deathSaves || {success: 0, fail: 0, stable: false};
	host.createEl("h3", {text: "Death saves"});
	const row = host.createDiv({cls: "fiveetools-character-card__death"});
	paintDeathChecks(row, "Success", play.deathSaves.success, (n) => {
		play.deathSaves.success = n;
		persistPlay(plugin, record);
	});
	paintDeathChecks(row, "Fail", play.deathSaves.fail, (n) => {
		play.deathSaves.fail = n;
		persistPlay(plugin, record);
	});
	const stable = host.createEl("label", {cls: "fiveetools-character-card__stable"});
	const box = stable.createEl("input", {attr: {type: "checkbox"}});
	box.checked = !!play.deathSaves.stable;
	stable.appendText(" Stable");
	box.addEventListener("change", () => {
		play.deathSaves.stable = box.checked;
		persistPlay(plugin, record);
	});
}

function paintDeathChecks (row, label, count, onChange) {
	const group = row.createDiv({cls: "fiveetools-character-card__death-group"});
	group.createSpan({text: label});
	const boxes = [];
	for (let i = 0; i < 3; i++) {
		const box = group.createEl("input", {attr: {type: "checkbox", title: `${label} ${i + 1}`}});
		box.checked = i < count;
		boxes.push(box);
		box.addEventListener("change", () => {
			const next = box.checked ? i + 1 : i;
			boxes.forEach((el, n) => { el.checked = n < next; });
			onChange(next);
		});
	}
}

function paintInspiration (host, plugin, record) {
	const play = playState(record);
	const label = host.createEl("label", {cls: "fiveetools-character-card__stable"});
	const box = label.createEl("input", {attr: {type: "checkbox"}});
	box.checked = !!play.inspiration;
	label.appendText(" Inspiration");
	box.addEventListener("change", () => {
		play.inspiration = box.checked;
		persistPlay(plugin, record);
	});
}

function paintXp (host, plugin, record) {
	const play = playState(record);
	const adjustment = Number(record.snapshot?.xpAdjustment);
	if (play.xp == null && !adjustment) return;
	host.createEl("h3", {text: "Experience"});
	const row = host.createDiv({cls: "fiveetools-character-card__xp"});
	row.createSpan({text: "XP "});
	const input = row.createEl("input", {
		cls: "fiveetools-encounter__hpinput fiveetools-character-card__xp-input",
		attr: {type: "number", min: "0", value: play.xp == null ? "" : String(play.xp), title: "Current XP"},
	});
	if (adjustment) row.createSpan({cls: "fiveetools-character-card__source", text: ` adjustment ${adjustment > 0 ? "+" : ""}${adjustment}`});
	input.addEventListener("change", () => {
		const next = Math.max(0, Math.floor(Number(input.value) || 0));
		play.xp = next;
		input.value = String(next);
		persistPlay(plugin, record);
	});
}

function paintSpellcasting (host, lines) {
	if (!lines?.length) return;
	host.createEl("p", {
		cls: "fiveetools-character-card__combat",
		text: lines.map(line => `${line.className} ${signed(line.attack)} / DC ${line.dc}`).join(" · "),
	});
}

function paintHitDice (host, plugin, record) {
	const dice = record.snapshot?.hitDice || [];
	if (!dice.length) return;
	const play = playState(record);
	play.hitDiceSpent = play.hitDiceSpent || {};
	host.createEl("h3", {text: "Hit dice"});
	for (const die of dice) {
		const row = host.createDiv({cls: "fiveetools-character-card__hitdie"});
		row.createSpan({text: `${die.className} d${die.die} `});
		const spent = Math.max(0, Math.min(die.count, Number(play.hitDiceSpent[die.className] ?? die.spent) || 0));
		const input = row.createEl("input", {
			cls: "fiveetools-encounter__hpinput",
			attr: {type: "number", min: "0", max: String(die.count), value: String(spent), title: "Spent hit dice"},
		});
		row.createSpan({text: ` / ${die.count}`});
		input.addEventListener("change", () => {
			const next = Math.max(0, Math.min(die.count, Math.floor(Number(input.value) || 0)));
			input.value = String(next);
			play.hitDiceSpent[die.className] = next;
			persistPlay(plugin, record);
		});
	}
}

function playState (record) {
	const snap = record.snapshot || {};
	if (snap.play) return snap.play;
	const fields = record.fields || {};
	const prepared = [];
	for (const ref of snap.refs || []) {
		if (ref?.kind === "spell" && ref.prepared && !ref.alwaysPrepared) prepared.push(ref.name || ref.label);
	}
	const hitDiceSpent = {};
	for (const die of snap.hitDice || []) {
		if (die?.className && Number(die.spent) > 0) hitDiceSpent[die.className] = Number(die.spent);
	}
	snap.play = {
		hpCurrent: fields.hp_current != null && fields.hp_current !== "" ? Number(fields.hp_current) : null,
		hpMax: fields.hp_max != null && fields.hp_max !== "" ? Number(fields.hp_max) : null,
		tempHp: 0,
		conditions: [],
		deathSaves: {success: 0, fail: 0, stable: false},
		inspiration: false,
		xp: null,
		prepared,
		hitDiceSpent,
		coins: coinBag(snap.coins),
		gear: gearFromRefs(snap.refs),
	};
	record.snapshot = snap;
	return snap.play;
}

function persistPlay (plugin, record) {
	const id = String(record.fields?.ddb_id || "");
	if (!id || !record.snapshot?.play) return;
	void saveCharacterPlay(plugin, id, record.snapshot.play).catch((e) => {
		new Notice(e.message || "Could not save the character.");
	});
}

function spellIsPrepared (spell, play) {
	if (spell?.alwaysPrepared) return true;
	const name = spell?.name || spell?.label;
	return (play?.prepared || []).includes(name);
}

function paintSlots (host, plugin, record) {
	const slots = record.snapshot?.slots;
	if (!slots?.length) return;
	host.createEl("h3", {text: "Spell slots"});
	const row = host.createDiv({cls: "fiveetools-character-card__slots"});
	for (const slot of slots) {
		const cell = row.createDiv({cls: "fiveetools-character-card__slot"});
		cell.createSpan({
			cls: "fiveetools-character-card__slot-level",
			text: slot.pact ? `P${slot.level}` : String(slot.level),
		});
		const boxes = cell.createDiv({cls: "fiveetools-character-card__slot-boxes"});
		for (let i = 0; i < slot.max; i++) {
			const box = boxes.createEl("input", {
				cls: "fiveetools-character-card__slot-check",
				attr: {type: "checkbox", title: slot.pact ? `Pact slot ${slot.level}` : `Level ${slot.level} slot`},
			});
			box.checked = i < slot.spent;
			box.addEventListener("change", () => {
				slot.spent = box.checked ? i + 1 : i;
				for (let n = 0; n < slot.max; n++) boxes.children[n].checked = n < slot.spent;
				const id = String(record.fields?.ddb_id || "");
				void saveCharacterSlots(plugin, id, record.snapshot.slots).catch((e) => {
					new Notice(e.message || "Could not save spell slots.");
				});
			});
		}
	}
}

function spellMeta (spell, edition) {
	const named = getSpellMeta({n: spell?.name || spell?.label, s: spell?.source});
	if (named) return named;
	try {
		const doc = findEditionDoc(spell?.name || spell?.label, {
			categoriesExact: ["spell"],
			edition: edition === "one" ? "one" : "classic",
		});
		return doc ? getSpellMeta(doc) : null;
	} catch (_) {
		return null;
	}
}

function spellLevel (spell, edition) {
	if (Number.isFinite(Number(spell?.level))) return Number(spell.level);
	const level = spellMeta(spell, edition)?.level;
	return Number.isFinite(Number(level)) ? Number(level) : 99;
}

function spellLevelLabel (level) {
	if (level === 0) return "Cantrips";
	if (level === 99) return "Other";
	const suffix = level % 10 === 1 && level % 100 !== 11 ? "st"
		: level % 10 === 2 && level % 100 !== 12 ? "nd"
			: level % 10 === 3 && level % 100 !== 13 ? "rd"
				: "th";
	return `${level}${suffix}`;
}

function paintRefSection (host, plugin, title, refs) {
	if (!refs.length) return;
	host.createEl("h3", {text: title});
	const list = host.createDiv({cls: "fiveetools-character-card__rows"});
	for (const ref of refs) {
		const extra = [];
		if (ref.equipped) extra.push("equipped");
		if (Number(ref.qty) > 1) extra.push(`×${ref.qty}`);
		paintEntityRow(list, plugin, ref, ref.label || ref.name || "", {sub: extra.join(" · ")});
	}
}

function paintEntityRow (parent, plugin, ref, label, packed = {}) {
	const linked = linkRef(ref, [], ref?.edition);
	const row = parent.createEl(linked.source ? "button" : "div", {
		cls: "fiveetools-library__row",
		attr: linked.source ? {type: "button"} : {},
	});
	const book = sourceAbbr(linked.source);
	paintPackedLibraryRow(row, {
		name: label,
		badge: packed.badge || book,
		sub: packed.sub || "",
		tooltip: packed.tooltip || [label, book].filter(Boolean).join(" · "),
	});
	if (!linked.source) return;
	row.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		const doc = findEntityDoc(linked.name, {
			categoriesExact: REF_CATEGORIES[linked.kind] || (linked.kind ? [linked.kind] : []),
			source: linked.source,
		});
		if (doc && String(doc.s || "").toLowerCase() === String(linked.source).toLowerCase()) {
			void plugin.openPreview?.(doc);
		}
	});
}

function paintRefRow (parent, plugin, refs, allRefs, edition) {
	refs.forEach((ref, index) => {
		if (index) parent.createSpan({text: " · "});
		paintRefButton(parent, plugin, linkRef(ref, allRefs, edition), ref.label || ref.name);
	});
}

function linkRef (ref, refs, edition) {
	if (ref?.source) return ref;
	const names = [ref?.name, ref?.label, ref?.alt].map(it => String(it || "").trim()).filter(Boolean);
	if (ref?.kind === "subclass") {
		for (const className of classNamesFrom(refs)) names.push(`${ref.label || ref.name} (${className})`);
	}
	for (const name of names) {
		const doc = findEditionDoc(name, {
			categoriesExact: REF_CATEGORIES[ref.kind] || [],
			edition: edition === "one" ? "one" : "classic",
		});
		if (doc) return {...ref, name: doc.n, source: doc.s};
	}
	return ref;
}

function classNamesFrom (refs) {
	return (refs || [])
		.filter(ref => ref.kind === "class")
		.map(ref => String(ref.name || ref.label || "").replace(/\s+\d+$/, "").trim())
		.filter(Boolean);
}

function paintRefButton (parent, plugin, ref, label) {
	const book = sourceAbbr(ref.source);
	if (!ref.source) {
		parent.createSpan({text: label});
		return;
	}
	const btn = parent.createEl("button", {
		cls: "fiveetools-character-card__link",
		attr: {type: "button"},
	});
	btn.createSpan({text: label});
	if (book) btn.createSpan({cls: "fiveetools-character-card__source", text: ` · ${book}`});
	btn.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		const doc = findEntityDoc(ref.name, {
			categoriesExact: REF_CATEGORIES[ref.kind] || (ref.kind ? [ref.kind] : []),
			source: ref.source,
		});
		if (doc && String(doc.s || "").toLowerCase() === String(ref.source).toLowerCase()) {
			void plugin.openPreview?.(doc);
		}
	});
}

function refButtonLabel (ref) {
	const label = ref.label || ref.name || "";
	const qty = Number(ref.qty) > 1 ? ` ×${ref.qty}` : "";
	const equipped = ref.equipped ? " (equipped)" : "";
	return `${label}${qty}${equipped}`;
}

function paintAbilities (host, abilities, rolls) {
	if (!abilities) return;
	const rows = ABILITY_KEYS.filter(key => abilities[key] != null);
	if (!rows.length) return;
	const grid = host.createDiv({cls: "fiveetools-character-card__abilities"});
	const saves = new Map((rolls?.saves || []).map(save => [save.key, save]));
	for (const key of rows) {
		const score = abilities[key];
		const check = modifierFromScore(score);
		const save = saves.get(key);
		const cell = grid.createDiv({
			cls: `fiveetools-character-card__ability${save?.proficient ? " is-proficient" : ""}`,
		});
		cell.createDiv({cls: "fiveetools-character-card__ability-name", text: key.toUpperCase()});
		cell.createDiv({cls: "fiveetools-character-card__ability-base", text: String(score)});
		const values = cell.createDiv({cls: "fiveetools-character-card__ability-values"});
		paintValueRoll(values, key.toUpperCase(), signed(check), check);
		if (!save) continue;
		values.createSpan({cls: "fiveetools-character-card__ability-slash", text: "/"});
		paintValueRoll(values, `${key.toUpperCase()} save`, signed(save.mod), save.mod);
		[...values.querySelectorAll(".render-roller")].pop()?.classList.add("fiveetools-character-card__ability-save");
		if (save.proficient) values.createSpan({cls: "fiveetools-character-card__source", text: "PB"});
		if (save.edge) values.createSpan({cls: "fiveetools-character-card__source", text: save.edge === "adv" ? " adv" : " dis"});
	}
}

function paintSkills (host, rolls) {
	paintRollList(host, "Skills", rolls?.skills, skill => skill.name, skill => skill.name, "fiveetools-character-card__refs--cols");
}

function paintRollList (host, title, rows, labelOf, rollName, listCls) {
	if (!rows?.length) return;
	host.createEl("h3", {text: title});
	const list = host.createEl("ul", {cls: `fiveetools-character-card__refs${listCls ? ` ${listCls}` : ""}`});
	for (const row of rows) {
		const line = list.createEl("li", {cls: row.proficient || row.expertise ? "is-proficient" : ""});
		line.createSpan({text: `${labelOf(row)} `});
		paintRoll(line, rollName(row), row.mod);
		if (row.half) line.createSpan({cls: "fiveetools-character-card__source", text: " half"});
		if (row.edge) line.createSpan({cls: "fiveetools-character-card__source", text: row.edge === "adv" ? " adv" : " dis"});
	}
}

function paintActions (host, plugin, actions, {edition = "classic", prefer = []} = {}) {
	if (!actions?.length) return;
	const list = host.createDiv({cls: "fiveetools-character-card__rows"});
	for (const action of actions) {
		const doc = action.lookup && action.source
			? {n: action.lookup, s: action.source, cf: action.kind}
			: findNamedFeature(action.name, {edition, prefer});
		const ref = doc?.n && doc.s
			? {kind: String(doc.cf || action.kind || "").toLowerCase(), name: doc.n, source: doc.s}
			: {name: action.name};
		const row = list.createDiv({cls: "fiveetools-character-card__twoline"});
		const line = row.createDiv({cls: "fiveetools-character-card__twoline-line"});
		paintRefButton(line, plugin, ref, action.name);
		const extra = [];
		if (action.activation) extra.push(action.activation);
		if (action.uses) extra.push(`${action.uses} uses`);
		if (action.attack) extra.push(action.attack);
		if (action.range) extra.push(action.range);
		if (extra.length) line.createSpan({cls: "fiveetools-character-card__source", text: ` · ${extra.join(" · ")}`});
		const detail = [action.dice, action.damage, action.save, action.snippet].filter(Boolean);
		if (detail.length) {
			const second = row.createDiv({cls: "fiveetools-character-card__twoline-line fiveetools-character-card__source"});
			appendTextWithDiceRollers(second, detail.join(" · "));
		}
		setRowTip(row, [
			action.name,
			action.activation,
			action.uses ? `${action.uses} uses` : "",
			action.attack,
			action.range,
			action.dice,
			action.damage,
			action.save,
			action.snippet,
		]);
	}
}

function paintRoll (host, label, mod) {
	paintValueRoll(host, label, signed(mod), mod);
}

function paintValueRoll (host, label, display, mod) {
	const n = Number(mod) || 0;
	const notation = n ? `1d20${signed(n)}` : "1d20";
	appendTextWithDiceRollers(host, notation);
	const roller = [...host.querySelectorAll(".render-roller")].pop();
	if (!roller) return;
	if (display) roller.textContent = display;
	roller.setAttribute("title", display ? `${label} (${notation})` : "Click to roll.");
	roller.setAttribute("data-roll-name", label);
	try {
		const packed = JSON.parse(roller.getAttribute("data-packed-dice") || "{}");
		packed.subType = "d20";
		packed.name = label;
		roller.setAttribute("data-packed-dice", JSON.stringify(packed));
	} catch (_) { /* notation still rolls */ }
}

function paintTraits (host, traits) {
	if (!traits) return;
	const rows = [
		["Personality", traits.personality],
		["Ideals", traits.ideals],
		["Bonds", traits.bonds],
		["Flaws", traits.flaws],
	].filter(([, text]) => String(text || "").trim());
	if (!rows.length) return;
	host.createEl("h3", {text: "Traits"});
	for (const [label, text] of rows) {
		const line = host.createEl("p");
		line.createEl("strong", {text: `${label}. `});
		line.createSpan({text: String(text).trim()});
	}
}

function preferNames (refs) {
	return (refs || [])
		.filter(ref => ref.kind === "class" || ref.kind === "subclass")
		.flatMap(ref => String(ref.name || ref.label || "").toLowerCase().split(/[^a-z0-9]+/))
		.filter(token => token.length > 3);
}

function modifierFromScore (score) {
	return Math.floor(((Number(score) || 0) - 10) / 2);
}

function signed (mod) {
	const n = Number(mod) || 0;
	return n >= 0 ? `+${n}` : String(n);
}

function avatarSrc (plugin, body) {
	const match = String(body || "").match(/!\[\[([^\]|]+)/);
	const path = String(match?.[1] || "").trim();
	if (!path) return "";
	try { return plugin?.app?.vault?.adapter?.getResourcePath(path) || ""; } catch (_) { return ""; }
}

export function renderCharacterManager (formEl, resultEl, {plugin, session, onSessionChange} = {}) {
	formEl.empty();
	formEl.addClass("fiveetools-characters");
	resultEl.empty();
	resultEl.addClass("fiveetools-characters-reader");

	let selectedId = String(session?.selectedId || "");
	let characters = [];
	let busy = false;

	const catalog = formEl.createDiv({cls: "fiveetools-characters__catalog"});
	catalog.createEl("h3", {text: "Characters"});
	catalog.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Paste a public D&D Beyond character URL or id, or choose a character-sheet PDF.",
	});
	const importRow = catalog.createDiv({cls: "fiveetools-homebrew__row"});
	const importInput = importRow.createEl("input", {
		cls: "fiveetools-campaign__select",
		attr: {type: "text", placeholder: "https://www.dndbeyond.com/characters/12345678"},
	});
	const importBtn = importRow.createEl("button", {text: "Import", cls: "fiveetools-btn"});
	const fileInput = importRow.createEl("input", {attr: {type: "file", accept: ".pdf,application/pdf"}});
	fileInput.style.display = "none";
	const pdfBtn = importRow.createEl("button", {text: "Import PDF", cls: "fiveetools-btn"});
	const listEl = catalog.createDiv({cls: "fiveetools-homebrew__list"});

	const actions = resultEl.createDiv({cls: "fiveetools-characters__actions"});
	const refreshBtn = actions.createEl("button", {text: "Refresh", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const deleteBtn = actions.createEl("button", {text: "Delete", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const cardEl = resultEl.createDiv({cls: "fiveetools-characters__card"});

	const emit = () => onSessionChange?.({selectedId});

	const syncSelection = () => {
		listEl.querySelectorAll(".fiveetools-library__row").forEach((el) => {
			el.classList.toggle("is-selected", el.dataset.id === selectedId);
		});
		const has = characters.some(it => characterId(it) === selectedId);
		refreshBtn.disabled = busy || !has;
		deleteBtn.disabled = busy || !has;
	};

	const paintList = () => {
		const scrollTop = listEl.scrollTop || 0;
		listEl.empty();
		if (!characters.length) {
			listEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No characters yet."});
			syncSelection();
			return;
		}
		for (const it of characters) {
			const id = characterId(it);
			const level = it.fields?.level != null && it.fields.level !== "" ? String(it.fields.level) : "";
			const classes = String(it.fields?.classes || "").trim();
			const species = String(it.fields?.species || "").trim();
			const sub = [species, classes].filter(Boolean).join(" · ");
			const row = listEl.createEl("button", {
				cls: `fiveetools-library__row${id === selectedId ? " is-selected" : ""}`,
				attr: {"data-id": id, type: "button"},
			});
			paintPackedLibraryRow(row, {
				name: characterName(it),
				badge: level,
				sub,
				tooltip: [characterName(it), sub, level ? `Level ${level}` : ""].filter(Boolean).join(" · "),
			});
			row.addEventListener("click", () => {
				if (selectedId === id) return;
				selectedId = id;
				syncSelection();
				emit();
				void paintCard();
			});
		}
		listEl.scrollTop = scrollTop;
		syncSelection();
	};

	const paintCard = async () => {
		cardEl.empty();
		if (!selectedId) {
			cardEl.createEl("p", {cls: "fiveetools-view__meta", text: "Import a character to view it."});
			syncSelection();
			return;
		}
		await renderCharacterCard(cardEl, plugin, selectedId);
		syncSelection();
	};

	const reload = async () => {
		characters = await listCharacters(plugin);
		if (selectedId && !characters.some(it => characterId(it) === selectedId)) selectedId = "";
		if (!selectedId && characters[0]) selectedId = characterId(characters[0]);
		paintList();
		await paintCard();
		emit();
	};

	const runPdf = async (file) => {
		if (busy) return;
		busy = true;
		pdfBtn.disabled = true;
		syncSelection();
		try {
			const card = cardFromPdf(new Uint8Array(await file.arrayBuffer()));
			const saved = await saveCharacter(plugin, card);
			selectedId = characterId(saved) || card.ddbId;
			await reload();
			new Notice(`Imported ${card.name}.`);
		} catch (e) {
			new Notice(e.message || "Could not import that PDF.");
		} finally {
			busy = false;
			pdfBtn.disabled = false;
			syncSelection();
		}
	};

	const runImport = async (idOrUrl) => {
		if (busy) return;
		busy = true;
		importBtn.disabled = true;
		syncSelection();
		try {
			const card = await importDdbCharacter(plugin, idOrUrl);
			const saved = await saveCharacter(plugin, card);
			importInput.value = "";
			selectedId = characterId(saved) || card.ddbId;
			await reload();
			new Notice(`Imported ${card.name}.`);
		} catch (e) {
			new Notice(e.message || "Could not import that character.");
		} finally {
			busy = false;
			importBtn.disabled = false;
			syncSelection();
		}
	};

	importBtn.addEventListener("click", () => { void runImport(importInput.value); });
	pdfBtn.addEventListener("click", () => fileInput.click());
	fileInput.addEventListener("change", () => {
		const file = fileInput.files?.[0];
		fileInput.value = "";
		if (file) void runPdf(file);
	});
	importInput.addEventListener("keydown", (evt) => {
		if (evt.key === "Enter") {
			evt.preventDefault();
			void runImport(importInput.value);
		}
	});
	refreshBtn.addEventListener("click", () => {
		if (!selectedId) return;
		if (selectedId.startsWith("pdf-")) {
			new Notice("This character came from a PDF. Import the file again to update it.");
			return;
		}
		void runImport(selectedId);
	});
	deleteBtn.addEventListener("click", async () => {
		if (!selectedId || busy) return;
		const label = characterName(characters.find(it => characterId(it) === selectedId));
		if (typeof window !== "undefined" && !window.confirm(`Delete ${label}?`)) return;
		try {
			await deleteCharacter(plugin, selectedId);
			selectedId = "";
			await reload();
		} catch (e) {
			new Notice(e.message || "Could not delete that character.");
		}
	});

	void reload().catch((e) => {
		new Notice(e.message || "Could not load characters.");
		paintList();
	});
}

function characterId (record) {
	return String(record?.fields?.ddb_id || "").trim();
}
