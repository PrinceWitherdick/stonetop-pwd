import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { stonetopChatCard } from "../../../utils/chat.js";
import { escHtml } from "../../../utils/strings.js";
import { classifyResult, rollStat } from "../../../utils/roll-engine.js";
import { guideRailStep } from "../../../utils/guide-rail.js";
import { DEATHS_DOOR_STATE, zeroHpMove } from "../deaths-door.js";
import { activatePostDeathChoices, buildPostDeathChoices, outstandingLabel } from "../post-death-choices.js";

// The move itself (name + trigger), from the 0-HP routing table that every other surface reads.
// The trigger is a rule the player is being asked to act on, so the walkthrough, its roll card
// and the sheet's card all print the one wording rather than three transcriptions of it.
const _MOVE = zeroHpMove(null);

/**
 * Death's Door, resolved end to end (Book I, Harm & Healing p.245).
 *
 * The move is short but every one of its branches changes the sheet, so this walks the whole
 * thing rather than printing the text and leaving the player to apply it by hand:
 *
 *   10+  return to 1 HP (written here — the move gives no choice about it) and say how the
 *        brush with death marked you, recorded as a permanent Death's-Door wound.
 *   7-9  no longer dying, but out of the action "until you say otherwise". Recorded as state
 *        rather than HP: the move pointedly does NOT give them a hit point back.
 *   6-   the three fates, as buttons that actually do the thing — step through the Last Door,
 *        refuse to go (Revenant or Ghost), or call on a Thing Below by name (Thrall).
 *
 * Two of the Heavy's moves bend the roll and are folded into the first step: Hard to Kill's
 * "+CON or +nothing (your choice)" and its 7-9 debility trade, and Unstoppable's "-1 penalty
 * for each circle marked".
 *
 * The first step also prints all three outcomes before the dice go, so nobody has to have the
 * move memorized to know what they're rolling into, plus the two asides the book attaches to
 * it: the Lady and the Door are the table's to describe, and the roll can wait for a better
 * moment in the scene.
 */

// What the 10+ mark says before the player says anything. The mark itself is not optional —
// "say how your brush with death has marked you" — so the wound goes on the sheet the moment the
// tier lands and carries the question until it's answered, rather than waiting on a click that
// a player halfway into the next scene never gets round to.
const _MARK_PLACEHOLDER = "Marked in mind, body, or soul: describe the mark";

// One-tap suggestions for the 10+ mark — the book's own examples (p.245), so recording a mark
// mid-session is a single click.
const _DEATHS_DOOR_MARK_CHIPS = [
	"a nasty scar",
	"a lost eye",
	"visions of the Last Door",
	"a murder of crows, always nearby",
];

// The 6- fates, verbatim. `insert` is the post-death insert the fate grants, if any.
const _FATES = [
	{
		key:    "last-door",
		label:  "Make one last move as if you rolled a 12+, then step through the Last Door",
		hint:   "After that they're dead. There's no saving them, and that last move can't be used to avoid death.",
		insert: null,
	},
	{
		key:    "refuse",
		label:  "Refuse to go; gain the Revenant or Ghost insert",
		hint:   "The GM will ask why. If you can't say what you refuse to leave undone, your Terrible Purpose, you shouldn't pick this.",
		insert: "choice",
	},
	{
		key:    "thrall",
		label:  "Call on one of the Things Below by name and beseech it to intercede; gain the Thrall insert",
		hint:   "You must know the name of a Thing Below. If none have come up in play, you can't call on one.",
		insert: "thrall",
	},
];

/**
 * The move's three outcomes, in one place: the roll step previews all of them, the result step
 * marks the one that landed, and the chat card prints the same text. Kept as data rather than
 * retyped per surface so the three can't drift apart. The wording is the book's, verbatim.
 *
 * `text` is PLAIN TEXT, not HTML. It feeds `moveResults[tier].value`, which the roll card runs
 * through formatOutcomeDetail → escHtml and also persists into a `data-outcome-*` attribute for
 * the GM's Shift Up/Down. An HTML entity here therefore reaches the card double-escaped and
 * prints as a literal "&mdash;", so these carry the real characters instead.
 */
const _TIERS = [
	{
		key:   "success",
		label: "10+",
		text:  "You wrest yourself back to the realm of the living—return to 1 HP but say how your brush with death has marked you.",
	},
	{
		key:   "partial",
		label: "7-9",
		text:  "The Lady waves you off—you’re no longer dying but you’re out of the action.",
	},
	{
		key:     "failure",
		label:   "6-",
		text:    "Your time has come—choose 1:",
		// The same three fates the miss offers as buttons, so the preview and the choice read alike.
		options: _FATES.map(f => f.label),
	},
];

