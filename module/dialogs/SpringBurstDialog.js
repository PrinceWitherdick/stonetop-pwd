import { StepperDialog } from "./StepperDialog.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { postSeasonsRollPrompt, SPRING_SEASONS_RESULT } from "../utils/roll-engine.js";
import { escHtml } from "../utils/strings.js";
import { getPlayerCharacters } from "../utils/playbook-actors.js";
import { postSeasonsChangeReminder } from "../seasons/seasons-change-reminders.js";
import { recordSeasonsChange, hasRecordedSeason } from "../seasons/seasons-chronicle.js";
import { confirmOutcome } from "../utils/ask-with-buttons.js";
import { readCurrentSeason, recordCurrentSeason, seasonRank } from "../seasons/current-season.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { applySeasonalGains } from "../actors/steading/seasonal-gains.js";
import { markWalkthroughDone } from "./walkthrough-resume.js";
import { saveChronicleFromButton } from "../utils/chronicle.js";
import { SEASONAL_GAINS } from "./spring-burst-data.js";
import { displayYear, setStartYear } from "../seasons/campaign-year.js";
import { campaignYearPreview } from "../seasons/campaign-year-dialog.js";
import { timelineNow } from "../timeline/timeline-record.js";
import { localize } from "../utils/i18n.js";
import { firstAdventureHooksHtml } from "../gm-toolkit/gm-agenda-view.js";

const ANSWERS_SETTING = "springBurstAnswers";

// Key for this dialog's reload-resume record (step + open flag) in the shared
// walkthroughResume setting. See walkthrough-resume.js.
const RESUME_KEY = "springBurst";

// ── SpringBurstDialog ──────────────────────────────────────────────────────────
// A GM-only walkthrough of Book I's final "Getting Started" step, "Let spring
// burst forth" (Book I, p.32). It picks up where the guided Introductions leave
// off: find the most hopeful PC, make the season's first Seasons Change move, read
// the result for a plot hook, then wrap up the session. Step 3 hands the roll to the
// table — it posts a chat card asking the most hopeful PC's player to roll +Fortunes
// (+1 this first spring), so the result lands in chat rather than the dialog. Opened
// from the combined introductions/spring-burst step of the WelcomeDialog (see
// templates/dialogs/welcome.hbs).

// Fortunes is +1 for this first spring (Book I, p.32: "roll +Fortunes (+1, in this
// case)"). Later seasons read it off the steading, but the first-session guide is
// always this opening roll.
const FIRST_SPRING_FORTUNES = 1;

/** The once-per-season marker the first spring's gains are applied under (seasonStepApplied). */
export const SPRING_BURST_GAINS_STEP = "springBurstGains";

/** The season this walkthrough IS: the campaign's first spring. */
const FIRST_SPRING = Object.freeze({ season: "spring", year: 1 });

/**
 * Apply the gains ticked at the first spring, ONCE.
 *
 * Through the same helper the steading's Seasons Change window uses (seasonal-gains.js), filed
 * under the same move. Two guards, because this walkthrough can be finished again:
 *   • The clock. A table re-running it mid-campaign has a clock past Spring of Year One, and the
 *     clock stamp is refused for exactly that reason (`advanceOnly` in recordCurrentSeason).
 *     The gains are refused by the same test: nothing is granted for a season the campaign has
 *     already left.
 *   • A marker. Finished twice within that first spring the clock reads the same both times, so
 *     the grant also stamps a once-per-season step and is refused while it stands.
 *
 * @param {Actor}  actor   The steading.
 * @param {object} picked  The walkthrough's ticked gains, a presence map keyed by gain key.
 * @returns {Promise<object|null>}  What was applied, or null when nothing was.
 */
export async function applySpringBurstGains(actor, picked) {
	const steading = actor?.typedActor;
	const keys = SEASONAL_GAINS.filter(g => picked?.[g.key]).map(g => g.key);
	if (!steading || !keys.length) return null;
	if (seasonRank(readCurrentSeason(actor)) > seasonRank(FIRST_SPRING)) return null;
	const { season: seasonId, year } = FIRST_SPRING;
	if (steading.seasonStepApplied(SPRING_BURST_GAINS_STEP, year, seasonId)) return null;
	return applySeasonalGains(steading, keys, {
		year, seasonId,
		also: { flags: steading.seasonStepFlags(SPRING_BURST_GAINS_STEP, year, seasonId) },
	});
}

