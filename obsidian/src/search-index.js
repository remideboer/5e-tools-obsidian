import fs from "fs";
import path from "path";
import {decompressIndex} from "./decompress-index.js";
import {MAX_LIBRARY_RESULTS, MAX_SEARCH_RESULTS} from "./constants.js";
import {getElasticlunr, getParser, getSearchUtil} from "./fiveetools-host.js";

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
