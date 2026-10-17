import {isCorpusPage, loadPageForDoc} from "./compact-render.js";
import {getDataLoader} from "./fiveetools-host.js";

export async function loadEntity (doc) {
	const page = loadPageForDoc(doc);
	if (!page) return {ent: {name: doc.n, source: doc.s, __prop: "generic"}, warning: "This category has no dedicated page renderer."};
	if (isCorpusPage(page)) {
		return {
			ent: {name: doc.n, source: doc.s, __prop: doc.cf === "Book" ? "book" : "adventure", entries: [{type: "entries", entries: [`${doc.cf} from ${doc.s || "unknown source"}. Full text is not loaded in the plugin.`]}]},
			warning: "Books are listed in search, but full text is not opened here.",
		};
	}

	const DataLoader = getDataLoader();
	const ent = await DataLoader.pCacheAndGet(page, doc.s, doc.u, {isSilent: true});
	if (ent?.adventure && ent?.adventureData) {
		const adv = ent.adventure;
		return {
			ent: {
				name: adv.name,
				source: adv.source,
				__prop: "adventure",
				adventure: adv,
				adventureData: ent.adventureData,
			},
		};
	}
	return {ent: ent || null};
}
