import {ItemView, Menu, Notice} from "obsidian";
import {VIEW_TYPE_FIVEETOOLS_TABLE} from "./constants.js";
import {acOf, characterId, hpOf} from "./dpr-view.js";
import {presentRoll, rollInitiative} from "./dice-roll.js";
import {characterName, listCharacters} from "./character-store.js";
import {getSavedEncounter, listSavedEncounters, loadEncountersFromVault} from "./encounter-store.js";
import {
	addCombatants,
	applyGroupInitScore,
	listKindGroups,
	reorderCombatantsByGroups,
	sortGroupsByInitiative,
} from "./encounter-view.js";
import {ensureSearchIndex, searchEntities} from "./search-index.js";
import {ICON_ID} from "./icon.js";
import {ensureTableSession, onTableChange, refreshTable} from "./table-session.js";

let nextId = 1;

export class FiveEToolsTableView extends ItemView {
	constructor (leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this._off = null;
		this._objectUrl = "";
	}

	getViewType () {
		return VIEW_TYPE_FIVEETOOLS_TABLE;
	}

	getDisplayText () {
		return "Table";
	}

	getIcon () {
		return ICON_ID;
	}

	async onOpen () {
		this.contentEl.addClass("fiveetools-table-player");
		this._off = onTableChange(() => this.paint());
		this.paint();
		this.contentEl.addEventListener("contextmenu", (evt) => {
			const img = evt.target?.closest?.("img");
			const src = img && img.classList?.contains("fiveetools-table-player__image") ? "" : (img?.currentSrc || img?.src || "");
			evt.preventDefault();
			const menu = new Menu();
			fillTableMenu(this.plugin, menu, src);
			menu.showAtMouseEvent(evt);
		});
	}

	async onClose () {
		this._off?.();
		this._off = null;
		this.revokeUrl();
		this.contentEl.empty();
	}

	revokeUrl () {
		if (!this._objectUrl) return;
		const url = this.contentEl?.win?.URL || URL;
		try { url.revokeObjectURL(this._objectUrl); } catch (_) { /* ignore */ }
		this._objectUrl = "";
	}

	paint () {
		const session = ensureTableSession(this.plugin);
		this.contentEl.empty();
		this.contentEl.addClass("fiveetools-table-player");
		const src = imageSrc(this, session);
		if (src) {
			this.contentEl.createEl("img", {
				cls: "fiveetools-table-player__image",
				attr: {src, alt: ""},
			});
		}
		if (session.combatants?.length) paintPlayerRoster(this.contentEl, session);
	}
}

function imageSrc (view, session) {
	view.revokeUrl();
	if (session.imageBytes) {
		const urlApi = view.contentEl?.win?.URL || URL;
		const blob = new Blob([session.imageBytes], {type: session.imageType || "image/png"});
		view._objectUrl = urlApi.createObjectURL(blob);
		return view._objectUrl;
	}
	return session.image || "";
}

function paintPlayerRoster (host, session) {
	const panel = host.createDiv({cls: "fiveetools-table-player__roster"});
	panel.createEl("h2", {text: "Initiative"});
	for (const group of listKindGroups(session.combatants)) {
		const block = panel.createDiv({cls: "fiveetools-table-player__group"});
		const head = block.createDiv({cls: "fiveetools-table-player__head"});
		head.createSpan({
			cls: "fiveetools-table-player__name",
			text: group.members.length > 1 ? `${group.label} ×${group.members.length}` : group.label,
		});
		head.createSpan({
			cls: "fiveetools-table-player__score",
			text: group.initScore != null ? String(group.initScore) : "—",
		});
		for (const member of group.members) {
			if (group.members.length === 1 && member.label === group.label) continue;
			block.createDiv({cls: "fiveetools-table-player__member", text: member.label});
		}
	}
}

export function renderTableTool (listEl, readerEl, {plugin} = {}) {
	listEl.empty();
	listEl.addClass("fiveetools-table");
	readerEl?.empty();
	const session = ensureTableSession(plugin);
	const rosterHost = readerEl || listEl;
	const rosterEl = rosterHost.createDiv({cls: "fiveetools-encounter fiveetools-table__board"});
	const paint = () => paintDmRoster(rosterEl, plugin);
	paint();
	plugin._tableToolUnsub?.();
	plugin._tableToolUnsub = onTableChange(() => {
		if (rosterEl.isConnected) paint();
	});
	void paintInserts(listEl, plugin, session);
}

