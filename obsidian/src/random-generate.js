import {generateRandomEncounter, habitatSelectOptions} from "./encounter-random.js";
import {ensureLootData, listLootTables, rollSelectedTables} from "./loot-view.js";
import {readPluginJson} from "./plugin-dir.js";
import {ensureSearchIndex, findEntityDoc, listEntities} from "./search-index.js";
import {getSpellMeta} from "./spell-meta.js";

const THEME_TYPES = {
	arcana: ["W", "WD", "RD", "RG"],
	armaments: ["M", "R", "LA", "MA", "HA", "S", "A"],
	implements: ["WD", "RD", "RG", "SCF"],
	relics: ["W"],
};

const ART_TABLE = {
	Crafted: "25 GP Art Objects",
	Fancy: "250 GP Art Objects",
	Exceptional: "750 GP Art Objects",
	Fine: "2,500 GP Art Objects",
	Superior: "7,500 GP Art Objects",
};

const MATERIAL_RE = {
	Bone: /bone|ivory/i,
	Ceramic: /ceramic|porcelain|clay/i,
	Cloth: /cloth|silk|vestment|tapestry/i,
	Jewelry: /jewel|bracelet|necklace|earring/i,
	Leather: /leather|hide/i,
	Metal: /gold|silver|platinum|bronze|copper|iron|brass/i,
	Stone: /stone|marble|jade|statuette/i,
	Wood: /wood/i,
};

const SCHOOL = {
	Abjuration: "A",
	Conjuration: "C",
	Divination: "D",
	Enchantment: "E",
	Evocation: "V",
	Illusion: "I",
	Necromancy: "N",
	Transmutation: "T",
};

let tableCache = null;
let trinketRows = null;
let trapCache = null;
let schoolCache = null;

const ROW_COUNT = 10;

export async function generateRandom (plugin, opts = {}) {
	await ensureSearchIndex(plugin);
	const used = new Set();
	const rows = [];
	let title = "";
	for (let face = 1; face <= ROW_COUNT; face++) {
		const one = await generateOne(plugin, {...opts, _used: used});
		title = title || one.title;
		const lines = one.lines || [];
		rows.push({
			face,
			caption: lines.length > 1 ? (one.title || "") : "",
			lines,
			combatants: one.combatants || null,
			warning: one.warning || "",
		});
	}
	return {title: title || "Result", rows};
}

async function generateOne (plugin, opts) {
	const type = String(opts.type || "encounter");
	if (type === "encounter") return generateEncounter(plugin, opts);
	if (type === "trap") return generateTrap(plugin, opts);
	if (type === "treasure") return generateTreasure(plugin, opts);
	if (type === "npc") return generateNpc(opts);
	if (type === "trinket") return generateTrinket(plugin, opts);
	if (type === "art_object") return generateArt(plugin, opts);
	if (type === "magic_item") return generateMagicItem(opts);
	if (type === "spellbook") return generateSpellbook(plugin, opts);
	if (type === "wild_surge") return generateWildSurge(plugin, opts);
	if (type === "bastion") return generateBastion(plugin, opts);
	throw new Error("Unknown generator.");
}

export function randomHabitats () {
	return habitatSelectOptions();
}

async function generateEncounter (plugin, opts) {
	const tiers = ["low", "moderate", "high"];
	const difficulty = opts.difficulty === "any" || !opts.difficulty
		? pick(tiers)
		: opts.difficulty;
	const result = await generateRandomEncounter({
		party: {count: opts.partyCount, level: opts.level},
		difficulty,
		type: "group",
		habitat: opts.environment || "",
	});
	const lines = groupsFrom(result.combatants).map(group => ({
		text: group.count > 1 ? `${group.count} × ${group.name}` : group.name,
		doc: group.doc,
	}));
	if (opts.loot === "Individual Treasure" || opts.loot === "Treasure Hoard") {
		const cr = highestCr(result.combatants);
		const loot = await rollTreasure(plugin, {
			cr,
			lootType: opts.loot,
		});
		lines.push(...loot.lines);
	}
	return {
		title: result.info?.label ? `${result.info.label} encounter` : "Encounter",
		lines,
		combatants: result.combatants,
		warning: result.warning || "",
	};
}

