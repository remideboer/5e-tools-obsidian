/**
 * D&D Beyond character-sheet PDF. Stats live in widget annotations
 * (`/T` name, `/V` value), not in an AcroForm catalog.
 */

const ABILITIES = [
	{key: "str", score: "STR", mod: "STRmod", prof: "StrProf", save: "ST Strength", label: "Strength"},
	{key: "dex", score: "DEX", mod: "DEXmod", prof: "DexProf", save: "ST Dexterity", label: "Dexterity"},
	{key: "con", score: "CON", mod: "CONmod", prof: "ConProf", save: "ST Constitution", label: "Constitution"},
	{key: "int", score: "INT", mod: "INTmod", prof: "IntProf", save: "ST Intelligence", label: "Intelligence"},
	{key: "wis", score: "WIS", mod: "WISmod", prof: "WisProf", save: "ST Wisdom", label: "Wisdom"},
	{key: "cha", score: "CHA", mod: "CHamod", prof: "ChaProf", save: "ST Charisma", label: "Charisma"},
];

const SKILLS = [
	{name: "Acrobatics", field: "Acrobatics", prof: "AcrobaticsProf", ability: "dex"},
	{name: "Animal Handling", field: "Animal", prof: "AnimalHandlingProf", ability: "wis"},
	{name: "Arcana", field: "Arcana", prof: "ArcanaProf", ability: "int"},
	{name: "Athletics", field: "Athletics", prof: "AthleticsProf", ability: "str"},
	{name: "Deception", field: "Deception", prof: "DeceptionProf", ability: "cha"},
	{name: "History", field: "History", prof: "HistoryProf", ability: "int"},
	{name: "Insight", field: "Insight", prof: "InsightProf", ability: "wis"},
	{name: "Intimidation", field: "Intimidation", prof: "IntimidationProf", ability: "cha"},
	{name: "Investigation", field: "Investigation", prof: "InvestigationProf", ability: "int"},
	{name: "Medicine", field: "Medicine", prof: "MedicineProf", ability: "wis"},
	{name: "Nature", field: "Nature", prof: "NatureProf", ability: "int"},
	{name: "Perception", field: "Perception", prof: "PerceptionProf", ability: "wis"},
	{name: "Performance", field: "Performance", prof: "PerformanceProf", ability: "cha"},
	{name: "Persuasion", field: "Persuasion", prof: "PersuasionProf", ability: "cha"},
	{name: "Religion", field: "Religion", prof: "ReligionProf", ability: "int"},
	{name: "Sleight of Hand", field: "SleightofHand", prof: "SleightOfHandProf", ability: "dex"},
	{name: "Stealth", field: "Stealth", prof: "StealthProf", ability: "dex"},
	{name: "Survival", field: "Survival", prof: "SurvivalProf", ability: "wis"},
];

