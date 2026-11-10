import {Notice} from "obsidian";
import {allocPanelId, getDmScreenBoard, queueSaveDmScreen, setDmScreenBoard} from "./dm-screen-store.js";

export function isCorpusDoc (doc) {
	const cat = String(doc?.cf || "").toLowerCase();
	return cat === "adventure" || cat === "book";
}

function slimDoc (doc) {
	if (!doc?.u && !doc?.n) return null;
	return {
		n: doc.n || "",
		u: doc.u || "",
		s: doc.s || "",
		c: doc.c ?? null,
		cf: doc.cf || "",
		sA: doc.sA || "",
	};
}

/**
 * Append a panel as a new DM screen column and persist.
 * @returns {object} next board
 */
export function appendDmScreenPanel (plugin, panelSpec) {
	const board = getDmScreenBoard();
	const panel = {
		id: allocPanelId(),
		type: "note",
		title: "Note",
		doc: null,
		path: "",
		ref: "",
		text: "",
		value: 0,
		...(panelSpec || {}),
	};
	if (!panel.id) panel.id = allocPanelId();
	const next = setDmScreenBoard({
		columns: [
			...(board.columns || []),
			{id: allocPanelId(), collapsed: false, items: [panel]},
		],
	});
	if (plugin) plugin._dmScreenBoard = next;
	queueSaveDmScreen(plugin);
	return next;
}

export function pinEntityDoc (plugin, doc) {
	if (!doc) throw new Error("No entry to pin.");
	const title = doc.n || "Entry";
	if (isCorpusDoc(doc)) {
		appendDmScreenPanel(plugin, {
			type: "corpus",
			title,
			doc: slimDoc(doc),
			chapter: 0,
		});
	} else {
		appendDmScreenPanel(plugin, {
			type: "entity",
			title,
			doc: slimDoc(doc),
		});
	}
	new Notice("Pinned to DM screen");
}

export function pinCampaignNotePath (plugin, {path, title} = {}) {
	const notePath = String(path || "").trim();
	if (!notePath) throw new Error("No note to pin.");
	appendDmScreenPanel(plugin, {
		type: "campaignNote",
		title: String(title || "").trim() || "Note",
		path: notePath,
	});
	new Notice("Pinned to DM screen");
}

/**
 * @param {{path?: string, bundledId?: string, title?: string, rollable?: boolean}} ref
 */
export function pinRollTableRef (plugin, ref = {}) {
	const title = String(ref.title || "").trim() || "Table";
	const bundledId = String(ref.bundledId || "").trim();
	const path = String(ref.path || "").trim();
	if (bundledId) {
		const rollable = ref.rollable !== false;
		appendDmScreenPanel(plugin, {
			type: rollable ? "rollTable" : "refTable",
			title,
			bundledId,
			path: "",
		});
	} else if (path) {
		appendDmScreenPanel(plugin, {
			type: "rollTable",
			title,
			path,
		});
	} else {
		throw new Error("No table to pin.");
	}
	new Notice("Pinned to DM screen");
}

Object.assign(globalThis.FiveEToolsObsidian ||= {}, {
	appendDmScreenPanel,
	pinEntityDoc,
	pinCampaignNotePath,
	pinRollTableRef,
	isCorpusDoc,
});
