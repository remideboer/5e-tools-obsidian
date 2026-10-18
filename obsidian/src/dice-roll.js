import {showDice3d} from "./dice-3d.js";

const POPUP_ID = "fiveetools-roll-popup";
const POPUP_MS = 4000;
let popupTimer = null;

export function rollPacked (entry, evt = {}) {
	const Renderer = globalThis.Renderer;
	if (!Renderer?.dice || !entry) return {label: "Roll", notation: "", total: null, dice: [], totals: []};
	const packed = JSON.parse(JSON.stringify(entry));
	const shiftKey = !!evt.shiftKey;
	const ctrlKey = !!(evt.ctrlKey || evt.metaKey);
	const meta = Renderer.dice.getEventModifiedRollMeta({shiftKey, ctrlKey, metaKey: ctrlKey}, packed);
	const notation = String(meta.entry?.toRoll || packed.toRoll || "");
	const count = Math.max(1, Number(meta.rollCount) || 1);
	const totals = [];
	const dice = [];
	for (let i = 0; i < count; i++) {
		const once = rollNotation(notation);
		totals.push(once.total);
		dice.push(...once.dice);
	}
	const total = totals[totals.length - 1];
	return {
		label: packed.name || packed.displayText || notation || "Roll",
		notation,
		total,
		totals,
		dice,
		subType: packed.subType || "",
		mode: rollMode(packed.subType, shiftKey, ctrlKey),
	};
}

export function rollInitiative (bonus, evt = {}, label = "Initiative") {
	const n = Number(bonus);
	const mod = Number.isFinite(n) ? (n >= 0 ? `+${n}` : `${n}`) : "+0";
	return rollPacked({
		toRoll: `1d20${mod}`,
		d20mod: mod,
		subType: "d20",
		name: label,
		displayText: mod,
		context: {type: "initiative"},
	}, evt);
}

export function formatRollNotice (result) {
	if (result?.total == null) return "Could not roll.";
	const mode = result.mode ? ` (${result.mode})` : "";
	const extra = result.totals?.length > 1 ? ` [${result.totals.join(", ")}]` : "";
	return `${result.label}${mode}: ${result.total}${extra}`;
}

export function presentRoll (plugin, result) {
	showRollPopup(formatRollNotice(result));
	if (result?.total != null && plugin?.settings?.dice3d) void showDice3d(plugin, result);
	return result;
}

function showRollPopup (text) {
	const el = ensureRollPopup();
	el.textContent = text;
	el.style.display = "";
	if (popupTimer) window.clearTimeout(popupTimer);
	popupTimer = window.setTimeout(() => {
		el.style.display = "none";
		popupTimer = null;
	}, POPUP_MS);
}

function ensureRollPopup () {
	let el = document.getElementById(POPUP_ID);
	if (el) return el;
	el = document.createElement("div");
	el.id = POPUP_ID;
	el.className = "fiveetools-roll-popup";
	el.style.display = "none";
	document.body.appendChild(el);
	return el;
}

export function bindDiceRollers (el, plugin) {
	if (!el?.addEventListener) return;
	el.addEventListener("click", (evt) => {
		const roller = evt.target.closest?.(".render-roller[data-packed-dice]");
		if (!roller || !el.contains(roller)) return;
		evt.preventDefault();
		evt.stopPropagation();
		let packed;
		try {
			packed = JSON.parse(roller.getAttribute("data-packed-dice"));
		} catch (_) {
			return;
		}
		if (roller.getAttribute("data-roll-name") && !packed.name) {
			packed.name = roller.getAttribute("data-roll-name");
		}
		presentRoll(plugin, rollPacked(packed, evt));
	}, true);
}

function rollMode (subType, shiftKey, ctrlKey) {
	if (subType === "damage" && shiftKey) return "crit";
	if (subType === "damage" && ctrlKey) return "half";
	if (subType === "d20" && shiftKey) return "advantage";
	if (subType === "d20" && ctrlKey) return "disadvantage";
	return "";
}

function rollNotation (notation) {
	const parsed = parseSimpleDice(notation);
	if (!parsed) {
		const total = globalThis.Renderer.dice.parseRandomise2(notation);
		return {total: Number.isFinite(total) ? total : null, dice: []};
	}
	const rolled = [];
	for (const term of parsed.dice) {
		for (let i = 0; i < term.count; i++) {
			const value = rollDie(term.faces);
			rolled.push({faces: term.faces, value, sign: term.sign});
		}
	}
	let used = rolled.map(it => it.sign * it.value);
	if (parsed.drop === "l" && used.length > 1) used.splice(used.indexOf(Math.min(...used)), 1);
	if (parsed.drop === "h" && used.length > 1) used.splice(used.indexOf(Math.max(...used)), 1);
	let total = used.reduce((sum, n) => sum + n, 0) + parsed.mod;
	if (parsed.floorHalf) total = Math.floor(total / 2);
	return {
		total,
		dice: rolled.map(it => ({faces: it.faces, value: it.value})),
	};
}

function parseSimpleDice (raw) {
	let s = String(raw || "").replace(/\s+/g, "");
	if (!s) return null;
	let floorHalf = false;
	const floorM = s.match(/^floor\(\((.+)\)\/2\)$/i);
	if (floorM) {
		s = floorM[1];
		floorHalf = true;
	}
	const dice = [];
	let mod = 0;
	let drop = null;
	const re = /([+-]?)(?:(\d*)d(\d+)(dl1|dh1)?|(\d+))/gi;
	let last = 0;
	let m;
	while ((m = re.exec(s))) {
		if (m.index !== last) return null;
		last = re.lastIndex;
		const sign = m[1] === "-" ? -1 : 1;
		if (m[5] != null) {
			mod += sign * Number(m[5]);
			continue;
		}
		const count = Number(m[2] || "1");
		const faces = Number(m[3]);
		if (!faces || count < 1) return null;
		if (m[4] === "dl1") drop = "l";
		if (m[4] === "dh1") drop = "h";
		dice.push({count, faces, sign});
	}
	if (last !== s.length || !dice.length) return null;
	return {dice, mod, drop, floorHalf};
}

function rollDie (faces) {
	const n = Number(faces);
	if (!Number.isFinite(n) || n < 1) return 0;
	if (globalThis.RollerUtil?.randomise) return globalThis.RollerUtil.randomise(n);
	return 1 + Math.floor(Math.random() * n);
}
