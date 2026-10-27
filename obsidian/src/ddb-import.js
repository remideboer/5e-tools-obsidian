import {requestUrl} from "obsidian";
import {DEFAULT_SETTINGS} from "./constants.js";

const ABILITIES = [
	{key: "str", id: 1, subType: "strength-score"},
	{key: "dex", id: 2, subType: "dexterity-score"},
	{key: "con", id: 3, subType: "constitution-score"},
	{key: "int", id: 4, subType: "intelligence-score"},
	{key: "wis", id: 5, subType: "wisdom-score"},
	{key: "cha", id: 6, subType: "charisma-score"},
];

export function extractDdbId (input) {
	const text = String(input || "").trim();
	const fromUrl = text.match(/\/characters\/(\d+)/i);
	if (fromUrl) return fromUrl[1];
	return /^\d+$/.test(text) ? text : "";
}

export function ddbProxyBase (plugin) {
	const raw = String(plugin?.settings?.ddbProxyUrl || DEFAULT_SETTINGS.ddbProxyUrl || "").trim();
	return (raw || DEFAULT_SETTINGS.ddbProxyUrl).replace(/\/+$/, "");
}

/** Public character only. Returns a slim card; `avatar` is `{bytes, ext}` or null. */
export async function importDdbCharacter (plugin, idOrUrl) {
	const id = extractDdbId(idOrUrl);
	if (!id) throw new Error("Enter a D&D Beyond character URL or numeric id.");
	const payload = await fetchCharacterPayload(plugin, id);
	const card = mapDdbCharacter(payload, id);
	card.avatar = await fetchAvatar(plugin, payload?.data);
	return card;
}

export function mapDdbCharacter (payload, requestedId) {
	const char = payload?.data;
	if (!char || typeof char !== "object") {
		throw new Error("Unexpected D&D Beyond response. Is the character set to Public?");
	}
	const abilities = abilityScores(char);
	const classes = Array.isArray(char.classes) ? char.classes : [];
	const level = classes.reduce((sum, cl) => sum + (Number(cl?.level) || 0), 0) || 1;
	const conMod = modifier(abilities.con);
	const hp = hitPoints(char, conMod, level);
	const speed = char.race?.weightSpeeds?.normal?.walk;
	return {
		ddbId: String(char.id || requestedId || ""),
		name: String(char.name || "Unnamed").trim() || "Unnamed",
		species: String(char.race?.fullName || char.race?.baseName || "").trim(),
		classes: classes.map(classLabel).filter(Boolean).join(" / "),
		level,
		background: String(char.background?.definition?.name || "").trim(),
		ac: armorClass(char, abilities.dex),
		hpMax: hp.max,
		hpCurrent: hp.current,
		tempHp: hp.temp,
		speed: Number.isFinite(Number(speed)) ? Number(speed) : null,
		abilities,
		equipped: equippedLines(char),
		spells: spellNames(char),
		coins: char.currencies || {},
		avatar: null,
	};
}

async function fetchCharacterPayload (plugin, id) {
	const url = `${ddbProxyBase(plugin)}/?id=${encodeURIComponent(id)}`;
	const {ok, status, body} = await requestJson(url);
	if (!ok) throw new Error(proxyErrorMessage(status, body));
	if (!body?.data) throw new Error("Unexpected D&D Beyond response. Is the character set to Public?");
	return body;
}

async function fetchAvatar (plugin, char) {
	const remote = avatarSourceUrl(char);
	if (!isDdbImageUrl(remote)) return null;
	try {
		const res = await requestUrl({
			url: `${ddbProxyBase(plugin)}/?img=${encodeURIComponent(remote)}`,
			headers: {Accept: "image/*"},
		});
		if (res.status && res.status >= 400) return null;
		const type = headerValue(res.headers, "content-type").split(";")[0].trim().toLowerCase();
		if (!type.startsWith("image/")) return null;
		const bytes = new Uint8Array(res.arrayBuffer);
		if (!bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024) return null;
		return {bytes, ext: extensionForImage(type)};
	} catch (_) {
		return null;
	}
}

function avatarSourceUrl (char) {
	const dec = char?.decorations || {};
	return dec.avatarUrl
		|| dec.thumbnailBackdropAvatarUrl
		|| dec.defaultBackdrop?.thumbnailBackdropAvatarUrl
		|| "";
}

function isDdbImageUrl (raw) {
	try {
		const url = new URL(raw);
		const host = url.hostname.toLowerCase();
		return url.protocol === "https:" && (host === "dndbeyond.com" || host.endsWith(".dndbeyond.com"));
	} catch (_) {
		return false;
	}
}

function extensionForImage (type) {
	if (type === "image/png") return ".png";
	if (type === "image/jpeg" || type === "image/jpg") return ".jpg";
	if (type === "image/gif") return ".gif";
	return ".webp";
}

