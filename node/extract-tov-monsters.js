import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import {getDocument, OPS} from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PDF = path.resolve(ROOT, "obsidian/docs/monster_vault_2_final_2025_08_22.pdf");
const OUT_BESTIARY = path.join(ROOT, "data", "bestiary", "bestiary-tov.json");
const OUT_FLUFF = path.join(ROOT, "data", "bestiary", "fluff-bestiary-tov.json");
const IMG_DIR = path.join(ROOT, "obsidian", "img", "bestiary", "ToV");
const INDEX = path.join(ROOT, "data", "bestiary", "index.json");
const FLUFF_INDEX = path.join(ROOT, "data", "bestiary", "fluff-index.json");
const FIRST_PAGE = 56;
const LAST_PAGE = 342;

const SIZES = {
	Tiny: "T",
	Small: "S",
	Medium: "M",
	Large: "L",
	Huge: "H",
	Gargantuan: "G",
};
const SIZE_LINE = /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+(.+)$/;
const CR_LINE = /^(.+?)\s+CR\s+(\d+\/\d+|\d+)\s*$/;
const SECTIONS = {
	ACTIONS: "action",
	"BONUS ACTIONS": "bonus",
	REACTIONS: "reaction",
	"LEGENDARY ACTIONS": "legendary",
};
const DAMAGE = new Set(["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"]);
const CONDITIONS = new Set(["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"]);

const doc = await getDocument({url: PDF, disableWorker: true}).promise;
const lines = [];
for (let n = FIRST_PAGE; n <= Math.min(LAST_PAGE, doc.numPages); n++) {
	const page = await doc.getPage(n);
	for (const text of columnTexts(await page.getTextContent())) {
		if (!text || isChrome(text)) continue;
		lines.push({page: n, text});
	}
}

const monsters = [];
let cursor = 0;
while (cursor < lines.length) {
	const found = findBlock(lines, cursor);
	if (!found) break;
	const next = findBlock(lines, found.end);
	const cut = next ? loreStart(lines, next.at, next.name) : lines.length;
	const body = lines.slice(found.end, cut);
	const monster = parseMonster(found, body);
	if (monster) monsters.push(monster);
	cursor = next ? next.at : lines.length;
}

console.log(`Parsed ${monsters.length} creatures`);
const suspicious = monsters.filter(monster => !/^[A-Z]/.test(monster.name) || monster.name.length < 3);
if (suspicious.length) console.log("Suspicious", suspicious.slice(0, 20).map(monster => monster.name).join(" | "));
fs.mkdirSync(IMG_DIR, {recursive: true});
let pictures = 0;
const fluff = [];
const byPage = new Map();
for (const monster of monsters) {
	if (!byPage.has(monster.page)) byPage.set(monster.page, []);
	byPage.get(monster.page).push(monster);
}
for (const [pageNo, group] of byPage) {
	const files = group.map(monster => ({
		monster,
		file: `${monster.name}.png`,
	}));
	if (files.every(item => fs.existsSync(path.join(IMG_DIR, item.file)))) {
		for (const item of files) {
			item.monster.ent.hasFluffImages = true;
			fluff.push(fluffEntry(item.monster.name));
			pictures += 1;
		}
		continue;
	}
	const images = await pageImages(doc, pageNo).catch(() => []);
	files.forEach((item, index) => {
		const image = images[index] || (index === 0 ? images[0] : null);
		if (!image) return;
		fs.writeFileSync(path.join(IMG_DIR, item.file), image);
		item.monster.ent.hasFluffImages = true;
		fluff.push(fluffEntry(item.monster.name));
		pictures += 1;
	});
}

