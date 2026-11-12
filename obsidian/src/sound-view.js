import {Notice} from "obsidian";
import {
	activePlaylist,
	addClip,
	addClipToPlaylist,
	addPlaylist,
	addSoundFolder,
	getClip,
	getSoundLibrary,
	listSelectableClips,
	loadSoundLibrary,
	moveClipInPlaylist,
	onSoundLibrary,
	removeClip,
	removeClipFromPlaylist,
	removePlaylist,
	removeSoundFolder,
	setActivePlaylist,
} from "./sound-store.js";
import {
	currentBedClip,
	getSoundPlayback,
	isBrowserClip,
	onSoundPlayback,
	pauseBed,
	playBed,
	playClip,
	playEffect,
	setVolume,
	stepBed,
	stopSound,
	toggleLoop,
} from "./sound-player.js";

const AUDIO_EXT = new Set(["mp3", "ogg", "wav", "m4a", "aac", "flac", "webm", "opus"]);
const KINDS = [
	["music", "Music"],
	["ambience", "Ambience"],
	["effect", "Effect"],
];

let stopTool = null;
let stopWidget = null;

export function teardownSoundTool () {
	stopTool?.();
	stopTool = null;
}

/**
 * Tools → Sounds. A row plays that clip. Enter on a link or a vault file adds it.
 * @param {HTMLElement} listEl
 * @param {HTMLElement} readerEl
 * @param {{ plugin: object }} opts
 */
