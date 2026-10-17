import {Modal} from "obsidian";
import {searchEntities} from "./search-index.js";
import {loadEntity} from "./entity-loader.js";

let nextCombatantId = 1;

export function hpMaxFromEnt (ent) {
	if (ent?.hp == null) return 0;
	if (typeof ent.hp === "number") {
		const n = Number(ent.hp);
		return Number.isFinite(n) ? n : 0;
	}
	if (ent.hp.average != null) {
		const n = Number(ent.hp.average);
		return Number.isFinite(n) ? n : 0;
	}
	if (ent.hp.special != null) {
		const m = String(ent.hp.special).match(/-?\d+/);
		return m ? Number(m[0]) : 0;
	}
	return 0;
}

export function crFromEnt (ent) {
	if (ent?.cr == null) return "";
	if (typeof ent.cr === "string") return ent.cr;
	return ent.cr.cr || "";
}

export async function addCombatants (session, doc, count = 1) {
	if (!doc) throw new Error("No creature to add.");
	const n = Math.max(1, Math.min(20, Number(count) || 1));
	const loaded = await loadEntity(doc);
	const ent = loaded.ent;
	if (!ent) throw new Error(`No JSON found for ${doc.n || "creature"}.`);
	const hpMax = hpMaxFromEnt(ent);
	const cr = crFromEnt(ent);
	const combatants = [...(session?.combatants || [])];
	bumpIdCounter(combatants);
	const added = [];
	for (let i = 0; i < n; i++) {
		const combatant = {
			id: `c${nextCombatantId++}`,
			label: nextLabel(doc.n || ent.name, combatants),
			doc: serializeDoc(doc),
			hpMax,
			hpCurrent: hpMax,
			cr,
		};
		combatants.push(combatant);
		added.push(combatant);
	}
	return {
		combatants,
		selectedId: added[added.length - 1].id,
		added,
	};
}

export function adjustHp (current, max, delta) {
	const cur = Number(current) || 0;
	const cap = Number(max) || 0;
	return Math.max(0, Math.min(cap, cur + Number(delta || 0)));
}