async function generateTrap (plugin, opts) {
	const traps = await loadTraps(plugin);
	const level = clamp(opts.level, 1, 20, 1);
	const tier = level <= 4 ? 1 : level <= 10 ? 2 : level <= 16 ? 3 : 4;
	const danger = String(opts.danger || "").toLowerCase();
	const rated = traps.filter(trap => (trap.rating || []).some(row => {
		if (danger && String(row.threat || "").toLowerCase() !== danger) return false;
		return Number(row.tier) === tier;
	}));
	const sameDanger = danger
		? traps.filter(trap => (trap.rating || []).some(row => String(row.threat || "").toLowerCase() === danger))
		: traps;
	const pool = rated.length ? rated : (sameDanger.length ? sameDanger : traps);
	const trap = pickFresh(pool, opts._used, item => `${item._kind}:${item.source || ""}:${item.name}`);
	if (!trap) throw new Error("No traps in the library.");
	const doc = findEntityDoc(trap.name, {categoriesExact: [trap._kind], source: trap.source})
		|| findEntityDoc(trap.name, {categoriesExact: [trap._kind]});
	return {
		title: "Trap",
		lines: [{text: trap.name, doc, item: doc ? null : {name: trap.name, source: trap.source || "", categories: [trap._kind]}}],
	};
}

async function generateTreasure (plugin, opts) {
	return rollTreasure(plugin, opts);
}

async function rollTreasure (plugin, opts) {
	await ensureLootData(plugin);
	const lootType = String(opts.lootType || opts.loot || "Individual Treasure");
	const hoard = /hoard/i.test(lootType);
	const withItems = /with items|salvage/i.test(lootType);
	const cr = opts.cr || "0";
	const table = hoard ? hoardTable(cr) : individualTable(cr);
	if (!table) throw new Error("No treasure table for that challenge rating.");
	const rolled = rollSelectedTables([table.id], 1);
	const lines = (rolled.items || []).map(lootLine);
	const extra = withItems || (hoard && (opts.rarity || opts.theme));
	if (extra) {
		const item = magicItemDoc({
			rarity: opts.rarity || rarityForLevel(opts.level),
			theme: opts.theme || "",
		});
		if (item) lines.push({text: item.n, doc: item});
	}
	return {title: lootType, lines};
}

function generateNpc (opts) {
	const species = namedDoc("species", opts.species);
	const klass = namedDoc("class", opts.className || opts.classId);
	if (!species && !klass) return {title: "NPCs", lines: [{text: "No species or class in the library."}]};
	const gender = String(opts.gender || "") || pick(["Female", "Male"]);
	const name = personName(nameSyllables(species?.n), opts._used);
	const scores = abilityScores(klass?.n);
	const pronoun = gender === "Female" ? "She" : "He";
	const parts = [{text: `${name}: ${gender} `}];
	if (species) parts.push({text: species.n, doc: species});
	else parts.push({text: "Person"});
	if (klass) {
		parts.push({text: " "});
		parts.push({text: klass.n, doc: klass});
	}
	parts.push({text: `, ${pick(ALIGNMENTS)}. ${scoreLine(scores)}. ${looks(name, species?.n)} ${wears(pronoun, klass?.n)} ${hook(name)}`});
	return {title: "NPCs", lines: [{parts}]};
}

async function generateTrinket (plugin, opts) {
	const rows = await loadTrinkets(plugin);
	const row = rollFresh(rows, opts._used);
	if (!row) throw new Error("No trinket table.");
	return {title: "Trinket", lines: [taggedLine(row[1] || row[0])]};
}

