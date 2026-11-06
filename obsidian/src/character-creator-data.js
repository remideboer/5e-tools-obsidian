import {getParser} from "./fiveetools-host.js";
import {ABILITY_LABELS, backgroundAbilityOptionsList} from "./character-creator-state.js";

let cache = null;

export async function loadCreatorCatalog () {
	if (cache) return cache;
	const DataUtil = globalThis.DataUtil;
	if (!DataUtil?.class?.loadRawJSON || !DataUtil?.race?.loadJSON || !DataUtil?.loadJSON) {
		throw new Error("5etools data helpers are not ready.");
	}
	const [classRaw, raceRaw, backgroundRaw] = await Promise.all([
		DataUtil.class.loadRawJSON(),
		DataUtil.race.loadJSON({isAddBaseRaces: true}),
		DataUtil.loadJSON(`${globalThis.Renderer.get().baseUrl}data/backgrounds.json`),
	]);
	const classes = (classRaw?.class || [])
		.filter(ent => isXphb(ent))
		.map(ent => summarizeClass(ent))
		.sort((a, b) => a.name.localeCompare(b.name));
	const classNames = new Set(classes.map(ent => ent.name));
	const subclasses = (classRaw?.subclass || [])
		.filter(ent => ent?.classSource === "XPHB" && classNames.has(ent.className))
		.map(ent => summarizeSubclass(ent))
		.sort((a, b) => a.name.localeCompare(b.name));
	const species = (raceRaw?.race || [])
		.filter(ent => isXphb(ent) && !ent._isBaseRace)
		.map(ent => summarizeSpecies(ent))
		.sort((a, b) => a.name.localeCompare(b.name));
	const backgrounds = (backgroundRaw?.background || [])
		.filter(ent => isXphb(ent))
		.map(ent => summarizeBackground(ent))
		.sort((a, b) => a.name.localeCompare(b.name));
	cache = {
		classes,
		subclasses,
		species,
		backgrounds,
		byKey: indexByKey({classes, subclasses, species, backgrounds}),
	};
	return cache;
}

function isXphb (ent) {
	return String(ent?.source || "") === "XPHB";
}

function indexByKey ({classes, subclasses, species, backgrounds}) {
	const map = new Map();
	for (const ent of classes) map.set(`class:${ent.name}|${ent.source}`, ent);
	for (const ent of subclasses || []) {
		map.set(`subclass:${ent.name}|${ent.source}|${ent.className}`, ent);
		if (ent.shortName) map.set(`subclass:${ent.shortName}|${ent.source}|${ent.className}`, ent);
	}
	for (const ent of species) map.set(`species:${ent.name}|${ent.source}`, ent);
	for (const ent of backgrounds) map.set(`background:${ent.name}|${ent.source}`, ent);
	return map;
}

export function findClass (catalog, name, source = "XPHB") {
	return catalog?.byKey?.get(`class:${name}|${source}`) || null;
}

export function findSubclass (catalog, name, source, className) {
	if (!name || !className) return null;
	return catalog?.byKey?.get(`subclass:${name}|${source}|${className}`)
		|| (catalog?.subclasses || []).find(sub => (
			sub.className === className
			&& (sub.name === name || sub.shortName === name)
			&& (!source || sub.source === source)
		))
		|| null;
}

export function findSpecies (catalog, name, source = "XPHB") {
	return catalog?.byKey?.get(`species:${name}|${source}`) || null;
}

export function findBackground (catalog, name, source = "XPHB") {
	return catalog?.byKey?.get(`background:${name}|${source}`) || null;
}