// The same three tiers, framed for the GM running the first session: you're
// fishing for a plot hook, not just any seasonal gain (Book I, p.32). The tier
// label ("10+" etc.) comes from SPRING_SEASONS_RESULT so it's only written once.
const _OMEN_TIERS = [
	{
		key:  "success",
		text: "Pick a gain that hands you a <strong>hook</strong>: <strong>Interesting news</strong>, <strong>Valuable insight</strong>, or a <strong>Trade opportunity</strong>. (Tor's blessing, an unexpected bounty, and the like don't give you one.)",
	},
	{
		key:  "partial",
		text: "They pick whatever gain they like: you'll pair it with a <strong>threat</strong> to the steading to build your starting situation.",
	},
	{
		key:  "failure",
		text: "Chuckle grimly and <strong>start thinking about threats</strong>.",
	},
];

// Linear walkthrough. `body` is rendered as HTML; `icon` is a Font Awesome class.
const _STEPS = [
	{
		key:   "spring",
		title: "Spring bursts forth",
		icon:  "fa-seedling",
		// "What year is it?": the first spring is the first year of play, so the answer names it.
		askYear: true,
		body:  `<p>The introductions are done and the maps are marked. Tell the players that <strong>spring has just broken forth upon the land</strong>: the snows recede, the soil softens, and Stonetop stirs to life.</p>
				<p>This last step turns everything they've given you into the seed of your first adventure.</p>`,
	},
	{
		// One screen for the whole Seasons Change move — the same content as the
		// steading's Seasons Change modal: the players name the most hopeful character
		// (no field needed), hand them the roll, read the omen, and tick what they pick.
		// The wrap-up note lands in `footer`, below the hook field. Next → "One last
		// question".
		key:      "roll",
		title:    "Make the Seasons Change move",
		icon:     "fa-dice",
		showRoll:  true,
		showTiers: true,
		showGains: true,
		body:     `<p>The players decide together <strong>whose character is the most hopeful</strong>; that character makes the <strong>Seasons Change</strong> move (under <em>Homefront Moves</em> on the Moves &amp; Gear handout): they <strong>roll +Fortunes</strong>, which is <strong>+1</strong> this first spring.</p>
				<p>You're looking for a <strong>plot hook</strong>: read the omen for what each result hands you, and tick whatever gain they pick.</p>`,
		qa:       {
			kind:        "single",
			key:         "hook",
			prompt:      "What hook does it open, the thread for your first adventure?",
			placeholder: "Opportunities or threats…",
		},
		// Under the hook field: how each result and gain becomes the first adventure's hook (Book I
		// pp.255-259), the rows of the gains already ticked marked (gm-toolkit/gm-agenda-view.js).
		hookGuide: true,
		footer:   `<p>Note the result and update the steading playbook if needed, then <strong>start to wrap up</strong>. It'll be tempting to leap straight into play: <strong>don't</strong>; give yourself time to mull over everything the players handed you and to prepare the first expedition.</p>`,
	},
	{
		key:   "question",
		title: "One last question",
		icon:  "fa-comment-dots",
		body:  `<p>Before everyone goes, ask each player:</p>
				<blockquote>What excites you the most about playing your character?</blockquote>
				<p>Whatever they tell you, <strong>write it down</strong>, and try to work it into the first adventure.</p>`,
		qa:    {
			kind:        "perPc",
			key:         "excites",
			prompt:      name => `What excites you most about playing <strong>${name}</strong>?`,
			placeholder: "What they told you…",
			empty:       "Create your characters first to record this per character.",
		},
	},
	{
		key:     "after",
		title:   "After the session",
		icon:    "fa-feather",
		isFinal: true,
		body:    `<p>Once you've broken up for the night, turn the evening's notes into your first adventure:</p>
				<ul>
					<li><strong>Organize your notes</strong>: record each NPC you established (with an occupation, ties, and maybe a trait) in the steading's Residents and Notable Neighbors.</li>
					<li><strong>Build a timeline</strong> of the events the players established, oldest to newest, and reconcile any contradictions.</li>
					<li><strong>Identify threats</strong>: the sources of trouble lurking in those notes.</li>
					<li>Keep an <strong>&ldquo;I wonder&hellip;&rdquo;</strong> list of open questions to answer in play.</li>
					<li><strong>Plan the first adventure</strong> from your threats, that &ldquo;I wonder&hellip;&rdquo; list, and the Seasons Change result.</li>
				</ul>`,
	},
];

