import {setIcon, Notice} from "obsidian";
import {characterName, listCharacters} from "./character-store.js";
import {abilityMod, attackFromCr, combatTraits, crOptions, crProfile, creatureSaves, creatureTurn, creatureType, formatNum, normalizeDefenses} from "./dpr-calc.js";
import {combineReports, createFight, rollFightInitiative, runFight, stepRound, stepTurn, summarize} from "./dpr-sim.js";
import {planTurn} from "./dpr-ai.js";
import {
	acOf,
	avatarFrom,
	characterId,
	clamp,
	encounterCreatures,
	field,
	hpOf,
	parseSpeed,
	saveMod,
	slotPool,
	sourcesFor,
} from "./dpr-view.js";
import {getSavedEncounter, listSavedEncounters, loadEncountersFromVault, queueSaveEncountersToVault, saveSavedEncounter, setEncounterInstance, upsertSavedEncounter} from "./encounter-store.js";
import {encounterDifficulty} from "./encounter-difficulty.js";
import {clearSearchInput, createSearchInput} from "./search-field.js";
import {addCombatants, initiativeFromEnt, kindKey, listKindGroups, paintKindRoster} from "./encounter-view.js";
import {listCampaigns, listEntries} from "./campaign-store.js";
import {ensureSearchIndex, indexHomebrewDocs, searchEntities} from "./search-index.js";
import {loadEntity} from "./entity-loader.js";
import {resolveTokenImage} from "./image-resolver.js";

const SVG = "http://www.w3.org/2000/svg";
const RUN_COUNTS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

function runCount (value) {
	const n = Number(value);
	if (RUN_COUNTS.includes(n)) return n;
	if (!Number.isFinite(n)) return 1;
	return RUN_COUNTS.reduce((best, option) => Math.abs(option - n) < Math.abs(best - n) ? option : best);
}

export function renderSimTool (listEl, readerEl, {plugin, session = {}, onSessionChange, onOpenEncounter} = {}) {
	listEl.empty();
	listEl.addClass("fiveetools-sim");
	readerEl?.empty();
	readerEl?.addClass("fiveetools-sim-reader");
	stopSimTimer(plugin);

	const state = {
		partyIds: new Set(savedParty(session, [])),
		threat: session.threat === "encounter" || session.threat === "creatures" ? session.threat : "cr",
		added: restoreAdded(session),
		cr: String(session.cr || "1"),
		monsters: clamp(session.monsters, 1, 10, 1),
		encounterId: String(session.encounterId || ""),
		simCount: runCount(session.simCount),
		initStyle: session.initStyle === "players" ? "players" : "current",
		openEncounter: onOpenEncounter,
		encounterGen: 0,
		characters: [],
		sheets: {},
		creatures: [],
		fight: null,
		reports: [],
		token: 0,
	};

	listEl.createEl("h3", {text: "Simulation"});
	listEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Dice and a 5-foot grid. Each creature uses its best option. Run plays a fight from the start. Play steps one creature at a time.",
	});
	const setupEl = listEl.createDiv();
	const controlsEl = listEl.createDiv({cls: "fiveetools-dpr__controls"});
	const resultsEl = readerEl || listEl.createDiv();
	resultsEl.createEl("p", {cls: "fiveetools-view__meta", text: "Loading characters…"});

	const emit = () => {
		onSessionChange?.({
			partyIds: [...state.partyIds],
			threat: state.threat,
			cr: state.cr,
			monsters: state.monsters,
			encounterId: state.encounterId,
			added: state.added.map(storedCombatant),
			simCount: state.simCount,
			simPace: state.simPace,
			initStyle: initStyle(state),
		});
	};

	const refresh = () => {
		if (!listEl.isConnected || !listEl.classList.contains("fiveetools-sim")) return;
		emit();
		state.paintDifficulty?.();
		paintSimControls(controlsEl, state, plugin, refresh);
		ensureSim(resultsEl, state);
	};

	void start();

	async function start () {
		const token = ++state.token;
		try {
			await loadEncountersFromVault(plugin);
			await ensureSearchIndex(plugin);
			indexHomebrewDocs();
		} catch (_) { /* the CR table still works */ }
		state.characters = await listCharacters(plugin);
		if (token !== state.token) return;
		if (!state.characters.length) {
			setupEl.createEl("p", {text: "Import a character under Player → Characters first."});
			controlsEl.empty();
			resultsEl.empty();
			return;
		}
		const known = new Set(state.characters.map(characterId));
		state.partyIds = new Set(savedParty(session, state.characters).filter(id => known.has(id)));
		state.added = await upgradeAdded(plugin, state.added);
		try {
			state.campaigns = await listCampaigns(plugin);
		} catch (_) { state.campaigns = []; }
		paintParty(setupEl, state, plugin, () => { void loadSources(); }, () => { void refreshEncounter(); });
		await loadSources();
	}

	async function refreshEncounter () {
		const gen = ++state.encounterGen;
		state.creatures = await foesFor(state, plugin);
		if (gen !== state.encounterGen || !listEl.isConnected || !listEl.classList.contains("fiveetools-sim")) return;
		placeFight(state, plugin);
		refresh();
	}

	async function loadSources () {
		const token = ++state.token;
		controlsEl.empty();
		resultsEl.empty();
		resultsEl.createEl("p", {cls: "fiveetools-view__meta", text: "Reading spells…"});
		stopSimTimer(plugin);
		state.fight = null;
		state.reports = [];
		const sheets = {};
		for (const record of partyRecords(state)) {
			sheets[characterId(record)] = await sourcesFor(plugin, record);
			if (token !== state.token) return;
		}
		state.sheets = sheets;
		const gen = ++state.encounterGen;
		state.creatures = await foesFor(state, plugin);
		if (gen !== state.encounterGen || token !== state.token || !listEl.isConnected || !listEl.classList.contains("fiveetools-sim")) return;
		placeFight(state, plugin);
		refresh();
	}
}

function foesFor (state, plugin) {
	if (state.threat === "encounter") return savedEncounterFoes(plugin, state.encounterId);
	if (state.threat === "creatures") return loadAdded(plugin, state.added);
	return [];
}

async function savedEncounterFoes (plugin, encounterId) {
	const creatures = await encounterCreatures(plugin, encounterId);
	const saved = getSavedEncounter(encounterId);
	return creatures.map((creature, index) => {
		const current = Number(saved?.combatants?.[index]?.hpCurrent);
		const maxHp = creature.hp;
		return {
			...creature,
			maxHp,
			hp: Number.isFinite(current) ? current : maxHp,
		};
	});
}

