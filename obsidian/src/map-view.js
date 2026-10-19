import {ItemView, Notice} from "obsidian";
import {VIEW_TYPE_FIVEETOOLS_MAP_PLAYER} from "./constants.js";
import {ICON_ID} from "./icon.js";
import {
	bindMapPointer,
	cameraOnCenter,
	defaultCamera,
	drawWorld,
	fitImage,
	worldCenter,
} from "./map-canvas.js";
import {
	cssPixelsPerWorldPixel,
	DEFAULT_CELL_INCHES,
	DEFAULT_DIAGONAL_INCHES,
	screenPpiCss,
} from "./map-scale.js";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

export function defaultMapSession () {
	return {
		filePath: "",
		cellPx: 70,
		offsetX: 0,
		offsetY: 0,
		camera: defaultCamera(),
		showGrid: true,
		actualSize: false,
		cellInches: DEFAULT_CELL_INCHES,
		diagonalInches: DEFAULT_DIAGONAL_INCHES,
	};
}

export function teardownMapView (plugin, {closePlayer = false} = {}) {
	plugin?._mapResizeOff?.();
	if (plugin) {
		plugin._mapResizeOff = null;
		plugin._mapPaint = null;
	}
	if (closePlayer) {
		closePlayerWindow(plugin);
		if (plugin) plugin._mapLastDraw = null;
	}
}

export function renderMapTool (formEl, resultEl, {session, plugin, app, onSessionChange} = {}) {
	teardownMapView(plugin);
	formEl.empty();
	formEl.addClass("fiveetools-map");
	resultEl.empty();
	resultEl.addClass("fiveetools-map-stage");

	let state = {...defaultMapSession(), ...session, camera: {...defaultCamera(), ...session?.camera}};
	let image = null;
	let raf = 0;

	const emit = () => onSessionChange?.({...state, camera: {...state.camera}});

	formEl.createEl("h3", {text: "Battle map"});
	formEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Load a vault image, pan and zoom, then open a player window. Actual size makes one grid cell one inch on that screen. The player window stays open if you switch to Campaigns or Encounter.",
	});

	const fileRow = formEl.createDiv({cls: "fiveetools-map__row"});
	const fileSelect = fileRow.createEl("select", {cls: "fiveetools-map__select", attr: {title: "Vault image"}});
	const loadBtn = fileRow.createEl("button", {text: "Load", cls: "fiveetools-btn", attr: {type: "button"}});

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

	const paintFiles = () => {
		const files = vaultImages(app);
		fileSelect.empty();
		if (!files.length) {
			fileSelect.createEl("option", {text: "No vault images", attr: {value: ""}});
			return;
		}
		for (const file of files) {
			const opt = fileSelect.createEl("option", {text: file.path, attr: {value: file.path}});
			if (file.path === state.filePath) opt.selected = true;
		}
		if (state.filePath && !files.some(it => it.path === state.filePath)) {
			fileSelect.createEl("option", {text: state.filePath, attr: {value: state.filePath}}).selected = true;
		}
	};

	const sizeCanvas = () => {
		const w = Math.max(1, resultEl.clientWidth || 400);
		const h = Math.max(1, resultEl.clientHeight || 300);
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
	};

	const paint = () => {
		sizeCanvas();
		drawWorld(ctx, {
			image,
			camera: state.camera,
			cellPx: state.cellPx,
			offsetX: state.offsetX,
			offsetY: state.offsetY,
			showGrid: state.showGrid,
			width: canvas.width,
			height: canvas.height,
		});
		paintPlayer(plugin, {
			image,
			gm: state,
			gmView: {width: canvas.width, height: canvas.height},
		});
	};

	const schedule = () => {
		if (raf) return;
		raf = requestAnimationFrame(() => {
			raf = 0;
			paint();
		});
	};

	if (plugin) plugin._mapPaint = paint;

	bindMapPointer(canvas, () => state.camera, (cam) => { state.camera = cam; }, () => {
		emit();
		schedule();
	});

	const loadPath = async (path) => {
		state.filePath = path;
		emit();
		image = await loadVaultImage(app, path);
		if (!image) {
			new Notice(path ? "Could not load that image." : "Pick a vault image.");
			schedule();
			return;
		}
		sizeCanvas();
		state.camera = fitImage(image, canvas.width, canvas.height);
		emit();
		schedule();
	};

	loadBtn.addEventListener("click", () => { void loadPath(fileSelect.value); });
	cellEl.addEventListener("change", () => {
		state.cellPx = Math.max(8, Number(cellEl.value) || 70);
		cellEl.value = String(state.cellPx);
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
		emit();
		schedule();
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
		emit();
		schedule();
	});
	actualBtn.addEventListener("click", () => {
		state.actualSize = !state.actualSize;
		actualBtn.setText(state.actualSize ? "Actual size on" : "Actual size off");
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
		};
	}

	paintFiles();
	sizeCanvas();
	if (state.filePath) void loadPath(state.filePath);
	else schedule();
}

function vaultImages (app) {
	return (app?.vault?.getFiles?.() || []).filter(f => IMAGE_EXT.has(String(f.extension || "").toLowerCase()));
}

async function loadVaultImage (app, path) {
	const file = app?.vault?.getAbstractFileByPath?.(path);
	if (!file || !app.vault.getResourcePath) return null;
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = app.vault.getResourcePath(file);
	});
}

export class FiveEToolsMapPlayerView extends ItemView {
	constructor (leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.canvas = null;
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
		this.canvas = this.contentEl.createEl("canvas", {cls: "fiveetools-map-player__canvas"});
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
		this.canvas = null;
		this.contentEl.empty();
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
	} catch (e) {
		new Notice(e.message || "Could not open player window.");
	}
}

function closePlayerWindow (plugin) {
	const leaves = plugin.app?.workspace?.getLeavesOfType?.(VIEW_TYPE_FIVEETOOLS_MAP_PLAYER) || [];
	for (const leaf of leaves) {
		try { leaf.detach(); } catch (_) { /* ignore */ }
	}
}

function paintPlayer (plugin, draw) {
	if (plugin) plugin._mapLastDraw = draw;
	const view = playerView(plugin);
	const canvas = view?.canvas;
	if (!canvas) return;
	const {image, gm, gmView} = draw;
	const host = view.contentEl;
	const win = host.win || host.ownerDocument?.defaultView;
	const width = Math.max(1, host.clientWidth || win?.innerWidth || 800);
	const height = Math.max(1, host.clientHeight || win?.innerHeight || 600);
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	const center = worldCenter(gm.camera, gmView.width, gmView.height);
	let scale = gm.camera.scale;
	if (gm.actualSize && win?.screen) {
		const ppi = screenPpiCss(win.screen.width, win.screen.height, gm.diagonalInches);
		const next = cssPixelsPerWorldPixel(gm.cellPx, gm.cellInches, ppi);
		if (next) scale = next;
	}
	drawWorld(canvas.getContext("2d"), {
		image,
		camera: cameraOnCenter(center, width, height, scale),
		cellPx: gm.cellPx,
		offsetX: gm.offsetX,
		offsetY: gm.offsetY,
		showGrid: gm.showGrid,
		width,
		height,
	});
}
