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
if (typeof host.setStyleHint === "function") host.setStyleHint("one");

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

	if (typeof host.ensureSearchIndex !== "function" || typeof host.docFromVetLink !== "function") {
		throw new Error("link helpers missing from host");
	}
	await host.ensureSearchIndex(pluginDir);
	const fireballDoc = host.findEntityDoc("Fireball", {categoriesExact: ["spell"]});
	if (String(fireballDoc?.s || "").toUpperCase() !== "XPHB") {
		throw new Error(`Fireball should prefer XPHB, got ${fireballDoc?.s}`);
	}
	const speciesHits = search("elf").filter(d => String(d.cf).toLowerCase() === "species");
	const elfDoc = speciesHits.find(d => /^elf$/i.test(d.n) && String(d.s).toUpperCase() === "XPHB") || speciesHits[0];
	if (!elfDoc) throw new Error("no Elf species");
	const elf = await DataLoader.pCacheAndGet(UrlUtil.CAT_TO_PAGE[elfDoc.c], elfDoc.s, elfDoc.u, {isSilent: true});
	if (!elf) throw new Error("failed to load Elf JSON");
	const elfHtml = String(Renderer.hover.getFnRenderCompact(UrlUtil.CAT_TO_PAGE[elfDoc.c], {isStatic: true})(elf));
	const senseAttrs = elfHtml.match(/data-vet-page="sense" data-vet-source="([^"]*)" data-vet-hash="([^"]+)"/);
	if (!senseAttrs) throw new Error("Elf compact HTML missing sense link data");
	const skillAttrs = elfHtml.match(/data-vet-page="skill" data-vet-source="([^"]*)" data-vet-hash="([^"]+)"/);
	if (!skillAttrs) throw new Error("Elf compact HTML missing skill link data");
	const senseDoc = host.docFromVetLink({page: "sense", source: senseAttrs[1], hash: senseAttrs[2], linkText: "Darkvision"});
	if (!senseDoc || !/darkvision/i.test(senseDoc.n)) throw new Error(`Darkvision sense did not resolve: ${JSON.stringify(senseDoc)}`);
	if (String(senseDoc.s || "").toUpperCase() !== "XPHB") {
		throw new Error(`Darkvision should prefer XPHB, got ${senseDoc.s}`);
	}
	const senseEnt = await DataLoader.pCacheAndGet("sense", senseDoc.s, senseDoc.u, {isSilent: true});
	if (!senseEnt) throw new Error(`Darkvision JSON miss via ${senseDoc.u}`);
	const skillDoc = host.docFromVetLink({page: "skill", source: skillAttrs[1], hash: skillAttrs[2], linkText: "Perception"});
	if (!skillDoc) throw new Error("species skill link did not resolve");
	if (String(skillDoc.s || "").toUpperCase() !== "XPHB") {
		throw new Error(`skill link should prefer XPHB, got ${skillDoc.s}`);
	}
	const skillEnt = await DataLoader.pCacheAndGet("skill", skillDoc.s, skillDoc.u, {isSilent: true});
	if (!skillEnt) throw new Error(`skill JSON miss via ${skillDoc.u}`);
	const restAttrs = elfHtml.match(/data-vet-page="variantrules.html" data-vet-source="([^"]*)" data-vet-hash="([^"]*long[^"]*)"/i);
	if (!restAttrs) throw new Error("Elf compact HTML missing Long Rest rule link");
	const restDoc = host.docFromVetLink({page: "variantrules.html", source: restAttrs[1], hash: restAttrs[2], linkText: "Long Rest"});
	if (!restDoc || !/long rest/i.test(restDoc.n)) throw new Error(`Long Rest did not resolve: ${JSON.stringify(restDoc)}`);
	if (!["XPHB", "XDMG"].includes(String(restDoc.s || "").toUpperCase())) {
		throw new Error(`Long Rest should prefer 2024 rules, got ${restDoc.s}`);
	}
	console.log("species links", {sense: senseDoc.n, skill: skillDoc.n, rule: restDoc.n});

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
	const tableI = lootTables.find(it => it.id === "magicItems:DMG:Magic Item Table I");
	if (!tableA || !tableB || !tableI) throw new Error("expected Magic Item Tables A, B, and I");
	if (typeof host.lootTableRarityWeight !== "function") throw new Error("lootTableRarityWeight missing");
	const wA = host.lootTableRarityWeight(tableA);
	const wB = host.lootTableRarityWeight(tableB);
	const wI = host.lootTableRarityWeight(tableI);
	if (!(wA > wI) || !(wB > wI)) throw new Error(`rarity weights should favor A/B over I: A=${wA} B=${wB} I=${wI}`);
	const lootRolls = host.rollSelectedTables([tableA.id, tableB.id], 5);
	if (lootRolls.items?.length !== 5) throw new Error(`expected 5 loot items, got ${lootRolls.items?.length}`);
	if (lootRolls.items.some(it => !it.label || !it.tableLabel)) throw new Error("loot item missing label or table");
	if (!lootRolls.items.some(it => it.name)) throw new Error("loot items missing linkable names");
	console.log("loot roll", {
		tables: lootTables.length,
		count: lootRolls.items.length,
		sample: lootRolls.items.map(it => `${it.label} [${it.tableLabel}]`),
	});

	if (typeof host.addCombatants !== "function" || typeof host.hpMaxFromEnt !== "function") {
		throw new Error("encounter helpers missing from host");
	}
	const enc = await host.addCombatants({combatants: [], selectedId: null}, doc, 2);
	if (enc.added?.length !== 2) throw new Error(`expected 2 combatants, got ${enc.added?.length}`);
	if (enc.added[0].label === enc.added[1].label) throw new Error("combatant labels should be distinct");
	const expectedHp = host.hpMaxFromEnt(ent);
	if (!expectedHp || enc.added[0].hpMax !== expectedHp || enc.added[1].hpCurrent !== expectedHp) {
		throw new Error(`goblin HP should be average ${expectedHp}, got ${enc.added[0].hpMax}`);
	}
	if (enc.added[0].ac !== 15) throw new Error(`goblin AC should be 15, got ${enc.added[0].ac}`);
	if (enc.added[0].initiative !== 2) throw new Error(`goblin Init should be +2, got ${enc.added[0].initiative}`);
	if (host.adjustHp(expectedHp, expectedHp, 1) !== expectedHp) throw new Error("HP + should clamp to max");
	if (host.adjustHp(0, expectedHp, -1) !== 0) throw new Error("HP - should clamp to 0");
	const encEnt = await DataLoader.pCacheAndGet(page, enc.added[0].doc.s, enc.added[0].doc.u, {isSilent: true});
	if (!encEnt) throw new Error(`encounter combatant JSON miss via ${enc.added[0].doc.u}`);
	console.log("encounter", {labels: enc.added.map(it => it.label), hp: expectedHp, cr: enc.added[0].cr});

	if (typeof host.encounterDifficulty !== "function") throw new Error("encounterDifficulty missing from host");
	const oneGob = host.encounterDifficulty({
		combatants: [{cr: "1/4"}],
		party: {count: 4, level: 1},
		style: "one",
	});
	if (oneGob.totalXp !== 50 || oneGob.xpPerPlayer !== 12 || oneGob.difficulty !== "low") {
		throw new Error(`1 goblin vs 4 L1 should be Low 50 XP / 12 each, got ${JSON.stringify(oneGob)}`);
	}
	const fiveGobs = host.encounterDifficulty({
		combatants: Array.from({length: 5}, () => ({cr: "1/4"})),
		party: {count: 4, level: 1},
		style: "one",
	});
	if (fiveGobs.totalXp !== 250 || fiveGobs.xpPerPlayer !== 62 || fiveGobs.difficulty !== "moderate") {
		throw new Error(`5 goblins vs 4 L1 should be Moderate 250 XP / 62 each, got ${JSON.stringify(fiveGobs)}`);
	}
	const emptyDiff = host.encounterDifficulty({combatants: [], party: {count: 4, level: 1}, style: "one"});
	if (emptyDiff.difficulty !== "" || emptyDiff.totalXp !== 0) {
		throw new Error(`empty roster should have no difficulty, got ${JSON.stringify(emptyDiff)}`);
	}

	if (typeof host.applyEncountersJson !== "function" || typeof host.upsertSavedEncounter !== "function") {
		throw new Error("encounter save helpers missing from host");
	}
	host.applyEncountersJson({encounters: []});
	const savedA = host.upsertSavedEncounter({
		name: "Goblin ambush",
		selectedId: enc.added[1].id,
		combatants: enc.combatants,
		party: {count: 5, level: 3},
	});
	if (savedA.party?.count !== 5 || savedA.party?.level !== 3) {
		throw new Error(`saved encounter should keep party, got ${JSON.stringify(savedA.party)}`);
	}
	const savedB = host.upsertSavedEncounter({name: "Owlbear nest", combatants: []});
	if (!savedA.id || savedA.combatants?.length !== 2) throw new Error("saved encounter should keep combatants");
	if (host.listSavedEncounters().length !== 2) throw new Error("should list both saved encounters");
	const wounded = enc.combatants.map((it, i) => (i === 0 ? {...it, hpCurrent: 4} : it));
	const savedAgain = host.upsertSavedEncounter({
		name: "goblin ambush",
		selectedId: enc.added[0].id,
		combatants: wounded,
	});
	if (savedAgain.id !== savedA.id) throw new Error("same-name upsert should overwrite");
	if (savedAgain.combatants[0].hpCurrent !== 4) throw new Error("overwrite should keep current HP");
	if (host.listSavedEncounters().length !== 2) throw new Error("overwrite should not add a third encounter");
	wounded[0].hpCurrent = 1;
	if (host.getSavedEncounter(savedAgain.id).combatants[0].hpCurrent !== 4) {
		throw new Error("catalog should clone combatants");
	}
	host.deleteSavedEncounter(savedB.id);
	const afterDelete = host.listSavedEncounters();
	if (afterDelete.length !== 1 || afterDelete[0].name.toLowerCase() !== "goblin ambush") {
		throw new Error("delete should leave the overwritten goblin encounter");
	}

	if (typeof host.setEncounterInstance !== "function" || typeof host.getEncounterInstance !== "function") {
		throw new Error("encounter instance helpers missing from host");
	}
	const live = enc.combatants.map((it, i) => (i === 0 ? {...it, hpCurrent: 3} : it));
	host.setEncounterInstance({
		name: "Live fight",
		savedId: savedAgain.id,
		selectedId: enc.added[0].id,
		combatants: live,
		party: {count: 4, level: 2},
	});
	const inst = host.getEncounterInstance();
	if (inst.name !== "Live fight" || inst.party?.level !== 2 || inst.combatants?.[0]?.hpCurrent !== 3) {
		throw new Error(`instance should keep running state, got ${JSON.stringify(inst)}`);
	}
	live[0].hpCurrent = 1;
	if (host.getEncounterInstance().combatants[0].hpCurrent !== 3) {
		throw new Error("instance should clone combatants");
	}
	host.upsertSavedEncounter({name: "Template only", combatants: []});
	if (host.getEncounterInstance().name !== "Live fight") {
		throw new Error("named save should not replace the running instance");
	}
	host.applyEncountersJson({
		encounters: [{name: "Keep", combatants: []}],
		instance: {name: "Live fight", combatants: [{hpCurrent: 3, hpMax: 7, cr: "1/4"}], party: {count: 4, level: 2}},
	});
	const restored = host.getEncounterInstance();
	if (restored.name !== "Live fight" || restored.combatants[0].hpCurrent !== 3 || restored.party.level !== 2) {
		throw new Error(`instance should round-trip in catalog JSON, got ${JSON.stringify(restored)}`);
	}

	if (typeof host.hpAverageFromFormula !== "function" || typeof host.buildEntity !== "function" || typeof host.entityToForm !== "function") {
		throw new Error("homebrew helpers missing from host");
	}
	const goblinStarter = host.entityToForm("monster", ent);
	if (goblinStarter.name !== ent.name || !goblinStarter.hpFormula) {
		throw new Error(`goblin starter form incomplete: ${JSON.stringify(goblinStarter)}`);
	}
	const goblinCopy = host.buildEntity("monster", goblinStarter);
	if (goblinCopy.source !== "HB" || goblinCopy.name !== ent.name) {
		throw new Error("starter should copy the selected creature into HB brew");
	}
	if (!Array.isArray(goblinStarter.traits) || !Array.isArray(goblinStarter.actions)) {
		throw new Error("creature form should use trait and action rows");
	}
	const customMon = host.buildEntity("monster", {
		name: "HB Scout",
		ac: "13",
		hpFormula: "2d8+2",
		dex: "14",
		wis: "12",
		passive: "15",
		resist: "fire, cold",
		immune: "poison",
		conditionImmune: "charmed, frightened",
		traits: [{name: "Pack Tactics", text: "Advantage when an ally is near."}],
		actions: [{name: "Scimitar", text: "Melee attack."}],
		spells: [{name: "Fire Bolt", source: "XPHB"}],
		spellAbility: "int",
	});
	if (!customMon.trait?.some(it => it.name === "Pack Tactics")) throw new Error("custom monster missing trait");
	if (!customMon.action?.some(it => it.name === "Scimitar")) throw new Error("custom monster missing action");
	if (!customMon.spellcasting?.[0]?.will?.some(it => /Fire Bolt/i.test(it))) {
		throw new Error(`custom monster missing spellcasting, got ${JSON.stringify(customMon.spellcasting)}`);
	}
	if (customMon.passive !== 15) throw new Error(`custom monster passive should be 15, got ${customMon.passive}`);
	if (!customMon.resist?.includes("fire") || !customMon.immune?.includes("poison")) {
		throw new Error("custom monster missing resist or immune");
	}
	if (!customMon.conditionImmune?.includes("charmed")) throw new Error("custom monster missing condition immunity");
	const customForm = host.entityToForm("monster", customMon);
	if (!customForm.traits.some(it => it.name === "Pack Tactics")) throw new Error("trait rows should round-trip");
	if (!customForm.spells.some(it => it.name === "Fire Bolt")) throw new Error("spell rows should round-trip");
	if (customForm.passive !== "15" || !/fire/i.test(customForm.resist) || !/charmed/i.test(customForm.conditionImmune)) {
		throw new Error("passive/resist/immunities should round-trip");
	}
	if (typeof host.addCombatantsFromEntity !== "function") throw new Error("addCombatantsFromEntity missing from host");
	const customEnc = host.addCombatantsFromEntity({combatants: [], selectedId: null}, customMon, 1);
	if (customEnc.added?.[0]?.ent?.name !== "HB Scout") throw new Error("custom combatant should snapshot ent");
	if (customEnc.added[0].ac !== 13) throw new Error(`custom combatant AC should be 13, got ${customEnc.added[0].ac}`);
	if (customEnc.added[0].hpMax !== 11) throw new Error(`custom combatant HP should be 11, got ${customEnc.added[0].hpMax}`);
	if (host.hpAverageFromFormula("2d8+2") !== 11) {
		throw new Error(`2d8+2 should average 11, got ${host.hpAverageFromFormula("2d8+2")}`);
	}
	if (typeof host.cacheEntityInDataLoader !== "function") throw new Error("cacheEntityInDataLoader missing from host");
	const previewSpell = host.buildEntity("spell", {
		name: "HB Preview Bolt",
		level: "0",
		school: "V",
		timeNumber: "1",
		timeUnit: "action",
		range: "60 feet",
		verbal: true,
		somatic: true,
		entries: "The target takes {@damage 1d6} Fire damage.",
	});
	host.cacheEntityInDataLoader(previewSpell, "spell");
	const previewPage = UrlUtil.CAT_TO_PAGE[Parser.CAT_ID_SPELL];
	const previewHash = UrlUtil.encodeForHash([previewSpell.name, "HB"]);
	const previewLoaded = await DataLoader.pCacheAndGet(previewPage, "HB", previewHash, {isSilent: true});
	if (!previewLoaded || previewLoaded.name !== "HB Preview Bolt") throw new Error(`unsaved preview spell miss via ${previewHash}`);
	const previewHtml = String(Renderer.hover.getFnRenderCompact(previewPage, {isStatic: true})(previewLoaded));
	if (!previewHtml.includes("HB Preview Bolt")) throw new Error("preview HTML missing spell name");
	if (previewHtml.includes("{@damage")) throw new Error("preview HTML still has raw damage tag");
	if (!/1d6/i.test(previewHtml)) throw new Error("preview HTML missing formatted damage");
	const hbSpell = host.buildEntity("spell", {
		name: "HB Spark",
		level: "0",
		school: "V",
		timeNumber: "1",
		timeUnit: "action",
		range: "60 feet",
		verbal: true,
		somatic: true,
		entries: "A spark leaps to a creature within range.",
		classes: "Wizard",
	});
	const hbMon = host.buildEntity("monster", {
		name: "HB Blob",
		size: "M",
		type: "ooze",
		alignment: "U",
		ac: "8",
		hpFormula: "2d8+2",
		speed: "20",
		str: "10",
		dex: "8",
		con: "12",
		int: "1",
		wis: "6",
		cha: "1",
		cr: "1/4",
		actions: "Pseudopod. {@atkr m} {@hit 2}, reach 5 ft. {@h}4 ({@damage 1d6 + 1}) Acid damage.",
	});
	if (hbMon.hp.average !== 11) throw new Error(`HB Blob HP average should be 11, got ${hbMon.hp.average}`);
	const brew = host.emptyBrew();
	brew.spell.push(hbSpell);
	brew.monster.push(hbMon);
	host.applyBrewJson(brew);
	await host.ensureSearchIndex(pluginDir);
	if (typeof host.indexHomebrewDocs !== "function") throw new Error("indexHomebrewDocs missing from host");
	const hbDocs = host.indexHomebrewDocs();
	if (!hbDocs.some(d => d.n === "HB Spark") || !hbDocs.some(d => d.n === "HB Blob")) {
		throw new Error("homebrew search docs missing");
	}
	const spellPage = UrlUtil.CAT_TO_PAGE[Parser.CAT_ID_SPELL];
	const monPage = UrlUtil.CAT_TO_PAGE[Parser.CAT_ID_CREATURE];
	const spellHash = UrlUtil.encodeForHash([hbSpell.name, "HB"]);
	const monHash = UrlUtil.encodeForHash([hbMon.name, "HB"]);
	const loadedSpell = await DataLoader.pCacheAndGet(spellPage, "HB", spellHash, {isSilent: true});
	if (!loadedSpell || loadedSpell.name !== "HB Spark") throw new Error(`HB spell miss via ${spellHash}`);
	const loadedMon = await DataLoader.pCacheAndGet(monPage, "HB", monHash, {isSilent: true});
	if (!loadedMon || loadedMon.hp.average !== 11) throw new Error(`HB creature miss or HP ${loadedMon?.hp?.average}`);
	const foundSpell = host.findEntityDoc("HB Spark", {categoriesExact: ["spell"]});
	if (!foundSpell || foundSpell.s !== "HB") throw new Error("HB Spark not in search index");
	const foundMon = host.findEntityDoc("HB Blob", {categoriesExact: ["bestiary"]});
	if (!foundMon || foundMon.s !== "HB") throw new Error("HB Blob not in search index");
	const hbHtml = String(Renderer.hover.getFnRenderCompact(monPage, {isStatic: true})(loadedMon));
	if (!hbHtml.includes("11") || !/XP/i.test(hbHtml)) throw new Error("HB creature compact HTML missing HP or XP");
	console.log("homebrew", {spell: loadedSpell.name, monster: loadedMon.name, hp: loadedMon.hp.average, cr: loadedMon.cr});

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
