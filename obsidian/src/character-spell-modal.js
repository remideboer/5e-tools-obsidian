import {Modal, Notice} from "obsidian";
import {saveCharacter, saveCharacterPlay} from "./character-store.js";
import {
	canLearnSpell,
	canPrepareSpell,
	capsSummary,
	levelLabel,
	listCasterSpellRows,
	listNames,
	loadCasterProfiles,
	mergeSlotSpent,
	recordToCard,
	spellCountsForClass,
	spellOnClassList,
	spellRefFromDoc,
} from "./character-spells.js";
import {attachHoverCard} from "./hover-card.js";
import {createSearchInput} from "./search-field.js";
import {findEntityDoc} from "./search-index.js";
import {getSpellMeta} from "./spell-meta.js";

/**
 * Manage Spells modal. Applies learn/prepare immediately (like gear).
 * onChanged() is called after each successful save so the sheet can refresh.
 */
export class ManageSpellsModal extends Modal {
	constructor (app, {plugin, record, profiles, onChanged} = {}) {
		super(app);
		this.plugin = plugin;
		this.record = record;
		this.profiles = profiles || [];
		this.onChanged = onChanged;
		this.query = "";
		this.rows = [];
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
		this.searchInput = createSearchInput(searchRow, {
			cls: "fiveetools-campaign__select",
			placeholder: "Search spells…",
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
			this.rows = await listCasterSpellRows(this.plugin, this.profiles, {query: this.query});
		} catch (e) {
			this.listEl.empty();
			this.listEl.createEl("p", {cls: "fiveetools-view__meta", text: e.message || "Could not load spells."});
			return;
		}
		this.paintList();
	}

	paintMeta () {
		const primary = this.profiles[0]?.className || "";
		const parts = this.profiles.map(profile => {
			const counts = spellCountsForClass(this.record, profile.className, {
				primary: profile.className === primary,
			});
			const caps = capsSummary(profile, counts);
			return caps ? `${profile.className} ${profile.level} · ${caps}` : `${profile.className} ${profile.level}`;
		});
		this.metaEl.setText(parts.join(" · ") || "Spells");
	}

	paintList () {
		const scrollTop = this.listEl.scrollTop || 0;
		this.listEl.empty();
		if (!this.rows.length) {
			this.listEl.createEl("p", {cls: "fiveetools-view__meta", text: "No spells match."});
			return;
		}
		const prepared = new Set(this.record?.snapshot?.play?.prepared || []);
		const primary = this.profiles[0]?.className || "";
		const byLevel = new Map();
		for (const entry of this.rows) {
			const level = getSpellMeta(entry.doc)?.level ?? 99;
			if (!byLevel.has(level)) byLevel.set(level, []);
			byLevel.get(level).push(entry);
		}
		const levels = [...byLevel.keys()].sort((a, b) => a - b);
		for (const level of levels) {
			const group = this.listEl.createDiv({cls: "fiveetools-spell-manage__group"});
			group.createEl("h3", {text: levelLabel(level)});
			for (const entry of byLevel.get(level)) {
				this.paintRow(group, entry, prepared, primary, level);
			}
		}
		this.listEl.scrollTop = scrollTop;
	}

	paintRow (parent, entry, prepared, primary, level) {
		const {doc, className, profile} = entry;
		const name = String(doc.n || "").trim();
		const counts = spellCountsForClass(this.record, className, {primary: className === primary});
		const row = parent.createDiv({cls: "fiveetools-spell-manage__row"});
		const learn = row.createEl("input", {
			attr: {type: "checkbox", title: level === 0 ? "Known cantrip" : "On spell list"},
		});
		learn.checked = spellOnClassList(this.record, name, className, primary);
		const atLearnCap = !learn.checked && !canLearnSpell(profile, counts, level);
		learn.disabled = this.busy || atLearnCap;
		learn.addEventListener("change", () => {
			void this.toggleLearn(doc, learn.checked, profile);
		});

		const label = row.createEl("button", {
			cls: "fiveetools-spell-manage__name fiveetools-character-card__link",
			attr: {type: "button"},
		});
		label.createSpan({text: name});
		label.createSpan({cls: "fiveetools-character-card__source", text: ` · ${className}`});
		if (doc.s) label.createSpan({cls: "fiveetools-character-card__source", text: ` · ${doc.s}`});
		attachHoverCard(label, this.plugin, () => findEntityDoc(name, {
			categoriesExact: ["spell"],
			source: doc.s,
		}) || doc);
		label.addEventListener("click", (evt) => {
			evt.preventDefault();
			void this.plugin.openPreview?.(doc);
		});

		if (profile?.mode === "prepared" && level > 0) {
			const prepWrap = row.createEl("label", {cls: "fiveetools-spell-manage__prep"});
			const prep = prepWrap.createEl("input", {
				attr: {type: "checkbox", title: "Prepared"},
			});
			prep.checked = learn.checked && prepared.has(name);
			const canPrep = learn.checked && (prep.checked || canPrepareSpell(profile, counts));
			prep.disabled = this.busy || !learn.checked || (!prep.checked && !canPrep);
			prepWrap.createSpan({text: "Prep"});
			prep.addEventListener("change", () => {
				void this.togglePrepared(name, prep.checked, profile);
			});
		}
	}

	async toggleLearn (doc, learn, profile) {
		if (this.busy) return;
		this.busy = true;
		try {
			const name = String(doc.n || "").trim();
			const needle = name.toLowerCase();
			const card = recordToCard(this.record);
			const play = this.record.snapshot?.play || {prepared: []};
			const nonSpells = (card.refs || []).filter(ref => ref.kind !== "spell");
			let spells = (card.refs || []).filter(ref => ref.kind === "spell");
			const primary = this.profiles[0]?.className || profile.className;
			if (learn) {
				const level = getSpellMeta(doc)?.level ?? 0;
				const counts = spellCountsForClass(this.record, profile.className, {
					primary: profile.className === primary,
				});
				if (!canLearnSpell(profile, counts, level)) {
					new Notice("That would exceed the spell cap.");
					return;
				}
				let ref = spells.find(it => String(it.name || it.label || "").toLowerCase() === needle);
				if (!ref) {
					ref = await spellRefFromDoc(doc, {
						listName: profile.className,
						edition: profile.edition,
					});
					if (!ref) throw new Error("Could not load that spell.");
					spells.push(ref);
				} else {
					const names = listNames(ref);
					if (!names.length && primary && profile.className !== primary) names.push(primary);
					names.push(profile.className);
					assignList(ref, names);
				}
				if (profile.mode === "known" && level > 0) {
					const set = new Set(play.prepared || []);
					set.add(name);
					play.prepared = [...set];
				}
				if (!card.slots?.length && profile.slots?.length) {
					card.slots = mergeSlotSpent(profile.slots, card.slots || []);
				}
			} else {
				const ref = spells.find(it => String(it.name || it.label || "").toLowerCase() === needle);
				if (ref) {
					let names = listNames(ref);
					if (!names.length) names = primary ? [primary] : [];
					names = names.filter(it => it.toLowerCase() !== profile.className.toLowerCase());
					if (names.length) assignList(ref, names);
					else {
						spells = spells.filter(it => it !== ref);
						play.prepared = (play.prepared || []).filter(it => String(it).toLowerCase() !== needle);
					}
				}
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

	async togglePrepared (name, on, profile) {
		if (this.busy) return;
		this.busy = true;
		try {
			const play = this.record.snapshot.play || {prepared: []};
			const set = new Set(play.prepared || []);
			if (on) {
				const primary = this.profiles[0]?.className || profile.className;
				const counts = spellCountsForClass(this.record, profile.className, {
					primary: profile.className === primary,
				});
				if (!canPrepareSpell(profile, counts)) {
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
	const profiles = await loadCasterProfiles(plugin, record);
	const hasSpells = (record?.snapshot?.refs || []).some(ref => ref?.kind === "spell");
	if (!profiles.length && !hasSpells) {
		new Notice("This character has no casting class.");
		return null;
	}
	const modal = new ManageSpellsModal(plugin.app, {
		plugin,
		record,
		profiles: profiles.length ? profiles : [{
			className: "Spells",
			level: Number(record?.fields?.level) || 1,
			edition: record?.snapshot?.edition === "one" ? "one" : "classic",
			mode: "prepared",
			cantripsMax: 99,
			preparedMax: 99,
			knownMax: 0,
			slots: record?.snapshot?.slots || [],
			maxLevel: 9,
		}],
		onChanged,
	});
	modal.open();
	return modal;
}

function assignList (ref, names) {
	const unique = [];
	for (const name of names) {
		const text = String(name || "").trim();
		if (!text || unique.some(it => it.toLowerCase() === text.toLowerCase())) continue;
		unique.push(text);
	}
	if (unique.length) ref.list = unique.join(", ");
	else delete ref.list;
}

function sortSpellRefs (refs) {
	return refs.slice().sort((a, b) => (Number(a.level) || 0) - (Number(b.level) || 0) || String(a.name || "").localeCompare(String(b.name || "")));
}
