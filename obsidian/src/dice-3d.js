import path from "path";
import {getPluginDir} from "./plugin-dir.js";

const SUPPORTED = new Set([4, 6, 8, 10, 12, 20, 100]);
const DIE_SCALE = 1.5;
const FADE_MS = 1000;
const OVERLAY_ID = "fiveetools-dice-overlay";

const sessions = new Map();
let diceRollerPromise = null;

export async function showDice3d (plugin, result, doc = document) {
	const session = sessionFor(doc);
	if (session.unavailable || !plugin || !doc?.body) return false;
	const dice = (result?.dice || []).filter(it => SUPPORTED.has(Number(it.faces)));
	if (!dice.length) return false;
	try {
		if (!hasWebGl(doc)) throw new Error("WebGL unavailable");
		const roller = await getRoller(plugin, doc);
		if (!roller) return false;
		const overlay = ensureOverlay(doc);
		showOverlay(overlay);
		const token = ++session.hideToken;
		if (typeof roller._handleResize === "function") roller._handleResize();
		await roller.roll(dice.map(it => ({
			dice: `d${it.faces}`,
			rolled: Number(it.value),
		})));
		const win = doc.defaultView || window;
		win.setTimeout(() => {
			void fadeOutThenHide(doc, token);
		}, 1200);
		return true;
	} catch (e) {
		session.unavailable = true;
		session.rollerPromise = null;
		hideOverlay(doc);
		console.warn("5etools 3D dice failed", e);
		return false;
	}
}

function sessionFor (doc) {
	let session = sessions.get(doc);
	if (!session) {
		session = {rollerPromise: null, unavailable: false, hideToken: 0};
		sessions.set(doc, session);
	}
	return session;
}

async function getRoller (plugin, doc) {
	const session = sessionFor(doc);
	if (session.rollerPromise) return session.rollerPromise;
	session.rollerPromise = loadRoller(plugin, doc).catch((e) => {
		session.unavailable = true;
		session.rollerPromise = null;
		console.warn("5etools 3D dice unavailable", e);
		return null;
	});
	return session.rollerPromise;
}

async function loadRoller (plugin, doc) {
	const DiceRoller = await loadDiceRoller(plugin);
	const overlay = ensureOverlay(doc);
	showOverlay(overlay);
	const view = doc.defaultView || window;
	const roller = new DiceRoller({
		container: overlay,
		width: Math.max(320, overlay.clientWidth || view.innerWidth || 800),
		height: Math.max(240, overlay.clientHeight || view.innerHeight || 600),
	});
	fitDice(roller, overlay);
	return roller;
}

function fitDice (roller, overlay) {
	const origApply = roller._applyDiePhysics?.bind(roller);
	if (origApply) {
		roller._applyDiePhysics = function (die, seed) {
			scaleDie(die, DIE_SCALE);
			return origApply(die, seed);
		};
	}
	const origResize = roller._handleResize?.bind(roller);
	if (origResize) {
		roller._handleResize = function () {
			if (overlay.style.display === "none") return;
			origResize();
		};
	}
}

function scaleDie (die, factor) {
	if (!die?.mesh || !die?.body) return;
	die.mesh.scale.setScalar(factor);
	for (const shape of die.body.shapes || []) {
		if (shape.halfExtents?.scale) shape.halfExtents.scale(factor, shape.halfExtents);
		else if (shape.vertices) {
			for (const v of shape.vertices) {
				if (v?.scale) v.scale(factor, v);
			}
		}
		if (typeof shape.updateConvexPolyhedronRepresentation === "function") {
			shape.updateConvexPolyhedronRepresentation();
		}
		if (typeof shape.updateBoundingSphereRadius === "function") {
			shape.updateBoundingSphereRadius();
		}
	}
	if (typeof die.body.updateBoundingRadius === "function") die.body.updateBoundingRadius();
	if (typeof die.body.updateMassProperties === "function") die.body.updateMassProperties();
}

function runtimeRequire (id) {
	if (typeof require === "function") return require(id);
	if (typeof globalThis.require === "function") return globalThis.require(id);
	throw new Error("require unavailable");
}

function loadDiceRoller (plugin) {
	if (!diceRollerPromise) {
		diceRollerPromise = Promise.resolve().then(() => {
			const file = path.join(getPluginDir(plugin), "dice", "dice-3d.js");
			const mod = runtimeRequire(file);
			const DiceRoller = mod?.DiceRoller || mod?.default?.DiceRoller || mod?.default;
			if (typeof DiceRoller !== "function") throw new Error("open-dice-dnd DiceRoller missing");
			return DiceRoller;
		}).catch((e) => {
			diceRollerPromise = null;
			throw e;
		});
	}
	return diceRollerPromise;
}

function hasWebGl (doc) {
	try {
		const canvas = doc.createElement("canvas");
		return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
	} catch (_) {
		return false;
	}
}

async function fadeOutThenHide (doc, token) {
	const session = sessionFor(doc);
	if (token !== session.hideToken) return;
	const el = ensureOverlay(doc);
	el.style.opacity = "0";
	const win = doc.defaultView || window;
	await new Promise(resolve => win.setTimeout(resolve, FADE_MS));
	if (token !== session.hideToken) return;
	hideOverlay(doc);
}

function showOverlay (el) {
	el.style.transition = "none";
	el.style.opacity = "1";
	el.style.display = "";
	void el.offsetWidth;
	el.style.transition = `opacity ${FADE_MS}ms ease`;
}

function hideOverlay (doc) {
	const el = doc.getElementById(OVERLAY_ID);
	if (!el) return;
	el.style.display = "none";
	el.style.opacity = "1";
}

function ensureOverlay (doc) {
	let el = doc.getElementById(OVERLAY_ID);
	if (el) return el;
	el = doc.createElement("div");
	el.id = OVERLAY_ID;
	el.className = "fiveetools-dice-overlay";
	el.style.display = "none";
	doc.body.appendChild(el);
	return el;
}
