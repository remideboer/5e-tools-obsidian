import fs from "fs";
import path from "path";
import {decompressIndex} from "./decompress-index.js";
import {CORPUS_PAGES, MAX_LIBRARY_RESULTS, MAX_SEARCH_RESULTS} from "./constants.js";
import {getElasticlunr, getParser, getSearchUtil, getUrlUtil} from "./fiveetools-host.js";

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
	god: ["deity"],
	rcp: ["recipe"],
	tbl: ["table"],
	cf: ["class feature"],
	scf: ["subclass feature"],
	rule: ["rule"],
};

let loadedRoot = "";
let searchIndex = null;

export async function ensureSearchIndex (rootPath) {
	const root = path.resolve(rootPath);
	if (searchIndex && loadedRoot === root) return searchIndex;

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

	const raw = JSON.parse(fs.readFileSync(path.join(root, "search", "index.json"), "utf8"));
	const docs = decompressIndex(raw);
	for (const doc of docs) {
		if (!doc || doc.n == null) continue;
		doc.cf = Parser.pageCategoryToFull(doc.c);
		doc.sA ||= doc.s ? Parser.sourceJsonToAbv(doc.s) : null;
		index.addDoc(doc);
	}

	searchIndex = index;
	loadedRoot = root;
	return searchIndex;
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
		out.push(doc);
		if (out.length >= limit) break;
	}
	return out;
}

export function listEntities ({categoriesExact = [], query = "", limit = MAX_LIBRARY_RESULTS} = {}) {
	if (!searchIndex) return [];
	const cats = new Set((categoriesExact || []).map(it => String(it).toLowerCase()));
	const term = String(query || "").trim();

	let docs;
	if (term.length >= 2) {
		docs = searchEntities(term, {categoriesExact, limit: Math.max(limit, 400)});
	} else {
		docs = Object.values(searchIndex.documentStore.docs)
			.filter(doc => doc && (!cats.size || cats.has(String(doc.cf || "").toLowerCase())));
		docs.sort((a, b) => String(a.n || "").localeCompare(String(b.n || "")));
	}
	return docs.slice(0, limit);
}

export function findEntityDoc (name, {categoriesExact = []} = {}) {
	const needle = String(name || "").toLowerCase();
	if (!needle || !searchIndex) return null;
	const hits = searchEntities(name, {categoriesExact, limit: 20});
	return hits.find(doc => String(doc.n || "").toLowerCase() === needle) || hits[0] || null;
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
		if (hit) return hit;
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
		s: decoded?.source || "PHB",
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
}
