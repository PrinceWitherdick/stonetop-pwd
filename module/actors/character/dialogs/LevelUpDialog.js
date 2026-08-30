import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { markProseSpiralBullets } from "../../../utils/journal-spiral-bullets.js";
import { moveGroupsForPlaybook, moveGroupKeys } from "./onboarding-move-groups.js";
import { moveMarkBudget } from "../move-mark-budget.js";
import { annotateInvocationEffects } from "../invocation-effects.js";
import { getHoverDescriptionSetting } from "../../../settings.js";
import { playbookIconPath } from "../../../utils/playbook-actors.js";

// Base width (overview, stat, marks). The move, foreign-move, and invocation steps
// widen so their two-column masonry lists show both columns comfortably by default.
// Heights are NOT fixed here: every step fits its own content (height:"auto"), and a
// CSS `max-height` on `.stonetop-levelup-dialog` (stonetop.css) caps the tall steps —
// the move grid and the invocation grid — so they scroll inside a comfortable window
// instead of ballooning to fill the viewport.
const LEVELUP_BASE_WIDTH = 520;
const LEVELUP_MOVE_WIDTH = 860;

// Steps whose two-column masonry card grids need the wider window. Anything else
// (overview, stat, marks) shows at LEVELUP_BASE_WIDTH.
const LEVELUP_WIDE_STEPS = ["move", "foreignMove", "invocation"];

// The level-up wizard is a linear sequence; each optional step appears only when its
// predicate fires (`overview` and `move` are always present). Next/Back navigation and the
// "is this the final step?" check all derive from this single ordering via _adjacentStep —
// keep this the one source of truth for step order + skip logic.
const LEVELUP_STEPS = ["overview", "move", "foreignMove", "stat", "marks", "invocation"];

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
const MOVE_CARD    = ".stonetop-levelup-move-option:not(.stonetop-levelup-foreign-option)";
const FOREIGN_CARD = ".stonetop-levelup-foreign-option";
const MOVE_CHIP    = ".stonetop-levelup-move-chip[data-move-group]";
const FOREIGN_CHIP = ".stonetop-levelup-foreign-chip";

export class LevelUpDialog extends StonetopDialog {
	constructor(character, levelUpData, onDone, options = {}) {
		super(options);
		this._character  = character;
		this._data       = levelUpData;
		this._step       = "overview"; // "overview" | "move" | "foreignMove" | "stat" | "marks" | "invocation"
		this._selectedMoveId         = null;
		this._selectedStat           = null;
		this._selectedInvocationSlug = null;
		// Level-up mark step (Veteran Crew / Well Versed / … and Potential for Greatness):
		// the picks made this take, each { slug, stat? } (stat only for a stat-choice option).
		this._selectedMarks          = [];
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
		this._onDone = onDone;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-levelup-dialog",
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
		// Capture the previous step's CENTER before re-rendering. A step change
		// resizes the window; without this it would grow from a fixed corner (or
		// Foundry would re-center it in the viewport, reading as a jump). Re-centering
		// on this point keeps the new, larger window centered over the old one.
		// Null on first render (no prior position), where Foundry centers us.
		const p = this.position;
		const prevCenter = [p?.left, p?.top, p?.width, p?.height].every(Number.isFinite)
			? { x: p.left + p.width / 2, y: p.top + p.height / 2 }
			: null;
		await super._render(force, options);
		this._applyStepSize(prevCenter);
	}

	// Resize the window to match the active step — but only when the step actually
	// changes, so a manual resize while picking moves isn't snapped back on the
	// re-render a move click triggers. Every step fits its own content height (a CSS
	// `max-height` caps the tall move/invocation lists so they scroll rather than
	// balloon); only the width differs — the move, foreign-move, and invocation
	// pickers widen for their two-column grids (LEVELUP_WIDE_STEPS). So a short step
	// like the stat picker shrinks back down instead of hanging at the wide size. When
	// `prevCenter` is known the window is re-centered on it so the resize stays put.
	_applyStepSize(prevCenter = null) {
		if (this._sizedStep === this._step) return;
		this._sizedStep = this._step;
		const width = LEVELUP_WIDE_STEPS.includes(this._step) ? LEVELUP_MOVE_WIDTH : LEVELUP_BASE_WIDTH;
		// Apply the new width + fit-to-content height first so Foundry resolves the
		// final height, then recenter using the now-known dimensions.
		this.setPosition({ width, height: "auto" });
		if (prevCenter) {
			this.setPosition({
				left: prevCenter.x - this.position.width / 2,
				top:  prevCenter.y - this.position.height / 2,
			});
		}
	}

