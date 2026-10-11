import { escHtml, signed } from "../../utils/strings.js";
import { format } from "../../utils/i18n.js";
import { seasonStamp } from "../../seasons/campaign-year.js";

// ── The steading's three debilities (Book I, "Homefront") ───────────────────────
// ONE table, because three separate moves clear a debility and each used to carry its own
// copy: Return Triumphant, the public sacrifice half of Rites of the Land, and the Inn's
// seasonal gathering. Each copy quotes its `detail` straight into a dialog the table reads,
// so three copies is three places for the wording of a rule to drift apart.
//
// The WINDOW those moves put the choice in lives here too (openDebilityPicker), for the same
// reason: they all ask it the same way, and the parts that make it work are easy to lose in
// a copy.

export const DEBILITIES = [
	{ id: "diminished", label: "Diminished", detail: "disadvantage to Deploy, Muster, Pull Together" },
	{ id: "lacking",    label: "Lacking",    detail: "treat Prosperity as 1 lower" },
	{ id: "malcontent", label: "Malcontent", detail: "Fortunes reset to +0 each season; folks need Persuading more often" },
];

/** Where one debility's checkbox lives on the steading's system data. */
export function debilityPath(id) {
	return `attributes.debilities.options.${id}.value`;
}

/** Which of the three are marked right now. Order follows DEBILITIES, not the data. */
export function markedDebilities(steading) {
	return DEBILITIES.filter(d => steading?.getSystemValue(debilityPath(d.id), false));
}

/**
 * Clear one debility, attributed to the move that did it.
 *
 * The `stonetopMove` tag is not optional decoration: the steading ledger renders it as
 * "via <move>", which is the only thing that later tells a table whether a cleared
 * Malcontent was the Inn's doing or a Blessed's sacrifice.
 */
export async function clearDebility(steading, id, stonetopMove) {
	if (!steading || !DEBILITIES.some(d => d.id === id)) return false;
	await steading.setSystemValue(debilityPath(id), false, { stonetopMove });
	return true;
}

/** The chrome every debility picker wears. */
const PICKER_DIALOG_OPTIONS = { classes: ["dialog", "stonetop", "stonetop-disaster-move-dialog"] };

/**
 * The "pick one debility, then commit from the footer" window.
 *
 * ONE implementation, because every move that clears a debility puts the same question the
 * same way, and the details that make it work are the easiest thing to lose in a copy:
 *
 * · Picking and committing are separate acts. A click used to write the clear and shut the
 *   window in one motion, which put an irreversible steading edit a single mis-click away and
 *   left no moment to read the row before it landed. A click now only marks the choice; the
 *   footer button writes it, and it NAMES the debility it is about to clear so there is no
 *   doubt what the press does. Nothing starts picked, so the button starts disabled.
 *
 * · `autofocus` on the first row is load-bearing, not polish: Foundry's own Tab handler pulls
 *   focus to the first `.dialog-button` whenever focus is outside the dialog, and a DISABLED
 *   button cannot take focus — so without a focus target inside the window, Tab would never
 *   get a keyboard user in. Starting focus on a row leaves Tab to the browser from then on.
 *
 * · Arming the button GROWS it, and the window has to be told. A `Dialog` carries no
 *   `height: "auto"`, so core pins `style.height` to whatever the content measured on the very
 *   first render — before anything is picked and while the button still reads "Clear Debility".
 *   The armed label names its debility and takes a second line (see the footer-button rule in
 *   stonetop.css), and that extra line was landing outside the window and being clipped. So
 *   each relabel re-measures the frame's natural height and grows to it. GROWS only: a window
 *   the table has dragged taller keeps its height, and shrinking back on the next pick would
 *   make the frame twitch under the cursor.
 *
 * · The apply callback is guarded rather than trusted to be unreachable: Foundry submits the
 *   `default` button on Enter whenever focus sits anywhere in the window, and `disabled` only
 *   stops the click. With nothing picked it closes writing nothing, like Escape.
 *
 * · `html[0] ?? html` both times: core hands render callbacks jQuery on v13 and there is no
 *   promise it always will. A bare `html[0]` would throw one line after the button was
 *   disabled and before a single row listener was wired, leaving a window whose only button
 *   is dead and whose rows do nothing — so the move could not be made at all.
 *
 * @param {object} opts
 * @param {string} opts.title             window title
 * @param {string} opts.introHtml         the line above the choices (trusted HTML)
 * @param {Array}  opts.marked            debilities to offer, from {@link markedDebilities}.
 *                                        Each `{id, label, detail}`; an optional `labelHtml`
 *                                        prints instead of the escaped `label` for a caller
 *                                        offering choices whose markup it authored itself.
 * @param {string} [opts.applyLabel]      footer button before anything is picked
 * @param {Function} [opts.applyLabelFor] (debility) => footer button once one is
 * @param {string} [opts.bodyClass]       extra class on the dialog body
 * @param {object} [opts.buttons]         further buttons, merged after `apply`
 * @param {string} [opts.choicesLabel]    what the radiogroup is choosing, for a screen reader
 * @param {object} [opts.dialogOptions]   Dialog application options
 * @param {Function} [opts.onRender]      (root, dialog) => void, for a window with a control of
 *                                        its own in `introHtml` (winter's "pay it instead")
 * @param {Function} opts.onApply         (debility) => void, run when the footer commits
 */
