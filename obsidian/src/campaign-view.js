import {Notice} from "obsidian";
import {
	CAMPAIGN_SECTIONS,
	createCampaign,
	createEntry,
	deleteCampaign,
	deleteEntry,
	entryFromSavedEncounter,
	listCampaigns,
	listEntries,
	parseCampaignMarkdown,
	readEntryText,
	saveEntryText,
	sessionFromCampaignEncounter,
	writeEntry,
} from "./campaign-store.js";
import {listSavedEncounters, setEncounterInstance} from "./encounter-store.js";

export function renderCampaignManager (formEl, resultEl, {
	session,
	plugin,
	app,
	onSessionChange,
	onOpenComposer,
} = {}) {
	formEl.empty();
	formEl.addClass("fiveetools-campaign");

	let slug = session?.slug || "";
	let sectionId = session?.sectionId || "overview";
	let selectedPath = session?.selectedPath || "";
	let campaigns = [];
	let entries = [];
	let editorText = "";
	let parsed = parseCampaignMarkdown("");
	let saveTimer = null;
	let dirty = false;

	const catalogEl = formEl.createDiv({cls: "fiveetools-homebrew__catalog"});
	catalogEl.createEl("h3", {text: "Campaigns"});
	catalogEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Each campaign is a folder of markdown notes under your 5etools notes folder.",
	});
	const campaignRow = catalogEl.createDiv({cls: "fiveetools-homebrew__row"});
	const campaignSel = campaignRow.createEl("select", {cls: "fiveetools-campaign__select"});
	const newNameEl = campaignRow.createEl("input", {
		attr: {type: "text", placeholder: "New campaign"},
	});
	const newCampaignBtn = campaignRow.createEl("button", {text: "New", cls: "fiveetools-btn"});
	const deleteCampaignBtn = campaignRow.createEl("button", {text: "Delete", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const tabs = catalogEl.createDiv({cls: "fiveetools-homebrew__tabs"});
	const searchEl = catalogEl.createEl("input", {
		cls: "fiveetools-homebrew__search",
		attr: {type: "search", placeholder: "Filter…"},
	});
	const listEl = catalogEl.createDiv({cls: "fiveetools-homebrew__list"});
	const actions = catalogEl.createDiv({cls: "fiveetools-homebrew__row"});
	const noteNameEl = actions.createEl("input", {
		cls: "fiveetools-campaign__select",
		attr: {type: "text", placeholder: "New note"},
	});
	const newBtn = actions.createEl("button", {text: "New", cls: "fiveetools-btn"});
	const deleteBtn = actions.createEl("button", {text: "Delete", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const importRow = catalogEl.createDiv({cls: "fiveetools-homebrew__row"});
	const importSel = importRow.createEl("select", {cls: "fiveetools-campaign__select"});
	const importBtn = importRow.createEl("button", {text: "Import from composer", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const openComposerBtn = importRow.createEl("button", {text: "Open in composer", cls: "fiveetools-btn fiveetools-btn--ghost"});

	const emit = () => {
		onSessionChange?.({slug, sectionId, selectedPath});
	};

	const showPlaceholder = (text) => {
		resultEl.empty();
		resultEl.removeClass("fiveetools-campaign-reader");
		resultEl.createEl("p", {
			cls: "fiveetools-view__meta",
			text: text || "Create a campaign, then a note.",
		});
	};

	const currentSnapshot = () => parsed.snapshot || parseCampaignMarkdown(editorText).snapshot;

	const paintCampaignSelect = () => {
		campaignSel.empty();
		if (!campaigns.length) {
			campaignSel.createEl("option", {text: "No campaigns", attr: {value: ""}});
			return;
		}
		for (const it of campaigns) {
			const opt = campaignSel.createEl("option", {text: it.name, attr: {value: it.slug}});
			if (it.slug === slug) opt.selected = true;
		}
	};

	const paintTabs = () => {
		tabs.empty();
		for (const section of CAMPAIGN_SECTIONS) {
			const btn = tabs.createEl("button", {
				cls: `fiveetools-homebrew__tab${section.id === sectionId ? " is-active" : ""}`,
				text: section.label,
			});
			btn.toggleAttribute("disabled", !slug);
			btn.addEventListener("click", () => {
				void (async () => {
					await flushSave();
					sectionId = section.id;
					selectedPath = "";
					editorText = "";
					parsed = parseCampaignMarkdown("");
					if (sectionId === "overview") await loadOverview();
					else await reloadEntries();
					emit();
				})();
			});
		}
	};

	const paintImport = () => {
		const show = !!slug && sectionId === "encounters";
		importRow.style.display = show ? "" : "none";
		importSel.empty();
		const saved = listSavedEncounters();
		openComposerBtn.disabled = !show || !currentSnapshot();
		if (!saved.length) {
			importSel.createEl("option", {text: "No saved encounters", attr: {value: ""}});
			importBtn.disabled = true;
			return;
		}
		importBtn.disabled = false;
		for (const it of saved) {
			importSel.createEl("option", {text: it.name, attr: {value: it.id}});
		}
	};

	const paintList = () => {
		listEl.empty();
		const isOverview = sectionId === "overview";
		searchEl.style.display = isOverview ? "none" : "";
		noteNameEl.style.display = isOverview ? "none" : "";
		newBtn.style.display = isOverview ? "none" : "";
		deleteBtn.style.display = isOverview ? "none" : "";
		deleteBtn.disabled = !selectedPath;
		openComposerBtn.disabled = sectionId !== "encounters" || !currentSnapshot();
		if (!slug) {
			listEl.createEl("div", {cls: "fiveetools-modal__empty", text: "Create a campaign to begin."});
			return;
		}
		if (isOverview) {
			listEl.createEl("div", {cls: "fiveetools-modal__empty", text: "Campaign overview."});
			return;
		}
		const needle = String(searchEl.value || "").trim().toLowerCase();
		const shown = entries.filter(it => {
			const name = String(it.fields?.name || "").toLowerCase();
			return !needle || name.includes(needle);
		});
		if (!shown.length) {
			listEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No entries."});
			return;
		}
		for (const it of shown) {
			const row = listEl.createEl("button", {
				cls: `fiveetools-homebrew__hit${it.path === selectedPath ? " is-selected" : ""}`,
			});
			row.createEl("div", {cls: "fiveetools-modal__name", text: it.fields?.name || it.path});
			row.addEventListener("click", () => { void openPath(it.path); });
		}
	};

	const paintEditor = () => {
		resultEl.empty();
		if (!slug || !selectedPath) {
			showPlaceholder();
			return;
		}
		resultEl.addClass("fiveetools-campaign-reader");
		const wrap = resultEl.createDiv({cls: "fiveetools-campaign__editor"});
		if (sectionId === "maps" && parsed.fields?.image) {
			const src = vaultResource(app, parsed.fields.image);
			if (src) wrap.createEl("img", {attr: {src, alt: parsed.fields.name || "Map"}, cls: "fiveetools-campaign__map"});
		}
		const ta = wrap.createEl("textarea", {cls: "fiveetools-campaign__textarea"});
		ta.value = editorText;
		ta.addEventListener("input", () => {
			editorText = ta.value;
			parsed = parseCampaignMarkdown(editorText);
			dirty = true;
			openComposerBtn.disabled = sectionId !== "encounters" || !currentSnapshot();
			scheduleSave();
			emit();
		});
	};

	const flushSave = async () => {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		if (!dirty || !slug || !selectedPath) return;
		try {
			const saved = await saveEntryText(plugin, slug, sectionId, selectedPath, editorText);
			selectedPath = saved.path;
			parsed = saved;
			dirty = false;
			if (sectionId === "overview") {
				campaigns = await listCampaigns(plugin);
				paintCampaignSelect();
			} else {
				entries = await listEntries(plugin, slug, sectionId);
				paintList();
			}
		} catch (e) {
			new Notice(e.message || "Could not save.");
		}
	};

	const scheduleSave = () => {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => { void flushSave(); }, 400);
	};

	const openPath = async (filePath) => {
		await flushSave();
		selectedPath = filePath || "";
		editorText = selectedPath ? await readEntryText(plugin, selectedPath) : "";
		parsed = parseCampaignMarkdown(editorText);
		dirty = false;
		paintList();
		paintImport();
		paintEditor();
		emit();
	};

	const loadOverview = async () => {
		entries = [];
		const [overview] = await listEntries(plugin, slug, "overview");
		paintTabs();
		paintImport();
		paintList();
		await openPath(overview?.path || "");
	};

	const reloadEntries = async () => {
		entries = slug ? await listEntries(plugin, slug, sectionId) : [];
		if (selectedPath && !entries.some(it => it.path === selectedPath)) selectedPath = "";
		paintTabs();
		paintImport();
		paintList();
		if (selectedPath) await openPath(selectedPath);
		else {
			editorText = "";
			parsed = parseCampaignMarkdown("");
			showPlaceholder();
			emit();
		}
	};

	const reloadCampaigns = async () => {
		campaigns = await listCampaigns(plugin);
		if (slug && !campaigns.some(it => it.slug === slug)) slug = campaigns[0]?.slug || "";
		if (!slug && campaigns[0]) slug = campaigns[0].slug;
		paintCampaignSelect();
		if (!slug) {
			sectionId = "overview";
			selectedPath = "";
			editorText = "";
			parsed = parseCampaignMarkdown("");
			entries = [];
			paintTabs();
			paintImport();
			paintList();
			showPlaceholder();
			return;
		}
		if (sectionId === "overview") await loadOverview();
		else await reloadEntries();
	};

	paintCampaignSelect();
	paintTabs();
	paintImport();
	paintList();
	showPlaceholder();

	campaignSel.addEventListener("change", () => {
		void (async () => {
			await flushSave();
			slug = campaignSel.value;
			sectionId = "overview";
			selectedPath = "";
			editorText = "";
			parsed = parseCampaignMarkdown("");
			await reloadCampaigns();
			emit();
		})();
	});
	newCampaignBtn.addEventListener("click", async () => {
		try {
			await flushSave();
			const created = await createCampaign(plugin, newNameEl.value);
			newNameEl.value = "";
			slug = created.slug;
			sectionId = "overview";
			selectedPath = "";
			await reloadCampaigns();
			emit();
			new Notice(`Created ${created.name}.`);
		} catch (e) {
			new Notice(e.message || "Could not create campaign.");
		}
	});
	deleteCampaignBtn.addEventListener("click", async () => {
		if (!slug) return;
		const label = campaigns.find(it => it.slug === slug)?.name || slug;
		if (typeof window !== "undefined" && !window.confirm(`Delete campaign ${label}?`)) return;
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		dirty = false;
		await deleteCampaign(plugin, slug);
		slug = "";
		selectedPath = "";
		editorText = "";
		parsed = parseCampaignMarkdown("");
		await reloadCampaigns();
		emit();
	});
	searchEl.addEventListener("input", () => paintList());
	newBtn.addEventListener("click", async () => {
		try {
			await flushSave();
			const created = await createEntry(plugin, slug, sectionId, noteNameEl.value);
			noteNameEl.value = "";
			entries = await listEntries(plugin, slug, sectionId);
			await openPath(created.path);
			new Notice(`Created ${created.fields?.name || "note"}.`);
		} catch (e) {
			new Notice(e.message || "Could not create note.");
		}
	});
	deleteBtn.addEventListener("click", async () => {
		if (!selectedPath) return;
		const label = parsed.fields?.name || "this entry";
		if (typeof window !== "undefined" && !window.confirm(`Delete ${label}?`)) return;
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		dirty = false;
		await deleteEntry(plugin, selectedPath);
		selectedPath = "";
		editorText = "";
		parsed = parseCampaignMarkdown("");
		await reloadEntries();
		emit();
	});
	importBtn.addEventListener("click", async () => {
		const saved = listSavedEncounters().find(it => it.id === importSel.value);
		if (!saved) {
			new Notice("Save an encounter in the composer first.");
			return;
		}
		try {
			await flushSave();
			const written = await writeEntry(plugin, slug, "encounters", entryFromSavedEncounter(saved));
			entries = await listEntries(plugin, slug, sectionId);
			await openPath(written.path);
			new Notice(`Imported ${saved.name}.`);
		} catch (e) {
			new Notice(e.message || "Could not import encounter.");
		}
	});
	openComposerBtn.addEventListener("click", () => {
		const snapshot = currentSnapshot();
		if (!snapshot) return;
		const next = sessionFromCampaignEncounter({
			fields: {name: parsed.fields?.name || ""},
			snapshot,
		});
		setEncounterInstance(next);
		onOpenComposer?.(next);
	});

	void reloadCampaigns().catch((e) => {
		new Notice(e.message || "Could not load campaigns.");
		paintCampaignSelect();
		paintTabs();
		paintImport();
		paintList();
		showPlaceholder(e.message || "Could not load campaigns.");
	});
}

function vaultResource (app, vaultPath) {
	const file = app?.vault?.getAbstractFileByPath?.(String(vaultPath || "").replace(/\\/g, "/"));
	if (!file || file.children) return "";
	return app.vault.getResourcePath?.(file) || "";
}
