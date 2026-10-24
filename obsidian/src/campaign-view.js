import {Notice} from "obsidian";
import {closeCampaignNote, openCampaignNote} from "./campaign-editor.js";
import {
	CAMPAIGN_SECTIONS,
	combatantsFromSnapshot,
	createCampaign,
	createEntry,
	deleteCampaign,
	deleteEntry,
	entryLabel,
	entryFromSavedEncounter,
	fileStem,
	listCampaigns,
	listEntries,
	parseCampaignMarkdown,
	readEntryText,
	sessionFromCampaignEncounter,
	snapshotCombatants,
	writeEntry,
} from "./campaign-store.js";
import {renderEntityPanel} from "./entity-reader.js";
import {listSavedEncounters, setEncounterInstance} from "./encounter-store.js";
import {renderCombatantRow} from "./encounter-view.js";

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
	onOpenMap,
} = {}) {
	formEl.empty();
	formEl.addClass("fiveetools-campaign");
	resultEl.empty();
	resultEl.addClass("fiveetools-campaign-reader");
	const chromeEl = resultEl.createDiv({cls: "fiveetools-campaign__chrome"});
	const addBtn = chromeEl.createEl("button", {
		text: "+",
		cls: "fiveetools-btn fiveetools-btn--ghost fiveetools-campaign__add",
		attr: {type: "button", title: "New note"},
	});
	const bodyEl = resultEl.createDiv({cls: "fiveetools-campaign__body"});

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

	const clearEncounterRoster = () => {
		formEl.removeClass("fiveetools-campaign--encounter");
		formEl.querySelector(".fiveetools-encounter__creatures")?.remove();
	};

	const syncChrome = () => {
		const show = !!slug && sectionId !== "overview";
		chromeEl.style.display = show ? "" : "none";
		addBtn.disabled = !show;
	};

	const showPlaceholder = (text) => {
		closeCampaignNote(plugin);
		clearEncounterRoster();
		bodyEl.empty();
		resultEl.addClass("fiveetools-campaign-reader");
		resultEl.removeClass("fiveetools-campaign-encounter");
		bodyEl.createEl("p", {
			cls: "fiveetools-view__meta",
			text: text || (sectionId === "encounters"
				? "Create or import an encounter."
				: "Create a campaign, then a note."),
		});
		syncChrome();
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
		openComposerBtn.disabled = !show || !selectedPath;
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

	const syncListSelection = () => {
		deleteBtn.disabled = !selectedPath;
		openComposerBtn.disabled = sectionId !== "encounters" || !selectedPath;
		listEl.querySelectorAll(".fiveetools-homebrew__hit").forEach((el) => {
			el.classList.toggle("is-selected", el.dataset.path === selectedPath);
		});
	};

	const paintList = () => {
		const scrollTop = listEl.scrollTop || 0;
		listEl.empty();
		const isOverview = sectionId === "overview";
		searchEl.style.display = isOverview ? "none" : "";
		actions.style.display = isOverview ? "none" : "";
		noteNameEl.style.display = isOverview ? "none" : "";
		newBtn.style.display = isOverview ? "none" : "";
		deleteBtn.style.display = isOverview ? "none" : "";
		noteNameEl.setAttribute("placeholder", "Name (optional)");
		syncChrome();
		if (!slug) {
			listEl.createEl("div", {cls: "fiveetools-modal__empty", text: "Create a campaign to begin."});
			syncListSelection();
			return;
		}
		if (isOverview) {
			listEl.createEl("div", {cls: "fiveetools-modal__empty", text: "Campaign overview."});
			syncListSelection();
			return;
		}
		const needle = String(searchEl.value || "").trim().toLowerCase();
		const shown = entries.filter(it => {
			const name = entryLabel(it).toLowerCase();
			return !needle || name.includes(needle);
		});
		if (!shown.length) {
			listEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No entries."});
			syncListSelection();
			return;
		}
		for (const it of shown) {
			const row = listEl.createEl("button", {
				cls: `fiveetools-homebrew__hit${it.path === selectedPath ? " is-selected" : ""}`,
				attr: {"data-path": it.path},
			});
			row.createEl("div", {cls: "fiveetools-modal__name", text: entryLabel(it)});
			row.addEventListener("click", () => {
				if (it.scene) {
					plugin._mapSession = {
						...(plugin._mapSession || {}),
						scenePath: it.path,
						filePath: "",
						activeLayerId: "",
					};
					onOpenMap?.();
					return;
				}
				void openPath(it.path);
			});
		}
		listEl.scrollTop = scrollTop;
		syncListSelection();
	};

	const editorHost = () => {
		clearEncounterRoster();
		resultEl.removeClass("fiveetools-campaign-encounter");
		resultEl.addClass("fiveetools-campaign-reader");
		let wrap = bodyEl.querySelector(".fiveetools-campaign__editor");
		if (!wrap) {
			bodyEl.empty();
			resultEl.addClass("fiveetools-campaign-reader");
			wrap = bodyEl.createDiv({cls: "fiveetools-campaign__editor"});
		}
		syncChrome();
		return wrap;
	};

	const paintEncounterPane = () => {
		closeCampaignNote(plugin);
		resultEl.addClass("fiveetools-campaign-reader");
		resultEl.removeClass("fiveetools-campaign-encounter");
		bodyEl.empty();
		formEl.addClass("fiveetools-campaign--encounter");
		syncChrome();
		let creaturesEl = formEl.querySelector(".fiveetools-encounter__creatures");
		if (!creaturesEl) {
			creaturesEl = formEl.createDiv({cls: "fiveetools-encounter__creatures"});
			const head = creaturesEl.createDiv({cls: "fiveetools-campaign__enchead"});
			head.createEl("h3", {text: "Creatures"});
			const mapBtn = head.createEl("button", {text: "Map", cls: "fiveetools-btn", attr: {type: "button"}});
			mapBtn.addEventListener("click", () => onOpenMap?.());
			creaturesEl.createDiv({cls: "fiveetools-encounter__roster"});
		}
		const rosterEl = creaturesEl.querySelector(".fiveetools-encounter__roster");
		let combatants = combatantsFromSnapshot(parsed.snapshot);
		let selectedId = combatants[0]?.id || null;

		const persist = async () => {
			const snapshot = {
				sourceId: parsed.snapshot?.sourceId || "",
				party: parsed.snapshot?.party || null,
				combatants: snapshotCombatants(combatants),
			};
			parsed = {...parsed, snapshot};
			const written = await writeEntry(plugin, slug, "encounters", {
				path: selectedPath,
				fields: {
					...parsed.fields,
					name: parsed.fields?.name || fileStem(selectedPath),
				},
				body: parsed.body,
				snapshot,
			});
			if (written?.path && written.path !== selectedPath) {
				selectedPath = written.path;
				emit();
			}
		};

		const openSelected = () => {
			const hit = combatants.find(it => it.id === selectedId);
			if (!hit?.doc) {
				bodyEl.empty();
				bodyEl.createEl("p", {
					cls: "fiveetools-view__meta",
					text: combatants.length ? "Select a creature." : "No creatures yet.",
				});
				return;
			}
			void renderEntityPanel(bodyEl, plugin, hit.doc);
		};

		const syncRosterSelection = () => {
			rosterEl.querySelectorAll(".fiveetools-encounter__combatant").forEach((el) => {
				el.classList.toggle("is-selected", el.dataset.id === selectedId);
			});
		};

		const paintRoster = () => {
			const scrollTop = rosterEl.scrollTop || 0;
			rosterEl.empty();
			if (!combatants.length) {
				rosterEl.createEl("p", {
					cls: "fiveetools-view__meta",
					text: "No creatures yet. Open in composer to add some.",
				});
				return;
			}
			for (const combatant of combatants) {
				renderCombatantRow(rosterEl, combatant, {
					app,
					plugin,
					selected: combatant.id === selectedId,
					onSelect: () => {
						selectedId = combatant.id;
						syncRosterSelection();
						openSelected();
					},
					onHp: (nextHp) => {
						combatant.hpCurrent = nextHp;
						paintRoster();
						void persist().catch((e) => new Notice(e.message || "Could not save HP."));
					},
					onRemove: () => {
						combatants = combatants.filter(it => it.id !== combatant.id);
						if (selectedId === combatant.id) selectedId = combatants[combatants.length - 1]?.id || null;
						paintRoster();
						openSelected();
						void persist().catch((e) => new Notice(e.message || "Could not save encounter."));
					},
				});
			}
			rosterEl.scrollTop = scrollTop;
		};

		paintRoster();
		openSelected();
	};

	const paintEditor = async () => {
		if (!slug || !selectedPath) {
			showPlaceholder();
			return;
		}
		if (sectionId === "encounters") {
			paintEncounterPane();
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
	};

	const openPath = async (filePath) => {
		selectedPath = filePath || "";
		syncListSelection();
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
	const createNewInSection = async () => {
		try {
			if (sectionId === "encounters") {
				if (!slug) throw new Error("Create a campaign first.");
				const name = String(noteNameEl.value || "").trim();
				noteNameEl.value = "";
				const next = {
					combatants: [],
					selectedId: null,
					name,
					savedId: null,
					pickedId: null,
					showBlank: false,
					blankDraft: null,
					saveToHomebrew: false,
				};
				setEncounterInstance(next);
				onOpenComposer?.(next, {slug, selectedPath: ""});
				return;
			}
			const created = await createEntry(plugin, slug, sectionId, noteNameEl.value);
			noteNameEl.value = "";
			entries = await listEntries(plugin, slug, sectionId);
			paintList();
			await openPath(created.path);
			new Notice(`Created ${entryLabel(created)}.`);
		} catch (e) {
			new Notice(e.message || "Could not create note.");
		}
	};
	newBtn.addEventListener("click", () => { void createNewInSection(); });
	addBtn.addEventListener("click", () => { void createNewInSection(); });
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
			paintList();
			await openPath(written.path);
			new Notice(`Imported ${saved.name}.`);
		} catch (e) {
			new Notice(e.message || "Could not import encounter.");
		}
	});
	openComposerBtn.addEventListener("click", async () => {
		if (!selectedPath) return;
		const text = await readEntryText(plugin, selectedPath);
		parsed = parseCampaignMarkdown(text);
		const next = sessionFromCampaignEncounter({
			fields: {name: parsed.fields?.name || fileStem(selectedPath)},
			snapshot: currentSnapshot() || {combatants: []},
		});
		setEncounterInstance(next);
		onOpenComposer?.(next, {slug, selectedPath});
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
