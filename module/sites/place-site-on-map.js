// "Which site?" — the chooser behind the route step's Put-a-site-on-the-map button.
//
// ONE BUTTON, BOTH ANSWERS. A GM reaching for this has either already written the place up and
// wants it on the map, or is looking at the map and has just decided there ought to be something
// in that valley. Those are the same intention arriving from two directions, so they are one
// control with a list: every site this steading has, and a last row that opens Book I's four
// phases and comes back with a new one. The row IS the flow (see `runPickedOption`), so a site
// added to the list cannot end up with no way to reach it.
//
// The gesture itself lives here too, and not in the walkthrough that first offered it. A site's
// spot is a flag on the PAGE, not anything about a trip: the walkthrough was simply the first
// surface with a map on it. Keeping the whole act here is what lets the popout do it without
// reaching back through the panel for code that has nothing to do with the journey, and what lets
// the next surface that grows a map offer the same gesture by calling it.
//
// What is NOT here is what to redraw afterwards. That genuinely is the caller's business: each
// surface knows which of its own views is showing pins.
import { pickContentOption, runPickedOption } from "../dialogs/content-picker.js";
import { createSiteFlow } from "../actors/gmtoolkit/gm-prep-actions.js";
import { listSitePages } from "./site-store.js";
import { clearSiteMapSpot, setSiteMapSpot, siteMapTier } from "./site-map-spots.js";
import { syncSitePin } from "./site-scene-pins.js";
import { percentSpot, travelMap } from "../data/travel-times.js";
import { getStonetopSteadingActorOrWarn } from "../utils/world.js";
import { format, localize } from "../utils/i18n.js";

/**
 * The mark a site wears in a LIST, shared with the sidebar's own "Create Stonetop Content" row so
 * the same thing is offered under the same picture wherever a GM meets it.
 *
 * Deliberately NOT the mark it wears as a pin on the map, which is a standing stone: that one is
 * drawn at 18px, where this one collapses into something that reads as a broken-image placeholder.
 * See the site block in expedition-journey-pins.hbs. One idea, two sizes, two drawings.
 */
export const SITE_ICON = "fa-mountain-sun";

/** The id of the row that writes a new one, kept off any page id by the underscores. */
const NEW_SITE = "__new__";

/**
 * What one existing site's row says under its name.
 *
 * The card's own foundation line (what manner of site, what country, what terrain), which is the
 * shortest true description a site has and the one the Sites tab already leads with. Where the
 * site is already pinned that outranks it: a GM scanning this list for something to place needs
 * to know which of these are placed before they need to be reminded what they are.
 */
function siteHint(page) {
	const tier = siteMapTier(page);
	if (tier) return format("stonetop.expedition.sites.alreadyOn", { map: travelMap(tier)?.name ?? tier });
	const sys = page.system ?? {};
	return [sys.mannerLabel, sys.regionLabel, sys.terrain]
		.map(s => String(s ?? "").trim())
		.filter(Boolean)
		.join(", ");
}

/**
 * Ask which site is going on the map, writing a new one if that is the answer.
 *
 * @param {Actor} steading  where this world's sites are filed
 * @param {string} tier     the map being placed on, for the window title alone
 * @returns {Promise<JournalEntryPage|null>}  the site to place, or null if the GM backed out
 *          (of the chooser OR of the walkthrough behind its last row).
 */
export async function chooseSiteForMap(steading, tier) {
	if (!steading) return null;

	const options = listSitePages(steading).map(page => ({
		id: page.id,
		label: page.name,
		icon: SITE_ICON,
		hint: siteHint(page),
		// Already in hand. The chooser's contract is that a row's `create` produces the thing, and
		// for a site that already exists producing it is handing it back.
		create: () => page,
	}));

	// LAST, not first. With prep written, placing it is what this button is for and the list is
	// what the GM came to read; the walkthrough is the answer to a rarer question, and a row that
	// opens a nine-step dialog is the wrong thing to have pre-selected under a Continue button.
	// With no prep at all it is the only row, so it is first by default anyway.
	options.push({
		id: NEW_SITE,
		label: localize("stonetop.expedition.sites.createNew"),
		icon: "fa-plus",
		hint: localize("stonetop.expedition.sites.createNewHint"),
		create: () => createSiteFlow(steading),
	});

	const choice = await pickContentOption({
		title: format("stonetop.expedition.sites.chooseTitle", {
			map: travelMap(tier)?.name ?? localize("stonetop.expedition.sites.thisMap"),
		}),
		options,
		buttonLabel: localize("stonetop.expedition.sites.chooseButton"),
	});
	return (await runPickedOption(options, choice)) ?? null;
}

// NO `openSiteWriteUp` ANY MORE. It existed for one caller — a tap on a site pin over the route
// map — and that tap lays a stop on the way there now instead (user, 2026-08-24: a site pin is a
// route control like every other mark on that picture, not a link out of the screen). The write-up
// is read where it is written, on the steading's Sites tab, which is also the only place that can
// show a site beside its siblings.

