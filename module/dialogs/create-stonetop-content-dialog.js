// The sidebar "Create Item" entry point for Stonetop's hand-authored, drag-and-drop
// content. Improvements and threats aren't Item sub-types, so rather than Foundry's
// Item type picker we show our own chooser and hand off to each authoring flow: a
// reusable world Move, a draggable steading-improvement card, a draggable threat card,
// a reusable world inventory item or treasure, or a homebrew arcanum. Opened from StonetopItem.createDialog.
//
// TWO STEPS AT MOST. The first window offers a handful of broad kinds; a kind that covers
// several flows (Gear & Treasure, Dangers & Places) opens a second window to refine it, and
// the flows it holds are rows there, never a third window. A kind left with ONE flow the
// user may run is not a group at all: that flow's own row stands in the first window.

import { canCreateArcana } from "../utils/authoring-gates.js";
import { pickContentOption, runPickedOption } from "./content-picker.js";

// What the chooser offers, and what each row DOES. The flow sits on the row rather than in an
// if/else ladder beside it: a kind added to one and missed in the other is a picker option that
// silently creates nothing, or a flow nothing can reach, and neither fails loudly.
//
// Who may see a row is on the row too: `gmOnly` for GM prep, `arcanum` for the rows that obey
// arcanaCreationGmOnly. `{heading}` entries caption the rows after them in a refine window.

// Gear & Treasure: what a character can carry.
const GEAR_OPTIONS = [
	{
		id: "inventory",
		label: "Inventory Item",
		icon: "fa-box-open",
		hint: "A custom gear item, saved as a reusable world item you drag onto any character's Inventory tab.",
		create: () => _openInventoryItem(),
	},
	{
		id: "treasure",
		label: "Treasure",
		icon: "fa-gem",
		// A GM-only world item the players meet when it is handed over.
		gmOnly: true,
		hint: "A treasure or artifact as Book II prints one: tags, Value, uses and its write-up, with the hint and lead for identifying it. Hidden from players until you drag it onto a character.",
		create: () => _openInventoryItem({ treasure: true }),
	},
	{ heading: "Arcana" },
	// NOT a tier choice: the editor's Identity page carries a "Major Arcanum" checkbox that
	// switches tier either way, so asking here would only be a second place to answer the same
	// question (and the wrong answer would look permanent). A blank card starts minor.
	{
		id: "arcanumBlank",
		label: "Blank arcanum",
		icon: "fa-wand-sparkles",
		arcanum: true,
		hint: "An empty homebrew arcanum, opened in the card editor. Tick “Major Arcanum” on its Identity page for card art and major semantics.",
		create: () => _createBlankArcanum(),
	},
	{
		id: "arcanumInspire",
		label: "Inspire me…",
		icon: "fa-dice-d20",
		arcanum: true,
		hint: "Roll the Book II Artifact Creation tables (origin, nature, form) for a themed starting point, then build the arcanum from the results.",
		create: () => _openArcanaInspire(),
	},
];

// Dangers & Places: GM prep, ending in world threats, monsters, or a page of the steading's
// GM-only Sites journal, and those stores are GM-only.
const DANGER_OPTIONS = [
	{
		id: "threat",
		label: "Threat",
		icon: "fa-skull",
		gmOnly: true,
		hint: "A homebrew threat card you drag onto the GM Toolkit's Threats tab.",
		create: () => _openThreat(),
	},
	{
		id: "site",
		label: "Site",
		icon: "fa-mountain-sun",
		gmOnly: true,
		hint: "Walk through Book I's Creating Sites process. The write-up lands at the foot of the GM Toolkit's Expeditions tab, ready to pin to a scene.",
		create: () => openCreateSite(),
	},
	// Book II, The Things Below. Thing + corrupted site become draggable threat cards; corrupted
	// being + emanation create monster stat-block actors directly.
	{ heading: "The Things Below" },
	{
		id: "thing",
		label: "A Thing Below",
		icon: "fa-eye",
		gmOnly: true,
		hint: "A primordial entity of darkness and corruption. Combine themes + aspects + an instinct; written up as a magical-entity threat.",
		create: () => _seedThreatCard(async () => {
			const { CreateThingDialog } = await import("../things-below/create-thing-dialog.js");
			return new CreateThingDialog().promise();
		}),
	},
	{
		id: "corruptedSite",
		label: "A corrupted site",
		icon: "fa-mountain-sun",
		gmOnly: true,
		hint: "A place the Things Below have tainted. Feature + cause + severity; written up as a MacGuffin threat with an impending doom.",
		create: () => _seedThreatCard(async () => {
			const { CreateCorruptedSiteDialog } = await import("../things-below/create-corrupted-site-dialog.js");
			return new CreateCorruptedSiteDialog().promise();
		}),
	},
	{
		id: "being",
		label: "A corrupted being",
		icon: "fa-skull",
		gmOnly: true,
		hint: "Twist an existing monster: add gifts, marks, and the corrupted tag. Creates a monster stat block.",
		create: () => _openCorruption("being"),
	},
	{
		id: "emanation",
		label: "An emanation",
		icon: "fa-hurricane",
		gmOnly: true,
		hint: "A Thing's discharge, given form. Creates a monster stat block from a source or a blank emanation template.",
		create: () => _openCorruption("emanation"),
	},
];

