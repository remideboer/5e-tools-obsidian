import {getRenderer} from "./fiveetools-host.js";

export async function resolveEntityImages (ent, {imageBaseUrl} = {}) {
	const Renderer = getRenderer();
	const urls = [];

	const tokenUrl = getTokenUrl(ent, Renderer);
	if (tokenUrl) urls.push(tokenUrl);

	try {
		const fluff = await Renderer.utils.pGetProxyFluff({entity: ent});
		const images = fluff?.images || [];
		for (const image of images) {
			const url = Renderer.utils.getEntryMediaUrl(image, "href", "img");
			if (url) urls.push(url);
		}
	} catch (_) { /* fluff is optional */ }

	const seen = new Set();
	const resolved = [];
	for (const url of urls) {
		const item = toRemoteUrl(url, imageBaseUrl);
		if (!item || seen.has(item.url)) continue;
		seen.add(item.url);
		resolved.push(item);
	}
	return resolved;
}

function getTokenUrl (ent, Renderer) {
	const prop = ent?.__prop;
	try {
		const impl = prop && Renderer[prop];
		if (impl?.getTokenUrl && (ent.hasToken || impl.hasToken?.(ent))) return impl.getTokenUrl(ent);
		if (ent?.hasToken) return Renderer.generic.getTokenUrl(ent, "bestiary/tokens");
	} catch (_) { /* no token */ }
	return null;
}

export function toRemoteUrl (url, imageBaseUrl) {
	if (!url) return null;
	const imageBase = String(imageBaseUrl || "https://5e.tools").replace(/\/+$/, "");
	const normalized = String(url).replace(/\\/g, "/");

	if (/^https?:\/\//i.test(normalized)) {
		return {kind: "url", url: normalized, rel: relativeImgPath(normalized)};
	}

	const rel = relativeImgPath(normalized);
	if (rel) return {kind: "url", url: `${imageBase}/img/${rel.replace(/\\/g, "/")}`, rel};
	return null;
}

function relativeImgPath (url) {
	const match = String(url).replace(/\\/g, "/").match(/\/img\/(.+)$/i);
	return match ? decodeURIComponent(match[1]) : null;
}

export function toPreviewSrc (resolved) {
	return resolved?.url || null;
}
