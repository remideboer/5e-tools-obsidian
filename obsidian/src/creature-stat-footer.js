import {Notice, setIcon} from "obsidian";
import {getParser} from "./fiveetools-host.js";
import {
	ensureLootData,
	isRollableTreasure,
	lootTableIdsForTreasure,
	rollSelectedTables,
	showLootRollPopup,
} from "./loot-view.js";

/**
 * Append Habitat / Treasure rows to a compact monster statblock and bind clicks.
 * @param {HTMLElement} statWrap
 * @param {object} ent
 * @param {object} plugin
 */
export function appendCreatureStatFooter (statWrap, ent, plugin) {
	if (!statWrap || !ent) return;
	const envs = Array.isArray(ent.environment) ? ent.environment.filter(Boolean) : [];
	const treasures = Array.isArray(ent.treasure) ? ent.treasure.filter(Boolean) : [];
	if (!envs.length && !treasures.length) return;

	const table = statWrap.querySelector("table.ve-stats") || statWrap;
	const Parser = getParser();
	const cr = ent.cr?.cr ?? ent.cr ?? "";

	if (envs.length) {
		const row = appendFooterRow(table, "Habitat");
		const sorted = [...envs].sort((a, b) => {
			const la = Parser.getEnvironmentDisplayName(a);
			const lb = Parser.getEnvironmentDisplayName(b);
			return String(la).localeCompare(String(lb), undefined, {sensitivity: "base"});
		});
		sorted.forEach((env, i) => {
			if (i) row.appendText(", ");
			const a = row.createEl("a", {
				cls: "fiveetools-creature-footer__link",
				text: Parser.getEnvironmentDisplayName(env),
				attr: {href: "#", "data-5e-habitat": String(env)},
			});
			a.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				void plugin.openLibrary({
					navId: "bestiary",
					bestiaryFilters: {environments: [String(env)]},
				});
			});
		});
	}

	if (treasures.length) {
		const row = appendFooterRow(table, "Treasure");
		const sorted = [...treasures].sort((a, b) => String(treasureLabel(a))
			.localeCompare(String(treasureLabel(b)), undefined, {sensitivity: "base"}));
		sorted.forEach((typ, i) => {
			if (i) row.appendText(", ");
			const wrap = row.createSpan({cls: "fiveetools-creature-footer__treasure"});
			const label = treasureLabel(typ);
			if (isRollableTreasure(typ)) {
				const a = wrap.createEl("a", {
					cls: "fiveetools-creature-footer__link",
					text: label,
					attr: {href: "#", "data-5e-treasure": String(typ)},
				});
				a.addEventListener("click", (evt) => {
					evt.preventDefault();
					evt.stopPropagation();
					void openTreasureTables(plugin, typ, cr);
				});
				const diceBtn = wrap.createEl("button", {
					cls: "fiveetools-creature-footer__roll",
					attr: {
						type: "button",
						title: "Roll treasure",
						"aria-label": "Roll treasure",
						"data-5e-treasure-roll": String(typ),
					},
				});
				setIcon(diceBtn, "dices");
				diceBtn.addEventListener("click", (evt) => {
					evt.preventDefault();
					evt.stopPropagation();
					void rollTreasure(plugin, typ, cr);
				});
			} else {
				wrap.createSpan({text: label});
			}
		});
	}
}

function appendFooterRow (host, label) {
	const tr = el(host, "tr", "fiveetools-creature-footer");
	const td = el(tr, "td");
	td.setAttribute("colspan", "6");
	const inner = el(td, "div", "fiveetools-creature-footer__row");
	const b = el(inner, "b");
	b.textContent = `${label}: `;
	return inner;
}

function el (parent, tag, cls = "") {
	if (typeof parent.createEl === "function") {
		return parent.createEl(tag, cls ? {cls} : undefined);
	}
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	parent.appendChild(node);
	return node;
}

function treasureLabel (typ) {
	const raw = String(typ || "");
	if (typeof raw.toTitleCase === "function") return raw.toTitleCase();
	return raw.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

async function openTreasureTables (plugin, typ, cr) {
	try {
		await ensureLootData(plugin);
		const ids = lootTableIdsForTreasure(typ, {cr});
		if (!ids.length) throw new Error(`No loot tables for ${treasureLabel(typ)}.`);
		plugin._lootSession = {
			ids,
			count: 1,
			results: null,
			viewId: ids[0],
		};
		await plugin.openLibrary({navId: "loot"});
	} catch (e) {
		new Notice(e.message || "Could not open treasure tables.");
	}
}

async function rollTreasure (plugin, typ, cr) {
	try {
		await ensureLootData(plugin);
		const ids = lootTableIdsForTreasure(typ, {cr});
		if (!ids.length) throw new Error(`No loot tables for ${treasureLabel(typ)}.`);
		const results = rollSelectedTables(ids, 1);
		showLootRollPopup(plugin, results);
	} catch (e) {
		new Notice(e.message || "Could not roll treasure.");
	}
}
