export const CAMPAIGN_SECTIONS = [
	{id: "overview", label: "Overview", folder: null},
	{id: "players", label: "Players", folder: "players"},
	{id: "sessions", label: "Sessions", folder: "sessions"},
	{id: "encounters", label: "Encounters", folder: "encounters"},
	{id: "scenes", label: "Scenes", folder: "scenes"},
	{id: "maps", label: "Maps", folder: "maps"},
	{id: "notes", label: "Notes", folder: "notes"},
	{id: "articles", label: "Articles", folder: "articles"},
];

export function campaignSection (sectionId) {
	return CAMPAIGN_SECTIONS.find(it => it.id === sectionId) || CAMPAIGN_SECTIONS[0];
}

export function campaignsRoot (plugin) {
	const folder = String(plugin?.settings?.notesFolder || "5etools").replace(/\\/g, "/").replace(/\/+$/, "");
	return `${folder}/_campaigns`;
}

export function campaignPath (plugin, slug) {
	return `${campaignsRoot(plugin)}/${slug}`;
}

export function parseCampaignMarkdown (text) {
	const raw = String(text || "").replace(/^\uFEFF/, "");
	let fields = {};
	let body = raw;
	if (raw.startsWith("---")) {
		const end = raw.indexOf("\n---", 3);
		if (end >= 0) {
			fields = parseSimpleYaml(raw.slice(3, end).trim());
			body = raw.slice(end + 4).replace(/^\r?\n/, "");
		}
	}
	const extracted = extractJsonFence(body);
	return {
		fields,
		body: extracted.body,
		snapshot: extracted.snapshot,
	};
}

export function serializeCampaignMarkdown ({fields = {}, body = "", snapshot = null} = {}) {
	const lines = [];
	for (const [key, value] of Object.entries(fields)) {
		if (value == null || value === "") continue;
		lines.push(`${key}: ${yamlScalar(value)}`);
	}
	let out = "";
	if (lines.length) out = `---\n${lines.join("\n")}\n---\n`;
	const text = String(body || "").replace(/^\s+/, "");
	if (text) {
		out += text;
		if (!out.endsWith("\n")) out += "\n";
	}
	if (snapshot) out += `${out && !out.endsWith("\n") ? "\n" : ""}\`\`\`json\n${JSON.stringify(snapshot, null, "\t")}\n\`\`\`\n`;
	return out;
}