async function generateArt (plugin, opts) {
	const tables = await loadTables(plugin);
	const wanted = ART_TABLE[opts.quality] || "";
	let pool = tables.filter(table => table.source === "XDMG" && /art objects/i.test(table.name || ""));
	if (wanted) pool = pool.filter(table => table.name === wanted);
	const table = pick(pool);
	if (!table) throw new Error("No art object table.");
	const material = MATERIAL_RE[opts.material];
	let rows = table.rows || [];
	if (material) {
		const matched = rows.filter(row => material.test(String(row[1] || "")));
		if (matched.length) rows = matched;
	}
	const row = rollFresh(rows, opts._used);
	return {title: table.name || "Art object", lines: [taggedLine(row?.[1] || "")]};
}

function generateMagicItem (opts) {
	const rarity = String(opts.rarity || "").toLowerCase() || rarityForLevel(opts.level);
	const theme = String(opts.theme || "").toLowerCase();
	const doc = magicItemDoc({rarity, theme, used: opts._used});
	if (!doc) throw new Error("No magic item matches those filters.");
	return {title: "Magic item", lines: [{text: doc.n, doc}]};
}

async function generateSpellbook (plugin, opts) {
	const level = clamp(opts.level, 1, 20, 1);
	const school = SCHOOL[opts.spec] || "";
	const schools = await loadSchools(plugin);
	const docs = listEntities({
		categoriesExact: ["spell"],
		spellFilters: {classes: ["wizard"]},
	});
	const byName = new Map();
	for (const doc of docs) {
		const key = String(doc.n || "").toLowerCase();
		const prev = byName.get(key);
		if (!prev || doc.s === "XPHB") byName.set(key, doc);
	}
	const spells = [...byName.values()].map(doc => {
		const meta = schools.get(`${doc.n}\0${doc.s}`) || {};
		const spellMeta = getSpellMeta(doc);
		return {
			doc,
			level: meta.level != null ? Number(meta.level) : spellMeta?.level,
			school: meta.school || "",
		};
	}).filter(spell => spell.level != null && spell.level >= 0);
	if (!spells.length) throw new Error("No wizard spells in the library.");
	const maxLevel = Math.min(9, Math.ceil(level / 2));
	const cantrips = takeSpells(spells.filter(spell => spell.level === 0), Math.min(5, 3 + Math.floor((level - 1) / 4)), school);
	const book = [];
	let remaining = 6 + 2 * (level - 1);
	for (let lv = 1; lv <= maxLevel && remaining > 0; lv++) {
		const share = lv === maxLevel ? remaining : Math.max(1, Math.floor(remaining / (maxLevel - lv + 1)));
		const got = takeSpells(spells.filter(spell => spell.level === lv), Math.min(share, remaining), school);
		book.push(...got);
		remaining -= got.length;
	}
	const lines = [...cantrips, ...book].map(spell => ({text: spell.doc.n, doc: spell.doc}));
	if (!lines.length) throw new Error("Could not fill a spellbook at that level.");
	return {title: `Level ${level} spellbook`, lines};
}

async function generateWildSurge (plugin, opts) {
	const tables = await loadTables(plugin);
	const table = tables.find(it => it.name === "Wild Magic Surge" && it.source === "XPHB")
		|| tables.find(it => it.name === "Wild Magic Surge");
	if (!table) throw new Error("No Wild Magic Surge table.");
	const row = rollFresh(table.rows || [], opts._used);
	const level = clamp(opts.level, 1, 9, 1);
	return {
		title: `Wild magic, ${ordinal(level)}-level trigger`,
		lines: [taggedLine(row?.[1] || "")],
	};
}

async function generateBastion (plugin, opts) {
	const tables = await loadTables(plugin);
	const table = tables.find(it => it.name === "Bastion Events" && it.source === "XDMG")
		|| tables.find(it => it.name === "Bastion Events");
	if (!table) throw new Error("No Bastion Events table.");
	const row = rollFresh(table.rows || [], opts._used);
	return {title: "Bastion event", lines: [taggedLine(row?.[1] || "")]};
}

