import {parseCampaignMarkdown, serializeCampaignMarkdown} from "./campaign-store.js";

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

export function charactersRoot (plugin) {
	const folder = String(plugin?.settings?.notesFolder || "5etools").replace(/\\/g, "/").replace(/\/+$/, "");
	return `${folder}/_characters`;
}

export function characterFilePath (plugin, ddbId) {
	return `${charactersRoot(plugin)}/${String(ddbId || "").trim()}.md`;
}

export function avatarFolder (plugin) {
	return `${charactersRoot(plugin)}/_avatars`;
}

export async function listCharacters (plugin) {
	const vault = plugin?.app?.vault;
	if (!vault) return [];
	const folder = vault.getAbstractFileByPath(charactersRoot(plugin));
	if (!folder?.children) return [];
	const out = [];
	for (const child of folder.children) {
		if (child.children || !String(child.path || "").endsWith(".md")) continue;
		try {
			const parsed = parseCampaignMarkdown(await vault.read(child));
			out.push({path: child.path, ...parsed});
		} catch (_) { /* skip */ }
	}
	return out.sort((a, b) => characterName(a).localeCompare(characterName(b)));
}

export async function readCharacter (plugin, ddbId) {
	const id = String(ddbId || "").trim();
	if (!id) return null;
	const vault = plugin?.app?.vault;
	if (!vault) return null;
	const file = vault.getAbstractFileByPath(characterFilePath(plugin, id));
	if (!file || file.children) return null;
	const parsed = parseCampaignMarkdown(await vault.read(file));
	return {path: file.path, ...parsed};
}

export async function saveCharacter (plugin, card) {
	const id = String(card?.ddbId || "").trim();
	if (!id) throw new Error("Character is missing a D&D Beyond id.");
	const vault = plugin?.app?.vault;
	if (!vault) throw new Error("Vault is unavailable.");
	await ensureFolder(plugin.app, charactersRoot(plugin));
	const avatarPath = card.avatar ? await writeAvatar(plugin, id, card.avatar) : existingAvatarPath(plugin, id);
	const filePath = characterFilePath(plugin, id);
	const text = serializeCampaignMarkdown({
		fields: {
			ddb_id: id,
			name: card.name || "Unnamed",
			species: card.species || "",
			classes: card.classes || "",
			level: card.level ?? "",
			background: card.background || "",
			ac: card.ac ?? "",
			hp_max: card.hpMax ?? "",
			hp_current: card.hpCurrent ?? "",
			speed: card.speed ?? "",
		},
		body: characterMarkdown(card, avatarPath),
	});
	await writeFile(plugin, filePath, text);
	return readCharacter(plugin, id);
}

export async function deleteCharacter (plugin, ddbId) {
	const vault = plugin?.app?.vault;
	const id = String(ddbId || "").trim();
	if (!vault || !id) return;
	const file = vault.getAbstractFileByPath(characterFilePath(plugin, id));
	if (file && !file.children) await vault.delete(file);
	const folder = vault.getAbstractFileByPath(avatarFolder(plugin));
	if (!folder?.children) return;
	for (const child of [...folder.children]) {
		if (child.children) continue;
		if (child.name === id || child.name.startsWith(`${id}.`)) await vault.delete(child);
	}
}

export function characterName (record) {
	return String(record?.fields?.name || record?.fields?.ddb_id || "Character");
}

function characterMarkdown (card, avatarPath) {
	const lines = [];
	if (avatarPath) lines.push(`![[${avatarPath}|80]]`, "");
	lines.push(`# ${card.name || "Unnamed"}`, "");
	const identity = [card.species, card.classes, card.level != null ? `Level ${card.level}` : ""].filter(Boolean);
	if (identity.length) lines.push(identity.join(" · "), "");
	if (card.background) lines.push(`Background: ${card.background}`, "");
	const combat = [];
	if (card.ac != null) combat.push(`AC ${card.ac}`);
	if (card.hpMax != null) {
		const current = card.hpCurrent != null ? card.hpCurrent : card.hpMax;
		let hp = `HP ${current}/${card.hpMax}`;
		if (Number(card.tempHp) > 0) hp += ` (temp ${card.tempHp})`;
		combat.push(hp);
	}
	if (card.speed != null) combat.push(`Speed ${card.speed}`);
	if (combat.length) lines.push(combat.join(" · "), "");
	lines.push("## Abilities", "");
	for (const key of ABILITY_KEYS) {
		const score = card.abilities?.[key];
		if (score == null) continue;
		lines.push(`- ${key.toUpperCase()} ${score} (${formatMod(score)})`);
	}
	lines.push("", "## Equipped", "");
	lines.push(...bulletList(card.equipped));
	lines.push("", "## Spells", "");
	lines.push(...bulletList(card.spells));
	lines.push("", "## Coins", "", formatCoins(card.coins), "");
	return lines.join("\n");
}

function bulletList (items) {
	const list = (items || []).map(it => String(it || "").trim()).filter(Boolean);
	if (!list.length) return ["- None"];
	return list.map(it => `- ${it}`);
}

function formatMod (score) {
	const mod = Math.floor(((Number(score) || 0) - 10) / 2);
	return mod >= 0 ? `+${mod}` : String(mod);
}

function formatCoins (coins) {
	const order = [["pp", "pp"], ["gp", "gp"], ["ep", "ep"], ["sp", "sp"], ["cp", "cp"]];
	const parts = [];
	for (const [key, label] of order) {
		const n = Number(coins?.[key]) || 0;
		if (n) parts.push(`${n} ${label}`);
	}
	return parts.length ? parts.join(", ") : "None";
}

async function writeAvatar (plugin, id, avatar) {
	const ext = String(avatar?.ext || ".webp");
	const folder = avatarFolder(plugin);
	await ensureFolder(plugin.app, folder);
	const path = `${folder}/${id}${ext.startsWith(".") ? ext : `.${ext}`}`;
	const vault = plugin.app.vault;
	const bytes = avatar.bytes instanceof Uint8Array ? avatar.bytes : new Uint8Array(avatar.bytes || []);
	const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	const existing = vault.getAbstractFileByPath(path);
	if (existing && !existing.children) await vault.modifyBinary(existing, data);
	else await vault.createBinary(path, data);
	const dir = vault.getAbstractFileByPath(folder);
	if (dir?.children) {
		for (const child of [...dir.children]) {
			if (child.children || child.path === path) continue;
			if (child.name.startsWith(`${id}.`)) await vault.delete(child);
		}
	}
	return path;
}

function existingAvatarPath (plugin, id) {
	const vault = plugin?.app?.vault;
	const folder = vault?.getAbstractFileByPath(avatarFolder(plugin));
	if (!folder?.children) return "";
	const hit = folder.children.find(child => !child.children && child.name.startsWith(`${id}.`));
	return hit?.path || "";
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
