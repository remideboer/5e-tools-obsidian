export function defaultCamera () {
	return {x: 0, y: 0, scale: 1};
}

export function clampScale (scale) {
	const n = Number(scale);
	if (!Number.isFinite(n) || n <= 0) return 1;
	return Math.min(8, Math.max(0.05, n));
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
}) {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = "#111";
	ctx.fillRect(0, 0, width, height);
	const scale = clampScale(camera.scale);
	ctx.setTransform(scale, 0, 0, scale, -camera.x * scale, -camera.y * scale);
	if (image) {
		try { ctx.drawImage(image, 0, 0); } catch (_) { /* popout documents cannot draw a main-window Image */ }
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

export function bindMapPointer (canvas, getCamera, setCamera, onChange, isZoomLocked = () => false) {
	let drag = null;
	canvas.addEventListener("pointerdown", (evt) => {
		if (evt.button !== 0) return;
		canvas.setPointerCapture(evt.pointerId);
		drag = {x: evt.clientX, y: evt.clientY, cam: {...getCamera()}};
	});
	canvas.addEventListener("pointermove", (evt) => {
		if (!drag) return;
		const prev = getCamera();
		const scale = clampScale(prev.scale);
		const next = {
			...prev,
			x: drag.cam.x - (evt.clientX - drag.x) / scale,
			y: drag.cam.y - (evt.clientY - drag.y) / scale,
		};
		setCamera(next);
		onChange("pan", next, prev);
	});
	const endDrag = () => { drag = null; };
	canvas.addEventListener("pointerup", endDrag);
	canvas.addEventListener("pointercancel", endDrag);
	canvas.addEventListener("wheel", (evt) => {
		evt.preventDefault();
		if (isZoomLocked()) return;
		const prev = getCamera();
		const rect = canvas.getBoundingClientRect();
		const mx = evt.clientX - rect.left;
		const my = evt.clientY - rect.top;
		const before = clampScale(prev.scale);
		const factor = evt.deltaY < 0 ? 1.1 : 1 / 1.1;
		const after = clampScale(before * factor);
		const wx = prev.x + mx / before;
		const wy = prev.y + my / before;
		const next = {
			scale: after,
			x: wx - mx / after,
			y: wy - my / after,
		};
		setCamera(next);
		onChange("zoom", next, prev);
	}, {passive: false});
}

export function fitImage (image, width, height) {
	if (!image?.width || !width || !height) return defaultCamera();
	const scale = Math.min(width / image.width, height / image.height);
	return {
		scale: clampScale(scale),
		x: (image.width - width / scale) / 2,
		y: (image.height - height / scale) / 2,
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
