export function defaultCamera () {
	return {x: 0, y: 0, scale: 1};
}

export function clampScale (scale) {
	const n = Number(scale);
	if (!Number.isFinite(n) || n <= 0) return 1;
	return Math.min(8, Math.max(0.05, n));
}

export function normRotation (r) {
	const n = ((Number(r) || 0) % 360 + 360) % 360;
	if (n < 45 || n >= 315) return 0;
	if (n < 135) return 90;
	if (n < 225) return 180;
	return 270;
}

/** Rotate (x,y) by rotation degrees (clockwise, screen Y-down). */
export function rotateDelta (x, y, rotation) {
	switch (normRotation(rotation)) {
		case 90: return {x: -y, y: x};
		case 180: return {x: -x, y: -y};
		case 270: return {x: y, y: -x};
		default: return {x, y};
	}
}

export function invRotateDelta (x, y, rotation) {
	return rotateDelta(x, y, -normRotation(rotation));
}

export function applyWorldTransform (ctx, camera, rotation, viewW, viewH) {
	const scale = clampScale(camera.scale);
	const center = worldCenter(camera, viewW, viewH);
	const rad = (normRotation(rotation) * Math.PI) / 180;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.translate(viewW / 2, viewH / 2);
	ctx.scale(scale, scale);
	ctx.rotate(rad);
	ctx.translate(-center.x, -center.y);
}

const DEFAULT_BG = "#111";

/** Average opaque RGB from a 1px strip on each image edge. */
export function sampleEdgeColor (image) {
	const w = image?.width | 0;
	const h = image?.height | 0;
	if (!w || !h) return DEFAULT_BG;
	try {
		const c = document.createElement("canvas");
		c.width = w;
		c.height = h;
		const cctx = c.getContext("2d", {willReadFrequently: true});
		if (!cctx) return DEFAULT_BG;
		cctx.drawImage(image, 0, 0);
		let r = 0;
		let g = 0;
		let b = 0;
		let n = 0;
		const add = (data) => {
			for (let i = 0; i < data.length; i += 4) {
				if (data[i + 3] < 16) continue;
				r += data[i];
				g += data[i + 1];
				b += data[i + 2];
				n++;
			}
		};
		add(cctx.getImageData(0, 0, w, 1).data);
		add(cctx.getImageData(0, h - 1, w, 1).data);
		if (h > 2) {
			add(cctx.getImageData(0, 1, 1, h - 2).data);
			add(cctx.getImageData(w - 1, 1, 1, h - 2).data);
		}
		if (!n) return DEFAULT_BG;
		return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
	} catch (_) {
		return DEFAULT_BG;
	}
}

function layoutRect (canvas) {
	return canvas.getBoundingClientRect();
}

export function screenToWorld (camera, canvas, clientX, clientY, rotation = 0) {
	const rect = layoutRect(canvas);
	const scale = clampScale(camera.scale);
	const viewW = canvas.width;
	const viewH = canvas.height;
	const sx = (clientX - rect.left) * (viewW / Math.max(1, rect.width));
	const sy = (clientY - rect.top) * (viewH / Math.max(1, rect.height));
	const center = worldCenter(camera, viewW, viewH);
	const local = invRotateDelta((sx - viewW / 2) / scale, (sy - viewH / 2) / scale, rotation);
	return {
		x: center.x + local.x,
		y: center.y + local.y,
	};
}

