export const VIEW_TYPE_FIVEETOOLS = "fiveetools-preview";
export const VIEW_TYPE_FIVEETOOLS_LIBRARY = "fiveetools-library";
export const VIEW_TYPE_FIVEETOOLS_MAP_PLAYER = "fiveetools-map-player";

export const DEFAULT_SETTINGS = {
	notesFolder: "5etools",
	imageBaseUrl: "https://5e.tools",
	style: "one",
	dice3d: false,
	dicePublic: false,
	convertHeicOnPaste: true,
};

export const MAX_SEARCH_RESULTS = 40;

export const CATEGORY_CHIPS = [
	{id: "all", label: "All", aliases: []},
	{id: "bestiary", label: "Bestiary", aliases: ["bestiary", "creature", "monster", "mon"]},
	{id: "spell", label: "Spell", aliases: ["spell", "sp"]},
	{id: "item", label: "Item", aliases: ["item", "itm"]},
	{id: "class", label: "Class", aliases: ["class"]},
	{id: "feat", label: "Feat", aliases: ["feat", "ft"]},
	{id: "species", label: "Species", aliases: ["species", "race"]},
	{id: "background", label: "Background", aliases: ["background", "bg"]},
	{id: "optionalfeature", label: "Options", aliases: ["optional feature", "invocation", "metamagic", "maneuver", "fighting style", "pact boon", "infusion"]},
	{id: "condition", label: "Condition", aliases: ["condition", "con", "disease", "status"]},
	{id: "trapshazards", label: "Traps", aliases: ["trap", "hazard"]},
	{id: "objects", label: "Object", aliases: ["object", "obj"]},
	{id: "cultsboons", label: "Cults", aliases: ["cult", "boon"]},
	{id: "rule", label: "Rule", aliases: ["rule"]},
	{id: "adventure", label: "Adventure", aliases: ["adventure", "adv"]},
];

export const LIBRARY_NAV = [
	{
		group: "Tools",
		items: [
			{id: "loot", label: "Loot Generator", tool: "loot"},
			{id: "rolltables", label: "Roll tables", tool: "rolltables"},
			{id: "encounter", label: "Encounter Composer", tool: "encounter"},
			{id: "homebrew", label: "Homebrew", tool: "homebrew"},
			{id: "campaign", label: "Campaigns", tool: "campaign"},
			{id: "map", label: "Map", tool: "map"},
		],
	},
	{
		group: "Player",
		items: [
			{id: "class", label: "Classes", categories: ["class", "subclass"]},
			{id: "background", label: "Backgrounds", categories: ["background"]},
			{id: "feat", label: "Feats", categories: ["feat"]},
			{id: "species", label: "Species", categories: ["species"]},
			{id: "optionalfeature", label: "Options & Features", categories: ["eldritch invocation", "metamagic", "maneuver; battle master", "maneuver; cavalier", "arcane shot", "optional feature", "fighting style", "pact boon", "elemental discipline", "infusion", "onomancy resonant", "rune knight rune", "alchemical formula", "maneuver"]},
		],
	},
	{
		group: "References",
		items: [
			{id: "bestiary", label: "Bestiary", categories: ["bestiary"]},
			{id: "trapshazards", label: "Traps & Hazards", categories: ["trap", "hazard"]},
			{id: "objects", label: "Objects", categories: ["object"]},
			{id: "cultsboons", label: "Cults & Boons", categories: ["cult", "boon"]},
			{id: "spell", label: "Spells", categories: ["spell"]},
			{id: "item", label: "Items", categories: ["item"]},
			{id: "condition", label: "Conditions", categories: ["condition", "disease", "status"]},
			{id: "rule", label: "Rules", categories: ["rule"]},
			{id: "adventure", label: "Adventures", categories: ["adventure"]},
			{id: "maps", label: "Maps", tool: "maps"},
		],
	},
];

export const CORPUS_PAGES = new Set([
	"book.html",
	"books.html",
]);
