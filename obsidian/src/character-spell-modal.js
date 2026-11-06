import {Modal, Notice} from "obsidian";
import {saveCharacter, saveCharacterPlay} from "./character-store.js";
import {
	canLearnSpell,
	canPrepareSpell,
	capsSummary,
	levelLabel,
	listClassSpellDocs,
	loadCasterProfile,
	mergeSlotSpent,
	recordToCard,
	spellCounts,
	spellRefFromDoc,
} from "./character-spells.js";
import {attachHoverCard} from "./hover-card.js";
import {findEntityDoc} from "./search-index.js";
import {getSpellMeta} from "./spell-meta.js";

/**
 * Manage Spells modal. Applies learn/prepare immediately (like gear).
 * onChanged() is called after each successful save so the sheet can refresh.
 */
export class ManageSpellsModal extends Modal {
	constructor (app, {plugin, record, profile, onChanged} = {}) {
		super(app);
		this.plugin = plugin;
		this.record = record;
		this.profile = profile;
		this.onChanged = onChanged;
		this.query = "";
		this.docs = [];
		this.busy = false;
	}

	async onOpen () {
		this.contentEl.empty();
		this.modalEl.addClass("fiveetools-spell-manage");
		this.contentEl.createEl("h2", {text: "Manage Spells"});
		this.metaEl = this.contentEl.createEl("p", {cls: "fiveetools-view__meta"});
		this.warnEl = this.contentEl.createEl("p", {cls: "fiveetools-view__meta"});
		const id = String(this.record?.fields?.ddb_id || "");
		if (id && !id.startsWith("local-") && !id.startsWith("pdf-")) {
			this.warnEl.setText("Refresh from D&D Beyond replaces the spell list.");
		} else {
			this.warnEl.setText("");
		}

		const searchRow = this.contentEl.createDiv({cls: "fiveetools-homebrew__row"});
		this.searchInput = searchRow.createEl("input", {
			cls: "fiveetools-campaign__select",
			attr: {type: "search", placeholder: "Search spells…"},
		});
		this.searchInput.value = this.query;
		this.searchInput.addEventListener("input", () => {
			this.query = this.searchInput.value;
			void this.reloadList();
		});

		this.listEl = this.contentEl.createDiv({cls: "fiveetools-spell-manage__list"});
		const footer = this.contentEl.createDiv({cls: "fiveetools-homebrew__row"});
		const closeBtn = footer.createEl("button", {text: "Close", cls: "fiveetools-btn", attr: {type: "button"}});
		closeBtn.addEventListener("click", () => this.close());

		await this.reloadList();
		queueMicrotask(() => this.searchInput.focus());
	}

	onClose () {
		this.contentEl.empty();
	}

	async reloadList () {
		this.paintMeta();
		this.listEl.empty();
		this.listEl.createEl("p", {cls: "fiveetools-view__meta", text: "Loading…"});
		try {
			this.docs = await listClassSpellDocs(this.plugin, this.profile, {query: this.query});
		} catch (e) {
			this.listEl.empty();
			this.listEl.createEl("p", {cls: "fiveetools-view__meta", text: e.message || "Could not load spells."});
			return;
		}
		this.paintList();
	}

	paintMeta () {
		const counts = spellCounts(this.record);
		const title = this.profile
			? `${this.profile.className} ${this.profile.level} · ${capsSummary(this.profile, counts)}`
			: capsSummary(this.profile, counts);
		this.metaEl.setText(title || "Spells");
	}

	paintList () {
		const scrollTop = this.listEl.scrollTop || 0;
		this.listEl.empty();
		if (!this.docs.length) {
			this.listEl.createEl("p", {cls: "fiveetools-view__meta", text: "No spells match."});
			return;
		}
		const known = knownSpellNames(this.record);
		const prepared = new Set(this.record?.snapshot?.play?.prepared || []);
		const counts = spellCounts(this.record);
		const byLevel = new Map();
		for (const doc of this.docs) {
			const level = getSpellMeta(doc)?.level ?? 99;
			if (!byLevel.has(level)) byLevel.set(level, []);
			byLevel.get(level).push(doc);
		}
		const levels = [...byLevel.keys()].sort((a, b) => a - b);
		for (const level of levels) {
			const group = this.listEl.createDiv({cls: "fiveetools-spell-manage__group"});
			group.createEl("h3", {text: levelLabel(level)});
			for (const doc of byLevel.get(level)) {
				this.paintRow(group, doc, known, prepared, counts, level);
			}
		}
		this.listEl.scrollTop = scrollTop;
	}

