import {Notice} from "obsidian";
import {loadEntity} from "./entity-loader.js";
import {escapeHtml, isCorpusPage, loadPageForDoc, renderCompactHtml, siteUrlForDoc} from "./compact-render.js";
import {resolveEntityImages, toPreviewSrc} from "./image-resolver.js";
import {cachedMediaSrc, rewriteMediaUrls} from "./media-cache.js";
import {insertEntityNote} from "./note-writer.js";
import {printEntityCard} from "./print-card.js";
import {parseAdventureHref, renderAdventurePanel} from "./adventure-reader.js";
import {docFromHref, docFromVetLink, indexHomebrewDocs} from "./search-index.js";
import {bindDiceRollers} from "./dice-roll.js";
import {appendCreatureStatFooter} from "./creature-stat-footer.js";
import {attachHoverCard} from "./hover-card.js";
import {addCombatants} from "./encounter-view.js";
import {emptyInstance, getEncounterInstance, queueSaveEncountersToVault, setEncounterInstance} from "./encounter-store.js";
import {adjustMultiattack, CR_STEPS, crLabel, crNumber, homebrewName} from "./creature-scale.js";
import {cacheBrewInDataLoader, saveHomebrewToVault, upsertEntity} from "./homebrew-store.js";

export async function renderEntityPanel (containerEl, plugin, doc, opts = {}) {
	containerEl.empty();
	containerEl.addClass("fiveetools-view");

	if (!doc) {
		containerEl.createEl("p", {text: "Select an entry from the list."});
		return;
	}

	const header = containerEl.createDiv({cls: "fiveetools-view__header"});
	header.createEl("h2", {text: doc.n || "Unknown"});
	header.createEl("div", {
		cls: "fiveetools-view__meta",
		text: [doc.cf, doc.sA || doc.s].filter(Boolean).join(" · "),
	});

	const actions = header.createDiv({cls: "fiveetools-view__actions"});
	const insertBtn = actions.createEl("button", {text: "Insert note", cls: "fiveetools-btn"});
	const printBtn = actions.createEl("button", {text: "Print card", cls: "fiveetools-btn fiveetools-btn--ghost"});
	printBtn.setAttr("disabled", "true");
	const openBtn = actions.createEl("button", {text: "Open on 5e.tools", cls: "fiveetools-btn fiveetools-btn--ghost"});
	openBtn.addEventListener("click", () => {
		window.open(siteUrlForDoc(doc, plugin.settings.imageBaseUrl), "_blank", "noopener");
	});
	const addEncounterBtn = isCreatureDoc(doc)
		? actions.createEl("button", {text: "Add to encounter", cls: "fiveetools-btn fiveetools-btn--ghost"})
		: null;
	if (addEncounterBtn) addEncounterBtn.setAttr("disabled", "true");

	const crRow = actions.createDiv({cls: "fiveetools-view__cr is-hidden"});
	crRow.createEl("span", {cls: "fiveetools-view__cr-label", text: "CR"});
	const crSlider = crRow.createEl("input", {
		cls: "fiveetools-view__cr-slider",
		attr: {type: "range", min: "0", max: String(CR_STEPS.length - 1), step: "1"},
	});
	const crValue = crRow.createEl("span", {cls: "fiveetools-view__cr-value", text: "—"});
	const saveBrewBtn = crRow.createEl("button", {
		text: "Save homebrew",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Save this CR as a new homebrew creature"},
	});
	saveBrewBtn.setAttr("disabled", "true");

	const body = containerEl.createDiv({cls: "fiveetools-view__body"});
	body.setText("Loading…");

	try {
		const loaded = await loadEntity(doc);
		const page = loadPageForDoc(doc);
		body.empty();

		if (loaded.warning) {
			body.createEl("p", {cls: "fiveetools-view__warning", text: loaded.warning});
		}

		if (loaded.ent) {
			if (loaded.ent.__prop === "adventure") {
				crRow.remove();
				insertBtn.addEventListener("click", async () => {
					insertBtn.setAttr("disabled", "true");
					try {
						await insertEntityNote(plugin, {doc, ent: loaded.ent});
					} finally {
						insertBtn.removeAttribute("disabled");
					}
				});
				await renderAdventurePanel(body, plugin, loaded.ent, {bindInternalLinks});
				bindDiceRollers(body, plugin);
				return;
			}

			const images = await resolveEntityImages(loaded.ent, {
				imageBaseUrl: plugin.settings.imageBaseUrl,
			});
			if (images.length) {
				const imgWrap = body.createDiv({cls: "fiveetools-view__images"});
				const preview = images.slice(0, 2);
				const srcs = await Promise.all(preview.map(image => cachedMediaSrc(plugin, toPreviewSrc(image))));
				preview.forEach((image, i) => {
					const src = srcs[i];
					if (!src) return;
					imgWrap.createEl("img", {attr: {src, alt: loaded.ent.name || doc.n || ""}});
				});
			}

			let compactHtml = "";
			if (!isCorpusPage(page)) {
				compactHtml = renderCompactHtml(loaded.ent, page);
				const statWrap = body.createDiv({cls: "fiveetools-view__stats"});
				statWrap.innerHTML = compactHtml;
				if (isCreatureEntity(loaded.ent, doc)) {
					appendCreatureStatFooter(statWrap, loaded.ent, plugin);
					compactHtml = statWrap.innerHTML;
				}
				bindInternalLinks(statWrap, plugin);
				bindDiceRollers(statWrap, plugin);
				await rewriteMediaUrls(plugin, statWrap);
				wireCrSlider({
					plugin,
					doc,
					page,
					ent: loaded.ent,
					statWrap,
					crRow,
					crSlider,
					crValue,
					saveBrewBtn,
					setPrintHtml: (html) => { compactHtml = html; },
				});
			} else {
				crRow.remove();
			}

			insertBtn.addEventListener("click", async () => {
				insertBtn.setAttr("disabled", "true");
				try {
					await insertEntityNote(plugin, {doc, ent: loaded.ent});
				} finally {
					insertBtn.removeAttribute("disabled");
				}
			});
			printBtn.removeAttribute("disabled");
			printBtn.addEventListener("click", async () => {
				printEntityCard({
					html: compactHtml || `<p><strong>${escapeHtml(loaded.ent.name || doc.n || "")}</strong></p>`,
					imageSrc: images[0] ? await cachedMediaSrc(plugin, toPreviewSrc(images[0])) : "",
				});
			});
			if (addEncounterBtn && isCreatureEntity(loaded.ent, doc)) {
				addEncounterBtn.removeAttribute("disabled");
				addEncounterBtn.addEventListener("click", async () => {
					addEncounterBtn.setAttr("disabled", "true");
					try {
						const next = await addCreatureToEncounter(plugin, doc);
						new Notice(`Added ${doc.n || loaded.ent.name || "creature"} to encounter.`);
						opts.onAddedToEncounter?.(next);
					} catch (e) {
						new Notice(e.message || "Could not add to encounter.");
					} finally {
						addEncounterBtn.removeAttribute("disabled");
					}
				});
			} else if (addEncounterBtn) {
				addEncounterBtn.remove();
			}
		} else {
			crRow.remove();
			insertBtn.setAttr("disabled", "true");
			addEncounterBtn?.remove();
			body.createEl("p", {text: `No JSON found for ${doc.n}.`});
		}
	} catch (e) {
		crRow.remove();
		insertBtn.setAttr("disabled", "true");
		addEncounterBtn?.remove();
		body.empty();
		body.createEl("p", {text: `Failed to load: ${e.message}`});
	}
}