export function cardFromPdf (bytes) {
	const widgets = readWidgets(bytes);
	const fields = new Map();
	for (const widget of widgets) {
		if (!fields.has(widget.name)) fields.set(widget.name, widget.value);
	}
	const name = clean(fields.get("CharacterName"));
	if (!name) throw new Error("This PDF is not a D&D Beyond character sheet.");
	const identity = classesAndLevel(fields.get("CLASS  LEVEL"));
	const abilities = {};
	for (const ability of ABILITIES) abilities[ability.key] = numberOr(fields.get(ability.score), 10);
	const skills = SKILLS.map(skill => {
		const mark = fields.get(skill.prof);
		return {
			name: skill.name,
			ability: skill.ability,
			mod: signed(fields.get(skill.field)),
			proficient: isMarked(mark),
			...(isExpertise(mark) ? {expertise: true} : {}),
		};
	});
	const perception = skills.find(skill => skill.name === "Perception");
	const passive = numberOr(fields.get("Passive1"), 10 + (perception?.mod || 0));
		const spells = spellRows(widgets, fields);
	const spellNames = new Set(spells.map(spell => spell.name.toLowerCase()));
	return {
		ddbId: pdfId(name),
		name,
		species: clean(fields.get("RACE")),
		classes: identity.classes,
		level: identity.level,
		background: clean(fields.get("BACKGROUND")),
		ac: numberOr(fields.get("AC"), 10),
		hpMax: numberOr(fields.get("MaxHP"), 1),
		hpCurrent: numberOr(fields.get("CurrentHP"), numberOr(fields.get("MaxHP"), 1)),
		tempHp: numberOr(blankDash(fields.get("TempHP")), 0),
		speed: speedValue(fields.get("Speed")),
		abilities,
		edition: "classic",
		refs: [
			...identity.parts.map(part => ({kind: "class", name: part.name, label: part.level ? `${part.name} ${part.level}` : part.name, edition: "classic"})),
			...(clean(fields.get("RACE")) ? [{kind: "species", name: clean(fields.get("RACE")), label: clean(fields.get("RACE")), edition: "classic"}] : []),
			...(clean(fields.get("BACKGROUND")) ? [{kind: "background", name: clean(fields.get("BACKGROUND")), label: clean(fields.get("BACKGROUND")), edition: "classic"}] : []),
			...gearRefs(fields),
			...spells.map(spell => ({
				kind: "spell",
				name: spell.name,
				label: spell.name,
				edition: "classic",
				level: spell.level,
				...(spell.time ? {castingTime: spell.time} : {}),
				...(spell.range ? {range: spell.range} : {}),
				...(spell.duration ? {duration: spell.duration} : {}),
				...(spell.components ? {components: spell.components} : {}),
				...(spell.attack ? {attack: spell.attack} : {}),
				...(spell.save ? {save: spell.save} : {}),
				...(spell.prepared ? {prepared: true} : {}),
			})),
		],
		traits: null,
		rolls: {
			proficiency: signed(fields.get("ProfBonus")) || proficiency(identity.level),
			initiative: signed(fields.get("Init")),
			passivePerception: passive,
			saves: ABILITIES.map(ability => ({
				key: ability.key,
				label: ability.label,
				mod: signed(fields.get(ability.save)),
				proficient: isMarked(fields.get(ability.prof)),
			})),
			skills,
		},
		actions: [
			...proseActions(fields),
			...weaponActions(fields).filter(action => !spellNames.has(action.name.toLowerCase())),
		],
		slots: slotRows(fields),
		coins: {
			cp: numberOr(fields.get("CP"), 0),
			sp: numberOr(fields.get("SP"), 0),
			ep: numberOr(fields.get("EP"), 0),
			gp: numberOr(fields.get("GP"), 0),
			pp: numberOr(fields.get("PP"), 0),
		},
		conditions: [],
		deathSaves: null,
		inspiration: isMarked(fields.get("Inspiration")),
		xp: xpValue(fields.get("EXPERIENCE POINTS")),
		xpAdjustment: null,
		senses: splitList(fields.get("AdditionalSenses")),
		speeds: speedRows(fields.get("Speed")),
		defenses: defenseLines(fields.get("Defenses")),
		proficiencies: proficiencyLines(fields.get("ProficienciesLang")),
		spellcasting: spellcastingRows(fields),
		hitDice: [],
		choices: [],
		features: featureRows(fields),
		companions: [],
		story: {backstory: clean(fields.get("Backstory"))},
		avatar: null,
	};
}

function readWidgets (bytes) {
	const text = typeof bytes === "string" ? bytes : new TextDecoder("latin1").decode(bytes);
	const widgets = [];
	let cursor = 0;
	while (cursor < text.length) {
		const slash = text.indexOf("/Subtype", cursor);
		if (slash < 0) break;
		const word = text.slice(slash, slash + 24).replace(/\s+/g, "");
		if (!word.startsWith("/Subtype/Widget")) {
			cursor = slash + 8;
			continue;
		}
		const end = text.indexOf("endobj", slash);
		const begin = text.lastIndexOf(" obj", slash);
		const body = text.slice(begin < 0 ? slash : begin, end < 0 ? slash + 5000 : end);
		const name = readKey(body, "T").trim();
		const value = readKey(body, "V");
		if (name) widgets.push({name, value});
		cursor = slash + 8;
	}
	return widgets;
}

function readKey (body, key) {
	const at = findToken(body, key);
	if (at < 0) return "";
	if (body[at] === "(") return readLiteral(body, at);
	if (body[at] === "<") return readHex(body, at);
	return "";
}

