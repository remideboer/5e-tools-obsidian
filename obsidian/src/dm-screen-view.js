import {MarkdownRenderer} from "obsidian";
import {fileStem, listCampaigns, listEntries, parseCampaignMarkdown} from "./campaign-store.js";
import {loadPageForDoc, renderCompactHtml} from "./compact-render.js";
import {CONDITIONS} from "./creature-form.js";
import {appendCreatureStatFooter} from "./creature-stat-footer.js";
import {bindDiceRollers} from "./dice-roll.js";
import {allocPanelId, queueSaveDmScreen, setDmScreenBoard} from "./dm-screen-store.js";
import {getEncounterInstance} from "./encounter-store.js";
import {listKindGroups} from "./encounter-view.js";
import {bindInternalLinks} from "./entity-reader.js";
import {loadEntity} from "./entity-loader.js";
import {HOMEBREW_TYPES, listBrewEntities} from "./homebrew-store.js";
import {rewriteMediaUrls} from "./media-cache.js";
import {brewDocFromEntity, findEntityDoc, searchEntities} from "./search-index.js";

const QUICK_REFS = [
	{ref: "conditions", label: "Conditions", name: "", categories: ["condition"]},
	{ref: "cover", label: "Cover", name: "Cover", categories: ["rule"]},
	{ref: "exhaustion", label: "Exhaustion", name: "Exhaustion", categories: ["condition"]},
	{ref: "concentration", label: "Concentration", name: "Concentration", categories: ["status"]},
];

