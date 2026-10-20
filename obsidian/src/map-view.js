import fs from "fs";
import path from "path";
import {ItemView, Menu, Notice} from "obsidian";
import {VIEW_TYPE_FIVEETOOLS_MAP_PLAYER} from "./constants.js";
import {ICON_ID} from "./icon.js";
import {
	bindMapPointer,
	cameraOnCenter,
	defaultCamera,
	drawWorld,
	fitImage,
	sampleEdgeColor,
	screenToWorld,
	worldCenter,
} from "./map-canvas.js";
import {
	clearFogRect,
	coverFogAll,
	createFogMask,
	fogPaths,
	loadFogMask,
	paintFogBrush,
	saveFogMask,
	strokeFogBrush,
} from "./map-fog.js";
import {
	cellPxFromMapDpi,
	cssPixelsPerWorldPixel,
	DEFAULT_CELL_INCHES,
	DEFAULT_DIAGONAL_INCHES,
	inchesFromMapDpi,
	mapDpiFromInches,
	screenPpiCss,
} from "./map-scale.js";
import {detectImageDpi} from "./map-dpi.js";

const FOG_GM_ALPHA = 0.55;
const DEFAULT_BRUSH = 40;

const IMAGE_FILTERS = [
	{name: "Images", extensions: ["png", "jpg", "jpeg", "bmp", "webp"]},
	{name: "All Files", extensions: ["*"]},
];

export function defaultMapSession () {
	return {
		filePath: "",
		cellPx: 70,
		offsetX: 0,
		offsetY: 0,
		camera: defaultCamera(),
		lookAt: null,
		showGrid: true,
		viewLocked: false,
		scaleLocked: false,
		playerScale: null,
		actualSize: false,
		cellInches: DEFAULT_CELL_INCHES,
		diagonalInches: DEFAULT_DIAGONAL_INCHES,
		mapDpi: null,
		paperWidthInches: null,
		paperHeightInches: null,
	};
}

export function teardownMapView (plugin, {closePlayer = false} = {}) {
	document.body.classList.remove("fiveetools-map-player-window");
	plugin?._mapResizeOff?.();
	if (plugin) {
		plugin._mapResizeOff = null;
		plugin._mapPaint = null;
		plugin._mapToggleViewLock = null;
		plugin._mapToggleScaleLock = null;
	}
	if (closePlayer) {
		closePlayerWindow(plugin);
		if (plugin) plugin._mapLastDraw = null;
	}
}

export function toggleMapPlayerZoomFreeze (plugin) {
	if (typeof plugin?._mapToggleScaleLock === "function") {
		plugin._mapToggleScaleLock();
		return;
	}
	const prev = plugin?._mapSession || {};
	const next = {
		...defaultMapSession(),
		...prev,
		camera: {...defaultCamera(), ...prev.camera},
		lookAt: prev.lookAt ? {...prev.lookAt} : null,
		viewLocked: prev.viewLocked ?? prev.zoomLocked ?? false,
		scaleLocked: !(prev.scaleLocked),
	};
	if (next.scaleLocked) {
		next.viewLocked = false;
		if (!next.playerScale) next.playerScale = next.camera?.scale ?? 1;
	} else {
		next.playerScale = null;
	}
	if (plugin) plugin._mapSession = next;
	new Notice(next.scaleLocked ? "Player zoom frozen" : "Player zoom unfrozen");
}