const ents = monsters.map(monster => monster.ent).sort((a, b) => a.name.localeCompare(b.name));
fluff.sort((a, b) => a.name.localeCompare(b.name));
fs.mkdirSync(path.dirname(OUT_BESTIARY), {recursive: true});
fs.writeFileSync(OUT_BESTIARY, `${JSON.stringify({monster: ents}, null, "\t")}\n`);
fs.writeFileSync(OUT_FLUFF, `${JSON.stringify({
	_meta: {internalCopies: ["monsterFluff"]},
	monsterFluff: fluff,
}, null, "\t")}\n`);
patchIndex(INDEX, "ToV", "bestiary-tov.json");
patchIndex(FLUFF_INDEX, "ToV", "fluff-bestiary-tov.json");
console.log(`Wrote ${ents.length} creatures → ${path.relative(ROOT, OUT_BESTIARY)}`);
console.log(`Wrote ${fluff.length} fluff + ${pictures} pictures → ${path.relative(ROOT, IMG_DIR)}`);

function fluffEntry (name) {
	return {
		name,
		source: "ToV",
		images: [{type: "image", href: {type: "internal", path: `bestiary/ToV/${name}.png`}}],
	};
}

function patchIndex (filePath, key, value) {
	const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
	json[key] = value;
	const ordered = Object.fromEntries(Object.keys(json).sort((a, b) => a.localeCompare(b)).map(k => [k, json[k]]));
	fs.writeFileSync(filePath, `${JSON.stringify(ordered, null, "\t")}\n`);
}

function columnTexts (content) {
	const rows = new Map();
	for (const item of content.items) {
		const text = String(item.str || "").trim();
		if (!text) continue;
		const y = Math.round(item.transform[5] / 3) * 3;
		const x = item.transform[4];
		const key = `${x < 300 ? "L" : "R"}:${y}`;
		if (!rows.has(key)) rows.set(key, []);
		rows.get(key).push({x, text});
	}
	const left = [];
	const right = [];
	for (const [key, parts] of rows) {
		const line = parts.sort((a, b) => a.x - b.x).map(part => part.text).join(" ").replace(/\s+/g, " ").trim();
		if (key.startsWith("L:")) left.push({y: Number(key.slice(2)), line});
		else right.push({y: Number(key.slice(2)), line});
	}
	const order = (list) => list.sort((a, b) => b.y - a.y).map(row => row.line);
	return [...order(left), ...order(right)];
}

function isChrome (text) {
	if (/^MONSTER VAULT 2\b/i.test(text)) return true;
	if (/^\d{1,3}$/.test(text)) return true;
	if (/^[A-Z]$/.test(text)) return true;
	return false;
}

function loreStart (source, headerAt, name) {
	const needle = name.toLowerCase();
	for (let i = headerAt - 1; i >= Math.max(0, headerAt - 50); i--) {
		if (source[i].text.toLowerCase() === needle) return i;
	}
	return headerAt;
}

function findBlock (source, from) {
	for (let i = from; i < source.length - 1; i++) {
		const cr = CR_LINE.exec(source[i].text);
		if (!cr) continue;
		const name = cr[1].trim();
		if (name.length > 60 || /example monster|template/i.test(name)) continue;
		const size = SIZE_LINE.exec(source[i + 1].text);
		if (!size) continue;
		return {at: i, end: i + 2, page: source[i].page, name, cr: cr[2], size: size[1], typeLine: size[2]};
	}
	return null;
}

