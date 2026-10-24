import {execFileSync, spawnSync} from "child_process";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM_URL = "https://github.com/5etools-mirror-3/5etools-src.git";
const SYNC_PATHS = ["data/", "search/index.json"];

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

const wantInstall = process.argv.includes("--install")
	|| Boolean(String(process.env.FIVEETOOLS_DEV_VAULTS || "").trim());

function git (args, {allowFail = false} = {}) {
	const result = spawnSync("git", args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
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

function assertCleanSyncPaths () {
	const status = git(["status", "--porcelain", "--", ...SYNC_PATHS]).stdout;
	if (!status) return;
	console.error("Refuse to sync: local changes under data/ or search/index.json:\n" + status);
	process.exit(1);
}

function pathsDiffer (upstreamRef) {
	const diff = git(["diff", "--quiet", "HEAD", upstreamRef, "--", ...SYNC_PATHS], {allowFail: true});
	return diff.status !== 0;
}

function printIncomingCommits (upstreamRef) {
	const log = git([
		"log",
		"--oneline",
		"-20",
		`HEAD..${upstreamRef}`,
		"--",
		...SYNC_PATHS,
	]).stdout;
	if (!log) {
		console.log("No commits on upstream (vs HEAD) that touch data/ or search/index.json.");
		return;
	}
	console.log("Recent upstream commits touching data/ or search/index.json:");
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

function main () {
	ensureUpstream();
	assertCleanSyncPaths();

	console.log("Fetching upstream …");
	git(["fetch", "upstream"]);

	const upstreamRef = resolveUpstreamRef();
	console.log(`Using ${upstreamRef}`);
	printIncomingCommits(upstreamRef);

	if (!pathsDiffer(upstreamRef)) {
		console.log("data/ and search/index.json already match upstream. Nothing to checkout.");
		if (wantInstall) runObsidianBuild();
		else console.log("Skip Obsidian install (set FIVEETOOLS_DEV_VAULTS or pass --install).");
		return;
	}

	console.log(`Checking out ${SYNC_PATHS.join(" ")} from ${upstreamRef} …`);
	git(["checkout", upstreamRef, "--", ...SYNC_PATHS]);

	const staged = git(["diff", "--cached", "--stat", "--", ...SYNC_PATHS]).stdout;
	if (staged) {
		console.log("Staged changes:");
		console.log(staged);
	}
	warnAllowlistGaps();
	console.log("");
	console.log("Review with git status / git diff --cached, then commit when ready.");
	console.log('Example: git commit -m "chore(data): sync from upstream"');

	if (wantInstall) runObsidianBuild();
	else console.log("Skip Obsidian install (set FIVEETOOLS_DEV_VAULTS or pass --install).");
}

try {
	main();
} catch (e) {
	console.error(e.message || e);
	process.exit(1);
}