// The first window. A row with `refine` is a group: picking it opens `refineTitle` on those rows.
const CONTENT_OPTIONS = [
	{
		id: "gear",
		label: "Gear & Treasure",
		icon: "fa-box-open",
		hint: "An inventory item, a treasure, or a homebrew arcanum. You pick which next.",
		refineTitle: "Create Gear or Treasure",
		refine: GEAR_OPTIONS,
	},
	{
		id: "move",
		label: "Move",
		icon: "fa-scroll",
		hint: "A custom move players can roll, saved as a reusable world move you drag onto character sheets.",
		create: () => _openWorldMove(),
	},
	{
		id: "improvement",
		label: "Steading Improvement",
		icon: "fa-screwdriver-wrench",
		hint: "A homebrew improvement card you drag onto Stonetop's Improvements tab.",
		create: () => _openImprovement(),
	},
	{
		id: "dangers",
		label: "Dangers & Places",
		icon: "fa-skull",
		hint: "A threat, a site, or one of the Things Below and their corruptions. You pick which next.",
		refineTitle: "Create a Danger or Place",
		refine: DANGER_OPTIONS,
	},
];

/** Drop headings with no row under them before the next heading (or the end). */
function _dropBareHeadings(rows) {
	return rows.filter((row, i) => !row.heading || (rows[i + 1] && !rows[i + 1].heading));
}

/**
 * The first window's rows for this user, each ready for `runPickedOption`.
 *
 * A group's `create` opens its refine window on the rows this user may run. A group left with
 * ONE such row is replaced by that row (its own label and hint), so no one is shown a window
 * with a single choice in it; a group left with none is dropped.
 *
 * @param {boolean} isGM
 * @param {{canArcana?: boolean}} [opts]  whether this user may author arcana (arcanaCreationGmOnly)
 */
export function contentOptionsFor(isGM, { canArcana = false } = {}) {
	const allowed = row => (!row.gmOnly || isGM) && (!row.arcanum || canArcana);
	return CONTENT_OPTIONS.flatMap(row => {
		if (!row.refine) return allowed(row) ? [row] : [];
		const rows = _dropBareHeadings(row.refine.filter(r => r.heading || allowed(r)));
		const choosable = rows.filter(r => !r.heading);
		if (choosable.length <= 1) return choosable;
		return [{
			...row,
			create: async () => runPickedOption(choosable, await pickContentOption({ title: row.refineTitle, options: rows })),
		}];
	});
}

/**
 * Open the chooser and hand off to the selected authoring flow. Each flow creates a
 * reusable, draggable artifact rather than a bare document.
 */
export async function openCreateStonetopContent() {
	const options = contentOptionsFor(!!game.user?.isGM, { canArcana: canCreateArcana() });
	return runPickedOption(options, await pickContentOption({ title: "Create Stonetop Content", options }));
}

/** A reusable world move, saved where every character sheet can drag it. */
async function _openWorldMove() {
	const { CustomMoveDialog, worldMoveSaver } =
		await import("../actors/character/dialogs/CustomMoveDialog.js");
	new CustomMoveDialog(worldMoveSaver(), {}).render(true);
}

/** A draggable steading-improvement card. */
async function _openImprovement() {
	const { openCreateImprovementDialog } = await import("./create-improvement-dialog.js");
	openCreateImprovementDialog();
}

