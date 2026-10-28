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
	const previous = await readCharacter(plugin, id);
	const play = previous?.snapshot?.play || seedPlay(card);
	if (Array.isArray(play.gear)) fillGearAttunable(play.gear, card.refs);
	const slots = mergeSlotSpent(card.slots || [], previous?.snapshot?.slots);
	const avatarPath = card.avatar ? await writeAvatar(plugin, id, card.avatar) : existingAvatarPath(plugin, id);
	const filePath = characterFilePath(plugin, id);
	const refs = resolveRefs(card.refs || []);
	const actions = resolveActions(card.actions || [], card.edition === "one" ? "one" : "classic", preferNames(card.refs));
	const shown = {
		...card,
		actions,
		slots,
		hpCurrent: play.hpCurrent ?? card.hpCurrent,
		hpMax: play.hpMax ?? card.hpMax,
		tempHp: play.tempHp ?? card.tempHp,
	};
	const text = serializeCampaignMarkdown({
		fields: {
			ddb_id: id,
			name: card.name || "Unnamed",
			species: card.species || "",
			classes: card.classes || "",
			level: card.level ?? "",
			background: card.background || "",
			ac: card.ac ?? "",
			hp_max: shown.hpMax ?? "",
			hp_current: shown.hpCurrent ?? "",
			speed: card.speed ?? "",
		},
		body: characterMarkdown({...shown, play}, avatarPath, refs),
		snapshot: {
			edition: card.edition || "classic",
			abilities: card.abilities || null,
			rolls: card.rolls || null,
			actions,
			slots,
			traits: card.traits || null,
			coins: card.coins || null,
			refs,
			senses: card.senses || [],
			speeds: card.speeds || [],
			defenses: card.defenses || [],
			proficiencies: card.proficiencies || [],
			spellcasting: card.spellcasting || [],
			hitDice: card.hitDice || [],
			choices: card.choices || [],
			features: card.features || [],
			companions: card.companions || [],
			story: card.story || null,
			xpAdjustment: card.xpAdjustment ?? null,
			play,
		},
	});
	await writeFile(plugin, filePath, text);
	return readCharacter(plugin, id);
}

export async function saveCharacterPlay (plugin, ddbId, play) {
	const record = await readCharacter(plugin, ddbId);
	if (!record?.snapshot) return null;
	record.snapshot.play = play;
	if (play?.hpCurrent != null) record.fields.hp_current = play.hpCurrent;
	if (play?.hpMax != null) record.fields.hp_max = play.hpMax;
	await writeFile(plugin, record.path, serializeCampaignMarkdown({
		fields: record.fields,
		body: record.body,
		snapshot: record.snapshot,
	}));
	return record;
}

export function seedPlay (card) {
	const prepared = [];
	for (const ref of card?.refs || []) {
		if (ref?.kind !== "spell" || ref.alwaysPrepared || !ref.prepared) continue;
		const name = String(ref.name || ref.label || "").trim();
		if (name) prepared.push(name);
	}
	const hitDiceSpent = {};
	for (const die of card?.hitDice || []) {
		if (die?.className && Number(die.spent) > 0) hitDiceSpent[die.className] = Number(die.spent);
	}
	return {
		hpCurrent: card?.hpCurrent ?? null,
		hpMax: card?.hpMax ?? null,
		tempHp: Number(card?.tempHp) || 0,
		conditions: Array.isArray(card?.conditions) ? card.conditions.slice() : [],
		deathSaves: {
			success: Number(card?.deathSaves?.success) || 0,
			fail: Number(card?.deathSaves?.fail) || 0,
			stable: !!card?.deathSaves?.stable,
		},
		inspiration: !!card?.inspiration,
		xp: card?.xp ?? null,
		prepared,
		hitDiceSpent,
		coins: coinBag(card?.coins),
		gear: gearFromRefs(card?.refs),
	};
}

export function coinBag (coins) {
	const bag = {};
	for (const key of ["gp", "sp", "cp", "ep", "pp"]) bag[key] = Math.max(0, Math.floor(Number(coins?.[key]) || 0));
	return bag;
}