function storedCombatant (row) {
	return {
		id: row.id,
		label: row.label || row.name || row.doc?.n || "Creature",
		doc: row.doc ? {...row.doc} : null,
		ent: row.ent ? JSON.parse(JSON.stringify(row.ent)) : null,
		...(row.scaleBase ? {scaleBase: JSON.parse(JSON.stringify(row.scaleBase))} : {}),
		hpMax: row.hpMax ?? null,
		hpCurrent: row.hpCurrent ?? row.hp ?? null,
		tempHp: row.tempHp ?? 0,
		condition: row.condition || "",
		cr: row.cr ?? "",
		ac: row.ac ?? null,
		initiative: row.initiative ?? null,
		dex: row.dex ?? null,
		passive: row.passive ?? null,
		initScore: row.initScore ?? null,
		custom: row.custom || undefined,
	};
}

function hasInstanceHp (row) {
	return row?.hpMax != null || row?.hpCurrent != null || row?.hp != null;
}

function restoreAdded (session) {
	const rows = [];
	for (const row of session?.added || []) {
		if (!row?.doc?.n && !row?.label && !row?.name) continue;
		if (hasInstanceHp(row)) rows.push(storedCombatant(row));
		else if (row.doc?.n) {
			rows.push({
				legacy: true,
				name: String(row.name || row.doc.n),
				doc: {
					n: row.doc.n,
					u: row.doc.u || "",
					s: row.doc.s || "",
					c: row.doc.c,
					cf: row.doc.cf,
					sA: row.doc.sA,
				},
			});
		}
	}
	return rows;
}

async function upgradeAdded (plugin, rows) {
	const combatants = [];
	const legacy = [];
	for (const row of rows || []) {
		if (row?.legacy) legacy.push(row);
		else combatants.push(row);
	}
	let session = {combatants};
	for (const row of legacy) {
		try {
			const next = await addCombatants(session, row.doc, 1);
			const added = next.added?.[0];
			if (added && row.name) added.label = String(row.name);
			session = {combatants: next.combatants};
		} catch (_) { /* skip a creature that will not load */ }
	}
	return session.combatants;
}

async function loadAdded (plugin, added) {
	const creatures = [];
	for (const row of added || []) {
		let ent = row.ent || null;
		let attacks = [];
		let image = "";
		let speed = 30;
		let defenses = normalizeDefenses(null);
		let int = null;
		let ac = 10;
		let hp = 1;
		let maxHp = 1;
		let cr = "";
		let saveMods = null;
		let type = "";
		let traits = null;
		let initMod = null;
		try {
			if (!ent && row.doc) ent = (await loadEntity(row.doc))?.ent || null;
			attacks = creatureTurn(ent);
			defenses = normalizeDefenses(ent);
			saveMods = ent ? creatureSaves(ent) : null;
			type = creatureType(ent);
			traits = ent ? combatTraits(ent) : null;
			initMod = initiativeFromEnt(ent);
			const token = ent ? resolveTokenImage(ent, {imageBaseUrl: plugin?.settings?.imageBaseUrl}) : null;
			image = token?.url || "";
			const walk = ent?.speed?.walk ?? ent?.speed;
			speed = Number(walk) || 30;
			int = Number.isFinite(Number(ent?.int)) ? Number(ent.int) : null;
			const acNum = Number(row.ac);
			ac = Number.isFinite(acNum) && acNum > 0 ? acNum : acFromEnt(ent);
			const current = Number(row.hpCurrent);
			const templateMax = Number(row.hpMax);
			const book = hpFromEnt(ent);
			maxHp = Number.isFinite(templateMax) && templateMax > 0 ? templateMax : book;
			hp = Number.isFinite(current) ? current : maxHp;
			cr = row.cr || crFromEnt(ent);
		} catch (_) { /* skip a creature that will not load */ }
		creatures.push({
			name: row.label || row.name || row.doc?.n || "Creature",
			ac,
			hp,
			maxHp,
			cr,
			attacks,
			image,
			speed,
			defenses,
			int,
			saveMods,
			type,
			traits,
			kind: kindKey({doc: row.doc, label: row.label || row.name, ent: row.ent}),
			initMod: Number.isFinite(initMod) ? initMod : 2,
		});
	}
	return creatures;
}

function acFromEnt (ent) {
	const ac = ent?.ac;
	if (Number.isFinite(Number(ac))) return Number(ac);
	const first = Array.isArray(ac) ? ac[0] : null;
	const value = Number(first?.ac ?? first);
	return Number.isFinite(value) && value > 0 ? value : 10;
}

function hpFromEnt (ent) {
	const hp = ent?.hp;
	const average = Number(hp?.average ?? hp);
	return Number.isFinite(average) && average > 0 ? average : 1;
}

function crFromEnt (ent) {
	const cr = ent?.cr;
	if (cr && typeof cr === "object") return String(cr.cr ?? "");
	return cr == null ? "" : String(cr);
}

function copyCombatants (list) {
	return (list || []).map(storedCombatant);
}

function savedParty (session, characters) {
	const ids = Array.isArray(session?.partyIds) ? session.partyIds.map(String) : [];
	if (!characters.length) return ids;
	const all = characters.map(characterId);
	if (ids.length === all.length && all.every(id => ids.includes(id))) return [];
	return ids;
}

function partyRecords (state) {
	return state.characters.filter(record => state.partyIds.has(characterId(record)));
}

