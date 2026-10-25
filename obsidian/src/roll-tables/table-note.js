import {TABLE_LIMITS} from "./table-limits.js";
import {isDelimiterRow, splitTableLine} from "./table-cells.js";
import {readPastedTable} from "./pasted-table.js";

export function tablesFolder (plugin) {
	const notes = String(plugin?.settings?.notesFolder || "5etools").replace(/\/+$/, "");
	return `${notes}/tables`;
}

function escapeCell (cell) {
	return String(cell ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Build vault note body: ## Name + markdown table.
 */
export function tableNoteText (name, headers, rows) {
	const title = String(name || "Table").trim() || "Table";
	const head = `| ${headers.map(escapeCell).join(" | ")} |`;
	const delim = `| ${headers.map(() => "---").join(" | ")} |`;
	const body = rows.map(row => `| ${row.map(escapeCell).join(" | ")} |`).join("\n");
	return `## ${title}\n\n${head}\n${delim}\n${body}\n`;
}

/**
 * Parse a roll-table vault note into name / headers / rows.
 * @returns {{ok: true, name: string, headers: string[], rows: string[][]} | {ok: false, error: string}}
 */
export function parseTableNote (text) {
	const raw = String(text || "");
	if (raw.length > TABLE_LIMITS.noteBytes) {
		return {ok: false, error: "Note is too large."};
	}
	const lines = raw.split(/\r?\n/);
	let name = "Table";
	let tableStart = -1;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		const heading = /^#{1,6}\s+(.+)$/.exec(line);
		if (heading) {
			name = heading[1].trim() || name;
			continue;
		}
		const cells = splitTableLine(line);
		if (cells.pipes && cells.cells.length) {
			tableStart = i;
			break;
		}
	}
	if (tableStart < 0) return {ok: false, error: "Note has no markdown table."};

	const header = splitTableLine(lines[tableStart].trim());
	const columns = header.cells.length;
	let rowStart = tableStart + 1;
	if (rowStart < lines.length) {
		const delim = splitTableLine(lines[rowStart].trim());
		if (isDelimiterRow(delim, columns)) rowStart++;
	}
	const rows = [];
	for (let i = rowStart; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (!trimmed) {
			if (rows.length) break;
			continue;
		}
		if (/^#{1,6}\s/.test(trimmed)) break;
		const line = splitTableLine(trimmed);
		if (!line.pipes) break;
		rows.push(line.cells.map(c => String(c ?? "").trim()));
	}
	const headers = header.cells.map(c => String(c ?? "").trim());
	if (!rows.length) return {ok: false, error: "Table has no rows."};
	if (headers.length > TABLE_LIMITS.columns) return {ok: false, error: "Too many columns."};
	if (rows.length > TABLE_LIMITS.rows) return {ok: false, error: "Too many rows."};
	for (const row of rows) {
		while (row.length < headers.length) row.push("");
		if (row.length > headers.length) row.length = headers.length;
	}
	return {ok: true, name, headers, rows};
}

/**
 * Preview paste as note text without writing.
 */
export function previewPastedNote (name, pasted) {
	const parsed = readPastedTable(pasted);
	if (!parsed.ok) return parsed;
	return {
		ok: true,
		headers: parsed.headers,
		rows: parsed.rows,
		text: tableNoteText(name, parsed.headers, parsed.rows),
	};
}
