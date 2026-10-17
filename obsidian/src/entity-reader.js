import {loadEntity} from "./entity-loader.js";
import {escapeHtml, isCorpusPage, loadPageForDoc, renderCompactHtml, siteUrlForDoc} from "./compact-render.js";
import {resolveEntityImages, toPreviewSrc} from "./image-resolver.js";
import {insertEntityNote} from "./note-writer.js";
import {printEntityCard} from "./print-card.js";
import {docFromHref} from "./search-index.js";

export async function renderEntityPanel (containerEl, plugin, doc) {
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
			const images = await resolveEntityImages(loaded.ent, {
				imageBaseUrl: plugin.settings.imageBaseUrl,
			});
			if (images.length) {
				const imgWrap = body.createDiv({cls: "fiveetools-view__images"});
				for (const image of images.slice(0, 2)) {
					const src = toPreviewSrc(image);
					if (!src) continue;
					imgWrap.createEl("img", {attr: {src, alt: loaded.ent.name || doc.n || ""}});
				}
			}

			let compactHtml = "";
			if (!isCorpusPage(page)) {
				compactHtml = renderCompactHtml(loaded.ent, page);
				const statWrap = body.createDiv({cls: "fiveetools-view__stats"});
				statWrap.innerHTML = compactHtml;
				bindInternalLinks(statWrap, plugin);
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
			printBtn.addEventListener("click", () => {
				printEntityCard({
					html: compactHtml || `<p><strong>${escapeHtml(loaded.ent.name || doc.n || "")}</strong></p>`,
					imageSrc: images[0] ? toPreviewSrc(images[0]) : "",
				});
			});
		} else {
			insertBtn.setAttr("disabled", "true");
			body.createEl("p", {text: `No JSON found for ${doc.n}.`});
		}
	} catch (e) {
		insertBtn.setAttr("disabled", "true");
		body.empty();
		body.createEl("p", {text: `Failed to load: ${e.message}`});
	}
}

function bindInternalLinks (el, plugin) {
	el.addEventListener("click", (evt) => {
		const a = evt.target.closest?.("a");
		if (!a || !el.contains(a)) return;
		const href = a.getAttribute("href") || "";
		if (/^https?:\/\//i.test(href)) return;
		const next = docFromHref(href, {linkText: (a.textContent || "").trim()});
		if (!next) return;
		evt.preventDefault();
		evt.stopPropagation();
		plugin.openLibrary({doc: next});
	});
}
