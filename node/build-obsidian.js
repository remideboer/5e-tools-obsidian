import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "build", "obsidian");

fs.mkdirSync(outDir, {recursive: true});

const elasticlunrPlugin = {
	name: "elasticlunr-cjs",
	setup (build) {
		build.onLoad({filter: /lib[\\/]elasticlunr\.js$/}, async (args) => {
			const source = await fs.promises.readFile(args.path, "utf8");
			return {
				contents: `
let elasticlunr;
(function () {
	const module = {exports: {}};
	const exports = module.exports;
	const define = undefined;
	${source}
	elasticlunr = module.exports.elasticlunr || module.exports;
}).call(globalThis);
globalThis.elasticlunr = elasticlunr;
export default elasticlunr;
`,
				loader: "js",
			};
		});
	},
};

const stubAcePlugin = {
	name: "stub-ace",
	setup (build) {
		build.onResolve({filter: /lib[\\/]ace\.js$/}, () => ({
			path: "ace-stub",
			namespace: "ace-stub",
		}));
		build.onLoad({filter: /.*/, namespace: "ace-stub"}, () => ({
			contents: "export default {};",
			loader: "js",
		}));
	},
};

await esbuild.build({
	absWorkingDir: root,
	entryPoints: [path.join(root, "obsidian", "main.js")],
	bundle: true,
	outfile: path.join(outDir, "main.js"),
	format: "cjs",
	platform: "node",
	target: "es2020",
	external: ["obsidian", "electron", "fs", "path", "os", "crypto"],
	minify: true,
	logLevel: "info",
	plugins: [elasticlunrPlugin, stubAcePlugin],
});

fs.copyFileSync(path.join(root, "obsidian", "manifest.json"), path.join(outDir, "manifest.json"));
fs.copyFileSync(path.join(root, "obsidian", "styles.css"), path.join(outDir, "styles.css"));
fs.writeFileSync(path.join(outDir, "package.json"), `${JSON.stringify({
	name: "5etools-obsidian",
	private: true,
	type: "commonjs",
	main: "main.js",
}, null, "\t")}\n`);

copyBundledData();
writeFilteredSearchIndex();
installToDevVaults();

console.log(`Wrote ${outDir}`);

function copyBundledData () {
	const dirs = ["data/class", "data/bestiary", "data/spells"];
	const files = [
		"data/races.json",
		"data/fluff-races.json",
		"data/feats.json",
		"data/fluff-feats.json",
		"data/backgrounds.json",
		"data/fluff-backgrounds.json",
		"data/optionalfeatures.json",
		"data/fluff-optionalfeatures.json",
		"data/items.json",
		"data/items-base.json",
		"data/magicvariants.json",
		"data/fluff-items.json",
		"data/conditionsdiseases.json",
		"data/fluff-conditionsdiseases.json",
		"data/loot.json",
		"data/skills.json",
		"data/senses.json",
		"data/generated/gendata-spell-source-lookup.json",
		"data/generated/gendata-subclass-lookup.json",
		"data/generated/gendata-tag-redirects.json",
	];

	for (const dir of dirs) {
		const src = path.join(root, dir);
		if (!fs.existsSync(src)) continue;
		fs.cpSync(src, path.join(outDir, dir), {recursive: true});
	}

	for (const file of files) {
		const src = path.join(root, file);
		if (!fs.existsSync(src)) continue;
		const dest = path.join(outDir, file);
		fs.mkdirSync(path.dirname(dest), {recursive: true});
		fs.copyFileSync(src, dest);
	}
}

function writeFilteredSearchIndex () {
	const src = path.join(root, "search", "index.json");
	if (!fs.existsSync(src)) {
		console.warn("No search/index.json; skipping filtered index.");
		return;
	}

	const categoryIds = new Set([
		1, 2, 3, 4, 5, 6, 7, 8, 10, 21, 22, 23, 26, 27, 28, 29, 30, 32, 33, 34, 37, 38, 39, 40, 41, 49,
	]);
	const docs = decompressIndex(JSON.parse(fs.readFileSync(src, "utf8")))
		.filter(doc => doc && categoryIds.has(doc.c));

	const dest = path.join(outDir, "search", "index.json");
	fs.mkdirSync(path.dirname(dest), {recursive: true});
	fs.writeFileSync(dest, JSON.stringify({x: docs, m: {}}));
}

function decompressIndex (indexGroup) {
	const {x: index, m: metadata} = indexGroup;
	const props = new Set();
	const lookup = {};
	Object.keys(metadata || {}).forEach(k => {
		props.add(k);
		Object.entries(metadata[k]).forEach(([kk, vv]) => {
			(lookup[k] = lookup[k] || {})[vv] = kk;
		});
	});
	(index || []).forEach(it => {
		Object.keys(it)
			.filter(k => props.has(k))
			.forEach(k => {
				it[k] = lookup[k][it[k]] ?? it[k];
			});
	});
	return index || [];
}

function installToDevVaults () {
	const vaults = String(process.env.FIVEETOOLS_DEV_VAULTS || "")
		.split(path.delimiter)
		.map(it => it.trim())
		.filter(Boolean);
	if (!vaults.length) return;

	for (const vaultRoot of vaults) {
		const obsidianDir = path.join(vaultRoot, ".obsidian");
		if (!fs.existsSync(obsidianDir)) {
			console.warn(`Skipping vault (no .obsidian): ${vaultRoot}`);
			continue;
		}

		const dest = path.join(obsidianDir, "plugins", "5etools");
		fs.mkdirSync(dest, {recursive: true});
		for (const name of ["main.js", "manifest.json", "styles.css"]) {
			fs.copyFileSync(path.join(outDir, name), path.join(dest, name));
		}
		for (const dir of ["data", "search"]) {
			const src = path.join(outDir, dir);
			if (fs.existsSync(src)) fs.cpSync(src, path.join(dest, dir), {recursive: true});
		}

		const hotreload = path.join(dest, ".hotreload");
		if (!fs.existsSync(hotreload)) fs.writeFileSync(hotreload, "");
		console.log(`Installed to ${dest}`);
	}
}
