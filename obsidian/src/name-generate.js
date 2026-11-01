import {readPluginJson} from "./plugin-dir.js";

let groups = [];

export async function loadNameGroups (plugin) {
	if (groups.length) return groups;
	const json = await readPluginJson(plugin, "data", "names.json");
	groups = json?.name || [];
	return groups;
}

export function nameFields (current) {
	const species = current?.nameGroup || groups[0]?.name || "";
	const group = groups.find(it => it.name === species) || groups[0];
	if (!group) return [];
	const fields = [
		{id: "nameGroup", label: "Species", options: groups.map(it => [it.name, it.name])},
	];
	const cultures = culturesOf(group);
	if (cultures.length > 1) {
		fields.push({
			id: "culture",
			label: group.name === "Gith" ? "Lineage" : "Culture",
			options: [["", "Any"], ...cultures.map(it => [it, it])],
		});
	}
	if (group.name === "Dwarf") {
		fields.push({id: "clan", label: "Clan", options: [["Clan", "Clan"], ["Duergar Clan", "Duergar clan"]]});
	}
	const genders = gendersOf(group);
	if (genders.length > 1) {
		fields.push({
			id: "nameGender",
			label: "Name",
			options: [["", "Any"], ...genders.map(it => [it, labelFor(it)])],
		});
	}
	return fields;
}

export function rollCharacterName (opts = {}, used) {
	const group = groups.find(it => it.name === opts.nameGroup) || groups[0];
	if (!group) throw new Error("No name tables.");
	let text = "";
	for (let i = 0; i < 12; i++) {
		text = compose(group, opts);
		if (!used?.has(text)) break;
	}
	used?.add(text);
	return {title: `${group.name} names`, lines: [{text}]};
}

export function nameForSpecies (species, gender, used) {
	const mapped = mapSpecies(species);
	if (!mapped) return "";
	const group = groups.find(it => it.name === mapped.group);
	if (!group) return "";
	const opts = {
		culture: mapped.culture || "",
		nameGender: gender === "Female" || gender === "Male" ? gender : "",
		clan: mapped.clan || "",
	};
	let text = "";
	for (let i = 0; i < 12; i++) {
		text = compose(group, opts);
		if (!used?.has(text)) break;
	}
	if (text) used?.add(text);
	return text;
}

function compose (group, opts) {
	const givenTable = pickGiven(group, opts.culture || "", opts.nameGender || "");
	if (!givenTable) throw new Error("No name table for that choice.");
	const given = rollRow(givenTable);
	if (/child|virtue/i.test(givenTable.option)) return given;
	const family = pickFamily(group, opts.clan || "");
	if (!family) return given;
	const clan = rollRow(family);
	if (group.name === "Dragonborn") return `${given} of ${clan}`;
	return `${given} ${clan}`;
}

function pickGiven (group, culture, gender) {
	let tables = (group.tables || []).filter(table => !isFamily(table.option));
	if (culture) tables = tables.filter(table => table.option.toLowerCase().startsWith(culture.toLowerCase()));
	if (gender) {
		const matched = tables.filter(table => genderKey(table.option) === gender);
		if (matched.length) tables = matched;
	}
	return pick(tables);
}

function pickFamily (group, clan) {
	const tables = (group.tables || []).filter(table => isFamily(table.option));
	if (!tables.length) return null;
	if (clan) return tables.find(table => table.option === clan) || tables[0];
	return tables.find(table => table.option === "Clan" || table.option === "Family") || tables[0];
}

function culturesOf (group) {
	const found = [];
	for (const table of group.tables || []) {
		const culture = String(table.option || "").split(",")[0].trim();
		if (!culture || isFamily(culture) || culture === "Child" || culture === "Virtue" || culture === "General") continue;
		if (/female|male|adult/i.test(culture)) continue;
		if (!found.includes(culture)) found.push(culture);
	}
	return found;
}

function gendersOf (group) {
	const found = [];
	for (const table of group.tables || []) {
		if (isFamily(table.option)) continue;
		const gender = genderKey(table.option);
		if (gender && !found.includes(gender)) found.push(gender);
	}
	const order = ["Female", "Male", "Child", "Virtue"];
	return found.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function genderKey (option) {
	const text = String(option || "");
	if (/child/i.test(text)) return "Child";
	if (/virtue/i.test(text)) return "Virtue";
	if (/female/i.test(text)) return "Female";
	if (/male/i.test(text)) return "Male";
	return "";
}

function labelFor (gender) {
	if (gender === "Child") return "Child";
	if (gender === "Virtue") return "Virtue";
	return gender;
}

function isFamily (option) {
	return /clan|family/i.test(String(option || ""));
}

function rollRow (table) {
	const faces = facesOf(table.diceExpression);
	const roll = 1 + Math.floor(Math.random() * faces);
	const row = (table.table || []).find(it => roll >= it.min && roll <= it.max);
	return String((row || table.table?.[table.table.length - 1])?.result || "").trim();
}

function facesOf (expr) {
	const match = String(expr || "d100").match(/d(\d+)/i);
	return match ? Number(match[1]) : 100;
}

function mapSpecies (species) {
	const n = String(species || "").toLowerCase();
	if (!n) return null;
	if (/dragonborn/.test(n)) return {group: "Dragonborn"};
	if (/duergar/.test(n)) return {group: "Dwarf", clan: "Duergar Clan"};
	if (/dwarf/.test(n)) return {group: "Dwarf"};
	if (/githyanki/.test(n)) return {group: "Gith", culture: "Githyanki"};
	if (/githzerai/.test(n)) return {group: "Gith", culture: "Githzerai"};
	if (/gith/.test(n)) return {group: "Gith"};
	if (/gnome|svirfneblin/.test(n)) return {group: "Gnome"};
	if (/halfling/.test(n)) return {group: "Halfling"};
	if (/tiefling/.test(n)) return {group: "Tiefling"};
	if (/lizardfolk/.test(n)) return {group: "Lizardfolk"};
	if (/half-elf|half elf/.test(n)) return Math.random() < 0.5 ? {group: "Elf"} : {group: "Human"};
	if (/elf|eladrin|drow|shadar/.test(n)) return {group: "Elf"};
	if (/half-orc|half orc|^orc| orc/.test(n)) return {group: "Half-Orc"};
	if (/human/.test(n)) return {group: "Human"};
	return null;
}

function pick (list) {
	if (!list?.length) return null;
	return list[Math.floor(Math.random() * list.length)];
}
