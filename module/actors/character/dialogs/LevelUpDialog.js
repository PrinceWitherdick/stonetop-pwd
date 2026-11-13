import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { withMarkOptionList } from "../mark-option-list.js";
import { holdCentre } from "../../../utils/hold-centre.js";
import { markProseSpiralBullets } from "../../../utils/journal-spiral-bullets.js";
import { moveGroupsForPlaybook, moveGroupKeys } from "./onboarding-move-groups.js";
import { moveMarkBudget, markOptionCapNote } from "../move-mark-budget.js";
import { annotateInvocationEffects } from "../invocation-effects.js";
import { getHoverDescriptionSetting } from "../../../settings.js";
import { playbookAvatar } from "../../../playbooks/playbook-catalog.js";
import { INVOKE_THE_SUN_GOD } from "../holy-light.js";
import { insertInertNote } from "../insert-inert-note.js";
import { localize, format } from "../../../utils/i18n.js";
import { levelUpAwayNote } from "../../../campaign/level-up-at-home.js";
import { CustomMoveDialog } from "./CustomMoveDialog.js";
import { canAuthorCustomMoves } from "../../../utils/authoring-gates.js";
import { xpRules } from "../../../utils/xp.js";
import { wireKeyboardButtons } from "../../../utils/keyboard-buttons.js";
import { attrValue } from "../../../utils/strings.js";
import { focusInto, focusNextWindow } from "../../../utils/focus-window.js";
import { LEARN_LATER } from "../../../timeline/timeline-milestones.js";

// Base width (overview, stat, marks). The move, foreign-move, and invocation steps
// widen so their masonry lists show two columns by default. The grid allows three
// (columns: var(--st-move-column-min) 3 in stonetop.css), so this width must stay
// short of three --st-move-column-min columns: at ~900 the default would open on
// three. tests/actors/character/move-card-columns.test.js checks it.
// Heights are NOT fixed here: every step fits its own content (height:"auto"), and a
// CSS `max-height` on `.stonetop-levelup-dialog` (stonetop.css) caps the tall steps —
// the move grid and the invocation grid — so they scroll inside a comfortable window
// instead of ballooning to fill the viewport.
const LEVELUP_BASE_WIDTH = 520;
const LEVELUP_MOVE_WIDTH = 860;

// Steps whose masonry card grids need the wider window. Anything else
// (overview, stat, marks) shows at LEVELUP_BASE_WIDTH.
const LEVELUP_WIDE_STEPS = ["move", "agreed", "foreignMove", "invocation"];

// The level-up wizard is a linear sequence; each optional step appears only when its
// predicate fires (`overview` and `move` are always present). Next/Back navigation and the
// "is this the final step?" check all derive from this single ordering via _adjacentStep —
// keep this the one source of truth for step order + skip logic.
const LEVELUP_STEPS = ["overview", "advance", "advanceStat", "move", "agreed", "foreignMove", "stat", "marks", "companion", "invocation"];

// The move step's "Agreed with the table" card (Book I p.529: a move from another playbook "If
// everyone (not just you) agrees", or a custom one, p.528 step 3's insert class). Picking it is a
// move pick like any other; the agreed step that follows says which move.
const AGREED_ID = "__agreed__";

// What picking a homebrew advance leads to, said on its row, or null when it is done on the spot.
function _advanceWhatNext(o) {
	switch (o.kind) {
		case "stat": return "Pick the stat next";
		case "move": return "Pick the move next";
		case "otherMove": return "Agree the move next";
		case "hp": return o.to ? `Max HP to ${o.to}` : `+${o.by} max HP`;
		case "damage": return `Damage die ${o.die}`;
		default: return "The table settles it";
	}
}
const AGREED_CUSTOM = "__custom__";

// The move step's "Choose my move later" card (Book I p.529: "they can take time to think ... if
// they're stumped, they can pick a new move during play"). The level is taken with no move; the Moves
// tab's shortfall banner then asks for it, and ticking it there asks for every choice it needs.
const LATER_ID = "__later__";

// What a step change hands the keyboard to: the new step's intro (template: data-levelup-focus).
const STEP_FOCUS = "[data-levelup-focus]";

// This world's Level Up cost in words: the book's "6 + twice your current level" (p.528), or the
// slower curve the world picked (p.582, utils/xp.js).
function _xpRuleText() {
	const { base, perLevel } = xpRules();
	return format("stonetop.specialMoves.levelUp.xpRule", {
		base,
		times: localize(perLevel === 3 ? "stonetop.specialMoves.levelUp.xpRuleThrice" : "stonetop.specialMoves.levelUp.xpRuleTwice"),
	});
}

// The selector that finds a pickable card again after the re-render its pick causes, so the
// keyboard focus stays on it. Off the one data key each card family carries.
const PICK_KEYS = ["advanceSlug", "compendiumId", "statKey", "markSlug", "actionSlug", "slug"];
function _pickableSelector(el) {
	for (const key of PICK_KEYS) {
		const value = el?.dataset?.[key];
		if (value == null) continue;
		const attr = key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
		return `.stonetop-levelup-pickable[data-${attr}="${attrValue(value)}"]`;
	}
	return null;
}

// One click on a step's pick list (the mark step, the companion step): a picked slug comes off, an
// unpicked one goes on while the allowance has room, and a single-pick step swaps its lone pick.
function _togglePick(picks, slug, allowance) {
	if (picks.includes(slug)) return picks.filter(s => s !== slug);
	if (picks.length < allowance) return [...picks, slug];
	return allowance === 1 ? [slug] : picks;
}

// The foreign-move step reuses the move step's card and chip markup so it inherits that
// styling (including the past-death skin, which targets these class names directly): a
// foreign card carries `.stonetop-levelup-move-option` too, and a playbook chip carries
// `.stonetop-levelup-move-chip`. So a handler selecting on the shared class alone ALSO
// binds to the other step's DOM — the two steps never render together, but the state each
// handler writes is on the instance and outlives the step. That is how a group chip left
// active on the move step used to blank the whole foreign list (a foreign card has no
// `data-move-groups`, so it matched no group), and how clicking a foreign move used to
// overwrite `_selectedMoveId` with the foreign move's id and level the character up with
// the wrong move entirely. Select through these constants — each pairs the shared class
// with the thing that tells the two families apart — rather than the bare class.
// The agreed step's cards (`.stonetop-levelup-agreed-option`) are a third family, kept out the same
// way. The move step's own "Agreed with the table" card IS a move card (it is that step's pick), but
// stays out of the move filter so a search never hides it.
const MOVE_CARD    = ".stonetop-levelup-move-option:not(.stonetop-levelup-foreign-option):not(.stonetop-levelup-agreed-option)";
const MOVE_FILTER_CARD = `${MOVE_CARD}:not(.stonetop-levelup-agreed-entry):not(.stonetop-levelup-later-entry)`;
const FOREIGN_CARD = ".stonetop-levelup-foreign-option";
const AGREED_CARD  = ".stonetop-levelup-agreed-option";
const MOVE_CHIP    = ".stonetop-levelup-move-chip[data-move-group]";
const FOREIGN_CHIP = ".stonetop-levelup-foreign-chip";

const LEVELUP_ID_PREFIX = "stonetop-levelup-dialog";

// The two lists of other playbooks' moves (the agreed step's and the cross-playbook step's), each
// card drawn by the one partial (templates/dialogs/partials/level-up-other-card.hbs) and wired by
// _wireOtherPlaybookList. Each names its cards, its search box, its "nothing matches" line, and the
// instance fields holding its pick, its query and (foreign only) its source-playbook chip.
const OTHER_PLAYBOOK_LISTS = {
	agreed: {
		cards: AGREED_CARD, filtered: `${AGREED_CARD}:not(.stonetop-levelup-agreed-custom)`,
		search: ".levelup-agreed-search", empty: ".stonetop-levelup-agreed-no-matches",
		pickKey: "_selectedAgreedId", searchKey: "_agreedSearch",
	},
	foreign: {
		cards: FOREIGN_CARD, filtered: FOREIGN_CARD,
		search: ".levelup-foreign-search", empty: ".stonetop-levelup-foreign-no-matches",
		pickKey: "_selectedForeignMoveId", searchKey: "_foreignSearch",
		chips: FOREIGN_CHIP, chipKey: "_activeForeignPlaybook",
	},
};