export function openDebilityPicker({
	title,
	introHtml,
	marked = [],
	applyLabel = "Clear Debility",
	applyLabelFor = d => `Clear ${d.label}`,
	bodyClass = "",
	buttons = {},
	choicesLabel = "Debility to clear",
	dialogOptions = PICKER_DIALOG_OPTIONS,
	onRender,
	onApply,
}) {
	// `labelHtml` is the opt-out from escaping, and it is opt-IN for a reason: a debility's
	// `label` is plain text and stays escaped, because a homebrew one is not ours to trust.
	// A caller offering choices IT authored (the rites' "Clear <strong>Diminished</strong>",
	// and its non-debility "Fortunes advantage" row) passes the markup it wrote deliberately.
	// `label` is still required alongside it — the footer button prints that one as text.
	const choicesHtml = marked.map((d, i) => `
		<li class="stonetop-disaster-choice" data-choice="${escHtml(d.id)}"
		    role="radio" aria-checked="false" tabindex="0"${i === 0 ? " autofocus" : ""}>
			<span class="stonetop-disaster-choice-label">${d.labelHtml ?? escHtml(d.label)}</span>
			<span class="stonetop-disaster-choice-detail">${escHtml(d.detail)}</span>
		</li>`).join("");

	let picked = null;

	// `const`, even though the render/button callbacks below refer to `dialog`: they run
	// after this statement completes, so the binding is always initialised by then.
	const dialog = new Dialog({
		title,
		content: `<div class="stonetop-disaster-dialog${bodyClass ? ` ${bodyClass}` : ""}">
			${introHtml}
			<ol class="stonetop-disaster-choices" role="radiogroup" aria-label="${escHtml(choicesLabel)}">${choicesHtml}</ol>
		</div>`,
		buttons: {
			apply: {
				label: applyLabel,
				callback: async () => {
					if (!picked) return;
					await onApply(picked);
				},
			},
			...buttons,
		},
		// Named even when it is the only button: omitting it makes Enter submit `undefined`,
		// which throws inside Dialog#submit.
		default: "apply",
		render: html => {
			const appEl    = dialog.element?.jquery ? dialog.element[0] : dialog.element;
			const applyBtn = appEl?.querySelector("button[data-button='apply']");
			if (applyBtn) applyBtn.disabled = true;

			// Measured off the FRAME, blanked for a moment so it shrink-wraps its content the
			// way core's own auto-height windows do. Not off `.window-content`'s scrollHeight:
			// `.dialog-content` is `flex: 1` and shrinks to absorb the taller footer, so its
			// text overflows IT rather than the scroll container and the overflow reads as 0.
			// Blanking and restoring within the one statement costs two reflows and paints
			// nothing, so the window never flickers through its natural size.
			//
			// `left`/`top` ride along deliberately: a bare finite `{height}` is the signature
			// the auto-height resize patch reads as a manual drag (utils/resizable-dialogs.js),
			// and this is not one.
			const refit = () => {
				const { left, top, height } = dialog.position ?? {};
				if (!appEl || !Number.isFinite(height)) return;
				const pinned = appEl.style.height;
				appEl.style.height = "";
				const natural = appEl.offsetHeight + 1;
				appEl.style.height = pinned;
				if (natural <= height) return;
				dialog.setPosition({ height: natural, left, top });
			};

			const root    = html[0] ?? html;
			const options = [...root.querySelectorAll(".stonetop-disaster-choice")];
			const select = el => {
				picked = marked.find(d => d.id === el.dataset.choice) ?? null;
				for (const o of options) {
					const on = o === el;
					o.classList.toggle("is-selected", on);
					o.setAttribute("aria-checked", String(on));
				}
				if (!applyBtn) return;
				applyBtn.disabled = !picked;
				applyBtn.textContent = picked ? applyLabelFor(picked) : applyLabel;
				refit();
			};

			for (const el of options) {
				el.addEventListener("click", () => select(el));
				// Space would scroll the window and Enter would reach Foundry's document-level
				// handler and submit the dialog, so a keyboard pick swallows its own key.
				el.addEventListener("keydown", event => {
					if ((event.key !== "Enter") && (event.key !== " ")) return;
					event.preventDefault();
					event.stopPropagation();
					select(el);
				});
			}

			onRender?.(root, dialog);
		},
	}, dialogOptions);
	dialog.render(true);
	return dialog;
}

