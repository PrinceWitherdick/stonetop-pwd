// The season-and-year picker: four season cards over one year field, click a card to commit.
//
// Two flows ask this same question and must read as the same question:
//   • Seasons Change (the MOVE) — "which season is beginning?", then the move's own dialog runs,
//     applying gains, resetting Fortunes and writing a journal page.
//   • Set the Current Season — "which season is Stonetop in?", which only corrects what the
//     header's clock says and makes no move at all.
//
// They were written twice, and had already drifted: only one of them offered the steading
// header shortcut. What varies between them is wording, whether a season is shown as
// already-chosen, and what a click DOES — everything else, including the markup that
// `.stonetop-season-card` is styled against, is the same picture.
//
// The whole dialog is pitched at the steading header's clock, because that readout is what
// this dialog SETS: each season is named in its own ink (--stonetop-season-*-ink, the same
// tokens the header uses) and the year is echoed back in the same stadium chip the header
// wears. Picking a season here should look like editing the thing in the header.
import { SEASON_IDS, seasonLabel, seasonIconSrc } from "./seasons-change-reminders.js";
import { yearLabel } from "./seasons-chronicle.js";
import { addStonetopSteadingButton } from "../utils/world.js";
import { bringDialogToFront } from "../utils/front-on-open.js";
import { escHtml } from "../utils/strings.js";

/** Ties the year label to its input. One picker is open at a time, so a constant id will do. */
const YEAR_INPUT_ID = "stonetop-season-year-input";

/**
 * The highest campaign year the field will hold.
 *
 * Not a rule of the game — nothing in Stonetop caps a campaign's length — but a typo guard.
 * The year rides through to `recordSeasonsChange`, which mints a Chronicle page named after
 * it, so a fat-fingered "20255" would leave a stray page in the journal sidebar with two
 * hundred centuries of nothing implied before it. Three digits is well past any table.
 */
export const MAX_CAMPAIGN_YEAR = 999;

/**
 * A typed year as a campaign year: whole, at least 1, no higher than MAX_CAMPAIGN_YEAR.
 *
 * `fallback` covers the field being unreadable rather than merely out of range — empty (the
 * GM has cleared it mid-edit) or not a number at all. Out-of-range values are clamped to the
 * nearest end instead, since "0" and "5000" are attempts at a year and snapping them to 1 or
 * 999 keeps what the GM was reaching for.
 */
export function clampYear(value, fallback = 1) {
	const raw  = String(value ?? "").trim();
	const typed = Math.trunc(Number(raw));
	const year  = raw && Number.isFinite(typed) ? typed : (Math.trunc(Number(fallback)) || 1);
	return Math.min(MAX_CAMPAIGN_YEAR, Math.max(1, year));
}

/**
 * The year field's markup: a −/＋ stepper you can also type into, and the chip naming what
 * you picked.
 *
 * This used to be a `<select>` of 1..N, which made the campaign year a closed list — and the
 * list was built from `seasonsCurrentYear`, a count that only moves when a Winter is completed
 * THROUGH THIS SYSTEM. A table that adopted the sheet in their fourth year had a flag reading
 * 1, so the only year on offer was the First, and there was no way to file the season they
 * were actually playing. A number is a number; the field now takes one.
 *
 * The chip and the hint are both rendered empty and filled by `wireYearField`, so the text in
 * them has exactly one author — see the `paint` note there.
 *
 * Local: the year field is half of `seasonPickerHtml`, never a control on its own, and the
 * tests drive it through the whole picker for the reason given there.
 */
function yearFieldHtml(startYear) {
	return `<div class="stonetop-season-year">
					<label class="stonetop-season-year-label" for="${YEAR_INPUT_ID}">Year</label>
					<div class="stonetop-season-year-stepper">
						<button type="button" class="stonetop-season-year-step" data-step="-1" aria-label="An earlier year">&minus;</button>
						<input id="${YEAR_INPUT_ID}" class="stonetop-season-year-input" type="number"
							inputmode="numeric" min="1" max="${MAX_CAMPAIGN_YEAR}" step="1" value="${startYear}">
						<button type="button" class="stonetop-season-year-step" data-step="1" aria-label="A later year">+</button>
					</div>
					<span class="stonetop-season-year-name stonetop-year-chip" aria-live="polite"></span>
				</div>
				<p class="stonetop-season-year-hint" aria-live="polite"></p>`;
}

