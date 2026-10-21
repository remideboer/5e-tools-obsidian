import {Notice} from "obsidian";
import {cachedMediaSrc} from "./media-cache.js";
import {
	createReferenceScene,
	fetchReferenceMap,
	listReferenceSources,
	referenceImageUrl,
} from "./map-reference.js";

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
		fetching: "",
		errorPath: "",
		errorText: "",
	};

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
				void paintReader();
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
					void paintReader({scrollTo: "chapter"});
				});
			}
		}
		menuEl.scrollTop = scroll;
	};

	const paintReader = async ({scrollTo = ""} = {}) => {
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
		const imageJobs = [];
		for (const chapter of source.chapters) {
			const key = chapterKey(source.id, chapter.name);
			const section = box.createDiv({cls: "fiveetools-refmaps__chapter-block"});
			section.dataset.chapter = key;
			section.createEl("h4", {text: chapter.name});
			for (const map of chapter.maps) {
				const kind = map.imageType === "mapPlayer" ? "Player" : "DM";
				const row = section.createDiv({
					cls: `fiveetools-refmaps__map${state.selectedPath === map.path ? " is-selected" : ""}`,
				});
				row.dataset.path = map.path;
				const pick = row.createEl("button", {
					cls: "fiveetools-refmaps__pick",
					text: `${map.title} (${kind})`,
					attr: {type: "button"},
				});
				pick.addEventListener("click", () => void selectMap(map, source.id, key));
				if (state.fetching === map.path) {
					row.createEl("p", {cls: "fiveetools-view__meta", text: "Fetching map…"});
				}
				if (state.errorPath === map.path && state.errorText) {
					row.createEl("p", {cls: "fiveetools-view__meta", text: state.errorText});
				}
				if (state.fetched[map.path]) {
					const use = row.createEl("button", {
						text: "Use as map",
						cls: "fiveetools-btn fiveetools-btn--ghost",
						attr: {type: "button"},
					});
					use.addEventListener("click", () => void useMap(map));
					const img = row.createEl("img", {
						cls: "fiveetools-refmaps__image",
						attr: {alt: map.title},
					});
					imageJobs.push(cachedMediaSrc(plugin, referenceImageUrl(plugin, map.path)).then(src => {
						if (src) img.src = src;
					}));
				}
			}
		}
		const target = scrollTo === "chapter"
			? [...box.querySelectorAll("[data-chapter]")].find(el => el.dataset.chapter === state.openChapter)
			: scrollTo === "map"
				? [...box.querySelectorAll("[data-path]")].find(el => el.dataset.path === state.selectedPath)
				: null;
		target?.scrollIntoView({block: scrollTo === "chapter" ? "start" : "nearest"});
		await Promise.all(imageJobs);
	};

	const selectMap = async (map, sourceId, key) => {
		state.selectedPath = map.path;
		state.openSourceId = sourceId;
		state.openChapter = key;
		state.fetching = map.path;
		state.errorPath = "";
		state.errorText = "";
		emit();
		paintMenu();
		await paintReader({scrollTo: "map"});
		try {
			const abs = await fetchReferenceMap(plugin, map.path);
			state.fetched[map.path] = abs;
			emit();
		} catch (e) {
			delete state.fetched[map.path];
			state.errorPath = map.path;
			state.errorText = e.message || "Could not fetch that map.";
			emit();
			new Notice(state.errorText);
		} finally {
			if (state.fetching === map.path) state.fetching = "";
			if (state.selectedPath === map.path) await paintReader({scrollTo: "map"});
		}
	};

	const useMap = async (map) => {
		const abs = state.fetched[map.path];
		if (!abs) {
			new Notice("Fetch the map first.");
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
	void paintReader();
}
