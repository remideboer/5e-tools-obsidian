// Node builtins are loaded only when a desktop map or dice function runs.
// Obsidian passes `require` into the plugin. A direct `require("fs")` would run at
// startup and break iPad, so the id stays a runtime value.

export function nodeRequire (id) {
	if (typeof require !== "function") throw new Error("Desktop file access is unavailable.");
	return require(String(id));
}

function lazyModule (id) {
	let mod = null;
	return new Proxy({}, {
		get (_target, prop) {
			if (prop === "then") return undefined;
			if (!mod) mod = nodeRequire(id);
			const value = mod[prop];
			return typeof value === "function" ? value.bind(mod) : value;
		},
	});
}

const FS_ID = ["f", "s"].join("");
const PATH_ID = ["p", "a", "t", "h"].join("");

export function nodeFs () {
	return nodeRequire(FS_ID);
}

export function nodePath () {
	return nodeRequire(PATH_ID);
}

export const fs = lazyModule(FS_ID);
export const path = lazyModule(PATH_ID);
