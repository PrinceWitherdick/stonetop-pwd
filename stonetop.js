import { registerSettings, getSetting, applyMoveDescriptionBodyClass } from "./module/settings.js";
import { createStonetopActorClass } from "./module/actors/StonetopActor.js";
import { createStonetopItemClass } from "./module/item/StonetopItem.js";
import { createStonetopArcanumSheetClass } from "./module/item/StonetopArcanumSheet.js";
import { createStonetopCharacterSheetClass } from "./module/actors/character/StonetopCharacterSheet.js";
import { createStonetopSteadingSheetClass } from "./module/actors/steading/StonetopSteadingSheet.js";
import { createStonetopMonsterSheetClass } from "./module/actors/monster/StonetopMonsterSheet.js";
import { createStonetopNpcSheetClass } from "./module/actors/npc/StonetopNpcSheet.js";
import { createStonetopGmToolkitSheetClass } from "./module/actors/gmtoolkit/StonetopGmToolkitSheet.js";
import { BestiaryPageModel } from "./module/journal/BestiaryPageModel.js";
import { LocationPageModel } from "./module/journal/LocationPageModel.js";
import { CharacterModel } from "./module/data-models/CharacterModel.js";
import { SteadingModel } from "./module/data-models/SteadingModel.js";
import { MonsterModel } from "./module/data-models/MonsterModel.js";
import { NpcModel } from "./module/data-models/NpcModel.js";
import { GmToolkitModel } from "./module/data-models/GmToolkitModel.js";
import { MoveModel } from "./module/data-models/MoveModel.js";
import { PlaybookModel } from "./module/data-models/PlaybookModel.js";
import { NpcMoveModel } from "./module/data-models/NpcMoveModel.js";
import { MonsterMoveModel } from "./module/data-models/MonsterMoveModel.js";
import { createStonetopBestiaryPageSheetClass } from "./module/journal/StonetopBestiaryPageSheet.js";
import { createStonetopLocationPageSheetClass } from "./module/journal/StonetopLocationPageSheet.js";
import { ThreatPageModel } from "./module/journal/ThreatPageModel.js";
import { createStonetopThreatPageSheetClass } from "./module/journal/StonetopThreatPageSheet.js";
import { HazardPageModel } from "./module/journal/HazardPageModel.js";
import { createStonetopHazardPageSheetClass } from "./module/journal/StonetopHazardPageSheet.js";
import { SitePageModel } from "./module/journal/SitePageModel.js";
import { createStonetopSitePageSheetClass } from "./module/journal/StonetopSitePageSheet.js";
import { ThreatBoard } from "./module/threats/threat-board.js";
import { onReady } from "./module/hooks/Ready.js";
import { handleImportedJournalArt, ART_INDEX_SETTINGS } from "./module/book2-art/reapply.js";
import { clearArtBrowseCache, ART_BROWSE_INPUTS } from "./module/book2-art/browse.js";
import { onRenderActorSheet } from "./module/hooks/RenderActorSheet.js";
import { onHotbarDrop } from "./module/hooks/HotbarDrop.js";
import { onDropPlaceOfInterest } from "./module/hooks/PlaceOfInterestDrop.js";
import { onDropFollower } from "./module/hooks/FollowerDrop.js";
import { onPreUpdateActorDeathsDoor, onUpdateActorDeathsDoorAutoOpen, onUpdateActorDeathsDoorCard, onUpdateActorDeathsDoorRaised, wireDyingPrompt } from "./module/hooks/DeathsDoorPrompt.js";
import { deathDripStamp, markDeathDrip } from "./module/hooks/DeathChatDrip.js";
import { onPreCreateThreatNote } from "./module/hooks/ThreatNotePins.js";
import { onDrawStonetopNote } from "./module/hooks/StonetopNoteLabels.js";
import { registerExpeditionRouteHooks } from "./module/hooks/ExpeditionRouteOverlay.js";
import { bumpEncounterNotesGeneration } from "./module/actors/gmtoolkit/gm-encounters-tab.js";
import { invalidateMonsterRefIndex } from "./module/bestiary/monster-ref-index.js";
import { ensureLocationSummaryIndex, applyTooltipsThenRestrict } from "./module/locations/location-tooltips.js";
import { hideBrokenJournalArt } from "./module/journal/hide-broken-art.js";
import { addJournalShareButton } from "./module/journal/share-journal.js";
import { patchJournalImagePopoutTitles } from "./module/journal/journal-image-titles.js";
import { onRenderPause } from "./module/hooks/RenderPause.js";
import { onRenderCompendiumItemIcons } from "./module/hooks/CompendiumItemIcons.js";
import { decoratePortraitRow, onUpdateActorPortraitFrame } from "./module/hooks/ActorDirectoryPortraits.js";
import { decorateNameRow, onUpdateActorPlaybookName } from "./module/hooks/ActorDirectoryNames.js";
import { decorateActorDirectoryRows } from "./module/hooks/actor-directory-rows.js";
import { onUpdateCondemned } from "./module/hooks/CondemnedTag.js";
import { characterFullName } from "./module/utils/playbook-actors.js";
import { registerStonetopSingletonHooks } from "./module/hooks/StonetopSingleton.js";
import { info } from "./module/utils/logger.js";
import { boldMissText } from "./module/utils/strings.js";
import { hbsTruthy } from "./module/utils/hbs-truthy.js";
import { rollSeasonsCard, sign, SPRING_SEASONS_RESULT, xpToLevelUp, markMissXp } from "./module/utils/roll-engine.js";
import { formatOutcomeDetail, escHtml } from "./module/utils/strings.js";
import { moveChatCard } from "./module/utils/chat.js";
import { isKnowThings, logbookUses, LOGBOOK, STRONG_HIT_TOTAL } from "./module/actors/character/know-things.js";
import { artifactStateForTier } from "./module/actors/character/artifact-identify.js";
import { wireAttackConfirm, wireApplyDamage, wireSufferAttack } from "./module/combat/attack-flow.js";
import { markQuestionBullets } from "./module/utils/question-bullets.js";
import { wrapGlyphTextContainers } from "./module/utils/glyphs.js";
import { applyJournalSpiralBullets, resolveEntry } from "./module/utils/journal-spiral-bullets.js";
import { applyTreasureDrops } from "./module/utils/treasure-drops.js";
import { applyGearTermTooltips } from "./module/utils/gear-term-tooltips.js";
import { SETTING_OVERVIEW_JOURNAL } from "./module/utils/seeded-journals.js";
import { applyJournalCheckboxes } from "./module/utils/journal-checkboxes.js";
import { applyJournalRollTables } from "./module/utils/journal-roll-tables.js";
import { bindSteadingImprovementDrag } from "./module/journal/steading-improvement-cards.js";
import { bindThreatSeedDrag } from "./module/threats/threat-seed-cards.js";
import { maybeAnnounceBecameHero } from "./module/actors/character/WouldBeHeroAsterisk.js";
import { StonetopSteading } from "./module/actors/steading/StonetopSteading.js";
import { onSteadingPeopleUpdate, repaintOpenSteadingRosters } from "./module/actors/steading/steading-people.js";
import { makeDialogsResizable, enableAutoHeightVerticalResize } from "./module/utils/resizable-dialogs.js";
import { registerStonetopWindowTheme, registerStonetopLightTheme } from "./module/utils/window-theme.js";
import { installWindowRestore } from "./module/utils/window-restore.js";
import { registerUuidRedirects } from "./module/migration/compat.js";
import { adoptLegacyClientSettings } from "./module/migration/copy-settings.js";
import { SYSTEM_ID } from "./module/system-id.js";
import { bootStep, recordBootPhase, reportBootHealth, bootReport } from "./module/utils/boot-guard.js";