function isCreatureDoc (doc) {
	if (!doc) return false;
	if (Number(doc.c) === 1) return true;
	return String(doc.cf || "").toLowerCase() === "bestiary";
}

function isCreatureEntity (ent, doc) {
	if (ent?.__prop === "monster") return true;
	return isCreatureDoc(doc);
}

let scaleCreaturePromise = null;

function loadScaleCreature () {
	if (!scaleCreaturePromise) {
		scaleCreaturePromise = import("../../js/scalecreature/scalecreature-scaler-cr.js")
			.then(mod => mod.ScaleCreature)
			.catch(err => {
				scaleCreaturePromise = null;
				throw err;
			});
	}
	return scaleCreaturePromise;
}

async function scaledCopy (original, targetNumber) {
	const copy = JSON.parse(JSON.stringify(original));
	if (crNumber(copy.cr) === targetNumber) return copy;
	adjustMultiattack(copy, targetNumber);
	const ScaleCreature = await loadScaleCreature();
	return ScaleCreature.scale(copy, targetNumber);
}

async function paintScaledStat (statWrap, ent, page, plugin, doc) {
	statWrap.innerHTML = renderCompactHtml(ent, page);
	if (isCreatureEntity(ent, doc)) appendCreatureStatFooter(statWrap, ent, plugin);
	bindInternalLinks(statWrap, plugin);
	bindDiceRollers(statWrap, plugin);
	await rewriteMediaUrls(plugin, statWrap);
}