function magicItemDoc ({rarity, theme, used}) {
	const types = THEME_TYPES[String(theme || "").toLowerCase()] || [];
	const filters = {
		rarities: rarity ? [String(rarity).toLowerCase()] : [],
		types,
	};
	let docs = listEntities({categoriesExact: ["item"], itemFilters: filters});
	if (!docs.length && types.length) {
		docs = listEntities({categoriesExact: ["item"], itemFilters: {rarities: filters.rarities, types: []}});
	}
	const official = docs.filter(doc => doc.s === "XDMG" || doc.s === "DMG");
	return pickFresh(official.length ? official : docs, used, doc => doc.u || doc.n);
}

function namedDoc (category, name) {
	const wanted = String(name || "").trim();
	const docs = listEntities({categoriesExact: [category]});
	if (!docs.length) return null;
	if (!wanted) return pick(docs);
	return findEntityDoc(wanted, {categoriesExact: [category]}) || pick(docs);
}

function hoardTable (cr) {
	return bandTable("hoard", cr);
}

function individualTable (cr) {
	return bandTable("individual", cr);
}

function bandTable (kind, cr) {
	const band = crBand(cr);
	const tables = listLootTables().filter(table => table.kind === kind && Number(table.crMin) === band);
	const xdmg = tables.filter(table => table.source === "XDMG");
	return (xdmg[0] || tables[0] || null);
}

function crBand (cr) {
	const n = crNumber(cr);
	if (n >= 17) return 17;
	if (n >= 11) return 11;
	if (n >= 5) return 5;
	return 0;
}

function rarityForLevel (level) {
	const n = clamp(level, 1, 20, 1);
	if (n <= 4) return "common";
	if (n <= 10) return "uncommon";
	if (n <= 16) return "rare";
	if (n <= 19) return "very rare";
	return "legendary";
}

function lootLine (item) {
	const text = item.label || item.name || "Item";
	if (!item.name) return {text};
	return {
		text: item.label || item.name,
		item: {name: item.name, source: item.source || "", label: item.label || item.name, categories: ["item"]},
	};
}

function groupsFrom (combatants) {
	const groups = [];
	for (const combatant of combatants || []) {
		const key = combatant.doc?.u || combatant.label;
		const found = groups.find(group => group.key === key);
		if (found) found.count += 1;
		else groups.push({
			key,
			doc: combatant.doc,
			name: combatant.doc?.n || combatant.label || "Creature",
			count: 1,
		});
	}
	return groups;
}

function highestCr (combatants) {
	let best = "0";
	let bestN = -1;
	for (const combatant of combatants || []) {
		const n = crNumber(combatant.cr);
		if (n > bestN) {
			bestN = n;
			best = combatant.cr || "0";
		}
	}
	return best;
}

function taggedLine (raw) {
	const text = String(raw || "");
	const re = /\{@(item|spell|creature) ([^|}]+)(?:\|([^}]+))?\}/gi;
	const parts = [];
	let last = 0;
	let match;
	while ((match = re.exec(text))) {
		if (match.index > last) parts.push({text: stripTags(text.slice(last, match.index))});
		const kind = match[1].toLowerCase();
		const source = String(match[3] || "").split("|")[0];
		const categories = kind === "item" ? ["item"] : kind === "spell" ? ["spell"] : ["bestiary"];
		parts.push({
			text: match[2],
			item: {name: match[2], source, categories},
		});
		last = match.index + match[0].length;
	}
	if (last < text.length) parts.push({text: stripTags(text.slice(last))});
	const cleaned = parts.map(part => ({...part, text: String(part.text || "").trim()})).filter(part => part.text);
	if (!cleaned.length) return {text: "—"};
	if (cleaned.length === 1) return cleaned[0];
	return {parts: cleaned};
}

function stripTags (text) {
	return String(text || "")
		.replace(/\{@\w+ ([^|}]+)[^}]*\}/g, "$1")
		.replace(/\{@dice ([^}]+)\}/g, "$1")
		.trim();
}

function rollSpan (rows) {
	const spans = (rows || []).map(row => ({row, ...parseSpan(row[0])})).filter(span => span.max >= span.min);
	if (!spans.length) return null;
	const top = Math.max(...spans.map(span => span.max));
	const roll = 1 + Math.floor(Math.random() * top);
	return (spans.find(span => roll >= span.min && roll <= span.max) || spans[spans.length - 1]).row;
}