// -- INIT ------------------------------------------------------
Hooks.once("init", () => {
	info("Initializing");

	// Before ANY setting is read: adopt this browser's client-scope preferences from an
	// older system id. localStorage is per-browser, so the GM's migration only ever fixed
	// the GM's own machine; without this every player silently reverts to defaults. Must
	// precede registerSettings and onReady, which applies the sheet font on its first line.
	// Wrapped, like the two steps below it, so a throw here is named and reported rather than only
	// logged by Foundry and forgotten. Foundry catches a hook that throws and carries on with the
	// next listener, so a failure in this run leaves a world that opens, looks right, and has
	// silently registered none of the settings that come after it. See utils/boot-guard.js.
	bootStep("adoptLegacyClientSettings", adoptLegacyClientSettings);

	// Before anything can resolve a UUID: make every compendium link written under an
	// older system id resolve against the current packs. This covers @UUID text, already
	// serialized content-link anchors, embeds and compendiumSource lookups alike, so no
	// stored string has to be rewritten for a renamed system to keep working.
	bootStep("registerUuidRedirects", registerUuidRedirects);

	bootStep("registerSettings", registerSettings);
	registerStonetopSingletonHooks();

	// Every window and modal in the system is drag-resizable; the ad-hoc
	// Dialog popups we spawn from sheets default to resizable too. The companion
	// patch lets auto-height windows (most of our modals) be dragged taller/shorter,
	// which core otherwise blocks by refitting auto-height windows to their content.
	makeDialogsResizable();
	enableAutoHeightVerticalResize();

	// Title the click-to-enlarge image popout with the JournalEntry's name (e.g.
	// "Huffel Peaks") instead of the blank fallback core uses for art embedded in
	// page content. See module/journal/journal-image-titles.js.
	patchJournalImagePopoutTitles();

	// Skin a curated allowlist of core Foundry windows (e.g. User Configuration)
	// to match our sheets/modals; scoped to a marker class so nothing else moves.
	registerStonetopWindowTheme();

	// Our parchment skin has no dark variant, so hold every Stonetop window to the
	// light theme even in a dark-mode world. Core already does this for AppV1; this
	// covers our ApplicationV2 windows. Native Foundry windows are left alone.
	registerStonetopLightTheme();

	// Track open document sheets + their geometry and reopen them at the same spot on
	// the next reload (per-client; toggled by the "Restore Open Windows on Reload"
	// setting). Registers its own render/close tracking hooks and a ready-time restore.
	installWindowRestore();

	Handlebars.registerHelper("format", (key, options) => game.i18n.format(String(key), options.hash));
	// For the one shape Handlebars can't express on its own: a localised string that carries its
	// own markup (so it has to be emitted with `{{{ }}}`) around a value that does not (so the
	// value has to be escaped before it goes in). Without this, `{{{format …}}}` is a hole and
	// `{{format …}}` prints the string's own <strong> at the reader.
	Handlebars.registerHelper("escapeHtml", value => escHtml(value));
	Handlebars.registerHelper("boldMissText", value => boldMissText(value));
	Handlebars.registerHelper("eq", (a, b) => a === b);
	// `hbsTruthy`, never bare `Boolean`: these three sit beside `{{#if}}` in the same
	// expression and have to answer the same way, and an EMPTY ARRAY is the case where
	// plain JS truthiness doesn't — truthy to `Boolean`, falsy to `{{#if}}`. See
	// utils/hbs-truthy.js. `.slice(0, -1)` drops the options object Handlebars appends.
	Handlebars.registerHelper("or", (...args) => args.slice(0, -1).some(hbsTruthy));
	Handlebars.registerHelper("and", (...args) => args.slice(0, -1).every(hbsTruthy));
	Handlebars.registerHelper("not", value => !hbsTruthy(value));
	// No `concat` here on purpose: core already registers one (its own doc example is
	// exactly our use, building an id out of a loop variable), and Handlebars helpers are
	// global to the Foundry runtime — re-registering it would shadow core's for every
	// other package, including the `join=` hash ours wouldn't honour.

	const _STAT_LABEL_KEYS = {
		str: "stonetop.character.stats.strength",
		dex: "stonetop.character.stats.dexterity",
		int: "stonetop.character.stats.intelligence",
		wis: "stonetop.character.stats.wisdom",
		con: "stonetop.character.stats.constitution",
		cha: "stonetop.character.stats.charisma",
	};
	Handlebars.registerHelper("statLabel", key => game.i18n.localize(_STAT_LABEL_KEYS[String(key)] ?? String(key)));

	Handlebars.registerHelper("resourceChecks", resource => {
		if (!resource) return [];
		const { current, max, labels } = resource;
		return Array.from({ length: max }, (_, i) => ({ checked: i < current, label: labels[i] || null }));
	});

	// Same circles as resourceChecks, but chunked into fixed-size groups (default 5)
	// so a long track (e.g. a fully-upgraded sacred pouch's Stock) reads in fives.
	// Each item keeps its absolute index; groups stay atomic so they never split
	// across a wrapped row and every wrapped row aligns under the first circle.
	Handlebars.registerHelper("resourceGroups", (resource, size) => {
		if (!resource) return [];
		const { current, max } = resource;
		const labels = resource.labels || [];
		const n = Number(size) > 0 ? Number(size) : 5;
		const items = Array.from({ length: max }, (_, i) => ({ checked: i < current, label: labels[i] || null, index: i }));
		const groups = [];
		for (let i = 0; i < items.length; i += n) groups.push(items.slice(i, i + n));
		return groups;
	});

	const _flatPoolItems = pool => {
		if (!pool) return [];
		const total = pool.max ?? 9;
		return Array.from({ length: total }, (_, i) => ({ checked: i < pool.current, index: i }));
	};

	Handlebars.registerHelper("poolItems", _flatPoolItems);

	Handlebars.registerHelper("poolGroups", pool => {
		const items = _flatPoolItems(pool);
		const groups = [];
		for (let i = 0; i < items.length; i += 3) groups.push(items.slice(i, i + 3));
		return groups;
	});

	Handlebars.registerHelper("times", n => Array.from({ length: n ?? 0 }, (_, i) => i));

	Handlebars.registerHelper("repeatChecks", move => {
		if (!move?.repeat) return [];
		const { max, current } = move.repeat;
		const lastOwnedId = move.ownedIds[move.ownedIds.length - 1] ?? null;
		return Array.from({ length: max }, (_, i) => ({
			checked:  i < current,
			ownedId:  i < current ? lastOwnedId : null,
			disabled: move.isStarting || move.locked || (!(i < current) && i !== current),
		}));
	});

	Handlebars.registerHelper("steadingTrack", (currentValue, defaultValue = 0) => {
		const raw = currentValue?.value ?? currentValue;
		const current = Number(raw ?? defaultValue);
		return Array.from({ length: 5 }, (_, i) => {
			const val = i - 1;
			return { val, label: (val >= 0 ? "+" : "") + val, checked: val === current };
		});
	});

	Handlebars.registerHelper("steadingDefenseTrack", (currentValue, defaultValue = 0) => {
		const raw = currentValue?.value ?? currentValue;
		const current = Number(raw ?? defaultValue);
		const sublabels = ["feeble", "mediocre", "strong", "formidable", "legendary"];
		return Array.from({ length: 5 }, (_, i) => {
			const val = i - 1;
			return { val, label: (val >= 0 ? "+" : "") + val, sublabel: sublabels[i], checked: val === current };
		});
	});

	CONFIG.Actor.documentClass = createStonetopActorClass(CONFIG.Actor.documentClass);
	CONFIG.Item.documentClass  = createStonetopItemClass(CONFIG.Item.documentClass);

	// System data models for each Actor/Item subtype (replaces template.json).
	CONFIG.Actor.dataModels ??= {};
	CONFIG.Item.dataModels  ??= {};
	CONFIG.Actor.dataModels.character = CharacterModel;
	CONFIG.Actor.dataModels.stonetop  = SteadingModel;
	CONFIG.Actor.dataModels.monster   = MonsterModel;
	CONFIG.Actor.dataModels.npc       = NpcModel;
	CONFIG.Actor.dataModels.gmToolkit = GmToolkitModel;
	CONFIG.Item.dataModels.move        = MoveModel;
	CONFIG.Item.dataModels.playbook    = PlaybookModel;
	CONFIG.Item.dataModels.npcMove     = NpcMoveModel;
	CONFIG.Item.dataModels.monsterMove = MonsterMoveModel;

	// Compendium rows are built from the pack INDEX, not from Item documents, so they never see
	// StonetopItem#thumbnail. Core indexes _id/name/img/type/sort/folder — enough to know an item
	// is a `move`, but not which KIND, and `move` is the catch-all sub-type that covers gear and
	// arcana too. Index moveType so onRenderCompendiumItemIcons can pick the same marker the
	// sidebar does. See module/utils/item-icon.js.
	CONFIG.Item.compendiumIndexFields ??= [];
	if (!CONFIG.Item.compendiumIndexFields.includes("system.moveType")) {
		CONFIG.Item.compendiumIndexFields.push("system.moveType");
	}

	const StonetopCharacterSheet = createStonetopCharacterSheetClass(ActorSheet);
	Actors.registerSheet(SYSTEM_ID, StonetopCharacterSheet, {
		types:       ["character"],
		makeDefault: true,
		label:       "Stonetop Character Sheet",
	});

	const StonetopSteadingSheet = createStonetopSteadingSheetClass(ActorSheet);
	Actors.registerSheet(SYSTEM_ID, StonetopSteadingSheet, {
		types:       ["stonetop"],
		makeDefault: true,
		label:       "Stonetop Steading Sheet",
	});

	const StonetopMonsterSheet = createStonetopMonsterSheetClass(ActorSheet);
	Actors.registerSheet(SYSTEM_ID, StonetopMonsterSheet, {
		types:       ["monster"],
		makeDefault: true,
		label:       "Stonetop Monster Sheet",
	});

	const StonetopNpcSheet = createStonetopNpcSheetClass(ActorSheet);
	Actors.registerSheet(SYSTEM_ID, StonetopNpcSheet, {
		types:       ["npc"],
		makeDefault: true,
		label:       "Stonetop NPC Sheet",
	});

	// The GM's own sheet: the screen-side companion to the GM playbook. Modern layout only
	// (no classic variant), so it takes no `layoutClasses` and registers no per-sheet layout
	// setting. See module/actors/gmtoolkit/StonetopGmToolkitSheet.js.
	const StonetopGmToolkitSheet = createStonetopGmToolkitSheetClass(ActorSheet);
	Actors.registerSheet(SYSTEM_ID, StonetopGmToolkitSheet, {
		types:       ["gmToolkit"],
		makeDefault: true,
		label:       "Stonetop GM Toolkit",
	});

	// Bestiary entry as a custom JournalEntryPage subtype.
	CONFIG.JournalEntryPage.dataModels ??= {};
	CONFIG.JournalEntryPage.dataModels["bestiary"] = BestiaryPageModel;
	const JournalPageSheetV1 = foundry.appv1?.sheets?.JournalPageSheet ?? globalThis.JournalPageSheet;
	const StonetopBestiaryPageSheet = createStonetopBestiaryPageSheetClass(JournalPageSheetV1);
	foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, SYSTEM_ID, StonetopBestiaryPageSheet, {
		types:       ["bestiary"],
		makeDefault: true,
		label:       "Stonetop Bestiary Page",
	});

	// Gazetteer places as a structured JournalEntryPage subtype (sectioned, with
	// per-section inline editing) — mirrors the bestiary page above.
	CONFIG.JournalEntryPage.dataModels["location"] = LocationPageModel;
	const StonetopLocationPageSheet = createStonetopLocationPageSheetClass(JournalPageSheetV1);
	foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, SYSTEM_ID, StonetopLocationPageSheet, {
		types:       ["location"],
		makeDefault: true,
		label:       "Stonetop Location Page",
	});

	// The Chronicle (session-zero record) reuses the same sectioned page model + sheet,
	// so its Bonds / Asked-of-the-others Q&A is inline-editable like a location's "In
	// Play" questions. Chronicle pages set every section's group to "glance", so no act
	// banners render. See utils/chronicle.js.
	CONFIG.JournalEntryPage.dataModels["chronicle"] = LocationPageModel;
	foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, SYSTEM_ID, StonetopLocationPageSheet, {
		types:       ["chronicle"],
		makeDefault: true,
		label:       "Stonetop Chronicle Page",
	});

	// Threats: GM-prep pages (Book I "Threats"). Each threat is a `threat` page inside a
	// GM-only per-steading Threats entry; the sheet is the book-styled interactive card
	// (live doom track), dropped onto scenes as a linked Note. See module/threats/.
	CONFIG.JournalEntryPage.dataModels["threat"] = ThreatPageModel;
	const StonetopThreatPageSheet = createStonetopThreatPageSheetClass(JournalPageSheetV1);
	foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, SYSTEM_ID, StonetopThreatPageSheet, {
		types:       ["threat"],
		makeDefault: true,
		label:       "Stonetop Threat Page",
	});

	// Hazards: the environmental half of Book I "Dangers" (pp. 381-389), threats'
	// sibling GM-prep page type. Same one-entry-per-page storage/visibility
	// architecture; authored via the Make-a-Hazard walkthrough. See module/hazards/.
	CONFIG.JournalEntryPage.dataModels["hazard"] = HazardPageModel;
	const StonetopHazardPageSheet = createStonetopHazardPageSheetClass(JournalPageSheetV1);
	foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, SYSTEM_ID, StonetopHazardPageSheet, {
		types:       ["hazard"],
		makeDefault: true,
		label:       "Stonetop Hazard Page",
	});

	// Sites: interesting places the PCs can explore (Book I "Sites", pp. 345-377), the third
	// GM-prep page type. Same one-entry-per-page storage/visibility architecture as threats
	// and hazards; authored via the Create-a-Site walkthrough. See module/sites/.
	CONFIG.JournalEntryPage.dataModels["site"] = SitePageModel;
	const StonetopSitePageSheet = createStonetopSitePageSheetClass(JournalPageSheetV1);
	foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, SYSTEM_ID, StonetopSitePageSheet, {
		types:       ["site"],
		makeDefault: true,
		label:       "Stonetop Site Page",
	});

	const StonetopArcanumSheet = createStonetopArcanumSheetClass(ItemSheet);
	Items.registerSheet(SYSTEM_ID, StonetopArcanumSheet, {
		types:       ["move"],
		makeDefault: false,
		label:       "Stonetop Arcanum",
	});

	// Kick off the sheet-partial preload now so the fetches run in parallel during init.
	// Core does NOT await init-hook callbacks (Hooks.callAll discards the returned promise),
	// so awaiting here would order nothing — instead we stash the promise and onReady awaits
	// it before any auto-opening sheet/walkthrough render, which is where a "partial could
	// not be found" race would actually bite.
	game.stonetop ??= {};
	game.stonetop.templatesReady = loadTemplates({
		"stonetop.arcanum-sheet":      "systems/stonetop-pwd/templates/item/arcanum-sheet.hbs",
		"stonetop.arcanum-sheet-edit": "systems/stonetop-pwd/templates/item/arcanum-sheet-edit.hbs",
		"stonetop.actor-header":     "systems/stonetop-pwd/templates/actor/partials/actor-header.hbs",
		"stonetop.portrait-frame-pip": "systems/stonetop-pwd/templates/actor/partials/portrait-frame-pip.hbs",
		"stonetop.condemned-tag":     "systems/stonetop-pwd/templates/actor/partials/condemned-tag.hbs",
		"stonetop.actor-stats":      "systems/stonetop-pwd/templates/actor/partials/actor-stats.hbs",
		"stonetop.actor-vitals":     "systems/stonetop-pwd/templates/actor/partials/actor-vitals.hbs",
		"stonetop.stat-block":       "systems/stonetop-pwd/templates/actor/partials/stat-block.hbs",
		"stonetop.tab-details":      "systems/stonetop-pwd/templates/actor/partials/tab-details.hbs",
		"stonetop.tab-moves":        "systems/stonetop-pwd/templates/actor/partials/tab-moves.hbs",
		"stonetop.tab-equipment":    "systems/stonetop-pwd/templates/actor/partials/tab-equipment.hbs",
		"stonetop.tab-invocations":  "systems/stonetop-pwd/templates/actor/partials/tab-invocations.hbs",
		"stonetop.tab-followers":    "systems/stonetop-pwd/templates/actor/partials/tab-followers.hbs",
		"stonetop.tab-arcana":       "systems/stonetop-pwd/templates/actor/partials/tab-arcana.hbs",
		"stonetop.tab-post-death":      "systems/stonetop-pwd/templates/actor/partials/tab-post-death.hbs",
		"stonetop.tab-special-moves":   "systems/stonetop-pwd/templates/actor/partials/tab-special-moves.hbs",
		"stonetop.tab-notes":           "systems/stonetop-pwd/templates/actor/partials/tab-notes.hbs",
		"stonetop.tab-rail-item":       "systems/stonetop-pwd/templates/actor/partials/tab-rail-item.hbs",
		"stonetop.tab-nav-item":        "systems/stonetop-pwd/templates/actor/partials/tab-nav-item.hbs",
		"stonetop.npc-quick-facts":     "systems/stonetop-pwd/templates/actor/partials/npc-quick-facts.hbs",
		"stonetop.npc-tab-nav":         "systems/stonetop-pwd/templates/actor/partials/npc-tab-nav.hbs",
		"stonetop.move-group":           "systems/stonetop-pwd/templates/actor/partials/move-group.hbs",
		"stonetop.tab-search-control":   "systems/stonetop-pwd/templates/actor/partials/tab-search-control.hbs",
		"stonetop.catalog-shell":        "systems/stonetop-pwd/templates/dialogs/partials/catalog-shell.hbs",
		// Rendered by BOTH Death's Door's last step and the standalone Post-Death chooser.
		"stonetop.post-death-choices":   "systems/stonetop-pwd/templates/dialogs/partials/post-death-choices.hbs",
		"stonetop.move-mark-level":      "systems/stonetop-pwd/templates/actor/partials/move-mark-level.hbs",
		"stonetop.sidebar-move-list":    "systems/stonetop-pwd/templates/actor/partials/sidebar-move-list.hbs",
		"stonetop.lore-section":          "systems/stonetop-pwd/templates/actor/partials/lore-section.hbs",
		"stonetop.lore-options-edit":     "systems/stonetop-pwd/templates/actor/partials/lore-options-edit.hbs",
		"stonetop.lore-options-readonly": "systems/stonetop-pwd/templates/actor/partials/lore-options-readonly.hbs",
		"stonetop.lore-arcana-image":     "systems/stonetop-pwd/templates/actor/partials/lore-arcana-image.hbs",
		"stonetop.relationships-table":  "systems/stonetop-pwd/templates/actor/partials/relationships-table.hbs",
		"stonetop.relationships-board": "systems/stonetop-pwd/templates/actor/partials/relationships-board.hbs",
		"stonetop.relationships-view":  "systems/stonetop-pwd/templates/actor/partials/relationships-view.hbs",
		"stonetop.relationships-viewbar": "systems/stonetop-pwd/templates/actor/partials/relationships-viewbar.hbs",
		"stonetop.section-heading":  "systems/stonetop-pwd/templates/actor/partials/section-heading.hbs",
		"stonetop.section-collapse": "systems/stonetop-pwd/templates/actor/partials/section-collapse.hbs",
		"stonetop.section-randomize": "systems/stonetop-pwd/templates/actor/partials/section-randomize.hbs",
		"stonetop.section-edit-toggle": "systems/stonetop-pwd/templates/actor/partials/section-edit-toggle.hbs",
		"stonetop.details-section-edit-toggle": "systems/stonetop-pwd/templates/actor/partials/details-section-edit-toggle.hbs",
		"stonetop.follower-section-edit": "systems/stonetop-pwd/templates/actor/partials/follower-section-edit.hbs",
		"stonetop.resource-track":   "systems/stonetop-pwd/templates/actor/partials/resource-track.hbs",
		"stonetop.inv-note":         "systems/stonetop-pwd/templates/actor/partials/inv-note.hbs",
		"stonetop.inv-item-regular": "systems/stonetop-pwd/templates/actor/partials/inv-item-regular.hbs",
		"stonetop.inv-item-small":   "systems/stonetop-pwd/templates/actor/partials/inv-item-small.hbs",
		"stonetop.inv-artifact":     "systems/stonetop-pwd/templates/actor/partials/inv-artifact.hbs",
		"stonetop.choice-gear-row":  "systems/stonetop-pwd/templates/actor/partials/choice-gear-row.hbs",
		"stonetop.steading-header-season":    "systems/stonetop-pwd/templates/actor/partials/steading-header-season.hbs",
		"stonetop.steading-section-toggle":   "systems/stonetop-pwd/templates/actor/partials/steading-section-toggle.hbs",
		"stonetop.steading-stats-bar":        "systems/stonetop-pwd/templates/actor/partials/steading-stats-bar.hbs",
		"stonetop.steading-settlements-card": "systems/stonetop-pwd/templates/actor/partials/steading-settlements-card.hbs",
		"stonetop.steading-moves-sidebar":    "systems/stonetop-pwd/templates/actor/partials/steading-moves-sidebar.hbs",
		"stonetop.steading-move-controls":    "systems/stonetop-pwd/templates/actor/partials/steading-move-controls.hbs",
		"stonetop.steading-tab-overview":     "systems/stonetop-pwd/templates/actor/partials/steading-tab-overview.hbs",
		"stonetop.steading-tab-neighbors":    "systems/stonetop-pwd/templates/actor/partials/steading-tab-neighbors.hbs",
		"stonetop.steading-tab-improvements": "systems/stonetop-pwd/templates/actor/partials/steading-tab-improvements.hbs",
		"stonetop.steading-tab-moves":        "systems/stonetop-pwd/templates/actor/partials/steading-tab-moves.hbs",
		"stonetop.steading-tab-notes":        "systems/stonetop-pwd/templates/actor/partials/steading-tab-notes.hbs",
		"stonetop.gm-toolkit-tab-moves":      "systems/stonetop-pwd/templates/actor/partials/gm-toolkit-tab-moves.hbs",
		"stonetop.gm-toolkit-tab-loop":       "systems/stonetop-pwd/templates/actor/partials/gm-toolkit-tab-loop.hbs",
		"stonetop.gm-toolkit-tab-threats":    "systems/stonetop-pwd/templates/actor/partials/gm-toolkit-tab-threats.hbs",
		"stonetop.gm-toolkit-tab-sites":      "systems/stonetop-pwd/templates/actor/partials/gm-toolkit-tab-sites.hbs",
		"stonetop.gm-toolkit-tab-homefront":  "systems/stonetop-pwd/templates/actor/partials/gm-toolkit-tab-homefront.hbs",
		"stonetop.gm-toolkit-tab-wonder":     "systems/stonetop-pwd/templates/actor/partials/gm-toolkit-tab-wonder.hbs",
		"stonetop.gm-toolkit-tab-encounters": "systems/stonetop-pwd/templates/actor/partials/gm-toolkit-tab-encounters.hbs",
		"stonetop.gm-prep-card-tools":        "systems/stonetop-pwd/templates/actor/partials/gm-prep-card-tools.hbs",
		"stonetop.gm-prep-add-bar":           "systems/stonetop-pwd/templates/actor/partials/gm-prep-add-bar.hbs",
		"stonetop.gm-prep-no-steading":       "systems/stonetop-pwd/templates/actor/partials/gm-prep-no-steading.hbs",
		"stonetop.gm-prep-guide-items":       "systems/stonetop-pwd/templates/actor/partials/gm-prep-guide-items.hbs",
		"stonetop.monster-sheet":             "systems/stonetop-pwd/templates/actor/monster.hbs",
		"stonetop.npc-sheet":                 "systems/stonetop-pwd/templates/actor/npc.hbs",
		"stonetop.bestiary-line-list":        "systems/stonetop-pwd/templates/actor/partials/bestiary-line-list.hbs",
		"stonetop.bestiary-page":             "systems/stonetop-pwd/templates/journal/bestiary.hbs",
		"stonetop.location-page":             "systems/stonetop-pwd/templates/journal/location.hbs",
		"stonetop.threat-page":               "systems/stonetop-pwd/templates/journal/threat-page.hbs",
		"stonetop.threat-card":               "systems/stonetop-pwd/templates/journal/partials/threat-card.hbs",
		"stonetop.hazard-page":               "systems/stonetop-pwd/templates/journal/hazard-page.hbs",
		"stonetop.hazard-card":               "systems/stonetop-pwd/templates/journal/partials/hazard-card.hbs",
		"stonetop.site-page":                 "systems/stonetop-pwd/templates/journal/site-page.hbs",
		"stonetop.site-card":                 "systems/stonetop-pwd/templates/journal/partials/site-card.hbs",
		"stonetop.bestiary-section-head":     "systems/stonetop-pwd/templates/journal/partials/bestiary-section-head.hbs",
		"stonetop.bestiary-group-section":    "systems/stonetop-pwd/templates/journal/partials/bestiary-group-section.hbs",
		"stonetop.introductions-dialog":      "systems/stonetop-pwd/templates/dialogs/introductions.hbs",
		"stonetop.guide-toc":                 "systems/stonetop-pwd/templates/dialogs/partials/guide-toc.hbs",
		"stonetop.expedition-journey":        "systems/stonetop-pwd/templates/dialogs/partials/expedition-journey.hbs",
		"stonetop.expedition-journey-pins":   "systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-pins.hbs",
		"stonetop.expedition-journey-controls": "systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-controls.hbs",
		"stonetop.expedition-journey-route":  "systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-route.hbs",
		"stonetop.intros-capture-head":       "systems/stonetop-pwd/templates/dialogs/partials/intros-capture-head.hbs",
		"stonetop.threat-string-list":        "systems/stonetop-pwd/templates/dialogs/partials/threat-string-list.hbs",
		"stonetop.cs-list-frame":             "systems/stonetop-pwd/templates/dialogs/partials/cs-list-frame.hbs",
		"stonetop.cs-line-list":              "systems/stonetop-pwd/templates/dialogs/partials/cs-line-list.hbs",
		"stonetop.cs-pair-list":              "systems/stonetop-pwd/templates/dialogs/partials/cs-pair-list.hbs",
		"stonetop.cs-pick-slots":             "systems/stonetop-pwd/templates/dialogs/partials/cs-pick-slots.hbs",
		"stonetop.settings-toggle-row":       "systems/stonetop-pwd/templates/settings/partials/settings-toggle-row.hbs",
		"stonetop.settings-save-footer":      "systems/stonetop-pwd/templates/settings/partials/settings-save-footer.hbs",
		"stonetop.roster-row":                "systems/stonetop-pwd/templates/dialogs/partials/roster-row.hbs",
		"stonetop.roster-add":                "systems/stonetop-pwd/templates/dialogs/partials/roster-add.hbs",
		"stonetop.deaths-door-outcomes":      "systems/stonetop-pwd/templates/dialogs/partials/deaths-door-outcomes.hbs",
		"stonetop.artifact-gm":              "systems/stonetop-pwd/templates/dialogs/artifact-gm.hbs",
		"stonetop.header-toggle-glyph":       "systems/stonetop-pwd/templates/actor/partials/header-toggle-glyph.hbs",
		"stonetop.header-count-glyph":        "systems/stonetop-pwd/templates/actor/partials/header-count-glyph.hbs",
		"stonetop.card-head":                 "systems/stonetop-pwd/templates/journal/partials/card-head.hbs",
		"stonetop.card-doom-track":           "systems/stonetop-pwd/templates/journal/partials/card-doom-track.hbs",
		"stonetop.card-gm-moves":             "systems/stonetop-pwd/templates/journal/partials/card-gm-moves.hbs",
		"stonetop.card-player-moves":         "systems/stonetop-pwd/templates/journal/partials/card-player-moves.hbs",
		"stonetop.site-group":                "systems/stonetop-pwd/templates/journal/partials/site-group.hbs",
	});

	// Last line of `init`, so reaching it means the whole run got through. A world that never
	// records this has a partial boot however healthy it looks, which is what reportBootHealth
	// says out loud once the world is up.
	recordBootPhase("init");
});

