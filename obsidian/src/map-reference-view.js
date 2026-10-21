import {Notice} from "obsidian";
import {cachedMediaFile, cachedMediaSrc} from "./media-cache.js";
import {
	createReferenceScene,
	fetchReferenceMap,
	listReferenceSources,
	referenceImageUrl,
} from "./map-reference.js";

const DOWNLOAD_LIMIT = 3;

export function renderReferenceMaps (listEl, readerEl, {session, plugin, onSessionChange, onOpenMap} = {}) {
	listEl.empty();
	listEl.addClass("fiveetools-refmaps");
	readerEl.empty();
	readerEl.removeClass("fiveetools-map-stage");

	const state = {
		query: session?.query || "",
		openSourceId: session?.openSourceId || "",
		openChapter: session?.openChapter || "",
		selectedPath: session?.selectedPath || "",
		fetched: {...(session?.fetched || {})},
		loading: new Set(),
		errors: {},
	};
	let loadGen = 0;

	const emit = () => {
		onSessionChange?.({
			query: state.query,
			openSourceId: state.openSourceId,
			openChapter: state.openChapter,
			selectedPath: state.selectedPath,
			fetched: {...state.fetched},
		});
	};

	const chapterKey = (sourceId, name) => `${sourceId}\n${name}`;

	const searchEl = listEl.createEl("input", {
		cls: "fiveetools-map__search",
		attr: {type: "search", placeholder: "Search adventures and maps"},
	});
	searchEl.value = state.query;
	const menuEl = listEl.createDiv({cls: "fiveetools-refmaps__tree"});

	const findSource = (id) => {
		if (!id) return null;
		return listReferenceSources().find(source => source.id === id) || null;
	};

	const mapsForSelection = (source) => {
		if (!source) return [];
		if (!state.openChapter) return source.chapters.flatMap(chapter => chapter.maps);
		const chapter = source.chapters.find(it => chapterKey(source.id, it.name) === state.openChapter);
		return chapter?.maps || [];
	};

	const paintMenu = () => {
		const scroll = menuEl.scrollTop;
		menuEl.empty();
		let sources = [];
		try {
			sources = listReferenceSources(state.query);
		} catch (e) {
			menuEl.createEl("p", {cls: "fiveetools-view__meta", text: e.message || "Could not read the map index."});
			return;
		}
		if (!sources.length) {
			menuEl.createEl("p", {cls: "fiveetools-view__meta", text: "No maps match."});
			return;
		}
		for (const source of sources) {
			const sourceBtn = menuEl.createEl("button", {
				cls: `fiveetools-refmaps__source${state.openSourceId === source.id ? " is-selected" : ""}`,
				text: source.name,
				attr: {type: "button"},
			});
			sourceBtn.addEventListener("click", () => {
				state.openSourceId = source.id;
				state.openChapter = "";
				emit();
				paintMenu();
				void loadMaps(mapsForSelection(source));
			});
			for (const chapter of source.chapters) {
				const key = chapterKey(source.id, chapter.name);
				const chapterBtn = menuEl.createEl("button", {
					cls: `fiveetools-refmaps__chapter${state.openChapter === key ? " is-selected" : ""}`,
					text: chapter.name,
					attr: {type: "button"},
				});
				chapterBtn.addEventListener("click", () => {
					state.openSourceId = source.id;
					state.openChapter = key;
					emit();
					paintMenu();
					void loadMaps(chapter.maps, {scrollTo: "chapter"});
				});
			}
		}
		menuEl.scrollTop = scroll;
	};

	const paintMapRow = (row, map) => {
		row.querySelector(".fiveetools-refmaps__status")?.remove();
		row.querySelector(".fiveetools-refmaps__ready")?.remove();
		if (state.loading.has(map.path)) {
			row.createEl("p", {cls: "fiveetools-view__meta fiveetools-refmaps__status", text: "Loading map…"});
			return;
		}
		if (state.errors[map.path] && !state.fetched[map.path]) {
			row.createEl("p", {cls: "fiveetools-view__meta fiveetools-refmaps__status", text: state.errors[map.path]});
			return;
		}
		if (!state.fetched[map.path]) return;
		const ready = row.createDiv({cls: "fiveetools-refmaps__ready"});
		const use = ready.createEl("button", {
			text: "Use as map",
			cls: "fiveetools-btn fiveetools-btn--ghost",
			attr: {type: "button"},
		});
		use.addEventListener("click", () => void useMap(map));
		const img = ready.createEl("img", {
			cls: "fiveetools-refmaps__image",
			attr: {alt: map.title},
		});
		void cachedMediaSrc(plugin, referenceImageUrl(plugin, map.path)).then(src => {
			if (src && row.isConnected) img.src = src;
		});
	};

	const refreshRow = (map) => {
		const row = [...readerEl.querySelectorAll("[data-path]")].find(el => el.dataset.path === map.path);
		if (row) paintMapRow(row, map);
	};

	const paintReader = ({scrollTo = ""} = {}) => {
		readerEl.empty();
		const box = readerEl.createDiv({cls: "fiveetools-refmaps__preview"});
		let source = null;
		try {
			source = findSource(state.openSourceId);
		} catch (e) {
			box.createEl("p", {cls: "fiveetools-view__meta", text: e.message || "Could not read the map index."});
			return;
		}
		if (!source) {
			box.createEl("p", {cls: "fiveetools-view__meta", text: "Pick an adventure from the menu."});
			return;
		}
		box.createEl("h3", {text: source.name});
		for (const chapter of source.chapters) {
			const key = chapterKey(source.id, chapter.name);
			const section = box.createDiv({cls: "fiveetools-refmaps__chapter-block"});
			section.dataset.chapter = key;
			section.createEl("h4", {text: chapter.name});
			for (const map of chapter.maps) {
				const kind = map.imageType === "mapPlayer" ? "Player" : "DM";
				const row = section.createDiv({cls: "fiveetools-refmaps__map"});
				row.dataset.path = map.path;
				row.createEl("div", {cls: "fiveetools-refmaps__pick", text: `${map.title} (${kind})`});
				paintMapRow(row, map);
			}
		}
		if (scrollTo === "chapter") {
			const target = [...box.querySelectorAll("[data-chapter]")].find(el => el.dataset.chapter === state.openChapter);
			target?.scrollIntoView({block: "start"});
		}
	};

	const loadMaps = async (maps, {scrollTo = ""} = {}) => {
		const gen = ++loadGen;
		const sourceId = state.openSourceId;
		state.loading = new Set();
		const missing = [];
		for (const map of maps) {
			if (state.fetched[map.path]) continue;
			const abs = cachedMediaFile(plugin, referenceImageUrl(plugin, map.path));
			if (abs) {
				state.fetched[map.path] = abs;
				delete state.errors[map.path];
				continue;
			}
			missing.push(map);
			state.loading.add(map.path);
			delete state.errors[map.path];
		}
		emit();
		paintReader({scrollTo});
		let cursor = 0;
		const worker = async () => {
			while (cursor < missing.length) {
				if (gen !== loadGen || state.openSourceId !== sourceId) return;
				const map = missing[cursor++];
				try {
					const abs = await fetchReferenceMap(plugin, map.path);
					if (gen !== loadGen || state.openSourceId !== sourceId) return;
					state.fetched[map.path] = abs;
					delete state.errors[map.path];
				} catch (e) {
					if (gen !== loadGen || state.openSourceId !== sourceId) return;
					state.errors[map.path] = e.message || "Could not download that map.";
				} finally {
					if (gen === loadGen) state.loading.delete(map.path);
				}
				if (gen === loadGen && state.openSourceId === sourceId) refreshRow(map);
			}
		};
		const width = Math.min(DOWNLOAD_LIMIT, missing.length);
		if (width) await Promise.all(Array.from({length: width}, () => worker()));
		if (gen === loadGen) emit();
	};

	const useMap = async (map) => {
		const abs = state.fetched[map.path];
		if (!abs) {
			new Notice("That map is not ready.");
			return;
		}
		try {
			const created = await createReferenceScene(plugin, map, abs);
			if (plugin) {
				plugin._mapSession = {
					...(plugin._mapSession || {}),
					scenePath: created.scenePath,
					filePath: "",
					activeLayerId: "",
				};
			}
			onOpenMap?.();
		} catch (e) {
			new Notice(e.message || "Could not open that map.");
		}
	};

	searchEl.addEventListener("input", () => {
		state.query = searchEl.value;
		emit();
		paintMenu();
	});

	paintMenu();
	let openSource = null;
	try {
		openSource = findSource(state.openSourceId);
	} catch (_) {
		openSource = null;
	}
	if (openSource) void loadMaps(mapsForSelection(openSource), {scrollTo: state.openChapter ? "chapter" : ""});
	else paintReader();
}
