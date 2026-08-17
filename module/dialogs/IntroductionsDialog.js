import { bringDialogToFront } from "../utils/front-on-open.js";
import { deletionEntry } from "../utils/foundry-compat.js";
import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { shuffle } from "../utils/arrays.js";
import { stonetopSteadingHeaderButton } from "../utils/world.js";
import { playbookSlug, getPlayerCharacters, playbookIconPath, orderByCombatTurns } from "../utils/playbook-actors.js";
import { wrapLoreTerms } from "../utils/lore-terms.js";
// Authored prompts/questions live in introductions-data.js so the Chronicle
// compiler can resolve a recorded answer's question index back to its text.
import { INTRO_PLAYBOOK_DATA as _PLAYBOOK_DATA } from "./introductions-data.js";
import { saveChronicleFromButton, writeChronicle } from "../utils/chronicle.js";
import { getSetting, setSetting } from "../settings.js";
import { getWalkthroughResume, patchWalkthroughResume, markWalkthroughDone, saveWalkthroughPosition } from "./walkthrough-resume.js";
// Pure round-robin/done logic for the looping answer/ask steps (unit-tested).
import { stepPcDone, nextActiveIndex, firstActiveIndex, turnsUntilActive, cursorReaction, cursorPositionKey } from "./introductions-flow.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { escHtml } from "../utils/strings.js";
import { findOpenApp } from "../utils/open-windows.js";
import { SYSTEM_ID } from "../system-id.js";

// The player-authored answer/ask step data lives on the PC actor flag
// flags.stonetop-pwd.intro. Scope MUST be the system id "stonetop-pwd" (not "stonetop",
// which points at read-only pack-baked flags and throws).
const _FLAG_SCOPE = SYSTEM_ID;
const _INTRO_FLAG = "intro";

// The world setting holding the answers recorded during the introductions, keyed
// by actor id → { r1, r2, r3 (strings); step4/step6 ({ answers, passed }); legacy
// r4–r7 }. Compiled into the Chronicle journal by utils/chronicle.js. See settings.js.
const _ANSWERS_SETTING = "introductionsAnswers";

// The GM-driven session cursor (whose turn / which step). GM writes it; every client
// reacts via its onChange to open/focus/close the dialog. See settings.js.
const _CURSOR_SETTING = "introCursor";

// Key for this dialog's reload-resume record (round + turn + open flag) in the
// shared walkthroughResume setting. See walkthrough-resume.js.
const _RESUME_KEY = "introductions";
// Resume-blob schema version. A save without `v` predates the collapse of the old 8-round
// flow (rounds 4/5 = the two "answer" laps, 6/7 = the two "ask" laps, 8 = the finale) into
// today's looping steps (4 = answer, 5 = ask, 6 = final); _restorePosition remaps those.
const _RESUME_VERSION = 2;
const _LEGACY_RESUME_PHASE_MAP = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4, 6: 5, 7: 5, 8: 6 };

// Placeholder copy for the narration rounds (1–3); the answer/ask steps set their
// own from whether the PC is answering or asking.
const _NARRATE_PLACEHOLDER = {
	1: "Name, pronouns, background, origin, appearance…",
	2: "Their special possessions, and how they help the village…",
	3: "Their answer…",
};

// ── Phase definitions ─────────────────────────────────────────────────────────
// Index = phase number (1-6); index 0 unused (phase 0 = pre-check). The two "go
// around again" laps of the old flow are collapsed into single LOOPING steps: the
// answer step (kind "answer", stepKey "step4") and the ask step (kind "ask",
// stepKey "step6") each cycle the table until every PC has passed or answered all
// four of their playbook's questions. Narration phases (kind "narrate") are a single
// linear pass storing a string under roundKey. The final phase (kind "final") is not
// round-robin. `title` labels the step in the nav.

const _PHASES = [
	null,
	{
		kind: "narrate", title: "Introduce yourself", icon: "fa-user", roundKey: "r1",
		getInstruction: () => `On your <strong>first turn</strong>, <strong>introduce yourself</strong>: your name, pronouns, background, origin, and appearance.`,
		getQuestions:   () => null,
	},
	{
		kind: "narrate", title: "Possessions & contribution", icon: "fa-hand-holding-heart", roundKey: "r2",
		getInstruction: () => `On your <strong>second turn</strong>, <strong>describe your special possessions</strong> and how you contribute to the village (beyond working the fields).`,
		getQuestions:   () => null,
	},
	{
		kind: "narrate", title: "Your place in Stonetop", icon: "fa-location-dot", roundKey: "r3",
		getInstruction: (pc) => {
			const d = _PLAYBOOK_DATA[playbookSlug(pc)];
			return d
				? `On your <strong>third turn</strong>, ${d.step3}`
				: `On your <strong>third turn</strong>, tell us something about your character and their place in Stonetop.`;
		},
		getQuestions: () => null,
	},
	{
		kind: "answer", title: "Bonds & ties", icon: "fa-link", stepKey: "step4",
		getInstruction: () => `<strong>Answer a question</strong> from your playbook, naming one or more NPCs who live in Stonetop. Each turn, answer another, or pass. When everyone has passed, go on.`,
		getQuestions:   (pc) => _PLAYBOOK_DATA[playbookSlug(pc)]?.step4 ?? null,
	},
	{
		kind: "ask", title: "Asking the others", icon: "fa-comments", stepKey: "step6",
		getInstruction: () => `<strong>Ask your fellow PCs one of these.</strong> When others ask you, answer as you like. Each turn, ask another, or pass. When everyone has passed, go on.`,
		getQuestions:   (pc) => _PLAYBOOK_DATA[playbookSlug(pc)]?.step6 ?? null,
	},
	{
		kind: "final", title: "Let spring break forth", icon: "fa-seedling",
		getInstruction: () => `<strong>Add each player's home</strong> to Stonetop's Places of Interest. When everyone is done, <strong>let spring break forth!</strong><span class="stonetop-intros-instruction-note">Players can reach the Stonetop playbook by hitting the <strong>Stonetop</strong> button in the navbar of their character sheet.</span>`,
		getQuestions:   () => null,
	},
];

// The last real phase (the final "let spring break forth" screen).
const _LAST_PHASE = _PHASES.length - 1;

// A round-robin phase goes around the table (narration + the two steps); only the
// final phase does not. A "step" phase is a looping answer/ask step.
const _isRoundRobin = (phase) => !!phase && phase.kind !== "final";
const _isStep       = (phase) => !!phase && (phase.kind === "answer" || phase.kind === "ask");

// ── Helpers ───────────────────────────────────────────────────────────────────

// Player characters on the combat tracker, in the GM's arranged turn order; [] before
// a combat is set up. Resolves to roster actors so the ids line up with
// getPlayerCharacters() (getData compares the two by id).
function _getCombatPcs() {
	return orderByCombatTurns(getPlayerCharacters());
}

// A chosen-question index normalized to an int, or null (no/blank prompt).
const _normQ = (v) => (Number.isInteger(v) ? v : null);

// ── IntroductionsDialog ───────────────────────────────────────────────────────

export class IntroductionsDialog extends StonetopDialog {
	constructor(options = {}) {
		super(options);
		this._phase       = 0;
		this._pcIndex     = 0;
		this._pcs         = [];
		this._combatHooks = null;
		this._introHook   = null;
		this._liveDraftTimer = null;
		// One-shot: a commit has just cleared the live draft, so the re-render that follows
		// must NOT flush the (still un-rebuilt) capture DOM back into it. See _commitStep.
		this._skipDraftFlushOnce = false;
		// The cursor position this dialog is currently DRAWN at (see cursorPositionKey),
		// recorded by _syncFromCursor. handleIntroCursor compares against it to tell a real
		// move from one of the same-position writes a single turn attracts.
		this._cursorKey   = null;
	}

	// Entry point used by the Welcome guide / macro: auto-populate the Combat Tracker
	// with every playbook-bearing character (GM only), then show the dialog. The GM
	// resumes its own saved position; a player seeds their phase/turn from the shared
	// cursor (the GM drives; players follow).
	static async open() {
		const existing = IntroductionsDialog._current();
		if (existing) { existing.bringToTop(); return existing; }
		// Guard against two near-simultaneous open() calls racing before the first instance
		// registers in ui.windows — on a player reload the ready hook fires both
		// reopenOpenWalkthroughs and openForActiveSession, and without this both would see
		// _current() null and stack two dialogs. Coalesce them onto one in-flight open.
		if (IntroductionsDialog._opening) return IntroductionsDialog._opening;
		IntroductionsDialog._opening = IntroductionsDialog._doOpen();
		try { return await IntroductionsDialog._opening; }
		finally { IntroductionsDialog._opening = null; }
	}

	static async _doOpen() {
		const dialog = new IntroductionsDialog();
		try {
			await dialog.ensureCombatRoster();
		} catch (err) {
			console.error("Stonetop | Introductions: failed to set up the combat tracker", err);
		}
		// Combat is set up first so the resumed/seeded round-robin has its PC list.
		if (game.user?.isGM) {
			// A GM with no saved local position (a fresh browser/tab) but a live session must
			// follow the running cursor, NOT reset to the pre-check — landing on phase 0 and
			// re-rendering would otherwise tear the session down for everyone.
			if (!dialog._restorePosition() && dialog._cursor().active) dialog._syncFromCursor();
		} else {
			dialog._syncFromCursor();
		}
		return dialog.render(true);
	}

	// The currently open dialog instance, if any. Checks both app registries so this
	// keeps working if the dialog is ever migrated to ApplicationV2 (see open-windows.js);
	// silently answering null would stack a second copy on every cursor write.
	static _current() {
		return findOpenApp(w => w instanceof IntroductionsDialog);
	}

