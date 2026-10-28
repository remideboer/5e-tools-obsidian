import {characterName, listCharacters} from "./character-store.js";
import {
	attackFromCr,
	averageFromText,
	crOptions,
	crProfile,
	creatureTurn,
	dprByAc,
	economySlot,
	expectedDamage,
	extraAttackSwings,
	formatNum,
	roundCasts,
	simulateFight,
	spellAtSlot,
	spellExtras,
	diceShape,
	normalizeDefenses,
} from "./dpr-calc.js";
import {resolveTokenImage} from "./image-resolver.js";
import {loadEntity} from "./entity-loader.js";
import {getSavedEncounter, listSavedEncounters, loadEncountersFromVault} from "./encounter-store.js";
import {ensureSearchIndex, findEditionDoc, listEntities} from "./search-index.js";
import {ensureMonsterMeta, getMonsterMeta} from "./bestiary-meta.js";
import {getParser} from "./fiveetools-host.js";

const SVG = "http://www.w3.org/2000/svg";

export function renderDprTool (listEl, readerEl, {plugin, session = {}, onSessionChange} = {}) {
	listEl.empty();
	listEl.addClass("fiveetools-dpr");
	readerEl?.empty();
	readerEl?.addClass("fiveetools-dpr-reader");

	const state = {
		characterId: String(session.characterId || ""),
		partyIds: new Set(session.partyIds || []),
		picks: picksFromSession(session),
		mode: session.mode === "advantage" || session.mode === "disadvantage" ? session.mode : "normal",
		ac: clamp(session.ac, 5, 30, 15),
		threat: session.threat === "encounter" ? "encounter" : "cr",
		cr: String(session.cr || "1"),
		monsters: clamp(session.monsters, 1, 12, 1),
		encounterId: String(session.encounterId || ""),
		encounterGen: 0,
		characters: [],
		sheets: {},
		creatures: [],
		token: 0,
	};

	listEl.createEl("h3", {text: "DPR"});
	listEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Each character has one action, one bonus action, and one reaction. Extra Attack and Multiattack stay inside that action. A natural 20 crits. Saves deal half on a success.",
	});
	const setupEl = listEl.createDiv();
	const resultsEl = readerEl || listEl.createDiv();
	resultsEl.createEl("p", {cls: "fiveetools-view__meta", text: "Loading characters…"});

	const emit = () => {
		onSessionChange?.({
			characterId: state.characterId,
			partyIds: [...state.partyIds],
			picks: Object.fromEntries(Object.entries(state.picks).map(([id, picks]) => [id, {
				attacks: [...picks.attacks],
				spells: [...picks.spells],
				heals: [...picks.heals],
			}])),
			mode: state.mode,
			ac: state.ac,
			threat: state.threat,
			cr: state.cr,
			monsters: state.monsters,
			encounterId: state.encounterId,
		});
	};

	const paint = () => {
		emit();
		paintResults(resultsEl, state);
	};

	void start();

	async function start () {
		const token = ++state.token;
		try {
			await loadEncountersFromVault(plugin);
		} catch (_) { /* the CR table still works */ }
		state.characters = await listCharacters(plugin);
		if (token !== state.token) return;
		if (!state.characters.length) {
			setupEl.createEl("p", {text: "Import a character under Player → Characters first."});
			resultsEl.empty();
			return;
		}
		if (!state.characters.some(record => characterId(record) === state.characterId)) {
			state.characterId = characterId(state.characters[0]);
		}
		paintSetup(setupEl, state, paint, () => { void loadSources(); }, () => { void refreshEncounter(); });
		await loadSources();
	}

	async function refreshEncounter () {
		const gen = ++state.encounterGen;
		await loadEncounter();
		if (gen !== state.encounterGen) return;
		paint();
	}

	async function loadSources () {
		const token = ++state.token;
		resultsEl.empty();
		resultsEl.createEl("p", {cls: "fiveetools-view__meta", text: "Reading spells…"});
		const sheets = {};
		for (const record of partyRecords(state)) {
			const id = characterId(record);
			sheets[id] = await sourcesFor(plugin, record);
			if (token !== state.token) return;
			const picks = memberPicks(state, id);
			keepIds(picks.attacks, sheets[id].attacks);
			keepIds(picks.spells, sheets[id].spells);
			keepIds(picks.heals, sheets[id].heals);
		}
		state.sheets = sheets;
		const gen = ++state.encounterGen;
		await loadEncounter();
		if (gen !== state.encounterGen) return;
		if (token !== state.token) return;
		paintChecks(resultsEl, state, paint);
		paint();
	}

	async function loadEncounter () {
		const gen = state.encounterGen;
		const creatures = state.threat === "encounter"
			? await encounterCreatures(plugin, state.encounterId)
			: [];
		if (gen !== state.encounterGen) return;
		state.creatures = creatures;
	}
}

