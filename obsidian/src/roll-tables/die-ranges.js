const NUMBER = "(\\d{1,6})";
const DASH = "(?:-|–|—|‒|to)";
const SINGLE = new RegExp(`^${NUMBER}$`);
const SPAN = new RegExp(`^${NUMBER}\\s*${DASH}\\s*${NUMBER}$`, "i");
const AT_MOST = new RegExp(`^(?:${NUMBER}\\s*(?:or (?:less|lower|fewer|below)|-|–|—)|(?:≤|<=)\\s*${NUMBER})$`, "i");
const AT_LEAST = new RegExp(`^(?:${NUMBER}\\s*(?:\\+|or (?:more|higher|above))|(?:≥|>=)\\s*${NUMBER})$`, "i");
const DIE = /^(?:dice:\s*)?(\d{0,2})d(\d{1,4}|%)$/i;
const DIE_IN_TEXT = /\broll(?:\s+(?:a|an|one))?\s+(\d{0,2})d(\d{1,4}|%)\b|\((\d{0,2})d(\d{1,4}|%)\)/i;
const WEIGHT_HEADER = /^(?:weight|wt|×)$/i;
const DIE_BY_HIGHEST = new Map([[4, 4], [6, 6], [8, 8], [10, 10], [12, 12], [20, 20], [100, 100]]);

export function plainCell (cell) {
	return String(cell || "").replace(/[*_`]/g, "").trim();
}

function number (text) {
	return text === "00" ? 100 : Number(text);
}

function readPart (part) {
	const single = SINGLE.exec(part);
	if (single) {
		const value = number(single[1]);
		return {min: value, max: value};
	}
	const span = SPAN.exec(part);
	if (span) {
		const min = number(span[1]);
		const max = number(span[2]);
		return min <= max ? {min, max} : null;
	}
	const atMost = AT_MOST.exec(part);
	if (atMost) return {min: -Infinity, max: number(atMost[1] ?? atMost[2])};
	const atLeast = AT_LEAST.exec(part);
	if (atLeast) return {min: number(atLeast[1] ?? atLeast[2]), max: Infinity};
	return null;
}

export function readRollCell (cell) {
	const parts = plainCell(cell).split(",").map(part => part.trim());
	if (parts.length > 32) return null;
	const ranges = [];
	for (const part of parts) {
		const range = readPart(part);
		if (!range) return null;
		ranges.push(range);
	}
	return ranges;
}

export function looksLikeRoll (cell) {
	return /^(?:\d|≤|≥|<=|>=)/.test(plainCell(cell));
}

function die (count, faces) {
	if (count < 1 || count > 10 || faces < 2 || faces > 1000) return null;
	if (faces === 66) return count === 1 ? {label: "d66", count: 2, faces: 6, d66: true} : null;
	return {label: `${count === 1 ? "" : count}d${faces}`, count, faces, d66: false};
}

function dieOf (count, faces) {
	return die(count ? Number(count) : 1, faces === "%" ? 100 : Number(faces));
}

export function dieOfHeader (header) {
	const match = DIE.exec(plainCell(header));
	return match ? dieOf(match[1], match[2]) : null;
}

export function dieInText (text) {
	const match = DIE_IN_TEXT.exec(String(text || ""));
	if (!match) return null;
	return match[2] !== undefined ? dieOf(match[1], match[2]) : dieOf(match[3], match[4]);
}

export function isD66Value (value) {
	const tens = Math.floor(value / 10);
	const ones = value % 10;
	return Number.isInteger(value) && tens >= 1 && tens <= 6 && ones >= 1 && ones <= 6;
}

export function dieOfNumbers (ranges) {
	const finite = ranges.flatMap(range => [range.min, range.max]).filter(Number.isFinite);
	if (!finite.length) return null;
	const highest = Math.max(...finite);
	if (highest === 66 && finite.every(isD66Value)) return die(1, 66);
	const faces = DIE_BY_HIGHEST.get(highest);
	return faces === undefined ? null : die(1, faces);
}

export function isWeightHeader (header) {
	return WEIGHT_HEADER.test(plainCell(header));
}

export function readWeight (cell) {
	const text = plainCell(cell);
	if (!/^\d{1,9}(?:\.\d{1,6})?$/.test(text)) return null;
	const n = Number(text);
	return Number.isFinite(n) && n > 0 ? n : null;
}

export function rollDie (tableDie, random = Math.random) {
	if (tableDie.d66) {
		const tens = 1 + Math.floor(random() * 6);
		const ones = 1 + Math.floor(random() * 6);
		return tens * 10 + ones;
	}
	let total = 0;
	for (let i = 0; i < tableDie.count; i++) total += 1 + Math.floor(random() * tableDie.faces);
	return total;
}
