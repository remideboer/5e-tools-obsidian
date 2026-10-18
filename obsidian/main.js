import {Notice, Plugin} from "obsidian";
import {DEFAULT_SETTINGS, VIEW_TYPE_FIVEETOOLS, VIEW_TYPE_FIVEETOOLS_LIBRARY} from "./src/constants.js";
import {FiveEToolsView} from "./src/entity-view.js";
import {configureFiveEToolsRoot, setStyleHint} from "./src/fiveetools-host.js";
import {ICON_ID, registerFiveEToolsIcon} from "./src/icon.js";
import {FiveEToolsLibraryView, libraryStateFromDoc} from "./src/library-view.js";
import {validateRoot} from "./src/local-fs.js";
import {getPluginDir} from "./src/plugin-dir.js";
import {ensureSearchIndex, indexHomebrewDocs} from "./src/search-index.js";
import {cacheBrewInDataLoader, loadHomebrewFromVault} from "./src/homebrew-store.js";
import {FiveEToolsSettingTab} from "./src/settings.js";

export default class FiveEToolsPlugin extends Plugin {
	async onload () {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (this.settings.fiveEToolsPath != null) {
			delete this.settings.fiveEToolsPath;
			await this.saveSettings();
		}
		setStyleHint(this.settings.style);
		registerFiveEToolsIcon();

		this.registerView(
			VIEW_TYPE_FIVEETOOLS,
			(leaf) => new FiveEToolsView(leaf, this),
		);
		this.registerView(
			VIEW_TYPE_FIVEETOOLS_LIBRARY,
			(leaf) => new FiveEToolsLibraryView(leaf, this),
		);

		this.addCommand({
			id: "open-library",
			name: "Open library",
			callback: () => this.openLibrary(),
		});
		this.addCommand({
			id: "search",
			name: "Search",
			callback: () => this.openSearch(),
		});

		this.addRibbonIcon(ICON_ID, "Open 5etools library", () => this.openLibrary());
		this.addSettingTab(new FiveEToolsSettingTab(this.app, this));
	}

	async saveSettings () {
		await this.saveData(this.settings);
	}

	getDataRoot () {
		return getPluginDir(this);
	}

	async ensureReady () {
		let root;
		try {
			root = this.getDataRoot();
		} catch (e) {
			new Notice(e.message);
			return false;
		}
		const check = validateRoot(root);
		if (!check.ok) {
			new Notice(check.error);
			return false;
		}
		configureFiveEToolsRoot(check.root, {imageBaseUrl: this.settings.imageBaseUrl});
		setStyleHint(this.settings.style);
		await ensureSearchIndex(check.root);
		await loadHomebrewFromVault(this);
		cacheBrewInDataLoader();
		indexHomebrewDocs();
		return true;
	}

	async openSearch () {
		await this.openLibrary();
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_FIVEETOOLS_LIBRARY)[0];
		const view = leaf?.view;
		if (view instanceof FiveEToolsLibraryView) view.focusGlobalSearch();
	}

	async openLibrary (opts = {}) {
		if (!await this.ensureReady()) return;
		const {workspace} = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_FIVEETOOLS_LIBRARY)[0];
		if (!leaf) {
			leaf = workspace.getLeaf(false) || workspace.getLeaf(true);
			await leaf.setViewState({
				type: VIEW_TYPE_FIVEETOOLS_LIBRARY,
				active: true,
				state: opts.doc ? libraryStateFromDoc(opts.doc) : {},
			});
			return;
		}
		workspace.revealLeaf(leaf);
		const view = leaf.view;
		if (view instanceof FiveEToolsLibraryView) {
			if (opts.doc) await view.navigateToDoc(opts.doc);
			else if (opts.navId) view.selectNav(opts.navId);
		}
	}

	async openPreview (doc) {
		await this.openLibrary({doc});
	}
}