	// onChange handler for the world cursor (wired in Ready.js). Runs on every client.
	// The PRIMARY GM authors the cursor, so it ignores its own writes; everyone else —
	// players AND any secondary/assistant GM — follows it (so a second GM can't drive a
	// conflicting turn). A player opens/focuses the dialog when it becomes their turn on any
	// round-robin round they author (narration or answer/ask step), follows read-only
	// otherwise, and closes when the session ends.
	//
	// What to do is decided by cursorReaction (pure, unit-tested); this only carries out the
	// verdict and keeps the bookkeeping it hands back. The two gates that matter to a player
	// mid-sentence — repaint only when the screen is actually out of date, raise only on a
	// real hand-off — live there with their reasoning.
	static handleIntroCursor(cursor = {}) {
		if (game.user?.isGM && isPrimaryGM()) return; // the author ignores its own writes
		const dialog = IntroductionsDialog._current();
		const act = cursorReaction({
			cursor,
			prevKey:       dialog?._cursorKey ?? null,
			userId:        game.user?.id ?? "",
			isRoundRobin:  _isRoundRobin(_PHASES[cursor.phase]),
			hasDialog:     !!dialog,
			// The caret being inside this window is what makes a repaint destructive: it
			// rebuilds the capture textarea from the stored value mid-word.
			typing:        !!dialog?.element?.[0]?.contains(document.activeElement),
			lastShowNonce: IntroductionsDialog._lastShowNonce,
			lastTurnKey:   IntroductionsDialog._lastTurnKey,
		});
		IntroductionsDialog._lastShowNonce = act.showNonce;
		IntroductionsDialog._lastTurnKey   = act.turnKey;

		if (act.close) { dialog?.close(); return; }
		// Toast the player the moment the turn lands on them, so they notice even when the
		// dialog is already open behind another window or off-screen.
		if (act.toast) IntroductionsDialog._notifyMyTurn(cursor);

		if (dialog) {
			// Always sync the local phase/turn (and re-record _cursorKey) even when the
			// repaint is deferred: the state must not lag the cursor, only the DOM may.
			dialog._syncFromCursor();
			if (act.render) dialog.render(false);
			if (act.raise)  dialog.bringToTop();
			return;
		}
		if (act.open) IntroductionsDialog.open();
	}

	// The one-shot "your turn" toast, phrased to match the phase: narrate / answer / ask.
	// Whether this is a NEW turn (rather than one of the repeated writes a single turn
	// attracts) is cursorReaction's call; by here it has already been made.
	static _notifyMyTurn(cursor) {
		const kind = _PHASES[cursor.phase]?.kind;
		const what = kind === "ask" ? "ask the others a question"
			: kind === "answer" ? "answer a question"
			: "share your introduction";
		ui.notifications?.info(`Character Introductions: it's your turn to ${what}.`);
	}

	// Ready-time seed for a player who logs in / reloads mid-introductions: open the
	// dialog whenever a session is running (the GM has it open on phase 1+), so the reload
	// drops them back into it — read-only until it's their turn. onChange
	// (handleIntroCursor) covers live changes; this covers the no-event initial load.
	// Unlike onChange, opening here is NOT gated on its being the player's turn — a reload
	// should always rejoin the running session — but the "open only on your turn / GM
	// force-show" rule still governs live cursor writes, so a player who deliberately closes
	// their window mid-session isn't re-summoned on every keystroke nonce bump.
	static openForActiveSession() {
		if (game.user?.isGM) return;
		const cursor = getSetting(_CURSOR_SETTING) ?? {};
		// Baseline the show-nonce so a "Show players" click from BEFORE this load doesn't
		// re-summon the dialog on every reload — only a live click after now force-opens it.
		IntroductionsDialog._lastShowNonce = Number.isInteger(cursor.showNonce) ? cursor.showNonce : -1;
		// Let handleIntroCursor run its turn toast / focus bookkeeping first (it opens on the
		// player's turn); then, if a session is active but it isn't their turn, open the
		// dialog anyway so the reload rejoins them. open()'s _current/_opening guards coalesce
		// this with the reopen from the walkthrough resume, so it never stacks two dialogs.
		IntroductionsDialog.handleIntroCursor(cursor);
		if (cursor.active && !IntroductionsDialog._current()) IntroductionsDialog.open();
	}

