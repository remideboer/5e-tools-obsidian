import {Modal} from "obsidian";
import {CATEGORY_CHIPS} from "./constants.js";
import {searchEntities} from "./search-index.js";

export class FiveEToolsSearchModal extends Modal {
	constructor (app, plugin) {
		super(app);
		this.plugin = plugin;
		this.activeChip = "all";
		this.selectedIndex = 0;
		this.results = [];
		this.inputEl = null;
		this.listEl = null;
	}

	onOpen () {
		this.modalEl.addClass("fiveetools-modal");
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl("h2", {text: "Search 5etools"});

		this.inputEl = contentEl.createEl("input", {
			cls: "fiveetools-modal__search",
			attr: {type: "search", placeholder: "Goblin, fireball, in:spell, source:mm"},
		});

		const chips = contentEl.createDiv({cls: "fiveetools-modal__chips"});
		for (const chip of CATEGORY_CHIPS) {
			const btn = chips.createEl("button", {
				cls: `fiveetools-chip${chip.id === this.activeChip ? " is-active" : ""}`,
				text: chip.label,
			});
			btn.addEventListener("click", () => {
				this.activeChip = chip.id;
				chips.querySelectorAll(".fiveetools-chip").forEach(el => el.classList.remove("is-active"));
				btn.classList.add("is-active");
				this.refresh();
				this.inputEl.focus();
			});
		}

		this.listEl = contentEl.createEl("div", {cls: "fiveetools-modal__results"});
		this.inputEl.addEventListener("input", () => this.refresh());
		this.inputEl.addEventListener("keydown", (evt) => this.onKeyDown(evt));
		this.refresh();
		this.inputEl.focus();
	}

	onClose () {
		this.contentEl.empty();
	}

	onKeyDown (evt) {
		if (evt.key === "ArrowDown") {
			evt.preventDefault();
			this.selectedIndex = Math.min(this.selectedIndex + 1, Math.max(0, this.results.length - 1));
			this.renderResults();
		} else if (evt.key === "ArrowUp") {
			evt.preventDefault();
			this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
			this.renderResults();
		} else if (evt.key === "Enter") {
			evt.preventDefault();
			const doc = this.results[this.selectedIndex];
			if (doc) this.choose(doc);
		}
	}

	refresh () {
		const chip = CATEGORY_CHIPS.find(it => it.id === this.activeChip);
		this.results = searchEntities(this.inputEl.value, {
			chipAliases: chip && chip.id !== "all" ? chip.aliases : [],
		});
		this.selectedIndex = 0;
		this.renderResults();
	}

	renderResults () {
		this.listEl.empty();
		if (!this.results.length) {
			this.listEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No results."});
			return;
		}

		this.results.forEach((doc, ix) => {
			const row = this.listEl.createEl("button", {
				cls: `fiveetools-modal__row${ix === this.selectedIndex ? " is-selected" : ""}`,
			});
			row.createEl("div", {cls: "fiveetools-modal__name", text: doc.n});
			row.createEl("div", {
				cls: "fiveetools-modal__sub",
				text: [doc.cf, doc.sA || doc.s].filter(Boolean).join(" · "),
			});
			row.addEventListener("click", () => this.choose(doc));
		});
	}

	async choose (doc) {
		this.close();
		await this.plugin.openLibrary({doc});
	}
}
