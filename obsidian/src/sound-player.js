import {activePlaylist, getClip, getSoundLibrary, onSoundLibrary} from "./sound-store.js";

const playbackListeners = new Set();
const state = {
	playing: false,
	loop: false,
	volume: 0.8,
	index: 0,
	overrideId: "",
};

let bedEl = null;
let stingEl = null;
let lastPlugin = null;
let boundPlaylist = "";

/**
 * A YouTube or YouTube Music address is stored, then opened in the browser.
 * Those terms do not allow playing the audio on its own.
 */
export function isBrowserClip (clip) {
	if (clip?.source !== "url" || !clip.url) return false;
	try {
		const host = new URL(clip.url).hostname.replace(/^www\./, "");
		return host === "youtu.be" || host === "music.youtube.com" || host.endsWith("youtube.com");
	} catch (_) {
		return false;
	}
}

export function getSoundPlayback () {
	return {
		playing: state.playing,
		loop: state.loop,
		volume: state.volume,
		index: state.index,
		clipId: currentBedClip()?.id || "",
	};
}

export function onSoundPlayback (fn) {
	playbackListeners.add(fn);
	return () => playbackListeners.delete(fn);
}

export function currentBedClip () {
	if (state.overrideId) {
		const clip = getClip(state.overrideId);
		if (clip) return clip;
		state.overrideId = "";
	}
	const queue = bedQueue();
	if (!queue.length) return null;
	if (state.index < 0 || state.index >= queue.length) state.index = 0;
	return queue[state.index];
}

/** Starts the bed in this turn. Call from the click, before any await. */
export function playBed (plugin) {
	lastPlugin = plugin || lastPlugin;
	const clip = currentBedClip();
	if (!clip) return "empty";
	if (isBrowserClip(clip)) {
		bedEl?.pause();
		state.playing = false;
		emitPlayback();
		openBrowser(clip.url);
		return "browser";
	}
	const src = clipUrl(lastPlugin, clip);
	const el = bedElement();
	if (!src || !el) return "empty";
	routePlayback();
	if (el.dataset.clipId !== clip.id) {
		el.src = src;
		el.dataset.clipId = clip.id;
	} else if (el.ended) {
		try { el.currentTime = 0; } catch (_) { /* the element may not have data yet */ }
	}
	el.loop = state.loop;
	el.volume = state.volume;
	const pending = el.play();
	state.playing = true;
	emitPlayback();
	if (pending && typeof pending.catch === "function") {
		pending.catch(() => {
			state.playing = false;
			emitPlayback();
		});
	}
	return "playing";
}

export function pauseBed () {
	bedEl?.pause();
	state.playing = false;
	emitPlayback();
}

/** Pauses the bed and the effect, and rewinds both. */
export function stopSound () {
	if (bedEl) {
		bedEl.pause();
		try { bedEl.currentTime = 0; } catch (_) { /* not loaded yet */ }
	}
	if (stingEl) {
		stingEl.pause();
		try { stingEl.currentTime = 0; } catch (_) { /* not loaded yet */ }
	}
	state.playing = false;
	emitPlayback();
}

export function stepBed (plugin, delta) {
	lastPlugin = plugin || lastPlugin;
	const queue = bedQueue();
	if (!queue.length) return;
	state.overrideId = "";
	state.index = (state.index + delta + queue.length) % queue.length;
	if (state.playing) playBed(lastPlugin);
	else emitPlayback();
}

export function toggleLoop () {
	state.loop = !state.loop;
	if (bedEl) bedEl.loop = state.loop;
	emitPlayback();
}

export function setVolume (value) {
	const next = Math.max(0, Math.min(1, Number(value) || 0));
	state.volume = next;
	if (bedEl) bedEl.volume = next;
	if (stingEl) stingEl.volume = next;
	emitPlayback();
}

