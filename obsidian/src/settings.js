import {Notice, PluginSettingTab, Setting} from "obsidian";
import {setStyleHint} from "./fiveetools-host.js";
import {clearMediaCache} from "./media-cache.js";

export class FiveEToolsSettingTab extends PluginSettingTab {
	constructor (app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display () {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.createEl("h2", {text: "5etools"});

		new Setting(containerEl)
			.setName("Notes folder")
			.setDesc("Vault folder for inserted notes and downloaded images.")
			.addText(text => text
				.setPlaceholder("5etools")
				.setValue(this.plugin.settings.notesFolder)
				.onChange(async (value) => {
					this.plugin.settings.notesFolder = value.trim() || "5etools";
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Image host")
			.setDesc("Remote host used for tokens and art (default https://5e.tools).")
			.addText(text => text
				.setPlaceholder("https://5e.tools")
				.setValue(this.plugin.settings.imageBaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.imageBaseUrl = value.trim() || "https://5e.tools";
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Image cache")
			.setDesc("Tokens, art, covers, and maps are stored in the plugin folder after first download.")
			.addButton(btn => btn
				.setButtonText("Clear image cache")
				.onClick(() => {
					try {
						clearMediaCache(this.plugin);
						new Notice("5etools image cache cleared.");
					} catch (e) {
						new Notice(`Could not clear image cache: ${e.message}`);
					}
				}));

		new Setting(containerEl)
			.setName("3D dice")
			.setDesc("Animate predetermined dice in an overlay after a roll. Turn off if WebGL fails.")
			.addToggle(toggle => toggle
				.setValue(!!this.plugin.settings.dice3d)
				.onChange(async (value) => {
					this.plugin.settings.dice3d = !!value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Statblock style")
			.setDesc("Classic (2014) or modern (2024) compact rendering.")
			.addDropdown(dropdown => dropdown
				.addOption("classic", "Classic (2014)")
				.addOption("one", "Modern (2024)")
				.setValue(this.plugin.settings.style)
				.onChange(async (value) => {
					this.plugin.settings.style = value === "one" ? "one" : "classic";
					setStyleHint(this.plugin.settings.style);
					await this.plugin.saveSettings();
				}));
	}
}
