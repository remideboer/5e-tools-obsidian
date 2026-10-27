import {decompressIndex} from "./decompress-index.js";
import {CORPUS_PAGES, MAX_SEARCH_RESULTS} from "./constants.js";
import {getElasticlunr, getParser, getSearchUtil, getStyleHint, getUrlUtil} from "./fiveetools-host.js";
import {getBrewJson, HOMEBREW_TYPES} from "./homebrew-store.js";
import {docMatchesBestiaryFilters, hasBestiaryFilters, loadMonsterMeta, resetMonsterMeta} from "./bestiary-meta.js";
import {docMatchesSpellFilters, hasSpellFilters, loadSpellMeta, resetSpellMeta} from "./spell-meta.js";
import {docMatchesItemFilters, hasItemFilters, loadItemMeta, resetItemMeta} from "./item-meta.js";
import {pluginVaultDir, readPluginJson} from "./plugin-dir.js";

const CATEGORY_ALIAS = {
	creature: ["bestiary"],
	monster: ["bestiary"],
	mon: ["bestiary"],
	sp: ["spell"],
	bg: ["background"],
	itm: ["item"],
	ft: ["feat"],
	con: ["condition"],
	race: ["species"],
	adv: ["adventure"],
	bk: ["book"],
	veh: ["vehicle"],
	obj: ["object"],
	trap: ["trap"],
	hazard: ["hazard"],
	trapshazard: ["trap", "hazard"],
	cult: ["cult"],
	boon: ["boon"],
	cultsboon: ["cult", "boon"],
	god: ["deity"],
	rcp: ["recipe"],
	tbl: ["table"],
	cf: ["class feature"],
	scf: ["subclass feature"],
	rule: ["rule"],
};

let loadedRoot = "";
let searchIndex = null;
let homebrewDocIds = new Set();

export async function ensureSearchIndex (plugin) {
	const root = pluginVaultDir(plugin);
	if (searchIndex && loadedRoot === root) return searchIndex;
	resetMonsterMeta();
	resetSpellMeta();
	resetItemMeta();

	const elasticlunr = getElasticlunr();
	const Parser = getParser();
	const SearchUtil = getSearchUtil();

	elasticlunr.clearStopWords();
	const index = elasticlunr(function () {
		this.addField("n");
		this.addField("sA");
		this.setRef("id");
	});
	SearchUtil.removeStemmer(index);

	const raw = await readPluginJson(plugin, "search", "index.json");
	const docs = decompressIndex(raw);
	for (const doc of docs) {
		if (!doc || doc.n == null) continue;
		doc.cf = Parser.pageCategoryToFull(doc.c);
		doc.sA ||= doc.s ? Parser.sourceJsonToAbv(doc.s) : null;
		index.addDoc(doc);
	}

	searchIndex = index;
	loadedRoot = root;
	homebrewDocIds.clear();
	await Promise.all([
		loadMonsterMeta(plugin),
		loadSpellMeta(plugin),
		loadItemMeta(plugin),
	]);
	return searchIndex;
}

export function brewDocFromEntity (ent, type) {
	const Parser = getParser();
	const UrlUtil = getUrlUtil();
	const source = ent.source || "HB";
	const hashBuilder = UrlUtil.URL_TO_HASH_BUILDER[type.prop] || ((it) => UrlUtil.encodeForHash([it.name, source]));
	const hash = hashBuilder(ent);
	return {
		id: `hb:${type.prop}:${hash}`,
		n: ent.name,
		u: hash,
		s: source,
		sA: "HB",
		c: type.catId,
		cf: Parser.pageCategoryToFull(type.catId),
	};
}

export function indexHomebrewDocs () {
	if (!searchIndex) return [];
	const brew = getBrewJson();
	const nextIds = new Set();
	const docs = [];
	for (const type of HOMEBREW_TYPES) {
		for (const ent of brew[type.prop] || []) {
			if (!ent?.name) continue;
			const doc = brewDocFromEntity(ent, type);
			nextIds.add(doc.id);
			if (searchIndex.documentStore.hasDoc(doc.id)) searchIndex.updateDoc(doc);
			else searchIndex.addDoc(doc);
			docs.push(doc);
		}
	}
	for (const id of homebrewDocIds) {
		if (nextIds.has(id)) continue;
		if (searchIndex.documentStore.hasDoc(id)) searchIndex.removeDocByRef(id);
	}
	homebrewDocIds = nextIds;
	return docs;
}