export function renderSoundTool (listEl, readerEl, {plugin} = {}) {
	teardownSoundTool();
	listEl.empty();
	listEl.addClass("fiveetools-sound");
	readerEl?.empty();
	readerEl?.addClass("fiveetools-sound-reader");

	let kind = "all";
	let query = "";
	let fileIndex = 0;
	let fileHitsDocs = [];
	let folderIndex = 0;
	let folderHitsDocs = [];

	listEl.createEl("h3", {text: "Sounds"});
	listEl.createEl("p", {cls: "fiveetools-view__meta", text: "Click a clip to play it. Sounds from a chosen folder are listed here."});
	const nowEl = listEl.createEl("p", {cls: "fiveetools-view__meta"});
	const transport = listEl.createDiv({cls: "fiveetools-sound__row"});
	const prevBtn = transport.createEl("button", {
		text: "Prev",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	const playBtn = transport.createEl("button", {
		text: "Play",
		cls: "fiveetools-btn",
		attr: {type: "button"},
	});
	const stopBtn = transport.createEl("button", {
		text: "Stop",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Stop the bed and the effect"},
	});
	const nextBtn = transport.createEl("button", {
		text: "Next",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	const loopBtn = transport.createEl("button", {
		text: "Loop",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Repeat the current clip"},
	});
	const volumeEl = listEl.createEl("input", {
		cls: "fiveetools-sound__volume",
		attr: {type: "range", min: "0", max: "100", value: String(Math.round(getSoundPlayback().volume * 100))},
	});
	const filters = listEl.createDiv({cls: "fiveetools-sound__row"});
	const kindSel = filters.createEl("select", {attr: {title: "Kind"}});
	kindSel.createEl("option", {attr: {value: "all"}, text: "All"});
	for (const [value, text] of KINDS) kindSel.createEl("option", {attr: {value}, text});
	const search = filters.createEl("input", {
		cls: "fiveetools-sound__grow",
		attr: {type: "search", placeholder: "Search clips"},
	});
	const clipsEl = listEl.createDiv({cls: "fiveetools-sound__clips"});

	readerEl?.createEl("h3", {text: "Add a clip"});
	readerEl?.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Point at a sound folder to list its audio files. A single file or a direct link can be added too. A YouTube link opens in the browser.",
	});
	const nameRow = readerEl?.createDiv({cls: "fiveetools-sound__row"});
	const addName = nameRow?.createEl("input", {
		cls: "fiveetools-sound__grow",
		attr: {type: "text", placeholder: "Name"},
	});
	const addKind = nameRow?.createEl("select", {attr: {title: "Kind of the new clip"}});
	for (const [value, text] of KINDS) addKind?.createEl("option", {attr: {value}, text});
	const urlRow = readerEl?.createDiv({cls: "fiveetools-sound__row"});
	const addUrl = urlRow?.createEl("input", {
		cls: "fiveetools-sound__grow",
		attr: {type: "url", placeholder: "https://… audio link"},
	});
	const fileRow = readerEl?.createDiv({cls: "fiveetools-sound__row"});
	const fileSearch = fileRow?.createEl("input", {
		cls: "fiveetools-sound__grow",
		attr: {type: "search", placeholder: "Vault audio file"},
	});
	const fileHits = readerEl?.createDiv({cls: "fiveetools-sound__files"});
	const folderRow = readerEl?.createDiv({cls: "fiveetools-sound__row"});
	const folderSearch = folderRow?.createEl("input", {
		cls: "fiveetools-sound__grow",
		attr: {
			type: "search",
			placeholder: "Sound folder",
			title: "Audio files in this folder, and its subfolders, become clips of the selected kind",
		},
	});
	const folderHits = readerEl?.createDiv({cls: "fiveetools-sound__files"});
	const folderList = readerEl?.createDiv({cls: "fiveetools-sound__folders"});

	readerEl?.createEl("h3", {text: "Playlists"});
	const listRow = readerEl?.createDiv({cls: "fiveetools-sound__row"});
	const playlistSel = listRow?.createEl("select", {
		cls: "fiveetools-sound__grow",
		attr: {title: "Active playlist"},
	});
	const delList = listRow?.createEl("button", {
		text: "×",
		cls: "fiveetools-btn fiveetools-btn--ghost fiveetools-sound__icon",
		attr: {type: "button", title: "Remove this playlist"},
	});
	const newRow = readerEl?.createDiv({cls: "fiveetools-sound__row"});
	const playlistName = newRow?.createEl("input", {
		cls: "fiveetools-sound__grow",
		attr: {type: "text", placeholder: "New playlist"},
	});
	const tracksEl = readerEl?.createDiv({cls: "fiveetools-sound__tracks"});

	const paintClips = () => {
		clipsEl.empty();
		const q = query.trim().toLowerCase();
		const clips = listSelectableClips(plugin).filter(clip => {
			if (kind !== "all" && clip.kind !== kind) return false;
			if (!q) return true;
			return clip.name.toLowerCase().includes(q)
				|| clip.path.toLowerCase().includes(q)
				|| clip.url.toLowerCase().includes(q);
		});
		if (!clips.length) {
			clipsEl.createEl("p", {cls: "fiveetools-view__meta", text: "No clips yet."});
			return;
		}
		const playingId = currentBedClip()?.id || "";
		for (const clip of clips) {
			const row = clipsEl.createDiv({
				cls: "fiveetools-sound__clip",
				attr: {"data-clip": clip.id},
			});
			if (clip.id === playingId) row.addClass("is-selected");
			row.createEl("span", {cls: "fiveetools-sound__kind", text: clip.kind});
			row.createEl("span", {cls: "fiveetools-sound__name", text: clip.name});
			if (isBrowserClip(clip)) row.createEl("span", {cls: "fiveetools-sound__tag", text: "link"});
			const addBtn = row.createEl("button", {
				text: "+",
				cls: "fiveetools-btn fiveetools-btn--ghost fiveetools-sound__icon",
				attr: {type: "button", title: "Add to the active playlist"},
			});
			row.addEventListener("click", () => playClip(plugin, clip.id));
			addBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				const id = getSoundLibrary().activePlaylistId;
				if (!id) {
					new Notice("Choose a playlist first.");
					return;
				}
				addClipToPlaylist(plugin, id, clip.id);
			});
			if (clip.fromFolder) continue;
			const delBtn = row.createEl("button", {
				text: "×",
				cls: "fiveetools-btn fiveetools-btn--ghost fiveetools-sound__icon",
				attr: {type: "button", title: "Remove from the library"},
			});
			delBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				removeClip(plugin, clip.id);
			});
		}
	};

	const syncSelected = () => {
		const playback = getSoundPlayback();
		const id = playback.clipId || "";
		const clip = currentBedClip();
		const list = activePlaylist();
		if (clip && list) nowEl.setText(`${list.name} · ${clip.name}`);
		else if (clip) nowEl.setText(clip.name);
		else if (list) nowEl.setText(list.name);
		else nowEl.setText("Nothing playing");
		playBtn.setText(playback.playing ? "Pause" : "Play");
		loopBtn.classList.toggle("is-selected", playback.loop);
		for (const row of clipsEl.querySelectorAll("[data-clip]")) {
			row.classList.toggle("is-selected", row.getAttribute("data-clip") === id);
		}
		if (!tracksEl) return;
		for (const row of tracksEl.querySelectorAll("[data-clip]")) {
			row.classList.toggle("is-selected", row.getAttribute("data-clip") === id);
		}
	};

	prevBtn.addEventListener("click", () => stepBed(plugin, -1));
	nextBtn.addEventListener("click", () => stepBed(plugin, 1));
	playBtn.addEventListener("click", () => {
		if (getSoundPlayback().playing) {
			pauseBed();
			return;
		}
		if (playBed(plugin) === "empty") new Notice("Nothing to play.");
	});
	stopBtn.addEventListener("click", () => stopSound());
	loopBtn.addEventListener("click", () => toggleLoop());
	volumeEl.addEventListener("input", () => setVolume(Number(volumeEl.value) / 100));

	const paintPlaylists = () => {
		if (!playlistSel || !tracksEl) return;
		const lib = getSoundLibrary();
		const current = lib.activePlaylistId || "";
		playlistSel.empty();
		playlistSel.createEl("option", {attr: {value: ""}, text: "No playlist"});
		for (const list of lib.playlists) {
			playlistSel.createEl("option", {attr: {value: list.id}, text: list.name});
		}
		playlistSel.value = current;
		tracksEl.empty();
		const list = activePlaylist();
		if (!list) {
			tracksEl.createEl("p", {cls: "fiveetools-view__meta", text: "Enter a name to add a playlist."});
			return;
		}
		if (!list.clipIds.length) {
			tracksEl.createEl("p", {cls: "fiveetools-view__meta", text: "This playlist is empty."});
			return;
		}
		const playingId = currentBedClip()?.id || "";
		list.clipIds.forEach((clipId, index) => {
			const clip = getClip(clipId);
			if (!clip) return;
			const row = tracksEl.createDiv({
				cls: "fiveetools-sound__track",
				attr: {"data-clip": clip.id},
			});
			if (clip.id === playingId) row.addClass("is-selected");
			row.createEl("span", {cls: "fiveetools-sound__name", text: clip.name});
			const up = row.createEl("button", {
				text: "↑",
				cls: "fiveetools-btn fiveetools-btn--ghost fiveetools-sound__icon",
				attr: {type: "button", title: "Move earlier"},
			});
			const down = row.createEl("button", {
				text: "↓",
				cls: "fiveetools-btn fiveetools-btn--ghost fiveetools-sound__icon",
				attr: {type: "button", title: "Move later"},
			});
			const del = row.createEl("button", {
				text: "×",
				cls: "fiveetools-btn fiveetools-btn--ghost fiveetools-sound__icon",
				attr: {type: "button", title: "Remove from this playlist"},
			});
			if (index === 0) up.disabled = true;
			if (index === list.clipIds.length - 1) down.disabled = true;
			row.addEventListener("click", () => playClip(plugin, clip.id));
			up.addEventListener("click", (evt) => {
				evt.stopPropagation();
				moveClipInPlaylist(plugin, list.id, clip.id, -1);
			});
			down.addEventListener("click", (evt) => {
				evt.stopPropagation();
				moveClipInPlaylist(plugin, list.id, clip.id, 1);
			});
			del.addEventListener("click", (evt) => {
				evt.stopPropagation();
				removeClipFromPlaylist(plugin, list.id, clip.id);
			});
		});
	};

	const audioFiles = (term) => {
		const q = String(term || "").trim().toLowerCase();
		if (!q) return [];
		const files = plugin?.app?.vault?.getFiles?.() || [];
		return files.filter(file => {
			const ext = String(file.extension || "").toLowerCase();
			return AUDIO_EXT.has(ext) && String(file.path || "").toLowerCase().includes(q);
		}).slice(0, 8);
	};

	const paintFiles = () => {
		if (!fileHits) return;
		fileHits.empty();
		fileHitsDocs.forEach((file, index) => {
			const row = fileHits.createDiv({cls: "fiveetools-sound__file"});
			if (index === fileIndex) row.addClass("is-selected");
			row.createEl("span", {cls: "fiveetools-sound__name", text: file.path});
			row.addEventListener("click", () => addFromFile(file));
		});
	};

	const markFile = () => {
		if (!fileHits) return;
		[...fileHits.children].forEach((row, index) => row.classList.toggle("is-selected", index === fileIndex));
	};

	const addFromUrl = () => {
		const url = addUrl?.value.trim() || "";
		if (!/^https?:\/\//i.test(url)) {
			new Notice("Use an https link.");
			return;
		}
		const before = getSoundLibrary().clips.length;
		const clip = addClip(plugin, {
			name: addName?.value.trim() || "",
			kind: addKind?.value || "music",
			source: "url",
			url,
		});
		if (!clip) return;
		if (getSoundLibrary().clips.length === before) new Notice("Already in the library.");
		if (addUrl) addUrl.value = "";
		if (addName) addName.value = "";
		addUrl?.focus();
	};

	const addFromFile = (file) => {
		if (!file?.path) return;
		const before = getSoundLibrary().clips.length;
		const clip = addClip(plugin, {
			name: addName?.value.trim() || file.basename || file.name || "",
			kind: addKind?.value || "music",
			source: "vault",
			path: file.path,
		});
		if (clip && getSoundLibrary().clips.length === before) new Notice("Already in the library.");
		if (addName) addName.value = "";
		if (fileSearch) fileSearch.value = "";
		fileHitsDocs = [];
		fileIndex = 0;
		paintFiles();
		fileSearch?.focus();
	};

	kindSel.addEventListener("change", () => {
		kind = kindSel.value || "all";
		paintClips();
	});
	search.addEventListener("input", () => {
		query = search.value || "";
		paintClips();
	});
	addName?.addEventListener("keydown", (evt) => {
		if (evt.key !== "Enter") return;
		evt.preventDefault();
		if (addUrl?.value.trim()) addFromUrl();
		else addUrl?.focus();
	});
	addUrl?.addEventListener("keydown", (evt) => {
		if (evt.key !== "Enter") return;
		evt.preventDefault();
		addFromUrl();
	});
	fileSearch?.addEventListener("input", () => {
		fileHitsDocs = audioFiles(fileSearch.value);
		fileIndex = 0;
		paintFiles();
	});
	fileSearch?.addEventListener("keydown", (evt) => {
		if (evt.key === "ArrowDown" || evt.key === "ArrowUp") {
			if (!fileHitsDocs.length) return;
			evt.preventDefault();
			fileIndex = evt.key === "ArrowDown"
				? Math.min(fileHitsDocs.length - 1, fileIndex + 1)
				: Math.max(0, fileIndex - 1);
			markFile();
			return;
		}
		if (evt.key !== "Enter") return;
		evt.preventDefault();
		const file = fileHitsDocs[fileIndex];
		if (file) addFromFile(file);
	});
	const vaultFolders = (term) => {
		const q = String(term || "").trim().toLowerCase();
		if (!q) return [];
		const root = plugin?.app?.vault?.getRoot?.();
		if (!root) return [];
		const out = [];
		const walk = (folder) => {
			for (const child of folder.children || []) {
				if (!child.children) continue;
				const path = String(child.path || "");
				if (path && path.toLowerCase().includes(q)) out.push(child);
				walk(child);
			}
		};
		walk(root);
		return out.slice(0, 8);
	};
	const paintFolderHits = () => {
		if (!folderHits) return;
		folderHits.empty();
		folderHitsDocs.forEach((folder, index) => {
			const row = folderHits.createDiv({cls: "fiveetools-sound__file"});
			if (index === folderIndex) row.addClass("is-selected");
			row.createEl("span", {cls: "fiveetools-sound__name", text: folder.path});
			row.addEventListener("click", () => addFromFolder(folder));
		});
	};
	const markFolder = () => {
		if (!folderHits) return;
		[...folderHits.children].forEach((row, index) => row.classList.toggle("is-selected", index === folderIndex));
	};
	const paintFolders = () => {
		if (!folderList) return;
		folderList.empty();
		for (const folder of getSoundLibrary().folders || []) {
			const row = folderList.createDiv({cls: "fiveetools-sound__track"});
			row.createEl("span", {cls: "fiveetools-sound__kind", text: folder.kind});
			row.createEl("span", {cls: "fiveetools-sound__name", text: folder.path});
			const del = row.createEl("button", {
				text: "×",
				cls: "fiveetools-btn fiveetools-btn--ghost fiveetools-sound__icon",
				attr: {type: "button", title: "Stop using this folder"},
			});
			del.addEventListener("click", (evt) => {
				evt.stopPropagation();
				removeSoundFolder(plugin, folder.path);
			});
		}
	};
	const addFromFolder = (folder) => {
		if (!folder?.path || !folder.children) {
			new Notice("Choose a folder.");
			return;
		}
		const kindName = addKind?.value || "music";
		addSoundFolder(plugin, folder.path, kindName);
		const n = listSelectableClips(plugin).filter(clip => clip.path === folder.path || clip.path.startsWith(`${folder.path}/`)).length;
		new Notice(n ? `${n} ${kindName} sounds from ${folder.path}` : `No audio files in ${folder.path}`);
		if (folderSearch) folderSearch.value = "";
		folderHitsDocs = [];
		folderIndex = 0;
		paintFolderHits();
		folderSearch?.focus();
	};
	folderSearch?.addEventListener("input", () => {
		folderHitsDocs = vaultFolders(folderSearch.value);
		folderIndex = 0;
		paintFolderHits();
	});
	folderSearch?.addEventListener("keydown", (evt) => {
		if (evt.key === "ArrowDown" || evt.key === "ArrowUp") {
			if (!folderHitsDocs.length) return;
			evt.preventDefault();
			folderIndex = evt.key === "ArrowDown"
				? Math.min(folderHitsDocs.length - 1, folderIndex + 1)
				: Math.max(0, folderIndex - 1);
			markFolder();
			return;
		}
		if (evt.key !== "Enter") return;
		evt.preventDefault();
		const picked = folderHitsDocs[folderIndex];
		if (picked) {
			addFromFolder(picked);
			return;
		}
		const typed = plugin?.app?.vault?.getAbstractFileByPath?.(folderSearch.value.trim());
		if (typed?.children) addFromFolder(typed);
	});
	playlistSel?.addEventListener("change", () => {
		setActivePlaylist(plugin, playlistSel.value || "");
	});
	delList?.addEventListener("click", () => {
		const id = getSoundLibrary().activePlaylistId;
		if (!id) return;
		removePlaylist(plugin, id);
	});
	playlistName?.addEventListener("keydown", (evt) => {
		if (evt.key !== "Enter") return;
		evt.preventDefault();
		const created = addPlaylist(plugin, playlistName.value);
		if (!created) return;
		playlistName.value = "";
		playlistName.focus();
	});

	const offLib = onSoundLibrary(() => {
		if (!listEl.isConnected) return;
		paintClips();
		paintFolders();
		paintPlaylists();
	});
	const offPlay = onSoundPlayback(() => {
		if (!listEl.isConnected) return;
		syncSelected();
	});
	const vault = plugin?.app?.vault;
	const onVaultFile = () => {
		if (!listEl.isConnected) return;
		paintClips();
	};
	const vaultRefs = vault?.on
		? ["create", "delete", "rename"].map(eventName => vault.on(eventName, onVaultFile))
		: [];
	stopTool = () => {
		offLib();
		offPlay();
		if (vault?.offref) {
			for (const ref of vaultRefs) vault.offref(ref);
		}
	};

	const editors = [addName, addKind, addUrl, fileSearch, folderSearch, playlistSel, delList, playlistName];
	for (const el of editors) if (el) el.disabled = true;
	void loadSoundLibrary(plugin).then(() => {
		if (!listEl.isConnected) return;
		for (const el of editors) if (el) el.disabled = false;
		paintClips();
		paintFolders();
		paintPlaylists();
	});
}