	// Ensure an active combat exists and every player character (any actor with a
	// playbook) is in it. Only the GM can mutate combat, so this is a no-op for
	// players — they just see whatever the GM has already set up.
	async ensureCombatRoster() {
		if (!game.user?.isGM) return;

		const actors = getPlayerCharacters();
		if (!actors.length) return;

		let combat = game.combat;
		if (!combat) {
			const CombatCls = getDocumentClass("Combat");
			combat = await CombatCls.create({ scene: canvas?.scene?.id ?? null });
			await combat?.activate?.();
		}
		if (!combat) return;

		const present = new Set(combat.combatants.map(c => c.actorId));
		const toAdd   = actors.filter(a => !present.has(a.id));
		if (!toAdd.length) return;

		await combat.createEmbeddedDocuments("Combatant", toAdd.map(a => ({
			actorId: a.id,
			name:    a.name,
			img:     a.img,
		})));
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-introductions",
			title:     "Character Introductions",
			template:  "systems/stonetop-pwd/templates/dialogs/introductions.hbs",
			// The PRIMARY GM gets a jump-to-step rail (see getData's `steps`), so seat it a
			// little wider — matching the Expedition dialog's 640. Players and secondary GMs
			// have no rail and keep the narrower single column.
			width:     (game.user?.isGM && isPrimaryGM() ? 640 : 520),
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-introductions"],
		});
	}

	async _render(force, options) {
		// Persist whatever's typed in the editable capture field to its flag BEFORE the DOM is
		// rebuilt. The narration rounds have no player commit button (only autosave), so a turn
		// advance — the GM's Next writes the cursor, which re-renders this dialog whether or not
		// the player is mid-word, because their turn may just have ended — would otherwise drop
		// the last, not-yet-debounced characters (a removed focused textarea doesn't reliably
		// fire its blur `change`). Flushing here catches every re-render path, so a player's
		// introduction survives the hand-off. Same-position cursor writes don't reach here at
		// all while they type: cursorReaction defers those instead.
		await this._flushCaptureFromDom();
		await super._render(force, options);
		// Record where we are + that we're open, so a reload can reopen here. Every
		// render reflects the current round/turn (navigation always re-renders).
		this._saveResume();
		// GM: mirror the current phase/turn into the world cursor so players' dialogs
		// open/follow. Skips a no-op write; players never write world settings.
		this._syncCursorFromLocal();
	}

	// GM-only "Stonetop" shortcut in the window header — mirrors the steading button
	// on the character sheet header (StonetopCharacterSheet._getHeaderButtons) — so the
	// GM can jump to the steading's Places of Interest while running introductions.
	// Players are pointed to their own sheet's button by the final-round note.
	_getHeaderButtons() {
		const buttons = super._getHeaderButtons();
		if (game.user?.isGM) {
			// Force-open the dialog on every player's screen at the GM's current spot — for
			// when a player closed it (the cursor otherwise only re-opens on a turn change).
			buttons.unshift({
				label: "Show players",
				class: "stonetop-intros-show-players",
				icon:  "fas fa-eye",
				onclick: () => this._showPlayers(),
			});
			buttons.unshift(stonetopSteadingHeaderButton());
		}
		return buttons;
	}

	// GM: bump the cursor's showNonce so every player's dialog force-opens at the current
	// phase/turn (which the cursor already carries, written on each render). No-op when no
	// session is running.
	_showPlayers() {
		if (!game.user?.isGM) return;
		const cur = this._cursor();
		if (!cur.active) {
			ui.notifications?.info("Begin the introductions first, then you can show them to your players.");
			return;
		}
		this._writeCursor({ showNonce: (Number(cur.showNonce) || 0) + 1 });
		ui.notifications?.info("Opened the introductions on your players' screens.");
	}

	activateListeners(html) {
		super.activateListeners(html);
		html.find(".stonetop-intros-shuffle").on("click", () => this._shuffleOrder());
		html.find(".stonetop-intros-begin").on("click", () => this._begin());
		html.find(".stonetop-intros-next").on("click",  () => this._advance());
		html.find(".stonetop-intros-pass").on("click",  () => this._confirmPass());
		html.find(".stonetop-intros-done").on("click",  () => this._recordCurrentDraft());
		html.find(".stonetop-intros-back").on("click",  () => this._retreat());
		html.find(".stonetop-intros-close").on("click", ev => this._finish(ev.currentTarget));
		// GM sidebar: jump straight to a step (the shared TOC-rail chrome).
		html.find(".stonetop-guide-toc-btn").on("click", ev => this._jumpToPhase(Number(ev.currentTarget.dataset.stepIndex)));

		// Narration rounds (1–3): the single plain-string answer, written near-live on input
		// (debounced) so the GM watches the player type, and again on blur (change). Same
		// actor-flag path as the step draft, so a player authors their own introduction.
		html.find(".stonetop-intros-answer").on("input", ev => {
			const el = ev.currentTarget;
			this._setSaveStatus("saving");
			this._scheduleNarration(el.dataset.actorId, el.dataset.roundKey, el.value);
		});
		html.find(".stonetop-intros-answer").on("change", async ev => {
			const el = ev.currentTarget;
			this._cancelLiveDraft();
			await this._saveNarration(el.dataset.actorId, el.dataset.roundKey, el.value);
			this._setSaveStatus("saved");
		});
		// Answer/ask steps: the in-progress draft answer. Written near-live on input
		// (debounced ~300ms) so the GM watches it appear as it's typed, and again on blur
		// (change) so a Next right after typing captures the last characters. The local
		// updateActor re-render is suppressed while this field is focused, so the writer's
		// own textarea is never reset mid-word; the watching client (not focused) refreshes.
		// The selected question is snapshotted at input time (not re-read when the debounced
		// write fires) and the timer is cancellable, so a keystroke that lands after the turn
		// has moved on can't resurrect a just-cleared draft with the next PC's question. It is
		// snapshotted from the FLAG, not from the highlighted button: a pick writes the flag and
		// only then re-renders, so between the two the DOM is a render behind — and a blur
		// `change` fires exactly there, when clicking a question is what moved focus off the
		// textarea. Reading the DOM wrote the old pick back over the new one.
		const pickedQ = (actorId, stepKey) => this._stepDraft(actorId, stepKey).q;
		html.find(".stonetop-intros-draft").on("input", ev => {
			const el = ev.currentTarget;
			this._setSaveStatus("saving");
			this._scheduleLiveDraft(el.dataset.actorId, el.dataset.stepKey, pickedQ(el.dataset.actorId, el.dataset.stepKey), el.value);
		});
		html.find(".stonetop-intros-draft").on("change", async ev => {
			const el = ev.currentTarget;
			this._cancelLiveDraft();
			await this._saveDraft(el.dataset.actorId, el.dataset.stepKey, { q: pickedQ(el.dataset.actorId, el.dataset.stepKey), a: el.value });
			this._setSaveStatus("saved");
		});
		// Pick (or toggle off) which question the draft answers/asks, preserving any typed
		// text, then re-render to move the highlight and update the answered gray-out.
		html.find(".stonetop-intros-question-pick").on("click", async ev => {
			const el      = ev.currentTarget;
			const idx     = Number(el.dataset.qIndex);
			const current = this._stepDraft(el.dataset.actorId, el.dataset.stepKey).q;
			const domA    = this.element?.[0]?.querySelector(".stonetop-intros-draft")?.value ?? "";
			this._cancelLiveDraft();
			await this._saveDraft(el.dataset.actorId, el.dataset.stepKey, { q: current === idx ? null : idx, a: domA });
			this.render(false);
		});

		this._registerCombatHooks();
		this._registerIntroHooks();
	}

	// The recorded answers blob. The GM (the only writer) edits through an in-memory
	// draft so rapid successive saves — e.g. an answer textarea blurring just as a
	// question button is clicked — compose synchronously instead of racing the async
	// world-settings write; players read the persisted value fresh each render.
	_answers() {
		if (game.user?.isGM) return (this._draft ??= { ...(getSetting(_ANSWERS_SETTING) ?? {}) });
		return getSetting(_ANSWERS_SETTING) ?? {};
	}

	// ── Answer/ask step data: the player's own actor flag ──────────────────────
	// The looping answer/ask steps are authored on each PC's own actor flag
	// flags.stonetop-pwd.intro (a write the owning player is always allowed to make —
	// see Phase 3), so it survives reload and a momentarily-absent GM. The GM harvests
	// it into the world-scoped introductionsAnswers (the Chronicle source) below. Shape:
	//   intro = { step4:{answers:[{q,a}],passed}, step6:{…}, live:{stepKey,q,a}|null }
	// where `live` is the single in-progress draft buffer (one step is active at a time).

	_actor(actorId) {
		return game.actors?.get(actorId) ?? null;
	}

	// The actor for a PC only when this client may write its flag (owns it), else null —
	// the shared guard for every player-authored step write below.
	_ownedActor(actorId) {
		const actor = this._actor(actorId);
		return actor?.isOwner ? actor : null;
	}

	_intro(actorId) {
		return this._actor(actorId)?.getFlag(_FLAG_SCOPE, _INTRO_FLAG) ?? {};
	}

	// This PC's committed record for a step: { answers:[{q,a}], passed }.
	_stepRecord(actorId, stepKey) {
		const s = this._intro(actorId)[stepKey];
		return { answers: Array.isArray(s?.answers) ? s.answers : [], passed: !!s?.passed };
	}

	// The in-progress draft ({ q, a }) for a step — the shared `live` buffer, but only
	// when it currently belongs to this step.
	_stepDraft(actorId, stepKey) {
		const live = this._intro(actorId).live;
		return (live && live.stepKey === stepKey)
			? { q: _normQ(live.q), a: typeof live.a === "string" ? live.a : "" }
			: { q: null, a: "" };
	}

	// Update the live draft for a step. Writes the whole live buffer (all three keys)
	// so a step switch or a cleared field can't leave a stale sub-key behind (setFlag
	// deep-merges). No-op without write permission (a non-owning player off-turn), and a
	// no-op when nothing actually changed — so per-keystroke drafting (and the blur `change`
	// that repeats the last input) doesn't spam a document write + broadcast to every client.
	async _saveDraft(actorId, stepKey, { q, a } = {}) {
		const actor = this._ownedActor(actorId);
		if (!actor) return;
		const nq  = _normQ(q);
		const na  = typeof a === "string" ? a : "";
		const cur = this._stepDraft(actorId, stepKey);
		if (cur.q === nq && cur.a === na) return;
		await actor.setFlag(_FLAG_SCOPE, `${_INTRO_FLAG}.live`, { stepKey, q: nq, a: na });
	}

	// Shared 300ms debounce behind the near-live draft/narration writes. Cancellable via the
	// single _liveDraftTimer slot (stored on the instance so it survives re-renders) so a
	// commit / pass / navigation can drop a pending keystroke before it lands — otherwise a
	// write that fires after the turn moved on would resurrect a just-cleared draft on an
	// already-recorded PC. `matchesPhase(phase)` re-checks this is still the same editable
	// turn; the field values are captured at input time by the caller, not re-read from the
	// (possibly re-rendered) DOM here.
	_scheduleLiveWrite(actorId, matchesPhase, write) {
		this._cancelLiveDraft();
		this._liveDraftTimer = setTimeout(async () => {
			this._liveDraftTimer = null;
			const shown = this._pcs?.[this._pcIndex];
			if (!shown || shown.id !== actorId || !matchesPhase(_PHASES[this._phase])) return;
			if (!this._canEditActor(shown)) return;
			await write();
			this._setSaveStatus("saved");
		}, 300);
	}

	// Schedule a debounced live-draft write for an answer/ask step.
	_scheduleLiveDraft(actorId, stepKey, q, a) {
		this._scheduleLiveWrite(actorId,
			phase => _isStep(phase) && phase.stepKey === stepKey,
			() => this._saveDraft(actorId, stepKey, { q, a }));
	}

	_cancelLiveDraft() {
		if (this._liveDraftTimer) { clearTimeout(this._liveDraftTimer); this._liveDraftTimer = null; }
	}

	// Reflect the near-live autosave on the active capture field's status pip: "saving" the
	// instant a keystroke lands, "saved" once the debounced/blur write to the actor flag
	// resolves. There's only ever one editable capture on screen, so this targets the single
	// .stonetop-intros-save-status; a no-op when the field isn't editable (readonly preview)
	// or has already gone (the turn moved on mid-write).
	_setSaveStatus(state) {
		const el = this.element?.[0]?.querySelector(".stonetop-intros-save-status");
		if (el) el.dataset.state = state;
	}

	// Commit the current draft as a recorded answer: append { q, a } to the step's
	// answers list (written whole, since arrays replace wholesale) and clear the live
	// buffer (the -= unset key, since setFlag/update merges). Returns false when the
	// draft has no answer text. A null q is allowed (blank prompt), matching the
	// Chronicle's "answer with no marked question" handling.
	async _recordDraft(actorId, stepKey) {
		const actor = this._ownedActor(actorId);
		if (!actor) return false;
		const draft = this._stepDraft(actorId, stepKey);
		const a     = String(draft.a ?? "").trim();
		if (!a) return false;
		const answers = [...this._stepRecord(actorId, stepKey).answers, { q: _normQ(draft.q), a }];
		await this._commitStep(actor, stepKey, "answers", answers);
		return true;
	}

	// Mark a PC passed (or un-passed) for a step, clearing any half-typed draft.
	async _setPassed(actorId, stepKey, passed) {
		const actor = this._ownedActor(actorId);
		if (!actor) return;
		await this._commitStep(actor, stepKey, "passed", passed);
	}

	// Write one committed step field (answers / passed) and clear the live draft in the
	// same update — the two always go together (recording or passing ends the draft), so
	// centralizing means neither path can forget the `-=live` unset.
	async _commitStep(actor, stepKey, field, value) {
		const [liveKey, liveVal] = deletionEntry(`flags.${_FLAG_SCOPE}.${_INTRO_FLAG}.live`);
		await actor.update({
			[`flags.${_FLAG_SCOPE}.${_INTRO_FLAG}.${stepKey}.${field}`]: value,
			[liveKey]: liveVal,
		});
		// Every commit is followed by a re-render, and _render flushes the capture DOM first —
		// but that DOM still shows the answer just recorded, so the flush would write it
		// straight back as a fresh draft and the next Next would record it a SECOND time.
		// Suppress exactly that one flush; the render after it rebuilds the field empty.
		this._skipDraftFlushOnce = true;
	}

	// ── Narration rounds (1–3): a single plain-string answer, on the PC's own flag ──────
	// Like the answer/ask steps, narration is authored on flags.stonetop-pwd.intro.narration
	// so the active player writes their OWN introduction; the primary GM harvests it into the
	// world setting for the Chronicle. Unlike a step there's no separate draft/commit — the
	// value IS the answer, written near-live. Reads fall back to the legacy world-setting
	// value so a world that recorded narration the old (GM-typed) way still shows it.
	_narration(actorId, roundKey) {
		const val = this._intro(actorId).narration?.[roundKey];
		if (typeof val === "string") return val;
		const legacy = this._answers()[actorId]?.[roundKey];
		return typeof legacy === "string" ? legacy : "";
	}

	async _saveNarration(actorId, roundKey, value) {
		const actor = this._ownedActor(actorId);
		if (!actor) return;
		const na  = typeof value === "string" ? value : "";
		if (this._intro(actorId).narration?.[roundKey] === na) return; // no-op if unchanged
		await actor.setFlag(_FLAG_SCOPE, `${_INTRO_FLAG}.narration.${roundKey}`, na);
	}

	// Debounced near-live narration write (shares the single pending-write slot with the step
	// draft) so a keystroke that lands after navigation can't write the wrong round.
	_scheduleNarration(actorId, roundKey, value) {
		this._scheduleLiveWrite(actorId,
			phase => !_isStep(phase) && _isRoundRobin(phase) && phase.roundKey === roundKey,
			() => this._saveNarration(actorId, roundKey, value));
	}

	// Whether this client may WRITE the given PC's live draft this turn. The active player
	// edits their OWN PC on their turn during an answer/ask step. The PRIMARY GM may also
	// write: it edits narration, GM-only PCs, and turns whose owning player is offline, and on
	// a round-robin turn owned by a present player it CO-EDITS the one shared live-draft buffer
	// alongside them (last-writer-wins; see _hasOnlinePlayerOwner, which drives the "writing
	// together" label). A secondary GM only watches. The GM commits the draft with Next (which
	// reads the flag, not the DOM).
	_canEditActor(actor) {
		if (game.user?.isGM) {
			// Only the PRIMARY GM edits — for a GM-only/offline PC, or CO-EDITING the shared
			// draft alongside a present player on a round-robin turn. A secondary/assistant GM
			// only WATCHES: it authors neither the cursor nor the harvest, and a second GM writer
			// would clobber the single shared draft and double-record answers into the step list.
			return isPrimaryGM();
		}
		if (!actor?.isOwner) return false;
		const cur = this._cursor();
		return !!cur.active && _isRoundRobin(_PHASES[cur.phase])
			&& cur.activeActorId === actor.id && cur.activeUserId === game.user?.id;
	}

	// The owning player's user id for a PC — the non-GM user who owns it, preferring an
	// ONLINE owner (the assigned player first) so a turn is never pinned to an offline user
	// while a present co-owner is locked out; falls back to any owner. "" when no player owns
	// it (a GM-only PC, which then never auto-opens on a player and is driven by the GM).
	_primaryOwnerId(actor) {
		const owners = game.users?.filter(u => !u.isGM && actor?.testUserPermission?.(u, "OWNER")) ?? [];
		const online = owners.filter(u => u.active);
		const pick   = online.find(u => u.character?.id === actor.id) ?? online[0]
			?? owners.find(u => u.character?.id === actor.id) ?? owners[0];
		return pick?.id ?? "";
	}

	// Whether a present (online) player — someone other than this GM — owns the PC. When true
	// on a round-robin turn the GM is CO-EDITING the shared draft alongside that player, not
	// standing in for an absent one; drives the "writing together" capture label. See
	// _canEditActor.
	_hasOnlinePlayerOwner(actor) {
		const ownerId = this._primaryOwnerId(actor);
		return !!ownerId && ownerId !== game.user?.id && !!game.users?.get(ownerId)?.active;
	}

	// The current session cursor blob (never null).
	_cursor() {
		return getSetting(_CURSOR_SETTING) ?? {};
	}

	// GM-only cursor write. Always bumps `nonce` so an otherwise-equal cursor still fires
	// onChange on players (Foundry suppresses equal-value setSetting) — centralizing this
	// means no write path can forget the bump and silently desync a player's dialog.
	//
	// SERIALIZED, because it is a read-modify-write on a world setting and the callers fire in
	// bursts: a showNonce bump followed in the same tick by _syncCursorFromLocal both read the
	// same `cur`, so the second overwrote the first's patch AND reused its nonce — defeating the
	// very "no write path can forget the bump" guarantee this method exists to provide. Chaining
	// off the previous write means each read sees the setting the last one stored.
	_writeCursor(patch) {
		const run = (this._cursorWrite ?? Promise.resolve()).then(() => {
			const cur = this._cursor();
			return setSetting(_CURSOR_SETTING, { ...cur, ...patch, nonce: (Number(cur.nonce) || 0) + 1 });
		});
		// Neutralised link: one failed write must not reject every write queued behind it.
		this._cursorWrite = run.catch(err =>
			console.error("Stonetop | Introductions: cursor write failed", err));
		return run;
	}

	// Primary GM only: mirror this dialog's local phase/turn into the world cursor so every
	// client can follow along. Skips a no-op write; _writeCursor bumps the nonce. Phase 0 is
	// the GM's local pre-check/roster screen, NOT a session end — leaving the cursor untouched
	// there means stepping Back to re-check the roster doesn't close every player's dialog;
	// only close() (a deliberate finish) deactivates the session. Carries the GM-authored PC
	// order so players seed their roster from the cursor, not their own scene-scoped game.combat.
	_syncCursorFromLocal() {
		if (!game.user?.isGM || !isPrimaryGM()) return; // only the primary GM authors the cursor
		const phase = this._phase;
		if (phase < 1 || phase > _LAST_PHASE) return;
		const actor   = _isRoundRobin(_PHASES[phase]) ? (this._pcs[this._pcIndex] ?? null) : null;
		const activeActorId = actor?.id ?? "";
		const activeUserId  = actor ? this._primaryOwnerId(actor) : "";
		const pcOrder = this._pcs.map(a => a.id);
		const cur = this._cursor();
		if (cur.active === true && cur.phase === phase
			&& cur.activeActorId === activeActorId && cur.activeUserId === activeUserId
			&& Array.isArray(cur.pcOrder) && cur.pcOrder.join() === pcOrder.join()) return;
		this._writeCursor({ active: true, phase, activeActorId, activeUserId, pcOrder });
	}

	// Players (and a GM without local nav state) seed their phase/turn from the cursor.
	// Returns false when the cursor isn't running (leaves the dialog on the pre-check). The
	// roster comes from the GM-authored `pcOrder` carried in the cursor — resolved against
	// game.actors (which every client has in full) — so a player whose scene-scoped
	// game.combat is empty or different still gets the right PCs and turn index; falls back
	// to the local combat roster before the GM has written an order.
	_syncFromCursor() {
		const cur = this._cursor();
		// Record what we are now drawn at, so the next cursor write can tell a real move from
		// a same-position bump (see handleIntroCursor).
		this._cursorKey = cursorPositionKey(cur);
		const fromCursor = Array.isArray(cur.pcOrder)
			? cur.pcOrder.map(id => this._actor(id)).filter(a => a && playbookSlug(a))
			: [];
		this._pcs = fromCursor.length ? fromCursor : _getCombatPcs();
		if (!cur.active || !Number.isInteger(cur.phase) || cur.phase < 1 || cur.phase > _LAST_PHASE) {
			this._phase   = 0;
			this._pcIndex = 0;
			return false;
		}
		this._phase   = cur.phase;
		const idx     = this._pcs.findIndex(a => a.id === cur.activeActorId);
		this._pcIndex = idx >= 0 ? idx : 0;
		return true;
	}

	// Total questions this PC's playbook offers for a step (4), used for exhaustion.
	_totalQuestions(actor, phase) {
		return (phase.getQuestions(actor) ?? []).length;
	}

	// Has a PC finished a step (passed or answered all their questions)?
	_isPcDone(actor, phase) {
		return stepPcDone(this._stepRecord(actor.id, phase.stepKey), this._totalQuestions(actor, phase));
	}

	// How many turns until the PC at `myIdx` is up: 0 = it's their turn now, N = N turns
	// away, -1 = they're past/finished (nothing more this round). Narration rounds are a
	// single linear pass (0..N-1); looping steps cycle only the still-active PCs, so a PC
	// that has passed/answered-all is skipped and any finished PC reports -1.
	_turnsUntil(myIdx, phase) {
		const count = this._pcs.length;
		if (!(myIdx >= 0) || count <= 0) return -1;
		if (_isStep(phase)) {
			return turnsUntilActive(this._pcIndex, myIdx, count, i => this._isPcDone(this._pcs[i], phase));
		}
		if (myIdx < this._pcIndex) return -1;   // narration: already had their turn
		return myIdx - this._pcIndex;           // 0 = now, else turns away
	}

	// For a non-GM viewer: a small "place in line" descriptor for their own PC (the
	// soonest-upcoming, if they own more than one) — the copy the template shows while
	// they wait. Null when they own none of the PCs in the run (a pure spectator).
	_myPlaceInLine(phase) {
		const pcs = this._pcs;
		if (!pcs?.length) return null;
		// Whether the cursor handed THIS user the active turn. A PC can have two owners; the
		// cursor picks one as the editor (see _primaryOwnerId), so a co-owner can be looking at
		// "their" active PC without being the one who may act on it.
		const cur = this._cursor();
		const iAmActiveUser = !!cur.active && cur.activeActorId === (pcs[this._pcIndex]?.id ?? "")
			&& cur.activeUserId === game.user?.id;
		let best = null;
		pcs.forEach((a, i) => {
			if (!a?.isOwner) return;
			const turns = this._turnsUntil(i, phase);
			const better = best == null
				|| (best.turns < 0 && turns >= 0)                              // an upcoming turn beats a finished one
				|| (turns >= 0 && best.turns >= 0 && turns < best.turns);      // sooner wins
			if (better) best = { name: a.name, turns };
		});
		if (best == null) return null;
		const pcNote = best.name ? `(you're playing ${best.name})` : "";
		if (best.turns < 0)   return { state: "done", icon: "fa-circle-check",   text: "You're all set here: sit back and enjoy the rest of the table.", pcNote: "" };
		// The current turn is only actionable if the cursor made THIS user its editor; a
		// co-owner whose partner holds the turn is waiting, not up.
		if (best.turns === 0) return iAmActiveUser
			? { state: "now",  icon: "fa-feather",        text: "It's your turn now.", pcNote: "" }
			: { state: "soon", icon: "fa-hourglass-half", text: `${best.name} is up now: you share this character.`, pcNote: "" };
		if (best.turns === 1) return { state: "next", icon: "fa-hourglass-half", text: "You're up next.",           pcNote };
		return                       { state: "soon", icon: "fa-hourglass-half", text: `You're ${best.turns} turns away.`, pcNote };
	}

	// ── GM harvest: mirror player flags into the world setting for the Chronicle ────
	// The GM is the only client that can write the world-scoped introductionsAnswers, so
	// the primary GM copies each PC's intro flag into it: the narration rounds (r1–r3, from
	// intro.narration) and the answer/ask steps (step4/step6), merged so a value the GM
	// typed directly (or an untouched field) is preserved.

	_mergeActorIntoDraft(actor) {
		if (!actor || actor.type !== "character") return false;
		const intro = actor.getFlag(_FLAG_SCOPE, _INTRO_FLAG);
		if (!intro) return false;
		const all = this._answers();
		const rec = { ...(all[actor.id] ?? {}) };
		let touched = false;
		const nar = intro.narration;
		// Only report a change when a value actually differs, so the live Chronicle sync
		// (which harvests on a debounce as people type) doesn't rewrite the world setting on
		// every tick. The close/finish harvest forces a final write regardless (see _harvestAll).
		if (nar) for (const roundKey of ["r1", "r2", "r3"]) {
			if (typeof nar[roundKey] === "string" && rec[roundKey] !== nar[roundKey]) {
				rec[roundKey] = nar[roundKey];
				touched = true;
			}
		}
		for (const stepKey of ["step4", "step6"]) {
			const s = intro[stepKey];
			if (s) {
				const next = { answers: Array.isArray(s.answers) ? s.answers : [], passed: !!s.passed };
				if (JSON.stringify(rec[stepKey]) !== JSON.stringify(next)) {
					rec[stepKey] = next;
					touched = true;
				}
			}
		}
		if (touched) all[actor.id] = rec;
		return touched;
	}

	// Harvest one PC's flag into the world setting (primary GM only).
	async _harvestActor(actor) {
		if (!isPrimaryGM()) return;
		if (this._mergeActorIntoDraft(actor)) await setSetting(_ANSWERS_SETTING, this._answers());
	}

	// Harvest every PC's flag into the world setting in one write — run before compiling
	// the Chronicle so an un-harvested edit (or one made while this GM wasn't primary)
	// still lands.
	async _harvestAll({ skipActorId = null, force = true } = {}) {
		let touched = false;
		for (const actor of getPlayerCharacters()) {
			if (actor.id === skipActorId) continue;
			touched = this._mergeActorIntoDraft(actor) || touched;
		}
		if (touched || (force && this._draft)) await setSetting(_ANSWERS_SETTING, this._answers());
		return touched;
	}

	// Primary GM: fill the shared Chronicle in during the session as answers are recorded and
	// as narration is typed, debounced so a burst of writes coalesces into one compile.
	// Every client's hook calls this, but only the primary GM (the sole world-doc writer)
	// proceeds; players and secondary GMs no-op.
	_scheduleChronicleSync() {
		if (!game.user?.isGM || !isPrimaryGM()) return;
		this._chronicleSync ??= foundry.utils.debounce(() => this._syncChronicle(), 1500);
		this._chronicleSync();
	}

	// The PC whose UNTRACKED (pre-fix) Chronicle page a live sync may adopt and refresh from
	// the text being typed this instant: the actively-authored narrator on a narration round.
	// A page seeded before per-section hash tracking existed has no way to prove it wasn't
	// hand-edited, so it's frozen by default — which means re-running the introductions for a
	// REUSED character would never update its page. But the PC being narrated right now IS
	// being (re-)authored, so its page should yield to the live text; once adopted it gains a
	// hash and tracks normally (later journal edits win again). Scoped to this one PC so no
	// other PC's legacy page is ever touched, and null off a narration round (Q&A is additive,
	// nothing to adopt).
	_liveAdoptActorId() {
		const phase = _PHASES[this._phase];
		if (_isRoundRobin(phase) && !_isStep(phase)) return this._pcs?.[this._pcIndex]?.id ?? null;
		return null;
	}

	// Harvest the latest answers — the actively-typing narrator INCLUDED — and quietly
	// re-compile the Chronicle. Prose sections track the source while un-edited (see
	// mergeChronicleSections), so a player's in-progress introduction is refreshed on each
	// tick instead of being frozen half-typed; a hand edit in the journal still wins (its
	// hash stops matching), so nothing written there is clobbered. The actively-authored PC's
	// page is passed as an adopt-legacy key so a REUSED character's pre-fix (untracked) page
	// starts updating too. Additive Q&A merge + pristine-prose refresh keeps it idempotent: it
	// writes nothing when there's nothing new, so a no-op tick is cheap. Silent: no toast, and
	// it never opens the journal (unlike the finish button or the macro).
	async _syncChronicle() {
		if (!game.user?.isGM || !isPrimaryGM()) return;
		try {
			await this._harvestAll({ force: false });
			const adoptId = this._liveAdoptActorId();
			await writeChronicle({ silent: true, adoptLegacyKeys: adoptId ? new Set([adoptId]) : null });
		} catch (err) {
			console.warn("Stonetop | Introductions: live Chronicle sync failed", err);
		}
	}

	// Compile everything recorded so far (plus the Spring Burst notes) into the
	// shared "Chronicle" journal and open it. GM-only — the button is hidden for
	// players, who read the journal once it's shared. Harvest every PC's flag into the
	// setting first so the compiler (which reads the persisted setting) sees the latest.
	async _saveChronicle(button) {
		return saveChronicleFromButton(button, {
			context:    "Introductions",
			beforeSave: () => this._harvestAll(),
		});
	}

	// "Let spring break forth!" — the final button now also commits everything
	// recorded to the Chronicle (GM only; there's no separate save step) before the
	// dialog closes. Players just close. If the save errors, keep the dialog open so
	// the GM can fix it and try again rather than losing the closing action.
	async _finish(button) {
		if (game.user?.isGM && !(await this._saveChronicle(button))) return;
		// Mark the run finished (drops the saved round/turn so a manual reopen starts at
		// the pre-check) — this is half of what stops the Welcome guide auto-opening once
		// spring's also burst forth. close() then re-stamps open:false.
		markWalkthroughDone(_RESUME_KEY, ["phase", "pcIndex"]);
		return this.close();
	}

	_registerCombatHooks() {
		if (this._combatHooks) return;
		const refresh = () => { if (this._phase === 0) this.render(false); };
		this._combatHooks = [
			["createCombat",    Hooks.on("createCombat",    refresh)],
			["deleteCombat",    Hooks.on("deleteCombat",    refresh)],
			["createCombatant", Hooks.on("createCombatant", refresh)],
			["deleteCombatant", Hooks.on("deleteCombatant", refresh)],
			// A PC created/deleted while the pre-check is up changes the roster too, but fires
			// no combatant hook — refresh so the "ready / not yet in the tracker" lists stay
			// live rather than going stale until some unrelated event (the removed "Add Player
			// Characters" button used to be the only nudge for a late-added PC). getData filters
			// to playbook-bearing actors, so a non-PC create/delete is a harmless no-op re-render.
			["createActor",     Hooks.on("createActor",     refresh)],
			["deleteActor",     Hooks.on("deleteActor",     refresh)],
		];
	}

	_unregisterCombatHooks() {
		if (!this._combatHooks) return;
		for (const [name, id] of this._combatHooks) Hooks.off(name, id);
		this._combatHooks = null;
	}

	// Live-sync listener for the answer/ask steps: when a PC's intro flag changes (a
	// player — or the GM — recording/passing/typing), the primary GM mirrors it into the
	// world setting, and any client showing that PC re-renders so the GM sees the player
	// type and the player sees the GM type for them (and their commit land). Mirrors
	// WelcomeDialog._registerHooks: filtered to character actors and the `intro` flag key
	// (stripping the "-=" unset prefix), debounced so a burst coalesces. Skips the
	// re-render while a field here is focused so it never yanks the textarea mid-edit.
	_registerIntroHooks() {
		if (this._introHook) return;
		// Re-render (debounced) when a shown PC's intro flag changes, unless a field here
		// is focused (never yank a textarea mid-edit). The harvest is done immediately,
		// not in this debounce, so a coalesced burst can't drop a step change.
		const scheduleRender = foundry.utils.debounce(actor => {
			const shown = this._pcs?.[this._pcIndex];
			if (shown && actor.id === shown.id && this.rendered && this._phase > 0
				&& !this.element?.[0]?.contains(document.activeElement)) this.render(false);
		}, 150);
		this._introHook = Hooks.on("updateActor", (actor, changes, _options, userId) => {
			if (actor?.type !== "character") return;
			const stFlags = changes?.flags?.[_FLAG_SCOPE];
			if (!stFlags) return;
			if (!Object.keys(stFlags).some(k => k.replace(/^-=/, "") === _INTRO_FLAG)) return;
			// Only a step4/step6 change (a recorded answer or a pass) is worth mirroring
			// into the world setting — not a live-typing keystroke, so per-keystroke draft
			// writes don't churn the world setting. Harvest immediately (primary GM only).
			const introDelta   = stFlags[_INTRO_FLAG];
			const stepChanged  = !!introDelta && ("step4" in introDelta || "step6" in introDelta);
			if (game.user?.isGM && stepChanged) this._harvestActor(actor);
			// Fill the shared Chronicle in as answers are recorded (and completed narration lands).
			// Fires on any intro change including narration keystrokes; _syncChronicle debounces and
			// skips the actively-typing PC, so a half-typed round is never frozen into the seed-once
			// journal. Primary-GM-guarded inside.
			this._scheduleChronicleSync();
			// A player recording their one answer (or passing) on their own turn hands the
			// turn along: the primary GM (the cursor author) advances to the next still-active
			// PC, so the table goes around one answer per turn. Gated to step records made by
			// ANOTHER user — the GM's own Next/Pass already advances, so reacting to that
			// self-write here would double-hop. When it advances it re-renders itself, so skip
			// the debounced render below.
			if (stepChanged && userId !== game.user?.id && this._autoAdvanceOnRemoteStep(actor)) return;
			scheduleRender(actor);
		});
	}

	_unregisterIntroHooks() {
		if (this._introHook == null) return;
		Hooks.off("updateActor", this._introHook);
		this._introHook = null;
	}

	async close(options = {}) {
		this._cancelLiveDraft();
		// Harvest every PC's answers — narration INCLUDED — into the world setting before we
		// go. The live updateActor harvest only fires on step (step4/step6) changes, so without
		// this, narration typed then closed with the X (rather than the Save-to-Chronicle
		// button) would never reach the setting the Chronicle compiler reads. Primary GM only
		// (only a GM can write a world setting, and only the primary should).
		// Non-fatal — closing must not be blockable — but NOT silent. This is the only path that
		// persists narration typed and then closed with the X, so a swallowed failure here loses
		// player-written text outright, and the table's only clue is that the Chronicle came out
		// short. Say so loudly enough that it can be retyped before anyone moves on.
		if (game.user?.isGM && isPrimaryGM()) {
			try { await this._harvestAll(); }
			catch (err) {
				console.error("Stonetop | Introductions: harvesting answers on close failed", err);
				ui.notifications?.error(
					"Stonetop: the Introductions answers could not be saved. Reopen the window and "
					+ "check the latest narration before continuing.");
			}
		}
		this._unregisterCombatHooks();
		this._unregisterIntroHooks();
		// Closing on purpose (the X or "Let spring break forth!") clears the open flag
		// so we don't auto-reopen on the next load; a browser reload skips close() and
		// leaves it set. The saved round/turn stays, so a manual reopen still resumes.
		patchWalkthroughResume(_RESUME_KEY, { open: false });
		// The primary GM closing on purpose ends the shared session, so players' dialogs
		// close too. (A secondary GM or a player closing their own window doesn't end it; a
		// GM browser reload skips close(), leaving the cursor active for reopen.)
		if (game.user?.isGM && isPrimaryGM() && this._cursor().active) this._writeCursor({ active: false });
		return super.close(options);
	}

	getData() {
		if (this._phase === 0) {
			// The pre-check roster is only needed on this screen; the round-robin below
			// reads this._pcs instead. Building it here keeps the per-keystroke re-render
			// off two full actor scans it would only throw away.
			const allPcs    = getPlayerCharacters();
			const combatPcs = orderByCombatTurns(allPcs);
			const combatIds = new Set(combatPcs.map(a => a.id));
			const missing   = allPcs.filter(a => !combatIds.has(a.id));
			const isGM = game.user?.isGM ?? false;
			return {
				isPreCheck:   true,
				isGM,
				canShuffle:   isGM && combatPcs.length > 1,
				canBegin:     combatPcs.length > 0,
				hasNone:      allPcs.length === 0,
				noneInCombat: allPcs.length > 0 && combatPcs.length === 0,
				hasMissing:   missing.length > 0,
				missingPcs:   missing.map(a => a.name),
				pcNames:      combatPcs.map(a => a.name),
				pcCount:      combatPcs.length,
			};
		}

		const isGM  = game.user?.isGM ?? false;
		const pcs   = this._pcs;
		const phase = _PHASES[this._phase];
		const actor = _isRoundRobin(phase) ? (pcs[this._pcIndex] ?? null) : null;

		let currentPc = null;
		let capture   = null;
		let questions = null;
		if (_isRoundRobin(phase) && actor) {
			const slug = playbookSlug(actor);
			// The owning player's real (user) name, shown in the banner beside the
			// character name — players new to the table may not yet map a PC name to a
			// person, so the banner spells out whose turn it is.
			const ownerId = this._primaryOwnerId(actor);
			currentPc = {
				name:         actor.name,
				playerName:   ownerId ? (game.users?.get(ownerId)?.name ?? "") : "",
				playbookName: actor.system?.playbook?.name ?? "",
				icon:         playbookIconPath(slug),
				index:        this._pcIndex + 1,
				total:        pcs.length,
			};

			// Editability is the same rule for narration and the steps, so compute it once:
			// whether this client may write the draft (canEdit), whether it's the primary GM
			// co-editing alongside a present player — a shared-box label, not GM-only (coEdit),
			// and whether a GM only watches a present player's live typing read-only (canPreview).
			const canEdit    = this._canEditActor(actor);
			const coEdit     = isGM && canEdit && this._hasOnlinePlayerOwner(actor);
			const canPreview = isGM && !canEdit;

			if (_isStep(phase)) {
				const stepKey = phase.stepKey;
				const record  = this._stepRecord(actor.id, stepKey);
				const answers = record.answers;
				const passed  = record.passed;
				const draft   = this._stepDraft(actor.id, stepKey);
				const qList   = phase.getQuestions(actor) ?? [];
				// Gray out any question this PC has already answered this step — except
				// the one drafted right now, which stays pickable so it can be toggled off.
				const usedQ     = new Set(answers.map(x => x.q).filter(Number.isInteger));
				const selectedQ = _normQ(draft.q);
				questions = qList.map((html, index) => ({
					index,
					html:       wrapLoreTerms(html),
					isSelected: index === selectedQ,
					isUsed:     usedQ.has(index) && index !== selectedQ,
				}));
				const recorded = answers.map(x => ({
					question: Number.isInteger(x.q) ? wrapLoreTerms(qList[x.q] ?? "") : "",
					answer:   x.a,
				}));
				const total   = qList.length;
				capture = {
					isStep:       true,
					isAsk:        phase.kind === "ask",
					actorId:      actor.id,
					stepKey,
					coEdit,
					draftAnswer:  typeof draft.a === "string" ? draft.a : "",
					saveState:    String(draft.a ?? "").trim() ? "saved" : "idle",
					placeholder:  phase.kind === "ask" ? "Who you asked, and what they answered…" : "Their answer…",
					canEdit,
					// The GM watches a present player's live typing read-only (it can't write the
					// shared draft), so it still sees the answer appear but never clobbers it.
					canPreview,
					recorded,
					hasRecorded:  recorded.length > 0,
					passed,
					// Pass is offered on any un-passed turn (a PC may pass without answering).
					canPass:      !passed,
					answeredCount: answers.length,
					total,
				};
			} else {
				// Narration round (1–3): a single plain-string answer, authored on the PC's
				// own flag so the active player writes their own intro (GM watches / types for
				// an offline PC), harvested to the world setting for the Chronicle.
				const roundKey = phase.roundKey;
				capture = {
					isStep:       false,
					actorId:      actor.id,
					key:          roundKey,
					answer:       this._narration(actor.id, roundKey),
					saveState:    String(this._narration(actor.id, roundKey) ?? "").trim() ? "saved" : "idle",
					placeholder:  _NARRATE_PLACEHOLDER[this._phase] ?? "Their answer…",
					canEdit,
					coEdit,
					// A secondary GM (canEdit false) still watches the player type read-only.
					canPreview,
				};
			}
		}

		// Add hover summaries to bare god names (Danu / Aratis / Helior) in the
		// authored prompts; move names are intentionally left alone.
		const instruction = wrapLoreTerms(phase.getInstruction(actor));
		const isLastPc    = !_isRoundRobin(phase) || this._pcIndex >= pcs.length - 1;
		const isDone      = this._phase === _LAST_PHASE && isLastPc;

		// GM-only "N of M done" tally for a step (passed or answered all their
		// questions). When all are done the GM's Next lights up as "continue" — the GM
		// still clicks it (GM-paced; no auto-advance). Reads durable per-actor state, so
		// an offline PC the GM answered/passed for counts too.
		let stepReady = null;
		if (isGM && _isStep(phase) && pcs.length) {
			const count = pcs.reduce((n, pc) => n + (this._isPcDone(pc, phase) ? 1 : 0), 0);
			stepReady = { count, total: pcs.length, all: count >= pcs.length };
		}

		// Player-side "where you are in the turn order" strip, shown while it isn't the
		// viewer's own turn to write. Absent for the GM (who paces the table and sees the
		// ready tally) and for a spectator who owns none of the PCs in the run.
		let placeInLine = null;
		if (!isGM && _isRoundRobin(phase) && !capture?.canEdit) placeInLine = this._myPlaceInLine(phase);

		// Primary-GM-only jump-to-step rail (the shared TOC chrome): one entry per real
		// phase (1..last), the current one flagged active. Only the primary GM drives the
		// cursor (see _jumpToPhase), so players AND secondary GMs follow it and get no rail
		// (a rendered-but-inert rail would click into _jumpToPhase's isPrimaryGM guard).
		const steps = (isGM && isPrimaryGM()) ? _PHASES.slice(1).map((p, i) => ({
			index:    i + 1,
			title:    p.title,
			icon:     p.icon,
			isActive: i + 1 === this._phase,
		})) : null;

		return {
			isPreCheck:     false,
			isGM,
			steps,
			phase:          this._phase,
			currentPc,
			instruction,
			questions,
			hasQuestions:   !!(questions?.length),
			capture,
			stepReady,
			stepLabel:      phase.title ?? `Step ${this._phase} of ${_LAST_PHASE}`,
			isPrevDisabled: this._phase === 1 && this._pcIndex === 0,
			placeInLine,
			isDone,
		};
	}

	// Randomize the round-robin order. We express the new order as descending
	// initiative on the PC combatants, so both the Combat Tracker and the dialog's
	// turn order (which reads `combat.turns`) reflect the shuffle.
	async _shuffleOrder() {
		const combat = game.combat;
		if (!combat || !game.user?.isGM) return;

		const pcs = _getCombatPcs();
		if (pcs.length < 2) return;

		const ids = pcs.map(a => a.id);
		let order = shuffle(ids);
		// Re-roll a few times if the shuffle happened to land on the same order.
		let guard = 0;
		while (order.every((id, i) => id === ids[i]) && guard++ < 10) order = shuffle(ids);

		const updates = [];
		order.forEach((actorId, idx) => {
			const c = combat.combatants.find(cb => cb.actorId === actorId);
			if (c) updates.push({ _id: c.id, initiative: order.length - idx });
		});
		if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
		this.render(false);
	}

	_begin() {
		// Only the PRIMARY GM starts the session — it authors the cursor every other client
		// follows; a secondary GM beginning locally would move only its own view and desync.
		if (!game.user?.isGM || !isPrimaryGM()) return;
		this._pcs     = _getCombatPcs();
		this._phase   = 1;
		this._pcIndex = 0;
		this.render(false);
	}

	// "Next". On an answer/ask step this records the active PC's drafted answer (if
	// any) and hands the turn to the next still-active PC, cycling until everyone has
	// passed/answered-all and then advancing to the next phase. On a narration round
	// it's the old linear round-robin. Async: recording flushes to the setting before
	// the re-render (though the GM's in-memory draft updates synchronously).
	async _advance() {
		// GM-paced: only the primary GM drives the shared cursor. A secondary GM's Next would
		// move its local view without propagating, then snap back on the next primary write.
		if (game.user?.isGM && !isPrimaryGM()) return;
		const phase = _PHASES[this._phase];
		if (_isStep(phase)) { await this._advanceStep(phase); return; }
		if (_isRoundRobin(phase) && this._pcIndex < this._pcs.length - 1) {
			this._pcIndex++;
		} else if (this._phase < _LAST_PHASE) {
			this._enterPhase(this._phase + 1);
		}
		// Advancing a narration turn writes no actor flag, so nudge the live Chronicle sync
		// here too — the PC just left is now finished with this round and safe to compile.
		this._scheduleChronicleSync();
		this.render(false);
	}

	// Persist the currently-typed capture field (narration textarea or step draft) to its
	// flag before a re-render replaces the DOM. Run at the top of _render so no re-render
	// path — a turn advance, a cursor nonce bump, a jump-to-step — can drop the last,
	// not-yet-debounced characters. Gated to the SOLE editor: the owning player (writing
	// their own PC) or the GM standing in for an offline / GM-only PC. A GM watching a
	// present player sees a readonly mirror (excluded by :not([readonly])) and, on the shared
	// live draft it co-edits, is excluded by _hasOnlinePlayerOwner — so its lagging DOM value
	// never reverts the player's newer flag. The DOM's own data-* is authoritative (not
	// this._pcIndex), so the flush still fires the instant AFTER the cursor moved the turn on.
	async _flushCaptureFromDom() {
		const root = this.element?.[0];
		// Consumed even when there is nothing to flush, so a suppression set by a commit
		// whose render never reached here can't skip a later, legitimate flush.
		const justCommitted = this._skipDraftFlushOnce;
		this._skipDraftFlushOnce = false;
		if (!root) return;
		this._cancelLiveDraft();
		// This runs at the top of _render, so a throw here would abort the whole render.
		// A flag write failing must not do that — log and let the render proceed (the same
		// defensive stance as _syncChronicle).
		try {
			const soleEditor = (actorId) => !!this._ownedActor(actorId) && !this._hasOnlinePlayerOwner(this._actor(actorId));
			const nar = root.querySelector("textarea.stonetop-intros-answer:not([readonly])");
			if (nar?.dataset.actorId && nar.dataset.roundKey && soleEditor(nar.dataset.actorId)) {
				await this._saveNarration(nar.dataset.actorId, nar.dataset.roundKey, nar.value);
			}
			const draft = root.querySelector("textarea.stonetop-intros-draft:not([readonly])");
			if (!justCommitted && draft?.dataset.actorId && draft.dataset.stepKey
				&& soleEditor(draft.dataset.actorId) && this._draftWorthFlushing(draft)) {
				// The DOM is authoritative for the TEXT and only the text: a keystroke can sit
				// in the textarea unwritten (that is the whole reason for this flush), but a
				// PICK is never DOM-only — every click writes the flag before re-rendering. So
				// read q from the flag. Reading it back off the last render instead re-wrote the
				// pick the player had just moved OFF, which is what made a second choice on
				// "Bonds & ties" / "Asking the others" look like it did nothing at all.
				const { q } = this._stepDraft(draft.dataset.actorId, draft.dataset.stepKey);
				await this._saveDraft(draft.dataset.actorId, draft.dataset.stepKey, { q, a: draft.value });
			}
		} catch (err) {
			console.warn("Stonetop | Introductions: capture flush before re-render failed", err);
		}
	}

	// Does a live draft for this step actually EXIST on the actor? _stepDraft answers the
	// same empty { q: null, a: "" } for "no draft" and "an empty one", which is right for
	// reading and wrong for deciding whether to write.
	_hasLiveDraft(actorId, stepKey) {
		const live = this._intro(actorId).live;
		return !!live && live.stepKey === stepKey;
	}

	/**
	 * Is there anything in the capture field worth writing back? Only when a live draft still
	 * exists (the field mirrors it, and may hold newer keystrokes), or the caret is in the
	 * field right now — the first keystroke of a brand-new draft, still inside the 300ms
	 * debounce this flush cancels.
	 *
	 * Neither holds right after a commit: the buffer is gone and the field goes on showing the
	 * recorded answer until the repaint. Writing THAT back re-creates a draft nobody is
	 * drafting, and the next Next records the same answer twice.
	 *
	 * `_skipDraftFlushOnce` covers the same ground on the client that did the committing; this
	 * covers every OTHER open dialog, whose re-render is driven by the updateActor hook and
	 * which never saw a commit of its own — the GM's Next clears an online player's draft, and
	 * it was the PLAYER's screen that put it back.
	 *
	 * Which is why focus ALONE is not enough, and why the text is checked against what has already
	 * been recorded. On that other client the caret is still in the field when the commit lands
	 * (the re-render that would have cleared it is suppressed precisely because it has focus), so
	 * the field goes on showing the answer just recorded with no live draft behind it — the one
	 * state this was supposed to refuse. Flushing it wrote the answer back as a new draft carrying
	 * `q: null`, since there is no live draft left to read the pick from, and when the round came
	 * back to that PC the commit refused it with "Tap the question they chose" and returned false.
	 * The GM's Next then did nothing at all, with nothing on screen to say why.
	 */
	_draftWorthFlushing(el) {
		if (this._hasLiveDraft(el.dataset.actorId, el.dataset.stepKey)) return true;
		if (el !== globalThis.document?.activeElement) return false;
		const text = String(el.value ?? "").trim();
		if (!text) return false;
		// Anything already committed for this step is a mirror of the record, not a draft. A
		// genuine first keystroke — the case this branch exists for, still inside the 300ms
		// debounce — is by definition text nobody has recorded yet.
		const recorded = this._stepRecord(el.dataset.actorId, el.dataset.stepKey).answers;
		return !recorded.some(entry => String(entry?.a ?? "").trim() === text);
	}

	// Flush the compose UI's current state to the draft flag and await it, so a fast
	// type-then-Next records the latest text rather than racing the debounced/blur writes.
	// The textarea is authoritative (it holds the live value); the PICK comes from the flag,
	// which a click always writes before the highlight moves — see _flushCaptureFromDom.
	async _flushDraftFromDom(actor, phase) {
		const el = this.element?.[0]?.querySelector(".stonetop-intros-draft");
		if (!el || el.dataset.actorId !== actor.id) return;
		const { q } = this._stepDraft(actor.id, phase.stepKey);
		await this._saveDraft(actor.id, phase.stepKey, { q, a: el.value });
	}

	// Record the active PC's draft, then move the cursor on within the step. Only the GM has
	// Next, so this runs on the GM. When the GM is the authoritative editor (a GM-only PC, an
	// offline player's turn, and — implicitly — the field it typed into) it flushes its own
	// textarea into the draft first, so a fast type-then-Next captures the last text. When a
	// present player is the editor, their `live` flag is the source of truth: DON'T flush the
	// GM's lagging mirror over it — record the flag as-is.
	async _advanceStep(phase) {
		this._cancelLiveDraft();
		const actor = this._pcs[this._pcIndex];
		// Record the shown PC's draft first; a draft with text but no chosen question is
		// rejected (below) and holds the turn. No actor (empty roster) still advances.
		if (actor && !(await this._commitComposedDraft(actor, phase, "Tap the question they chose before recording it."))) return;
		this._advanceStepCursor(phase);
		this.render(false);
	}

	// Flush the shown PC's typed text into the draft (when this client is its editor), then
	// record it as an answer. A draft with answer text but no chosen question is rejected —
	// warn and return false so the caller holds the turn; anything else returns true. Shared
	// by the GM's Next (_advanceStep) and the player's Done (_recordCurrentDraft).
	async _commitComposedDraft(actor, phase, warnMsg) {
		// Flush our own textarea into the draft ONLY when we're the SOLE editor. In a co-edit
		// (primary GM writing alongside a present player) the player's `live` flag is the
		// source of truth — flushing the GM's lagging mirror could re-create a just-cleared
		// draft and record the same answer twice, inflating the exhaustion count. The active
		// player editing their own PC is its sole editor, so they still flush normally.
		if (this._canEditActor(actor) && !this._hasOnlinePlayerOwner(actor)) await this._flushDraftFromDom(actor, phase);
		const draft   = this._stepDraft(actor.id, phase.stepKey);
		const hasText = String(draft.a ?? "").trim() !== "";
		const hasQ    = Number.isInteger(draft.q);
		if (hasText && !hasQ) { ui.notifications?.warn(warnMsg); return false; }
		if (hasText && hasQ) await this._recordDraft(actor.id, phase.stepKey);
		return true;
	}

	// The player's "Done" — record the current draft as their ONE answer for this turn; the
	// turn then hands off on its own (the record writes their actor flag, which the primary
	// GM's updateActor hook picks up via _autoAdvanceOnRemoteStep). Mirrors the record half of
	// the GM's Next: flush the latest typed text, require a chosen question, append it.
	async _recordCurrentDraft() {
		const phase = _PHASES[this._phase];
		if (!_isStep(phase)) return;
		const actor = this._pcs[this._pcIndex];
		if (!actor || !this._canEditActor(actor)) return;
		this._cancelLiveDraft();
		if (!(await this._commitComposedDraft(actor, phase, "Tap the question you're answering before recording it."))) return;
		this.render(false);
	}

	// Pass, with a confirmation for the player explaining what passing means. The GM — who
	// paces the table and may pass on behalf of an offline PC — passes without the prompt.
	async _confirmPass() {
		const phase = _PHASES[this._phase];
		if (!_isStep(phase)) return;
		if (game.user?.isGM) return this._pass();
		const isAsk = phase.kind === "ask";
		const confirmed = await Dialog.confirm({
			title:   "Pass this part?",
			content: `<p>Passing means you're <strong>done ${isAsk ? "asking" : "answering"}</strong> for this part of the introductions: you won't be asked to ${isAsk ? "ask" : "answer"} another question about <em>${escHtml(phase.title)}</em>.</p>`
			       + `<p>Anything you've already recorded is kept, and the group carries on. If you change your mind, just ask your GM.</p>`,
			yes:        () => true,
			no:         () => false,
			defaultYes: false,
			render:     bringDialogToFront,
		});
		if (confirmed) await this._pass();
	}

	// Pass: the active PC opts out of the rest of this step. The turn then moves to the next
	// still-active PC — the GM advances its own view right here; a player's pass writes their
	// flag and the primary GM's updateActor hook (_autoAdvanceOnRemoteStep) advances for them.
	// A pass never auto-leaves the step (GM-paced: when all are done the GM's lit-up Next is
	// what advances the phase), and the GM's Next always skips already-passed PCs.
	async _pass() {
		const phase = _PHASES[this._phase];
		if (!_isStep(phase)) return;
		const actor = this._pcs[this._pcIndex];
		if (!actor || !this._canEditActor(actor)) return;
		this._cancelLiveDraft();
		await this._setPassed(actor.id, phase.stepKey, true);
		if (game.user?.isGM) this._stepToNextActivePc(phase); // else stay put; everyone's done → GM clicks Next
		this.render(false);
	}

	// Move the round-robin cursor to the next still-active PC in this looping step,
	// cycling with wrap-around (staying put when only the current PC is left). Returns
	// true when a next PC exists, false when everyone's done — the caller decides whether
	// that means crossing the phase boundary (Next) or parking for the GM.
	_stepToNextActivePc(phase) {
		const nextIdx = nextActiveIndex(this._pcIndex, this._pcs.length, i => this._isPcDone(this._pcs[i], phase));
		if (nextIdx < 0) return false;
		this._pcIndex = nextIdx;
		return true;
	}

	// Advance the round-robin cursor within a looping step: to the next still-active
	// PC (cycling), or — when everyone is passed/exhausted — on to the next phase.
	_advanceStepCursor(phase) {
		if (this._stepToNextActivePc(phase)) return;
		if (this._phase < _LAST_PHASE) this._enterPhase(this._phase + 1);
	}

	// Primary-GM auto-advance for a looping answer/ask step: when the ACTIVE PC's own player
	// records an answer (their Done) or passes, hand the turn to the next still-active PC so
	// the table cycles one answer per turn. Only the primary GM (the cursor author) advances,
	// and only for a step change on the PC whose turn it currently is. Unlike the GM's Next,
	// this never crosses the phase boundary — when everyone is done it parks on the current PC
	// so the GM deliberately continues with the (now lit) "Everyone's done, continue" button.
	// Returns true when handled (advanced / stayed on a lone active PC / parked, then
	// re-rendered), false to fall through to the ordinary debounced re-render.
	_autoAdvanceOnRemoteStep(actor) {
		if (!game.user?.isGM || !isPrimaryGM()) return false;
		const phase = _PHASES[this._phase];
		if (!_isStep(phase)) return false;
		if (this._pcs?.[this._pcIndex]?.id !== actor.id) return false; // only the active PC's own turn
		this._cancelLiveDraft();
		// Step to the next active PC; when everyone is done this stays put so the GM crosses
		// the phase deliberately with the (now lit) "Everyone's done, continue" button.
		this._stepToNextActivePc(phase);
		this.render(false);
		return true;
	}

	// Enter a phase, parking the cursor: on a looping step, on the first still-active
	// PC (so a re-entered step skips PCs already done); otherwise on the first PC.
	_enterPhase(phase) {
		this._phase = phase;
		const def = _PHASES[phase];
		if (_isStep(def)) {
			const first = firstActiveIndex(this._pcs.length, i => this._isPcDone(this._pcs[i], def));
			this._pcIndex = first >= 0 ? first : 0;
		} else {
			this._pcIndex = 0;
		}
	}

	_retreat() {
		// Back is GM-paced too: only the primary GM moves the shared cursor (see _advance).
		if (game.user?.isGM && !isPrimaryGM()) return;
		if (this._phase === 0) return;
		const phase = _PHASES[this._phase];
		if (_isRoundRobin(phase) && this._pcIndex > 0) {
			this._pcIndex--;
		} else if (this._phase > 1) {
			this._phase--;
			const prev = _PHASES[this._phase];
			this._pcIndex = _isRoundRobin(prev) ? this._pcs.length - 1 : 0;
		} else {
			// Back to pre-check from phase 1, first PC
			this._phase   = 0;
			this._pcIndex = 0;
		}
		this.render(false);
	}

	// GM sidebar jump: fast-forward or rewind the shared cursor to another step,
	// parking on its first still-active PC (via _enterPhase) exactly as Next/Back do
	// when they cross a phase boundary — the render then mirrors it out to every
	// player's dialog. GM-paced like _advance/_retreat: only the primary GM drives the
	// cursor (a secondary GM/player has no rail, and this guard backstops that). A
	// click on the current step is a no-op so it can't reset the per-PC turn.
	_jumpToPhase(index) {
		if (!game.user?.isGM || !isPrimaryGM()) return;
		if (!Number.isInteger(index) || index < 1 || index > _LAST_PHASE || index === this._phase) return;
		this._cancelLiveDraft();
		this._enterPhase(index);
		this._scheduleChronicleSync();
		this.render(false);
	}

	// Resume the phase/turn saved before a reload (the dialog doesn't survive a refresh).
	// Returns true when it restored a live position; false (leaving the dialog on the
	// pre-check) when nothing's saved or no PCs are on the tracker — the caller then falls
	// back to the shared cursor so a fresh GM tab joins a running session instead of resetting.
	_restorePosition() {
		const saved = getWalkthroughResume(_RESUME_KEY);
		let phase = Number(saved?.phase);
		if (!Number.isInteger(phase) || phase < 1) return false;
		// A resume written before the round-robin collapse (no _RESUME_VERSION marker) used the
		// old 8-round numbering, so remap each legacy round to the step it was actually on;
		// otherwise old round 5 (the second answer lap) would resume on the ASK step, skipping
		// the remaining answers. Current-format saves pass through, clamped only if past the end.
		if (Number(saved?.v) >= _RESUME_VERSION) {
			if (phase > _LAST_PHASE) phase = _LAST_PHASE;
		} else {
			phase = _LEGACY_RESUME_PHASE_MAP[phase] ?? _LAST_PHASE;
		}
		const pcs = _getCombatPcs();
		if (!pcs.length) return false;
		this._pcs     = pcs;
		this._phase   = phase;
		const maxIdx  = _isRoundRobin(_PHASES[phase]) ? pcs.length - 1 : 0;
		const idx     = Number(saved?.pcIndex);
		this._pcIndex = Number.isInteger(idx) ? Math.min(Math.max(idx, 0), maxIdx) : 0;
		return true;
	}

	// Persist the current round/turn (and that we're open) so a reload can reopen here.
	// Fire-and-forget client-scoped write; saveWalkthroughPosition drops it when nothing has
	// moved, which matters more here than for the steppers — this dialog re-renders on a capture
	// flush and on every cursor sync, not only when the GM navigates. This walkthrough's "place"
	// is the round, the turn within it, and the format version those two are written in.
	_saveResume() {
		saveWalkthroughPosition(_RESUME_KEY, { v: _RESUME_VERSION, phase: this._phase, pcIndex: this._pcIndex });
	}
}