function parseQuery (rawQuery, chipAliases) {
	let query = String(rawQuery || "");
	const categories = [];
	const sources = [];

	query = query.replace(/\bsource:\s*(?<isNegate>!)?(?<source>\S+)/ig, (...m) => {
		const {isNegate, source} = m.at(-1);
		sources.push({isNegate: !!isNegate, value: source.trim().toLowerCase()});
		return " ";
	});

	query = query.replace(/\bin:\s*(?<isNegate>!)?(?<category>\S+)/ig, (...m) => {
		const {isNegate, category} = m.at(-1);
		categories.push({isNegate: !!isNegate, values: expandCategory(category)});
		return " ";
	});

	if (chipAliases?.length) {
		categories.push({isNegate: false, values: chipAliases});
	}

	return {
		term: query.replace(/\s+/g, " ").trim(),
		categories,
		sources,
	};
}

function expandCategory (category) {
	const key = String(category || "").toLowerCase().replace(/s$/, "");
	if (CATEGORY_ALIAS[key]) return CATEGORY_ALIAS[key].map(it => it.toLowerCase());
	return [key];
}

function sourcePriority (doc) {
	const Parser = getParser();
	const s = doc?.s;
	const modern = s === Parser.SRC_XPHB || s === Parser.SRC_XDMG || s === Parser.SRC_XMM;
	const legacy = !!globalThis.SourceUtil?.isLegacySourceWotc?.(s);
	if (getStyleHint() === "one") {
		if (modern) return 0;
		if (legacy) return 2;
		return 1;
	}
	if (s === Parser.SRC_PHB || s === Parser.SRC_DMG || s === Parser.SRC_MM) return 0;
	if (modern) return 2;
	return 1;
}

function preferModernDoc (hit, docs, matchPage, linkText = "") {
	if (getStyleHint() !== "one" || !hit) return hit;
	const Parser = getParser();
	const modern = new Set([Parser.SRC_XPHB, Parser.SRC_XDMG, Parser.SRC_XMM]);
	if (modern.has(hit.s)) return hit;
	if (!globalThis.SourceUtil?.isLegacySourceWotc?.(hit.s)) return hit;
	const name = String(linkText || hit.n || "").toLowerCase();
	if (!name) return hit;
	const upgrade = docs.find(doc => doc
		&& matchPage(doc)
		&& modern.has(doc.s)
		&& String(doc.n || "").toLowerCase() === name);
	return upgrade || hit;
}

function docMatchesFilters (doc, parsed, categoriesExact = []) {
	const category = String(doc.cf || "").toLowerCase();
	const sourceAbv = String(doc.sA || "").toLowerCase();
	const source = String(doc.s || "").toLowerCase();

	if (categoriesExact.length) {
		const allowed = new Set(categoriesExact.map(it => String(it).toLowerCase()));
		if (!allowed.has(category)) return false;
	}

	for (const filter of parsed.categories) {
		const hit = filter.values.some(val => category === val || category.includes(val));
		if (filter.isNegate ? hit : !hit) return false;
	}

	for (const filter of parsed.sources) {
		const hit = sourceAbv === filter.value || source === filter.value;
		if (filter.isNegate ? hit : !hit) return false;
	}

	return true;
}

