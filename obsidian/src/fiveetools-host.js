import fs from "fs";
import path from "path";
import "./fiveetools-preload.js";
import {setStyleHint, getStyleHint} from "./fiveetools-globals.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import "../../js/render-markdown.js";
import "../../js/utils-dataloader.js";
import {toPosixRoot, urlToLocalPath} from "./local-fs.js";
import {cachedMediaSrc, clearMediaCache} from "./media-cache.js";
import {formatRollNotice, rollInitiative, rollPacked} from "./dice-roll.js";
import {cellPxFromMapDpi, cssPixelsPerWorldPixel, inchesFromMapDpi, mapDpiFromInches, screenPpiCss} from "./map-scale.js";
import {detectImageDpi} from "./map-dpi.js";

export {setStyleHint, getStyleHint, cssPixelsPerWorldPixel, screenPpiCss, inchesFromMapDpi, mapDpiFromInches, cellPxFromMapDpi, detectImageDpi};

let configuredRoot = "";

export function getConfiguredRoot () {
	return configuredRoot;
}

export function configureFiveEToolsRoot (rootPath, {imageBaseUrl = "https://5e.tools"} = {}) {
	const posixRoot = `${toPosixRoot(rootPath)}/`;
	configuredRoot = posixRoot;

	globalThis.IS_VTT = true;
	const renderer = globalThis.Renderer.get();
	renderer.setBaseUrl(posixRoot);
	renderer.setBaseMediaUrl("img", `${String(imageBaseUrl || "https://5e.tools").replace(/\/+$/, "")}/img/`);
	renderer.setAddHandlers(true);
	bindObsidianLinkPlugin(renderer);

	globalThis.DataUtil._pLoad_pGetJson_pGetOptionalJson = async function ({url}) {
		const filePath = urlToLocalPath(url, posixRoot.replace(/\/+$/, ""));
		try {
			const text = fs.readFileSync(filePath, "utf8");
			return new globalThis.DataUtil._OptionalJsonResponse({
				url,
				status: 200,
				json: JSON.parse(text),
			});
		} catch (e) {
			const missing = e && e.code === "ENOENT";
			return new globalThis.DataUtil._OptionalJsonResponse({
				url,
				status: missing ? 404 : 500,
				error: `Failed to read ${filePath}: ${e.message}`,
			});
		}
	};

	return posixRoot;
}

export function getRenderer () {
	return globalThis.Renderer;
}

export function getDataLoader () {
	return globalThis.DataLoader;
}

export function getParser () {
	return globalThis.Parser;
}

export function getUrlUtil () {
	return globalThis.UrlUtil;
}

export function getElasticlunr () {
	return globalThis.elasticlunr;
}

export function getSearchUtil () {
	return globalThis.SearchUtil;
}

export function joinUnderRoot (rootPath, ...parts) {
	return path.join(toPosixRoot(rootPath), ...parts);
}

let linkPluginBound = false;

function bindObsidianLinkPlugin (renderer) {
	if (linkPluginBound) return;
	linkPluginBound = true;
	renderer.addPlugin("link", (_common, pluginArgs) => {
		const entry = pluginArgs?.input;
		if (!entry?.href || entry.href.type !== "internal") return null;
		const page = entry.href.hover?.page || entry.href.path;
		if (!page) return null;
		const UrlUtil = globalThis.UrlUtil;
		const hover = entry.href.hover || {};
		let hash;
		if (hover.hash != null) {
			hash = hover.hashPreEncoded ? hover.hash : UrlUtil.encodeForHash(hover.hash);
		} else if (entry.href.hash != null) {
			hash = entry.href.hashPreEncoded ? entry.href.hash : UrlUtil.encodeForHash(entry.href.hash);
		}
		if (hash == null || hash === "" || hash === globalThis.HASH_BLANK) return null;
		const source = hover.source || "";
		return {
			attributes: [
				`data-vet-page="${String(page).qq()}"`,
				`data-vet-source="${String(source).qq()}"`,
				`data-vet-hash="${String(hash).qq()}"`,
			].join(" "),
		};
	});
}

globalThis.FiveEToolsObsidian = {
	configureFiveEToolsRoot,
	getConfiguredRoot,
	setStyleHint,
	getStyleHint,
	getDataLoader,
	getParser,
	getUrlUtil,
	getRenderer,
	getElasticlunr,
	getSearchUtil,
	cachedMediaSrc,
	clearMediaCache,
	rollPacked,
	rollInitiative,
	formatRollNotice,
	screenPpiCss,
	cssPixelsPerWorldPixel,
	inchesFromMapDpi,
	mapDpiFromInches,
	cellPxFromMapDpi,
	detectImageDpi,
};
