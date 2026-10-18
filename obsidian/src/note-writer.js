import path from "path";
import {renderCompactMarkdown, pageForDoc} from "./compact-render.js";
import {getAdventureChapters, renderAdventureChapterMarkdown} from "./adventure-reader.js";
import {resolveEntityImages} from "./image-resolver.js";
import {readCachedBytes} from "./media-cache.js";

export function entityNotePath (plugin, doc, ent) {
	const folder = sanitizePathPart(plugin.settings?.notesFolder || "5etools");
	if (ent?.__prop === "adventure") {
		const source = sanitizePathPart(ent.source || doc?.s || "Unknown");
		const name = sanitizePathPart(ent.name || doc?.n || "Adventure");
		return `${folder}/Adventure/${source}/${name}.md`;
	}
	const category = sanitizePathPart(doc?.cf || "Other");
	const source = sanitizePathPart(ent?.source || doc?.s || "Unknown");
	const name = sanitizePathPart(ent?.name || doc?.n || "Untitled");
	return `${folder}/${category}/${source}/${name}.md`;
}

export function wikilinkForFile (file, displayName) {
	const path = String(file?.path || "").replace(/\.md$/i, "");
	const label = String(displayName || file?.basename || path.replace(/^.*\//, "")).trim();
	if (!path) return `[[${label}]]`;
	if (label && label !== path.replace(/^.*\//, "")) return `[[${path}|${label}]]`;
	return `[[${path}]]`;
}

export async function insertEntityNote (plugin, {doc, ent, open = true} = {}) {
	if (ent?.__prop === "adventure") return insertAdventureNotes(plugin, {doc, ent, open});

	const folder = sanitizePathPart(plugin.settings?.notesFolder || "5etools");
	const category = sanitizePathPart(doc?.cf || "Other");
	const source = sanitizePathPart(ent?.source || doc?.s || "Unknown");
	const name = sanitizePathPart(ent?.name || doc?.n || "Untitled");
	const notePath = entityNotePath(plugin, doc, ent);
	const noteFolder = notePath.replace(/\/[^/]+$/, "");
	const existing = plugin.app.vault.getAbstractFileByPath(notePath);
	if (existing) {
		if (open) await plugin.app.workspace.getLeaf(false).openFile(existing);
		return existing;
	}

	await ensureFolder(plugin.app, noteFolder);

	const images = await resolveEntityImages(ent, {
		imageBaseUrl: plugin.settings.imageBaseUrl,
	});
	const imageMarkdown = [];
	if (images.length) {
		const imageFolder = `${folder}/_images/${category}/${source}`;
		await ensureFolder(plugin.app, imageFolder);
		const first = images[0];
		const imageName = `${name}${extensionFor(first)}`;
		const imagePath = `${imageFolder}/${imageName}`;
		if (!plugin.app.vault.getAbstractFileByPath(imagePath)) {
			const bytes = await readCachedBytes(plugin, first.url);
			if (bytes) await plugin.app.vault.createBinary(imagePath, bytes);
		}
		if (plugin.app.vault.getAbstractFileByPath(imagePath)) {
			imageMarkdown.push(`![[${imagePath}]]`);
		}
	}

	const page = pageForDoc(doc);
	const body = renderCompactMarkdown(ent, page).trim();
	const content = [
		"---",
		`5etools_id: "${yamlEscape(`${String(doc.n || ent.name || "").toLowerCase()}|${doc.s || ""}`)}"`,
		`name: "${yamlEscape(ent.name || doc.n || "")}"`,
		`source: "${yamlEscape(doc.s || "")}"`,
		`category: "${yamlEscape(doc.cf || "")}"`,
		page ? `page: "${yamlEscape(page)}"` : null,
		"---",
		"",
		...imageMarkdown,
		imageMarkdown.length ? "" : null,
		body,
		"",
	].filter(it => it != null).join("\n");

	const file = await plugin.app.vault.create(notePath, content);
	if (open) await plugin.app.workspace.getLeaf(false).openFile(file);
	return file;
}

async function insertAdventureNotes (plugin, {doc, ent, open = true} = {}) {
	const indexPath = entityNotePath(plugin, doc, ent);
	const noteFolder = indexPath.replace(/\/[^/]+$/, "");
	const existing = plugin.app.vault.getAbstractFileByPath(indexPath);
	if (existing) {
		if (open) await plugin.app.workspace.getLeaf(false).openFile(existing);
		return existing;
	}

	await ensureFolder(plugin.app, noteFolder);
	const chapters = getAdventureChapters(ent);
	const links = [];
	for (const chapter of chapters) {
		const chapterName = `${String(chapter.ix + 1).padStart(2, "0")} ${sanitizePathPart(chapter.name)}`;
		const chapterPath = `${noteFolder}/${chapterName}.md`;
		links.push(`- [[${chapterName}]]`);
		if (plugin.app.vault.getAbstractFileByPath(chapterPath)) continue;
		const body = renderAdventureChapterMarkdown(chapter.section).trim() || `# ${chapter.name}`;
		const content = [
			"---",
			`5etools_id: "${yamlEscape(`${String(ent.name || "").toLowerCase()}|${ent.source || ""}|${chapter.ix}`)}"`,
			`name: "${yamlEscape(chapter.name)}"`,
			`source: "${yamlEscape(ent.source || "")}"`,
			`category: "Adventure"`,
			`adventure: "${yamlEscape(ent.name || "")}"`,
			"---",
			"",
			body,
			"",
		].join("\n");
		await plugin.app.vault.create(chapterPath, content);
	}

	const index = [
		"---",
		`5etools_id: "${yamlEscape(`${String(ent.name || "").toLowerCase()}|${ent.source || ""}`)}"`,
		`name: "${yamlEscape(ent.name || "")}"`,
		`source: "${yamlEscape(ent.source || "")}"`,
		`category: "Adventure"`,
		"---",
		"",
		`# ${ent.name || "Adventure"}`,
		"",
		...links,
		"",
	].join("\n");
	const file = await plugin.app.vault.create(indexPath, index);
	if (open) await plugin.app.workspace.getLeaf(false).openFile(file);
	return file;
}

function extensionFor (resolved) {
	const fromRel = path.extname(resolved.rel || resolved.path || "");
	if (fromRel) return fromRel;
	if (resolved.url && /\.png(\?|$)/i.test(resolved.url)) return ".png";
	if (resolved.url && /\.jpe?g(\?|$)/i.test(resolved.url)) return ".jpg";
	return ".webp";
}

async function ensureFolder (app, folderPath) {
	const parts = folderPath.split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(acc)) {
			await app.vault.createFolder(acc);
		}
	}
}

function sanitizePathPart (value) {
	return String(value || "Unknown")
		.replace(/[\\/:*?"<>|]/g, "_")
		.replace(/\s+/g, " ")
		.trim() || "Unknown";
}

function yamlEscape (value) {
	return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

if (globalThis.FiveEToolsObsidian) {
	globalThis.FiveEToolsObsidian.entityNotePath = entityNotePath;
	globalThis.FiveEToolsObsidian.wikilinkForFile = wikilinkForFile;
}
