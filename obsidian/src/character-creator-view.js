import {Notice} from "obsidian";
import {saveCharacter} from "./character-store.js";
import {buildLocalCharacterCard, draftSummaryLines, estimatedHp} from "./character-creator-build.js";
import {
	findBackground,
	findClass,
	findSpecies,
	loadCreatorCatalog,
	parseGoldAlternative,
} from "./character-creator-data.js";
import {rollDice} from "./dice-roll.js";
import {loadNameGroups, rollCharacterName} from "./name-generate.js";
import {
	ABILITY_KEYS,
	ABILITY_LABELS,
	ABILITY_METHODS,
	abilityModifier,
	activeSteps,
	backgroundAbilityMatches,
	canEnterStep,
	CONCEPT_ARCHETYPES,
	defaultDraft,
	POINT_BUY_COST,
	POINT_BUY_TOTAL,
	pointBuySpent,
	ROLL_STYLES,
	rollStyleMeta,
	sortClassesByArchetype,
	STANDARD_ARRAY,
	stepIndex,
	stepMessage,
	stepValid,
	subclassesFor,
} from "./character-creator-state.js";

const NAME_SUGGESTION_COUNT = 8;

/**
 * Full-pane character creator. Calls onDone({ddbId}) or onCancel().
 */
export async function renderCharacterCreator (host, {plugin, session, onSessionChange, onDone, onCancel} = {}) {
	host.empty();
	host.addClass("fiveetools-cc");

	let draft = {...defaultDraft(), ...(session?.draft || {})};
	let stepId = session?.step || "concept";
	let catalog = null;
	let nameGroups = [];
	let busy = false;
	let detail = {title: "", body: ""};

	const shell = host.createDiv({cls: "fiveetools-cc__shell"});
	const progress = shell.createDiv({cls: "fiveetools-cc__progress", attr: {role: "tablist"}});
	const summary = shell.createDiv({cls: "fiveetools-cc__summary"});
	const stage = shell.createDiv({cls: "fiveetools-cc__stage"});
	const options = stage.createDiv({cls: "fiveetools-cc__options"});
	const sidebar = stage.createDiv({cls: "fiveetools-cc__sidebar"});
	const sideStep = sidebar.createDiv({cls: "fiveetools-cc__side-step"});
	const kicker = sideStep.createDiv({cls: "fiveetools-cc__kicker"});
	const titleEl = sideStep.createEl("h3", {cls: "fiveetools-cc__title"});
	const descEl = sideStep.createEl("p", {cls: "fiveetools-cc__desc"});
	const detailPanel = sidebar.createDiv({cls: "fiveetools-cc__detail"});
	const detailPlaceholder = detailPanel.createEl("p", {
		cls: "fiveetools-view__meta",
		text: "Select an option to see details.",
	});
	const detailTitle = detailPanel.createEl("h4", {cls: "fiveetools-cc__detail-title"});
	const detailBody = detailPanel.createEl("pre", {cls: "fiveetools-cc__detail-body"});
	const nav = sidebar.createDiv({cls: "fiveetools-cc__nav"});
	const cancelBtn = nav.createEl("button", {text: "Cancel", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button"}});
	const backBtn = nav.createEl("button", {text: "Back", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button"}});
	const nextBtn = nav.createEl("button", {text: "Next", cls: "fiveetools-btn", attr: {type: "button"}});
	const body = options.createDiv({cls: "fiveetools-cc__body"});
	const errorEl = options.createDiv({cls: "fiveetools-cc__error"});

	const emit = () => onSessionChange?.({step: stepId, draft: {...draft}});

	const setDetail = (title, text) => {
		detail = {title: title || "", body: text || ""};
		const has = !!(detail.title || detail.body);
		detailPlaceholder.toggleAttribute("hidden", has);
		detailTitle.toggleAttribute("hidden", !has);
		detailBody.toggleAttribute("hidden", !has);
		detailTitle.setText(detail.title);
		detailBody.setText(detail.body);
	};

	const steps = () => activeSteps(draft, catalog);

	const paintProgress = () => {
		progress.empty();
		const list = steps();
		list.forEach((step, index) => {
			const current = stepIndex(stepId, draft, catalog);
			const btn = progress.createEl("button", {
				cls: "fiveetools-cc__step",
				attr: {type: "button", role: "tab"},
			});
			btn.createSpan({cls: "fiveetools-cc__step-num", text: String(index + 1)});
			btn.createSpan({text: step.short});
			if (index === current) btn.addClass("is-current");
			else if (index < current) btn.addClass("is-done");
			btn.addEventListener("click", () => {
				if (index === current) return;
				if (index > current && !stepValid(stepId, draft, catalog)) {
					errorEl.setText(stepMessage(stepId, draft, catalog));
					return;
				}
				if (index > current && !canEnterStep(draft, step.id, catalog)) {
					errorEl.setText("Finish earlier steps first.");
					return;
				}
				stepId = step.id;
				emit();
				paint();
			});
		});
	};

	const paintSummary = () => {
		summary.empty();
		const lines = draftSummaryLines(draft, catalog);
		if (!lines.length) {
			summary.createEl("span", {cls: "fiveetools-view__meta", text: "Draft updates as you choose."});
			return;
		}
		const dl = summary.createEl("dl", {cls: "fiveetools-cc__summary-list"});
		for (const [label, value] of lines) {
			dl.createEl("dt", {text: label});
			dl.createEl("dd", {text: value});
		}
	};

	const paintSide = () => {
		const list = steps();
		let index = stepIndex(stepId, draft, catalog);
		if (!list.some(step => step.id === stepId)) {
			stepId = list[Math.min(index, list.length - 1)]?.id || "concept";
			index = stepIndex(stepId, draft, catalog);
		}
		const step = list[index];
		kicker.setText(`Step ${index + 1} of ${list.length}`);
		titleEl.setText(step?.title || "");
		descEl.setText(stepBlurb(step?.id));
		backBtn.disabled = index === 0 || busy;
		nextBtn.disabled = busy || !stepValid(stepId, draft, catalog);
		nextBtn.setText(index >= list.length - 1 ? "Finish" : "Next");
		errorEl.setText(stepValid(stepId, draft, catalog) ? "" : stepMessage(stepId, draft, catalog));
	};

	const paintBody = () => {
		body.empty();
		switch (stepId) {
			case "concept": paintConcept(body); break;
			case "class": paintClassGrid(body); break;
			case "subclass": paintSubclassGrid(body); break;
			case "abilities": paintAbilities(body); break;
			case "species": paintSpeciesGrid(body); break;
			case "background": paintBackground(body); break;
			case "equipment": paintEquipment(body); break;
			default: break;
		}
	};

	const paint = () => {
		if (catalog && stepId === "subclass" && !subclassesFor(draft, catalog).length) {
			stepId = "abilities";
		}
		paintProgress();
		paintSummary();
		paintSide();
		paintBody();
	};

	function paintConcept (root) {
		root.createEl("label", {cls: "fiveetools-cc__label", text: "Name"});
		const name = root.createEl("input", {
			cls: "fiveetools-campaign__select",
			attr: {type: "text", placeholder: "Character name"},
		});
		name.value = draft.name || "";
		name.addEventListener("input", () => {
			draft.name = name.value;
			emit();
			paintSide();
			paintSummary();
			syncNamePills();
		});
		name.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				name.select();
			}
		});

		const genRow = root.createDiv({cls: "fiveetools-cc__name-gen"});
		const groupSelect = genRow.createEl("select", {
			cls: "fiveetools-campaign__select",
			attr: {"aria-label": "Name generator species"},
		});
		if (!nameGroups.length) {
			groupSelect.createEl("option", {text: "Loading…", attr: {value: ""}});
			groupSelect.disabled = true;
		} else {
			for (const group of nameGroups) {
				groupSelect.createEl("option", {text: group.name, attr: {value: group.name}});
			}
			if (!draft.nameGroup || !nameGroups.some(group => group.name === draft.nameGroup)) {
				draft.nameGroup = nameGroups[0]?.name || "";
			}
			groupSelect.value = draft.nameGroup;
		}
		groupSelect.addEventListener("change", () => {
			draft.nameGroup = groupSelect.value;
			emit();
		});
		const genBtn = genRow.createEl("button", {
			text: "Generate name",
			cls: "fiveetools-btn",
			attr: {type: "button"},
		});
		genBtn.disabled = !nameGroups.length;
		genBtn.addEventListener("click", () => {
			const group = draft.nameGroup || nameGroups[0]?.name || "";
			if (!group) return;
			const used = new Set();
			const suggestions = [];
			for (let i = 0; i < NAME_SUGGESTION_COUNT; i++) {
				try {
					const rolled = rollCharacterName({nameGroup: group}, used);
					const text = String(rolled?.lines?.[0]?.text || "").trim();
					if (text) suggestions.push(text);
				} catch (_) { /* skip failed rolls */ }
			}
			draft.nameGroup = group;
			draft.nameSuggestions = suggestions;
			emit();
			paintPills();
		});

		const pills = root.createDiv({cls: "fiveetools-cc__chips fiveetools-cc__name-pills"});
		const paintPills = () => {
			pills.empty();
			const suggestions = Array.isArray(draft.nameSuggestions) ? draft.nameSuggestions : [];
			if (!suggestions.length) return;
			for (const suggestion of suggestions) {
				const chip = pills.createEl("button", {
					text: suggestion,
					cls: `fiveetools-cc__chip${draft.name === suggestion ? " is-selected" : ""}`,
					attr: {type: "button"},
				});
				chip.addEventListener("click", () => {
					draft.name = suggestion;
					name.value = suggestion;
					emit();
					paintSide();
					paintSummary();
					paintPills();
					name.focus();
				});
			}
		};
		const syncNamePills = () => {
			pills.querySelectorAll(".fiveetools-cc__chip").forEach((el) => {
				el.classList.toggle("is-selected", el.textContent === draft.name);
			});
		};
		paintPills();

		root.createEl("label", {cls: "fiveetools-cc__label", text: "Concept notes"});
		const notes = root.createEl("textarea", {
			cls: "fiveetools-cc__notes",
			attr: {rows: "3", placeholder: "Optional — who is this hero?"},
		});
		notes.value = draft.notes || "";
		notes.addEventListener("input", () => {
			draft.notes = notes.value;
			emit();
			paintSummary();
		});

		root.createEl("label", {cls: "fiveetools-cc__label", text: "Archetype (sorts classes)"});
		const chips = root.createDiv({cls: "fiveetools-cc__chips"});
		for (const arch of CONCEPT_ARCHETYPES) {
			const chip = chips.createEl("button", {
				text: arch.label,
				cls: `fiveetools-cc__chip${draft.archetype === arch.id ? " is-selected" : ""}`,
				attr: {type: "button"},
			});
			chip.addEventListener("click", () => {
				draft.archetype = draft.archetype === arch.id ? "" : arch.id;
				emit();
				paintBody();
				paintSide();
			});
		}
		queueMicrotask(() => name.focus());
	}

	function paintClassGrid (root) {
		const list = sortClassesByArchetype(catalog.classes, draft.archetype);
		const grid = root.createDiv({cls: "fiveetools-cc__grid"});
		for (const ent of list) {
			const card = grid.createEl("button", {
				cls: `fiveetools-cc__card${draft.className === ent.name ? " is-selected" : ""}`,
				attr: {type: "button"},
			});
			card.createEl("div", {cls: "fiveetools-cc__card-title", text: ent.name});
			card.createEl("div", {cls: "fiveetools-cc__card-teaser", text: ent.teaser});
			if (draft.archetype && ent.name && sortHint(ent.name, draft.archetype)) {
				card.createEl("span", {cls: "fiveetools-cc__tag", text: "Suggested"});
			}
			card.addEventListener("click", () => {
				draft.className = ent.name;
				draft.classSource = ent.source;
				draft.classPackage = "";
				draft.subclassName = "";
				draft.subclassSource = "";
				setDetail(ent.name, ent.detail);
				emit();
				paint();
			});
			card.addEventListener("mouseenter", () => setDetail(ent.name, ent.detail));
		}
		if (draft.className) {
			const ent = findClass(catalog, draft.className, draft.classSource);
			if (ent) setDetail(ent.name, ent.detail);
		}
	}

	function paintSubclassGrid (root) {
		const list = subclassesFor(draft, catalog);
		if (!list.length) {
			root.createEl("p", {cls: "fiveetools-view__meta", text: "This class has no subclasses in the 2024 data."});
			return;
		}
		const grid = root.createDiv({cls: "fiveetools-cc__grid"});
		for (const ent of list) {
			const selected = draft.subclassName === ent.name || draft.subclassName === ent.shortName;
			const card = grid.createEl("button", {
				cls: `fiveetools-cc__card${selected ? " is-selected" : ""}`,
				attr: {type: "button"},
			});
			card.createEl("div", {cls: "fiveetools-cc__card-title", text: ent.shortName || ent.name});
			card.createEl("div", {cls: "fiveetools-cc__card-teaser", text: ent.teaser});
			card.addEventListener("click", () => {
				draft.subclassName = ent.name;
				draft.subclassSource = ent.source;
				setDetail(ent.name, ent.detail);
				emit();
				paint();
			});
			card.addEventListener("mouseenter", () => setDetail(ent.name, ent.detail));
		}
		if (draft.subclassName) {
			const ent = list.find(sub => sub.name === draft.subclassName || sub.shortName === draft.subclassName);
			if (ent) setDetail(ent.name, ent.detail);
		}
	}

	function paintAbilities (root) {
		if (!draft.abilityRollStyle) {
			draft.abilityRollStyle = Object.fromEntries(ABILITY_KEYS.map(key => [key, "normal"]));
		}
		if (!draft.abilityRollDetail) {
			draft.abilityRollDetail = Object.fromEntries(ABILITY_KEYS.map(key => [key, null]));
		}

		const methods = root.createDiv({cls: "fiveetools-cc__methods"});
		for (const method of ABILITY_METHODS) {
			const btn = methods.createEl("button", {
				text: method.label,
				cls: `fiveetools-cc__chip${draft.abilityMethod === method.id ? " is-selected" : ""}`,
				attr: {type: "button"},
			});
			btn.addEventListener("click", () => {
				draft.abilityMethod = method.id;
				if (method.id === "standard-array") {
					draft.abilities = Object.fromEntries(ABILITY_KEYS.map((key, i) => [key, STANDARD_ARRAY[i]]));
				} else if (method.id === "point-buy") {
					draft.abilities = Object.fromEntries(ABILITY_KEYS.map(key => [key, 8]));
				} else {
					draft.abilities = Object.fromEntries(ABILITY_KEYS.map(key => [key, null]));
					draft.abilityRollDetail = Object.fromEntries(ABILITY_KEYS.map(key => [key, null]));
				}
				emit();
				paint();
			});
		}

		if (draft.abilityMethod === "roll") {
			const presets = root.createDiv({cls: "fiveetools-cc__methods"});
			presets.createEl("span", {cls: "fiveetools-view__meta", text: "Set all:"});
			for (const style of ROLL_STYLES) {
				const btn = presets.createEl("button", {
					text: style.label,
					cls: "fiveetools-cc__chip",
					attr: {type: "button", title: style.blurb},
				});
				btn.addEventListener("click", () => {
					draft.abilityRollStyle = Object.fromEntries(ABILITY_KEYS.map(key => [key, style.id]));
					emit();
					paint();
				});
			}
			const rollAll = presets.createEl("button", {
				text: "Roll all",
				cls: "fiveetools-btn",
				attr: {type: "button"},
			});
			rollAll.addEventListener("click", () => {
				for (const key of ABILITY_KEYS) applyAbilityRoll(key);
				emit();
				paint();
			});
		}

		const table = root.createDiv({cls: "fiveetools-cc__ability-table"});
		for (const key of ABILITY_KEYS) {
			const row = table.createDiv({
				cls: `fiveetools-cc__ability-row${draft.abilityMethod === "roll" ? " fiveetools-cc__ability-row--roll" : ""}`,
			});
			row.createEl("span", {cls: "fiveetools-cc__ability-name", text: ABILITY_LABELS[key]});
			if (draft.abilityMethod === "point-buy") {
				const minus = row.createEl("button", {text: "−", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button"}});
				row.createEl("span", {cls: "fiveetools-cc__ability-score", text: String(draft.abilities[key] ?? "—")});
				const plus = row.createEl("button", {text: "+", cls: "fiveetools-btn fiveetools-btn--ghost", attr: {type: "button"}});
				row.createEl("span", {
					cls: "fiveetools-cc__ability-mod",
					text: formatMod(abilityModifier(draft.abilities[key])),
				});
				minus.addEventListener("click", () => bumpAbility(key, -1));
				plus.addEventListener("click", () => bumpAbility(key, 1));
			} else if (draft.abilityMethod === "roll") {
				const style = draft.abilityRollStyle[key] === "hero" ? "hero" : "normal";
				const toggles = row.createDiv({cls: "fiveetools-cc__roll-toggles"});
				for (const option of ROLL_STYLES) {
					const chip = toggles.createEl("button", {
						text: option.label,
						cls: `fiveetools-cc__chip fiveetools-cc__chip--tiny${style === option.id ? " is-selected" : ""}`,
						attr: {type: "button", title: option.blurb},
					});
					chip.addEventListener("click", () => {
						draft.abilityRollStyle[key] = option.id;
						emit();
						paint();
					});
				}
				const rollBtn = row.createEl("button", {
					text: "Roll",
					cls: "fiveetools-btn fiveetools-btn--ghost",
					attr: {type: "button"},
				});
				rollBtn.addEventListener("click", () => {
					applyAbilityRoll(key);
					emit();
					paint();
				});
				row.createEl("span", {
					cls: "fiveetools-cc__ability-score",
					text: draft.abilities[key] != null ? String(draft.abilities[key]) : "—",
				});
				row.createEl("span", {
					cls: "fiveetools-cc__ability-mod",
					text: formatMod(abilityModifier(draft.abilities[key])),
				});
				const detail = draft.abilityRollDetail?.[key];
				if (detail) {
					row.createEl("span", {
						cls: "fiveetools-cc__roll-detail",
						text: detail,
					});
				}
			} else {
				const select = row.createEl("select", {cls: "fiveetools-campaign__select"});
				select.createEl("option", {text: "—", attr: {value: ""}});
				const used = new Set(ABILITY_KEYS.filter(k => k !== key && draft.abilities[k] != null).map(k => Number(draft.abilities[k])));
				for (const score of STANDARD_ARRAY) {
					const opt = select.createEl("option", {text: String(score), attr: {value: String(score)}});
					if (used.has(score) && Number(draft.abilities[key]) !== score) opt.disabled = true;
				}
				if (draft.abilities[key] != null) select.value = String(draft.abilities[key]);
				select.addEventListener("change", () => {
					draft.abilities[key] = select.value === "" ? null : Number(select.value);
					emit();
					paint();
				});
				row.createEl("span", {
					cls: "fiveetools-cc__ability-mod",
					text: formatMod(abilityModifier(draft.abilities[key])),
				});
			}
		}

		const meta = root.createDiv({cls: "fiveetools-view__meta"});
		if (draft.abilityMethod === "point-buy") {
			meta.setText(`Point buy: ${pointBuySpent(draft.abilities)} / ${POINT_BUY_TOTAL} spent`);
		} else if (draft.abilityMethod === "roll") {
			meta.setText("Normal = 4d6 drop lowest. Hero = 3d6+6. Toggle per ability, then roll.");
		} else {
			meta.setText("Assign each of 15, 14, 13, 12, 10, 8 once.");
		}
		const hp = estimatedHp(draft, catalog);
		if (hp != null && draft.className) {
			root.createEl("p", {cls: "fiveetools-view__meta", text: `Estimated HP at level 1: ${hp}`});
		}
		setDetail("Ability scores", abilityDetailText(draft.abilityMethod));
	}

	function applyAbilityRoll (key) {
		const style = rollStyleMeta(draft.abilityRollStyle?.[key] || "normal");
		const result = rollDice(style.notation);
		const total = Number(result?.total);
		if (!Number.isFinite(total)) return;
		draft.abilities[key] = total;
		const dice = (result.dice || []).map(die => die.value).join(", ");
		draft.abilityRollDetail[key] = dice
			? `${style.label}: [${dice}]${result.mod ? ` ${result.mod >= 0 ? "+" : ""}${result.mod}` : ""} → ${total}`
			: `${style.label}: ${total}`;
	}

	function bumpAbility (key, delta) {
		const current = Number(draft.abilities[key]) || 8;
		const next = Math.max(8, Math.min(15, current + delta));
		if (next === current) return;
		const trial = {...draft.abilities, [key]: next};
		if (pointBuySpent(trial) > POINT_BUY_TOTAL && next > current) return;
		draft.abilities[key] = next;
		emit();
		paint();
	}

	function paintSpeciesGrid (root) {
		const grid = root.createDiv({cls: "fiveetools-cc__grid"});
		for (const ent of catalog.species) {
			const card = grid.createEl("button", {
				cls: `fiveetools-cc__card${draft.speciesName === ent.name ? " is-selected" : ""}`,
				attr: {type: "button"},
			});
			card.createEl("div", {cls: "fiveetools-cc__card-title", text: ent.name});
			card.createEl("div", {cls: "fiveetools-cc__card-teaser", text: ent.teaser});
			card.addEventListener("click", () => {
				draft.speciesName = ent.name;
				draft.speciesSource = ent.source;
				setDetail(ent.name, ent.detail);
				emit();
				paint();
			});
			card.addEventListener("mouseenter", () => setDetail(ent.name, ent.detail));
		}
		if (draft.speciesName) {
			const ent = findSpecies(catalog, draft.speciesName, draft.speciesSource);
			if (ent) setDetail(ent.name, ent.detail);
		}
	}

	function paintBackground (root) {
		const grid = root.createDiv({cls: "fiveetools-cc__grid"});
		for (const ent of catalog.backgrounds) {
			const card = grid.createEl("button", {
				cls: `fiveetools-cc__card${draft.backgroundName === ent.name ? " is-selected" : ""}`,
				attr: {type: "button"},
			});
			card.createEl("div", {cls: "fiveetools-cc__card-title", text: ent.name});
			card.createEl("div", {cls: "fiveetools-cc__card-teaser", text: ent.teaser});
			card.addEventListener("click", () => {
				draft.backgroundName = ent.name;
				draft.backgroundSource = ent.source;
				draft.backgroundPackage = "";
				draft.backgroundAbility = {};
				draft.backgroundAbilityMode = 0;
				draft._asiSlots = {};
				draft.backgroundAbilityDone = !(ent.abilityModes || []).length;
				setDetail(ent.name, ent.detail);
				emit();
				paint();
			});
			card.addEventListener("mouseenter", () => setDetail(ent.name, ent.detail));
		}

		const ent = draft.backgroundName ? findBackground(catalog, draft.backgroundName, draft.backgroundSource) : null;
		const modes = ent?.abilityModes || [];
		if (modes.length) {
			const box = root.createDiv({cls: "fiveetools-cc__asi"});
			box.createEl("h4", {text: "Ability bonuses"});
			if (modes.length > 1) {
				const modeRow = box.createDiv({cls: "fiveetools-cc__methods"});
				modes.forEach((mode, index) => {
					const label = mode.weights.map(w => `+${w}`).join(" / ");
					const btn = modeRow.createEl("button", {
						text: label,
						cls: `fiveetools-cc__chip${Number(draft.backgroundAbilityMode) === index ? " is-selected" : ""}`,
						attr: {type: "button"},
					});
					btn.addEventListener("click", () => {
						draft.backgroundAbilityMode = index;
						draft.backgroundAbility = {};
						draft._asiSlots = {};
						draft.backgroundAbilityDone = false;
						emit();
						paint();
					});
				});
			}
			const mode = modes[Math.max(0, Math.min(modes.length - 1, Number(draft.backgroundAbilityMode) || 0))];
			box.createEl("p", {
				cls: "fiveetools-view__meta",
				text: `Assign ${mode.weights.map(w => `+${w}`).join(" / ")} among ${mode.from.map(key => ABILITY_LABELS[key]).join(", ")}.`,
			});
			const weightCounts = new Map();
			for (const weight of mode.weights) weightCounts.set(weight, (weightCounts.get(weight) || 0) + 1);
			const slots = [];
			for (const [weight, count] of [...weightCounts.entries()].sort((a, b) => b[0] - a[0])) {
				for (let i = 0; i < count; i++) slots.push({weight, slot: `${weight}-${i}`});
			}
			const assignedBySlot = draft._asiSlots || {};
			for (const slot of slots) {
				const row = box.createDiv({cls: "fiveetools-cc__asi-row"});
				row.createEl("span", {text: `+${slot.weight}`});
				const select = row.createEl("select", {cls: "fiveetools-campaign__select"});
				select.createEl("option", {text: "—", attr: {value: ""}});
				const usedKeys = new Set(Object.values(assignedBySlot).filter(Boolean));
				for (const key of mode.from) {
					const opt = select.createEl("option", {text: ABILITY_LABELS[key], attr: {value: key}});
					if (usedKeys.has(key) && assignedBySlot[slot.slot] !== key) opt.disabled = true;
				}
				if (assignedBySlot[slot.slot]) select.value = assignedBySlot[slot.slot];
				select.addEventListener("change", () => {
					const nextSlots = {...(draft._asiSlots || {}), [slot.slot]: select.value || ""};
					draft._asiSlots = nextSlots;
					const next = {};
					for (const entry of slots) {
						const key = nextSlots[entry.slot];
						if (!key) continue;
						next[key] = (Number(next[key]) || 0) + entry.weight;
					}
					draft.backgroundAbility = next;
					draft.backgroundAbilityDone = backgroundAbilityMatches(mode, next);
					emit();
					paint();
				});
			}
		}
		if (ent) setDetail(ent.name, ent.detail);
	}

	function paintEquipment (root) {
		const cls = findClass(catalog, draft.className, draft.classSource);
		const background = findBackground(catalog, draft.backgroundName, draft.backgroundSource);
		const methods = root.createDiv({cls: "fiveetools-cc__methods"});
		for (const method of [
			{id: "packages", label: "Equipment packages"},
			{id: "wealth", label: "Starting wealth"},
		]) {
			const btn = methods.createEl("button", {
				text: method.label,
				cls: `fiveetools-cc__chip${draft.equipmentMethod === method.id ? " is-selected" : ""}`,
				attr: {type: "button"},
			});
			btn.addEventListener("click", () => {
				draft.equipmentMethod = method.id;
				if (method.id === "wealth") {
					draft.classPackage = "";
					draft.backgroundPackage = "";
					draft.goldCp = parseGoldAlternative(cls?.goldAlternative) || 15000;
				}
				emit();
				paint();
			});
		}

		if (draft.equipmentMethod === "wealth") {
			root.createEl("p", {
				cls: "fiveetools-view__meta",
				text: cls?.goldAlternative
					? `Take class starting wealth instead of packages: ${cls.goldAlternative}. Gear starts empty.`
					: "Starting wealth: 150 gp (no listed alternative). Gear starts empty.",
			});
			setDetail("Starting wealth", "Buy equipment later; inventory begins empty.");
			return;
		}

		paintPackageGroup(root, "Class package", cls?.packages || [], draft.classPackage, (id) => {
			draft.classPackage = id;
			emit();
			paint();
		});
		paintPackageGroup(root, "Background package", background?.packages || [], draft.backgroundPackage, (id) => {
			draft.backgroundPackage = id;
			emit();
			paint();
		});
	}

	function paintPackageGroup (root, heading, packages, selected, onPick) {
		root.createEl("h4", {text: heading});
		if (!packages.length) {
			root.createEl("p", {cls: "fiveetools-view__meta", text: "No packages listed."});
			return;
		}
		const grid = root.createDiv({cls: "fiveetools-cc__grid fiveetools-cc__grid--packages"});
		for (const pkg of packages) {
			const card = grid.createEl("button", {
				cls: `fiveetools-cc__card${selected === pkg.id ? " is-selected" : ""}`,
				attr: {type: "button"},
			});
			card.createEl("div", {cls: "fiveetools-cc__card-title", text: pkg.label});
			card.createEl("div", {cls: "fiveetools-cc__card-teaser", text: pkg.summary || "—"});
			card.addEventListener("click", () => {
				setDetail(pkg.label, pkg.summary || "");
				onPick(pkg.id);
			});
			card.addEventListener("mouseenter", () => setDetail(pkg.label, pkg.summary || ""));
		}
	}

	cancelBtn.addEventListener("click", () => {
		if (busy) return;
		onCancel?.();
	});
	backBtn.addEventListener("click", () => {
		const list = steps();
		const index = stepIndex(stepId, draft, catalog);
		if (index <= 0) return;
		stepId = list[index - 1].id;
		emit();
		paint();
	});
	nextBtn.addEventListener("click", async () => {
		if (!stepValid(stepId, draft, catalog)) {
			errorEl.setText(stepMessage(stepId, draft, catalog));
			return;
		}
		const list = steps();
		const index = stepIndex(stepId, draft, catalog);
		if (index < list.length - 1) {
			stepId = list[index + 1].id;
			emit();
			paint();
			return;
		}
		if (busy) return;
		busy = true;
		paintSide();
		try {
			const card = buildLocalCharacterCard(draft, catalog);
			await saveCharacter(plugin, card);
			new Notice(`Created ${card.name}.`);
			onDone?.({ddbId: card.ddbId});
		} catch (e) {
			new Notice(e.message || "Could not create that character.");
			busy = false;
			paintSide();
		}
	});

	body.createEl("p", {cls: "fiveetools-view__meta", text: "Loading 2024 options…"});
	try {
		const [loadedCatalog, loadedNames] = await Promise.all([
			loadCreatorCatalog(),
			loadNameGroups(plugin),
		]);
		catalog = loadedCatalog;
		nameGroups = loadedNames || [];
		if (!draft.nameGroup && nameGroups[0]?.name) draft.nameGroup = nameGroups[0].name;
		if (!Array.isArray(draft.nameSuggestions)) draft.nameSuggestions = [];
		if (!draft.abilities || ABILITY_KEYS.every(key => draft.abilities[key] == null)) {
			draft.abilities = Object.fromEntries(ABILITY_KEYS.map((key, i) => [key, STANDARD_ARRAY[i]]));
		}
		emit();
		paint();
	} catch (e) {
		host.empty();
		host.createEl("p", {cls: "fiveetools-view__meta", text: e.message || "Could not load creator data."});
		const back = host.createEl("button", {text: "Back", cls: "fiveetools-btn", attr: {type: "button"}});
		back.addEventListener("click", () => onCancel?.());
	}
}

function stepBlurb (id) {
	switch (id) {
		case "concept": return "Name your hero (or generate from a species table), then optionally pick an archetype to sort classes.";
		case "class": return "Pick a 2024 Player’s Handbook class.";
		case "subclass": return "Pick a subclass for this class.";
		case "abilities": return "Standard array, point buy, or roll (Normal 4d6dl / Hero 3d6+6).";
		case "species": return "Choose a 2024 species.";
		case "background": return "Choose a background and assign its ability bonuses.";
		case "equipment": return "Take class and background packages, or starting wealth.";
		default: return "";
	}
}

function abilityDetailText (method) {
	if (method === "point-buy") {
		return `Spend ${POINT_BUY_TOTAL} points. Costs: ${Object.entries(POINT_BUY_COST).map(([s, c]) => `${s}=${c}`).join(", ")}.`;
	}
	if (method === "roll") {
		return "Normal: roll 4d6 six times, drop the lowest die each time.\nHero: roll 3d6+6 six times.\nToggle Normal/Hero per ability, then Roll or Roll all.";
	}
	return "Standard array values must each be used once.";
}

function sortHint (className, archetype) {
	const map = {
		martial: ["Barbarian", "Fighter", "Monk", "Paladin", "Ranger"],
		arcane: ["Wizard", "Sorcerer", "Warlock"],
		divine: ["Cleric", "Paladin"],
		primal: ["Druid", "Ranger", "Barbarian"],
		skill: ["Rogue", "Bard"],
	};
	return (map[archetype] || []).includes(className);
}

function formatMod (mod) {
	const n = Number(mod) || 0;
	return n >= 0 ? `+${n}` : String(n);
}