// -- RENDER PAUSE ----------------------------------------------
// "renderPause" (v11) was renamed in v12+; cover all known variants and
// pauseGame so the text override fires whenever pause state changes.
Hooks.on("renderPause", onRenderPause);
Hooks.on("renderPauseBanner", onRenderPause);
Hooks.on("pauseGame", (paused) => paused && onRenderPause());

// -- COMPENDIUM ITEM ICONS -------------------------------------
// Art-less rows in an Item compendium get the same fallback markers the world sidebar gets.
// The sidebar goes through StonetopItem#thumbnail; compendium rows render off the pack index
// and never build a document, so they need this. See module/hooks/CompendiumItemIcons.js.
Hooks.on("renderDocumentDirectory", onRenderCompendiumItemIcons);

// -- ACTORS SIDEBAR ROW DECORATION -----------------------------
// Two features paint these rows and they share one walk over them (the row list and the
// per-row `collection.get` are the cost; doing them twice on the same event is pure waste):
//
//   PORTRAIT FRAMES — a chosen crop is a rect on a flag, so core's bare `<img src>` rows show
//     the uncropped picture. Each framed row's image is wrapped in a clipping box painted with
//     the same style the sheets use, so a person's face is the same face everywhere.
//   PLAYBOOK EPITHETS — name the player characters the way the table does, "Pim The
//     Lightbearer". Appended to the row, never written to the document.
//
// The updateActor halves are not optional: core redraws the directory for name / img / sort /
// folder and nothing else, so a frame (in `flags`) or a playbook (in `system`) would otherwise
// not show up until the world was reloaded. Each repaints its ONE row rather than re-rendering
// the directory, so nobody's scroll position moves. See module/hooks/actor-directory-rows.js.
Hooks.on("renderDocumentDirectory", (app, element) =>
	decorateActorDirectoryRows(app, element, [decoratePortraitRow, decorateNameRow]));
