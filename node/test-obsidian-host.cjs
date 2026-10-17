const path = require("path");
const Module = require("module");
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === "obsidian") {
		return {
			Plugin: class Plugin {},
			ItemView: class ItemView {},
			Modal: class Modal {},
			PluginSettingTab: class PluginSettingTab {},
			FileSystemAdapter: class FileSystemAdapter {},
			Setting: class Setting { constructor () { return this; } setName () { return this; } setDesc () { return this; } addText () { return this; } addDropdown () { return this; } },
			Notice: class Notice { constructor (msg) { console.log("Notice:", msg); } },
			addIcon () {},
			requestUrl: async () => ({arrayBuffer: new ArrayBuffer(0)}),
		};
	}
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
	if (fs.existsSync(path.join(pluginDir, "data", "adventure"))) throw new Error("adventures should not be bundled");

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

	const loot = JSON.parse(fs.readFileSync(path.join(pluginDir, "data", "loot.json"), "utf8"));
	const table = loot.individual.find(it => it.source === "DMG" && it.crMin === 0);
	const rowRoll = globalThis.RollerUtil.randomise(100);
	const row = table.table.find(it => rowRoll >= it.min && rowRoll <= it.max);
	const coins = Object.fromEntries(Object.entries(row.coins).map(([type, formula]) => [type, Renderer.dice.parseRandomise2(String(formula))]));
	console.log("loot roll", {rowRoll, coins, bands: loot.hoard.filter(it => it.source === "DMG").map(it => it.name)});

	const adventures = packed.filter(it => it.c === 13 || it.c === 44);
	if (adventures.length) throw new Error(`filtered index still has ${adventures.length} adventure/book docs`);

	console.log("ok");
})().catch(err => {
	console.error(err);
	process.exit(1);
});