function parseMonster (head, bodyLines) {
	const fields = [];
	const rest = [];
	let abilities = null;
	for (const line of bodyLines) {
		if (CR_LINE.test(line.text) && SIZE_LINE.test(bodyLines[bodyLines.indexOf(line) + 1]?.text || "")) break;
		if (!abilities && /^[+\u2212\u2013\u2014\-−]\d+(?:\s+[+\u2212\u2013\u2014\-−]\d+){5}$/.test(line.text)) {
			abilities = line.text.split(/\s+/).map(readMod);
			continue;
		}
		if (!abilities) fields.push(line.text);
		else rest.push(line.text);
	}
	const ent = {
		name: head.name,
		source: "ToV",
		edition: "one",
		size: [SIZES[head.size] || "M"],
		type: head.typeLine.replace(/\s*\([^)]*\)\s*/g, " ").trim().toLowerCase() || "monstrosity",
		cr: head.cr,
	};
	const ac = fields.find(line => /^Armor Class\b/i.test(line));
	const hp = fields.find(line => /^Hit Points\b/i.test(line));
	const speed = fields.find(line => /^Speed\b/i.test(line));
	const passiveLine = fields.find(line => /^Perception\b/i.test(line));
	const senseLine = fields.find(line => /^Senses\b/i.test(line));
	const langLine = fields.find(line => /^Languages\b/i.test(line));
	if (ac) ent.ac = parseAc(ac.replace(/^Armor Class\s*/i, ""));
	if (hp) {
		const average = Number((hp.match(/\d+/) || [])[0]);
		if (Number.isFinite(average)) ent.hp = {average};
	}
	if (speed) ent.speed = parseSpeed(speed.replace(/^Speed\s*/i, ""));
	if (abilities?.length === 6) {
		["str", "dex", "con", "int", "wis", "cha"].forEach((key, index) => {
			ent[key] = Math.max(1, Math.min(30, 10 + abilities[index] * 2));
		});
	}
	applySkills(ent, passiveLine);
	applyList(ent, fields, "Vulnerable", "vulnerable");
	applyList(ent, fields, "Resistant", "resist");
	applyList(ent, fields, "Immune", "immune");
	if (senseLine) applySenses(ent, senseLine.replace(/^Senses\s*/i, ""));
	if (langLine) {
		const languages = langLine.replace(/^Languages\s*/i, "").trim();
		if (languages && languages !== "—" && languages !== "-") ent.languages = [languages];
	}
	const blocks = parseBlocks(rest);
	if (blocks.trait.length) ent.trait = blocks.trait;
	if (blocks.action.length) ent.action = blocks.action;
	if (blocks.bonus.length) ent.bonus = blocks.bonus;
	if (blocks.reaction.length) ent.reaction = blocks.reaction;
	if (blocks.legendary.length) ent.legendary = blocks.legendary;
	return {name: head.name, page: head.page, ent};
}

function readMod (token) {
	return Number(token.replace(/[\u2212\u2013\u2014−]/g, "-"));
}

function parseAc (text) {
	const match = text.match(/(\d+)\s*(?:\(([^)]+)\))?/);
	if (!match) return [10];
	if (!match[2]) return [Number(match[1])];
	return [{ac: Number(match[1]), from: [match[2].trim()]}];
}

function parseSpeed (text) {
	const speed = {};
	const walk = text.match(/^(\d+)\s*ft/);
	if (walk) speed.walk = Number(walk[1]);
	for (const kind of ["fly", "swim", "climb", "burrow"]) {
		const match = text.match(new RegExp(`${kind}\\s+(\\d+)`, "i"));
		if (match) speed[kind] = Number(match[1]);
	}
	if (text.includes("hover")) speed.canHover = true;
	return Object.keys(speed).length ? speed : {walk: 30};
}

function applySkills (ent, line) {
	if (!line) return;
	const perception = line.match(/Perception\s+(\d+)/i);
	const stealth = line.match(/Stealth\s+(\d+)/i);
	const wis = Number(ent.wis) || 10;
	if (perception) {
		const passive = Number(perception[1]);
		ent.passive = passive;
		const bonus = passive - 10;
		const wisMod = Math.floor((wis - 10) / 2);
		if (bonus !== wisMod) ent.skill = {...(ent.skill || {}), perception: signed(bonus)};
	}
	if (stealth) {
		ent.skill = {...(ent.skill || {}), stealth: signed(Number(stealth[1]) - 10)};
	}
}

function applyList (ent, fields, label, key) {
	const line = fields.find(row => new RegExp(`^${label}\\b`, "i").test(row));
	if (!line) return;
	const raw = line.replace(new RegExp(`^${label}\\s*`, "i"), "");
	const nonmagical = /nonmagical attacks/i.test(raw);
	const parts = raw.split(/[|,]| and /i).map(part => part.replace(/damage.*/i, "").trim().toLowerCase()).filter(Boolean);
	const damage = [];
	const conditions = [];
	for (const part of parts) {
		if (DAMAGE.has(part)) damage.push(part);
		else if (CONDITIONS.has(part)) conditions.push(part);
	}
	if (damage.length && nonmagical) {
		ent[key] = [{[key]: damage, note: "from nonmagical attacks", cond: true}];
	} else if (damage.length) ent[key] = damage;
	if (conditions.length && key === "immune") ent.conditionImmune = [...(ent.conditionImmune || []), ...conditions];
	if (conditions.length && key === "resist") ent.conditionImmune = [...(ent.conditionImmune || []), ...conditions];
}