Hooks.on("updateActor", onUpdateActorPortraitFrame);
Hooks.on("updateActor", onUpdateActorPlaybookName);

// -- THE JUDGE'S BRAND -----------------------------------------
// A Condemn brand is stored on the JUDGE but WORN by the person branded, so core re-renders the
// wrong sheet when one is laid or lifted. Repaint the affected targets by hand.
// See module/hooks/CondemnedTag.js.
Hooks.on("updateActor", onUpdateCondemned);

// -- READY -----------------------------------------------------
// FIRST of the ready listeners, deliberately. This one reports whether the startup it is reporting
// on actually finished, so it must not be able to be skipped by a later listener throwing. It is
// registered at module scope like every hook here, which is what lets it still fire on a world
// whose `init` threw — the case it exists for. See utils/boot-guard.js.
Hooks.once("ready", () => {
	reportBootHealth();
	// Callable from the console: game.stonetop.bootReport()
	//
	// Hung off `game` rather than only `game.stonetop`, because `game.stonetop` is built during
	// onReady and a boot broken enough to need this is a boot that may never build it. A GM asked
	// for a bug report can paste the result of one expression instead of being talked through the
	// console, and it answers the question every art report has to answer first: is this world's
	// system actually running?
	game.stonetop ??= {};
	game.stonetop.bootReport = bootReport;
});
Hooks.once("ready", onReady);
Hooks.once("ready", () => applyMoveDescriptionBodyClass(getSetting("showMoveDescriptionsInChat")));

// -- THREAT BOARD (opt-in on-canvas threat cards) --------------
Hooks.once("ready", () => {
	game.stonetop ??= {};
	game.stonetop.threatBoard = new ThreatBoard();
	game.stonetop.threatBoard.install();
	if (globalThis.canvas?.ready) game.stonetop.threatBoard.refresh();
});

// -- RENDER ACTOR SHEET ----------------------------------------
Hooks.on("renderActorSheet", onRenderActorSheet);

// -- HOTBAR DROP -----------------------------------------------
// Turn a learned move dragged from a character sheet onto the macro hotbar into a
// script macro that re-rolls it (game.stonetop.rollMoveMacro, wired in Ready.js).
Hooks.on("hotbarDrop", onHotbarDrop);

// -- PLACE OF INTEREST → SCENE NOTE ----------------------------
// Drag a "Places of Interest" disc from the steading Overview tab onto the canvas to
// drop a lettered map note whose label (the place name) shows on hover.
Hooks.on("dropCanvasData", onDropPlaceOfInterest);

// -- FOLLOWER → SCENE TOKEN ------------------------------------
// Drag a follower card off a character's Followers tab onto the canvas to put that
// follower on the map: the card becomes (or re-uses) an `npc` Actor, and core places
// its token.
Hooks.on("dropCanvasData", onDropFollower);

// -- BOOK II ART ON JOURNAL IMPORT -----------------------------
// A GM dragging one of our journals in from the compendium mid-version would get an
// art-less world copy (the once-per-version re-apply won't fire again). Embed its Book II
// art right away from the durable folder. Debounced + idempotent (see book2-art/reapply.js),
// so a folder-import burst — and the fresh-world seed's own create storm — collapse to one pass.
Hooks.on("createJournalEntry", handleImportedJournalArt);

// The durable art folder just gained files, so drop the cached listings of it (see
// book2-art/browse.js). Publishing these two indices is the LAST thing the Import Book Art
// macro does, which makes it the one reliable signal that an import finished — the macro is
// a macro, not a module, so nothing here can hook it directly. reapply.js writes the same
// settings, but only when the contents genuinely changed, so a settled world never fires this.
//
// BOTH hooks, deliberately: a world setting has no Setting document until it is first
// written, so the very first import in a fresh world — the case that matters most — is a
// create, not an update.
// Driven off reapply.js's own list rather than naming the indexes again here: a fourth index
// added there and forgotten here would simply never invalidate, and its files would stay unseen
// for the rest of the session.
//
// ...and off browse.js's list of what a cached listing READS, for the same reason from the other
// side. A published index means "the folder changed"; the art prefix means "the question we ask
// the folder changed", and a listing taken before one was known answers nothing about the folder
// a listing taken after would find. Neither module names the other's settings.
const _onArtIndexPublished = (setting) => {
	const key = setting?.key ?? "";
	if ([...ART_INDEX_SETTINGS, ...ART_BROWSE_INPUTS].some((s) => key.endsWith(`.${s}`))) clearArtBrowseCache();
};
Hooks.on("createSetting", _onArtIndexPublished);
Hooks.on("updateSetting", _onArtIndexPublished);

// -- THREAT SCENE PINS -----------------------------------------
// A threat card dragged onto a scene drops a native page-linked Note; give that
// pin the torn-note icon, the threat's name, and global (fog-ignoring) visibility.
Hooks.on("preCreateNote", onPreCreateThreatNote);

