import {ItemView, Menu, Notice} from "obsidian";
import {VIEW_TYPE_FIVEETOOLS_TABLE} from "./constants.js";
import {acOf, characterId, hpOf} from "./dpr-view.js";
import {presentRoll, rollInitiative} from "./dice-roll.js";
import {characterName, listCharacters} from "./character-store.js";
import {getSavedEncounter, listSavedEncounters, loadEncountersFromVault} from "./encounter-store.js";
import {
	addCombatants,
	applyGroupInitScore,
	kindKey,
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
		this._onTurnKey = (evt) => onInitiativeKey(this.plugin, evt);
		this.contentEl.win?.addEventListener("keydown", this._onTurnKey);
		markTableWindow(this, true);
		this.paint();
		this.contentEl.onWindowMigrated?.(() => {
			markTableWindow(this, true);
			this.paint();
		});
	}

	async onClose () {
		this._off?.();
		this._off = null;
		this.contentEl.win?.removeEventListener("keydown", this._onTurnKey);
		this._onTurnKey = null;
		this.frame?.remove();
		this.frame = null;
		markTableWindow(this, false);
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
		const frame = this.frame;
		if (!frame) return;
		frame.empty?.();
		while (frame.firstChild) frame.removeChild(frame.firstChild);
		const src = imageSrc(this, session);
		if (src) {
			const img = this.contentEl.win.document.createElement("img");
			img.className = "fiveetools-table-player__image";
			img.alt = "";
			img.src = src;
			frame.appendChild(img);
		}
		if (placedChips(session).length) paintPlayerRoster(frame, session, this.contentEl.win.document);
	}
}

function markTableWindow (view, on) {
	document.body.classList.remove("fiveetools-table-window");
	const win = view?.contentEl?.win;
	const body = view?.contentEl?.doc?.body;
	if (!win || win === window || !body) return;
	body.classList.toggle("fiveetools-table-window", on);
	if (!on) return;
	if (!view.frame || view.frame.ownerDocument !== win.document) mountTableFrame(view);
	view.contentEl.doc.title = "Table";
	win.document.documentElement.style.background = "#000";
	body.style.background = "#000";
}

