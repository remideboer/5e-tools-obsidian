import {characterName, listCharacters} from "./character-store.js";
import {
	averageFromText,
	crOptions,
	crProfile,
	creatureRound,
	dprByAc,
	expectedDamage,
	firstSpellDice,
	formatNum,
	hpOverRounds,
	roundsToClear,
	spellText,
} from "./dpr-calc.js";
import {loadEntity} from "./entity-loader.js";
import {getSavedEncounter, listSavedEncounters, loadEncountersFromVault} from "./encounter-store.js";
import {ensureSearchIndex, findEditionDoc} from "./search-index.js";

const SVG = "http://www.w3.org/2000/svg";

export function renderDprTool (listEl, readerEl, {plugin, session = {}, onSessionChange} = {}) {
	listEl.empty();
	listEl.addClass("fiveetools-dpr");
	readerEl?.empty();
	readerEl?.addClass("fiveetools-dpr-reader");

	const state = {
		characterId: String(session.characterId || ""),
		partyIds: new Set(session.partyIds || []),
		attackIds: new Set(session.attackIds || []),
		spellIds: new Set(session.spellIds || []),
		healIds: new Set(session.healIds || []),
		mode: session.mode === "advantage" || session.mode === "disadvantage" ? session.mode : "normal",
		ac: clamp(session.ac, 5, 30, 15),
		threat: session.threat === "encounter" ? "encounter" : "cr",
		cr: String(session.cr || "1"),
		monsters: clamp(session.monsters, 1, 12, 1),
		encounterId: String(session.encounterId || ""),
		encounterGen: 0,
		characters: [],
		sources: {attacks: [], spells: [], heals: []},
		creatures: [],
		token: 0,
	};

	listEl.createEl("h3", {text: "DPR"});
	listEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Expected damage for the attacks and spells you check. A natural 20 crits. Saves deal half on a success.",
	});
	const setupEl = listEl.createDiv();
	const resultsEl = readerEl || listEl.createDiv();
	resultsEl.createEl("p", {cls: "fiveetools-view__meta", text: "Loading characters…"});

	const emit = () => {
		onSessionChange?.({
			characterId: state.characterId,
			partyIds: [...state.partyIds],
			attackIds: [...state.attackIds],
			spellIds: [...state.spellIds],
			healIds: [...state.healIds],
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
		const record = state.characters.find(it => characterId(it) === state.characterId);
		resultsEl.empty();
		resultsEl.createEl("p", {cls: "fiveetools-view__meta", text: "Reading spells…"});
		const sources = await sourcesFor(plugin, record);
		if (token !== state.token) return;
		state.sources = sources;
		keepIds(state.attackIds, sources.attacks);
		keepIds(state.spellIds, sources.spells);
		keepIds(state.healIds, sources.heals);
		const gen = ++state.encounterGen;
		await loadEncounter();
		if (gen !== state.encounterGen) return;
		if (token !== state.token) return;
		paintChecks(resultsEl, state, paint);
		paint();
	}

	async function loadEncounter () {
		const gen = state.encounterGen;
		if (state.threat !== "encounter" || !state.encounterId) {
			if (gen === state.encounterGen) state.creatures = [];
			return;
		}
		const saved = getSavedEncounter(state.encounterId);
		if (!saved) {
			if (gen === state.encounterGen) state.creatures = [];
			return;
		}
		const creatures = [];
		for (const combatant of saved.combatants || []) {
			let attacks = [];
			try {
				const ent = combatant.ent || (combatant.doc ? (await loadEntity(combatant.doc))?.ent : null);
				attacks = creatureRound(ent);
			} catch (_) { /* fall back to the CR table */ }
			creatures.push({
				name: combatant.label || "Creature",
				ac: Number(combatant.ac) || 0,
				hp: Number(combatant.hpMax) || 0,
				cr: combatant.cr,
				attacks,
			});
		}
		if (gen !== state.encounterGen) return;
		state.creatures = creatures;
	}
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
		state.attackIds.clear();
		state.spellIds.clear();
		state.healIds.clear();
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
				paint();
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
	const checks = host.createDiv();
	paintGroup(checks, "Attacks", state.sources.attacks, state.attackIds, paint);
	paintGroup(checks, "Spells", state.sources.spells, state.spellIds, paint);
	paintGroup(checks, "Healing", state.sources.heals, state.healIds, paint);
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
	const damage = [
		...state.sources.attacks.filter(row => state.attackIds.has(row.id)),
		...state.sources.spells.filter(row => state.spellIds.has(row.id)),
	];
	const heals = state.sources.heals.filter(row => state.healIds.has(row.id));
	const party = partyOf(state);
	const threat = threatOf(state, party.ac);
	const ctx = {ac: state.ac, mode: state.mode, saveBonus: threat.save};
	const dpr = damage.reduce((sum, row) => sum + expectedDamage(row, ctx), 0);
	const healing = heals.reduce((sum, row) => sum + (row.dice + row.flat), 0);
	const bare = hpOverRounds(party.hp, threat.incoming, 0);
	const helped = hpOverRounds(party.hp, threat.incoming, healing);
	const clear = roundsToClear(threat.hp, dpr);

	results.createEl("h3", {text: "This round"});
	if (!damage.length) {
		results.createEl("p", {cls: "fiveetools-view__meta", text: "Check the attacks and spells used this round."});
	}
	for (const row of damage) {
		results.createEl("p", {text: `${row.name} · ${formatNum(expectedDamage(row, ctx))}`});
	}
	results.createEl("p", {text: `DPR ${formatNum(dpr)} at AC ${state.ac}`});
	results.createEl("p", {text: `Healing ${formatNum(healing)} into ${formatNum(party.hp)} party HP`});
	results.createEl("p", {text: `${threat.label}: ${formatNum(threat.incoming)} incoming, ${formatNum(threat.hp)} HP`});
	if (threat.ac) {
		const theirAc = state.threat === "encounter" ? `Their AC averages ${formatNum(threat.ac)}` : `Typical AC ${formatNum(threat.ac)}`;
		results.createEl("p", {cls: "fiveetools-view__meta", text: `${theirAc}. Party AC averages ${formatNum(party.ac)}.`});
	}
	results.createEl("p", {text: `The party lasts ${roundsText(bare.rounds)} without healing, and ${roundsText(helped.rounds)} with the heals checked.`});
	results.createEl("p", {text: clear == null ? "Check some damage to see when the fight ends." : `At this DPR the fight ends in ${clear} rounds.`});

	paintChart(results, "DPR by AC", "AC", dprByAc(damage, {mode: state.mode, saveBonus: threat.save}).map(point => ({
		x: point.ac,
		y: point.dpr,
	})), [{name: "DPR", cls: "fiveetools-dpr__line--dpr"}]);
	const chartLines = [
		{name: "Without healing", cls: "fiveetools-dpr__line--hurt", points: seriesPoints(bare.series)},
	];
	if (healing > 0) chartLines.push({name: "With healing", cls: "fiveetools-dpr__line--heal", points: seriesPoints(helped.series)});
	paintChart(results, "Party HP", "Round", null, chartLines);
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
	const w = 420;
	const h = 180;
	const left = 36;
	const top = 10;
	const right = 8;
	const bottom = 22;
	const svg = document.createElementNS(SVG, "svg");
	svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
	svg.setAttribute("class", "fiveetools-dpr__chart");
	const xOf = (x) => left + ((x - xMin) / (xMax - xMin || 1)) * (w - left - right);
	const yOf = (y) => top + (1 - y / yMax) * (h - top - bottom);
	svg.append(svgLine(left, top, left, h - bottom, "fiveetools-dpr__axis"));
	svg.append(svgLine(left, h - bottom, w - right, h - bottom, "fiveetools-dpr__axis"));
	for (const line of drawn) {
		const poly = document.createElementNS(SVG, "polyline");
		poly.setAttribute("points", line.points.map(point => `${xOf(point.x)},${yOf(point.y)}`).join(" "));
		poly.setAttribute("class", line.cls);
		svg.append(poly);
	}
	svg.append(svgText(2, 14, formatNum(yMax)));
	svg.append(svgText(left, h - 6, `${xLabel} ${xMin}–${xMax}`));
	host.append(svg);
	host.createEl("p", {cls: "fiveetools-view__meta", text: drawn.map(line => line.name).join(" · ")});
}

function seriesPoints (series) {
	return series.map((y, x) => ({x, y}));
}

function threatOf (state, partyAc) {
	if (state.threat === "encounter") {
		if (!state.encounterId) return {label: "No encounter", incoming: 0, hp: 0, save: 0, ac: null};
		let incoming = 0;
		let hp = 0;
		let acSum = 0;
		let acCount = 0;
		let saveSum = 0;
		let saveCount = 0;
		for (const creature of state.creatures) {
			hp += creature.hp;
			if (creature.ac > 0) {
				acSum += creature.ac;
				acCount++;
			}
			const profile = crProfile(creature.cr);
			if (profile) {
				saveSum += profile.save;
				saveCount++;
			}
			if (creature.attacks.length) {
				incoming += creature.attacks.reduce((sum, attack) => sum + expectedDamage({
					kind: "attack",
					bonus: attack.bonus,
					dice: attack.dice,
					flat: attack.flat,
				}, {ac: partyAc}), 0);
			} else if (profile) incoming += profile.dpr;
		}
		const saved = getSavedEncounter(state.encounterId);
		return {
			label: saved?.name || "Encounter",
			incoming,
			hp,
			save: saveCount ? saveSum / saveCount : 0,
			ac: acCount ? acSum / acCount : null,
		};
	}
	const profile = crProfile(state.cr) || crProfile("1");
	const count = state.monsters;
	return {
		label: `CR ${profile.cr} × ${count}`,
		incoming: profile.dpr * count,
		hp: profile.hp * count,
		save: profile.save,
		ac: profile.ac,
	};
}

function partyOf (state) {
	const members = state.characters.filter(record => {
		const id = characterId(record);
		return id === state.characterId || state.partyIds.has(id);
	});
	const hp = members.reduce((sum, record) => sum + hpOf(record), 0);
	const acs = members.map(acOf).filter(n => n != null);
	const ac = acs.length ? acs.reduce((sum, n) => sum + n, 0) / acs.length : 15;
	return {hp, ac};
}

async function sourcesFor (plugin, record) {
	const empty = {attacks: [], spells: [], heals: []};
	const snapshot = record?.snapshot;
	if (!snapshot) return empty;
	await ensureSearchIndex(plugin);
	const edition = snapshot.edition === "one" ? "one" : "classic";
	const casting = snapshot.spellcasting || [];
	const attacks = (snapshot.actions || []).map(action => actionSource(action, casting)).filter(Boolean);
	const spells = [];
	const heals = [];
	const refs = (snapshot.refs || []).filter(ref => ref.kind === "spell");
	const loaded = await Promise.all(refs.map(async (spell) => spellSource(spell, casting, edition)));
	for (const source of loaded) {
		if (!source) continue;
		if (source.kind === "heal") heals.push(source);
		else spells.push(source);
	}
	return {attacks, spells, heals};
}

function actionSource (action, casting) {
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
		kind,
		bonus: bonus ?? 0,
		dc,
		notation: diceLabel(parts, notation),
		...parts,
	};
}