// One move from another playbook as a card, for the agreed step and the cross-playbook step alike.
// `insertMove`: the 0-HP move of an insert the character wears, for insertInertNote.
function _otherPlaybookCard(m, selectedId, insertMove = null, idBase = "") {
	const insertNote = insertInertNote(m.name, insertMove);
	return {
		..._cardIds(idBase, { description: m.description, requiresLabel: m.requiresLabel, stockNote: m.stockNote, insertNote }),
		compendiumId:  m.compendiumId,
		name:          m.name,
		description:   m.description,
		moveResults:   m.moveResults ?? null,
		playbook:      m.playbook,
		requiresLabel: m.requiresLabel ?? null,
		// "Costs Stock; you have no sacred pouch", or null. Display only (see
		// StonetopCharacter#getForeignMovesForLevelUp, which leaves it off an Initiate pick).
		stockNote:     m.stockNote ?? null,
		insertNote,
		selected:      m.compendiumId === selectedId,
	};
}

// A pickable card's short spoken name and its description (M1): the card is named by its move's
// name (`nameId`) and described by its text and notes (`descIds`), rather than read whole as its name.
// The second argument says which pieces the card shows, so only ids that exist are referred to.
function _cardIds(idBase, { description = null, requiresLabel = null, stockNote = null, insertNote = null } = {}) {
	if (!idBase) return { nameId: null, descId: null, reqId: null, stockId: null, noteId: null, descIds: null };
	const ids = { nameId: `${idBase}-name`, descId: `${idBase}-desc`, reqId: `${idBase}-req`, stockId: `${idBase}-stock`, noteId: `${idBase}-note` };
	const descIds = [description && ids.descId, requiresLabel && ids.reqId, stockNote && ids.stockId, insertNote && ids.noteId]
		.filter(Boolean).join(" ");
	return { ...ids, descIds: descIds || null };
}

export class LevelUpDialog extends StonetopDialog {
	constructor(character, levelUpData, onDone, options = {}) {
		// One window PER CHARACTER — see StonetopDialog.perDocumentOptions. A GM levelling the
		// whole party between sessions has several of these open at once, and with one shared
		// id the second painted into the first's frame, leaving buttons that levelled up the
		// wrong character.
		super(StonetopDialog.perDocumentOptions(LEVELUP_ID_PREFIX, character?._actor?.id, options));
		this._character  = character;
		this._data       = levelUpData;
		this._step       = "overview"; // "overview" | "move" | "foreignMove" | "stat" | "marks" | "invocation"
		this._selectedMoveId         = null;
		this._selectedStat           = null;
		// A homebrew playbook's own advance picked (its slug), when it has its own Level Up.
		this._selectedAdvance        = null;
		// The stat a homebrew stat advance raises: its own pick, apart from an Improved/Superior Stat
		// move taken alongside it (`replacesUsual` false), which asks for its own stat.
		this._selectedAdvanceStat    = null;
		// The Invocations picked: one on an even level, or every one owed when catching up (C3).
		this._selectedInvocations    = [];
		// The keyboard's place for the next draw (a selector), or null: see _render.
		this._focusNext              = null;
		// Level-up mark step (Veteran Crew / Well Versed / …; never Potential for Greatness, which
		// is marked in play): the picks made this take, each { slug, stat? }.
		this._selectedMarks          = [];
		// Beast-Bonded Ranger: the companion action slugs marked for the level being gained.
		this._selectedCompanionActions = [];
		this._showLockedMoves        = false;
		// Move-filter state, persisted across re-renders (a move click re-renders the
		// dialog) so the search query and active chip survive selection.
		this._moveSearch             = "";
		this._activeMoveGroup        = null;
		// Cross-playbook foreign-move pick (Phase 3): the qualifying foreign moves are
		// fetched async when the step opens; the chosen one + a search filter live here.
		this._selectedForeignMoveId  = null;
		this._foreignMoves           = [];
		this._foreignMovesForId      = null; // the move id _foreignMoves was loaded for (avoid re-fetch on Back/Next)
		this._foreignSearch          = "";
		this._activeForeignPlaybook  = null; // source-playbook chip filter ("The Fox" | … | null = all)
		// "Agreed with the table": the qualifying moves of every other playbook (fetched when the
		// step opens), the pick (a compendium id, or AGREED_CUSTOM), and its search filter.
		this._agreedMoves            = [];
		this._agreedLoaded           = false;
		this._selectedAgreedId       = null;
		this._agreedSearch           = "";
		this._customEditor           = null;
		this._customPicks            = null;
		this._onDone = onDone;
	}

