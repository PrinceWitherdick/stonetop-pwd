import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { SYSTEM_ID } from "../system-id.js";
import { prefersReducedMotion } from "../utils/reduced-motion.js";
import { getStonetopSteadingActor, isSteadingActor } from "../utils/world.js";
import { currentSeasonView, nextSeasonStamp, readCurrentSeason, readCurrentYear } from "./current-season.js";
import { START_YEAR_CHANGED_HOOK } from "./campaign-year.js";
import { currentWeatherView, readCurrentWeather } from "./current-weather.js";
import { seasonLabel } from "./seasons-change-reminders.js";
import { yearLabel } from "./seasons-chronicle.js";

// ── The weather, the season and the year, at the top of the screen ────────────────────────────
// One bar hanging from the top edge of the canvas in three parts, for the whole table: what the
// sky is doing, the season Stonetop is in, and the year that season belongs to. Brought over from
// the Mythic Bastionland system's Phase/Season/Age banner.
//
// A VIEW AND NOTHING ELSE. Every fact on it is the steading's, already stored and already drawn on
// the steading header: the weather from `weatherCurrent` (current-weather.js), the season and the
// year from the `seasonsCurrent` STAMP (current-season.js). It reads them through the same two
// view functions the header's template paints from, so the bar and the header cannot say two
// different things, and it is repainted off the steading's own `updateActor`, so it turns on
// every client the moment a GM posts a weather or completes a Seasons Change.
//
// Each part is painted in its own light, as Bastionland's are: the weather in its sky's, the season
// in its season's, the year in the parchment of Bastionland's Age. THE ONE SANCTIONED EXCEPTION to
// "only the steading clock colours by season" (the user's call, 2026-09-27), and it is kept narrow:
// the bar's season lights are gradients of its own, declared on its own classes in stonetop.css,
// and it never reads the four `--stonetop-season-*-ink` tokens, which stay the clock's alone.
//
// A GM's parts are buttons. The weather opens the Weather picker, the window that decides it. The
// season and the year let down two buttons under the bar, the way Bastionland's parts let down its
// ways of moving time on: NEXT SEASON runs the Seasons Change move straight for the season after
// this one, and CHANGE SEASON opens the move's picker to choose (which carries its own door to
// correcting the clock without making the move). Nobody else's parts do anything.
//
// Per browser, through `timeBannerShown`: a player who finds it in the way takes it down for
// themselves and nobody else.

/** The bar's element id. */
export const TIME_BANNER_ID = "stonetop-time-banner";

/** The parts, left to right. */
export const TIME_BANNER_PARTS = Object.freeze(["weather", "season", "year"]);

/** The year's glyph, Bastionland's Age hourglass. */
const YEAR_ICON = "fa-solid fa-hourglass-half";

/**
 * How long a slide may take before its part is turned regardless. The face's `animationend` is
 * what normally finishes it, and a stylesheet that turned the animation off would never send one.
 */
const TURN_TIMEOUT_MS = 1500;

/** @type {HTMLElement|null} The one bar, while it's up. */
let banner = null;

/** @type {WeakMap<HTMLElement, () => void>} Each part a new face is still sliding in over, and what puts it up at once. */
const turning = new WeakMap();

/** @type {HTMLElement|null} The GM's season buttons, hanging under the bar while they're let down. */
let menu = null;

/** The parts whose press lets the season buttons down. */
const SEASON_PARTS = Object.freeze(["season", "year"]);

let installed = false;

/**
 * The buttons a GM's press on the season or the year lets down, left to right. Pure, so the tests
 * drive it directly: Next Season's hover names the exact season and year it will begin, since it
 * runs the move without asking.
 *
 * @param {{season: string, year: number}|null} stamp  From readCurrentSeason.
 * @param {number} [fallbackYear=1]                    Usually seasonsCurrentYear.
 */
export function seasonMenuItems(stamp, fallbackYear = 1) {
	const next = nextSeasonStamp(stamp, fallbackYear);
	return [
		{
			move:  "next",
			icon:  "fa-solid fa-forward",
			label: "Next Season",
			hint:  `Make the Seasons Change move for ${seasonLabel(next.season)}, ${yearLabel(next.year)}`,
		},
		{
			move:  "change",
			icon:  "fa-solid fa-calendar-days",
			label: "Change Season",
			hint:  "Choose which season is beginning, or just correct what the sheet says",
		},
		{
			// What the years are CALLED, not which one it is: every recorded year moves with it.
			move:  "year",
			icon:  "fa-solid fa-hourglass-half",
			label: "Set the Year",
			hint:  "Say what year it is in your campaign; every recorded year, history included, moves with it",
		},
	];
}