// "Refuse to go" forks one more time; both inserts are the same refusal, told differently.
const _REFUSAL_INSERTS = [
	{ slug: "revenant", name: "Revenant", hint: "You cling stubbornly to your body." },
	{ slug: "ghost",    name: "Ghost",    hint: "Your body is dead and gone; your soul lingers." },
];

/**
 * What actually happened, in the terms of the fate that was taken — the walkthrough's last step
 * says it to the player, the chat card says it to the table, and this is the one place either
 * reads it from.
 *
 * Two of the three inserts come from REFUSING to go. The Thrall does not: that fate is "call on
 * one of the Things Below by name and beseech it to intercede" (_FATES above, and the insert's own
 * trigger), and Death is averted by the thing that answered rather than by the character's refusal.
 * Both surfaces used to print the refusal line for all three, which told a Thrall they had done
 * something they hadn't — and "it let you go" reads as "it let you die" besides, since "go" is this
 * dialog's own verb for dying.
 */
const _REFUSED = {
	intro: "You refused to go, and the Last Door let you back. Here is what that costs.",
	card:  (who, what) => `<strong>${who}</strong> refuses the Last Door and gains the <strong>${what}</strong> insert.`,
	next:  "Choose your Terrible Purpose and your first Consequence.",
};

const _INSERT_TAKEN = {
	revenant: _REFUSED,
	ghost:    _REFUSED,
	thrall:   {
		intro: "You called one of the Things Below by name, and it answered. Here is what that costs.",
		card:  (who, what) =>
			`<strong>${who}</strong> calls on a Thing Below by name, and it intercedes: gaining the <strong>${what}</strong> insert.`,
		// The Mark is the GM's to choose (thrall.json: "the GM will choose 1 Mark for you"), so
		// this does not tell the player to take one.
		next:  "Name your master; your GM will choose the Mark it leaves on you.",
	},
};

/**
 * How dark the window is, by what the dice did. The styling for each lives in stonetop.css
 * under "the dark comes in from the edges"; all this side owns is which one is true.
 */
const _MOODS = {
	dusk:     "deaths-door-mood--dusk",        // the dice are still in hand
	returned: "deaths-door-mood--returned",    // 10+
	wavedOff: "deaths-door-mood--waved-off",   // 7-9
	door:     "deaths-door-mood--door",        // 6-, or Refuse to Go
};

// Stamped for the render where the mood CHANGES, so the "lights go out" animation plays on
// the roll that lands the miss and not again on every click inside it.
const _MOOD_ENTERING = "deaths-door-mood-entering";

/**
 * The window the last step needs, and the reason it isn't the one the rest of the walkthrough
 * uses. Every other step is a paragraph and a couple of buttons, so it hugs its content; the
 * insert's questions are four lists of the book's own prose, and stacked they made a window
 * taller than the screen with the footer pushed off the bottom of it. That step is laid out as
 * the shared left-rail sheet instead (the first-session guide's chrome — see welcome.hbs), which
 * needs a definite height to scroll one panel inside rather than growing the frame, and a little
 * more width to pay for the rail.
 */
const _CHOICES_SIZE = { width: 760, height: 600 };

// The two scrolling columns, either of which may be the one on screen: the walkthrough's own body
// on every step but the last, and the rail sheet's panel column on that one.
const _SCROLLERS = [".deaths-door-dialog-content", ".deaths-door-choices-main"];