function paintParty (host, state, plugin, onParty, onThreat) {
	host.empty();
	host.createEl("h4", {text: "Party"});
	const campRow = field(host, "Campaign");
	const campEl = campRow.createEl("select");
	campEl.createEl("option", {text: state.campaigns?.length ? "Add players…" : "No campaigns", attr: {value: ""}});
	for (const camp of state.campaigns || []) {
		campEl.createEl("option", {text: camp.name || camp.slug, attr: {value: camp.slug}});
	}
	campEl.addEventListener("change", () => {
		const slug = campEl.value;
		campEl.value = "";
		if (slug) void addCampaignPlayers(slug);
	});
	const addCampaignPlayers = async (slug) => {
		let entries = [];
		try {
			entries = await listEntries(plugin, slug, "players");
		} catch (_) { entries = []; }
		const known = new Set(state.characters.map(characterId));
		const ids = [];
		for (const entry of entries) {
			const id = String(entry.fields?.character || "").trim();
			if (id && known.has(id) && !ids.includes(id)) ids.push(id);
		}
		if (!ids.length) {
			new Notice("That campaign has no linked characters.");
			return;
		}
		for (const id of ids) state.partyIds.add(id);
		paintMembers();
		paintChoices();
		onParty();
	};
	const membersEl = host.createDiv({cls: "fiveetools-sim__members"});
	const finder = host.createDiv({cls: "fiveetools-sim__combo"});
	const query = createSearchInput(finder, {placeholder: "Add a character"});
	const menu = finder.createDiv({cls: "fiveetools-sim__combo-menu"});
	let menuOpen = false;

	const available = () => state.characters.filter(record => !state.partyIds.has(characterId(record)));
	const matchesFor = () => {
		const needle = query.value.trim().toLowerCase();
		return available().filter(record => !needle || characterName(record).toLowerCase().includes(needle));
	};
	const addCharacter = (id) => {
		if (!id || state.partyIds.has(id)) return;
		state.partyIds.add(id);
		clearSearchInput(query, {focus: true});
		menuOpen = true;
		paintMembers();
		paintChoices();
		onParty();
	};
	const paintChoices = () => {
		menu.empty();
		menu.toggleClass("is-open", menuOpen);
		if (!menuOpen) return;
		const matches = matchesFor();
		if (!matches.length) {
			menu.createDiv({cls: "fiveetools-sim__combo-empty", text: "No characters"});
			return;
		}
		for (const record of matches) {
			const id = characterId(record);
			const item = menu.createDiv({cls: "fiveetools-sim__combo-item", text: characterName(record)});
			item.addEventListener("mousedown", (evt) => {
				evt.preventDefault();
				addCharacter(id);
			});
		}
	};
	const paintMembers = () => {
		membersEl.empty();
		const members = partyRecords(state);
		if (!members.length) {
			membersEl.createEl("p", {cls: "fiveetools-view__meta", text: "Add a character."});
			return;
		}
		for (const record of members) {
			const id = characterId(record);
			const row = membersEl.createDiv({cls: "fiveetools-sim__member"});
			row.createSpan({text: `${characterName(record)} · AC ${acOf(record) ?? "—"} · HP ${hpOf(record) || "—"}`});
			const remove = row.createEl("button", {text: "Remove", cls: "fiveetools-btn"});
			remove.addEventListener("click", () => {
				state.partyIds.delete(id);
				paintMembers();
				paintChoices();
				onParty();
			});
		}
	};
	query.addEventListener("focus", () => {
		menuOpen = true;
		paintChoices();
	});
	query.addEventListener("click", () => {
		menuOpen = true;
		paintChoices();
	});
	query.addEventListener("input", () => {
		menuOpen = true;
		paintChoices();
	});
	query.addEventListener("keydown", (evt) => {
		if (evt.key === "Escape") {
			menuOpen = false;
			paintChoices();
			return;
		}
		if (evt.key !== "Enter") return;
		evt.preventDefault();
		const first = matchesFor()[0];
		if (first) addCharacter(characterId(first));
	});
	query.addEventListener("blur", () => {
		menuOpen = false;
		paintChoices();
	});
	paintMembers();
	paintChoices();

	const threatRow = field(host, "Against");
	const threatEl = threatRow.createEl("select");
	threatEl.createEl("option", {text: "Challenge rating", attr: {value: "cr"}});
	threatEl.createEl("option", {text: "Saved encounter", attr: {value: "encounter"}});
	threatEl.createEl("option", {text: "Added creatures", attr: {value: "creatures"}});
	threatEl.value = state.threat;

	const creatureWrap = host.createDiv({cls: "fiveetools-sim__creatures"});
	const searchRow = creatureWrap.createDiv({cls: "fiveetools-encounter__row"});
	const searchEl = createSearchInput(searchRow, {
		cls: "fiveetools-encounter__search",
		placeholder: "Add creature…",
	});
	const hitsEl = creatureWrap.createDiv({cls: "fiveetools-encounter__hits"});
	const addedEl = creatureWrap.createDiv({cls: "fiveetools-encounter__roster"});
	const sendBtn = creatureWrap.createEl("button", {
		text: "Send to encounter",
		cls: "fiveetools-btn",
		attr: {type: "button"},
	});
	const commitAdded = () => {
		paintAdded();
		onThreat();
	};
	const paintAdded = () => {
		sendBtn.disabled = !state.added.length;
		paintKindRoster(addedEl, state.added, {
			app: plugin.app,
			plugin,
			emptyText: "Search to add a creature.",
			onHp: (combatant, nextHp) => {
				combatant.hpCurrent = nextHp;
				commitAdded();
			},
			onTempHp: (combatant, nextTemp) => {
				combatant.tempHp = nextTemp;
				commitAdded();
			},
			onCondition: (combatant, nextCond) => {
				combatant.condition = nextCond;
				commitAdded();
			},
			onRemove: (combatant) => {
				state.added = state.added.filter(it => it.id !== combatant.id);
				commitAdded();
			},
			onRemoveGroup: (group) => {
				const ids = new Set(group.members.map(member => member.id));
				state.added = state.added.filter(it => !ids.has(it.id));
				commitAdded();
			},
		});
	};
	let hitDocs = [];
	let hitIndex = 0;
	const addHit = async (doc) => {
		if (!doc) return;
		try {
			const next = await addCombatants({combatants: state.added}, doc, 1);
			state.added = next.combatants;
		} catch (e) {
			new Notice(e.message || "Could not add that creature.");
			return;
		}
		clearSearchInput(searchEl, {focus: true});
		hitDocs = [];
		hitIndex = 0;
		hitsEl.empty();
		commitAdded();
	};
	const markHit = () => {
		const rows = [...hitsEl.querySelectorAll(".fiveetools-encounter__hit")];
		rows.forEach((row, index) => {
			row.classList.toggle("is-selected", index === hitIndex);
			if (index === hitIndex) row.scrollIntoView({block: "nearest"});
		});
	};
	const paintHits = () => {
		hitsEl.empty();
		hitIndex = 0;
		const term = searchEl.value.trim();
		if (term.length < 2) {
			hitDocs = [];
			return;
		}
		hitDocs = searchEntities(term, {categoriesExact: ["bestiary"], limit: 8});
		if (!hitDocs.length) {
			hitsEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No creatures."});
			return;
		}
		hitDocs.forEach((doc, index) => {
			const hit = hitsEl.createDiv({cls: `fiveetools-encounter__hit${index === 0 ? " is-selected" : ""}`});
			const meta = hit.createDiv({cls: "fiveetools-encounter__hitmeta"});
			meta.createEl("div", {cls: "fiveetools-modal__name", text: doc.n});
			meta.createEl("div", {cls: "fiveetools-modal__sub", text: [doc.sA || doc.s, doc.cf].filter(Boolean).join(" · ")});
			hit.addEventListener("click", () => { void addHit(doc); });
		});
	};
	searchEl.addEventListener("input", paintHits);
	searchEl.addEventListener("keydown", (evt) => {
		if (evt.key === "ArrowDown" || evt.key === "ArrowUp") {
			if (!hitDocs.length) return;
			evt.preventDefault();
			const next = evt.key === "ArrowDown" ? hitIndex + 1 : hitIndex - 1;
			hitIndex = Math.max(0, Math.min(hitDocs.length - 1, next));
			markHit();
			return;
		}
		if (evt.key !== "Enter") return;
		evt.preventDefault();
		void addHit(hitDocs[hitIndex]);
	});
	const sendAddedToEncounter = () => {
		if (!state.added.length) {
			new Notice("No creatures to send.");
			return;
		}
		const combatants = copyCombatants(state.added);
		const name = listKindGroups(combatants).map(group => (
			group.members.length > 1 ? `${group.label} ×${group.members.length}` : group.label
		)).join(", ");
		state.token += 1;
		state.encounterGen += 1;
		stopSimTimer(plugin);
		plugin._encounterSession = {
			combatants,
			selectedId: combatants[combatants.length - 1]?.id || null,
			name,
			savedId: null,
			pickedId: null,
		};
		if (state.openEncounter) state.openEncounter();
	};
	sendBtn.addEventListener("click", () => { void sendAddedToEncounter(); });
	paintAdded();

	const crWrap = host.createDiv();
	const crRow = field(crWrap, "CR");
	const crEl = crRow.createEl("select");
	for (const cr of crOptions()) crEl.createEl("option", {text: cr, attr: {value: cr}});
	if (crProfile(state.cr)) crEl.value = state.cr;
	crEl.addEventListener("change", () => {
		state.cr = crEl.value;
		onThreat();
	});
	const countRow = field(crWrap, "Monsters");
	const countEl = countRow.createEl("select", {attr: {title: "How many of that challenge rating"}});
	for (let n = 1; n <= 10; n++) countEl.createEl("option", {text: String(n), attr: {value: String(n)}});
	countEl.value = String(state.monsters);
	countEl.addEventListener("change", () => {
		state.monsters = clamp(countEl.value, 1, 10, 1);
		countEl.value = String(state.monsters);
		onThreat();
	});

	const encWrap = host.createDiv();
	const encRow = field(encWrap, "Encounter");
	const encEl = encRow.createEl("select");
	const saved = listSavedEncounters();
	encEl.createEl("option", {text: saved.length ? "Choose…" : "No saved encounters", attr: {value: ""}});
	for (const encounter of saved) {
		encEl.createEl("option", {text: encounter.name || "Encounter", attr: {value: encounter.id}});
	}
	if (saved.some(it => it.id === state.encounterId)) encEl.value = state.encounterId;
	const encRoster = encWrap.createDiv({cls: "fiveetools-encounter__roster"});
	const editSaved = (mutate) => {
		const savedEncounter = getSavedEncounter(state.encounterId);
		if (!savedEncounter) return;
		const combatants = savedEncounter.combatants || [];
		mutate(combatants);
		let baseline = Array.isArray(savedEncounter.initOrderBaseline) ? savedEncounter.initOrderBaseline.map(String) : null;
		if (baseline) {
			const ids = new Set(combatants.map(it => it.id));
			baseline = baseline.filter(id => ids.has(id));
			if (!baseline.length) baseline = null;
		}
		const selectedId = combatants.some(it => it.id === savedEncounter.selectedId)
			? savedEncounter.selectedId
			: (combatants[combatants.length - 1]?.id || null);
		const next = upsertSavedEncounter({
			id: savedEncounter.id,
			name: savedEncounter.name,
			combatants,
			selectedId,
			party: savedEncounter.party,
			initOrderBaseline: baseline,
		});
		const live = plugin._encounterSession;
		if (live && (live.savedId === savedEncounter.id || live.pickedId === savedEncounter.id)) {
			plugin._encounterSession = {
				...live,
				combatants: copyCombatants(next.combatants),
				selectedId: next.selectedId,
			};
			setEncounterInstance(plugin._encounterSession);
		}
		void saveSavedEncounter(plugin, next);
		queueSaveEncountersToVault(plugin);
		paintSavedRoster();
		onThreat();
	};
	const paintSavedRoster = () => {
		const savedEncounter = getSavedEncounter(state.encounterId);
		paintKindRoster(encRoster, savedEncounter?.combatants || [], {
			app: plugin.app,
			plugin,
			emptyText: state.encounterId ? "No creatures in this encounter." : "Choose an encounter.",
			onHp: (combatant, nextHp) => editSaved((combatants) => {
				const hit = combatants.find(it => it.id === combatant.id);
				if (hit) hit.hpCurrent = nextHp;
			}),
			onTempHp: (combatant, nextTemp) => editSaved((combatants) => {
				const hit = combatants.find(it => it.id === combatant.id);
				if (hit) hit.tempHp = nextTemp;
			}),
			onCondition: (combatant, nextCond) => editSaved((combatants) => {
				const hit = combatants.find(it => it.id === combatant.id);
				if (hit) hit.condition = nextCond;
			}),
			onRemove: (combatant) => editSaved((combatants) => {
				const ix = combatants.findIndex(it => it.id === combatant.id);
				if (ix >= 0) combatants.splice(ix, 1);
			}),
			onRemoveGroup: (group) => editSaved((combatants) => {
				const ids = new Set(group.members.map(member => member.id));
				for (let i = combatants.length - 1; i >= 0; i--) {
					if (ids.has(combatants[i].id)) combatants.splice(i, 1);
				}
			}),
		});
	};
	encEl.addEventListener("change", () => {
		state.encounterId = encEl.value;
		paintSavedRoster();
		onThreat();
	});
	paintSavedRoster();

	const showThreat = () => {
		crWrap.style.display = state.threat === "cr" ? "" : "none";
		encWrap.style.display = state.threat === "encounter" ? "" : "none";
		creatureWrap.style.display = state.threat === "creatures" ? "" : "none";
	};
	threatEl.addEventListener("change", () => {
		state.threat = threatEl.value;
		showThreat();
		onThreat();
	});
	showThreat();
	const diffWrap = host.createDiv({cls: "fiveetools-sim__difficulty"});
	const diffEl = diffWrap.createDiv({cls: "fiveetools-encounter__diff"});
	const xpEl = diffWrap.createDiv({cls: "fiveetools-encounter__xp"});
	state.paintDifficulty = () => paintSimDifficulty(diffEl, xpEl, state);
	state.paintDifficulty();
}