// Give our lettered Place-of-Interest discs and threat/hazard pins a thick paper text
// halo so their labels stay legible over the illustrated Stonetop maps.
Hooks.on("drawNote", onDrawStonetopNote);

// -- EXPEDITION ROUTE ON THE MAP -------------------------------
// A journey put on a poster-map scene from the Run an Expedition walkthrough. The scene
// carries the two place slugs and every client paints the line from them, players included.
registerExpeditionRouteHooks();

// -- ENCOUNTER NOTES: LINKS FOLLOW A RENAME --------------------
// The GM Toolkit's Encounters tab holds each encounter's notes as already-enriched HTML, keyed
// against the prose they were built from. That key cannot see a rename: `enrichHTML` resolves an
// @UUID link to the target's CURRENT name, so renaming a linked monster leaves the prose
// byte-identical and the cached HTML showing the old name for the rest of the session. Bumping a
// counter on any rename of a thing a note can point at is what lets the next paint rebuild.
for (const doc of ["Actor", "Item", "JournalEntry", "JournalEntryPage", "Scene", "RollTable", "Macro"]) {
	Hooks.on(`update${doc}`, (_doc, changes) => {
		if ("name" in (changes ?? {})) bumpEncounterNotesGeneration();
	});
}

// -- LOCATION CROSS-LINK TOOLTIPS ------------------------------
// Give cross-links into the Locations pack a useful hover summary instead of the
// default "Journal Entry". Covers the journal sheet/page render hooks across
// Foundry v12–v14; the index warms on ready so the first hover is instant.
Hooks.once("ready", () => ensureLocationSummaryIndex());
const _onJournalRender = (app, html) => {
	// Give cross-links their hover summary FIRST, then neuter any a player can't
	// follow. Tooltips then restriction, in that order and for the reasons written down
	// in applyTooltipsThenRestrict.
	applyTooltipsThenRestrict(html);
	// Drop any book-art image whose file fails to load, so no reader — player or GM —
	// is ever shown an empty frame where a durable illustration went missing.
	hideBrokenJournalArt(html);
	// Spiral bullets / question-spirals for this system's prose journals.
	applyJournalSpiralBullets(app, html);
	// Gear/weapon-tag hover tooltips for the curated Setting Overview prose (the
	// Character Creation FAQ's "various tags," the Gear: Terms & Value page). Scoped
	// to that one journal — other prose's em-emphasis on common words like
	// "near"/"close"/"far" would draw spurious range tooltips. Mirrors what
	// SettingOverviewDialog does when it renders the same pages outside a journal.
	if (resolveEntry(app)?.name === SETTING_OVERVIEW_JOURNAL) {
		const root = html?.jquery ? html[0] : html;
		root?.querySelectorAll?.(".journal-page-content").forEach(applyGearTermTooltips);
	}
	// Tick-off the requirement check-lists in view mode (state stored on the page).
	applyJournalCheckboxes(app, html);
	// Roll the random tables straight from their "Roll" header.
	applyJournalRollTables(app, html);
	// Make baked steading-improvement cards draggable onto the Stonetop sheet.
	bindSteadingImprovementDrag(html);
	// Make homebrew threat cards draggable onto the steading Threats tab.
	bindThreatSeedDrag(html);
	// Make Book II treasures draggable inventory items (and restore their ◇/○ badges),
	// for any treasure journal that renders through the generic page sheet rather than
	// the custom location page sheet.
	applyTreasureDrops(html, resolveEntry(app)?.name);
};
for (const hook of ["renderJournalSheet", "renderJournalEntrySheet", "renderJournalPageSheet", "renderJournalEntryPageSheet"]) {
	Hooks.on(hook, _onJournalRender);
}

// -- JOURNAL SHARE BUTTON --------------------------------------
// Give the GM a one-click eye button on the journal entry's header bar to toggle
// whether players can see it (and at what access level). Scoped to the whole-entry
// sheet — v12 fires renderJournalSheet, v13+ renderJournalEntrySheet.
for (const hook of ["renderJournalSheet", "renderJournalEntrySheet"]) {
	Hooks.on(hook, addJournalShareButton);
}

// -- BESTIARY CROSS-LINK INDEX ---------------------------------
// Drop the cached creature name index when a world monster is added, removed,
// or renamed/re-conceived so cross-links stay accurate.
Hooks.on("createActor", (actor) => { if (actor?.type === "monster") invalidateMonsterRefIndex(); });
Hooks.on("deleteActor", (actor) => { if (actor?.type === "monster") invalidateMonsterRefIndex(); });
Hooks.on("updateActor", (actor, changes) => {
	if (actor?.type !== "monster") return;
	if ("name" in (changes ?? {}) || changes?.system?.concept !== undefined) invalidateMonsterRefIndex();
});

// -- CROSS-CLIENT RENDER SYNC ----------------------------------
// Arcana resource-track clicks persist with { render: false } so the masonry doesn't
// repack and jump the tab's scroll (the click handler patches the track's checkboxes in
// place). But Foundry broadcasts that option with the update, so it also suppresses the
// automatic re-render on OTHER clients — leaving a second open sheet of the same actor
// (e.g. the GM's) showing a stale track. Re-render those here: this fires on every client
// after the update, so on the non-initiating clients (the initiator already patched its own
// DOM) we repaint the actor's open sheets. Additive only — it never suppresses a render, so
// it can't reintroduce the scroll jump.
Hooks.on("updateActor", (actor, _changes, options, userId) => {
	if (options?.render !== false || userId === game.user?.id) return;
	for (const app of Object.values(actor.apps ?? {})) app?.render?.(false);
});

// -- STEADING PEOPLE LIVE-LINK ---------------------------------
// A steading's Residents/Neighbors rows render live off their linked "npc" actors (name,
// occupation, traits, relations, and the rich-notes preview), and its Players rows render
// live off the character's own portrait and playbook. Foundry only auto-re-renders a sheet
// when ITS OWN document changes, so editing a linked NPC — on the NPC sheet or via the
// roster's notes pop-up — or changing a character's picture would leave an open steading
// sheet's roster stale until a reload. Repaint any open steading that actually lists this
// actor so the two surfaces stay in sync both ways.
Hooks.on("updateActor", repaintOpenSteadingRosters);
// Deletion is the same staleness by another route: the row still points at a document that
// is now gone, and an open roster would keep showing the person until a reload. Repainting
// drops the row to its cached-name "unresolved" state (or, for a player, to the stored
// portrait snapshot) right away, so the GM can see there is something to re-link or remove.
Hooks.on("deleteActor", repaintOpenSteadingRosters);

// A roster row written by someone who can't create Actors — a player finishing onboarding
// with a background that names neighbors — arrives as plain text. This broadcast reaches the
// GM's client, which turns it into a real NPC on the spot, so it never matters who made the
// character. See steading-people.js#onSteadingPeopleUpdate.
Hooks.on("updateActor", onSteadingPeopleUpdate);

// -- RECOVER LOCK ----------------------------------------------
// The Recover special move can't be used again until the character takes more
// damage; clear its lock flag the moment HP drops.
Hooks.on("preUpdateActor", (actor, changes) => {
	if (actor?.type !== "character") return;
	const newHp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
	if (newHp === undefined) return;
	const oldHp = actor.system?.attributes?.hp?.value ?? 0;
	if (newHp < oldHp && actor.getFlag(SYSTEM_ID, "recover.spent")) {
		foundry.utils.setProperty(changes, `flags.${SYSTEM_ID}.recover.spent`, false);
	}
});

// -- DEATH AND DYING -------------------------------------------
// A PC reduced to 0 HP is dying and must face their 0-HP move (Book I p.245). Record that
// state on the same write and announce it, naming the move they actually trigger — Death's
// Door only until they carry a post-death insert.
Hooks.on("preUpdateActor", onPreUpdateActorDeathsDoor);
// The announcement rides the COMMITTED write, not the preUpdate that plans it: an update can
// still be refused after that hook has run, and a card is not taken back when it is.
Hooks.on("updateActor", onUpdateActorDeathsDoorCard);
// And, if the table wants it, open that move's walkthrough on the dying player's own screen.
// A separate hook because it has to run somewhere the preUpdate can't: that fires only on the
// client applying the damage, which is usually the GM's.
Hooks.on("updateActor", onUpdateActorDeathsDoorAutoOpen);
// The other direction: hit points appearing on a sheet that is through the Last Door. Nothing
// walks `dead` back on its own, so this asks whoever made the change whether it was a raising.
Hooks.on("updateActor", onUpdateActorDeathsDoorRaised);

// -- CHAT SPEAKER: ALIAS AND DEATH -----------------------------
// Two stamps a character's message carries from the moment it is created: the playbook in the
// speaker's name, and — for a PC past the Last Door — the kind of death behind them, which the
// render pass turns into the fringe under the card. Both are written in one updateSource so a
// message costs one source edit, not two.
Hooks.on("preCreateChatMessage", (message) => {
	const actor = _speakerActor(message);
	if (!actor || actor.type !== "character") return;

	const changes = {};
	// The same long name the Actors sidebar and the steading's roster show — including the
	// Would-Be Hero's mid-campaign rename, which this used to miss by reading the stored
	// playbook name directly (a crossed-off hero spoke as "Would-Be" forever).
	const fullName = characterFullName(actor);
	if (fullName !== actor.name) changes["speaker.alias"] = fullName;
	Object.assign(changes, deathDripStamp(actor) ?? {});

	if (Object.keys(changes).length) message.updateSource(changes);
});

// -- BLIND / PRIVATE ROLLS -------------------------------------
// Our roll cards print the rolled total (and result tier) in the message flavor,
// which Foundry renders for everyone regardless of whether the roll's result is
// visible to them. So for a viewer who isn't allowed to see the result (blind GM
// rolls, private rolls), drop our card entirely: that lets the `:has(.stonetop-roll-card)`
// rule stop hiding Foundry's own native dice block, which renders as a "??? = ?"
// hidden-roll placeholder. Runs before the button-wiring hooks below so they no-op.
function _chatStripBlindRoll(message, html) {
	if (message.isContentVisible) return;
	html.querySelector(".stonetop-roll-card")?.remove();
}

// -- CHAT-CARD PROSE TREATMENT ---------------------------------
function _chatProseTreatment(message, html) {
	markQuestionBullets(html);
	// Swap inline ◇/◆/○/●/□ ASCII for this system's styled glyphs in our chat-card
	// prose — matching the sheets and journals. The shared container list only names
	// our own cards, so a literal glyph someone types in chat is left alone.
	wrapGlyphTextContainers(html);
}

