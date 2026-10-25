import "./fiveetools-preload.js";
import {setStyleHint, getStyleHint} from "./fiveetools-globals.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import "../../js/render-markdown.js";
import "../../js/utils-dataloader.js";
import {urlToPluginVaultPath} from "./local-fs.js";
import {cachedMediaSrc, clearMediaCache} from "./media-cache.js";
import {getPluginDir, pluginVaultDir} from "./plugin-dir.js";
import {formatRollNotice, rollInitiative, rollPacked} from "./dice-roll.js";
import {cellPxFromMapDpi, cssPixelsPerWorldPixel, inchesFromMapDpi, mapDpiFromInches, screenPpiCss} from "./map-scale.js";
import {detectImageDpi} from "./map-dpi.js";

export {setStyleHint, getStyleHint, cssPixelsPerWorldPixel, screenPpiCss, inchesFromMapDpi, mapDpiFromInches, cellPxFromMapDpi, detectImageDpi};

let configuredPlugin = null;
let configuredRoot = "";
let configuredAbsRoot = "";

export function getConfiguredRoot () {
	return configuredRoot;
}

/** Desktop absolute plugin folder. Empty on mobile. Map code uses this for Node reads. */
export function getConfiguredAbsoluteRoot () {
	return configuredAbsRoot;
}

export function configureFiveEToolsRoot (plugin, {imageBaseUrl = "https://5e.tools"} = {}) {
	const dir = pluginVaultDir(plugin);
	const posixRoot = `${dir}/`;
	configuredPlugin = plugin;
	configuredRoot = posixRoot;
	configuredAbsRoot = getPluginDir(plugin);

	globalThis.IS_VTT = true;
	const renderer = globalThis.Renderer.get();
	renderer.setBaseUrl(posixRoot);
	renderer.setBaseMediaUrl("img", `${String(imageBaseUrl || "https://5e.tools").replace(/\/+$/, "")}/img/`);
	renderer.setAddHandlers(true);
	bindObsidianLinkPlugin(renderer);

	globalThis.DataUtil._pLoad_pGetJson_pGetOptionalJson = async function ({url}) {
		const vaultPath = urlToPluginVaultPath(url, dir);
		if (!vaultPath) {
			return new globalThis.DataUtil._OptionalJsonResponse({
				url,
				status: 404,
				error: `Not a plugin file: ${url}`,
			});
		}
		const adapter = configuredPlugin?.app?.vault?.adapter;
		try {
			if (!adapter || !(await adapter.exists(vaultPath))) {
				return new globalThis.DataUtil._OptionalJsonResponse({
					url,
					status: 404,
					error: `Failed to read ${vaultPath}: not found`,
				});
			}
			const text = await adapter.read(vaultPath);
			return new globalThis.DataUtil._OptionalJsonResponse({
				url,
				status: 200,
				json: JSON.parse(text),
			});
		} catch (e) {
			return new globalThis.DataUtil._OptionalJsonResponse({
				url,
				status: 500,
				error: `Failed to read ${vaultPath}: ${e.message}`,
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
	getConfiguredAbsoluteRoot,
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
