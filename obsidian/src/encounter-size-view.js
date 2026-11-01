import {getStyleHint} from "./fiveetools-globals.js";
import {MAX_MONSTERS, SIZE_CRS, monsterCount} from "./encounter-size.js";

const CLASSIC = [
	["easy", "Easy"],
	["medium", "Medium"],
	["hard", "Hard"],
	["deadly", "Deadly"],
];
const ONE = [
	["low", "Low"],
	["moderate", "Moderate"],
	["high", "High"],
];

function difficultiesFor (style) {
	return style === "one" ? ONE : CLASSIC;
}

function defaultDifficulty (style) {
	return style === "one" ? "moderate" : "medium";
}

function clampCount (value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 4;
	return Math.max(1, Math.min(12, Math.round(n)));
}

function partyLevel (value) {
	if (value === "all" || value == null || value === "") return "all";
	const n = Number(value);
	if (!Number.isFinite(n)) return "all";
	return Math.max(1, Math.min(20, Math.round(n)));
}

export function renderEncounterSize (listEl, readerEl, {session = {}, onSessionChange} = {}) {
	listEl.empty();
	listEl.addClass("fiveetools-size");
	readerEl?.empty();
	readerEl?.addClass("fiveetools-size-reader");

	const style = getStyleHint() || "one";
	const tiers = difficultiesFor(style);
	const stored = String(session.difficulty || "");
	const state = {
		partyCount: clampCount(session.partyCount),
		level: partyLevel(session.level),
		difficulty: tiers.some(([id]) => id === stored) ? stored : defaultDifficulty(style),
		playersFirst: session.playersFirst === true,
	};

	const emit = () => onSessionChange?.({
		partyCount: state.partyCount,
		level: state.level,
		difficulty: state.difficulty,
		playersFirst: state.playersFirst,
	});

	listEl.createEl("h3", {text: "Encounter size"});
	const party = labeledSelect(listEl, "Party size", state.partyCount, Array.from({length: 12}, (_, i) => [String(i + 1), String(i + 1)]));
	const level = labeledSelect(listEl, "Level", state.level, [
		["all", "All levels"],
		...Array.from({length: 20}, (_, i) => [String(i + 1), String(i + 1)]),
	]);
	const difficulty = labeledSelect(listEl, "Difficulty", state.difficulty, tiers);
	const styleRow = listEl.createDiv({cls: "fiveetools-dpr__init-style"});
	const buttons = [];
	for (const [value, label] of [["current", "Standard"], ["players", "Players first"]]) {
		const button = styleRow.createEl("button", {
			text: label,
			cls: "fiveetools-btn",
			attr: {type: "button"},
		});
		button.dataset.value = value;
		buttons.push(button);
		button.addEventListener("click", () => {
			const next = value === "players";
			if (state.playersFirst === next) return;
			state.playersFirst = next;
			paintInit();
			emit();
			paintTable();
		});
	}
	listEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "The count is a budget. A party that acts first lets more monsters in, less so when each monster attacks more.",
	});

	const host = readerEl || listEl;
	host.createEl("h3", {text: `Number of monsters (max ${MAX_MONSTERS}) by CR`});
	const tableHost = host.createDiv({cls: "fiveetools-size__scroll"});

	party.addEventListener("change", () => {
		state.partyCount = clampCount(party.value);
		party.value = String(state.partyCount);
		emit();
		paintTable();
	});
	level.addEventListener("change", () => {
		state.level = partyLevel(level.value);
		level.value = String(state.level);
		emit();
		paintTable();
	});
	difficulty.addEventListener("change", () => {
		state.difficulty = difficulty.value;
		emit();
		paintTable();
	});

	function paintInit () {
		const current = state.playersFirst ? "players" : "current";
		for (const button of buttons) button.classList.toggle("is-selected", button.dataset.value === current);
	}

	function paintTable () {
		tableHost.empty();
		const table = tableHost.createEl("table", {cls: "fiveetools-size__table"});
		const head = table.createEl("thead").createEl("tr");
		head.createEl("th", {text: "Level"});
		for (const cr of SIZE_CRS) head.createEl("th", {text: cr});
		const body = table.createEl("tbody");
		const levels = state.level === "all"
			? Array.from({length: 20}, (_, i) => i + 1)
			: [state.level];
		for (const level of levels) {
			const row = body.createEl("tr");
			row.createEl("th", {text: String(level)});
			for (const cr of SIZE_CRS) {
				const n = monsterCount({
					level,
					cr,
					partyCount: state.partyCount,
					difficulty: state.difficulty,
					playersFirst: state.playersFirst,
					style,
				});
				const cell = row.createEl("td");
				if (!n) continue;
				cell.setText(String(n));
				cell.setAttr("title", n === MAX_MONSTERS ? `${MAX_MONSTERS} or more` : `${n} monsters`);
			}
		}
	}

	paintInit();
	emit();
	paintTable();
}

function labeledSelect (parent, label, value, options) {
	const wrap = parent.createDiv({cls: "fiveetools-size__field"});
	wrap.createEl("label", {text: label});
	const select = wrap.createEl("select");
	for (const [id, text] of options) {
		select.createEl("option", {text, attr: {value: id}});
	}
	select.value = String(value);
	return select;
}