/**
 * What each part of the bar says, left to right. Pure, so the tests drive it directly.
 *
 * `value` is what the part is turned BY: a new face slides in only when it changes, so a repaint
 * for some unrelated flag on the steading leaves the bar still. `light` is the class that paints
 * it, and it rides on the sliding face too, so a new season drops in already in its own colours.
 *
 * @param {ReturnType<typeof currentWeatherView>} weather
 * @param {ReturnType<typeof currentSeasonView>}  season
 * @param {{isGM?: boolean}} [opts]
 */
export function timeBannerTabs(weather, season, { isGM = false } = {}) {
	const seasonHint = isGM ? "Next Season, Change Season or Set the Year" : "";
	return [
		{
			part:    "weather",
			value:   weather.sky,
			label:   weather.label,
			// The row's own line: the glyph and the word say what kind of day it is, the hover
			// says which day exactly. Everybody gets it, as on the steading header.
			tooltip: weather.text,
			// The drawing comes off the shared sky class; the un-set sun is softened the same way
			// the header softens it, because a sun nobody chose should not be as loud as one they did.
			glyph:   `stonetop-time-banner__sky stonetop-sky--${weather.sky}${weather.stamped ? "" : " stonetop-time-banner__sky--unset"}`,
			light:   `stonetop-time-banner--sky-${weather.sky}`,
		},
		{
			part:    "season",
			value:   season.season,
			label:   season.label,
			tooltip: seasonHint,
			// A game-icons.net glyph masked in the light's own colour, like the sky beside it. NOT
			// the book's season art the Chronicle heads a season with: that is a traced bitmap,
			// and at bar size its edge breaks up into stair-steps.
			glyph:   `stonetop-time-banner__season stonetop-time-banner__season--${season.season}`,
			light:   `stonetop-time-banner--season-${season.season}`,
		},
		{
			part:    "year",
			// By its name, not its number: the GM renaming the years turns the part as a new year would.
			value:   season.yearLabel,
			label:   season.yearLabel,
			tooltip: seasonHint,
			glyph:   `stonetop-time-banner__icon ${YEAR_ICON}`,
			light:   "stonetop-time-banner--year",
		},
	];
}

/**
 * The whole date in one line, for the bar's accessible name — "Rain, Autumn, Year Two".
 * @param {ReturnType<typeof timeBannerTabs>} tabs
 */
export function timeBannerLabel(tabs) {
	return tabs.map(tab => tab.label).join(", ");
}

/**
 * What the bar shows for a steading, or null when there is no steading to show.
 *
 * No steading is no bar rather than a default one: there is nothing a GM could press to change
 * it, and a table that is not playing in Stonetop at all should not have Spring of the First Year
 * hung over its map.
 */
export function timeBannerTabsFor(actor, opts) {
	if (!actor) return null;
	return timeBannerTabs(
		currentWeatherView(readCurrentWeather(actor)),
		currentSeasonView(readCurrentSeason(actor), readCurrentYear(actor)),
		opts,
	);
}

/** @returns {boolean} Whether this browser shows the bar. */
function timeBannerShown() {
	try {
		return game.settings.get(SYSTEM_ID, "timeBannerShown") !== false;
	} catch {
		return true;
	}
}

/** The glyph and the words a part shows. */
function faceHTML({ label, glyph }) {
	// An <i> for the Font Awesome hourglass, a <span> for the drawn glyphs; hidden either way, the words say it.
	const tag = glyph.includes("fa-") ? "i" : "span";
	return `<${tag} class="${glyph}" aria-hidden="true"></${tag}>`
		+ `<span class="stonetop-time-banner__label">${foundry.utils.escapeHTML(label)}</span>`;
}

/** Show a face on a part at once, in its own light. */
function dress(tab, face) {
	tab.className = `stonetop-time-banner__tab stonetop-time-banner__tab--${face.part} ${face.light}`;
	tab.dataset.value = face.value;
	tab.innerHTML = faceHTML(face);
}