export function searchEntities (rawQuery, {chipAliases = [], categoriesExact = [], limit = MAX_SEARCH_RESULTS} = {}) {
	if (!searchIndex) return [];

	const parsed = parseQuery(rawQuery, chipAliases);
	const hasFilter = parsed.categories.length || parsed.sources.length || categoriesExact.length;
	if (!parsed.term && !hasFilter) return [];
	if (parsed.term && parsed.term.length < 2 && !hasFilter) return [];

	const results = parsed.term
		? searchIndex.search(parsed.term, {
			fields: {
				n: {boost: 5, expand: true},
				sA: {expand: true},
			},
			bool: "AND",
			expand: true,
		})
		: Object.values(searchIndex.documentStore.docs).map(doc => ({doc, score: 1}));

	const out = [];
	for (const result of results) {
		const doc = result.doc;
		if (!doc || !docMatchesFilters(doc, parsed, categoriesExact)) continue;
		out.push({doc, score: result.score || 0});
	}
	out.sort((a, b) => {
		const bySource = sourcePriority(a.doc) - sourcePriority(b.doc);
		if (bySource) return bySource;
		return (b.score || 0) - (a.score || 0);
	});
	return out.slice(0, limit).map(it => it.doc);
}

export function listEntities ({
	categoriesExact = [],
	query = "",
	limit = null,
	bestiaryFilters,
	spellFilters,
	itemFilters,
} = {}) {
	if (!searchIndex) return [];
	const cats = new Set((categoriesExact || []).map(it => String(it).toLowerCase()));
	const term = String(query || "").trim();
	const filtered = hasBestiaryFilters(bestiaryFilters)
		|| hasSpellFilters(spellFilters)
		|| hasItemFilters(itemFilters);
	const capped = Number.isFinite(limit) && limit > 0;

	let docs;
	if (term.length >= 2 && !filtered) {
		const searchLimit = capped ? Math.max(limit, 400) : Number.MAX_SAFE_INTEGER;
		docs = searchEntities(term, {categoriesExact, limit: searchLimit});
	} else {
		docs = Object.values(searchIndex.documentStore.docs)
			.filter(doc => doc && (!cats.size || cats.has(String(doc.cf || "").toLowerCase())));
		if (term.length >= 2) {
			const needle = term.toLowerCase();
			docs = docs.filter(doc => String(doc.n || "").toLowerCase().includes(needle));
		}
		docs.sort((a, b) => {
			const byName = String(a.n || "").localeCompare(String(b.n || ""));
			if (byName) return byName;
			return sourcePriority(a) - sourcePriority(b);
		});
	}
	if (hasBestiaryFilters(bestiaryFilters)) docs = docs.filter(doc => docMatchesBestiaryFilters(doc, bestiaryFilters));
	if (hasSpellFilters(spellFilters)) docs = docs.filter(doc => docMatchesSpellFilters(doc, spellFilters));
	if (hasItemFilters(itemFilters)) docs = docs.filter(doc => docMatchesItemFilters(doc, itemFilters));
	return capped ? docs.slice(0, limit) : docs;
}

export function findEntityDoc (name, {categoriesExact = [], source = ""} = {}) {
	const needle = String(name || "").toLowerCase();
	if (!needle || !searchIndex) return null;
	const sourceLc = String(source || "").toLowerCase();
	const pick = (docs) => {
		if (!docs?.length) return null;
		if (sourceLc) {
			return docs.find(doc => String(doc.s || "").toLowerCase() === sourceLc)
				|| docs.find(doc => String(doc.n || "").toLowerCase() === needle)
				|| docs[0];
		}
		return docs.find(doc => String(doc.n || "").toLowerCase() === needle) || docs[0] || null;
	};

	const hits = searchEntities(name, {categoriesExact, limit: 40});
	const fromSearch = pick(hits);
	if (fromSearch && String(fromSearch.n || "").toLowerCase() === needle) return fromSearch;

	const cats = new Set((categoriesExact || []).map(it => String(it).toLowerCase()));
	const exact = Object.values(searchIndex.documentStore.docs).filter(doc => {
		if (!doc || String(doc.n || "").toLowerCase() !== needle) return false;
		if (cats.size && !cats.has(String(doc.cf || "").toLowerCase())) return false;
		return true;
	});
	exact.sort((a, b) => sourcePriority(a) - sourcePriority(b));
	return pick(exact) || fromSearch || null;
}

