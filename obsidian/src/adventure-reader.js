import {htmlToMarkdown} from "./compact-render.js";
import {getRenderer} from "./fiveetools-host.js";

export function getAdventureChapters (ent) {
	const data = ent?.adventureData?.data;
	if (!Array.isArray(data)) return [];
	return data.map((section, ix) => ({
		ix,
		name: section?.name || ent.adventure?.contents?.[ix]?.name || `Chapter ${ix + 1}`,
		section,
	}));
}

export function coverUrlForAdventure (adventure, imageBaseUrl) {
	const rel = adventure?.cover?.path;
	if (!rel) return "";
	const base = String(imageBaseUrl || "https://5e.tools").replace(/\/+$/, "");
	return `${base}/img/${String(rel).replace(/^\/+/, "")}`;
}

export function renderAdventureChapterHtml (section) {
	if (!section) return "";
	const Renderer = getRenderer().get();
	Renderer.setFirstSection(true);
	return Renderer.render(section) || "";
}

export function renderAdventureChapterMarkdown (section) {
	if (!section) return "";
	const RendererMarkdown = globalThis.RendererMarkdown;
	try {
		if (RendererMarkdown?.generic?.getCompactRenderedString) {
			const md = String(RendererMarkdown.generic.getCompactRenderedString(section, {meta: {depth: 1}}) || "");
			if (md.trim()) return md.trim();
		}
	} catch (_) { /* fall through */ }
	return htmlToMarkdown(renderAdventureChapterHtml(section));
}

export function renderAdventurePanel (bodyEl, plugin, ent, {bindInternalLinks} = {}) {
	const adv = ent.adventure || {};
	const chapters = getAdventureChapters(ent);
	const meta = [
		adv.author,
		adv.storyline,
		adv.level ? `Levels ${adv.level.start ?? "?"}${adv.level.end != null ? `–${adv.level.end}` : ""}` : "",
	].filter(Boolean);
	if (meta.length) {
		bodyEl.createEl("p", {cls: "fiveetools-view__meta", text: meta.join(" · ")});
	}

	const coverSrc = coverUrlForAdventure(adv, plugin.settings.imageBaseUrl);
	if (coverSrc) {
		const imgWrap = bodyEl.createDiv({cls: "fiveetools-view__images"});
		imgWrap.createEl("img", {attr: {src: coverSrc, alt: adv.name || "Cover"}});
	}

	if (!chapters.length) {
		bodyEl.createEl("p", {text: "No chapters found for this adventure."});
		return;
	}

	const toc = bodyEl.createDiv({cls: "fiveetools-adventure__toc"});
	const chapterBody = bodyEl.createDiv({cls: "fiveetools-adventure__chapter"});
	let selected = 0;

	const showChapter = (ix) => {
		selected = ix;
		toc.querySelectorAll(".fiveetools-adventure__chapbtn").forEach((btn, i) => {
			btn.classList.toggle("is-active", i === ix);
		});
		const chapter = chapters[ix];
		chapterBody.empty();
		chapterBody.createEl("h3", {text: chapter.name});
		const prose = chapterBody.createDiv({cls: "fiveetools-adventure__prose"});
		prose.innerHTML = renderAdventureChapterHtml(chapter.section);
		if (bindInternalLinks) bindInternalLinks(prose, plugin);
	};

	for (const chapter of chapters) {
		const btn = toc.createEl("button", {
			cls: "fiveetools-adventure__chapbtn",
			text: chapter.name,
		});
		btn.addEventListener("click", () => showChapter(chapter.ix));
	}

	showChapter(0);
}
