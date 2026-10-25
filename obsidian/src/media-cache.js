import {normalizePath, requestUrl} from "obsidian";
import {desktopAbsolutePath, pluginVaultPath} from "./plugin-dir.js";
import {fs} from "./node-fs.js";

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
		if (cached) return plugin.app.vault.adapter.readBinary(cached.vaultPath);
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

export async function clearMediaCache (plugin) {
	inFlight.clear();
	const dir = pluginVaultPath(plugin, "cache");
	const adapter = plugin.app.vault.adapter;
	if (!(await adapter.exists(dir))) return;
	if (typeof adapter.rmdir !== "function") throw new Error("This device cannot delete the image cache folder.");
	await adapter.rmdir(dir, true);
}

export function cachedMediaFile (plugin, url) {
	const cached = cachedFilePaths(plugin, url);
	if (!cached?.abs) return "";
	try {
		if (fs.existsSync(cached.abs) && fs.statSync(cached.abs).size > 0) return cached.abs;
	} catch (_) { /* missing cache is a download */ }
	return "";
}

async function ensureCachedFile (plugin, url) {
	const cached = cachedFilePaths(plugin, url);
	if (!cached) return null;
	const {rel, vaultPath} = cached;
	if (inFlight.has(rel)) return inFlight.get(rel);
	if (await vaultFileReady(plugin, vaultPath)) return cached;

	const pending = (async () => {
		const res = await requestUrl({url});
		const bytes = new Uint8Array(res.arrayBuffer);
		if (!bytes.byteLength) throw new Error("empty media response");
		const adapter = plugin.app.vault.adapter;
		await ensureVaultFolder(adapter, vaultDirname(vaultPath));
		await adapter.writeBinary(vaultPath, bytes.buffer);
		return cached;
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

function cachedFilePaths (plugin, url) {
	const rel = cacheRel(plugin, url);
	if (!rel) return null;
	const vaultPath = pluginVaultPath(plugin, "cache", "img", rel);
	return {
		abs: desktopAbsolutePath(plugin, vaultPath),
		rel,
		vaultPath,
	};
}

async function vaultFileReady (plugin, vaultPath) {
	const adapter = plugin.app.vault.adapter;
	if (!(await adapter.exists(vaultPath))) return false;
	if (typeof adapter.stat !== "function") return true;
	try {
		const stat = await adapter.stat(vaultPath);
		if (!stat) return true;
		if (stat.type && stat.type !== "file") return false;
		return stat.size == null || stat.size > 0;
	} catch (_) {
		return true;
	}
}

async function ensureVaultFolder (adapter, folder) {
	const parts = normalizePath(folder).split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		try {
			if (!(await adapter.exists(acc))) await adapter.mkdir(acc);
		} catch (_) { /* already there */ }
	}
}

function vaultDirname (vaultPath) {
	const norm = normalizePath(vaultPath);
	const i = norm.lastIndexOf("/");
	return i === -1 ? "" : norm.slice(0, i);
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
