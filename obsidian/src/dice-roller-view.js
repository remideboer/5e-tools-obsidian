import {DIE_FACES, dieLabel, paintDieIcon} from "./dice-icons.js";
import {formatRollNotice, presentRoll, rollPacked} from "./dice-roll.js";

const HISTORY_MAX = 40;

export function emptyDiceSession () {
	return {
		amount: "1",
		customAmount: 1,
		modifier: 0,
		advantage: false,
		disadvantage: false,
		history: [],
	};
}

/**
 * Tools → Dice roller: amount + adv/disadv + tap polyhedra.
 * @param {HTMLElement} listEl
 * @param {HTMLElement} readerEl
 * @param {{ plugin: object, session?: object, onSessionChange?: (s: object) => void }} opts
 */
export function renderDiceRoller (listEl, readerEl, {
	plugin,
	session = emptyDiceSession(),
	onSessionChange,
} = {}) {
	listEl.empty();
	listEl.addClass("fiveetools-dice-roller");
	readerEl?.empty();
	readerEl?.addClass("fiveetools-dice-roller-reader");

	const state = {
		amount: String(session.amount ?? "1"),
		customAmount: clampAmount(session.customAmount ?? 1),
		modifier: clampModifier(session.modifier ?? 0),
		advantage: !!session.advantage,
		disadvantage: !!session.disadvantage && !session.advantage,
		history: Array.isArray(session.history) ? [...session.history] : [],
	};

	const emit = () => {
		onSessionChange?.({
			amount: state.amount,
			customAmount: state.customAmount,
			modifier: state.modifier,
			advantage: state.advantage,
			disadvantage: state.disadvantage,
			history: state.history,
		});
	};

	listEl.createEl("h3", {text: "Dice roller"});
	listEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Set amount, tap a die. Advantage / disadvantage apply to d20.",
	});

	const amountRow = listEl.createDiv({cls: "fiveetools-dice-roller__row"});
	amountRow.createEl("label", {text: "Amount", cls: "fiveetools-dice-roller__label"});
	const amountSel = amountRow.createEl("select", {cls: "fiveetools-dice-roller__amount"});
	for (let i = 1; i <= 10; i++) {
		const opt = amountSel.createEl("option", {text: String(i), attr: {value: String(i)}});
		if (state.amount === String(i)) opt.selected = true;
	}
	const customOpt = amountSel.createEl("option", {text: "Custom…", attr: {value: "custom"}});
	if (state.amount === "custom") customOpt.selected = true;

	const customInput = amountRow.createEl("input", {
		cls: "fiveetools-dice-roller__custom",
		attr: {
			type: "number",
			min: "1",
			max: "99",
			inputmode: "numeric",
			value: String(state.customAmount),
			"aria-label": "Custom amount",
		},
	});
	const syncCustomVisible = () => {
		customInput.style.display = state.amount === "custom" ? "" : "none";
	};
	syncCustomVisible();

	amountSel.addEventListener("change", () => {
		state.amount = amountSel.value;
		syncCustomVisible();
		if (state.amount === "custom") customInput.focus();
		emit();
	});
	customInput.addEventListener("change", () => {
		state.customAmount = clampAmount(customInput.value);
		customInput.value = String(state.customAmount);
		emit();
	});

	amountRow.createEl("label", {text: "Mod", cls: "fiveetools-dice-roller__label"});
	const modSel = amountRow.createEl("select", {
		cls: "fiveetools-dice-roller__mod",
		attr: {"aria-label": "Modifier"},
	});
	for (let m = -5; m <= 10; m++) {
		const label = m > 0 ? `+${m}` : String(m);
		const opt = modSel.createEl("option", {text: label, attr: {value: String(m)}});
		if (state.modifier === m) opt.selected = true;
	}
	modSel.addEventListener("change", () => {
		state.modifier = clampModifier(modSel.value);
		emit();
	});

	const flags = listEl.createDiv({cls: "fiveetools-dice-roller__flags"});
	const advLabel = flags.createEl("label", {cls: "fiveetools-dice-roller__flag"});
	const advBox = advLabel.createEl("input", {attr: {type: "checkbox"}});
	advBox.checked = state.advantage;
	advLabel.createSpan({text: "Advantage"});
	const disLabel = flags.createEl("label", {cls: "fiveetools-dice-roller__flag"});
	const disBox = disLabel.createEl("input", {attr: {type: "checkbox"}});
	disBox.checked = state.disadvantage;
	disLabel.createSpan({text: "Disadvantage"});

	advBox.addEventListener("change", () => {
		state.advantage = advBox.checked;
		if (state.advantage) {
			state.disadvantage = false;
			disBox.checked = false;
		}
		emit();
	});
	disBox.addEventListener("change", () => {
		state.disadvantage = disBox.checked;
		if (state.disadvantage) {
			state.advantage = false;
			advBox.checked = false;
		}
		emit();
	});

	const grid = listEl.createDiv({cls: "fiveetools-dice-roller__grid"});
	for (const faces of DIE_FACES) {
		const btn = grid.createEl("button", {
			cls: "fiveetools-dice-roller__die",
			attr: {
				type: "button",
				title: `Roll ${dieLabel(faces)}`,
				"aria-label": `Roll ${dieLabel(faces)}`,
			},
		});
		const icon = btn.createDiv({cls: "fiveetools-dice-roller__icon"});
		paintDieIcon(icon, faces);
		btn.createSpan({cls: "fiveetools-dice-roller__die-label", text: dieLabel(faces)});
		btn.addEventListener("click", async () => {
			const result = rollDie(faces, state);
			await presentRoll(plugin, result);
			state.history = [
				{
					id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
					faces,
					notation: result.notation,
					mode: result.mode || "",
					total: result.total,
					text: formatRollNotice(result),
				},
				...state.history,
			].slice(0, HISTORY_MAX);
			emit();
			paintHistory(readerEl, state.history);
		});
	}

	const clearRow = listEl.createDiv({cls: "fiveetools-dice-roller__row"});
	const clearBtn = clearRow.createEl("button", {
		text: "Clear history",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	clearBtn.addEventListener("click", () => {
		state.history = [];
		emit();
		paintHistory(readerEl, state.history);
	});

	paintHistory(readerEl, state.history);
}

function rollDie (faces, state) {
	const modStr = formatMod(state.modifier);
	// Adv/disadv is a single d20 check (amount ignored while either flag is on).
	if (Number(faces) === 20 && (state.advantage || state.disadvantage)) {
		const toRoll = `1d20${modStr}`;
		return rollPacked({
			toRoll,
			d20mod: modStr,
			subType: "d20",
			name: toRoll,
			displayText: toRoll,
		}, {
			shiftKey: !!state.advantage,
			ctrlKey: !!state.disadvantage,
		});
	}
	const n = resolvedAmount(state);
	const toRoll = `${n}d${faces}${modStr}`;
	return rollPacked({toRoll, name: toRoll, displayText: toRoll}, {});
}

function formatMod (mod) {
	const n = clampModifier(mod);
	if (!n) return "";
	return n > 0 ? `+${n}` : String(n);
}

function resolvedAmount (state) {
	if (state.amount === "custom") return clampAmount(state.customAmount);
	return clampAmount(state.amount);
}

function clampAmount (value) {
	const n = Math.floor(Number(value));
	if (!Number.isFinite(n) || n < 1) return 1;
	return Math.min(99, n);
}

function clampModifier (value) {
	const n = Math.floor(Number(value));
	if (!Number.isFinite(n)) return 0;
	return Math.max(-5, Math.min(10, n));
}

function paintHistory (readerEl, history) {
	if (!readerEl) return;
	readerEl.empty();
	readerEl.addClass("fiveetools-dice-roller-reader");
	readerEl.createEl("h3", {text: "Results"});
	if (!history?.length) {
		readerEl.createEl("p", {
			cls: "fiveetools-view__meta",
			text: "Tap a die to roll.",
		});
		return;
	}
	const list = readerEl.createDiv({cls: "fiveetools-dice-roller__history"});
	for (const row of history) {
		const item = list.createDiv({cls: "fiveetools-dice-roller__hist-item"});
		const top = item.createDiv({cls: "fiveetools-dice-roller__hist-top"});
		top.createSpan({
			cls: "fiveetools-dice-roller__hist-notation",
			text: row.notation || dieLabel(row.faces),
		});
		if (row.mode) {
			top.createSpan({
				cls: "fiveetools-dice-roller__hist-mode",
				text: row.mode,
			});
		}
		item.createDiv({
			cls: "fiveetools-dice-roller__hist-total",
			text: row.total == null ? "—" : String(row.total),
		});
		item.createDiv({
			cls: "fiveetools-dice-roller__hist-detail",
			text: row.text || "",
		});
	}
}
