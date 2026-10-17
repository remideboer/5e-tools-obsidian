import {addIcon} from "obsidian";

export const ICON_ID = "fiveetools";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><text x="0.5" y="16.5" font-size="12" font-weight="700" font-family="system-ui,Segoe UI,sans-serif" fill="currentColor" stroke="none">5e</text><g transform="translate(9.5,9.2) scale(0.58)"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" fill="currentColor" stroke="none"/></g></svg>`;

export function registerFiveEToolsIcon () {
	addIcon(ICON_ID, SVG);
}
