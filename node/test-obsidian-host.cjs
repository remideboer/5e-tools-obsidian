const path = require("path");
const Module = require("module");
const origLoad = Module._load;
const obsidianMock = {
	Plugin: class Plugin {},
	ItemView: class ItemView {},
	Modal: class Modal {},
	PluginSettingTab: class PluginSettingTab {},
	FileSystemAdapter: class FileSystemAdapter {},
	Setting: class Setting {
		constructor () { return this; }
		setName () { return this; }
		setDesc () { return this; }
		addText () { return this; }
		addDropdown () { return this; }
		addButton () { return this; }
	},
	Notice: class Notice { constructor (msg) { console.log("Notice:", msg); } },
	addIcon () {},
	normalizePath: (p) => String(p || "").replace(/\\/g, "/"),
	requestUrl: async ({url}) => ({arrayBuffer: Buffer.from(`img:${url}`)}),
};
Module._load = function (request, parent, isMain) {
	if (request === "obsidian") return obsidianMock;
	return origLoad.apply(this, arguments);
};

const root = path.join(__dirname, "..");
const pluginDir = path.join(root, "build", "obsidian");
require(path.join(pluginDir, "main.js"));

const fs = require("fs");
const host = globalThis.FiveEToolsObsidian;
if (!host) throw new Error("FiveEToolsObsidian host missing");

host.configureFiveEToolsRoot(pluginDir, {imageBaseUrl: "https://5e.tools"});

const elasticlunr = host.getElasticlunr();
const Parser = host.getParser();
const SearchUtil = host.getSearchUtil();
const DataLoader = host.getDataLoader();
const UrlUtil = host.getUrlUtil();
const Renderer = host.getRenderer();

elasticlunr.clearStopWords();
const index = elasticlunr(function () {
	this.addField("n");
	this.addField("sA");
	this.setRef("id");
});
SearchUtil.removeStemmer(index);

const raw = JSON.parse(fs.readFileSync(path.join(pluginDir, "search", "index.json"), "utf8"));
const {x: packed, m: metadata} = raw;
const lookup = {};
Object.keys(metadata || {}).forEach(k => {
	Object.entries(metadata[k]).forEach(([kk, vv]) => {
		(lookup[k] = lookup[k] || {})[vv] = kk;
	});
});
const props = new Set(Object.keys(metadata || {}));
packed.forEach(it => {
	Object.keys(it).filter(k => props.has(k)).forEach(k => {
		it[k] = lookup[k][it[k]] ?? it[k];
	});
	if (it?.n == null) return;
	it.cf = Parser.pageCategoryToFull(it.c);
	it.sA ||= it.s ? Parser.sourceJsonToAbv(it.s) : null;
	index.addDoc(it);
});

function search (term) {
	return index.search(term, {
		fields: {n: {boost: 5, expand: true}, sA: {expand: true}},
		bool: "AND",
		expand: true,
	}).map(it => it.doc);
}