export function gearFromRefs (refs) {
	const items = [];
	const seen = new Map();
	for (const ref of refs || []) {
		if (ref?.kind !== "item") continue;
		const label = String(ref.label || ref.name || "").trim();
		if (!label) continue;
		const base = label.toLowerCase();
		const n = (seen.get(base) || 0) + 1;
		seen.set(base, n);
		items.push({
			id: n === 1 ? base : `${base}-${n}`,
			name: ref.name || label,
			label,
			source: ref.source || "",
			edition: ref.edition || "",
			qty: Math.max(1, Number(ref.qty) || 1),
			equipped: !!ref.equipped,
			attuned: !!ref.attuned,
			attunable: ref.attunable != null ? !!ref.attunable : !!ref.attuned,
			...(ref.rarity ? {rarity: ref.rarity} : {}),
			...(Number(ref.weight) > 0 ? {weight: Number(ref.weight)} : {}),
			...(Number(ref.charges) > 0 ? {charges: Number(ref.charges)} : {}),
			...(ref.snippet ? {snippet: ref.snippet} : {}),
		});
	}
	return items;
}

export function fillGearAttunable (gear, refs) {
	const byLabel = new Map();
	for (const ref of refs || []) {
		if (ref?.kind !== "item") continue;
		const key = String(ref.label || ref.name || "").trim().toLowerCase();
		if (key && !byLabel.has(key)) byLabel.set(key, ref);
	}
	for (const item of gear || []) {
		const ref = byLabel.get(String(item.label || item.name || "").trim().toLowerCase());
		if (ref?.attunable || item.attuned) {
			item.attunable = true;
			continue;
		}
		if (typeof item.attunable === "boolean") continue;
		item.attunable = false;
	}
	return gear;
}

function mergeSlotSpent (next, previous) {
	if (!previous?.length) return next || [];
	return (next || []).map(slot => {
		const old = previous.find(it => it.level === slot.level && !!it.pact === !!slot.pact);
		if (!old) return slot;
		const spent = Math.max(0, Math.min(slot.max, Number(old.spent) || 0));
		return {...slot, spent};
	});
}

export async function saveCharacterSlots (plugin, ddbId, slots) {
	const record = await readCharacter(plugin, ddbId);
	if (!record?.snapshot) return null;
	record.snapshot.slots = slots;
	await writeFile(plugin, record.path, serializeCampaignMarkdown({
		fields: record.fields,
		body: record.body,
		snapshot: record.snapshot,
	}));
	return record;
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
			...refDetails(ref),
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

function refDetails (ref) {
	const out = {};
	for (const key of ["level", "school", "castingTime", "range", "duration", "components", "concentration", "ritual", "attack", "save", "prepared", "alwaysPrepared", "list", "attuned", "attunable", "rarity", "weight", "charges", "snippet"]) {
		const value = ref?.[key];
		if (value == null || value === "" || value === false) continue;
		out[key] = value;
	}
	return out;
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
		combat.push(`Initiative ${signed(card.rolls.initiative)}`);
		combat.push(`PB ${signed(card.rolls.proficiency)}`);
		if (card.rolls.passivePerception != null) combat.push(`Passive Perception ${card.rolls.passivePerception}`);
	}
	if (combat.length) lines.push(combat.join(" · "), "");
	lines.push(...abilityLines(card));
	lines.push(...slotLines(card.slots));
	lines.push(...skillLines(card.rolls));
	lines.push(...actionLines(card.actions));
	lines.push(...spellLines(refsOf(refs, "spell"), card.play));
	lines.push(...refSection("Feats", refsOf(refs, "feat")));
	lines.push(...refSection("Gear", gearLines(refs, card.play)));
	lines.push(...traitLines(card.traits));
	lines.push(...joinedLine("Senses", card.senses));
	lines.push(...speedLines(card.speeds));
	lines.push(...joinedLine("Defenses", card.defenses));
	lines.push(...joinedLine("Proficiencies", card.proficiencies));
	lines.push(...spellcastingLines(card.spellcasting));
	lines.push(...hitDiceLines(card.hitDice, card.play));
	lines.push(...choiceLines(card.choices));
	lines.push(...featureLines(card.features));
	lines.push(...companionLines(card.companions));
	lines.push(...storyLines(card.story));
	lines.push("", "## Coins", "", formatCoins(card.play?.coins || card.coins), "");
	return lines.join("\n");
}

function joinedLine (title, values) {
	const text = (values || []).map(value => String(value || "").trim()).filter(Boolean).join(", ");
	if (!text) return [];
	return ["", `**${title}.** ${text}`, ""];
}