	// The window id for one actor's level-up. The sheet opens it through openOrFocus
	// (utils/open-or-focus.js), which also holds it while the level-up's data is read and the window draws.
	static idFor(actorId) {
		return StonetopDialog.perDocumentOptions(LEVELUP_ID_PREFIX, actorId).id;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        LEVELUP_ID_PREFIX,
			template:  "systems/stonetop-pwd/templates/dialogs/level-up.hbs",
			title:     game.i18n.localize("stonetop.specialMoves.levelUp.title"),
			width:     LEVELUP_BASE_WIDTH,
			height:    "auto", // every step fits its content; CSS max-height caps tall lists
			resizable: true,
			classes:   ["stonetop", "stonetop-levelup-dialog"],
			// Picking a move / foreign move / invocation re-renders the step; without this
			// Foundry would reset these tall scroll lists to the top on every selection.
			// Listing the scroll containers lets the framework save/restore their scrollTop.
			scrollY:   [".stonetop-levelup-move-list", ".stonetop-levelup-invocation-list"],
		});
	}

	async _render(force, options) {
		// Hold the previous step's CENTER before re-rendering (utils/hold-centre.js). A step
		// change resizes the window; without this it would grow from a fixed corner (or
		// Foundry would re-center it in the viewport, reading as a jump). Re-centering
		// on this point keeps the new, larger window centered over the old one.
		// Nothing is held on the first render (no prior position), where Foundry centers us.
		const recentre = holdCentre(this);
		// The keyboard's place (M1): a redraw replaces every control, and the browser drops focus on the
		// page body. A step change goes to the new step's intro (set by Next/Back); otherwise the control
		// that had focus is found again; the first draw starts on the overview's intro.
		const firstDraw = !this.rendered;
		this._focusNext ??= this._focusSelectorFor(globalThis.document?.activeElement);
		await super._render(force, options);
		this._applyStepSize(recentre);
		const target = this._focusNext ?? (firstDraw ? STEP_FOCUS : null);
		this._focusNext = null;
		if (target) focusInto(this.element, { prefer: target });
	}

	// A selector that finds `el` (the focused control, inside this window) in the next draw, or null.
	_focusSelectorFor(el) {
		const root = this.element?.[0];
		if (!el || !root?.contains?.(el)) return null;
		if (el.matches?.(".stonetop-levelup-pickable")) return _pickableSelector(el);
		if (el.matches?.(".stonetop-levelup-locked-check")) return ".stonetop-levelup-locked-check";
		if (el.dataset?.moveGroup) return `${MOVE_CHIP}[data-move-group="${attrValue(el.dataset.moveGroup)}"]`;
		if (el.dataset?.playbook && el.matches?.(FOREIGN_CHIP)) return `${FOREIGN_CHIP}[data-playbook="${attrValue(el.dataset.playbook)}"]`;
		return null;
	}

	// Resize the window to match the active step — but only when the step actually
	// changes, so a manual resize while picking moves isn't snapped back on the
	// re-render a move click triggers. Every step fits its own content height (a CSS
	// `max-height` caps the tall move/invocation lists so they scroll rather than
	// balloon); only the width differs — the move, foreign-move, and invocation
	// pickers widen for their two-column grids (LEVELUP_WIDE_STEPS). So a short step
	// like the stat picker shrinks back down instead of hanging at the wide size. When
	// given `recentre` (holdCentre's answer) the window is re-centered on the old centre so
	// the resize stays put.
	_applyStepSize(recentre = null) {
		if (this._sizedStep === this._step) return;
		this._sizedStep = this._step;
		const width = LEVELUP_WIDE_STEPS.includes(this._step) ? LEVELUP_MOVE_WIDTH : LEVELUP_BASE_WIDTH;
		// Apply the new width + fit-to-content height first so Foundry resolves the
		// final height, then recenter using the now-known dimensions.
		this.setPosition({ width, height: "auto" });
		recentre?.();
	}

	getData() {
		const d = this._data;
		const isOverview    = this._step === "overview";
		const isAdvance     = this._step === "advance";
		const isMove        = this._step === "move";
		const isAgreed      = this._step === "agreed";
		const isForeignMove = this._step === "foreignMove";
		// The advance's stat step draws the same stat list as the move's.
		const isAdvanceStat = this._step === "advanceStat";
		const isStat        = this._step === "stat" || isAdvanceStat;
		const isMarks       = this._step === "marks";
		const isCompanion   = this._step === "companion";
		const isInvocation  = this._step === "invocation";

		const markDesc     = this._markStepDescriptor();
		// The wizard's final step — no active step remains after the current one. See
		// LEVELUP_STEPS / _adjacentStep for the single source of step order + skip logic.
		// An advance step with nothing picked yet isn't the last: the pick decides what follows it.
		const switching = !!d.advancement?.switchPlaybook;
		const isLastStep = this._adjacentStep(+1) === undefined && !(isAdvance && !this._selectedAdvance && !switching);

		const playbookName = d.playbookName ?? null;
		// The 0-HP move of an insert they wear (Undying, Tethered, Dark Succor), or null: Death's Door is behind them.
		const insertMove = this._insertZeroHpMove();

		// Each card's ids, unique to this window (M1: a short spoken name, the text as its description).
		const idBase = `stonetop-levelup-${this.appId ?? "x"}`;
		const moves = d.availableMoves.map((m, i) => ({
			..._cardIds(`${idBase}-m${i}`, { description: m.description, requiresLabel: m.requiresLabel, insertNote: insertInertNote(m.name, insertMove) }),
			compendiumId:  m.compendiumId,
			name:          m.name,
			// Its mark options listed, as it has no boxes to show them on yet (mark-option-list.js).
			description:   withMarkOptionList(m.description, m.markOptions),
			// The move's stored tiers, for the moves whose description states no outcome (Borrow
			// Power, Veil): without them the card shows no ladder at all (utils/move-tiers.js).
			moveResults:   m.moveResults ?? null,
			requiresLabel: m.requiresLabel,
			groupsAttr:    moveGroupKeys(playbookName, m.name).join(" "),
			insertNote:    insertInertNote(m.name, insertMove),
			selected:      m.compendiumId === this._selectedMoveId,
		}));

		const lockedMoves = d.lockedMoves.map(m => ({
			compendiumId:  m.compendiumId,
			name:          m.name,
			description:   m.description,
			moveResults:   m.moveResults ?? null,
			requiresLabel: m.requiresLabel,
			groupsAttr:    moveGroupKeys(playbookName, m.name).join(" "),
		}));

		// Mirror the Invocations tab: when the hover-descriptions setting is on, wrap the
		// "Reduced:" / "Empowered:" labels so they carry the same explanatory tooltip here.
		const showEffectTips = getHoverDescriptionSetting("hoverDescriptionsInvocations");
		const invocationAllowance = this._invocationAllowance();
		const invocations = d.availableInvocations.map((inv, i) => {
			const selected = this._selectedInvocations.includes(inv.slug);
			return {
				..._cardIds(`${idBase}-i${i}`, { description: inv.description }),
				slug:        inv.slug,
				label:       inv.label,
				description: showEffectTips ? annotateInvocationEffects(inv.description ?? "") : inv.description,
				selected,
				// A multi-pick step locks the rest once its allowance is picked; a single pick just swaps.
				disabled:    !selected && invocationAllowance > 1 && this._selectedInvocations.length >= invocationAllowance,
			};
		});

		// The move step's "Agreed with the table" pick, and the agreed step's list: every other
		// playbook's qualifying moves, then "a custom move" where this user may write one.
		const agreedPicked = this._selectedMoveId === AGREED_ID;
		const laterPicked = this._selectedMoveId === LATER_ID;
		const customAllowed = canAuthorCustomMoves();
		const agreedMoves = this._agreedMoves.map((m, i) => _otherPlaybookCard(m, this._selectedAgreedId, insertMove, `${idBase}-a${i}`));

		// Foreign-move picker (cross-playbook moves): the qualifying foreign moves, with a
		// text filter. An empty list (nothing qualifies) allows Continue only for a move that
		// grants something else (Initiate's Sacred Pouch); any other would grant nothing.
		const foreignMoves = this._foreignMoves.map((m, i) => _otherPlaybookCard(m, this._selectedForeignMoveId, insertMove, `${idBase}-f${i}`));

		// Source-playbook chips beside the foreign-move search. Derived from the moves
		// actually offered (so a chip can never filter to nothing) rather than from the
		// full playbook roster, and only worth showing once two or more are represented —
		// a cross-playbook move naming a single playbook needs no filter.
		const foreignPlaybooks = this._foreignPlaybookChips();

		// How many distinct options are actually SELECTABLE this take (a count option with a
		// free box). The required allowance is capped to this, so a budgeted move whose budget
		// exceeds its free boxes (one-box options like Beast of Legend's, some of them marked by
		// hand beyond the budget) can never trap the player: one pick per free box means the
		// budget is filled as far as it can be, with the rest markable later on the sheet.
		const markSelectable = markDesc ? markDesc.options.reduce((n, o) => o.existing < o.capacity && !o.capNote ? n + 1 : n, 0) : 0;
		const markAllowance = markDesc ? Math.min(markDesc.allowance, markSelectable) : 0;

		// The mark step is satisfied when this take's allowance of picks is made (the player
		// opted for "require the pick" over deferring a budgeted move's marks to the sheet).
		const marksComplete = !!markDesc && this._selectedMarks.length === markAllowance;

		const selectedEntry = this._selectedMoveEntry();
		// A cross-playbook move with nothing to learn and nothing else to give buys nothing, so the
		// level can't be spent on it (the Moves tab un-ticks it in the same case).
		// A possession already held gives nothing either (a second Initiate brings no new Pouch).
		const foreignBlocked = isForeignMove && foreignMoves.length === 0
			&& !(selectedEntry?.crossPlaybook?.grantsPossession && this._grantsNewPossession);

		const canContinue = isOverview
			|| (isAdvance && (this._selectedAdvance !== null || !!d.advancement?.switchPlaybook))
			|| (isMove && this._selectedMoveId !== null)
			|| (isAgreed && this._selectedAgreedId !== null)
			|| (isForeignMove && !foreignBlocked && (this._selectedForeignMoveId !== null || foreignMoves.length === 0))
			|| (isAdvanceStat && this._selectedAdvanceStat !== null)
			|| (isStat && !isAdvanceStat && this._selectedStat !== null)
			|| (isMarks && marksComplete)
			|| (isCompanion && this._selectedCompanionActions.length === (d.companionActions?.allowance ?? 0))
			|| (isInvocation && this._selectedInvocations.length === invocationAllowance);

		// Companion step (Beast-Bonded Ranger): each action not yet marked is a pickable row;
		// one already marked shows as such and can't be picked again. An allowance of 1 just
		// swaps the lone pick, like the mark step.
		const companion = d.companionActions ?? null;
		const companionStep = companion ? {
			allowance: companion.allowance,
			used:      this._selectedCompanionActions.length,
			chosenLabel: format("stonetop.specialMoves.levelUp.picksChosen", { used: this._selectedCompanionActions.length, allowance: companion.allowance }),
			options: companion.options.map(o => {
				const selected = this._selectedCompanionActions.includes(o.slug);
				return {
					slug: o.slug, label: o.label, selected,
					existingLabel: o.marked ? localize("stonetop.specialMoves.levelUp.marked") : null,
					disabled: o.marked || (!selected && companion.allowance !== 1 && this._selectedCompanionActions.length >= companion.allowance),
				};
			}),
		} : null;

		// Stat-increase step: the six stats, greying out any already at the chosen
		// move's cap (+2 Improved / +3 Superior), or the homebrew advance's ("to a max of +2").
		// The move's step counts the +1 the advance already gave its stat this level.
		const advance = this._advanceOption();
		const statAdvance = isAdvanceStat && advance?.kind === "stat" ? advance : null;
		const statCap = statAdvance ? (Number(statAdvance.max) || 3) : (selectedEntry?.cap ?? null);
		const advanceRaised = !isAdvanceStat && advance?.kind === "stat" ? this._selectedAdvanceStat : null;
		const statOptions = (d.stats ?? []).map(s => {
			const value = s.value + (s.key === advanceRaised ? 1 : 0);
			return {
				...s,
				value,
				valueLabel: value >= 0 ? `+${value}` : `${value}`,
				atCap:      statCap != null && value >= statCap,
				selected:   s.key === (isAdvanceStat ? this._selectedAdvanceStat : this._selectedStat),
			};
		});

		// Mark step (a budgeted move just picked): each option is a clickable checkbox-style
		// row. A picked option highlights; an unpicked one locks when it's full or the take's
		// allowance is spent (an allowance of 1 just swaps the lone pick instead of locking).
		const markStep = markDesc ? {
			moveName:  markDesc.moveName,
			allowance: markAllowance,
			used:      this._selectedMarks.length,
			chosenLabel: format("stonetop.specialMoves.levelUp.marksChosen", { move: markDesc.moveName, used: this._selectedMarks.length, allowance: markAllowance }),
			options: markDesc.options.map((o, i) => {
				const selected = this._selectedMarks.some(p => p.slug === o.slug);
				// An option whose target is already at its cap (the crew's die at d10) buys nothing,
				// so it has no room either, and says why (move-mark-budget.js#markOptionCapNote).
				const hasRoom  = o.existing < o.capacity && !o.capNote;
				// Why an option is out (crew already at d10, a background's box), said in text a keyboard or
				// screen-reader user meets too (L15), not in a hover tooltip only.
				return {
					slug: o.slug, label: o.label, selected,
					note:   o.capNote ?? null,
					noteId: o.capNote ? `${idBase}-mk${i}-why` : null,
					existingLabel: o.background
						? localize("stonetop.character.moves.backgroundMark")
						: o.existing > 0 ? format("stonetop.specialMoves.levelUp.markedTimes", { count: o.existing }) : null,
					disabled: !selected && (!hasRoom || (this._selectedMarks.length >= markDesc.allowance && markDesc.allowance !== 1)),
				};
			}),
		} : null;

		// A homebrew playbook's own Level Up: its advances, the ones marked at earlier levels shown as such.
		const adv = d.advancement ?? null;
		const advanceStep = adv ? {
			replacesUsual: adv.replacesUsual,
			switchPlaybook: !!adv.switchPlaybook,
			note:  adv.note,
			// The Standout's: the level is taken here, with no move; the playbook picker opens after.
			intro: adv.switchPlaybook
				? `${playbookName ?? "This playbook"} doesn't level up in place: you switch to a different playbook. Level Up takes the level, then the playbook picker opens for the new one.`
				: adv.replacesUsual
				? `${playbookName ?? "This playbook"} levels up its own way: mark one of these instead of the usual new move. Each can be marked once.`
				: `Mark one of ${playbookName ?? "this playbook"}'s advances. Each can be marked once.`,
			options: adv.options.map((o, i) => ({
				slug: o.slug, label: o.label,
				selected: o.slug === this._selectedAdvance,
				disabled: o.marked,
				existingLabel: o.marked ? localize("stonetop.specialMoves.levelUp.marked") : _advanceWhatNext(o),
				// Two advances worded alike ("Increase one of your stats" twice) are two boxes on the page.
				id: `${idBase}-adv${i}`,
			})),
		} : null;

		return {
			isOverview,
			isAdvance,
			advanceStep,
			isMove,
			isAgreed,
			isForeignMove,
			isStat,
			isMarks,
			isCompanion,
			isInvocation,
			isLastStep,
			// Level Up step 6 (Book I p.528), naming a temporary Instinct this level-up ends and an
			// insert whose Instinct replaced the playbook's.
			// Not before a change of playbook: its creation asks for a new Instinct and Appearance anyway.
			reviewLine:      isLastStep && !switching ? this._reviewLine() : "",
			markStep,
			companionStep,
			canContinue,
			overviewIntro:   format("stonetop.specialMoves.levelUp.overviewIntroRule", { rule: _xpRuleText() }),
			agreedPicked,
			laterPicked,
			laterId:         LATER_ID,
			agreedMoves,
			hasAgreedMoves:  agreedMoves.length > 0,
			agreedLoaded:    this._agreedLoaded,
			customAllowed,
			customSelected:  this._selectedAgreedId === AGREED_CUSTOM,
			customId:        AGREED_CUSTOM,
			agreedId:        AGREED_ID,
			// Apply on a custom move opens the custom move editor; the level is taken when it saves.
			applyLabel:      switching && isAdvance ? "Level Up and pick a playbook"
				: localize(isAgreed && this._selectedAgreedId === AGREED_CUSTOM
					? "stonetop.specialMoves.levelUp.applyCustom"
					: "stonetop.specialMoves.levelUp.apply"),
			// Playbook avatar art, shown beside the intro of steps unique to one playbook
			// (currently only the Lightbearer-only invocation step) to brand them.
			playbookName:    d.playbookName,
			playbookIcon:    playbookAvatar(d.playbookSlug),
			newLevel:        d.newLevel,
			// Level Up is made at home (Book I p.528): a reminder, never a block, while a trip they are on is underway.
			awayWarning:     isOverview ? levelUpAwayNote(this._character?._actor) : "",
			// An even level grows a held sacred pouch, and the new room arrives EMPTY (the user's ruling;
			// StonetopCharacter#applyLevelUp settles it), so the overview says where the Stock comes from.
			pouchGrowthNote: isOverview && d.pouchGrowth > 0 ? format("stonetop.specialMoves.levelUp.pouchGrowth", { count: d.pouchGrowth }) : "",
			cost:            d.cost,
			xpRemaining:     d.xpRemaining,
			// "Reset XP to 0 on Level Up" (Book I p.582): every point goes, not just the cost (L12).
			resetAside:      isOverview && xpRules().resetOnLevelUp && (d.xp ?? 0) > (d.cost ?? 0)
				? format("stonetop.specialMoves.levelUp.resetAside", { xp: d.xp }) : "",
			moves,
			hasMoves:        moves.length > 0,
			lockedMoves,
			hasLockedMoves:  lockedMoves.length > 0,
			showLockedMoves: this._showLockedMoves,
			moveGroups:      moveGroupsForPlaybook(playbookName),
			showMoveFilter:  moves.length > 0 || (this._showLockedMoves && lockedMoves.length > 0),
			invocations,
			needsInvocation: d.needsInvocation,
			invocationAllowance,
			// Owed from earlier levels (C3), or on an odd level: not "your new level is even".
			invocationAside: invocationAllowance > 1 || (d.newLevel ?? 0) % 2 === 1
				? format("stonetop.specialMoves.levelUp.invocationAsideOwed", { count: invocationAllowance })
				: localize("stonetop.specialMoves.levelUp.invocationAside"),
			invocationIntro: invocationAllowance > 1
				? format("stonetop.specialMoves.levelUp.invocationIntroMany", { count: invocationAllowance })
				: localize("stonetop.specialMoves.levelUp.invocationIntro"),
			invocationChosen: invocationAllowance > 1
				? format("stonetop.specialMoves.levelUp.picksChosen", { used: this._selectedInvocations.length, allowance: invocationAllowance })
				: "",
			statOptions,
			statMoveName:    statAdvance ? statAdvance.label : (selectedEntry?.name ?? null),
			statCap,
			statCapLabel:    statAdvance ? `${statAdvance.label} Each stat goes up by 1, to +${statCap} at most.`
				: selectedEntry?.name && statCap != null
				? format("stonetop.specialMoves.levelUp.statCapNote", { move: selectedEntry.name, cap: statCap }) : "",
			statAtMaxLabel:  localize("stonetop.specialMoves.levelUp.statAtMax"),
			statAllAtCap:    statOptions.length > 0 && statOptions.every(s => s.atCap),
			foreignMoves,
			foreignPlaybooks,
			hasForeignMoves: foreignMoves.length > 0,
			foreignMovesEmpty: isForeignMove && foreignMoves.length === 0,
			foreignBlocked,
			foreignFromMoveName: selectedEntry?.name ?? null,
			foreignGrantsPouch:  !!selectedEntry?.crossPlaybook?.grantsPossession && !!this._grantsNewPossession,
		};
	}

	// The distinct source playbooks among the offered foreign moves, as filter chips
	// ({ key, label }). `key` is the playbook name exactly as a move stores it (the value
	// matched against `data-playbook`); `label` drops the article so the chips read as the
	// playbooks are spoken — "Fox", "Heavy", "Would-Be Hero". Returns [] below two entries,
	// which the template reads as "no chip row".
	_foreignPlaybookChips() {
		const names = [...new Set(this._foreignMoves.map(m => m.playbook).filter(Boolean))].sort();
		if (names.length < 2) return [];
		return names.map(name => ({ key: name, label: name.replace(/^The\s+/i, "") }));
	}

	// The homebrew advance picked, from the playbook's own Level Up, or null.
	_advanceOption() {
		if (!this._selectedAdvance) return null;
		return this._data?.advancement?.options?.find(o => o.slug === this._selectedAdvance) ?? null;
	}

	// Whether this level-up takes a move at all: always by the book; with a homebrew playbook's own
	// Level Up that replaces it, only when the advance picked is "a new move from your playbook".
	_takesMove() {
		const adv = this._data?.advancement;
		// The Standout's: the new playbook's creation brings the moves, not this level-up.
		if (adv?.switchPlaybook) return false;
		if (!adv?.replacesUsual) return true;
		return this._advanceOption()?.kind === "move";
	}

	// The PlaybookMoveEntry for the currently-selected move (carries `cap`/`name`), or null.
	_selectedMoveEntry() {
		if (!this._selectedMoveId) return null;
		const all = [...(this._data?.availableMoves ?? []), ...(this._data?.lockedMoves ?? [])];
		return all.find(m => m.compendiumId === this._selectedMoveId) ?? null;
	}

	// A stat-increase move (Improved/Superior Stat) carries a `cap` and so needs the
	// stat-picker step inserted before applying.
	_needsStatChoice() {
		return (this._selectedMoveEntry()?.cap ?? null) != null;
	}

	// A cross-playbook move (Versatile/Worldly/…) carries a `crossPlaybook` config and so
	// needs the foreign-move picker step inserted after the move pick.
	_needsForeignMoveChoice() {
		return !!this._selectedMoveEntry()?.crossPlaybook;
	}

	// The mark step to show (or null) for a just-picked budgeted move (Veteran Crew /
	// Heroes to the Last / Beast of Legend / Well Versed). Potential for Greatness is NOT
	// collected at level-up — it's marked in play on a 10+ stat roll (see the chat reminder
	// in WouldBeHeroAsterisk.js).
	//
	// A cross-playbook pick asks the marks of the FOREIGN move it chose: a Blessed who takes Beast
	// of Legend through Wild Soul picks its option here as a Ranger would. The foreign move carries
	// its mark options and the copies already held (StonetopCharacter#getForeignMovesForLevelUp).
	_markStepDescriptor() {
		// A move agreed with the table asks its own marks, as a foreign pick does.
		if (this._isAgreed()) {
			const agreed = this._agreedForeign();
			return agreed?.markOptions?.length ? this._buildPickedMoveMarkStep(agreed) : null;
		}
		const entry = this._selectedMoveEntry();
		if (entry?.crossPlaybook) {
			const foreign = this._foreignMoves.find(m => m.compendiumId === this._selectedForeignMoveId);
			return foreign?.markOptions?.length ? this._buildPickedMoveMarkStep(foreign) : null;
		}
		return entry?.markOptions?.length ? this._buildPickedMoveMarkStep(entry) : null;
	}

	// Drives navigation routing — a mark step follows the move/foreign/stat steps.
	_needsMarkChoice() {
		return !!this._markStepDescriptor();
	}

	// Level Up step 5: a new Invocation on an even level for the Lightbearer or anyone with
	// Invoke the Sun God. Step 3 comes first, so a character who learns Invoke the Sun God as
	// this level's cross-playbook pick is owed one now as well. `availableInvocations` is only
	// filled on even levels, so it doubles as the even-level check.
	_needsInvocationChoice() {
		if (this._data?.needsInvocation) return true;
		if (!this._data?.availableInvocations?.length) return false;
		if (this._isAgreed()) return this._agreedForeign()?.name === INVOKE_THE_SUN_GOD;
		const foreign = this._foreignMoves.find(m => m.compendiumId === this._selectedForeignMoveId);
		return this._needsForeignMoveChoice() && foreign?.name === INVOKE_THE_SUN_GOD;
	}

	// How many Invocations the step asks for: every one owed when the character already draws on a
	// list (getLevelUpData's `invocationAllowance`, C3), else one (Invoke the Sun God taken this level).
	_invocationAllowance() {
		return this._data?.needsInvocation ? Math.max(1, Number(this._data?.invocationAllowance) || 1) : 1;
	}

	// Whether the move step's pick is "Choose my move later" (C2).
	_isLater() {
		return this._selectedMoveId === LATER_ID;
	}

	// Whether the move step's pick is "Agreed with the table".
	_isAgreed() {
		return this._selectedMoveId === AGREED_ID;
	}

	// The agreed step's pick when it is another playbook's move, or null (none yet, or custom).
	_agreedForeign() {
		if (!this._isAgreed() || !this._selectedAgreedId || this._selectedAgreedId === AGREED_CUSTOM) return null;
		return this._agreedMoves.find(m => m.compendiumId === this._selectedAgreedId) ?? null;
	}

	// The qualifying moves of every other playbook, by the cross-playbook picker's own filters
	// (no Improved/Superior Stat, no other cross move, nothing playbook-locked or already held).
	// Fetched once, when the agreed step first opens.
	async _loadAgreedMoves() {
		if (this._agreedLoaded) return;
		this._agreedMoves = await this._character.getForeignMovesForLevelUp({ playbooks: "any" }, this._data.newLevel);
		this._agreedLoaded = true;
	}

	// Step 6's line: names a temporary Instinct this level-up ends, or the insert whose Instinct
	// the character now goes by (a Ghost, Revenant or Thrall), else the book's plain reminder.
	//
	// An insert's Instinct is changed on the Post-Death tab, never on Details (whose radios are the retired
	// playbook's), so an insert PC is pointed there: with the temporary Instinct ending, with theirs chosen,
	// or with none chosen yet.
	_reviewLine() {
		const d = this._data ?? {};
		const insert = !!this._character?.postDeathSlug;
		if (d.temporaryInstinct) {
			return format(`stonetop.specialMoves.levelUp.${insert ? "reviewReminderTemporaryInsert" : "reviewReminderTemporary"}`,
				{ instinct: d.temporaryInstinct });
		}
		if (d.insertInstinctName) return format("stonetop.specialMoves.levelUp.reviewReminderInsert", { insert: d.insertInstinctName });
		if (insert) return localize("stonetop.specialMoves.levelUp.reviewReminderInsertUnchosen");
		return localize("stonetop.specialMoves.levelUp.reviewReminder");
	}

	/** The 0-HP move of the insert the character wears, or null for one still facing Death's Door. */
	_insertZeroHpMove() {
		const move = this._character?.postDeathSlug ? this._character?.zeroHpMove : null;
		return move && !move.dialog ? move.name ?? null : null;
	}

	// Whether a given step is part of THIS level-up; the optional steps appear only when
	// their move-driven predicate fires (`overview`/`move` are always present).
	_stepActive(step) {
		switch (step) {
			case "advance":     return !!this._data?.advancement;
			case "move":        return this._takesMove();
			case "agreed":      return this._isAgreed();
			case "foreignMove": return this._needsForeignMoveChoice();
			case "advanceStat": return this._advanceOption()?.kind === "stat";
			case "stat":        return this._needsStatChoice();
			case "marks":       return this._needsMarkChoice();
			case "companion":   return !!this._data?.companionActions;
			case "invocation":  return this._needsInvocationChoice();
			default:            return true; // overview
		}
	}

	// The next (dir = +1) or previous (dir = -1) ACTIVE step from the current one, skipping
	// any steps this take doesn't need. Returns undefined past either end: forward-past-end
	// means "nothing left — apply"; back-past-start means "stay on overview".
	_adjacentStep(dir) {
		let i = LEVELUP_STEPS.indexOf(this._step) + dir;
		while (i >= 0 && i < LEVELUP_STEPS.length && !this._stepActive(LEVELUP_STEPS[i])) i += dir;
		return LEVELUP_STEPS[i]; // undefined once i runs off either end
	}

	// Build the mark step for a just-picked budgeted move: its checkbox (count) options,
	// what's already spent on prior copies, and the NEW picks this take grants (the move's
	// repeat-scaling budget minus what's already spent). Stat-choice options are skipped:
	// only Potential for Greatness has them, and it is marked in play, never here.
	_buildPickedMoveMarkStep(entry) {
		const ownedCountAfter = (entry.ownedIds?.length ?? 0) + 1; // this level-up adds one copy
		const budgetMax = moveMarkBudget(entry.markBudget, ownedCountAfter);
		const marksForMove = this._data?.marks?.[entry.name] ?? {};
		const len = v => Array.isArray(v) ? v.length : (typeof v === "number" ? v : 0);
		// The box the background fills (the Patriot's Things Below on Well Versed) is not stored, so
		// it spends none of the budget; it is one of the option's boxes, so it can't be picked again.
		const backgroundSlug = this._data?.backgroundMarks?.[entry.name] ?? null;
		const options = (entry.markOptions ?? [])
			.filter(o => o.choice !== "stat")
			.map(o => {
				const fromBackground = o.slug === backgroundSlug;
				return { slug: o.slug, label: o.label, choice: "count", existing: len(marksForMove[o.slug]),
					capacity: Math.max(0, (o.marks ?? 1) - (fromBackground ? 1 : 0)),
					background: fromBackground,
					capNote: fromBackground
						? localize("stonetop.specialMoves.levelUp.markFromBackground")
						: markOptionCapNote(o, this._data?.markCapState ?? {}) };
			});
		if (!options.length) return null;
		const used = options.reduce((n, o) => n + o.existing, 0);
		// A null budget (move declares no markBudget) is uncapped; fall back to one pick so
		// the step still asks for a choice rather than offering an unbounded count.
		const allowance = budgetMax != null ? Math.max(0, budgetMax - used) : 1;
		if (allowance <= 0) return null;
		return { moveName: entry.name, allowance, options };
	}

	// Fetch the qualifying foreign moves for the selected cross-playbook move (async — the
	// repo reads them from the compendium). Called when entering the foreignMove step. Skips
	// the re-fetch (and preserves the current pick + filter) on a Back→Next round-trip where
	// the source move is unchanged; a move change clears _foreignMovesForId so it reloads.
	async _loadForeignMoves() {
		const entry = this._selectedMoveEntry();
		if (!entry?.crossPlaybook) {
			this._foreignMoves = []; this._foreignMovesForId = null; this._selectedForeignMoveId = null;
			return;
		}
		if (this._foreignMovesForId === entry.compendiumId) return; // already loaded for this move
		this._foreignMoves = await this._character.getForeignMovesForLevelUp(entry.crossPlaybook, this._data.newLevel);
		// "Also grants a Sacred Pouch" only on the take that brings one: a second Initiate adds nothing.
		const grants = entry.crossPlaybook.grantsPossession ?? null;
		this._grantsNewPossession = !!grants && !(await this._character.holdsPossession?.(grants));
		this._foreignMovesForId = entry.compendiumId;
		this._selectedForeignMoveId = null;
		this._foreignSearch = "";
		this._activeForeignPlaybook = null;
	}

	// Show/hide one card list against its step's filter (`match` decides whether a card
	// passes), and reveal that list's "nothing matches" line when the filter empties it.
	//
	// The card the player has already picked is pinned visible whether or not it matches:
	// Continue is enabled off the stored pick, so a hidden selection means a player filtering
	// after choosing sees an unexplained live button — or worse, levels up on a card that
	// scrolled out of existence. Pinning keeps the enabled button and the highlighted card in
	// agreement without discarding a deliberate choice.
	_applyCardFilter(html, cardSelector, emptySelector, match) {
		let visible = 0;
		html.find(cardSelector).each((_, el) => {
			// Block body is load-bearing: a bare-arrow callback returning `show` would abort
			// jQuery's .each() on the first filtered-out card, leaving the rest unfiltered.
			const show = match(el) || el.classList.contains("is-selected");
			el.classList.toggle("is-filtered-out", !show);
			if (show) visible++;
		});
		html.find(emptySelector).toggleClass("is-filtered-out", visible > 0);
	}

	// Paint a chip row's active state: the chip whose `data-<dataKey>` equals `active` lights,
	// the rest clear. `aria-pressed` carries the same state for a screen reader, which has no
	// access to the highlight. A null `active` (no filter) matches no chip and clears the row.
	_paintChips(html, chipSelector, dataKey, active) {
		html.find(chipSelector).each((_, b) => {
			// Block body is load-bearing: classList.toggle returns a boolean, and a
			// bare-arrow return of `false` aborts jQuery's .each() mid-loop.
			const on = b.dataset[dataKey] === active;
			b.classList.toggle("is-active", on);
			b.setAttribute("aria-pressed", on ? "true" : "false");
		});
	}

	// One list of other playbooks' moves (OTHER_PLAYBOOK_LISTS): a click picks a card, and the search
	// box (plus source-playbook chips, where the list has them) filters by pure DOM show/hide. The
	// state lives on the instance so a pick, which re-renders, keeps the query and the chip.
	_wireOtherPlaybookList(html, { cards, filtered, search, empty, pickKey, searchKey, chips, chipKey }) {
		html.find(cards).on("click", ev => {
			const id = ev.currentTarget.dataset.compendiumId;
			// A mark picked for the previous move is not this one's (_markStepDescriptor).
			if (this[pickKey] !== id) this._selectedMarks = [];
			this[pickKey] = id;
			this.render(false);
		});
		const apply = () => {
			const q = this[searchKey].trim().toLowerCase();
			const playbook = chipKey ? this[chipKey] : null;
			this._applyCardFilter(html, filtered, empty, el =>
				(!q || el.textContent.toLowerCase().includes(q)) && (!playbook || el.dataset.playbook === playbook));
		};
		const input = html.find(search);
		input.val(this[searchKey]);
		input.on("input", ev => { this[searchKey] = ev.currentTarget.value; apply(); });
		if (chips) {
			html.find(chips).on("click", ev => {
				const key = ev.currentTarget.dataset.playbook;
				this[chipKey] = this[chipKey] === key ? null : key; // tap again to clear
				this._paintChips(html, chips, "playbook", this[chipKey]);
				apply();
			});
			// Restore the active-chip highlight after each render.
			this._paintChips(html, chips, "playbook", this[chipKey]);
		}
		apply();
	}

	activateListeners(html) {
		super.activateListeners(html);

		// Move / invocation descriptions are enriched move HTML that can contain
		// bulleted option lists; give them the same spiral bullets as the sheet.
		for (const desc of html.find(".stonetop-levelup-move-description, .stonetop-levelup-invocation-description")) {
			markProseSpiralBullets(desc);
		}

		html.find(`${MOVE_CARD}:not(.is-locked)`).on("click", ev => {
			this._selectedMoveId = ev.currentTarget.dataset.compendiumId;
			this._clearMoveDependents();
			this.render(false);
		});

		// Agreed step (another playbook's move, or a custom one) and the cross-playbook step.
		this._wireOtherPlaybookList(html, OTHER_PLAYBOOK_LISTS.agreed);
		this._wireOtherPlaybookList(html, OTHER_PLAYBOOK_LISTS.foreign);

		// Every pickable card answers Enter and Space as well as a click, so the window works from
		// the keyboard and a screen reader (the cards carry role="button" and tabindex in the template):
		// utils/keyboard-buttons.js presses it. The press redraws the window, and _render puts the
		// keyboard back on the card pressed (M1).
		wireKeyboardButtons(html);

		// Only the stat rows: the mark, companion and advance rows wear the same class for its look,
		// and a redraw started here would run before their own handler wrote the pick, dropping theirs.
		html.find(".stonetop-levelup-stat-option[data-stat-key]:not(.is-at-cap)").on("click", ev => {
			const key = ev.currentTarget.dataset.statKey;
			if (this._step === "advanceStat") {
				// A different stat for the advance changes what the move's own stat step allows.
				if (key !== this._selectedAdvanceStat) this._selectedStat = null;
				this._selectedAdvanceStat = key;
			} else this._selectedStat = key;
			this.render(false);
		});

		// ── Advance step (a homebrew playbook's own Level Up) ─────────────
		// The advance decides what follows: a move from this playbook (the move step), one agreed
		// from another (the agreed step), a stat (the stat step), or nothing more (max HP, a die).
		html.find(".stonetop-levelup-advance-option:not(.is-at-cap)").on("click", ev => {
			const slug = ev.currentTarget.dataset.advanceSlug;
			if (slug !== this._selectedAdvance) {
				this._selectedAdvance = slug;
				this._selectedAdvanceStat = null;
				const kind = this._advanceOption()?.kind;
				this._selectedMoveId = kind === "otherMove" ? AGREED_ID : null;
				this._clearMoveDependents();
			}
			this.render(false);
		});

		// ── Mark step (budgeted moves: Veteran Crew / Heroes to the Last / …) ──────────
		// Count options toggle; once this take's allowance is spent, a single-pick step
		// swaps the lone pick instead of locking.
		const markDesc = this._markStepDescriptor();
		html.find(".stonetop-levelup-mark-option:not(.is-at-cap)").on("click", ev => {
			const picks = this._selectedMarks.map(p => p.slug);
			this._selectedMarks = _togglePick(picks, ev.currentTarget.dataset.markSlug, markDesc?.allowance ?? 0).map(slug => ({ slug }));
			this.render(false);
		});

		// ── Companion step (Beast-Bonded Ranger) ──────────────────────────
		html.find(".stonetop-levelup-companion-option:not(.is-at-cap)").on("click", ev => {
			const allowance = this._data?.companionActions?.allowance ?? 0;
			this._selectedCompanionActions = _togglePick(this._selectedCompanionActions, ev.currentTarget.dataset.actionSlug, allowance);
			this.render(false);
		});

		// ── Move search + group chips ─────────────────────────────────────
		// Pure DOM show/hide, mirroring the onboarding move picker. Filter state
		// lives on the instance so a move click (which re-renders) doesn't lose it;
		// we re-apply it below on every render.
		const applyMoveFilter = () => {
			const query = this._moveSearch.trim().toLowerCase();
			this._applyCardFilter(html, MOVE_FILTER_CARD, ".stonetop-levelup-move-no-matches", el => {
				const textMatch  = !query || el.textContent.toLowerCase().includes(query);
				const groups     = (el.dataset.moveGroups ?? "").split(/\s+/).filter(Boolean);
				const groupMatch = !this._activeMoveGroup || groups.includes(this._activeMoveGroup);
				return textMatch && groupMatch;
			});
		};
		const search = html.find(".levelup-move-search");
		search.val(this._moveSearch);
		search.on("input", ev => {
			this._moveSearch = ev.currentTarget.value;
			applyMoveFilter();
		});
		html.find(MOVE_CHIP).on("click", ev => {
			const key = ev.currentTarget.dataset.moveGroup;
			this._activeMoveGroup = this._activeMoveGroup === key ? null : key; // tap again to clear
			this._paintChips(html, MOVE_CHIP, "moveGroup", this._activeMoveGroup);
			applyMoveFilter();
		});
		// Restore the active-chip highlight and apply the current filter after each render.
		this._paintChips(html, MOVE_CHIP, "moveGroup", this._activeMoveGroup);
		applyMoveFilter();

		html.find(".stonetop-levelup-locked-check").on("change", ev => {
			this._showLockedMoves = ev.currentTarget.checked;
			this.render(false);
		});

		html.find(".stonetop-levelup-invocation-option:not(.is-at-cap)").on("click", ev => {
			this._selectedInvocations = _togglePick(this._selectedInvocations, ev.currentTarget.dataset.slug, this._invocationAllowance());
			this.render(false);
		});

		html.find(".stonetop-levelup-back-btn").on("click", () => {
			const prev = this._adjacentStep(-1);
			if (prev) {
				this._step = prev; // undefined only at overview: stay put
				this._focusNext = STEP_FOCUS;
			}
			this.render(false);
		});

		html.find(".stonetop-levelup-next-btn").on("click", async (ev) => {
			// Re-entrancy guard, the shared one (StonetopDialog#_guardBusy): the handler awaits
			// compendium reads and the level-up writes (which add moves / grant possessions). A
			// fast double-click before those resolve would otherwise apply twice — bump the
			// level and add the move/foreign move/pouch a second time.
			//
			// The button greys while that is in flight, which this handler used to latch without
			// doing: it ignored the second click but still looked live, so the press that was
			// being dropped looked exactly like a press that had not registered.
			await this._guardBusy(ev, async () => {
				const next = this._adjacentStep(+1);
				if (!next) {
					await this._apply(); // nothing left to ask — commit the level-up
				} else {
					// The foreign-move and agreed pickers need their lists fetched before they show.
					if (next === "foreignMove") await this._loadForeignMoves();
					if (next === "agreed") await this._loadAgreedMoves();
					this._step = next;
					this._focusNext = STEP_FOCUS;
				}
				this.render(false);
			});
		});
	}

	async _apply() {
		const entry = this._selectedMoveEntry();
		const choices = {};
		// A homebrew playbook's own advance: marked by the level-up, with the stat it raised.
		const advance = this._advanceOption();
		if (advance) choices.advance = { slug: advance.slug, stat: advance.kind === "stat" ? this._selectedAdvanceStat : null };
		if (this._selectedStat && entry?.cap != null) {
			choices.stat = this._selectedStat;
			choices.cap  = entry.cap;
		} else if (entry?.crossPlaybook) {
			// Cross-playbook pick: the chosen foreign move (may be null if nothing qualified)
			// + whether this move also grants a possession (the Initiate Sacred Pouch).
			choices.crossPlaybook    = true;
			choices.foreignMoveId    = this._selectedForeignMoveId;
			choices.grantsPossession = entry.crossPlaybook.grantsPossession ?? null;
		}
		// Mark-step picks for a budgeted move just taken (or the foreign move a cross-playbook
		// pick chose). Threaded INDEPENDENTLY of the stat/cross branches above.
		const markDesc = this._markStepDescriptor();
		if (markDesc && this._selectedMarks.length) {
			choices.marks = { moveName: markDesc.moveName, picks: this._selectedMarks };
		}
		if (this._stepActive("companion") && this._selectedCompanionActions.length) {
			choices.companionActions = [...this._selectedCompanionActions];
		}
		// Only when the step ran THIS time: a player who picked Invoke the Sun God through
		// Versatile, chose an Invocation, then went Back and picked another move has a stale
		// slug left over that must not be learned.
		const invocations = this._stepActive("invocation") ? [...this._selectedInvocations] : null;
		// A move agreed with the table: another playbook's (added like any move) or a custom one,
		// written in the custom move editor first; the level is taken only when that saves.
		const agreedForeign = this._agreedForeign();
		if (this._isAgreed()) {
			if (this._selectedAgreedId === AGREED_CUSTOM) return this._openCustomEditor(choices, invocations);
			choices.agreed = { foreignMoveId: agreedForeign?.compendiumId ?? null };
		}
		// The foreign move a cross-playbook pick learned, for the timeline row and the sheet.
		const foreignMoveName = choices.crossPlaybook
			? this._foreignMoves.find(m => m.compendiumId === choices.foreignMoveId)?.name
			: undefined;
		const moveName = this._isLater() ? LEARN_LATER
			: agreedForeign?.name ?? (foreignMoveName ? `${entry?.name} (${foreignMoveName})` : entry?.name ?? "");
		// `fromLevel` pins the level these choices were built for, so a stale window (the same
		// level-up already applied elsewhere, or XP spent meanwhile) writes nothing. `moveName`
		// rides along to the timeline's "Reached level N" row ("Learned Seasoned Warrior.").
		const result = await this._character.applyLevelUp(
			this._isAgreed() || this._isLater() ? null : this._selectedMoveId, invocations,
			Object.keys(choices).length ? choices : null,
			{ fromLevel: this._data.level, moveName },
		);
		if (result?.reason === "moveHeld") return this._backToMoves(agreedForeign?.name ?? entry?.name ?? "");
		return this._finish(result, { addedMoveName: agreedForeign?.name ?? entry?.name ?? null, foreignMoveName,
			switchPlaybook: !!this._data?.advancement?.switchPlaybook });
	}

	// The move picked was put on the sheet while this window was open (L7): nothing was written. Say
	// so, read the level-up afresh (the move is no longer offered), and go back to the move step.
	async _backToMoves(moveName) {
		ui.notifications?.warn(format("stonetop.specialMoves.levelUp.refusedMoveHeld", { move: moveName }));
		this._data = await this._character.getLevelUpData();
		this._selectedMoveId = null;
		this._clearMoveDependents();
		this._agreedLoaded = false;
		this._agreedMoves = [];
		this._step = "move";
		this._focusNext = STEP_FOCUS;
	}

	// Drop any stat / foreign-move / mark / agreed pick hanging on the move picked before, so they
	// re-validate against the new move (a non-stat / non-cross-playbook move ignores them).
	_clearMoveDependents() {
		this._selectedStat = null;
		this._selectedForeignMoveId = null;
		this._foreignMoves = [];
		this._foreignMovesForId = null;
		this._selectedMarks = [];
		this._selectedAgreedId = null;
	}

	// "A custom move" agreed with the table: the custom move editor opens, and saving it takes the
	// level (StonetopCharacter#_addLevelUpMove writes the move and stamps it as the level's pick).
	// Closing the editor without saving changes nothing; the level-up window stays open.
	// The editor saves whatever picks the last Apply carried: the level-up window stays usable
	// while the editor is open, so Back + a changed pick + Apply again must not be lost.
	_openCustomEditor(choices, invocations) {
		this._customPicks = { choices, invocations };
		if (this._customEditor?.rendered) return this._customEditor.bringToTop();
		const saver = {
			create: async input => {
				const { choices, invocations } = this._customPicks;
				const result = await this._character.applyLevelUp(null, invocations,
					{ ...choices, agreed: { customMove: input } },
					{ fromLevel: this._data.level, moveName: input?.name ?? "" });
				await this._finish(result, { addedMoveName: null });
			},
			update: async () => {},
		};
		this._customEditor = new CustomMoveDialog(saver, {
			onSaved: () => this._character?._actor?.sheet?.render(false),
		});
		this._customEditor.render(true);
	}

	// Closing the level-up window closes a custom move editor it opened, so saving that editor
	// later cannot take a level the player walked away from. Not while that save is finishing.
	async close(options) {
		const editor = this._customEditor;
		this._customEditor = null;
		if (editor?.rendered && !this._finishing) await editor.close();
		return super.close(options);
	}

	// After an apply: close, say what happened, and hand back to the sheet.
	async _finish(result, { addedMoveName = null, foreignMoveName, switchPlaybook = false } = {}) {
		this._finishing = true;
		// Closed BEFORE the sheet hears back: when there's XP for another level, the sheet
		// opens the next level-up, and a window still closing under this id would be found by
		// openOrFocus and raised instead.
		await this.close();
		if (result && !result.applied) {
			const refused = { outOfPlay: "refusedOutOfPlay", level: "refusedLevel" }[result.reason] ?? "refusedXp";
			ui.notifications?.warn(game.i18n.localize(`stonetop.specialMoves.levelUp.${refused}`));
			if (this._onDone) this._onDone(null, { applied: false });
			this._focusAfterApply();
			return;
		}
		// A pick that could not be saved after the level was paid for: say which, so it is finished
		// on the sheet rather than lost without a word (the console has the error).
		if (result?.failed?.length) {
			ui.notifications?.error(format("stonetop.specialMoves.levelUp.partlyFailed",
				{ level: this._data.newLevel, parts: result.failed.join(", ") }));
		}
		if (result?.endedInstinct?.value) {
			ui.notifications?.info(format("stonetop.specialMoves.levelUp.instinctEnded", { instinct: result.endedInstinct.value }));
		}
		// Hand back the chosen move's name so the sheet can auto-open the sacred-pouch
		// editor when a Blessed levels into Big Magic (an additional remarkable trait). A
		// cross-playbook pick hands back the foreign move it learned too: a Seeker who takes
		// Big Magic through Initiate of the Secret Arts is owed that trait just the same.
		if (this._onDone) this._onDone(addedMoveName, { applied: true, foreignMoveName, ...(switchPlaybook ? { switchPlaybook: true } : {}) });
		this._focusAfterApply();
	}

	// M1: the window is gone, so the keyboard would land on the page body. It goes to a window the
	// Apply opened, or else to the sheet's Level field, which now reads the new level.
	_focusAfterApply() {
		const sheet = this._character?._actor?.sheet ?? null;
		// Redrawing counts: the sheet is mid-render for the new level as this runs (V1 RENDERING = 1,
		// RENDERED = 2), and focusNextWindow puts the keyboard back once that draw lands.
		const live = !!sheet && (sheet.rendered || (sheet._state ?? 0) >= 1);
		return focusNextWindow({ fallback: live ? sheet : null, fallbackSelector: "input[name='system.attributes.level.value']" });
	}
}
