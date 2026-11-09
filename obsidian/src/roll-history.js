const HISTORY_MAX = 5;
const HUD_ID = "fiveetools-roll-history-hud";

let history = [];
const listeners = new Set();

export function getRollHistory () {
	return history.slice();
}

export function clearRollHistory () {
	history = [];
	notify();
}

/** @param {Array<{id?: string, text: string, total?: number|null, label?: string}>} entries newest group first-to-last */
export function pushRollHistory (entries) {
	const rows = (entries || [])
		.map(normalizeEntry)
		.filter(Boolean);
	if (!rows.length) return;
	history = [...rows, ...history].slice(0, HISTORY_MAX);
	notify();
}

export function onRollHistoryChange (fn) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function notify () {
	const snap = history.slice();
	for (const fn of listeners) {
		try { fn(snap); } catch (_) { /* ignore */ }
	}
}

function normalizeEntry (row) {
	const text = String(row?.text || "").trim();
	if (!text) return null;
	return {
		id: String(row.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
		text,
		total: row.total == null || row.total === "" ? null : Number(row.total),
		label: String(row.label || ""),
	};
}

/** Fixed bottom-right stack for the player Table window. */
export function ensureTableRollHistoryHud (doc) {
	if (!doc?.body) return null;
	let el = doc.getElementById(HUD_ID);
	if (!el) {
		el = doc.createElement("div");
		el.id = HUD_ID;
		el.className = "fiveetools-roll-history-hud";
		doc.body.appendChild(el);
		const off = onRollHistoryChange(() => paintRollHistoryStack(el, {compact: true}));
		el._fiveetoolsHistOff = off;
	}
	paintRollHistoryStack(el, {compact: true});
	return el;
}

export function removeTableRollHistoryHud (doc) {
	const el = doc?.getElementById?.(HUD_ID);
	if (!el) return;
	el._fiveetoolsHistOff?.();
	el.remove();
}

/** Paint last rolls into a host (DM widget or HUD). */
export function paintRollHistoryStack (host, {compact = false, emptyText = "No rolls yet."} = {}) {
	if (!host) return;
	host.empty?.();
	if (!host.empty) {
		while (host.firstChild) host.removeChild(host.firstChild);
	}
	host.classList.add("fiveetools-roll-history");
	if (compact) host.classList.add("fiveetools-roll-history--compact");
	else host.classList.remove("fiveetools-roll-history--compact");

	const rows = getRollHistory();
	if (!rows.length) {
		if (compact) {
			host.style.display = "none";
			return;
		}
		host.style.display = "";
		const empty = host.ownerDocument.createElement("div");
		empty.className = "fiveetools-roll-history__empty";
		empty.textContent = emptyText;
		host.appendChild(empty);
		return;
	}
	host.style.display = "";
	const list = host.ownerDocument.createElement("div");
	list.className = "fiveetools-roll-history__list";
	for (const row of rows) {
		const item = host.ownerDocument.createElement("div");
		item.className = "fiveetools-roll-history__item";
		item.textContent = row.text;
		list.appendChild(item);
	}
	host.appendChild(list);
}

/** Obsidian Element wrapper paint for DM screen. */
export function renderRollHistoryWidget (body) {
	body.empty();
	body.addClass("fiveetools-dmscreen__rollhist");
	const stack = body.createDiv({cls: "fiveetools-roll-history"});
	paintRollHistoryStack(stack, {compact: false, emptyText: "Rolls from the table and stat blocks appear here."});
	const clear = body.createEl("button", {
		text: "Clear",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});
	clear.addEventListener("click", () => clearRollHistory());
	return onRollHistoryChange(() => {
		if (!stack.isConnected) return;
		paintRollHistoryStack(stack, {compact: false, emptyText: "Rolls from the table and stat blocks appear here."});
	});
}