function speedLines (speeds) {
	const text = (speeds || []).filter(speed => Number(speed?.value) > 0).map(speed => `${speed.label} ${speed.value}`).join(", ");
	if (!text) return [];
	return ["", `**Speeds.** ${text}`, ""];
}

function spellcastingLines (lines) {
	if (!lines?.length) return [];
	return ["", "**Spellcasting.** " + lines.map(line => `${line.className} ${signed(line.attack)} / DC ${line.dc}`).join(" · "), ""];
}

function hitDiceLines (dice, play) {
	if (!dice?.length) return [];
	const rows = dice.map(die => {
		const spent = Number(play?.hitDiceSpent?.[die.className] ?? die.spent) || 0;
		return `${die.className} d${die.die} ${spent}/${die.count}`;
	});
	return ["", "## Hit dice", "", ...rows.map(row => `- ${row}`)];
}

function choiceLines (choices) {
	if (!choices?.length) return [];
	return ["", "## Choices", "", ...choices.map(choice => `- ${choice}`)];
}

function featureLines (features) {
	if (!features?.length) return [];
	const lines = ["", "## Features", ""];
	for (const feature of features) {
		const snippet = feature.snippet ? ` — ${feature.snippet}` : "";
		lines.push(`- ${feature.group ? `${feature.group}: ` : ""}${feature.name}${snippet}`);
	}
	return lines;
}

function companionLines (companions) {
	if (!companions?.length) return [];
	const lines = ["", "## Companions", ""];
	for (const companion of companions) {
		const bits = [companion.name, companion.line, companion.snippet].filter(Boolean);
		lines.push(`- ${bits.join(" · ")}`);
	}
	return lines;
}

function storyLines (story) {
	if (!story) return [];
	const rows = [
		["Gender", story.gender],
		["Faith", story.faith],
		["Age", story.age],
		["Hair", story.hair],
		["Eyes", story.eyes],
		["Skin", story.skin],
		["Height", story.height],
		["Weight", story.weight],
		["Alignment", story.alignment],
		["Lifestyle", story.lifestyle],
		["Appearance", story.appearance],
		["Backstory", story.backstory],
		["Allies", story.allies],
		["Organizations", story.organizations],
		["Enemies", story.enemies],
		["Other notes", story.otherNotes],
		["Personal possessions", story.possessions],
	].filter(([, text]) => String(text || "").trim());
	if (!rows.length) return [];
	const lines = ["", "## Person and story", ""];
	for (const [label, text] of rows) lines.push(`**${label}.** ${String(text).trim()}`, "");
	return lines;
}

function gearLines (refs, play) {
	const items = Array.isArray(play?.gear) ? play.gear : refsOf(refs, "item");
	return items.slice().sort((a, b) => Number(!!b.equipped) - Number(!!a.equipped) || String(a.label || a.name).localeCompare(String(b.label || b.name)));
}

function refsOf (refs, kind) {
	return (refs || []).filter(ref => ref.kind === kind);
}

function spellLines (spells, play) {
	if (!spells?.length) return [];
	const lines = ["", "## Spells", ""];
	for (const [level, list] of groupSpells(spells)) {
		lines.push(`### ${spellLevelLabel(level)}`, "");
		for (const spell of list) lines.push(`- ${spellText(spell, play)}`);
		lines.push("");
	}
	return lines;
}

function groupSpells (spells) {
	const groups = new Map();
	for (const spell of spells) {
		const level = Number.isFinite(Number(spell.level)) ? Number(spell.level) : 99;
		if (!groups.has(level)) groups.set(level, []);
		groups.get(level).push(spell);
	}
	return [...groups.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([level, list]) => [level, list.sort((a, b) => String(a.label || a.name).localeCompare(String(b.label || b.name)))]);
}

function spellLevelLabel (level) {
	if (level === 0) return "Cantrips";
	if (level === 99) return "Other";
	const suffix = level % 10 === 1 && level % 100 !== 11 ? "st"
		: level % 10 === 2 && level % 100 !== 12 ? "nd"
			: level % 10 === 3 && level % 100 !== 13 ? "rd"
				: "th";
	return `${level}${suffix}`;
}

function refSection (title, refs) {
	if (!refs.length) return [];
	return ["", `## ${title}`, "", ...refs.map(ref => `- ${refText(ref)}`)];
}

