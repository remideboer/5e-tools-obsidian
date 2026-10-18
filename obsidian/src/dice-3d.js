import path from "path";
import {getPluginDir} from "./plugin-dir.js";

const SUPPORTED = new Set([4, 6, 8, 10, 12, 20, 100]);

let rollerPromise = null;
let unavailable = false;

export async function showDice3d (plugin, result) {
	if (unavailable || !plugin) return false;
	const dice = (result?.dice || []).filter(it => SUPPORTED.has(Number(it.faces)));
	if (!dice.length) return false;
	try {
		if (!hasWebGl()) throw new Error("WebGL unavailable");
		const roller = await getRoller(plugin);
		if (!roller) return false;
		const overlay = ensureOverlay();
		overlay.style.display = "";
		await roller.roll(dice.map(it => ({
			dice: `d${it.faces}`,
			rolled: Number(it.value),
		})));
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
	overlay.style.display = "";
	const roller = new DiceRoller({
		container: overlay,
		width: Math.max(320, window.innerWidth || 800),
		height: Math.max(240, window.innerHeight || 600),
		onRollComplete: () => {
			window.setTimeout(hideOverlay, 1200);
		},
	});
	return roller;
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

function hideOverlay () {
	const el = document.getElementById("fiveetools-dice-overlay");
	if (el) el.style.display = "none";
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
