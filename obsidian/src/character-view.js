import {MarkdownRenderer, Notice} from "obsidian";
import {characterName, deleteCharacter, listCharacters, readCharacter, REF_CATEGORIES, saveCharacter, saveCharacterSlots} from "./character-store.js";
import {importDdbCharacter} from "./ddb-import.js";
import {appendTextWithDiceRollers, bindDiceRollers} from "./dice-roll.js";
import {ensureSearchIndex, findEditionDoc, findEntityDoc, findNamedFeature, sourceAbbr} from "./search-index.js";
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
	const sheet = host.createDiv({cls: "fiveetools-character-card__sheet"});
	const top = sheet.createDiv({cls: "fiveetools-character-card__panel is-wide"});
	const src = avatarSrc(plugin, record.body);
	if (src) top.createEl("img", {attr: {src, alt: characterName(record)}});
	top.createEl("h2", {text: characterName(record)});
	const identity = top.createDiv({cls: "fiveetools-character-card__identity"});
	const identityRefs = ["species", "class", "subclass"].flatMap(kind => refs.filter(ref => ref.kind === kind));
	const edition = snapshot.edition === "one" ? "one" : "classic";
	paintRefRow(identity, plugin, identityRefs, refs, edition);
	const level = fields.level != null && fields.level !== "" ? `Level ${fields.level}` : "";
	if (level) identity.createSpan({cls: "fiveetools-view__meta", text: identity.childNodes.length ? ` · ${level}` : level});
	const background = refs.find(ref => ref.kind === "background");
	if (background) {
		const line = top.createDiv({cls: "fiveetools-character-card__identity"});
		line.createSpan({text: "Background: "});
		paintRefRow(line, plugin, [background], refs, edition);
	}
	paintCombat(top, fields, snapshot.rolls);
	paintAbilities(top, snapshot.abilities, snapshot.rolls);
	paintSlots(top, plugin, record);
	if (snapshot.rolls?.skills?.length) paintSkills(panel(sheet), snapshot.rolls);
	const spells = refs.filter(ref => ref.kind === "spell");
	if (spells.length) paintSpells(panel(sheet), plugin, spells, edition);
	const gear = refs.filter(ref => ref.kind === "item");
	if (gear.length) paintRefSection(panel(sheet), plugin, "Gear", gear);
	if (snapshot.actions?.length) {
		paintActions(panel(sheet), plugin, snapshot.actions, {
			edition,
			prefer: preferNames(refs),
		});
	}
	const feats = refs.filter(ref => ref.kind === "feat");
	if (feats.length) paintRefSection(panel(sheet), plugin, "Feats", feats);
	const coins = formatCoins(snapshot.coins);
	if (snapshot.traits) {
		const traits = panel(sheet, true);
		paintTraits(traits, snapshot.traits);
		if (coins) {
			traits.createEl("h3", {text: "Coins"});
			traits.createEl("p", {text: coins});
		}
	} else if (coins) {
		const box = panel(sheet);
		box.createEl("h3", {text: "Coins"});
		box.createEl("p", {text: coins});
	}
	bindDiceRollers(host, plugin);
}

function panel (sheet, wide) {
	return sheet.createDiv({cls: `fiveetools-character-card__panel${wide ? " is-wide" : ""}`});
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

function paintSpells (host, plugin, spells, edition) {
	host.createEl("h3", {text: "Spells"});
	const grouped = spells.map(spell => ({spell, level: spellLevel(spell, edition)}));
	grouped.sort((a, b) => a.level - b.level || String(a.spell.label || a.spell.name).localeCompare(String(b.spell.label || b.spell.name)));
	let last = null;
	let frame = null;
	for (const {spell, level} of grouped) {
		if (level !== last) {
			frame = host.createDiv({cls: "fiveetools-character-card__spell-level"});
			frame.createDiv({cls: "fiveetools-character-card__spell-level-label", text: spellLevelLabel(level)});
			last = level;
		}
		const meta = spellMeta(spell, edition);
		const sub = (meta?.classAbbrs || []).join(", ");
		paintEntityRow(frame, plugin, spell, spell.label || spell.name || "Spell", {sub});
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
	host.createEl("h3", {text: "Abilities"});
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
	}
}

function paintCombat (host, fields, rolls) {
	const line = host.createEl("p", {cls: "fiveetools-character-card__combat"});
	const bits = [];
	if (fields.ac != null && fields.ac !== "") bits.push(`AC ${fields.ac}`);
	if (fields.hp_max != null && fields.hp_max !== "") {
		const current = fields.hp_current != null && fields.hp_current !== "" ? fields.hp_current : fields.hp_max;
		bits.push(`HP ${current}/${fields.hp_max}`);
	}
	if (fields.speed != null && fields.speed !== "") bits.push(`Speed ${fields.speed}`);
	if (bits.length) line.createSpan({text: bits.join(" · ")});
	if (rolls && rolls.initiative != null) {
		if (bits.length) line.createSpan({text: " · Initiative "});
		else line.createSpan({text: "Initiative "});
		paintRoll(line, "Initiative", rolls.initiative);
	}
	const tail = [];
	if (rolls?.proficiency != null) tail.push(`PB ${signed(rolls.proficiency)}`);
	if (rolls?.passivePerception != null) tail.push(`Passive Perception ${rolls.passivePerception}`);
	if (tail.length) line.createSpan({text: `${bits.length || rolls?.initiative != null ? " · " : ""}${tail.join(" · ")}`});
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
	}
}

function paintActions (host, plugin, actions, {edition = "classic", prefer = []} = {}) {
	if (!actions?.length) return;
	host.createEl("h3", {text: "Actions"});
	const list = host.createDiv({cls: "fiveetools-character-card__rows"});
	for (const action of actions) {
		const doc = action.lookup && action.source
			? {n: action.lookup, s: action.source, cf: action.kind}
			: findNamedFeature(action.name, {edition, prefer});
		const extra = [];
		if (action.activation) extra.push(action.activation);
		if (action.uses) extra.push(`${action.uses} uses`);
		if (action.dice) extra.push(action.dice);
		const ref = doc?.n && doc.s
			? {kind: String(doc.cf || action.kind || "").toLowerCase(), name: doc.n, source: doc.s}
			: {name: action.name};
		paintEntityRow(list, plugin, ref, action.name, {sub: extra.join(" · ")});
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

function formatCoins (coins) {
	const order = [["pp", "pp"], ["gp", "gp"], ["ep", "ep"], ["sp", "sp"], ["cp", "cp"]];
	const parts = [];
	for (const [key, label] of order) {
		const n = Number(coins?.[key]) || 0;
		if (n) parts.push(`${n} ${label}`);
	}
	return parts.join(", ");
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
		text: "Paste a public D&D Beyond character URL or id.",
	});
	const importRow = catalog.createDiv({cls: "fiveetools-homebrew__row"});
	const importInput = importRow.createEl("input", {
		cls: "fiveetools-campaign__select",
		attr: {type: "text", placeholder: "https://www.dndbeyond.com/characters/12345678"},
	});
	const importBtn = importRow.createEl("button", {text: "Import", cls: "fiveetools-btn"});
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
	importInput.addEventListener("keydown", (evt) => {
		if (evt.key === "Enter") {
			evt.preventDefault();
			void runImport(importInput.value);
		}
	});
	refreshBtn.addEventListener("click", () => {
		if (!selectedId) return;
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