function findToken (body, key) {
	const token = `/${key}`;
	let cursor = 0;
	while (cursor < body.length) {
		const at = body.indexOf(token, cursor);
		if (at < 0) return -1;
		const next = body[at + token.length] || "";
		if (key === "T" && (next === "U" || next === "y" || next === "e")) {
			cursor = at + token.length;
			continue;
		}
		let valueAt = at + token.length;
		while (body[valueAt] === " " || body[valueAt] === "\n" || body[valueAt] === "\r") valueAt++;
		if (body[valueAt] === "(" || body[valueAt] === "<") return valueAt;
		cursor = at + token.length;
	}
	return -1;
}

function readHex (text, open) {
	const end = text.indexOf(">", open);
	if (end < 0) return "";
	const hex = text.slice(open + 1, end).replace(/\s/g, "");
	const wide = hex.length >= 4 && hex.slice(0, 4).toUpperCase() === "FEFF";
	let out = "";
	for (let i = wide ? 4 : 0; i + (wide ? 4 : 2) <= hex.length; i += wide ? 4 : 2) {
		out += String.fromCharCode(parseInt(hex.slice(i, i + (wide ? 4 : 2)), 16));
	}
	return out;
}

function readLiteral (text, open) {
	let out = "";
	let depth = 1;
	for (let i = open + 1; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\\") {
			const next = text[i + 1] || "";
			if (next === "n") out += "\n";
			else if (next === "r") out += "\r";
			else if (next === "t") out += "\t";
			else if (/[0-7]/.test(next)) {
				let oct = next;
				let j = i + 2;
				while (oct.length < 3 && /[0-7]/.test(text[j] || "")) oct += text[j++];
				out += String.fromCharCode(parseInt(oct, 8));
				i = j - 1;
				continue;
			} else out += next;
			i++;
			continue;
		}
		if (ch === "(") {
			depth++;
			out += ch;
			continue;
		}
		if (ch === ")") {
			depth--;
			if (!depth) return out;
			out += ch;
			continue;
		}
		out += ch;
	}
	return out;
}

function spellRows (widgets, fields) {
	let level = 0;
	const seen = new Set();
	const spells = [];
	for (const widget of widgets) {
		if (/^spellHeader\d+$/.test(widget.name)) {
			level = spellLevel(widget.value);
			continue;
		}
		const match = widget.name.match(/^spellName(\d+)$/);
		if (!match) continue;
		const raw = clean(widget.value);
		if (!raw) continue;
		const name = raw.replace(/\s*\[R\]\s*$/i, "").trim();
		const key = name.toLowerCase();
		if (!name || seen.has(key)) continue;
		seen.add(key);
		const index = match[1];
		const hit = clean(fields.get(`spellSaveHit${index}`));
		spells.push({
			name,
			level,
			time: castingTime(fields.get(`spellCastingTime${index}`)),
			range: clean(fields.get(`spellRange${index}`)),
			duration: clean(fields.get(`spellDuration${index}`)),
			components: clean(fields.get(`spellComponents${index}`)),
			attack: /^\s*[+-]?\d+/.test(hit) ? hit : "",
			save: /^[A-Z]{3}\b/.test(hit) ? hit : "",
			prepared: isMarked(fields.get(`spellPrepared${index}`)),
		});
	}
	return spells;
}

function spellLevel (header) {
	const text = String(header || "");
	if (/cantrip/i.test(text)) return 0;
	const match = text.match(/(\d+)/);
	return match ? Number(match[1]) : 0;
}

function castingTime (value) {
	const text = clean(value);
	if (text === "1A") return "action";
	if (text === "1BA") return "bonus";
	if (text === "1R") return "reaction";
	return text;
}

function slotRows (fields) {
	const slots = [];
	for (let i = 0; i < 10; i++) {
		const level = spellLevel(fields.get(`spellHeader${i}`));
		const count = String(fields.get(`spellSlotHeader${i}`) || "").match(/(\d+)\s+Slots/i);
		if (!level || !count) continue;
		slots.push({level, max: Number(count[1]), spent: 0});
	}
	return slots;
}

