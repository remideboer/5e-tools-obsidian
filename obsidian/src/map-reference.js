import fs from "fs";
import path from "path";
import {getConfiguredRoot} from "./fiveetools-host.js";
import {cachedMediaPath} from "./media-cache.js";
import {createSceneFromImage, writeScene} from "./map-scene.js";

let catalog = null;

export function listReferenceSources (query = "") {
	const sources = loadReferenceMaps();
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
	const abs = await cachedMediaPath(plugin, url);
	if (!abs) throw new Error("Could not download that map.");
	return abs;
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
	if (!wanted) return null;
	for (const source of loadReferenceMaps()) {
		for (const chapter of source.chapters) {
			const map = chapter.maps.find(it => it.path === wanted);
			if (map) return map;
		}
	}
	return null;
}

function loadReferenceMaps () {
	if (catalog) return catalog;
	const root = String(getConfiguredRoot() || "").replace(/\/+$/, "");
	if (!root) throw new Error("5etools data is not ready.");
	const file = path.join(root, "data", "generated", "gendata-maps.json");
	if (!fs.existsSync(file)) throw new Error("Map index was not found.");
	const data = JSON.parse(fs.readFileSync(file, "utf8"));
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
				const title = String(image.title || path.basename(rel, path.extname(rel)));
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
	catalog = out;
	return out;
}