/**
 * Wire the year field up and hand back a reader for what it currently says.
 *
 * @param {HTMLElement} root
 * @param {object}  opts
 * @param {number}  opts.fallback    What an unreadable field means — the year the picker opened on.
 * @param {number}  opts.latestYear  The campaign's high-water mark, for the hint alone. Typing
 *   past it is allowed (that is the whole point of the field), but it is worth saying out loud:
 *   a Chronicle page is about to be minted for a year nothing has been recorded in yet, which
 *   is either a mid-campaign table catching the sheet up or a slipped keystroke.
 * @returns {() => number} The committed year, clamped.
 *
 * Local, like `yearFieldHtml`: `wireSeasonPicker` is the only caller, and it is what the tests
 * drive.
 */
function wireYearField(root, { fallback = 1, latestYear = fallback } = {}) {
	const input = root.querySelector(".stonetop-season-year-input");
	const name  = root.querySelector(".stonetop-season-year-name");
	const hint  = root.querySelector(".stonetop-season-year-hint");
	const read  = () => clampYear(input?.value, fallback);

	// One author for both readouts, run on every change to the field including the first —
	// which is why the markup ships them empty. Rendering the opening text in the HTML too
	// would be a second copy of the same two sentences, free to drift from this one.
	//
	// Deliberately does NOT write back to `input`: repainting the label is not the same event
	// as normalising the value, and clamping on every keystroke would snatch a "1" on its way
	// to "12" back to 1 as it was typed. The label simply tells the truth in the meantime —
	// a cleared field shows the fallback's name, because the fallback is what a click commits.
	const paint = () => {
		const year = read();
		if (name) name.textContent = yearLabel(year);
		if (hint) hint.textContent = year > latestYear
			? `Nothing has been recorded past ${yearLabel(latestYear)} yet.`
			: "";
	};

	const nudge = (step) => {
		if (!input) return;
		input.value = clampYear(read() + step, fallback);
		paint();
	};

	root.querySelectorAll(".stonetop-season-year-step").forEach(el => {
		el.addEventListener("click", () => nudge(Number(el.dataset.step) || 0));
	});
	input?.addEventListener("input", paint);
	// Blur and Enter: the moment editing stops is the moment the field may be tidied up.
	input?.addEventListener("change", () => { input.value = read(); paint(); });
	// Dialog's content sits inside a <form>, and this picker declares no buttons — so Enter
	// would submit that form and take the window with it, discarding the pick instead of
	// making it. There is nothing to submit here; a card click is the commit.
	input?.addEventListener("keydown", (event) => { if (event.key === "Enter") event.preventDefault(); });

	paint();
	return read;
}

/**
 * The picker's whole body: the question, the four cards, the year field, the footnote.
 *
 * Split out from `openSeasonPicker` so it can be built and driven without a Dialog — the
 * behaviour worth testing here (what a card commits, what the year field does when you type
 * into it) is behaviour of this markup plus `wireYearField`, and a test that hand-rolled its
 * own approximation of the markup would pass right through a renamed class.
 *
 * @param {object}  parts
 * @param {string}  parts.prompt      The italic question over the cards.
 * @param {number}  parts.startYear   Already clamped — the year the field opens on.
 * @param {string}  [parts.selected]  Season id to draw as already chosen.
 * @param {string}  [parts.note]      A footnote under the year row; omitted when empty.
 * @param {{ask: string, label: string}} [parts.altAction]  The way out to the OTHER picker;
 *   omitted when absent. See `openSeasonPicker`.
 */
export function seasonPickerHtml({ prompt, startYear, selected = null, note = "", altAction = null }) {
	// No per-season colour: the four season inks are the steading header clock's alone, and a
	// picker of four coloured names is what would stop that one coloured name meaning anything.
	// A card is told apart by its glyph and its label; the marked one is marked in plain ink.
	//
	// The icon's `alt` is empty on purpose. It is decorative here — the label directly below
	// names the season in text — and a filled alt would have a screen reader say "Spring"
	// twice for one card.
	const cards = SEASON_IDS.map(id => `
					<button type="button" class="stonetop-season-card${id === selected ? " is-selected" : ""}"
						data-season="${id}"${id === selected ? ` aria-current="true"` : ""}>
						<img src="${seasonIconSrc(id)}" alt="" class="stonetop-season-icon">
						<span class="stonetop-season-label">${escHtml(seasonLabel(id))}</span>
					</button>`).join("");

	// The way out to the other picker, if this one has one. A question and then the answer as
	// the thing you click, rather than a bare button: the two flows are told apart by INTENT
	// ("am I playing the season, or fixing what the sheet says?"), not by any word that fits
	// on a button, so the question is what makes the choice.
	const alt = altAction ? `
				<p class="stonetop-season-picker-alt">${escHtml(altAction.ask)}
					<button type="button" class="stonetop-season-alt-btn">${escHtml(altAction.label)}</button>
				</p>` : "";

	return `<div class="stonetop-season-picker">
				<p><em>${escHtml(prompt)}</em></p>
				<div class="stonetop-season-cards">${cards}</div>
				${yearFieldHtml(startYear)}
				${note ? `<p class="stonetop-season-picker-note"><em>${escHtml(note)}</em></p>` : ""}${alt}
			</div>`;
}