export async function encounterCreatures (plugin, encounterId) {
	if (!encounterId) return [];
	const saved = getSavedEncounter(encounterId);
	if (!saved) return [];
	const creatures = [];
	for (const combatant of saved.combatants || []) {
		let attacks = [];
		let image = "";
		let speed = 30;
		let defenses = normalizeDefenses(null);
		let int = null;
		try {
			const ent = combatant.ent || (combatant.doc ? (await loadEntity(combatant.doc))?.ent : null);
			attacks = creatureTurn(ent);
			defenses = normalizeDefenses(ent);
			const token = ent ? resolveTokenImage(ent, {imageBaseUrl: plugin?.settings?.imageBaseUrl}) : null;
			image = token?.url || "";
			const walk = ent?.speed?.walk ?? ent?.speed;
			speed = Number(walk) || 30;
			int = Number.isFinite(Number(ent?.int)) ? Number(ent.int) : null;
		} catch (_) { /* fall back to the CR table */ }
		creatures.push({
			name: combatant.label || "Creature",
			ac: Number(combatant.ac) || 0,
			hp: Number(combatant.hpMax) || 0,
			cr: combatant.cr,
			attacks,
			image,
			speed,
			defenses,
			int,
		});
	}
	return creatures;
}

function paintSetup (host, state, paint, onCharacter, onThreat) {
	host.empty();
	const characterRow = field(host, "Character");
	const characterEl = characterRow.createEl("select");
	for (const record of state.characters) {
		const id = characterId(record);
		characterEl.createEl("option", {text: characterName(record), attr: {value: id}});
	}
	characterEl.value = state.characterId;
	characterEl.addEventListener("change", () => {
		state.characterId = characterEl.value;
		onCharacter();
	});

	const others = state.characters.filter(record => characterId(record) !== state.characterId);
	if (others.length) {
		host.createEl("h4", {text: "Party HP"});
		host.createEl("p", {
			cls: "fiveetools-view__meta",
			text: "The chosen character is always in the pool. Add others to share the healing.",
		});
		for (const record of others) {
			const id = characterId(record);
			const label = host.createEl("label", {cls: "fiveetools-dpr__check"});
			const box = label.createEl("input", {attr: {type: "checkbox"}});
			box.checked = state.partyIds.has(id);
			box.addEventListener("change", () => {
				if (box.checked) state.partyIds.add(id);
				else state.partyIds.delete(id);
				onCharacter();
			});
			label.createSpan({text: `${characterName(record)} · HP ${hpOf(record) || "—"}`});
		}
	}

	const modeRow = field(host, "Roll");
	const modeEl = modeRow.createEl("select");
	for (const [value, text] of [["normal", "Normal"], ["advantage", "Advantage"], ["disadvantage", "Disadvantage"]]) {
		modeEl.createEl("option", {text, attr: {value}});
	}
	modeEl.value = state.mode;
	modeEl.addEventListener("change", () => {
		state.mode = modeEl.value;
		paint();
	});

	const acRow = field(host, "Target AC");
	const acEl = acRow.createEl("input", {attr: {type: "number", min: "5", max: "30", value: String(state.ac)}});
	acEl.addEventListener("change", () => {
		state.ac = clamp(acEl.value, 5, 30, 15);
		acEl.value = String(state.ac);
		paint();
	});

	const threatRow = field(host, "Against");
	const threatEl = threatRow.createEl("select");
	threatEl.createEl("option", {text: "Challenge rating", attr: {value: "cr"}});
	threatEl.createEl("option", {text: "Saved encounter", attr: {value: "encounter"}});
	threatEl.value = state.threat;

	const crWrap = host.createDiv();
	const crRow = field(crWrap, "CR");
	const crEl = crRow.createEl("select");
	for (const cr of crOptions()) crEl.createEl("option", {text: cr, attr: {value: cr}});
	if (crProfile(state.cr)) crEl.value = state.cr;
	crEl.addEventListener("change", () => {
		state.cr = crEl.value;
		paint();
	});
	const countRow = field(crWrap, "Monsters");
	const countEl = countRow.createEl("input", {attr: {type: "number", min: "1", max: "12", value: String(state.monsters)}});
	countEl.addEventListener("change", () => {
		state.monsters = clamp(countEl.value, 1, 12, 1);
		countEl.value = String(state.monsters);
		paint();
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
	encEl.addEventListener("change", () => {
		state.encounterId = encEl.value;
		onThreat();
	});

	const showThreat = () => {
		crWrap.style.display = state.threat === "cr" ? "" : "none";
		encWrap.style.display = state.threat === "encounter" ? "" : "none";
	};
	threatEl.addEventListener("change", () => {
		state.threat = threatEl.value;
		showThreat();
		onThreat();
	});
	showThreat();
}

function paintChecks (host, state, paint) {
	host.empty();
	const checks = host.createDiv({cls: "fiveetools-dpr__party"});
	for (const record of partyRecords(state)) {
		const id = characterId(record);
		const sheet = state.sheets[id];
		if (!sheet) continue;
		const column = checks.createDiv({cls: "fiveetools-dpr__party-col"});
		const swings = sheet.swings > 1 ? ` · ${sheet.swings} swings` : "";
		column.createEl("h3", {text: `${characterName(record)} · AC ${acOf(record) ?? "—"} · HP ${hpOf(record) || "—"}${swings}`});
		const picks = memberPicks(state, id);
		paintGroup(column, "Attacks", sheet.attacks, picks.attacks, paint);
		paintGroup(column, "Spells", sheet.spells, picks.spells, paint);
		paintGroup(column, "Healing", sheet.heals, picks.heals, paint);
	}
	host.createDiv({cls: "fiveetools-dpr__results"});
}

function paintGroup (host, title, rows, selected, paint) {
	host.createEl("h3", {text: title});
	if (!rows.length) {
		host.createEl("p", {cls: "fiveetools-view__meta", text: "None with readable dice."});
		return;
	}
	for (const row of rows) {
		const label = host.createEl("label", {cls: "fiveetools-dpr__check"});
		const box = label.createEl("input", {attr: {type: "checkbox"}});
		box.checked = selected.has(row.id);
		box.addEventListener("change", () => {
			if (box.checked) selected.add(row.id);
			else selected.delete(row.id);
			paint();
		});
		label.createSpan({text: sourceLabel(row)});
	}
}

function paintResults (host, state) {
	let results = host.querySelector(".fiveetools-dpr__results");
	if (!results) {
		results = host.createDiv({cls: "fiveetools-dpr__results"});
	}
	results.empty();
	const members = partyRecords(state).map(record => memberTurn(state, record));
	const enemies = enemiesOf(state);
	const saveBonus = enemySaveBonus(state);
	const opening = members.map(member => roundCasts(cloneCaster(member), true));
	const damage = opening.flat().filter(row => row.kind !== "heal");
	const ctx = {ac: state.ac, mode: state.mode, saveBonus};
	const dpr = damage.reduce((sum, row) => sum + expectedDamage(row, ctx), 0);
	const plain = simulateFight({party: members, enemies, mode: state.mode, saveBonus, useHeals: false});
	const helped = simulateFight({party: members, enemies, mode: state.mode, saveBonus, useHeals: true});

	results.createEl("h3", {text: "This round"});
	if (!damage.length) {
		results.createEl("p", {cls: "fiveetools-view__meta", text: "Check the attacks and spells each character uses. Only one action and one bonus action fit."});
	}
	members.forEach((member, index) => {
		const bits = castSequence(opening[index]);
		results.createEl("p", {text: `${member.name} (AC ${formatNum(member.ac)}): ${bits || "no action checked"}`});
	});
	results.createEl("p", {text: `Party DPR ${formatNum(dpr)} against AC ${state.ac}${openingLabel(damage)}`});
	results.createEl("p", {cls: "fiveetools-view__meta", text: "Each attack uses that target's AC. A character at 0 HP stops attacking. Healing goes to the most wounded ally, and stops at their own maximum."});
	if (!enemies.length) {
		results.createEl("p", {text: "Choose a saved encounter, or switch to a challenge rating."});
	} else {
		for (let i = 0; i < members.length; i++) {
			const name = members[i].name;
			const sequence = castSequence((helped.people[i]?.casts || []).flat());
			results.createEl("p", {text: `${name}: ${sequence || "no casts"}`});
			results.createEl("p", {text: `${name} lasts ${roundsText(dropRound(plain.people[i]?.series))} without healing, and ${roundsText(dropRound(helped.people[i]?.series))} with healing.`});
		}
		const clear = helped.clearRound;
		results.createEl("p", {text: clear == null ? "The enemies are still up after 12 rounds." : `The enemies drop on round ${clear}.`});
	}

	paintChart(results, "DPR by AC", "AC", dprByAc(damage, {mode: state.mode, saveBonus}).map(point => ({
		x: point.ac,
		y: point.dpr,
	})), [{name: openingLabel(damage).replace(/^, /, "") || "DPR", cls: "fiveetools-dpr__line--dpr"}]);
	const lineCls = ["fiveetools-dpr__line--dpr", "fiveetools-dpr__line--hurt", "fiveetools-dpr__line--heal", "fiveetools-dpr__line--other"];
	const chartLines = helped.people.map((person, i) => ({
		name: person.name,
		cls: lineCls[i % lineCls.length],
		points: seriesPoints(person.series),
	}));
	paintChart(results, "Hit points", "Round", null, chartLines);
}

function paintChart (host, title, xLabel, points, lines) {
	host.createEl("h3", {text: title});
	const drawn = points
		? [{name: lines[0].name, cls: lines[0].cls, points}]
		: lines;
	const xs = drawn.flatMap(line => line.points.map(point => point.x));
	const ys = drawn.flatMap(line => line.points.map(point => point.y));
	if (!xs.length) return;
	const xMin = Math.min(...xs);
	const xMax = Math.max(...xs);
	const yMax = Math.max(1, ...ys);
	const yStep = tickStep(yMax, 4);
	const yTop = Math.max(yStep, Math.ceil((yMax - 1e-9) / yStep) * yStep);
	const w = 420;
	const h = 200;
	const left = 44;
	const top = 12;
	const right = 12;
	const bottom = 28;
	const svg = document.createElementNS(SVG, "svg");
	svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
	svg.setAttribute("class", "fiveetools-dpr__chart");
	const xOf = (x) => left + ((x - xMin) / (xMax - xMin || 1)) * (w - left - right);
	const yOf = (y) => top + (1 - y / yTop) * (h - top - bottom);
	const plotRight = w - right;
	const plotBottom = h - bottom;
	for (let y = 0; y <= yTop + yStep * 0.001; y += yStep) {
		const py = yOf(y);
		svg.append(svgLine(left, py, plotRight, py, y === 0 ? "fiveetools-dpr__axis" : "fiveetools-dpr__grid"));
		svg.append(svgText(left - 4, py + 3, formatNum(y), "end"));
	}
	for (const x of xTicks(xMin, xMax)) {
		const px = xOf(x);
		if (x !== xMin) svg.append(svgLine(px, top, px, plotBottom, "fiveetools-dpr__grid"));
		svg.append(svgText(px, h - 8, formatNum(x), "middle"));
	}
	svg.append(svgLine(left, top, left, plotBottom, "fiveetools-dpr__axis"));
	for (const line of drawn) {
		const poly = document.createElementNS(SVG, "polyline");
		poly.setAttribute("points", line.points.map(point => `${xOf(point.x)},${yOf(point.y)}`).join(" "));
		poly.setAttribute("fill", "none");
		poly.setAttribute("class", line.cls);
		svg.append(poly);
	}
	host.append(svg);
	host.createEl("p", {cls: "fiveetools-view__meta", text: `${xLabel} · ${drawn.map(line => line.name).join(" · ")}`});
}

function seriesPoints (series) {
	return series.map((y, x) => ({x, y}));
}

function partyRecords (state) {
	return state.characters.filter(record => {
		const id = characterId(record);
		return id === state.characterId || state.partyIds.has(id);
	});
}

function memberTurn (state, record) {
	const id = characterId(record);
	const sheet = state.sheets[id] || {attacks: [], spells: [], heals: [], swings: 1};
	const picks = memberPicks(state, id);
	const checked = [
		...sheet.attacks.filter(row => picks.attacks.has(row.id)),
		...sheet.spells.filter(row => picks.spells.has(row.id)),
		...sheet.heals.filter(row => picks.heals.has(row.id)),
	];
	return {
		name: characterName(record),
		ac: acOf(record) || 10,
		max: hpOf(record),
		checked,
		extraSwings: sheet.swings || 1,
		characterLevel: Number(record?.fields?.level) || 1,
		pool: slotPool(record?.snapshot?.slots),
	};
}

function cloneCaster (member) {
	return {...member, pool: (member.pool || []).map(slot => ({...slot}))};
}

export function slotPool (slots) {
	const pool = [];
	for (const slot of slots || []) {
		const count = Math.max(0, (Number(slot.max) || 0) - (Number(slot.spent) || 0));
		for (let i = 0; i < count; i++) pool.push({level: Number(slot.level) || 0, pact: !!slot.pact});
	}
	return pool;
}

function enemiesOf (state) {
	if (state.threat === "encounter") {
		if (!state.creatures.length) return [];
		return state.creatures.map(creature => {
			const profile = crProfile(creature.cr);
			const swings = creature.attacks?.length
				? creature.attacks.map(attack => ({kind: attack.kind || "attack", bonus: attack.bonus, dice: attack.dice, flat: attack.flat, name: attack.name}))
				: (profile ? [attackFromCr(profile)] : []);
			return {name: creature.name, ac: creature.ac || profile?.ac || 10, max: creature.hp || profile?.hp || 1, swings};
		});
	}
	const profile = crProfile(state.cr) || crProfile("1");
	const swing = attackFromCr(profile);
	return Array.from({length: state.monsters}, (_, index) => ({
		name: `CR ${profile.cr} ${index + 1}`,
		ac: profile.ac,
		max: profile.hp,
		swings: [swing],
	}));
}

function enemySaveBonus (state) {
	if (state.threat === "encounter" && state.creatures.length) {
		const bonuses = state.creatures.map(creature => crProfile(creature.cr)?.save).filter(n => n != null);
		if (bonuses.length) return bonuses.reduce((sum, n) => sum + n, 0) / bonuses.length;
	}
	return crProfile(state.cr)?.save || 0;
}

function castSequence (casts) {
	const labels = [];
	for (const swing of casts || []) labels.push(castLabel(swing));
	const parts = [];
	for (const label of labels) {
		const last = parts[parts.length - 1];
		if (last && last.label === label) last.count++;
		else parts.push({label, count: 1});
	}
	return parts.map(part => part.count > 1 ? `${part.label} ×${part.count}` : part.label).join(", ");
}

function castLabel (swing) {
	if (swing?.castLevel > 0) return `${swing.name} ${ordinal(swing.castLevel)}`;
	return swing?.name || "";
}

function openingLabel (swings) {
	const labels = [...new Set((swings || []).map(castLabel).filter(Boolean))];
	return labels.length ? `, ${labels.join(", ")}` : "";
}

function ordinal (level) {
	const n = Number(level) || 0;
	const suffix = n % 10 === 1 && n % 100 !== 11 ? "st"
		: n % 10 === 2 && n % 100 !== 12 ? "nd"
			: n % 10 === 3 && n % 100 !== 13 ? "rd"
				: "th";
	return `${n}${suffix}`;
}

function dropRound (series) {
	if (!series) return null;
	for (let i = 1; i < series.length; i++) {
		if (series[i] <= 0) return i;
	}
	return null;
}

function picksFromSession (session) {
	const picks = {};
	for (const [id, value] of Object.entries(session?.picks || {})) {
		picks[id] = {
			attacks: new Set(value?.attacks || []),
			spells: new Set(value?.spells || []),
			heals: new Set(value?.heals || []),
		};
	}
	const focus = String(session?.characterId || "");
	if (focus && !picks[focus]) {
		picks[focus] = {
			attacks: new Set(session?.attackIds || []),
			spells: new Set(session?.spellIds || []),
			heals: new Set(session?.healIds || []),
		};
	}
	return picks;
}

function memberPicks (state, id) {
	if (!state.picks[id]) {
		state.picks[id] = {attacks: new Set(), spells: new Set(), heals: new Set()};
	}
	return state.picks[id];
}

export async function sourcesFor (plugin, record) {
	const empty = {attacks: [], spells: [], heals: [], swings: 1};
	const snapshot = record?.snapshot;
	if (!snapshot) return empty;
	await ensureSearchIndex(plugin);
	const edition = snapshot.edition === "one" ? "one" : "classic";
	const casting = snapshot.spellcasting || [];
	const attacks = (snapshot.actions || []).map(action => actionSource(action, casting)).filter(Boolean);
	try {
		await attachWildShape(record, attacks);
	} catch (_) { /* the shape stays a bonus action with no beast */ }
	const spells = [];
	const heals = [];
	const refs = (snapshot.refs || []).filter(ref => ref.kind === "spell");
	const characterLevel = Number(record?.fields?.level) || 1;
	const loaded = await Promise.all(refs.map(async (spell) => spellSource(spell, casting, edition, characterLevel)));
	for (const source of loaded) {
		if (!source) continue;
		if (source.kind === "heal") heals.push(source);
		else spells.push(source);
	}
	return {attacks, spells, heals, swings: extraAttackSwings(snapshot.features, record?.fields?.classes)};
}

async function attachWildShape (record, attacks) {
	const shape = (attacks || []).find(option => option.utility === "wildshape");
	if (!shape) return;
	const beast = await bestBeast(wildShapeCap(record));
	shape.beastName = beast?.name || "a beast";
	shape.beastOptions = beast?.options || [];
}

function wildShapeCap (record) {
	const classes = String(record?.fields?.classes || "");
	const druid = classes.match(/druid\s+(\d+)/i);
	if (!druid) return 0;
	const level = Number(druid[1]) || 0;
	const moon = (record?.snapshot?.refs || []).some(ref => /moon/i.test(`${ref?.name || ""} ${ref?.label || ""}`));
	if (moon) return level >= 6 ? Math.floor(level / 3) : 1;
	if (level < 4) return 0.25;
	if (level < 8) return 0.5;
	return 1;
}

async function bestBeast (cap) {
	if (!(cap > 0)) return null;
	await ensureMonsterMeta();
	const Parser = getParser();
	const crOf = (doc) => {
		const value = Parser?.crToNumber?.(getMonsterMeta(doc)?.cr);
		return Number.isFinite(value) ? value : -1;
	};
	const docs = listEntities({categoriesExact: ["bestiary"]}).filter(doc => {
		const meta = getMonsterMeta(doc);
		if (!meta?.types?.includes("beast")) return false;
		if (/swarm/i.test(doc.n || "")) return false;
		const cr = crOf(doc);
		return cr > 0 && cr <= cap;
	});
	const top = docs.length ? Math.max(...docs.map(crOf)) : -1;
	let best = null;
	let bestScore = -1;
	for (const doc of docs.filter(item => crOf(item) === top)) {
		try {
			const ent = (await loadEntity(doc))?.ent;
			if (!ent) continue;
			const options = enemyOptions(creatureTurn(ent)).filter(option => option.kind !== "utility");
			const score = options.reduce((sum, option) => {
				const swings = option.repeats?.length ? option.repeats : [option];
				return sum + swings.reduce((part, swing) => part + (swing.dice || 0) + (swing.flat || 0), 0);
			}, 0);
			if (score > bestScore) {
				bestScore = score;
				best = {name: ent.name, options};
			}
		} catch (_) { /* skip a beast that will not load */ }
	}
	return best;
}

function actionSource (action, casting) {
	if (/wild shape/i.test(action?.name || "")) {
		return {
			id: `action:${action.name}`,
			name: action.name,
			kind: "utility",
			utility: "wildshape",
			slot: "bonus",
			activation: "bonus",
			spell: false,
		};
	}
	const notation = String(action?.dice || action?.snippet || "").trim();
	const parts = averageFromText(notation);
	if (!parts) return null;
	const bonus = parseBonus(action.attack);
	const line = casting[0];
	const dc = parseDc(action.save) ?? (Number(line?.dc) || 0);
	let kind = "auto";
	if (bonus != null && action.attack) kind = "attack";
	else if (action.save) kind = "save";
	return {
		id: `action:${action.name}`,
		name: action.name,
		activation: action.activation || "",
		slot: economySlot(action.activation),
		range: action.range || "",
		blurb: String(action.snippet || ""),
		count: diceShape(notation)?.count || 0,
		faces: diceShape(notation)?.faces || 0,
		damage: String(action.damage || "").toLowerCase(),
		kind,
		bonus: bonus ?? 0,
		dc,
		notation: diceLabel(parts, notation),
		...parts,
	};
}

async function spellSource (spell, casting, edition, characterLevel) {
	let ent = null;
	const doc = findEditionDoc(spell?.name || spell?.label, {categoriesExact: ["spell"], edition});
	if (doc) {
		try {
			ent = (await loadEntity(doc))?.ent || null;
		} catch (_) { /* the card snippet still describes the spell */ }
	}
	const extras = spellExtras(ent);
	const text = `${spell?.snippet || ""} ${extras.text || ""}`.trim();
	const fromBook = extras.base;
	const fromSnippet = averageFromText(spell?.snippet);
	let parts = fromBook || fromSnippet;
	if (fromBook && fromSnippet?.flat) parts = {...fromBook, flat: fromSnippet.flat, average: fromBook.dice + fromSnippet.flat};
	if (!parts && !extras.cantrip.length) return null;
	parts = parts || {dice: 0, flat: 0, average: 0};
	const line = casting.find(it => String(it.className || "").toLowerCase() === String(spell.list || "").toLowerCase()) || casting[0];
	const name = spell.label || spell.name || "Spell";
	const heal = isHealing(name, text);
	const level = Number.isFinite(Number(spell.level)) ? Number(spell.level) : (extras.cantrip.length ? 0 : null);
	const shape = diceShape(firstDiceText(extras.text) || firstDiceText(spell?.snippet) || "");
	const row = {
		id: `spell:${spell.name || name}`,
		name,
		spell: true,
		activation: spell.castingTime || "",
		slot: economySlot(spell.castingTime),
		level,
		scale: extras.scale,
		cantrip: extras.cantrip,
		kind: heal ? "heal" : (spell.attack ? "attack" : (spell.save ? "save" : "auto")),
		bonus: Number(line?.attack) || 0,
		dc: parseDc(spell.save) ?? (Number(line?.dc) || 0),
		dice: parts.dice,
		flat: parts.flat,
		count: shape?.count || 0,
		faces: shape?.faces || 0,
		damage: String(ent?.damageInflict?.[0] || "").toLowerCase(),
		range: spell.range || "",
		blurb: text.slice(0, 240),
	};
	const shown = spellAtSlot(row, level > 0 ? level : 0, characterLevel);
	const baseText = firstDiceText(extras.text) || firstDiceText(spell?.snippet) || diceLabel(parts, spell?.snippet);
	const cantripLabel = (shown.cantrip || []).filter(it => it.level <= characterLevel).pop()?.label;
	return {
		...row,
		dice: shown.dice,
		flat: shown.flat,
		count: shown.count || row.count,
		faces: shown.faces || row.faces,
		notation: cantripLabel || (extras.scale ? `${baseText} +${extras.scale.label}/slot` : baseText),
	};
}

function firstDiceText (text) {
	const match = String(text || "").match(/\{@(?:dice|damage)\s+([^}]+)\}/i);
	return match ? match[1].replace(/\s+/g, "") : "";
}

function diceLabel (parts, raw) {
	const match = String(raw || "").match(/(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?/i);
	if (!match) return `~${formatNum(parts.average)}`;
	const count = match[1] || "1";
	const flat = match[3] ? `${match[3]}${match[4]}` : "";
	return `${count}d${match[2]}${flat}`;
}

function isHealing (name, text) {
	const blob = `${name} ${text}`.toLowerCase();
	const heal = /\b(heals?|healing|regains?)\b/.test(blob) || /\bhit points\b/.test(blob);
	const damage = /\bdamage\b/.test(blob);
	if (heal && !damage) return true;
	return /^(cure wounds|healing word|mass healing word|prayer of healing|mass heal|heal|goodberry|healing spirit|aura of vitality)$/i.test(String(name || "").trim());
}

function sourceLabel (row) {
	const bits = [row.name];
	if (row.activation) bits.push(row.activation);
	if (row.kind === "attack") bits.push(signed(row.bonus));
	if (row.kind === "save") bits.push(`DC ${row.dc}`);
	if (row.notation) bits.push(row.notation);
	return bits.filter(Boolean).join(" · ");
}

export function characterId (record) {
	return String(record?.fields?.ddb_id || "").trim();
}

export function hpOf (record) {
	const n = Number(record?.snapshot?.play?.hpMax ?? record?.fields?.hp_max);
	return Number.isFinite(n) ? n : 0;
}

export function acOf (record) {
	const n = Number(record?.fields?.ac);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function parseBonus (value) {
	const match = String(value ?? "").match(/[+-]?\d+/);
	return match ? Number(match[0]) : null;
}

function parseDc (value) {
	const match = String(value ?? "").match(/DC\s*(\d+)/i);
	return match ? Number(match[1]) : null;
}

function keepIds (selected, rows) {
	const ids = new Set(rows.map(row => row.id));
	for (const id of [...selected]) {
		if (!ids.has(id)) selected.delete(id);
	}
}

function roundsText (rounds) {
	return rounds == null ? "does not drop" : `${rounds} rounds`;
}

function signed (n) {
	const value = Number(n) || 0;
	return value >= 0 ? `+${value}` : String(value);
}

export function clamp (value, min, max, fallback) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
}

export function field (host, label) {
	const row = host.createDiv({cls: "fiveetools-dpr__row"});
	row.createEl("label", {text: label});
	return row;
}

function svgLine (x1, y1, x2, y2, cls) {
	const line = document.createElementNS(SVG, "line");
	line.setAttribute("x1", String(x1));
	line.setAttribute("y1", String(y1));
	line.setAttribute("x2", String(x2));
	line.setAttribute("y2", String(y2));
	line.setAttribute("class", cls);
	return line;
}

function svgText (x, y, text, anchor) {
	const node = document.createElementNS(SVG, "text");
	node.setAttribute("x", String(x));
	node.setAttribute("y", String(y));
	node.setAttribute("class", "fiveetools-dpr__tick");
	if (anchor) node.setAttribute("text-anchor", anchor);
	node.textContent = text;
	return node;
}

function tickStep (span, count) {
	const rough = Math.max(span, 1) / Math.max(1, count);
	const pow = Math.pow(10, Math.floor(Math.log10(rough)));
	const scaled = rough / pow;
	const nice = scaled >= 7.5 ? 10 : scaled >= 3 ? 5 : scaled >= 1.5 ? 2 : 1;
	return nice * pow;
}

function xTicks (min, max) {
	const span = max - min || 1;
	const candidates = [1, 2, 5, 10, 20];
	const step = candidates.find(cand => span / cand <= 8 && span % cand === 0)
		|| candidates.find(cand => span / cand <= 8)
		|| 5;
	const out = [];
	for (let value = min; value <= max + 1e-6; value += step) out.push(Math.round(value));
	if (out[out.length - 1] !== max) out.push(max);
	return out;
}

export function parseSpeed (value) {
	const match = String(value ?? "").match(/(\d+)/);
	return match ? Number(match[1]) : 30;
}

export function saveMod (record) {
	const saves = record?.snapshot?.rolls?.saves || [];
	if (!saves.length) return 0;
	return saves.reduce((sum, save) => sum + (Number(save.mod) || 0), 0) / saves.length;
}

export function avatarFrom (plugin, body) {
	const match = String(body || "").match(/!\[\[([^\]|]+)/);
	const path = String(match?.[1] || "").trim();
	if (!path) return "";
	try { return plugin?.app?.vault?.adapter?.getResourcePath(path) || ""; } catch (_) { return ""; }
}