function paintSimDifficulty (diffEl, xpEl, state) {
	const levels = partyRecords(state).map(record => Number(record.fields?.level) || 1);
	const info = encounterDifficulty({
		combatants: difficultyCreatures(state),
		levels,
		party: {count: Math.max(1, levels.length), level: levels[0] || 1},
	});
	diffEl.setText(levels.length && info.difficulty ? `Difficulty: ${info.label}` : "Difficulty: —");
	xpEl.setText(levels.length && info.difficulty ? `${info.totalXp.toLocaleString()} XP · ${info.xpPerPlayer.toLocaleString()} per player` : "");
}

function difficultyCreatures (state) {
	if (state.threat === "cr") {
		const profile = crProfile(state.cr) || crProfile("1");
		return Array.from({length: state.monsters}, () => ({cr: profile.cr}));
	}
	return (state.creatures || []).map(creature => ({cr: creature.cr}));
}

function ensureSim (host, state) {
	let sim = host.querySelector(".fiveetools-dpr__sim");
	if (!sim) sim = host.createDiv({cls: "fiveetools-dpr__sim"});
	sim.empty();
	if (state.runLabel) sim.createEl("p", {cls: "fiveetools-view__meta", text: state.runLabel});
	if (!partyRecords(state).length) {
		sim.createEl("p", {cls: "fiveetools-view__meta", text: "Add a character to the party."});
		return;
	}
	paintBoard(sim, state.fight);
	paintLog(sim, state.fight);
	paintReport(sim, state.reports, state.fight);
}