function wireCrSlider ({plugin, doc, page, ent, statWrap, crRow, crSlider, crValue, saveBrewBtn, setPrintHtml}) {
	const label = crLabel(ent?.cr);
	const startIndex = CR_STEPS.indexOf(label);
	if (!isCreatureEntity(ent, doc) || startIndex < 0 || crNumber(label) == null) {
		crRow.remove();
		return;
	}
	crRow.removeClass("is-hidden");
	crSlider.value = String(startIndex);
	crValue.setText(label);

	const original = JSON.parse(JSON.stringify(ent));
	let shown = original;
	let appliedIndex = startIndex;
	let timer = 0;
	let token = 0;

	const applyIndex = async (index) => {
		const nextLabel = CR_STEPS[index];
		const myToken = ++token;
		try {
			const next = await scaledCopy(original, crNumber(nextLabel));
			if (myToken !== token) return;
			shown = next;
			appliedIndex = index;
			await paintScaledStat(statWrap, next, page, plugin, doc);
			if (myToken !== token) return;
			setPrintHtml(statWrap.innerHTML);
			crValue.setText(nextLabel);
			if (index === startIndex) saveBrewBtn.setAttr("disabled", "true");
			else saveBrewBtn.removeAttribute("disabled");
		} catch (e) {
			if (myToken !== token) return;
			new Notice(e.message || "Could not scale this creature.");
			crSlider.value = String(appliedIndex);
			crValue.setText(CR_STEPS[appliedIndex]);
			if (appliedIndex === startIndex) saveBrewBtn.setAttr("disabled", "true");
			else saveBrewBtn.removeAttribute("disabled");
		}
	};

	crSlider.addEventListener("input", () => {
		window.clearTimeout(timer);
		const index = Number(crSlider.value);
		crValue.setText(CR_STEPS[index] || "—");
		saveBrewBtn.setAttr("disabled", "true");
		timer = window.setTimeout(() => { void applyIndex(index); }, 200);
	});

	saveBrewBtn.addEventListener("click", async () => {
		saveBrewBtn.setAttr("disabled", "true");
		try {
			const nextLabel = CR_STEPS[appliedIndex];
			const saved = JSON.parse(JSON.stringify(shown));
			saved.name = homebrewName(original.name || doc.n, nextLabel);
			saved.source = "HB";
			saved.__prop = "monster";
			delete saved._displayName;
			delete saved._scaledCr;
			delete saved._isScaledCr;
			delete saved._originalCr;
			upsertEntity("monster", saved);
			await saveHomebrewToVault(plugin);
			cacheBrewInDataLoader();
			indexHomebrewDocs();
			new Notice(`Saved ${saved.name}.`);
		} catch (e) {
			new Notice(e.message || "Could not save homebrew.");
		} finally {
			if (appliedIndex !== startIndex) saveBrewBtn.removeAttribute("disabled");
		}
	});
}

function encounterSessionForAdd (plugin) {
	const session = plugin._encounterSession || getEncounterInstance() || emptyInstance();
	const hasRoster = !!(session.combatants || []).length;
	const hasIdentity = !!(session.savedId || String(session.name || "").trim());
	if (!hasRoster && !hasIdentity) return {...emptyInstance(), party: session.party || emptyInstance().party};
	return {
		...emptyInstance(),
		...session,
		combatants: [...(session.combatants || [])],
		party: session.party || emptyInstance().party,
	};
}

async function addCreatureToEncounter (plugin, doc) {
	const session = encounterSessionForAdd(plugin);
	const added = await addCombatants(session, doc, 1);
	const next = {
		...session,
		combatants: added.combatants,
		selectedId: added.selectedId,
	};
	plugin._encounterSession = next;
	setEncounterInstance(next);
	queueSaveEncountersToVault(plugin);
	return next;
}

export function bindInternalLinks (el, plugin) {
	el.addEventListener("click", (evt) => {
		const a = evt.target.closest?.("a, [data-vet-page]");
		if (!a || !el.contains(a)) return;
		const href = a.getAttribute("href") || "";
		const linkText = (a.textContent || "").trim();
		if (/^https?:\/\//i.test(href) && !/adventure\.html/i.test(href) && !a.hasAttribute("data-vet-page")) return;
		const loc = parseAdventureHref(href);
		if (loc) {
			const next = docFromHref(`adventure.html#${loc.id}`, {linkText});
			if (!next) return;
			evt.preventDefault();
			evt.stopPropagation();
			plugin._adventureJump = loc;
			plugin.openLibrary({doc: next});
			return;
		}
		const next = docFromVetLink({
			page: a.getAttribute("data-vet-page"),
			source: a.getAttribute("data-vet-source"),
			hash: a.getAttribute("data-vet-hash"),
			linkText,
		})
			|| (!/^https?:\/\//i.test(href) ? docFromHref(href, {linkText}) : null);
		if (!next) return;
		evt.preventDefault();
		evt.stopPropagation();
		plugin.openLibrary({doc: next});
	}, true);
	el.addEventListener("mouseover", (evt) => {
		const a = evt.target.closest?.("a, [data-vet-page]");
		if (!a || !el.contains(a)) return;
		const doc = docFromAnchor(a);
		if (!doc) return;
		attachHoverCard(a, plugin, () => docFromAnchor(a), evt);
	});
}

function docFromAnchor (a) {
	const href = a.getAttribute("href") || "";
	const linkText = (a.textContent || "").trim();
	if (/^https?:\/\//i.test(href) && !a.hasAttribute("data-vet-page")) return null;
	return docFromVetLink({
		page: a.getAttribute("data-vet-page"),
		source: a.getAttribute("data-vet-source"),
		hash: a.getAttribute("data-vet-hash"),
		linkText,
	}) || (!/^https?:\/\//i.test(href) ? docFromHref(href, {linkText}) : null);
}