/**
 * Exact-name match for a character card. `edition` is "classic" (2014) or "one" (2024).
 * Does not follow the plugin style switcher and does not call preferModernDoc.
 */
export function findEditionDoc (name, {categoriesExact = [], edition = "classic"} = {}) {
	const needle = String(name || "").trim().toLowerCase();
	if (!needle || !searchIndex) return null;
	const Parser = getParser();
	const modern = new Set([Parser.SRC_XPHB, Parser.SRC_XDMG, Parser.SRC_XMM]);
	const cats = new Set((categoriesExact || []).map(it => String(it).toLowerCase()));
	const exact = Object.values(searchIndex.documentStore.docs).filter(doc => {
		if (!doc || String(doc.n || "").toLowerCase() !== needle) return false;
		if (cats.size && !cats.has(String(doc.cf || "").toLowerCase())) return false;
		return true;
	});
	if (!exact.length) return null;
	const classic = exact.filter(doc => !modern.has(doc.s));
	if (edition === "one") {
		const reprinted = exact.filter(doc => modern.has(doc.s));
		if (reprinted.length) return reprinted.sort(compareEditionDoc)[0];
	}
	const pool = classic.length ? classic : (edition === "one" ? exact : []);
	if (!pool.length) return null;
	return pool.sort(compareEditionDoc)[0];
}

const FEATURE_CATEGORIES = new Set(["class feature", "subclass feature", "optional feature"]);

/** Class and subclass features are indexed as "Class Level; Name". */
export function findNamedFeature (name, {edition = "classic", prefer = []} = {}) {
	const needle = String(name || "").trim().toLowerCase();
	if (!needle || !searchIndex) return null;
	const Parser = getParser();
	const modern = new Set([Parser.SRC_XPHB, Parser.SRC_XDMG, Parser.SRC_XMM]);
	const preferLc = prefer.map(token => String(token || "").toLowerCase()).filter(token => token.length > 3);
	const hits = Object.values(searchIndex.documentStore.docs).filter(doc => {
		if (!doc || !FEATURE_CATEGORIES.has(String(doc.cf || "").toLowerCase())) return false;
		const title = String(doc.n || "").toLowerCase();
		return title === needle || title.endsWith(`; ${needle}`);
	});
	if (!hits.length) return null;
	const classic = hits.filter(doc => !modern.has(doc.s));
	const reprinted = hits.filter(doc => modern.has(doc.s));
	const pool = edition === "one"
		? (reprinted.length ? reprinted : classic)
		: (classic.length ? classic : []);
	if (!pool.length) return null;
	const rank = (doc) => {
		const title = String(doc.n || "").toLowerCase();
		return preferLc.reduce((sum, token) => sum + (title.includes(token) ? 1 : 0), 0);
	};
	return pool.sort((a, b) => rank(b) - rank(a) || compareEditionDoc(a, b))[0];
}

export function sourceAbbr (source) {
	const Parser = getParser();
	const id = String(source || "");
	if (!id) return "";
	return Parser.sourceJsonToAbv?.(id) || Parser.SOURCE_JSON_TO_ABV?.[id] || id;
}

function compareEditionDoc (a, b) {
	const Parser = getParser();
	const rank = (doc) => {
		const s = doc?.s;
		if (s === Parser.SRC_PHB || s === Parser.SRC_XPHB) return 0;
		if (s === Parser.SRC_DMG || s === Parser.SRC_XDMG) return 1;
		if (s === Parser.SRC_MM || s === Parser.SRC_XMM) return 2;
		return 3;
	};
	const byRank = rank(a) - rank(b);
	if (byRank) return byRank;
	return String(a?.s || "").localeCompare(String(b?.s || ""));
}