function parseSpan (label) {
	const raw = String(label || "").replace(/[–—]/g, "-").replace(/[^\d-]/g, "");
	const parts = raw.split("-").filter(Boolean).map(Number);
	if (!parts.length || parts.some(n => !Number.isFinite(n))) return {min: 1, max: 1};
	if (parts.length === 1) return {min: parts[0] === 0 ? 100 : parts[0], max: parts[0] === 0 ? 100 : parts[0]};
	const max = parts[1] === 0 ? 100 : parts[1];
	return {min: parts[0], max};
}

function takeSpells (pool, count, school) {
	const chosen = [];
	const preferred = school ? pool.filter(spell => spell.school === school) : [];
	let left = count;
	left -= draw(preferred, Math.min(Math.ceil(count / 2), left), chosen);
	draw(pool.filter(spell => !chosen.includes(spell)), left, chosen);
	return chosen;
}

function draw (pool, count, into) {
	const copy = [...pool];
	let n = 0;
	while (n < count && copy.length) {
		const index = Math.floor(Math.random() * copy.length);
		into.push(copy.splice(index, 1)[0]);
		n += 1;
	}
	return n;
}

async function loadTables (plugin) {
	if (tableCache) return tableCache;
	const json = await readPluginJson(plugin, "data", "generated", "gendata-tables.json");
	tableCache = json.table || [];
	return tableCache;
}

async function loadTrinkets (plugin) {
	if (trinketRows) return trinketRows;
	const json = await readPluginJson(plugin, "data", "items.json");
	const item = (json.item || []).find(it => it.name === "Trinket" && it.source === "XPHB")
		|| (json.item || []).find(it => it.name === "Trinket" && it.source === "PHB");
	const table = (item?.entries || []).find(entry => entry?.type === "table");
	trinketRows = table?.rows || [];
	return trinketRows;
}

async function loadTraps (plugin) {
	if (trapCache) return trapCache;
	const json = await readPluginJson(plugin, "data", "trapshazards.json");
	trapCache = [
		...(json.trap || []).map(trap => ({...trap, _kind: "trap"})),
		...(json.hazard || []).map(trap => ({...trap, _kind: "hazard"})),
	];
	return trapCache;
}

async function loadSchools (plugin) {
	if (schoolCache) return schoolCache;
	const map = new Map();
	for (const file of ["spells-xphb.json", "spells-phb.json"]) {
		let json;
		try {
			json = await readPluginJson(plugin, "data", "spells", file);
		} catch (_) {
			continue;
		}
		for (const ent of json.spell || []) {
			if (!ent?.name) continue;
			map.set(`${ent.name}\0${ent.source || ""}`, {level: ent.level, school: ent.school || ""});
		}
	}
	schoolCache = map;
	return map;
}

function crNumber (cr) {
	const raw = String(cr?.cr ?? cr ?? "0").trim();
	if (raw.includes("/")) {
		const [a, b] = raw.split("/").map(Number);
		if (b) return a / b;
	}
	const n = Number(raw);
	return Number.isFinite(n) ? n : 0;
}

function ordinal (level) {
	const n = Number(level) || 1;
	const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
	return `${n}${suffix}`;
}

function clamp (value, min, max, fallback) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, Math.round(n)));
}

const ALIGNMENTS = ["LG", "NG", "CG", "LN", "N", "CN", "LE", "NE", "CE"];