	getData() {
		const d = this._data;
		const isOverview    = this._step === "overview";
		const isMove        = this._step === "move";
		const isForeignMove = this._step === "foreignMove";
		const isStat        = this._step === "stat";
		const isMarks       = this._step === "marks";
		const isInvocation  = this._step === "invocation";

		const markDesc     = this._markStepDescriptor();
		// The wizard's final step — no active step remains after the current one. See
		// LEVELUP_STEPS / _adjacentStep for the single source of step order + skip logic.
		const isLastStep = this._adjacentStep(+1) === undefined;

		const playbookName = d.playbookName ?? null;

		const moves = d.availableMoves.map(m => ({
			compendiumId:  m.compendiumId,
			name:          m.name,
			description:   m.description,
			requiresLabel: m.requiresLabel,
			groupsAttr:    moveGroupKeys(playbookName, m.name).join(" "),
			selected:      m.compendiumId === this._selectedMoveId,
		}));

		const lockedMoves = d.lockedMoves.map(m => ({
			compendiumId:  m.compendiumId,
			name:          m.name,
			description:   m.description,
			requiresLabel: m.requiresLabel,
			groupsAttr:    moveGroupKeys(playbookName, m.name).join(" "),
		}));

		// Mirror the Invocations tab: when the hover-descriptions setting is on, wrap the
		// "Reduced:" / "Empowered:" labels so they carry the same explanatory tooltip here.
		const showEffectTips = getHoverDescriptionSetting("hoverDescriptionsInvocations");
		const invocations = d.availableInvocations.map(inv => ({
			slug:        inv.slug,
			label:       inv.label,
			description: showEffectTips ? annotateInvocationEffects(inv.description ?? "") : inv.description,
			selected:    inv.slug === this._selectedInvocationSlug,
		}));

		// Foreign-move picker (cross-playbook moves): the qualifying foreign moves, with a
		// text filter. An empty list (nothing qualifies) still allows Continue — e.g. an
		// Initiate take that grants only the Sacred Pouch.
		const foreignMoves = this._foreignMoves.map(m => ({
			compendiumId:  m.compendiumId,
			name:          m.name,
			description:   m.description,
			playbook:      m.playbook,
			requiresLabel: m.requiresLabel ?? null,
			selected:      m.compendiumId === this._selectedForeignMoveId,
		}));

		// Source-playbook chips beside the foreign-move search. Derived from the moves
		// actually offered (so a chip can never filter to nothing) rather than from the
		// full playbook roster, and only worth showing once two or more are represented —
		// a cross-playbook move naming a single playbook needs no filter.
		const foreignPlaybooks = this._foreignPlaybookChips();

		// How many distinct options are actually SELECTABLE this take (a count option with a
		// free box). The required allowance is capped to this, so a budgeted move whose budget
		// exceeds its distinct options (e.g. Beast of Legend's 2 options on a 3-pick take) can
		// never trap the player — one pick per option means the budget is filled as far as it
		// can be, with the rest markable later on the sheet.
		const markSelectable = markDesc ? markDesc.options.reduce((n, o) => o.existing < o.capacity ? n + 1 : n, 0) : 0;
		const markAllowance = markDesc ? Math.min(markDesc.allowance, markSelectable) : 0;

		// The mark step is satisfied when this take's allowance of picks is made (the player
		// opted for "require the pick" over deferring a budgeted move's marks to the sheet).
		const marksComplete = !!markDesc && this._selectedMarks.length === markAllowance;

		const canContinue = isOverview
			|| (isMove && this._selectedMoveId !== null)
			|| (isForeignMove && (this._selectedForeignMoveId !== null || foreignMoves.length === 0))
			|| (isStat && this._selectedStat !== null)
			|| (isMarks && marksComplete)
			|| (isInvocation && this._selectedInvocationSlug !== null);

		// Stat-increase step: the six stats, greying out any already at the chosen
		// move's cap (+2 Improved / +3 Superior).
		const selectedEntry = this._selectedMoveEntry();
		const statCap = selectedEntry?.cap ?? null;
		const statOptions = (d.stats ?? []).map(s => ({
			...s,
			valueLabel: s.value >= 0 ? `+${s.value}` : `${s.value}`,
			atCap:      statCap != null && s.value >= statCap,
			selected:   s.key === this._selectedStat,
		}));

		// Mark step (a budgeted move just picked): each option is a clickable checkbox-style
		// row. A picked option highlights; an unpicked one locks when it's full or the take's
		// allowance is spent (an allowance of 1 just swaps the lone pick instead of locking).
		const markStep = markDesc ? {
			moveName:  markDesc.moveName,
			allowance: markAllowance,
			used:      this._selectedMarks.length,
			options: markDesc.options.map(o => {
				const selected = this._selectedMarks.some(p => p.slug === o.slug);
				const hasRoom  = o.existing < o.capacity;
				return {
					slug: o.slug, label: o.label, selected,
					existingLabel: o.existing > 0 ? `marked ×${o.existing}` : null,
					disabled: !selected && (!hasRoom || (this._selectedMarks.length >= markDesc.allowance && markDesc.allowance !== 1)),
				};
			}),
		} : null;

		return {
			isOverview,
			isMove,
			isForeignMove,
			isStat,
			isMarks,
			isInvocation,
			isLastStep,
			markStep,
			canContinue,
			// Playbook avatar art, shown beside the intro of steps unique to one playbook
			// (currently only the Lightbearer-only invocation step) to brand them.
			playbookName:    d.playbookName,
			playbookIcon:    playbookIconPath(d.playbookSlug),
			newLevel:        d.newLevel,
			cost:            d.cost,
			xpRemaining:     d.xpRemaining,
			moves,
			hasMoves:        moves.length > 0,
			lockedMoves,
			hasLockedMoves:  lockedMoves.length > 0,
			showLockedMoves: this._showLockedMoves,
			moveGroups:      moveGroupsForPlaybook(playbookName),
			showMoveFilter:  moves.length > 0 || (this._showLockedMoves && lockedMoves.length > 0),
			invocations,
			needsInvocation: d.needsInvocation,
			statOptions,
			statMoveName:    selectedEntry?.name ?? null,
			statCap,
			statAllAtCap:    statOptions.length > 0 && statOptions.every(s => s.atCap),
			foreignMoves,
			foreignPlaybooks,
			hasForeignMoves: foreignMoves.length > 0,
			foreignMovesEmpty: isForeignMove && foreignMoves.length === 0,
			foreignFromMoveName: selectedEntry?.name ?? null,
			foreignGrantsPouch:  !!selectedEntry?.crossPlaybook?.grantsPossession,
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
	_markStepDescriptor() {
		const entry = this._selectedMoveEntry();
		return entry?.markOptions?.length ? this._buildPickedMoveMarkStep(entry) : null;
	}

	// Drives navigation routing — a mark step follows the move/foreign/stat steps.
	_needsMarkChoice() {
		return !!this._markStepDescriptor();
	}

	// Whether a given step is part of THIS level-up; the optional steps appear only when
	// their move-driven predicate fires (`overview`/`move` are always present).
	_stepActive(step) {
		switch (step) {
			case "foreignMove": return this._needsForeignMoveChoice();
			case "stat":        return this._needsStatChoice();
			case "marks":       return this._needsMarkChoice();
			case "invocation":  return !!this._data?.needsInvocation;
			default:            return true; // overview, move
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
	// repeat-scaling budget minus what's already spent). Stat-choice options are skipped —
	// only Potential for Greatness has them, and it's served by its own precomputed step.
	_buildPickedMoveMarkStep(entry) {
		const ownedCountAfter = (entry.ownedIds?.length ?? 0) + 1; // this level-up adds one copy
		const budgetMax = moveMarkBudget(entry.markBudget, ownedCountAfter);
		const marksForMove = this._data?.marks?.[entry.name] ?? {};
		const len = v => Array.isArray(v) ? v.length : (typeof v === "number" ? v : 0);
		const options = (entry.markOptions ?? [])
			.filter(o => o.choice !== "stat")
			.map(o => ({ slug: o.slug, label: o.label, choice: "count", capacity: o.marks ?? 1, existing: len(marksForMove[o.slug]) }));
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

	activateListeners(html) {
		super.activateListeners(html);

		// Move / invocation descriptions are enriched move HTML that can contain
		// bulleted option lists; give them the same spiral bullets as the sheet.
		for (const desc of html.find(".stonetop-levelup-move-description, .stonetop-levelup-invocation-description, .stonetop-levelup-foreign-description")) {
			markProseSpiralBullets(desc);
		}

		html.find(`${MOVE_CARD}:not(.is-locked)`).on("click", ev => {
			this._selectedMoveId = ev.currentTarget.dataset.compendiumId;
			// Drop any stat / foreign-move / mark pick from a previously-selected move so they
			// re-validate against the new move (a non-stat / non-cross-playbook move ignores them).
			this._selectedStat = null;
			this._selectedForeignMoveId = null;
			this._foreignMoves = [];
			this._foreignMovesForId = null;
			this._selectedMarks = [];
			this.render(false);
		});

		html.find(".stonetop-levelup-foreign-option").on("click", ev => {
			this._selectedForeignMoveId = ev.currentTarget.dataset.compendiumId;
			this.render(false);
		});
		// Foreign-move search + source-playbook chips (pure DOM show/hide, mirroring the
		// move step; state lives on the instance so a pick — which re-renders — keeps both).
		const applyForeignFilter = () => {
			const q = this._foreignSearch.trim().toLowerCase();
			this._applyCardFilter(html, FOREIGN_CARD, ".stonetop-levelup-foreign-no-matches", el => {
				const textMatch     = !q || el.textContent.toLowerCase().includes(q);
				const playbookMatch = !this._activeForeignPlaybook || el.dataset.playbook === this._activeForeignPlaybook;
				return textMatch && playbookMatch;
			});
		};
		const foreignSearch = html.find(".levelup-foreign-search");
		foreignSearch.val(this._foreignSearch);
		foreignSearch.on("input", ev => { this._foreignSearch = ev.currentTarget.value; applyForeignFilter(); });
		html.find(FOREIGN_CHIP).on("click", ev => {
			const key = ev.currentTarget.dataset.playbook;
			this._activeForeignPlaybook = this._activeForeignPlaybook === key ? null : key; // tap again to clear
			this._paintChips(html, FOREIGN_CHIP, "playbook", this._activeForeignPlaybook);
			applyForeignFilter();
		});
		// Restore the active-chip highlight and apply the current filter after each render.
		this._paintChips(html, FOREIGN_CHIP, "playbook", this._activeForeignPlaybook);
		applyForeignFilter();

		html.find(".stonetop-levelup-stat-option:not(.is-at-cap)").on("click", ev => {
			this._selectedStat = ev.currentTarget.dataset.statKey;
			this.render(false);
		});

		// ── Mark step (budgeted moves: Veteran Crew / Heroes to the Last / …) ──────────
		// Count options toggle; once this take's allowance is spent, a single-pick step
		// swaps the lone pick instead of locking.
		const markDesc = this._markStepDescriptor();
		html.find(".stonetop-levelup-mark-option:not(.is-at-cap)").on("click", ev => {
			const slug = ev.currentTarget.dataset.markSlug;
			const i = this._selectedMarks.findIndex(p => p.slug === slug);
			if (i >= 0) this._selectedMarks.splice(i, 1);                                        // deselect
			else if (markDesc && this._selectedMarks.length < markDesc.allowance) this._selectedMarks.push({ slug });
			else if (markDesc && markDesc.allowance === 1) this._selectedMarks = [{ slug }];     // single-pick: replace
			this.render(false);
		});

		// ── Move search + group chips ─────────────────────────────────────
		// Pure DOM show/hide, mirroring the onboarding move picker. Filter state
		// lives on the instance so a move click (which re-renders) doesn't lose it;
		// we re-apply it below on every render.
		const applyMoveFilter = () => {
			const query = this._moveSearch.trim().toLowerCase();
			this._applyCardFilter(html, MOVE_CARD, ".stonetop-levelup-move-no-matches", el => {
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

		html.find(".stonetop-levelup-invocation-option").on("click", ev => {
			this._selectedInvocationSlug = ev.currentTarget.dataset.slug;
			this.render(false);
		});

		html.find(".stonetop-levelup-back-btn").on("click", () => {
			const prev = this._adjacentStep(-1);
			if (prev) this._step = prev; // undefined only at overview — stay put
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
					// The foreign-move picker needs its qualifying list fetched before it shows.
					if (next === "foreignMove") await this._loadForeignMoves();
					this._step = next;
				}
				this.render(false);
			});
		});
	}

	async _apply() {
		const entry = this._selectedMoveEntry();
		const choices = {};
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
		// Mark-step picks (a budgeted move just taken, or the Would-Be Hero's Potential for
		// Greatness). Threaded INDEPENDENTLY of the stat/cross branches above, so a Would-Be
		// Hero who took Improved Stat or a cross-playbook move still records this level's mark.
		const markDesc = this._markStepDescriptor();
		if (markDesc && this._selectedMarks.length) {
			choices.marks = { moveName: markDesc.moveName, picks: this._selectedMarks };
		}
		await this._character.applyLevelUp(this._selectedMoveId, this._selectedInvocationSlug, Object.keys(choices).length ? choices : null);
		// Hand back the chosen move's name so the sheet can auto-open the sacred-pouch
		// editor when a Blessed levels into Big Magic (an additional remarkable trait).
		if (this._onDone) this._onDone(entry?.name ?? null);
		this.close();
	}
}
