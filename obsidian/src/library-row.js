import {getParser} from "./fiveetools-host.js";
import {getMonsterMeta} from "./bestiary-meta.js";
import {getSpellMeta, spellLevelFull, spellLevelShort} from "./spell-meta.js";
import {getItemMeta} from "./item-meta.js";

const ALIGNMENT_LABEL = {
	U: "Unaligned",
	A: "Any alignment",
	LG: "Lawful Good",
	NG: "Neutral Good",
	CG: "Chaotic Good",
	LN: "Lawful Neutral",
	N: "Neutral",
	CN: "Chaotic Neutral",
	LE: "Lawful Evil",
	NE: "Neutral Evil",
	CE: "Chaotic Evil",
	G: "Any Good",
	E: "Any Evil",
	L: "Lawful",
	C: "Chaotic",
};

const RARITY_ORDER = [
	"none", "common", "uncommon", "rare", "very rare", "legendary", "artifact",
	"varies", "unknown (magic)", "unknown",
];

const BADGE_SORT_NAV = new Set(["bestiary", "spell", "item"]);

const MISSING = Number.POSITIVE_INFINITY;

export function libraryRowKind (doc) {
	return rowKind(doc);
}

export function navSupportsBadgeSort (navId) {
	return BADGE_SORT_NAV.has(String(navId || ""));
}

export function defaultListSort () {
	return {key: "name", dir: "asc"};
}

/**
 * Sort library docs by name or badge value (CR / rarity / level).
 * Missing badge values sort last in both directions; secondary key is name then source.
 */
export function sortLibraryDocs (docs, {key = "name", dir = "asc", kind = "other"} = {}) {
	const list = Array.isArray(docs) ? docs.slice() : [];
	const sign = dir === "desc" ? -1 : 1;
	list.sort((a, b) => {
		if (key === "badge" && (kind === "bestiary" || kind === "spell" || kind === "item")) {
			const av = badgeSortValue(a, kind);
			const bv = badgeSortValue(b, kind);
			const aMissing = av === MISSING;
			const bMissing = bv === MISSING;
			if (aMissing !== bMissing) return aMissing ? 1 : -1;
			if (av !== bv) return sign * (av - bv);
		}
		const byName = String(a?.n || "").localeCompare(String(b?.n || ""));
		if (byName) return key === "name" ? sign * byName : byName;
		return String(a?.sA || a?.s || "").localeCompare(String(b?.sA || b?.s || ""));
	});
	return list;
}

function badgeSortValue (doc, kind) {
	if (kind === "bestiary") {
		const cr = getMonsterMeta(doc)?.cr;
		if (cr == null || cr === "") return MISSING;
		const Parser = getParser();
		const n = Parser?.crToNumber?.(cr);
		return Number.isFinite(n) ? n : MISSING;
	}
	if (kind === "spell") {
		const level = getSpellMeta(doc)?.level;
		if (level == null || Number.isNaN(Number(level))) return MISSING;
		return Number(level);
	}
	if (kind === "item") {
		const rarity = String(getItemMeta(doc)?.rarity || "").toLowerCase();
		if (!rarity) return MISSING;
		const ix = RARITY_ORDER.indexOf(rarity);
		return ix >= 0 ? ix : MISSING;
	}
	return MISSING;
}

/**
 * Paint a denser library list row: name + right badge, secondary line, tooltip.
 * `packed` is `{name, badge, sub, tooltip}`.
 */
export function paintPackedLibraryRow (rowEl, packed) {
	rowEl.empty();
	const top = rowEl.createDiv({cls: "fiveetools-library__row-top"});
	top.createEl("div", {cls: "fiveetools-library__row-name", text: packed?.name || "—"});
	if (packed?.badge) {
		top.createEl("div", {cls: "fiveetools-library__row-badge", text: packed.badge});
	}
	if (packed?.sub) {
		rowEl.createEl("div", {cls: "fiveetools-library__row-sub", text: packed.sub});
	}
	rowEl.setAttr("title", packed?.tooltip || packed?.name || "");
	rowEl.removeAttribute("aria-label");
}

export function paintLibraryRow (rowEl, doc) {
	const kind = rowKind(doc);
	paintPackedLibraryRow(rowEl, packRow(doc, kind));
}

function rowKind (doc) {
	const cf = String(doc?.cf || "").toLowerCase();
	if (cf === "bestiary" || cf === "creature" || cf === "monster") return "bestiary";
	if (cf === "spell") return "spell";
	if (cf === "item") return "item";
	const c = Number(doc?.c);
	if (c === 1) return "bestiary";
	if (c === 2) return "spell";
	if (c === 4) return "item";
	return "other";
}

function packRow (doc, kind) {
	const name = String(doc?.n || "").trim() || "—";
	const source = String(doc?.sA || doc?.s || "").trim();
	const category = String(doc?.cf || "").trim();

	if (kind === "bestiary") {
		const meta = getMonsterMeta(doc);
		const cr = meta?.cr != null && meta.cr !== "" ? String(meta.cr) : "";
		const type = titleCase(meta?.types?.[0] || "");
		const align = String(meta?.alignments?.[0] || "").trim();
		const badge = cr ? `CR ${cr}` : "";
		const subParts = [type, align, source].filter(Boolean);
		const alignFull = ALIGNMENT_LABEL[align] || align;
		const tipParts = [
			name,
			cr ? `CR ${cr}` : "",
			meta?.hp != null ? `HP ${meta.hp}` : "",
			meta?.ac != null ? `AC ${meta.ac}` : "",
			type,
			alignFull,
			source || category,
		].filter(Boolean);
		return {
			name,
			badge,
			sub: subParts.join(" · "),
			tooltip: tipParts.join(" · "),
		};
	}

	if (kind === "spell") {
		const meta = getSpellMeta(doc);
		const level = meta?.level;
		const badge = level == null || Number.isNaN(level) ? "" : spellLevelShort(level);
		const classesShort = (meta?.classAbbrs || []).join(", ");
		const classesFull = (meta?.classes || []).join(", ");
		const subParts = [classesShort, source].filter(Boolean);
		const tipParts = [
			name,
			level == null || Number.isNaN(level) ? "" : spellLevelFull(level),
			classesFull,
			source || category,
		].filter(Boolean);
		return {
			name,
			badge,
			sub: subParts.join(" · ") || [category, source].filter(Boolean).join(" · "),
			tooltip: tipParts.join(" · "),
		};
	}

	if (kind === "item") {
		const meta = getItemMeta(doc);
		const badge = meta?.rarityShort || "";
		const subParts = [category || "Item", source].filter(Boolean);
		const tipParts = [
			name,
			meta?.rarity ? titleCase(meta.rarity) : "",
			source || category,
		].filter(Boolean);
		return {
			name,
			badge,
			sub: subParts.join(" · "),
			tooltip: tipParts.join(" · "),
		};
	}

	const sub = [category, source].filter(Boolean).join(" · ");
	return {
		name,
		badge: "",
		sub,
		tooltip: [name, sub].filter(Boolean).join(" · "),
	};
}

function titleCase (text) {
	const s = String(text || "");
	if (!s) return "";
	return s.charAt(0).toUpperCase() + s.slice(1);
}