/** Slide a new face down over the part from the top edge, the old one still showing under it until it's covered. */
function turn(tab, face) {
	const cover = document.createElement("span");
	cover.className = `stonetop-time-banner__face ${face.light}`;
	cover.innerHTML = faceHTML(face);
	tab.dataset.value = face.value;
	const finish = () => {
		if (turning.get(tab) !== finish) return;
		turning.delete(tab);
		clearTimeout(timer);
		dress(tab, face);
	};
	const timer = setTimeout(finish, TURN_TIMEOUT_MS);
	cover.addEventListener("animationend", finish);
	turning.set(tab, finish);
	tab.append(cover);
}

/** Paint the bar, letting a part turn if what it shows has changed. */
function paint(tabs) {
	if (!banner) return;
	banner.setAttribute("aria-label", timeBannerLabel(tabs));
	for (const face of tabs) {
		const tab = banner.querySelector(`[data-part="${face.part}"]`);
		if (!tab) continue;
		// A season part's hover would drop over the buttons let down under it, so it waits until they're put away.
		if (face.tooltip && !(menu && SEASON_PARTS.includes(face.part))) tab.dataset.tooltip = face.tooltip;
		else delete tab.dataset.tooltip;
		// Already sliding in; a second change straight after the first puts that one up and slides again.
		const sliding = turning.get(tab);
		if (sliding && tab.dataset.value === face.value) continue;
		sliding?.();
		const turned = tab.dataset.value && tab.dataset.value !== face.value;
		if (turned && !prefersReducedMotion()) turn(tab, face);
		else dress(tab, face);
	}
}

/** What each season button runs. Through `game.stonetop`, like the hotbar macros, so each keeps to one window. */
const SEASON_MOVES = Object.freeze({
	next:   () => game.stonetop?.openNextSeason?.(),
	change: () => game.stonetop?.openSeasonsChange?.(),
	year:   () => game.stonetop?.openCampaignYear?.(),
});

/** The steading's clock as the season buttons read it, or the header's defaults with no steading. */
function seasonMenuItemsNow() {
	const steading = getStonetopSteadingActor();
	return seasonMenuItems(readCurrentSeason(steading), readCurrentYear(steading));
}

/** Say on each season button what it will do: Next Season names the season it would begin. */
function labelSeasonMenu() {
	if (!menu) return;
	for (const { move, hint } of seasonMenuItemsNow()) {
		const button = menu.querySelector(`[data-move="${move}"]`);
		if (button) button.dataset.tooltip = hint;
	}
}

/** Let the season buttons down under the season part. */
function openSeasonMenu() {
	if (!banner || menu) return;
	menu = document.createElement("nav");
	// In the year's parchment, as Bastionland's buttons are in its Age's.
	menu.className = "stonetop-time-banner__moves stonetop-time-banner--year";
	menu.setAttribute("aria-label", "Season");
	// The bar reads each new date out; the buttons coming and going aren't news.
	menu.setAttribute("aria-live", "off");
	for (const { move, icon, label } of seasonMenuItemsNow()) {
		const button = document.createElement("button");
		button.type = "button";
		button.dataset.move = move;
		button.innerHTML = `<i class="${icon}" aria-hidden="true"></i> ${foundry.utils.escapeHTML(label)}`;
		button.addEventListener("click", () => {
			closeSeasonMenu();
			SEASON_MOVES[move]();
		});
		menu.append(button);
	}
	banner.append(menu);
	// Hung under the middle of the season part rather than of the whole bar, so it drops from what was pressed.
	const anchor = banner.querySelector('[data-part="season"]');
	if (anchor) menu.style.left = `${anchor.offsetLeft + anchor.offsetWidth / 2}px`;
	labelSeasonMenu();
	for (const part of SEASON_PARTS) {
		const tab = banner.querySelector(`[data-part="${part}"]`);
		tab?.setAttribute("aria-expanded", "true");
		if (tab) delete tab.dataset.tooltip;
	}
	game.tooltip?.deactivate?.();
	document.addEventListener("pointerdown", awayFromSeasonMenu, true);
	document.addEventListener("keydown", escapeSeasonMenu, true);
}

