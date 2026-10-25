import {fs} from "./node-fs.js";

export function fogPaths (mapPath) {
	const base = String(mapPath || "");
	return {
		start: base ? `${base}.fog-start.png` : "",
		live: base ? `${base}.fog-live.png` : "",
	};
}

/** Empty (clear) fog mask — map fully visible until Cover is used. */
export function createFogMask (w, h) {
	const width = Math.max(1, w | 0);
	const height = Math.max(1, h | 0);
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	ctx.clearRect(0, 0, width, height);
	return canvas;
}

export function coverFogAll (mask) {
	if (!mask) return;
	const ctx = mask.getContext("2d");
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalCompositeOperation = "source-over";
	ctx.fillStyle = "#000";
	ctx.fillRect(0, 0, mask.width, mask.height);
}

export function paintFogBrush (mask, x, y, r, mode) {
	if (!mask) return;
	const radius = Math.max(1, Number(r) || 1);
	const ctx = mask.getContext("2d");
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, Math.PI * 2);
	if (mode === "reveal") {
		ctx.globalCompositeOperation = "destination-out";
		ctx.fillStyle = "#000";
	} else {
		ctx.globalCompositeOperation = "source-over";
		ctx.fillStyle = "#000";
	}
	ctx.fill();
	ctx.globalCompositeOperation = "source-over";
}

export function strokeFogBrush (mask, x0, y0, x1, y1, r, mode) {
	const dx = x1 - x0;
	const dy = y1 - y0;
	const dist = Math.hypot(dx, dy);
	const step = Math.max(1, (Number(r) || 1) * 0.35);
	if (dist < step) {
		paintFogBrush(mask, x1, y1, r, mode);
		return;
	}
	const n = Math.ceil(dist / step);
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		paintFogBrush(mask, x0 + dx * t, y0 + dy * t, r, mode);
	}
}

function fogComposite (ctx, mode) {
	ctx.globalCompositeOperation = mode === "reveal" ? "destination-out" : "source-over";
	ctx.fillStyle = "#000";
}

export function fillFogRect (mask, x, y, w, h, mode = "reveal") {
	if (!mask) return;
	const ctx = mask.getContext("2d");
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	fogComposite(ctx, mode);
	ctx.fillRect(x, y, w, h);
	ctx.globalCompositeOperation = "source-over";
}

export function fillFogPolygon (mask, points, mode = "reveal") {
	if (!mask || !points?.length || points.length < 3) return;
	const ctx = mask.getContext("2d");
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.beginPath();
	ctx.moveTo(points[0].x, points[0].y);
	for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
	ctx.closePath();
	fogComposite(ctx, mode);
	ctx.fill();
	ctx.globalCompositeOperation = "source-over";
}

export function fillFogCircle (mask, cx, cy, r, mode = "reveal") {
	const radius = Number(r);
	if (!mask || !(radius > 0)) return;
	const ctx = mask.getContext("2d");
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.beginPath();
	ctx.arc(cx, cy, radius, 0, Math.PI * 2);
	fogComposite(ctx, mode);
	ctx.fill();
	ctx.globalCompositeOperation = "source-over";
}

export function saveFogMask (filePath, mask) {
	if (!filePath || !mask) return false;
	try {
		const dataUrl = mask.toDataURL("image/png");
		const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
		fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
		return true;
	} catch (_) {
		return false;
	}
}

export function saveFogMaskAsync (filePath, mask) {
	if (!filePath || !mask) return Promise.resolve(false);
	if (typeof mask.toBlob !== "function") return Promise.resolve(saveFogMask(filePath, mask));
	return new Promise((resolve) => {
		mask.toBlob((blob) => {
			if (!blob) {
				resolve(false);
				return;
			}
			blob.arrayBuffer().then((buf) => {
				try {
					fs.writeFileSync(filePath, Buffer.from(buf));
					resolve(true);
				} catch (_) {
					resolve(false);
				}
			}).catch(() => resolve(false));
		}, "image/png");
	});
}

export async function loadFogMask (filePath, w, h) {
	const width = Math.max(1, w | 0);
	const height = Math.max(1, h | 0);
	if (!filePath || !fs.existsSync(filePath)) return null;
	try {
		const buf = fs.readFileSync(filePath);
		const url = URL.createObjectURL(new Blob([buf], {type: "image/png"}));
		const img = await new Promise((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = () => reject(new Error("fog load failed"));
			el.src = url;
		});
		URL.revokeObjectURL(url);
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		ctx.drawImage(img, 0, 0, width, height);
		return canvas;
	} catch (_) {
		return null;
	}
}
