import {normalizePath} from "obsidian";
import {pluginVaultDir, pluginVaultPath} from "./plugin-dir.js";

export function stripUrlQuery (url) {
	if (!url) return "";
	const raw = String(url);
	const q = raw.indexOf("?");
	return q === -1 ? raw : raw.slice(0, q);
}

/** Map a DataLoader URL onto a vault path under the installed plugin. Remote URLs return null. */
export function urlToPluginVaultPath (url, pluginDir) {
	let raw = stripUrlQuery(url).trim();
	if (!raw || /^https?:\/\//i.test(raw)) return null;
	if (raw.startsWith("file:")) {
		raw = decodeURIComponent(raw.replace(/^file:\/\//, ""));
		raw = raw.replace(/^\/(?=[a-zA-Z]:)/, "");
	}
	raw = raw.replace(/\\/g, "/");
	const dir = String(pluginDir || "").replace(/\\/g, "/").replace(/\/+$/, "");
	let vaultPath = raw;
	if (dir) {
		const idx = raw.toLowerCase().lastIndexOf(dir.toLowerCase());
		if (idx !== -1) vaultPath = raw.slice(idx);
		else if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith("/")) return null;
		else vaultPath = `${dir}/${raw.replace(/^\/+/, "")}`;
	}
	const norm = normalizePath(vaultPath);
	if (!norm || norm.split("/").includes("..")) return null;
	return norm;
}

export async function validatePluginData (plugin) {
	const root = pluginVaultDir(plugin);
	if (!root) return {ok: false, error: "Could not find the 5etools plugin folder."};
	const adapter = plugin?.app?.vault?.adapter;
	if (!adapter || typeof adapter.exists !== "function") {
		return {ok: false, error: "Could not find the 5etools plugin folder."};
	}
	const dataDir = pluginVaultPath(plugin, "data");
	const searchIndex = pluginVaultPath(plugin, "search", "index.json");
	if (!(await adapter.exists(dataDir))) return {ok: false, error: `No data/ folder in ${root}`};
	if (!(await adapter.exists(searchIndex))) return {ok: false, error: `No search/index.json in ${root}`};
	return {ok: true, root};
}
