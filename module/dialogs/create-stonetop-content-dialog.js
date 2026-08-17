// The sidebar "Create Item" entry point for Stonetop's hand-authored, drag-and-drop
// content. Improvements and threats aren't Item sub-types, so rather than Foundry's
// Item type picker we show our own chooser and hand off to each authoring flow: a
// reusable world Move, a draggable steading-improvement card, a draggable threat card,
// a reusable world inventory item, or a homebrew arcanum. Opened from StonetopItem.createDialog.

import { canCreateArcana } from "../utils/authoring-gates.js";
import { pickContentOption, runPickedOption } from "./content-picker.js";

// What the chooser offers, and what each row DOES. The flow sits on the row rather than in an
// if/else ladder beside it: a kind added to one and missed in the other is a picker option that
// silently creates nothing, or a flow nothing can reach, and neither fails loudly. The same holds
// for the two sub-choosers below, which had the same shape.
const CONTENT_OPTIONS = [
	{
		id: "arcanum",
		label: "Arcanum",
		icon: "fa-wand-sparkles",
		hint: "A homebrew major or minor arcanum card, opened in the card editor as a reusable world item.",
		create: () => openCreateArcanum(),
	},
	{
		id: "inventory",
		label: "Inventory Item",
		icon: "fa-box-open",
		hint: "A custom gear item, saved as a reusable world item you drag onto any character's Inventory tab.",
		create: () => _openInventoryItem(),
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
		id: "threat",
		label: "Threat",
		icon: "fa-skull",
		hint: "A homebrew threat card you drag onto the GM Toolkit's Threats tab.",
		create: () => _openThreat(),
	},
	{
		id: "thingBelow",
		label: "Thing Below",
		icon: "fa-eye",
		hint: "Create a Thing Below, a corrupted site, a corrupted being, or an emanation (Book II).",
		create: () => openCreateThingBelow(),
	},
	{
		id: "site",
		label: "Site",
		icon: "fa-mountain-sun",
		hint: "Walk through Book I's Creating Sites process. The write-up lands on the GM Toolkit's Sites tab, ready to pin to a scene.",
		create: () => openCreateSite(),
	},
];

// The Thing Below sub-chooser (shown after picking "Thing Below"): the four Book II
// creation flows. Thing + Corrupted Site become draggable threat cards; Corrupted Being +
// Emanation create monster stat-block actors directly.
const THING_BELOW_KIND_OPTIONS = [
	{
		id: "thing",
		label: "A Thing Below",
		icon: "fa-eye",
		hint: "A primordial entity of darkness and corruption. Combine themes + aspects + an instinct; written up as a magical-entity threat.",
		create: () => _seedThreatCard(async () => {
			const { CreateThingDialog } = await import("../things-below/create-thing-dialog.js");
			return new CreateThingDialog().promise();
		}),
	},
	{
		id: "site",
		label: "A corrupted site",
		icon: "fa-mountain-sun",
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
		hint: "Twist an existing monster: add gifts, marks, and the corrupted tag. Creates a monster stat block.",
		create: () => _openCorruption("being"),
	},
	{
		id: "emanation",
		label: "An emanation",
		icon: "fa-hurricane",
		hint: "A Thing's discharge, given form. Creates a monster stat block from a source or a blank emanation template.",
		create: () => _openCorruption("emanation"),
	},
];

// The Arcanum sub-chooser (shown after picking "Arcanum"): a blank card of either tier,
// or the Artifact Creation wizard that seeds a card from rolled inspiration.
const ARCANUM_KIND_OPTIONS = [
	{
		id: "minor",
		label: "Minor arcanum",
		icon: "fa-scroll",
		hint: "A blank minor arcanum (a curio with a hidden power), opened in the card editor.",
		create: () => _createBlankArcanum(false),
	},
	{
		id: "major",
		label: "Major arcanum",
		icon: "fa-wand-sparkles",
		hint: "A blank major arcanum (its own card art and major semantics), opened in the card editor.",
		create: () => _createBlankArcanum(true),
	},
	{
		id: "inspire",
		label: "Inspire me…",
		icon: "fa-dice-d20",
		hint: "Roll the Book II Artifact Creation tables (origin, nature, form) for a themed starting point, then build the card from the results.",
		create: () => _openArcanaInspire(),
	},
];

