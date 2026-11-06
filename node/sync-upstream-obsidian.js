/**
 * Rerunnable import from the 5etools upstream mirror into this Obsidian fork.
 *
 * 1. Fetches `upstream` and checks out `data/` + `search/index.json`
 * 2. Merges missing site-source registrations from upstream `js/parser.js`
 *    (required so DataLoader treats new sources as site data, not missing brew)
 * 3. Warns on Obsidian data allowlist gaps and search sources still unknown to Parser
 * 4. Optionally runs `build-obsidian.js` (--install or FIVEETOOLS_DEV_VAULTS)
 *
 * Does not auto-commit. Does not merge upstream JS beyond Parser source maps.
 *
 *   npm run sync:upstream-obsidian
 *   npm run sync:upstream-obsidian:install
 */
import {execFileSync, spawnSync} from "child_process";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM_URL = "https://github.com/5etools-mirror-3/5etools-src.git";
const DATA_PATHS = ["data/", "search/index.json"];
const PARSER_PATH = "js/parser.js";
const ALL_TOUCH_PATHS = [...DATA_PATHS, PARSER_PATH];

/** Top-level data/ entries covered by copyBundledData in build-obsidian.js */
const OBSIDIAN_DATA_TOP = new Set([
	"class",
	"bestiary",
	"spells",
	"adventure",
	"generated",
	"races.json",
	"fluff-races.json",
	"feats.json",
	"fluff-feats.json",
	"backgrounds.json",
	"fluff-backgrounds.json",
	"optionalfeatures.json",
	"fluff-optionalfeatures.json",
	"items.json",
	"items-base.json",
	"magicvariants.json",
	"fluff-items.json",
	"conditionsdiseases.json",
	"fluff-conditionsdiseases.json",
	"loot.json",
	"skills.json",
	"senses.json",
	"actions.json",
	"adventures.json",
	"variantrules.json",
	"objects.json",
	"fluff-objects.json",
	"trapshazards.json",
	"fluff-trapshazards.json",
	"cultsboons.json",
]);

/** Source-category arrays/sets in parser.js that must stay aligned with upstream for new SRC_* keys. */
const PARSER_MEMBERSHIP_BLOCKS = [
	"SOURCES_ADVENTURES",
	"SOURCES_NON_STANDARD_WOTC",
	"SOURCES_NON_FR",
	"SOURCES_AVAILABLE_DOCS_BOOK",
	"SOURCES_AVAILABLE_DOCS_ADVENTURE",
];

const wantInstall = process.argv.includes("--install")
	|| Boolean(String(process.env.FIVEETOOLS_DEV_VAULTS || "").trim());
const dryRun = process.argv.includes("--dry-run");

function git (args, {allowFail = false} = {}) {
	const result = spawnSync("git", args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.status !== 0 && !allowFail) {
		const err = (result.stderr || result.stdout || "").trim() || `git ${args.join(" ")} failed`;
		throw new Error(err);
	}
	return {
		status: result.status ?? 1,
		stdout: (result.stdout || "").trim(),
		stderr: (result.stderr || "").trim(),
	};
}

function ensureUpstream () {
	const remotes = git(["remote"]).stdout.split(/\r?\n/).filter(Boolean);
	if (!remotes.includes("upstream")) {
		console.log(`Adding remote upstream → ${UPSTREAM_URL}`);
		git(["remote", "add", "upstream", UPSTREAM_URL]);
		return;
	}
	const url = git(["remote", "get-url", "upstream"]).stdout;
	if (url !== UPSTREAM_URL) {
		console.warn(`upstream URL is ${url} (expected ${UPSTREAM_URL}); leaving as-is.`);
	}
}

function resolveUpstreamRef () {
	for (const branch of ["master", "main"]) {
		const ref = `upstream/${branch}`;
		const check = git(["rev-parse", "--verify", ref], {allowFail: true});
		if (check.status === 0) return ref;
	}
	throw new Error("No upstream/master or upstream/main after fetch.");
}

function assertCleanPaths (paths) {
	const status = git(["status", "--porcelain", "--", ...paths]).stdout;
	if (!status) return;
	console.error("Refuse to sync: local changes under sync paths:\n" + status);
	process.exit(1);
}

function pathsDiffer (upstreamRef, paths) {
	const diff = git(["diff", "--quiet", "HEAD", upstreamRef, "--", ...paths], {allowFail: true});
	return diff.status !== 0;
}