function applySenses (ent, text) {
	if (!text || text === "—" || text === "-") return;
	const dark = text.match(/darkvision\s+(\d+)/i);
	if (dark) ent.darkvision = Number(dark[1]);
	const blindsight = text.match(/blindsight\s+(\d+)/i);
	if (blindsight) ent.blindsight = Number(blindsight[1]);
	const tremorsense = text.match(/tremorsense\s+(\d+)/i);
	if (tremorsense) ent.tremorsense = Number(tremorsense[1]);
	const truesight = text.match(/truesight\s+(\d+)/i);
	if (truesight) ent.truesight = Number(truesight[1]);
	const other = text
		.replace(/darkvision\s+\d+\s*ft\.?/ig, "")
		.replace(/blindsight\s+\d+\s*ft\.?/ig, "")
		.replace(/tremorsense\s+\d+\s*ft\.?/ig, "")
		.replace(/truesight\s+\d+\s*ft\.?/ig, "")
		.replace(/^[,;\s]+|[,;\s]+$/g, "")
		.trim();
	if (other && other !== "—") ent.senses = [other];
}

function parseBlocks (lines) {
	const buckets = {trait: [], action: [], bonus: [], reaction: [], legendary: []};
	let bucket = "trait";
	let current = null;
	const flush = () => {
		if (!current?.name) return;
		const text = current.lines.join(" ").replace(/\s+/g, " ").trim();
		if (text) buckets[bucket].push({name: current.name, entries: [text]});
		current = null;
	};
	for (const line of lines) {
		if (SECTIONS[line]) {
			flush();
			bucket = SECTIONS[line];
			continue;
		}
		const named = /^([A-Z][^.]{1,70}?)\.\s+(.*)$/.exec(line);
		const open = current && !/[.!?]"?$/.test(current.lines[current.lines.length - 1] || "");
		if (named && open && named[1].split(/\s+/).length <= 4) {
			current.lines.push(line);
			continue;
		}
		if (named) {
			flush();
			current = {name: named[1].trim(), lines: [named[2]]};
			continue;
		}
		if (current) current.lines.push(line);
	}
	flush();
	return buckets;
}

function signed (n) {
	const value = Number(n) || 0;
	return value >= 0 ? `+${value}` : String(value);
}

function slug (name) {
	return String(name || "creature").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "creature";
}

async function pageImages (pdf, pageNo) {
	const page = await pdf.getPage(pageNo);
	const ops = await page.getOperatorList();
	const names = [];
	for (let i = 0; i < ops.fnArray.length; i++) {
		if (ops.fnArray[i] === OPS.paintImageXObject) names.push(ops.argsArray[i][0]);
	}
	const images = [];
	for (const name of names) {
		const img = await new Promise((resolve) => {
			const timer = setTimeout(() => resolve(null), 2000);
			page.objs.get(name, (value) => {
				clearTimeout(timer);
				resolve(value);
			});
		});
		if (!img?.data || img.width < 200 || img.height < 200) continue;
		if (img.width >= 2400 || img.height >= 2400) continue;
		const channels = Math.round(img.data.length / (img.width * img.height));
		if (![1, 2, 3, 4].includes(channels)) continue;
		if (img.data.length < img.width * img.height * channels) continue;
		const png = await sharp(Buffer.from(img.data), {
			raw: {width: img.width, height: img.height, channels},
		}).resize({width: 640, height: 640, fit: "inside", withoutEnlargement: true}).png().toBuffer();
		images.push({area: img.width * img.height, png});
	}
	images.sort((a, b) => b.area - a.area);
	return images.map(image => image.png);
}
