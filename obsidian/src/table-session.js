import {VIEW_TYPE_FIVEETOOLS_TABLE} from "./constants.js";

export function ensureTableSession (plugin) {
	if (!plugin._tableSession) {
		plugin._tableSession = {
			combatants: [],
			selectedId: null,
			image: "",
			imageBytes: null,
			imageType: "",
			privateRolls: false,
		};
	}
	return plugin._tableSession;
}

const listeners = new Set();

export function onTableChange (fn) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function refreshTable (plugin) {
	for (const fn of listeners) {
		try { fn(plugin); } catch (_) { /* a closed view can drop out */ }
	}
}

export function tableDocument (plugin) {
	const leaves = plugin?.app?.workspace?.getLeavesOfType?.(VIEW_TYPE_FIVEETOOLS_TABLE) || [];
	const doc = leaves[0]?.view?.contentEl?.win?.document;
	if (!doc?.body || doc === document) return null;
	return doc;
}
