const TYPE_SHORT = {
	acid: "acid",
	cold: "cold",
	fire: "fire",
	force: "force",
	poison: "poison",
	piercing: "pierce",
	radiant: "rad.",
	bludgeoning: "bludg.",
	lightning: "light.",
	necrotic: "necr.",
	psychic: "psych.",
	slashing: "slash.",
	thunder: "thund.",
};

const TYPE_RE = new RegExp(`\\b(${Object.keys(TYPE_SHORT).join("|")})\\b`, "i");

const HEAL_RE = /\b(hit points?|healing|regains?|restor\w*)\b/i;

/** Book damage and healing for one spell row. Empty when the entry has neither. */
export function spellDamageLine (ent, {slotLevel = 0, characterLevel = 0} = {}) {
	const slotCap = Number(slotLevel) || 0;
	const levelCap = Number(characterLevel) || 0;
	return [damageLine(ent, slotCap, levelCap), healLine(ent, slotCap)].filter(Boolean).join(", ");
}

function damageLine (ent, slotLevel, characterLevel) {
	const inflict = (Array.isArray(ent?.damageInflict) ? ent.damageInflict : [])
		.map(type => String(type || "").toLowerCase())
		.filter(Boolean);
	if (!inflict.length) return "";
	const cantrip = cantripLine(ent, inflict, characterLevel);
	if (cantrip) return cantrip;
	const parts = damageParts(flatten(ent?.entries), inflict);
	if (!parts.length) return "";
	attachScales(parts, scaleClauses(flatten(ent?.entriesHigherLevel)));
	const level = Number(ent?.level) || 0;
	return parts.map(part => {
		const dice = chainFor(part, level, slotLevel);
		const label = shortType(part.type);
		return label ? `${dice} ${label}` : dice;
	}).join(", ");
}

function healLine (ent, slotLevel) {
	const parts = healParts(flatten(ent?.entries));
	const scales = healScales(flatten(ent?.entriesHigherLevel));
	if (!parts.length && scales.length === 1) {
		const base = parseExpr(scales[0].base);
		if (base) parts.push({expr: base, type: "heal", scale: scales[0]});
	} else {
		attachScales(parts, scales);
	}
	if (!parts.length) return "";
	const level = Number(ent?.level) || 0;
	return parts.map(part => `${chainFor(part, level, slotLevel)} heal`).join(", ");
}

function cantripLine (ent, inflict, characterLevel) {
	const raw = ent?.scalingLevelDice;
	const blocks = Array.isArray(raw) ? raw : raw ? [raw] : [];
	const lines = [];
	for (const block of blocks) {
		if (!block?.scaling || typeof block.scaling !== "object") continue;
		const rows = Object.entries(block.scaling)
			.map(([level, dice]) => ({level: Number(level), dice: normalizeDice(dice)}))
			.filter(row => row.level > 0 && row.dice)
			.sort((a, b) => a.level - b.level);
		if (!rows.length) continue;
		const shown = cappedRows(rows, characterLevel);
		const type = typeIn(block.label) || (inflict.length === 1 ? inflict[0] : "");
		const chain = shown.map(row => row.dice).join("->");
		lines.push(type ? `${chain} ${shortType(type)}` : chain);
	}
	return lines.join(", ");
}

function cappedRows (rows, characterLevel) {
	if (!(characterLevel > 0)) return rows;
	const reached = rows.filter(row => row.level <= characterLevel);
	return reached.length ? reached : [rows[0]];
}

function damageParts (text, inflict) {
	const parts = [];
	const re = /\{@damage\s+([^}]+)\}/gi;
	let match;
	while ((match = re.exec(text))) {
		const expr = parseExpr(match[1]);
		if (!expr) continue;
		const after = text.slice(match.index + match[0].length, match.index + match[0].length + 60).split("{")[0];
		parts.push({expr, type: typeIn(after), scale: null});
	}
	const lone = inflict.length === 1 ? inflict[0] : "";
	for (const part of parts) {
		if (!part.type && lone) part.type = lone;
	}
	return parts;
}

function scaleClauses (text) {
	const scales = [];
	const re = /\{@scaledamage\s+([^}]+)\}/gi;
	let match;
	while ((match = re.exec(text))) {
		const bits = match[1].split("|");
		const add = parseExpr(bits[2] || "");
		const span = scaleSpan(bits[1] || "");
		if (!add || !span) continue;
		const sentence = sentenceAround(text, match.index);
		const named = [...sentence.matchAll(new RegExp(TYPE_RE, "gi"))].map(hit => hit[1].toLowerCase());
		const types = [...new Set(named)];
		scales.push({...span, add, types: types.length === 1 ? types : []});
	}
	return scales;
}

function attachScales (parts, scales) {
	for (const scale of scales) {
		if (scale.types.length !== 1) continue;
		for (const part of parts) {
			if (part.type === scale.types[0] && !part.scale) part.scale = scale;
		}
	}
	const unnamed = scales.filter(scale => scale.types.length !== 1);
	if (unnamed.length === 1 && parts.length === 1 && !parts[0].scale) parts[0].scale = unnamed[0];
}