async function paintInserts (listEl, plugin) {
	const box = listEl.createDiv({cls: "fiveetools-table__inserts"});
	box.createEl("h3", {text: "Table"});
	box.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "The Table window keeps one image as its background. This roster and public dice sit on top of it.",
	});
	const actions = box.createDiv({cls: "fiveetools-dpr__sim-controls"});
	toolButton(actions, "Open table", () => { void openTableWindow(plugin); });
	toolButton(actions, "Clear table", () => clearTableImage(plugin));
	toolButton(actions, "Close table", () => closeTableWindow(plugin));
	const session = ensureTableSession(plugin);
	const priv = toolButton(actions, session.privateRolls ? "Private rolls on" : "Private rolls", () => {
		session.privateRolls = !session.privateRolls;
		priv.setText(session.privateRolls ? "Private rolls on" : "Private rolls");
		if (session.privateRolls) priv.addClass("is-selected");
		else priv.removeClass("is-selected");
	});
	if (session.privateRolls) priv.addClass("is-selected");

	box.createEl("h4", {text: "Add a creature"});
	const searchRow = box.createDiv({cls: "fiveetools-encounter__row"});
	const searchEl = searchRow.createEl("input", {
		cls: "fiveetools-encounter__search",
		attr: {type: "search", placeholder: "Add creature…"},
	});
	const copiesEl = searchRow.createEl("select", {cls: "fiveetools-encounter__count", attr: {title: "Copies to add"}});
	for (let n = 1; n <= 8; n++) copiesEl.createEl("option", {text: String(n), attr: {value: String(n)}});
	const hitsEl = box.createDiv({cls: "fiveetools-encounter__hits"});
	try { await ensureSearchIndex(plugin); } catch (_) { /* search stays empty */ }
	const paintHits = () => {
		hitsEl.empty();
		const term = searchEl.value.trim();
		if (term.length < 2) return;
		const docs = searchEntities(term, {categoriesExact: ["bestiary"], limit: 8});
		if (!docs.length) {
			hitsEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No creatures."});
			return;
		}
		for (const doc of docs) {
			const hit = hitsEl.createDiv({cls: "fiveetools-encounter__hit"});
			hit.createDiv({cls: "fiveetools-modal__name", text: doc.n});
			const addBtn = hit.createEl("button", {text: "Add", cls: "fiveetools-btn", attr: {type: "button"}});
			addBtn.addEventListener("click", () => {
				void addCreature(plugin, doc, Number(copiesEl.value) || 1);
			});
		}
	};
	searchEl.addEventListener("input", paintHits);

	box.createEl("h4", {text: "Add an encounter"});
	const encRow = box.createDiv({cls: "fiveetools-encounter__row"});
	const encEl = encRow.createEl("select");
	encEl.createEl("option", {text: "Choose…", attr: {value: ""}});
	try { await loadEncountersFromVault(plugin); } catch (_) { /* saved list may be empty */ }
	for (const encounter of listSavedEncounters()) {
		encEl.createEl("option", {text: encounter.name || "Encounter", attr: {value: encounter.id}});
	}
	toolButton(encRow, "Add", () => { void addEncounter(plugin, encEl.value); });

	box.createEl("h4", {text: "Add a character"});
	const charRow = box.createDiv({cls: "fiveetools-encounter__row"});
	const charEl = charRow.createEl("select");
	charEl.createEl("option", {text: "Choose…", attr: {value: ""}});
	let characters = [];
	try { characters = await listCharacters(plugin); } catch (_) { characters = []; }
	for (const record of characters) {
		const id = characterId(record);
		charEl.createEl("option", {text: characterName(record), attr: {value: id}});
	}
	toolButton(charRow, "Add", () => {
		const record = characters.find(it => characterId(it) === charEl.value);
		if (record) addCharacter(plugin, record);
	});

	box.createEl("h4", {text: "Add a name"});
	const nameRow = box.createDiv({cls: "fiveetools-encounter__row"});
	const nameEl = nameRow.createEl("input", {attr: {type: "text", placeholder: "Name"}});
	toolButton(nameRow, "Add", () => addName(plugin, nameEl.value));
	nameEl.addEventListener("keydown", (evt) => {
		if (evt.key !== "Enter") return;
		evt.preventDefault();
		addName(plugin, nameEl.value);
		nameEl.value = "";
	});
}

