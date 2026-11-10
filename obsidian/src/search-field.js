const CLEAR_SYNC = Symbol("fiveetoolsSearchClearSync");

/**
 * Search input with an × clear control on the right.
 * Clearing dispatches a bubbling `input` so existing listeners refresh results.
 * @param {HTMLElement} parent
 * @param {{cls?: string, attr?: Record<string, string>, placeholder?: string, title?: string}} [opts]
 * @returns {HTMLInputElement}
 */
export function createSearchInput (parent, {cls, attr, placeholder, title} = {}) {
	const wrap = parent.createDiv({
		cls: cls ? `fiveetools-search ${cls}` : "fiveetools-search",
	});
	const merged = {
		type: "search",
		autocomplete: "off",
		...(attr || {}),
	};
	if (placeholder != null) merged.placeholder = placeholder;
	if (title != null) merged.title = title;
	merged.type = "search";
	const input = wrap.createEl("input", {
		attr: merged,
	});
	const clear = wrap.createEl("button", {
		text: "×",
		cls: "fiveetools-search__clear is-hidden",
		attr: {type: "button", title: "Clear", "aria-label": "Clear"},
	});
	const sync = () => {
		clear.toggleClass("is-hidden", !String(input.value || "").length);
	};
	input[CLEAR_SYNC] = sync;
	input.addEventListener("input", sync);
	clear.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		clearSearchInput(input, {focus: true});
	});
	sync();
	return input;
}

/** Empty a search field, fire `input`, and sync the ×. */
export function clearSearchInput (input, {focus = false} = {}) {
	if (!input) return;
	input.value = "";
	input.dispatchEvent(new Event("input", {bubbles: true}));
	input[CLEAR_SYNC]?.();
	if (focus) input.focus?.();
}
