import {isCorpusPage, pageForDoc} from "./compact-render.js";
import {getDataLoader} from "./fiveetools-host.js";

export async function loadEntity (doc) {
	const page = pageForDoc(doc);
	if (!page) return {ent: {name: doc.n, source: doc.s, __prop: "generic"}, warning: "This category has no dedicated page renderer."};
	if (isCorpusPage(page)) {
		return {
			ent: {name: doc.n, source: doc.s, __prop: doc.cf === "Book" ? "book" : "adventure", entries: [{type: "entries", entries: [`${doc.cf} from ${doc.s || "unknown source"}. Full text is not loaded in the plugin.`]}]},
			warning: "Adventures and books are listed in search, but full text is not opened here.",
		};
	}

	const DataLoader = getDataLoader();
	const ent = await DataLoader.pCacheAndGet(page, doc.s, doc.u, {isSilent: true});
	return {ent: ent || null};
}