// -- STARTUP CARD: OPEN WELCOME GUIDE --------------------------
// The new-install welcome card carries a button into the first-session guide.
// The card is visible to everyone, but the guide is a GM tool, so hide it for
// players and wire it up for the GM.
function _chatWireStartupWelcome(message, html) {
	const btn = html.querySelector(".stonetop-startup-open-welcome");
	if (!btn) return;
	if (!game.user.isGM) { btn.style.display = "none"; return; }
	btn.addEventListener("click", () => game.stonetop?.openWelcome?.());
}

// -- ART-IMPORT REMINDER CARD: LAUNCH IMPORT MACRO -------------
// Both whispered GM cards that launch the Import Book Art macro carry this button: the one-time
// "Import Your Book Art" reminder for a world that never imported, and "Finish Your Art Import"
// for one whose run fell short of the manifest (hooks/Ready.js _postBook2ArtReminderOnce and
// _offerPartialArtImportOnce). They are mutually exclusive by construction — one needs no art on
// disk, the other needs some — so a single generic wiring serves both and a third card offering
// the same macro would need no change here.
// GM-only cards, but hide/guard the button for players defensively like the startup card.
function _chatWireBook2ArtReminder(message, html) {
	const btn = html.querySelector(".stonetop-import-art-open");
	if (!btn) return;
	if (!game.user.isGM) { btn.style.display = "none"; return; }
	btn.addEventListener("click", () => game.stonetop?.importBookArt?.());
}

// -- SHEET LAYOUT OFFER CARD ----------------------------------
// The card that tells an upgraded world its sheets stayed on the classic layout, and the
// one offering the way back that pressing its button posts (utils/sheet-layout.js). One
// handler for both: the target layout rides on the button's data-layout.
//
// The setting it writes is world-scoped, so this really is GM-only rather than defensively
// so; the card is whispered to GMs, and the footer points everyone else at their own row in
// Configure Settings.
//
// There is ONE such card per world and the flip EDITS it, so pressing the button rewrites the
// very card it sits on — headline, prose and button all flip to the other direction. Which is
// why nothing here has to report success: the update re-renders the message, this handler runs
// again on the new markup, and the button the user is looking at is already the way back. Only
// the failure path touches the DOM (re-enable), and the in-flight disable is there so a double
// click cannot start a second write against a card that is about to be replaced.
function _chatWireLayoutSwitch(message, html) {
	const btn = html.querySelector(".stonetop-layout-switch");
	if (!btn) return;
	if (!game.user.isGM) { btn.style.display = "none"; return; }
	btn.addEventListener("click", async () => {
		if (btn.disabled) return;
		btn.disabled = true;
		const { setWorldSheetLayout } = await import("./module/utils/sheet-layout.js");
		if (await setWorldSheetLayout(btn.dataset.layout)) return;
		btn.disabled = false;   // refused (not a GM after all) - leave the card usable
	});
}

// -- REBUILD BOOK ART CARD -------------------------------------
// The one-time offer to cut the finer pictures — People detail portraits, square faces and
// creature token squares — out of art the GM already imported (hooks/Ready.js
// _offerBookArtRebuildOnce). Runs in the browser off files already on disk, so it needs no PDF —
// but it does write files, hence GM-only. Disable the button while it runs so an impatient second
// click can't start a duplicate pass over the same 200-odd images.
function _chatWireRebuildCrops(message, html) {
	const btn = html.querySelector(".stonetop-rebuild-crops-run");
	if (!btn) return;
	if (!game.user.isGM) { btn.style.display = "none"; return; }
	btn.addEventListener("click", async () => {
		if (btn.disabled) return;
		const { runBookArtRebuildFromButton } = await import("./module/book2-art/run-rebuild.js");
		// Owns the disable, the counting spinner, the notification and the restore-on-error;
		// what is left here is only what this card says once the run is over.
		const res = await runBookArtRebuildFromButton(btn);
		if (!res) return;   // threw — the label is already back
		if (res.failed) {
			// A partial run leaves work undone, so the card has to stay usable: pressing it
			// again re-plans from disk, which now skips everything just written and retries
			// only the parents that failed. Latching it closed on "Rebuilt N" would make a
			// reload the only way back to the remainder.
			btn.disabled = false;
			btn.innerHTML = `<i class="fas fa-rotate-right"></i> Retry ${res.failed}`;
		} else {
			btn.innerHTML = `<i class="fas fa-check"></i> Rebuilt ${res.written}`;
		}
	});
}

// -- MOVE DESCRIPTION TOGGLE -----------------------------------
function _chatWireDescToggle(message, html) {
	const toggle = html.querySelector(".stonetop-roll-card-desc-toggle");
	if (!toggle) return;
	toggle.addEventListener("click", () => {
		toggle.closest(".stonetop-roll-card")?.classList.toggle("desc-revealed");
	});
}

// -- DEBILITY DISADVANTAGE ANNOTATION -------------------------
// When a roll was penalised by a debility, annotate the
// "Disadvantage" condition in the chat card with the debility name.
function _chatAnnotateDebility(message, html) {
	const opts = message.rolls?.[0]?.options ?? {};
	const { stonetopDebility: debility, stonetopDebilityTooltip: tooltip } = opts;
	if (!debility) return;
	const pill = html.querySelector(".stonetop-roll-card .stonetop-condition-disadvantage");
	if (pill) {
		const hint = tooltip
			? `<span class="stonetop-debility-hint" data-tooltip="${tooltip}" data-tooltip-direction="UP">${debility}</span>`
			: debility;
		pill.innerHTML = `Disadvantage (${hint})`;
	}
}

// -- ROLL RESULT SHIFTING --------------------------------------
function _chatWireRollShifting(message, html) {
	// Only actual roll results can be shifted (_onRollShift operates on message.rolls).
	// Skip roll-less cards that merely reuse the .stonetop-card-buttons row — the
	// "ask the most hopeful to roll" prompt and the Become-a-Hero prompt — so they
	// don't get dead Shift Up/Down buttons injected.
	if (!message.rolls?.length) return;
	const cardButtons = html.querySelector(".stonetop-roll-card .stonetop-card-buttons");
	if (!cardButtons) return;

	// Shift Up/Down is a GM-only tool for bumping a roll's tier, and off by default —
	// most tables never touch it. When disabled, don't inject or reveal the buttons, and
	// hide any the roll card pre-rendered; the shared .stonetop-card-buttons row is left
	// for Burn Brightly (wired next) to claim if the owner qualifies.
	const showShift = game.user.isGM && getSetting("chatShiftButtons");

	if (showShift && !cardButtons.querySelector("[data-action='shiftUp']")) {
		cardButtons.insertAdjacentHTML("afterbegin", `
			<button data-action="shiftUp">Shift Up</button>
			<button data-action="shiftDown">Shift Down</button>
		`);
	}

	for (const button of cardButtons.querySelectorAll("[data-action='shiftUp'], [data-action='shiftDown']")) {
		button.style.display = showShift ? "" : "none";
		if (showShift) button.addEventListener("click", ev => _onRollShift(ev, message));
	}
	cardButtons.style.display = showShift ? "flex" : "none";
}

// -- BURN BRIGHTLY ---------------------------------------------
const BURN_BRIGHTLY_TOOLTIP =
	"When you have enough XP to Level Up, " +
	"you may spend 2 XP after any roll you make to add +1 to that roll (max +1 per roll).";

function _chatWireBurnBrightly(message, html) {
	const cardButtons = html.querySelector(".stonetop-roll-card .stonetop-card-buttons");
	if (!cardButtons) return;

	const actor = _speakerActor(message);

	if (!actor || actor.type !== "character" || !actor.isOwner) return;

	const alreadyBurned = message.getFlag(SYSTEM_ID, "burnBrightly") ?? false;
	const xp    = actor.system?.attributes?.xp?.value    ?? 0;
	const level = actor.system?.attributes?.level?.value ?? 1;
	const canAfford = xp >= xpToLevelUp(level);

	if (!canAfford && !alreadyBurned) return;

	const btn = document.createElement("button");
	btn.className = "stonetop-burn-brightly-btn";
	btn.innerHTML = `<span class="stonetop-burn-brightly-icon"></span> Burn brightly`;
	btn.dataset.tooltip = BURN_BRIGHTLY_TOOLTIP;
	btn.dataset.tooltipDirection = "UP";
	btn.disabled = alreadyBurned;

	cardButtons.appendChild(btn);
	cardButtons.style.display = "flex";

	if (alreadyBurned) return;

	btn.addEventListener("click", async () => {
		btn.disabled = true;
		const currentXp    = actor.system?.attributes?.xp?.value    ?? 0;
		const currentLevel = actor.system?.attributes?.level?.value ?? 1;
		if (currentXp < xpToLevelUp(currentLevel)) {
			ui.notifications.warn("You don't have enough XP to Burn Brightly.");
			btn.disabled = false;
			return;
		}
		try {
			// Read before the update, so the re-stamped alias is the one the card was created
			// with rather than whatever the actor has become mid-click.
			const fullName = characterFullName(actor);
			await actor.update({ "system.attributes.xp.value": currentXp - 2 });
			const newXp = currentXp - 2;
			const maxXp = xpToLevelUp(currentLevel);
			ChatMessage.create({
				content: `-2 XP for Burning Brightly.<br>New XP: ${newXp} / ${maxXp}`,
				speaker: ChatMessage.getSpeaker({ actor }),
			});

			const rolls = message.rolls;
			const roll  = rolls.at(0);
			// Add +1 to the roll's rollShifting modifier term (creating it if absent) — the
			// same dice-term math the ± roll-shift buttons use, so the two never drift.
			await _shiftRoll(roll, 1);

			const speakerUpdate = fullName !== actor.name ? { alias: fullName } : {};
			await message.update({
				rolls,
				// Regenerate the card so the readout, result label and per-tier outcome reflect the +1.
				flavor:  _shiftRollCardFlavor(message.flavor, roll.total, roll.formula),
				speaker: { ...message.speaker, ...speakerUpdate },
				flags:   { [SYSTEM_ID]: { burnBrightly: true } },
			});
		} catch (err) {
			console.error("Stonetop | Error burning brightly:", err);
			btn.disabled = false;
		}
	});
}

// -- KNOW THINGS: the moves that reach back into a landed roll --
//
// Two Seeker moves act on a Know Things roll AFTER the dice land, so both live on the card:
//   Never at a Loss — "you may choose to not mark XP" on a 6-. The automatic mark was suppressed
//     at roll time (see StonetopItem.roll), so one of these two buttons has to be pressed for the
//     XP to happen at all. Rendered as failure-tier actions, so a GM Shift Up hides them.
//   Logbook — "expend a use ... treat the result as a 10+". Spends a use and pads the roll's
//     shift term up to exactly 10, reusing the same term math the GM's Shift buttons use.
//
// Caveat worth knowing: a later GM Shift Down can take a padded 10 back to 9 and revoke the
// guarantee, because _shiftRollCardFlavor derives the tier from the total alone and has no notion
// of a locked tier. That's a GM overriding a player's spend, which is their call to make.