function paintDmRoster (host, plugin) {
	host.empty();
	const session = ensureTableSession(plugin);
	const head = host.createDiv({cls: "fiveetools-table__roster-head"});
	head.createEl("h3", {text: "Initiative"});
	toolButton(head, "Roll all", () => { void rollAll(plugin); });
	if (!session.combatants.length) {
		host.createEl("p", {cls: "fiveetools-view__meta", text: "Add a creature, encounter, character, or name."});
		return;
	}
	for (const group of listKindGroups(session.combatants)) {
		const shell = host.createDiv({cls: "fiveetools-encounter__group"});
		const title = shell.createDiv({cls: "fiveetools-encounter__group-head"});
		title.createDiv({
			cls: "fiveetools-encounter__group-name",
			text: group.members.length > 1 ? `${group.label} ×${group.members.length}` : group.label,
		});
		const actions = title.createDiv({cls: "fiveetools-encounter__group-actions"});
		const roll = actions.createEl("button", {
			text: `Init ${formatBonus(group.bonus)}`,
			cls: "fiveetools-btn",
			attr: {type: "button", title: "Roll initiative for this group"},
		});
		roll.addEventListener("click", () => { void rollGroup(plugin, group); });
		actions.createSpan({
			cls: `fiveetools-encounter__init-score${group.initScore != null ? " has-score" : ""}`,
			text: group.initScore != null ? String(group.initScore) : "—",
		});
		const body = shell.createDiv({cls: "fiveetools-encounter__group-body"});
		for (const member of group.members) {
			const row = body.createDiv({cls: "fiveetools-sim__member"});
			const hp = member.hpMax ? `${member.hpCurrent ?? member.hpMax}/${member.hpMax}` : "";
			row.createSpan({text: [member.label, hp].filter(Boolean).join(" · ")});
			const remove = row.createEl("button", {text: "Remove", cls: "fiveetools-btn", attr: {type: "button"}});
			remove.addEventListener("click", () => removeCombatant(plugin, member.id));
		}
	}
}

async function addCreature (plugin, doc, count) {
	const session = ensureTableSession(plugin);
	try {
		const next = await addCombatants(session, doc, count);
		session.combatants = next.combatants;
		session.selectedId = next.selectedId;
		refreshTable(plugin);
	} catch (err) {
		new Notice(err?.message || "Could not add that creature.");
	}
}

async function addEncounter (plugin, id) {
	if (!id) return;
	const saved = getSavedEncounter(id);
	if (!saved?.combatants?.length) {
		new Notice("That encounter has no creatures.");
		return;
	}
	const session = ensureTableSession(plugin);
	for (const combatant of saved.combatants) {
		if (combatant?.doc?.n) {
			try {
				const next = await addCombatants(session, combatant.doc, 1);
				session.combatants = next.combatants;
			} catch (_) { /* skip a creature that will not load */ }
		} else if (combatant?.label) {
			pushNamed(session, combatant.label, combatant);
		}
	}
	sortRoster(session);
	refreshTable(plugin);
}

function addCharacter (plugin, record) {
	const session = ensureTableSession(plugin);
	const id = characterId(record);
	if (id && session.combatants.some(it => it.characterId === id)) return;
	const name = characterName(record);
	const max = hpOf(record) || 1;
	session.combatants.push({
		id: `t${nextId++}`,
		characterId: id,
		label: nextLabel(name, session.combatants),
		hpMax: max,
		hpCurrent: max,
		ac: acOf(record) || null,
		initiative: Number(record.snapshot?.rolls?.initiative) || 0,
		dex: null,
		tempHp: 0,
		condition: "",
		initScore: null,
	});
	sortRoster(session);
	refreshTable(plugin);
}

function addName (plugin, raw) {
	const name = String(raw || "").trim();
	if (!name) return;
	const session = ensureTableSession(plugin);
	pushNamed(session, name, {});
	sortRoster(session);
	refreshTable(plugin);
}

function pushNamed (session, name, extra) {
	session.combatants.push({
		id: `t${nextId++}`,
		label: nextLabel(name, session.combatants),
		hpMax: Number(extra.hpMax) || 0,
		hpCurrent: Number(extra.hpCurrent ?? extra.hpMax) || 0,
		ac: extra.ac ?? null,
		initiative: Number(extra.initiative) || 0,
		dex: extra.dex ?? null,
		tempHp: 0,
		condition: "",
		initScore: extra.initScore ?? null,
	});
}

function removeCombatant (plugin, id) {
	const session = ensureTableSession(plugin);
	session.combatants = session.combatants.filter(it => it.id !== id);
	refreshTable(plugin);
}

