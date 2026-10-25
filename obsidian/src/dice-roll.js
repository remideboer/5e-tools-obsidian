import {showDice3d} from "./dice-3d.js";
import {mapPlayerDocument} from "./map-view.js";

const POPUP_ID = "fiveetools-roll-popup";
const POPUP_MS = 4000;
const popupTimers = new Map();

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
	let lastOnce = {total: null, dice: [], diceTotal: null, mod: 0};
	for (let i = 0; i < count; i++) {
		lastOnce = rollNotation(notation);
		totals.push(lastOnce.total);
		dice.push(...lastOnce.dice);
	}
	return {
		label: packed.name || packed.displayText || notation || "Roll",
		notation,
		total: lastOnce.total,
		totals,
		dice,
		diceTotal: lastOnce.diceTotal,
		mod: lastOnce.mod,
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
	const mod = Number(result.mod) || 0;
	// Flat rolls: show total only (e.g. "5"), not "5: 5".
	if (!mod) return `${result.total}${mode}${extra}`;
	return `${formatBreakdown(result)}${mode}: ${result.total}${extra}`;
}

function formatBreakdown (result) {
	if (result.diceTotal == null) return result.label || result.notation || "Roll";
	const diceTotal = Number(result.diceTotal);
	if (!Number.isFinite(diceTotal)) return result.label || result.notation || "Roll";
	const mod = Number(result.mod) || 0;
	if (!mod) return String(diceTotal);
	return `${diceTotal} ${mod < 0 ? "-" : "+"} ${Math.abs(mod)}`;
}

/**
 * Show roll popup (after 3D dice settle when enabled).
 * @returns {Promise<object>} resolves with `result` when the popup is shown
 */
export function presentRoll (plugin, result) {
	const text = formatRollNotice(result);
	const docs = rollDocuments(plugin);
	if (result?.total != null && plugin?.settings?.dice3d) {
		const waits = docs.map((doc) => {
			const win = doc.defaultView || window;
			return Promise.resolve(showDice3d(plugin, result, doc)).then(() => new Promise((resolve) => {
				win.setTimeout(() => {
					showRollPopup(text, doc);
					resolve();
				}, 500);
			}));
		});
		return Promise.all(waits).then(() => result);
	}
	for (const doc of docs) showRollPopup(text, doc);
	return Promise.resolve(result);
}

function rollDocuments (plugin) {
	const docs = [document];
	if (!plugin?.settings?.dicePublic) return docs;
	const playerDoc = mapPlayerDocument(plugin);
	if (playerDoc?.body && playerDoc !== document) docs.push(playerDoc);
	return docs;
}

function showRollPopup (text, doc = document) {
	const el = ensureRollPopup(doc);
	el.textContent = text;
	el.style.display = "";
	const win = doc.defaultView || window;
	const prev = popupTimers.get(doc);
	if (prev) win.clearTimeout(prev);
	popupTimers.set(doc, win.setTimeout(() => {
		el.style.display = "none";
		popupTimers.delete(doc);
	}, POPUP_MS));
}

function ensureRollPopup (doc = document) {
	let el = doc.getElementById(POPUP_ID);
	if (el) return el;
	el = doc.createElement("div");
	el.id = POPUP_ID;
	el.className = "fiveetools-roll-popup";
	el.style.display = "none";
	doc.body.appendChild(el);
	return el;
}

/** Case-insensitive NdM / NdM±K (e.g. 1d20, 1D20, d6, 2d6+3). */
const DICE_NOTATION = /\b(\d{0,2})d(\d{1,4}|%)([+-]\d+)?\b/gi;

export function textHasDiceNotation (text) {
	DICE_NOTATION.lastIndex = 0;
	return DICE_NOTATION.test(String(text || ""));
}

/**
 * Append plain text with clickable `.render-roller` spans for die notations.
 * Does not auto-roll; pair with bindDiceRollers.
 */
export function appendTextWithDiceRollers (host, text) {
	if (!host) return;
	const raw = String(text ?? "");
	if (!raw) return;
	DICE_NOTATION.lastIndex = 0;
	let last = 0;
	let found = false;
	let m;
	while ((m = DICE_NOTATION.exec(raw))) {
		found = true;
		if (m.index > last) host.appendText(raw.slice(last, m.index));
		const display = m[0];
		const count = m[1] || "1";
		const faces = m[2] === "%" ? "100" : m[2];
		const mod = m[3] || "";
		const toRoll = `${count}d${faces}${mod}`.toLowerCase().replace(/\s+/g, "");
		host.createEl("span", {
			cls: "render-roller ve-roller",
			text: display,
			attr: {
				title: "Click to roll.",
				"data-packed-dice": JSON.stringify({toRoll}),
			},
		});
		last = m.index + display.length;
	}
	if (!found) {
		host.appendText(raw);
		return;
	}
	if (last < raw.length) host.appendText(raw.slice(last));
}

export function bindDiceRollers (el, plugin) {
	if (!el?.addEventListener) return;
	if (el.dataset.fiveetoolsDiceBound === "1") return;
	el.dataset.fiveetoolsDiceBound = "1";
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
		return {total: Number.isFinite(total) ? total : null, dice: [], diceTotal: null, mod: 0};
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
	const diceTotal = used.reduce((sum, n) => sum + n, 0);
	let total = diceTotal + parsed.mod;
	if (parsed.floorHalf) total = Math.floor(total / 2);
	return {
		total,
		dice: rolled.map(it => ({faces: it.faces, value: it.value})),
		diceTotal,
		mod: parsed.mod,
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