function paintSimControls (host, state, plugin, refresh) {
	host.empty();
	if (!partyRecords(state).length) return;
	const row = host.createDiv({cls: "fiveetools-dpr__sim-controls"});
	const count = row.createEl("select", {attr: {title: "How many fights to run"}});
	for (const n of RUN_COUNTS) count.createEl("option", {text: String(n), attr: {value: String(n)}});
	state.simCount = runCount(state.simCount);
	count.value = String(state.simCount);
	count.addEventListener("change", () => {
		state.simCount = runCount(count.value);
		count.value = String(state.simCount);
	});
	const pace = row.createEl("select", {attr: {title: "Pause between automatic turns"}});
	for (const ms of [400, 800, 1200, 2000, 3000]) {
		pace.createEl("option", {text: `${ms / 1000} s`, attr: {value: String(ms)}});
	}
	pace.value = String(simPace(state));
	pace.addEventListener("change", () => { state.simPace = Number(pace.value) || 800; });
	const style = row.createDiv({cls: "fiveetools-dpr__init-style"});
	for (const [value, label] of [["current", "Standard"], ["players", "Players first"]]) {
		const button = style.createEl("button", {
			text: label,
			cls: `fiveetools-btn${initStyle(state) === value ? " is-selected" : ""}`,
			attr: {type: "button"},
		});
		button.addEventListener("click", () => {
			if (initStyle(state) === value) return;
			state.initStyle = value;
			refresh();
		});
	}
	simButton(row, "Reset", () => { resetFight(state, plugin); refresh(); }, state.running);
	simButton(row, "Step turn", () => { stopSimTimer(plugin); beginFight(state, plugin); stepTurn(state.fight); refresh(); }, state.running);
	simButton(row, "Step round", () => { stopSimTimer(plugin); beginFight(state, plugin); stepRound(state.fight); refresh(); }, state.running);
	const playing = !!plugin._dprSimTimer;
	simIconButton(row, playing ? "pause" : "play", playing ? "Pause" : "Play", () => {
		if (plugin._dprSimTimer) {
			stopSimTimer(plugin);
			refresh();
			return;
		}
		startAuto(state, plugin, refresh);
	});
	simButton(row, state.running ? "Running…" : "Run", () => { void runMany(1); }, state.running);
	simButton(row, state.running ? "Running…" : "Run N", () => { void runMany(runCount(count.value)); }, state.running);

	async function runMany (n) {
		if (state.running) return;
		stopSimTimer(plugin);
		state.running = true;
		const total = runCount(n);
		const reports = [];
		let last = null;
		try {
			for (let i = 0; i < total; i++) {
				state.runLabel = total === 1 ? "Running the fight…" : `Running ${i + 1} of ${total}`;
				refresh();
				await waitFrame();
				last = rollFightInitiative(createFight(...simSides(state, plugin)), initStyle(state));
				runFight(last);
				reports.push(summarize(last));
				state.fight = last;
				state.reports = reports.slice();
			}
		} catch (err) {
			console.error(err);
			new Notice(err?.message || "The simulation stopped.");
		} finally {
			state.running = false;
			state.runLabel = "";
			refresh();
		}
	}
}

function waitFrame () {
	return new Promise(resolve => setTimeout(resolve, 0));
}

function placeFight (state, plugin) {
	stopSimTimer(plugin);
	state.reports = [];
	state.fight = partyRecords(state).length ? createFight(...simSides(state, plugin)) : null;
}

function resetFight (state, plugin) {
	placeFight(state, plugin);
	if (state.fight) rollFightInitiative(state.fight, initStyle(state));
}

function startAuto (state, plugin, refresh) {
	stopSimTimer(plugin);
	if (!state.fight || state.fight.over) resetFight(state, plugin);
	else rollFightInitiative(state.fight, initStyle(state));
	plugin._dprSimTimer = setInterval(() => {
		if (!state.fight || state.fight.over) {
			stopSimTimer(plugin);
			if (state.fight?.over) state.reports = [summarize(state.fight)];
			refresh();
			return;
		}
		stepTurn(state.fight);
		if (state.fight.over) {
			state.reports = [summarize(state.fight)];
			stopSimTimer(plugin);
		}
		refresh();
	}, simPace(state));
	refresh();
}