export class DeathsDoorDialog extends StonetopDialog {
	constructor(character, onDone, options = {}) {
		// One window PER CHARACTER — see StonetopDialog.perDocumentOptions for why sharing one id
		// silently merges two of these into one frame. It matters more here than anywhere else:
		// the choices step keeps the window open for four questions rather than one roll.
		super(StonetopDialog.perDocumentOptions(
			"stonetop-deathsdoor-dialog", character?._actor?.id, options));
		this._character = character;
		this._onDone = onDone;
		this._stat   = "";               // "" = +nothing; "con" with Hard to Kill

		// The 10+ mark's wound, once a 10+ has seeded it, and the text last written to it. The
		// wound is created by the tier itself and the text saves as the player leaves the field,
		// so there is no button to miss — see _seedMark. `_markText` is what a re-render of this
		// window puts back in the input; the wound on the sheet is the record.
		this._markWoundId = null;
		this._markText    = "";
		this._markSeeding = null;   // the in-flight seed write, so two callers can't make two marks

		// Reopened on an unresolved 6-: the roll is spent, so resume at the fates rather than
		// offering a fresh one. The GM asking "why do you refuse?" is exactly the pause that
		// sends a player back out of this dialog and into the conversation.
		this._step = this._fatePending ? "result" : "roll";   // "roll" | "result" | "fate" | "choices"
		// What the insert asks for once one is taken. Loaded on the way into the "choices" step
		// (it reaches the compendium), null everywhere else.
		this._choices = null;
		// Which of the insert's questions the rail is showing. Latched on the instance rather than
		// derived per render because that step re-renders on every answer, and a cursor recomputed
		// each time would move itself: answering the question you are looking at would swap the
		// panel out from under you before you had read what taking it did to your character.
		this._choiceStep = null;
		// Set by the rail so ONE render lands the new panel at its top. Everything else about that
		// step wants the scroll kept (see _render).
		this._choiceScrollReset = false;
		// Whether the window has already been resized for the rail sheet. One-shot, so a player who
		// resizes the window mid-question doesn't have it snapped back on their next click.
		this._sizedForChoices = false;
	}