/** A reusable world inventory item, or (`treasure`) a GM-only treasure with its write-up. */
async function _openInventoryItem({ treasure = false } = {}) {
	const { AddInventoryItemDialog, worldInventoryItemSaver } =
		await import("../actors/character/dialogs/AddInventoryItemDialog.js");
	new AddInventoryItemDialog(worldInventoryItemSaver({ treasure }), {
		allowColumnChoice: true,
		allowImage: true,
		treasure,
		titleKey: treasure ? "stonetop.inventory.createTreasure" : "stonetop.inventory.createWorldItem",
	}).render(true);
}

/** A plain homebrew threat card. */
function _openThreat() {
	return _seedThreatCard(async () => {
		const { CreateThreatDialog } = await import("../threats/create-threat-dialog.js");
		return new CreateThreatDialog(null, {}).promise();
	});
}

/**
 * The shared tail of every flow that ENDS in a draggable threat card: run a wizard, and if it
 * resolved a seed rather than being dismissed, write the card. Three wizards reach it (a plain
 * threat, a Thing Below, a corrupted site) and each used to re-spell the "if (seed)" half.
 *
 * @param {() => Promise<object|null>} runWizard  opens the wizard and resolves its seed
 */
async function _seedThreatCard(runWizard) {
	const seed = await runWizard();
	if (!seed) return null;
	const { createThreatSeedCard } = await import("../threats/threat-seed-cards.js");
	return createThreatSeedCard(seed);
}

/** Either Things Below corruption wizard; both create a `monster` stat block themselves. */
async function _openCorruption(mode) {
	const { CorruptBeingDialog } = await import("../things-below/corrupt-being-dialog.js");
	return new CorruptBeingDialog({ mode }).promise();
}

/**
 * Site flow (Book I, "Sites"): run the walkthrough and FILE the result under the steading, the
 * way the Sites tab's own button does. Sites aren't a draggable seed card like threats: a site
 * IS its write-up, and there is one place it belongs.
 *
 * Filed under the steading, READ on the GM Toolkit. Those are two different actors since the
 * Sites tab moved, and both matter here: `createSite` still takes the steading (the journal
 * that holds the page is pointed at by a flag on it), while the sheet to nudge afterwards is
 * the toolkit's.
 */
async function openCreateSite() {
	const { getStonetopSteadingActorOrWarn } = await import("../utils/world.js");
	const steading = getStonetopSteadingActorOrWarn({ because: "there is nowhere to file a site" });
	if (!steading) return;
	// The same flow the Sites tab's own button runs. Any open GM Toolkit picks the new card up
	// by watching its journal pages, so there is nothing to nudge from here.
	const { createSiteFlow } = await import("../actors/gmtoolkit/gm-prep-actions.js");
	// quietSave: this says where the site went, so the walkthrough's own Save for now notice would repeat it.
	const page = await createSiteFlow(steading, { quietSave: true });
	if (!page) return;
	// Said HERE and not in the flow: creating from the tab shows you the card appear, but this
	// path may leave the toolkit closed entirely, so it has to say where the site went.
	ui.notifications?.info?.(`Added site: ${page.name}. It's at the foot of the GM Toolkit's Expeditions tab.`);
}

/**
 * Defensive gate (the chooser already hides the arcanum rows for non-authors): never author
 * arcana for a player when arcanaCreationGmOnly is on, even if a flow is reached directly.
 */
function _mayCreateArcana() {
	if (canCreateArcana()) return true;
	ui.notifications?.warn(game.i18n.localize("stonetop.arcana.createGmOnly"));
	return false;
}

/**
 * A blank card, opened in the editor; its Identity page picks the tier. Mirrors the
 * `game.stonetop.createArcanum` console helper (see Ready.js).
 */
async function _createBlankArcanum() {
	if (!_mayCreateArcana()) return;
	const { createArcanumItem } = await import("../item/createArcanum.js");
	return createArcanumItem({ name: "New Arcanum", major: false });
}

/**
 * The Artifact Creation wizard, whose rolled results pre-fill the card before the editor opens.
 * Mirrors the `game.stonetop.inspireArcanum` console helper (see Ready.js).
 */
async function _openArcanaInspire() {
	if (!_mayCreateArcana()) return;
	const { createArcanumItem } = await import("../item/createArcanum.js");
	const { StonetopArcanaInspireDialog } = await import("../item/StonetopArcanaInspireDialog.js");
	new StonetopArcanaInspireDialog({
		onCreate: ({ name, major, front }) => createArcanumItem({ name, major, front }),
	}).render(true);
}