function saveModsFrom (record) {
	const out = {};
	for (const save of record?.snapshot?.rolls?.saves || []) {
		const key = String(save.key || "").toLowerCase();
		if (key) out[key] = Number(save.mod) || 0;
	}
	return out;
}

function simPace (state) {
	const pace = Number(state?.simPace);
	return [400, 800, 1200, 2000, 3000].includes(pace) ? pace : 800;
}

function initStyle (state) {
	return state?.initStyle === "players" ? "players" : "current";
}

export function stopSimTimer (plugin) {
	if (!plugin?._dprSimTimer) return;
	clearInterval(plugin._dprSimTimer);
	plugin._dprSimTimer = null;
}

function beginFight (state, plugin) {
	if (!state.fight || state.fight.over) {
		state.fight = createFight(...simSides(state, plugin));
		state.reports = [];
	}
	rollFightInitiative(state.fight, initStyle(state));
}

function medicineModOf (record) {
	const skills = record.snapshot?.rolls?.skills || [];
	const skill = skills.find(it => /^medicine$/i.test(String(it?.name || "").trim()));
	if (skill && Number.isFinite(Number(skill.mod))) return Number(skill.mod);
	return abilityMod(record.snapshot?.abilities?.wis);
}

function simSides (state, plugin) {
	const party = partyRecords(state).map(record => {
		const sheet = state.sheets[characterId(record)] || {attacks: [], spells: [], heals: [], swings: 1};
		return {
			name: characterName(record),
			ac: acOf(record) || 10,
			max: hpOf(record) || 1,
			speed: parseSpeed(record.fields?.speed),
			initMod: Number(record.snapshot?.rolls?.initiative) || 0,
			image: avatarFrom(plugin, record.body),
			options: [...(sheet.attacks || []), ...(sheet.spells || []), ...(sheet.heals || [])],
			extraSwings: sheet.swings || 1,
			characterLevel: Number(record.fields?.level) || 1,
			pool: slotPool(record.snapshot?.slots, true),
			classes: record.fields?.classes || "",
			int: Number(record.snapshot?.abilities?.int) || 10,
			defenses: normalizeDefenses(record.snapshot?.defenses),
			saveBonus: saveMod(record),
			saveMods: saveModsFrom(record),
			chaMod: abilityMod(record.snapshot?.abilities?.cha),
			wisMod: abilityMod(record.snapshot?.abilities?.wis),
			medicineMod: medicineModOf(record),
			spellDc: Number(record.snapshot?.spellcasting?.[0]?.dc) || (8 + abilityMod(record.snapshot?.abilities?.wis) + (Number(record.snapshot?.rolls?.proficiency) || 2)),
			pb: Number(record.snapshot?.rolls?.proficiency) || 2,
			type: "humanoid",
		};
	});
	return [party, simEnemies(state)];
}

function simEnemies (state) {
	if (state.threat === "creatures" || (state.threat === "encounter" && state.creatures.length)) {
		return state.creatures.map(creature => ({
			name: creature.name,
			ac: creature.ac || 10,
			hp: Number.isFinite(Number(creature.hp)) ? Number(creature.hp) : 1,
			max: Number(creature.maxHp) || Number(creature.hp) || 1,
			speed: creature.speed || 30,
			initMod: Number.isFinite(Number(creature.initMod)) ? Number(creature.initMod) : 2,
			kind: creature.kind || kindKey({label: creature.name}),
			image: creature.image || "",
			options: enemyOptions(creature.attacks),
			extraSwings: 1,
			cr: creature.cr || "",
			int: Number.isFinite(Number(creature.int)) ? Number(creature.int) : null,
			defenses: creature.defenses || normalizeDefenses(null),
			saveBonus: crProfile(creature.cr)?.save || 0,
			saveMods: creature.saveMods || null,
			type: creature.type || "",
			traits: creature.traits || null,
		}));
	}
	const profile = crProfile(state.cr) || crProfile("1");
	const swing = attackFromCr(profile);
	const avg = Number(swing.dice) || 4;
	const count = Math.max(1, Math.round(avg / 4.5));
	const option = {...swing, count, faces: 8, flat: 0, melee: true, rangeFeet: 5, activation: "action"};
	return Array.from({length: state.monsters}, (_, index) => ({
		name: `CR ${profile.cr} ${index + 1}`,
		ac: profile.ac,
		max: profile.hp,
		speed: 30,
		initMod: 2,
		kind: `cr:${profile.cr}`,
		image: "",
		options: [option],
		extraSwings: 1,
		cr: profile.cr,
		defenses: normalizeDefenses(null),
		saveBonus: profile.save,
	}));
}

function enemyOptions (attacks) {
	const action = (attacks || []).filter(attack => attack.activation !== "bonus" && !attack.separate && attack.kind !== "utility");
	const extras = (attacks || []).filter(attack => attack.separate || attack.kind === "utility" || attack.activation === "bonus");
	const options = [];
	if (action.length) {
		options.push({
			...action[0],
			name: action.length > 1 ? "Multiattack" : action[0].name,
			repeats: action,
			activation: "action",
		});
	}
	for (const item of extras) options.push(item);
	return options;
}

function paintBoard (host, fight) {
	const stage = host.createDiv({cls: "fiveetools-dpr__stage"});
	if (!fight) {
		stage.createEl("p", {cls: "fiveetools-view__meta", text: "Step or run to place tokens."});
		return;
	}
	const map = stage.createDiv({cls: "fiveetools-dpr__map"});
	const latest = fight.log.length ? fight.log[fight.log.length - 1].text : "";
	const banner = map.createDiv({cls: "fiveetools-dpr__action"});
	if (latest) {
		banner.setText(latest);
		banner.setAttr("title", latest);
	}
	const board = map.createDiv({cls: "fiveetools-dpr__board"});
	const current = fight.over ? null : fight.actors.find(actor => actor.id === fight.order[fight.cursor]);
	board.style.gridTemplateColumns = `repeat(${fight.cols}, 1fr)`;
	for (let y = 0; y < fight.rows; y++) {
		for (let x = 0; x < fight.cols; x++) {
			const cell = board.createDiv({cls: "fiveetools-dpr__cell"});
			const actor = fight.actors.find(it => it.x === x && it.y === y);
			if (!actor) continue;
			const dead = actor.dead || (actor.side === "enemy" && actor.hp <= 0);
			const token = cell.createDiv({cls: `fiveetools-dpr__token${actor.side === "enemy" ? " is-enemy" : ""}${dead ? " is-dead" : ""}${current && current.id === actor.id ? " is-active" : ""}`});
			if (actor.image) token.createEl("img", {attr: {src: actor.image, alt: actor.name}});
			else token.createSpan({text: actor.name.slice(0, 1)});
			token.createEl("span", {cls: "fiveetools-dpr__hp", text: String(Math.max(0, Math.round(actor.hp)))});
		}
	}
	const target = fight.initiativeRolled ? attackTarget(current, fight.actors) : null;
	if (current && target) paintAttackArrow(board, current, target, fight.cols, fight.rows);
	paintRoster(stage, fight, current);
}