	paintRow (parent, doc, known, prepared, counts, level) {
		const name = String(doc.n || "").trim();
		const row = parent.createDiv({cls: "fiveetools-spell-manage__row"});
		const learn = row.createEl("input", {
			attr: {type: "checkbox", title: level === 0 ? "Known cantrip" : "On spell list"},
		});
		learn.checked = known.has(name.toLowerCase());
		const atLearnCap = !learn.checked && !canLearnSpell(this.profile, counts, level);
		learn.disabled = this.busy || atLearnCap;
		learn.addEventListener("change", () => {
			void this.toggleLearn(doc, learn.checked);
		});

		const label = row.createEl("button", {
			cls: "fiveetools-spell-manage__name fiveetools-character-card__link",
			attr: {type: "button"},
		});
		label.createSpan({text: name});
		if (doc.s) label.createSpan({cls: "fiveetools-character-card__source", text: ` · ${doc.s}`});
		attachHoverCard(label, this.plugin, () => findEntityDoc(name, {
			categoriesExact: ["spell"],
			source: doc.s,
		}) || doc);
		label.addEventListener("click", (evt) => {
			evt.preventDefault();
			void this.plugin.openPreview?.(doc);
		});

		if (this.profile?.mode === "prepared" && level > 0) {
			const prepWrap = row.createEl("label", {cls: "fiveetools-spell-manage__prep"});
			const prep = prepWrap.createEl("input", {
				attr: {type: "checkbox", title: "Prepared"},
			});
			prep.checked = prepared.has(name);
			const canPrep = learn.checked && (prep.checked || canPrepareSpell(this.profile, counts));
			prep.disabled = this.busy || !learn.checked || (!prep.checked && !canPrep);
			prepWrap.createSpan({text: "Prep"});
			prep.addEventListener("change", () => {
				void this.togglePrepared(name, prep.checked);
			});
		}
	}

	async toggleLearn (doc, learn) {
		if (this.busy) return;
		this.busy = true;
		try {
			const name = String(doc.n || "").trim();
			const needle = name.toLowerCase();
			const card = recordToCard(this.record);
			const play = this.record.snapshot?.play || {prepared: []};
			const nonSpells = (card.refs || []).filter(ref => ref.kind !== "spell");
			let spells = (card.refs || []).filter(ref => ref.kind === "spell");
			if (learn) {
				const level = getSpellMeta(doc)?.level ?? 0;
				const counts = spellCounts(this.record);
				if (!canLearnSpell(this.profile, counts, level)) {
					new Notice("That would exceed the spell cap.");
					return;
				}
				if (!spells.some(ref => String(ref.name || ref.label || "").toLowerCase() === needle)) {
					const ref = await spellRefFromDoc(doc, {
						listName: this.profile.className,
						edition: this.profile.edition,
					});
					if (!ref) throw new Error("Could not load that spell.");
					spells.push(ref);
				}
				if (this.profile.mode === "known" && level > 0) {
					const set = new Set(play.prepared || []);
					set.add(name);
					play.prepared = [...set];
				}
				if (!card.slots?.length && this.profile.slots?.length) {
					card.slots = mergeSlotSpent(this.profile.slots, card.slots || []);
				}
			} else {
				spells = spells.filter(ref => String(ref.name || ref.label || "").toLowerCase() !== needle);
				play.prepared = (play.prepared || []).filter(it => String(it).toLowerCase() !== needle);
			}
			card.refs = [...nonSpells, ...sortSpellRefs(spells)];
			const saved = await saveCharacter(this.plugin, card);
			await saveCharacterPlay(this.plugin, card.ddbId, play);
			this.record = saved || this.record;
			if (this.record.snapshot) this.record.snapshot.play = play;
			this.paintMeta();
			await this.onChanged?.(this.record);
		} catch (e) {
			new Notice(e.message || "Could not update spells.");
		} finally {
			this.busy = false;
			this.paintList();
		}
	}

	async togglePrepared (name, on) {
		if (this.busy) return;
		this.busy = true;
		try {
			const play = this.record.snapshot.play || {prepared: []};
			const set = new Set(play.prepared || []);
			if (on) {
				const counts = spellCounts(this.record);
				if (!canPrepareSpell(this.profile, counts)) {
					new Notice("Prepared spell limit reached.");
					return;
				}
				set.add(name);
			} else {
				set.delete(name);
			}
			play.prepared = [...set];
			const id = String(this.record.fields?.ddb_id || "");
			await saveCharacterPlay(this.plugin, id, play);
			this.record.snapshot.play = play;
			this.paintMeta();
			this.paintList();
			await this.onChanged?.(this.record);
		} catch (e) {
			new Notice(e.message || "Could not update prepared spells.");
		} finally {
			this.busy = false;
			this.paintList();
		}
	}
}

export async function openManageSpells (plugin, record, onChanged) {
	const profile = await loadCasterProfile(plugin, record);
	const hasSpells = (record?.snapshot?.refs || []).some(ref => ref?.kind === "spell");
	if (!profile && !hasSpells) {
		new Notice("This character has no casting class.");
		return null;
	}
	const modal = new ManageSpellsModal(plugin.app, {
		plugin,
		record,
		profile: profile || {
			className: "Spells",
			level: Number(record?.fields?.level) || 1,
			edition: record?.snapshot?.edition === "one" ? "one" : "classic",
			mode: "prepared",
			cantripsMax: 99,
			preparedMax: 99,
			knownMax: 0,
			slots: record?.snapshot?.slots || [],
			maxLevel: 9,
		},
		onChanged,
	});
	modal.open();
	return modal;
}

function knownSpellNames (record) {
	const set = new Set();
	for (const ref of record?.snapshot?.refs || []) {
		if (ref?.kind !== "spell") continue;
		set.add(String(ref.name || ref.label || "").trim().toLowerCase());
	}
	return set;
}

function sortSpellRefs (refs) {
	return refs.slice().sort((a, b) => (Number(a.level) || 0) - (Number(b.level) || 0) || String(a.name || "").localeCompare(String(b.name || "")));
}