// ── Meet With Disaster, below −1 (Book I p. 532) ─────────────────────────────────
// "If Fortunes would drop below -1 for any reason … the GM picks 1 instead." Three debilities
// to MARK and a Population loss, where the pickers above offer debilities to clear. Two moments
// ask it: the move itself on the Moves tab, and a winter the steading cannot feed, which "Meets
// with Disaster" (p. 84, p. 518) and so lands here whenever Fortunes is already at the floor.

/** The four answers, the debilities' own copy first so the two lists cannot drift apart. */
const DISASTER_CHOICES = [
	...DEBILITIES,
	{ id: "population", label: "Folks start to leave", detail: "reduce Population by 1 (min −1)" },
];

/** What the picker offers: only what would cost something. A debility already marked is left
 *  out, since marking it again would write `true` over `true`, and so is the Population at −1,
 *  where applyDisasterChoice's floor would write −1 over −1. Either way the disaster cost nothing. */
export function disasterChoices(steading) {
	const marked = new Set(markedDebilities(steading).map(d => d.id));
	const floored = steading.getStatValue("population") <= -1;
	return DISASTER_CHOICES.filter(c => (c.id === "population" ? !floored : !marked.has(c.id)));
}

/**
 * The flag a disaster met at −1 leaves until its pick is made (StonetopSteading#disasterOwed).
 * `season` (`{seasonId, year, title}`) is the Seasons Change it was met in, so a pick made later
 * from the header glyph still goes on that season's shortfall note. Always written, null for none,
 * so a flag left from an earlier disaster never lends this one its season.
 */
export function disasterOwedFlags(cause, season = null) {
	return { disasterOwed: { cause: String(cause ?? ""), season: owedSeason(season) } };
}

/** An owed disaster's season as it is stored and read back: `{seasonId, year, title}`, or null. */
export function owedSeason(season) {
	const year = Number(season?.year);
	return season?.seasonId && Number.isFinite(year)
		? { seasonId: String(season.seasonId), year, title: String(season.title ?? "") }
		: null;
}

/**
 * Write one of the four. Population stops at −1, the floor the sheet's steppers use.
 * `settlesOwed` clears the owed-disaster flag in the same write: set by every picker that a
 * write owing one opened, and by the header glyph that reopens it, never by the Moves tab's own.
 */
async function applyDisasterChoice(steading, id, stonetopMove, { settlesOwed = false } = {}) {
	if (!steading) return false;
	let system;
	if (id === "population") {
		system = { "attributes.population.value": Math.max(steading.getStatValue("population") - 1, -1) };
	} else if (DEBILITIES.some(d => d.id === id)) {
		system = { [debilityPath(id)]: true };
	} else return false;
	await steading.applyChanges({ system, flags: settlesOwed ? { disasterOwed: null } : {} }, { stonetopMove });
	return true;
}

