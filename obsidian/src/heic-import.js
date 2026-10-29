import {Notice, normalizePath} from "obsidian";

const HEIC_EXT = /\.(heic|heif)$/i;
const HEIC_MIME = /^(image\/heic|image\/heif)(;|$)/i;
const JPEG_QUALITY = 0.9;

let heic2anyPromise = null;

export function isHeicFile (file) {
	if (!file) return false;
	const type = String(file.type || "");
	if (HEIC_MIME.test(type)) return true;
	return HEIC_EXT.test(String(file.name || ""));
}

export function registerHeicImport (plugin) {
	plugin.registerEvent(plugin.app.workspace.on("editor-paste", (evt, editor, info) => {
		void handleHeicTransfer(plugin, evt, editor, info, evt.clipboardData);
	}));
	plugin.registerEvent(plugin.app.workspace.on("editor-drop", (evt, editor, info) => {
		void handleHeicTransfer(plugin, evt, editor, info, evt.dataTransfer);
	}));
	plugin.registerMarkdownPostProcessor((el, ctx) => {
		displayHeicEmbeds(plugin, el, ctx?.sourcePath || "");
	});
}

async function handleHeicTransfer (plugin, evt, editor, info, data) {
	if (!plugin.settings?.convertHeicOnPaste) return;
	const files = heicFilesFromTransfer(data);
	if (!files.length) return;

	evt.preventDefault();
	evt.stopPropagation();

	const sourcePath = activeNotePath(info, plugin);
	const embeds = [];
	try {
		for (const file of files) {
			const path = await importHeicAsJpeg(plugin, file, sourcePath);
			if (path) embeds.push(`![[${path}]]`);
		}
	} catch (e) {
		new Notice(e.message || "Could not convert HEIC image.");
		return;
	}
	if (!embeds.length) {
		new Notice("Could not convert HEIC image.");
		return;
	}
	const text = embeds.join("\n");
	if (typeof editor?.replaceSelection === "function") editor.replaceSelection(embeds.length > 1 ? `${text}\n` : text);
	else if (typeof editor?.replaceRange === "function" && typeof editor?.getCursor === "function") {
		editor.replaceRange(text, editor.getCursor());
	}
}

function displayHeicEmbeds (plugin, el, sourcePath) {
	const embeds = [];
	const images = [];
	const take = (node) => {
		if (!node) return;
		if (node.classList?.contains("internal-embed")) embeds.push(node);
		else if (node.tagName === "IMG") images.push(node);
	};
	take(el);
	el.querySelectorAll?.(".internal-embed, img").forEach(take);
	const claimed = new Set();
	for (const embed of embeds) {
		const file = resolveHeicFile(plugin, embed.getAttribute("src") || "", sourcePath);
		if (!file) continue;
		const img = embed.querySelector("img");
		if (img) claimed.add(img);
		watchHeic(plugin, embed, file);
	}
	for (const img of images) {
		if (claimed.has(img)) continue;
		const file = resolveHeicFile(plugin, img.getAttribute("src") || img.currentSrc || img.src || "", sourcePath);
		if (!file) continue;
		void paintHeic(plugin, img, img, file);
	}
}

function watchHeic (plugin, embed, file) {
	const apply = () => {
		if (!embed.isConnected) {
			observer.disconnect();
			const previous = embed.dataset.fiveetoolsHeicUrl;
			if (previous) {
				URL.revokeObjectURL(previous);
				delete embed.dataset.fiveetoolsHeicUrl;
			}
			return;
		}
		const img = embed.querySelector("img");
		if (img) void paintHeic(plugin, img, embed, file);
	};
	const observer = new MutationObserver(apply);
	apply();
	observer.observe(embed, {childList: true, subtree: true});
	if (embed.parentNode) observer.observe(embed.parentNode, {childList: true});
}

async function paintHeic (plugin, img, host, file) {
	const mark = file.path;
	if (img.dataset.fiveetoolsHeic === mark || img.dataset.fiveetoolsHeic === `pending:${mark}`) return;
	img.dataset.fiveetoolsHeic = `pending:${mark}`;
	try {
		const bytes = await plugin.app.vault.readBinary(file);
		if (!img.isConnected) return;
		const jpeg = await heicFileToJpegBytes(plugin, new Blob([bytes], {type: "image/heic"}));
		if (!img.isConnected) return;
		const url = URL.createObjectURL(new Blob([jpeg], {type: "image/jpeg"}));
		const previous = host.dataset.fiveetoolsHeicUrl;
		if (previous) URL.revokeObjectURL(previous);
		host.dataset.fiveetoolsHeicUrl = url;
		img.dataset.fiveetoolsHeic = mark;
		img.src = url;
	} catch (_) {
		if (img.dataset.fiveetoolsHeic === `pending:${mark}`) delete img.dataset.fiveetoolsHeic;
	}
}