export function playClip (plugin, clipId) {
	const clip = getClip(clipId);
	if (!clip) return;
	if (isBrowserClip(clip)) {
		openBrowser(clip.url);
		return;
	}
	if (clip.kind === "effect") {
		playEffect(plugin, clip);
		return;
	}
	const ix = bedQueue().findIndex(it => it.id === clip.id);
	if (ix >= 0) {
		state.index = ix;
		state.overrideId = "";
	} else state.overrideId = clip.id;
	playBed(plugin);
}

/** Plays once on the effect element. The bed keeps running. */
export function playEffect (plugin, clipOrId) {
	const clip = typeof clipOrId === "string" ? getClip(clipOrId) : clipOrId;
	if (!clip) return;
	if (isBrowserClip(clip)) {
		openBrowser(clip.url);
		return;
	}
	const src = clipUrl(plugin, clip);
	const el = stingElement();
	if (!src || !el) return;
	routePlayback();
	el.loop = false;
	el.volume = state.volume;
	if (el.dataset.clipId === clip.id) {
		try { el.currentTime = 0; } catch (_) { /* restart after src is set */ }
	} else {
		el.src = src;
		el.dataset.clipId = clip.id;
	}
	const pending = el.play();
	if (pending && typeof pending.catch === "function") pending.catch(() => {});
}

function bedQueue () {
	const list = activePlaylist();
	if (!list) return [];
	return list.clipIds
		.map(id => getClip(id))
		.filter(clip => clip && clip.kind !== "effect" && !isBrowserClip(clip));
}

function bedElement () {
	if (bedEl) return bedEl;
	bedEl = mediaElement();
	if (!bedEl) return null;
	bedEl.addEventListener("ended", () => {
		if (state.loop) return;
		if (state.overrideId) {
			state.overrideId = "";
			if (bedQueue().length && lastPlugin) playBed(lastPlugin);
			else {
				state.playing = false;
				emitPlayback();
			}
			return;
		}
		const queue = bedQueue();
		if (state.index + 1 < queue.length && lastPlugin) {
			state.index += 1;
			playBed(lastPlugin);
			return;
		}
		state.playing = false;
		emitPlayback();
	});
	return bedEl;
}

function stingElement () {
	if (!stingEl) stingEl = mediaElement();
	return stingEl;
}

function mediaElement () {
	if (typeof Audio !== "function") return null;
	const el = new Audio();
	el.preload = "auto";
	el.playsInline = true;
	el.setAttribute("playsinline", "");
	return el;
}

function routePlayback () {
	const session = globalThis.navigator?.audioSession;
	if (session && "type" in session) {
		try { session.type = "playback"; } catch (_) { /* ignore */ }
	}
}

function clipUrl (plugin, clip) {
	if (!clip) return "";
	if (clip.source === "url") return clip.url;
	try {
		return plugin?.app?.vault?.adapter?.getResourcePath?.(clip.path) || "";
	} catch (_) {
		return "";
	}
}

function openBrowser (url) {
	window.open(url, "_blank", "noopener");
}

function emitPlayback () {
	const snapshot = getSoundPlayback();
	for (const fn of [...playbackListeners]) fn(snapshot);
}

boundPlaylist = getSoundLibrary().activePlaylistId || "";
onSoundLibrary(() => {
	if (state.overrideId && !getClip(state.overrideId)) state.overrideId = "";
	const id = getSoundLibrary().activePlaylistId || "";
	const switched = id !== boundPlaylist;
	if (switched) {
		boundPlaylist = id;
		state.index = 0;
		state.overrideId = "";
	}
	const queue = bedQueue();
	if (state.index >= queue.length) state.index = 0;
	if (state.playing && lastPlugin) {
		const clip = currentBedClip();
		if (!clip) {
			state.playing = false;
			bedEl?.pause();
		} else if (switched || (bedEl && bedEl.dataset.clipId && bedEl.dataset.clipId !== clip.id)) {
			playBed(lastPlugin);
			return;
		}
	}
	emitPlayback();
});
