import path from "path";
import {FileSystemAdapter} from "obsidian";

export function getPluginDir (plugin) {
	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		throw new Error("5etools requires the desktop app so it can read bundled data files.");
	}
	return path.join(adapter.getBasePath(), plugin.app.vault.configDir, "plugins", plugin.manifest.id);
}