/** The move a roll card came from, as stamped by StonetopItem.roll. Null for non-move rolls. */
function _cardMoveName(message) {
	return message.getFlag(SYSTEM_ID, "move") ?? null;
}

/**
 * Bring an arcanum's identification up to the card's CURRENT tier.
 *
 * Identifying a face-down arcanum by Knowing Things about it commits its outcome at roll time
 * (_onArcanumKnowThings), which is right for the roll and wrong for everything that rewrites the
 * tier afterwards: the Logbook's "expend a use … treat the result as a 10+" re-labelled the card a
 * Strong Hit and said "You read the card, front and back" while leaving the arcanum front-only with
 * its back still owed — the player spent a limited resource and got exactly what the 7-9 had
 * already given them. A GM Shift Up out of a 6- read the same way, promising a card nobody had
 * been shown. The slug rides on the message (see the roll's messageFlags) so both routes can
 * finish the job here rather than each keeping their own copy of p.440's ladder.
 *
 * UPGRADES ONLY. A Shift Down may take a padded 10 back to 9 — that's a GM overriding a player's
 * spend, and their call — but it cannot un-read a card the player has already been shown, and
 * re-applying the weak hit's outcome would re-open a settled back debt. So a tier at or below what
 * the arcanum already carries writes nothing.
 */
async function _syncArcanumIdentification(message, actor, total) {
	const slug = message.getFlag(SYSTEM_ID, "arcanum");
	const character = actor?.typedActor;
	if (!slug || !character) return;

	const key  = _classifyShiftedTotal(Number(total) || 0).key;
	const opts = { stonetopMove: "Know Things" };
	try {
		if (key === "success" || key === "critical") {
			// Already read front and back? Then there is nothing to grant, and identifyAndReveal
			// would be a no-op write that re-renders every open sheet.
			if (character.revealedArcanaSlugs?.has?.(slug) && !character.backOwedArcanaSlugs?.has?.(slug)) return;
			await character.identifyAndRevealArcanum(slug, opts);
		} else if (key === "partial") {
			if (character.identifiedArcanaSlugs?.has?.(slug)) return;   // a 6- shifted up to a 7-9 only
			await character.identifyFrontOwedArcanum(slug, opts);
		} else return;
		actor.sheet?.render(false);
	} catch (err) {
		console.error("Stonetop | Error re-applying the arcanum's identification:", err);
	}
}

/**
 * The same job for an artifact (Book I pp.430-431), which rides on the message as an ITEM ID
 * rather than a pack slug: an artifact is a document the character owns, so there is one to name.
 *
 * Upgrades only, and for the same reason as the arcanum above — a Shift Down must not take back a
 * write-up the player has already read. `setArtifactState` enforces that itself, so this only has
 * to translate the tier and hand it over. A Shift Down that lands on a 6- translates to no state
 * at all and writes nothing, which leaves the artifact exactly as the better roll left it.
 */
async function _syncArtifactIdentification(message, actor, total) {
	const itemId = message.getFlag(SYSTEM_ID, "artifact");
	const character = actor?.typedActor;
	// Seek Insight also stamps `artifact` (so a card can say which thing it was about), but it
	// never settles the ladder — p.430 leaves those answers with the GM. Only Know Things writes.
	if (!itemId || !character || !isKnowThings(_cardMoveName(message))) return;

	const state = artifactStateForTier(_classifyShiftedTotal(Number(total) || 0).key);
	if (!state) return;
	try {
		if (await character.setArtifactState(itemId, state, { upgradeOnly: true })) {
			actor.sheet?.render(false);
		}
	} catch (err) {
		console.error("Stonetop | Error re-applying the artifact's identification:", err);
	}
}

/**
 * Every kind of thing a Know Things roll can be identifying.
 *
 * The two bodies stay separate because they genuinely differ (the arcanum walks p.440's ladder
 * with per-tier skip guards; the artifact hands one state to `setArtifactState`, which enforces
 * upgrade-only itself). What is shared is the DISPATCH: every place that rewrites a roll's total
 * has to re-apply it to whatever the roll was about. Listing them here means a third identifiable
 * thing is one entry rather than another line at each rewrite site — and a rewrite site that
 * forgot one failed silently, promising a 10+ and delivering a 7-9's disclosure.
 */
const IDENTIFY_SYNCERS = [_syncArcanumIdentification, _syncArtifactIdentification];

/** Re-apply a rewritten roll total to whatever that roll was identifying. */
async function _resyncIdentification(message, actor, total) {
	for (const sync of IDENTIFY_SYNCERS) await sync(message, actor, total);
}

// Burn Brightly gates on actor.isOwner but then calls message.update(), which throws when the GM
// rolled on a player's behalf. Both handlers below need BOTH rights, so check them together.
function _canRewriteCard(message, actor) {
	if (!actor || actor.type !== "character" || !actor.isOwner) return false;
	return message.canUserModify?.(game.user, "update") ?? game.user.isGM;
}

function _chatWireKnowThings(message, html) {
	const card = html.querySelector(".stonetop-roll-card");
	if (!card || !isKnowThings(_cardMoveName(message))) return;
	const actor = _speakerActor(message);
	if (!_canRewriteCard(message, actor)) return;
	_wireNeverAtALoss(message, html, actor);
	_wireLogbook(message, html, actor, card);
}

// The two failure-tier buttons. The choice latches on the message so a re-render (or a second
// click) can't mark the XP twice.
function _wireNeverAtALoss(message, html, actor) {
	const buttons = html.querySelectorAll(".stonetop-know-things-xp");
	if (!buttons.length) return;
	const chosen = message.getFlag(SYSTEM_ID, "knowThingsXp") ?? null;
	for (const btn of buttons) {
		if (chosen) {
			btn.disabled = true;
			btn.classList.toggle("is-chosen", btn.dataset.choice === chosen);
			continue;
		}
		btn.addEventListener("click", async () => {
			for (const b of buttons) b.disabled = true;
			const choice = btn.dataset.choice;
			let latched = false;
			try {
				await message.setFlag(SYSTEM_ID, "knowThingsXp", choice);
				latched = true;
				if (choice === "mark") return void await markMissXp(actor, "Know Things");
				await ChatMessage.create({
					content: moveChatCard("Never at a Loss",
						`<p><strong>${escHtml(actor.name)}</strong> declines the XP. The GM tells them nothing`
						+ ` interesting or useful about the subject &mdash; but does tell them how they could learn more.</p>`),
					speaker: ChatMessage.getSpeaker({ actor }),
				});
			} catch (err) {
				console.error("Stonetop | Error resolving Never at a Loss:", err);
				// Take the latch back off. It is written FIRST so a second click (or a re-render
				// arriving mid-flight) cannot mark the XP twice — but that also means a failure
				// after it lands leaves the choice recorded and the XP unmarked, with both buttons
				// rendering disabled from here on and no way to ask again. Re-enabling the DOM is
				// not enough on its own: the next render reads the flag, not these buttons.
				if (latched) {
					await message.unsetFlag(SYSTEM_ID, "knowThingsXp")
						.catch(e => console.error("Stonetop | Could not release the Never at a Loss latch:", e));
				}
				for (const b of buttons) b.disabled = false;
			}
		});
	}
}

// "expend a use ... treat the result as a 10+". Only offered while the card is still below a
// strong hit and the logbook still has a use in it.
function _wireLogbook(message, html, actor, card) {
	if (message.getFlag(SYSTEM_ID, "knowThingsUpgrade")) return;
	const roll = message.rolls?.at(0);
	if (!roll || roll.total >= STRONG_HIT_TOTAL) return;

	const uses = logbookUses(actor, actor.typedActor?.moveResources?.getMoveResources?.() ?? {});
	if (!uses || uses.left <= 0) return;

	const cardButtons = card.querySelector(".stonetop-card-buttons");
	if (!cardButtons) return;
	const btn = document.createElement("button");
	btn.className = "stonetop-logbook-btn";
	btn.innerHTML = `<i class="fas fa-book"></i> Consult your logbook`;
	btn.dataset.tooltip = `Expend a use (${uses.left} of ${uses.max} left) to ignore this roll and treat the result as a 10+.`;
	btn.dataset.tooltipDirection = "UP";
	cardButtons.appendChild(btn);
	cardButtons.style.display = "flex";

	btn.addEventListener("click", async () => {
		btn.disabled = true;
		try {
			// Re-read at click time: the track may have been spent elsewhere since this rendered.
			const now = logbookUses(actor, actor.typedActor?.moveResources?.getMoveResources?.() ?? {});
			if (!now || now.left <= 0) {
				ui.notifications.warn("Your logbook has no uses left.");
				return;
			}
			// A move track counts uses SPENT, so expending one increments. Routed through the
			// class that owns that storage shape — the same door the sheet's pips use — so the
			// flag path is spelled out in one place. Attributed for the ledger.
			await actor.typedActor.moveResources.setUses(LOGBOOK, now.spent + 1, { stonetopMove: LOGBOOK });
			// Pad to exactly 10. _shiftRoll only steps by one, and stopping at 10 keeps the card
			// off the 12+ "critical" label a bigger pad would earn.
			const rolls = message.rolls;
			const shifted = rolls.at(0);
			while (shifted.total < STRONG_HIT_TOTAL) await _shiftRoll(shifted, 1);
			await message.update({
				rolls,
				flavor: _shiftRollCardFlavor(message.flavor, shifted.total, shifted.formula),
				flags:  { [SYSTEM_ID]: { knowThingsUpgrade: LOGBOOK } },
			});
			await ChatMessage.create({
				content: moveChatCard("Logbook",
					`<p><strong>${escHtml(actor.name)}</strong> consults their logbook and expends a use`
					+ ` (${now.left - 1} of ${now.max} left), treating that roll as a 10+.</p>`),
				speaker: ChatMessage.getSpeaker({ actor }),
			});
			// If this roll was identifying an arcanum or an artifact, the 10+ the use just bought
			// has to actually hand the thing over — the outcome was committed when the dice landed.
			await _resyncIdentification(message, actor, shifted.total);
			actor.sheet?.render(false);
		} catch (err) {
			console.error("Stonetop | Error consulting the logbook:", err);
			btn.disabled = false;
		}
	});
}

// -- REQUISITION: apply miss cost from the roll card ------------
function _speakerActor(message) {
	const { token: tokenId, actor: actorId } = message.speaker ?? {};
	return (tokenId ? canvas.tokens?.get(tokenId)?.actor : null)
		?? (actorId ? game.actors?.get(actorId) : null);
}

