function noopBrewUtil (displayName) {
	return {
		DISPLAY_NAME: displayName,
		hasSourceJson () { return false; },
		sourceJsonToSource () { return null; },
		async pGetCustomUrl () { return ""; },
		async pGetBrewProcessed () { return {}; },
		async pAddBrewFromUrl () {},
		getBrewProcessedFromCache () { return []; },
		getPopoutStyleElementHtml () { return ""; },
		getFileUrl () { return ""; },
		getSources () { return []; },
	};
}

globalThis.IS_VTT = true;

if (typeof globalThis.PrereleaseUtil === "undefined") {
	globalThis.PrereleaseUtil = noopBrewUtil("prerelease");
}
if (typeof globalThis.BrewUtil2 === "undefined") {
	globalThis.BrewUtil2 = noopBrewUtil("homebrew");
}

if (typeof globalThis.ScaleCreature === "undefined") {
	globalThis.ScaleCreature = {
		isCrInScaleRange () { return false; },
		async scale (mon) { return mon; },
	};
}
if (typeof globalThis.ScaleSpellSummonedCreature === "undefined") {
	globalThis.ScaleSpellSummonedCreature = {
		async scale (mon) { return mon; },
	};
}
if (typeof globalThis.ScaleClassSummonedCreature === "undefined") {
	globalThis.ScaleClassSummonedCreature = {
		async scale (mon) { return mon; },
	};
}

if (typeof globalThis.UiUtil === "undefined") {
	globalThis.UiUtil = {
		intToBonus (int, {isPretty = false} = {}) {
			return `${int >= 0 ? "+" : int < 0 ? (isPretty ? "\u2212" : "-") : ""}${Math.abs(int)}`;
		},
	};
}

if (typeof globalThis.Hist === "undefined") {
	globalThis.Hist = {
		cleanSetHash () {},
		util: {
			getCleanHash (hash) {
				return String(hash || "").replace(/,+/g, ",").replace(/,$/, "").toLowerCase();
			},
			getHashParts (location, {isReturnEncoded = false} = {}) {
				if (location && location[0] === "#") location = location.slice(1);
				if (isReturnEncoded) return String(location || "").split(globalThis.HASH_PART_SEP || ",");
				return String(location || "").split(globalThis.HASH_PART_SEP || ",");
			},
			getSubHash () { return null; },
			setSubhash (location) { return location; },
		},
	};
}

let styleHint = "classic";

globalThis.VetoolsConfig = {
	get (groupId, configId) {
		if (groupId === "styleSwitcher" && configId === "style") return styleHint;
		if (groupId === "markdown" && configId === "tagRenderMode") return "convertMarkdown";
		if (groupId === "markdown" && configId === "isAddPageBreaks") return false;
		if (groupId === "markdown" && configId === "isAddColumnBreaks") return false;
		return undefined;
	},
	set () {},
};

export function setStyleHint (style) {
	styleHint = style === "one" ? "one" : "classic";
}

export function getStyleHint () {
	return styleHint;
}