(async () => {
	if (!fs.existsSync(path.join(pluginDir, "data", "loot.json"))) throw new Error("loot.json missing from plugin");
	if (!fs.existsSync(path.join(pluginDir, "data", "bestiary"))) throw new Error("bestiary missing from plugin");
	if (!fs.existsSync(path.join(pluginDir, "data", "adventure"))) throw new Error("adventure data missing from plugin");
	if (!fs.existsSync(path.join(pluginDir, "data", "adventures.json"))) throw new Error("adventures.json missing from plugin");

	const goblins = search("goblin").filter(d => String(d.cf).toLowerCase() === "bestiary");
	console.log("search hits", goblins.slice(0, 5).map(d => `${d.n} [${d.s}] ${d.cf}`));
	const doc = goblins.find(d => /^goblin$/i.test(d.n)) || goblins[0];
	if (!doc) throw new Error("no goblin");
	const page = UrlUtil.CAT_TO_PAGE[doc.c];
	const ent = await DataLoader.pCacheAndGet(page, doc.s, doc.u, {isSilent: true});
	console.log("entity", ent && {name: ent.name, source: ent.source, prop: ent.__prop, hasToken: ent.hasToken});
	if (!ent) throw new Error("failed to load goblin JSON");
	const html = Renderer.hover.getFnRenderCompact(page, {isStatic: true})(ent);
	console.log("html length", String(html).length, "sample", String(html).slice(0, 120).replace(/\s+/g, " "));
	const crPart = Renderer.monster.getChallengeRatingPart(ent);
	if (!crPart || crPart === "\u2014") throw new Error(`goblin CR missing: ${crPart}`);
	if (!String(html).includes(String(ent.cr?.cr ?? ent.cr))) throw new Error("compact HTML missing CR");
	if (!/XP/i.test(String(html))) throw new Error("compact HTML missing XP");
	console.log("cr", crPart);
	const tokenUrl = Renderer.monster.getTokenUrl(ent);
	console.log("tokenUrl", tokenUrl);
	if (!/^https:\/\/5e\.tools\/img\//i.test(String(tokenUrl))) throw new Error(`expected remote token URL, got ${tokenUrl}`);

	const spells = search("fireball").filter(d => String(d.cf).toLowerCase() === "spell");
	const spellDoc = spells.find(d => /^fireball$/i.test(d.n)) || spells[0];
	const spell = await DataLoader.pCacheAndGet(UrlUtil.CAT_TO_PAGE[spellDoc.c], spellDoc.s, spellDoc.u, {isSilent: true});
	console.log("spell", spell && {name: spell.name, source: spell.source, level: spell.level});

	const classes = search("fighter").filter(d => String(d.cf).toLowerCase() === "class");
	const classDoc = classes.find(d => /^fighter$/i.test(d.n)) || classes[0];
	const cls = await DataLoader.pCacheAndGet(UrlUtil.CAT_TO_PAGE[classDoc.c], classDoc.s, classDoc.u, {isSilent: true});
	console.log("class", cls && {name: cls.name, source: cls.source});
	const classHtml = Renderer.hover.getFnRenderCompact(UrlUtil.CAT_TO_PAGE[classDoc.c], {isStatic: true})(cls);
	console.log("class html length", String(classHtml).length);

	const items = search("bag of holding").filter(d => String(d.cf).toLowerCase() === "item");
	const itemDoc = items.find(d => /^bag of holding$/i.test(d.n)) || items[0];
	const item = await DataLoader.pCacheAndGet(UrlUtil.CAT_TO_PAGE[itemDoc.c], itemDoc.s, itemDoc.u, {isSilent: true});
	console.log("item", item && {name: item.name, source: item.source, type: item.type});
	const itemHtml = Renderer.hover.getFnRenderCompact(UrlUtil.CAT_TO_PAGE[itemDoc.c], {isStatic: true})(item);
	console.log("item html length", String(itemHtml).length);

	if (!fs.existsSync(path.join(pluginDir, "data", "variantrules.json"))) throw new Error("variantrules.json missing from plugin");
	const rules = search("advantage").filter(d => String(d.cf).toLowerCase() === "rule");
	const ruleDoc = rules.find(d => /^advantage$/i.test(d.n)) || rules[0];
	if (!ruleDoc) throw new Error("no advantage rule in filtered index");
	const rule = await DataLoader.pCacheAndGet(UrlUtil.CAT_TO_PAGE[ruleDoc.c], ruleDoc.s, ruleDoc.u, {isSilent: true});
	console.log("rule", rule && {name: rule.name, source: rule.source});

	const sneakHits = search("sneak attack").filter(d => String(d.cf).toLowerCase() === "class feature");
	const sneakDoc = sneakHits.find(d => /sneak attack/i.test(d.n)) || sneakHits[0];
	if (!sneakDoc) throw new Error("no sneak attack class feature in filtered index");
	const sneakPage = UrlUtil.CAT_TO_HOVER_PAGE[sneakDoc.c] || UrlUtil.CAT_TO_PAGE[sneakDoc.c];
	const sneak = await DataLoader.pCacheAndGet(sneakPage, sneakDoc.s, sneakDoc.u, {isSilent: true});
	if (!sneak) throw new Error(`sneak attack JSON miss via ${sneakPage} ${sneakDoc.u}`);
	console.log("classFeature", sneak && {name: sneak.name, source: sneak.source, page: sneakPage});

	if (typeof host.listLootTables !== "function" || typeof host.rollSelectedTables !== "function") {
		throw new Error("loot table helpers missing from host");
	}
	const lootTables = host.listLootTables();
	const groups = [...new Set(lootTables.map(it => it.group))];
	for (const group of ["Individual", "Hoard", "Dragon", "Gems", "Art objects", "Magic items", "Dragon mundane"]) {
		if (!groups.includes(group)) throw new Error(`loot group missing: ${group}`);
	}
	const tableA = lootTables.find(it => it.id === "magicItems:DMG:Magic Item Table A");
	const tableB = lootTables.find(it => it.id === "magicItems:DMG:Magic Item Table B");
	if (!tableA || !tableB) throw new Error("expected Magic Item Tables A and B");
	const lootRolls = host.rollSelectedTables([tableA.id, tableB.id], 5);
	if (lootRolls.items?.length !== 5) throw new Error(`expected 5 loot items, got ${lootRolls.items?.length}`);
	if (lootRolls.items.some(it => !it.label || !it.tableLabel)) throw new Error("loot item missing label or table");
	if (!lootRolls.items.some(it => it.name)) throw new Error("loot items missing linkable names");
	console.log("loot roll", {
		tables: lootTables.length,
		count: lootRolls.items.length,
		sample: lootRolls.items.map(it => `${it.label} [${it.tableLabel}]`),
	});

	const books = packed.filter(it => it.c === 44);
	if (books.length) throw new Error(`filtered index still has ${books.length} book docs`);
	const advHits = search("lost mine").filter(d => String(d.cf).toLowerCase() === "adventure");
	const advDoc = advHits.find(d => /phandelver/i.test(d.n)) || advHits[0];
	if (!advDoc) throw new Error("no Lost Mine adventure in filtered index");
	const advPack = await DataLoader.pCacheAndGet(UrlUtil.CAT_TO_PAGE[advDoc.c], advDoc.s, advDoc.u, {isSilent: true});
	const chapters = advPack?.adventureData?.data;
	if (!Array.isArray(chapters) || !chapters.length) throw new Error("LMoP chapters missing");
	globalThis.BookUtil = {
		curRender: {
			data: chapters,
			fromIndex: advPack.adventure,
			curBookId: String(advPack.adventure.id).toLowerCase(),
			chapter: 1,
			headerMap: Renderer.adventureBook.getEntryIdLookup(chapters, {isSilent: true}),
		},
	};
	const areaHtml = Renderer.get().setFirstSection(true).render(chapters[1] || chapters[0]);
	const areaHref = String(areaHtml).match(/href="#([^"]+)"/i)?.[1];
	if (!areaHref || !/,/.test(areaHref)) throw new Error("adventure chapter missing in-text area links");
	const areaParts = areaHref.split(",");
	if (areaParts.length < 3) throw new Error(`area href too short: ${areaHref}`);
	console.log("adventure", {name: advPack.adventure?.name, chapters: chapters.length, areaHref});

	if (typeof host.cachedMediaSrc !== "function") throw new Error("cachedMediaSrc missing from host");
	const os = require("os");
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fiveetools-cache-"));
	try {
		const adapter = new obsidianMock.FileSystemAdapter();
		adapter.getBasePath = () => tmpRoot;
		adapter.getResourcePath = (p) => `app://local/${String(p).replace(/\\/g, "/")}`;
		const cachePlugin = {
			settings: {imageBaseUrl: "https://5e.tools"},
			manifest: {id: "5etools"},
			app: {vault: {configDir: ".obsidian", adapter}},
		};
		const localSrc = await host.cachedMediaSrc(cachePlugin, tokenUrl);
		if (!String(localSrc).startsWith("app://local/")) throw new Error(`expected cached resource path, got ${localSrc}`);
		const vaultRel = String(localSrc).replace(/^app:\/\/local\//, "");
		const cachedFile = path.join(tmpRoot, ...vaultRel.split("/").filter(Boolean));
		if (!fs.existsSync(cachedFile)) throw new Error(`cache file missing: ${cachedFile}`);
		const again = await host.cachedMediaSrc(cachePlugin, tokenUrl);
		if (again !== localSrc) throw new Error("second cache lookup returned a different path");
		console.log("image cache", {file: cachedFile, hits: 2});
		host.clearMediaCache(cachePlugin);
		if (fs.existsSync(path.join(tmpRoot, ".obsidian", "plugins", "5etools", "cache"))) {
			throw new Error("cache folder still present after clear");
		}
	} finally {
		fs.rmSync(tmpRoot, {recursive: true, force: true});
	}

	console.log("ok");
})().catch(err => {
	console.error(err);
	process.exit(1);
});