export function fileStem (path) {
	return String(path || "").replace(/^.*\//, "").replace(/\.md$/i, "") || "note";
}

export function entryLabel (entry) {
	const named = String(entry?.fields?.name || "").trim();
	return named || fileStem(entry?.path);
}

export function slugify (name) {
	const slug = String(name || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "campaign";
}

export function snapshotCombatants (combatants) {
	return (combatants || []).map(it => ({
		id: it.id || "",
		label: it.label || "",
		hp: it.hpCurrent ?? it.hp ?? null,
		hpMax: it.hpMax ?? null,
		tempHp: it.tempHp ?? 0,
		condition: it.condition || "",
		ac: it.ac ?? null,
		cr: it.cr ?? "",
		dex: it.dex ?? null,
		passive: it.passive ?? null,
		initiative: it.initiative ?? null,
		initScore: it.initScore ?? null,
		doc: it.doc ? {n: it.doc.n, u: it.doc.u, s: it.doc.s, c: it.doc.c, cf: it.doc.cf, sA: it.doc.sA} : null,
	}));
}

export function combatantsFromSnapshot (snapshot) {
	return (snapshot?.combatants || []).map((it, i) => ({
		...it,
		id: it.id || `c${i + 1}`,
		hpMax: it.hpMax ?? 0,
		hpCurrent: it.hpCurrent ?? it.hp ?? it.hpMax ?? 0,
		tempHp: it.tempHp ?? 0,
		condition: it.condition || "",
	}));
}

export function encounterSnapshotFromSaved (saved) {
	if (!saved || typeof saved !== "object") return {party: null, combatants: [], sourceId: ""};
	return {
		sourceId: String(saved.id || ""),
		party: saved.party ? {...saved.party} : null,
		combatants: snapshotCombatants(saved.combatants),
	};
}

export function entryFromSavedEncounter (saved) {
	const snapshot = encounterSnapshotFromSaved(saved);
	return {
		fields: {
			name: String(saved?.name || "Encounter").trim() || "Encounter",
			type: "encounter",
			sourceId: snapshot.sourceId,
		},
		body: "",
		snapshot,
	};
}

export function sessionFromCampaignEncounter (entry) {
	const snapshot = entry?.snapshot || {};
	return {
		name: String(entry?.fields?.name || ""),
		savedId: snapshot.sourceId || null,
		pickedId: snapshot.sourceId || null,
		selectedId: null,
		party: snapshot.party || undefined,
		combatants: combatantsFromSnapshot(snapshot),
		showBlank: false,
		blankDraft: null,
		saveToHomebrew: false,
	};
}

export async function listCampaigns (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return [];
	const root = campaignsRoot(plugin);
	const folder = vault.getAbstractFileByPath(root);
	if (!folder?.children) return [];
	const out = [];
	for (const child of folder.children) {
		if (!child.children) continue;
		const file = vault.getAbstractFileByPath(`${child.path}/campaign.md`);
		if (!file || file.children) continue;
		try {
			const parsed = parseCampaignMarkdown(await vault.read(file));
			out.push({
				slug: child.name,
				path: child.path,
				name: String(parsed.fields.name || child.name).trim() || child.name,
			});
		} catch (_) { /* skip unreadable */ }
	}
	return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function createCampaign (plugin, name) {
	const trimmed = String(name || "").trim();
	if (!trimmed) throw new Error("Name is required.");
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	const slug = await uniqueCampaignSlug(plugin, slugify(trimmed));
	const folder = campaignPath(plugin, slug);
	await ensureFolder(plugin.app, folder);
	const filePath = `${folder}/campaign.md`;
	const text = serializeCampaignMarkdown({
		fields: {name: trimmed, type: "overview"},
		body: "",
	});
	await writeFile(plugin, filePath, text);
	return {slug, path: folder, name: trimmed};
}

export async function deleteCampaign (plugin, slug) {
	const vault = plugin?.app?.vault;
	if (!vault || !slug) return;
	const folder = vault.getAbstractFileByPath(campaignPath(plugin, slug));
	if (folder) await vault.delete(folder, true);
}

export async function listEntries (plugin, slug, sectionId) {
	const section = campaignSection(sectionId);
	const vault = plugin?.app?.vault;
	if (!vault || !slug) return [];
	if (!section.folder) {
		const filePath = `${campaignPath(plugin, slug)}/campaign.md`;
		const file = vault.getAbstractFileByPath(filePath);
		if (!file || file.children) return [];
		const parsed = parseCampaignMarkdown(await vault.read(file));
		return [{path: filePath, ...parsed}];
	}
	const folderPath = `${campaignPath(plugin, slug)}/${section.folder}`;
	const folder = vault.getAbstractFileByPath(folderPath);
	if (!folder?.children) return [];
	const out = [];
	if (section.id === "maps") {
		for (const child of folder.children) {
			if (!child.children) continue;
			const sceneFile = vault.getAbstractFileByPath(`${child.path}/scene.json`);
			if (!sceneFile || sceneFile.children) continue;
			try {
				const scene = JSON.parse(await vault.read(sceneFile));
				out.push({
					path: child.path,
					fields: {name: String(scene?.name || child.name), type: "map"},
					body: "",
					snapshot: null,
					scene: true,
				});
			} catch (_) { /* skip */ }
		}
	}
	for (const child of folder.children) {
		if (child.children || !String(child.path || "").endsWith(".md")) continue;
		try {
			const parsed = parseCampaignMarkdown(await vault.read(child));
			out.push({path: child.path, ...parsed});
		} catch (_) { /* skip */ }
	}
	if (section.id === "sessions") {
		return out.sort((a, b) => sessionSortKey(a.path) - sessionSortKey(b.path)
			|| String(a.fields?.name || a.path).localeCompare(String(b.fields?.name || b.path)));
	}
	return out.sort((a, b) => String(a.fields?.name || a.path).localeCompare(String(b.fields?.name || b.path)));
}

export async function readEntry (plugin, filePath) {
	const vault = plugin?.app?.vault;
	if (!vault || !filePath) return null;
	const file = vault.getAbstractFileByPath(filePath);
	if (!file || file.children) return null;
	const parsed = parseCampaignMarkdown(await vault.read(file));
	return {path: filePath, ...parsed};
}

export async function writeEntry (plugin, slug, sectionId, entry) {
	const section = campaignSection(sectionId);
	const name = String(entry?.fields?.name || "").trim();
	if (!name) throw new Error("Name is required.");
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	const folder = section.folder
		? `${campaignPath(plugin, slug)}/${section.folder}`
		: campaignPath(plugin, slug);
	await ensureFolder(plugin.app, folder);
	const nextPath = section.folder
		? `${folder}/${uniqueFileSlug(vault, folder, slugify(name), entry?.path)}.md`
		: `${folder}/campaign.md`;
	const text = serializeCampaignMarkdown({
		fields: {...entry.fields, name, type: section.id},
		body: entry.body || "",
		snapshot: entry.snapshot || null,
	});
	await writeFile(plugin, nextPath, text);
	if (entry.path && entry.path !== nextPath) {
		const old = vault.getAbstractFileByPath(entry.path);
		if (old && !old.children) await vault.delete(old);
	}
	return readEntry(plugin, nextPath);
}

const SECTION_CODE_PREFIX = {
	players: "player",
	sessions: "session",
	encounters: "encounter",
	scenes: "scene",
	maps: "map",
	notes: "note",
	articles: "article",
};

export function nextNumberedCode (prefix, paths) {
	const stem = String(prefix || "note").replace(/[^a-z0-9-]/gi, "") || "note";
	const re = new RegExp(`(?:^|/)${stem}-(\\d+)(?:\\.md)?$`, "i");
	let max = 0;
	for (const path of paths || []) {
		const m = String(path).match(re);
		if (m) max = Math.max(max, Number(m[1]));
	}
	return `${stem}-${String(max + 1).padStart(2, "0")}`;
}

export function nextSessionCode (paths) {
	return nextNumberedCode("session", paths);
}

export function dutchDate (date = new Date()) {
	const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
	const dd = String(d.getDate()).padStart(2, "0");
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	return `${dd}-${mm}-${d.getFullYear()}`;
}

export async function createEntry (plugin, slug, sectionId, name) {
	const section = campaignSection(sectionId);
	if (!section.folder) throw new Error("Overview is the campaign file.");
	const trimmed = String(name || "").trim();
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	const folder = `${campaignPath(plugin, slug)}/${section.folder}`;
	await ensureFolder(plugin.app, folder);
	const existing = await listEntries(plugin, slug, section.id);
	const prefix = SECTION_CODE_PREFIX[section.id] || "note";
	const code = nextNumberedCode(prefix, existing.map(it => it.path));
	const fileSlug = !trimmed
		? code
		: uniqueFileSlug(vault, folder, slugify(trimmed) || code);
	const date = dutchDate();
	const fields = section.id === "sessions" ? {date} : {};
	const label = trimmed || fileSlug;
	let body = "";
	if (section.id === "sessions") body = `# ${label} - ${date}\n\n`;
	else if (trimmed) body = `# ${trimmed}\n\n`;
	const filePath = `${folder}/${fileSlug}.md`;
	await writeFile(plugin, filePath, serializeCampaignMarkdown({fields, body}));
	return readEntry(plugin, filePath);
}

export function planSaveEntryText (sectionId, folder, currentPath, text) {
	const section = campaignSection(sectionId);
	const raw = String(text ?? "");
	const parsed = parseCampaignMarkdown(raw);
	const name = String(parsed.fields.name || "").trim();
	if (!name) throw new Error("Name is required.");
	const nextPath = section.folder
		? `${folder}/${slugify(name)}.md`
		: `${folder}/campaign.md`;
	return {parsed, name, text: raw, nextPath, currentPath: currentPath || ""};
}

export async function saveEntryText (plugin, slug, sectionId, path, text) {
	const section = campaignSection(sectionId);
	const folder = section.folder
		? `${campaignPath(plugin, slug)}/${section.folder}`
		: campaignPath(plugin, slug);
	const plan = planSaveEntryText(sectionId, folder, path, text);
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	await ensureFolder(plugin.app, folder);
	const nextPath = section.folder
		? `${folder}/${uniqueFileSlug(vault, folder, slugify(plan.name), path)}.md`
		: `${folder}/campaign.md`;
	await writeFile(plugin, nextPath, plan.text);
	if (path && path !== nextPath) {
		const old = vault.getAbstractFileByPath(path);
		if (old && !old.children) await vault.delete(old);
	}
	return {path: nextPath, text: plan.text, ...parseCampaignMarkdown(plan.text)};
}

export async function readEntryText (plugin, filePath) {
	const vault = plugin?.app?.vault;
	if (!vault || !filePath) return "";
	const file = vault.getAbstractFileByPath(filePath);
	if (!file || file.children) return "";
	return vault.read(file);
}

export async function deleteEntry (plugin, filePath) {
	const vault = plugin?.app?.vault;
	if (!vault || !filePath) return;
	if (String(filePath).endsWith("/campaign.md")) return;
	const file = vault.getAbstractFileByPath(filePath);
	if (file && !file.children) await vault.delete(file);
}

function parseSimpleYaml (block) {
	const fields = {};
	for (const line of String(block || "").split(/\r?\n/)) {
		const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!m) continue;
		fields[m[1]] = unquote(m[2].trim());
	}
	return fields;
}

function yamlScalar (value) {
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	const text = String(value);
	if (/[:#\n]|^\s|\s$/.test(text)) return JSON.stringify(text);
	return text;
}

function unquote (value) {
	if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
		try { return JSON.parse(value.startsWith("'") ? `"${value.slice(1, -1)}"` : value); } catch (_) { return value.slice(1, -1); }
	}
	if (value === "true") return true;
	if (value === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	return value;
}

function extractJsonFence (body) {
	const text = String(body || "");
	const match = text.match(/```json\s*([\s\S]*?)\s*```/i);
	if (!match) return {body: text.replace(/\s+$/, ""), snapshot: null};
	let snapshot = null;
	try { snapshot = JSON.parse(match[1]); } catch (_) { snapshot = null; }
	const rest = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`.replace(/\s+$/, "");
	return {body: rest.trim(), snapshot};
}

async function uniqueCampaignSlug (plugin, base) {
	let slug = base;
	let n = 2;
	while (plugin.app.vault.getAbstractFileByPath(campaignPath(plugin, slug))) {
		slug = `${base}-${n++}`;
	}
	return slug;
}

function sessionSortKey (path) {
	const m = String(path || "").match(/session-(\d+)(?:\.md)?$/i);
	return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function uniqueFileSlug (vault, folder, base, currentPath) {
	let slug = base;
	let n = 2;
	while (true) {
		const path = `${folder}/${slug}.md`;
		if (path === currentPath) return slug;
		const existing = vault.getAbstractFileByPath(path);
		if (!existing) return slug;
		slug = `${base}-${n++}`;
	}
}

async function writeFile (plugin, filePath, text) {
	const vault = plugin.app.vault;
	const existing = vault.getAbstractFileByPath(filePath);
	if (existing && !existing.children) await vault.modify(existing, text);
	else await vault.create(filePath, text);
}

async function ensureFolder (app, folderPath) {
	const parts = String(folderPath || "").split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(acc)) await app.vault.createFolder(acc);
	}
}

if (globalThis.FiveEToolsObsidian) {
	globalThis.FiveEToolsObsidian.parseCampaignMarkdown = parseCampaignMarkdown;
	globalThis.FiveEToolsObsidian.serializeCampaignMarkdown = serializeCampaignMarkdown;
	globalThis.FiveEToolsObsidian.encounterSnapshotFromSaved = encounterSnapshotFromSaved;
	globalThis.FiveEToolsObsidian.entryFromSavedEncounter = entryFromSavedEncounter;
	globalThis.FiveEToolsObsidian.sessionFromCampaignEncounter = sessionFromCampaignEncounter;
	globalThis.FiveEToolsObsidian.combatantsFromSnapshot = combatantsFromSnapshot;
	globalThis.FiveEToolsObsidian.snapshotCombatants = snapshotCombatants;
	globalThis.FiveEToolsObsidian.planSaveEntryText = planSaveEntryText;
	globalThis.FiveEToolsObsidian.saveEntryText = saveEntryText;
	globalThis.FiveEToolsObsidian.slugify = slugify;
	globalThis.FiveEToolsObsidian.nextSessionCode = nextSessionCode;
	globalThis.FiveEToolsObsidian.nextNumberedCode = nextNumberedCode;
	globalThis.FiveEToolsObsidian.dutchDate = dutchDate;
	globalThis.FiveEToolsObsidian.entryLabel = entryLabel;
}
