import fs from "fs";
import path from "path";
import {loadEntity} from "./entity-loader.js";
import {resolveEntityImages} from "./image-resolver.js";
import {cachedMediaPath} from "./media-cache.js";
import {layerAbsolute} from "./map-scene.js";

const SIZE_CELLS = {
	tiny: 0.5,
	small: 1,
	medium: 1,
	large: 2,
	huge: 3,
	gargantuan: 4,
};

const SIZE_ALIASES = {
	t: "tiny",
	s: "small",
	m: "medium",
	l: "large",
	h: "huge",
	g: "gargantuan",
};

export function cellsForCreatureSize (size) {
	const raw = Array.isArray(size) ? size[0] : size;
	const word = String(raw || "medium").trim().toLowerCase().split(/\s+/)[0];
	const key = SIZE_ALIASES[word] || word;
	return SIZE_CELLS[key] || 1;
}

export function tokenRadius (token, cellPx) {
	const cell = Math.max(1, Number(cellPx) || 70);
	const cells = Number(token?.cells) > 0 ? Number(token.cells) : 1;
	return (cells * cell) / 2;
}

/** Last matching token wins when discs overlap. */
export function tokenAtPoint (tokens, world, cellPx) {
	const list = tokens || [];
	const x = Number(world?.x) || 0;
	const y = Number(world?.y) || 0;
	for (let i = list.length - 1; i >= 0; i--) {
		const token = list[i];
		const r = tokenRadius(token, cellPx);
		const dx = x - (Number(token?.x) || 0);
		const dy = y - (Number(token?.y) || 0);
		if (dx * dx + dy * dy <= r * r) return token;
	}
	return null;
}

/** Odd footprints sit on a cell center. Even footprints sit on a grid corner. */
export function snapTokenCenter (world, cells, cellPx, offsetX = 0, offsetY = 0) {
	const size = Math.max(1, Number(cellPx) || 70);
	const span = Number(cells) > 0 ? Number(cells) : 1;
	const even = span >= 2 && span % 2 === 0;
	const originX = (Number(offsetX) || 0) + (even ? 0 : size / 2);
	const originY = (Number(offsetY) || 0) + (even ? 0 : size / 2);
	return {
		x: originX + Math.round(((Number(world?.x) || 0) - originX) / size) * size,
		y: originY + Math.round(((Number(world?.y) || 0) - originY) / size) * size,
	};
}

export async function createSceneToken (plugin, scenePath, {doc, world, cellPx, offsetX, offsetY}) {
	const loaded = await loadEntity(doc);
	const ent = loaded?.ent;
	if (!ent) throw new Error("Could not read that creature.");
	const images = await resolveEntityImages(ent, {imageBaseUrl: plugin?.settings?.imageBaseUrl});
	const card = pickCardImage(images);
	if (!card?.url) throw new Error("That creature has no image.");
	const abs = await cachedMediaPath(plugin, card.url);
	if (!abs) throw new Error("Could not download that image.");
	const cells = cellsForCreatureSize(ent.size);
	const center = snapTokenCenter(world, cells, cellPx, offsetX, offsetY);
	const id = `token-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	const ext = path.extname(abs).toLowerCase() || ".webp";
	const rel = `tokens/${id}${ext}`;
	const dest = layerAbsolute(plugin, scenePath, rel);
	if (!dest) throw new Error("Open a map scene first.");
	await ensureFolder(plugin, parentVault(scenePath, "tokens"));
	fs.mkdirSync(path.dirname(dest), {recursive: true});
	fs.copyFileSync(abs, dest);
	return {
		id,
		name: String(ent.name || doc?.n || "Token"),
		size: String(Array.isArray(ent.size) ? ent.size[0] : ent.size || "medium"),
		cells,
		x: center.x,
		y: center.y,
		image: rel,
		source: String(ent.source || doc?.s || ""),
		hash: String(doc?.u || ""),
	};
}

function pickCardImage (images) {
	const list = images || [];
	const card = list.find(img => !/\/tokens\//i.test(`${img?.url || ""} ${img?.rel || ""}`));
	return card || list[0] || null;
}

function parentVault (scenePath, child) {
	const scene = String(scenePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
	return scene ? `${scene}/${child}` : child;
}

async function ensureFolder (plugin, folderPath) {
	const parts = String(folderPath || "").split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		if (!plugin.app.vault.getAbstractFileByPath(acc)) {
			try { await plugin.app.vault.createFolder(acc); } catch (_) { /* already there */ }
		}
	}
}