const SYLLABLE = {
	human: ["al", "an", "bel", "cor", "da", "el", "gar", "hal", "in", "jor", "ka", "lan", "mar", "ned", "or", "per", "ric", "sar", "tor", "ul", "vin", "wyn"],
	elf: ["ae", "ael", "ari", "dar", "el", "en", "fel", "il", "la", "mir", "na", "quel", "ri", "sha", "syl", "thi", "ya"],
	dwarf: ["bal", "bron", "dak", "dur", "gar", "gim", "in", "kil", "mor", "nur", "thra", "thor", "ul", "vur"],
	halfling: ["bil", "brand", "cor", "fast", "ham", "hill", "lil", "mer", "per", "ros", "sam", "wil"],
	gnome: ["bimp", "fizz", "gell", "nam", "nock", "pim", "tock", "wink", "zook"],
	reptile: ["am", "ar", "dra", "in", "kesh", "kor", "met", "rax", "sha", "sul", "thur", "vex"],
	orc: ["dug", "gash", "gruk", "mog", "ruk", "shag", "thok", "urg"],
	fiend: ["ak", "kas", "lil", "mal", "mor", "phe", "rav", "sha", "xir", "zar"],
};

const HAIR = ["black", "brown", "blonde", "copper", "silver", "white", "red", "auburn"];
const HAIR_STYLE = ["straight", "curly", "braided", "uneven", "cropped", "long", "wavy"];
const EYES = ["grey", "blue", "green", "brown", "amber", "hazel", "gold", "violet"];
const SCALE = ["red", "green", "blue", "bronze", "gold", "silver", "black", "white", "brass", "copper"];
const BUILD = ["short", "tall", "slight", "broad-shouldered", "weathered", "rough in appearance", "exceptionally beautiful", "striking"];
const FEATURE = ["a beaked nose", "a thin mouth", "a long face", "a broken nose", "a cleft chin", "freckled cheeks"];
const ARMOR = ["hide armor", "studded leather", "a chain shirt", "scale mail", "splint armor", "a breastplate"];
const WEAPON = ["a greataxe", "a halberd", "a rapier", "a longsword", "a club", "a spear", "a shortbow", "a warhammer"];
const CLOTH = ["travel-stained clothing", "fine clothing", "modest garments", "a patched cloak", "work clothes"];
const METAL = ["pewter", "silver", "iron", "gold", "copper"];
const BEAST = ["wolf", "raven", "mastiff", "hawk", "owl", "fox", "goat", "lizard"];

function nameSyllables (species) {
	const n = String(species || "").toLowerCase();
	if (/dragon|lizard|kobold|yuan-ti|serpent/.test(n)) return SYLLABLE.reptile;
	if (/elf|eladrin|shadar/.test(n)) return SYLLABLE.elf;
	if (/dwarf|duergar/.test(n)) return SYLLABLE.dwarf;
	if (/halfling/.test(n)) return SYLLABLE.halfling;
	if (/gnome/.test(n)) return SYLLABLE.gnome;
	if (/orc|goblin|hobgoblin|bugbear/.test(n)) return SYLLABLE.orc;
	if (/tiefling/.test(n)) return SYLLABLE.fiend;
	return SYLLABLE.human;
}

function personName (syllables, used) {
	const parts = syllables?.length ? syllables : SYLLABLE.human;
	for (let attempt = 0; attempt < 12; attempt++) {
		const given = cap(joinSyllables(parts, Math.random() < 0.3 ? 3 : 2));
		const surname = Math.random() < 0.45 ? ` ${cap(joinSyllables(parts, 2))}` : "";
		const name = given + surname;
		if (!used?.has(name)) {
			used?.add(name);
			return name;
		}
	}
	const fallback = `${cap(joinSyllables(parts, 3))} ${used?.size || 1}`;
	used?.add(fallback);
	return fallback;
}

function joinSyllables (syllables, count) {
	let word = "";
	for (let i = 0; i < count; i++) word += pick(syllables);
	return word;
}

