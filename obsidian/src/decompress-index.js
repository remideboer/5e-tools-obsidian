/** Unpack a compressed 5etools omnisearch index (copied from Omnidexer.decompressIndex). */
export function decompressIndex (indexGroup) {
	const {x: index, m: metadata} = indexGroup;
	const props = new Set();
	const lookup = {};

	Object.keys(metadata || {}).forEach(k => {
		props.add(k);
		Object.entries(metadata[k]).forEach(([kk, vv]) => {
			(lookup[k] = lookup[k] || {})[vv] = kk;
		});
	});

	(index || []).forEach(it => {
		Object.keys(it)
			.filter(k => props.has(k))
			.forEach(k => {
				it[k] = lookup[k][it[k]] ?? it[k];
			});
	});

	return index;
}