export function drawWorld (ctx, {
	image,
	camera,
	cellPx,
	offsetX = 0,
	offsetY = 0,
	showGrid = true,
	width,
	height,
	bgColor = DEFAULT_BG,
	fog = null,
	fogAlpha = 1,
	rotation = 0,
	tokens = null,
	tokenImages = null,
}) {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = bgColor || DEFAULT_BG;
	ctx.fillRect(0, 0, width, height);
	const scale = clampScale(camera.scale);
	const view = visibleWorldRect(camera, width, height, rotation);
	applyWorldTransform(ctx, camera, rotation, width, height);
	if (image) {
		try { blitVisible(ctx, image, view); } catch (_) { /* popout documents cannot draw a main-window Image */ }
	}
	const gridSize = Number(cellPx) || 70;
	if (tokens?.length) drawTokenSprites(ctx, tokens, tokenImages, gridSize, view);
	if (fog) {
		const prev = ctx.globalAlpha;
		ctx.globalAlpha = Math.max(0, Math.min(1, Number(fogAlpha) || 0));
		try { blitVisible(ctx, fog, view); } catch (_) { /* ignore */ }
		ctx.globalAlpha = prev;
	}
	if (showGrid) strokeGrid(ctx, view, image, scale, gridSize, offsetX, offsetY);
	ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function viewToWorld (camera, viewW, viewH, sx, sy, rotation) {
	const scale = clampScale(camera.scale);
	const center = worldCenter(camera, viewW, viewH);
	const local = invRotateDelta((sx - viewW / 2) / scale, (sy - viewH / 2) / scale, rotation);
	return {x: center.x + local.x, y: center.y + local.y};
}

function visibleWorldRect (camera, viewW, viewH, rotation) {
	const corners = [
		viewToWorld(camera, viewW, viewH, 0, 0, rotation),
		viewToWorld(camera, viewW, viewH, viewW, 0, rotation),
		viewToWorld(camera, viewW, viewH, 0, viewH, rotation),
		viewToWorld(camera, viewW, viewH, viewW, viewH, rotation),
	];
	let x0 = corners[0].x;
	let y0 = corners[0].y;
	let x1 = x0;
	let y1 = y0;
	for (let i = 1; i < corners.length; i++) {
		const p = corners[i];
		if (p.x < x0) x0 = p.x;
		if (p.y < y0) y0 = p.y;
		if (p.x > x1) x1 = p.x;
		if (p.y > y1) y1 = p.y;
	}
	return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
}

function blitVisible (ctx, source, view) {
	const srcW = source?.width || 0;
	const srcH = source?.height || 0;
	if (!srcW || !srcH || !view?.w || !view?.h) return;
	const x0 = Math.max(0, view.x);
	const y0 = Math.max(0, view.y);
	const x1 = Math.min(srcW, view.x + view.w);
	const y1 = Math.min(srcH, view.y + view.h);
	const sw = x1 - x0;
	const sh = y1 - y0;
	if (!(sw > 0) || !(sh > 0)) return;
	ctx.drawImage(source, x0, y0, sw, sh, x0, y0, sw, sh);
}

function strokeGrid (ctx, view, image, scale, size, offsetX, offsetY) {
	const step = Number(size);
	if (!(step > 0) || !view) return;
	const minX = image ? Math.max(view.x, 0) : view.x;
	const minY = image ? Math.max(view.y, 0) : view.y;
	const maxX = Math.min(view.x + view.w, image?.width || (view.x + view.w));
	const maxY = Math.min(view.y + view.h, image?.height || (view.y + view.h));
	if (maxX <= minX || maxY <= minY) return;
	const ox = Number(offsetX) || 0;
	const oy = Number(offsetY) || 0;
	ctx.beginPath();
	ctx.strokeStyle = "rgba(255,255,255,0.28)";
	ctx.lineWidth = 1 / scale;
	for (let x = ox + Math.ceil((minX - ox) / step - 1e-6) * step; x <= maxX; x += step) {
		ctx.moveTo(x, minY);
		ctx.lineTo(x, maxY);
	}
	for (let y = oy + Math.ceil((minY - oy) / step - 1e-6) * step; y <= maxY; y += step) {
		ctx.moveTo(minX, y);
		ctx.lineTo(maxX, y);
	}
	ctx.stroke();
}

/** Blit a cached circle. The card image is cropped once per footprint size. */
export function drawTokenSprites (ctx, tokens, images, cellPx, view = null) {
	const cell = Math.max(1, Number(cellPx) || 70);
	for (const token of tokens || []) {
		const cells = Number(token?.cells) > 0 ? Number(token.cells) : 1;
		const d = cells * cell;
		const x = Number(token?.x) || 0;
		const y = Number(token?.y) || 0;
		if (view) {
			const r = d / 2;
			if (x + r < view.x || x - r > view.x + view.w || y + r < view.y || y - r > view.y + view.h) continue;
		}
		const img = images?.get?.(token.id);
		if (typeof ImageBitmap === "function" && img instanceof ImageBitmap) {
			try { ctx.drawImage(img, x - img.width / 2, y - img.height / 2); } catch (_) { /* closed bitmap */ }
			continue;
		}
		const disc = img ? tokenDisc(img, d) : null;
		if (disc) {
			try { ctx.drawImage(disc, x - disc.width / 2, y - disc.height / 2); } catch (_) { /* image from another document */ }
			continue;
		}
		ctx.beginPath();
		ctx.arc(x, y, d / 2, 0, Math.PI * 2);
		ctx.fillStyle = "#444";
		ctx.fill();
	}
}

export function tokenDisc (source, diameter) {
	const d = Math.max(1, Math.round(diameter));
	if (source._tokenDisc?.width === d) return source._tokenDisc;
	const disc = document.createElement("canvas");
	disc.width = d;
	disc.height = d;
	const g = disc.getContext("2d");
	if (!g) return null;
	g.beginPath();
	g.arc(d / 2, d / 2, d / 2, 0, Math.PI * 2);
	g.clip();
	const iw = source.width || 1;
	const ih = source.height || 1;
	const cover = Math.max(d / iw, d / ih);
	const w = iw * cover;
	const h = ih * cover;
	try { g.drawImage(source, (d - w) / 2, (d - h) / 2, w, h); } catch (_) { /* undecoded */ }
	g.beginPath();
	g.arc(d / 2, d / 2, Math.max(0, d / 2 - 1), 0, Math.PI * 2);
	g.strokeStyle = "rgba(255,255,255,0.9)";
	g.lineWidth = Math.max(2, d * 0.06);
	g.stroke();
	source._tokenDisc = disc;
	return disc;
}

export function bindMapPointer (
	canvas,
	getCamera,
	setCamera,
	onChange,
	canPan = () => true,
	isPanButton = (evt) => evt.button === 0,
	onPanEnd = null,
	getRotation = () => 0,
) {
	let drag = null;
	canvas.addEventListener("pointerdown", (evt) => {
		if (!canPan() || !isPanButton(evt)) return;
		if (evt.button === 2) evt.preventDefault();
		canvas.setPointerCapture(evt.pointerId);
		drag = {
			x: evt.clientX,
			y: evt.clientY,
			cam: {...getCamera()},
			button: evt.button,
			moved: false,
		};
		onPanEnd?.({moved: false, button: evt.button}, evt);
	});
	canvas.addEventListener("pointermove", (evt) => {
		if (!drag) return;
		const dx = evt.clientX - drag.x;
		const dy = evt.clientY - drag.y;
		if (!drag.moved && (dx * dx + dy * dy) > 16) {
			drag.moved = true;
			onPanEnd?.({moved: true, button: drag.button}, evt);
		}
		const prev = getCamera();
		const scale = clampScale(prev.scale);
		const world = invRotateDelta(dx / scale, dy / scale, getRotation());
		const next = {
			...prev,
			x: drag.cam.x - world.x,
			y: drag.cam.y - world.y,
		};
		setCamera(next);
		onChange("pan", next, prev);
	});
	const endDrag = (evt) => {
		if (!drag) return;
		const info = {moved: drag.moved, button: drag.button};
		drag = null;
		onPanEnd?.(info, evt);
	};
	canvas.addEventListener("pointerup", endDrag);
	canvas.addEventListener("pointercancel", endDrag);
	canvas.addEventListener("wheel", (evt) => {
		evt.preventDefault();
		const prev = getCamera();
		const before = clampScale(prev.scale);
		const factor = evt.deltaY < 0 ? 1.1 : 1 / 1.1;
		const after = clampScale(before * factor);
		const rot = getRotation();
		const anchor = screenToWorld(prev, canvas, evt.clientX, evt.clientY, rot);
		const rect = layoutRect(canvas);
		const viewW = canvas.width;
		const viewH = canvas.height;
		const sx = (evt.clientX - rect.left) * (viewW / Math.max(1, rect.width));
		const sy = (evt.clientY - rect.top) * (viewH / Math.max(1, rect.height));
		const local = invRotateDelta((sx - viewW / 2) / after, (sy - viewH / 2) / after, rot);
		const next = {
			scale: after,
			x: anchor.x - local.x - viewW / (2 * after),
			y: anchor.y - local.y - viewH / (2 * after),
		};
		setCamera(next);
		onChange("zoom", next, prev);
	}, {passive: false});
}

export function fitImage (image, width, height, rotation = 0) {
	if (!image?.width || !width || !height) return defaultCamera();
	const rot = normRotation(rotation);
	const iw = rot === 90 || rot === 270 ? image.height : image.width;
	const ih = rot === 90 || rot === 270 ? image.width : image.height;
	const scale = Math.min(width / iw, height / ih);
	const s = clampScale(scale);
	return {
		scale: s,
		x: (image.width - width / s) / 2,
		y: (image.height - height / s) / 2,
	};
}

export function worldCenter (camera, viewW, viewH) {
	const scale = clampScale(camera.scale);
	return {
		x: camera.x + viewW / (2 * scale),
		y: camera.y + viewH / (2 * scale),
	};
}

export function cameraOnCenter (center, viewW, viewH, scale) {
	const next = clampScale(scale);
	return {
		scale: next,
		x: center.x - viewW / (2 * next),
		y: center.y - viewH / (2 * next),
	};
}