async function rollGroup (plugin, group) {
	const result = rollInitiative(group.bonus, {}, group.label || "Initiative");
	await presentRoll(plugin, result);
	const score = Number(result?.total);
	if (!Number.isFinite(score)) return;
	const session = ensureTableSession(plugin);
	applyGroupInitScore(session.combatants, group.key, score);
	sortRoster(session);
	refreshTable(plugin);
}

async function rollAll (plugin) {
	const session = ensureTableSession(plugin);
	const groups = listKindGroups(session.combatants);
	for (const group of groups) await rollGroup(plugin, group);
}

function sortRoster (session) {
	session.combatants = reorderCombatantsByGroups(sortGroupsByInitiative(listKindGroups(session.combatants)));
}

function nextLabel (name, combatants) {
	const base = String(name || "Creature").trim() || "Creature";
	const used = new Set((combatants || []).map(it => it.label));
	if (!used.has(base)) return base;
	let n = 2;
	while (used.has(`${base} ${n}`)) n += 1;
	return `${base} ${n}`;
}

function formatBonus (n) {
	if (n == null || !Number.isFinite(Number(n))) return "—";
	const value = Number(n);
	return value >= 0 ? `+${value}` : `${value}`;
}

function toolButton (row, text, onClick) {
	const button = row.createEl("button", {text, cls: "fiveetools-btn", attr: {type: "button"}});
	button.addEventListener("click", onClick);
	return button;
}

export async function openTableWindow (plugin) {
	const workspace = plugin.app?.workspace;
	if (typeof workspace?.openPopoutLeaf !== "function") {
		new Notice("The Table window needs the Obsidian desktop app.");
		return;
	}
	try {
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_FIVEETOOLS_TABLE)[0];
		if (!leaf) {
			leaf = workspace.openPopoutLeaf({size: {width: 1280, height: 720}});
			await leaf.setViewState({type: VIEW_TYPE_FIVEETOOLS_TABLE, active: true});
		}
		workspace.revealLeaf(leaf);
		leaf.view?.paint?.();
	} catch (err) {
		new Notice(err?.message || "Could not open the Table window.");
	}
}

export function closeTableWindow (plugin) {
	const leaves = plugin.app?.workspace?.getLeavesOfType?.(VIEW_TYPE_FIVEETOOLS_TABLE) || [];
	for (const leaf of leaves) {
		try { leaf.detach(); } catch (_) { /* ignore */ }
	}
}

export function clearTableImage (plugin) {
	const session = ensureTableSession(plugin);
	session.image = "";
	session.imageBytes = null;
	session.imageType = "";
	refreshTable(plugin);
}

export async function showOnTable (plugin, src) {
	const text = String(src || "").trim();
	if (!text) return;
	const session = ensureTableSession(plugin);
	if (text.startsWith("blob:")) {
		try {
			const res = await fetch(text);
			session.imageBytes = await res.arrayBuffer();
			session.imageType = res.headers.get("content-type") || "image/png";
			session.image = "";
		} catch (_) {
			session.image = text;
			session.imageBytes = null;
		}
	} else {
		session.image = text;
		session.imageBytes = null;
	}
	refreshTable(plugin);
	await openTableWindow(plugin);
}

export function fillTableMenu (plugin, menu, src) {
	if (src) {
		menu.addItem((item) => {
			item.setTitle("Show on table").onClick(() => { void showOnTable(plugin, src); });
		});
	}
	menu.addItem((item) => {
		item.setTitle("Open table").onClick(() => { void openTableWindow(plugin); });
	});
	menu.addItem((item) => {
		item.setTitle("Clear table").onClick(() => clearTableImage(plugin));
	});
	menu.addItem((item) => {
		item.setTitle("Close table").onClick(() => closeTableWindow(plugin));
	});
}

export function bindTableImageMenu (el, plugin) {
	if (!el || el._fiveetoolsTableMenu) return;
	el._fiveetoolsTableMenu = true;
	el.addEventListener("contextmenu", (evt) => {
		const img = evt.target?.closest?.("img");
		if (!img || img.classList?.contains("fiveetools-table-player__image")) return;
		const src = img.currentSrc || img.src || "";
		if (!src) return;
		evt.preventDefault();
		const menu = new Menu();
		fillTableMenu(plugin, menu, src);
		menu.showAtMouseEvent(evt);
	});
}

export function tableKind (combatant) {
	return kindKey(combatant);
}