async function spellSource (spell, casting, edition) {
	let text = String(spell?.snippet || "");
	let parts = averageFromText(text);
	if (!parts) {
		const doc = findEditionDoc(spell?.name || spell?.label, {categoriesExact: ["spell"], edition});
		if (doc) {
			try {
				const loaded = await loadEntity(doc);
				text = spellText(loaded?.ent) || text;
				parts = firstSpellDice(loaded?.ent);
			} catch (_) { /* the spell stays off the list */ }
		}
	}
	if (!parts) return null;
	const line = casting.find(it => String(it.className || "").toLowerCase() === String(spell.list || "").toLowerCase()) || casting[0];
	const name = spell.label || spell.name || "Spell";
	const heal = isHealing(name, text);
	return {
		id: `spell:${spell.name || name}`,
		name,
		activation: spell.castingTime || "",
		kind: heal ? "heal" : (spell.attack ? "attack" : (spell.save ? "save" : "auto")),
		bonus: Number(line?.attack) || 0,
		dc: parseDc(spell.save) ?? (Number(line?.dc) || 0),
		notation: diceLabel(parts, spell.snippet || text),
		...parts,
	};
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

function characterId (record) {
	return String(record?.fields?.ddb_id || "").trim();
}

function hpOf (record) {
	const n = Number(record?.snapshot?.play?.hpMax ?? record?.fields?.hp_max);
	return Number.isFinite(n) ? n : 0;
}

function acOf (record) {
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

function clamp (value, min, max, fallback) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
}

function field (host, label) {
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

function svgText (x, y, text) {
	const node = document.createElementNS(SVG, "text");
	node.setAttribute("x", String(x));
	node.setAttribute("y", String(y));
	node.setAttribute("class", "fiveetools-dpr__tick");
	node.textContent = text;
	return node;
}
