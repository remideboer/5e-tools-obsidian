const NUMBER_WORDS = ["", "one", "two", "three", "four"];

export const CR_STEPS = [
	"0", "1/8", "1/4", "1/2",
	"1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
	"11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
	"21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
];

export function crLabel (cr) {
	if (cr && typeof cr === "object") return String(cr.cr ?? "");
	return String(cr ?? "");
}

export function crNumber (cr) {
	const label = crLabel(cr);
	if (label === "1/8") return 0.125;
	if (label === "1/4") return 0.25;
	if (label === "1/2") return 0.5;
	const n = Number(label);
	return Number.isFinite(n) ? n : null;
}

export function attackCountForCr (cr) {
	if (cr < 1) return 1;
	if (cr <= 4) return 2;
	if (cr <= 10) return 3;
	return 4;
}

export function homebrewName (originalName, label) {
	const base = String(originalName || "Creature").replace(/\s+\(CR [^)]+\)$/i, "");
	return `${base} (CR ${label})`;
}

export function adjustMultiattack (mon, crNumberValue) {
	const action = (mon?.action || []).find(entry => /^multiattack$/i.test(String(entry?.name || "")));
	if (!action?.entries) return mon;
	const word = NUMBER_WORDS[attackCountForCr(crNumberValue)];
	action.entries = action.entries.map(entry => {
		if (typeof entry !== "string") return entry;
		if (/\bmakes\s+(?:one|two|three|four|five|six|\d+)\b/i.test(entry)) {
			return entry.replace(/\bmakes\s+(?:one|two|three|four|five|six|\d+)\b/i, `makes ${word}`);
		}
		return entry.replace(/\b(?:one|two|three|four|five|six|\d+)\s+attacks\b/i, `${word} attacks`);
	});
	return mon;
}