export function renderEncounterComposer (formEl, resultEl, {
	session,
	app,
	onOpenDoc,
	onSessionChange,
} = {}) {
	formEl.empty();
	formEl.addClass("fiveetools-encounter");
	formEl.createEl("h3", {text: "Encounter Composer"});
	formEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Search the bestiary and click a result to preview its statblock, then Add.",
	});

	let combatants = cloneCombatants(session?.combatants);
	let selectedId = session?.selectedId || null;
	let previewKey = null;
	bumpIdCounter(combatants);

	const addRow = formEl.createDiv({cls: "fiveetools-encounter__add"});
	const searchRow = addRow.createDiv({cls: "fiveetools-encounter__row"});
	const searchEl = searchRow.createEl("input", {
		cls: "fiveetools-encounter__search",
		attr: {type: "search", placeholder: "Add creature…"},
	});
	const countInput = searchRow.createEl("input", {
		cls: "fiveetools-encounter__count",
		attr: {type: "number", min: "1", max: "20", value: "1", title: "Copies to add"},
	});
	const hitsEl = addRow.createDiv({cls: "fiveetools-encounter__hits"});
	const rosterEl = formEl.createDiv({cls: "fiveetools-encounter__roster"});
	const actions = formEl.createDiv({cls: "fiveetools-encounter__row"});
	const clearBtn = actions.createEl("button", {text: "Clear encounter", cls: "fiveetools-btn fiveetools-btn--ghost"});

	const emit = () => {
		clearBtn.toggleAttribute("disabled", !combatants.length);
		onSessionChange?.({
			combatants: cloneCombatants(combatants),
			selectedId,
		});
	};

	const showPlaceholder = () => {
		resultEl.empty();
		resultEl.createEl("p", {
			cls: "fiveetools-view__meta",
			text: "Click a search result to preview its statblock, then Add it to the encounter.",
		});
	};

	const openDoc = (doc) => {
		if (!doc) {
			showPlaceholder();
			return;
		}
		onOpenDoc?.(doc);
	};

	const openSelected = () => {
		const hit = combatants.find(it => it.id === selectedId);
		openDoc(hit?.doc);
	};

	const previewDoc = (doc) => {
		previewKey = docKey(doc);
		paintHits();
		paintRoster();
		openDoc(doc);
	};

	const paintRoster = () => {
		rosterEl.empty();
		if (!combatants.length) {
			rosterEl.createEl("p", {cls: "fiveetools-view__meta", text: "No creatures yet."});
			return;
		}
		for (const combatant of combatants) {
			renderCombatantRow(rosterEl, combatant, {
				app,
				selected: !previewKey && combatant.id === selectedId,
				onSelect: () => {
					previewKey = null;
					selectedId = combatant.id;
					emit();
					paintHits();
					paintRoster();
					openSelected();
				},
				onHp: (nextHp) => {
					combatant.hpCurrent = nextHp;
					emit();
					paintRoster();
				},
				onRemove: () => {
					combatants = combatants.filter(it => it.id !== combatant.id);
					if (selectedId === combatant.id) {
						selectedId = combatants[combatants.length - 1]?.id || null;
					}
					emit();
					paintRoster();
					openSelected();
				},
			});
		}
	};

	const paintHits = () => {
		hitsEl.empty();
		const term = String(searchEl.value || "").trim();
		if (term.length < 2) return;
		const docs = searchEntities(term, {categoriesExact: ["bestiary"], limit: 8});
		if (!docs.length) {
			hitsEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No creatures."});
			return;
		}
		for (const doc of docs) {
			const row = hitsEl.createDiv({
				cls: `fiveetools-encounter__hit${previewKey === docKey(doc) ? " is-selected" : ""}`,
			});
			const meta = row.createDiv({cls: "fiveetools-encounter__hitmeta"});
			meta.createEl("div", {cls: "fiveetools-modal__name", text: doc.n});
			meta.createEl("div", {
				cls: "fiveetools-modal__sub",
				text: [doc.sA || doc.s, doc.cf].filter(Boolean).join(" · "),
			});
			row.addEventListener("click", (evt) => {
				if (evt.target.closest("button")) return;
				previewDoc(doc);
			});
			const addBtn = row.createEl("button", {text: "Add", cls: "fiveetools-btn"});
			addBtn.addEventListener("click", async (evt) => {
				evt.stopPropagation();
				addBtn.setAttr("disabled", "true");
				try {
					const next = await addCombatants({combatants, selectedId}, doc, Number(countInput.value) || 1);
					combatants = next.combatants;
					selectedId = next.selectedId;
					previewKey = null;
					emit();
					paintHits();
					paintRoster();
					openSelected();
				} catch (e) {
					resultEl.empty();
					resultEl.createEl("p", {text: e.message || "Could not add creature."});
				} finally {
					addBtn.removeAttribute("disabled");
				}
			});
		}
	};

	searchEl.addEventListener("input", () => paintHits());
	clearBtn.addEventListener("click", () => {
		combatants = [];
		selectedId = null;
		previewKey = null;
		emit();
		paintHits();
		paintRoster();
		showPlaceholder();
	});

	emit();
	paintRoster();
	if (selectedId) openSelected();
	else showPlaceholder();
}