/**
 * Choose a site, then take the click that says where it goes, then write it down.
 *
 * THE CHOOSING COMES FIRST, deliberately. The other order (click the map, then say what is there)
 * reads well until the GM has to leave the map to write the site up: Book I's walkthrough is nine
 * steps long, and by the time it closes the point they were aiming at is gone from under the
 * cursor and from their head. Choosing first means the last thing that happens is the click, which
 * is the part that has to be precise.
 *
 * @param {object} surface
 * @param {string} surface.tier        which map is showing, since a spot belongs to one
 * @param {object} surface.frame       that file's registration, for `percentSpot`
 * @param {Function} surface.pickPoint `()` -> Promise of `{left, top}` percentages, or null
 * @returns {Promise<boolean>} whether a pin was actually written, so the caller knows to redraw.
 */
export async function placeSiteOnMap({ tier, frame, pickPoint } = {}) {
	const steading = getStonetopSteadingActorOrWarn({ because: "there is nowhere to file a site" });
	if (!steading) return false;

	const page = await chooseSiteForMap(steading, tier);
	// Backed out of the chooser, or out of the nine-step walkthrough behind its last row.
	if (!page) return false;

	ui.notifications?.info(format("stonetop.expedition.sites.clickToPlace", { name: page.name }));
	const at = await pickPoint();
	// Escape, a right-click, or the window closing with the gesture still armed. A site written on
	// the way through is KEPT: it is prep either way, it is already on the Sites tab, and binning
	// somebody's nine steps of typing because they changed their mind about the pin would be the
	// worst possible reading of "cancel".
	if (!at) return false;

	const mapName = travelMap(tier)?.name ?? localize("stonetop.expedition.sites.thisMap");

	// The answer is CHECKED, not assumed. `setSiteMapSpot` refuses a fraction outside the printed
	// crop and writes nothing, and that is a reachable click rather than a broken caller: the
	// picker shows the whole map FILE, whose registered crop is inset a few percent inside it, so
	// aiming at the margin band is an ordinary miss. Announced as placed, it would send the caller
	// off to redraw a pin that is not there, or report a move that never happened while the old
	// pin sits where it always was.
	const spot = await setSiteMapSpot(page, { tier, ...percentSpot(at, frame) });
	if (!spot) {
		ui.notifications?.warn(format("stonetop.expedition.sites.offTheMap", {
			name: page.name,
			map: mapName,
		}));
		return false;
	}

	// AND ON THE TABLE'S OWN COPY OF THAT MAP, if this world has built one. A spot is one fact
	// about where a site stands, so marking it on the planner's little map and leaving the Scene
	// the players are looking at unmarked would be half an answer — and the half nobody at the
	// table can see. See sites/site-scene-pins.js: it is the same fraction, laid through the same
	// conversion the book's own place markers use.
	//
	// AFTER the spot is written, never before. The Scene pin is a picture OF that spot; drawing it
	// first would mean a refused write left a pin on the table's map for a placement that never
	// happened.
	const pinned = await syncSitePin(page, spot);

	// The write-up took the spot either way, so this is always the good news — but a Scene that
	// refused the pin is said out loud rather than passed over, since a GM who is not told will go
	// looking for a mark that was never laid.
	ui.notifications?.info(format(pinnedMessage(pinned), {
		name: page.name,
		map: mapName,
		scene: pinned?.scene?.name ?? "",
	}));
	if (pinned?.refused) {
		ui.notifications?.warn(format("stonetop.expedition.sites.pinRefused", { map: mapName }));
	}
	return true;
}

/**
 * Which sentence the GM reads, out of the things that can have happened.
 *
 * Named separately because the difference is worth saying: a pin appearing on the Scene the table
 * plays on is news, a pin MOVING there is different news, and a world with no such Scene should not
 * be told about a map it does not have. The Scene is named rather than described, because a GM may
 * well have renamed it and it is the thing they are about to go and look at.
 *
 * A REFUSED pin reads as the plain "placed", because that is exactly what happened: the site knows
 * where it stands and no Scene was marked. What was wrong with the Scene is a separate sentence
 * (see the caller), so this one does not have to hedge.
 */
function pinnedMessage(pinned) {
	if (!pinned || pinned.refused) return "stonetop.expedition.sites.placed";
	return pinned.moved
		? "stonetop.expedition.sites.placedMoved"
		: "stonetop.expedition.sites.placedPinned";
}

/**
 * Lift a pin back off the map.
 *
 * NO CONFIRMATION, because nothing is destroyed: the write-up stays exactly where it was on the
 * Sites tab, and putting the pin back is the same two clicks that put it there. That is the whole
 * difference between this and the trash on that tab, which does ask.
 *
 * @returns {Promise<boolean>} whether a pin was actually lifted.
 */
export async function liftSiteOffMap(uuid) {
	if (!uuid) return false;
	const page = await fromUuid(uuid).catch(() => null);
	if (!page) return false;
	await clearSiteMapSpot(page);
	// The other half of the same door. A pin this system put on the table's copy of the map is a
	// picture of the spot that has just been cleared, so leaving it there would have the two maps
	// disagreeing about whether the site is placed at all. Only the regional poster Scenes and only
	// pins linked to this page: a mark the GM dragged onto a dungeon of their own is theirs.
	//
	// Its answer is not read, and there is nothing here to word from it: "off the map" is the whole
	// of what happened, whether or not this world had a Scene to take a pin off as well.
	await syncSitePin(page, null);
	ui.notifications?.info(format("stonetop.expedition.sites.removed", { name: page.name }));
	return true;
}
