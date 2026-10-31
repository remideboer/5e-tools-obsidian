import {loadEntity} from "./entity-loader.js";
import {loadPageForDoc, renderCompactHtml} from "./compact-render.js";
import {bindDiceRollers} from "./dice-roll.js";

const SHOW_DELAY = 350;
const HIDE_DELAY = 150;

let token = 0;
let showTimer = null;
let hideTimer = null;
let card = null;
let anchor = null;

export function attachHoverCard (el, plugin, getDoc, evt) {
	if (!el) return;
	if (el.dataset.fiveetoolsHover !== "1") {
		el.dataset.fiveetoolsHover = "1";
		el.removeAttribute("title");
		el.addEventListener("mouseenter", (enterEvt) => {
			const doc = readDoc(getDoc);
			if (!doc) return;
			scheduleShow(el, plugin, doc, enterEvt.clientX, enterEvt.clientY);
		});
		el.addEventListener("mouseleave", (leaveEvt) => {
			if (el.contains(leaveEvt.relatedTarget)) return;
			scheduleHide(el);
		});
	}
	if (!evt) return;
	const doc = readDoc(getDoc);
	if (!doc) return;
	scheduleShow(el, plugin, doc, evt.clientX, evt.clientY);
}

function readDoc (getDoc) {
	try {
		const doc = typeof getDoc === "function" ? getDoc() : getDoc;
		if (!doc || (!doc.n && !doc.u)) return null;
		return doc;
	} catch (_) {
		return null;
	}
}

function scheduleShow (el, plugin, doc, x, y) {
	clearTimers();
	anchor = el;
	const id = ++token;
	showTimer = window.setTimeout(() => {
		showTimer = null;
		void showCard(id, plugin, doc, x, y);
	}, SHOW_DELAY);
}

function scheduleHide (el) {
	if (anchor !== el) return;
	if (hideTimer) window.clearTimeout(hideTimer);
	hideTimer = window.setTimeout(() => {
		hideTimer = null;
		if (card?.matches(":hover") || anchor?.matches(":hover")) return;
		closeCard();
	}, HIDE_DELAY);
}

function clearTimers () {
	if (showTimer) window.clearTimeout(showTimer);
	if (hideTimer) window.clearTimeout(hideTimer);
	showTimer = null;
	hideTimer = null;
}

function closeCard () {
	token += 1;
	clearTimers();
	card?.remove();
	card = null;
	anchor = null;
}

async function showCard (id, plugin, doc, x, y) {
	if (id !== token) return;
	if (plugin?.ensureReady && !await plugin.ensureReady()) return;
	if (id !== token) return;
	const loaded = await loadEntity(doc);
	if (id !== token || !loaded?.ent) return;
	const html = renderCompactHtml(loaded.ent, loadPageForDoc(doc));
	if (id !== token) return;
	card?.remove();
	const docEl = anchor?.ownerDocument || document;
	const panel = docEl.createElement("div");
	panel.className = "fiveetools-hover-card";
	panel.innerHTML = html;
	bindDiceRollers(panel, plugin);
	docEl.body.appendChild(panel);
	placeCard(panel, x, y);
	panel.addEventListener("mouseenter", () => {
		if (hideTimer) {
			window.clearTimeout(hideTimer);
			hideTimer = null;
		}
	});
	panel.addEventListener("mouseleave", () => scheduleHide(anchor));
	card = panel;
}

function placeCard (panel, x, y) {
	const margin = 12;
	const win = panel.ownerDocument.defaultView || window;
	panel.style.left = "0px";
	panel.style.top = "0px";
	const rect = panel.getBoundingClientRect();
	let left = x + 16;
	let top = y + 16;
	if (left + rect.width > win.innerWidth - margin) left = Math.max(margin, x - rect.width - 16);
	if (top + rect.height > win.innerHeight - margin) top = Math.max(margin, win.innerHeight - rect.height - margin);
	panel.style.left = `${left}px`;
	panel.style.top = `${top}px`;
}
