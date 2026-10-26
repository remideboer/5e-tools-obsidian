import {Modal, Notice} from "obsidian";
import {searchEntities, brewDocFromEntity, indexHomebrewDocs} from "./search-index.js";
import {loadEntity} from "./entity-loader.js";
import {CONDITIONS, renderCreatureForm} from "./creature-form.js";
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
	queueSaveEncountersToVault,
	saveEncountersToVault,
	setEncounterInstance,
	upsertSavedEncounter,
} from "./encounter-store.js";
import {encounterDifficulty, normalizeParty} from "./encounter-difficulty.js";
import {
	DIFFICULTY_OPTIONS,
	ENCOUNTER_TYPES,
	generateRandomEncounter,
	habitatSelectOptions,
	SETTING_OPTIONS,
	THEME_OPTIONS,
} from "./encounter-random.js";
import {presentRoll, rollInitiative} from "./dice-roll.js";

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

export function dexFromEnt (ent) {
	const n = Number(ent?.dex);
	return Number.isFinite(n) ? n : null;
}

export function passiveFromEnt (ent) {
	if (ent?.passive != null) {
		const n = Number(ent.passive);
		if (Number.isFinite(n)) return n;
	}
	if (typeof ent?.wis === "number") {
		const Parser = globalThis.Parser;
		const mod = Parser?.getAbilityModNumber
			? Parser.getAbilityModNumber(ent.wis)
			: Math.floor((ent.wis - 10) / 2);
		return 10 + (Number.isFinite(mod) ? mod : 0);
	}
	return null;
}

export function kindKey (combatant) {
	if (combatant?.doc?.u && combatant?.doc?.s) return `${combatant.doc.u}|${combatant.doc.s}`;
	const custom = String(combatant?.ent?.name || "").trim();
	if (custom) return `ent:${custom.toLowerCase()}`;
	return String(combatant?.label || "").replace(/\s+\d+$/, "").trim().toLowerCase() || "creature";
}

export function groupBaseLabel (combatant) {
	return String(combatant?.doc?.n || combatant?.ent?.name || combatant?.label || "Creature")
		.replace(/\s+\d+$/, "")
		.trim() || "Creature";
}

/** Cluster by kind, preserving first-seen group order (no Dex re-sort). */
export function listKindGroups (list) {
	const groups = [];
	const ix = new Map();
	for (const combatant of list || []) {
		const key = kindKey(combatant);
		if (!ix.has(key)) {
			ix.set(key, groups.length);
			groups.push({key, members: []});
		}
		groups[ix.get(key)].members.push(combatant);
	}
	return groups.map((g) => {
		const first = g.members[0];
		const scores = g.members.map(it => finiteScore(it.initScore)).filter(n => n != null);
		return {
			key: g.key,
			label: groupBaseLabel(first),
			members: g.members,
			bonus: first?.initiative ?? null,
			dex: combatantDex(first),
			passive: combatantPassive(first),
			initScore: scores.length ? scores[0] : null,
		};
	});
}

export function groupCombatants (list) {
	return listKindGroups(list).flatMap(g => g.members);
}

export function sortGroupsByDex (groups) {
	return [...groups].sort((a, b) => (b.dex ?? -Infinity) - (a.dex ?? -Infinity));
}

export function sortGroupsByInitiative (groups) {
	return [...groups].sort((a, b) => {
		const sa = finiteScore(a.initScore);
		const sb = finiteScore(b.initScore);
		const aHas = sa != null;
		const bHas = sb != null;
		if (aHas && bHas && sa !== sb) return sb - sa;
		if (aHas && !bHas) return -1;
		if (!aHas && bHas) return 1;
		const da = a.dex ?? -Infinity;
		const db = b.dex ?? -Infinity;
		if (da !== db) return db - da;
		const pa = a.passive ?? -Infinity;
		const pb = b.passive ?? -Infinity;
		if (pa !== pb) return pb - pa;
		return String(a.label || "").localeCompare(String(b.label || ""), undefined, {sensitivity: "base"});
	});
}

export function reorderCombatantsByGroups (groups) {
	return (groups || []).flatMap(g => g.members || []);
}

export function sortCombatantsByDex (list) {
	return reorderCombatantsByGroups(sortGroupsByDex(listKindGroups(list)));
}