/** Put the season buttons away again. */
function closeSeasonMenu() {
	if (!menu) return;
	menu.remove();
	menu = null;
	document.removeEventListener("pointerdown", awayFromSeasonMenu, true);
	document.removeEventListener("keydown", escapeSeasonMenu, true);
	if (!banner) return;
	for (const part of SEASON_PARTS) banner.querySelector(`[data-part="${part}"]`)?.setAttribute("aria-expanded", "false");
	refreshTimeBanner();
}

/** @param {PointerEvent} event A press anywhere but the bar puts the buttons away. */
function awayFromSeasonMenu(event) {
	if (!banner?.contains(event.target)) closeSeasonMenu();
}

/** @param {KeyboardEvent} event Escape puts the buttons away. */
function escapeSeasonMenu(event) {
	if (event.key !== "Escape") return;
	event.stopPropagation();
	closeSeasonMenu();
}

/** What a GM's press on a part does: the weather opens its picker, the season and the year let the season buttons down. */
function onPress(part) {
	if (part === "weather") {
		closeSeasonMenu();
		game.stonetop?.openWeather?.();
	} else if (menu) closeSeasonMenu();
	else openSeasonMenu();
}

/** Build the empty bar: one part per TIME_BANNER_PARTS, buttons for a GM. */
function build() {
	const gm = Boolean(game.user?.isGM);
	const bar = document.createElement("div");
	bar.id = TIME_BANNER_ID;
	bar.className = "stonetop-time-banner";
	// Read out as it turns, the way Bastionland's does: a new season is news.
	bar.setAttribute("role", "status");
	for (const part of TIME_BANNER_PARTS) {
		const tab = document.createElement(gm ? "button" : "div");
		tab.className = `stonetop-time-banner__tab stonetop-time-banner__tab--${part}`;
		tab.dataset.part = part;
		if (gm) {
			tab.type = "button";
			if (SEASON_PARTS.includes(part)) {
				tab.setAttribute("aria-haspopup", "true");
				tab.setAttribute("aria-expanded", "false");
			}
			tab.addEventListener("click", () => onPress(part));
		}
		bar.append(tab);
	}
	return bar;
}

/** Take the bar down. */
export function closeTimeBanner() {
	// The bar goes first, so putting its buttons away has nothing left to repaint.
	banner?.remove();
	banner = null;
	closeSeasonMenu();
}

/** Put the bar up at the top of the screen, or bring it up to date if it's already there. */
export function refreshTimeBanner() {
	const tabs = timeBannerShown() ? timeBannerTabsFor(getStonetopSteadingActor(), { isGM: game.user?.isGM }) : null;
	if (!tabs) return closeTimeBanner();
	const top = globalThis.document?.getElementById("ui-top");
	if (!top) return;
	if (!banner) {
		banner = build();
		top.prepend(banner);
	}
	paint(tabs);
}

/**
 * Put the bar up and keep it turning with the steading. Idempotent, and called once from the
 * `ready` hook: it mounts into core's own `#ui-top`, which does not exist until the interface has
 * been rendered.
 */
export function installTimeBanner() {
	if (installed) return;
	installed = true;

	// Any change to our flags on the steading repaints. Cheaper than it sounds: a part only
	// rewrites itself when the value it is turned by has moved, so the bar sits still through
	// every other flag the steading carries.
	Hooks.on("updateActor", (actor, changed) => {
		if (!isSteadingActor(actor) || changed?.flags?.[STONETOP_SCOPE] === undefined) return;
		refreshTimeBanner();
		// A season recorded while the buttons are down moves the one Next Season would begin.
		labelSeasonMenu();
	});
	// The steading arriving or leaving is the difference between a bar and none.
	for (const hook of ["createActor", "deleteActor"]) {
		Hooks.on(hook, (actor) => { if (isSteadingActor(actor)) refreshTimeBanner(); });
	}
	// The GM renaming the years: the year part says the new name, and Next Season's hover with it.
	Hooks.on(START_YEAR_CHANGED_HOOK, () => {
		refreshTimeBanner();
		labelSeasonMenu();
	});
	// The per-browser switch, which core announces by key.
	Hooks.on("clientSettingChanged", (key) => {
		if (String(key ?? "") === `${SYSTEM_ID}.timeBannerShown`) refreshTimeBanner();
	});

	refreshTimeBanner();
}