function mountTableFrame (view) {
	const win = view.contentEl.win;
	if (!win || win === window) return;
	view.frame?.remove();
	const frame = win.document.createElement("div");
	frame.className = "fiveetools-table-player__frame";
	win.document.body.appendChild(frame);
	view.frame = frame;
	frame.addEventListener("contextmenu", (evt) => {
		evt.preventDefault();
		const img = evt.target?.closest?.("img");
		const src = img && !img.classList?.contains("fiveetools-table-player__image") ? (img.currentSrc || img.src || "") : "";
		const menu = new Menu();
		fillTableMenu(view.plugin, menu, src, evt);
		menu.showAtMouseEvent(evt);
	});
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

function paintPlayerRoster (host, session, doc) {
	const panel = doc.createElement("div");
	panel.className = "fiveetools-table-player__roster";
	const title = doc.createElement("h2");
	title.textContent = "Initiative";
	panel.appendChild(title);
	const current = currentTurnKey(session);
	for (const chip of placedChips(session)) {
		const row = doc.createElement("div");
		row.className = `fiveetools-init-list__row${chip.key === current ? " is-current" : ""}`;
		row.textContent = chip.label;
		panel.appendChild(row);
	}
	host.appendChild(panel);
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
	toolButton(actions, "Open table", (evt) => {
		castTableWindow(plugin, {anchorEl: evt.currentTarget, mouseEvent: evt});
	});
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
			hit.setAttr("draggable", "true");
			hit.addEventListener("dragstart", (evt) => {
				evt.dataTransfer.setData("text/plain", JSON.stringify({
					doc: {n: doc.n, u: doc.u || "", s: doc.s || "", c: doc.c, cf: doc.cf, sA: doc.sA},
					count: Number(copiesEl.value) || 1,
				}));
				evt.dataTransfer.effectAllowed = "copy";
			});
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
	toolButton(head, "Show on table", (evt) => {
		castTableWindow(plugin, {anchorEl: evt.currentTarget, mouseEvent: evt});
	});
	const waiting = listKindGroups(session.combatants).filter(group => group.initScore == null);
	if (waiting.length) {
		const tray = host.createDiv({cls: "fiveetools-init-tray"});
		tray.createEl("p", {cls: "fiveetools-view__meta", text: "Drag onto a number."});
		const row = tray.createDiv({cls: "fiveetools-init-ruler__chips"});
		for (const group of waiting) mountChip(row, plugin, group);
	}
	const ruler = host.createDiv({cls: "fiveetools-init-ruler", attr: {tabindex: "0"}});
	ruler.addEventListener("keydown", (evt) => onInitiativeKey(plugin, evt));
	const byScore = new Map();
	for (const group of placedChips(session)) {
		const slot = rulerSlot(group.initScore);
		if (!byScore.has(slot)) byScore.set(slot, []);
		byScore.get(slot).push(group);
	}
	for (let score = 25; score >= 1; score--) {
		const line = ruler.createDiv({cls: "fiveetools-init-ruler__row"});
		line.createSpan({cls: "fiveetools-init-ruler__n", text: String(score)});
		const chips = line.createDiv({cls: "fiveetools-init-ruler__chips"});
		const groups = byScore.get(score) || [];
		groups.forEach((group, index) => {
			if (index) chips.createSpan({cls: "fiveetools-init-ruler__slash", text: "/"});
			mountChip(chips, plugin, group);
		});
		line.addEventListener("dragover", (evt) => {
			evt.preventDefault();
			line.addClass("is-drop");
		});
		line.addEventListener("dragleave", () => line.removeClass("is-drop"));
		line.addEventListener("drop", (evt) => {
			evt.preventDefault();
			line.removeClass("is-drop");
			void dropOnScore(plugin, score, evt);
		});
	}
}

function mountChip (parent, plugin, group) {
	const chip = parent.createEl("span", {
		cls: "fiveetools-init-chip",
		attr: {draggable: "true"},
	});
	chip.createSpan({text: group.label});
	chip.addEventListener("dragstart", (evt) => {
		evt.dataTransfer.setData("text/plain", JSON.stringify({key: group.key}));
		evt.dataTransfer.effectAllowed = "move";
	});
	const remove = chip.createEl("button", {
		text: "×",
		cls: "fiveetools-init-chip__x",
		attr: {type: "button", "aria-label": `Remove ${group.label}`},
	});
	remove.addEventListener("click", (evt) => {
		evt.stopPropagation();
		removeGroup(plugin, group.key);
	});
}

async function dropOnScore (plugin, score, evt) {
	let payload = null;
	try { payload = JSON.parse(evt.dataTransfer?.getData("text/plain") || ""); } catch (_) { return; }
	if (!payload) return;
	const session = ensureTableSession(plugin);
	if (payload.key) {
		placeGroup(session, payload.key, score);
		refreshTable(plugin);
		return;
	}
	if (!payload.doc?.n) return;
	await addCreature(plugin, payload.doc, payload.count || 1);
	const next = ensureTableSession(plugin);
	const key = kindKey({doc: payload.doc, label: payload.doc.n});
	if (listKindGroups(next.combatants).some(group => group.key === key)) placeGroup(next, key, score);
	refreshTable(plugin);
}

function placeGroup (session, key, score) {
	const n = Math.max(1, Math.min(25, Math.round(Number(score))));
	applyGroupInitScore(session.combatants, key, n);
	const groups = listKindGroups(session.combatants);
	const moved = groups.find(group => group.key === key);
	if (!moved) return;
	const rest = groups.filter(group => group.key !== key);
	const scored = rest.filter(group => group.initScore != null)
		.sort((a, b) => Number(b.initScore) - Number(a.initScore));
	const open = rest.filter(group => group.initScore == null);
	const at = scored.findIndex(group => Number(group.initScore) < n);
	const placed = at < 0 ? [...scored, moved] : [...scored.slice(0, at), moved, ...scored.slice(at)];
	session.combatants = reorderCombatantsByGroups([...placed, ...open]);
}

export function placedChips (session) {
	return listKindGroups(session?.combatants)
		.filter(group => group.initScore != null && Number.isFinite(Number(group.initScore)))
		.sort((a, b) => Number(b.initScore) - Number(a.initScore));
}

function currentTurnKey (session) {
	const chips = placedChips(session);
	if (!chips.length) return null;
	return chips.some(chip => chip.key === session.turnKey) ? session.turnKey : chips[0].key;
}

export function onInitiativeKey (plugin, evt) {
	const tag = evt.target?.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || evt.target?.isContentEditable) return;
	if (evt.key !== "ArrowDown" && evt.key !== "ArrowUp") return;
	const session = ensureTableSession(plugin);
	const chips = placedChips(session);
	if (!chips.length) return;
	evt.preventDefault();
	const dir = evt.key === "ArrowDown" ? 1 : -1;
	let index = chips.findIndex(chip => chip.key === currentTurnKey(session));
	if (index < 0) index = 0;
	session.turnKey = chips[(index + dir + chips.length) % chips.length].key;
	refreshTable(plugin);
}

function rulerSlot (score) {
	const n = Math.round(Number(score));
	if (!Number.isFinite(n)) return null;
	return Math.max(1, Math.min(25, n));
}