export function applyGroupInitScore (combatants, key, score) {
	const n = finiteScore(score);
	for (const c of combatants || []) {
		if (kindKey(c) === key) c.initScore = n;
	}
}

/** Reject null/"" — Number(null) is 0 and must not count as a rolled score. */
function finiteScore (v) {
	if (v == null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function combatantDex (combatant) {
	const n = combatant?.dex ?? dexFromEnt(combatant?.ent);
	return Number.isFinite(Number(n)) ? Number(n) : null;
}

function combatantPassive (combatant) {
	const n = combatant?.passive ?? passiveFromEnt(combatant?.ent);
	return Number.isFinite(Number(n)) ? Number(n) : null;
}

function formatBonus (n) {
	if (n == null || !Number.isFinite(Number(n))) return "—";
	const v = Number(n);
	return v >= 0 ? `+${v}` : `${v}`;
}

function fillNumberSelect (el, min, max, value) {
	for (let n = min; n <= max; n++) {
		el.createEl("option", {attr: {value: String(n)}, text: String(n)});
	}
	el.value = String(value);
}

export async function addCombatants (session, doc, count = 1) {
	if (!doc) throw new Error("No creature to add.");
	const n = Math.max(1, Math.min(10, Number(count) || 1));
	const loaded = await loadEntity(doc);
	const ent = loaded.ent;
	if (!ent) throw new Error(`No JSON found for ${doc.n || "creature"}.`);
	const hpMax = hpMaxFromEnt(ent);
	const cr = crFromEnt(ent);
	const ac = acFromEnt(ent);
	const initiative = initiativeFromEnt(ent);
	const dex = dexFromEnt(ent);
	const passive = passiveFromEnt(ent);
	const combatants = [...(session?.combatants || [])];
	bumpIdCounter(combatants);
	const existingScore = sharedInitScoreForDoc(combatants, doc);
	const added = [];
	for (let i = 0; i < n; i++) {
		const combatant = {
			id: `c${nextCombatantId++}`,
			label: nextLabel(doc.n || ent.name, combatants),
			doc: serializeDoc(doc),
			hpMax,
			hpCurrent: hpMax,
			tempHp: 0,
			condition: "",
			cr,
			ac,
			initiative,
			dex,
			passive,
			initScore: existingScore,
		};
		combatants.push(combatant);
		added.push(combatant);
	}
	return {
		combatants: finalizeRosterOrder(combatants),
		selectedId: added[added.length - 1].id,
		added,
	};
}

export function addCombatantsFromEntity (session, ent, count = 1) {
	if (!ent?.name) throw new Error("Name is required.");
	cacheEntityInDataLoader(ent, "monster");
	const doc = brewDocFromEntity(ent, homebrewType("monster"));
	const n = Math.max(1, Math.min(10, Number(count) || 1));
	const hpMax = hpMaxFromEnt(ent);
	const cr = crFromEnt(ent);
	const ac = acFromEnt(ent);
	const initiative = initiativeFromEnt(ent);
	const dex = dexFromEnt(ent);
	const passive = passiveFromEnt(ent);
	const combatants = [...(session?.combatants || [])];
	bumpIdCounter(combatants);
	const existingScore = sharedInitScoreForDoc(combatants, doc, ent);
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
			tempHp: 0,
			condition: "",
			cr,
			ac,
			initiative,
			dex,
			passive,
			initScore: existingScore,
		};
		combatants.push(combatant);
		added.push(combatant);
	}
	return {
		combatants: finalizeRosterOrder(combatants),
		selectedId: added[added.length - 1].id,
		added,
	};
}

function sharedInitScoreForDoc (combatants, doc, ent = null) {
	const probe = {doc: serializeDoc(doc), ent, label: doc?.n || ent?.name};
	const key = kindKey(probe);
	for (const c of combatants || []) {
		if (kindKey(c) !== key) continue;
		const score = finiteScore(c.initScore);
		if (score != null) return score;
	}
	return null;
}

