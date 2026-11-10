import {Notice} from "obsidian";
import {closeEmbeddedNote} from "./campaign-editor.js";
import {createSearchInput} from "./search-field.js";
import {
	createQuickNote,
	deleteQuickNote,
	listQuickNotes,
	openQuickNote,
	quickNotesFolder,
	renameQuickNote,
	syncQuickNoteTitleFromFile,
} from "./quick-note-store.js";

const TITLE_SYNC_MS = 400;

export function teardownNotesManager (plugin) {
	plugin?._notesVaultOff?.();
	if (plugin) plugin._notesVaultOff = null;
	closeEmbeddedNote(plugin);
}

export function renderNotesManager (formEl, resultEl, {plugin, session, onSessionChange} = {}) {
	formEl.empty();
	formEl.addClass("fiveetools-notes");
	resultEl.empty();
	resultEl.addClass("fiveetools-campaign-reader");
	resultEl.removeClass("fiveetools-campaign-encounter");

	let selectedPath = String(session?.selectedPath || "");
	let filter = String(session?.filter || "");
	let notes = [];
	let cancelled = false;
	let syncing = false;
	let titleSyncTimer = null;
	let lastCollisionNotice = "";

	const emit = () => onSessionChange?.({selectedPath, filter});
	const selectedTitle = () => notes.find((it) => it.path === selectedPath)?.title || "";
	const isCollision = (e) => e?.code === "NAME_COLLISION";

	const catalog = formEl.createDiv({cls: "fiveetools-notes__catalog"});
	const filterEl = createSearchInput(catalog, {
		cls: "fiveetools-notes__filter",
		placeholder: "Filter…",
	});
	filterEl.value = filter;
	const actions = catalog.createDiv({cls: "fiveetools-notes__actions"});
	const newBtn = actions.createEl("button", {
		text: "New",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	const editBtn = actions.createEl("button", {
		text: "Edit",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	const deleteBtn = actions.createEl("button", {
		text: "Delete",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	const listEl = catalog.createDiv({cls: "fiveetools-notes__list"});

	const syncChrome = () => {
		const has = !!selectedPath && notes.some((it) => it.path === selectedPath);
		editBtn.disabled = !has;
		deleteBtn.disabled = !has;
		listEl.querySelectorAll(".fiveetools-library__row").forEach((el) => {
			el.classList.toggle("is-selected", el.dataset.path === selectedPath);
		});
	};

	const openSelected = async () => {
		if (!selectedPath) {
			closeEmbeddedNote(plugin);
			resultEl.empty();
			resultEl.addClass("fiveetools-campaign-reader");
			resultEl.createEl("p", {cls: "fiveetools-view__meta", text: "Select a note or press + to create one."});
			syncChrome();
			return;
		}
		try {
			await openQuickNote(plugin, selectedPath, resultEl);
		} catch (e) {
			resultEl.empty();
			resultEl.createEl("p", {cls: "fiveetools-view__meta", text: e?.message || "Could not open that note."});
		}
		syncChrome();
	};

	const bindRow = (row, note) => {
		row.addEventListener("click", () => {
			if (selectedPath === note.path) return;
			selectedPath = note.path;
			lastCollisionNotice = "";
			syncChrome();
			emit();
			void openSelected();
		});
	};

	const paintList = () => {
		const scrollTop = listEl.scrollTop || 0;
		listEl.empty();
		const needle = String(filter || "").trim().toLowerCase();
		const shown = notes.filter((it) => !needle || it.title.toLowerCase().includes(needle));
		if (!shown.length) {
			listEl.createEl("div", {
				cls: "fiveetools-modal__empty",
				text: notes.length ? "No matching notes." : "No notes yet. Press + to create one.",
			});
			syncChrome();
			listEl.scrollTop = scrollTop;
			return;
		}
		for (const note of shown) {
			const row = listEl.createEl("button", {
				cls: `fiveetools-library__row fiveetools-library__row--note${note.path === selectedPath ? " is-selected" : ""}`,
				attr: {type: "button", "data-path": note.path, title: note.title},
			});
			const top = row.createDiv({cls: "fiveetools-library__row-top"});
			top.createEl("div", {cls: "fiveetools-library__row-name", text: note.title});
			bindRow(row, note);
		}
		listEl.scrollTop = scrollTop;
		syncChrome();
	};

	/** Patch existing rows when only titles/paths changed; rebuild if membership/order differs. */
	const refreshListFromNotes = (nextNotes) => {
		const prev = notes;
		notes = nextNotes;
		if (selectedPath && !notes.some((it) => it.path === selectedPath)) {
			selectedPath = "";
			emit();
		}
		const needle = String(filter || "").trim().toLowerCase();
		const shown = notes.filter((it) => !needle || it.title.toLowerCase().includes(needle));
		const rows = [...listEl.querySelectorAll(".fiveetools-library__row[data-path]")];
		const sameMembership = prev.length === notes.length
			&& prev.every((it) => notes.some((n) => n.path === it.path))
			&& notes.every((it) => prev.some((n) => n.path === it.path));
		const sameShownOrder = sameMembership
			&& rows.length === shown.length
			&& shown.every((it, i) => rows[i]?.dataset.path === it.path || rows.some((r) => r.dataset.path === it.path));

		if (!sameMembership || rows.length !== shown.length || listEl.querySelector(".fiveetools-modal__empty")) {
			paintList();
			return;
		}

		if (sameShownOrder && shown.every((it, i) => rows[i]?.dataset.path === it.path)) {
			for (let i = 0; i < shown.length; i++) {
				const row = rows[i];
				const note = shown[i];
				row.dataset.path = note.path;
				row.setAttribute("title", note.title);
				const nameEl = row.querySelector(".fiveetools-library__row-name");
				if (nameEl) nameEl.setText(note.title);
			}
			syncChrome();
			return;
		}

		// Path changed (rename): patch by matching old selection / rebuild safely
		paintList();
	};

	const reload = async ({reopen = true} = {}) => {
		const next = await listQuickNotes(plugin, "", {limit: 0});
		if (cancelled) return;
		refreshListFromNotes(next);
		if (reopen) await openSelected();
		else syncChrome();
	};

	const underNotesFolder = (path) => {
		const folder = quickNotesFolder(plugin);
		const p = String(path || "").replace(/\\/g, "/");
		return p === folder || p.startsWith(`${folder}/`);
	};

	const runTitleSync = async (path) => {
		if (cancelled || syncing || !path || path !== selectedPath) return;
		syncing = true;
		try {
			const before = path;
			const file = await syncQuickNoteTitleFromFile(plugin, path);
			if (cancelled) return;
			lastCollisionNotice = "";
			if (file.path !== before) {
				selectedPath = file.path;
				emit();
				const next = await listQuickNotes(plugin, "", {limit: 0});
				if (cancelled) return;
				refreshListFromNotes(next);
				const embedFile = plugin._embeddedNote?.file?.path || plugin._campaignEmbed?.file?.path;
				if (embedFile !== selectedPath) await openSelected();
			} else {
				const next = await listQuickNotes(plugin, "", {limit: 0});
				if (cancelled) return;
				refreshListFromNotes(next);
			}
		} catch (e) {
			if (isCollision(e)) {
				if (lastCollisionNotice !== e.message) {
					lastCollisionNotice = e.message;
					new Notice(e.message);
				}
			} else {
				console.error(e);
			}
		} finally {
			syncing = false;
		}
	};

	const scheduleTitleSync = (path) => {
		if (titleSyncTimer) clearTimeout(titleSyncTimer);
		titleSyncTimer = setTimeout(() => {
			titleSyncTimer = null;
			void runTitleSync(path);
		}, TITLE_SYNC_MS);
	};

	const onVaultCreate = (file) => {
		if (syncing || !underNotesFolder(file?.path) || file?.children) return;
		void reload({reopen: false});
	};
	const onVaultModify = (file) => {
		if (syncing || cancelled || !underNotesFolder(file?.path) || file?.children) return;
		if (file.path === selectedPath) scheduleTitleSync(file.path);
		else void listQuickNotes(plugin, "", {limit: 0}).then((next) => {
			if (cancelled || syncing) return;
			refreshListFromNotes(next);
		});
	};
	const onVaultRename = (file, oldPath) => {
		if (syncing) {
			if (selectedPath === oldPath) {
				selectedPath = file?.path || "";
				emit();
			}
			return;
		}
		if (selectedPath === oldPath) {
			selectedPath = file?.path || "";
			emit();
		}
		if (underNotesFolder(file?.path) || underNotesFolder(oldPath)) void reload({reopen: false});
	};
	const onVaultDelete = (file) => {
		if (syncing || !underNotesFolder(file?.path)) return;
		if (selectedPath === file.path) {
			selectedPath = "";
			emit();
		}
		void reload({reopen: false});
	};

	plugin._notesVaultOff?.();
	const app = plugin?.app;
	const createRef = app?.vault?.on?.("create", onVaultCreate);
	const modifyRef = app?.vault?.on?.("modify", onVaultModify);
	const renameRef = app?.vault?.on?.("rename", onVaultRename);
	const deleteRef = app?.vault?.on?.("delete", onVaultDelete);
	plugin._notesVaultOff = () => {
		cancelled = true;
		if (titleSyncTimer) clearTimeout(titleSyncTimer);
		titleSyncTimer = null;
		app?.vault?.offref?.(createRef);
		app?.vault?.offref?.(modifyRef);
		app?.vault?.offref?.(renameRef);
		app?.vault?.offref?.(deleteRef);
	};

	filterEl.addEventListener("input", () => {
		filter = filterEl.value;
		emit();
		paintList();
	});

	newBtn.addEventListener("click", async () => {
		try {
			syncing = true;
			const file = await createQuickNote(plugin);
			selectedPath = file.path;
			emit();
			lastCollisionNotice = "";
			syncing = false;
			await reload();
		} catch (e) {
			syncing = false;
			new Notice(e?.message || "Could not create that note.");
			console.error(e);
		}
	});

	editBtn.addEventListener("click", async () => {
		if (!selectedPath) return;
		let attempt = selectedTitle();
		while (!cancelled) {
			const next = typeof window !== "undefined"
				? window.prompt("Note title", attempt)
				: attempt;
			if (next == null) return;
			const title = String(next).trim();
			if (!title) {
				new Notice("Enter a title.");
				attempt = "";
				continue;
			}
			try {
				syncing = true;
				closeEmbeddedNote(plugin);
				const file = await renameQuickNote(plugin, selectedPath, title);
				selectedPath = file.path;
				emit();
				lastCollisionNotice = "";
				syncing = false;
				await reload();
				return;
			} catch (e) {
				syncing = false;
				if (isCollision(e)) {
					new Notice(e.message);
					attempt = title;
					continue;
				}
				new Notice(e?.message || "Could not rename that note.");
				console.error(e);
				await openSelected();
				return;
			}
		}
	});

	deleteBtn.addEventListener("click", async () => {
		if (!selectedPath) return;
		const label = selectedTitle() || "this note";
		if (typeof window !== "undefined" && !window.confirm(`Delete ${label}?`)) return;
		try {
			syncing = true;
			closeEmbeddedNote(plugin);
			await deleteQuickNote(plugin, selectedPath);
			selectedPath = "";
			emit();
			syncing = false;
			await reload();
		} catch (e) {
			syncing = false;
			new Notice(e?.message || "Could not delete that note.");
			console.error(e);
		}
	});

	void reload();
}
