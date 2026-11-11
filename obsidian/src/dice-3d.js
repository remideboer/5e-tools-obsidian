import {normalizePath, Platform} from "obsidian";

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
/** All dice in one throw start inside this window, so a large pool still finishes with the roll. */
const SOUND_WINDOW_SEC = 0.2;
let rollSoundIndex = 0;
/** @type {AudioBufferSourceNode | null} */
let rollSoundKeep = null;
/** Silent media element. iPad silent mode mutes Web Audio on the speaker and still plays Bluetooth. */
let iosSpeakerRoute = null;
const IOS_SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

/**
 * Call from a click/touch handler (sync) so iOS unlocks Web Audio before awaits.
 * Safe to call often; no-ops when sound is off or AudioContext is missing.
 */
export function unlockDiceSound (plugin) {
	if (!plugin?.settings?.diceSound) return;
	const ctx = ensureAudioContext();
	if (!ctx) return;
	if (Platform.isIosApp) routeIosSpeaker();
	playSilentUnlock(ctx);
	holdAudioContext(ctx);
	if (ctx.state === "suspended") void ctx.resume?.();
	void ensureRollSound(plugin);
}

export async function showDice3d (plugin, result, doc = document) {
	const session = sessionFor(doc);
	if (session.unavailable || !plugin || !doc?.body) return false;
	const dice = (result?.dice || []).filter(it => SUPPORTED.has(Number(it.faces)));
	if (!dice.length) return false;
	// Still in the click/touch turn when presentRolls calls us — unlock before any await.
	if (plugin.settings?.diceSound) unlockDiceSound(plugin);
	try {
		if (!hasWebGl(doc)) throw new Error("WebGL unavailable");
		const roller = await getRoller(plugin, doc);
		if (!roller) return false;
		session.plugin = plugin;
		if (plugin.settings?.diceSound) {
			await ensureRollSound(plugin);
			await resumeAudioContext();
		}
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

function ensureAudioContext () {
	const Ctor = audioContextCtor();
	if (!Ctor) return null;
	if (!rollSoundCtx || rollSoundCtx.state === "closed") {
		rollSoundKeep = null;
		rollSoundCtx = new Ctor();
	}
	return rollSoundCtx;
}

function routeIosSpeaker () {
	const session = globalThis.navigator?.audioSession;
	if (session && "type" in session) {
		try { session.type = "playback"; } catch (_) { /* ignore */ }
	}
	if (iosSpeakerRoute) return;
	const el = new Audio(IOS_SILENT_WAV);
	el.setAttribute("playsinline", "");
	el.loop = true;
	iosSpeakerRoute = el;
	const pending = el.play();
	if (pending && typeof pending.catch === "function") void pending.catch(() => { iosSpeakerRoute = null; });
}

function playSilentUnlock (ctx) {
	if (!ctx) return;
	try {
		const buf = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.connect(ctx.destination);
		src.start(0);
	} catch (_) { /* ignore */ }
}

function holdAudioContext (ctx) {
	if (!ctx || rollSoundKeep) return;
	try {
		const buf = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.loop = true;
		const gain = ctx.createGain();
		gain.gain.value = 0;
		src.connect(gain);
		gain.connect(ctx.destination);
		src.start();
		rollSoundKeep = src;
	} catch (_) { /* ignore */ }
}

async function resumeAudioContext () {
	const ctx = ensureAudioContext();
	if (!ctx) return null;
	if (ctx.state === "suspended" && typeof ctx.resume === "function") {
		try { await ctx.resume(); } catch (_) { /* ignore */ }
	}
	return ctx;
}

function rollSoundVaultPath (plugin) {
	const dir = plugin?.manifest?.dir;
	if (!dir) return "";
	return normalizePath(`${dir}/dice/rolling.mp3`);
}

async function readBinaryRollSound (plugin) {
	const vaultPath = rollSoundVaultPath(plugin);
	const adapter = plugin?.app?.vault?.adapter;
	if (!vaultPath || typeof adapter?.readBinary !== "function") return null;
	try {
		const data = await adapter.readBinary(vaultPath);
		if (!data) return null;
		return data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
	} catch (_) {
		return null;
	}
}

async function fetchRollSoundBytes (plugin) {
	const vaultPath = rollSoundVaultPath(plugin);
	const adapter = plugin?.app?.vault?.adapter;
	if (!vaultPath || typeof adapter?.getResourcePath !== "function") return null;
	try {
		const url = adapter.getResourcePath(vaultPath);
		if (!url) return null;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.arrayBuffer();
	} catch (_) {
		return null;
	}
}

async function decodeRollSound (ctx, raw) {
	if (!ctx || !raw) return null;
	try {
		return await ctx.decodeAudioData(raw.slice(0));
	} catch (_) {
		return null;
	}
}

async function ensureRollSound (plugin) {
	const vaultPath = rollSoundVaultPath(plugin);
	if (!vaultPath) return null;
	if (rollSoundBuffer && rollSoundUrl === vaultPath) return rollSoundBuffer;
	if (rollSoundLoad && rollSoundUrl === vaultPath) return rollSoundLoad;
	rollSoundUrl = vaultPath;
	rollSoundBuffer = null;
	if (!ensureAudioContext()) return null;
	rollSoundLoad = (async () => {
		try {
			const ctx = await resumeAudioContext();
			if (!ctx) return null;
			rollSoundBuffer = await decodeRollSound(ctx, await readBinaryRollSound(plugin));
			if (!rollSoundBuffer) rollSoundBuffer = await decodeRollSound(ctx, await fetchRollSoundBytes(plugin));
			if (!rollSoundBuffer) throw new Error("rolling.mp3 missing or unreadable");
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
	if (ctx.state === "suspended") void ctx.resume?.();
	const index = rollSoundIndex++;
	try {
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		// Slight rate/pan spread so voices don't cancel into one mono hit.
		src.playbackRate.value = 0.94 + (index % 5) * 0.03;
		const pan = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
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
		src.start(ctx.currentTime + Math.random() * SOUND_WINDOW_SEC);
	} catch (_) { /* ignore autoplay / decode errors */ }
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