/** Top-level chooser. Resolves to a CONTENT_OPTIONS id or null. */
function pickContentType() {
	// Homebrew arcana obey arcanaCreationGmOnly (default GM-only); drop the Arcanum option
	// for a player who isn't allowed to author it, so the sidebar can't bypass the same gate
	// the arcana-tab "Create arcanum" buttons enforce.
	let options = canCreateArcana() ? CONTENT_OPTIONS : CONTENT_OPTIONS.filter(o => o.id !== "arcanum");
	// Things Below and sites are GM prep (they end in world threats/monsters, or a page of the
	// steading's GM-only Sites journal, and those stores are GM-only).
	if (!game.user?.isGM) options = options.filter(o => o.id !== "thingBelow" && o.id !== "site");
	return pickContentOption({ title: "Create Stonetop Content", options });
}

/** Thing Below kind chooser. Resolves to "thing" | "site" | "being" | "emanation" or null. */
function pickThingBelowKind() {
	return pickContentOption({ title: "Create a Thing Below", options: THING_BELOW_KIND_OPTIONS });
}

/** Arcanum tier chooser. Resolves to "minor" | "major" | "inspire" or null. */
function pickArcanumKind() {
	return pickContentOption({ title: "Create Arcanum", options: ARCANUM_KIND_OPTIONS });
}

/**
 * Open the chooser and hand off to the selected authoring flow. Each flow creates a
 * reusable, draggable artifact rather than a bare document.
 */
export async function openCreateStonetopContent() {
	return runPickedOption(CONTENT_OPTIONS, await pickContentType());
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

/** A reusable world inventory item. */
async function _openInventoryItem() {
	const { AddInventoryItemDialog, worldInventoryItemSaver } =
		await import("../actors/character/dialogs/AddInventoryItemDialog.js");
	new AddInventoryItemDialog(worldInventoryItemSaver(), {
		allowColumnChoice: true,
		titleKey: "stonetop.inventory.createWorldItem",
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
	const page = await createSiteFlow(steading);
	if (!page) return;
	// Said HERE and not in the flow: creating from the tab shows you the card appear, but this
	// path may leave the toolkit closed entirely, so it has to say where the site went.
	ui.notifications?.info?.(`Added site: ${page.name}. It's on the GM Toolkit's Sites tab.`);
}

/**
 * Second-step Thing Below flow (Book II, The Things Below): pick which of the four creation
 * wizards to run. Thing + Corrupted Site resolve a threat SEED that becomes a draggable card
 * (dropped onto the GM Toolkit's Threats tab, like the plain Threat flow); Corrupted Being +
 * Emanation open the lighter corruption dialog, which creates a `monster` stat-block actor.
 */
async function openCreateThingBelow() {
	if (!game.user?.isGM) {
		ui.notifications?.warn("Only the GM can create Things Below.");
		return;
	}
	return runPickedOption(THING_BELOW_KIND_OPTIONS, await pickThingBelowKind());
}

/**
 * Second-step Arcanum flow: pick a tier (or the inspiration wizard), then create a
 * standalone homebrew arcanum world Item and open its editor. Mirrors the
 * `game.stonetop.createArcanum` / `inspireArcanum` console helpers (see Ready.js): a
 * blank card for major/minor, or the Artifact Creation wizard whose rolled results
 * pre-fill the card before the editor opens.
 */
async function openCreateArcanum() {
	// Defensive gate (the chooser already hides the Arcanum option for non-authors): never
	// author arcana for a player when arcanaCreationGmOnly is on, even if this is reached directly.
	if (!canCreateArcana()) {
		ui.notifications?.warn(game.i18n.localize("stonetop.arcana.createGmOnly"));
		return;
	}
	return runPickedOption(ARCANUM_KIND_OPTIONS, await pickArcanumKind());
}

/** A blank card of either tier, opened in the editor. */
async function _createBlankArcanum(major) {
	const { createArcanumItem } = await import("../item/createArcanum.js");
	return createArcanumItem({ name: major ? "New Major Arcanum" : "New Minor Arcanum", major });
}

/** The Artifact Creation wizard, whose rolled results pre-fill the card before the editor opens. */
async function _openArcanaInspire() {
	const { createArcanumItem } = await import("../item/createArcanum.js");
	const { StonetopArcanaInspireDialog } = await import("../item/StonetopArcanaInspireDialog.js");
	new StonetopArcanaInspireDialog({
		onCreate: ({ name, major, front }) => createArcanumItem({ name, major, front }),
	}).render(true);
}
