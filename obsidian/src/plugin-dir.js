import {FileSystemAdapter, normalizePath} from "obsidian";
import {nodePath} from "./node-fs.js";

export function pluginVaultDir (plugin) {
	const dir = plugin?.manifest?.dir;
	if (dir) return normalizePath(String(dir));
	const id = plugin?.manifest?.id || "5etools";
	const configDir = plugin?.app?.vault?.configDir || ".obsidian";
	return normalizePath(`${configDir}/plugins/${id}`);
}

export function pluginVaultPath (plugin, ...parts) {
	const rel = parts.flatMap(part => String(part || "").split(/[\\/]+/)).filter(Boolean);
	if (rel.some(part => part === ".." || part === ".")) {
		throw new Error("Invalid plugin path.");
	}
	return normalizePath([pluginVaultDir(plugin), ...rel].join("/"));
}

export async function readPluginText (plugin, ...parts) {
	return plugin.app.vault.adapter.read(pluginVaultPath(plugin, ...parts));
}

export async function readPluginJson (plugin, ...parts) {
	return JSON.parse(await readPluginText(plugin, ...parts));
}

export function desktopAbsolutePath (plugin, vaultPath) {
	const adapter = plugin?.app?.vault?.adapter;
	if (!(adapter instanceof FileSystemAdapter) || typeof adapter.getBasePath !== "function") return "";
	const rel = normalizePath(String(vaultPath || ""));
	if (!rel) return "";
	try {
		return nodePath().join(adapter.getBasePath(), ...rel.split("/"));
	} catch (_) {
		return "";
	}
}

/** Absolute plugin folder on desktop. Empty on mobile. */
export function getPluginDir (plugin) {
	return desktopAbsolutePath(plugin, pluginVaultDir(plugin));
}
