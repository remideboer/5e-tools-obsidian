import {PLACE_ICONS, TABLE_ICONS} from "./table-icons.js";

const NS = "http://www.w3.org/2000/svg";
const mounts = new WeakMap();

export function mountTableOverlay (host, {plugin, session, imageEl = null, interactive = false} = {}) {
	const doc = host.ownerDocument;
	const space = doc.createElement("div");
	space.className = `fiveetools-table-overlay__space${interactive ? " is-interactive" : ""}`;
	const svg = doc.createElementNS(NS, "svg");
	svg.classList.add("fiveetools-table-overlay__svg");
	svg.setAttribute("viewBox", "0 0 1000 1000");
	svg.setAttribute("preserveAspectRatio", "none");
	space.appendChild(svg);
	const laser = doc.createElement("div");
	laser.className = "fiveetools-table-overlay__laser";
	laser.style.display = "none";
	space.appendChild(laser);
	host.appendChild(space);

	const controller = {
		host,
		space,
		svg,
		laser,
		session,
		imageEl,
		draft: null,
		paint () {
			while (svg.firstChild) svg.removeChild(svg.firstChild);
			for (const mark of session.marks || []) appendMark(svg, mark);
			if (controller.draft) appendMark(svg, controller.draft, true);
		},
		setDraft (mark) {
			controller.draft = mark || null;
			controller.paint();
		},
		setLaser (point) {
			if (!point) {
				laser.style.display = "none";
				return;
			}
			laser.style.display = "";
			laser.style.left = `${point.x * 100}%`;
			laser.style.top = `${point.y * 100}%`;
		},
		pointFromEvent (evt) {
			const rect = space.getBoundingClientRect();
			if (!rect.width || !rect.height) return null;
			if (evt.clientX < rect.left || evt.clientX > rect.right || evt.clientY < rect.top || evt.clientY > rect.bottom) return null;
			return {
				x: clamp((evt.clientX - rect.left) / rect.width),
				y: clamp((evt.clientY - rect.top) / rect.height),
			};
		},
		markIdFromEvent (evt) {
			return evt.target?.closest?.("[data-mark-id]")?.getAttribute("data-mark-id") || "";
		},
		destroy () {
			controller.observer?.disconnect();
			imageEl?.removeEventListener("load", controller.position);
			mountSet(plugin).delete(controller);
			space.remove();
		},
	};
	controller.position = () => positionImageSpace(controller);
	const ResizeObserver = doc.defaultView?.ResizeObserver || globalThis.ResizeObserver;
	if (ResizeObserver) {
		controller.observer = new ResizeObserver(controller.position);
		controller.observer.observe(host);
	}
	imageEl?.addEventListener("load", controller.position);
	mountSet(plugin).add(controller);
	controller.position();
	controller.paint();
	return controller;
}

export function repaintTableMarks (plugin) {
	forEachMount(plugin, controller => controller.paint());
}

export function setTableLaser (plugin, point) {
	forEachMount(plugin, controller => controller.setLaser(point));
}

function mountSet (plugin) {
	let set = mounts.get(plugin);
	if (!set) {
		set = new Set();
		mounts.set(plugin, set);
	}
	return set;
}

function forEachMount (plugin, fn) {
	const set = mountSet(plugin);
	for (const controller of [...set]) {
		if (!controller.host.isConnected) {
			controller.destroy();
			continue;
		}
		fn(controller);
	}
}

function positionImageSpace ({host, space, imageEl}) {
	const width = host.clientWidth;
	const height = host.clientHeight;
	if (!width || !height) return;
	const naturalWidth = imageEl?.naturalWidth || 0;
	const naturalHeight = imageEl?.naturalHeight || 0;
	if (!naturalWidth || !naturalHeight) {
		Object.assign(space.style, {left: "0px", top: "0px", width: `${width}px`, height: `${height}px`});
		return;
	}
	const scale = Math.min(width / naturalWidth, height / naturalHeight);
	const shownWidth = naturalWidth * scale;
	const shownHeight = naturalHeight * scale;
	Object.assign(space.style, {
		left: `${(width - shownWidth) / 2}px`,
		top: `${(height - shownHeight) / 2}px`,
		width: `${shownWidth}px`,
		height: `${shownHeight}px`,
	});
}

function appendMark (svg, mark, draft = false) {
	if (!mark) return;
	let el = null;
	if (mark.kind === "stroke") el = polyline(svg, mark);
	else if (mark.kind === "text") el = textMark(svg, mark);
	else if (mark.kind === "stamp") el = iconMark(svg, mark);
	else if (mark.kind === "place") el = placeMark(svg, mark);
	else if (mark.kind === "line") el = lineMark(svg, mark);
	else if (mark.kind === "circle") el = ellipseMark(svg, mark);
	else if (mark.kind === "square") el = rectMark(svg, mark);
	else if (mark.kind === "cone") el = coneMark(svg, mark);
	if (!el) return;
	el.classList.add("fiveetools-table-mark");
	if (draft) el.classList.add("is-draft");
	if (mark.id) el.setAttribute("data-mark-id", mark.id);
}

function polyline (svg, mark) {
	const el = make(svg, "polyline");
	el.setAttribute("points", (mark.points || []).map(point => `${point.x * 1000},${point.y * 1000}`).join(" "));
	stroke(el, mark.color);
	el.setAttribute("fill", "none");
	return el;
}

