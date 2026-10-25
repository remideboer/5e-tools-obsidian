import {fs, path} from "./node-fs.js";
import {ItemView, Menu, Notice} from "obsidian";
import {VIEW_TYPE_FIVEETOOLS_MAP_PLAYER} from "./constants.js";
import {ICON_ID} from "./icon.js";
import {
	applyWorldTransform,
	bindMapPointer,
	cameraOnCenter,
	defaultCamera,
	drawWorld,
	fitImage,
	normRotation,
	sampleEdgeColor,
	screenToWorld,
	tokenDisc,
	worldCenter,
} from "./map-canvas.js";
import {
	coverFogAll,
	createFogMask,
	fillFogCircle,
	fillFogPolygon,
	fillFogRect,
	loadFogMask,
	paintFogBrush,
	saveFogMask,
	saveFogMaskAsync,
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
import {listCampaigns} from "./campaign-store.js";
import {createSceneToken, snapTokenCenter, tokenAtPoint, tokenRadius} from "./map-tokens.js";
import {openTokenPicker, tokenDragDoc} from "./map-token-picker.js";
import {
	absoluteToVault,
	addSceneLayer,
	copySceneToCampaign,
	createSceneFromImage,
	isSceneJson,
	layerAbsolute,
	readScene,
	writeScene,
} from "./map-scene.js";

const FOG_GM_ALPHA = 0.55;
const DEFAULT_BRUSH = 40;

const IMAGE_FILTERS = [
	{name: "Images", extensions: ["png", "jpg", "jpeg", "bmp", "webp"]},
	{name: "All Files", extensions: ["*"]},
];

export function defaultMapSession () {
	return {
		filePath: "",
		scenePath: "",
		activeLayerId: "",
		cellPx: 70,
		offsetX: 0,
		offsetY: 0,
		camera: defaultCamera(),
		lookAt: null,
		rotation: 0,
		showGrid: false,
		snapToGrid: false,
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
		plugin._syncPublicRollsBtn = null;
		plugin._mapTokenOff?.();
		plugin._mapTokenOff = null;
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
		rotation: normRotation(session?.rotation),
		viewLocked: session?.viewLocked ?? session?.zoomLocked ?? false,
		scaleLocked: !!session?.scaleLocked,
	};
	delete state.zoomLocked;
	if (state.viewLocked) state.scaleLocked = false;
	let image = null;
	let fog = null;
	let edgeColor = "#111";
	const lastDraw = plugin?._mapLastDraw;
	if (lastDraw?.image && lastDraw.gm?.filePath === state.filePath) {
		image = lastDraw.image;
		fog = lastDraw.fog || null;
		edgeColor = lastDraw.bgColor || edgeColor;
	}
	let tool = "pan";
	let fogMode = "reveal";
	let brushPx = DEFAULT_BRUSH;
	let fogStroke = null;
	let fogRect = null;
	let fogCircle = null;
	let fogPoly = null;
	let fogSaveTimer = 0;
	let sceneSaveTimer = 0;
	let raf = 0;
	let sceneDoc = null;
	let sceneVault = state.scenePath || "";
	const tokenBitmaps = new Map();
	if (plugin) {
		plugin._mapTokenOff = () => {
			for (const img of tokenBitmaps.values()) revokeImageUrl(img);
			tokenBitmaps.clear();
		};
	}

	const emit = () => {
		onSessionChange?.({
			...state,
			camera: {...state.camera},
			lookAt: state.lookAt ? {...state.lookAt} : null,
		});
		scheduleSceneSave();
	};

	const setLookAtFromView = () => {
		sizeCanvas();
		state.lookAt = worldCenter(state.camera, canvas.width, canvas.height);
	};

	formEl.createEl("h3", {text: "Battle map"});
	formEl.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Choose an image to save a scene in the vault maps folder. Add levels, then pan and zoom. Actual size prints one grid cell at the cell inches on the player screen.",
	});

	const fileRow = formEl.createDiv({cls: "fiveetools-map__row"});
	const pathEl = fileRow.createEl("span", {
		cls: "fiveetools-map__path",
		text: state.filePath ? path.basename(state.filePath) : "No file chosen",
		attr: {title: state.filePath || ""},
	});
	const browseBtn = fileRow.createEl("button", {text: "Browse", cls: "fiveetools-btn", attr: {type: "button"}});
	const layerRow = formEl.createDiv({cls: "fiveetools-map__row"});
	const prevLayerBtn = layerRow.createEl("button", {
		text: "Prev",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Previous level"},
	});
	const layerNameEl = layerRow.createEl("span", {cls: "fiveetools-map__path", text: "No layer"});
	const nextLayerBtn = layerRow.createEl("button", {
		text: "Next",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Next level"},
	});
	const addLayerBtn = layerRow.createEl("button", {
		text: "Add layer",
		cls: "fiveetools-btn",
		attr: {type: "button", title: "Add another level to this scene"},
	});
	const copyCampaignBtn = layerRow.createEl("button", {
		text: "Copy to campaign",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Copy this scene into a campaign Maps folder"},
	});
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
	const snapBtn = formEl.createEl("button", {
		text: state.snapToGrid ? "Snap on" : "Snap off",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: "Snap tokens to grid on place and drag end"},
	});

	const fitBtn = formEl.createEl("button", {text: "Fit map", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button"}});
	const rotateBtn = formEl.createEl("button", {
		text: "Rotate 90°",
		cls: "fiveetools-btn fiveetools-btn--ghost",
		attr: {type: "button", title: `Rotation ${state.rotation}°`},
	});
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

	const fogBox = formEl.createDiv({cls: "fiveetools-map__fog"});
	fogBox.createEl("h4", {text: "Fog", cls: "fiveetools-map__fog-title"});
	const fogToolRow = fogBox.createDiv({cls: "fiveetools-map__fog-row"});
	const toolPanBtn = fogToolRow.createEl("button", {text: "Pan", cls: "fiveetools-btn fiveetools-btn--ghost is-active", attr: {type: "button"}});
	const toolPencilBtn = fogToolRow.createEl("button", {text: "Pencil", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Brush fog or reveal"}});
	const toolRectBtn = fogToolRow.createEl("button", {text: "Rect", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Rectangle cover or reveal"}});
	const toolCircleBtn = fogToolRow.createEl("button", {text: "Circle", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Circle: click center, drag radius"}});
	const toolPolyBtn = fogToolRow.createEl("button", {text: "Poly", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Polygon: click points, double-click or Enter to close"}});
	const fogModeRow = fogBox.createDiv({cls: "fiveetools-map__fog-row"});
	const modeCoverBtn = fogModeRow.createEl("button", {text: "Cover", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Add fog"}});
	const modeRevealBtn = fogModeRow.createEl("button", {text: "Reveal", cls: "fiveetools-btn fiveetools-btn--ghost is-active", attr: {type: "button", title: "Remove fog"}});
	const fogBrushRow = fogBox.createDiv({cls: "fiveetools-map__fog-brush"});
	fogBrushRow.createEl("label", {text: "Brush"});
	const brushSlider = fogBrushRow.createEl("input", {
		cls: "fiveetools-map__fog-slider",
		attr: {type: "range", min: "4", max: "200", step: "1", value: String(brushPx)},
	});
	const brushValEl = fogBrushRow.createEl("span", {cls: "fiveetools-map__fog-brush-val", text: String(brushPx)});
	const fogActionRow = fogBox.createDiv({cls: "fiveetools-map__fog-row"});
	const coverAllBtn = fogActionRow.createEl("button", {text: "Cover all", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button"}});
	const saveStartBtn = fogActionRow.createEl("button", {text: "Save start", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Save current fog as reusable start state"}});
	const resetStartBtn = fogActionRow.createEl("button", {text: "Reset start", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button", title: "Restore fog from saved start state"}});

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
	const publicBtn = formEl.createEl("button", {
		text: plugin?.settings?.dicePublic ? "Public rolls on" : "Public rolls",
		cls: "fiveetools-btn",
		attr: {type: "button", title: "Show dice rolls on the player window"},
	});

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
		toolPencilBtn.classList.toggle("is-active", tool === "pencil");
		toolRectBtn.classList.toggle("is-active", tool === "rect");
		toolCircleBtn.classList.toggle("is-active", tool === "circle");
		toolPolyBtn.classList.toggle("is-active", tool === "poly");
		modeCoverBtn.classList.toggle("is-active", fogMode === "cover");
		modeRevealBtn.classList.toggle("is-active", fogMode === "reveal");
		canvas.classList.toggle("fiveetools-map__canvas--fog", tool !== "pan");
	};

	const commitPoly = () => {
		if (!fog || !fogPoly || fogPoly.length < 3) {
			fogPoly = null;
			schedule();
			return;
		}
		fillFogPolygon(fog, fogPoly, fogMode);
		fogPoly = null;
		queueFogSave();
		schedule();
	};

	const queueFogSave = () => {
		if (!fog || !activeLayer()) return;
		fog._rev = (fog._rev || 0) + 1;
		if (fogSaveTimer) clearTimeout(fogSaveTimer);
		fogSaveTimer = setTimeout(() => {
			fogSaveTimer = 0;
			flushFogSave();
		}, 500);
		if (plugin?._mapLastDraw) paintPlayer(plugin, plugin._mapLastDraw);
	};

	const sendPlayerFrame = () => {
		try {
			paintPlayer(plugin, {
				image,
				gm: state,
				gmView: {width: canvas.width, height: canvas.height},
				bgColor: edgeColor,
				fog,
				tokens: sceneDoc?.tokens || [],
				tokenImages: tokenBitmaps,
			});
		} catch (_) { /* player paint must not blank the GM canvas */ }
	};

	let selectedTokenId = null;

	const paint = (sendPlayer = true) => {
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
			rotation: state.rotation,
			tokens: sceneDoc?.tokens || [],
			tokenImages: tokenBitmaps,
		});
		if ((fogRect || fogCircle || fogPoly?.length) && fog) {
			const scale = state.camera.scale;
			applyWorldTransform(ctx, state.camera, state.rotation, canvas.width, canvas.height);
			ctx.strokeStyle = "rgba(255,220,80,0.9)";
			ctx.fillStyle = "rgba(255,220,80,0.15)";
			ctx.lineWidth = 2 / scale;
			if (fogRect) {
				const x = Math.min(fogRect.x0, fogRect.x1);
				const y = Math.min(fogRect.y0, fogRect.y1);
				const w = Math.abs(fogRect.x1 - fogRect.x0);
				const h = Math.abs(fogRect.y1 - fogRect.y0);
				ctx.strokeRect(x, y, w, h);
			}
			if (fogCircle && fogCircle.r > 0) {
				ctx.beginPath();
				ctx.arc(fogCircle.cx, fogCircle.cy, fogCircle.r, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			}
			if (fogPoly?.length) {
				ctx.beginPath();
				ctx.moveTo(fogPoly[0].x, fogPoly[0].y);
				for (let i = 1; i < fogPoly.length; i++) ctx.lineTo(fogPoly[i].x, fogPoly[i].y);
				ctx.stroke();
				if (fogPoly.length >= 3) {
					ctx.closePath();
					ctx.fill();
				}
				for (const p of fogPoly) {
					ctx.beginPath();
					ctx.arc(p.x, p.y, 4 / scale, 0, Math.PI * 2);
					ctx.fillStyle = "rgba(255,220,80,0.95)";
					ctx.fill();
				}
			}
			ctx.setTransform(1, 0, 0, 1, 0, 0);
		}
		const selected = (sceneDoc?.tokens || []).find(token => token.id === selectedTokenId);
		if (selected) {
			const radius = tokenRadius(selected, state.cellPx);
			applyWorldTransform(ctx, state.camera, state.rotation, canvas.width, canvas.height);
			ctx.beginPath();
			ctx.arc(Number(selected.x) || 0, Number(selected.y) || 0, radius, 0, Math.PI * 2);
			ctx.strokeStyle = "rgba(255,220,80,0.95)";
			ctx.lineWidth = 3 / (Number(state.camera.scale) || 1);
			ctx.stroke();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
		}
		if (sendPlayer) sendPlayerFrame();
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
		syncLayerUi();
		const layer = activeLayer();
		const label = sceneDoc?.name
			? (layer?.name && sceneDoc.layers.length > 1 ? `${sceneDoc.name} — ${layer.name}` : sceneDoc.name)
			: (state.filePath ? path.basename(state.filePath) : "No file chosen");
		pathEl.setText(label);
		pathEl.setAttribute("title", sceneVault || state.filePath || "");
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

	let rightPanMoved = false;
	let gestured = false;
	let pointerDown = false;
	let wheelTimer = 0;
	const finishGesture = () => {
		if (wheelTimer) {
			clearTimeout(wheelTimer);
			wheelTimer = 0;
		}
		if (!gestured) return;
		gestured = false;
		if (raf) {
			cancelAnimationFrame(raf);
			raf = 0;
		}
		emit();
		paint();
	};
	const armWheelEnd = () => {
		if (pointerDown) return;
		if (wheelTimer) clearTimeout(wheelTimer);
		wheelTimer = setTimeout(() => {
			wheelTimer = 0;
			finishGesture();
		}, 80);
	};
	let tokenDrag = null;
	const tokenUnderEvent = (evt) => {
		if (!sceneDoc?.tokens?.length) return null;
		const pt = screenToWorld(state.camera, canvas, evt.clientX, evt.clientY, state.rotation);
		return tokenAtPoint(sceneDoc.tokens, pt, state.cellPx);
	};
	bindMapPointer(
		canvas,
		() => state.camera,
		(cam) => { state.camera = cam; },
		(reason, cam, prev) => {
			if ((reason === "pan" || reason === "zoom") && prev) {
				if (reason === "pan" && !state.viewLocked) {
					if (!state.lookAt) state.lookAt = worldCenter(prev, canvas.width, canvas.height);
					state.lookAt = {
						x: state.lookAt.x + (cam.x - prev.x),
						y: state.lookAt.y + (cam.y - prev.y),
					};
				}
				gestured = true;
				if (reason === "zoom") armWheelEnd();
				schedule();
				return;
			}
			emit();
			schedule();
		},
		() => true,
		(evt) => {
			if (evt.button === 0 && tokenUnderEvent(evt)) return false;
			return tool === "pan" ? evt.button === 0 : evt.button === 2;
		},
		({moved, button}, evt) => {
			if (button === 2) rightPanMoved = !!moved;
			const type = evt?.type;
			if (type === "pointerdown") {
				pointerDown = true;
				if (wheelTimer) {
					clearTimeout(wheelTimer);
					wheelTimer = 0;
				}
				return;
			}
			if (type === "pointerup" || type === "pointercancel") {
				pointerDown = false;
				finishGesture();
			}
		},
		() => state.rotation,
	);

	canvas.addEventListener("pointerdown", (evt) => {
		if (evt.button !== 2) rightPanMoved = false;
		if (evt.button !== 0) return;
		const token = tokenUnderEvent(evt);
		if (!token) {
			if (selectedTokenId) {
				selectedTokenId = null;
				schedule();
			}
			return;
		}
		const pt = screenToWorld(state.camera, canvas, evt.clientX, evt.clientY, state.rotation);
		selectedTokenId = token.id;
		tokenDrag = {
			id: token.id,
			dx: (Number(token.x) || 0) - pt.x,
			dy: (Number(token.y) || 0) - pt.y,
			pointerId: evt.pointerId,
		};
		canvas.setPointerCapture(evt.pointerId);
		schedule();
	});
	canvas.addEventListener("pointermove", (evt) => {
		if (!tokenDrag || evt.pointerId !== tokenDrag.pointerId) return;
		const token = sceneDoc?.tokens?.find(item => item.id === tokenDrag.id);
		if (!token) return;
		const pt = screenToWorld(state.camera, canvas, evt.clientX, evt.clientY, state.rotation);
		token.x = pt.x + tokenDrag.dx;
		token.y = pt.y + tokenDrag.dy;
		schedule();
	});
	const endTokenDrag = (evt) => {
		if (!tokenDrag || evt.pointerId !== tokenDrag.pointerId) return;
		const token = sceneDoc?.tokens?.find(item => item.id === tokenDrag.id);
		tokenDrag = null;
		if (!token) return;
		if (state.snapToGrid) {
			const snapped = snapTokenCenter(token, token.cells, state.cellPx, state.offsetX, state.offsetY);
			token.x = snapped.x;
			token.y = snapped.y;
		}
		scheduleSceneSave();
		schedule();
	};
	canvas.addEventListener("pointerup", endTokenDrag);
	canvas.addEventListener("pointercancel", endTokenDrag);
	canvas.addEventListener("dragover", (evt) => {
		const types = evt.dataTransfer?.types ? [...evt.dataTransfer.types] : [];
		if (!types.includes("text/plain")) return;
		evt.preventDefault();
		if (evt.dataTransfer) evt.dataTransfer.dropEffect = "copy";
	});
	canvas.addEventListener("drop", (evt) => {
		const doc = tokenDragDoc(evt.dataTransfer);
		if (!doc) return;
		evt.preventDefault();
		const at = screenToWorld(state.camera, canvas, evt.clientX, evt.clientY, state.rotation);
		void placeToken(doc, at);
	});

	canvas.addEventListener("pointerdown", (evt) => {
		if (evt.button !== 0 || tool === "pan" || !fog || !image) return;
		if (tokenUnderEvent(evt)) return;
		const pt = screenToWorld(state.camera, canvas, evt.clientX, evt.clientY, state.rotation);
		if (tool === "poly") {
			if (!fogPoly) fogPoly = [];
			fogPoly.push({x: pt.x, y: pt.y});
			schedule();
			return;
		}
		canvas.setPointerCapture(evt.pointerId);
		if (tool === "rect") {
			fogRect = {x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y};
			schedule();
			return;
		}
		if (tool === "circle") {
			fogCircle = {cx: pt.x, cy: pt.y, r: 0};
			schedule();
			return;
		}
		if (tool === "pencil") {
			fogStroke = {x: pt.x, y: pt.y};
			paintFogBrush(fog, pt.x, pt.y, brushPx, fogMode);
			schedule();
		}
	});
	canvas.addEventListener("pointermove", (evt) => {
		if (fogRect) {
			const pt = screenToWorld(state.camera, canvas, evt.clientX, evt.clientY, state.rotation);
			fogRect.x1 = pt.x;
			fogRect.y1 = pt.y;
			schedule();
			return;
		}
		if (fogCircle) {
			const pt = screenToWorld(state.camera, canvas, evt.clientX, evt.clientY, state.rotation);
			fogCircle.r = Math.hypot(pt.x - fogCircle.cx, pt.y - fogCircle.cy);
			schedule();
			return;
		}
		if (!fogStroke || !fog || tool !== "pencil") return;
		const pt = screenToWorld(state.camera, canvas, evt.clientX, evt.clientY, state.rotation);
		strokeFogBrush(fog, fogStroke.x, fogStroke.y, pt.x, pt.y, brushPx, fogMode);
		fogStroke.x = pt.x;
		fogStroke.y = pt.y;
		schedule();
	});
	const endFogPointer = () => {
		if (fogRect && fog) {
			const x = Math.min(fogRect.x0, fogRect.x1);
			const y = Math.min(fogRect.y0, fogRect.y1);
			const w = Math.abs(fogRect.x1 - fogRect.x0);
			const h = Math.abs(fogRect.y1 - fogRect.y0);
			if (w > 1 && h > 1) fillFogRect(fog, x, y, w, h, fogMode);
			fogRect = null;
			queueFogSave();
			schedule();
			return;
		}
		if (fogCircle && fog) {
			if (fogCircle.r > 1) fillFogCircle(fog, fogCircle.cx, fogCircle.cy, fogCircle.r, fogMode);
			fogCircle = null;
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
	canvas.addEventListener("dblclick", (evt) => {
		if (tool !== "poly" || !fogPoly) return;
		evt.preventDefault();
		if (fogPoly.length) fogPoly.pop();
		commitPoly();
	});

	const setTool = (next) => {
		tool = next;
		fogStroke = null;
		fogRect = null;
		fogCircle = null;
		fogPoly = null;
		syncToolUi();
		schedule();
	};

	const onFogKey = (evt) => {
		if (tool !== "poly" || !fogPoly) return;
		if (evt.key === "Enter") {
			evt.preventDefault();
			commitPoly();
		} else if (evt.key === "Escape") {
			evt.preventDefault();
			fogPoly = null;
			schedule();
		}
	};
	const fogKeyWin = canvas.win || window;
	fogKeyWin.addEventListener("keydown", onFogKey);

	function activeLayer () {
		const layers = sceneDoc?.layers || [];
		return layers.find(it => it.id === state.activeLayerId) || layers[0] || null;
	}

	function layerFile (rel) {
		return layerAbsolute(plugin, sceneVault, rel);
	}

	function syncLayerUi () {
		const layers = sceneDoc?.layers || [];
		const index = layers.findIndex(it => it.id === state.activeLayerId);
		const layer = index >= 0 ? layers[index] : null;
		layerNameEl.setText(layer ? `${index + 1}/${layers.length} ${layer.name}` : "No layer");
	}

	function captureLayer () {
		const layer = activeLayer();
		if (!layer || !sceneDoc) return;
		sceneDoc.camera = {...state.camera};
		sceneDoc.lookAt = state.lookAt ? {...state.lookAt} : null;
		sceneDoc.rotation = state.rotation;
		sceneDoc.activeLayerId = layer.id;
		sceneDoc.cellInches = state.cellInches;
		sceneDoc.diagonalInches = state.diagonalInches;
		sceneDoc.viewLocked = state.viewLocked;
		sceneDoc.scaleLocked = state.scaleLocked;
		sceneDoc.playerScale = state.playerScale;
		sceneDoc.actualSize = state.actualSize;
		sceneDoc.snapToGrid = state.snapToGrid;
		layer.mapDpi = state.mapDpi ?? null;
		layer.paperWidthInches = state.paperWidthInches ?? null;
		layer.paperHeightInches = state.paperHeightInches ?? null;
		layer.cellPx = state.cellPx;
		layer.showGrid = !!state.showGrid;
		layer.offsetX = state.offsetX || 0;
		layer.offsetY = state.offsetY || 0;
		if (!Array.isArray(sceneDoc.tokens)) sceneDoc.tokens = [];
	}

	function scheduleSceneSave () {
		if (!sceneDoc || !sceneVault) return;
		if (sceneSaveTimer) clearTimeout(sceneSaveTimer);
		sceneSaveTimer = setTimeout(() => {
			sceneSaveTimer = 0;
			void persistScene();
		}, 400);
	}

	async function persistScene () {
		if (!sceneDoc || !sceneVault) return;
		captureLayer();
		try {
			await writeScene(plugin, sceneVault, sceneDoc);
		} catch (e) {
			new Notice(e.message || "Could not save the scene.");
		}
	}

	function flushFogSave () {
		if (fogSaveTimer) {
			clearTimeout(fogSaveTimer);
			fogSaveTimer = 0;
		}
		const live = layerFile(activeLayer()?.fogLive);
		if (!live || !fog) return;
		if (!saveFogMask(live, fog)) new Notice("Could not save live fog.");
	}

	function applySceneSettings () {
		if (!sceneDoc) return;
		if (sceneDoc.cellInches) state.cellInches = sceneDoc.cellInches;
		if (sceneDoc.diagonalInches) state.diagonalInches = sceneDoc.diagonalInches;
		state.viewLocked = !!sceneDoc.viewLocked;
		state.scaleLocked = !!sceneDoc.scaleLocked;
		state.playerScale = sceneDoc.playerScale ?? null;
		state.actualSize = !!sceneDoc.actualSize;
		state.snapToGrid = !!sceneDoc.snapToGrid;
		if (state.viewLocked) state.scaleLocked = false;
	}

	async function showLayer (layer, {fit = false, keepSessionView = false} = {}) {
		if (!layer) return;
		state.activeLayerId = layer.id;
		if (sceneDoc) sceneDoc.activeLayerId = layer.id;
		const imageAbs = layerFile(layer.image);
		const prev = state.filePath;
		state.filePath = imageAbs;
		state.scenePath = sceneVault;
		revokeImageUrl(image);
		image = await loadMapImage(app, imageAbs);
		if (!image) {
			edgeColor = "#111";
			fog = null;
			new Notice("Could not load that layer.");
			syncLayerUi();
			syncPaperUi();
			schedule();
			return;
		}
		if (layer.edgeColor) edgeColor = layer.edgeColor;
		else {
			edgeColor = sampleEdgeColor(image);
			layer.edgeColor = edgeColor;
		}
		fog = await loadFogMask(layerFile(layer.fogLive), image.width, image.height)
			|| await loadFogMask(layerFile(layer.fogStart), image.width, image.height)
			|| createFogMask(image.width, image.height);
		sizeCanvas();
		if (!keepSessionView && fit) {
			state.rotation = normRotation(layer.rotation || 0);
			state.camera = fitImage(image, canvas.width, canvas.height, state.rotation);
			setLookAtFromView();
		} else if (!keepSessionView) {
			state.camera = {...defaultCamera(), ...layer.camera};
			state.lookAt = layer.lookAt ? {...layer.lookAt} : null;
			state.rotation = normRotation(layer.rotation);
		}
		state.offsetX = layer.offsetX || 0;
		state.offsetY = layer.offsetY || 0;
		state.showGrid = !!layer.showGrid;
		state.cellPx = layer.cellPx || (fit ? 70 : state.cellPx);
		state.mapDpi = layer.mapDpi ?? null;
		state.paperWidthInches = layer.paperWidthInches ?? null;
		state.paperHeightInches = layer.paperHeightInches ?? null;
		if (fit && !state.mapDpi) {
			const found = await detectMapImageDpi(app, imageAbs);
			if (found) applyDpi(found);
			else if (prev !== imageAbs) {
				state.mapDpi = null;
				state.paperWidthInches = null;
				state.paperHeightInches = null;
			}
		}
		if (fit && layer.showGrid && layer.cellPx) {
			state.cellPx = Math.max(8, Math.round(layer.cellPx));
			state.showGrid = true;
		}
		gridBtn.setText(state.showGrid ? "Grid on" : "Grid off");
		snapBtn.setText(state.snapToGrid ? "Snap on" : "Snap off");
		rotateBtn.setAttribute("title", `Rotation ${state.rotation}°`);
		syncFreezeButtons();
		actualBtn.setText(state.actualSize ? "Actual size on" : "Actual size off");
		inchEl.value = String(state.cellInches);
		diagEl.value = String(state.diagonalInches);
		cellEl.value = String(state.cellPx);
		syncLayerUi();
		syncPaperUi();
		emit();
		schedule();
	}

	async function placeToken (doc, world) {
		if (!sceneDoc || !sceneVault || !doc) {
			new Notice("Open a map scene first.");
			return;
		}
		try {
			const token = await createSceneToken(plugin, sceneVault, {
				doc,
				world,
				cellPx: state.cellPx,
				offsetX: state.offsetX,
				offsetY: state.offsetY,
				snapToGrid: state.snapToGrid,
			});
			if (!Array.isArray(sceneDoc.tokens)) sceneDoc.tokens = [];
			sceneDoc.tokens.push(token);
			scheduleSceneSave();
			const img = await loadMapImage(app, layerFile(token.image));
			if (img) tokenBitmaps.set(token.id, img);
			schedule();
			new Notice(`Placed ${token.name}.`);
		} catch (e) {
			new Notice(e.message || "Could not place that token.");
		}
	}

	async function ensureTokenImages () {
		const tokens = sceneDoc?.tokens || [];
		const ids = new Set(tokens.map(token => token.id));
		for (const id of [...tokenBitmaps.keys()]) {
			if (ids.has(id)) continue;
			revokeImageUrl(tokenBitmaps.get(id));
			tokenBitmaps.delete(id);
		}
		await Promise.all(tokens.map(async (token) => {
			if (!token?.id || tokenBitmaps.has(token.id)) return;
			const img = await loadMapImage(app, layerFile(token.image));
			if (img) tokenBitmaps.set(token.id, img);
		}));
		schedule();
	}

	async function openScene (vaultPath, {fromSession = false, reusePixels = false, fit = false} = {}) {
		const loaded = await readScene(plugin, vaultPath);
		if (!loaded) {
			new Notice("Could not open that scene.");
			return;
		}
		sceneDoc = loaded.scene;
		sceneVault = loaded.scenePath;
		state.scenePath = sceneVault;
		if (!fromSession) applySceneSettings();
		const preferred = fromSession && state.activeLayerId ? state.activeLayerId : sceneDoc.activeLayerId;
		const layer = sceneDoc.layers.find(it => it.id === preferred) || sceneDoc.layers[0];
		if (!layer) {
			void ensureTokenImages();
			return;
		}
		if (reusePixels && image) {
			state.activeLayerId = layer.id;
			sceneDoc.activeLayerId = layer.id;
			state.filePath = layerFile(layer.image) || state.filePath;
			if (!fog) {
				fog = await loadFogMask(layerFile(layer.fogLive), image.width, image.height)
					|| await loadFogMask(layerFile(layer.fogStart), image.width, image.height)
					|| createFogMask(image.width, image.height);
			}
			syncLayerUi();
			syncPaperUi();
			emit();
			paint();
			void ensureTokenImages();
			return;
		}
		if (fromSession && !fit) {
			await showLayer(layer, {keepSessionView: true});
			void ensureTokenImages();
			return;
		}
		if (!fit && (applySceneView() || applyLegacyLayerView(layer))) {
			await showLayer(layer, {keepSessionView: true});
			void ensureTokenImages();
			return;
		}
		await showLayer(layer, {fit: true});
		void ensureTokenImages();
	}

	function applySceneView () {
		const cam = sceneDoc?.camera;
		if (!cam || !(Number(cam.scale) > 0)) return false;
		state.camera = {...defaultCamera(), ...cam};
		state.lookAt = sceneDoc.lookAt ? {...sceneDoc.lookAt} : null;
		state.rotation = normRotation(sceneDoc.rotation || 0);
		return true;
	}

	function applyLegacyLayerView (layer) {
		const cam = layer?.camera;
		if (!cam) return false;
		const moved = layer.lookAt || cam.x || cam.y || (Number(cam.scale) > 0 && cam.scale !== 1);
		if (!moved) return false;
		state.camera = {...defaultCamera(), ...cam};
		state.lookAt = layer.lookAt ? {...layer.lookAt} : null;
		state.rotation = normRotation(layer.rotation || 0);
		return true;
	}

	async function adoptFile (filePath, {fromSession = false} = {}) {
		try {
			if (isSceneJson(filePath)) {
				const folder = absoluteToVault(plugin, path.dirname(filePath));
				if (!folder) throw new Error("Choose a scene saved in the vault.");
				await openScene(folder, {fromSession, reusePixels: fromSession && !!image, fit: !fromSession});
				return;
			}
			const created = await createSceneFromImage(plugin, filePath);
			await openScene(created.scenePath, {
				fromSession,
				reusePixels: fromSession && !!image,
				fit: !fromSession,
			});
			new Notice(`Saved scene ${created.scene.name}.`);
		} catch (e) {
			new Notice(e.message || "Could not save that map as a scene.");
		}
	}

	async function switchLayer (id) {
		const layer = sceneDoc?.layers?.find(it => it.id === id);
		if (!layer || layer.id === state.activeLayerId) return;
		const mask = fog;
		const live = layerFile(activeLayer()?.fogLive);
		if (fogSaveTimer) {
			clearTimeout(fogSaveTimer);
			fogSaveTimer = 0;
		}
		void saveFogMaskAsync(live, mask);
		captureLayer();
		fogStroke = null;
		fogRect = null;
		fogCircle = null;
		fogPoly = null;
		await showLayer(layer, {keepSessionView: true});
	}

	function stepLayer (delta) {
		const layers = sceneDoc?.layers || [];
		if (layers.length < 2) return;
		const index = layers.findIndex(it => it.id === state.activeLayerId);
		const next = layers[(Math.max(0, index) + delta + layers.length) % layers.length];
		void switchLayer(next.id);
	}

	browseBtn.addEventListener("click", () => {
		const picked = pickMapFile(state.filePath);
		if (picked == null) return;
		if (!picked) {
			new Notice("File picker needs the Obsidian desktop app.");
			return;
		}
		void adoptFile(picked);
	});
	prevLayerBtn.addEventListener("click", () => stepLayer(-1));
	nextLayerBtn.addEventListener("click", () => stepLayer(1));
	addLayerBtn.addEventListener("click", () => {
		if (!sceneVault || !sceneDoc) {
			new Notice("Open a map before adding a layer.");
			return;
		}
		const picked = pickMapFile("");
		if (picked == null) return;
		if (!picked) {
			new Notice("File picker needs the Obsidian desktop app.");
			return;
		}
		void (async () => {
			try {
				flushFogSave();
				captureLayer();
				const layer = await addSceneLayer(plugin, sceneVault, sceneDoc, picked);
				await showLayer(layer, {fit: true});
			} catch (e) {
				new Notice(e.message || "Could not add that layer.");
			}
		})();
	});
	copyCampaignBtn.addEventListener("click", async (evt) => {
		if (!sceneVault || !sceneDoc) {
			new Notice("Open a map before copying it.");
			return;
		}
		let campaigns = [];
		try {
			campaigns = await listCampaigns(plugin);
		} catch (e) {
			new Notice(e.message || "Could not list campaigns.");
			return;
		}
		if (!campaigns.length) {
			new Notice("Create a campaign first.");
			return;
		}
		const menu = new Menu();
		for (const campaign of campaigns) {
			menu.addItem((item) => {
				item.setTitle(campaign.name).onClick(async () => {
					try {
						flushFogSave();
						await persistScene();
						await copySceneToCampaign(plugin, sceneVault, campaign.slug);
						new Notice(`Copied to ${campaign.name}.`);
					} catch (e) {
						new Notice(e.message || "Could not copy the scene.");
					}
				});
			});
		}
		menu.showAtMouseEvent(evt);
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
	snapBtn.addEventListener("click", () => {
		state.snapToGrid = !state.snapToGrid;
		snapBtn.setText(state.snapToGrid ? "Snap on" : "Snap off");
		emit();
		schedule();
	});
	fitBtn.addEventListener("click", () => {
		if (!image) return;
		sizeCanvas();
		state.camera = fitImage(image, canvas.width, canvas.height, state.rotation);
		if (!state.viewLocked) setLookAtFromView();
		emit();
		schedule();
	});
	rotateBtn.addEventListener("click", () => {
		state.rotation = normRotation(state.rotation + 90);
		rotateBtn.setAttribute("title", `Rotation ${state.rotation}°`);
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
	toolPencilBtn.addEventListener("click", () => setTool("pencil"));
	toolRectBtn.addEventListener("click", () => setTool("rect"));
	toolCircleBtn.addEventListener("click", () => setTool("circle"));
	toolPolyBtn.addEventListener("click", () => setTool("poly"));
	modeCoverBtn.addEventListener("click", () => {
		fogMode = "cover";
		syncToolUi();
	});
	modeRevealBtn.addEventListener("click", () => {
		fogMode = "reveal";
		syncToolUi();
	});
	const syncBrush = () => {
		brushPx = Math.max(4, Math.min(200, Number(brushSlider.value) || DEFAULT_BRUSH));
		brushSlider.value = String(brushPx);
		brushValEl.setText(String(brushPx));
	};
	brushSlider.addEventListener("input", syncBrush);
	coverAllBtn.addEventListener("click", () => {
		if (!fog) return;
		coverFogAll(fog);
		queueFogSave();
		schedule();
	});
	saveStartBtn.addEventListener("click", () => {
		const start = layerFile(activeLayer()?.fogStart);
		if (!fog || !start) {
			new Notice("Load a map before saving fog start.");
			return;
		}
		if (saveFogMask(start, fog)) new Notice("Fog start state saved.");
		else new Notice("Could not save fog start state.");
	});
	resetStartBtn.addEventListener("click", async () => {
		const start = layerFile(activeLayer()?.fogStart);
		if (!image || !start) return;
		const loaded = await loadFogMask(start, image.width, image.height);
		fog = loaded || createFogMask(image.width, image.height);
		queueFogSave();
		schedule();
		new Notice(loaded ? "Fog reset to start state." : "No start state; fog cleared.");
	});
	canvas.addEventListener("contextmenu", (evt) => {
		evt.preventDefault();
		if (rightPanMoved) {
			rightPanMoved = false;
			return;
		}
		const at = screenToWorld(state.camera, canvas, evt.clientX, evt.clientY, state.rotation);
		const menu = new Menu();
		if (sceneDoc && image) {
			menu.addItem((item) => {
				item.setTitle("Insert token");
				item.onClick(() => {
					openTokenPicker(app, plugin, {onPlace: (doc) => void placeToken(doc, at)});
				});
			});
		}
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
		menu.addItem((item) => {
			item
				.setTitle(state.snapToGrid ? "Snap off" : "Snap on")
				.onClick(() => {
					state.snapToGrid = !state.snapToGrid;
					snapBtn.setText(state.snapToGrid ? "Snap on" : "Snap off");
					emit();
					schedule();
				});
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
	playerBtn.addEventListener("click", (evt) => {
		castPlayerWindow(plugin, {
			anchorEl: playerBtn,
			mouseEvent: evt,
			onReady: () => {
				state.actualSize = true;
				actualBtn.setText("Actual size on");
				setLookAtFromView();
				emit();
				schedule();
			},
		});
	});
	const syncPublicBtn = () => {
		publicBtn.setText(plugin?.settings?.dicePublic ? "Public rolls on" : "Public rolls");
	};
	publicBtn.addEventListener("click", async () => {
		if (!plugin) return;
		plugin.settings.dicePublic = !plugin.settings.dicePublic;
		await plugin.saveSettings();
		syncPublicBtn();
	});
	if (plugin) plugin._syncPublicRollsBtn = syncPublicBtn;

	const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => schedule()) : null;
	ro?.observe(resultEl);
	if (plugin) {
		plugin._mapResizeOff = () => {
			fogKeyWin.removeEventListener("keydown", onFogKey);
			ro?.disconnect();
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
			flushFogSave();
			if (sceneSaveTimer) clearTimeout(sceneSaveTimer);
			sceneSaveTimer = 0;
			if (wheelTimer) clearTimeout(wheelTimer);
			wheelTimer = 0;
			gestured = false;
			void persistScene();
		};
	}

	sizeCanvas();
	syncPaperUi();
	syncToolUi();
	if (state.scenePath && image) {
		paint();
		void openScene(state.scenePath, {fromSession: true, reusePixels: true});
	} else if (state.scenePath) {
		void openScene(state.scenePath, {fromSession: !!state.filePath});
	} else if (state.filePath) {
		void adoptFile(state.filePath, {fromSession: true});
	} else schedule();
}

function pickMapFile (defaultPath) {
	const dialog = window.electron?.remote?.dialog;
	if (typeof dialog?.showOpenDialogSync !== "function") return "";
	const opts = {
		title: "Choose battle map",
		properties: ["openFile", "dontAddToRecent"],
		filters: IMAGE_FILTERS,
	};
	try {
		if (defaultPath && path.isAbsolute(defaultPath)) opts.defaultPath = defaultPath;
	} catch (_) { /* dialog still opens when path is unavailable */ }
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
	const canvas = win.document.createElement("canvas");
	canvas.className = "fiveetools-map-player__frame";
	win.document.body.appendChild(canvas);
	view.frame = canvas;
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

export function mapPlayerDocument (plugin) {
	const win = playerView(plugin)?.contentEl?.win;
	if (!isPopoutWin(win)) return null;
	return win.document || null;
}

function electronRemote () {
	return window.electron?.remote || null;
}

function listDisplays () {
	try {
		const displays = electronRemote()?.screen?.getAllDisplays?.();
		return Array.isArray(displays) ? displays : [];
	} catch (_) {
		return [];
	}
}

function primaryDisplay () {
	try {
		return electronRemote()?.screen?.getPrimaryDisplay?.() || listDisplays()[0] || null;
	} catch (_) {
		return listDisplays()[0] || null;
	}
}

function browserWindowFor (win) {
	if (!win) return null;
	try {
		if (typeof win.electron?.remote?.getCurrentWindow === "function") {
			return win.electron.remote.getCurrentWindow();
		}
	} catch (_) { /* ignore */ }
	try {
		const req = win.require || window.require;
		const remote = req?.("electron")?.remote;
		if (typeof remote?.getCurrentWindow === "function") return remote.getCurrentWindow();
	} catch (_) { /* ignore */ }
	return null;
}

function placePopoutOnDisplay (win, display) {
	if (!win || !display) return;
	const bw = browserWindowFor(win);
	if (!bw) return;
	try {
		const area = display.workArea || display.bounds;
		if (area && typeof bw.setBounds === "function") {
			bw.setBounds({
				x: area.x | 0,
				y: area.y | 0,
				width: Math.max(200, area.width | 0),
				height: Math.max(200, area.height | 0),
			});
		} else if (area && typeof bw.setPosition === "function") {
			bw.setPosition(area.x | 0, area.y | 0);
		}
		if (typeof bw.maximize === "function") bw.maximize();
	} catch (_) { /* ignore */ }
}

function displayLabel (display, index, primary) {
	const size = display?.size || display?.bounds || {};
	const w = size.width || display?.workAreaSize?.width || "?";
	const h = size.height || display?.workAreaSize?.height || "?";
	const tags = [];
	if (primary && display?.id === primary.id) tags.push("primary");
	if (display?.internal) tags.push("built-in");
	const suffix = tags.length ? ` (${tags.join(", ")})` : "";
	return `Screen ${index + 1} — ${w}×${h}${suffix}`;
}

async function openPlayerWindow (plugin, {display = null} = {}) {
	const workspace = plugin.app?.workspace;
	if (typeof workspace?.openPopoutLeaf !== "function") {
		new Notice("Player window needs the Obsidian desktop app.");
		return;
	}
	const target = display || primaryDisplay();
	const area = target?.workAreaSize || target?.size;
	try {
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_FIVEETOOLS_MAP_PLAYER)[0];
		if (!leaf) {
			const size = area
				? {width: Math.max(800, area.width | 0), height: Math.max(600, area.height | 0)}
				: {width: 1280, height: 720};
			leaf = workspace.openPopoutLeaf({size});
			await leaf.setViewState({
				type: VIEW_TYPE_FIVEETOOLS_MAP_PLAYER,
				active: true,
			});
		}
		workspace.revealLeaf(leaf);
		const view = leaf.view;
		if (view?.getViewType?.() === VIEW_TYPE_FIVEETOOLS_MAP_PLAYER) {
			markPlayerWindow(view, true);
			const win = view.contentEl?.win;
			if (target && isPopoutWin(win)) {
				requestAnimationFrame(() => placePopoutOnDisplay(win, target));
			}
		}
	} catch (e) {
		new Notice(e.message || "Could not open player window.");
	}
}

function castPlayerWindow (plugin, {anchorEl, mouseEvent, onReady} = {}) {
	const displays = listDisplays();
	const primary = primaryDisplay();
	const finish = async (display) => {
		await openPlayerWindow(plugin, {display});
		onReady?.();
	};
	if (displays.length <= 1) {
		void finish(displays[0] || primary);
		return;
	}
	const menu = new Menu();
	displays.forEach((display, index) => {
		menu.addItem((item) => {
			item
				.setTitle(displayLabel(display, index, primary))
				.onClick(() => { void finish(display); });
		});
	});
	if (mouseEvent) menu.showAtMouseEvent(mouseEvent);
	else if (anchorEl) {
		const r = anchorEl.getBoundingClientRect();
		menu.showAtPosition({x: r.left, y: r.bottom});
	} else {
		void finish(primary);
	}
}

function closePlayerWindow (plugin) {
	const leaves = plugin.app?.workspace?.getLeavesOfType?.(VIEW_TYPE_FIVEETOOLS_MAP_PLAYER) || [];
	for (const leaf of leaves) {
		try { leaf.detach(); } catch (_) { /* ignore */ }
	}
	document.body.classList.remove("fiveetools-map-player-window");
	dropPlayerBitmaps(plugin);
}

function closeBitmap (bitmap) {
	try { bitmap?.close?.(); } catch (_) { /* already closed */ }
}

function dropPlayerBitmaps (plugin) {
	if (!plugin) return;
	closeBitmap(plugin._mapBitmap);
	closeBitmap(plugin._mapFogBitmap);
	plugin._mapBitmap = null;
	plugin._mapFogBitmap = null;
	plugin._mapBitmapSrc = null;
	plugin._mapFogSrc = null;
	plugin._mapFogRev = null;
	plugin._mapBitmapTicket = (plugin._mapBitmapTicket || 0) + 1;
	plugin._mapFogTicket = (plugin._mapFogTicket || 0) + 1;
	if (plugin._mapTokenBitmaps) {
		for (const entry of plugin._mapTokenBitmaps.values()) closeBitmap(entry?.bitmap);
		plugin._mapTokenBitmaps.clear();
	}
	plugin._mapBlit = null;
	plugin._mapPlayerEncode = false;
	plugin._mapPlayerDirty = false;
	if (plugin._mapPlayerUrl) URL.revokeObjectURL(plugin._mapPlayerUrl);
	plugin._mapPlayerUrl = "";
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
	const view = playerView(plugin);
	const frame = view?.frame;
	if (!draw?.image && plugin?._mapLastDraw?.image) return;
	if (!plugin) return;
	plugin._mapLastDraw = draw;
	if (!frame || frame.tagName !== "CANVAS") return;
	const ctx = frame.getContext("2d");
	if (!ctx) return;
	ensurePlayerBitmaps(plugin, draw);
	const win = view.contentEl.win;
	const width = Math.max(1, win?.innerWidth || 800);
	const height = Math.max(1, win?.innerHeight || 600);
	if (frame.width !== width || frame.height !== height) {
		frame.width = width;
		frame.height = height;
	}
	const {image: mapBitmap, fog: fogBitmap, discs} = playerSources(plugin);
	const {gm, gmView, bgColor, tokens} = draw;
	const {center, scale} = resolvePlayerView(gm, gmView, plugin);
	plugin._mapPlayerView = {center: {x: center.x, y: center.y}, scale};
	try {
		drawWorld(ctx, {
			image: mapBitmap,
			camera: cameraOnCenter(center, width, height, scale),
			cellPx: gm.cellPx,
			offsetX: gm.offsetX,
			offsetY: gm.offsetY,
			showGrid: gm.showGrid,
			width,
			height,
			bgColor,
			fog: fogBitmap,
			fogAlpha: 1,
			rotation: gm.rotation,
			tokens,
			tokenImages: discs,
		});
	} catch (e) {
		warnPlayerBlit(plugin, e);
	}
}

function playerSources (plugin) {
	const discs = new Map();
	for (const [id, entry] of plugin._mapTokenBitmaps || []) {
		if (entry?.bitmap) discs.set(id, entry.bitmap);
	}
	return {image: plugin._mapBitmap || null, fog: plugin._mapFogBitmap || null, discs};
}

function ensurePlayerBitmaps (plugin, draw) {
	ensureMapBitmap(plugin, draw.image);
	ensureFogBitmap(plugin, draw.fog);
	ensureTokenBitmaps(plugin, draw.tokens, draw.tokenImages, draw.gm?.cellPx);
}

function ensureMapBitmap (plugin, image) {
	if (!image || plugin._mapBitmapSrc === image) return;
	plugin._mapBitmapSrc = image;
	const ticket = (plugin._mapBitmapTicket || 0) + 1;
	plugin._mapBitmapTicket = ticket;
	createImageBitmap(image).then((bmp) => {
		if (plugin._mapBitmapTicket !== ticket) {
			closeBitmap(bmp);
			return;
		}
		closeBitmap(plugin._mapBitmap);
		plugin._mapBitmap = bmp;
		if (plugin._mapLastDraw) paintPlayer(plugin, plugin._mapLastDraw);
	}).catch((e) => warnPlayerBlit(plugin, e));
}

function ensureFogBitmap (plugin, fog) {
	if (!fog) {
		closeBitmap(plugin._mapFogBitmap);
		plugin._mapFogBitmap = null;
		plugin._mapFogSrc = null;
		plugin._mapFogRev = null;
		return;
	}
	const rev = fog._rev || 0;
	if (plugin._mapFogSrc === fog && plugin._mapFogRev === rev) return;
	if (plugin._mapFogPending === fog && plugin._mapFogPendingRev === rev) return;
	plugin._mapFogPending = fog;
	plugin._mapFogPendingRev = rev;
	const ticket = (plugin._mapFogTicket || 0) + 1;
	plugin._mapFogTicket = ticket;
	createImageBitmap(fog).then((bmp) => {
		if (plugin._mapFogTicket !== ticket) {
			closeBitmap(bmp);
			return;
		}
		closeBitmap(plugin._mapFogBitmap);
		plugin._mapFogBitmap = bmp;
		plugin._mapFogSrc = fog;
		plugin._mapFogRev = rev;
		plugin._mapFogPending = null;
		if (plugin._mapLastDraw) paintPlayer(plugin, plugin._mapLastDraw);
	}).catch((e) => warnPlayerBlit(plugin, e));
}

function ensureTokenBitmaps (plugin, tokens, images, cellPx) {
	if (!plugin._mapTokenBitmaps) plugin._mapTokenBitmaps = new Map();
	const cache = plugin._mapTokenBitmaps;
	const live = new Set();
	const cell = Math.max(1, Number(cellPx) || 70);
	for (const token of tokens || []) {
		if (!token?.id) continue;
		live.add(token.id);
		const img = images?.get?.(token.id);
		if (!img || (typeof ImageBitmap === "function" && img instanceof ImageBitmap)) continue;
		const cells = Number(token.cells) > 0 ? Number(token.cells) : 1;
		const disc = tokenDisc(img, cells * cell);
		if (!disc) continue;
		const key = disc.width;
		const hit = cache.get(token.id);
		if (hit?.bitmap && hit.key === key) continue;
		if (hit?.pending === key) continue;
		cache.set(token.id, {key, pending: key, bitmap: hit?.bitmap || null});
		createImageBitmap(disc).then((bmp) => {
			const cur = cache.get(token.id);
			if (!cur || cur.pending !== key) {
				closeBitmap(bmp);
				return;
			}
			closeBitmap(cur.bitmap);
			cur.bitmap = bmp;
			cur.key = key;
			cur.pending = 0;
			if (plugin._mapLastDraw) paintPlayer(plugin, plugin._mapLastDraw);
		}).catch((e) => warnPlayerBlit(plugin, e));
	}
	for (const [id, entry] of cache) {
		if (live.has(id)) continue;
		closeBitmap(entry?.bitmap);
		cache.delete(id);
	}
}

function warnPlayerBlit (plugin, err) {
	if (!plugin || plugin._mapBlitWarned) return;
	plugin._mapBlitWarned = true;
	new Notice(err?.message || "Could not send the map to the player window.");
}