function attackTarget (actor, actors) {
	if (!actor || actor.hp <= 0 || actor.dead || actor.dying || actor.stable) return null;
	const plan = planTurn(actor, actors);
	const choice = damagingChoice(plan.action) || damagingChoice(plan.bonus);
	return choice?.targets?.find(it => it.side !== actor.side && !it.dead && (it.hp > 0 || it.dying || it.stable)) || null;
}

function damagingChoice (choice) {
	if (!choice?.option || choice.option.kind === "heal") return null;
	return choice;
}

function paintAttackArrow (board, from, to, cols, rows) {
	const svg = document.createElementNS(SVG, "svg");
	svg.setAttribute("class", "fiveetools-dpr__arrow");
	svg.setAttribute("viewBox", `0 0 ${cols} ${rows}`);
	svg.setAttribute("preserveAspectRatio", "none");
	const x1 = from.x + 0.5;
	const y1 = from.y + 0.5;
	const x2 = to.x + 0.5;
	const y2 = to.y + 0.5;
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = Math.hypot(dx, dy);
	if (len < 0.2) return;
	const ux = dx / len;
	const uy = dy / len;
	const endX = x2 - ux * 0.42;
	const endY = y2 - uy * 0.42;
	const line = document.createElementNS(SVG, "line");
	line.setAttribute("x1", String(x1));
	line.setAttribute("y1", String(y1));
	line.setAttribute("x2", String(endX));
	line.setAttribute("y2", String(endY));
	svg.append(line);
	const px = -uy;
	const py = ux;
	const baseX = endX - ux * 0.42;
	const baseY = endY - uy * 0.42;
	const head = document.createElementNS(SVG, "polygon");
	head.setAttribute("points", [
		`${endX},${endY}`,
		`${baseX + px * 0.22},${baseY + py * 0.22}`,
		`${baseX - px * 0.22},${baseY - py * 0.22}`,
	].join(" "));
	svg.append(head);
	board.append(svg);
}

function paintRoster (host, fight, current) {
	const roster = host.createDiv({cls: "fiveetools-dpr__roster"});
	roster.createEl("h4", {text: `Round ${fight.round}`});
	for (const id of fight.order) {
		const actor = fight.actors.find(it => it.id === id);
		if (!actor) continue;
		const line = roster.createDiv({cls: `fiveetools-dpr__roster-row${current && current.id === actor.id ? " is-active" : ""}`});
		line.createSpan({cls: "fiveetools-dpr__roster-init", text: actor.init == null ? "—" : String(actor.init)});
		line.createSpan({cls: "fiveetools-dpr__actor-name", text: actor.name});
		const slots = actor.side === "party" ? slotText(actor.pool) : "";
		line.createSpan({cls: "fiveetools-dpr__roster-status", text: `${rosterStatus(actor)}${slots ? `  ${slots}` : ""}`});
	}
}

function rosterStatus (actor) {
	if (actor.dead) return `Dead  HP ${Math.round(actor.hp)}/${actor.max}`;
	if (actor.stable) return `Stable  HP 0/${actor.max}`;
	if (actor.dying) return `Dying ${actor.saves?.success || 0} success, ${actor.saves?.fail || 0} fail  HP 0/${actor.max}`;
	return `HP ${Math.round(actor.hp)}/${actor.max}`;
}

function slotText (pool) {
	const counts = new Map();
	for (const slot of pool || []) counts.set(slot.level, (counts.get(slot.level) || 0) + 1);
	return [...counts.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([level, count]) => `${ordinal(level)} ${count}`)
		.join(" · ");
}

function ordinal (level) {
	const n = Number(level) || 0;
	const suffix = n % 10 === 1 && n % 100 !== 11 ? "st"
		: n % 10 === 2 && n % 100 !== 12 ? "nd"
			: n % 10 === 3 && n % 100 !== 13 ? "rd"
				: "th";
	return `${n}${suffix}`;
}

function paintLog (host, fight) {
	const log = host.createDiv({cls: "fiveetools-dpr__log"});
	if (!fight?.log?.length) {
		log.createEl("p", {cls: "fiveetools-view__meta", text: "No actions yet."});
		return;
	}
	for (let i = fight.log.length - 1; i >= 0; i--) {
		const line = fight.log[i];
		log.createEl("p", {text: `R${line.round} ${line.text}`});
	}
}

