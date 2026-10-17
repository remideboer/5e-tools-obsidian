import fs from "fs";
import path from "path";
import "./fiveetools-preload.js";
import {setStyleHint, getStyleHint} from "./fiveetools-globals.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import "../../js/render-markdown.js";
import "../../js/utils-dataloader.js";
import {toPosixRoot, urlToLocalPath} from "./local-fs.js";

export {setStyleHint, getStyleHint};

let configuredRoot = "";

export function configureFiveEToolsRoot (rootPath, {imageBaseUrl = "https://5e.tools"} = {}) {
	const posixRoot = `${toPosixRoot(rootPath)}/`;
	configuredRoot = posixRoot;

	globalThis.IS_VTT = true;
	const renderer = globalThis.Renderer.get();
	renderer.setBaseUrl(posixRoot);
	renderer.setBaseMediaUrl("img", `${String(imageBaseUrl || "https://5e.tools").replace(/\/+$/, "")}/img/`);
	renderer.setAddHandlers(false);

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

export function getConfiguredRoot () {
	return configuredRoot;
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

globalThis.FiveEToolsObsidian = {
	configureFiveEToolsRoot,
	setStyleHint,
	getStyleHint,
	getDataLoader,
	getParser,
	getUrlUtil,
	getRenderer,
	getElasticlunr,
	getSearchUtil,
};