/**
 * The floor rule alone: "reduce Fortunes by 1 (min -1). If Fortunes would drop below -1 … the GM
 * picks 1 instead." Pure, so every write that Meets with Disaster reads the floor the same way.
 * @returns {{fortunes: number, disaster: boolean}} `disaster`: the GM's pick is owed instead
 */
export function disasterFortunes(current) {
	return current <= -1 ? { fortunes: current, disaster: true } : { fortunes: current - 1, disaster: false };
}

/**
 * One line on a season's shortfall note on Stonetop's timeline (timeline-season-entry.js
 * #noteSeasonShortfall). `season` is `{seasonId, year, title}`; none notes nothing.
 *
 * IMPORTED AT CALL TIME, as seasons-chronicle.js imports the season's own row: the timeline's
 * writers reach the season clock, which this file's callers sit beside. Best-effort: a world that
 * cannot write the timeline has still suffered the shortfall.
 */
export async function noteShortfallOnTimeline(season, line) {
	if (!season?.seasonId || !line) return;
	try {
		const { noteSeasonShortfall } = await import("../../timeline/timeline-season-entry.js");
		await noteSeasonShortfall({ ...season, line });
	} catch (err) {
		console.error("Stonetop | could not note the shortfall on the timeline", err);
	}
}

/** What a disaster's pick took, as the shortfall note says it. Null for no pick (nothing left). */
export function disasterPickLine(choice) {
	return choice ? `Met with Disaster: ${disasterPickCost(choice)}.` : "Met with Disaster, with nothing left for it to take.";
}

/** What a disaster's pick cost, as its Disaster row's title says it: "marked Malcontent". */
export function disasterPickCost(choice) {
	return choice?.id === "population" ? "folks started to leave (Population −1)" : `marked ${choice?.label ?? ""}`;
}

/**
 * A disaster's pick, onto Stonetop's timeline (user, 2026-10-10). Within a Seasons Change (`season`)
 * it is a line on that season's shortfall note, beside what brought it; anywhere else (a Requisition's
 * miss, the move itself on the Moves tab, an owed pick made at last) it is a Disaster row of its own,
 * saying what brought it on. A pick with nothing left to take is a row of nothing, and is not written.
 *
 * IMPORTED AT CALL TIME, as noteShortfallOnTimeline is. Best-effort: the debility is marked either way.
 */
export async function recordDisasterPick(steading, choice, { season = null, cause = "" } = {}) {
	if (season?.seasonId) return noteShortfallOnTimeline(season, disasterPickLine(choice));
	if (!choice) return;
	try {
		const { recordMilestones, timelineNow } = await import("../../timeline/timeline-record.js");
		const now = timelineNow(steading?._actor);
		const why = String(cause ?? "").trim();
		await recordMilestones(steading?._actor ?? steading, [{
			source: "disaster",
			// Each pick its own row: Population can be picked twice in one season, and a debility
			// cleared and marked again is a second disaster, so a key per season and choice would
			// leave the second one unwritten.
			key:    `disaster:${seasonStamp(now.year, now.season)}:${choice.id}:${foundry.utils.randomID()}`,
			title:  format("stonetop.timeline.milestone.disasterPicked", { cost: disasterPickCost(choice) }),
			...(why ? { body: `<p>Brought on by ${escHtml(why)}.</p>` } : {}),
		}], { now });
	} catch (err) {
		console.error("Stonetop | could not put the disaster on the timeline", err);
	}
}

/**
 * Meet With Disaster, applied. For a rule that says "and the steading Meets with Disaster" with
 * no window of its own to ask in (a failed harvest, Book I p. 516). `alsoFlags` rides the same
 * write, so a step marker the disaster closes does not cost a second update.
 *
 * At −1 that write also records the pick as owed (`cause` names it on the header glyph), because
 * the marker has closed the step by then and the picker, which has no Cancel, can still be shut.
 *
 * `season` (`{seasonId, year, title, line}`) puts it on that season's shortfall line on the
 * timeline: `line` says what happened, and what the disaster cost is added to it.
 * @returns {Promise<{fortunes: number, disaster: boolean}>} `disaster`: the pick window opened
 */