/**
 * DM screen Sound card. Play starts in the click. Effects use a second element.
 * @param {HTMLElement} host
 * @param {{ plugin: object }} opts
 */
export function renderSoundWidget (host, {plugin} = {}) {
	stopWidget?.();
	stopWidget = null;
	host.empty();
	host.addClass("fiveetools-sound-widget");

	const now = host.createEl("p", {cls: "fiveetools-view__meta"});
	const row = host.createDiv({cls: "fiveetools-sound__row"});
	const prev = row.createEl("button", {
		text: "Prev",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	const play = row.createEl("button", {
		text: "Play",
		cls: "fiveetools-btn",
		attr: {type: "button"},
	});
	const stop = row.createEl("button", {
		text: "Stop",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Stop the bed and the effect"},
	});
	const next = row.createEl("button", {
		text: "Next",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	const loop = row.createEl("button", {
		text: "Loop",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Repeat the current clip"},
	});
	const volume = host.createEl("input", {
		attr: {type: "range", min: "0", max: "100", value: String(Math.round(getSoundPlayback().volume * 100))},
	});
	host.createEl("p", {cls: "fiveetools-view__meta", text: "Effects"});
	const effects = host.createDiv({cls: "fiveetools-sound-widget__effects"});

	const paintStatus = () => {
		const playback = getSoundPlayback();
		const clip = currentBedClip();
		const list = activePlaylist();
		if (clip && list) now.setText(`${list.name} · ${clip.name}`);
		else if (clip) now.setText(clip.name);
		else if (list) now.setText(list.name);
		else now.setText("No playlist");
		play.setText(playback.playing ? "Pause" : "Play");
		loop.classList.toggle("is-selected", playback.loop);
	};

	const paintEffects = () => {
		effects.empty();
		const clips = listSelectableClips(plugin).filter(clip => clip.kind === "effect");
		if (!clips.length) {
			effects.createEl("p", {cls: "fiveetools-view__meta", text: "No effects yet."});
			return;
		}
		for (const clip of clips) {
			const btn = effects.createEl("button", {
				text: clip.name,
				cls: "fiveetools-btn fiveetools-btn--ghost",
				attr: {type: "button"},
			});
			btn.addEventListener("click", () => playEffect(plugin, clip.id));
		}
	};

	prev.addEventListener("click", () => stepBed(plugin, -1));
	next.addEventListener("click", () => stepBed(plugin, 1));
	play.addEventListener("click", () => {
		if (getSoundPlayback().playing) {
			pauseBed();
			return;
		}
		if (playBed(plugin) === "empty") new Notice("Nothing to play.");
	});
	stop.addEventListener("click", () => stopSound());
	loop.addEventListener("click", () => toggleLoop());
	volume.addEventListener("input", () => setVolume(Number(volume.value) / 100));

	const offPlay = onSoundPlayback(() => {
		if (!host.isConnected) {
			stopWidget?.();
			return;
		}
		paintStatus();
	});
	const offLib = onSoundLibrary(() => {
		if (!host.isConnected) {
			stopWidget?.();
			return;
		}
		paintStatus();
		paintEffects();
	});
	const widgetVault = plugin?.app?.vault;
	const onWidgetVault = () => {
		if (!host.isConnected) {
			stopWidget?.();
			return;
		}
		paintEffects();
	};
	const widgetRefs = widgetVault?.on
		? ["create", "delete", "rename"].map(eventName => widgetVault.on(eventName, onWidgetVault))
		: [];
	stopWidget = () => {
		offPlay();
		offLib();
		if (widgetVault?.offref) {
			for (const ref of widgetRefs) widgetVault.offref(ref);
		}
	};

	paintStatus();
	paintEffects();
	void loadSoundLibrary(plugin).then(() => {
		if (!host.isConnected) return;
		paintStatus();
		paintEffects();
	});
}
