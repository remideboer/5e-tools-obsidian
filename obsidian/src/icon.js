import {addIcon} from "obsidian";

export const ICON_ID = "fiveetools";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path fill="none" d="M6.8 5.6H1.1V10.4H5.2C7.6 10.4 8.4 11.6 8.4 13.2 8.4 14.8 7.4 15.8 5.2 15.8H1.1"/><path fill="none" d="M16.4 11.3H9.2C9.4 8.6 12.2 7.6 14.4 8.6 16.2 9.4 16.6 10.6 16.2 11.3 16.6 12.4 16 14.8 13.4 15 11 15.2 9.6 13.8 9.6 12.2"/><g transform="translate(9.5,9.2) scale(0.58)" stroke="none"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" fill="currentColor"/></g></svg>`;

export function registerFiveEToolsIcon () {
	addIcon(ICON_ID, SVG);
}