function paintReport (host, reports, fight) {
	const card = host.createDiv({cls: "fiveetools-dpr__report"});
	if (!fight) return;
	const many = (reports || []).length > 1;
	const summary = many ? combineReports(reports) : summarize(fight);
	if (!many && fight.over) paintScoreboard(card, summary);
	else if (many) paintRecord(card, summary);
	if (!many) {
		card.createEl("h3", {text: "Report"});
		const stats = card.createDiv({cls: "fiveetools-dpr__stats"});
		statTile(stats, "Rounds", String(summary.rounds || "—"));
		statTile(stats, "Damage", formatNum(summary.damage));
		statTile(stats, "Healing", formatNum(summary.healing));
		statTile(stats, "XP", summary.xp ? `${summary.xp} (${summary.share} each)` : "0");
		const actors = summary.actors || [];
		reportGroup(card, "Characters alive", actors.filter(actor => actor.side === "party" && !actor.dead));
		reportGroup(card, "Characters dead", actors.filter(actor => actor.side === "party" && actor.dead));
		reportGroup(card, "Creatures alive", actors.filter(actor => actor.side !== "party" && !actor.dead));
		reportGroup(card, "Creatures dead", actors.filter(actor => actor.side !== "party" && actor.dead));
		return;
	}
	const stats = card.createDiv({cls: "fiveetools-dpr__stats"});
	statTile(stats, "Rounds", rangeText(summary.rounds));
	statTile(stats, "Damage", rangeText(summary.damage));
	statTile(stats, "Healing", rangeText(summary.healing));
	statTile(stats, "XP", rangeText(summary.xp));
	for (const actor of summary.actors || []) {
		const line = card.createDiv({cls: "fiveetools-dpr__actor"});
		line.createSpan({cls: "fiveetools-dpr__actor-name", text: actor.name});
		const gone = actor.side === "party"
			? `${actor.deaths} deaths · ${formatNum(actor.meanDowns)} downs/fight · ${formatNum(actor.meanRolls)} death saves/fight`
			: "";
		line.createSpan({text: `${rangeText(actor.damage)} damage · ${rangeText(actor.healing)} healing${gone ? ` · ${gone}` : ""}`});
	}
	paintActions(card, "Party actions", summary.actions?.party);
	paintActions(card, "Creature actions", summary.actions?.enemy);
}

function paintScoreboard (host, summary) {
	const winner = summary.winner || "draw";
	const word = winner === "party" ? "Victory" : winner === "enemy" ? "Defeat" : "Draw";
	const board = host.createDiv({cls: `fiveetools-dpr__scoreboard is-${winner}`});
	board.createDiv({cls: "fiveetools-dpr__scoreboard-result", text: word});
	const sides = board.createDiv({cls: "fiveetools-dpr__scoreboard-sides"});
	sides.createSpan({text: "Party"});
	sides.createSpan({cls: "fiveetools-dpr__scoreboard-vs", text: "vs"});
	sides.createSpan({text: "Foes"});
	board.createDiv({cls: "fiveetools-dpr__scoreboard-meta", text: `${summary.standing || 0} still standing`});
}

function paintRecord (host, summary) {
	const runs = summary.runs || 0;
	const wins = summary.wins || {};
	const board = host.createDiv({cls: "fiveetools-dpr__scoreboard"});
	board.createDiv({cls: "fiveetools-dpr__scoreboard-result", text: `${runs} fights`});
	const line = board.createDiv({cls: "fiveetools-dpr__scoreboard-sides"});
	line.createSpan({text: `Party ${wins.party || 0}`});
	line.createSpan({cls: "fiveetools-dpr__scoreboard-vs", text: "·"});
	line.createSpan({text: `Foes ${wins.enemy || 0}`});
	line.createSpan({cls: "fiveetools-dpr__scoreboard-vs", text: "·"});
	line.createSpan({text: `Draw ${wins.draw || 0}`});
	const rate = Math.round((summary.winRate || 0) * 100);
	const left = Object.entries(summary.standing?.counts || {})
		.sort((a, b) => Number(a[0]) - Number(b[0]))
		.map(([count, times]) => `${count} left ×${times}`)
		.join(", ");
	board.createDiv({
		cls: "fiveetools-dpr__scoreboard-meta",
		text: `Party win rate ${rate}%. When the party wins, ${formatNum(summary.standing?.mean || 0)} characters left${left ? ` (${left})` : ""}.`,
	});
}

function paintActions (host, title, rows) {
	host.createEl("h4", {text: title});
	const attacks = (rows || []).filter(row => row.kind !== "heal" && row.damage > 0).sort((a, b) => b.damage - a.damage).slice(0, 8);
	const heals = (rows || []).filter(row => row.kind === "heal" && row.healing > 0).sort((a, b) => b.healing - a.healing).slice(0, 8);
	if (!attacks.length && !heals.length) {
		host.createEl("p", {cls: "fiveetools-view__meta", text: "None"});
		return;
	}
	for (const row of attacks) {
		const swings = row.hits + row.misses;
		const rate = swings ? Math.round(100 * row.hits / swings) : 0;
		const line = host.createDiv({cls: "fiveetools-dpr__actor"});
		line.createSpan({cls: "fiveetools-dpr__actor-name", text: row.name});
		line.createSpan({text: `${formatNum(row.damage)} damage · ${row.uses} uses · ${rate}% hits · ${formatNum(row.damage / (row.uses || 1))} avg`});
	}
	for (const row of heals) {
		const line = host.createDiv({cls: "fiveetools-dpr__actor"});
		line.createSpan({cls: "fiveetools-dpr__actor-name", text: row.name});
		line.createSpan({text: `${formatNum(row.healing)} healing · ${row.uses} uses · ${formatNum(row.healing / (row.uses || 1))} avg`});
	}
}

function reportGroup (host, title, actors) {
	host.createEl("h4", {text: title});
	if (!actors.length) {
		host.createEl("p", {cls: "fiveetools-view__meta", text: "None"});
		return;
	}
	for (const actor of actors) {
		const line = host.createDiv({cls: "fiveetools-dpr__actor"});
		line.createSpan({cls: "fiveetools-dpr__actor-name", text: actor.name});
		const label = actor.dying ? "dying" : actor.stable ? "stable" : actor.dead ? "dead" : `${actor.hp}/${actor.max}`;
		line.createSpan({text: `${actor.side === "party" ? "Character" : "Creature"} · ${label} · ${formatNum(actor.damage)} damage · ${formatNum(actor.healing)} healing`});
	}
}

function statTile (host, label, value) {
	const tile = host.createDiv({cls: "fiveetools-dpr__stat"});
	tile.createDiv({cls: "fiveetools-dpr__stat-label", text: label});
	tile.createDiv({cls: "fiveetools-dpr__stat-value", text: value});
}

function rangeText (stat) {
	if (!stat) return "—";
	return `mean ${formatNum(stat.mean)} · SD ${formatNum(stat.sd)} · median ${formatNum(stat.median)}`;
}

function simButton (row, text, onClick, disabled) {
	const button = row.createEl("button", {text, cls: "fiveetools-btn", attr: {type: "button"}});
	if (disabled) button.disabled = true;
	button.addEventListener("click", onClick);
}

function simIconButton (row, icon, title, onClick) {
	const button = row.createEl("button", {
		cls: "fiveetools-btn fiveetools-dpr__play",
		attr: {type: "button", title, "aria-label": title},
	});
	setIcon(button, icon);
	button.addEventListener("click", onClick);
}