export function docFromHref (href, {linkText = ""} = {}) {
	if (!href || /^https?:\/\//i.test(href) || href.startsWith("mailto:")) return null;
	const parsed = parseInternalHref(href);
	if (!parsed) return null;
	return lookupDoc(parsed.page, parsed.hash, linkText);
}

export function docFromVetLink ({page, source, hash, linkText = ""} = {}) {
	return lookupDoc(page, hash, linkText, source);
}

function lookupDoc (page, hash, linkText = "", source = "") {
	const pageName = String(page || "").replace(/\\/g, "/").split("/").pop();
	const hashLc = String(hash || "").split("&")[0].trim().toLowerCase();
	if (!pageName || !hashLc || hashLc === "blankhash") return null;
	if (CORPUS_PAGES.has(pageName)) return null;

	if (searchIndex) {
		const UrlUtil = getUrlUtil();
		const docs = Object.values(searchIndex.documentStore.docs);
		const matchPage = (doc) => {
			const docPage = UrlUtil.CAT_TO_PAGE[doc.c];
			const hoverPage = UrlUtil.CAT_TO_HOVER_PAGE?.[doc.c];
			return docPage === pageName || hoverPage === pageName;
		};
		const byHash = docs.filter(doc => doc && String(doc.u || "").toLowerCase() === hashLc);
		const sourceLc = String(source || "").toLowerCase();
		const hit = byHash.find(doc => matchPage(doc) && (!sourceLc || String(doc.s || "").toLowerCase() === sourceLc))
			|| byHash.find(matchPage)
			|| byHash[0];
		if (hit) return preferModernDoc(hit, docs, matchPage, linkText);
	}

	return synthesizeDoc(pageName, hashLc, linkText);
}

function parseInternalHref (href) {
	const raw = String(href || "").replace(/\\/g, "/");
	const hashIdx = raw.indexOf("#");
	if (hashIdx === -1) return null;
	let hash = raw.slice(hashIdx + 1);
	const amp = hash.indexOf("&");
	if (amp !== -1) hash = hash.slice(0, amp);
	const comma = hash.indexOf(",");
	if (comma !== -1) hash = hash.slice(0, comma);
	try { hash = decodeURIComponent(hash); } catch (_) { /* keep raw */ }
	hash = hash.trim();
	if (!hash) return null;

	const before = raw.slice(0, hashIdx).replace(/\/+$/, "");
	const last = before.split("/").pop() || "";
	if (!last) return null;
	return {page: last, hash};
}

function synthesizeDoc (page, hash, linkText) {
	const UrlUtil = getUrlUtil();
	const Parser = getParser();
	const decoded = UrlUtil.autoDecodeHash(hash, {page});
	const cat = catIdForPage(page);
	const name = (linkText || decoded?.name || hash).trim();
	return {
		n: name,
		u: hash,
		s: decoded?.source || (getStyleHint() === "one" ? "XPHB" : "PHB"),
		c: cat,
		cf: cat != null ? Parser.pageCategoryToFull(cat) : page.replace(/\.html$/, ""),
	};
}

function catIdForPage (page) {
	const UrlUtil = getUrlUtil();
	const hover = Object.entries(UrlUtil.CAT_TO_HOVER_PAGE || {}).find(([, value]) => value === page);
	if (hover) return Number(hover[0]);
	const mapped = Object.entries(UrlUtil.CAT_TO_PAGE || {}).find(([, value]) => value === page);
	return mapped ? Number(mapped[0]) : null;
}

if (globalThis.FiveEToolsObsidian) {
	globalThis.FiveEToolsObsidian.docFromHref = docFromHref;
	globalThis.FiveEToolsObsidian.docFromVetLink = docFromVetLink;
	globalThis.FiveEToolsObsidian.ensureSearchIndex = ensureSearchIndex;
	globalThis.FiveEToolsObsidian.findEntityDoc = findEntityDoc;
	globalThis.FiveEToolsObsidian.findEditionDoc = findEditionDoc;
	globalThis.FiveEToolsObsidian.findNamedFeature = findNamedFeature;
	globalThis.FiveEToolsObsidian.sourceAbbr = sourceAbbr;
	globalThis.FiveEToolsObsidian.indexHomebrewDocs = indexHomebrewDocs;
	globalThis.FiveEToolsObsidian.brewDocFromEntity = brewDocFromEntity;
	globalThis.FiveEToolsObsidian.listEntities = listEntities;
}
