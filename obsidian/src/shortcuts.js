import {Notice, Setting} from "obsidian";

const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta"]);

/** Chord from a keydown, or null while a modifier key is still going down. */
export function shortcutFromEvent (evt) {
	const raw = String(evt?.key || "");
	if (!raw || evt.isComposing || MODIFIER_KEYS.has(raw.toLowerCase())) return null;
	return {
		ctrl: !!evt.ctrlKey,
		alt: !!evt.altKey,
		shift: !!evt.shiftKey,
		meta: !!evt.metaKey,
		key: raw.length === 1 ? raw.toLowerCase() : raw,
	};
}

export function shortcutLabel (chord) {
	if (!chord?.key) return "None";
	const parts = [];
	if (chord.ctrl) parts.push("Ctrl");
	if (chord.alt) parts.push("Alt");
	if (chord.shift) parts.push("Shift");
	if (chord.meta) parts.push("Win");
	parts.push(chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
	return parts.join("+");
}

export function sameShortcut (a, b) {
	if (!a?.key || !b?.key) return false;
	return !!a.ctrl === !!b.ctrl
		&& !!a.alt === !!b.alt
		&& !!a.shift === !!b.shift
		&& !!a.meta === !!b.meta
		&& String(a.key).toLowerCase() === String(b.key).toLowerCase();
}

/**
 * Click the button, then press the chord. Backspace clears it.
 * The plugin keydown handler calls `plugin._capturingShortcut` while this is armed.
 */
export function addShortcutSetting (containerEl, plugin, {name, desc, settingKey, otherKey}) {
	const showLabel = () => shortcutLabel(plugin.settings[settingKey]);
	new Setting(containerEl)
		.setName(name)
		.setDesc(desc)
		.addButton(btn => {
			const show = () => btn.setButtonText(showLabel());
			show();
			btn.onClick(() => {
				plugin._stopShortcutCapture?.();
				btn.setButtonText("Press shortcut");
				const take = async (chord) => {
					stop();
					if (!chord || chord.key === "Escape") {
						show();
						return;
					}
					if ((chord.key === "Backspace" || chord.key === "Delete") && !chord.ctrl && !chord.alt && !chord.meta) {
						plugin.settings[settingKey] = null;
						await plugin.saveSettings();
						show();
						return;
					}
					if (!chord.ctrl && !chord.alt && !chord.meta) {
						new Notice("Use Ctrl, Alt, or the Windows key with another key.");
						show();
						return;
					}
					if (sameShortcut(chord, plugin.settings[otherKey])) {
						new Notice("That shortcut is already used.");
						show();
						return;
					}
					plugin.settings[settingKey] = chord;
					await plugin.saveSettings();
					show();
				};
				const onPointer = (evt) => {
					if (btn.buttonEl?.contains(evt.target)) return;
					stop();
					show();
				};
				const stop = () => {
					document.removeEventListener("pointerdown", onPointer, true);
					if (plugin._capturingShortcut === take) plugin._capturingShortcut = null;
					if (plugin._stopShortcutCapture === stop) plugin._stopShortcutCapture = null;
				};
				plugin._capturingShortcut = take;
				plugin._stopShortcutCapture = stop;
				window.setTimeout(() => document.addEventListener("pointerdown", onPointer, true), 0);
			});
		});
}