function healParts (text) {
	const parts = [];
	const re = /\{@dice\s+([^}]+)\}/gi;
	let match;
	while ((match = re.exec(text))) {
		if (!isHealSentence(sentenceAround(text, match.index))) continue;
		const expr = parseExpr(match[1]);
		if (!expr) continue;
		parts.push({expr, type: "heal", scale: null});
	}
	return parts;
}

function healScales (text) {
	const scales = [];
	const re = /\{@scaledice\s+([^}]+)\}/gi;
	let match;
	while ((match = re.exec(text))) {
		if (!isHealSentence(sentenceAround(text, match.index))) continue;
		const bits = match[1].split("|");
		const add = parseExpr(bits[2] || "");
		const span = scaleSpan(bits[1] || "");
		if (!add || !span) continue;
		scales.push({...span, add, base: bits[0] || "", types: ["heal"]});
	}
	return scales;
}

function isHealSentence (sentence) {
	return HEAL_RE.test(String(sentence || ""));
}

function chainFor (part, spellLevel, slotLevel = 0) {
	if (!part.scale) return formatExpr(part.expr);
	const {from, to, every, add} = part.scale;
	const step = Math.max(1, every);
	const start = spellLevel > 0 ? Math.max(from, spellLevel) : from;
	const end = slotLevel > 0 ? Math.min(to, slotLevel) : to;
	if (end < start) return formatExpr(part.expr);
	const values = [];
	for (let slot = start; slot <= end; slot += step) {
		const adds = Math.floor((slot - from) / step);
		values.push(formatExpr(addTimes(part.expr, add, adds)));
	}
	return values.length ? values.join("->") : formatExpr(part.expr);
}

function scaleSpan (progression) {
	const span = String(progression || "").match(/(\d+)\s*-\s*(\d+)/);
	if (span) return {from: Number(span[1]), to: Number(span[2]), every: 1};
	const nums = [...new Set(String(progression || "").split(/[^\d]+/).map(Number).filter(n => n > 0))].sort((a, b) => a - b);
	if (!nums.length) return null;
	let every = 1;
	if (nums.length > 1) {
		const step = nums[1] - nums[0];
		if (nums.every((n, i) => i === 0 || n - nums[i - 1] === step)) every = step;
	}
	return {from: nums[0], to: nums[nums.length - 1], every};
}

function sentenceAround (text, index) {
	const before = Math.max(text.lastIndexOf(".", index), text.lastIndexOf(";", index));
	const from = before < 0 ? 0 : before + 1;
	const end = text.indexOf(".", index + 1);
	return text.slice(from, end === -1 ? text.length : end);
}

function typeIn (text) {
	const match = String(text || "").match(TYPE_RE);
	return match ? match[1].toLowerCase() : "";
}

function shortType (type) {
	const key = String(type || "").toLowerCase();
	return TYPE_SHORT[key] || key;
}

function normalizeDice (dice) {
	const expr = parseExpr(dice);
	return expr ? formatExpr(expr) : String(dice || "").replace(/\s+/g, "");
}

function parseExpr (raw) {
	const text = String(raw || "").split("|")[0].trim();
	if (!text) return null;
	const groups = [];
	let flat = 0;
	const re = /([+-])?\s*(\d+)\s*d\s*(\d+)|([+-])?\s*(\d+)/gi;
	let matched = false;
	let match;
	while ((match = re.exec(text))) {
		matched = true;
		const sign = (match[1] || match[4]) === "-" ? -1 : 1;
		if (match[2]) {
			const count = sign * Number(match[2]);
			const faces = Number(match[3]);
			const existing = groups.find(group => group.faces === faces);
			if (existing) existing.count += count;
			else groups.push({count, faces});
		} else {
			flat += sign * Number(match[5]);
		}
	}
	if (!matched || (!groups.length && !flat)) return null;
	return {groups, flat};
}

function addTimes (base, add, times) {
	const groups = base.groups.map(group => ({...group}));
	let flat = base.flat;
	if (times > 0) {
		for (const group of add.groups) {
			const existing = groups.find(item => item.faces === group.faces);
			if (existing) existing.count += group.count * times;
			else groups.push({count: group.count * times, faces: group.faces});
		}
		flat += add.flat * times;
	}
	return {groups, flat};
}

function formatExpr (expr) {
	const parts = [];
	for (const group of expr.groups) {
		if (!group.count) continue;
		parts.push({text: `${Math.abs(group.count)}d${group.faces}`, neg: group.count < 0});
	}
	if (expr.flat) parts.push({text: String(Math.abs(expr.flat)), neg: expr.flat < 0});
	if (!parts.length) return "0";
	return parts.map((part, index) => {
		if (index === 0) return part.neg ? `-${part.text}` : part.text;
		return part.neg ? `-${part.text}` : `+${part.text}`;
	}).join("");
}

function flatten (value) {
	if (value == null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.map(flatten).join(" ");
	if (typeof value === "object") {
		return [value.entries, value.entry, value.items, value.header, value.name]
			.map(flatten)
			.filter(Boolean)
			.join(" ");
	}
	return "";
}