function summarizeClass (ent) {
	const hd = ent.hd || {};
	const primary = (ent.primaryAbility || [])
		.flatMap(row => Object.keys(row || {}).filter(key => row[key]))
		.map(key => ABILITY_LABELS[key] || key.toUpperCase());
	const saves = (ent.proficiency || []).map(key => ABILITY_LABELS[key] || key.toUpperCase());
	return {
		kind: "class",
		name: ent.name,
		source: ent.source,
		hdFaces: Number(hd.faces) || 8,
		primary,
		saves,
		teaser: `Hit Die d${Number(hd.faces) || 8}${primary.length ? ` · ${primary.join(" or ")}` : ""}`,
		detail: [
			primary.length ? `Primary: ${primary.join(" or ")}` : "",
			saves.length ? `Saving Throws: ${saves.join(", ")}` : "",
			`Hit Die: d${Number(hd.faces) || 8}`,
		].filter(Boolean).join("\n"),
		raw: ent,
		packages: equipmentPackages(ent.startingEquipment?.defaultData),
		goldAlternative: String(ent.startingEquipment?.goldAlternative || "").trim(),
		skillChoices: classSkillChoices(ent),
		fixedSkills: fixedSkillNames(ent.startingProficiencies?.skills),
	};
}

function summarizeSubclass (ent) {
	const label = ent.shortName || ent.name;
	const teaser = String(ent.subclassTitle || ent.name || "").trim();
	const firstFeature = Array.isArray(ent.subclassFeatures) ? ent.subclassFeatures[0] : "";
	const featureName = typeof firstFeature === "string"
		? firstFeature.split("|")[0]
		: "";
	return {
		kind: "subclass",
		name: ent.name,
		shortName: ent.shortName || ent.name,
		source: ent.source,
		className: ent.className,
		classSource: ent.classSource,
		teaser: featureName ? `${label} · ${featureName}` : label,
		detail: [
			`Subclass: ${ent.name}`,
			ent.subclassTitle ? `Type: ${ent.subclassTitle}` : "",
			featureName ? `Starts with: ${featureName}` : "",
		].filter(Boolean).join("\n"),
		raw: ent,
	};
}

function summarizeSpecies (ent) {
	const speed = speciesSpeed(ent);
	const size = Array.isArray(ent.size) ? ent.size.join("/") : String(ent.size || "");
	const traits = (ent.entries || [])
		.filter(entry => entry?.type === "entries" && entry.name)
		.map(entry => entry.name);
	return {
		kind: "species",
		name: ent.name,
		source: ent.source,
		speed,
		size,
		teaser: [speed ? `${speed} ft.` : "", size ? `Size ${size}` : ""].filter(Boolean).join(" · "),
		detail: [
			speed ? `Speed: ${speed} ft.` : "",
			size ? `Size: ${size}` : "",
			traits.length ? `Traits: ${traits.join(", ")}` : "",
		].filter(Boolean).join("\n"),
		traits,
		raw: ent,
	};
}

function summarizeBackground (ent) {
	const skills = fixedSkillNames(ent.skillProficiencies);
	const tools = Object.keys(Object.assign({}, ...(ent.toolProficiencies || [])))
		.filter(key => key !== "choose" && key !== "any" && key !== "anyArtisansTool");
	const feat = backgroundFeatName(ent);
	const abilityModes = backgroundAbilityOptionsList(ent);
	const ability = abilityModes[0] || null;
	return {
		kind: "background",
		name: ent.name,
		source: ent.source,
		skills,
		tools,
		feat,
		ability,
		abilityModes,
		teaser: [skills.length ? skills.join(", ") : "", feat ? `Feat: ${feat}` : ""].filter(Boolean).join(" · "),
		detail: [
			abilityModes.length
				? `Ability Scores: ${abilityModes.map(mode => mode.weights.map(w => `+${w}`).join("/")).join(" or ")} from ${ability.from.map(key => ABILITY_LABELS[key] || key).join(", ")}`
				: "",
			feat ? `Feat: ${feat}` : "",
			skills.length ? `Skills: ${skills.join(", ")}` : "",
			tools.length ? `Tools: ${tools.join(", ")}` : "",
		].filter(Boolean).join("\n"),
		raw: ent,
		packages: equipmentPackages(ent.startingEquipment),
	};
}

