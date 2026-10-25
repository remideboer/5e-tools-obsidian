import {TABLE_LIMITS} from "./table-limits.js";
import {isDelimiterRow, splitTableLine} from "./table-cells.js";

const NUMBERED = /^(\d{1,4})[.)]\s+(\S.*)$/;
const NUMBERED_SPAN = /^(\d{1,4})\s*[-–—‒]\s*(\d{1,4})[.)]?\s+(\S.*)$/;
const BULLET = /^[-*•]\s+(\S.*)$/;

function fail (error) {
	return {ok: false, error};
}

function ok (headers, rows) {
	return {ok: true, headers, rows};
}

function trimCells (cells) {
	return cells.map(cell => String(cell ?? "").trim());
}

function checkSize (headers, rows) {
	if (headers.length > TABLE_LIMITS.columns) return fail(`At most ${TABLE_LIMITS.columns} columns.`);
	if (rows.length > TABLE_LIMITS.rows) return fail(`At most ${TABLE_LIMITS.rows} rows.`);
	if (!rows.length) return fail("Paste at least one result row.");
	for (const row of rows) {
		if (row.length !== headers.length) return fail("Every row needs the same number of columns.");
		for (const cell of row) {
			if (String(cell).length > TABLE_LIMITS.cellCharacters) {
				return fail(`Cells can be at most ${TABLE_LIMITS.cellCharacters} characters.`);
			}
		}
	}
	return null;
}

function readMarkdown (text) {
	const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
	if (lines.length < 2) return null;
	const header = splitTableLine(lines[0]);
	if (!header.pipes || !header.cells.length) return null;
	const columns = header.cells.length;
	let start = 1;
	const delim = splitTableLine(lines[1]);
	if (isDelimiterRow(delim, columns)) start = 2;
	const rows = [];
	for (let i = start; i < lines.length; i++) {
		const line = splitTableLine(lines[i]);
		if (!line.pipes) return fail("Markdown table rows must use | separators.");
		rows.push(trimCells(line.cells));
	}
	const headers = trimCells(header.cells);
	const size = checkSize(headers, rows);
	return size || ok(headers, rows);
}

function readTsv (text) {
	const lines = text.split(/\r?\n/).map(line => line.trimEnd()).filter(line => line.length);
	if (lines.length < 2) return null;
	if (!lines.some(line => line.includes("\t"))) return null;
	const rows = lines.map(line => trimCells(line.split("\t")));
	const width = Math.max(...rows.map(row => row.length));
	if (width < 2) return null;
	const padded = rows.map(row => {
		while (row.length < width) row.push("");
		return row.slice(0, width);
	});
	const headers = padded[0];
	const body = padded.slice(1);
	const size = checkSize(headers, body);
	return size || ok(headers, body);
}

function readNumberedList (text) {
	const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
	if (!lines.length) return null;
	const rows = [];
	let numbered = 0;
	for (const line of lines) {
		const span = NUMBERED_SPAN.exec(line);
		if (span) {
			numbered++;
			rows.push([`${span[1]}-${span[2]}`, span[3].trim()]);
			continue;
		}
		const one = NUMBERED.exec(line);
		if (one) {
			numbered++;
			rows.push([one[1], one[2].trim()]);
			continue;
		}
		const bullet = BULLET.exec(line);
		if (bullet) {
			rows.push([String(rows.length + 1), bullet[1].trim()]);
			continue;
		}
		if (rows.length) rows.push([String(rows.length + 1), line]);
		else return null;
	}
	if (!numbered && rows.length < 2) return null;
	const headers = ["d", "Result"];
	const size = checkSize(headers, rows);
	return size || ok(headers, rows);
}

/**
 * Parse pasted table text into headers + rows.
 * Supports markdown tables, TSV, and numbered/bullet lists.
 * @returns {{ok: true, headers: string[], rows: string[][]} | {ok: false, error: string}}
 */
export function readPastedTable (text) {
	const raw = String(text || "");
	if (!raw.trim()) return fail("Paste a table or numbered list.");
	if (raw.length > TABLE_LIMITS.noteBytes) {
		return fail(`Paste is too large (max ${TABLE_LIMITS.noteBytes / 1024} KiB).`);
	}
	const md = readMarkdown(raw);
	if (md) return md;
	const tsv = readTsv(raw);
	if (tsv) return tsv;
	const list = readNumberedList(raw);
	if (list) return list;
	return fail("Could not parse paste. Use a markdown table, tab-separated rows, or a numbered list.");
}