export async function meetWithDisaster(steading, { stonetopMove = "Meet with Disaster", cause = "", introHtml, onApplied, alsoFlags = {}, season = null } = {}) {
	const out = disasterFortunes(steading.getStatValue("fortunes"));
	const { line = "", ...where } = season ?? {};
	await steading.applyChanges({
		system: out.disaster ? {} : { "stats.fortunes.value": out.fortunes },
		flags: { ...alsoFlags, ...(out.disaster ? disasterOwedFlags(cause, season ? where : null) : {}) },
	}, { stonetopMove });
	if (season) {
		await noteShortfallOnTimeline(where, [line, out.disaster
			? "Fortunes was already −1, so the steading Met with Disaster."
			: `Fortunes to ${signed(out.fortunes)}.`].filter(Boolean).join(" "));
	}
	if (out.disaster) {
		openDisasterPicker(steading, { introHtml, stonetopMove, onApplied, settlesOwed: true, season: season ? where : null, cause });
	}
	return out;
}

/**
 * The GM's pick when Fortunes would drop below −1, on the same pick-then-commit window the
 * clearing moves use: marking a debility is as permanent a steading edit as clearing one.
 *
 * @param {object} steading
 * @param {object} [opts]
 * @param {string} [opts.introHtml]    the line above the choices (trusted HTML)
 * @param {string} [opts.stonetopMove] what the ledger names as the cause
 * @param {object} [opts.buttons]      further footer buttons (the move's own window offers Cancel;
 *                                     a winter shortfall does not, since the rule is not optional)
 * @param {Function} [opts.onApplied]  (choice) => void, after the write
 * @param {boolean} [opts.settlesOwed] the pick pays an owed disaster (see applyDisasterChoice)
 * @param {{seasonId: string, year: number, title?: string}|null} [opts.season]  The Seasons Change
 *   it was met in, whose shortfall line it goes on (recordDisasterPick); none is a Disaster row.
 * @param {string} [opts.cause]  What brought it on, said on that row.
 */
export function openDisasterPicker(steading, {
	introHtml = `<p><em>Fortunes cannot drop below −1.</em> The GM picks 1:</p>`,
	stonetopMove = "Meet with Disaster",
	buttons = {},
	onApplied,
	settlesOwed = false,
	season = null,
	cause = "",
} = {}) {
	// All three marked and Population at −1: the book's list has nothing left to take, so there
	// is no pick to make. Say so rather than open an empty window, and pay off an owed pick, or
	// the header glyph would wait on a choice that cannot exist.
	const choices = disasterChoices(steading);
	if (!choices.length) {
		globalThis.ui?.notifications?.info?.("The steading has nothing left for the disaster to take: every debility is marked and Population is at −1.");
		if (settlesOwed) {
			steading.applyChanges({ flags: { disasterOwed: null } })
				.then(() => onApplied?.(null))
				.catch(err => console.error("Stonetop | Could not settle the owed disaster:", err));
		}
		if (season?.seasonId) noteShortfallOnTimeline(season, disasterPickLine(null));
		return null;
	}
	return openDebilityPicker({
		title: "Meet with Disaster",
		introHtml,
		marked: choices,
		applyLabel: "Pick what it costs",
		applyLabelFor: c => (c.id === "population" ? "Reduce Population by 1" : `Mark ${c.label}`),
		choicesLabel: "What the disaster costs",
		buttons,
		onApply: async choice => {
			await applyDisasterChoice(steading, choice.id, stonetopMove, { settlesOwed });
			await recordDisasterPick(steading, choice, { season, cause: cause || (stonetopMove !== "Meet with Disaster" ? stonetopMove : "") });
			onApplied?.(choice);
		},
	});
}

/** The header glyph's way back to a disaster whose pick was closed unmade. */
export function openOwedDisasterPicker(steading, { onApplied } = {}) {
	const owed = steading.disasterOwed?.();
	if (!owed) {
		globalThis.ui?.notifications?.info?.("No disaster is waiting on a pick.");
		return null;
	}
	const why = owed.cause ? ` after ${escHtml(owed.cause)}` : "";
	return openDisasterPicker(steading, {
		introHtml: `<p><em>The steading Met with Disaster${why} at Fortunes −1, and what it costs was never picked.</em> The GM picks 1:</p>`,
		stonetopMove: "Meet with Disaster",
		onApplied,
		settlesOwed: true,
		cause: owed.cause ?? "",
		season: owed.season ?? null,
	});
}
