import {showDice3d} from "./dice-3d.js";
import {mapPlayerDocument} from "./map-view.js";
import {pushRollHistory} from "./roll-history.js";
import {tableDocument} from "./table-session.js";

const POPUP_ID = "fiveetools-roll-popup";
const POPUP_MS = 4000;
const popupTimers = new Map();

export function rollPacked (entry, evt = {}) {
	const Renderer = globalThis.Renderer;
	if (!Renderer?.dice || !entry) return {label: "Roll", notation: "", total: null, dice: [], totals: []};
	const packed = JSON.parse(JSON.stringify(entry));
	if (packed.toRoll != null) packed.toRoll = normalizeDiceNotation(packed.toRoll);
	const shiftKey = !!evt.shiftKey;
	const ctrlKey = !!(evt.ctrlKey || evt.metaKey);
	const meta = Renderer.dice.getEventModifiedRollMeta({shiftKey, ctrlKey, metaKey: ctrlKey}, packed);
	const notation = normalizeDiceNotation(meta.entry?.toRoll || packed.toRoll || "");
	const count = Math.max(1, Number(meta.rollCount) || 1);
	const totals = [];
	const dice = [];
	let lastOnce = {total: null, dice: [], diceTotal: null, mod: 0};
	for (let i = 0; i < count; i++) {
		lastOnce = rollNotation(notation);
		totals.push(lastOnce.total);
		dice.push(...lastOnce.dice);
	}
	const successThresh = packed.successThresh != null ? Number(packed.successThresh) : null;
	const successMax = packed.successMax != null ? Number(packed.successMax) : null;
	const rechargeOk = successThresh != null
		? lastOnce.total > (successMax || 100) - successThresh
		: null;
	return {
		label: packed.name || packed.displayText || notation || "Roll",
		notation,
		total: lastOnce.total,
		totals,
		dice,
		diceTotal: lastOnce.diceTotal,
		mod: lastOnce.mod,
		subType: packed.subType || "",
		context: packed.context || null,
		mode: rollMode(packed.subType, shiftKey, ctrlKey),
		damageType: packed.damageType || "",
		successThresh,
		successMax,
		chanceSuccessText: packed.chanceSuccessText || "Recharged!",
		chanceFailureText: packed.chanceFailureText || "Did not recharge",
		displayText: packed.displayText || "",
		rechargeOk,
	};
}

export function rollInitiative (bonus, evt = {}, label = "Initiative") {
	const n = Number(bonus);
	const mod = Number.isFinite(n) ? (n >= 0 ? `+${n}` : `${n}`) : "+0";
	const result = rollPacked({
		toRoll: `1d20${mod}`,
		d20mod: mod,
		subType: "d20",
		name: label,
		displayText: mod,
		context: {type: "initiative"},
	}, evt);
	result.label = label;
	result.showLabel = true;
	return result;
}

export function formatRollNotice (result) {
	if (result?.total == null) return "Could not roll.";
	const prefix = result.showLabel && result.label ? `${result.label} ` : "";
	if (result.successThresh != null) {
		const outcome = result.rechargeOk
			? (result.chanceSuccessText || "Recharged!")
			: (result.chanceFailureText || "Did not recharge");
		return `${prefix}${result.total}: ${outcome}`;
	}
	if (result.context?.type === "hit") {
		const nat = Number(result.diceTotal);
		if (nat === 1) return `${prefix}1 : FAIL!`;
		if (nat === 20) return `${prefix}20 : CRITICAL!`;
		return `${prefix}${formatBreakdown(result)}: ${result.total} to hit`;
	}
	if (result.subType === "damage") {
		const type = String(result.damageType || "").trim().toLowerCase();
		const typePart = type ? ` ${type}` : "";
		const mode = result.mode ? ` (${result.mode})` : "";
		const extra = result.totals?.length > 1 ? ` [${result.totals.join(", ")}]` : "";
		return `${prefix}${result.total}${typePart} damage${mode}${extra}`;
	}
	const mode = result.mode ? ` (${result.mode})` : "";
	const extra = result.totals?.length > 1 ? ` [${result.totals.join(", ")}]` : "";
	const mod = Number(result.mod) || 0;
	// Flat rolls: show total only (e.g. "5"), not "5: 5".
	if (!mod) return `${prefix}${result.total}${mode}${extra}`;
	return `${prefix}${formatBreakdown(result)}${mode}: ${result.total}${extra}`;
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
	return presentRolls(plugin, result == null ? [] : [result]).then(() => result);
}

/**
 * Show one or more roll lines in a stacked popup.
 * @returns {Promise<object[]>}
 */
