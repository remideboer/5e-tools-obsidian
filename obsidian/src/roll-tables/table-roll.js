import {
	dieInText,
	dieOfHeader,
	dieOfNumbers,
	isWeightHeader,
	looksLikeRoll,
	plainCell,
	readRollCell,
	readWeight,
	rollDie,
} from "./die-ranges.js";

function inRange (total, ranges) {
	return ranges.some(range => total >= range.min && total <= range.max);
}

function detectRollColumn (headers, rows) {
	for (let c = 0; c < headers.length; c++) {
		if (dieOfHeader(headers[c])) return c;
		if (isWeightHeader(headers[c])) continue;
		const sample = rows.slice(0, Math.min(rows.length, 20));
		if (sample.every(row => looksLikeRoll(row[c]) && readRollCell(row[c]))) return c;
	}
	return -1;
}

function detectWeightColumn (headers) {
	for (let c = 0; c < headers.length; c++) {
		if (isWeightHeader(headers[c])) return c;
	}
	return -1;
}

/**
 * Resolve how to roll a parsed table.
 * @returns {{mode: "die"|"weight"|"equal", die?: object, rollCol?: number, weightCol?: number, ranges?: object[]}|null}
 */
export function resolveTableRoll (headers, rows, noteName = "") {
	if (!headers?.length || !rows?.length) return null;
	const rollCol = detectRollColumn(headers, rows);
	if (rollCol >= 0) {
		const ranges = rows.map(row => readRollCell(row[rollCol]));
		if (ranges.every(Boolean)) {
			const fromHeader = dieOfHeader(headers[rollCol]);
			const fromNumbers = dieOfNumbers(ranges.flat());
			const fromName = dieInText(noteName) || dieInText(headers.join(" "));
			const tableDie = fromHeader || fromNumbers || fromName;
			if (tableDie) return {mode: "die", die: tableDie, rollCol, ranges};
			// Numbered rows without a matching die face — equal pick, hide roll column in results.
			return {mode: "equal", rollCol};
		}
	}
	const weightCol = detectWeightColumn(headers);
	if (weightCol >= 0) {
		const weights = rows.map(row => readWeight(row[weightCol]));
		if (weights.every(w => w != null)) return {mode: "weight", weightCol, weights};
	}
	return {mode: "equal", rollCol: -1};
}

function pickWeighted (weights, random) {
	const total = weights.reduce((a, b) => a + b, 0);
	let r = random() * total;
	for (let i = 0; i < weights.length; i++) {
		r -= weights[i];
		if (r <= 0) return i;
	}
	return weights.length - 1;
}

function resultCells (headers, row, skipCol) {
	const cells = [];
	for (let c = 0; c < headers.length; c++) {
		if (c === skipCol) continue;
		const text = plainCell(row[c]);
		if (!text) continue;
		cells.push({header: headers[c], text: row[c]});
	}
	return cells;
}

/**
 * Roll once on a parsed table.
 * @returns {{die: object|null, total: number|null, rowIndex: number, row: string[], cells: {header: string, text: string}[]}}
 */
export function rollOnTable (headers, rows, noteName = "", random = Math.random) {
	const plan = resolveTableRoll(headers, rows, noteName);
	if (!plan) throw new Error("Empty table.");

	if (plan.mode === "die") {
		const total = rollDie(plan.die, random);
		let rowIndex = plan.ranges.findIndex(ranges => inRange(total, ranges));
		if (rowIndex < 0) rowIndex = 0;
		const row = rows[rowIndex];
		return {
			die: plan.die,
			total,
			rowIndex,
			row,
			cells: resultCells(headers, row, plan.rollCol),
		};
	}

	let rowIndex;
	if (plan.mode === "weight") rowIndex = pickWeighted(plan.weights, random);
	else rowIndex = Math.floor(random() * rows.length);

	const row = rows[rowIndex];
	const skip = plan.mode === "weight" ? plan.weightCol : (plan.rollCol ?? -1);
	return {
		die: null,
		total: null,
		rowIndex,
		row,
		cells: resultCells(headers, row, skip),
	};
}
