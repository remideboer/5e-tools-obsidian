import {Modal, Notice} from "obsidian";
import {searchEntities, brewDocFromEntity, indexHomebrewDocs} from "./search-index.js";
import {loadEntity} from "./entity-loader.js";
import {renderCreatureForm} from "./creature-form.js";
import {
	buildEntity,
	cacheBrewInDataLoader,
	cacheEntityInDataLoader,
	emptyForm,
	homebrewType,
	normalizeMonsterForm,
	saveHomebrewToVault,
	upsertEntity,
} from "./homebrew-store.js";
import {
	deleteSavedEncounter,
	getSavedEncounter,
	listSavedEncounters,
	saveEncountersToVault,
	upsertSavedEncounter,
} from "./encounter-store.js";
import {encounterDifficulty, normalizeParty} from "./encounter-difficulty.js";

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

export function acFromEnt (ent) {
	const ac = ent?.ac;
	if (ac == null) return null;
	if (typeof ac === "number" && Number.isFinite(ac)) return ac;
	const first = Array.isArray(ac) ? ac[0] : ac;
	if (typeof first === "number" && Number.isFinite(first)) return first;
	const n = Number(first?.ac);
	return Number.isFinite(n) ? n : null;
}

export function initiativeFromEnt (ent) {
	const fromRenderer = globalThis.Renderer?.monster?.getInitiativeBonusNumber?.({mon: ent});
	if (fromRenderer != null && Number.isFinite(fromRenderer)) return fromRenderer;
	if (typeof ent?.dex !== "number") return null;
	const Parser = globalThis.Parser;
	if (Parser?.getAbilityModNumber) return Parser.getAbilityModNumber(ent.dex);
	return Math.floor((ent.dex - 10) / 2);
}

function formatBonus (n) {
	if (n == null || !Number.isFinite(Number(n))) return "—";
	const v = Number(n);
	return v >= 0 ? `+${v}` : `${v}`;
}