export function presentRolls (plugin, results) {
	const list = (results || []).filter(it => it?.total != null);
	if (!list.length) return Promise.resolve(results || []);
	pushRollHistory(list.map(result => ({
		text: formatRollNotice(result),
		total: result.total,
		label: result.label || "",
	})));
	const docs = rollDocuments(plugin);
	if (plugin?.settings?.dice3d) {
		// One 3D roll for all dice — concurrent roller.roll calls hang and skip the popup.
		const combined = {
			dice: list.flatMap(it => it.dice || []),
			total: list.reduce((sum, it) => sum + (Number(it.total) || 0), 0),
		};
		const waits = docs.map((doc) => {
			const win = doc.defaultView || window;
			return Promise.resolve(showDice3d(plugin, combined, doc)).then(() => new Promise((resolve) => {
				win.setTimeout(() => {
					showRollPopupResults(list, doc);
					resolve();
				}, 500);
			}));
		});
		return Promise.all(waits).then(() => list);
	}
	for (const doc of docs) showRollPopupResults(list, doc);
	return Promise.resolve(list);
}

function rollDocuments (plugin) {
	const docs = [document];
	if (plugin?.settings?.dicePublic) {
		const playerDoc = mapPlayerDocument(plugin);
		if (playerDoc?.body && playerDoc !== document) docs.push(playerDoc);
	}
	if (!plugin?._tableSession?.privateRolls) {
		const tableDoc = tableDocument(plugin);
		if (tableDoc?.body && !docs.includes(tableDoc)) docs.push(tableDoc);
	}
	return docs;
}

function showRollPopupResults (results, doc = document) {
	const el = ensureRollPopup(doc);
	el.replaceChildren();
	for (const result of results) {
		const line = doc.createElement("div");
		line.className = "fiveetools-roll-popup__line";
		appendRollNoticeNodes(line, result, doc);
		el.appendChild(line);
	}
	el.style.display = "";
	const win = doc.defaultView || window;
	const prev = popupTimers.get(doc);
	if (prev) win.clearTimeout(prev);
	popupTimers.set(doc, win.setTimeout(() => {
		el.style.display = "none";
		popupTimers.delete(doc);
	}, POPUP_MS));
}

function boldVal (doc, value) {
	const b = doc.createElement("b");
	b.className = "fiveetools-roll-popup__val";
	b.textContent = String(value);
	return b;
}

function appendText (host, text) {
	host.appendChild(host.ownerDocument.createTextNode(text));
}

/** Build popup line DOM with dice/totals in bold. */
function appendRollNoticeNodes (line, result, doc) {
	if (result?.total == null) {
		appendText(line, "Could not roll.");
		return;
	}
	const prefix = result.showLabel && result.label ? `${result.label} ` : "";
	if (prefix) appendText(line, prefix);

	if (result.successThresh != null) {
		const outcome = result.rechargeOk
			? (result.chanceSuccessText || "Recharged!")
			: (result.chanceFailureText || "Did not recharge");
		line.appendChild(boldVal(doc, result.total));
		appendText(line, `: ${outcome}`);
		return;
	}
	if (result.context?.type === "hit") {
		const nat = Number(result.diceTotal);
		if (nat === 1) {
			line.appendChild(boldVal(doc, "1"));
			appendText(line, " : FAIL!");
			return;
		}
		if (nat === 20) {
			line.appendChild(boldVal(doc, "20"));
			appendText(line, " : CRITICAL!");
			return;
		}
		appendBreakdownNodes(line, result, doc);
		appendText(line, ": ");
		line.appendChild(boldVal(doc, result.total));
		appendText(line, " to hit");
		return;
	}
	if (result.subType === "damage") {
		const type = String(result.damageType || "").trim().toLowerCase();
		const typePart = type ? ` ${type}` : "";
		const mode = result.mode ? ` (${result.mode})` : "";
		const extra = result.totals?.length > 1 ? ` [${result.totals.join(", ")}]` : "";
		line.appendChild(boldVal(doc, result.total));
		appendText(line, `${typePart} damage${mode}${extra}`);
		return;
	}
	const mode = result.mode ? ` (${result.mode})` : "";
	const extra = result.totals?.length > 1 ? ` [${result.totals.join(", ")}]` : "";
	const mod = Number(result.mod) || 0;
	if (!mod) {
		line.appendChild(boldVal(doc, result.total));
		appendText(line, `${mode}${extra}`);
		return;
	}
	appendBreakdownNodes(line, result, doc);
	appendText(line, `${mode}: `);
	line.appendChild(boldVal(doc, result.total));
	appendText(line, extra);
}

