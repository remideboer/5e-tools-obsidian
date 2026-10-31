export const DAY_MINUTES = 24 * 60;
export const SHIFT_MINUTES = 6 * 60;
export const EXPLORE_TURN = 10;
export const SHORT_REST = 60;
export const LONG_REST = 8 * 60;

export const TIME_MODES = [
	{id: "explore", label: "Explore", steps: [
		{id: 10, label: "10 minutes"},
		{id: 60, label: "1 hour"},
		{id: 360, label: "1 shift"},
	]},
	{id: "downtime", label: "Downtime", steps: [
		{id: 360, label: "1 shift"},
		{id: 1440, label: "1 day"},
	]},
	{id: "combat", label: "Combat", steps: [
		{id: 1, label: "1 minute"},
	]},
];

export function stepsFor (mode) {
	return TIME_MODES.find(it => it.id === mode)?.steps || TIME_MODES[0].steps;
}

export function normalizeTime (raw) {
	const mode = TIME_MODES.some(it => it.id === raw?.timeMode) ? raw.timeMode : "explore";
	const steps = stepsFor(mode);
	const step = Number(raw?.timeStep);
	const minute = Number(raw?.timeMinute);
	return {
		timeMinute: Number.isFinite(minute) ? Math.max(0, Math.trunc(minute)) : 0,
		timeMode: mode,
		timeStep: steps.some(it => it.id === step) ? step : steps[0].id,
	};
}

export function addMinutes (total, delta) {
	return Math.max(0, Math.trunc(Number(total) || 0) + Math.trunc(Number(delta) || 0));
}

export function clockParts (total) {
	const minute = Math.max(0, Math.trunc(Number(total) || 0));
	const minuteOfDay = minute % DAY_MINUTES;
	const shift = Math.floor(minuteOfDay / SHIFT_MINUTES);
	const shiftMinute = minuteOfDay % SHIFT_MINUTES;
	return {
		day: Math.floor(minute / DAY_MINUTES) + 1,
		minuteOfDay,
		hour: Math.floor(minuteOfDay / 60),
		minute: minuteOfDay % 60,
		shift,
		shiftMinute,
		row: Math.floor(shiftMinute / EXPLORE_TURN),
	};
}

export function formatClock (parts) {
	return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function formatMinute (minute) {
	const h = Math.floor(minute / 60);
	const m = minute % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function shiftLabel (shift) {
	const start = shift * SHIFT_MINUTES;
	const end = start + SHIFT_MINUTES;
	const endText = end === DAY_MINUTES ? "24:00" : formatMinute(end);
	return `Shift ${shift + 1} · ${formatMinute(start)}–${endText}`;
}

export function shiftRows (shift) {
	const start = shift * SHIFT_MINUTES;
	const count = SHIFT_MINUTES / EXPLORE_TURN;
	const rows = [];
	for (let i = 0; i < count; i++) rows.push(formatMinute(start + i * EXPLORE_TURN));
	return rows;
}
