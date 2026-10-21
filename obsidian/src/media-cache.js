import fs from "fs";
import path from "path";
import {normalizePath, requestUrl} from "obsidian";
import {getPluginDir} from "./plugin-dir.js";

const inFlight = new Map();

export async function cachedMediaSrc (plugin, url) {
	if (!url) return "";
	try {
		const cached = await ensureCachedFile(plugin, url);
		if (!cached) return url;
		return plugin.app.vault.adapter.getResourcePath(cached.vaultPath);
	} catch (_) {
		return url;
	}
}

export async function readCachedBytes (plugin, url) {
	if (!url) return null;
	try {
		const cached = await ensureCachedFile(plugin, url);
		if (cached) {
			const buf = fs.readFileSync(cached.abs);
			return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		}
	} catch (_) { /* fall through */ }
	try {
		const res = await requestUrl({url});
		return res.arrayBuffer;
	} catch (_) {
		return null;
	}
}

export async function rewriteMediaUrls (plugin, rootEl) {
	if (!rootEl?.querySelectorAll) return;
	const nodes = [...rootEl.querySelectorAll("img[src], source[src]")];
	await Promise.all(nodes.map(async (el) => {
		const src = el.getAttribute("src") || "";
		if (!/^https?:\/\//i.test(src)) return;
		const next = await cachedMediaSrc(plugin, src);
		if (next) el.setAttribute("src", next);
	}));
}

export function clearMediaCache (plugin) {
	const dir = cacheRoot(plugin);
	fs.rmSync(dir, {recursive: true, force: true});
	inFlight.clear();
}

export function cachedMediaFile (plugin, url) {
	const cached = cachedFilePaths(plugin, url);
	if (!cached) return "";
	try {
		if (fs.existsSync(cached.abs) && fs.statSync(cached.abs).size > 0) return cached.abs;
	} catch (_) { /* missing cache is a download */ }
	return "";
}

async function ensureCachedFile (plugin, url) {
	const cached = cachedFilePaths(plugin, url);
	if (!cached) return null;
	const {abs, rel, vaultPath} = cached;
	if (inFlight.has(rel)) return inFlight.get(rel);
	if (fs.existsSync(abs) && fs.statSync(abs).size > 0) return {abs, rel, vaultPath};

	const pending = (async () => {
		const res = await requestUrl({url});
		const buf = Buffer.from(res.arrayBuffer);
		if (!buf.length) throw new Error("empty media response");
		fs.mkdirSync(path.dirname(abs), {recursive: true});
		fs.writeFileSync(abs, buf);
		return {abs, rel, vaultPath};
	})();

	inFlight.set(rel, pending);
	try {
		return await pending;
	} finally {
		inFlight.delete(rel);
	}
}

export async function cachedMediaPath (plugin, url) {
	const cached = await ensureCachedFile(plugin, url);
	return cached?.abs || "";
}

function cacheRoot (plugin) {
	return path.join(getPluginDir(plugin), "cache");
}

function cachedFilePaths (plugin, url) {
	const rel = cacheRel(plugin, url);
	if (!rel) return null;
	return {
		abs: path.join(cacheRoot(plugin), "img", ...rel.split("/")),
		rel,
		vaultPath: normalizePath(`${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/cache/img/${rel}`),
	};
}

function cacheRel (plugin, url) {
	const imageBase = String(plugin?.settings?.imageBaseUrl || "https://5e.tools").replace(/\/+$/, "");
	let parsed;
	let base;
	try {
		parsed = new URL(String(url));
		base = new URL(imageBase);
	} catch (_) {
		return null;
	}
	if (parsed.hostname.toLowerCase() !== base.hostname.toLowerCase()) return null;
	const match = parsed.pathname.replace(/\\/g, "/").match(/\/img\/(.+)$/i);
	if (!match) return null;
	let rel;
	try {
		rel = decodeURIComponent(match[1]).replace(/\\/g, "/");
	} catch (_) {
		rel = match[1].replace(/\\/g, "/");
	}
	const parts = rel.split("/").filter(Boolean);
	if (!parts.length || parts.some(part => part === ".." || part === ".")) return null;
	return parts.join("/");
}
