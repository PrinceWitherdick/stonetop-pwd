import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { escHtml } from "../../../utils/strings.js";
import { TIER_LABELS } from "../../../utils/move-results.js";
import { classifyResult, messageOfRoll } from "../../../utils/roll-engine.js";
import { promptRoll } from "../../../dialogs/RollDialog.js";
import { guideRailStep } from "../../../utils/guide-rail.js";
import {
	DEATHS_DOOR_FLAG, DEATHS_DOOR_ROLL_FLAG, DEATHS_DOOR_ROLL_STALE_MS, DEATHS_DOOR_STATE, HARD_TO_KILL,
	HARD_TO_KILL_TRADE_FLAG, NEVER_GONNA_KEEP_ME_DOWN, deathsDoorCardTier, deathsDoorCardTierShift,
	deathsDoorRollWatch, zeroHpMove,
} from "../deaths-door.js";
import {
	clearDeathsDoorRollMarker, deathsDoorRollCard, deathsDoorRollClock, deathsDoorRollMarker, deathsDoorRollPosted,
	setDeathsDoorRollMarker,
} from "../deaths-door-actor.js";
import {
	DEATHS_DOOR_BOOSTS, askDeathsDoorBoost, askDeathsDoorClaim, burnBrightlyOnDoorCard, deathsDoorBoostsLeft,
} from "../deaths-door-relay.js";
import { ROLLED_FLAG, countedNote, countedTier, outcomeTier } from "../../../utils/counted-tier.js";
import { activatePostDeathChoices, buildPostDeathChoices, outstandingLabel } from "../post-death-choices.js";
import { endBattleJoyUnrolled } from "../../../combat/battle-joy-offer.js";
import { SYSTEM_ID } from "../../../system-id.js";
import { deletionEntry } from "../../../utils/foundry-compat.js";
import { postDyingCard } from "../../../hooks/DeathsDoorPrompt.js";
import { format, localize } from "../../../utils/i18n.js";
import { rollRewrite } from "../../../utils/roll-rewrite.js";
import { rollCardRoute } from "../../../utils/roll-card-writer.js";
import { boostButtonFace, boostNote, boostsOn, deathsDoorPlusOnes, pressBoost } from "../roll-boosts.js";
import { BURN_BRIGHTLY_COST } from "../burn-brightly.js";
import { GAVE_IT_ALL_FLAG, GIVE_IT_ALL_COSTS, IMPETUOUS_YOUTH, askGiveItAllCost, giveItAllAtDeathsDoor } from "../impetuous-youth.js";

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
 * for each circle marked". So do two of the Would-Be Hero's: Never Gonna Keep Me Down's "once per
 * session ... don't roll. You get a 10+", a button beside the roll, and the Destined's "treat a
 * 6- on Death's Door as a 7-9, and a 7-9 as a 10+", which moves the tier the dice land on.
 *
 * And two things that reach back into a roll after the dice land: Burn Brightly (+1 for 2 XP) and the
 * Would-Be Hero's Impetuous Youth ("give it your all": up to the next tier, for a cost). Everywhere else
 * they are buttons on the roll card, but this window settles the tier the moment the dice land, so a
 * lift on the card afterwards would only relabel it. So when either is on offer the result step waits
 * on the counted tier with a button for each and "Accept this result", and the tier is written only
 * once the player accepts (or nothing is left to offer). See _onBurnBrightly and _onGiveItAll. It waits the same
 * way on the roll-card +1s (Diligence, Sanction, Many Hands, a Blessing: roll-boosts.js) while anyone could still
 * add one: this user's own are buttons here, and another player's are pressed on the card, which takes them only
 * while this wait lasts (roll-boosts.js#deathsDoorAwaitsPlusOnes). See _onPlusOne and _onCardRewritten.
 *
 * Any owner of the character can open this window, so the roll is claimed before the dice: through the primary
 * GM's client, which rules on one claim at a time, so two owners pressing Roll together make one roll and the other
 * window waits on it (_claimRoll, deaths-door-relay.js). A private roll's card never reaches the other owners, so a
 * window that takes one over spends its boosts through the GM's client too (_boostViaGM).
 *
 * The first step also prints all three outcomes before the dice go, so nobody has to have the
 * move memorized to know what they're rolling into, plus the two asides the book attaches to
 * it: the Lady and the Door are the table's to describe, and the roll can wait for a better
 * moment in the scene.
 */

// This window's strings in languages/en.json. Every table below reads them through getters, so each
// reader gets them in the language of the moment it reads them (as impetuous-youth.js#GIVE_IT_ALL_COSTS does).
const _I18N = "stonetop.specialMoves.deathsDoor";

// What the 10+ mark says before the player says anything. The mark itself is not optional —
// "say how your brush with death has marked you" — so the wound goes on the sheet the moment the
// tier lands and carries the question until it's answered, rather than waiting on a click that
// a player halfway into the next scene never gets round to.
const _markPlaceholder = () => localize(`${_I18N}.mark.placeholder`);

// One-tap suggestions for the 10+ mark — the book's own examples (p.245), so recording a mark
// mid-session is a single click.
const _markChips = () => ["scar", "eye", "visions", "crows"].map(key => localize(`${_I18N}.mark.chips.${key}`));

// The 6- fates, verbatim. `insert` is the post-death insert the fate grants, if any; `i18n` names the
// fate's strings (`fates.<i18n>.label` / `.hint`).
const _fate = (key, i18n, insert) => Object.freeze({
	key,
	insert,
	get label() { return localize(`${_I18N}.fates.${i18n}.label`); },
	get hint()  { return localize(`${_I18N}.fates.${i18n}.hint`); },
});
const _FATES = Object.freeze([
	_fate("last-door", "lastDoor", null),
	_fate("refuse",    "refuse",   "choice"),
	_fate("thrall",    "thrall",   "thrall"),
]);

/**
 * The move's three outcomes, in one place: the roll step previews all of them, the result step
 * marks the one that landed, and the chat card prints the same text. Kept as data rather than
 * retyped per surface so the three can't drift apart. The wording is the book's, verbatim
 * (`tiers.<key>` in the language file).
 *
 * `text` is PLAIN TEXT, not HTML. It feeds `moveResults[tier].value`, which the roll card runs
 * through formatOutcomeDetail → escHtml and also persists into a `data-outcome-*` attribute for
 * the GM's Shift Up/Down. An HTML entity here therefore reaches the card double-escaped and
 * prints as a literal "&mdash;", so these carry the real characters instead.
 */
const _tier = key => Object.freeze({
	key,
	label: TIER_LABELS[key],
	get text() { return localize(`${_I18N}.tiers.${key}`); },
});
const _TIERS = Object.freeze([
	_tier("success"),
	_tier("partial"),
	Object.freeze({
		key:   "failure",
		label: TIER_LABELS.failure,
		get text()    { return localize(`${_I18N}.tiers.failure`); },
		// The same three fates the miss offers as buttons, so the preview and the choice read alike.
		get options() { return _FATES.map(f => f.label); },
	}),
]);

// "Refuse to go" forks one more time; both inserts are the same refusal, told differently.
const _refusalInsert = (slug, name) => Object.freeze({
	slug,
	name,
	get hint() { return localize(`${_I18N}.refusalHints.${slug}`); },
});
const _REFUSAL_INSERTS = Object.freeze([
	_refusalInsert("revenant", "Revenant"),
	_refusalInsert("ghost",    "Ghost"),
]);

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
const _taken = i18n => Object.freeze({
	get intro() { return localize(`${_I18N}.taken.${i18n}.intro`); },
	// `who` and `what` arrive escaped: the line is HTML.
	card: (who, what) => format(`${_I18N}.taken.${i18n}.card`, { who, what }),
	get next() { return localize(`${_I18N}.taken.${i18n}.next`); },
});
const _REFUSED = _taken("refused");

const _INSERT_TAKEN = {
	revenant: _REFUSED,
	ghost:    _REFUSED,
	// The Mark is the GM's to choose (thrall.json: "the GM will choose 1 Mark for you"), so its `next`
	// does not tell the player to take one.
	thrall:   _taken("thrall"),
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

// The window on THIS client holding each character's roll in progress, by actor id: the one that wrote (or
// took over) its marker, until the tier lands. A second window for the same character here (one closed while
// the dice were in the air, then opened again) follows that one instead of picking the roll up a second time.
const _HOLDERS = new Map();

// Why another owner may take a roll over, per deaths-door.js#deathsDoorRollWatch's `reason`.
const _ORPHANED = {
	away:  (who) => format(`${_I18N}.orphaned.away`, { name: who }),
	stale: (who) => format(`${_I18N}.orphaned.stale`, { name: who, minutes: Math.round(DEATHS_DOOR_ROLL_STALE_MS / 60000) }),
};

// Burn Brightly refused at the press: the XP is no longer there (spent elsewhere since the button drew).
const _noXpToBurn = () => localize("stonetop.specialMoves.burnBrightly.notEnoughXp");

// Who a roll is named for when the marker carries no name.
const _anotherPlayer = () => localize(`${_I18N}.anotherPlayer`);

// The notes above the ladder: a boost spent, `from` → `to`.
const _burnNote    = (from, to) => format(`${_I18N}.notes.burn`, { from, to });
const _giveAllNote = (from, to, spent) => (spent
	? format(`${_I18N}.notes.giveAll`, { label: IMPETUOUS_YOUTH.label, from, to, spent })
	: format(`${_I18N}.notes.giveAllNoCost`, { label: IMPETUOUS_YOUTH.label, from, to }));

/** _boostsLeft with nothing on offer. Frozen: it is handed out, never built on. */
const _NO_BOOSTS = Object.freeze({ burn: false, giveAll: false, plusOnes: false, mine: Object.freeze([]), any: false });

// The +1s a card took (roll-boosts.js), one note each: "+1 Diligence (Aeron).".
const _plusOneNotes = card => boostsOn(card).map(b => `${boostNote(b)}.`);

// What identifies one +1 the window offers, so a press finds the offer it was drawn for.
const _plusOneKey = offer => `${offer.source}:${offer.helper?.uuid ?? ""}`;

/**
 * The window's own +1 buttons, from the offers this user presses (roll-boosts.js#deathsDoorPlusOnes): labelled as
 * the card labels them, named for the helper when this user could press one source for two of them.
 */
function _plusOneButtons(offers = []) {
	return offers.map(offer => {
		const { label, tip } = boostButtonFace(offer, offers);
		return { key: _plusOneKey(offer), label, title: tip };
	});
}

/**
 * What a Death's Door card says was done to its roll after the dice, for a window that did not do it: the
 * Destined's bend (counted-tier.js#countedNote), Burn Brightly and giving it your all, read off the card's own
 * flags (the rolling window's notes live only in that window). `bend: false` leaves the bend out, for a window
 * that says it in its own words (_readLanded).
 */
function cardBoostNotes(card, total, { bend = true, plusOnes = true } = {}) {
	if (!card) return [];
	const notes = [];
	if (card.getFlag?.(SYSTEM_ID, "burnBrightly")) notes.push(localize(`${_I18N}.notes.burnOnCard`));
	const gave = card.getFlag?.(SYSTEM_ID, GAVE_IT_ALL_FLAG);
	if (gave) {
		const spent = GIVE_IT_ALL_COSTS.find(c => c.key === gave.cost)?.spent ?? gave.cost;
		notes.push(_giveAllNote(gave.from, gave.to, spent));
	}
	if (plusOnes) notes.push(..._plusOneNotes(card));
	const bent = bend ? countedNote(total, card.getFlag?.(SYSTEM_ID, ROLLED_FLAG) ?? null) : "";
	if (bent) notes.push(`${bent}.`);
	return notes;
}

/**
 * Hard to Kill's 7-9 trade, "mark a debility of your choice to regain 1 HP" (p.114): THE one, for this window's
 * result step and for the sheet's Death's Door card, which offers it once this window has gone (StonetopCharacter
 * Sheet#_onHardToKillTrade). One write for the debility, the hit point, the end of being out of the action and
 * the trade's latch (HARD_TO_KILL_TRADE_FLAG), and the table is told. Whether it was made.
 */
export async function tradeHardToKillDebility(character, key) {
	const name = character?.debilityMarkChoices?.find(d => d.key === key)?.name ?? key;
	const actor = character._actor ?? null;
	const latch = actor?.getFlag?.(SYSTEM_ID, HARD_TO_KILL_TRADE_FLAG)
		? Object.fromEntries([deletionEntry(`flags.${SYSTEM_ID}.${HARD_TO_KILL_TRADE_FLAG}`)]) : null;
	const ok = await character.markDebility(key, { hp: 1, moveName: HARD_TO_KILL, clearsDeathsDoor: true, alsoUpdate: latch });
	if (!ok) return false;
	await postDyingCard(actor, HARD_TO_KILL, `<p>${format(`${_I18N}.chat.hardToKill`, {
		name: escHtml(actor?.name ?? localize(`${_I18N}.theCharacter`)), debility: escHtml(name),
	})}</p>`);
	return true;
}

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

		// The tier that landed, once it has: the dice's, moved up a step for a Destined hero, or a 10+
		// taken without rolling (Never Gonna Keep Me Down). `_tierNote` says which of those it was.
		this._landed   = null;
		this._tierNote = "";

		// Burn Brightly and giving it your all, while the result step waits on them (see the class
		// header): the Door's card they rewrite, the Destined's shift the tier is read with, whether
		// each is spent (once apiece), what each did (said above the ladder), and whether the tier is
		// still unwritten. `_boosting` holds off a second press, and Accept, while one is in flight.
		this._rollMessage   = null;
		// The card's id when this client cannot read it (a private roll, taken over): the GM's client rewrites it.
		this._privateCardId = null;
		this._tierShift     = null;
		this._burned        = false;
		this._gaveAll       = false;
		this._boostNotes    = [];
		this._boostsPending = false;
		this._boosting      = false;
		this._settleOnBoostEnd = false;
		// A window shut while the dice were still in the air: its result is accepted as they land (see close()).
		this._settleOnRollEnd  = false;

		// The roll in progress, as every other owner's window sees it (deaths-door.js#DEATHS_DOOR_ROLLING_FLAG).
		// `_rollNonce` names the roll this window holds, `_claimed` is the marker it last wrote, and
		// `_markerWritten` whether that write landed: only a roll the others could see can be lost to them.
		this._rollNonce     = null;
		this._claimed       = null;
		this._markerWritten = false;
		// Someone else's roll this window is following (their marker, kept after it clears so the result can
		// say whose it was), and once it lands, `_spectator`: the result shown as theirs, with nothing on it to
		// act on. `_ignoredNonce` is an abandoned roll set aside here by "Take over", with nothing posted to take.
		this._watched      = null;
		this._spectator    = null;
		this._ignoredNonce = null;
		this._hooks        = null;
		this._staleTimer   = null;
		this._drawnWatchKey = null;

		// Reopened on an unresolved 6-: the roll is spent, so resume at the fates rather than
		// offering a fresh one. The GM asking "why do you refuse?" is exactly the pause that
		// sends a player back out of this dialog and into the conversation.
		this._step = this._fatePending ? "result" : "roll";   // "roll" | "result" | "fate" | "choices"
		// What the insert asks for once one is taken. Loaded on the way into the "choices" step
		// (it reaches the compendium), null everywhere else.
		this._choices = null;
		// Options held before this insert was taken, `{ [section]: slugs }`, that do not answer its
		// questions (buildPostDeathChoices' `carried`), and the words the step opens with when the insert
		// came from somewhere other than this window's own fates. Both set by openChoices.
		this._carried = {};
		this._takenIntro = null;
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
	 * Straight to the insert's questions, for an insert taken somewhere other than this window's fates:
	 * Undying's 6- that gives up the Revenant for the Ghost (UndeathDialog#_onAlternative). The same step,
	 * rail and rules as a 6- here, so a Ghost is asked for their first Consequence the one way every Ghost
	 * is. `carried` is what they held before, which does not answer it; `taken` names the `taken.*` words
	 * (languages/en.json) the step opens with: only their `intro`, since no fate card is posted from here.
	 */
	static async openChoices(character, onDone, { carried = {}, taken = null } = {}) {
		const dialog = new DeathsDoorDialog(character, onDone);
		dialog._step    = "choices";
		dialog._carried = carried ?? {};
		dialog._takenIntro = taken ? localize(`${_I18N}.taken.${taken}.intro`) : null;
		await dialog._refreshChoices();
		dialog.render(true);
		return dialog;
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
			title:     localize(`${_I18N}.title`),
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
		this._syncRoll();
		const before = this._captureScroll();
		await super._render(force, options);
		this._sizeForStep();
		this._restoreScroll(before);
		this._paintMood();
		this._listen();
		this._drawnWatchKey = this._watchKey();
		this._armStaleTimer();
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
		const key = this._landedTier();
		if (key === "success") return _MOODS.returned;
		if (key === "partial") return _MOODS.wavedOff;
		if (key === "failure") return _MOODS.door;
		return _MOODS.dusk;
	}

	/**
	 * The tier the result step is showing: the one latched when it landed (shifted for a Destined
	 * hero, or a 10+ with no dice at all), else the plain classification of the total.
	 */
	_landedTier() {
		if (this._landed) return this._landed;
		return this._rolledTotal == null ? null : classifyResult(this._rolledTotal).key;
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
		const key   = this._landedTier();
		// Someone else's roll on the table replaces every step with the waiting view (see _watchData).
		const watch = this._watchData();
		// A resumed 6- has no total left to classify but is still sitting on the miss. The waiting view's
		// ladder marks the tier their roll counts as so far.
		const landed = watch ? watch.tier : key ?? (this._fatePending ? "failure" : null);
		const boosts = this._boostOffers();

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

			isRoll:    !watch && this._step === "roll",
			isResult:  !watch && this._step === "result",
			isFate:    !watch && this._step === "fate",
			isChoices: !watch && this._step === "choices",

			// Another owner's roll, while it is on the table: who, and the result so far. No dice here.
			isWatching: !!watch,
			watch,
			// Their roll once it has landed (_showLanded): named as theirs, with nothing on it to act on.
			spectator: !!this._spectator,
			rolledBy:  this._spectator?.userName ?? "",

			// The insert's outstanding business, for the last step. Built in _refreshChoices
			// because it reads the compendium; null until an insert has been taken.
			choices:          choices,
			insertName:       this._choices?.name ?? "",
			// Told in the terms of the fate that was actually taken — see _INSERT_TAKEN.
			choicesIntro:     this._takenIntro ?? (_INSERT_TAKEN[this._choices?.slug] ?? _REFUSED).intro,
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
			// Nothing a tier does is offered while Burn Brightly or giving it your all may still move
			// it: the ladder shows where it stands, and the footer asks.
			isStrong:    !this._boostsPending && key === "success",
			isWeak:      !this._boostsPending && key === "partial",
			// A resumed 6- has no total to show but is still a miss awaiting its fate.
			isMiss:      !this._boostsPending && (key === "failure" || this._fatePending),
			boostsPending:   this._boostsPending,
			canBurnBrightly: this._boostsPending && boosts.burn,
			canGiveItAll:    this._boostsPending && boosts.giveAll,
			// The +1s anyone could still add (Diligence, Sanction, Many Hands, a Blessing): said above, and the
			// ones this user presses for their own characters drawn as buttons (_plusOneButtons).
			canPlusOne:      this._boostsPending && boosts.plusOnes,
			plusOneButtons:  this._boostsPending ? _plusOneButtons(boosts.mine) : [],
			burnBrightlyCost: BURN_BRIGHTLY_COST,
			// A private roll taken over with no GM connected: only the GM's client could change its card, so it
			// says why Accept is all there is.
			privateBoostsNote: this._boostsPending && boosts.needsGM ? localize(`${_I18N}.privateBoostsNeedGM`) : "",

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
			// Never Gonna Keep Me Down: the move that can skip the roll this session, or whether its one
			// use is already spent (said, so the missing button isn't a mystery).
			skipRollMove:   opts.skipRollMove ?? null,
			neverGonnaUsed: !!opts.neverGonnaUsed,
			neverGonnaName: NEVER_GONNA_KEEP_ME_DOWN,
			// Destined: who moves the tier up a step, said before the dice.
			tierShift:      opts.tierShift ?? null,
			// After it: how the tier came to be what it is, when it isn't simply the dice's.
			tierNote:       this._tierNote,

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
			markChips:  _markChips(),
			// The wound exists from the moment the 10+ lands (see _seedMark), so this reports that
			// it's already on the sheet rather than gating the input behind a "record" click. The
			// input stays open either way: describing the mark is editing the wound, not creating it.
			markSeeded: !!this._markWoundId,
			markText:   this._markText,
			restored:   !this._boostsPending && key === "success",

			// 7-9 — Hard to Kill's trade is the only way back to 1 HP on a weak hit, and taking
			// it is what ends being out of the action.
			hardToKill:      opts.hardToKill,
			// A move's "mark a debility", so Auspicious Birth's circle may stand in (debilityMarkChoices).
			debilityChoices: this._character?.debilityMarkChoices?.filter(d => !d.marked) ?? [],
			debilityTraded:  !!this._debilityTraded,
			outOfAction:     !this._boostsPending && key === "partial" && !this._debilityTraded,

			// 6-
			fates:          _FATES,
			refusalInserts: _REFUSAL_INSERTS,
			fateApplied:    !!this._fateApplied,
		};
	}

	activateListeners(html) {
		super.activateListeners(html);

		// Shift skips the pre-roll window, as it does on every other roll (RollDialog.js#promptRoll).
		html.find(".deaths-door-roll-btn").on("click", (ev) => this._onRoll({ shiftKey: !!ev.shiftKey }));
		html.find(".deaths-door-skip-roll-btn").on("click", () => this._onTakeTenPlus());
		html.find(".deaths-door-close-btn").on("click", () => this._onFinish());
		html.find(".deaths-door-cancel-btn").on("click", () => this.close());
		html.find(".deaths-door-accept-btn").on("click", () => this._onAcceptResult());
		html.find(".deaths-door-burn-btn").on("click", () => this._onBurnBrightly());
		html.find(".deaths-door-give-all-btn").on("click", () => this._onGiveItAll());
		html.find(".deaths-door-plus-one-btn").on("click", (ev) => this._onPlusOne(ev.currentTarget.dataset.plusOne ?? ""));
		html.find(".deaths-door-take-over-btn").on("click", () => this._onTakeOver());

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
	async _onRoll({ shiftKey = false } = {}) {
		if (this._rolling) return;
		this._rolling = true;
		let claimed = false;
		let roll = null;
		try {
			const actor = this._character?._actor ?? null;
			if (!actor) return;
			// A roll is already on the table, another owner's or one this window holds (this window had not
			// redrawn for it yet): that one stands.
			if (this._rollWatch().kind !== "none") { this.renderIfOpen(); return; }
			// The character is not at the Door any more (brought back up, or the Door settled elsewhere) while this
			// window still showed the dice. Checked here as well as by the GM's ruling, which a table with no GM
			// connected does not have.
			if (this._notAtTheDoor()) return;
			const { penalty, tierShift = null } = this._character.deathsDoorRollOptions();

			// The pre-roll window every other roll gets (the mode, when the table asks it each time, and the one-off
			// stepper), asked before the claim so backing out of it claims and rolls nothing. Absent `rollMode` in its
			// answer, the sheet's sticky selector decides (onDirectStatRoll).
			const prompted = await promptRoll({ title: _MOVE.name, shiftKey });
			if (!prompted) return;

			// Claimed (through the GM, when one is connected) and said on the actor before anything else moves, the
			// Battle Joy's end included, so no other window offers the dice while these are in the air. A claim
			// refused (another owner's press got there first) rolls nothing: this window waits on theirs.
			claimed = true;
			if (!(await this._claimRoll())) { this.renderIfOpen(); return; }

			// Rolling it is when they stop fighting, so a Heavy still in their Battle Joy (fighting on
			// at 0 HP with Unstoppable) comes out of it first, with no roll, and this roll takes their
			// debilities again (combat/battle-joy-offer.js#endBattleJoyUnrolled).
			await endBattleJoyUnrolled(actor);

			// The one path every direct roll takes (StonetopCharacter#onDirectStatRoll): the sticky mode or the
			// window's, ongoing, and what the next roll is owed, claimed and spent here. An Aid's advantage is the
			// book's own case: "If someone tries to save the dying PC ... they're Aiding the Death's Door roll"
			// (p.245). Rolling +CON exposes the roll to `miserable` there, like any other +CON roll; +nothing
			// touches no stat and so is untouched by debilities. Aimed at nobody, whatever is targeted on the map.
			// Unstoppable's penalty rides the stepper's one-off modifier.
			roll = await this._character.onDirectStatRoll(this._stat, {
				...prompted,
				situational: (Number(prompted.situational) || 0) + (Number(penalty) || 0),
				targets:     [],
				// The roll's nonce on its card, so a window picking the roll up finds it even when the marker
				// never got as far as naming it (the page went while the dice were still in the air).
				messageFlags: { [SYSTEM_ID]: { [DEATHS_DOOR_ROLL_FLAG]: this._rollNonce } },
				statValue:   this._stat ? undefined : 0,
				moveName:    _MOVE.name,
				noXpOnMiss:  true,
				// Destined: "treat a 6- on Death's Door as a 7-9, and a 7-9 as a 10+". The card reads its
				// tier the same way and names the background beside the result.
				...(tierShift ? { missCountsAsPartial: tierShift, partialCountsAsSuccess: tierShift } : {}),
				moveDescription: `<p>${_MOVE.trigger} ${format(`${_I18N}.roll.thenRoll`, { stat: this._stat ? "+CON" : "+nothing" })}</p>`,
				// " / " so the card's own pick-list formatter (formatOutcomeDetail) recognises the
				// "choose 1:" hinge and breaks the three fates onto bulleted lines instead of one
				// run-on. Safe despite the fates' own semicolons: the separator only treats a ";"
				// as one when a capitalised "OR" follows it.
				moveResults: Object.fromEntries(_TIERS.map(t => [t.key, {
					label: t.label,
					value: t.options ? `${t.text} ${t.options.join(" / ")}` : t.text,
				}])),
			});
			// No dice were thrown (the roll was refused on its way): the finally below gives the Door back.
			if (!roll) return;

			this._rolledTotal = roll.total;
			this._tierShift = tierShift;
			this._boostNotes = [];
			this._burned = false;
			this._gaveAll = false;
			this._readLanded();
			this._step = "result";
			// A fresh roll is a fresh brush with death: re-arm the per-result actions so a
			// re-roll can record its own outcome. The mark is pointedly NOT
			// re-armed — it's a wound on the sheet now, not a pending action, and re-arming it
			// would leave a re-rolled 10+ carrying two marks for one visit to the Door.
			this._debilityTraded = false;
			this._fateApplied = false;

			// Burn Brightly or giving it your all could still move it: wait on the player (see the
			// class header). Otherwise the tier lands now, exactly as it always has.
			this._rollMessage = messageOfRoll(roll);
			this._privateCardId = null;
			const left = this._boostsLeft();
			this._boostsPending = this._boostOffers(left).any;
			// The card, the total, the tier it counts as and what could still move it go on the marker the moment
			// the dice land, whatever follows: a window that has to take the roll over (one whose client was never
			// sent a private card included) accepts it from there rather than rolling it again.
			await this._noteRoll(left);
			if (!this._boostsPending) await this._land(this._landed);
			// Shut while the dice were in the air: accepted as it stands, as close() accepts a waiting result.
			else if (this._settleOnRollEnd) await this._settleBoosts();
			// Guarded: a 3D-dice roll and the tier's writes are several seconds of awaits, and a
			// window the player closed in the middle of them must not be forced back open over
			// whatever they moved on to. The outcome is already on the sheet either way.
			this.renderIfOpen();
		} finally {
			this._rolling = false;
			this._settleOnRollEnd = false;
			// Nothing reached the table (a write or the roll itself failed first): the Door is still to face.
			if (claimed && !roll) await this._releaseRoll({ unlessPosted: true });
		}
	}

	/**
	 * Never Gonna Keep Me Down: "Once per session, when you are at Death's Door, don't roll. You get a
	 * 10+." Offered only while the move is learned and its circle clear (deathsDoorRollOptions), and
	 * asked again here, so a second window or a quick second click can't spend it twice. The circle is
	 * marked first, then the 10+ lands exactly as a rolled one does, and the table is told which move
	 * did it. End of Session clears the circle (deaths-door-actor.js#resetNeverGonnaKeepMeDown).
	 */
	async _onTakeTenPlus() {
		if (this._rolling) return;
		this._rolling = true;
		let claimed = false;
		try {
			const actor = this._character?._actor ?? null;
			if (!actor) return;
			const { skipRollMove = null } = this._character.deathsDoorRollOptions?.() ?? {};
			if (!skipRollMove) return;
			// No dice, but the Door is being faced here all the same: said first, as a roll says it (_onRoll).
			if (this._rollWatch().kind !== "none") { this.renderIfOpen(); return; }
			if (this._notAtTheDoor()) return;
			claimed = true;
			if (!(await this._claimRoll())) { this.renderIfOpen(); return; }
			// Facing the Door is when they stop fighting, with or without the dice (see _onRoll).
			await endBattleJoyUnrolled(actor);
			await this._character.moveResources?.setUses?.(skipRollMove, 1, { stonetopMove: skipRollMove });
			await this._post(skipRollMove, `<p>${format(`${_I18N}.chat.skipped`, { name: escHtml(this._actorName) })}</p>
				<p class="stonetop-dying-trigger">${localize(`${_I18N}.chat.skippedRule`)}</p>`);

			this._rolledTotal = null;
			this._rollMessage = null;
			this._privateCardId = null;
			this._landed = "success";
			this._tierNote = format(`${_I18N}.notes.skipped`, { move: skipRollMove, tier: TIER_LABELS.success });
			this._step = "result";
			this._debilityTraded = false;
			this._fateApplied = false;
			// The 10+ goes on the marker before it lands, as the dice's result does (_onRoll): the move's one use is
			// spent, so a window taking this over accepts the 10+ rather than rolling.
			await this._noteRoll();
			await this._land("success");
			this.renderIfOpen();
		} finally {
			this._rolling = false;
			this._settleOnRollEnd = false;
			// Stopped short of the 10+ (a write failed): nothing landed, so nothing is in progress either.
			// A no-op once it has landed, which releases the roll itself.
			if (claimed) await this._releaseRoll();
		}
	}

	/**
	 * Read the tier off the current total: the dice's, moved up a step for a Destined hero, and the note
	 * that says how it came to be that, when it isn't simply the dice's (each boost spent, then the shift).
	 */
	_readLanded() {
		const total  = this._rolledTotal;
		const rolled = classifyResult(total).key;
		const bends  = !!this._tierShift;
		this._landed = outcomeTier(countedTier(total, { missCountsAsPartial: bends, partialCountsAsSuccess: bends }));
		const shifted = this._landed === rolled ? ""
			: format(`${_I18N}.notes.shifted`, { shift: this._tierShift, from: TIER_LABELS[rolled], to: TIER_LABELS[this._landed] });
		// The +1s are read off the card, whoever pressed them: a Judge's player presses theirs on the card itself.
		this._tierNote = [...this._boostNotes, ..._plusOneNotes(this._rollMessage), shifted].filter(Boolean).join(" ");
	}

	/**
	 * What could still move the tier: Burn Brightly (once, while affordable: burn-brightly.js, so a Driven
	 * hero needs only the 2 XP) and Impetuous Youth's "give it your all" (once, for the hero who took it).
	 * Neither on a 10+: it is this move's top, and a 12+ says nothing more at the Door, so either would be
	 * paid for nothing. Neither without the Door's card to rewrite (this client's copy, or the GM's of a
	 * private card this client was never sent: _privateCardId), or the rewrite functions stonetop.js
	 * registers (utils/roll-rewrite.js): a lift the card could not show would be a second story of the roll.
	 *
	 * And the roll-card +1s (`plusOnes`): Diligence, Sanction, Many Hands and a Blessing (roll-boosts.js), while
	 * anyone at all could still add one, below a 10+ too. The Door is a roll like any other, and Diligence is spent
	 * "at any time to add +1 to a roll that you or a fellow player just made" (Book I p.118), so the result waits
	 * for them as it waits for Burn Brightly (the user's ruling). `mine` are the ones this user presses for their
	 * own characters, drawn here; everyone else's are on the card. Only on a card this client has: a private
	 * roll's card is the GM's to show.
	 */
	_boostsLeft() {
		const actor = this._character?._actor ?? null;
		if (!actor || !(this._rollMessage || this._privateCardId) || !rollRewrite() || this._rolledTotal == null) return _NO_BOOSTS;
		const { burn, giveAll } = deathsDoorBoostsLeft(actor, this._landed, {
			burned:  this._burned,
			gaveAll: this._gaveAll || !!this._rollMessage?.getFlag?.(SYSTEM_ID, GAVE_IT_ALL_FLAG),
		});
		const plus = this._rollMessage && this._landed !== "success"
			? deathsDoorPlusOnes(this._rollMessage, actor)
			: { any: false, mine: [] };
		return { burn, giveAll, plusOnes: plus.any, mine: plus.mine, any: burn || giveAll || plus.any };
	}

	/**
	 * Where a boost on the Door's card is written (utils/roll-card-writer.js): `local` here, `relay` by the GM's
	 * client (_boostViaGM), which writes every player's rewrite of a card while a GM is connected, and a private
	 * card this client was never sent at any time. Null when neither can: no GM, and a card this client may not write.
	 */
	_boostRoute() {
		if (!this._rollMessage) return globalThis.game?.users?.activeGM ? "relay" : null;
		return rollCardRoute(this._rollMessage);
	}

	/**
	 * The boosts that can be pressed here, now: those left (_boostsLeft), while something can rewrite the card
	 * (_boostRoute). With nothing that can, none can be, and `needsGM` says that is why. `left` is a reading of
	 * _boostsLeft the caller already made, which walks every character in the world for the +1s.
	 */
	_boostOffers(left = this._boostsLeft()) {
		if (left.any && !this._boostRoute()) return { ..._NO_BOOSTS, needsGM: true };
		return { ...left, needsGM: false };
	}

	/**
	 * Burn Brightly on the Door's roll: the card path's spend (deaths-door-relay.js#burnBrightlyOnDoorCard), from
	 * here, or from the GM's client when that is the card's writer (_boostRoute). The tier is then read again off
	 * the new total.
	 */
	async _onBurnBrightly() {
		if (this._boosting || !this._boostsPending || !this._boostOffers().burn) return;
		this._boosting = true;
		try {
			const from = this._rolledTotal;
			const note = to => _burnNote(from, to);
			if (this._boostRoute() === "relay") return await this._boostViaGM("burn", { note });
			const burned = await burnBrightlyOnDoorCard(this._rollMessage, this._character._actor, rollRewrite(), {
				// Latched as the XP goes, so a rewrite that fails after it can't take the 2 XP a second time.
				onSpent: () => { this._burned = true; },
			});
			if (!burned) {
				ui.notifications?.warn?.(_noXpToBurn());
				return;
			}
			this._boostNotes.push(note(this._cardTotal()));
			await this._afterBoost();
		} catch (err) {
			console.error("Stonetop | Error burning brightly at Death's Door:", err);
		} finally {
			await this._endBoost();
		}
	}

	/**
	 * Impetuous Youth at the Door: asks the cost with the card's own picker (closing it gives nothing and
	 * costs nothing), then lifts the card to the next floor of the tier it COUNTS as (so a Destined 6-, a 7-9
	 * already, goes to a 10+), records the cost on it and rolls "you get hurt"'s 2d4 at the hero, all through
	 * impetuous-youth.js#giveItAllAtDeathsDoor (on the GM's client, when that is the card's writer: _boostRoute).
	 * The tier is then read again off the new total.
	 */
	async _onGiveItAll() {
		if (this._boosting || !this._boostsPending || !this._boostOffers().giveAll) return;
		this._boosting = true;
		try {
			const actor = this._character._actor;
			const cost  = await askGiveItAllCost(actor);
			if (!cost) return;
			const from  = this._rolledTotal;
			const spent = GIVE_IT_ALL_COSTS.find(c => c.key === cost)?.spent ?? cost;
			const note  = to => _giveAllNote(from, to, spent);
			if (this._boostRoute() === "relay") return await this._boostViaGM("giveAll", { cost, note });
			if (!(await giveItAllAtDeathsDoor(this._rollMessage, actor, cost, rollRewrite()))) return;
			this._gaveAll = true;
			this._boostNotes.push(note(this._cardTotal()));
			await this._afterBoost();
		} catch (err) {
			console.error("Stonetop | Error giving it their all at Death's Door:", err);
		} finally {
			await this._endBoost();
		}
	}

	/**
	 * One of the roll-card +1s (Diligence, Sanction, Many Hands, a Blessing), pressed here for one of this user's
	 * own characters: the card's own press (roll-boosts.js#pressBoost), on this client or through the GM's, then
	 * the tier read again off the card (_onCardRewritten). One another player presses on the card is read the
	 * same way as the card changes (_listen).
	 */
	async _onPlusOne(key) {
		if (this._boosting || !this._boostsPending || !this._rollMessage) return;
		const offer = this._boostOffers().mine.find(o => _plusOneKey(o) === key);
		if (!offer) return;
		this._boosting = true;
		try {
			const taken = await pressBoost(this._rollMessage, offer, rollRewrite(), { route: this._boostRoute() });
			if (!taken) {
				ui.notifications?.warn?.(localize("stonetop.rollBoosts.refused"));
				return;
			}
			await this._onCardRewritten();
		} catch (err) {
			console.error("Stonetop | Error adding +1 at Death's Door:", err);
		} finally {
			await this._endBoost();
		}
	}

	/**
	 * The Door's card shows a total this window has not read (a +1 pressed on it, here or by another player, or
	 * written by the GM's client): the tier is read again and settled once nothing is left to offer, exactly as
	 * after a boost of the window's own (_afterBoost). Nothing while the result has already landed. Every boost
	 * only ever raises the total, so a card reading LOWER than this window is only a copy that has not yet heard a
	 * rewrite the GM's client answered (_boostViaGM), and is left alone.
	 */
	async _onCardRewritten() {
		if (!this._boostsPending || !this._rollMessage) return false;
		const total = this._cardTotal();
		if (total == null || total <= (Number(this._rolledTotal) || 0)) return false;
		await this._afterBoost(null, total);
		return true;
	}

	/**
	 * A boost the GM's client writes (_boostRoute): it spends it and rewrites the card
	 * (deaths-door-relay.js#handleDeathsDoorBoostQuery), and this window carries on from the total and the counted
	 * tier it answers, exactly as from its own rewrite: this client's copy of a card it can read may not have heard
	 * the rewrite yet. A refusal changes nothing here but, when the GM's client says the boost is gone from the card
	 * all the same, the button.
	 */
	async _boostViaGM(boost, { cost = null, note }) {
		const answer = await askDeathsDoorBoost(this._character?._actor, {
			nonce: this._rollNonce, messageId: this._rollMessage?.id ?? this._privateCardId, boost, cost,
		});
		if (answer?.applied || answer?.spent) {
			if (boost === "burn") this._burned = true;
			else this._gaveAll = true;
		}
		if (!answer?.applied) {
			ui.notifications?.warn?.(answer?.reason === "xp" ? _noXpToBurn() : localize(`${_I18N}.boostRelayFailed`));
			return;
		}
		this._rolledTotal = answer.total;
		if (answer.tierShift) this._tierShift = answer.tierShift;
		this._boostNotes.push(note(answer.total));
		await this._afterBoost(answer.tier ?? null, answer.total);
	}

	/** The Door's card's total now, which is what a boost moved. */
	_cardTotal() {
		return this._rollMessage?.rolls?.at(0)?.total ?? this._rolledTotal;
	}

	/**
	 * Read the tier again after a boost, and settle it once there is nothing left that could move it. `counted` and
	 * `total` are the GM's reading of a card it rewrote (_boostViaGM), which stand over this window's. Nothing left
	 * means nothing left to buy: a private roll's boosts waiting on a GM to come back still wait.
	 */
	async _afterBoost(counted = null, total = null) {
		this._rolledTotal = total ?? this._cardTotal();
		this._readLanded();
		if (counted) this._landed = counted;
		const left = this._boostsLeft();
		// The moved total goes on the marker (and keeps it from going stale while they choose), then lands if it must.
		await this._noteRoll(left);
		const settles = !left.any;
		if (settles) await this._settleBoosts();
	}

	/** A boost is done: let the next press through, and settle for a window closed while it ran. */
	async _endBoost() {
		this._boosting = false;
		// A +1 whose write reached this client while the boost ran (the GM's client wrote it): read now, since the
		// card's update was let past while this window was busy (_listen).
		try {
			await this._onCardRewritten();
		} catch (err) {
			console.error("Stonetop | Error reading Death's Door's card again:", err);
		}
		if (this._settleOnBoostEnd && this._boostsPending) await this._settleBoosts();
		this.renderIfOpen();
	}

	/** "Accept this result": the tier as it stands now lands on the sheet. */
	async _onAcceptResult() {
		if (this._boosting || !this._boostsPending) return;
		await this._settleBoosts();
		this.renderIfOpen();
	}

	/** Write the tier the result step has been waiting on. Once: the latch drops before the writes. */
	async _settleBoosts() {
		if (!this._boostsPending) return;
		this._boostsPending = false;
		this._settleOnBoostEnd = false;
		await this._land(this._landed);
	}

	// ── The roll in progress, as every other owner's window sees it ──────────────
	// This window is one client's, and the character stays `dying` until the tier lands: through the dice,
	// and through the Burn Brightly / "give it your all" pause. So the roll is said on the actor before the
	// dice go (deaths-door.js#DEATHS_DOOR_ROLLING_FLAG), and any other window on the character waits on it
	// instead of offering dice of its own; one whose roller has gone offers to take it over. Claiming the roll (a
	// fresh one, or one taken over) goes through the primary GM's client, which rules on one claim at a time
	// (deaths-door-relay.js); every other write goes straight to the actor, like every other write this window
	// makes: only an owner can open it.

	/** What this window should make of the character's roll in progress, right now (deaths-door.js#deathsDoorRollWatch). */
	_rollWatch() {
		const actor  = this._character?._actor ?? null;
		const marker = deathsDoorRollMarker(actor);
		const here   = actor?.id ? _HOLDERS.get(actor.id) : null;
		return deathsDoorRollWatch({
			marker,
			state:        this._character?.deathsDoorState ?? null,
			me:           game.user?.id ?? null,
			ownNonce:     this._rollNonce,
			ignoredNonce: this._ignoredNonce,
			heldHere:     !!here && here !== this,
			holderActive: !!(marker && game.users?.get?.(marker.userId)?.active),
			now:          deathsDoorRollClock(),
		});
	}

	/**
	 * Claim the roll for this window, before anything else moves. Whether it may go ahead.
	 *
	 * Asked of the primary GM's client when one is connected (this client's own handler, when it is that GM):
	 * it rules on one claim at a time and writes the marker for the one it grants, so of two owners pressing Roll
	 * inside one round trip exactly one rolls, and the other is told who has it (_claimRefused).
	 *
	 * With no GM to rule (none connected, or none that answered), the marker is written here and read back once
	 * the write resolves: a claim that landed over this one's is someone else's roll now. Only this case keeps the
	 * narrow race the GM closes: two such writes inside one round trip can both roll, though only one of them
	 * lands a tier (_land lands nothing for a roll the marker no longer names). A marker that cannot be written
	 * costs the other windows their warning and never this roll: they offer what they always offered.
	 */
	async _claimRoll() {
		const actor = this._character?._actor ?? null;
		const claim = {
			userId: game.user?.id ?? null, userName: game.user?.name ?? "", at: deathsDoorRollClock(),
			nonce: foundry.utils.randomID(), messageId: null, total: null, tier: null, boosts: null,
		};
		// Held here from the start, so a second window on this client (one reopened meanwhile) follows this one.
		this._hold(claim, false);
		const ruling = await askDeathsDoorClaim(actor, { nonce: claim.nonce });
		if (ruling && !ruling.granted) {
			this._dropHold();
			return this._claimRefused(ruling.holder);
		}
		if (ruling) {
			this._hold(ruling.marker ?? claim, true);
			return true;
		}
		try {
			this._markerWritten = await setDeathsDoorRollMarker(actor, claim);
		} catch (err) {
			console.error("Stonetop | could not say the Death's Door roll is under way", err);
		}
		if (!this._lostRoll()) return true;
		const holder = deathsDoorRollMarker(actor);
		this._dropHold();
		return this._claimRefused(holder);
	}

	/** Hold roll `marker` here: this window's to land, and the one any other window here follows. */
	_hold(marker, written) {
		const id = this._character?._actor?.id;
		this._rollNonce     = marker.nonce;
		this._claimed       = marker;
		this._markerWritten = written;
		if (id) _HOLDERS.set(id, this);
	}

	/**
	 * A claim that was not this window's to make: another owner's roll stands (followed here, the waiting view,
	 * as a redraw in time would have shown it), or the Door was settled before the claim arrived. Nothing is
	 * rolled; the player is told why. False, for the caller to stop on.
	 */
	_claimRefused(holder) {
		const me = game.user?.id ?? null;
		if (holder) {
			this._watched   = holder;
			this._spectator = null;
			// Set aside here as nothing posted (Take over and roll), and found posted after all: back to take over.
			if (this._ignoredNonce === holder.nonce) this._ignoredNonce = null;
		}
		if (holder?.userId !== me) {
			ui.notifications?.info?.(holder
				? format(`${_I18N}.claimHeld`, { name: holder.userName || _anotherPlayer(), actor: this._actorName })
				: format(`${_I18N}.claimSettled`, { actor: this._actorName }));
		}
		return false;
	}

	/**
	 * The dice are down, or a boost moved them, or a 10+ was taken without them: the card, the total, the tier it
	 * counts as and the boosts still on offer, for the other windows (and for one that takes the roll over).
	 * `known` is the caller's own reading of _boostsLeft, made a moment before, so it is not walked again.
	 */
	async _noteRoll(known = null) {
		if (!this._markerWritten || this._lostRoll()) return;
		const left = this._boostsPending ? (known ?? this._boostsLeft()) : null;
		this._claimed = {
			...this._claimed,
			at:        deathsDoorRollClock(),
			messageId: this._rollMessage?.id ?? this._claimed?.messageId ?? null,
			total:     this._rolledTotal ?? null,
			tier:      this._landed ?? null,
			boosts:    DEATHS_DOOR_BOOSTS.filter(key => left?.[key]),
		};
		try {
			await setDeathsDoorRollMarker(this._character?._actor, this._claimed);
		} catch (err) {
			console.error("Stonetop | could not update the Death's Door roll under way", err);
		}
	}

	/**
	 * Whether the roll this window holds has been taken out of its hands: over to another owner (their name on
	 * the marker now), or ended without it (the marker gone: landed elsewhere, or the character brought back up
	 * meanwhile). Only a roll whose marker was written can be lost; one nobody else could see stays this window's.
	 */
	_lostRoll() {
		if (!this._markerWritten || !this._rollNonce) return false;
		const marker = deathsDoorRollMarker(this._character?._actor);
		return marker?.nonce !== this._rollNonce || marker?.userId !== game.user?.id;
	}

	/**
	 * Land the tier and end the roll in progress with it. Every way a tier lands comes through here: the dice
	 * with nothing to wait on, Accept, a boost that leaves nothing more to offer, a window shut on the result,
	 * Never Gonna Keep Me Down's 10+. A roll no longer this window's lands nothing (_yieldRoll).
	 */
	async _land(key) {
		// Brought back up (or settled elsewhere) while the dice were in the air: a roll whose marker never got
		// written, or a table with no GM to clear it, would otherwise land a tier on someone no longer dying.
		if (this._lostRoll() || this._character?.deathsDoorState !== DEATHS_DOOR_STATE.DYING) return this._yieldRoll();
		await this._applyTier(key);
		await this._releaseRoll();
	}

	/**
	 * Whether this window's character has left the Door since it drew the dice: healed above 0 HP, or the Door
	 * settled from another window. Says so and redraws when it has. The GM's claim ruling refuses such a roll
	 * too (deaths-door.js#deathsDoorClaimRuling), but a table with no GM connected has no ruling, so the window
	 * asks for itself before anything is written.
	 */
	_notAtTheDoor() {
		if (this._character?.deathsDoorState === DEATHS_DOOR_STATE.DYING) return false;
		ui.notifications?.info?.(format(`${_I18N}.claimSettled`, { actor: this._actorName }));
		this.renderIfOpen();
		return true;
	}

	/** Stop holding the roll here. The marker is left alone: _releaseRoll clears it, _yieldRoll leaves it to its new holder. */
	_dropHold() {
		const id = this._character?._actor?.id;
		if (id && _HOLDERS.get(id) === this) _HOLDERS.delete(id);
		this._rollNonce = null;
		this._markerWritten = false;
	}

	/**
	 * The roll is over: stop holding it, and clear its marker so every other window moves on. `unlessPosted`
	 * keeps the marker when the roll's card reached the table after all (a failure after the dice): that roll is
	 * spent, and the marker is what lets this user, or whoever takes it over, accept it rather than roll again.
	 */
	async _releaseRoll({ unlessPosted = false } = {}) {
		const nonce = this._rollNonce;
		if (!nonce) return;
		const written = this._markerWritten;
		const messageId = this._rollMessage?.id ?? this._claimed?.messageId ?? null;
		this._dropHold();
		if (!written) return;
		if (unlessPosted && deathsDoorRollCard({ nonce, messageId })) return;
		try {
			await clearDeathsDoorRollMarker(this._character?._actor, nonce);
		} catch (err) {
			console.error("Stonetop | could not clear the Death's Door roll under way", err);
		}
	}

	/**
	 * The roll went on without this window (another owner took it over, or it ended elsewhere): land nothing,
	 * say so, and follow whoever has it, or show how it ended.
	 */
	_yieldRoll() {
		const marker = deathsDoorRollMarker(this._character?._actor);
		this._watched = marker ?? { ...this._claimed, userName: "" };
		this._spectator = null;
		this._dropHold();
		this._boostsPending = false;
		this._step = "roll";
		ui.notifications?.info?.(marker
			? format(`${_I18N}.yieldTaken`, { name: marker.userName || _anotherPlayer(), actor: this._actorName })
			: format(`${_I18N}.yieldSettled`, { actor: this._actorName }));
	}

	/**
	 * Bring the window in line with the roll before it draws. Someone else's roll is followed; this user's own,
	 * with no window here holding it (a reload mid-roll), is picked back up where it was; and a followed roll
	 * that has ended either lands here as theirs (the state moved) or, let go of without landing, gives the
	 * roll step back.
	 */
	_syncRoll() {
		const watch = this._rollWatch();
		if (watch.kind === "resume") return this._resumeRoll(watch.marker);
		if (watch.kind === "watch" || watch.kind === "orphaned") {
			this._watched   = watch.marker;
			this._spectator = null;
			return;
		}
		if (watch.kind !== "none" || !this._watched || this._spectator) return;
		if (this._character?.deathsDoorState === DEATHS_DOOR_STATE.DYING) this._watched = null;
		else this._showLanded();
	}

	/** This user's own roll, from a window that is gone: waiting again if it reached the table, else set aside. */
	_resumeRoll(marker) {
		const card = deathsDoorRollCard(marker);
		if (deathsDoorRollPosted(marker, card)) return this._adoptRoll(marker, card);
		// The page went before anything was posted: there is no roll to resume, and the marker only stands in the way.
		this._ignoredNonce = marker.nonce;
		clearDeathsDoorRollMarker(this._character?._actor, marker.nonce)
			.catch(err => console.error("Stonetop | could not clear an abandoned Death's Door roll", err));
	}

	/**
	 * Hold a roll that is already on the table: this user's own after a reload, or one taken over from an owner
	 * who has gone. The card is read as it stands (its total, the tier it COUNTS as, what was spent on it), and
	 * the window waits on it exactly as it waits after its own dice: nothing is rolled again, and "Accept this
	 * result" (or a boost still on offer) is what lands it. A card this client was never sent (a private roll)
	 * leaves the marker's own total, tier and boosts still on offer; those boosts are spent through the GM's
	 * client, which has the card (_boostViaGM), and with no GM connected Accept is all it offers.
	 */
	_adoptRoll(marker, card = null, written = true) {
		this._hold(marker, written);
		this._watched = this._spectator = this._ignoredNonce = null;

		const total  = card?.rolls?.at?.(0)?.total ?? marker.total;
		const left   = Array.isArray(marker.boosts) ? marker.boosts : null;
		this._rollMessage   = card ?? null;
		this._privateCardId = card ? null : marker.messageId ?? null;
		this._rolledTotal   = total;
		this._tierShift     = deathsDoorCardTierShift(card);
		// Spent is read off the card where there is one, else off what the marker still lists as on offer.
		this._burned  = card ? !!card.getFlag?.(SYSTEM_ID, "burnBrightly") : !!left && !left.includes("burn");
		this._gaveAll = card ? !!card.getFlag?.(SYSTEM_ID, GAVE_IT_ALL_FLAG) : !!left && !left.includes("giveAll");
		// Not its +1s: _readLanded reads those off the card itself.
		this._boostNotes  = cardBoostNotes(card, total, { bend: false, plusOnes: false });
		this._readLanded();
		// The card's own reading of the tier it counts as (the Destined's bends are stamped on it), where there is one.
		if (card) this._landed = deathsDoorCardTier(card, total);
		else if (marker.tier) this._landed = marker.tier;
		this._step = "result";
		this._debilityTraded = false;
		this._fateApplied = false;
		// Nothing has landed, whatever is still on offer: the footer asks.
		this._boostsPending = true;
	}

	/**
	 * The followed roll has landed: show it as theirs. The tier is read off the character (the write it made is
	 * the record), the total and what was spent on it off the card; and nothing on it is this window's to act
	 * on: the mark is theirs to describe, the Hard to Kill trade and a 6-'s fate theirs to choose.
	 */
	_showLanded() {
		const marker = this._watched;
		const card   = deathsDoorRollCard(marker);
		const total  = card?.rolls?.at?.(0)?.total ?? marker.total ?? null;
		const state  = this._character?.deathsDoorState ?? null;
		// A 6- is read first: one whose fate was an insert leaves them out of the action too, with the insert on.
		const missed = state === DEATHS_DOOR_STATE.FATE_PENDING || state === DEATHS_DOOR_STATE.DEAD
			|| this._character?.zeroHpMove?.dialog === false;
		// Otherwise the tier the roll counted as: its card's, which a boost moved last, else its marker's as this
		// window last saw it. A 7-9 traded back to 1 HP (Hard to Kill) leaves no state to read it from, and neither
		// does a character brought back up mid-roll.
		const counted = (card && total != null ? deathsDoorCardTier(card, total) : null) ?? marker.tier ?? null;
		const landed = missed ? "failure" : state === DEATHS_DOOR_STATE.OUT_OF_ACTION ? "partial" : counted;
		// Nothing landed at all (they were brought back up before the dice did): no result to show as theirs.
		if (!landed) {
			this._watched = null;
			return;
		}
		this._spectator     = { userName: marker.userName || _anotherPlayer() };
		this._rolledTotal   = total;
		this._rollMessage   = null;
		this._boostsPending = false;
		this._landed   = landed;
		this._tierNote = cardBoostNotes(card, total).join(" ");
		this._step     = "result";
	}

	/**
	 * The waiting view, while another owner's roll is on the table: who is rolling, and once their dice are down
	 * the result so far (the tier it counts as, and what was spent on it). Null for a window with no such roll.
	 */
	_watchData(watch = this._rollWatch()) {
		if (watch.kind !== "watch" && watch.kind !== "orphaned") return null;
		const marker = watch.marker;
		const card   = this._watchedCard(watch);
		const total  = card?.rolls?.at?.(0)?.total ?? marker.total ?? null;
		const tier   = card && total != null ? deathsDoorCardTier(card, total) : marker.tier ?? null;
		const who    = marker.userName || _anotherPlayer();
		const orphaned = watch.kind === "orphaned";
		return {
			userName:  who,
			actorName: this._actorName,
			rolled:    total != null,
			total,
			tier,
			notes:     cardBoostNotes(card, total).join(" "),
			canTakeOver:     orphaned,
			// Taking over a roll that reached the table accepts it; one that never did is rolled afresh.
			takeOverAccepts: orphaned && deathsDoorRollPosted(marker, card),
			whyTakeOver:     orphaned ? _ORPHANED[watch.reason]?.(who) ?? "" : "",
		};
	}

	/**
	 * The followed roll's card. By name only, while the roll is live: the marker names it once the roller's dice
	 * are down, so this window never gives away a total their dice are still showing. By its nonce too for a roll
	 * left orphaned, whose marker may never have got that far.
	 */
	_watchedCard(watch) {
		if (watch.kind === "orphaned") return deathsDoorRollCard(watch.marker);
		return watch.marker?.messageId ? deathsDoorRollCard(watch.marker) : null;
	}

	/**
	 * What this window's following of the roll is drawn from, as one comparable string: a redraw is owed only
	 * when it changes. The window's own roll is one key whatever its marker says (the window redraws itself for
	 * that), and a window with nothing to follow ignores the character's other writes, as it always has.
	 */
	_watchKey() {
		const watch = this._rollWatch();
		if (watch.kind === "watch" || watch.kind === "orphaned") return JSON.stringify(this._watchData(watch));
		if (watch.kind === "resume") return `resume:${watch.marker.nonce}`;
		if (watch.kind === "none" && this._watched && !this._spectator) return `ended:${this._character?.deathsDoorState ?? ""}`;
		// A private roll held here: its boosts come and go with the GM (_boostOffers), so a GM arriving or leaving redraws.
		if (watch.kind === "own" && this._privateCardId) return `own:${!!globalThis.game?.users?.activeGM}`;
		return watch.kind;
	}

	_redrawIfWatchChanged() {
		if (!this.rendered || this._watchKey() === this._drawnWatchKey) return;
		this.render(false);
	}

	/**
	 * Follow the character while the window is open: its marker and state (`updateActor`), the roll's card as a
	 * boost rewrites it (`updateChatMessage`), and who is still in the game (`userConnected`), which is what
	 * turns a live roll into one that can be taken over.
	 */
	_listen() {
		const actorId = this._character?._actor?.id;
		if (this._hooks || !actorId || typeof Hooks?.on !== "function") return;
		const redraw = () => this._redrawIfWatchChanged();
		this._hooks = [
			["updateActor",       Hooks.on("updateActor", actor => { if (actor?.id === actorId) redraw(); })],
			["updateChatMessage", Hooks.on("updateChatMessage", message => {
				// This window's own card, raised by a +1 pressed on it (another player's Diligence, say): the tier is
				// read again. Not while a boost of its own runs; _endBoost catches up on what it let past.
				if (message?.id && message.id === this._rollMessage?.id && this._boostsPending && !this._boosting) {
					// A write that raised nothing (a latch, a copy catching up) redraws only as any other would.
					this._onCardRewritten()
						.then(moved => (moved ? this.renderIfOpen() : redraw()))
						.catch(err => console.error("Stonetop | Error reading Death's Door's card again:", err));
					return;
				}
				if (message?.getFlag?.(SYSTEM_ID, DEATHS_DOOR_ROLL_FLAG)) redraw();
			})],
			["userConnected",     Hooks.on("userConnected", redraw)],
		];
	}

	_unlisten() {
		for (const [hook, id] of this._hooks ?? []) if (id != null) Hooks.off?.(hook, id);
		this._hooks = null;
		clearTimeout(this._staleTimer);
		this._staleTimer = null;
	}

	/** A live roll goes stale on the clock, with no write to say so: redraw when it does, so Take over appears. */
	_armStaleTimer() {
		clearTimeout(this._staleTimer);
		this._staleTimer = null;
		const watch = this._rollWatch();
		if (watch.kind !== "watch" || !this.rendered) return;
		const wait = (Number(watch.marker.at) || 0) + DEATHS_DOOR_ROLL_STALE_MS - deathsDoorRollClock() + 1000;
		if (wait > 0) this._staleTimer = setTimeout(() => this._redrawIfWatchChanged(), Math.min(wait, DEATHS_DOOR_ROLL_STALE_MS + 1000));
	}

	/**
	 * "Take over": pick up a roll its owner has left behind (deaths-door.js#deathsDoorRollWatch's "orphaned").
	 * One that reached the table is adopted as it stands, under this user's name: nothing is rolled again, and
	 * the window waits on it for "Accept this result". One that never did is set aside here, and this window
	 * offers the dice (its own claim then replaces the abandoned one).
	 *
	 * Claimed as a roll is (_claimRoll): through the primary GM's client, which decides whether the roll is still
	 * nobody's to finish (another owner may have taken it first, or its roller come back) and hands over what it can
	 * see of it, a private card's included. With no GM to rule, written here and read back.
	 */
	async _onTakeOver() {
		if (this._rolling || this._boosting) return;
		const watch = this._rollWatch();
		if (watch.kind !== "orphaned") return this.renderIfOpen();
		const marker = watch.marker;
		const card   = deathsDoorRollCard(marker);
		if (!deathsDoorRollPosted(marker, card)) {
			this._ignoredNonce = marker.nonce;
			this._watched = null;
			return this.renderIfOpen();
		}
		this._rolling = true;
		try {
			const actor = this._character?._actor ?? null;
			// The name on the marker is what stands every other window down, the one who left included.
			const taken = {
				...marker, userId: game.user?.id ?? null, userName: game.user?.name ?? "", at: deathsDoorRollClock(),
				messageId: card?.id ?? marker.messageId ?? null,
			};
			const ruling = await askDeathsDoorClaim(actor, { nonce: marker.nonce, takeOver: true });
			if (ruling && !ruling.granted) {
				this._claimRefused(ruling.holder);
				return this.renderIfOpen();
			}
			let written = !!ruling;
			if (!ruling) {
				written = await setDeathsDoorRollMarker(actor, taken);
				const now = deathsDoorRollMarker(actor);
				if (written && (now?.nonce !== taken.nonce || now?.userId !== taken.userId)) {
					this._claimRefused(now);
					return this.renderIfOpen();
				}
			}
			this._adoptRoll(ruling?.marker ?? taken, card, written);
			// Shut while the take-over was going out: it is this user's roll now, and a window shut on it accepts it.
			if (this._settleOnRollEnd) await this._settleBoosts();
		} catch (err) {
			this.reportWriteFailure("take-over", err);
			return;
		} finally {
			this._rolling = false;
			this._settleOnRollEnd = false;
		}
		this.renderIfOpen();
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
			// Unstoppable's circles go BEFORE the hit point: a Heavy still carrying marks at 0 HP
			// would otherwise have that 1 HP read as "regain HP while fighting" and turned into a
			// cleared mark (see unstoppable.js#regainInstead).
			await this._clearUnstoppable();
			// The hit point and the end of dying land in one write (see returnToOneHp).
			await this._character.returnToOneHp();
			await this._seedMark();
		} else if (key === "partial") {
			await this._clearUnstoppable();
			// Pointedly no HP: "no longer dying" is not "back up". They're unconscious (or close
			// enough) until the GM says otherwise, which is what the state records. A Heavy's Hard to
			// Kill trade opens with it, latched in the same write, so the sheet's card can still offer
			// it once this window is closed (HARD_TO_KILL_TRADE_FLAG).
			const actor = this._character._actor;
			if (this._character.deathsDoorRollOptions?.()?.hardToKill && typeof actor?.update === "function") {
				await actor.update({
					[`flags.${SYSTEM_ID}.${DEATHS_DOOR_FLAG}`]: DEATHS_DOOR_STATE.OUT_OF_ACTION,
					[`flags.${SYSTEM_ID}.${HARD_TO_KILL_TRADE_FLAG}`]: true,
				});
			} else {
				await this._character.setDeathsDoorState(DEATHS_DOOR_STATE.OUT_OF_ACTION);
			}
		} else {
			// A 6- decides nothing but that the roll is spent — which of the three fates they take
			// is still theirs, and the GM will want to ask about it before they answer.
			await this._character.setDeathsDoorState(DEATHS_DOOR_STATE.FATE_PENDING);
		}
	}

	/**
	 * Unstoppable: "If you survive, clear all your circles." A 10+ and a 7-9 are both surviving
	 * (the Hard to Kill trade only follows a 7-9, so it finds them already cleared), and the move
	 * gives no choice about it, so it is written with the tier and said in chat.
	 */
	async _clearUnstoppable() {
		const cleared = await this._character.clearUnstoppableCircles?.();
		if (!cleared) return;
		const said = cleared === 1 ? "unstoppableOne" : "unstoppableMany";
		await this._post("Unstoppable", `<p>${format(`${_I18N}.chat.${said}`, { name: escHtml(this._actorName), count: cleared })}</p>`);
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
					text: _markPlaceholder(),
					status: "permanent",
					origin: "deaths-door",
				}, { moveName: _MOVE.name });
			} catch (err) {
				console.error("Stonetop | could not record the Death's-Door mark", err);
				ui.notifications?.warn?.(localize(`${_I18N}.mark.seedFailed`));
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
		await this._character.updateWound?.(this._markWoundId, { text: text || _markPlaceholder() });
		// Latched only once the write has landed, so a save that failed doesn't make the next
		// attempt at the same wording look like a no-op and drop it for good.
		this._markText = text;
	}

	/** Hard to Kill, 7-9: "you can mark a debility of your choice to regain 1 HP" (p.114). */
	async _onTradeDebility(key) {
		if (this._debilityTraded || !key) return;
		this._debilityTraded = true;
		try {
			if (!(await tradeHardToKillDebility(this._character, key))) { this._debilityTraded = false; return; }
		} catch (err) {
			this._debilityTraded = false;
			throw err;
		}
		this.renderIfOpen();
	}

	get _actorName() { return this._character?._actor?.name ?? localize(`${_I18N}.theCharacter`); }

	/** A fate that could not be written. The latch is already back off; say so and redraw. */
	_onFateFailed(err) { this.reportWriteFailure("fate", err); }

	/**
	 * A 6- fate. "Refuse to go" forks again (Revenant or Ghost), so it advances to the insert
	 * step; the other two resolve here.
	 */
	async _onChooseFate(key) {
		const fate = _FATES.find(f => f.key === key);
		if (!fate || this._fateApplied || this._noFateOwed()) return;

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
		await this._post(localize(`${_I18N}.chat.lastDoorTitle`), `<p>${format(`${_I18N}.chat.lastDoor`, { name: escHtml(this._actorName) })}</p>
			<p class="stonetop-dying-trigger">${localize(`${_I18N}.chat.lastDoorRule`)}</p>`);
		this.renderIfOpen();
	}

	/**
	 * Whether the 6- this window is offering fates for is no longer owed: the GM cleared the pending fate in
	 * edit mode, or it was chosen from another window, while this one still showed the buttons. Says so and
	 * redraws when it is not, so a stale button never sets `dead` or grants an insert nobody is owed.
	 */
	_noFateOwed() {
		if (this._fatePending) return false;
		ui.notifications?.info?.(format(`${_I18N}.fateSettled`, { actor: this._actorName }));
		this.renderIfOpen();
		return true;
	}

	/** Grant a post-death insert — the actual mechanical consequence of refusing to go. */
	async _onTakeInsert(slug) {
		if (this._fateApplied || !slug || this._noFateOwed()) return;
		this._fateApplied = true;
		try {
			// They died and came back: no longer dying, and emphatically not dead, but out of the
			// action at 0 HP until they are back on their feet (the Special Moves card's button). From
			// here on 0 HP triggers the insert's own move, not Death's Door again. That state rides IN
			// the slug's own write rather than following it as a second one: as a pair, a reload
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
		this._choices = await buildPostDeathChoices(this._character, { group: `deathsdoor-${id}`, carried: this._carried });
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
		await postDyingCard(this._character?._actor ?? null, title, body);
	}

	/**
	 * Flush the mark on the way out. `change` doesn't fire for a field the player typed in and
	 * then closed the window on (Escape, the X, or Done straight from the keyboard), and losing
	 * the one sentence they wrote about their own death is exactly the loss this window is
	 * supposed to stop. Read before super.close() tears the element down.
	 */
	async close(options = {}) {
		// A result still waiting on Burn Brightly or giving it your all is accepted as it stands: the roll
		// is spent, and a window shut on it must not leave the Door neither passed nor faced. One mid-boost
		// settles as that boost finishes (_endBoost), on whatever total it left, and one shut while the dice
		// were still in the air as they land (_onRoll): left waiting on a closed window, the roll's marker
		// would hold every other owner off until it went stale.
		if (this._rolling) this._settleOnRollEnd = true;
		this._unlisten();
		if (this._boostsPending) {
			if (this._boosting) this._settleOnBoostEnd = true;
			else {
				try { await this._settleBoosts(); }
				catch (err) { console.error("Stonetop | could not settle the Death's Door result", err); }
			}
		}
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
