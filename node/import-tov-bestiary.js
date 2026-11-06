/**
 * Move Tales of the Valiant creatures from vault homebrew into site bestiary data.
 *
 * Reads:  {vault}/5etools/_homebrew/homebrew.json
 * Writes: data/bestiary/bestiary-tov.json (+ empty fluff stub)
 *         updates bestiary index + fluff-index
 * Art stays in the vault at 5etools/_homebrew/img/tov-*.png (not in git).
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
const OUT_BESTIARY = path.join(root, "data", "bestiary", "bestiary-tov.json");
const OUT_FLUFF = path.join(root, "data", "bestiary", "fluff-bestiary-tov.json");
const INDEX = path.join(root, "data", "bestiary", "index.json");
const FLUFF_INDEX = path.join(root, "data", "bestiary", "fluff-index.json");
const stripBrew = process.argv.includes("--strip-brew");

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
	delete ent.hasFluffImages;
	ent.source = "ToV";
	for (const key of ["trait", "action", "bonus", "reaction", "legendary", "mythic", "legendaryHeader"]) {
		if (ent[key]) ent[key] = cleanBlock(ent[key]);
	}
	if (Array.isArray(ent.languages)) {
		ent.languages = ent.languages.map(cleanText).filter(Boolean);
	}
	return ent;
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

const monsters = tov.map(toSiteMonster).sort((a, b) => a.name.localeCompare(b.name));

fs.mkdirSync(path.dirname(OUT_BESTIARY), {recursive: true});
fs.writeFileSync(OUT_BESTIARY, `${JSON.stringify({monster: monsters}, null, "\t")}\n`);
fs.writeFileSync(OUT_FLUFF, `${JSON.stringify({
	_meta: {internalCopies: ["monsterFluff"]},
	monsterFluff: [],
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
console.log("Art stays in vault 5etools/_homebrew/img/ (not copied into the repo).");
