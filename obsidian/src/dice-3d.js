import {normalizePath} from "obsidian";

const SUPPORTED = new Set([4, 6, 8, 10, 12, 20, 100]);
const DIE_SCALE = 1.5;
const FADE_MS = 1000;
const OVERLAY_ID = "fiveetools-dice-overlay";

const sessions = new Map();
let diceRollerPromise = null;
/** @type {AudioContext | null} */
let rollSoundCtx = null;
/** @type {AudioBuffer | null} */
let rollSoundBuffer = null;
let rollSoundUrl = "";
let rollSoundLoad = null;
/** Gap between per-die throw SFX so overlaps stay audible as separate voices. */
const SOUND_STAGGER_SEC = 0.12;
let rollSoundIndex = 0;

export async function showDice3d (plugin, result, doc = document) {
	const session = sessionFor(doc);
	if (session.unavailable || !plugin || !doc?.body) return false;
	const dice = (result?.dice || []).filter(it => SUPPORTED.has(Number(it.faces)));
	if (!dice.length) return false;
	try {
		if (!hasWebGl(doc)) throw new Error("WebGL unavailable");
		const roller = await getRoller(plugin, doc);
		if (!roller) return false;
		session.plugin = plugin;
		await ensureRollSound(plugin);
		rollSoundIndex = 0;
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
	const session = sessionFor(doc);
	session.plugin = plugin;
	void ensureRollSound(plugin);
	fitDice(roller, overlay, doc);
	return roller;
}

function fitDice (roller, overlay, doc) {
	const origApply = roller._applyDiePhysics?.bind(roller);
	if (origApply) {
		roller._applyDiePhysics = function (die, seed) {
			scaleDie(die, DIE_SCALE);
			const out = origApply(die, seed);
			const plugin = sessionFor(doc).plugin;
			if (plugin?.settings?.diceSound && die?.mesh?.visible !== false) playRollSound();
			return out;
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

function audioContextCtor () {
	return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

async function ensureRollSound (plugin) {
	const dir = plugin?.manifest?.dir;
	const adapter = plugin?.app?.vault?.adapter;
	if (!dir || !adapter?.getResourcePath) return null;
	const vaultPath = normalizePath(`${dir}/dice/rolling.mp3`);
	const url = adapter.getResourcePath(vaultPath);
	if (!url) return null;
	if (rollSoundBuffer && rollSoundUrl === url) return rollSoundBuffer;
	if (rollSoundLoad && rollSoundUrl === url) return rollSoundLoad;
	rollSoundUrl = url;
	rollSoundBuffer = null;
	const Ctor = audioContextCtor();
	if (!Ctor) return null;
	rollSoundLoad = (async () => {
		try {
			if (!rollSoundCtx || rollSoundCtx.state === "closed") rollSoundCtx = new Ctor();
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const raw = await res.arrayBuffer();
			rollSoundBuffer = await rollSoundCtx.decodeAudioData(raw.slice(0));
			return rollSoundBuffer;
		} catch (e) {
			console.warn("5etools dice roll sound failed to load", e);
			rollSoundBuffer = null;
			return null;
		} finally {
			rollSoundLoad = null;
		}
	})();
	return rollSoundLoad;
}

function playRollSound () {
	const ctx = rollSoundCtx;
	const buffer = rollSoundBuffer;
	if (!ctx || !buffer) return;
	const index = rollSoundIndex++;
	const startAt = () => {
		try {
			if (ctx.state === "suspended") void ctx.resume?.();
			const src = ctx.createBufferSource();
			src.buffer = buffer;
			// Slight rate/pan spread so voices don't cancel into one mono hit.
			src.playbackRate.value = 0.94 + (index % 5) * 0.03;
			const pan = ctx.createStereoPanner?.() || null;
			const gain = ctx.createGain();
			gain.gain.value = 0.85;
			if (pan) {
				pan.pan.value = ((index % 5) - 2) * 0.28;
				src.connect(pan);
				pan.connect(gain);
			} else {
				src.connect(gain);
			}
			gain.connect(ctx.destination);
			src.start(ctx.currentTime + index * SOUND_STAGGER_SEC);
		} catch (_) { /* ignore autoplay / decode errors */ }
	};
	startAt();
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

function loadDiceRoller (plugin) {
	if (!diceRollerPromise) {
		diceRollerPromise = injectDiceScript(plugin).then(() => {
			const DiceRoller = globalThis.FiveEToolsDice?.DiceRoller;
			if (typeof DiceRoller !== "function") throw new Error("open-dice-dnd DiceRoller missing");
			return DiceRoller;
		}).catch((e) => {
			diceRollerPromise = null;
			throw e;
		});
	}
	return diceRollerPromise;
}

function injectDiceScript (plugin) {
	if (typeof globalThis.FiveEToolsDice?.DiceRoller === "function") return Promise.resolve();
	const dir = plugin?.manifest?.dir;
	if (!dir) return Promise.reject(new Error("3D dice bundle is not installed."));
	const vaultPath = normalizePath(`${dir}/dice/dice-3d.js`);
	const url = plugin.app.vault.adapter.getResourcePath(vaultPath);
	return new Promise((resolve, reject) => {
		const fail = () => reject(new Error("Could not load 3D dice. Rebuild the plugin so dice/ is installed."));
		const existing = document.querySelector(`script[data-fiveetools-dice="1"]`);
		if (existing) {
			if (typeof globalThis.FiveEToolsDice?.DiceRoller === "function") {
				resolve();
				return;
			}
			existing.addEventListener("load", () => {
				if (typeof globalThis.FiveEToolsDice?.DiceRoller === "function") resolve();
				else fail();
			});
			existing.addEventListener("error", fail);
			return;
		}
		const script = document.createElement("script");
		script.src = url;
		script.async = true;
		script.dataset.fiveetoolsDice = "1";
		script.onload = () => {
			if (typeof globalThis.FiveEToolsDice?.DiceRoller === "function") resolve();
			else fail();
		};
		script.onerror = fail;
		document.head.appendChild(script);
	});
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