function renderCombatantRow (parent, combatant, {app, selected, onSelect, onHp, onRemove}) {
	const row = parent.createDiv({
		cls: `fiveetools-encounter__combatant${selected ? " is-selected" : ""}${combatant.hpCurrent <= 0 ? " is-down" : ""}`,
	});
	row.addEventListener("click", (evt) => {
		if (evt.target.closest(".fiveetools-encounter__hp")) return;
		onSelect();
	});

	const name = row.createDiv({cls: "fiveetools-encounter__who"});
	name.createEl("div", {cls: "fiveetools-modal__name", text: combatant.label});
	name.createEl("div", {
		cls: "fiveetools-modal__sub",
		text: [combatant.cr ? `CR ${combatant.cr}` : null, combatant.doc?.sA || combatant.doc?.s].filter(Boolean).join(" · "),
	});

	const hp = row.createDiv({cls: "fiveetools-encounter__hp"});
	const minus = hp.createEl("button", {text: "−", cls: "fiveetools-encounter__hpbtn", attr: {type: "button", title: "−1 HP"}});
	const input = hp.createEl("input", {
		cls: "fiveetools-encounter__hpinput",
		attr: {type: "number", value: String(combatant.hpCurrent), title: "Current HP"},
	});
	hp.createEl("span", {cls: "fiveetools-encounter__hpmax", text: `/ ${combatant.hpMax}`});
	const plus = hp.createEl("button", {text: "+", cls: "fiveetools-encounter__hpbtn", attr: {type: "button", title: "+1 HP"}});
	const remove = hp.createEl("button", {text: "×", cls: "fiveetools-encounter__hpbtn fiveetools-encounter__remove", attr: {type: "button", title: "Remove"}});

	minus.addEventListener("click", (evt) => {
		evt.stopPropagation();
		onHp(adjustHp(combatant.hpCurrent, combatant.hpMax, -1));
	});
	plus.addEventListener("click", (evt) => {
		evt.stopPropagation();
		onHp(adjustHp(combatant.hpCurrent, combatant.hpMax, 1));
	});
	input.addEventListener("click", (evt) => evt.stopPropagation());
	input.addEventListener("change", () => {
		const typed = Number(input.value);
		onHp(Number.isFinite(typed) ? typed : combatant.hpCurrent);
	});
	remove.addEventListener("click", (evt) => {
		evt.stopPropagation();
		confirmRemove(app, combatant.label, onRemove);
	});
}

class ConfirmRemoveModal extends Modal {
	constructor (app, label, onConfirm) {
		super(app);
		this.label = label;
		this.onConfirm = onConfirm;
	}

	onOpen () {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl("h2", {text: "Remove creature"});
		contentEl.createEl("p", {text: `Remove ${this.label} from the encounter?`});
		const actions = contentEl.createDiv({cls: "fiveetools-encounter__row"});
		const cancel = actions.createEl("button", {text: "Cancel", cls: "fiveetools-btn fiveetools-btn--ghost"});
		const ok = actions.createEl("button", {text: "Remove", cls: "fiveetools-btn"});
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

function confirmRemove (app, label, onConfirm) {
	if (!app) {
		if (typeof window !== "undefined" && window.confirm(`Remove ${label} from the encounter?`)) onConfirm?.();
		return;
	}
	new ConfirmRemoveModal(app, label, onConfirm).open();
}

function nextLabel (name, combatants) {
	const base = String(name || "Creature").trim() || "Creature";
	const used = new Set(combatants.map(it => it.label));
	let n = 1;
	while (used.has(`${base} ${n}`)) n++;
	return `${base} ${n}`;
}

function bumpIdCounter (combatants) {
	for (const it of combatants || []) {
		const n = Number(String(it.id || "").replace(/^c/, ""));
		if (Number.isFinite(n) && n >= nextCombatantId) nextCombatantId = n + 1;
	}
}

function serializeDoc (doc) {
	if (!doc) return null;
	return {
		n: doc.n,
		u: doc.u,
		s: doc.s,
		c: doc.c,
		cf: doc.cf,
		sA: doc.sA,
	};
}

function docKey (doc) {
	return `${doc?.u || ""}|${doc?.s || ""}`;
}

function cloneCombatants (combatants) {
	return (combatants || []).map(it => ({
		...it,
		doc: it.doc ? {...it.doc} : null,
	}));
}

if (globalThis.FiveEToolsObsidian) {
	globalThis.FiveEToolsObsidian.addCombatants = addCombatants;
	globalThis.FiveEToolsObsidian.hpMaxFromEnt = hpMaxFromEnt;
	globalThis.FiveEToolsObsidian.adjustHp = adjustHp;
}
