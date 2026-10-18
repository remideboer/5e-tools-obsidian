import {Notice} from "obsidian";
import {closeCampaignNote, openCampaignNote} from "./campaign-editor.js";
import {
	CAMPAIGN_SECTIONS,
	createCampaign,
	createEntry,
	deleteCampaign,
	deleteEntry,
	entryLabel,
	entryFromSavedEncounter,
	listCampaigns,
	listEntries,
	parseCampaignMarkdown,
	readEntryText,
	sessionFromCampaignEncounter,
	writeEntry,
} from "./campaign-store.js";
import {listSavedEncounters, setEncounterInstance} from "./encounter-store.js";

export function teardownCampaignManager (plugin) {
	plugin?._campaignVaultOff?.();
	if (plugin) plugin._campaignVaultOff = null;
	closeCampaignNote(plugin);
}

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
	let parsed = parseCampaignMarkdown("");

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
	const actions = catalogEl.createDiv({cls: "fiveetools-homebrew__row"});
	const noteNameEl = actions.createEl("input", {
		cls: "fiveetools-campaign__select",
		attr: {type: "text", placeholder: "New note"},
	});
	const newBtn = actions.createEl("button", {text: "New", cls: "fiveetools-btn"});
	const deleteBtn = actions.createEl("button", {text: "Delete", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const listEl = catalogEl.createDiv({cls: "fiveetools-homebrew__list"});
	const importRow = catalogEl.createDiv({cls: "fiveetools-homebrew__row"});
	const importSel = importRow.createEl("select", {cls: "fiveetools-campaign__select"});
	const importBtn = importRow.createEl("button", {text: "Import from composer", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const openComposerBtn = importRow.createEl("button", {text: "Open in composer", cls: "fiveetools-btn fiveetools-btn--ghost"});

	const emit = () => {
		onSessionChange?.({slug, sectionId, selectedPath});
	};

	const showPlaceholder = (text) => {
		closeCampaignNote(plugin);
		resultEl.empty();
		resultEl.removeClass("fiveetools-campaign-reader");
		resultEl.createEl("p", {
			cls: "fiveetools-view__meta",
			text: text || "Create a campaign, then a note.",
		});
	};

	const currentSnapshot = () => parsed.snapshot;

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
					sectionId = section.id;
					selectedPath = "";
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
		actions.style.display = isOverview ? "none" : "";
		noteNameEl.style.display = isOverview ? "none" : "";
		newBtn.style.display = isOverview ? "none" : "";
		deleteBtn.style.display = isOverview ? "none" : "";
		noteNameEl.setAttribute("placeholder", "Name (optional)");
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
			const name = entryLabel(it).toLowerCase();
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
			row.createEl("div", {cls: "fiveetools-modal__name", text: entryLabel(it)});
			row.addEventListener("click", () => { void openPath(it.path); });
		}
	};

	const editorHost = () => {
		resultEl.addClass("fiveetools-campaign-reader");
		let wrap = resultEl.querySelector(".fiveetools-campaign__editor");
		if (!wrap) {
			resultEl.empty();
			resultEl.addClass("fiveetools-campaign-reader");
			wrap = resultEl.createDiv({cls: "fiveetools-campaign__editor"});
		}
		return wrap;
	};

	const paintEditor = async () => {
		if (!slug || !selectedPath) {
			showPlaceholder();
			return;
		}
		const file = app?.vault?.getAbstractFileByPath?.(selectedPath);
		if (!file || file.children) {
			showPlaceholder("Note is missing.");
			return;
		}
		try {
			await openCampaignNote(plugin, editorHost(), file);
		} catch (e) {
			showPlaceholder(e.message || "Could not open note.");
		}
	};

	const refreshParsed = async (filePath) => {
		const text = filePath ? await readEntryText(plugin, filePath) : "";
		parsed = parseCampaignMarkdown(text);
		paintImport();
		paintList();
	};

	const openPath = async (filePath) => {
		selectedPath = filePath || "";
		await refreshParsed(selectedPath);
		await paintEditor();
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

	const onVaultModify = (file) => {
		if (!file?.path) return;
		if (file.path === selectedPath || entries.some(it => it.path === file.path)) {
			void (async () => {
				if (sectionId === "overview") {
					campaigns = await listCampaigns(plugin);
					paintCampaignSelect();
				} else {
					entries = await listEntries(plugin, slug, sectionId);
				}
				if (file.path === selectedPath) await refreshParsed(selectedPath);
				else paintList();
			})();
		}
	};
	const onVaultRename = (file, oldPath) => {
		if (selectedPath === oldPath) {
			selectedPath = file?.path || "";
			emit();
		}
		onVaultModify(file);
	};

	plugin._campaignVaultOff?.();
	const modifyRef = app?.vault?.on?.("modify", onVaultModify);
	const renameRef = app?.vault?.on?.("rename", onVaultRename);
	plugin._campaignVaultOff = () => {
		app?.vault?.offref?.(modifyRef);
		app?.vault?.offref?.(renameRef);
	};

	paintCampaignSelect();
	paintTabs();
	paintImport();
	paintList();
	showPlaceholder();

	campaignSel.addEventListener("change", () => {
		void (async () => {
			slug = campaignSel.value;
			sectionId = "overview";
			selectedPath = "";
			parsed = parseCampaignMarkdown("");
			await reloadCampaigns();
			emit();
		})();
	});
	newCampaignBtn.addEventListener("click", async () => {
		try {
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
		closeCampaignNote(plugin);
		await deleteCampaign(plugin, slug);
		slug = "";
		selectedPath = "";
		parsed = parseCampaignMarkdown("");
		await reloadCampaigns();
		emit();
	});
	searchEl.addEventListener("input", () => paintList());
	newBtn.addEventListener("click", async () => {
		try {
			const created = await createEntry(plugin, slug, sectionId, noteNameEl.value);
			noteNameEl.value = "";
			entries = await listEntries(plugin, slug, sectionId);
			await openPath(created.path);
			new Notice(`Created ${entryLabel(created)}.`);
		} catch (e) {
			new Notice(e.message || "Could not create note.");
		}
	});
	deleteBtn.addEventListener("click", async () => {
		if (!selectedPath) return;
		const label = entryLabel({fields: parsed.fields, path: selectedPath});
		if (typeof window !== "undefined" && !window.confirm(`Delete ${label}?`)) return;
		closeCampaignNote(plugin);
		await deleteEntry(plugin, selectedPath);
		selectedPath = "";
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
			const written = await writeEntry(plugin, slug, "encounters", entryFromSavedEncounter(saved));
			entries = await listEntries(plugin, slug, sectionId);
			await openPath(written.path);
			new Notice(`Imported ${saved.name}.`);
		} catch (e) {
			new Notice(e.message || "Could not import encounter.");
		}
	});
	openComposerBtn.addEventListener("click", async () => {
		const text = selectedPath ? await readEntryText(plugin, selectedPath) : "";
		parsed = parseCampaignMarkdown(text);
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
