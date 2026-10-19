const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const INCHES_PER_METRE = 1 / 0.0254;
const SKIP_DPI = new Set([72, 96]);

export function detectImageDpi (bytes) {
	const view = toView(bytes);
	if (!view) return null;
	return pngDpi(view) || jpegDpi(view);
}

export function meanDpi (x, y) {
	const a = Number(x);
	const b = Number(y);
	if (!(a > 0) || !(b > 0)) return null;
	if (Math.abs(a - b) / Math.max(a, b) > 0.01) return null;
	const dpi = Math.round((a + b) / 2);
	return SKIP_DPI.has(dpi) ? null : dpi;
}

function toView (bytes) {
	if (!bytes) return null;
	if (bytes instanceof DataView) return bytes;
	if (bytes instanceof ArrayBuffer) return new DataView(bytes);
	if (ArrayBuffer.isView(bytes)) {
		return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}
	return null;
}

function pngDpi (view) {
	if (view.byteLength < 29) return null;
	for (let i = 0; i < 8; i++) {
		if (view.getUint8(i) !== PNG[i]) return null;
	}
	let pos = 8;
	while (pos + 12 <= view.byteLength) {
		const len = view.getUint32(pos);
		const name = latin1(view, pos + 4, 4);
		const data = pos + 8;
		if (data + len + 4 > view.byteLength) return null;
		if (name === "pHYs" && len === 9 && view.getUint8(data + 8) === 1) {
			return meanDpi(
				view.getUint32(data) / INCHES_PER_METRE,
				view.getUint32(data + 4) / INCHES_PER_METRE,
			);
		}
		if (name === "IDAT" || name === "IEND") return null;
		pos = data + len + 4;
	}
	return null;
}

function jpegDpi (view) {
	if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
	let pos = 2;
	let jfif = null;
	let exif = null;
	let sawJfif = false;
	let sawExif = false;
	while (pos + 4 <= view.byteLength) {
		if (view.getUint8(pos) !== 0xff) break;
		const marker = view.getUint8(pos + 1);
		if (marker === 0xff) {
			pos += 1;
			continue;
		}
		if (marker === 0xda || (marker >= 0xd0 && marker <= 0xd9)) break;
		const size = view.getUint16(pos + 2);
		const data = pos + 4;
		if (data + size - 2 > view.byteLength) break;
		if (marker === 0xe0 && !sawJfif) {
			sawJfif = true;
			jfif = jfifDpi(view, data, size - 2);
		} else if (marker === 0xe1 && !sawExif) {
			sawExif = true;
			exif = exifDpi(view, data, size - 2);
		}
		pos = data + size - 2;
	}
	return jfif || exif;
}

function jfifDpi (view, data, size) {
	if (size < 14 || latin1(view, data, 5) !== "JFIF\0") return null;
	const units = view.getUint8(data + 7);
	const x = view.getUint16(data + 8);
	const y = view.getUint16(data + 10);
	if (units === 1) return meanDpi(x, y);
	if (units === 2) return meanDpi(x * 2.54, y * 2.54);
	return null;
}

function exifDpi (view, data, size) {
	if (size < 8 || latin1(view, data, 6) !== "Exif\0\0") return null;
	const tiff = data + 6;
	const order = latin1(view, tiff, 2);
	const le = order === "II";
	if (!le && order !== "MM") return null;
	if (u16(view, tiff + 2, le) !== 42) return null;
	const ifd = tiff + u32(view, tiff + 4, le);
	if (ifd + 2 > view.byteLength) return null;
	const count = u16(view, ifd, le);
	let x;
	let y;
	let unit = 2;
	for (let i = 0; i < count; i++) {
		const entry = ifd + 2 + i * 12;
		if (entry + 12 > view.byteLength) return null;
		const tag = u16(view, entry, le);
		const type = u16(view, entry + 2, le);
		const n = u32(view, entry + 4, le);
		if (tag === 0x011a && type === 5 && n === 1) x = rational(view, tiff, u32(view, entry + 8, le), le);
		else if (tag === 0x011b && type === 5 && n === 1) y = rational(view, tiff, u32(view, entry + 8, le), le);
		else if (tag === 0x0128 && type === 3 && n === 1) unit = u16(view, entry + 8, le);
	}
	if (!(x > 0) || !(y > 0)) return null;
	if (unit === 3) return meanDpi(x * 2.54, y * 2.54);
	if (unit === 2) return meanDpi(x, y);
	return null;
}

function rational (view, tiff, offset, le) {
	if (tiff + offset + 8 > view.byteLength) return null;
	const den = u32(view, tiff + offset + 4, le);
	return den > 0 ? u32(view, tiff + offset, le) / den : null;
}

function u16 (view, offset, le) {
	return view.getUint16(offset, le);
}

function u32 (view, offset, le) {
	return view.getUint32(offset, le);
}

function latin1 (view, offset, length) {
	let text = "";
	for (let i = 0; i < length && offset + i < view.byteLength; i++) {
		text += String.fromCharCode(view.getUint8(offset + i));
	}
	return text;
}