function appendBreakdownNodes (line, result, doc) {
	if (result.diceTotal == null) {
		appendText(line, result.label || result.notation || "Roll");
		return;
	}
	const diceTotal = Number(result.diceTotal);
	if (!Number.isFinite(diceTotal)) {
		appendText(line, result.label || result.notation || "Roll");
		return;
	}
	const mod = Number(result.mod) || 0;
	line.appendChild(boldVal(doc, diceTotal));
	if (!mod) return;
	appendText(line, ` ${mod < 0 ? "-" : "+"} `);
	line.appendChild(boldVal(doc, Math.abs(mod)));
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
	markDamageTriggers(el);
	if (el.dataset.fiveetoolsDiceBound === "1") return;
	el.dataset.fiveetoolsDiceBound = "1";
	el.addEventListener("click", (evt) => {
		const roller = evt.target.closest?.(".render-roller[data-packed-dice]");
		if (roller && el.contains(roller)) {
			evt.preventDefault();
			evt.stopPropagation();
			const result = rollFromRoller(roller, evt);
			if (result) presentRoll(plugin, result);
			return;
		}
		const trigger = evt.target.closest?.("[data-hit-roll], [data-or-roll]");
		if (!trigger || !el.contains(trigger)) return;
		evt.preventDefault();
		evt.stopPropagation();
		const results = rollDamagesFromTrigger(trigger, evt);
		if (results.length) presentRolls(plugin, results);
	}, true);
}

function markDamageTriggers (root) {
	for (const node of root.querySelectorAll?.("i") || []) {
		if (node.dataset.hitRoll) continue;
		if (String(node.textContent || "").trim() !== "Hit:") continue;
		node.dataset.hitRoll = "1";
		node.classList.add("fiveetools-hit-roll", "render-roller");
		if (!node.getAttribute("title")) node.setAttribute("title", "Click to roll Hit damage.");
	}
	const blocks = new Set();
	for (const hit of root.querySelectorAll?.("[data-hit-roll]") || []) {
		const block = hit.closest?.("p, [data-roll-name-ancestor]") || hit.parentElement;
		if (block) blocks.add(block);
	}
	for (const block of blocks) markOrTriggersInBlock(block);
}

function markOrTriggersInBlock (block) {
	const doc = block.ownerDocument || document;
	const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
	const textNodes = [];
	while (walker.nextNode()) textNodes.push(walker.currentNode);
	for (const textNode of textNodes) {
		if (textNode.parentElement?.closest?.("[data-or-roll], [data-hit-roll], .render-roller[data-packed-dice]")) continue;
		const raw = String(textNode.nodeValue || "");
		const m = raw.match(/^(.*?)(\bor\b)(.*)$/i);
		if (!m) continue;
		if (!hasDamageRollerBefore(block, textNode) || !hasDamageRollerAfter(block, textNode)) continue;

		const before = doc.createTextNode(m[1]);
		const span = doc.createElement("span");
		span.dataset.orRoll = "1";
		span.className = "fiveetools-or-roll render-roller";
		span.textContent = m[2];
		span.setAttribute("title", "Click to roll alternative damage.");
		const after = doc.createTextNode(m[3]);
		const parent = textNode.parentNode;
		parent.insertBefore(before, textNode);
		parent.insertBefore(span, textNode);
		parent.insertBefore(after, textNode);
		parent.removeChild(textNode);
	}
}