export class SpringBurstDialog extends StepperDialog {
	constructor(options = {}) {
		super(options);
		// Set once the GM hands the roll to the table via chat. The result lands in
		// chat, not here, so the omen step can't gate the gains on a tier it never
		// sees — it shows all gains once the roll's been delegated. Persisted in the
		// resume record (see _resumeExtras) so a reload that resumes on the roll step
		// doesn't hide the gains the GM already ticked.
		this._delegatedRoll = false;
		// Latches against a second click while the first is still running.
		this._asking = false;
		this._finishing = false;
	}

	get _steps() { return _STEPS; }
	get _answersSetting() { return ANSWERS_SETTING; }

	static open() {
		// GM prep, and every write it makes is a world write only a GM may make. The macro that opens
		// it is seeded in a GM-only block, but the API call is open to anyone with a console.
		if (!game.user?.isGM) {
			ui.notifications?.warn?.("Only the GM can run Let Spring Burst Forth.");
			return null;
		}
		return openOrFocus("stonetop-spring-burst", () => {
			const dialog = new SpringBurstDialog();
			dialog._restoreStep();   // reopen on the step left off at before a reload
			return dialog.render(true);
		});
	}

	// Reload-resume, implemented once in StepperDialog. `delegated` rides along as an extra
	// because it GATES what the roll step shows: without it a reload that resumes there would
	// hide the gains the GM had already ticked.
	get _resumeKey() { return RESUME_KEY; }
	_resumeExtras() { return { delegated: this._delegatedRoll }; }
	_applyResumeExtras(saved) { this._delegatedRoll = !!saved?.delegated; }

	// "Done" on the final step compiles everything recorded — the Introductions
	// answers and the notes from this walkthrough — into the Chronicle, then closes.
	// This is the session-zero flow's last save, so the Spring Burst page lands in the
	// journal here. Keep the dialog open if the save errors so the GM can retry.
	//
	// Once only per press: the button stays disabled from the first click until the dialog
	// closes (or something fails, when it comes back so the GM can try again).
	async _finish(button) {
		if (this._finishing) return undefined;
		this._finishing = true;
		try {
			await this._answersSettled();   // a tick still being written is part of what is finished
			if (!(await saveChronicleFromButton(button, { context: "Let Spring Burst Forth", keepDisabled: true }))) return undefined;
			await this._recordFirstSpring();
			// Spring has burst forth: mark this walkthrough finished. With the Introductions
			// also done, hooks/Ready.js stops auto-opening the Welcome guide (sessionZeroComplete).
			// Drop the saved step + delegated flag so a manual reopen starts a fresh run.
			markWalkthroughDone(RESUME_KEY, ["step", "stepKey", "delegated"]);
			return await this.close();
		} catch (err) {
			console.error("Stonetop | Let Spring Burst Forth: could not finish", err);
			ui.notifications?.error?.("Couldn't finish Let Spring Burst Forth.");
			if (button) button.disabled = false;
			return undefined;
		} finally {
			this._finishing = false;
		}
	}

