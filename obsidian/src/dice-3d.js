import path from "path";
import {getPluginDir} from "./plugin-dir.js";

const SUPPORTED = new Set([4, 6, 8, 10, 12, 20, 100]);
const DIE_SCALE = 1.5;
const FADE_MS = 1000;

let rollerPromise = null;
let unavailable = false;
let hideToken = 0;

export async function showDice3d (plugin, result) {
	if (unavailable || !plugin) return false;
	const dice = (result?.dice || []).filter(it => SUPPORTED.has(Number(it.faces)));
	if (!dice.length) return false;
	try {
		if (!hasWebGl()) throw new Error("WebGL unavailable");
		const roller = await getRoller(plugin);
		if (!roller) return false;
		const overlay = ensureOverlay();
		showOverlay(overlay);
		const token = ++hideToken;
		if (typeof roller._handleResize === "function") roller._handleResize();
		await roller.roll(dice.map(it => ({
			dice: `d${it.faces}`,
			rolled: Number(it.value),
		})));
		window.setTimeout(() => {
			void fadeOutThenHide(roller, token);
		}, 1200);
		return true;
	} catch (e) {
		unavailable = true;
		rollerPromise = null;
		hideOverlay();
		console.warn("5etools 3D dice failed", e);
		return false;
	}
}

async function getRoller (plugin) {
	if (rollerPromise) return rollerPromise;
	rollerPromise = loadRoller(plugin).catch((e) => {
		unavailable = true;
		console.warn("5etools 3D dice unavailable", e);
		return null;
	});
	return rollerPromise;
}

async function loadRoller (plugin) {
	const DiceRoller = await loadDiceRoller(plugin);
	const overlay = ensureOverlay();
	showOverlay(overlay);
	const roller = new DiceRoller({
		container: overlay,
		width: Math.max(320, overlay.clientWidth || window.innerWidth || 800),
		height: Math.max(240, overlay.clientHeight || window.innerHeight || 600),
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

async function loadDiceRoller (plugin) {
	const file = path.join(getPluginDir(plugin), "dice", "dice-3d.js");
	const mod = runtimeRequire(file);
	const DiceRoller = mod?.DiceRoller || mod?.default?.DiceRoller || mod?.default;
	if (typeof DiceRoller !== "function") throw new Error("open-dice-dnd DiceRoller missing");
	return DiceRoller;
}

function hasWebGl () {
	try {
		const canvas = document.createElement("canvas");
		return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
	} catch (_) {
		return false;
	}
}

async function fadeOutThenHide (roller, token) {
	if (token !== hideToken) return;
	const el = ensureOverlay();
	el.style.opacity = "0";
	await new Promise(resolve => window.setTimeout(resolve, FADE_MS));
	if (token !== hideToken) return;
	hideOverlay();
}

function showOverlay (el) {
	el.style.transition = "none";
	el.style.opacity = "1";
	el.style.display = "";
	void el.offsetWidth;
	el.style.transition = `opacity ${FADE_MS}ms ease`;
}

function hideOverlay () {
	const el = document.getElementById("fiveetools-dice-overlay");
	if (!el) return;
	el.style.display = "none";
	el.style.opacity = "1";
}

function ensureOverlay () {
	let el = document.getElementById("fiveetools-dice-overlay");
	if (el) return el;
	el = document.createElement("div");
	el.id = "fiveetools-dice-overlay";
	el.className = "fiveetools-dice-overlay";
	el.style.display = "none";
	document.body.appendChild(el);
	return el;
}