function hasDamageRollerBefore (block, node) {
	return damageRollersInBlock(block).some(roller => Boolean(roller.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
}

function hasDamageRollerAfter (block, node) {
	return damageRollersInBlock(block).some(roller => Boolean(node.compareDocumentPosition(roller) & Node.DOCUMENT_POSITION_FOLLOWING));
}

function damageRollersInBlock (block) {
	return [...(block.querySelectorAll?.(".render-roller[data-packed-dice]") || [])].filter((roller) => {
		try {
			const packed = JSON.parse(roller.getAttribute("data-packed-dice"));
			return packed.subType === "damage";
		} catch (_) {
			return false;
		}
	});
}

function rollFromRoller (roller, evt) {
	let packed;
	try {
		packed = JSON.parse(roller.getAttribute("data-packed-dice"));
	} catch (_) {
		return null;
	}
	const isRecharge = packed.successThresh != null;
	const named = resolveRollerName(roller, packed, {isRecharge});
	if (named) packed.name = named;
	if (!packed.damageType && packed.subType === "damage") {
		const inferred = damageTypeNearRoller(roller);
		if (inferred) packed.damageType = inferred;
	}
	const result = rollPacked(packed, evt);
	if (named) {
		result.label = named;
		result.showLabel = true;
	}
	return result;
}

function rollDamagesFromTrigger (trigger, evt) {
	const block = trigger.closest?.("p, [data-roll-name-ancestor]") || trigger.parentElement;
	if (!block) return [];
	const end = nextDamageBoundary(block, trigger);
	const results = [];
	for (const roller of damageRollersInBlock(block)) {
		if (!isNodeBetween(trigger, roller, end)) continue;
		const result = rollFromRoller(roller, evt);
		if (result) results.push(result);
	}
	return results;
}

function nextDamageBoundary (block, trigger) {
	const boundaries = [...(block.querySelectorAll?.("[data-hit-roll], [data-or-roll]") || [])];
	return boundaries.find(el => el !== trigger
		&& Boolean(trigger.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) || null;
}

/** True if `node` is after `start` and (if `end`) before `end`. */
function isNodeBetween (start, node, end) {
	if (!Boolean(start.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
	if (!end) return true;
	return Boolean(node.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING);
}

const DAMAGE_TYPES = [
	"acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
	"piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

const SPELLCASTING_TRAIT_RE = /^(innate\s+)?spellcasting$/i;

function resolveRollerName (roller, packed, {isRecharge = false} = {}) {
	const attr = cleanRollerLabel(roller.getAttribute("data-roll-name"));
	if (attr && !(isRecharge && SPELLCASTING_TRAIT_RE.test(attr))) return attr;
	const packedName = cleanRollerLabel(packed?.name);
	if (packedName && !(isRecharge && SPELLCASTING_TRAIT_RE.test(packedName))) return packedName;

	const ancestor = roller.closest?.("[data-roll-name-ancestor]");
	const fromAncestor = cleanRollerLabel(ancestor?.getAttribute("data-roll-name-ancestor"));
	if (fromAncestor && !(isRecharge && SPELLCASTING_TRAIT_RE.test(fromAncestor))) return fromAncestor;

	if (isRecharge) {
		const fromLine = rechargeNameFromParent(roller);
		if (fromLine) return fromLine;
		return "Recharge";
	}
	return "";
}

function cleanRollerLabel (raw) {
	let s = String(raw || "").trim();
	if (!s) return "";
	s = s.replace(/\{@recharge[^}]*\}/gi, " ");
	s = s.replace(/\(?\s*Recharge\s+[\d\u2013\-]+(?:\s*[–\-]\s*\d+)?\s*\)?/gi, " ");
	s = s.replace(/\s+/g, " ").trim().replace(/[.,:]$/, "");
	return s;
}

function rechargeNameFromParent (roller) {
	const p = roller.closest?.("p");
	if (!p) return "";
	const links = [...(p.querySelectorAll?.("a") || [])]
		.map(a => String(a.textContent || "").trim())
		.filter(Boolean);
	if (links.length) return links[0];
	return "";
}

function damageTypeNearRoller (roller) {
	const parent = roller.parentElement;
	if (!parent) return "";
	let sawRoller = false;
	let after = "";
	for (const node of parent.childNodes) {
		if (node === roller || (node.contains && node.contains(roller))) {
			sawRoller = true;
			continue;
		}
		if (!sawRoller) continue;
		after += node.textContent || "";
		if (after.length > 80) break;
	}
	if (!after) {
		const full = String(parent.textContent || "");
		const idx = full.indexOf(roller.textContent || "");
		after = idx >= 0 ? full.slice(idx + String(roller.textContent || "").length) : full;
	}
	const re = new RegExp(`\\b(${DAMAGE_TYPES.join("|")})\\b`, "i");
	const m = after.match(re);
	return m ? m[1].toLowerCase() : "";
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

/** Roll a notation without showing a popup. A d20 natural 1 or 20 is `diceTotal`. */
export function rollDice (notation) {
	return rollNotation(notation);
}

/** Match web Renderer.dice lexer: natural-language ops → symbols. */
function normalizeDiceNotation (raw) {
	return String(raw || "")
		.replace(/\s*?\bplus\b\s*?/gi, " + ")
		.replace(/\s*?\bminus\b\s*?/gi, " - ")
		.replace(/\s*?\btimes\b\s*?/gi, " * ")
		.replace(/\s*?\bover\b\s*?/gi, " / ")
		.replace(/\s*?\bdivided by\b\s*?/gi, " / ")
		.replace(/[\u2012-\u2014\u2212]/g, "-")
		.trim();
}

function parseSimpleDice (raw) {
	let s = normalizeDiceNotation(raw).replace(/\s+/g, "");
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