function removeGroup (plugin, key) {
	const session = ensureTableSession(plugin);
	session.combatants = session.combatants.filter(combatant => kindKey(combatant) !== key);
	if (session.turnKey === key) session.turnKey = placedChips(session)[0]?.key || null;
	refreshTable(plugin);
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

function toolButton (row, text, onClick) {
	const button = row.createEl("button", {text, cls: "fiveetools-btn", attr: {type: "button"}});
	button.addEventListener("click", onClick);
	return button;
}

export async function openTableWindow (plugin, {display = null} = {}) {
	const workspace = plugin.app?.workspace;
	if (typeof workspace?.openPopoutLeaf !== "function") {
		new Notice("The Table window needs the Obsidian desktop app.");
		return;
	}
	const target = display || primaryDisplay();
	const area = target?.workAreaSize || target?.size;
	try {
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_FIVEETOOLS_TABLE)[0];
		if (!leaf) {
			const size = area
				? {width: Math.max(800, area.width | 0), height: Math.max(600, area.height | 0)}
				: {width: 1280, height: 720};
			leaf = workspace.openPopoutLeaf({size});
			await leaf.setViewState({type: VIEW_TYPE_FIVEETOOLS_TABLE, active: true});
		}
		workspace.revealLeaf(leaf);
		const view = leaf.view;
		if (view?.getViewType?.() === VIEW_TYPE_FIVEETOOLS_TABLE) {
			markTableWindow(view, true);
			view.paint?.();
			const win = view.contentEl?.win;
			if (target && win && win !== window) {
				requestAnimationFrame(() => placePopoutOnDisplay(win, target));
			}
		}
	} catch (err) {
		new Notice(err?.message || "Could not open the Table window.");
	}
}

export function castTableWindow (plugin, {anchorEl, mouseEvent} = {}) {
	const displays = listDisplays();
	const primary = primaryDisplay();
	const finish = (display) => { void openTableWindow(plugin, {display}); };
	if (displays.length <= 1) {
		finish(displays[0] || primary);
		return;
	}
	const menu = new Menu();
	displays.forEach((display, index) => {
		menu.addItem((item) => {
			item.setTitle(displayLabel(display, index, primary)).onClick(() => finish(display));
		});
	});
	if (mouseEvent) menu.showAtMouseEvent(mouseEvent);
	else if (anchorEl) {
		const rect = anchorEl.getBoundingClientRect();
		menu.showAtPosition({x: rect.left, y: rect.bottom});
	} else finish(primary);
}

function electronRemote () {
	return window.electron?.remote || null;
}

function listDisplays () {
	try {
		const displays = electronRemote()?.screen?.getAllDisplays?.();
		return Array.isArray(displays) ? displays : [];
	} catch (_) {
		return [];
	}
}

function primaryDisplay () {
	try {
		return electronRemote()?.screen?.getPrimaryDisplay?.() || listDisplays()[0] || null;
	} catch (_) {
		return listDisplays()[0] || null;
	}
}

function browserWindowFor (win) {
	if (!win) return null;
	try {
		if (typeof win.electron?.remote?.getCurrentWindow === "function") return win.electron.remote.getCurrentWindow();
	} catch (_) { /* ignore */ }
	try {
		const req = win.require || window.require;
		const remote = req?.("electron")?.remote;
		if (typeof remote?.getCurrentWindow === "function") return remote.getCurrentWindow();
	} catch (_) { /* ignore */ }
	return null;
}

function placePopoutOnDisplay (win, display) {
	if (!win || !display) return;
	const bw = browserWindowFor(win);
	if (!bw) return;
	try {
		const area = display.workArea || display.bounds;
		if (area && typeof bw.setBounds === "function") {
			bw.setBounds({
				x: area.x | 0,
				y: area.y | 0,
				width: Math.max(200, area.width | 0),
				height: Math.max(200, area.height | 0),
			});
		} else if (area && typeof bw.setPosition === "function") {
			bw.setPosition(area.x | 0, area.y | 0);
		}
		if (typeof bw.maximize === "function") bw.maximize();
	} catch (_) { /* ignore */ }
}

function displayLabel (display, index, primary) {
	const size = display?.size || display?.bounds || {};
	const w = size.width || display?.workAreaSize?.width || "?";
	const h = size.height || display?.workAreaSize?.height || "?";
	const tags = [];
	if (primary && display?.id === primary.id) tags.push("primary");
	if (display?.internal) tags.push("built-in");
	const suffix = tags.length ? ` (${tags.join(", ")})` : "";
	return `Screen ${index + 1} — ${w}×${h}${suffix}`;
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
}

export function fillTableMenu (plugin, menu, src, mouseEvent) {
	if (src) {
		menu.addItem((item) => {
			item.setTitle("Show on table").onClick(() => {
				void showOnTable(plugin, src).then(() => {
					const open = plugin.app?.workspace?.getLeavesOfType?.(VIEW_TYPE_FIVEETOOLS_TABLE)?.length;
					if (!open) castTableWindow(plugin, {mouseEvent});
				});
			});
		});
	}
	menu.addItem((item) => {
		item.setTitle("Open table").onClick(() => castTableWindow(plugin, {mouseEvent}));
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
		fillTableMenu(plugin, menu, src, evt);
		menu.showAtMouseEvent(evt);
	});
}

export function tableKind (combatant) {
	return kindKey(combatant);
}