function textMark (svg, mark) {
	const el = make(svg, "text");
	el.setAttribute("x", mark.x * 1000);
	el.setAttribute("y", mark.y * 1000);
	el.setAttribute("fill", mark.color);
	el.setAttribute("font-size", "42");
	el.setAttribute("font-weight", "700");
	el.setAttribute("paint-order", "stroke");
	el.setAttribute("stroke", "#000");
	el.setAttribute("stroke-width", "7");
	el.setAttribute("stroke-linejoin", "round");
	el.textContent = mark.text || "";
	return el;
}

function iconMark (svg, mark) {
	if (mark.icon === "x" || mark.icon === "question" || mark.icon === "skull") {
		const el = textMark(svg, {
			...mark,
			text: mark.icon === "x" ? "×" : mark.icon === "question" ? "?" : "☠",
		});
		el.setAttribute("text-anchor", "middle");
		el.setAttribute("dominant-baseline", "middle");
		el.setAttribute("font-size", "72");
		return el;
	}
	if (mark.icon === "circle") {
		const el = make(svg, "circle");
		el.setAttribute("cx", mark.x * 1000);
		el.setAttribute("cy", mark.y * 1000);
		el.setAttribute("r", "36");
		stroke(el, mark.color);
		el.setAttribute("fill", "none");
		return el;
	}
	return svgIcon(svg, mark.icon, mark.x, mark.y, mark.color, 82);
}

function placeMark (svg, mark) {
	const group = make(svg, "g");
	const x = mark.x * 1000;
	const y = mark.y * 1000;
	const pin = make(group, "path");
	pin.setAttribute("d", `M${x} ${y + 46}C${x - 10} ${y + 27} ${x - 36} ${y + 2} ${x - 36} ${y - 27}a36 36 0 1 1 72 0c0 29-26 54-36 73z`);
	pin.setAttribute("fill", mark.color);
	pin.setAttribute("stroke", "#000");
	pin.setAttribute("stroke-width", "6");
	const key = PLACE_ICONS[mark.place];
	if (key) svgIcon(group, key, mark.x, mark.y - 0.027, "#111", 50);
	const label = make(group, "text");
	label.setAttribute("x", x);
	label.setAttribute("y", y + 82);
	label.setAttribute("text-anchor", "middle");
	label.setAttribute("fill", mark.color);
	label.setAttribute("font-size", "34");
	label.setAttribute("font-weight", "700");
	label.setAttribute("paint-order", "stroke");
	label.setAttribute("stroke", "#000");
	label.setAttribute("stroke-width", "7");
	label.textContent = mark.label || mark.place || "";
	return group;
}

function lineMark (svg, mark) {
	const el = make(svg, "line");
	el.setAttribute("x1", mark.x * 1000);
	el.setAttribute("y1", mark.y * 1000);
	el.setAttribute("x2", mark.x2 * 1000);
	el.setAttribute("y2", mark.y2 * 1000);
	stroke(el, mark.color);
	return el;
}

function ellipseMark (svg, mark) {
	const el = make(svg, "ellipse");
	const x1 = mark.x * 1000;
	const y1 = mark.y * 1000;
	const x2 = mark.x2 * 1000;
	const y2 = mark.y2 * 1000;
	el.setAttribute("cx", (x1 + x2) / 2);
	el.setAttribute("cy", (y1 + y2) / 2);
	el.setAttribute("rx", Math.abs(x2 - x1) / 2);
	el.setAttribute("ry", Math.abs(y2 - y1) / 2);
	areaStyle(el, mark.color);
	return el;
}

function rectMark (svg, mark) {
	const el = make(svg, "rect");
	const x1 = mark.x * 1000;
	const y1 = mark.y * 1000;
	const x2 = mark.x2 * 1000;
	const y2 = mark.y2 * 1000;
	el.setAttribute("x", Math.min(x1, x2));
	el.setAttribute("y", Math.min(y1, y2));
	el.setAttribute("width", Math.abs(x2 - x1));
	el.setAttribute("height", Math.abs(y2 - y1));
	areaStyle(el, mark.color);
	return el;
}

function coneMark (svg, mark) {
	const el = make(svg, "polygon");
	const x = mark.x * 1000;
	const y = mark.y * 1000;
	const dx = mark.x2 * 1000 - x;
	const dy = mark.y2 * 1000 - y;
	const length = Math.hypot(dx, dy) || 1;
	const width = length * 0.58;
	const px = -dy / length * width;
	const py = dx / length * width;
	el.setAttribute("points", `${x},${y} ${x + dx + px},${y + dy + py} ${x + dx - px},${y + dy - py}`);
	areaStyle(el, mark.color);
	return el;
}

function svgIcon (parent, key, x, y, color, size) {
	const icon = TABLE_ICONS[key] || TABLE_ICONS.shield;
	const el = make(parent, "svg");
	el.setAttribute("x", x * 1000 - size / 2);
	el.setAttribute("y", y * 1000 - size / 2);
	el.setAttribute("width", size);
	el.setAttribute("height", size);
	el.setAttribute("viewBox", "0 0 512 512");
	const path = make(el, "path");
	path.setAttribute("d", icon.path);
	path.setAttribute("fill", color);
	return el;
}

function areaStyle (el, color) {
	stroke(el, color);
	el.setAttribute("fill", color);
	el.setAttribute("fill-opacity", "0.16");
}

function stroke (el, color) {
	el.setAttribute("stroke", color || "#ff3b30");
	el.setAttribute("stroke-width", "12");
	el.setAttribute("stroke-linecap", "round");
	el.setAttribute("stroke-linejoin", "round");
	el.setAttribute("vector-effect", "non-scaling-stroke");
}

function make (parent, tag) {
	const el = parent.ownerDocument.createElementNS(NS, tag);
	parent.appendChild(el);
	return el;
}

function clamp (value) {
	return Math.max(0, Math.min(1, value));
}