function resolveHeicFile (plugin, link, sourcePath) {
	const linkpath = String(link || "").split("|")[0].trim();
	if (!linkpath) return null;
	let name = linkpath;
	try { name = decodeURIComponent(linkpath.split("?")[0].split("/").pop() || ""); } catch (_) { /* keep the raw name */ }
	if (!HEIC_EXT.test(name) && !HEIC_EXT.test(linkpath)) return null;
	const directLink = /^app:|^https?:|^blob:/i.test(linkpath) ? name : linkpath;
	const dest = plugin.app.metadataCache?.getFirstLinkpathDest?.(directLink, sourcePath || "");
	if (dest && !dest.children && HEIC_EXT.test(dest.path)) return dest;
	if (!/^app:|^https?:|^blob:/i.test(linkpath)) {
		const direct = plugin.app.vault.getAbstractFileByPath(normalizePath(linkpath));
		if (direct && !direct.children && HEIC_EXT.test(direct.path)) return direct;
	}
	return null;
}

function heicFilesFromTransfer (data) {
	if (!data?.files?.length) return [];
	return [...data.files].filter(isHeicFile);
}

function activeNotePath (info, plugin) {
	const file = info?.file || plugin.app.workspace.getActiveFile();
	return file?.path || "";
}

async function importHeicAsJpeg (plugin, file, sourcePath) {
	const bytes = await heicFileToJpegBytes(plugin, file);
	const base = jpegBasename(file.name || "image");
	const destPath = await plugin.app.fileManager.getAvailablePathForAttachment(base, sourcePath || undefined);
	const path = normalizePath(destPath);
	await plugin.app.vault.createBinary(path, bytes);
	return path;
}

export async function heicFileToJpegBytes (plugin, file) {
	const heic2any = await loadHeic2any(plugin);
	const input = file instanceof Blob ? file : new Blob([file], {type: file?.type || "image/heic"});
	const result = await heic2any({
		blob: input,
		toType: "image/jpeg",
		quality: JPEG_QUALITY,
	});
	const blob = Array.isArray(result) ? result[0] : result;
	if (!blob) throw new Error("HEIC conversion returned no image.");
	return blob.arrayBuffer();
}

function jpegBasename (name) {
	const raw = String(name || "image").replace(/[\\/:*?"<>|]/g, "_").trim() || "image";
	const stem = raw.replace(HEIC_EXT, "") || "image";
	return `${stem}.jpg`;
}

async function loadHeic2any (plugin) {
	if (typeof globalThis.heic2any === "function") return globalThis.heic2any;
	if (heic2anyPromise) return heic2anyPromise;
	heic2anyPromise = injectHeicScript(plugin).then(() => {
		if (typeof globalThis.heic2any !== "function") throw new Error("HEIC converter failed to load.");
		return globalThis.heic2any;
	}).catch((e) => {
		heic2anyPromise = null;
		throw e;
	});
	return heic2anyPromise;
}

function injectHeicScript (plugin) {
	if (typeof globalThis.heic2any === "function") return Promise.resolve();
	const vaultPath = normalizePath(`${plugin.manifest.dir}/heic/heic2any.js`);
	const url = plugin.app.vault.adapter.getResourcePath(vaultPath);
	return new Promise((resolve, reject) => {
		const fail = () => reject(new Error("Could not load HEIC converter. Rebuild the plugin so heic/ is installed."));
		const existing = document.querySelector(`script[data-fiveetools-heic="1"]`);
		if (existing) {
			if (typeof globalThis.heic2any === "function") {
				resolve();
				return;
			}
			existing.addEventListener("load", () => {
				if (typeof globalThis.heic2any === "function") resolve();
				else fail();
			});
			existing.addEventListener("error", fail);
			return;
		}
		const script = document.createElement("script");
		script.src = url;
		script.async = true;
		script.dataset.fiveetoolsHeic = "1";
		script.onload = () => {
			if (typeof globalThis.heic2any === "function") resolve();
			else fail();
		};
		script.onerror = fail;
		document.head.appendChild(script);
	});
}
