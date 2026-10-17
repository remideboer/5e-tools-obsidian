import fs from "fs";
import path from "path";

export function normalizeRoot (rootPath) {
	if (!rootPath || typeof rootPath !== "string") return "";
	return path.resolve(rootPath.trim());
}

export function validateRoot (rootPath) {
	const root = normalizeRoot(rootPath);
	if (!root) return {ok: false, error: "Could not find the 5etools plugin folder."};
	if (!fs.existsSync(root)) return {ok: false, error: `Folder not found: ${root}`};
	const dataDir = path.join(root, "data");
	const searchIndex = path.join(root, "search", "index.json");
	if (!fs.existsSync(dataDir)) return {ok: false, error: `No data/ folder in ${root}`};
	if (!fs.existsSync(searchIndex)) return {ok: false, error: `No search/index.json in ${root}`};
	return {ok: true, root};
}

export function toPosixRoot (rootPath) {
	return normalizeRoot(rootPath).replace(/\\/g, "/").replace(/\/+$/, "");
}

export function stripUrlQuery (url) {
	if (!url) return "";
	const q = url.indexOf("?");
	return q === -1 ? url : url.slice(0, q);
}

export function urlToLocalPath (url, posixRoot) {
	const raw = stripUrlQuery(String(url || "")).replace(/\\/g, "/");
	if (!raw) return null;

	if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith("/")) {
		return path.normalize(raw);
	}

	if (raw.startsWith("file:")) {
		const withoutProtocol = raw.replace(/^file:\/\//, "");
		return path.normalize(decodeURIComponent(withoutProtocol.replace(/^\//, "")));
	}

	if (posixRoot && raw.toLowerCase().startsWith(posixRoot.toLowerCase())) {
		return path.normalize(raw);
	}

	const rel = raw.replace(/^\/+/, "");
	return path.normalize(`${posixRoot}/${rel}`);
}
