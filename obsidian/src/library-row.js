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

/**
 * Paint a denser library list row: name + right badge, secondary line, tooltip.
 */
export function paintLibraryRow (rowEl, doc) {
	rowEl.empty();
	const kind = rowKind(doc);
	const packed = packRow(doc, kind);

	const top = rowEl.createDiv({cls: "fiveetools-library__row-top"});
	top.createEl("div", {cls: "fiveetools-library__row-name", text: packed.name});
	if (packed.badge) {
		top.createEl("div", {cls: "fiveetools-library__row-badge", text: packed.badge});
	}
	if (packed.sub) {
		rowEl.createEl("div", {cls: "fiveetools-library__row-sub", text: packed.sub});
	}
	rowEl.setAttr("title", packed.tooltip);
	rowEl.setAttr("aria-label", packed.tooltip);
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