function abilityScores (char) {
	const subTypeToId = Object.fromEntries(ABILITIES.map(it => [it.subType, it.id]));
	const lists = ["class", "race", "background", "feat", "item"];
	const modBonuses = lists.flatMap(key => char.modifiers?.[key] || [])
		.filter(mod => mod?.type === "bonus" && subTypeToId[mod.subType] != null && mod.value != null)
		.map(mod => ({id: subTypeToId[mod.subType], value: Number(mod.value) || 0}));
	const bonusStats = [...(char.bonusStats || []).filter(it => it?.value != null), ...modBonuses];
	const stats = char.stats || [];
	const overrides = char.overrideStats || [];
	const score = (id) => {
		const base = stats.find(it => it?.id === id)?.value ?? 10;
		const override = overrides.find(it => it?.id === id)?.value;
		if (override != null) return Number(override) || 0;
		const bonus = bonusStats.filter(it => it.id === id).reduce((sum, it) => sum + (Number(it.value) || 0), 0);
		return (Number(base) || 0) + bonus;
	};
	const out = {};
	for (const ability of ABILITIES) out[ability.key] = score(ability.id);
	return out;
}

function hitPoints (char, conMod, level) {
	let max = null;
	if (char.overrideHitPoints != null) max = Number(char.overrideHitPoints) || 0;
	else if (char.baseHitPoints != null) {
		max = (Number(char.baseHitPoints) || 0) + (Number(char.bonusHitPoints) || 0) + conMod * level;
	}
	if (max == null) return {max: null, current: null, temp: 0};
	const removed = Number(char.removedHitPoints) || 0;
	return {
		max,
		current: Math.max(0, max - removed),
		temp: Math.max(0, Number(char.temporaryHitPoints) || 0),
	};
}

function armorClass (char, dexScore) {
	const dex = modifier(dexScore);
	const equipped = (Array.isArray(char.inventory) ? char.inventory : [])
		.filter(item => item?.equipped && item.definition);
	const armor = equipped.find(item => isWornArmor(item.definition));
	const shield = equipped.find(item => isShield(item.definition));
	let ac = 10 + dex;
	if (armor) {
		ac = (Number(armor.definition.armorClass) || 0) + dexForArmor(armor.definition.armorTypeId, dex) + magicBonus(armor.definition.name);
	}
	if (shield) ac += 2 + magicBonus(shield.definition.name);
	return ac;
}

function isWornArmor (def) {
	const id = def?.armorTypeId;
	return id === 1 || id === 2 || id === 3;
}

function isShield (def) {
	return def?.armorTypeId === 4 || /\bshield\b/i.test(def?.name || "");
}

function dexForArmor (typeId, dexMod) {
	if (typeId === 3) return 0;
	if (typeId === 2) return Math.min(dexMod, 2);
	return dexMod;
}

function magicBonus (name) {
	const match = String(name || "").match(/^\+(\d+)\b/);
	return match ? Number(match[1]) : 0;
}

function classLabel (cl) {
	const name = String(cl?.definition?.name || "").trim();
	if (!name) return "";
	const level = Number(cl?.level) || 0;
	const sub = String(cl?.subclassDefinition?.name || "").trim();
	const core = `${name} ${level}`.trim();
	return sub ? `${core} (${sub})` : core;
}

function equippedLines (char) {
	const lines = [];
	for (const item of Array.isArray(char.inventory) ? char.inventory : []) {
		if (!item?.equipped || !item.definition?.name) continue;
		const name = String(item.definition.name).trim();
		if (!name) continue;
		const qty = Number(item.quantity) || 1;
		lines.push(qty > 1 ? `${name} ×${qty}` : name);
	}
	return lines;
}

function spellNames (char) {
	const names = [];
	const push = (list) => {
		for (const entry of list || []) {
			const name = String(entry?.definition?.name || entry?.name || "").trim();
			if (name) names.push(name);
		}
	};
	const spells = char.spells || {};
	push(spells.class);
	push(spells.race);
	push(spells.feat);
	push(spells.item);
	push(spells.background);
	for (const block of char.classSpells || []) push(block?.spells);
	const seen = new Set();
	const out = [];
	for (const name of names) {
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(name);
	}
	out.sort((a, b) => a.localeCompare(b));
	return out;
}

function modifier (score) {
	return Math.floor(((Number(score) || 10) - 10) / 2);
}

function proxyErrorMessage (status, body) {
	const code = body?.error;
	if (code === "private" || status === 403) {
		return "Character is private. Set it to Public on D&D Beyond, then try again.";
	}
	if (code === "not_found" || status === 404) return "Character not found on D&D Beyond.";
	if (body?.message && code !== "upstream_error") return String(body.message);
	if (status) return `D&D Beyond returned HTTP ${status}.`;
	return "Could not reach the D&D Beyond proxy.";
}

async function requestJson (url) {
	try {
		const res = await requestUrl({url, headers: {Accept: "application/json"}});
		const body = jsonBody(res);
		if (res.status && res.status >= 400) return {ok: false, status: res.status, body};
		return {ok: true, status: res.status || 200, body};
	} catch (err) {
		const status = Number(err?.status) || 0;
		const body = jsonBody(err);
		if (status) return {ok: false, status, body};
		throw new Error(err?.message || "Could not reach the D&D Beyond proxy.");
	}
}

function jsonBody (res) {
	if (res?.json && typeof res.json === "object") return res.json;
	try { return JSON.parse(String(res?.text || "")); } catch (_) { return null; }
}

function headerValue (headers, name) {
	if (!headers) return "";
	if (typeof headers.get === "function") return String(headers.get(name) || headers.get(name.toLowerCase()) || "");
	const target = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (String(key).toLowerCase() === target) return String(value || "");
	}
	return "";
}
