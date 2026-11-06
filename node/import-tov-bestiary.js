/**
 * Move Tales of the Valiant creatures from vault homebrew into site bestiary data.
 *
 * Reads:  {vault}/5etools/_homebrew/homebrew.json + img/tov-*.png
 * Writes: data/bestiary/bestiary-tov.json
 *         data/bestiary/fluff-bestiary-tov.json
 *         obsidian/img/bestiary/ToV/{Name}.png
 *         updates bestiary index + fluff-index
 * Optionally strips ToV from the vault homebrew file (--strip-brew).
 *
 *   node node/import-tov-bestiary.js
 *   node node/import-tov-bestiary.js --strip-brew
 */
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const VAULT = process.env.TOV_VAULT || "C:\\Users\\remid\\Documents\\Obsidian Vault";
const BREW_FILE = path.join(VAULT, "5etools", "_homebrew", "homebrew.json");
const BREW_IMG = path.join(VAULT, "5etools", "_homebrew", "img");
const OUT_BESTIARY = path.join(root, "data", "bestiary", "bestiary-tov.json");
const OUT_FLUFF = path.join(root, "data", "bestiary", "fluff-bestiary-tov.json");
const OUT_IMG = path.join(root, "obsidian", "img", "bestiary", "ToV");
const INDEX = path.join(root, "data", "bestiary", "index.json");
const FLUFF_INDEX = path.join(root, "data", "bestiary", "fluff-index.json");
const stripBrew = process.argv.includes("--strip-brew");

function slug (name) {
	return String(name || "")
		.toLowerCase()
		.replace(/['']/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function cleanText (value) {
	return String(value || "")
		.replace(/\s*B\s+B\s+MONSTER VAULT 2\b[\s\S]*$/i, "")
		.replace(/\bMONSTER VAULT 2\b/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

function cleanEntries (entries) {
	if (!Array.isArray(entries)) return entries;
	return entries
		.map(entry => {
			if (typeof entry === "string") return cleanText(entry);
			if (entry && typeof entry === "object") {
				const next = {...entry};
				if (next.name) next.name = cleanText(next.name);
				if (next.entries) next.entries = cleanEntries(next.entries);
				return next;
			}
			return entry;
		})
		.filter(entry => {
			if (typeof entry === "string") return entry.length > 0;
			if (entry?.entries) return entry.entries.length > 0;
			return true;
		});
}

function cleanBlock (list) {
	if (!Array.isArray(list)) return list;
	return list
		.map(item => {
			const next = {...item};
			if (next.name) next.name = cleanText(next.name);
			if (next.entries) next.entries = cleanEntries(next.entries);
			return next;
		})
		.filter(item => item.name || (item.entries && item.entries.length));
}

function toSiteMonster (raw) {
	const ent = {...raw};
	delete ent._homebrewImage;
	delete ent.__prop;
	ent.source = "ToV";
	for (const key of ["trait", "action", "bonus", "reaction", "legendary", "mythic", "legendaryHeader"]) {
		if (ent[key]) ent[key] = cleanBlock(ent[key]);
	}
	if (Array.isArray(ent.languages)) {
		ent.languages = ent.languages.map(cleanText).filter(Boolean);
	}
	return ent;
}

function imageFileName (name) {
	return `${name}.png`;
}

function fluffHrefPath (name) {
	return `bestiary/ToV/${imageFileName(name)}`;
}

function ensureIndexEntry (filePath, key, value) {
	const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
	if (json[key] === value) return false;
	json[key] = value;
	const ordered = Object.fromEntries(Object.keys(json).sort((a, b) => a.localeCompare(b)).map(k => [k, json[k]]));
	fs.writeFileSync(filePath, `${JSON.stringify(ordered, null, "\t")}\n`);
	return true;
}

if (!fs.existsSync(BREW_FILE)) {
	console.error(`No homebrew file at ${BREW_FILE}`);
	process.exit(1);
}

const brew = JSON.parse(fs.readFileSync(BREW_FILE, "utf8"));
const tov = (brew.monster || []).filter(monster => monster?.source === "ToV" && monster?.name);
if (!tov.length) {
	console.error("No ToV monsters found in vault homebrew.");
	process.exit(1);
}

fs.mkdirSync(OUT_IMG, {recursive: true});
const monsters = [];
const fluff = [];
let pictures = 0;
let missingPictures = 0;

for (const raw of tov) {
	const ent = toSiteMonster(raw);
	monsters.push(ent);

	const brewRel = String(raw._homebrewImage || "").trim();
	const brewName = brewRel ? path.basename(brewRel) : `tov-${slug(ent.name)}.png`;
	const srcImg = path.join(BREW_IMG, brewName);
	const destName = imageFileName(ent.name);
	const destImg = path.join(OUT_IMG, destName);

	if (fs.existsSync(srcImg)) {
		fs.copyFileSync(srcImg, destImg);
		pictures += 1;
		fluff.push({
			name: ent.name,
			source: "ToV",
			images: [
				{
					type: "image",
					href: {
						type: "internal",
						path: fluffHrefPath(ent.name),
					},
				},
			],
		});
	} else if (fs.existsSync(destImg)) {
		pictures += 1;
		fluff.push({
			name: ent.name,
			source: "ToV",
			images: [
				{
					type: "image",
					href: {
						type: "internal",
						path: fluffHrefPath(ent.name),
					},
				},
			],
		});
	} else {
		missingPictures += 1;
	}
}

monsters.sort((a, b) => a.name.localeCompare(b.name));
fluff.sort((a, b) => a.name.localeCompare(b.name));

fs.mkdirSync(path.dirname(OUT_BESTIARY), {recursive: true});
fs.writeFileSync(OUT_BESTIARY, `${JSON.stringify({monster: monsters}, null, "\t")}\n`);
fs.writeFileSync(OUT_FLUFF, `${JSON.stringify({
	_meta: {internalCopies: ["monsterFluff"]},
	monsterFluff: fluff,
}, null, "\t")}\n`);

ensureIndexEntry(INDEX, "ToV", "bestiary-tov.json");
ensureIndexEntry(FLUFF_INDEX, "ToV", "fluff-bestiary-tov.json");

if (stripBrew) {
	brew.monster = (brew.monster || []).filter(monster => monster?.source !== "ToV");
	if (Array.isArray(brew._meta?.sources)) {
		brew._meta.sources = brew._meta.sources.filter(source => source?.json !== "ToV");
	}
	fs.writeFileSync(BREW_FILE, `${JSON.stringify(brew, null, "\t")}\n`);
	console.log(`Stripped ToV from ${BREW_FILE}`);
}

console.log(`Wrote ${monsters.length} creatures → ${path.relative(root, OUT_BESTIARY)}`);
console.log(`Wrote ${fluff.length} fluff entries → ${path.relative(root, OUT_FLUFF)}`);
console.log(`Copied ${pictures} pictures → ${path.relative(root, OUT_IMG)} (${missingPictures} without art)`);