/**
 * Wire a rendered picker body: the year field, and a click on each card that reads the year
 * off it and hands the pair to `onPick`.
 *
 * Split from the Dialog for the same reason `seasonPickerHtml` is — and it takes `onPick`
 * rather than the dialog so the ORDER stays visible: the window is closed by the caller
 * before the pick runs, because both picks open something else over the top of it.
 *
 * @param {HTMLElement} root
 * @param {object}   opts
 * @param {number}   opts.startYear   The field's opening year, and its fallback.
 * @param {number}   opts.latestYear  The campaign's high-water year, for the hint alone.
 * @param {(season: string, year: number) => any} opts.onPick
 * @param {(year: number) => any} [opts.onAlt]  The way out to the other picker. Given the year
 *   the field is currently showing, so the window it opens can pick up where this one left off
 *   — a GM who has already dialled a year in must not have to type it twice to change their
 *   mind about which question they are answering.
 */
export function wireSeasonPicker(root, { startYear, latestYear, onPick, onAlt }) {
	const readYear = wireYearField(root, { fallback: startYear, latestYear });
	root.querySelectorAll(".stonetop-season-card").forEach(el => {
		el.addEventListener("click", () => onPick(el.dataset.season, readYear()));
	});
	root.querySelector(".stonetop-season-alt-btn")?.addEventListener("click", () => onAlt?.(readYear()));
}

/**
 * Open the picker.
 *
 * @param {object}   options
 * @param {string}   options.title           Window title.
 * @param {string}   options.prompt          The italic question over the cards.
 * @param {string}   [options.note]          A footnote under the year row; omitted when empty.
 * @param {string}   [options.selected]      Season id to draw as already chosen.
 * @param {number}   options.selectedYear    The year the field opens on, and the fallback if it
 *                                           is somehow unreadable when a card is clicked.
 * @param {number}   [options.latestYear]    The campaign's high-water year. Only drives the
 *                                           hint under the field — it is not a ceiling.
 * @param {boolean}  [options.headerShortcut=false]  Add the "Stonetop" header button. The move's
 *   picker carries it (it can be opened from a hotbar macro, away from the sheet); the
 *   correct-the-clock picker is opened FROM the steading header, where it would point at the
 *   window you are already looking at.
 * @param {object}   [options.altAction]  The way out to the OTHER picker, as a question and the
 *   answer you click: `{ask, label, onRun(year)}`. The two flows ask nearly the same thing and
 *   are told apart only by intent, so whichever one you land in owes you a door to the other —
 *   the move's picker is what the steading header opens, and a GM who only meant to correct
 *   what the sheet says needs to get there without hunting for another control.
 * @param {(season: string, year: number) => any} options.onPick  Run after the dialog closes.
 */
export function openSeasonPicker({
	title,
	prompt,
	note = "",
	selected = null,
	selectedYear,
	latestYear,
	headerShortcut = false,
	altAction = null,
	onPick,
}) {
	const startYear = clampYear(selectedYear, 1);
	const highWater = clampYear(latestYear, startYear);

	// `const` despite the render callback below referring to `dialog`: the callback runs after
	// this statement completes, so the binding is always initialised by then.
	const dialog = new Dialog({
		title,
		content: seasonPickerHtml({ prompt, startYear, selected, note, altAction }),
		buttons: {},
		render: (html) => {
			// Both callers open this FROM the steading sheet, which is the case front-on-open
			// exists for: an ad-hoc `new Dialog(...)` gets no subclass of ours, so without this
			// it can land behind the sheet that spawned it and read as a click that did nothing.
			// Every other sheet-spawned dialog in the system carries it.
			bringDialogToFront(html);
			if (headerShortcut) addStonetopSteadingButton(html);
			wireSeasonPicker(html[0], {
				startYear,
				latestYear: highWater,
				onPick: async (season, year) => {
					// Closed BEFORE the pick runs: both callers open something else (the move's
					// dialog) or write a flag that re-renders the sheet underneath.
					dialog.close();
					await onPick(season, year);
				},
				// Same order, and for a sharper reason: what this opens is another window of this
				// very shape, and leaving this one up would put two pickers of the same question
				// on screen at once.
				onAlt: async (year) => {
					dialog.close();
					await altAction?.onRun?.(year);
				},
			});
		},
	}, { classes: ["dialog", "stonetop", "stonetop-season-picker-dialog"] });
	dialog.render(true);
	return dialog;
}