function cap (word) {
	const text = String(word || "");
	return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function abilityScores (className) {
	const keys = ["str", "dex", "con", "int", "wis", "cha"];
	const scores = {};
	for (const key of keys) scores[key] = d6(3);
	const primary = primaryAbility(className);
	if (primary) {
		const best = keys.reduce((top, key) => scores[key] > scores[top] ? key : top, keys[0]);
		if (best !== primary) {
			const swap = scores[primary];
			scores[primary] = scores[best];
			scores[best] = swap;
		}
	}
	return scores;
}

function primaryAbility (className) {
	const n = String(className || "");
	if (/barbarian|fighter|paladin/i.test(n)) return "str";
	if (/monk|ranger|rogue/i.test(n)) return "dex";
	if (/artificer|wizard/i.test(n)) return "int";
	if (/cleric|druid/i.test(n)) return "wis";
	if (/bard|sorcerer|warlock/i.test(n)) return "cha";
	return "";
}

function scoreLine (scores) {
	return `Str ${scores.str}, Dex ${scores.dex}, Con ${scores.con}, Int ${scores.int}, Wis ${scores.wis}, Cha ${scores.cha}`;
}

function looks (name, species) {
	const eyes = `${Math.random() < 0.3 ? "large " : ""}${eyeColor()}`;
	const build = Math.random() < 0.45 ? pick(BUILD) : "";
	const feature = Math.random() < 0.35 ? `, and ${pick(FEATURE)}` : "";
	const body = bodyColor(species);
	if (build) return `${name} is ${build}, with ${body} and ${eyes} eyes${feature}.`;
	return `${name} has ${body} and ${eyes} eyes${feature}.`;
}

function bodyColor (species) {
	const n = String(species || "").toLowerCase();
	if (/dragon|lizard|kobold|yuan-ti/.test(n)) return `${pick(SCALE)} scales`;
	if (/tabaxi|leonin|harengon|minotaur|bugbear/.test(n)) return `${pick(HAIR)} fur`;
	if (/aarakocra|owlin|kenku/.test(n)) return `${pick(HAIR)} feathers`;
	if (/warforged|autognome/.test(n)) return `${pick(METAL)} plating`;
	if (/tortle/.test(n)) return "a patterned shell";
	return `${pick(HAIR_STYLE)} ${pick(HAIR)} hair`;
}

function eyeColor () {
	const color = pick(EYES);
	return color === "grey" && Math.random() < 0.4 ? "light grey" : color;
}

function wears (pronoun, className) {
	const n = String(className || "");
	if (/barbarian|fighter|paladin|ranger|rogue|monk/i.test(n)) {
		return `${pronoun} wears ${pick(ARMOR)} and wields ${pick(WEAPON)}.`;
	}
	if (/cleric|druid/i.test(n)) {
		return `${pronoun} wears ${pick(CLOTH)} and a ${pick(METAL)} holy symbol.`;
	}
	return `${pronoun} wears ${pick(CLOTH)} and a ${pick(METAL)} amulet.`;
}

function hook (name) {
	const other = cap(joinSyllables(SYLLABLE.human, 2));
	const item = cap(joinSyllables(SYLLABLE.human, 2));
	const lines = [
		`${name} spent a century sealed in a warded cell.`,
		`${name} is hunting a weapon called ${item}.`,
		`${name} wants to be remembered, and little else.`,
		`${name} will not cross open water.`,
		`${name} changes plans easily and likes a risk.`,
		`${name} travels with a ${pick(SCALE)} ${pick(BEAST)} called ${other}.`,
		`${name} says the wrong thing and rarely notices.`,
		`${name} still owes a favor to ${other}.`,
		`${name} keeps a sealed letter from a dead relative.`,
		`${name} is the only one who knows where a family cache is buried.`,
	];
	return pick(lines);
}

function d6 (count) {
	let total = 0;
	for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * 6);
	return total;
}

function pickFresh (pool, used, keyOf) {
	if (!pool?.length) return null;
	const open = used ? pool.filter(item => !used.has(keyOf(item))) : pool;
	const chosen = pick(open.length ? open : pool);
	if (chosen && used) used.add(keyOf(chosen));
	return chosen;
}

function rollFresh (rows, used) {
	let chosen = null;
	for (let i = 0; i < 8; i++) {
		chosen = rollSpan(rows);
		const key = JSON.stringify(chosen);
		if (!used?.has(key)) {
			used?.add(key);
			return chosen;
		}
	}
	if (chosen && used) used.add(JSON.stringify(chosen));
	return chosen;
}

function pick (list) {
	if (!list?.length) return null;
	return list[Math.floor(Math.random() * list.length)];
}
