import {loadPageForDoc, renderCompactHtml} from "./compact-render.js";
import {appendCreatureStatFooter} from "./creature-stat-footer.js";
import {bindDiceRollers} from "./dice-roll.js";
import {allocPanelId, queueSaveDmScreen, setDmScreenBoard} from "./dm-screen-store.js";
import {bindInternalLinks} from "./entity-reader.js";
import {loadEntity} from "./entity-loader.js";
import {rewriteMediaUrls} from "./media-cache.js";
import {searchEntities} from "./search-index.js";

const PIN_CATEGORIES = ["bestiary", "spell", "item", "condition", "disease", "status", "rule"];

/**
 * Tools → DM screen: pinned entity / note / counter cards.
 * @param {HTMLElement} listEl
 * @param {HTMLElement} readerEl
 */
export function renderDmScreen (listEl, readerEl, {plugin, board, onBoardChange} = {}) {
	listEl.empty();
	listEl.addClass("fiveetools-dmscreen");
	readerEl?.empty();

	const state = {
		panels: (board?.panels || []).map(it => ({...it, doc: it.doc ? {...it.doc} : null})),
	};

	const emit = () => {
		const next = setDmScreenBoard({panels: state.panels});
		onBoardChange?.(next);
		queueSaveDmScreen(plugin);
	};

	const bar = listEl.createDiv({cls: "fiveetools-dmscreen__bar"});
	const addEntityBtn = bar.createEl("button", {
		text: "Creature / spell / rule",
		cls: "fiveetools-btn",
		attr: {type: "button"},
	});
	const addNoteBtn = bar.createEl("button", {
		text: "Note",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	const addCounterBtn = bar.createEl("button", {
		text: "Counter",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});

	const searchEl = listEl.createDiv({cls: "fiveetools-dmscreen__search is-hidden"});
	const searchInput = searchEl.createEl("input", {
		cls: "fiveetools-dmscreen__searchinput",
		attr: {type: "search", placeholder: "Search creature, spell, item, condition, rule…"},
	});
	const hitsEl = searchEl.createDiv({cls: "fiveetools-dmscreen__hits"});

	const grid = listEl.createDiv({cls: "fiveetools-dmscreen__grid"});

	const paint = () => {
		grid.empty();
		if (!state.panels.length) {
			grid.createEl("p", {cls: "fiveetools-view__meta", text: "No panels yet."});
			return;
		}
		for (const panel of state.panels) paintCard(grid, panel);
	};

	const paintHits = () => {
		hitsEl.empty();
		const term = String(searchInput.value || "").trim();
		if (term.length < 2) return;
		const docs = searchEntities(term, {categoriesExact: PIN_CATEGORIES, limit: 8});
		if (!docs.length) {
			hitsEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No matches."});
			return;
		}
		for (const doc of docs) {
			const row = hitsEl.createDiv({cls: "fiveetools-dmscreen__hit"});
			row.createEl("div", {cls: "fiveetools-modal__name", text: doc.n});
			row.createEl("div", {
				cls: "fiveetools-modal__sub",
				text: [doc.cf, doc.sA || doc.s].filter(Boolean).join(" · "),
			});
			row.addEventListener("click", () => {
				state.panels.push({
					id: allocPanelId(),
					type: "entity",
					title: doc.n || "Entry",
					doc: slimDoc(doc),
					text: "",
					value: 0,
				});
				searchInput.value = "";
				hitsEl.empty();
				searchEl.addClass("is-hidden");
				emit();
				paint();
			});
		}
	};

	addEntityBtn.addEventListener("click", () => {
		const open = searchEl.hasClass("is-hidden");
		searchEl.toggleClass("is-hidden", !open);
		if (open) searchInput.focus();
	});
	addNoteBtn.addEventListener("click", () => {
		state.panels.push({
			id: allocPanelId(),
			type: "note",
			title: "Note",
			doc: null,
			text: "",
			value: 0,
		});
		emit();
		paint();
	});
	addCounterBtn.addEventListener("click", () => {
		state.panels.push({
			id: allocPanelId(),
			type: "counter",
			title: "Counter",
			doc: null,
			text: "",
			value: 0,
		});
		emit();
		paint();
	});
	searchInput.addEventListener("input", paintHits);

	const paintCard = (parent, panel) => {
		const card = parent.createDiv({cls: "fiveetools-dmscreen__card", attr: {"data-id": panel.id}});
		const head = card.createDiv({cls: "fiveetools-dmscreen__head"});
		if (panel.type === "entity") {
			head.createEl("div", {cls: "fiveetools-dmscreen__title", text: panel.title || panel.doc?.n || "Entry"});
		} else {
			const title = head.createEl("input", {
				cls: "fiveetools-dmscreen__titleinput",
				attr: {type: "text", value: panel.title || ""},
			});
			title.addEventListener("input", () => {
				panel.title = title.value;
				emit();
			});
			title.addEventListener("click", (evt) => evt.stopPropagation());
		}
		const remove = head.createEl("button", {
			text: "×",
			cls: "fiveetools-dmscreen__remove",
			attr: {type: "button", title: "Remove panel"},
		});
		remove.addEventListener("click", (evt) => {
			evt.stopPropagation();
			state.panels = state.panels.filter(it => it.id !== panel.id);
			emit();
			paint();
		});

		const body = card.createDiv({cls: "fiveetools-dmscreen__body"});
		if (panel.type === "note") paintNote(body, panel);
		else if (panel.type === "counter") paintCounter(body, panel);
		else void paintEntity(body, panel);
	};

	const paintNote = (body, panel) => {
		const area = body.createEl("textarea", {
			cls: "fiveetools-dmscreen__note",
			attr: {placeholder: "Note"},
		});
		area.value = panel.text || "";
		area.addEventListener("input", () => {
			panel.text = area.value;
			emit();
		});
	};

	const paintCounter = (body, panel) => {
		const row = body.createDiv({cls: "fiveetools-dmscreen__counter"});
		const minus = row.createEl("button", {
			text: "−",
			cls: "fiveetools-dmscreen__countbtn",
			attr: {type: "button", title: "−1"},
		});
		const valueEl = row.createEl("span", {
			cls: "fiveetools-dmscreen__count",
			text: String(panel.value || 0),
		});
		const plus = row.createEl("button", {
			text: "+",
			cls: "fiveetools-dmscreen__countbtn",
			attr: {type: "button", title: "+1"},
		});
		const setValue = (next) => {
			panel.value = next;
			valueEl.setText(String(next));
			emit();
		};
		minus.addEventListener("click", () => setValue((Number(panel.value) || 0) - 1));
		plus.addEventListener("click", () => setValue((Number(panel.value) || 0) + 1));
	};

	const paintEntity = async (body, panel) => {
		body.setText("Loading…");
		try {
			const loaded = await loadEntity(panel.doc);
			if (!body.isConnected) return;
			body.empty();
			if (!loaded?.ent) {
				body.createEl("p", {text: `No JSON found for ${panel.title || "entry"}.`});
				return;
			}
			const page = loadPageForDoc(panel.doc);
			const wrap = body.createDiv({cls: "fiveetools-view__stats"});
			wrap.innerHTML = renderCompactHtml(loaded.ent, page);
			if (loaded.ent.__prop === "monster") appendCreatureStatFooter(wrap, loaded.ent, plugin);
			bindInternalLinks(wrap, plugin);
			bindDiceRollers(wrap, plugin);
			await rewriteMediaUrls(plugin, wrap);
		} catch (e) {
			if (!body.isConnected) return;
			body.empty();
			body.createEl("p", {text: e.message || "Could not load entry."});
		}
	};

	paint();
}

function slimDoc (doc) {
	return {
		n: doc.n || "",
		u: doc.u || "",
		s: doc.s || "",
		c: doc.c ?? null,
		cf: doc.cf || "",
		sA: doc.sA || "",
	};
}
