import {parseCampaignMarkdown, serializeCampaignMarkdown} from "./campaign-store.js";
import {ensureSearchIndex, findEditionDoc, findNamedFeature, sourceAbbr} from "./search-index.js";

export const REF_CATEGORIES = {
	spell: ["spell"],
	item: ["item"],
	background: ["background"],
	feat: ["feat"],
	species: ["species"],
	class: ["class"],
	subclass: ["subclass"],
};

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
	await ensureSearchIndex(plugin);
	const avatarPath = card.avatar ? await writeAvatar(plugin, id, card.avatar) : existingAvatarPath(plugin, id);
	const filePath = characterFilePath(plugin, id);
	const refs = resolveRefs(card.refs || []);
	const actions = resolveActions(card.actions || [], card.edition === "one" ? "one" : "classic", preferNames(card.refs));
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
		body: characterMarkdown({...card, actions}, avatarPath, refs),
		snapshot: {
			edition: card.edition || "classic",
			abilities: card.abilities || null,
			rolls: card.rolls || null,
			actions,
			traits: card.traits || null,
			coins: card.coins || null,
			refs,
		},
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

function resolveRefs (refs) {
	return (refs || []).map(ref => {
		const names = [ref.name, ref.alt, ...(ref.alts || [])].map(it => String(it || "").trim()).filter(Boolean);
		let doc = null;
		for (const name of names) {
			doc = findEditionDoc(name, {
				categoriesExact: REF_CATEGORIES[ref.kind] || [],
				edition: ref.edition === "one" ? "one" : "classic",
			});
			if (doc) break;
		}
		const qty = Number(ref.qty) || 0;
		return {
			kind: ref.kind,
			name: doc?.n || ref.name || "",
			label: ref.label || ref.name || "",
			source: doc?.s || "",
			...(qty > 1 ? {qty} : {}),
			...(ref.equipped ? {equipped: true} : {}),
		};
	}).filter(ref => ref.label || ref.name);
}

function resolveActions (actions, edition, prefer) {
	return (actions || []).map(action => {
		const name = String(action?.name || "").trim();
		const doc = findNamedFeature(name, {edition, prefer});
		return {
			...action,
			name,
			...(doc ? {kind: String(doc.cf || "").toLowerCase(), lookup: doc.n, source: doc.s} : {}),
		};
	}).filter(action => action.name);
}

function preferNames (refs) {
	return (refs || [])
		.filter(ref => ref.kind === "class" || ref.kind === "subclass")
		.flatMap(ref => String(ref.name || ref.label || "").toLowerCase().split(/[^a-z0-9]+/))
		.filter(token => token.length > 3);
}

function characterMarkdown (card, avatarPath, refs) {
	const lines = [];
	if (avatarPath) lines.push(`![[${avatarPath}|80]]`, "");
	lines.push(`# ${card.name || "Unnamed"}`, "");
	const identity = [card.species, card.classes, card.level != null ? `Level ${card.level}` : ""].filter(Boolean);
	if (identity.length) lines.push(identity.join(" · "), "");
	const background = refsOf(refs, "background")[0];
	if (card.background) lines.push(`Background: ${refText(background || {label: card.background})}`, "");
	const combat = [];
	if (card.ac != null) combat.push(`AC ${card.ac}`);
	if (card.hpMax != null) {
		const current = card.hpCurrent != null ? card.hpCurrent : card.hpMax;
		let hp = `HP ${current}/${card.hpMax}`;
		if (Number(card.tempHp) > 0) hp += ` (temp ${card.tempHp})`;
		combat.push(hp);
	}
	if (card.speed != null) combat.push(`Speed ${card.speed}`);
	if (card.rolls) {
		combat.push(`Initiative ${checkNotation(card.rolls.initiative)}`);
		combat.push(`PB ${signed(card.rolls.proficiency)}`);
		if (card.rolls.passivePerception != null) combat.push(`Passive Perception ${card.rolls.passivePerception}`);
	}
	if (combat.length) lines.push(combat.join(" · "), "");
	lines.push("## Abilities", "");
	const saves = new Map((card.rolls?.saves || []).map(save => [save.key, save]));
	for (const key of ABILITY_KEYS) {
		const score = card.abilities?.[key];
		if (score == null) continue;
		const check = modifierFromScore(score);
		const save = saves.get(key);
		const mods = save ? `${signed(check)} / ${signed(save.mod)}${save.proficient ? " PB" : ""}` : signed(check);
		lines.push(`- ${key.toUpperCase()} ${score} · ${mods}`);
	}
	lines.push(...skillLines(card.rolls));
	lines.push(...actionLines(card.actions));
	lines.push(...refSection("Spells", refsOf(refs, "spell")));
	lines.push(...refSection("Feats", refsOf(refs, "feat")));
	lines.push(...refSection("Gear", refsOf(refs, "item")));
	lines.push(...traitLines(card.traits));
	lines.push("", "## Coins", "", formatCoins(card.coins), "");
	return lines.join("\n");
}

function refsOf (refs, kind) {
	return (refs || []).filter(ref => ref.kind === kind);
}

function refSection (title, refs) {
	if (!refs.length) return [];
	return ["", `## ${title}`, "", ...refs.map(ref => `- ${refText(ref)}`)];
}

function refText (ref) {
	const label = ref.label || ref.name || "";
	const qty = Number(ref.qty) > 1 ? ` ×${ref.qty}` : "";
	const equipped = ref.equipped ? " (equipped)" : "";
	const source = sourceAbbr(ref.source);
	const book = source ? ` · ${source}` : "";
	return `${label}${qty}${equipped}${book}`;
}

function traitLines (traits) {
	if (!traits) return [];
	const rows = [
		["Personality", traits.personality],
		["Ideals", traits.ideals],
		["Bonds", traits.bonds],
		["Flaws", traits.flaws],
	].filter(([, text]) => String(text || "").trim());
	if (!rows.length) return [];
	const lines = ["", "## Traits", ""];
	for (const [label, text] of rows) lines.push(`**${label}.** ${String(text).trim()}`, "");
	return lines;
}

function modifierFromScore (score) {
	return Math.floor(((Number(score) || 0) - 10) / 2);
}

function signed (mod) {
	const n = Number(mod) || 0;
	return n >= 0 ? `+${n}` : String(n);
}

function checkNotation (mod) {
	const n = Number(mod) || 0;
	return n ? `1d20${signed(n)}` : "1d20";
}

function skillLines (rolls) {
	if (!rolls?.skills?.length) return [];
	const lines = ["", "## Skills", ""];
	for (const skill of rolls.skills) lines.push(`- ${rollLine(skill.name, skill)}`);
	return lines;
}

function rollLine (label, row) {
	const mark = row.expertise ? " expertise" : (row.proficient ? " PB" : "");
	return `${label} ${signed(row.mod)}${mark} ${checkNotation(row.mod)}`;
}

function actionLines (actions) {
	if (!actions?.length) return [];
	const lines = ["", "## Actions", ""];
	for (const action of actions) {
		const bits = [action.name];
		if (action.source) bits.push(sourceAbbr(action.source));
		if (action.activation) bits.push(action.activation);
		if (action.uses) bits.push(`${action.uses} uses`);
		if (action.dice) bits.push(action.dice);
		lines.push(`- ${bits.join(" · ")}`);
	}
	return lines;
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