/** Keep initiative order if any scores exist; otherwise default Dex grouping. */
function finalizeRosterOrder (combatants) {
	const hasScores = (combatants || []).some(c => finiteScore(c.initScore) != null);
	if (hasScores) {
		return reorderCombatantsByGroups(sortGroupsByInitiative(listKindGroups(combatants)));
	}
	return sortCombatantsByDex(combatants);
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
	onSaved,
} = {}) {
	formEl.empty();
	formEl.addClass("fiveetools-encounter");

	let combatants = groupCombatants(cloneCombatants(session?.combatants));
	let selectedId = session?.selectedId || null;
	let name = session?.name || "";
	let party = normalizeParty(session?.party);
	let savedId = session?.savedId || null;
	let pickedId = session?.pickedId || savedId || null;
	let previewKey = null;
	let showBlank = !!session?.showBlank;
	let blankDraft = normalizeMonsterForm(session?.blankDraft || emptyForm("monster"));
	let saveToHomebrew = !!session?.saveToHomebrew;
	let initOrderBaseline = Array.isArray(session?.initOrderBaseline)
		? session.initOrderBaseline.map(String)
		: null;
	bumpIdCounter(combatants);

	const composerEl = formEl.createDiv({cls: "fiveetools-encounter__composer"});
	composerEl.createEl("h3", {text: "Encounter Composer"});
	composerEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "The running encounter autosaves. Search the bestiary and click a result to preview its statblock, then Add. Use Save to keep a named copy.",
	});

	const partyEl = composerEl.createDiv({cls: "fiveetools-encounter__party"});
	const partyRow = partyEl.createDiv({cls: "fiveetools-encounter__row"});
	const playersWrap = partyRow.createDiv({cls: "fiveetools-homebrew__field"});
	playersWrap.createEl("label", {text: "Players"});
	const playersEl = playersWrap.createEl("select", {attr: {title: "Number of player characters"}});
	fillNumberSelect(playersEl, 1, 12, party.count);
	const levelWrap = partyRow.createDiv({cls: "fiveetools-homebrew__field"});
	levelWrap.createEl("label", {text: "Level"});
	const levelEl = levelWrap.createEl("select", {attr: {title: "Party level (all the same)"}});
	fillNumberSelect(levelEl, 1, 20, party.level);
	const diffEl = partyEl.createEl("div", {cls: "fiveetools-encounter__diff"});
	const xpEl = partyEl.createEl("div", {cls: "fiveetools-encounter__xp"});

	const nameRow = composerEl.createDiv({cls: "fiveetools-encounter__row"});
	const nameEl = nameRow.createEl("input", {
		cls: "fiveetools-encounter__name",
		attr: {type: "text", placeholder: "Encounter name", value: name},
	});
	const savesEl = composerEl.createDiv({cls: "fiveetools-encounter__saves"});
	const saveActions = composerEl.createDiv({cls: "fiveetools-encounter__row"});
	const newBtn = saveActions.createEl("button", {text: "New", cls: "fiveetools-btn"});
	const saveBtn = saveActions.createEl("button", {text: "Save", cls: "fiveetools-btn"});
	const loadBtn = saveActions.createEl("button", {text: "Load", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const deleteBtn = saveActions.createEl("button", {text: "Delete", cls: "fiveetools-btn fiveetools-btn--ghost"});

	const addRow = composerEl.createDiv({cls: "fiveetools-encounter__add"});
	const searchRow = addRow.createDiv({cls: "fiveetools-encounter__row"});
	const searchEl = searchRow.createEl("input", {
		cls: "fiveetools-encounter__search",
		attr: {type: "search", placeholder: "Add creature…"},
	});
	const countInput = searchRow.createEl("select", {
		cls: "fiveetools-encounter__count",
		attr: {title: "Copies to add"},
	});
	fillNumberSelect(countInput, 1, 10, 1);
	const blankRow = addRow.createDiv({cls: "fiveetools-encounter__row"});
	const blankBtn = blankRow.createEl("button", {text: "Blank creature", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button"}});
	const randomBtn = blankRow.createEl("button", {
		text: "Random encounter",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	const hitsEl = addRow.createDiv({cls: "fiveetools-encounter__hits"});
	const blankEl = composerEl.createDiv({cls: "fiveetools-encounter__blank is-hidden"});
	const actions = composerEl.createDiv({cls: "fiveetools-encounter__row"});
	const clearBtn = actions.createEl("button", {text: "Clear encounter", cls: "fiveetools-btn fiveetools-btn--ghost"});

	const creaturesEl = formEl.createDiv({cls: "fiveetools-encounter__creatures"});
	const creaturesHead = creaturesEl.createDiv({cls: "fiveetools-encounter__creatures-head"});
	creaturesHead.createEl("h3", {text: "Creatures"});
	const initToolbar = creaturesHead.createDiv({cls: "fiveetools-encounter__init-toolbar"});
	const rollAllBtn = initToolbar.createEl("button", {
		text: "Roll initiative",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Roll initiative for each creature group"},
	});
	const resetOrderBtn = initToolbar.createEl("button", {
		text: "Reset order",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Restore order from before initiative"},
	});
	const rosterEl = creaturesEl.createDiv({cls: "fiveetools-encounter__roster"});

	const syncInitToolbar = () => {
		rollAllBtn.toggleAttribute("disabled", !combatants.length);
		resetOrderBtn.toggleAttribute("disabled", !initOrderBaseline?.length);
	};

	const emit = () => {
		clearBtn.toggleAttribute("disabled", !combatants.length);
		loadBtn.toggleAttribute("disabled", !pickedId);
		deleteBtn.toggleAttribute("disabled", !pickedId);
		syncInitToolbar();
		paintDifficulty();
		const next = {
			combatants: cloneCombatants(combatants),
			selectedId,
			name,
			party: normalizeParty(party),
			savedId,
			pickedId,
			showBlank,
			blankDraft: normalizeMonsterForm(blankDraft),
			saveToHomebrew,
			initOrderBaseline: initOrderBaseline ? [...initOrderBaseline] : null,
		};
		onSessionChange?.(next);
		setEncounterInstance(next);
		queueSaveEncountersToVault(plugin);
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

	const syncRosterSelection = () => {
		rosterEl.querySelectorAll(".fiveetools-encounter__combatant").forEach((el) => {
			el.classList.toggle("is-selected", !previewKey && el.dataset.id === selectedId);
		});
	};

	const captureBaselineIfNeeded = () => {
		if (!initOrderBaseline?.length) {
			initOrderBaseline = combatants.map(it => it.id);
		}
	};

	const rollGroupInitiative = async (group, {reorder = false} = {}) => {
		const result = rollInitiative(group.bonus, {}, group.label || "Initiative");
		await presentRoll(plugin, result);
		const score = Number(result?.total);
		if (!Number.isFinite(score)) return;
		applyGroupInitScore(combatants, group.key, score);
		if (reorder) {
			captureBaselineIfNeeded();
			combatants = reorderCombatantsByGroups(sortGroupsByInitiative(listKindGroups(combatants)));
		}
		emit();
		paintRoster();
	};

	const paintRoster = () => {
		const groups = listKindGroups(combatants);
		const flat = reorderCombatantsByGroups(groups);
		const changed = flat.length !== combatants.length
			|| flat.some((it, i) => it.id !== combatants[i]?.id);
		combatants = flat;
		if (changed) emit();
		else syncInitToolbar();
		const scrollTop = rosterEl.scrollTop || 0;
		rosterEl.empty();
		if (!combatants.length) {
			rosterEl.createEl("p", {cls: "fiveetools-view__meta", text: "No creatures yet."});
			syncInitToolbar();
			return;
		}
		for (const group of listKindGroups(combatants)) {
			const shell = rosterEl.createDiv({cls: "fiveetools-encounter__group"});
			const head = shell.createDiv({cls: "fiveetools-encounter__group-head"});
			const title = head.createDiv({cls: "fiveetools-encounter__group-title"});
			title.createEl("span", {
				cls: "fiveetools-encounter__group-name",
				text: group.members.length > 1 ? `${group.label} ×${group.members.length}` : group.label,
			});
			const headActions = head.createDiv({cls: "fiveetools-encounter__group-actions"});
			const initBtn = headActions.createEl("button", {
				text: `Init ${formatBonus(group.bonus)}`,
				cls: "fiveetools-encounter__init",
				attr: {type: "button", title: "Roll initiative for this group"},
			});
			initBtn.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				void rollGroupInitiative(group, {reorder: false});
			});
			headActions.createEl("span", {
				cls: `fiveetools-encounter__init-score${group.initScore != null ? " has-score" : ""}`,
				text: group.initScore != null ? String(group.initScore) : "—",
				attr: {title: "Initiative score"},
			});
			paintGroupSharedStats(shell, group.members[0]);
			const body = shell.createDiv({cls: "fiveetools-encounter__group-body"});
			for (const combatant of group.members) {
				renderCombatantRow(body, combatant, {
					app,
					plugin,
					selected: !previewKey && combatant.id === selectedId,
					onSelect: () => {
						previewKey = null;
						selectedId = combatant.id;
						emit();
						paintHits();
						syncRosterSelection();
						openSelected();
					},
					onHp: (nextHp) => {
						combatant.hpCurrent = nextHp;
						emit();
						paintRoster();
					},
					onTempHp: (nextTemp) => {
						combatant.tempHp = nextTemp;
						emit();
						paintRoster();
					},
					onCondition: (nextCond) => {
						combatant.condition = nextCond;
						emit();
						paintRoster();
					},
					onRemove: () => {
						combatants = combatants.filter(it => it.id !== combatant.id);
						if (selectedId === combatant.id) {
							selectedId = combatants[combatants.length - 1]?.id || null;
						}
						if (initOrderBaseline?.length) {
							initOrderBaseline = initOrderBaseline.filter(id => id !== combatant.id);
							if (!initOrderBaseline.length) initOrderBaseline = null;
						}
						emit();
						paintRoster();
						openSelected();
					},
				});
			}
		}
		rosterEl.scrollTop = scrollTop;
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
				paintSaves();
				const saved = getSavedEncounter(it.id);
				if (!saved) {
					emit();
					return;
				}
				if (savedId === saved.id) {
					emit();
					return;
				}
				loadPicked(saved.id);
			});
		}
	};

	const applySaved = (saved) => {
		combatants = groupCombatants(cloneCombatants(saved.combatants));
		selectedId = saved.selectedId && combatants.some(it => it.id === saved.selectedId)
			? saved.selectedId
			: (combatants[combatants.length - 1]?.id || null);
		name = saved.name;
		party = normalizeParty(saved.party);
		savedId = saved.id;
		pickedId = saved.id;
		previewKey = null;
		initOrderBaseline = Array.isArray(saved.initOrderBaseline)
			? saved.initOrderBaseline.map(String)
			: null;
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

	const loadPicked = (id) => {
		const saved = getSavedEncounter(id ?? pickedId);
		if (!saved) return;
		applySaved(saved);
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
	randomBtn.addEventListener("click", () => {
		openRandomEncounterModal(app, {
			party,
			onGenerate: async (opts) => {
				const apply = async () => {
					randomBtn.setAttr("disabled", "true");
					try {
						const result = await generateRandomEncounter(opts);
						combatants = result.combatants;
						selectedId = result.selectedId;
						party = normalizeParty(result.party);
						playersEl.value = String(party.count);
						levelEl.value = String(party.level);
						previewKey = null;
						showBlank = false;
						initOrderBaseline = null;
						emit();
						paintBlank();
						paintHits();
						paintRoster();
						openSelected();
						if (result.warning) new Notice(result.warning);
						else new Notice(`Random encounter: ${result.info.label} (${result.info.totalXp.toLocaleString()} XP)`);
					} catch (e) {
						new Notice(e.message || "Could not generate encounter.");
						throw e;
					} finally {
						randomBtn.removeAttribute("disabled");
					}
				};
				if (combatants.length) {
					confirmAction(app, {
						title: "Replace encounter?",
						message: "Random encounter will replace the current roster. Continue?",
						confirmLabel: "Replace",
						onConfirm: () => { void apply(); },
					});
				} else {
					await apply();
				}
			},
		});
	});
	rollAllBtn.addEventListener("click", async () => {
		const groups = listKindGroups(combatants);
		if (!groups.length) return;
		rollAllBtn.setAttr("disabled", "true");
		try {
			captureBaselineIfNeeded();
			for (const group of groups) {
				const result = rollInitiative(group.bonus, {}, group.label || "Initiative");
				await presentRoll(plugin, result);
				const score = Number(result?.total);
				if (Number.isFinite(score)) applyGroupInitScore(combatants, group.key, score);
			}
			combatants = reorderCombatantsByGroups(sortGroupsByInitiative(listKindGroups(combatants)));
			emit();
			paintRoster();
		} finally {
			rollAllBtn.removeAttribute("disabled");
			syncInitToolbar();
		}
	});
	resetOrderBtn.addEventListener("click", () => {
		if (!initOrderBaseline?.length) return;
		const byId = new Map(combatants.map(it => [it.id, it]));
		const restored = [];
		for (const id of initOrderBaseline) {
			const hit = byId.get(id);
			if (hit) {
				restored.push(hit);
				byId.delete(id);
			}
		}
		for (const left of byId.values()) restored.push(left);
		for (const c of restored) c.initScore = null;
		combatants = groupCombatants(restored);
		initOrderBaseline = null;
		emit();
		paintRoster();
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
		initOrderBaseline = null;
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
				initOrderBaseline,
			});
			await saveEncountersToVault(plugin);
			savedId = saved.id;
			pickedId = saved.id;
			name = saved.name;
			nameEl.value = name;
			emit();
			paintSaves();
			new Notice(`Saved ${saved.name}.`);
			await onSaved?.(saved);
		} catch (e) {
			new Notice(e.message || "Could not save encounter.");
		}
	});
	loadBtn.addEventListener("click", () => loadPicked(pickedId));
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
		initOrderBaseline = null;
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

export function paintGroupSharedStats (parent, sample) {
	if (!sample) return;
	const strip = parent.createDiv({cls: "fiveetools-encounter__group-stats"});
	const crLine = [sample.cr ? `CR ${sample.cr}` : null, sample.doc?.sA || sample.doc?.s].filter(Boolean).join(" · ");
	if (crLine) strip.createEl("div", {cls: "fiveetools-encounter__group-meta", text: crLine});
	const stats = strip.createDiv({cls: "fiveetools-encounter__stats"});
	stats.createEl("span", {text: `AC ${sample.ac != null ? sample.ac : "—"}`});
	stats.createEl("span", {text: `HP ${sample.hpMax != null ? sample.hpMax : "—"}`});
	const dex = sample.dex ?? dexFromEnt(sample.ent);
	stats.createEl("span", {text: dex != null ? `Dex ${dex}` : "Dex —", attr: {title: "Dexterity"}});
}

export function renderCombatantRow (parent, combatant, {
	app,
	plugin,
	selected,
	onSelect,
	onHp,
	onTempHp,
	onCondition,
	onRemove,
}) {
	const row = parent.createDiv({
		cls: `fiveetools-encounter__combatant${selected ? " is-selected" : ""}${combatant.hpCurrent <= 0 ? " is-down" : ""}`,
		attr: {"data-id": combatant.id},
	});
	row.addEventListener("click", (evt) => {
		if (evt.target.closest(".fiveetools-encounter__controls, .fiveetools-encounter__remove")) return;
		onSelect();
	});

	const top = row.createDiv({cls: "fiveetools-encounter__who"});
	top.createEl("div", {cls: "fiveetools-modal__name", text: combatant.label});
	const remove = top.createEl("button", {
		text: "×",
		cls: "fiveetools-encounter__hpbtn fiveetools-encounter__remove",
		attr: {type: "button", title: "Remove"},
	});
	remove.addEventListener("click", (evt) => {
		evt.stopPropagation();
		confirmRemove(app, combatant.label, onRemove);
	});

	const controls = row.createDiv({cls: "fiveetools-encounter__controls"});
	const hp = controls.createDiv({cls: "fiveetools-encounter__hp"});
	const minus = hp.createEl("button", {text: "−", cls: "fiveetools-encounter__hpbtn", attr: {type: "button", title: "−1 HP"}});
	const input = hp.createEl("input", {
		cls: "fiveetools-encounter__hpinput",
		attr: {type: "number", value: String(combatant.hpCurrent), title: "Current HP"},
	});
	hp.createEl("span", {cls: "fiveetools-encounter__hpmax", text: `/ ${combatant.hpMax}`});
	const plus = hp.createEl("button", {text: "+", cls: "fiveetools-encounter__hpbtn", attr: {type: "button", title: "+1 HP"}});

	const temp = controls.createEl("input", {
		cls: "fiveetools-encounter__tempinput",
		attr: {
			type: "number",
			min: "0",
			value: String(combatant.tempHp ?? 0),
			title: "Temporary HP",
			placeholder: "Temp",
		},
	});
	const cond = controls.createEl("select", {
		cls: "fiveetools-encounter__condition",
		attr: {title: "Condition"},
	});
	cond.createEl("option", {attr: {value: ""}, text: "—"});
	for (const it of CONDITIONS) {
		cond.createEl("option", {attr: {value: it.id}, text: it.label});
	}
	cond.value = combatant.condition || "";

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
	temp.addEventListener("click", (evt) => evt.stopPropagation());
	temp.addEventListener("change", () => {
		const typed = Number(temp.value);
		const next = Number.isFinite(typed) ? Math.max(0, Math.floor(typed)) : (combatant.tempHp ?? 0);
		onTempHp?.(next);
	});
	cond.addEventListener("click", (evt) => evt.stopPropagation());
	cond.addEventListener("change", () => {
		onCondition?.(cond.value || "");
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

class RandomEncounterModal extends Modal {
	constructor (app, {party, onGenerate}) {
		super(app);
		this.party = normalizeParty(party);
		this.onGenerate = onGenerate;
	}

	onOpen () {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass("fiveetools-encounter-random");
		contentEl.createEl("h2", {text: "Random encounter"});
		contentEl.createEl("p", {
			cls: "fiveetools-view__meta",
			text: "Builds a 2024 XP budget for the party size below. Official and homebrew creatures are included.",
		});

		const form = contentEl.createDiv({cls: "fiveetools-encounter-random__form"});
		const players = addSelectField(form, "Players", 1, 12, this.party.count);
		const level = addSelectField(form, "Level", 1, 20, this.party.level);
		const difficulty = addOptionField(form, "Difficulty", DIFFICULTY_OPTIONS, "moderate");
		const type = addOptionField(form, "Type", ENCOUNTER_TYPES, "group");
		const setting = addOptionField(form, "Setting", SETTING_OPTIONS, "");
		const habitat = addOptionField(form, "Habitat", habitatSelectOptions(), "");
		const theme = addOptionField(form, "Theme", THEME_OPTIONS, "");

		const actions = contentEl.createDiv({cls: "fiveetools-encounter__row"});
		const cancel = actions.createEl("button", {text: "Cancel", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button"}});
		const ok = actions.createEl("button", {text: "Generate", cls: "fiveetools-btn", attr: {type: "button"}});
		cancel.addEventListener("click", () => this.close());
		ok.addEventListener("click", async () => {
			ok.setAttr("disabled", "true");
			try {
				await this.onGenerate?.({
					party: normalizeParty({count: players.value, level: level.value}),
					difficulty: difficulty.value || "moderate",
					type: type.value || "group",
					setting: setting.value || "",
					habitat: habitat.value || "",
					theme: theme.value || "",
				});
				this.close();
			} catch (e) {
				new Notice(e.message || "Could not generate encounter.");
				ok.removeAttribute("disabled");
			}
		});
	}

	onClose () {
		this.contentEl.empty();
	}
}

function openRandomEncounterModal (app, {party, onGenerate}) {
	if (!app) {
		new Notice("Random encounter needs the Obsidian app.");
		return;
	}
	new RandomEncounterModal(app, {party, onGenerate}).open();
}

function addSelectField (host, label, min, max, value) {
	const wrap = host.createDiv({cls: "fiveetools-homebrew__field"});
	wrap.createEl("label", {text: label});
	const sel = wrap.createEl("select");
	fillNumberSelect(sel, min, max, value);
	return sel;
}

function addOptionField (host, label, options, value) {
	const wrap = host.createDiv({cls: "fiveetools-homebrew__field"});
	wrap.createEl("label", {text: label});
	const sel = wrap.createEl("select");
	for (const opt of options) {
		sel.createEl("option", {attr: {value: String(opt.id)}, text: opt.label});
	}
	sel.value = String(value ?? "");
	return sel;
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
	globalThis.FiveEToolsObsidian.dexFromEnt = dexFromEnt;
	globalThis.FiveEToolsObsidian.passiveFromEnt = passiveFromEnt;
	globalThis.FiveEToolsObsidian.groupCombatants = groupCombatants;
	globalThis.FiveEToolsObsidian.listKindGroups = listKindGroups;
	globalThis.FiveEToolsObsidian.sortGroupsByInitiative = sortGroupsByInitiative;
	globalThis.FiveEToolsObsidian.adjustHp = adjustHp;
	globalThis.FiveEToolsObsidian.encounterDifficulty = encounterDifficulty;
	globalThis.FiveEToolsObsidian.normalizeParty = normalizeParty;
}
