import {fs, path} from "./node-fs.js";
import {FileSystemAdapter} from "obsidian";
import {campaignPath, listCampaigns, slugify} from "./campaign-store.js";
import {defaultCamera} from "./map-canvas.js";
import {fogPaths} from "./map-fog.js";
import {DEFAULT_CELL_INCHES, DEFAULT_DIAGONAL_INCHES} from "./map-scale.js";

export const SCENE_FILE = "scene.json";

export function mapsLibraryRoot (plugin) {
	const folder = String(plugin?.settings?.notesFolder || "5etools").replace(/\\/g, "/").replace(/\/+$/, "");
	return `${folder}/maps`;
}

export function vaultBase (plugin) {
	const adapter = plugin?.app?.vault?.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		throw new Error("Map scenes need the Obsidian desktop app.");
	}
	return adapter.getBasePath();
}

export function vaultToAbsolute (plugin, vaultPath) {
	const rel = String(vaultPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
	return path.join(vaultBase(plugin), ...rel.split("/").filter(Boolean));
}

export function absoluteToVault (plugin, absPath) {
	const base = vaultBase(plugin).replace(/\\/g, "/").replace(/\/+$/, "");
	const abs = String(absPath || "").replace(/\\/g, "/");
	const prefix = `${base}/`;
	if (abs.toLowerCase().startsWith(prefix.toLowerCase())) return abs.slice(prefix.length);
	return "";
}

export function isSceneJson (filePath) {
	return /(?:^|\/)scene\.json$/i.test(String(filePath || "").replace(/\\/g, "/"));
}

export async function createSceneFromImage (plugin, sourceAbs) {
	const source = String(sourceAbs || "");
	if (!source || !fs.existsSync(source) || isSceneJson(source)) {
		throw new Error("Choose an image file.");
	}
	const name = path.basename(source, path.extname(source)) || "Map";
	const root = mapsLibraryRoot(plugin);
	await ensureVaultFolder(plugin, root);
	const slug = uniqueChild(plugin, root, slugify(name));
	const scenePath = `${root}/${slug}`;
	await ensureVaultFolder(plugin, `${scenePath}/layers`);
	const ext = path.extname(source).toLowerCase() || ".png";
	const imageRel = `layers/00-${slugify(name)}${ext}`;
	copyAbs(source, vaultToAbsolute(plugin, `${scenePath}/${imageRel}`));
	const legacy = fogPaths(source);
	const fogLive = "layers/00-fog-live.png";
	const fogStart = "layers/00-fog-start.png";
	if (legacy.live && fs.existsSync(legacy.live)) {
		copyAbs(legacy.live, vaultToAbsolute(plugin, `${scenePath}/${fogLive}`));
	}
	if (legacy.start && fs.existsSync(legacy.start)) {
		copyAbs(legacy.start, vaultToAbsolute(plugin, `${scenePath}/${fogStart}`));
	}
	const scene = blankScene(name);
	scene.layers.push(blankLayer({
		id: "layer-1",
		name,
		image: imageRel,
		fogLive,
		fogStart,
	}));
	scene.activeLayerId = "layer-1";
	await writeScene(plugin, scenePath, scene);
	return {scenePath, scene};
}

export async function addSceneLayer (plugin, scenePath, scene, sourceAbs) {
	const source = String(sourceAbs || "");
	if (!scenePath || !scene || !source || !fs.existsSync(source)) {
		throw new Error("Choose an image to add as a layer.");
	}
	const name = path.basename(source, path.extname(source)) || "Layer";
	const index = String(scene.layers.length).padStart(2, "0");
	const ext = path.extname(source).toLowerCase() || ".png";
	const imageRel = `layers/${index}-${slugify(name)}${ext}`;
	await ensureVaultFolder(plugin, `${scenePath}/layers`);
	copyAbs(source, vaultToAbsolute(plugin, `${scenePath}/${imageRel}`));
	const id = `layer-${Date.now().toString(36)}`;
	const layer = blankLayer({
		id,
		name,
		image: imageRel,
		fogLive: `layers/${index}-fog-live.png`,
		fogStart: `layers/${index}-fog-start.png`,
	});
	scene.layers.push(layer);
	scene.activeLayerId = id;
	await writeScene(plugin, scenePath, scene);
	return layer;
}

export async function readScene (plugin, scenePath) {
	const folder = sceneFolder(plugin, scenePath);
	if (!folder) return null;
	const file = plugin.app.vault.getAbstractFileByPath(`${folder}/${SCENE_FILE}`);
	let raw = "";
	if (file && !file.children) raw = await plugin.app.vault.read(file);
	else {
		const abs = vaultToAbsolute(plugin, `${folder}/${SCENE_FILE}`);
		if (!fs.existsSync(abs)) return null;
		raw = fs.readFileSync(abs, "utf8");
	}
	let scene;
	try {
		scene = JSON.parse(raw);
	} catch (_) {
		return null;
	}
	if (!scene || !Array.isArray(scene.layers) || !scene.layers.length) return null;
	scene.version = 1;
	scene.tokens = Array.isArray(scene.tokens) ? scene.tokens : [];
	if (!scene.layers.some(it => it.id === scene.activeLayerId)) {
		scene.activeLayerId = scene.layers[0].id;
	}
	return {scenePath: folder, scene};
}

export async function writeScene (plugin, scenePath, scene) {
	const folder = sceneFolder(plugin, scenePath);
	if (!folder) throw new Error("Scene folder is missing.");
	await ensureVaultFolder(plugin, folder);
	const payload = {
		...scene,
		version: 1,
		tokens: Array.isArray(scene.tokens) ? scene.tokens : [],
	};
	const text = `${JSON.stringify(payload, null, "\t")}\n`;
	const vaultPath = `${folder}/${SCENE_FILE}`;
	const vault = plugin.app.vault;
	const existing = vault.getAbstractFileByPath(vaultPath);
	if (existing && !existing.children) await vault.modify(existing, text);
	else await vault.create(vaultPath, text);
}

export function layerAbsolute (plugin, scenePath, relPath) {
	const rel = String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
	if (!scenePath || !rel) return "";
	return vaultToAbsolute(plugin, `${sceneFolder(plugin, scenePath)}/${rel}`);
}

export async function copySceneToCampaign (plugin, scenePath, campaignSlug) {
	const src = sceneFolder(plugin, scenePath);
	const loaded = await readScene(plugin, src);
	if (!loaded) throw new Error("Could not read that scene.");
	const destRoot = `${campaignPath(plugin, campaignSlug)}/maps`;
	await ensureVaultFolder(plugin, destRoot);
	const slug = uniqueChild(plugin, destRoot, slugify(loaded.scene.name || "map"));
	const dest = `${destRoot}/${slug}`;
	await copyVaultTree(plugin, src, dest);
	return dest;
}

export async function listLibraryScenes (plugin) {
	return listSceneFolders(plugin, mapsLibraryRoot(plugin));
}

export async function listCampaignMapScenes (plugin) {
	const campaigns = await listCampaigns(plugin);
	const out = [];
	for (const campaign of campaigns) {
		const rows = await listSceneFolders(plugin, `${campaignPath(plugin, campaign.slug)}/maps`);
		for (const row of rows) out.push({...row, campaign: campaign.name, campaignSlug: campaign.slug});
	}
	return out;
}

async function listSceneFolders (plugin, folderPath) {
	const vault = plugin?.app?.vault;
	const folder = vault?.getAbstractFileByPath(folderPath);
	if (!folder?.children) return [];
	const out = [];
	for (const child of folder.children) {
		if (!child.children) continue;
		const loaded = await readScene(plugin, child.path);
		if (!loaded) continue;
		out.push({
			path: child.path,
			name: String(loaded.scene.name || child.name),
		});
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

function sceneFolder (plugin, scenePath) {
	let folder = String(scenePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
	if (!folder) return "";
	if (isSceneJson(folder)) folder = folder.slice(0, -SCENE_FILE.length).replace(/\/+$/, "");
	const vaulted = absoluteToVault(plugin, folder);
	return vaulted || folder;
}

function blankScene (name) {
	return {
		version: 1,
		name,
		activeLayerId: "",
		cellInches: DEFAULT_CELL_INCHES,
		diagonalInches: DEFAULT_DIAGONAL_INCHES,
		viewLocked: false,
		scaleLocked: false,
		playerScale: null,
		actualSize: false,
		snapToGrid: false,
		camera: null,
		lookAt: null,
		rotation: 0,
		tokens: [],
		layers: [],
	};
}

function blankLayer ({id, name, image, fogLive, fogStart}) {
	return {
		id,
		name,
		image,
		fogLive,
		fogStart,
		camera: defaultCamera(),
		lookAt: null,
		rotation: 0,
		offsetX: 0,
		offsetY: 0,
		showGrid: false,
		cellPx: 70,
		mapDpi: null,
		paperWidthInches: null,
		paperHeightInches: null,
	};
}

function uniqueChild (plugin, parentVault, base) {
	const stem = base || "map";
	let slug = stem;
	let n = 2;
	while (childExists(plugin, parentVault, slug)) slug = `${stem}-${n++}`;
	return slug;
}

function childExists (plugin, parentVault, slug) {
	const rel = `${parentVault}/${slug}`;
	if (plugin.app.vault.getAbstractFileByPath(rel)) return true;
	try {
		return fs.existsSync(vaultToAbsolute(plugin, rel));
	} catch (_) {
		return false;
	}
}

async function ensureVaultFolder (plugin, folderPath) {
	const parts = String(folderPath || "").split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		if (!plugin.app.vault.getAbstractFileByPath(acc)) await plugin.app.vault.createFolder(acc);
	}
}

function copyAbs (from, to) {
	fs.mkdirSync(path.dirname(to), {recursive: true});
	fs.copyFileSync(from, to);
}

async function copyVaultTree (plugin, srcVault, destVault) {
	const srcAbs = vaultToAbsolute(plugin, srcVault);
	const files = [];
	walkFiles(srcAbs, "", files);
	await ensureVaultFolder(plugin, destVault);
	for (const file of files) {
		const rel = file.rel.replace(/\\/g, "/");
		const dest = `${destVault}/${rel}`;
		if (rel.endsWith("/")) continue;
		const parent = dest.replace(/\/[^/]+$/, "");
		if (parent && parent !== dest) await ensureVaultFolder(plugin, parent);
		const buf = fs.readFileSync(file.abs);
		if (rel.endsWith(".json")) {
			const text = buf.toString("utf8");
			const existing = plugin.app.vault.getAbstractFileByPath(dest);
			if (existing && !existing.children) await plugin.app.vault.modify(existing, text);
			else await plugin.app.vault.create(dest, text);
		} else {
			const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
			const existing = plugin.app.vault.getAbstractFileByPath(dest);
			if (existing && !existing.children) await plugin.app.vault.modifyBinary(existing, data);
			else await plugin.app.vault.createBinary(dest, data);
		}
	}
}

function walkFiles (absDir, relBase, out) {
	if (!fs.existsSync(absDir)) return;
	for (const name of fs.readdirSync(absDir)) {
		const abs = path.join(absDir, name);
		const rel = relBase ? `${relBase}/${name}` : name;
		if (fs.statSync(abs).isDirectory()) walkFiles(abs, rel, out);
		else out.push({abs, rel});
	}
}