function speciesSpeed (ent) {
	if (typeof ent?.speed === "number") return ent.speed;
	if (ent?.speed && typeof ent.speed === "object") return Number(ent.speed.walk) || Number(ent.speed.choose) || 30;
	return 30;
}

function classSkillChoices (ent) {
	const skills = ent?.startingProficiencies?.skills;
	if (!Array.isArray(skills)) return null;
	for (const row of skills) {
		if (row?.choose?.from?.length) {
			return {
				from: row.choose.from.map(name => titleSkill(name)),
				count: Number(row.choose.count) || 1,
			};
		}
	}
	return null;
}

function fixedSkillNames (rows) {
	if (!Array.isArray(rows)) return [];
	const names = [];
	for (const row of rows) {
		if (!row || typeof row !== "object") continue;
		for (const [key, value] of Object.entries(row)) {
			if (key === "choose" || key === "any" || !value) continue;
			names.push(titleSkill(key));
		}
	}
	return names;
}

function titleSkill (name) {
	return String(name || "")
		.split(/[\s_-]+/)
		.filter(Boolean)
		.map(part => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function backgroundFeatName (ent) {
	const feats = ent?.feats;
	if (!Array.isArray(feats) || !feats.length) return "";
	const key = Object.keys(feats[0] || {})[0] || "";
	if (!key) return "";
	const [name] = key.split("|");
	return titleSkill(String(name || "").split(";")[0].trim());
}

/** Normalize startingEquipment defaultData / background arrays into labeled packages. */
export function equipmentPackages (data) {
	const rows = Array.isArray(data) ? data : [];
	const out = [];
	for (const row of rows) {
		if (!row || typeof row !== "object") continue;
		for (const [label, items] of Object.entries(row)) {
			if (!/^[A-Za-z]$/.test(label)) continue;
			out.push({
				id: label.toUpperCase(),
				label: `Package ${label.toUpperCase()}`,
				items: flattenEquipmentItems(items),
				summary: summarizeEquipmentItems(items),
			});
		}
	}
	return out;
}

function flattenEquipmentItems (items) {
	if (!Array.isArray(items)) return [];
	const out = [];
	for (const item of items) {
		if (typeof item === "string") {
			out.push({uid: item, name: displayItemName(item), quantity: 1, valueCp: 0});
			continue;
		}
		if (item && typeof item === "object") {
			if (item.item) {
				out.push({
					uid: item.item,
					name: item.displayName || displayItemName(item.item),
					quantity: Number(item.quantity) || 1,
					valueCp: 0,
				});
			} else if (item.value != null) {
				out.push({uid: "", name: "", quantity: 1, valueCp: Number(item.value) || 0});
			}
		}
	}
	return out;
}

function summarizeEquipmentItems (items) {
	const parts = [];
	let cp = 0;
	for (const item of flattenEquipmentItems(items)) {
		if (item.valueCp) cp += item.valueCp;
		else if (item.name) parts.push(item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name);
	}
	if (cp) parts.push(`${formatGp(cp)} GP`);
	return parts.join(", ");
}

export function displayItemName (uid) {
	const Parser = getParser();
	const raw = String(uid || "").split("|")[0].trim();
	if (!raw) return "";
	if (Parser?.item_getReadableName) {
		try { return Parser.item_getReadableName(raw) || titleSkill(raw); } catch (_) { /* fall through */ }
	}
	return titleSkill(raw);
}

export function formatGp (cp) {
	const gp = (Number(cp) || 0) / 100;
	return Number.isInteger(gp) ? String(gp) : gp.toFixed(2).replace(/\.?0+$/, "");
}

export function parseGoldAlternative (text) {
	const match = String(text || "").match(/(\d+)\s*g/i);
	if (!match) return 0;
	return Number(match[1]) * 100;
}
