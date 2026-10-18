import {EditorSuggest, Notice} from "obsidian";
import {searchEntities} from "./search-index.js";
import {loadEntity} from "./entity-loader.js";
import {insertEntityNote, wikilinkForFile} from "./note-writer.js";

export class FiveEToolsLinkSuggest extends EditorSuggest {
	constructor (plugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onTrigger (cursor, editor, _file) {
		const line = editor.getLine(cursor.line).slice(0, cursor.ch);
		const at = line.match(/(^|[\s(])@([^\s[\]]*)$/);
		if (!at || at[2].length < 2) return null;
		return {
			start: {line: cursor.line, ch: at.index + at[1].length},
			end: cursor,
			query: at[2],
		};
	}

	async getSuggestions (context) {
		if (!await this.plugin.ensureReady()) return [];
		return searchEntities(context.query, {limit: 12});
	}

	renderSuggestion (doc, el) {
		el.createDiv({cls: "fiveetools-suggest__name", text: doc.n || "Unknown"});
		el.createDiv({
			cls: "fiveetools-suggest__sub",
			text: [doc.cf, doc.sA || doc.s].filter(Boolean).join(" · "),
		});
	}

	async selectSuggestion (doc) {
		const ctx = this.context;
		if (!ctx?.editor) return;
		const {editor, start, end} = ctx;
		try {
			const loaded = await loadEntity(doc);
			if (!loaded?.ent) throw new Error("Could not load that entry.");
			const file = await insertEntityNote(this.plugin, {doc, ent: loaded.ent, open: false});
			editor.replaceRange(wikilinkForFile(file, doc.n), start, end);
		} catch (e) {
			new Notice(e.message || "Could not insert link.");
		}
	}
}

export function registerLinkSuggest (plugin) {
	plugin.registerEditorSuggest(new FiveEToolsLinkSuggest(plugin));
}
