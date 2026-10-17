import fs from "fs";
import {findEntityDoc} from "./search-index.js";
import {getConfiguredRoot, getRenderer, joinUnderRoot} from "./fiveetools-host.js";

const CR_BANDS = [
	{id: 0, label: "0–4", crMin: 0},
	{id: 5, label: "5–10", crMin: 5},
	{id: 11, label: "11–16", crMin: 11},
	{id: 17, label: "17+", crMin: 17},
];

let lootCache = null;

export function renderLootGenerator (formEl, resultEl, {onOpenItem} = {}) {
	formEl.empty();
	formEl.addClass("fiveetools-loot");
	formEl.createEl("h3", {text: "Loot Generator"});
	formEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Individual treasure or hoard tables from the Dungeon Master’s Guide.",
	});

	const form = formEl.createDiv({cls: "fiveetools-loot__form"});

	const modeWrap = form.createDiv({cls: "fiveetools-loot__row"});
	modeWrap.createEl("span", {text: "Type"});
	const modeSelect = modeWrap.createEl("select");
	modeSelect.createEl("option", {text: "Individual", attr: {value: "individual"}});
	modeSelect.createEl("option", {text: "Hoard", attr: {value: "hoard"}});

	const crWrap = form.createDiv({cls: "fiveetools-loot__row"});
	crWrap.createEl("span", {text: "Challenge"});
	const crSelect = crWrap.createEl("select");
	for (const band of CR_BANDS) {
		crSelect.createEl("option", {text: band.label, attr: {value: String(band.crMin)}});
	}

	const rollBtn = form.createEl("button", {text: "Roll", cls: "fiveetools-btn"});
	resultEl.empty();
	resultEl.createEl("p", {cls: "fiveetools-view__meta", text: "Roll to generate coins and magic items."});

	rollBtn.addEventListener("click", async () => {
		rollBtn.setAttr("disabled", "true");
		resultEl.setText("Rolling…");
		try {
			const result = rollLoot({
				kind: modeSelect.value,
				crMin: Number(crSelect.value),
			});
			renderLootResult(resultEl, result, onOpenItem);
		} catch (e) {
			resultEl.setText(`Failed to roll: ${e.message}`);
		} finally {
			rollBtn.removeAttribute("disabled");
		}
	});
}

export function rollLoot ({kind, crMin}) {
	const loot = loadLootJson();
	const tables = loot[kind] || [];
	const table = tables.find(it => it.source === "DMG" && it.crMin === crMin)
		|| tables.find(it => it.crMin === crMin);
	if (!table) throw new Error("No loot table for that challenge band.");

	const RollerUtil = globalThis.RollerUtil;
	const Renderer = getRenderer();
	const rowRoll = RollerUtil.randomise(100);
	const row = (table.table || []).find(it => rowRoll >= it.min && rowRoll <= it.max) || {};

	const coinSource = kind === "hoard" ? (table.coins || {}) : (row.coins || {});
	const coins = {};
	for (const [type, formula] of Object.entries(coinSource)) {
		const value = Renderer.dice.parseRandomise2(String(formula));
		if (value) coins[type] = value;
	}

	return {
		kind,
		name: table.name,
		rowRoll,
		coins,
		gems: rollGemsArt(row, "gems", loot, RollerUtil, Renderer),
		artObjects: rollGemsArt(row, "artObjects", loot, RollerUtil, Renderer),
		magicItems: rollMagicItems(row, loot, Renderer, RollerUtil),
	};
}

function rollGemsArt (row, prop, loot, RollerUtil, Renderer) {
	const meta = row[prop];
	if (!meta) return null;
	const count = Math.max(0, Number(Renderer.dice.parseRandomise2(String(meta.amount))) || 0);
	if (!count) return null;
	const tables = (loot[prop] || []).filter(it => it.type === meta.type);
	const table = tables.find(it => it.source === "DMG") || tables[0];
	const names = [];
	for (let i = 0; i < count; i++) {
		const pick = table?.table?.length
			? table.table[RollerUtil.randomise(table.table.length) - 1]
			: table?.name;
		names.push(parseItemTag(pick).name || table?.name || `${meta.type} gp`);
	}
	return {type: meta.type, count, names};
}

function rollMagicItems (row, loot, Renderer, RollerUtil) {
	const entries = [];
	for (const magic of row.magicItems || []) {
		const amountRaw = magic.amount == null ? "1" : String(magic.amount);
		const count = Math.max(0, Number(Renderer.dice.parseRandomise2(amountRaw)) || 0);
		if (!count) continue;

		if (!magic.type || magic.type === "randomByLevel") {
			entries.push({label: `${count} magic item${count === 1 ? "" : "s"}`});
			continue;
		}

		const tables = (loot.magicItems || []).filter(it => it.type === magic.type);
		const table = tables.find(it => it.source === "DMG") || tables[0];
		if (!table?.table?.length) {
			entries.push({label: `${count}× Table ${magic.type}`});
			continue;
		}

		for (let i = 0; i < count; i++) {
			const roll = RollerUtil.randomise(100);
			const hit = table.table.find(it => roll >= it.min && roll <= it.max);
			const parsed = parseItemTag(hit?.item);
			entries.push({
				label: parsed.name || `Table ${magic.type}`,
				name: parsed.name,
				source: parsed.source,
				table: magic.type,
			});
		}
	}
	return entries;
}

function parseItemTag (raw) {
	const text = String(raw || "");
	const match = text.match(/\{@item ([^|}]+)(?:\|([^|}]+))?/i);
	if (match) return {name: match[1].trim(), source: (match[2] || "").trim()};
	return {name: text.replace(/\{@[^}]+\}/g, "").trim(), source: ""};
}

function loadLootJson () {
	if (lootCache) return lootCache;
	const filePath = joinUnderRoot(getConfiguredRoot(), "data", "loot.json");
	lootCache = JSON.parse(fs.readFileSync(filePath, "utf8"));
	return lootCache;
}

function renderLootResult (el, result, onOpenItem) {
	el.empty();
	el.addClass("fiveetools-loot__result");
	el.createEl("h3", {text: result.name});
	el.createEl("div", {cls: "fiveetools-view__meta", text: `d100 = ${result.rowRoll}`});

	const coinText = Object.entries(result.coins)
		.map(([type, amount]) => `${amount} ${type}`)
		.join(", ");
	el.createEl("p", {text: coinText ? `Coins: ${coinText}` : "Coins: none"});

	renderNamedGroup(el, "Gems", result.gems);
	renderNamedGroup(el, "Art objects", result.artObjects);

	if (result.magicItems.length) {
		el.createEl("h4", {text: "Magic items"});
		const list = el.createEl("ul", {cls: "fiveetools-loot__items"});
		for (const item of result.magicItems) {
			const li = list.createEl("li");
			if (item.name && onOpenItem) {
				const btn = li.createEl("button", {text: item.label, cls: "fiveetools-loot__item"});
				btn.addEventListener("click", () => {
					const doc = findEntityDoc(item.name, {categoriesExact: ["item"]});
					if (doc) onOpenItem(doc);
				});
			} else {
				li.setText(item.label);
			}
		}
	} else {
		el.createEl("p", {text: "Magic items: none"});
	}
}

function renderNamedGroup (el, title, group) {
	if (!group) return;
	el.createEl("h4", {text: `${title} (${group.count}× ${group.type} gp)`});
	const list = el.createEl("ul");
	for (const name of group.names) list.createEl("li", {text: name});
}