export function renderMapTool (formEl, resultEl, {session, plugin, app, onSessionChange} = {}) {
	teardownMapView(plugin);
	formEl.empty();
	formEl.addClass("fiveetools-map");
	resultEl.empty();
	resultEl.addClass("fiveetools-map-stage");

	let state = {
		...defaultMapSession(),
		...session,
		camera: {...defaultCamera(), ...session?.camera},
		lookAt: session?.lookAt ? {...session.lookAt} : null,
		viewLocked: session?.viewLocked ?? session?.zoomLocked ?? false,
		scaleLocked: !!session?.scaleLocked,
	};
	delete state.zoomLocked;
	if (state.viewLocked) state.scaleLocked = false;
	let image = null;
	let fog = null;
	let edgeColor = "#111";
	let tool = "pan";
	let brushPx = DEFAULT_BRUSH;
	let fogStroke = null;
	let fogRect = null;
	let fogSaveTimer = 0;
	let raf = 0;

	const emit = () => onSessionChange?.({
		...state,
		camera: {...state.camera},
		lookAt: state.lookAt ? {...state.lookAt} : null,
	});

	const setLookAtFromView = () => {
		sizeCanvas();
		state.lookAt = worldCenter(state.camera, canvas.width, canvas.height);
	};

	formEl.createEl("h3", {text: "Battle map"});
	formEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Choose an image file. Set paper size or DPI (autodetected when the file has it). Pan and zoom, then open a player window. Actual size prints one grid cell at the cell inches on that screen.",
	});

	const fileRow = formEl.createDiv({cls: "fiveetools-map__row"});
	const pathEl = fileRow.createEl("span", {
		cls: "fiveetools-map__path",
		text: state.filePath ? path.basename(state.filePath) : "No file chosen",
		attr: {title: state.filePath || ""},
	});
	const browseBtn = fileRow.createEl("button", {text: "Browse", cls: "fiveetools-btn", attr: {type: "button"}});
	const metaEl = formEl.createEl("p", {cls: "fiveetools-view__meta"});

	const paperRow = formEl.createDiv({cls: "fiveetools-map__row"});
	paperRow.createEl("label", {text: "W\""});
	const paperWEl = paperRow.createEl("input", {
		cls: "fiveetools-map__num",
		attr: {type: "number", min: "0.1", step: "0.01", title: "Map width in inches"},
	});
	paperRow.createEl("label", {text: "H\""});
	const paperHEl = paperRow.createEl("input", {
		cls: "fiveetools-map__num",
		attr: {type: "number", min: "0.1", step: "0.01", title: "Map height in inches"},
	});
	paperRow.createEl("label", {text: "DPI"});
	const dpiEl = paperRow.createEl("input", {
		cls: "fiveetools-map__num",
		attr: {type: "number", min: "1", step: "1", title: "Map pixels per inch"},
	});

	const gridRow = formEl.createDiv({cls: "fiveetools-map__row"});
	gridRow.createEl("label", {text: "Cell px"});
	const cellEl = gridRow.createEl("input", {
		cls: "fiveetools-map__num",
		attr: {type: "number", min: "8", value: String(state.cellPx)},
	});
	const gridBtn = gridRow.createEl("button", {
		text: state.showGrid ? "Grid on" : "Grid off",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button"},
	});

	const fitBtn = formEl.createEl("button", {text: "Fit map", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button"}});
	const freezeBtn = formEl.createEl("button", {
		text: state.viewLocked ? "Player frozen" : "Freeze player",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Player holds view; GM can pan, zoom, change maps"},
	});
	const freezeZoomBtn = formEl.createEl("button", {
		text: state.scaleLocked ? "Zoom frozen" : "Freeze zoom",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Player holds zoom; pan still follows"},
	});

	const fogRow = formEl.createDiv({cls: "fiveetools-map__row"});
	const toolPanBtn = fogRow.createEl("button", {text: "Pan", cls: "fiveetools-btn fiveetools-btn--ghost is-active", attr: {type: "button"}});
	const toolCoverBtn = fogRow.createEl("button", {text: "Cover", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Paint fog"}});
	const toolRevealBtn = fogRow.createEl("button", {text: "Reveal", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Erase fog with pencil"}});
	const toolRectBtn = fogRow.createEl("button", {text: "Rect reveal", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Clear fog in a rectangle"}});
	fogRow.createEl("label", {text: "Brush"});
	const brushEl = fogRow.createEl("input", {
		cls: "fiveetools-map__num",
		attr: {type: "number", min: "4", step: "1", value: String(brushPx)},
	});
	const coverAllBtn = fogRow.createEl("button", {text: "Cover all", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button"}});
	const saveStartBtn = fogRow.createEl("button", {text: "Save start", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Save current fog as reusable start state"}});
	const resetStartBtn = fogRow.createEl("button", {text: "Reset start", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Restore fog from saved start state"}});

	const sizeRow = formEl.createDiv({cls: "fiveetools-map__row"});
	sizeRow.createEl("label", {text: "Screen \""});
	const diagEl = sizeRow.createEl("input", {
		cls: "fiveetools-map__num",
		attr: {type: "number", min: "1", step: "0.1", value: String(state.diagonalInches)},
	});
	sizeRow.createEl("label", {text: "Cell \""});
	const inchEl = sizeRow.createEl("input", {
		cls: "fiveetools-map__num",
		attr: {type: "number", min: "0.1", step: "0.1", value: String(state.cellInches)},
	});

	const actualBtn = formEl.createEl("button", {
		text: state.actualSize ? "Actual size on" : "Actual size off",
		cls: "fiveetools-btn",
		attr: {type: "button", title: "Player window: 1 cell = cell inches on the calibrated screen"},
	});
	const playerBtn = formEl.createEl("button", {text: "Player window", cls: "fiveetools-btn", attr: {type: "button"}});

	const canvas = resultEl.createEl("canvas", {cls: "fiveetools-map__canvas"});
	const ctx = canvas.getContext("2d");

	const sizeCanvas = () => {
		const w = Math.max(1, resultEl.clientWidth || 400);
		const h = Math.max(1, resultEl.clientHeight || 300);
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
	};

	const syncToolUi = () => {
		toolPanBtn.classList.toggle("is-active", tool === "pan");
		toolCoverBtn.classList.toggle("is-active", tool === "cover");
		toolRevealBtn.classList.toggle("is-active", tool === "reveal");
		toolRectBtn.classList.toggle("is-active", tool === "rect");
		canvas.classList.toggle("fiveetools-map__canvas--fog", tool !== "pan");
	};

	const queueFogSave = () => {
		if (!state.filePath || !fog) return;
		if (fogSaveTimer) clearTimeout(fogSaveTimer);
		fogSaveTimer = setTimeout(() => {
			fogSaveTimer = 0;
			const {live} = fogPaths(state.filePath);
			if (!saveFogMask(live, fog)) new Notice("Could not save live fog.");
		}, 500);
	};

	const paint = () => {
		sizeCanvas();
		if (!state.lookAt) state.lookAt = worldCenter(state.camera, canvas.width, canvas.height);
		drawWorld(ctx, {
			image,
			camera: state.camera,
			cellPx: state.cellPx,
			offsetX: state.offsetX,
			offsetY: state.offsetY,
			showGrid: state.showGrid,
			width: canvas.width,
			height: canvas.height,
			bgColor: edgeColor,
			fog,
			fogAlpha: FOG_GM_ALPHA,
		});
		if (fogRect && fog) {
			const scale = state.camera.scale;
			const x = Math.min(fogRect.x0, fogRect.x1);
			const y = Math.min(fogRect.y0, fogRect.y1);
			const w = Math.abs(fogRect.x1 - fogRect.x0);
			const h = Math.abs(fogRect.y1 - fogRect.y0);
			ctx.setTransform(scale, 0, 0, scale, -state.camera.x * scale, -state.camera.y * scale);
			ctx.strokeStyle = "rgba(255,220,80,0.9)";
			ctx.lineWidth = 2 / scale;
			ctx.strokeRect(x, y, w, h);
			ctx.setTransform(1, 0, 0, 1, 0, 0);
		}
		try {
			paintPlayer(plugin, {
				image,
				gm: state,
				gmView: {width: canvas.width, height: canvas.height},
				bgColor: edgeColor,
				fog,
			});
		} catch (_) { /* player paint must not blank the GM canvas */ }
	};

	const schedule = () => {
		if (raf) return;
		raf = requestAnimationFrame(() => {
			raf = 0;
			paint();
		});
	};

	if (plugin) plugin._mapPaint = paint;

	const syncPaperUi = () => {
		pathEl.setText(state.filePath ? path.basename(state.filePath) : "No file chosen");
		pathEl.setAttribute("title", state.filePath || "");
		paperWEl.value = state.paperWidthInches ? fmtNum(state.paperWidthInches, 2) : "";
		paperHEl.value = state.paperHeightInches ? fmtNum(state.paperHeightInches, 2) : "";
		dpiEl.value = state.mapDpi ? fmtNum(state.mapDpi, 1) : "";
		cellEl.value = String(state.cellPx);
		if (!image) {
			metaEl.setText("Choose an image file, then set paper size or DPI.");
			return;
		}
		const bits = [`${image.width} × ${image.height} px`];
		if (state.paperWidthInches && state.paperHeightInches) {
			bits.push(`${fmtNum(state.paperWidthInches, 2)} × ${fmtNum(state.paperHeightInches, 2)} in`);
		}
		if (state.mapDpi) bits.push(`${fmtNum(state.mapDpi, 1)} DPI`);
		metaEl.setText(bits.join(" · "));
	};

	const applyDpi = (dpi) => {
		const n = Number(dpi);
		if (!(n > 0) || !image) return false;
		state.mapDpi = n;
		state.paperWidthInches = inchesFromMapDpi(image.width, n);
		state.paperHeightInches = inchesFromMapDpi(image.height, n);
		const cell = cellPxFromMapDpi(n, state.cellInches);
		if (cell) state.cellPx = Math.max(8, Math.round(cell));
		syncPaperUi();
		return true;
	};

	const fallbackPlayerScale = () => {
		const view = playerView(plugin);
		const win = view?.contentEl?.win;
		if (state.actualSize && win?.screen) {
			const ppi = screenPpiCss(win.screen.width, win.screen.height, state.diagonalInches);
			const next = cssPixelsPerWorldPixel(state.cellPx, state.cellInches, ppi);
			if (next) return next;
		}
		return state.camera.scale;
	};

	/** Capture what the player window is showing now (not the GM camera). */
	const snapshotPlayerView = () => {
		const last = plugin?._mapPlayerView;
		if (last?.center && last.scale) {
			state.lookAt = {...last.center};
			state.playerScale = last.scale;
			return;
		}
		if (!state.lookAt) setLookAtFromView();
		state.playerScale = fallbackPlayerScale();
	};

	const syncFreezeButtons = () => {
		freezeBtn.setText(state.viewLocked ? "Player frozen" : "Freeze player");
		freezeZoomBtn.setText(state.scaleLocked ? "Zoom frozen" : "Freeze zoom");
	};

	const snapGmToPlayerView = () => {
		sizeCanvas();
		const view = resolvePlayerView(state, {width: canvas.width, height: canvas.height}, plugin);
		state.lookAt = {...view.center};
		state.camera = cameraOnCenter(view.center, canvas.width, canvas.height, view.scale);
	};

	const setViewLocked = (next) => {
		if (next) {
			state.viewLocked = true;
			state.scaleLocked = false;
			snapshotPlayerView();
		} else {
			snapGmToPlayerView();
			state.viewLocked = false;
			state.playerScale = null;
		}
		syncFreezeButtons();
		emit();
		schedule();
	};

	const setScaleLocked = (next) => {
		if (next) {
			state.scaleLocked = true;
			state.viewLocked = false;
			snapshotPlayerView();
		} else {
			snapGmToPlayerView();
			state.scaleLocked = false;
			state.playerScale = null;
		}
		syncFreezeButtons();
		emit();
		schedule();
	};

	if (plugin) {
		plugin._mapToggleViewLock = () => setViewLocked(!state.viewLocked);
		plugin._mapToggleScaleLock = () => setScaleLocked(!state.scaleLocked);
	}

	bindMapPointer(
		canvas,
		() => state.camera,
		(cam) => { state.camera = cam; },
		(reason, cam, prev) => {
			if (reason === "pan" && prev && !state.viewLocked) {
				if (!state.lookAt) state.lookAt = worldCenter(prev, canvas.width, canvas.height);
				state.lookAt = {
					x: state.lookAt.x + (cam.x - prev.x),
					y: state.lookAt.y + (cam.y - prev.y),
				};
			}
			emit();
			schedule();
		},
		() => tool === "pan",
	);

	canvas.addEventListener("pointerdown", (evt) => {
		if (evt.button !== 0 || tool === "pan" || !fog || !image) return;
		canvas.setPointerCapture(evt.pointerId);
		const pt = screenToWorld(state.camera, canvas, evt.clientX, evt.clientY);
		if (tool === "rect") {
			fogRect = {x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y};
			schedule();
			return;
		}
		fogStroke = {x: pt.x, y: pt.y, mode: tool === "cover" ? "cover" : "reveal"};
		paintFogBrush(fog, pt.x, pt.y, brushPx, fogStroke.mode);
		schedule();
	});
	canvas.addEventListener("pointermove", (evt) => {
		if (fogRect) {
			const pt = screenToWorld(state.camera, canvas, evt.clientX, evt.clientY);
			fogRect.x1 = pt.x;
			fogRect.y1 = pt.y;
			schedule();
			return;
		}
		if (!fogStroke || !fog) return;
		const pt = screenToWorld(state.camera, canvas, evt.clientX, evt.clientY);
		strokeFogBrush(fog, fogStroke.x, fogStroke.y, pt.x, pt.y, brushPx, fogStroke.mode);
		fogStroke.x = pt.x;
		fogStroke.y = pt.y;
		schedule();
	});
	const endFogPointer = (evt) => {
		if (fogRect && fog) {
			const x = Math.min(fogRect.x0, fogRect.x1);
			const y = Math.min(fogRect.y0, fogRect.y1);
			const w = Math.abs(fogRect.x1 - fogRect.x0);
			const h = Math.abs(fogRect.y1 - fogRect.y0);
			if (w > 1 && h > 1) clearFogRect(fog, x, y, w, h);
			fogRect = null;
			queueFogSave();
			schedule();
			return;
		}
		if (fogStroke) {
			fogStroke = null;
			queueFogSave();
		}
	};
	canvas.addEventListener("pointerup", endFogPointer);
	canvas.addEventListener("pointercancel", endFogPointer);

	const setTool = (next) => {
		tool = next;
		fogStroke = null;
		fogRect = null;
		syncToolUi();
		schedule();
	};

	const loadPath = async (filePath, {fromSession = false} = {}) => {
		const prevPath = state.filePath;
		state.filePath = filePath;
		emit();
		revokeImageUrl(image);
		image = await loadMapImage(app, filePath);
		if (!image) {
			edgeColor = "#111";
			fog = null;
			new Notice(filePath ? "Could not load that image." : "Choose an image file.");
			syncPaperUi();
			schedule();
			return;
		}
		edgeColor = sampleEdgeColor(image);
		const paths = fogPaths(filePath);
		fog = await loadFogMask(paths.live, image.width, image.height)
			|| await loadFogMask(paths.start, image.width, image.height)
			|| createFogMask(image.width, image.height);
		sizeCanvas();
		state.camera = fitImage(image, canvas.width, canvas.height);
		setLookAtFromView();
		if (state.viewLocked || state.scaleLocked) state.playerScale = fallbackPlayerScale();
		const keepPaper = fromSession && (state.mapDpi || state.paperWidthInches);
		const found = keepPaper ? null : await detectMapImageDpi(app, filePath);
		if (found) {
			applyDpi(found);
			if (!fromSession) new Notice(`Map DPI ${found} from file.`);
		} else if (!fromSession && prevPath !== filePath) {
			state.mapDpi = null;
			state.paperWidthInches = null;
			state.paperHeightInches = null;
			syncPaperUi();
			new Notice("No DPI in file. Set width, height, or DPI.");
		} else {
			syncPaperUi();
		}
		emit();
		schedule();
	};

	browseBtn.addEventListener("click", () => {
		const picked = pickMapFile(state.filePath);
		if (picked == null) return;
		if (!picked) {
			new Notice("File picker needs the Obsidian desktop app.");
			return;
		}
		void loadPath(picked);
	});
	paperWEl.addEventListener("change", () => {
		const dpi = image ? mapDpiFromInches(image.width, paperWEl.value) : null;
		if (!applyDpi(dpi)) paperWEl.value = state.paperWidthInches ? fmtNum(state.paperWidthInches, 2) : "";
		emit();
		schedule();
	});
	paperHEl.addEventListener("change", () => {
		const dpi = image ? mapDpiFromInches(image.height, paperHEl.value) : null;
		if (!applyDpi(dpi)) paperHEl.value = state.paperHeightInches ? fmtNum(state.paperHeightInches, 2) : "";
		emit();
		schedule();
	});
	dpiEl.addEventListener("change", () => {
		if (!applyDpi(dpiEl.value)) dpiEl.value = state.mapDpi ? fmtNum(state.mapDpi, 1) : "";
		emit();
		schedule();
	});
	cellEl.addEventListener("change", () => {
		state.cellPx = Math.max(8, Number(cellEl.value) || 70);
		cellEl.value = String(state.cellPx);
		const dpi = mapDpiFromInches(state.cellPx, state.cellInches);
		if (dpi && image) applyDpi(dpi);
		else syncPaperUi();
		emit();
		schedule();
	});
	gridBtn.addEventListener("click", () => {
		state.showGrid = !state.showGrid;
		gridBtn.setText(state.showGrid ? "Grid on" : "Grid off");
		emit();
		schedule();
	});
	fitBtn.addEventListener("click", () => {
		if (!image) return;
		sizeCanvas();
		state.camera = fitImage(image, canvas.width, canvas.height);
		if (!state.viewLocked) setLookAtFromView();
		emit();
		schedule();
	});
	freezeBtn.addEventListener("click", () => {
		setViewLocked(!state.viewLocked);
	});
	freezeZoomBtn.addEventListener("click", () => {
		setScaleLocked(!state.scaleLocked);
	});
	toolPanBtn.addEventListener("click", () => setTool("pan"));
	toolCoverBtn.addEventListener("click", () => setTool("cover"));
	toolRevealBtn.addEventListener("click", () => setTool("reveal"));
	toolRectBtn.addEventListener("click", () => setTool("rect"));
	brushEl.addEventListener("change", () => {
		brushPx = Math.max(4, Number(brushEl.value) || DEFAULT_BRUSH);
		brushEl.value = String(brushPx);
	});
	coverAllBtn.addEventListener("click", () => {
		if (!fog) return;
		coverFogAll(fog);
		queueFogSave();
		schedule();
	});
	saveStartBtn.addEventListener("click", () => {
		if (!fog || !state.filePath) {
			new Notice("Load a map before saving fog start.");
			return;
		}
		const {start} = fogPaths(state.filePath);
		if (saveFogMask(start, fog)) new Notice("Fog start state saved.");
		else new Notice("Could not save fog start state.");
	});
	resetStartBtn.addEventListener("click", async () => {
		if (!image || !state.filePath) return;
		const {start} = fogPaths(state.filePath);
		const loaded = await loadFogMask(start, image.width, image.height);
		fog = loaded || createFogMask(image.width, image.height);
		queueFogSave();
		schedule();
		new Notice(loaded ? "Fog reset to start state." : "No start state; fog cleared.");
	});
	canvas.addEventListener("contextmenu", (evt) => {
		evt.preventDefault();
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(state.viewLocked ? "Unfreeze player" : "Freeze player")
				.onClick(() => setViewLocked(!state.viewLocked));
		});
		menu.addItem((item) => {
			item
				.setTitle(state.scaleLocked ? "Unfreeze zoom" : "Freeze zoom")
				.onClick(() => setScaleLocked(!state.scaleLocked));
		});
		menu.showAtMouseEvent(evt);
	});
	diagEl.addEventListener("change", () => {
		state.diagonalInches = Math.max(1, Number(diagEl.value) || DEFAULT_DIAGONAL_INCHES);
		diagEl.value = String(state.diagonalInches);
		emit();
		schedule();
	});
	inchEl.addEventListener("change", () => {
		state.cellInches = Math.max(0.1, Number(inchEl.value) || DEFAULT_CELL_INCHES);
		inchEl.value = String(state.cellInches);
		if (state.mapDpi) applyDpi(state.mapDpi);
		emit();
		schedule();
	});
	actualBtn.addEventListener("click", () => {
		state.actualSize = !state.actualSize;
		actualBtn.setText(state.actualSize ? "Actual size on" : "Actual size off");
		if (state.actualSize) setLookAtFromView();
		emit();
		schedule();
	});
	playerBtn.addEventListener("click", () => {
		void openPlayerWindow(plugin).then(() => schedule());
	});

	const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => schedule()) : null;
	ro?.observe(resultEl);
	if (plugin) {
		plugin._mapResizeOff = () => {
			ro?.disconnect();
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
			if (fogSaveTimer) clearTimeout(fogSaveTimer);
			fogSaveTimer = 0;
		};
	}

	sizeCanvas();
	syncPaperUi();
	syncToolUi();
	if (state.filePath) void loadPath(state.filePath, {fromSession: true});
	else schedule();
}

function pickMapFile (defaultPath) {
	const dialog = window.electron?.remote?.dialog;
	if (typeof dialog?.showOpenDialogSync !== "function") return "";
	const opts = {
		title: "Choose battle map",
		properties: ["openFile", "dontAddToRecent"],
		filters: IMAGE_FILTERS,
	};
	if (defaultPath && path.isAbsolute(defaultPath)) opts.defaultPath = defaultPath;
	const picked = dialog.showOpenDialogSync(opts);
	if (!picked?.length) return null;
	return picked[0];
}

async function detectMapImageDpi (app, filePath) {
	try {
		const buf = await readMapBytes(app, filePath);
		if (!buf) return null;
		const slice = buf.byteLength > 262144 ? buf.slice(0, 262144) : buf;
		return detectImageDpi(slice);
	} catch (_) {
		return null;
	}
}

async function readMapBytes (app, filePath) {
	if (!filePath) return null;
	const vaultFile = app?.vault?.getAbstractFileByPath?.(filePath);
	if (vaultFile && app.vault.readBinary) {
		return app.vault.readBinary(vaultFile);
	}
	if (!fs.existsSync(filePath)) return null;
	return fs.readFileSync(filePath);
}

function fmtNum (n, places) {
	const x = Number(n);
	if (!Number.isFinite(x)) return "";
	return String(Number(x.toFixed(places)));
}

const IMAGE_MIME = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	bmp: "image/bmp",
	webp: "image/webp",
	gif: "image/gif",
};

function revokeImageUrl (image) {
	const url = image?._fiveetoolsObjectUrl;
	if (url) URL.revokeObjectURL(url);
}

function mapMime (filePath) {
	const ext = String(path.extname(filePath || "")).replace(/^\./, "").toLowerCase();
	return IMAGE_MIME[ext] || "application/octet-stream";
}

async function loadMapImage (app, filePath) {
	let url = "";
	try {
		const buf = await readMapBytes(app, filePath);
		if (!buf) return null;
		url = URL.createObjectURL(new Blob([buf], {type: mapMime(filePath)}));
	} catch (_) {
		return null;
	}
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => {
			URL.revokeObjectURL(url);
			resolve(null);
		};
		img._fiveetoolsObjectUrl = url;
		img.src = url;
	});
}

export class FiveEToolsMapPlayerView extends ItemView {
	constructor (leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.frame = null;
		this._ro = null;
	}

	getViewType () {
		return VIEW_TYPE_FIVEETOOLS_MAP_PLAYER;
	}

	getDisplayText () {
		return "Player map";
	}

	getIcon () {
		return ICON_ID;
	}

	async onOpen () {
		this.contentEl.empty();
		this.contentEl.addClass("fiveetools-map-player");
		mountPlayerFrame(this);
		markPlayerWindow(this, true);
		this.contentEl.onWindowMigrated?.(() => {
			mountPlayerFrame(this);
			markPlayerWindow(this, true);
			if (this.plugin._mapPaint) this.plugin._mapPaint();
			else if (this.plugin._mapLastDraw) paintPlayer(this.plugin, this.plugin._mapLastDraw);
		});
		this._ro = typeof ResizeObserver === "function"
			? new ResizeObserver(() => {
				if (this.plugin._mapPaint) this.plugin._mapPaint();
				else if (this.plugin._mapLastDraw) paintPlayer(this.plugin, this.plugin._mapLastDraw);
			})
			: null;
		this._ro?.observe(this.contentEl);
	}

	async onClose () {
		this._ro?.disconnect();
		this._ro = null;
		this.frame?.remove();
		this.frame = null;
		markPlayerWindow(this, false);
		this.contentEl.empty();
	}
}

function mountPlayerFrame (view) {
	const win = view.contentEl.win;
	if (!isPopoutWin(win)) return;
	view.frame?.remove();
	const img = win.document.createElement("img");
	img.className = "fiveetools-map-player__frame";
	img.alt = "";
	win.document.body.appendChild(img);
	view.frame = img;
}

function isPopoutWin (win) {
	return !!(win && win !== window);
}

function markPlayerWindow (view, on) {
	document.body.classList.remove("fiveetools-map-player-window");
	const win = view?.contentEl?.win;
	const body = view?.contentEl?.doc?.body;
	if (!isPopoutWin(win) || !body) return;
	body.classList.toggle("fiveetools-map-player-window", on);
	if (on) {
		if (!view.frame || view.frame.ownerDocument !== win.document) mountPlayerFrame(view);
		view.contentEl.doc.title = "Player map";
		win.document.documentElement.style.background = "#000";
		body.style.background = "#000";
		requestAnimationFrame(() => {
			if (view.plugin._mapPaint) view.plugin._mapPaint();
			else if (view.plugin._mapLastDraw) paintPlayer(view.plugin, view.plugin._mapLastDraw);
		});
	}
}

function playerView (plugin) {
	const view = plugin.app?.workspace?.getLeavesOfType?.(VIEW_TYPE_FIVEETOOLS_MAP_PLAYER)?.[0]?.view;
	return view?.getViewType?.() === VIEW_TYPE_FIVEETOOLS_MAP_PLAYER ? view : null;
}

async function openPlayerWindow (plugin) {
	const workspace = plugin.app?.workspace;
	if (typeof workspace?.openPopoutLeaf !== "function") {
		new Notice("Player window needs the Obsidian desktop app.");
		return;
	}
	try {
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_FIVEETOOLS_MAP_PLAYER)[0];
		if (!leaf) {
			leaf = workspace.openPopoutLeaf({size: {width: 1280, height: 720}});
			await leaf.setViewState({
				type: VIEW_TYPE_FIVEETOOLS_MAP_PLAYER,
				active: true,
			});
		}
		workspace.revealLeaf(leaf);
		if (leaf.view?.getViewType?.() === VIEW_TYPE_FIVEETOOLS_MAP_PLAYER) markPlayerWindow(leaf.view, true);
	} catch (e) {
		new Notice(e.message || "Could not open player window.");
	}
}

function closePlayerWindow (plugin) {
	const leaves = plugin.app?.workspace?.getLeavesOfType?.(VIEW_TYPE_FIVEETOOLS_MAP_PLAYER) || [];
	for (const leaf of leaves) {
		try { leaf.detach(); } catch (_) { /* ignore */ }
	}
	document.body.classList.remove("fiveetools-map-player-window");
	if (plugin) plugin._mapBlit = null;
}

function playerBlitCanvas (plugin, width, height) {
	let el = plugin._mapBlit;
	if (!el) {
		el = document.createElement("canvas");
		plugin._mapBlit = el;
	}
	if (el.width !== width || el.height !== height) {
		el.width = width;
		el.height = height;
	}
	return el;
}

function resolvePlayerView (gm, gmView, plugin) {
	const win = playerView(plugin)?.contentEl?.win;
	const holdCenter = (gm.viewLocked || gm.scaleLocked || gm.actualSize) && gm.lookAt;
	const holdScale = (gm.viewLocked || gm.scaleLocked) && gm.playerScale;
	const center = holdCenter
		? {x: gm.lookAt.x, y: gm.lookAt.y}
		: worldCenter(gm.camera, gmView.width, gmView.height);
	let scale = gm.camera.scale;
	if (gm.actualSize && win?.screen) {
		const ppi = screenPpiCss(win.screen.width, win.screen.height, gm.diagonalInches);
		const next = cssPixelsPerWorldPixel(gm.cellPx, gm.cellInches, ppi);
		if (next) scale = next;
	}
	if (holdScale) scale = gm.playerScale;
	return {center, scale};
}

function paintPlayer (plugin, draw) {
	if (plugin) plugin._mapLastDraw = draw;
	const view = playerView(plugin);
	const frame = view?.frame;
	if (!frame) return;
	const {image, gm, gmView, bgColor, fog} = draw;
	const win = view.contentEl.win;
	const width = Math.max(1, win?.innerWidth || 800);
	const height = Math.max(1, win?.innerHeight || 600);
	const {center, scale} = resolvePlayerView(gm, gmView, plugin);
	if (plugin) plugin._mapPlayerView = {center: {x: center.x, y: center.y}, scale};
	const blit = playerBlitCanvas(plugin, width, height);
	drawWorld(blit.getContext("2d"), {
		image,
		camera: cameraOnCenter(center, width, height, scale),
		cellPx: gm.cellPx,
		offsetX: gm.offsetX,
		offsetY: gm.offsetY,
		showGrid: gm.showGrid,
		width,
		height,
		bgColor,
		fog,
		fogAlpha: 1,
	});
	try {
		frame.src = blit.toDataURL("image/jpeg", 0.85);
	} catch (e) {
		if (!plugin._mapBlitWarned) {
			plugin._mapBlitWarned = true;
			new Notice(e.message || "Could not send the map to the player window.");
		}
	}
}
