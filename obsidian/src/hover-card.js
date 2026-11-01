import {loadEntity} from "./entity-loader.js";
import {loadPageForDoc, renderCompactHtml} from "./compact-render.js";
import {bindDiceRollers} from "./dice-roll.js";
import {resolveEntityImages, toPreviewSrc} from "./image-resolver.js";
import {cachedMediaSrc} from "./media-cache.js";

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
			const target = readTarget(getDoc);
			if (!target) return;
			scheduleShow(el, plugin, target.doc, enterEvt.clientX, enterEvt.clientY, target.ent);
		});
		el.addEventListener("mouseleave", (leaveEvt) => {
			if (el.contains(leaveEvt.relatedTarget)) return;
			scheduleHide(el);
		});
	}
	if (!evt) return;
	const target = readTarget(getDoc);
	if (!target) return;
	scheduleShow(el, plugin, target.doc, evt.clientX, evt.clientY, target.ent);
}

function readTarget (getDoc) {
	try {
		const value = typeof getDoc === "function" ? getDoc() : getDoc;
		if (!value) return null;
		if (value.ent || value.doc) {
			const doc = value.doc || null;
			if (!value.ent && doc && !doc.n && !doc.u) return null;
			return {doc, ent: value.ent || null};
		}
		if (!value.n && !value.u) return null;
		return {doc: value, ent: null};
	} catch (_) {
		return null;
	}
}

function scheduleShow (el, plugin, doc, x, y, ent) {
	clearTimers();
	anchor = el;
	const id = ++token;
	showTimer = window.setTimeout(() => {
		showTimer = null;
		void showCard(id, plugin, doc, x, y, ent);
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

async function showCard (id, plugin, doc, x, y, ent) {
	if (id !== token) return;
	if (plugin?.ensureReady && !await plugin.ensureReady()) return;
	if (id !== token) return;
	let creature = ent || null;
	if (!creature && doc) {
		const loaded = await loadEntity(doc);
		creature = loaded?.ent || null;
	}
	if (id !== token || !creature) return;
	const html = renderCompactHtml(creature, doc ? loadPageForDoc(doc) : null);
	if (id !== token) return;
	const images = isBestiary(creature, doc) ? await hoverImages(plugin, creature) : [];
	if (id !== token) return;
	card?.remove();
	const docEl = anchor?.ownerDocument || document;
	const panel = docEl.createElement("div");
	panel.className = "fiveetools-hover-card";
	panel.innerHTML = html;
	if (images.length) {
		const wrap = docEl.createElement("div");
		wrap.className = "fiveetools-hover-card__images";
		const alt = creature.name || doc?.n || "";
		for (const src of images) {
			const img = docEl.createElement("img");
			img.src = src;
			img.alt = alt;
			wrap.appendChild(img);
		}
		panel.insertBefore(wrap, panel.firstChild);
	}
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

function isBestiary (ent, doc) {
	if (ent?.__prop === "monster") return true;
	if (Number(doc?.c) === 1) return true;
	return String(doc?.cf || "").toLowerCase() === "bestiary";
}

async function hoverImages (plugin, ent) {
	try {
		const resolved = await resolveEntityImages(ent, {imageBaseUrl: plugin?.settings?.imageBaseUrl});
		const preview = resolved.slice(0, 2);
		const srcs = await Promise.all(preview.map(image => cachedMediaSrc(plugin, toPreviewSrc(image))));
		return srcs.filter(Boolean);
	} catch (_) {
		return [];
	}
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
