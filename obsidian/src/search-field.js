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

const CLEAR_TYPES = new Set(["", "text", "search", "url", "number", "email", "tel", "password", "date", "time", "datetime-local"]);
let clearObserver = null;

/** × on a text, number, or link field. Skips checkboxes, files, and sliders. */
export function enableInputClear (input) {
	if (!input || input.dataset.fiveetoolsClear === "1") return input;
	const isArea = String(input.tagName || "").toUpperCase() === "TEXTAREA";
	const type = isArea ? "text" : String(input.type || "text").toLowerCase();
	if (!isArea && !CLEAR_TYPES.has(type)) return input;
	if (input.closest(".fiveetools-search, .fiveetools-clearable")) return input;
	if (input.closest(".cm-editor, .metadata-container, .workspace-leaf-content:not([data-type^='fiveetools'])")) return input;
	if (!input.closest("[class*='fiveetools-']")) return input;
	const parent = input.parentElement;
	if (!parent) return input;
	const doc = input.ownerDocument;
	const grow = Number(doc.defaultView.getComputedStyle(input).flexGrow) || 0;
	const fills = parent.clientWidth > 40 && input.offsetWidth > parent.clientWidth * 0.8;
	const wrap = doc.createElement("div");
	wrap.className = "fiveetools-clearable";
	parent.insertBefore(wrap, input);
	wrap.appendChild(input);
	if (grow > 0) {
		wrap.style.flex = "1 1 auto";
		wrap.style.minWidth = "0";
		wrap.style.maxHeight = "fit-content";
		input.style.width = "100%";
	} else if (fills) {
		wrap.style.display = "block";
		wrap.style.width = "100%";
		wrap.style.maxHeight = "fit-content";
		input.style.width = "100%";
	}
	const clear = doc.createElement("button");
	clear.type = "button";
	clear.textContent = "×";
	clear.className = "fiveetools-input-clear is-hidden";
	clear.title = "Clear";
	clear.setAttribute("aria-label", "Clear");
	wrap.appendChild(clear);
	const sync = () => clear.classList.toggle("is-hidden", !String(input.value || "").length);
	watchValue(input, sync);
	input.addEventListener("input", sync);
	clear.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		input.value = "";
		input.dispatchEvent(new Event("input", {bubbles: true}));
		input.dispatchEvent(new Event("change", {bubbles: true}));
		sync();
		input.focus();
	});
	input.dataset.fiveetoolsClear = "1";
	sync();
	return input;
}

/** Watch fields the plugin adds, including ones rebuilt while a view is open. */
export function installInputClears () {
	if (clearObserver) return () => {};
	const scan = (node) => {
		if (!node || node.nodeType !== 1) return;
		if (node.matches?.("input, textarea")) enableInputClear(node);
		node.querySelectorAll?.("input, textarea").forEach(el => enableInputClear(el));
	};
	clearObserver = new MutationObserver((records) => {
		for (const record of records) {
			for (const node of record.addedNodes) scan(node);
		}
	});
	clearObserver.observe(document.body, {childList: true, subtree: true});
	scan(document.body);
	return () => {
		clearObserver?.disconnect();
		clearObserver = null;
	};
}

function watchValue (input, sync) {
	const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
	if (!desc?.get || !desc?.set) return;
	Object.defineProperty(input, "value", {
		configurable: true,
		get () { return desc.get.call(this); },
		set (value) {
			desc.set.call(this, value);
			sync();
		},
	});
}

/** Empty a search field, fire `input`, and sync the ×. */
export function clearSearchInput (input, {focus = false} = {}) {
	if (!input) return;
	input.value = "";
	input.dispatchEvent(new Event("input", {bubbles: true}));
	input[CLEAR_SYNC]?.();
	if (focus) input.focus?.();
}