function spellText (spell, play) {
	const name = spell.name || spell.label;
	const prepared = spell.alwaysPrepared || (play?.prepared || []).includes(name) ? "prepared" : "";
	const meta = [prepared, spell.list, spell.school, spell.concentration ? "concentration" : "", spell.ritual ? "ritual" : ""].filter(Boolean);
	const detail = [spell.castingTime, spell.range, spell.duration, spell.components, spell.attack, spell.save].filter(Boolean);
	const bits = [refText(spell)];
	if (meta.length) bits.push(meta.join(", "));
	if (detail.length) bits.push(detail.join(" · "));
	return bits.join(" — ");
}

function refText (ref) {
	const label = ref.label || ref.name || "";
	const qty = Number(ref.qty) > 1 ? ` ×${ref.qty}` : "";
	const equipped = ref.equipped ? " (equipped)" : "";
	const attuned = ref.attuned ? " (attuned)" : "";
	const rarity = ref.rarity ? ` · ${ref.rarity}` : "";
	const weight = Number(ref.weight) > 0 ? ` · ${ref.weight} lb` : "";
	const charges = Number(ref.charges) > 0 ? ` · ${ref.charges} charges` : "";
	const source = sourceAbbr(ref.source);
	const book = source ? ` · ${source}` : "";
	return `${label}${qty}${equipped}${attuned}${rarity}${weight}${charges}${book}`;
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

function abilityLines (card) {
	const lines = ["## Abilities", ""];
	const saves = new Map((card.rolls?.saves || []).map(save => [save.key, save]));
	for (const key of ABILITY_KEYS) {
		const score = card.abilities?.[key];
		if (score == null) continue;
		const check = modifierFromScore(score);
		const save = saves.get(key);
		const mods = save ? `${signed(check)} / ${signed(save.mod)}${save.proficient ? " PB" : ""}` : signed(check);
		lines.push(`- ${key.toUpperCase()} ${score} · ${mods}`);
	}
	return lines;
}

function slotLines (slots) {
	if (!slots?.length) return [];
	const lines = ["", "## Spell slots", ""];
	for (const slot of slots) {
		const label = slot.pact ? `Pact ${slot.level}` : ordinal(slot.level);
		lines.push(`- ${label} ${slot.spent}/${slot.max}`);
	}
	return lines;
}

function ordinal (level) {
	const n = Number(level) || 0;
	const suffix = n % 10 === 1 && n % 100 !== 11 ? "st"
		: n % 10 === 2 && n % 100 !== 12 ? "nd"
			: n % 10 === 3 && n % 100 !== 13 ? "rd"
				: "th";
	return `${n}${suffix}`;
}

function skillLines (rolls) {
	if (!rolls?.skills?.length) return [];
	const lines = ["", "## Skills", ""];
	for (const skill of rolls.skills) lines.push(`- ${rollLine(skill.name, skill)}`);
	return lines;
}

function rollLine (label, row) {
	const text = `${label} ${signed(row.mod)}`;
	return row.proficient || row.expertise ? `**${text}**` : text;
}

function actionLines (actions) {
	if (!actions?.length) return [];
	const lines = ["", "## Actions", ""];
	for (const action of actions) {
		const bits = [action.name];
		if (action.source) bits.push(sourceAbbr(action.source));
		if (action.activation) bits.push(action.activation);
		if (action.uses) bits.push(`${action.uses} uses`);
		if (action.attack) bits.push(action.attack);
		if (action.range) bits.push(action.range);
		if (action.dice) bits.push(action.dice);
		if (action.damage) bits.push(action.damage);
		if (action.save) bits.push(action.save);
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

export async function setCharacterPortrait (plugin, ddbId, avatar) {
	const id = String(ddbId || "").trim();
	const record = await readCharacter(plugin, id);
	if (!record) throw new Error("Character not found.");
	const avatarPath = await writeAvatar(plugin, id, avatar);
	const body = String(record.body || "").replace(/^!\[\[[^\]]+\]\]\s*/, "");
	await writeFile(plugin, record.path, serializeCampaignMarkdown({
		fields: record.fields,
		body: `![[${avatarPath}|80]]\n\n${body}`,
		snapshot: record.snapshot,
	}));
	return readCharacter(plugin, id);
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
