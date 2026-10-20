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

export function screenToWorld (camera, canvas, clientX, clientY, rotation = 0) {
	const rect = canvas.getBoundingClientRect();
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
}) {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = bgColor || DEFAULT_BG;
	ctx.fillRect(0, 0, width, height);
	const scale = clampScale(camera.scale);
	applyWorldTransform(ctx, camera, rotation, width, height);
	if (image) {
		try { ctx.drawImage(image, 0, 0); } catch (_) { /* popout documents cannot draw a main-window Image */ }
	}
	if (fog) {
		const prev = ctx.globalAlpha;
		ctx.globalAlpha = Math.max(0, Math.min(1, Number(fogAlpha) || 0));
		try { ctx.drawImage(fog, 0, 0); } catch (_) { /* ignore */ }
		ctx.globalAlpha = prev;
	}
	if (showGrid) {
		const size = Number(cellPx) || 70;
		const w = image?.width || width / scale;
		const h = image?.height || height / scale;
		ctx.beginPath();
		ctx.strokeStyle = "rgba(255,255,255,0.28)";
		ctx.lineWidth = 1 / scale;
		for (let x = Number(offsetX) || 0; x <= w; x += size) {
			ctx.moveTo(x, 0);
			ctx.lineTo(x, h);
		}
		for (let y = Number(offsetY) || 0; y <= h; y += size) {
			ctx.moveTo(0, y);
			ctx.lineTo(w, y);
		}
		ctx.stroke();
	}
	ctx.setTransform(1, 0, 0, 1, 0, 0);
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
		const rect = canvas.getBoundingClientRect();
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