const PIN_CATEGORIES = [
	"bestiary", "spell", "item", "background", "species",
	"condition", "disease", "status", "rule",
];

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
		text: "Entry / note",
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
	const addEncounterBtn = bar.createEl("button", {
		text: "Encounter",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Pin the current encounter roster"},
	});
	const refButtons = QUICK_REFS.map((spec) => {
		const el = bar.createEl("button", {
			text: spec.label,
			cls: "fiveetools-btn fiveetools-btn--ghost",
			attr: {type: "button", title: `Pin ${spec.label}`},
		});
		el.addEventListener("click", () => pinReference(spec));
		return {ref: spec.ref, el};
	});

	const searchEl = listEl.createDiv({cls: "fiveetools-dmscreen__search is-hidden"});
	const searchInput = searchEl.createEl("input", {
		cls: "fiveetools-dmscreen__searchinput",
		attr: {type: "search", placeholder: "Search creatures, items, homebrew, campaign notes…"},
	});
	const hitsEl = searchEl.createDiv({cls: "fiveetools-dmscreen__hits"});

	const grid = listEl.createDiv({cls: "fiveetools-dmscreen__grid"});

	const syncBar = () => {
		addEncounterBtn.toggleAttribute("disabled", state.panels.some(panel => panel.type === "encounter"));
		for (const btn of refButtons) {
			btn.el.toggleAttribute("disabled", state.panels.some(panel => panel.type === "reference" && panel.ref === btn.ref));
		}
	};

	const paint = () => {
		grid.empty();
		syncBar();
		if (!state.panels.length) {
			grid.createEl("p", {cls: "fiveetools-view__meta", text: "No panels yet."});
			return;
		}
		for (const panel of state.panels) paintCard(grid, panel);
	};

	let hitToken = 0;
	const paintHits = () => {
		const token = ++hitToken;
		hitsEl.empty();
		const term = String(searchInput.value || "").trim();
		if (term.length < 2) return;
		const docs = pinDocs(term);
		void findCampaignNotes(plugin, term).then((notes) => {
			if (token !== hitToken) return;
			hitsEl.empty();
			if (!docs.length && !notes.length) {
				hitsEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No matches."});
				return;
			}
			for (const note of notes) {
				const row = hitsEl.createDiv({cls: "fiveetools-dmscreen__hit"});
				row.createEl("div", {cls: "fiveetools-modal__name", text: note.title});
				row.createEl("div", {
					cls: "fiveetools-modal__sub",
					text: ["Note", note.campaign].filter(Boolean).join(" · "),
				});
				row.addEventListener("click", () => pinCampaignNote(note));
			}
			for (const doc of docs) {
				const row = hitsEl.createDiv({cls: "fiveetools-dmscreen__hit"});
				row.createEl("div", {cls: "fiveetools-modal__name", text: doc.n});
				row.createEl("div", {
					cls: "fiveetools-modal__sub",
					text: [doc.s === "HB" ? "Homebrew" : null, doc.cf, doc.sA || doc.s].filter(Boolean).join(" · "),
				});
				row.addEventListener("click", () => pinEntity(doc));
			}
		});
	};

	const closeSearch = () => {
		searchInput.value = "";
		hitsEl.empty();
		searchEl.addClass("is-hidden");
	};

	const pinEntity = (doc) => {
		state.panels.push({
			id: allocPanelId(),
			type: "entity",
			title: doc.n || "Entry",
			doc: slimDoc(doc),
			path: "",
			text: "",
			value: 0,
		});
		closeSearch();
		emit();
		paint();
	};

	const pinCampaignNote = (note) => {
		state.panels.push({
			id: allocPanelId(),
			type: "campaignNote",
			title: note.title || "Note",
			doc: null,
			path: note.path,
			text: "",
			value: 0,
		});
		closeSearch();
		emit();
		paint();
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
			path: "",
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
			path: "",
			ref: "",
			text: "",
			value: 0,
		});
		emit();
		paint();
	});
	addEncounterBtn.addEventListener("click", () => {
		if (state.panels.some(panel => panel.type === "encounter")) return;
		state.panels.unshift(blankPanel("encounter", "Encounter"));
		emit();
		paint();
	});

	const pinReference = (spec) => {
		if (state.panels.some(panel => panel.type === "reference" && panel.ref === spec.ref)) return;
		state.panels.push({...blankPanel("reference", spec.label), ref: spec.ref});
		emit();
		paint();
	};
	searchInput.addEventListener("input", paintHits);

	const paintCard = (parent, panel) => {
		const card = parent.createDiv({cls: "fiveetools-dmscreen__card", attr: {"data-id": panel.id}});
		const head = card.createDiv({cls: "fiveetools-dmscreen__head"});
		if (panel.type === "entity" || panel.type === "campaignNote" || panel.type === "encounter" || panel.type === "reference") {
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
		else if (panel.type === "campaignNote") void paintCampaignNote(body, panel);
		else if (panel.type === "encounter") paintEncounter(body);
		else if (panel.type === "reference") void paintReference(body, panel);
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

	const paintCampaignNote = async (body, panel) => {
		body.setText("Loading…");
		try {
			const entry = await readCampaignNote(plugin, panel.path);
			if (!body.isConnected) return;
			body.empty();
			if (!entry) {
				body.createEl("p", {text: "Note not found."});
				return;
			}
			const host = body.createDiv({cls: "fiveetools-dmscreen__markdown"});
			await MarkdownRenderer.render(plugin.app, entry.body || "", host, panel.path, plugin);
		} catch (e) {
			if (!body.isConnected) return;
			body.empty();
			body.createEl("p", {text: e.message || "Could not load note."});
		}
	};

	const paintEncounter = (body) => {
		const session = plugin._encounterSession || getEncounterInstance();
		const combatants = session?.combatants || [];
		if (!combatants.length) {
			body.createEl("p", {cls: "fiveetools-view__meta", text: "No creatures in the encounter."});
			return;
		}
		for (const group of listKindGroups(combatants)) {
			const headRow = body.createDiv({cls: "fiveetools-dmscreen__encgroup"});
			const name = group.members.length > 1 ? `${group.label} ×${group.members.length}` : group.label;
			headRow.createEl("span", {cls: "fiveetools-dmscreen__encname", text: name});
			headRow.createEl("span", {
				cls: "fiveetools-dmscreen__encinit",
				text: group.initScore != null ? String(group.initScore) : "—",
			});
			for (const combatant of group.members) {
				const row = body.createDiv({cls: "fiveetools-dmscreen__encrow"});
				row.createEl("span", {cls: "fiveetools-dmscreen__encwho", text: combatant.label || group.label});
				const bits = [`${combatant.hpCurrent ?? 0}/${combatant.hpMax ?? 0}`];
				if (Number(combatant.tempHp) > 0) bits.push(`temp ${combatant.tempHp}`);
				const cond = conditionLabel(combatant.condition);
				if (cond) bits.push(cond);
				row.createEl("span", {cls: "fiveetools-dmscreen__encmeta", text: bits.join("  ")});
			}
		}
	};

	const paintReference = async (body, panel) => {
		body.setText("Loading…");
		try {
			if (panel.ref === "conditions") {
				if (!body.isConnected) return;
				body.empty();
				for (const cond of CONDITIONS) {
					const doc = findEntityDoc(cond.label, {categoriesExact: ["condition"]});
					const block = body.createDiv({cls: "fiveetools-dmscreen__refblock"});
					block.createEl("div", {cls: "fiveetools-dmscreen__refname", text: cond.label});
					if (!doc) {
						block.createEl("p", {text: "Not found."});
						continue;
					}
					await renderDocInto(block, doc);
					if (!body.isConnected) return;
				}
				return;
			}
			const spec = QUICK_REFS.find(it => it.ref === panel.ref);
			const doc = spec?.name
				? findEntityDoc(spec.name, {categoriesExact: spec.categories})
				: null;
			if (!body.isConnected) return;
			body.empty();
			if (!doc) {
				body.createEl("p", {text: "Not found."});
				return;
			}
			await renderDocInto(body, doc);
		} catch (e) {
			if (!body.isConnected) return;
			body.empty();
			body.createEl("p", {text: e.message || "Could not load reference."});
		}
	};

	const renderDocInto = async (host, doc) => {
		const loaded = await loadEntity(doc);
		if (!host.isConnected) return;
		if (!loaded?.ent) {
			host.createEl("p", {text: `No JSON found for ${doc?.n || "entry"}.`});
			return;
		}
		const page = loadPageForDoc(doc);
		const wrap = host.createDiv({cls: "fiveetools-view__stats"});
		wrap.innerHTML = renderCompactHtml(loaded.ent, page);
		if (loaded.ent.__prop === "monster") appendCreatureStatFooter(wrap, loaded.ent, plugin);
		bindInternalLinks(wrap, plugin);
		bindDiceRollers(wrap, plugin);
		await rewriteMediaUrls(plugin, wrap);
	};

	const paintEntity = async (body, panel) => {
		body.setText("Loading…");
		try {
			if (!body.isConnected) return;
			body.empty();
			await renderDocInto(body, panel.doc);
		} catch (e) {
			if (!body.isConnected) return;
			body.empty();
			body.createEl("p", {text: e.message || "Could not load entry."});
		}
	};

	paint();
}

function blankPanel (type, title) {
	return {
		id: allocPanelId(),
		type,
		title,
		doc: null,
		path: "",
		ref: "",
		text: "",
		value: 0,
	};
}

function conditionLabel (id) {
	const key = String(id || "");
	if (!key) return "";
	return CONDITIONS.find(it => it.id === key)?.label || key;
}

function pinDocs (term) {
	const needle = String(term || "").trim().toLowerCase();
	const brew = [];
	for (const type of HOMEBREW_TYPES) {
		for (const ent of listBrewEntities(type.id)) {
			if (!String(ent?.name || "").toLowerCase().includes(needle)) continue;
			brew.push(brewDocFromEntity(ent, type));
		}
	}
	const rest = searchEntities(term, {categoriesExact: PIN_CATEGORIES, limit: 12});
	const seen = new Set();
	const out = [];
	for (const doc of [...brew, ...rest]) {
		const key = `${doc.s}|${doc.u}|${doc.c}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(doc);
		if (out.length >= 8) break;
	}
	return out;
}

async function findCampaignNotes (plugin, term) {
	const needle = String(term || "").trim().toLowerCase();
	if (needle.length < 2) return [];
	const campaigns = await listCampaigns(plugin);
	const out = [];
	for (const camp of campaigns) {
		const entries = await listEntries(plugin, camp.slug, "notes");
		for (const entry of entries) {
			const fromFile = fileStem(entry.path);
			const title = String(entry.fields?.name || "").trim() || fromFile || "Note";
			const blob = `${title}\n${fromFile}\n${entry.body || ""}`.toLowerCase();
			if (!blob.includes(needle)) continue;
			out.push({
				title,
				path: entry.path,
				campaign: camp.name,
				rank: title.toLowerCase().includes(needle) ? 0 : 1,
			});
		}
	}
	out.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
	return out.slice(0, 8);
}

async function readCampaignNote (plugin, filePath) {
	const vault = plugin?.app?.vault;
	if (!vault || !filePath) return null;
	const file = vault.getAbstractFileByPath(filePath);
	if (!file || file.children) return null;
	return parseCampaignMarkdown(await vault.read(file));
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
