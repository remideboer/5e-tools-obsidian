import {cacheRemoteImage, cachedMediaPath} from "./media-cache.js";
import {createSceneFromImage, writeScene} from "./map-scene.js";
import {pluginVaultPath} from "./plugin-dir.js";

let catalog = null;
let catalogPromise = null;

export async function ensureReferenceCatalog (plugin) {
	return loadReferenceMaps(plugin);
}

export function listReferenceSources (query = "") {
	if (!catalog) throw new Error("Could not read the map index.");
	const sources = catalog;
	const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!terms.length) return sources;
	const out = [];
	for (const source of sources) {
		const chapters = [];
		for (const chapter of source.chapters) {
			const maps = chapter.maps.filter(map => terms.every(term => map.search.includes(term)));
			if (maps.length) chapters.push({name: chapter.name, maps});
		}
		if (chapters.length) out.push({id: source.id, name: source.name, prop: source.prop, chapters});
	}
	return out;
}

export function referenceImageUrl (plugin, relPath) {
	const base = String(plugin?.settings?.imageBaseUrl || "https://5e.tools").replace(/\/+$/, "");
	const encoded = String(relPath || "").split("/").filter(Boolean).map(part => encodeURIComponent(part)).join("/");
	return `${base}/img/${encoded}`;
}

export async function fetchReferenceMap (plugin, relPath) {
	const url = referenceImageUrl(plugin, relPath);
	const cached = await cacheRemoteImage(plugin, url);
	if (!cached?.vaultPath) throw new Error("Could not download that map.");
	return cached.abs || cached.vaultPath;
}

export async function createReferenceScene (plugin, entry, absPath) {
	const created = await createSceneFromImage(plugin, absPath);
	const layer = created.scene.layers[0];
	const grid = entry?.grid;
	const kind = entry?.imageType === "mapPlayer" ? "Player" : "DM";
	const label = `${entry?.title || created.scene.name} (${kind})`;
	created.scene.name = entry?.source ? `${entry.source}: ${label}` : label;
	if (layer) {
		layer.name = label;
		if (grid) {
			if (grid.size) layer.cellPx = Math.max(8, Math.round(grid.size));
			layer.offsetX = grid.offsetX || 0;
			layer.offsetY = grid.offsetY || 0;
			layer.showGrid = true;
		}
	}
	await writeScene(plugin, created.scenePath, created.scene);
	return created;
}

export function findReferenceMap (relPath) {
	const wanted = String(relPath || "");
	if (!wanted || !catalog) return null;
	for (const source of catalog) {
		for (const chapter of source.chapters) {
			const map = chapter.maps.find(it => it.path === wanted);
			if (map) return map;
		}
	}
	return null;
}

function loadReferenceMaps (plugin) {
	if (catalog) return catalog;
	if (!plugin) throw new Error("Could not read the map index.");
	if (!catalogPromise) {
		catalogPromise = readReferenceCatalog(plugin).catch((error) => {
			catalogPromise = null;
			throw error;
		});
	}
	return catalogPromise;
}

async function readReferenceCatalog (plugin) {
	const adapter = plugin?.app?.vault?.adapter;
	const vaultPath = pluginVaultPath(plugin, "data", "generated", "gendata-maps.json");
	if (!adapter || !(await adapter.exists(vaultPath))) throw new Error("Map index was not found.");
	let data;
	try {
		data = JSON.parse(await adapter.read(vaultPath));
	} catch (error) {
		throw new Error(error?.message || "Could not read the map index.");
	}
	catalog = buildReferenceCatalog(data);
	return catalog;
}

function fileStem (rel) {
	const base = String(rel || "").split(/[\\/]/).pop() || "";
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}

function buildReferenceCatalog (data) {
	const out = [];
	for (const meta of Object.values(data || {})) {
		const source = String(meta?.name || meta?.id || "");
		const sourceId = String(meta?.id || source);
		const chapters = [];
		for (const chapter of meta?.chapters || []) {
			const chapterName = String(chapter?.name || "");
			const maps = [];
			for (const image of chapter?.images || []) {
				const rel = image?.href?.path;
				if (!rel) continue;
				const imageType = image.imageType === "mapPlayer" ? "mapPlayer" : "map";
				const title = String(image.title || fileStem(rel));
				const rawGrid = image.grid;
				const gridSize = Number(rawGrid?.size) || 0;
				const grid = rawGrid && (gridSize > 0 || rawGrid.offsetX != null || rawGrid.offsetY != null)
					? {
						size: gridSize,
						offsetX: Number(rawGrid.offsetX) || 0,
						offsetY: Number(rawGrid.offsetY) || 0,
					}
					: null;
				const row = {
					source,
					sourceId,
					chapter: chapterName,
					title,
					imageType,
					path: String(rel).replace(/\\/g, "/"),
					width: Number(image.width) || 0,
					height: Number(image.height) || 0,
					grid,
				};
				row.search = `${source} ${chapterName} ${title} ${imageType === "mapPlayer" ? "player" : "dm"}`.toLowerCase();
				maps.push(row);
			}
			if (maps.length) chapters.push({name: chapterName, maps});
		}
		if (!chapters.length) continue;
		out.push({
			id: `${meta?.prop === "book" ? "book" : "adventure"}:${sourceId}`,
			name: source,
			prop: meta?.prop === "book" ? "book" : "adventure",
			chapters,
		});
	}
	return out;
}
