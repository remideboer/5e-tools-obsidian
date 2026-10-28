import {ItemView} from "obsidian";
import {VIEW_TYPE_FIVEETOOLS} from "./constants.js";
import {renderEntityPanel} from "./entity-reader.js";
import {bindTableImageMenu} from "./table-view.js";

export class FiveEToolsView extends ItemView {
	constructor (leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.doc = null;
		this._title = "5etools";
	}

	getViewType () {
		return VIEW_TYPE_FIVEETOOLS;
	}

	getDisplayText () {
		return this._title;
	}

	getIcon () {
		return "book-open";
	}

	async onOpen () {
		this.contentEl.addClass("fiveetools-view");
		bindTableImageMenu(this.contentEl, this.plugin);
	}

	async onClose () {
		this.contentEl.empty();
	}

	async showDoc (doc) {
		this.doc = doc;
		this._title = doc.n || "5etools";
		this.leaf.tabHeaderInnerTitleEl?.setText?.(this._title);
		await renderEntityPanel(this.contentEl, this.plugin, this.doc);
	}
}