const BASIC_ACTIONS = new Set([
	"attack", "magic", "dash", "disengage", "dodge", "help", "hide", "ready", "search",
	"utilize", "opportunity attack", "grapple", "shove", "improvise", "two-weapon fighting",
	"interact with an object", "study", "influence", "use an object",
]);

function proseActions (fields) {
	const lines = numbered(fields, "Actions").join("\n").split("\n");
	const actions = [];
	let activation = "action";
	let current = null;
	const store = () => {
		if (!current?.name) return;
		const uses = current.uses || usesFrom(current.snippet);
		actions.push({
			name: current.name,
			activation,
			...(current.snippet ? {snippet: current.snippet.slice(0, 160)} : {}),
			...(uses ? {uses} : {}),
		});
	};
	for (const raw of lines) {
		if (!raw.trim()) continue;
		const heading = raw.trim().match(/^===\s*(.+?)\s*===$/);
		if (heading) {
			store();
			current = null;
			activation = activationFor(heading[1]);
			continue;
		}
		if (/^\s/.test(raw) || /^[a-z(]/.test(raw.trim())) {
			if (!current) continue;
			current.snippet = `${current.snippet || ""} ${raw.trim()}`.trim();
			continue;
		}
		const title = raw.trim();
		if (/^standard actions$/i.test(title)) continue;
		if (title.split(",").every(part => BASIC_ACTIONS.has(part.trim().toLowerCase()))) continue;
		store();
		const marked = title.match(/^(.*?)\s*[•·]\s*(\d+)\s*\//);
		const name = (marked ? marked[1] : title).trim();
		current = BASIC_ACTIONS.has(name.toLowerCase()) ? null : {name, uses: marked ? Number(marked[2]) : 0, snippet: ""};
	}
	store();
	return actions.filter(action => action.name);
}

function activationFor (heading) {
	const text = heading.toLowerCase();
	if (text.includes("bonus")) return "bonus";
	if (text.includes("reaction")) return "reaction";
	if (text.includes("special")) return "special";
	return "action";
}

function usesFrom (snippet) {
	const text = String(snippet || "");
	if (/twice per (short|long) rest/i.test(text)) return 2;
	const count = text.match(/(\d+)\s+uses/i);
	return count ? Number(count[1]) : 0;
}

function weaponActions (fields) {
	const actions = [];
	for (let i = 1; i <= 12; i++) {
		const name = clean(i === 1 ? fields.get("Wpn Name") : fields.get(`Wpn Name ${i}`));
		if (!name) continue;
		const damage = clean(fields.get(`Wpn${i} Damage`));
		const parts = damage.match(/^(.*\d(?:d\d+)?(?:\s*[+-]\s*\d+)?)(?:\s+([A-Za-z]+))?$/);
		const notes = clean(fields.get(`Wpn Notes ${i}`));
		actions.push({
			name,
			...(clean(fields.get(`Wpn${i} AtkBonus`)) ? {attack: clean(fields.get(`Wpn${i} AtkBonus`))} : {}),
			...(parts ? {dice: parts[1].replace(/\s+/g, "")} : {}),
			...(parts?.[2] ? {damage: parts[2]} : {}),
			...(notes ? {snippet: notes} : {}),
		});
	}
	return actions;
}

function gearRefs (fields) {
	const refs = [];
	for (let i = 0; i < 40; i++) {
		const name = clean(fields.get(`Eq Name${i}`));
		if (!name) continue;
		const qty = numberOr(fields.get(`Eq Qty${i}`), 1);
		refs.push({kind: "item", name, label: name, edition: "classic", ...(qty > 1 ? {qty} : {})});
	}
	return refs;
}

function spellcastingRows (fields) {
	const classes = splitSlash(fields.get("spellCastingClass0"));
	const dcs = splitSlash(fields.get("spellSaveDC0"));
	const attacks = splitSlash(fields.get("spellAtkBonus0"));
	return classes.map((className, index) => ({
		className,
		dc: numberOr(dcs[index], 0),
		attack: signed(attacks[index]),
	})).filter(row => row.className);
}

function featureRows (fields) {
	const chunks = numbered(fields, "FeaturesTraits");
	const features = [];
	let group = "Features";
	for (const chunk of chunks) {
		const lines = chunk.split(/\n/).map(line => line.trim()).filter(Boolean);
		let current = null;
		for (const line of lines) {
			const heading = line.match(/^===\s*(.+?)\s*===$/);
			if (heading) {
				group = heading[1].replace(/\s+features$/i, "").trim() || "Features";
				current = null;
				continue;
			}
			const named = line.match(/^\*\s*(.+?)(?:\s+[•·]\s+.+)?$/);
			if (named && !named[1].includes("  ")) {
				current = {group, name: named[1].replace(/\s+[•·]\s+.*$/, "").trim()};
				if (current.name) features.push(current);
				continue;
			}
			if (current && !current.snippet) current.snippet = line.replace(/\s+/g, " ").slice(0, 160);
		}
	}
	return features.filter(feature => feature.name);
}

function proficiencyLines (value) {
	return String(value || "")
		.split(/\n+/)
		.map(line => line.replace(/^=+\s*|\s*=+$/g, "").trim())
		.filter(line => line && !/^===$/.test(line));
}

function defenseLines (value) {
	return String(value || "")
		.split(/\n|,\s*/)
		.map(line => line.trim())
		.filter(Boolean)
		.map(line => line
			.replace(/^immunit(?:y|ies)\s*[-:]\s*/i, "Immunity ")
			.replace(/^resistances?\s*[-:]\s*/i, "Resistance ")
			.replace(/^vulnerabilit(?:y|ies)\s*[-:]\s*/i, "Vulnerability "));
}

function classesAndLevel (value) {
	const parts = String(value || "").split(/\s*\/\s*/).map(part => part.trim()).filter(Boolean);
	let level = 0;
	const parsed = parts.map(part => {
		const match = part.match(/^(.*?)(?:\s+(\d+))?$/);
		const name = (match?.[1] || part).trim();
		const count = Number(match?.[2]) || 0;
		level += count;
		return {name, level: count};
	}).filter(part => part.name);
	return {classes: parts.join(" / "), level: level || 1, parts: parsed};
}

function speedRows (value) {
	const text = clean(value);
	const match = text.match(/(\d+)\s*ft\.?\s*(?:\(([^)]+)\))?/i);
	if (!match) return [];
	return [{label: title(match[2] || "Walk"), value: Number(match[1])}];
}

function speedValue (value) {
	const row = speedRows(value)[0];
	return row ? row.value : null;
}

function numbered (fields, prefix) {
	const rows = [];
	for (const [name, value] of fields) {
		const match = name.match(new RegExp(`^${prefix}(\\d+)$`));
		if (!match || !clean(value)) continue;
		rows.push({index: Number(match[1]), value});
	}
	rows.sort((a, b) => a.index - b.index);
	return rows.map(row => row.value);
}

function splitSlash (value) {
	return String(value || "").split(/\s*\/\s*/).map(clean).filter(Boolean);
}

function splitList (value) {
	return String(value || "").split(/\n|,\s*/).map(clean).filter(Boolean);
}

function pdfId (name) {
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
	return `pdf-${slug || "character"}`;
}

function proficiency (level) {
	return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

function isMarked (value) {
	const text = clean(value);
	return text === "•" || text === "P" || text === "E" || text === "*";
}

function isExpertise (value) {
	return clean(value) === "E";
}

function signed (value) {
	const match = String(value || "").match(/[+-]?\d+/);
	return match ? Number(match[0]) : 0;
}

function xpValue (value) {
	const text = clean(value).replace(/\s/g, "");
	if (/^\d{1,3}(\.\d{3})+$/.test(text)) return Number(text.replace(/\./g, ""));
	return numberOr(text, null);
}

function numberOr (value, fallback) {
	if (value == null || value === "") return fallback;
	const match = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
	return match ? Number(match[0]) : fallback;
}

function blankDash (value) {
	const text = clean(value);
	return text === "--" || text === "—" ? "" : text;
}

function clean (value) {
	return String(value || "").replace(/\s+/g, " ").trim();
}

function title (value) {
	const text = clean(value).toLowerCase();
	return text ? text[0].toUpperCase() + text.slice(1) : "";
}
