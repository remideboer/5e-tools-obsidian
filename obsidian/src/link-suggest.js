import {EditorSuggest, Notice} from "obsidian";
import {searchEntities} from "./search-index.js";
import {fiveETagForDoc} from "./fivee-tag.js";

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

	selectSuggestion (doc) {
		const ctx = this.context;
		if (!ctx?.editor) return;
		const tag = fiveETagForDoc(doc);
		if (!tag) {
			new Notice("Could not insert link.");
			return;
		}
		ctx.editor.replaceRange(tag, ctx.start, ctx.end);
	}
}

export function registerLinkSuggest (plugin) {
	plugin.registerEditorSuggest(new FiveEToolsLinkSuggest(plugin));
}
