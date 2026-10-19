export const DEFAULT_CELL_INCHES = 1;
export const DEFAULT_DIAGONAL_INCHES = 27;

export function screenPpiCss (widthPx, heightPx, diagonalInches) {
	const w = Number(widthPx);
	const h = Number(heightPx);
	const d = Number(diagonalInches);
	if (!(w > 0) || !(h > 0) || !(d > 0)) return null;
	return Math.hypot(w, h) / d;
}

export function cssPixelsPerWorldPixel (cellPx, cellInches, ppiCss) {
	const cell = Number(cellPx);
	const inches = Number(cellInches);
	const ppi = Number(ppiCss);
	if (!(cell > 0) || !(inches > 0) || !(ppi > 0)) return null;
	return (inches * ppi) / cell;
}

export function inchesFromMapDpi (imagePx, dpi) {
	const px = Number(imagePx);
	const n = Number(dpi);
	if (!(px > 0) || !(n > 0)) return null;
	return px / n;
}

export function mapDpiFromInches (imagePx, inches) {
	const px = Number(imagePx);
	const n = Number(inches);
	if (!(px > 0) || !(n > 0)) return null;
	return px / n;
}

export function cellPxFromMapDpi (dpi, cellInches) {
	const n = Number(dpi);
	const inches = Number(cellInches);
	if (!(n > 0) || !(inches > 0)) return null;
	return n * inches;
}
