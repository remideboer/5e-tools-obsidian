import {PluginSettingTab, Setting} from "obsidian";
import {setStyleHint} from "./fiveetools-host.js";

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