function printIncomingCommits (upstreamRef) {
	const log = git([
		"log",
		"--oneline",
		"-20",
		`HEAD..${upstreamRef}`,
		"--",
		...DATA_PATHS,
		PARSER_PATH,
	]).stdout;
	if (!log) {
		console.log("No commits on upstream (vs HEAD) that touch data/, search/index.json, or js/parser.js.");
		return;
	}
	console.log("Recent upstream commits touching sync paths:");
	console.log(log);
}

function warnAllowlistGaps () {
	const dataDir = path.join(root, "data");
	if (!fs.existsSync(dataDir)) return;
	const extras = fs.readdirSync(dataDir)
		.filter(name => !name.startsWith("."))
		.filter(name => !OBSIDIAN_DATA_TOP.has(name))
		.sort();
	if (!extras.length) return;
	console.log("");
	console.log("Note: these top-level data/ entries are not in the Obsidian allowlist");
	console.log("(node/build-obsidian.js copyBundledData). They are in git but not installed");
	console.log("into the vault plugin until you extend that list:");
	for (const name of extras) console.log(`  - data/${name}`);
}

function runObsidianBuild () {
	console.log("Running node/build-obsidian.js …");
	execFileSync(process.execPath, [path.join(root, "node", "build-obsidian.js")], {
		cwd: root,
		stdio: "inherit",
		env: process.env,
	});
}

/* -------------------------------------------- */
/* Parser source merge                          */
/* -------------------------------------------- */