	// The first spring is itself a Seasons Change move, so record it in the per-year "Seasons
	// Change" journal (Year 1, Spring): the same log the steading flow keeps from Summer on, so the
	// seasons history starts at this opening spring rather than a season later. Carries the gains
	// that took effect, this first spring's +Fortunes (+1), and the omen/hook the GM noted.
	async _recordFirstSpring() {
		const picked = this._answers().gains ?? {};
		// Asked before the gains land: whether an earlier finish (or the steading's own Seasons
		// Change) already wrote this spring down.
		const alreadyRecorded = hasRecordedSeason("spring", 1);
		// The gains take effect, not just get written down: a Tor's blessing, a Population boom
		// or an Unexpected bounty ticked here holds exactly as one ticked at any later Seasons
		// Change. Before the clock is stamped, so the blessing's stamp and the clock's agree.
		const steadingActor = getStonetopSteadingActor();
		const applied = await applySpringBurstGains(steadingActor, picked);
		// Only what was granted is recorded. Nothing is when there is no steading to grant it to,
		// or when this spring has already had its gains (a walkthrough finished twice, or re-run
		// mid-campaign), and the record must not claim otherwise.
		if (applied) this._grantedGainNames = SEASONAL_GAINS.filter(g => picked[g.key]).map(g => g.name);
		// A retry after a press that granted the gains and then failed to write them down: the gains
		// are granted, so the record names them. The names this window granted when it has them;
		// after a reload, this walkthrough's own stamp says the resumed picks were the ones granted.
		const grantedEarlier = !applied && !alreadyRecorded
			&& !!steadingActor?.typedActor?.seasonStepApplied?.(SPRING_BURST_GAINS_STEP, FIRST_SPRING.year, FIRST_SPRING.season);
		const gainNames = applied || grantedEarlier
			? (this._grantedGainNames ?? SEASONAL_GAINS.filter(g => picked[g.key]).map(g => g.name))
			: [];
		if (alreadyRecorded && !applied) {
			// A re-run. The record already says what this spring was; rewriting it would put the
			// gains ticked now (never granted) over the ones that were.
			ui.notifications?.info?.("Spring of Year One is already in the Seasons Change journal, so its record is left as it is.");
		} else {
			await recordSeasonsChange({
				seasonId: "spring",
				year:     1,
				gainNames,
				fortunes: FIRST_SPRING_FORTUNES,
				notes:    this._answers().hook ?? "",
			});
		}
		// …and set the steading's clock to it, so the sheet header opens on "Spring · First
		// Year" from session zero rather than waiting for the second season to name one.
		// advanceOnly so re-running this walkthrough mid-campaign can't rewind the clock.
		await recordCurrentSeason(getStonetopSteadingActor(), "spring", 1, { advanceOnly: true });
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-spring-burst",
			title:     "Let Spring Burst Forth",
			template:  "systems/stonetop-pwd/templates/dialogs/spring-burst.hbs",
			width:     520,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog"],
			// Asking for the roll redraws the step, which drew it back at its top. StepperDialog
			// still opens a new step at its top (_stepScrollSelector).
			scrollY:   [".stonetop-guide-main"],
		});
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._bindStepNav(html);
		html.find(".stonetop-spring-ask-btn").on("click", () => this._askToRoll());
		html.find(".stonetop-spring-done").on("click", ev => this._finish(ev.currentTarget));
		// Save answers on blur/change so the textarea keeps focus while typing.
		html.find(".stonetop-spring-year-input").on("change", ev => this._saveYear(ev.currentTarget));
		html.find(".stonetop-spring-qa-answer").on("change", ev => {
			const el = ev.currentTarget;
			this._saveAnswer(el.dataset.answerKey, el.value, el.dataset.answerId);
		});
		// Mark which seasonal gain(s) were picked. No re-render — the checkbox toggles
		// natively and we just persist, so nothing on the step is lost.
		html.find(".stonetop-season-gain-check").on("change", ev => {
			const { gainKey } = ev.currentTarget.dataset;
			// Mark that gain's rows in the hook guide too, in place, for the same reason.
			html[0]?.querySelectorAll?.(`.stonetop-hook-gain[data-gain="${gainKey}"]`)
				.forEach(row => row.classList.toggle("is-picked", ev.currentTarget.checked));
			this._saveGain(gainKey, ev.currentTarget.checked);
		});
	}

	getData() {
		const nav  = this._stepNav();
		const step = nav.step;
		return {
			...nav,
			showRoll:  !!step.showRoll,
			showTiers: !!step.showTiers,
			tiers:     step.showTiers
				? _OMEN_TIERS.map(t => ({ text: t.text, label: SPRING_SEASONS_RESULT[t.key].label }))
				: null,
			// Offer the gains once the roll's been handed to the table. The roll lands in
			// chat, not here, so the dialog never learns the tier — it shows the gains the
			// moment the GM delegates the roll (and not before).
			gains:     step.showGains && this._delegatedRoll ? this._gainsContext() : null,
			qa:        this._qaContext(step.qa),
			hookGuide: step.hookGuide ? firstAdventureHooksHtml({ picked: this._answers().gains ?? {} }) : null,
			yearAsk:   step.askYear ? this._yearAskContext() : null,
		};
	}

	// The year field on the opening step. It opens on what the clock's year is called now, which is
	// the start year in a new world; a walkthrough re-run mid-campaign asks the same question the
	// bar's Set the Year does, so the same arithmetic answers it.
	_yearAskContext() {
		const nowYear = timelineNow().year;
		return { value: displayYear(nowYear), min: nowYear, hint: localize("stonetop.campaignYear.springHint") };
	}

	// Name the years by what was typed. Refused (with the reason under the field) rather than
	// clamped: a year before play began is a slip, not an answer.
	async _saveYear(input) {
		const answer = campaignYearPreview(input?.value, timelineNow().year);
		const hint = input?.closest?.(".stonetop-spring-year")?.querySelector?.(".stonetop-spring-year-hint");
		if (hint) hint.textContent = answer.start === null ? answer.text : localize("stonetop.campaignYear.springHint");
		if (answer.start !== null) await setStartYear(answer.start);
	}

	// The seasonal-gains checklist for the omen step: each Book I gain plus whether
	// it's been ticked (stored in springBurstAnswers.gains by key).
	_gainsContext() {
		const picked = this._answers().gains ?? {};
		return SEASONAL_GAINS.map(g => ({ ...g, checked: !!picked[g.key] }));
	}

	// Persist a ticked/unticked seasonal gain. Stored as a presence map under `gains`
	// so an unchecked one is dropped rather than left as `false`.
	//
	// Through _updateAnswers, which queues the writes and sends them through setWorldSetting
	// (`springBurstAnswers` is WORLD-scoped; the walkthrough is GM prep, so that only ever
	// catches a stray call).
	async _saveGain(key, checked) {
		if (!key) return undefined;
		return this._updateAnswers(all => {
			const gains = all.gains ?? {};
			if (checked) gains[key] = true; else delete gains[key];
			all.gains = gains;
		});
	}

	// Build the current step's Q&A field(s) for the template. `single` is one
	// prompt + stored answer; `perPc` is one row per player character (answers
	// stored by actor id), mirroring the journal Q&A lists.
	_qaContext(qa) {
		if (!qa) return null;
		const all = this._answers();
		if (qa.kind === "perPc") {
			const stored = all[qa.key] ?? {};
			const rows = getPlayerCharacters().map(pc => ({
				id:     pc.id,
				prompt: qa.prompt(escHtml(pc.name)),
				answer: stored[pc.id] ?? "",
			}));
			return { kind: "perPc", key: qa.key, placeholder: qa.placeholder, rows, empty: rows.length ? "" : qa.empty };
		}
		return { kind: "single", key: qa.key, prompt: qa.prompt, placeholder: qa.placeholder, answer: all[qa.key] ?? "" };
	}

	// Persist one answer without re-rendering (so the textarea keeps focus). `id`
	// is set for per-PC answers (nested under the question key by actor id).
	async _saveAnswer(key, value, id) {
		if (!key) return undefined;
		return this._updateAnswers(all => {
			if (id) all[key] = { ...(all[key] ?? {}), [id]: value };
			else all[key] = value;
		});
	}

	// Hand the roll to the table: post a chat card asking the most hopeful character's
	// player to roll +Fortunes, with a button they click to do it (the result lands in
	// chat). The dialog never sees the tier, so flag the roll as delegated and show the
	// gains checklist.
	//
	// One card per spring: a second press while the first is posting does nothing, and once a
	// card has been posted (this run, or before a reload) the GM is asked before another goes up.
	async _askToRoll() {
		if (this._asking) return;
		this._asking = true;
		try {
			if (this._delegatedRoll) {
				const again = await confirmOutcome({
					title:   "Ask again?",
					content: "<p>The roll prompt for this spring is already in chat. Post another one?</p>",
					yes:     { label: "Post another" },
					no:      { label: "Keep the one in chat" },
				});
				if (!again) return;
			}
			await postSeasonsRollPrompt({ alias: "Seasons Change: Spring", fortunes: FIRST_SPRING_FORTUNES });
			await postSeasonsChangeReminder("spring");
			this._delegatedRoll = true;
			this.render(false);
		} finally {
			this._asking = false;
		}
	}
}
