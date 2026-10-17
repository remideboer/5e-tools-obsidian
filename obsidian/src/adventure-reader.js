import {htmlToMarkdown} from "./compact-render.js";
import {getRenderer} from "./fiveetools-host.js";
import {cachedMediaSrc, rewriteMediaUrls} from "./media-cache.js";
import {docFromHref} from "./search-index.js";

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
	Renderer.setTrackTitles(true);
	Renderer.setRenderHeaderIndex(true);
	Renderer.resetHeaderIndex();
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

export async function renderAdventurePanel (bodyEl, plugin, ent, {bindInternalLinks} = {}) {
	const adv = ent.adventure || {};
	const chapters = getAdventureChapters(ent);
	syncBookUtilRender(ent, 0);

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
		const coverImg = imgWrap.createEl("img", {attr: {alt: adv.name || "Cover"}});
		void cachedMediaSrc(plugin, coverSrc).then(src => {
			if (src) coverImg.setAttr("src", src);
		});
	}

	if (!chapters.length) {
		bodyEl.createEl("p", {text: "No chapters found for this adventure."});
		return;
	}

	const toc = bodyEl.createDiv({cls: "fiveetools-adventure__toc"});
	const chapterBody = bodyEl.createDiv({cls: "fiveetools-adventure__chapter"});
	let selected = 0;
	const currentId = String(adv.id || "").toLowerCase();

	let chapterGen = 0;
	const showChapter = async (ix, header, headerNumber) => {
		const myGen = ++chapterGen;
		const nextIx = Math.max(0, Math.min(chapters.length - 1, Number(ix) || 0));
		selected = nextIx;
		syncBookUtilRender(ent, nextIx);
		toc.querySelectorAll(".fiveetools-adventure__chapbtn").forEach((btn, i) => {
			btn.classList.toggle("is-active", i === nextIx);
		});
		const chapter = chapters[nextIx];
		chapterBody.empty();
		chapterBody.createEl("h3", {text: chapter.name});
		const prose = chapterBody.createDiv({cls: "fiveetools-adventure__prose"});
		prose.innerHTML = renderAdventureChapterHtml(chapter.section);
		await rewriteMediaUrls(plugin, prose);
		if (myGen !== chapterGen) return;
		if (header) scrollToHeader(prose, header, headerNumber);
	};

	bodyEl.addEventListener("click", (evt) => {
		const a = evt.target.closest?.("a");
		if (!a || !bodyEl.contains(a)) return;
		const href = a.getAttribute("href") || "";
		const loc = parseAdventureHref(href);
		if (loc) {
			evt.preventDefault();
			evt.stopPropagation();
			if (loc.id && loc.id !== currentId) {
				const next = docFromHref(`adventure.html#${loc.id}`, {linkText: (a.textContent || "").trim()});
				if (next) {
					plugin._adventureJump = loc;
					plugin.openLibrary({doc: next});
				}
				return;
			}
			showChapter(loc.chapter ?? selected, loc.header, loc.headerNumber);
			return;
		}
		if (!bindInternalLinks) return;
		if (/^https?:\/\//i.test(href)) return;
		const next = docFromHref(href, {linkText: (a.textContent || "").trim()});
		if (!next) return;
		evt.preventDefault();
		evt.stopPropagation();
		plugin.openLibrary({doc: next});
	}, true);

	for (const chapter of chapters) {
		const btn = toc.createEl("button", {
			cls: "fiveetools-adventure__chapbtn",
			text: chapter.name,
		});
		btn.addEventListener("click", () => showChapter(chapter.ix));
	}

	const jump = plugin._adventureJump;
	plugin._adventureJump = null;
	if (jump && jump.id === currentId) {
		await showChapter(jump.chapter ?? 0, jump.header, jump.headerNumber);
		return;
	}
	await showChapter(0);
}

function syncBookUtilRender (ent, chapterIx) {
	const data = ent?.adventureData?.data || [];
	const Renderer = getRenderer();
	globalThis.BookUtil = globalThis.BookUtil || {};
	globalThis.BookUtil.curRender = {
		data,
		fromIndex: ent.adventure,
		curBookId: String(ent.adventure?.id || "").toLowerCase(),
		chapter: chapterIx,
		headerMap: Renderer.adventureBook.getEntryIdLookup(data, {isSilent: true}),
	};
}

export function parseAdventureHref (href) {
	const raw = String(href || "").trim();
	if (!raw || /^javascript:/i.test(raw) || /^mailto:/i.test(raw)) return null;
	if (/^https?:\/\//i.test(raw) && !/adventure\.html/i.test(raw)) return null;

	const hashIdx = raw.indexOf("#");
	if (hashIdx === -1) return null;

	const before = raw.slice(0, hashIdx).replace(/\\/g, "/").replace(/\/+$/, "");
	const page = before.split("/").pop() || "";
	if (page && page !== "adventure.html") return null;

	let hash = raw.slice(hashIdx + 1);
	const amp = hash.indexOf("&");
	if (amp !== -1) hash = hash.slice(0, amp);
	if (!hash) return null;

	const parts = hash.split(",").map((part) => {
		try { return decodeURIComponent(part.replace(/\+/g, " ")).trim(); } catch (_) { return part.trim(); }
	});
	const id = (parts[0] || "").toLowerCase();
	if (!id) return null;

	let chapter = null;
	if (parts.length > 1 && parts[1] !== "" && Number.isFinite(Number(parts[1]))) {
		chapter = Number(parts[1]);
		if (chapter < 0) chapter = 0;
	}
	const header = parts[2] || null;
	let headerNumber = 0;
	if (parts.length > 3 && parts[3] !== "" && Number.isFinite(Number(parts[3]))) {
		headerNumber = Number(parts[3]);
	}
	return {id, chapter, header, headerNumber};
}

function scrollToHeader (root, header, headerNumber = 0) {
	const needle = String(header || "").toLowerCase().trim();
	if (!needle || !root) return;

	const Renderer = getRenderer().get();
	const inverse = Renderer.getTrackedTitlesInverted?.({isStripTags: true}) || {};
	const ixTitle = (inverse[needle] || [])[headerNumber || 0];
	if (ixTitle != null) {
		const byIndex = root.querySelector(`[data-title-index="${ixTitle}"]`);
		if (byIndex) {
			byIndex.scrollIntoView({block: "start"});
			return;
		}
	}

	const nodes = root.querySelectorAll("h1, h2, h3, h4, h5, h6, [data-title-index], .rd__h, .ve-rd__h");
	for (const el of nodes) {
		const text = (el.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
		if (text === needle || text.includes(needle)) {
			el.scrollIntoView({block: "start"});
			return;
		}
	}
}
