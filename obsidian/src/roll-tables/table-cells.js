export function splitTableLine (line) {
	const text = String(line || "").trim();
	const lastClose = text.lastIndexOf("]]");
	const cells = [];
	let current = "";
	let pipes = 0;
	let endsWithPipe = false;
	let i = 0;
	while (i < text.length) {
		const char = text[i];
		endsWithPipe = false;
		if (char === "\\" && text[i + 1] === "|") {
			current += "|";
			i += 2;
			continue;
		}
		if (char === "[" && text[i + 1] === "[" && i + 2 <= lastClose) {
			const close = text.indexOf("]]", i + 2);
			current += text.slice(i, close + 2).replace(/\\\|/g, "|");
			i = close + 2;
			continue;
		}
		if (char === "|") {
			cells.push(current.trim());
			current = "";
			pipes++;
			endsWithPipe = true;
		} else {
			current += char;
		}
		i++;
	}
	if (!endsWithPipe) cells.push(current.trim());
	if (text.startsWith("|")) cells.shift();
	return {cells, pipes};
}

const DELIMITER_CELL = /^:?-+:?$/;

export function isDelimiterRow (line, columns) {
	return line.pipes > 0 && line.cells.length === columns && line.cells.every(cell => DELIMITER_CELL.test(cell));
}