	/**
	 * A 6- whose fate hasn't been chosen. Read from the character rather than latched here: the
	 * state on the actor is what a reopened dialog resumes from, and every path through this
	 * walkthrough writes it, so a second copy could only ever disagree with it.
	 */
	get _fatePending() {
		return this._character?.deathsDoorState === DEATHS_DOOR_STATE.FATE_PENDING;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-deathsdoor-dialog",
			template:  "systems/stonetop-pwd/templates/dialogs/deaths-door.hbs",
			title:     "Death's Door",
			width:     620,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-deathsdoor-dialog"],
		});
	}

	/**
	 * Content-hugging on every step but the last. The rail sheet is the exception: its panel column
	 * scrolls INSIDE a window of a fixed height, and a window that hugged its tallest panel instead
	 * would be the wall of questions the rail exists to break up.
	 */
	get _autoHeight() { return this._step !== "choices"; }

	/**
	 * Carries the scroll position across the re-render every answer on the choices step triggers:
	 * a Thrall's nine Marks run well past the window's height cap, and without this, ticking the
	 * Mark you scrolled down to threw you back to the top of the list.
	 *
	 * Also the one place the rail sheet is sized. Both columns are queried because which of them
	 * scrolls depends on the step (see _SCROLLERS), and only the one on screen answers.
	 */
	async _render(force, options) {
		const before = this._captureScroll();
		await super._render(force, options);
		this._sizeForStep();
		this._restoreScroll(before);
		this._paintMood();
	}

	_captureScroll() {
		const root = this.element?.[0];
		return _SCROLLERS.map(sel => root?.querySelector(sel)?.scrollTop ?? 0);
	}

	/**
	 * Put each column back where it was. A rail click is the one render that must NOT: a fresh
	 * panel starts at its top, the same as every other guide-rail sheet does it (applyGuideRail).
	 */
	_restoreScroll(tops) {
		const reset = this._choiceScrollReset;
		this._choiceScrollReset = false;
		const root = this.element?.[0];
		_SCROLLERS.forEach((sel, i) => {
			if (!tops[i] || (reset && sel === ".deaths-door-choices-main")) return;
			const el = root?.querySelector(sel);
			if (el) el.scrollTop = tops[i];
		});
	}

	/**
	 * Give the rail sheet the room it needs, once. Every earlier step hugs its own content through
	 * `_autoHeight`, which is why this can't live in defaultOptions: a 600px frame around the roll
	 * step would be mostly empty window.
	 */
	_sizeForStep() {
		if (this._step !== "choices" || this._sizedForChoices) return;
		this._sizedForChoices = true;
		this.setPosition({ ..._CHOICES_SIZE });
	}

	/**
	 * Which mood the window wears. Derived from the same classification getData() renders
	 * rather than latched at each transition, so a re-render — a GM's tier shift, a reopened
	 * 6- — can never leave the window lit for a result it is no longer showing.
	 */
	_mood() {
		// Both post-6- steps are past the Door by definition — the fate fork, and the walkthrough
		// of what the insert they took now asks of them.
		if (this._step === "fate" || this._step === "choices" || this._fatePending) return _MOODS.door;
		if (this._step !== "result") return _MOODS.dusk;
		const key = this._rolledTotal == null ? null : classifyResult(this._rolledTotal).key;
		if (key === "success") return _MOODS.returned;
		if (key === "partial") return _MOODS.wavedOff;
		if (key === "failure") return _MOODS.door;
		return _MOODS.dusk;
	}

	/**
	 * Put the mood on the window ROOT, not the content: the frame and the title bar have to
	 * turn over with the body, and only the root is an ancestor of both.
	 */
	_paintMood() {
		const root = this.element?.[0];
		if (!root) return;
		const mood = this._mood();
		root.classList.remove(...Object.values(_MOODS), _MOOD_ENTERING);
		root.classList.add(mood);
		if (mood === this._paintedMood) return;
		this._paintedMood = mood;
		// Reading a layout property between the remove and the add is what restarts the
		// entering animation; without it the browser coalesces the pair into no change at all
		// and a second visit to the same mood plays nothing.
		void root.offsetWidth;
		root.classList.add(_MOOD_ENTERING);
	}

	/** The insert's questions, or an empty list before one has been taken. */
	get _choiceSteps() { return this._choices?.steps ?? []; }

	/**
	 * Which question the rail is on. `_choiceStep` is what the player picked and is honoured
	 * whenever it still names a step; anything else (a fresh insert, a swapped one) falls back to
	 * the first one they haven't answered, which is where a walkthrough should open.
	 */
	_activeChoiceKey() {
		const steps = this._choiceSteps;
		if (steps.some(s => s.key === this._choiceStep)) return this._choiceStep;
		return (steps.find(s => !s.done) ?? steps[0])?.key ?? "";
	}

	getData() {
		const opts  = this._character?.deathsDoorRollOptions?.() ?? { statChoices: [{ stat: "", label: "+nothing" }], penalty: 0, hardToKill: false, unstoppableMarks: 0 };
		const total = this._rolledTotal ?? null;
		const key   = total === null ? null : classifyResult(total).key;
		// A resumed 6- has no total left to classify but is still sitting on the miss.
		const landed = key ?? (this._fatePending ? "failure" : null);

		// The rail, and the one panel it is showing. `isActive` is stamped onto a COPY of each step
		// rather than onto the built view model, so the cursor can never leak into what the next
		// _refreshChoices reads back.
		const activeKey   = this._activeChoiceKey();
		const activeIndex = this._choiceSteps.findIndex(s => s.key === activeKey);
		const choices     = this._choices
			? { ...this._choices, steps: this._choiceSteps.map(s => ({ ...s, isActive: s.key === activeKey })) }
			: null;

		return {
			// The move's own name and trigger, from the 0-HP routing table, so the walkthrough,
			// the roll card and the sheet all print one wording of the rule.
			move: _MOVE,

			isRoll:    this._step === "roll",
			isResult:  this._step === "result",
			isFate:    this._step === "fate",
			isChoices: this._step === "choices",

			// The insert's outstanding business, for the last step. Built in _refreshChoices
			// because it reads the compendium; null until an insert has been taken.
			choices:          choices,
			insertName:       this._choices?.name ?? "",
			// Told in the terms of the fate that was actually taken — see _INSERT_TAKEN.
			choicesIntro:     (_INSERT_TAKEN[this._choices?.slug] ?? _REFUSED).intro,
			outstandingLabel: outstandingLabel(this._choices),

			// One rail entry per question. The label is the step's `short` name, the same words the
			// "still to choose" line uses, so the footer and the rail can't call the same question
			// two different things. The tick is the step's own `done`, which is the rules' answer to
			// "is this one settled" rather than this window's guess at it.
			choiceTabs: (choices?.steps ?? []).map(s => ({
				key: s.key, label: s.short, icon: s.icon, done: s.done, isActive: s.isActive,
			})),
			atFirstChoice: activeIndex <= 0,
			atLastChoice:  activeIndex === this._choiceSteps.length - 1,

			rolledTotal: total,
			isStrong:    key === "success",
			isWeak:      key === "partial",
			// A resumed 6- has no total to show but is still a miss awaiting its fate.
			isMiss:      key === "failure" || this._fatePending,

			// Roll step
			statChoices:  opts.statChoices.map(c => ({ ...c, selected: c.stat === this._stat })),
			hasStatChoice: opts.statChoices.length > 1,
			// A player being handed a stat to roll shouldn't have to remember which of their moves
			// is doing it. Name and prose both come from the move they actually own, so a reworded
			// or homebrewed one prints its own words here rather than a copy kept in this file.
			statChoiceMove:            opts.statChoiceMove ?? null,
			statChoiceMoveDescription: opts.statChoiceMoveDescription ?? null,
			penalty:       opts.penalty,
			unstoppableMarks: opts.unstoppableMarks,

			// The outcome ladder, shared by both steps: a preview before the roll, and after it
			// the same three with the one that landed picked out.
			tiers: _TIERS.map(t => ({
				label:     t.label,
				text:      t.text,
				options:   t.options ?? null,
				isCurrent: t.key === landed,
			})),

			// 10+. What the tier did to the sheet is the tier itself (see _applyTier), so both
			// confirmations are read off the classification rather than latched at the write:
			// a re-roll then can't leave the previous tier's line standing.
			markChips:  _DEATHS_DOOR_MARK_CHIPS,
			// The wound exists from the moment the 10+ lands (see _seedMark), so this reports that
			// it's already on the sheet rather than gating the input behind a "record" click. The
			// input stays open either way: describing the mark is editing the wound, not creating it.
			markSeeded: !!this._markWoundId,
			markText:   this._markText,
			restored:   key === "success",

			// 7-9 — Hard to Kill's trade is the only way back to 1 HP on a weak hit, and taking
			// it is what ends being out of the action.
			hardToKill:      opts.hardToKill,
			debilityChoices: this._character?.debilityChoices?.filter(d => !d.marked) ?? [],
			debilityTraded:  !!this._debilityTraded,
			outOfAction:     key === "partial" && !this._debilityTraded,

			// 6-
			fates:          _FATES,
			refusalInserts: _REFUSAL_INSERTS,
			fateApplied:    !!this._fateApplied,
		};
	}

	activateListeners(html) {
		super.activateListeners(html);

		html.find(".deaths-door-roll-btn").on("click", () => this._onRoll());
		html.find(".deaths-door-close-btn").on("click", () => this._onFinish());
		html.find(".deaths-door-cancel-btn").on("click", () => this.close());

		html.find(".deaths-door-stat-choice").on("change", (ev) => { this._stat = ev.currentTarget.value; });

		// 10+ mark. The wound is already on the sheet by the time this step renders, so nothing
		// here creates it — a chip and the input both just describe it. Saved on `change` (blur or
		// Enter) rather than per keystroke: one write per phrasing, not one per letter, and the
		// close() below flushes a field the player typed in and then shut the window on.
		html.find(".deaths-door-mark-chip").on("click", (ev) => {
			const text = ev.currentTarget.dataset.mark ?? "";
			this.element.find(".deaths-door-mark-input").val(text);
			this._saveMark(text);
		});
		html.find(".deaths-door-mark-input").on("change", (ev) => this._saveMark(ev.currentTarget.value));

		// 7-9, Heavy only: mark a debility of your choice to regain 1 HP.
		html.find(".deaths-door-debility-btn").on("click", (ev) => this._onTradeDebility(ev.currentTarget.dataset.debility));

		// 6-: pick a fate, then (for "refuse to go") which insert tells it.
		// Both carry a `.catch`: each handler rolls its latch back and rethrows, and a click is
		// fired and forgotten, so without one the rejection reached the console and the player was
		// left looking at a window that had silently ignored them.
		html.find(".deaths-door-fate-btn").on("click", (ev) =>
			this._onChooseFate(ev.currentTarget.dataset.fate).catch(err => this._onFateFailed(err)));
		html.find(".deaths-door-insert-btn").on("click", (ev) =>
			this._onTakeInsert(ev.currentTarget.dataset.slug).catch(err => this._onFateFailed(err)));

		// The rail down the side of the last step, and the pair of buttons that walk it. Navigation
		// is this window's, not the chooser's: the rules table knows what the questions are, and
		// only the window knows which of them is on screen.
		html.find(".deaths-door-choice-tab").on("click", (ev) => this._goToChoice(ev.currentTarget.dataset.choiceStep));
		html.find(".deaths-door-choice-back").on("click", () => this._stepChoice(-1));
		html.find(".deaths-door-choice-next").on("click", () => this._stepChoice(1));

		// And what the insert asks for. The handlers are the chooser's own, so the rules live
		// beside the table that states them rather than in this window.
		activatePostDeathChoices(html, this._character, async () => {
			await this._refreshChoices();
			this.renderIfOpen();
		});
	}

	/**
	 * Show one of the insert's questions.
	 *
	 * Rendering rather than swapping panels in the DOM (which is how the first-session guide does
	 * it) because this step re-renders on every answer anyway: a hand-synced rail here would only
	 * be a second copy of the same switch, and the two would have to agree.
	 */
	_goToChoice(key) {
		if (!key || key === this._activeChoiceKey()) return;
		if (!this._choiceSteps.some(s => s.key === key)) return;
		this._choiceStep = key;
		this._choiceScrollReset = true;
		this.renderIfOpen();
	}

	/** Back / Next along the rail. Shares its arithmetic with every other guide-rail sheet. */
	_stepChoice(delta) {
		const next = guideRailStep(this._choiceSteps, this._activeChoiceKey(), delta);
		if (next) this._goToChoice(next.key);
	}

	/**
	 * Roll the move through the shared engine, so the card matches every other move card: tier
	 * outcomes, advantage pills, the GM's Shift Up/Down.
	 *
	 * The one thing it does NOT take from the engine is the standard +1 XP on a 6-. A miss here
	 * isn't a lesson learned, it's the end of the character — and paying out XP into a sheet
	 * that's about to be retired, in the same breath as "your time has come", lands badly at the
	 * table. The Heavy's own Hard to Kill already carries `noXpOnMiss` in the pack, so this is
	 * also what the one Death's Door roll the compendium describes in full expects.
	 */
	async _onRoll() {
		if (this._rolling) return;
		this._rolling = true;
		try {
			const actor = this._character?._actor ?? null;
			if (!actor) return;
			const { penalty } = this._character.deathsDoorRollOptions();

			// Rolling +CON exposes the roll to `miserable`, like any other +CON roll; +nothing
			// touches no stat and so is untouched by debilities.
			const rollOptions = this._character.applyDebilityRollMode?.(this._stat, { rollMode: "normal" })
				?? { rollMode: "normal" };

			const roll = await rollStat(this._stat, actor, {
				...rollOptions,
				statValue:   this._stat ? undefined : 0,
				moveName:    _MOVE.name,
				modifier:    penalty,
				noXpOnMiss:  true,
				moveDescription: `<p>${_MOVE.trigger} Then, roll ${this._stat ? "+CON" : "+nothing"}.</p>`,
				// " / " so the card's own pick-list formatter (formatOutcomeDetail) recognises the
				// "choose 1:" hinge and breaks the three fates onto bulleted lines instead of one
				// run-on. Safe despite the fates' own semicolons: the separator only treats a ";"
				// as one when a capitalised "OR" follows it.
				moveResults: Object.fromEntries(_TIERS.map(t => [t.key, {
					label: t.label,
					value: t.options ? `${t.text} ${t.options.join(" / ")}` : t.text,
				}])),
			});

			this._rolledTotal = roll.total;
			this._step = "result";
			// A fresh roll is a fresh brush with death: re-arm the per-result actions so a
			// re-roll (a GM tier shift, say) can record its own outcome. The mark is pointedly NOT
			// re-armed — it's a wound on the sheet now, not a pending action, and re-arming it
			// would leave a re-rolled 10+ carrying two marks for one visit to the Door.
			this._debilityTraded = false;
			this._fateApplied = false;

			await this._applyTier(classifyResult(roll.total).key);
			// Guarded: a 3D-dice roll and the tier's writes are several seconds of awaits, and a
			// window the player closed in the middle of them must not be forced back open over
			// whatever they moved on to. The outcome is already on the sheet either way.
			this.renderIfOpen();
		} finally {
			this._rolling = false;
		}
	}

	/**
	 * Enact what the tier does to the sheet on its own, with no button to press: a 10+ returns
	 * them to 1 HP and records the mark it left, and a 7-9 puts them out of the action. None of
	 * it is a choice the move offers — "say how your brush with death has marked you" is an
	 * instruction, not an option — so none of it waits on a click. What the move DOES leave to
	 * the player stays a button: the Heavy's debility trade and the three fates. Describing the
	 * mark is then editing a wound that already exists, which is why closing the window without
	 * typing still leaves the mark on the sheet.
	 */
	async _applyTier(key) {
		if (key === "success") {
			// The hit point and the end of dying land in one write (see returnToOneHp).
			await this._character.returnToOneHp();
			await this._seedMark();
		} else if (key === "partial") {
			// Pointedly no HP: "no longer dying" is not "back up". They're unconscious (or close
			// enough) until the GM says otherwise, which is what the state records.
			await this._character.setDeathsDoorState(DEATHS_DOOR_STATE.OUT_OF_ACTION);
		} else {
			// A 6- decides nothing but that the roll is spent — which of the three fates they take
			// is still theirs, and the GM will want to ask about it before they answer.
			await this._character.setDeathsDoorState(DEATHS_DOOR_STATE.FATE_PENDING);
		}
	}

	/**
	 * Put the 10+ mark on the sheet the moment the tier lands, undescribed. The placeholder text
	 * is the prompt itself, so a wound nobody got round to naming still reads as something to
	 * answer rather than as a blank the sheet can't explain.
	 *
	 * The in-flight promise is what keeps it to one: a chip clicked while the write is still going
	 * out joins that write rather than starting a second one, so a fast player can't end up with
	 * two marks for one visit to the Door. It resolves rather than rejects on a failed write —
	 * this runs inside the roll's own apply step, and a mark that couldn't be written must not
	 * take the tier's HP and chat card down with it. The next save retries.
	 */
	async _seedMark() {
		if (this._markSeeding) return this._markSeeding;
		if (this._markWoundId || !this._character?.addWound) return;
		this._markSeeding = (async () => {
			try {
				this._markWoundId = await this._character.addWound({
					text: _MARK_PLACEHOLDER,
					status: "permanent",
					origin: "deaths-door",
				});
			} catch (err) {
				console.error("Stonetop | could not record the Death's-Door mark", err);
				ui.notifications?.warn?.("Couldn't record the Death's-Door mark: describe it and it will try again.");
			} finally {
				this._markSeeding = null;
			}
		})();
		return this._markSeeding;
	}

	/**
	 * Write the described mark onto that wound. Called as the player leaves the input and as the
	 * window closes, so the phrasing they left in the field is what's on the sheet either way.
	 *
	 * Seeds first if the wound is somehow missing — a window reopened on a 10+ that predates the
	 * seeding, or a failed seed — so this path can always answer for the mark on its own.
	 * Blanking the field falls back to the placeholder rather than deleting: they were marked
	 * whether or not they can say how, and only the sheet's own trash affordance takes that back.
	 */
	async _saveMark(value) {
		const text = String(value ?? "").trim();
		if (text === this._markText) return;
		if (!this._markWoundId) await this._seedMark();
		if (!this._markWoundId) return;
		await this._character.updateWound?.(this._markWoundId, { text: text || _MARK_PLACEHOLDER });
		// Latched only once the write has landed, so a save that failed doesn't make the next
		// attempt at the same wording look like a no-op and drop it for good.
		this._markText = text;
	}

	/** Hard to Kill, 7-9: "you can mark a debility of your choice to regain 1 HP" (p.113). */
	async _onTradeDebility(key) {
		if (this._debilityTraded || !key) return;
		const name = this._character.debilityChoices.find(d => d.key === key)?.name ?? key;
		this._debilityTraded = true;
		try {
			// One write: the debility, the hit point and the end of being out of the action are
			// all the one trade.
			const ok = await this._character.markDebility(key,
				{ hp: 1, moveName: "Hard to Kill", clearsDeathsDoor: true });
			if (!ok) { this._debilityTraded = false; return; }
		} catch (err) {
			this._debilityTraded = false;
			throw err;
		}
		await this._post("Hard to Kill", `<p><strong>${escHtml(this._actorName)}</strong> marks <strong>${escHtml(name)}</strong> to regain 1 HP.</p>`);
		this.renderIfOpen();
	}

	get _actorName() { return this._character?._actor?.name ?? "The character"; }

	/** A fate that could not be written. The latch is already back off; say so and redraw. */
	_onFateFailed(err) { this.reportWriteFailure("fate", err); }

	/**
	 * A 6- fate. "Refuse to go" forks again (Revenant or Ghost), so it advances to the insert
	 * step; the other two resolve here.
	 */
	async _onChooseFate(key) {
		const fate = _FATES.find(f => f.key === key);
		if (!fate || this._fateApplied) return;

		if (fate.insert === "choice") { this._step = "fate"; this.render(true); return; }
		if (fate.insert) return this._onTakeInsert(fate.insert);

		// Step through the Last Door. Nothing on the sheet changes but the state — the last
		// move is made in the fiction, at the table, as a 12+.
		//
		// The latch is rolled back on a failed write, the same as _onTakeInsert below. Left set, a
		// refused update (a player-owned actor whose permission the server declines, a dropped
		// connection) wrote nothing, posted nothing and re-rendered nothing, while every later
		// click returned at the guard above: the three fates stayed on screen and none of them
		// could be chosen again.
		this._fateApplied = true;
		try {
			await this._character.setDeathsDoorState(DEATHS_DOOR_STATE.DEAD);
		} catch (err) {
			this._fateApplied = false;
			throw err;
		}
		await this._post("The Last Door", `<p><strong>${escHtml(this._actorName)}</strong> makes one last move as if they rolled a <strong>12+</strong>, then steps through the Last Door.</p>
			<p class="stonetop-dying-trigger">There's no saving them. Only the rarest of magic can bring them back.</p>`);
		this.renderIfOpen();
	}

	/** Grant a post-death insert — the actual mechanical consequence of refusing to go. */
	async _onTakeInsert(slug) {
		if (this._fateApplied || !slug) return;
		this._fateApplied = true;
		try {
			// They died and came back: no longer dying, and emphatically not dead. From here on
			// 0 HP triggers the insert's own move, not Death's Door again. That clear rides IN the
			// slug's own write rather than following it as a second one — as a pair, a reload
			// landing between them left a Ghost still flagged `fate-pending`, and the whole sheet
			// then insisted Death's Door was owed by someone who had just answered it.
			await this._character.setPostDeathInsert(slug);
		} catch (err) {
			this._fateApplied = false;
			throw err;
		}
		const name  = _REFUSAL_INSERTS.find(i => i.slug === slug)?.name ?? "Thrall";
		const taken = _INSERT_TAKEN[slug] ?? _REFUSED;
		// Straight on to what the insert asks for. The insert is already theirs, so this step is
		// a walkthrough rather than a gate: closing the window here leaves them undead with their
		// choices outstanding, and the Post-Death tab carries a button to come back and finish.
		this._step = "choices";
		await this._refreshChoices();
		await this._post(name, `<p>${taken.card(escHtml(this._actorName), escHtml(name))}</p>
			<p class="stonetop-dying-trigger">${taken.next}</p>`);
		// Granting an insert is several server round trips and a chat message; a player who gave
		// up waiting and closed the window must not have it reopened underneath them. Everything
		// above is already written, and the Post-Death tab prints the rest.
		this.renderIfOpen();
	}

	/**
	 * Re-read what the insert still asks for. Held on the instance rather than fetched in getData
	 * because it reaches the compendium (the insert's own lore and instincts) and getData is
	 * synchronous — the same reason UndeathDialog loads its sections up front.
	 */
	async _refreshChoices() {
		// Per CHARACTER, not per window kind: radio `name`s are document-global, and now that two
		// of these can be open at once (see the id in the constructor) a shared suffix would put
		// two characters' Purposes in one group — clicking in one would clear the other.
		const id = this._character?._actor?.id ?? "unknown";
		this._choices = await buildPostDeathChoices(this._character, { group: `deathsdoor-${id}` });
		this._latchChoiceStep();
	}

	/**
	 * Open the rail on the first unanswered question, and then LEAVE IT THERE.
	 *
	 * Latched rather than resolved per render because this runs after every answer: a cursor that
	 * kept asking "which is first unanswered?" would walk itself forward as the player worked, and
	 * the click that takes a Consequence would replace the panel with the next question before the
	 * paragraphs saying what that Consequence does to them had a chance to appear.
	 */
	_latchChoiceStep() {
		if (this._choiceSteps.some(s => s.key === this._choiceStep)) return;
		this._choiceStep = this._activeChoiceKey() || null;
	}

	async _post(title, body) {
		const actor = this._character?._actor ?? null;
		await ChatMessage.create({
			speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker(),
			content: stonetopChatCard(title, `<div class="card-content">${body}</div>`, "stonetop-dying-card"),
		});
	}

	/**
	 * Flush the mark on the way out. `change` doesn't fire for a field the player typed in and
	 * then closed the window on (Escape, the X, or Done straight from the keyboard), and losing
	 * the one sentence they wrote about their own death is exactly the loss this window is
	 * supposed to stop. Read before super.close() tears the element down.
	 */
	async close(options = {}) {
		const input = this.element?.find?.(".deaths-door-mark-input");
		const text  = input?.length ? input.val() : null;
		if (text !== null && text !== undefined) {
			// Never trap the window open on a failed write: the mark is already on the sheet, and
			// the only thing at stake here is the wording.
			try { await this._saveMark(text); }
			catch (err) { console.error("Stonetop | could not save the Death's-Door mark", err); }
		}
		return super.close(options);
	}

	async _onFinish() {
		await this.close();
		this._onDone?.();
	}
}

// Exported for the tests that assert the 6- options still read as the book's three fates, and
// that the tier text stays plain (an entity or tag here prints as literal markup on the card).
export { _FATES as DEATHS_DOOR_FATES, _REFUSAL_INSERTS as DEATHS_DOOR_REFUSAL_INSERTS, _TIERS as DEATHS_DOOR_TIERS };