export async function addCombatants (session, doc, count = 1) {
	if (!doc) throw new Error("No creature to add.");
	const n = Math.max(1, Math.min(20, Number(count) || 1));
	const loaded = await loadEntity(doc);
	const ent = loaded.ent;
	if (!ent) throw new Error(`No JSON found for ${doc.n || "creature"}.`);
	const hpMax = hpMaxFromEnt(ent);
	const cr = crFromEnt(ent);
	const ac = acFromEnt(ent);
	const initiative = initiativeFromEnt(ent);
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
			ac,
			initiative,
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

export function addCombatantsFromEntity (session, ent, count = 1) {
	if (!ent?.name) throw new Error("Name is required.");
	cacheEntityInDataLoader(ent, "monster");
	const doc = brewDocFromEntity(ent, homebrewType("monster"));
	const n = Math.max(1, Math.min(20, Number(count) || 1));
	const hpMax = hpMaxFromEnt(ent);
	const cr = crFromEnt(ent);
	const ac = acFromEnt(ent);
	const initiative = initiativeFromEnt(ent);
	const combatants = [...(session?.combatants || [])];
	bumpIdCounter(combatants);
	const added = [];
	const snapshot = JSON.parse(JSON.stringify(ent));
	for (let i = 0; i < n; i++) {
		const combatant = {
			id: `c${nextCombatantId++}`,
			label: nextLabel(ent.name, combatants),
			doc: serializeDoc(doc),
			ent: JSON.parse(JSON.stringify(snapshot)),
			custom: true,
			hpMax,
			hpCurrent: hpMax,
			cr,
			ac,
			initiative,
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
	plugin,
	app,
	onOpenDoc,
	onSessionChange,
} = {}) {
	formEl.empty();
	formEl.addClass("fiveetools-encounter");
	formEl.createEl("h3", {text: "Encounter Composer"});
	formEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Search the bestiary and click a result to preview its statblock, then Add. Save named encounters to load later.",
	});

	let combatants = cloneCombatants(session?.combatants);
	let selectedId = session?.selectedId || null;
	let name = session?.name || "";
	let party = normalizeParty(session?.party);
	let savedId = session?.savedId || null;
	let pickedId = session?.pickedId || savedId || null;
	let previewKey = null;
	let showBlank = !!session?.showBlank;
	let blankDraft = normalizeMonsterForm(session?.blankDraft || emptyForm("monster"));
	let saveToHomebrew = !!session?.saveToHomebrew;
	bumpIdCounter(combatants);

	const partyEl = formEl.createDiv({cls: "fiveetools-encounter__party"});
	const partyRow = partyEl.createDiv({cls: "fiveetools-encounter__row"});
	const playersWrap = partyRow.createDiv({cls: "fiveetools-homebrew__field"});
	playersWrap.createEl("label", {text: "Players"});
	const playersEl = playersWrap.createEl("input", {
		attr: {type: "number", min: "1", max: "12", value: String(party.count), title: "Number of player characters"},
	});
	const levelWrap = partyRow.createDiv({cls: "fiveetools-homebrew__field"});
	levelWrap.createEl("label", {text: "Level"});
	const levelEl = levelWrap.createEl("input", {
		attr: {type: "number", min: "1", max: "20", value: String(party.level), title: "Party level (all the same)"},
	});
	const diffEl = partyEl.createEl("div", {cls: "fiveetools-encounter__diff"});
	const xpEl = partyEl.createEl("div", {cls: "fiveetools-encounter__xp"});

	const nameRow = formEl.createDiv({cls: "fiveetools-encounter__row"});
	const nameEl = nameRow.createEl("input", {
		cls: "fiveetools-encounter__name",
		attr: {type: "text", placeholder: "Encounter name", value: name},
	});
	const savesEl = formEl.createDiv({cls: "fiveetools-encounter__saves"});
	const saveActions = formEl.createDiv({cls: "fiveetools-encounter__row"});
	const newBtn = saveActions.createEl("button", {text: "New", cls: "fiveetools-btn"});
	const saveBtn = saveActions.createEl("button", {text: "Save", cls: "fiveetools-btn"});
	const loadBtn = saveActions.createEl("button", {text: "Load", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const deleteBtn = saveActions.createEl("button", {text: "Delete", cls: "fiveetools-btn fiveetools-btn--ghost"});

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
	const blankBtn = searchRow.createEl("button", {text: "Blank creature", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button"}});
	const hitsEl = addRow.createDiv({cls: "fiveetools-encounter__hits"});
	const blankEl = formEl.createDiv({cls: "fiveetools-encounter__blank is-hidden"});
	const rosterEl = formEl.createDiv({cls: "fiveetools-encounter__roster"});
	const actions = formEl.createDiv({cls: "fiveetools-encounter__row"});
	const clearBtn = actions.createEl("button", {text: "Clear encounter", cls: "fiveetools-btn fiveetools-btn--ghost"});

	const emit = () => {
		clearBtn.toggleAttribute("disabled", !combatants.length);
		loadBtn.toggleAttribute("disabled", !pickedId);
		deleteBtn.toggleAttribute("disabled", !pickedId);
		paintDifficulty();
		onSessionChange?.({
			combatants: cloneCombatants(combatants),
			selectedId,
			name,
			party: normalizeParty(party),
			savedId,
			pickedId,
			showBlank,
			blankDraft: normalizeMonsterForm(blankDraft),
			saveToHomebrew,
		});
	};

	const paintDifficulty = () => {
		const info = encounterDifficulty({combatants, party});
		diffEl.setText(info.difficulty ? `Difficulty: ${info.label}` : "Difficulty: —");
		xpEl.setText(`${info.totalXp.toLocaleString()} XP · ${info.xpPerPlayer.toLocaleString()} per player`);
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
		if (hit?.ent) cacheEntityInDataLoader(hit.ent, "monster");
		openDoc(hit?.doc);
	};

	let blankPreviewTimer = null;
	const cancelBlankPreview = () => {
		if (blankPreviewTimer) {
			clearTimeout(blankPreviewTimer);
			blankPreviewTimer = null;
		}
	};
	const previewBlank = () => {
		const ent = buildEntity("monster", blankDraft);
		if (!ent?.name) {
			showPlaceholder();
			return;
		}
		cacheEntityInDataLoader(ent, "monster");
		previewKey = null;
		openDoc(brewDocFromEntity(ent, homebrewType("monster")));
	};
	const scheduleBlankPreview = () => {
		cancelBlankPreview();
		blankPreviewTimer = setTimeout(previewBlank, 200);
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

	const paintSaves = () => {
		savesEl.empty();
		const saved = listSavedEncounters();
		if (!saved.some(it => it.id === pickedId)) pickedId = null;
		loadBtn.toggleAttribute("disabled", !pickedId);
		deleteBtn.toggleAttribute("disabled", !pickedId);
		if (!saved.length) {
			savesEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No saved encounters."});
			return;
		}
		for (const it of saved) {
			const count = it.combatants?.length || 0;
			const row = savesEl.createEl("button", {
				cls: `fiveetools-encounter__save${it.id === pickedId ? " is-selected" : ""}`,
				attr: {type: "button"},
			});
			row.createEl("div", {cls: "fiveetools-modal__name", text: it.name});
			row.createEl("div", {
				cls: "fiveetools-modal__sub",
				text: count === 1 ? "1 creature" : `${count} creatures`,
			});
			row.addEventListener("click", () => {
				pickedId = it.id;
				emit();
				paintSaves();
			});
		}
	};

	const applySaved = (saved) => {
		combatants = cloneCombatants(saved.combatants);
		selectedId = saved.selectedId && combatants.some(it => it.id === saved.selectedId)
			? saved.selectedId
			: (combatants[combatants.length - 1]?.id || null);
		name = saved.name;
		party = normalizeParty(saved.party);
		savedId = saved.id;
		pickedId = saved.id;
		previewKey = null;
		nameEl.value = name;
		playersEl.value = String(party.count);
		levelEl.value = String(party.level);
		bumpIdCounter(combatants);
		emit();
		paintSaves();
		paintHits();
		paintRoster();
		if (selectedId) openSelected();
		else showPlaceholder();
	};

	const paintBlank = () => {
		blankEl.empty();
		blankBtn.classList.toggle("is-selected", showBlank);
		if (!showBlank) {
			blankEl.addClass("is-hidden");
			return;
		}
		blankEl.removeClass("is-hidden");
		const formHost = blankEl.createDiv({cls: "fiveetools-encounter__blankform"});
		renderCreatureForm(formHost, blankDraft, {
			onChange: () => {
				emit();
				scheduleBlankPreview();
			},
		});
		const blankActions = blankEl.createDiv({cls: "fiveetools-encounter__row"});
		const saveWrap = blankActions.createEl("label", {cls: "fiveetools-homebrew__check"});
		const saveCb = saveWrap.createEl("input", {attr: {type: "checkbox"}});
		saveCb.checked = saveToHomebrew;
		saveWrap.createSpan({text: "Save to homebrew"});
		saveCb.addEventListener("change", () => {
			saveToHomebrew = saveCb.checked;
			emit();
		});
		const addBlankBtn = blankActions.createEl("button", {text: "Add to encounter", cls: "fiveetools-btn", attr: {type: "button"}});
		addBlankBtn.addEventListener("click", async () => {
			const ent = buildEntity("monster", blankDraft);
			if (!ent.name) {
				new Notice("Name is required.");
				return;
			}
			try {
				if (saveToHomebrew) {
					upsertEntity("monster", ent);
					await saveHomebrewToVault(plugin);
					cacheBrewInDataLoader();
					indexHomebrewDocs();
				}
				const next = addCombatantsFromEntity({combatants, selectedId}, ent, Number(countInput.value) || 1);
				combatants = next.combatants;
				selectedId = next.selectedId;
				previewKey = null;
				emit();
				paintHits();
				paintRoster();
				openSelected();
			} catch (e) {
				new Notice(e.message || "Could not add creature.");
			}
		});
	};

	const readParty = (clampDisplay) => {
		party = normalizeParty({count: playersEl.value, level: levelEl.value});
		if (clampDisplay) {
			playersEl.value = String(party.count);
			levelEl.value = String(party.level);
		}
		emit();
	};
	playersEl.addEventListener("input", () => readParty(false));
	levelEl.addEventListener("input", () => readParty(false));
	playersEl.addEventListener("change", () => readParty(true));
	levelEl.addEventListener("change", () => readParty(true));
	nameEl.addEventListener("input", () => {
		name = nameEl.value;
		emit();
	});
	blankBtn.addEventListener("click", () => {
		showBlank = !showBlank;
		emit();
		paintBlank();
		if (showBlank) scheduleBlankPreview();
		else {
			cancelBlankPreview();
			openSelected();
		}
	});
	newBtn.addEventListener("click", () => {
		combatants = [];
		selectedId = null;
		name = "";
		savedId = null;
		pickedId = null;
		previewKey = null;
		showBlank = false;
		blankDraft = emptyForm("monster");
		saveToHomebrew = false;
		cancelBlankPreview();
		nameEl.value = "";
		emit();
		paintSaves();
		paintBlank();
		paintHits();
		paintRoster();
		showPlaceholder();
	});
	saveBtn.addEventListener("click", async () => {
		try {
			const saved = upsertSavedEncounter({
				id: savedId,
				name,
				combatants,
				selectedId,
				party,
			});
			await saveEncountersToVault(plugin);
			savedId = saved.id;
			pickedId = saved.id;
			name = saved.name;
			nameEl.value = name;
			emit();
			paintSaves();
			new Notice(`Saved ${saved.name}.`);
		} catch (e) {
			new Notice(e.message || "Could not save encounter.");
		}
	});
	loadBtn.addEventListener("click", () => {
		const saved = getSavedEncounter(pickedId);
		if (!saved) return;
		const replace = () => applySaved(saved);
		if (combatants.length && savedId !== saved.id) {
			confirmAction(app, {
				title: "Load encounter",
				message: `Replace the current roster with ${saved.name}?`,
				confirmLabel: "Load",
				onConfirm: replace,
			});
			return;
		}
		replace();
	});
	deleteBtn.addEventListener("click", () => {
		const saved = getSavedEncounter(pickedId);
		if (!saved) return;
		confirmAction(app, {
			title: "Delete encounter",
			message: `Delete saved encounter ${saved.name}?`,
			confirmLabel: "Delete",
			onConfirm: async () => {
				deleteSavedEncounter(saved.id);
				await saveEncountersToVault(plugin);
				if (savedId === saved.id) savedId = null;
				pickedId = null;
				emit();
				paintSaves();
				new Notice(`Deleted ${saved.name}.`);
			},
		});
	});
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

	paintSaves();
	paintBlank();
	emit();
	paintRoster();
	if (showBlank) previewBlank();
	else if (selectedId) openSelected();
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
	const stats = name.createDiv({cls: "fiveetools-encounter__stats"});
	stats.createEl("span", {text: `AC ${combatant.ac != null ? combatant.ac : "—"}`});
	stats.createEl("span", {text: `HP ${combatant.hpCurrent}/${combatant.hpMax}`});
	stats.createEl("span", {text: `Init ${formatBonus(combatant.initiative)}`});

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

class ConfirmActionModal extends Modal {
	constructor (app, {title, message, confirmLabel, onConfirm}) {
		super(app);
		this.titleText = title;
		this.message = message;
		this.confirmLabel = confirmLabel;
		this.onConfirm = onConfirm;
	}

	onOpen () {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl("h2", {text: this.titleText});
		contentEl.createEl("p", {text: this.message});
		const actions = contentEl.createDiv({cls: "fiveetools-encounter__row"});
		const cancel = actions.createEl("button", {text: "Cancel", cls: "fiveetools-btn fiveetools-btn--ghost"});
		const ok = actions.createEl("button", {text: this.confirmLabel, cls: "fiveetools-btn"});
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

function confirmAction (app, {title, message, confirmLabel, onConfirm}) {
	if (!app) {
		if (typeof window !== "undefined" && window.confirm(message)) onConfirm?.();
		return;
	}
	new ConfirmActionModal(app, {title, message, confirmLabel, onConfirm}).open();
}

function confirmRemove (app, label, onConfirm) {
	confirmAction(app, {
		title: "Remove creature",
		message: `Remove ${label} from the encounter?`,
		confirmLabel: "Remove",
		onConfirm,
	});
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
		ent: it.ent ? JSON.parse(JSON.stringify(it.ent)) : null,
	}));
}

if (globalThis.FiveEToolsObsidian) {
	globalThis.FiveEToolsObsidian.addCombatants = addCombatants;
	globalThis.FiveEToolsObsidian.addCombatantsFromEntity = addCombatantsFromEntity;
	globalThis.FiveEToolsObsidian.hpMaxFromEnt = hpMaxFromEnt;
	globalThis.FiveEToolsObsidian.acFromEnt = acFromEnt;
	globalThis.FiveEToolsObsidian.initiativeFromEnt = initiativeFromEnt;
	globalThis.FiveEToolsObsidian.adjustHp = adjustHp;
	globalThis.FiveEToolsObsidian.encounterDifficulty = encounterDifficulty;
	globalThis.FiveEToolsObsidian.normalizeParty = normalizeParty;
}