function _chatWireRequisitionMissCost(message, html) {
	const btn = html.querySelector(".stonetop-requisition-miss-cost");
	if (!btn) return;

	if (message.getFlag(SYSTEM_ID, "requisitionMissCostApplied")) {
		btn.disabled = true;
		btn.textContent = "Miss cost applied";
		return;
	}

	btn.addEventListener("click", async () => {
		btn.disabled = true;
		try {
			const actor = _speakerActor(message);
			if (!actor?.isOwner || actor.type !== "stonetop") {
				ui.notifications.warn("You need permission to update the steading's Fortunes.");
				btn.disabled = false;
				return;
			}

			// Go through StonetopSteading so the write lands in BOTH system.* and the
			// mirrored steading flag that getStatValue (and the sheet) actually read from —
			// a raw actor.update of system.* alone leaves the mirror stale and the reduction
			// invisible.
			const steading = new StonetopSteading(actor);
			const fortunes = steading.getStatValue("fortunes");
			const newFortunes = Math.max(fortunes - 1, -1);
			await steading.setSystemValue("stats.fortunes.value", newFortunes, { stonetopMove: "Requisition" });
			await message.setFlag(SYSTEM_ID, "requisitionMissCostApplied", true);
			for (const sheet of Object.values(actor.apps ?? {})) sheet.render(false);
			ui.notifications.info(`Fortunes reduced to ${sign(newFortunes)}.`);
		} catch (err) {
			console.error("Stonetop | Error applying Requisition miss cost:", err);
			btn.disabled = false;
		}
	});
}

// -- LOVE LETTER PICK LIST -------------------------------------
// A love letter with a shared "choose from this list" pool renders its options as a
// checklist on the roll card (see rollStat's pickListHtml). Restore any saved ticks and
// wire the boxes so a click persists to the message flag (author/GM) and always toggles
// locally. The letter item itself is consumed on resolve, so the message is the only home
// the checked state has.
function _chatWireLoveLetterPicks(message, html) {
	const boxes = html.querySelectorAll(".stonetop-picklist-check");
	if (!boxes.length) return;

	const saved   = message.getFlag(SYSTEM_ID, "pickChecked") ?? [];
	const canSave = message.canUserModify?.(game.user, "update") ?? game.user.isGM;

	for (const box of boxes) {
		const idx  = Number(box.dataset.index);
		const item = box.closest(".stonetop-picklist-item");
		const on   = !!saved[idx];
		box.checked = on;
		item?.classList.toggle("is-picked", on);

		box.addEventListener("change", async () => {
			item?.classList.toggle("is-picked", box.checked);
			if (!canSave) return;
			const arr = Array.from(boxes).map((b) => !!b.checked);
			try {
				await message.setFlag(SYSTEM_ID, "pickChecked", arr);
			} catch (err) {
				console.error("Stonetop | Error saving love-letter picks:", err);
			}
		});
	}
}

// -- WOULD-BE HERO: BECOME A HERO ------------------------------
// The first time a Would-Be Hero gains a hero-making (asterisked) move, cross off
// "Would-be" and announce it once. The playbook header already derives "The Hero"
// from owning such a move, so this hook is purely the one-time announcement.
Hooks.on("createItem", (item, options, userId) => maybeAnnounceBecameHero(item, userId, options));

// One render hook drives all of the above, in this order: the blind-roll strip
// MUST run first (it removes our card so the button-wiring helpers below no-op
// for viewers who can't see the result), then the message-root passes, then prose
// treatment, then the button and annotation passes. A single dispatch beats nine
// separate hook registrations each re-scanning the same message DOM on every chat
// render.
Hooks.on("renderChatMessageHTML", (message, html) => {
	_chatStripBlindRoll(message, html);
	markDeathDrip(message, html);
	_chatProseTreatment(message, html);
	_chatWireStartupWelcome(message, html);
	_chatWireBook2ArtReminder(message, html);
	_chatWireRebuildCrops(message, html);
	_chatWireLayoutSwitch(message, html);
	_chatWireDescToggle(message, html);
	_chatAnnotateDebility(message, html);
	_chatWireRollShifting(message, html);
	_chatWireBurnBrightly(message, html);
	// After the roll-shift pass (which hides the button row from non-GMs) and after Burn
	// Brightly, so the logbook pill sits to its right in the shared button row.
	_chatWireKnowThings(message, html);
	_chatWireRequisitionMissCost(message, html);
	_chatWireSeasonsRoll(message, html);
	_chatWireLoveLetterPicks(message, html);
	wireDyingPrompt(message, html);
	wireAttackConfirm(message, html);
	wireApplyDamage(message, html);
	wireSufferAttack(message, html);
});

// -- SEASONS CHANGE: "ask the most hopeful to roll" -----------
// Wire the roll button on a spring Seasons Change prompt card (postSeasonsRollPrompt):
// any player can click it to make the +Fortunes roll for the table. The result posts
// its own card; we just disable the button locally so a stray double-click can't fire
// two rolls.
function _chatWireSeasonsRoll(message, html) {
	const btn = html.querySelector(".stonetop-seasons-roll-btn");
	if (!btn) return;

	btn.addEventListener("click", async () => {
		btn.disabled = true;
		const fortunes = Number(btn.dataset.fortunes) || 0;
		// The carried name ("Seasons Change — <season>") heads the result card; the
		// speaker is left to default to whoever clicked (see rollSeasonsCard).
		const title    = btn.dataset.alias || "Seasons Change — Spring";
		const formula  = fortunes >= 0 ? `2d6 + ${fortunes}` : `2d6 - ${-fortunes}`;
		try {
			await rollSeasonsCard({ formula, title, resultTable: SPRING_SEASONS_RESULT });
		} catch (err) {
			console.error("Stonetop | Error rolling Seasons Change from chat:", err);
			btn.disabled = false;
		}
	});
}

async function _onRollShift(event, message) {
	event.preventDefault();
	const button = event.currentTarget;
	button.disabled = true;

	try {
		const roll = message.rolls?.at(0);
		if (!roll) return;

		const shift = button.dataset.action === "shiftUp" ? 1 : -1;
		await _shiftRoll(roll, shift);

		await message.update({
			rolls:  message.rolls,
			flavor: _shiftRollCardFlavor(message.flavor, roll.total, roll.formula),
		});
		// A shifted Know Things card that was identifying an arcanum has to carry the new tier's
		// disclosure with it, or a Shift Up says "You read the card, front and back" over a card
		// still face down. No-op for every other roll — the flag is only on that one.
		await _resyncIdentification(message, _speakerActor(message), roll.total);
	} catch (err) {
		console.error("Stonetop | Error shifting roll result:", err);
	} finally {
		button.disabled = false;
	}
}

async function _shiftRoll(roll, shift) {
	const shiftMap = { 1: "+", "-1": "-" };
	let opTerm = roll.terms.find(term => term instanceof foundry.dice.terms.OperatorTerm && term.options.rollShifting);
	let numTerm = roll.terms.find(term => term instanceof foundry.dice.terms.NumericTerm && term.options.rollShifting);
	let originalValue = `${opTerm?.operator ?? ""}${numTerm?.number ?? ""}`;
	if (originalValue !== "" && !Number.isNaN(Number(originalValue))) originalValue = Number(originalValue);

	if (!numTerm) {
		roll.terms.push(
			opTerm = new foundry.dice.terms.OperatorTerm({ operator: shiftMap[shift], options: { rollShifting: true } }),
			numTerm = new foundry.dice.terms.NumericTerm({ number: 1, options: { rollShifting: true } })
		);
	} else {
		numTerm.number = Math.abs(Roll.safeEval(`${opTerm.operator}${numTerm.number} + ${shift}`));
	}

	if (numTerm.number === 1 && originalValue === 0 && opTerm.operator !== shiftMap[shift]) {
		opTerm.operator = shiftMap[shift];
	} else if (numTerm.number === 0) {
		opTerm.operator = "+";
	}

	roll.resetFormula();
	await roll._evaluate();
}

function _shiftRollCardFlavor(flavor, total, formula = null) {
	if (!flavor) return flavor;

	const wrapper = document.createElement("div");
	wrapper.innerHTML = flavor;

	// Keep our own total + formula (which stand in for Foundry's hidden dice block)
	// in sync with the shifted roll. This runs for every roll card, including damage
	// cards that have no result tier. (The die-faces tooltip is left as-is: a shift
	// only adjusts the rollShifting modifier term, never the rolled d6 faces.)
	const numberEl = wrapper.querySelector(".stonetop-roll-card .stonetop-roll-result-number");
	if (numberEl) numberEl.textContent = total;
	if (formula != null) {
		const formulaEl = wrapper.querySelector(".stonetop-roll-card .stonetop-roll-formula");
		if (formulaEl) formulaEl.textContent = formula;
	}

	const resultEl = wrapper.querySelector(".stonetop-roll-card .stonetop-roll-result");
	const resultLabel = resultEl?.querySelector(".stonetop-roll-result-label");
	let result = null;
	if (resultEl && resultLabel) {
		result = _classifyShiftedTotal(total);
		resultEl.classList.remove("success", "partial", "failure", "critical");
		resultEl.classList.add(result.key);
		resultLabel.textContent = result.label;

		// Keep the per-tier outcome line (if any) in sync with the shifted tier. The
		// three outcomes are stashed on the result block as data-outcome-* by _rollCard.
		const details = resultEl.querySelector(".stonetop-roll-result-details");
		if (details) {
			const tierKey = result.key === "critical" ? "success" : result.key;
			const outcome = {
				success: resultEl.dataset.outcomeSuccess,
				partial: resultEl.dataset.outcomePartial,
				failure: resultEl.dataset.outcomeFailure,
			}[tierKey];
			if (outcome !== undefined) details.innerHTML = formatOutcomeDetail(outcome);
		}
	}

	const tierActions = wrapper.querySelector(".stonetop-roll-card .stonetop-roll-tier-actions");
	if (tierActions && result) {
		const activeTier = result.key === "critical" ? "success" : result.key;
		tierActions.dataset.activeTier = activeTier;
		for (const action of tierActions.querySelectorAll(".stonetop-roll-tier-action")) {
			// Set the VALUED attribute, not the `.hidden` property: this innerHTML is written back
			// to the message's flavor (an HTMLField), and Foundry v14's sanitize-html strips
			// valueless boolean attributes — a bare/empty `hidden` would vanish and reveal every tier.
			if (action.dataset.tier === activeTier) action.removeAttribute("hidden");
			else action.setAttribute("hidden", "hidden");
		}
	}

	return wrapper.innerHTML;
}

function _classifyShiftedTotal(total) {
	if (total >= 12) return { key: "critical", label: "12+ Strong Hit" };
	if (total >= 10) return { key: "success", label: "Strong Hit" };
	if (total >= 7) return { key: "partial", label: "Weak Hit" };
	return { key: "failure", label: "Miss" };
}