function parseSrcDefs (text) {
	const out = new Map();
	for (const match of text.matchAll(/Parser\.SRC_(\w+)\s*=\s*"([^"]+)"/g)) {
		out.set(match[1], match[2]);
	}
	// Template forms: Parser.SRC_X = `${Parser.SRC_Y}suffix`
	let grew = true;
	while (grew) {
		grew = false;
		for (const match of text.matchAll(/Parser\.SRC_(\w+)\s*=\s*`\$\{Parser\.SRC_(\w+)\}([^`]*)`/g)) {
			const key = match[1];
			if (out.has(key)) continue;
			const base = out.get(match[2]);
			if (base == null) continue;
			out.set(key, `${base}${match[3]}`);
			grew = true;
		}
	}
	return out;
}

function parseMapEntries (text, mapName) {
	const out = new Map();
	const re = new RegExp(`Parser\\.${mapName}\\[Parser\\.SRC_(\\w+)\\]\\s*=\\s*([^\n;]+);`, "g");
	for (const match of text.matchAll(re)) {
		out.set(match[1], match[2].trim());
	}
	return out;
}

function parseMembership (text, blockName) {
	const members = new Set();
	const start = text.indexOf(`Parser.${blockName}`);
	if (start < 0) return members;
	const open = text.indexOf("[", start);
	if (open < 0) return members;
	let depth = 0;
	let end = -1;
	for (let i = open; i < text.length; i++) {
		const ch = text[i];
		if (ch === "[") depth++;
		else if (ch === "]") {
			depth--;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	if (end < 0) return members;
	const body = text.slice(open, end + 1);
	for (const match of body.matchAll(/Parser\.SRC_(\w+)/g)) members.add(match[1]);
	return members;
}

function extractParserCatalog (text) {
	return {
		defs: parseSrcDefs(text),
		full: parseMapEntries(text, "SOURCE_JSON_TO_FULL"),
		abv: parseMapEntries(text, "SOURCE_JSON_TO_ABV"),
		date: parseMapEntries(text, "SOURCE_JSON_TO_DATE"),
		membership: Object.fromEntries(
			PARSER_MEMBERSHIP_BLOCKS.map(name => [name, parseMembership(text, name)]),
		),
	};
}

function insertBefore (text, anchor, chunk) {
	const idx = text.indexOf(anchor);
	if (idx < 0) throw new Error(`Parser sync anchor not found: ${anchor}`);
	if (text.slice(Math.max(0, idx - chunk.length - 2), idx).includes(chunk.trim())) return text;
	return `${text.slice(0, idx)}${chunk}${text.slice(idx)}`;
}

function addMembershipMember (text, blockName, srcKey) {
	const token = `Parser.SRC_${srcKey}`;
	if (parseMembership(text, blockName).has(srcKey)) return text;

	const start = text.indexOf(`Parser.${blockName}`);
	if (start < 0) throw new Error(`Missing Parser.${blockName}`);
	const open = text.indexOf("[", start);
	let depth = 0;
	let end = -1;
	for (let i = open; i < text.length; i++) {
		const ch = text[i];
		if (ch === "[") depth++;
		else if (ch === "]") {
			depth--;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	if (end < 0) throw new Error(`Unclosed Parser.${blockName}`);

	const lineStart = text.lastIndexOf("\n", end);
	const closeIndent = text.slice(lineStart + 1, end).match(/^\s*/)?.[0] || "";
	return `${text.slice(0, end)}\t${token},\n${closeIndent}${text.slice(end)}`;
}

function mergeParserSources (localText, upstreamText) {
	const local = extractParserCatalog(localText);
	const upstream = extractParserCatalog(upstreamText);
	const missingKeys = [...upstream.defs.keys()].filter(key => !local.defs.has(key));
	const report = {
		addedDefs: [],
		addedFull: [],
		addedAbv: [],
		addedDate: [],
		addedMembership: [],
	};

	if (!missingKeys.length) {
		// Still fill map/membership gaps for sources we already have.
	}

	let next = localText;

	for (const key of missingKeys) {
		const value = upstream.defs.get(key);
		const line = `Parser.SRC_${key} = "${value}";\n`;
		next = insertBefore(next, "Parser.SRC_PS_PREFIX", line);
		report.addedDefs.push(key);
		local.defs.set(key, value);
	}

	for (const key of upstream.full.keys()) {
		if (!parseSrcDefs(next).has(key)) continue;
		if (parseMapEntries(next, "SOURCE_JSON_TO_FULL").has(key)) continue;
		const rhs = upstream.full.get(key);
		const line = `Parser.SOURCE_JSON_TO_FULL[Parser.SRC_${key}] = ${rhs};\n`;
		next = insertBefore(next, "Parser.SOURCE_JSON_TO_ABV = {}", line);
		report.addedFull.push(key);
	}

	for (const key of upstream.abv.keys()) {
		if (parseMapEntries(next, "SOURCE_JSON_TO_ABV").has(key)) continue;
		if (!parseSrcDefs(next).has(key)) continue;
		const rhs = upstream.abv.get(key);
		const line = `Parser.SOURCE_JSON_TO_ABV[Parser.SRC_${key}] = ${rhs};\n`;
		next = insertBefore(next, "Parser.SOURCE_JSON_TO_DATE = {}", line);
		report.addedAbv.push(key);
	}

	for (const key of upstream.date.keys()) {
		if (parseMapEntries(next, "SOURCE_JSON_TO_DATE").has(key)) continue;
		if (!parseSrcDefs(next).has(key)) continue;
		const rhs = upstream.date.get(key);
		const line = `Parser.SOURCE_JSON_TO_DATE[Parser.SRC_${key}] = ${rhs};\n`;
		next = insertBefore(next, "// region Source categories", line);
		report.addedDate.push(key);
	}

	const localDefsNow = parseSrcDefs(next);
	for (const blockName of PARSER_MEMBERSHIP_BLOCKS) {
		const upMembers = upstream.membership[blockName] || new Set();
		for (const key of upMembers) {
			if (!localDefsNow.has(key)) continue;
			const before = parseMembership(next, blockName);
			if (before.has(key)) continue;
			next = addMembershipMember(next, blockName, key);
			report.addedMembership.push(`${blockName}:${key}`);
		}
	}

	const changed = next !== localText;
	return {text: next, changed, report};
}

function syncParserFromUpstream (upstreamRef) {
	const localPath = path.join(root, PARSER_PATH);
	const localText = fs.readFileSync(localPath, "utf8");
	const upstreamText = git(["show", `${upstreamRef}:${PARSER_PATH}`]).stdout.replace(/\r\n/g, "\n");
	const localNorm = localText.replace(/\r\n/g, "\n");
	const {text, changed, report} = mergeParserSources(localNorm, upstreamText);

	if (!changed) {
		console.log("Parser source maps already include upstream SRC_* entries.");
		return false;
	}

	console.log("Merging missing Parser site sources from upstream …");
	if (report.addedDefs.length) console.log(`  SRC defs: ${report.addedDefs.join(", ")}`);
	if (report.addedFull.length) console.log(`  SOURCE_JSON_TO_FULL: ${report.addedFull.join(", ")}`);
	if (report.addedAbv.length) console.log(`  SOURCE_JSON_TO_ABV: ${report.addedAbv.join(", ")}`);
	if (report.addedDate.length) console.log(`  SOURCE_JSON_TO_DATE: ${report.addedDate.join(", ")}`);
	if (report.addedMembership.length) console.log(`  membership: ${report.addedMembership.join(", ")}`);

	if (dryRun) {
		console.log("Dry run: parser.js not written.");
		return true;
	}

	const out = localText.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
	fs.writeFileSync(localPath, out, "utf8");
	git(["add", "--", PARSER_PATH]);
	return true;
}

function decompressSearchSources (indexGroup) {
	const {x: index, m: metadata} = indexGroup || {};
	const lookup = {};
	for (const [prop, map] of Object.entries(metadata || {})) {
		lookup[prop] = {};
		for (const [key, value] of Object.entries(map || {})) {
			lookup[prop][value] = key;
		}
	}
	const sources = new Set();
	for (const doc of index || []) {
		if (doc == null || doc.s == null) continue;
		const raw = doc.s;
		const resolved = lookup.s?.[raw] ?? raw;
		if (typeof resolved === "string") sources.add(resolved);
	}
	return sources;
}

function warnUnknownSearchSources () {
	const indexPath = path.join(root, "search", "index.json");
	const parserPath = path.join(root, PARSER_PATH);
	if (!fs.existsSync(indexPath) || !fs.existsSync(parserPath)) return;

	const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
	const parserText = fs.readFileSync(parserPath, "utf8");
	const defs = parseSrcDefs(parserText);
	const full = parseMapEntries(parserText, "SOURCE_JSON_TO_FULL");
	const known = new Set();
	for (const key of full.keys()) {
		const abv = defs.get(key);
		if (abv) known.add(abv);
	}

	const unknown = [...decompressSearchSources(index)]
		.filter(src => !known.has(src))
		.sort();

	if (!unknown.length) {
		console.log("Search index sources are all registered in Parser.SOURCE_JSON_TO_FULL.");
		return;
	}
	console.log("");
	console.log("Warning: search/index.json still references sources missing from Parser.SOURCE_JSON_TO_FULL:");
	for (const src of unknown) console.log(`  - ${src}`);
	console.log("Entity opens for those sources will fail until Parser maps are fixed.");
}

function syncDataFromUpstream (upstreamRef) {
	if (!pathsDiffer(upstreamRef, DATA_PATHS)) {
		console.log("data/ and search/index.json already match upstream.");
		return false;
	}
	if (dryRun) {
		console.log(`Dry run: would checkout ${DATA_PATHS.join(" ")} from ${upstreamRef}`);
		return true;
	}
	console.log(`Checking out ${DATA_PATHS.join(" ")} from ${upstreamRef} …`);
	git(["checkout", upstreamRef, "--", ...DATA_PATHS]);
	const staged = git(["diff", "--cached", "--stat", "--", ...DATA_PATHS]).stdout;
	if (staged) {
		console.log("Staged data/search changes:");
		console.log(staged);
	}
	return true;
}

function main () {
	ensureUpstream();
	if (!dryRun) assertCleanPaths(ALL_TOUCH_PATHS);

	console.log("Fetching upstream …");
	git(["fetch", "upstream"]);

	const upstreamRef = resolveUpstreamRef();
	console.log(`Using ${upstreamRef}`);
	printIncomingCommits(upstreamRef);

	const dataChanged = syncDataFromUpstream(upstreamRef);
	const parserChanged = syncParserFromUpstream(upstreamRef);

	warnAllowlistGaps();
	warnUnknownSearchSources();

	if (!dataChanged && !parserChanged) {
		console.log("Nothing to import.");
	} else {
		console.log("");
		console.log("Review with git status / git diff --cached, then commit when ready.");
		console.log('Example: git commit -m "chore(obsidian): sync upstream data and Parser sources"');
	}

	if (wantInstall && !dryRun) runObsidianBuild();
	else if (wantInstall && dryRun) console.log("Dry run: skip Obsidian install.");
	else console.log("Skip Obsidian install (set FIVEETOOLS_DEV_VAULTS or pass --install).");
}

try {
	main();
} catch (e) {
	console.error(e.message || e);
	process.exit(1);
}
