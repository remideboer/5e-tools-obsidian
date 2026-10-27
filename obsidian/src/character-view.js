import {MarkdownRenderer, Notice} from "obsidian";
import {characterName, deleteCharacter, listCharacters, readCharacter, saveCharacter} from "./character-store.js";
import {importDdbCharacter} from "./ddb-import.js";

export async function renderCharacterCard (host, plugin, ddbId) {
	host.empty();
	host.addClass("fiveetools-character-card");
	const record = await readCharacter(plugin, ddbId);
	if (!record) {
		host.createEl("p", {cls: "fiveetools-view__meta", text: "Character not found."});
		return null;
	}
	const body = host.createDiv({cls: "fiveetools-character-card__body"});
	const markdown = String(record.body || "").trim() || `# ${characterName(record)}`;
	await MarkdownRenderer.render(plugin.app, markdown, body, record.path, plugin);
	return record;
}

export function renderCharacterManager (formEl, resultEl, {plugin, session, onSessionChange} = {}) {
	formEl.empty();
	formEl.addClass("fiveetools-characters");
	resultEl.empty();
	resultEl.addClass("fiveetools-characters-reader");

	let selectedId = String(session?.selectedId || "");
	let characters = [];
	let busy = false;

	const catalog = formEl.createDiv({cls: "fiveetools-characters__catalog"});
	catalog.createEl("h3", {text: "Characters"});
	catalog.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Paste a public D&D Beyond character URL or id.",
	});
	const importRow = catalog.createDiv({cls: "fiveetools-homebrew__row"});
	const importInput = importRow.createEl("input", {
		cls: "fiveetools-campaign__select",
		attr: {type: "text", placeholder: "https://www.dndbeyond.com/characters/12345678"},
	});
	const importBtn = importRow.createEl("button", {text: "Import", cls: "fiveetools-btn"});
	const listEl = catalog.createDiv({cls: "fiveetools-homebrew__list"});

	const actions = resultEl.createDiv({cls: "fiveetools-characters__actions"});
	const refreshBtn = actions.createEl("button", {text: "Refresh", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const deleteBtn = actions.createEl("button", {text: "Delete", cls: "fiveetools-btn fiveetools-btn--ghost"});
	const cardEl = resultEl.createDiv({cls: "fiveetools-characters__card"});

	const emit = () => onSessionChange?.({selectedId});

	const syncSelection = () => {
		listEl.querySelectorAll(".fiveetools-homebrew__hit").forEach((el) => {
			el.classList.toggle("is-selected", el.dataset.id === selectedId);
		});
		const has = characters.some(it => characterId(it) === selectedId);
		refreshBtn.disabled = busy || !has;
		deleteBtn.disabled = busy || !has;
	};

	const paintList = () => {
		const scrollTop = listEl.scrollTop || 0;
		listEl.empty();
		if (!characters.length) {
			listEl.createEl("div", {cls: "fiveetools-modal__empty", text: "No characters yet."});
			syncSelection();
			return;
		}
		for (const it of characters) {
			const id = characterId(it);
			const row = listEl.createEl("button", {
				cls: `fiveetools-homebrew__hit${id === selectedId ? " is-selected" : ""}`,
				attr: {"data-id": id, type: "button"},
			});
			row.createEl("div", {cls: "fiveetools-modal__name", text: characterName(it)});
			const meta = [it.fields?.classes, it.fields?.level != null && it.fields.level !== "" ? `Level ${it.fields.level}` : ""]
				.filter(Boolean)
				.join(" · ");
			if (meta) row.createEl("div", {cls: "fiveetools-view__meta", text: meta});
			row.addEventListener("click", () => {
				if (selectedId === id) return;
				selectedId = id;
				syncSelection();
				emit();
				void paintCard();
			});
		}
		listEl.scrollTop = scrollTop;
		syncSelection();
	};

	const paintCard = async () => {
		cardEl.empty();
		if (!selectedId) {
			cardEl.createEl("p", {cls: "fiveetools-view__meta", text: "Import a character to view it."});
			syncSelection();
			return;
		}
		await renderCharacterCard(cardEl, plugin, selectedId);
		syncSelection();
	};

	const reload = async () => {
		characters = await listCharacters(plugin);
		if (selectedId && !characters.some(it => characterId(it) === selectedId)) selectedId = "";
		if (!selectedId && characters[0]) selectedId = characterId(characters[0]);
		paintList();
		await paintCard();
		emit();
	};

	const runImport = async (idOrUrl) => {
		if (busy) return;
		busy = true;
		importBtn.disabled = true;
		syncSelection();
		try {
			const card = await importDdbCharacter(plugin, idOrUrl);
			const saved = await saveCharacter(plugin, card);
			importInput.value = "";
			selectedId = characterId(saved) || card.ddbId;
			await reload();
			new Notice(`Imported ${card.name}.`);
		} catch (e) {
			new Notice(e.message || "Could not import that character.");
		} finally {
			busy = false;
			importBtn.disabled = false;
			syncSelection();
		}
	};

	importBtn.addEventListener("click", () => { void runImport(importInput.value); });
	importInput.addEventListener("keydown", (evt) => {
		if (evt.key === "Enter") {
			evt.preventDefault();
			void runImport(importInput.value);
		}
	});
	refreshBtn.addEventListener("click", () => {
		if (!selectedId) return;
		void runImport(selectedId);
	});
	deleteBtn.addEventListener("click", async () => {
		if (!selectedId || busy) return;
		const label = characterName(characters.find(it => characterId(it) === selectedId));
		if (typeof window !== "undefined" && !window.confirm(`Delete ${label}?`)) return;
		try {
			await deleteCharacter(plugin, selectedId);
			selectedId = "";
			await reload();
		} catch (e) {
			new Notice(e.message || "Could not delete that character.");
		}
	});

	void reload().catch((e) => {
		new Notice(e.message || "Could not load characters.");
		paintList();
	});
}

function characterId (record) {
	return String(record?.fields?.ddb_id || "").trim();
}
