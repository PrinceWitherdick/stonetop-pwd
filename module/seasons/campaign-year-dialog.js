// "WHAT YEAR IS IT?" -- the GM naming the campaign's years, and everything that follows from it.
//
// Asked as the year it is NOW rather than the year play began, because that is the number a GM
// knows ("it's 1249, three years since the Hillfolk winter"), and the two say the same thing: the
// start year is worked out from the clock's own count (`startYearFor`, campaign-year.js). In a
// new world the clock reads the first year, so the answer IS the start year, and the session-zero
// walkthrough asks it in exactly this shape (SpringBurstDialog's spring step).
//
// Changing it later moves EVERY recorded year, history included, because nothing stored changes:
// the setting only renames stored years. What does need doing is the repaint, below.
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { contentElement } from "../dialogs/content-picker.js";
import { escHtml } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { renameAllSeasonYearPages } from "../migration/season-year-page-names.js";
import { timelineNow } from "../timeline/timeline-record.js";
import { cardinalWord } from "./seasons-chronicle.js";
import {
	MAX_START_YEAR, START_YEAR_CHANGED_HOOK, displayYear, setStartYear, startYearFor, typedYear,
} from "./campaign-year.js";

/**
 * What the window says under the field, for what is typed in it. Pure, so the tests drive it.
 *
 * @param {string|number} typed    What the field holds.
 * @param {number}        nowYear  The clock's stored year.
 * @returns {{start: number|null, text: string}}  `start` null when the answer cannot be taken.
 */
export function campaignYearPreview(typed, nowYear) {
	const year = typedYear(typed);
	if (year === null) return { start: null, text: localize("stonetop.campaignYear.empty") };
	const start = startYearFor(year, nowYear);
	if (start === null) {
		const late = year > nowYear;
		return late
			? { start, text: format("stonetop.campaignYear.tooLate", { max: displayYear(nowYear, MAX_START_YEAR) }) }
			: { start, text: format("stonetop.campaignYear.tooEarly", { min: nowYear }) };
	}
	return { start, text: format("stonetop.campaignYear.preview", { year: cardinalWord(start) }) };
}

/** The field and its preview. Built as an element so core's sanitizer keeps the input's attributes. */
function content(nowYear) {
	const value = displayYear(nowYear);
	return contentElement(`
		<div class="stonetop stonetop-campaign-year">
			<p class="stonetop-campaign-year-hint">${escHtml(localize("stonetop.campaignYear.hint"))}</p>
			<label class="stonetop-campaign-year-row">
				<span class="stonetop-campaign-year-label">${escHtml(localize("stonetop.campaignYear.label"))}</span>
				<input type="number" name="stonetopYear" class="stonetop-campaign-year-input"
				       inputmode="numeric" step="1" min="${nowYear}" value="${value}">
			</label>
			<p class="stonetop-campaign-year-preview" aria-live="polite"></p>
		</div>`);
}

/** Keep the preview telling the truth about what is typed. */
function wirePreview(root, nowYear) {
	const field = root?.querySelector?.(".stonetop-campaign-year-input");
	const out = root?.querySelector?.(".stonetop-campaign-year-preview");
	if (!field || !out) return;
	const paint = () => { out.textContent = campaignYearPreview(field.value, nowYear).text; };
	field.addEventListener("input", paint);
	paint();
	field.focus?.();
	field.select?.();
}

/**
 * Ask the GM what year it is, and name the campaign's years by the answer.
 * @returns {Promise<number|null>}  The start year set, or null when nothing changed.
 */
export async function openCampaignYearDialog() {
	if (!game.user?.isGM) return null;
	const nowYear = timelineNow().year;
	const answer = await askWithButtons({
		title:   localize("stonetop.campaignYear.title"),
		content: content(nowYear),
		classes: ["stonetop-campaign-year-dialog"],
		render:  (root) => wirePreview(root, nowYear),
		buttons: [
			{
				key:   "set",
				label: localize("stonetop.campaignYear.set"),
				icon:  "fa-hourglass-half",
				value: (form) => campaignYearPreview(form?.elements?.namedItem?.("stonetopYear")?.value, nowYear),
			},
			{ key: "keep", label: localize("stonetop.campaignYear.keep"), icon: "fa-xmark", value: null },
		],
	});
	if (!answer) return null;
	if (answer.start === null) {
		ui.notifications?.warn(answer.text);
		return null;
	}
	await setStartYear(answer.start);
	return answer.start;
}

/**
 * Repaint what names a year once the GM renames them all. The timeline windows and tabs listen for
 * the hook themselves (TimelineWindow#_wireSync) and the time banner does too; this covers the
 * rest: the steading sheet's clock, open journal sheets (a timeline page reads its years at
 * render), and the Seasons Change journal's page titles, which are stored and so are renamed.
 */
export function installCampaignYearSync() {
	Hooks.on(START_YEAR_CHANGED_HOOK, async () => {
		const steading = getStonetopSteadingActor();
		if (steading?.sheet?.rendered) steading.sheet.render(false);
		for (const journal of game.journal ?? []) {
			if (journal.sheet?.rendered) journal.sheet.render(false);
		}
		// The one write, and the GM's: two GMs racing would both issue it.
		if (game.user?.isGM && isPrimaryGM()) {
			try { await renameAllSeasonYearPages(); }
			catch (err) { console.error("Stonetop | Chronicle year-page rename failed", err); }
		}
	});
}
