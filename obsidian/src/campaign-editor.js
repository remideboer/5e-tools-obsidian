export async function openCampaignNote (plugin, parentEl, file) {
	if (!plugin || !parentEl) return null;
	if (!file || file.children) {
		closeCampaignNote(plugin);
		return null;
	}
	const app = plugin.app;
	const existing = plugin._campaignEmbed;
	if (existing?.leaf && existing.parentEl === parentEl) {
		await existing.leaf.openFile(file, {
			active: false,
			state: {mode: "source", source: false},
		});
		existing.file = file;
		return existing;
	}
	closeCampaignNote(plugin);
	const WorkspaceSplit = app.workspace?.rootSplit?.constructor;
	if (!WorkspaceSplit || typeof app.workspace.createLeafInParent !== "function") {
		throw new Error("Could not open the Obsidian editor.");
	}
	const rootSplit = new WorkspaceSplit(app.workspace, "vertical");
	rootSplit.getRoot = () => app.workspace.rootSplit;
	rootSplit.getContainer = () => app.workspace.rootSplit;
	const container = rootSplit.containerEl;
	container.addClass("fiveetools-campaign__leaf");
	container.style.width = "100%";
	container.style.height = "100%";
	const leaf = app.workspace.createLeafInParent(rootSplit, 0);
	await leaf.openFile(file, {
		active: false,
		state: {mode: "source", source: false},
	});
	parentEl.empty();
	parentEl.appendChild(container);
	const embed = {leaf, rootSplit, parentEl, file};
	plugin._campaignEmbed = embed;
	return embed;
}

export function closeCampaignNote (plugin) {
	const embed = plugin?._campaignEmbed;
	if (!embed) return;
	plugin._campaignEmbed = null;
	try { embed.leaf?.detach?.(); } catch (_) { /* already detached */ }
	const el = embed.rootSplit?.containerEl;
	if (el?.detach) el.detach();
	else el?.remove?.();
}
