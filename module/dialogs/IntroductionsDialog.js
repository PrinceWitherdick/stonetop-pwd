import { confirmOutcome } from "../utils/ask-with-buttons.js";
import { deletionEntry } from "../utils/foundry-compat.js";
import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { shuffle } from "../utils/arrays.js";
import { stonetopSteadingHeaderButton } from "../utils/world.js";
import { playbookSlug, getPlayerCharacters, playbookIconPath, playerOf } from "../utils/playbook-actors.js";
// The order the introductions go around the table in: a world setting of its own, never the
// Combat tracker. See utils/introductions-order.js for why.
import { introductionsRoster, adoptLegacyIntroOrder, writeIntroOrder, moveId, reshuffle } from "../utils/introductions-order.js";
import { wrapLoreTerms } from "../utils/lore-terms.js";
// Authored prompts/questions live in introductions-data.js so the Chronicle
// compiler can resolve a recorded answer's question index back to its text.
import { INTRO_PLAYBOOK_DATA as _PLAYBOOK_DATA } from "./introductions-data.js";
import { saveChronicleFromButton, writeChronicle } from "../utils/chronicle.js";
import { getSetting, setSetting } from "../settings.js";
import { getWalkthroughResume, patchWalkthroughResume, markWalkthroughDone, saveWalkthroughPosition } from "./walkthrough-resume.js";
// Pure round-robin/done logic for the looping answer/ask steps (unit-tested).
import {
	stepPcDone, nextActiveIndex, firstActiveIndex, prevActiveIndex, lastActiveIndex, turnsUntilActive,
	cursorReaction, cursorPositionKey, withRecordedAnswer, withAnswerEdited, withoutAnswer,
} from "./introductions-flow.js";
import { isPrimaryGM, anyActiveGM, primaryGM } from "../utils/primary-gm.js";

import { escHtml } from "../utils/strings.js";
import { findOpenApp } from "../utils/open-windows.js";
import { merge3, diffHunks, mapIndex } from "../utils/text-rebase.js";
import { SYSTEM_ID } from "../system-id.js";

/** Whether this client runs the Introductions: the GM at the table (primary), the only one who writes it. */
const runsIntroductions = () => !!game.user?.isGM && isPrimaryGM();

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
		kind: "final", title: "Let spring burst forth", icon: "fa-seedling",
		getInstruction: () => `<strong>Add each player's home</strong> to Stonetop's Places of Interest. When everyone is done, <strong>let spring burst forth!</strong><span class="stonetop-intros-instruction-note">Players can reach the Stonetop playbook by hitting the <strong>Stonetop</strong> button in the navbar of their character sheet.</span>`,
		getQuestions:   () => null,
	},
];

// The last real phase (the final "let spring burst forth" screen).
const _LAST_PHASE = _PHASES.length - 1;

// A round-robin phase goes around the table (narration + the two steps); only the
// final phase does not. A "step" phase is a looping answer/ask step.
const _isRoundRobin = (phase) => !!phase && phase.kind !== "final";
const _isStep       = (phase) => !!phase && (phase.kind === "answer" || phase.kind === "ask");

// ── Helpers ───────────────────────────────────────────────────────────────────

// A chosen-question index normalized to an int, or null (no/blank prompt).
const _normQ = (v) => (Number.isInteger(v) ? v : null);

// Who an answer is about, normalized to an actor id, or null (nobody at this table was picked).
//
// ⚠ NULL IS THE ORDINARY ANSWER, not a fault. Most "Bonds & ties" answers are about somebody
// outside the party ("my sister Maeve"), and the pick is offered rather than required, so a blank
// one is simply an answer nobody was asked to point at. The relationship map falls back to looking
// for a name in the writing (relmap/relmap-intros.js), which is all it ever had before this.
const _normWho = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

// A step's unrecorded draft, or null. Each step keeps its own under intro.drafts, so recording or
// passing one step never touches the other's. A session started before that kept ONE shared
// `live` buffer (tagged with its stepKey) plus a `parked` slot for the other step; those are still
// read here, and the next write for the step folds them into intro.drafts (_saveDraft, _commitStep).
const _draftIn = (intro, stepKey) => {
	const own = intro.drafts?.[stepKey];
	if (own && typeof own === "object") return own;
	if (intro.live?.stepKey === stepKey) return intro.live;
	const parked = intro.parked?.[stepKey];
	return parked && typeof parked === "object" ? parked : null;
};

// Update entries removing the old-shape copies of one step's draft (see _draftIn). Empty once folded.
const _legacyDraftDeletions = (intro, stepKey, base) => {
	const paths = [];
	if (intro.live?.stepKey === stepKey) paths.push(`${base}.live`);
	if (intro.parked?.[stepKey]) paths.push(`${base}.parked.${stepKey}`);
	return Object.fromEntries(paths.map(path => deletionEntry(path)));
};

// ── IntroductionsDialog ───────────────────────────────────────────────────────

export class IntroductionsDialog extends StonetopDialog {
	constructor(options = {}) {
		super(options);
		this._phase       = 0;
		this._pcIndex     = 0;
		this._pcs         = [];
		this._rosterHooks = null;
		this._introHook   = null;
		this._liveDraftTimer = null;
		// One-shot: a commit has just cleared the live draft, so the re-render that follows
		// must NOT flush the (still un-rebuilt) capture DOM back into it. See _commitStep.
		this._skipDraftFlushOnce = false;
		// The cursor position this dialog is currently DRAWN at (see cursorPositionKey),
		// recorded by _syncFromCursor. handleIntroCursor compares against it to tell a real
		// move from one of the same-position writes a single turn attracts.
		this._cursorKey   = null;
		// What this client last knew the editable capture field's flag to hold: { key, text, q,
		// who }, keyed by the field's own "actorId:roundKey|stepKey". The yardstick for "typed
		// here and not saved yet" (see _captureDirty) and the common base a newer value written
		// by the other editor is merged against (see _absorbCaptureWrite).
		this._captureSeen = null;
	}

	// Entry point used by the Welcome guide / macro: show the dialog. The GM resumes its
	// own saved position; a player seeds their phase/turn from the shared cursor (the GM
	// drives; players follow). The turn order is the introductions' own setting, so opening
	// this never creates or touches a Combat (see introductions-order.js).
	static async open() {
		const existing = IntroductionsDialog._current();
		if (existing) { existing.bringToTop(); return existing; }
		// Guard against two near-simultaneous open() calls racing before the first instance
		// registers in ui.windows: a cursor write can land while the ready-time open is still in
		// flight, and on a GM reload the walkthrough resume and resumeRunningSession can both
		// open it. Without this each would see _current() null and stack two dialogs. Coalesce
		// them onto one in-flight open.
		if (IntroductionsDialog._opening) return IntroductionsDialog._opening;
		IntroductionsDialog._opening = IntroductionsDialog._doOpen();
		try { return await IntroductionsDialog._opening; }
		finally { IntroductionsDialog._opening = null; }
	}

	static async _doOpen() {
		const dialog = new IntroductionsDialog();
		// A world that arranged its table in the old Combat-tracker order gets that order copied
		// across the first time a GM opens this (primary GM only; a no-op every time after).
		// Before the resume below, so a resumed round-robin reads the copied order.
		try {
			await adoptLegacyIntroOrder();
		} catch (err) {
			console.error("Stonetop | Introductions: failed to carry over the old turn order", err);
		}
		// A LIVE SESSION ALWAYS WINS over this browser's own saved spot, for a GM too. The saved
		// spot is per browser and goes stale the moment the table moves on without it (a GM who
		// reloads, or opens a second tab), and the first render writes this dialog's spot back
		// into the cursor: preferring the saved one dragged every player back to wherever this
		// GM had last been. The saved spot is only for reopening a session nobody is running.
		if (dialog._cursor().active) dialog._syncFromCursor();
		else if (game.user?.isGM) dialog._restorePosition();
		else dialog._syncFromCursor();
		return dialog.render(true);
	}

	// The currently open dialog instance, if any. Checks both app registries so this
	// keeps working if the dialog is ever migrated to ApplicationV2 (see open-windows.js);
	// silently answering null would stack a second copy on every cursor write.
	static _current() {
		return findOpenApp(w => w instanceof IntroductionsDialog);
	}

	// The name of the GM running the table (the one isPrimaryGM answers yes for), for the note a
	// second GM sees in place of the controls only the primary may use.
	static _primaryGmName() {
		return primaryGM()?.name || "Another GM";
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
		if (runsIntroductions()) return; // the author ignores its own writes
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
		const cursor = getSetting(_CURSOR_SETTING) ?? {};
		// Baseline the show-nonce so a "Show players" click from BEFORE this load doesn't
		// re-summon the dialog on every reload: only a live click after now force-opens it.
		// For a GM too: a secondary GM follows the cursor like a player, and without a baseline
		// the first cursor write after its reload counted as a force-show.
		IntroductionsDialog._lastShowNonce = Number.isInteger(cursor.showNonce) ? cursor.showNonce : -1;
		IntroductionsDialog._watchGmPresence();
		if (game.user?.isGM) return;
		// No GM online, so nobody can run the session: a cursor left active by a GM who closed
		// the tab without closing the window would otherwise summon the dialog on every login.
		// Held instead, and opened when a GM connects (see _watchGmPresence).
		if (cursor.active && !anyActiveGM()) { IntroductionsDialog._heldForGm = true; return; }
		// Let handleIntroCursor run its turn toast / focus bookkeeping first (it opens on the
		// player's turn); then, if a session is active but it isn't their turn, open the
		// dialog anyway so the reload rejoins them. open()'s _current/_opening guards coalesce
		// two near-simultaneous opens, so it never stacks two dialogs.
		IntroductionsDialog.handleIntroCursor(cursor);
		if (cursor.active && !IntroductionsDialog._current()) IntroductionsDialog.open();
	}

	// Ready-time, for the GM running the table: a session still marked live (the GM closed the
	// browser tab, or reloaded in another browser that has no saved spot) reopens at the cursor,
	// so it can be carried on or closed. Closing the window is what ends a session, and without
	// this nothing on the GM's screen would say one was still running. Called from Ready.js after
	// the walkthrough resume, so it coalesces with that reopen rather than stacking a second copy.
	static resumeRunningSession() {
		if (!runsIntroductions()) return null;
		if (!getSetting(_CURSOR_SETTING)?.active) return null;
		const existing = IntroductionsDialog._current();
		if (existing) return existing;
		return IntroductionsDialog.open();
	}

	// GMs coming and going, watched once per client. A player held back because no GM was online
	// opens the running session when one connects. A GM client with the window open redraws, since
	// who runs the table (and so who gets Back / Next) may just have changed hands.
	static _watchGmPresence() {
		if (IntroductionsDialog._presenceHook) return;
		IntroductionsDialog._presenceHook = Hooks.on("userConnected", (user, connected) => {
			if (!user?.isGM || user.id === game.user?.id) return;
			if (game.user?.isGM) {
				const open = IntroductionsDialog._current();
				if (open?.rendered) open.render(false);
				return;
			}
			if (!connected || !IntroductionsDialog._heldForGm) return;
			IntroductionsDialog._heldForGm = false;
			if (getSetting(_CURSOR_SETTING)?.active && !IntroductionsDialog._current()) IntroductionsDialog.open();
		});
	}

	// onChange handler for the saved turn order (wired in Ready.js). Runs on every client,
	// the writer's included. Only the pre-check shows the order; a running session follows
	// the cursor's own pcOrder, so a change made elsewhere mid-session must not repaint it.
	static onOrderChanged() {
		const dialog = IntroductionsDialog._current();
		if (dialog && dialog._phase === 0) dialog.render(false);
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-introductions",
			title:     "Character Introductions",
			template:  "systems/stonetop-pwd/templates/dialogs/introductions.hbs",
			// The PRIMARY GM gets a jump-to-step rail (see getData's `steps`), so seat it a
			// little wider — matching the Expedition dialog's 640. Players and secondary GMs
			// have no rail and keep the narrower single column.
			width:     (runsIntroductions() ? 640 : 520),
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-introductions"],
		});
	}

	// Every answer, pass and turn written anywhere at the table redraws this window, which drew the
	// column back at its top under whoever was reading it. A redraw of the same turn keeps the
	// place; the next phase or PC opens at the top. The pre-check (phase 0) scrolls its own list.
	get _keptScrollSelector() { return ".stonetop-intros-precheck, .stonetop-guide-main"; }
	get _keptPlaceKey() { return `${this._phase}:${this._pcs?.[this._pcIndex]?.id ?? ""}`; }

	async _render(force, options) {
		// Persist whatever's typed in the editable capture field to its flag BEFORE the DOM is
		// rebuilt. The narration rounds have no player commit button (only autosave), so a turn
		// advance — the GM's Next writes the cursor, which re-renders this dialog whether or not
		// the player is mid-word, because their turn may just have ended — would otherwise drop
		// the last, not-yet-debounced characters (a removed focused textarea doesn't reliably
		// fire its blur `change`). Flushing here catches every re-render path, so a player's
		// introduction survives the hand-off. Same-position cursor writes don't reach here at
		// all while they type: cursorReaction defers those instead.
		if (this._closing) return;
		await this._flushCaptureFromDom();
		await super._render(force, options);
		// ONLY WHEN THIS RENDER ACTUALLY DREW. A render that began before close() (a flush was
		// still awaiting) finds the window closing or closed, and core quietly skips it. The two
		// writes below would still run, and the cursor one put `active: true` straight back after
		// close() had ended the session, summoning every player again.
		const states = Application.RENDER_STATES;
		if (this._closing || (states && this._state !== states.RENDERED)) return;
		this._noteCaptureShown();
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
		// The primary GM only. This is a read-modify-write of the whole cursor, so a second GM's
		// copy, read a moment before the primary moved the turn on, put the turn back.
		if (!isPrimaryGM()) {
			ui.notifications?.info(`${IntroductionsDialog._primaryGmName()} is running the introductions, so only they can show them to the players.`);
			return;
		}
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
		html.find(".stonetop-intros-move").on("click", ev => {
			const el = ev.currentTarget;
			this._moveInOrder(el.dataset.actorId, Number(el.dataset.delta));
		});
		html.find(".stonetop-intros-begin").on("click", () => this._begin());
		html.find(".stonetop-intros-next").on("click",  () => this._advance());
		html.find(".stonetop-intros-pass").on("click",  () => this._confirmPass());
		html.find(".stonetop-intros-done").on("click",  () => this._recordCurrentDraft());
		html.find(".stonetop-intros-back").on("click",  () => this._retreat());
		html.find(".stonetop-intros-close").on("click", ev => this._finish(ev.currentTarget));
		// GM sidebar: jump straight to a step (the shared TOC-rail chrome).
		html.find(".stonetop-guide-toc-btn").on("click", ev => this._jumpToPhase(Number(ev.currentTarget.dataset.stepIndex)));

		// The GM's corrections to a step already taken: un-pass a PC, and edit or delete one of
		// their recorded answers. Each control carries the PC, the step and (for an answer) its
		// place in the list, so nothing is read off this._pcIndex, which the cursor may move.
		html.find(".stonetop-intros-unpass").on("click", ev => {
			const { actorId, stepKey } = ev.currentTarget.dataset;
			this._unpass(actorId, stepKey);
		});
		html.find(".stonetop-intros-recorded-edit").on("click", ev => {
			const { actorId, stepKey, answerIndex } = ev.currentTarget.dataset;
			this._startAnswerEdit(actorId, stepKey, Number(answerIndex));
		});
		html.find(".stonetop-intros-recorded-edit-field").on("input", ev => {
			if (this._editingAnswer) this._editingAnswer.text = ev.currentTarget.value;
		});
		html.find(".stonetop-intros-recorded-save").on("click", () => this._saveAnswerEdit());
		html.find(".stonetop-intros-recorded-cancel").on("click", () => this._cancelAnswerEdit());
		html.find(".stonetop-intros-recorded-delete").on("click", ev => {
			const { actorId, stepKey, answerIndex } = ev.currentTarget.dataset;
			this._confirmDeleteAnswer(actorId, stepKey, Number(answerIndex));
		});

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
		//
		// ⚠ EXCEPT `who`, WHICH COMES OFF ITS OWN CONTROL, and the asymmetry is the point. The about
		// pick shows its own state and deliberately does NOT re-render (see its handler), so its DOM
		// is never a render behind — while its flag is a `setFlag` behind, for as long as that write
		// is in the air. Read off the flag, a keystroke landing in that window carried the OLD pick
		// forward and the debounced write 300ms later put it back over the one the writer had just
		// made, with nothing on screen to say so.
		const composed = (actorId, stepKey) => {
			const { q, who } = this._stepDraft(actorId, stepKey);
			return { q, who: this._aboutPicked(actorId, stepKey) ?? who };
		};
		html.find(".stonetop-intros-draft").on("input", ev => {
			const el = ev.currentTarget;
			const { q, who } = composed(el.dataset.actorId, el.dataset.stepKey);
			this._setSaveStatus("saving");
			this._scheduleLiveDraft(el.dataset.actorId, el.dataset.stepKey, q, el.value, who);
		});
		html.find(".stonetop-intros-draft").on("change", async ev => {
			const el = ev.currentTarget;
			this._cancelLiveDraft();
			await this._saveDraft(el.dataset.actorId, el.dataset.stepKey, { a: el.value });
			this._setSaveStatus("saved");
		});
		// Pick (or toggle off) which question the draft answers/asks, preserving any typed
		// text, then re-render to move the highlight and update the answered gray-out.
		html.find(".stonetop-intros-question-pick").on("click", async ev => {
			const el      = ev.currentTarget;
			const idx     = Number(el.dataset.qIndex);
			const { q: current } = composed(el.dataset.actorId, el.dataset.stepKey);
			const domA    = this.element?.[0]?.querySelector(".stonetop-intros-draft")?.value ?? "";
			this._cancelLiveDraft();
			await this._saveDraft(el.dataset.actorId, el.dataset.stepKey, { q: current === idx ? null : idx, a: domA });
			this.render(false);
		});
		// Who at this table the answer is about. Written to the flag the moment it changes, like a
		// question pick and for the same reason: from here on the flag is what every other writer
		// reads the pick back out of, so it must never be a render behind the control.
		//
		// NO RE-RENDER OF ITS OWN, unlike the question pick, which has a highlight and a gray-out
		// to move. This select shows its own state, and rebuilding the step here would take the
		// caret out of the answer field somebody is very likely still typing in. The write
		// broadcasts, so the other client's view of the pick follows on its own.
		html.find(".stonetop-intros-about-pick").on("change", async ev => {
			const el   = ev.currentTarget;
			const domA = this.element?.[0]?.querySelector(".stonetop-intros-draft")?.value ?? "";
			this._cancelLiveDraft();
			this._setSaveStatus("saving");
			await this._saveDraft(el.dataset.actorId, el.dataset.stepKey, { a: domA, who: el.value });
			this._setSaveStatus("saved");
		});

		this._registerRosterHooks();
		this._registerIntroHooks();
	}

	// The recorded answers blob. The GM (the only writer) edits through an in-memory
	// draft so rapid successive saves — e.g. an answer textarea blurring just as a
	// question button is clicked — compose synchronously instead of racing the async
	// world-settings write; players read the persisted value fresh each render.
	// Not StepperDialog's queued _updateAnswers: the harvest reads this copy synchronously inside
	// the updateActor hook, and the copy must also be dropped when this GM becomes primary (below).
	_answers() {
		if (game.user?.isGM) return (this._draft ??= { ...(getSetting(_ANSWERS_SETTING) ?? {}) });
		return getSetting(_ANSWERS_SETTING) ?? {};
	}

	// The in-memory copy above is only good for as long as this client is the one writing the
	// setting. A GM that has just become primary (the one before it left) holds a copy from
	// whenever it first read it, and harvesting into that would write the stale rest back over
	// everything the previous primary recorded since. So it is dropped, and re-read, on the way in.
	_refreshDraftIfNewPrimary() {
		const primary = runsIntroductions();
		if (primary && !this._wasPrimary) this._draft = null;
		this._wasPrimary = primary;
		return primary;
	}

	// ── Answer/ask step data: the player's own actor flag ──────────────────────
	// The looping answer/ask steps are authored on each PC's own actor flag
	// flags.stonetop-pwd.intro (a write the owning player is always allowed to make —
	// see Phase 3), so it survives reload and a momentarily-absent GM. The GM harvests
	// it into the world-scoped introductionsAnswers (the Chronicle source) below. Shape:
	//   intro = { step4:{answers:[{q,a,who}],passed}, step6:{…},
	//             drafts:{ step4?:{q,a,who}, step6?:{q,a,who} } }
	// where each step's in-progress draft sits under its own key (an unrecorded draft of one step
	// waits there while the GM runs the other) and `who` is the actor id of the player character
	// the answer is about, where the writer picked one. Older sessions' `live`/`parked`: _draftIn.

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

	// This PC's committed record for a step: { answers:[{q,a,who}], passed }.
	_stepRecord(actorId, stepKey) {
		const s = this._intro(actorId)[stepKey];
		return { answers: Array.isArray(s?.answers) ? s.answers : [], passed: !!s?.passed };
	}

	// The in-progress draft ({ q, a, who }) for a step, or an empty one.
	_stepDraft(actorId, stepKey) {
		const draft = this._draftSource(actorId, stepKey);
		return draft
			? { q: _normQ(draft.q), a: typeof draft.a === "string" ? draft.a : "", who: _normWho(draft.who) }
			: { q: null, a: "", who: null };
	}

	// The raw draft object behind _stepDraft, or null (see _draftIn).
	_draftSource(actorId, stepKey) {
		return _draftIn(this._intro(actorId), stepKey);
	}

	// Who the "Who is this about?" select on screen is showing, or undefined when this step has no
	// such control (a narration round, or a readonly preview) — which is the difference `composed`
	// leans on, since "" is a real answer there meaning "nobody at this table".
	//
	// There is only ever ONE editable capture on screen, the same assumption `_setSaveStatus` makes,
	// so the control is found without building a selector out of ids; its own data-* are then
	// checked, so a select left over from another turn cannot answer for this one.
	_aboutPicked(actorId, stepKey) {
		const el = this.element?.[0]?.querySelector(".stonetop-intros-about-pick");
		if (!el || el.dataset.actorId !== actorId || el.dataset.stepKey !== stepKey) return undefined;
		return el.value;
	}

	// Update the draft for a step. Writes the whole draft (every key) so a cleared field
	// can't leave a stale sub-key behind (setFlag deep-merges). No-op without write permission (a non-owning player off-turn), and a
	// no-op when nothing actually changed — so per-keystroke drafting (and the blur `change`
	// that repeats the last input) doesn't spam a document write + broadcast to every client.
	//
	// ⚠ A PATCH, MERGED OVER THE STEP'S CURRENT DRAFT, and the merge happens HERE rather than at
	// each call site. The buffer is still written whole (see above), so a caller that named only
	// two of the three fields used to rub out the third — a keystroke handler missing `who` would
	// erase the person the writer had just picked, on the very next character they typed. That was
	// an invariant every one of six call sites had to remember, enforced by nothing, and its failure
	// was silent and destructive. Now a caller passes what it is CHANGING; anything it does not name
	// is carried over. An explicit `null` still overrides, which is what the question-pick toggle
	// needs to mean "no question chosen".
	//
	// The fields it does name are still read off the FLAG rather than the DOM where they are
	// composed — see the note on the draft listeners for why that half matters.
	async _saveDraft(actorId, stepKey, patch = {}) {
		const actor = this._ownedActor(actorId);
		if (!actor) return;
		const cur = this._stepDraft(actorId, stepKey);
		const { q, a, who } = { ...cur, ...patch };
		const next = { q: _normQ(q), a: typeof a === "string" ? a : "", who: _normWho(who) };
		const base    = `flags.${_FLAG_SCOPE}.${_INTRO_FLAG}`;
		const legacy  = _legacyDraftDeletions(this._intro(actorId), stepKey, base);
		const folding = Object.keys(legacy).length > 0;
		if (!folding && cur.q === next.q && cur.a === next.a && cur.who === next.who) return;
		if (!folding) {
			await actor.setFlag(_FLAG_SCOPE, `${_INTRO_FLAG}.drafts.${stepKey}`, next);
			return;
		}
		// An old-shape draft for this step moves into its own key in the same write.
		await actor.update({ [`${base}.drafts.${stepKey}`]: next, ...legacy });
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
	//
	// ⚠ ALL THREE FIELDS ARE PASSED HERE ON PURPOSE, and this is the one caller that should. They
	// were SNAPSHOTTED at input time (see the draft listeners), and the whole point of the snapshot
	// is that the write 300ms later records what was on screen when the key was pressed rather than
	// whatever the flag says by then. Letting `_saveDraft` merge these from the current draft would
	// quietly undo that.
	//
	// ⚠ AND THE STEP'S RECORD IS SNAPSHOTTED WITH THEM (_commitMark). The turn and phase can still
	// match when the write fires while the draft it carries has meanwhile been RECORDED: the GM's
	// Next landed inside the 300ms. Written anyway, it put the recorded text back as a fresh draft
	// carrying the question just used, and the next Next recorded it a second time.
	_scheduleLiveDraft(actorId, stepKey, q, a, who) {
		const mark = this._commitMark(actorId, stepKey);
		this._scheduleLiveWrite(actorId,
			phase => _isStep(phase) && phase.stepKey === stepKey,
			async () => {
				if (this._commitMark(actorId, stepKey) !== mark) return;
				await this._saveDraft(actorId, stepKey, { q, a, who });
			});
	}

	// What a PC has recorded for a step, as one comparable string: it changes whenever an answer
	// is recorded, edited or deleted, or the PC passes or is un-passed. A draft typed against one
	// mark and written under another was typed against a record that has since moved on.
	_commitMark(actorId, stepKey) {
		return JSON.stringify(this._stepRecord(actorId, stepKey));
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

	// ── The capture field while two people can write it ─────────────────────────────
	// On a turn owned by a present player the primary GM co-edits the same field (see
	// _canEditActor), and each side saves its WHOLE text. Two rules keep either from rubbing
	// out the other: a field only ever saves what was typed into it (_captureDirty), and every
	// newer value that lands is merged into the field on screen at once, caret and all, rather
	// than waiting for a re-render that is skipped for as long as somebody's caret is in it
	// (_absorbCaptureWrite). Two saves that cross in flight sort themselves out: the side whose
	// save lands second gets the other's first, while its own words are still in its field,
	// merges the two, and saves the result.

	// The key a capture field is tracked under: its PC and round / step, off its own data-*.
	_captureKey(el) {
		const { actorId, roundKey, stepKey } = el?.dataset ?? {};
		const part = roundKey || stepKey;
		return actorId && part ? `${actorId}:${part}` : null;
	}

	// Does this field hold typing that hasn't been saved yet? Yes when it differs from what this
	// client last saw in the flag. With no record for the field (never drawn by this dialog),
	// assume it does: that is how the flush behaved before there was a record to go on.
	_captureDirty(el) {
		const seen = this._captureSeen;
		return !seen || seen.key !== this._captureKey(el) || el.value !== seen.text;
	}

	// After a render: note what the editable field was drawn with, then catch it up with the flag
	// in case a save landed while the render was under way (its hook ran against the old DOM).
	_noteCaptureShown() {
		const el = this.element?.[0]?.querySelector(
			"textarea.stonetop-intros-answer:not([readonly]), textarea.stonetop-intros-draft:not([readonly])");
		const key = this._captureKey(el);
		if (!key) { this._captureSeen = null; return; }
		const { actorId, stepKey } = el.dataset;
		const draft = stepKey ? this._stepDraft(actorId, stepKey) : null;
		// `mark`: the step's record this field was drawn against (see _commitMark). A field drawn
		// before an answer was recorded must never be flushed back in after it (_draftWorthFlushing).
		const mark  = stepKey ? this._commitMark(actorId, stepKey) : null;
		this._captureSeen = { key, text: el.value, q: draft?.q ?? null, who: draft?.who ?? null, mark };
		const actor = this._actor(actorId);
		if (actor) this._absorbCaptureWrite(actor, null);
	}

	// A PC's intro flag just changed, by anyone, this client included: bring the capture field on
	// screen up to date with it, in place. Returns true when the change RECORDED (or passed) the
	// draft on screen and the field was emptied, which the caller answers with a redraw even while
	// the caret is in it (there is nothing left in the field to protect).
	_absorbCaptureWrite(actor, userId) {
		const root = this.element?.[0];
		if (!root || !actor) return false;
		const phase = _PHASES[this._phase];
		// A readonly mirror carries no data-*, so it's matched to the PC shown. Nothing is typed
		// into one, so it simply takes the text as it stands. A step's draft that has just been
		// recorded is left alone: the re-render moves it into the recorded list.
		const mirror = root.querySelector("textarea.stonetop-intros-answer[readonly], textarea.stonetop-intros-draft[readonly]");
		if (mirror && this._pcs?.[this._pcIndex]?.id === actor.id) {
			const now = _isStep(phase)
				? (this._hasLiveDraft(actor.id, phase.stepKey) ? this._stepDraft(actor.id, phase.stepKey).a : null)
				: (phase?.roundKey ? this._narration(actor.id, phase.roundKey) : null);
			if (typeof now === "string" && mirror.value !== now) this._setFieldText(mirror, now);
		}
		const nar = root.querySelector("textarea.stonetop-intros-answer:not([readonly])");
		if (nar?.dataset.actorId === actor.id && nar.dataset.roundKey) {
			const { actorId, roundKey } = nar.dataset;
			const unsaved = this._mergeIntoField(nar, this._narration(actorId, roundKey), userId);
			if (unsaved !== null) {
				this._setSaveStatus("saving");
				this._scheduleNarration(actorId, roundKey, unsaved);
			}
		}
		const draftEl = root.querySelector("textarea.stonetop-intros-draft:not([readonly])");
		if (draftEl?.dataset.actorId === actor.id && draftEl.dataset.stepKey) return this._absorbDraftWrite(root, draftEl, userId);
		return false;
	}

	// The answer/ask step's half of _absorbCaptureWrite: the text merges like narration's, and the
	// picks (question, who it's about) follow the flag. Returns true when it emptied the field.
	_absorbDraftWrite(root, el, userId) {
		const { actorId, stepKey } = el.dataset;
		const key   = this._captureKey(el);
		const seen  = this._captureSeen?.key === key ? this._captureSeen : null;
		const mark  = this._commitMark(actorId, stepKey);
		if (!this._hasLiveDraft(actorId, stepKey)) {
			// Recording or passing clears the draft outright. That ENDS the answer rather than
			// editing it, so when the field was showing a draft that has now been recorded, it is
			// emptied here and then, caret or no caret. Left standing (the redraw is skipped while
			// somebody is typing), it was the recorded answer sitting in an editable field, and the
			// next keystroke or flush wrote it back as a brand-new draft with the question just used.
			// A field that showed no saved draft has nothing recorded out of it, and is left alone.
			if (!seen || !seen.text || seen.mark === mark) return false;
			this._cancelLiveDraft();
			this._setFieldText(el, "");
			for (const btn of root.querySelectorAll(".stonetop-intros-question-pick")) btn.classList.toggle("is-selected", false);
			const about = root.querySelector(".stonetop-intros-about-pick");
			if (about?.dataset.actorId === actorId && about.dataset.stepKey === stepKey) about.value = "";
			this._captureSeen = { ...seen, text: "", q: null, who: null, mark };
			return true;
		}
		// The draft survived, so whatever changed in the record (the GM editing an older answer)
		// did not record what is in this field: it stays a draft against the record as it is now.
		if (seen) seen.mark = mark;
		const draft = this._stepDraft(actorId, stepKey);
		// A pick is never unsaved (a click writes the flag before anything else), so the flag's is
		// simply shown. Left alone, a question the other editor picked stayed unlit here while the
		// caret was in the field, and clicking it to pick it toggled it straight back off.
		if (!seen || seen.q !== draft.q) {
			for (const btn of root.querySelectorAll(".stonetop-intros-question-pick")) {
				btn.classList.toggle("is-selected", Number(btn.dataset.qIndex) === draft.q);
			}
		}
		// Likewise who it's about, which matters more: the next keystroke saves whatever this select
		// shows (see `composed` in activateListeners), so a stale one put the old pick back.
		const about = root.querySelector(".stonetop-intros-about-pick");
		if (about?.dataset.actorId === actorId && about.dataset.stepKey === stepKey && (!seen || seen.who !== draft.who)) {
			about.value = draft.who ?? "";
		}
		const unsaved = this._mergeIntoField(el, draft.a, userId);
		this._captureSeen = { ...this._captureSeen, q: draft.q, who: draft.who, mark };
		if (unsaved !== null) {
			this._setSaveStatus("saving");
			this._scheduleLiveDraft(actorId, stepKey, draft.q, unsaved, this._aboutPicked(actorId, stepKey) ?? draft.who);
		}
		return false;
	}

	// Merge the flag's value for a field into what's on screen, and record it as seen. Returns the
	// text still to be saved (this client's own typing, now on top of the newer value), or null
	// when the field holds nothing the flag doesn't.
	_mergeIntoField(el, now, userId) {
		const key  = this._captureKey(el);
		const seen = this._captureSeen?.key === key ? this._captureSeen : null;
		const base = seen ? seen.text : el.value;
		this._captureSeen = { q: null, who: null, ...seen, key, text: now };
		// This client's own save coming back. The field already holds it, and whatever was typed
		// since has a timer behind it; only merged-in text with no timer left still needs a save.
		if (userId && userId === game.user?.id) {
			return (el.value !== now && !this._liveDraftTimer) ? el.value : null;
		}
		const text = merge3(base, el.value, now);
		if (text !== el.value) this._setFieldText(el, text);
		return text !== now ? text : null;
	}

	// Replace a field's text without upsetting whoever is typing in it: the caret and any
	// selection move with the text around them, and the field keeps its scroll position.
	_setFieldText(el, text) {
		const focused = el === globalThis.document?.activeElement;
		const { selectionStart, selectionEnd, selectionDirection, scrollTop } = el;
		const hunks = focused ? diffHunks(el.value, text) : null;
		el.value = text;
		if (focused && Number.isInteger(selectionStart)) {
			el.setSelectionRange?.(mapIndex(selectionStart, hunks), mapIndex(selectionEnd, hunks), selectionDirection ?? "none");
		}
		if (Number.isFinite(scrollTop)) el.scrollTop = scrollTop;
	}

	// Commit the current draft as a recorded answer: append { q, a, who } to the step's
	// answers list (written whole, since arrays replace wholesale) and clear the live
	// buffer (the -= unset key, since setFlag/update merges). Returns false when the
	// draft has no answer text. A null q is allowed (blank prompt), matching the
	// Chronicle's "answer with no marked question" handling.
	//
	// The pick is written only when there IS one, so a record carries `who` or carries nothing:
	// every world that ran its introductions before the picker existed has answers without the
	// key, and the readers all treat absent and null alike (see _normWho). Writing `who: null` on
	// every answer would spend a field on saying nothing, in a blob the Chronicle stores whole.
	async _recordDraft(actorId, stepKey) {
		const actor = this._ownedActor(actorId);
		if (!actor) return false;
		const draft = this._stepDraft(actorId, stepKey);
		const a     = String(draft.a ?? "").trim();
		if (!a) return false;
		const entry   = { q: _normQ(draft.q), a, ...(draft.who ? { who: draft.who } : {}) };
		await this._commitStep(actor, stepKey, "answers", withRecordedAnswer(this._stepRecord(actorId, stepKey).answers, entry));
		return true;
	}

	// Mark a PC passed (or un-passed) for a step, clearing any half-typed draft.
	async _setPassed(actorId, stepKey, passed) {
		const actor = this._ownedActor(actorId);
		if (!actor) return;
		await this._commitStep(actor, stepKey, "passed", passed);
	}

	// ── The GM's corrections: un-pass, and edit or delete a recorded answer ───────────────
	// A player who passed by mistake, or recorded something they want back, asks the GM (which is
	// what the Pass prompt tells them). The GM running the table is the only one offered these: a
	// second GM writing the same list would race the first, and the harvest and Chronicle follow
	// the primary's writes.

	// Write a PC's whole answer list for a step. Whole, through the dotted path, because a flag
	// merge cannot drop an element; and WITHOUT touching the live draft, unlike _commitStep: the
	// player may be partway through their next answer while the GM fixes an earlier one.
	async _writeAnswers(actor, stepKey, answers) {
		await actor.update({ [`flags.${_FLAG_SCOPE}.${_INTRO_FLAG}.${stepKey}.answers`]: answers });
	}

	async _unpass(actorId, stepKey) {
		if (!runsIntroductions() || !this._actor(actorId)) return;
		await this._setPassed(actorId, stepKey, false);
		this.render(false);
	}

	_startAnswerEdit(actorId, stepKey, index) {
		if (!runsIntroductions()) return;
		const entry = this._stepRecord(actorId, stepKey).answers[index];
		if (!entry) return;
		const text = String(entry.a ?? "");
		this._editingAnswer = { actorId, stepKey, index, text, original: text };
		this.render(false);
	}

	_cancelAnswerEdit() {
		this._editingAnswer = null;
		this.render(false);
	}

	// Save the answer being edited. The list is re-read first, and the edit refused if that answer
	// is no longer the one the GM opened (deleted, or changed under them meanwhile), so a stale
	// index can never reword somebody else's answer.
	async _saveAnswerEdit() {
		const ed = this._editingAnswer;
		if (!ed || !runsIntroductions()) return;
		const actor = this._actor(ed.actorId);
		if (!actor) return;
		const field = this.element?.[0]?.querySelector(".stonetop-intros-recorded-edit-field");
		const text  = typeof field?.value === "string" ? field.value : ed.text;
		const answers = this._stepRecord(ed.actorId, ed.stepKey).answers;
		if (String(answers[ed.index]?.a ?? "") !== ed.original) {
			ui.notifications?.warn("That answer changed while you were editing it. Have another look, then edit it again.");
			this._editingAnswer = null;
			this.render(false);
			return;
		}
		const next = withAnswerEdited(answers, ed.index, text);
		if (!next) {
			ui.notifications?.warn("An answer can't be left empty. To remove it, delete it instead.");
			return;
		}
		this._editingAnswer = null;
		await this._writeAnswers(actor, ed.stepKey, next);
		this.render(false);
	}

	async _confirmDeleteAnswer(actorId, stepKey, index) {
		if (!runsIntroductions()) return;
		const actor = this._actor(actorId);
		const entry = this._stepRecord(actorId, stepKey).answers[index];
		if (!actor || !entry) return;
		const confirmed = await confirmOutcome({
			title:   "Delete this answer?",
			content: `<p>Delete this answer from <strong>${escHtml(actor.name ?? "")}</strong>'s record?</p>`
			       + `<blockquote>${escHtml(String(entry.a ?? ""))}</blockquote>`
			       + `<p>Its question becomes free to answer again. This can't be undone.</p>`,
			yes:     { label: "Delete answer", icon: "fa-trash", className: "stonetop-dialog-btn--danger" },
			no:      { label: "Keep it" },
		});
		if (!confirmed) return;
		await this._deleteAnswer(actorId, stepKey, index, entry);
	}

	// Remove one recorded answer. Found again by its content when the list moved while the confirm
	// was up, and not at all when it has gone.
	async _deleteAnswer(actorId, stepKey, index, entry) {
		if (!runsIntroductions()) return;
		const actor = this._actor(actorId);
		if (!actor) return;
		const answers = this._stepRecord(actorId, stepKey).answers;
		const same = x => x && x.a === entry.a && x.q === entry.q;
		const at = same(answers[index]) ? index : answers.findIndex(same);
		const next = withoutAnswer(answers, at);
		if (!next) return;
		if (this._editingAnswer?.actorId === actorId && this._editingAnswer.stepKey === stepKey) this._editingAnswer = null;
		await this._writeAnswers(actor, stepKey, next);
		this.render(false);
	}

	// Write one committed step field (answers / passed) and clear THIS step's draft in the
	// same update: the two always go together (recording or passing ends the draft), so
	// centralizing means neither path can forget the unset. The other step's draft is untouched.
	//
	// The unset goes out even when this client sees no draft: the owner's latest keystroke may not
	// have reached this client yet, and it must not outlive the commit.
	async _commitStep(actor, stepKey, field, value) {
		const base  = `flags.${_FLAG_SCOPE}.${_INTRO_FLAG}`;
		const intro = actor.getFlag?.(_FLAG_SCOPE, _INTRO_FLAG) ?? {};
		const [draftKey, draftVal] = deletionEntry(`${base}.drafts.${stepKey}`);
		await actor.update({
			[`${base}.${stepKey}.${field}`]: value,
			[draftKey]: draftVal,
			..._legacyDraftDeletions(intro, stepKey, base),
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
	// a round-robin turn owned by a present player it CO-EDITS that step's shared draft
	// alongside them (each side's typing is merged into the other's field as it lands; see
	// _absorbCaptureWrite, and _hasOnlinePlayerOwner, which drives the "writing together"
	// label). A secondary GM only watches. The GM commits the draft with Next (which
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
		return playerOf(actor, { preferOnline: true })?.id ?? "";
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
	// only close() (a deliberate finish) deactivates the session. Carries the PC order the session
	// is running in, so every client follows the same table for as long as it runs.
	_syncCursorFromLocal() {
		if (!runsIntroductions()) return; // only the primary GM authors the cursor
		if (this._closing) return;
		const phase = this._phase;
		if (phase < 1 || phase > _LAST_PHASE) return;
		const def = _PHASES[phase];
		let actor = _isRoundRobin(def) ? (this._pcs[this._pcIndex] ?? null) : null;
		// NOBODY'S TURN on a step where the PC this dialog is parked on is done with it: everyone
		// has passed or answered everything (the GM's "Everyone's done, continue" wait), or the PC
		// has no questions for this step at all. Naming them handed the turn to their player, who
		// was summoned to a window with nothing left to do in it.
		if (actor && _isStep(def) && this._isPcDone(actor, def)) actor = null;
		const activeActorId = actor?.id ?? "";
		const activeUserId  = actor ? this._primaryOwnerId(actor) : "";
		const pcOrder = this._pcs.map(a => a.id);
		const cur = this._cursor();
		if (cur.active === true && cur.phase === phase
			&& cur.activeActorId === activeActorId && cur.activeUserId === activeUserId
			&& Array.isArray(cur.pcOrder) && cur.pcOrder.join() === pcOrder.join()) return;
		this._writeCursor({ active: true, phase, activeActorId, activeUserId, pcOrder });
	}

	// The PCs a cursor's GM-authored `pcOrder` names, resolved against game.actors (which every
	// client has in full); the saved introductions order when it names none.
	_cursorRoster(cur) {
		const fromCursor = Array.isArray(cur?.pcOrder)
			? cur.pcOrder.map(id => this._actor(id)).filter(a => a && playbookSlug(a))
			: [];
		return fromCursor.length ? fromCursor : introductionsRoster();
	}

	// Players (and a GM without local nav state) seed their phase/turn from the cursor.
	// Returns false when the cursor isn't running (leaves the dialog on the pre-check). The
	// roster comes from the GM-authored `pcOrder` carried in the cursor — resolved against
	// game.actors (which every client has in full) — so every client gets the same PCs and
	// turn index; falls back to the saved introductions order before a session has begun.
	_syncFromCursor() {
		const cur = this._cursor();
		// Record what we are now drawn at, so the next cursor write can tell a real move from
		// a same-position bump (see handleIntroCursor).
		this._cursorKey = cursorPositionKey(cur);
		this._pcs = this._cursorRoster(cur);
		if (!cur.active || !Number.isInteger(cur.phase) || cur.phase < 1 || cur.phase > _LAST_PHASE) {
			this._phase   = 0;
			this._pcIndex = 0;
			this._waitingOnTurn = false;
			return false;
		}
		this._phase   = cur.phase;
		const idx     = this._pcs.findIndex(a => a.id === cur.activeActorId);
		this._pcIndex = idx >= 0 ? idx : 0;
		// On a round of turns, a cursor naming nobody this client can find (nobody's turn on a
		// step everyone is done with, or a PC deleted since the GM wrote it) is a wait, not the
		// first PC's turn. Drawn as one (see getData), rather than showing PC #1 as up.
		this._waitingOnTurn = _isRoundRobin(_PHASES[cur.phase]) && idx < 0;
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
		if (!this._refreshDraftIfNewPrimary()) return;
		if (this._mergeActorIntoDraft(actor)) await setSetting(_ANSWERS_SETTING, this._answers());
	}

	// A PC's whole intro flag was removed (a reset, by macro or by hand): what was harvested from
	// it goes too. Only on a REMOVAL, seen as such by the updateActor hook. A PC that simply has no
	// flag may be one whose narration was typed straight into the setting before players wrote
	// their own, and that must stay.
	async _clearHarvested(actor) {
		if (!actor || !this._refreshDraftIfNewPrimary()) return;
		const all = this._answers();
		if (!(actor.id in all)) return;
		delete all[actor.id];
		await setSetting(_ANSWERS_SETTING, all);
	}

	// Harvest every PC's flag into the world setting in one write — run before compiling
	// the Chronicle so an un-harvested edit (or one made while this GM wasn't primary)
	// still lands. The primary GM only: a second GM's copy of the setting is whatever it last
	// read, and writing it would put back everything recorded since.
	async _harvestAll({ skipActorId = null, force = true } = {}) {
		if (!this._refreshDraftIfNewPrimary()) return false;
		// A forced harvest (closing, saving) starts from the setting as it stands, not from the
		// copy held since this dialog opened: everything recorded since is re-read from the flags
		// below either way, so nothing is lost by it, and nothing stale is written back.
		if (force) this._draft = null;
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
	//
	// A timer of its own rather than foundry.utils.debounce, so that close() and the final save can
	// CANCEL it: left pending, it compiled the Chronicle a second time over the top of the save.
	_scheduleChronicleSync() {
		if (!runsIntroductions() || this._closing) return;
		this._cancelChronicleSync();
		this._chronicleSyncTimer = setTimeout(() => {
			this._chronicleSyncTimer = null;
			this._syncChronicle();
		}, 1500);
	}

	// Drop a pending live sync. Answers true when one was pending (its changes not compiled yet).
	_cancelChronicleSync() {
		if (!this._chronicleSyncTimer) return false;
		clearTimeout(this._chronicleSyncTimer);
		this._chronicleSyncTimer = null;
		return true;
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
		if (!runsIntroductions()) return;
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
	//
	// `keepDisabled` on the way to finishing: the window closes after a good save, and a button
	// re-enabled in between let a second click run the whole finish again.
	async _saveChronicle(button, { keepDisabled = false } = {}) {
		return saveChronicleFromButton(button, {
			context:    "Introductions",
			beforeSave: () => this._harvestAll(),
			keepDisabled,
		});
	}

	// "Let spring burst forth!"— the final button now also commits everything
	// recorded to the Chronicle (GM only; there's no separate save step) before the
	// dialog closes. Players just close. If the save errors, keep the dialog open so
	// the GM can fix it and try again rather than losing the closing action.
	//
	// The GM running the table only, among GMs: the save harvests every PC into the setting, and a
	// second GM's harvest would write its own stale copy. Its window shows no such button anyway.
	async _finish(button) {
		if (game.user?.isGM) {
			if (!isPrimaryGM()) return;
			// The authoritative save is about to compile everything; a live sync still pending would
			// only compile it again over the top of it.
			this._cancelChronicleSync();
			if (!(await this._saveChronicle(button, { keepDisabled: true }))) return;
			this._finishing = true;
		}
		// Mark the run finished (drops the saved round/turn so a manual reopen starts at
		// the pre-check) — this is half of what stops the Welcome guide auto-opening once
		// spring's also burst forth. close() then re-stamps open:false.
		markWalkthroughDone(_RESUME_KEY, ["phase", "pcIndex"]);
		return this.close();
	}

	// A PC created or deleted while the pre-check is up changes the order it shows, so the
	// list redraws rather than going stale until some unrelated event. getData filters to
	// playbook-bearing actors, so a non-PC create/delete is a harmless no-op re-render. A
	// change to the saved order itself arrives through the setting's onChange instead
	// (onOrderChanged).
	//
	// A character gaining (or losing) a playbook is a PC joining or leaving that list too, so a
	// playbook change refreshes it as well: a PC made after the window opened usually gets its
	// playbook a while after it is created.
	//
	// DURING A SESSION the run is the cursor's own order, and the GM running the table keeps it
	// true: a PC deleted mid-session leaves it (and hands the turn on if it was theirs), and a new
	// PC with a playbook joins it at the end, which is where the saved order puts somebody it has
	// not placed yet (see introductions-order.js). Everyone else follows the cursor.
	_registerRosterHooks() {
		if (this._rosterHooks) return;
		const onDelete = (actor) => {
			if (this._phase === 0) return this.render(false);
			if (!this._pcs?.some(pc => pc.id === actor?.id)) return;
			if (runsIntroductions()) return this._dropFromSession(actor.id);
			// A follower: the GM's cursor write is on its way, but until it lands this window must
			// not go on showing (or fall back to the first PC for) a character that no longer exists.
			this._syncFromCursor();
			this.render(false);
		};
		const onJoin = (actor) => {
			if (this._phase === 0) return this.render(false);
			if (runsIntroductions()) this._addToSession(actor);
		};
		const onUpdate = (actor, changes) => {
			if (actor?.type !== "character" || !Object.keys(changes?.system ?? {}).some(k => k.replace(/^-=/, "") === "playbook")) return;
			onJoin(actor);
		};
		this._rosterHooks = [
			["createActor", Hooks.on("createActor", onJoin)],
			["deleteActor", Hooks.on("deleteActor", onDelete)],
			["updateActor", Hooks.on("updateActor", onUpdate)],
		];
	}

	// Primary GM: a PC deleted mid-session leaves the run. When it was their turn, the turn goes to
	// whoever is next (on a step, the next PC still answering; on a narration round, the next PC
	// in line, or the next step when they were the last). The render that follows writes the new
	// order and turn into the cursor.
	_dropFromSession(actorId) {
		const at = this._pcs.findIndex(pc => pc.id === actorId);
		if (at < 0) return;
		const wasTurn = at === this._pcIndex;
		this._pcs = this._pcs.filter(pc => pc.id !== actorId);
		if (at < this._pcIndex) this._pcIndex--;
		const phase = _PHASES[this._phase];
		if (wasTurn && this._pcs.length) {
			if (_isStep(phase)) {
				// From the PC before the gap, so the one who slid into it is first in line.
				const next = nextActiveIndex((at - 1 + this._pcs.length) % this._pcs.length, this._pcs.length,
					i => this._isPcDone(this._pcs[i], phase));
				this._pcIndex = next >= 0 ? next : Math.min(at, this._pcs.length - 1);
			} else if (_isRoundRobin(phase) && at >= this._pcs.length) {
				if (this._phase < _LAST_PHASE) this._enterPhase(this._phase + 1);
				else this._pcIndex = this._pcs.length - 1;
			}
		}
		this._pcIndex = Math.max(0, Math.min(this._pcIndex, Math.max(this._pcs.length - 1, 0)));
		if (this.rendered) this.render(false);
	}

	// Primary GM: a PC that gained its playbook mid-session joins the run at the end of the order.
	_addToSession(actor) {
		if (!actor?.id || this._pcs.some(pc => pc.id === actor.id)) return;
		if (!getPlayerCharacters().some(pc => pc.id === actor.id)) return;
		this._pcs = [...this._pcs, actor];
		if (this.rendered) this.render(false);
	}

	_unregisterRosterHooks() {
		if (!this._rosterHooks) return;
		for (const [name, id] of this._rosterHooks) Hooks.off(name, id);
		this._rosterHooks = null;
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
		// `force`: the change recorded the draft that was on screen and the field has been emptied
		// (see _absorbCaptureWrite), so there is nothing left under the caret to protect, and the
		// recorded list and the used question still need redrawing.
		let forceNext = false;
		const scheduleRender = foundry.utils.debounce(actor => {
			const force = forceNext;
			forceNext = false;
			const shown = this._pcs?.[this._pcIndex];
			if (shown && actor.id === shown.id && this.rendered && this._phase > 0
				&& (force || !this.element?.[0]?.contains(document.activeElement))) this.render(false);
		}, 150);
		this._introHook = Hooks.on("updateActor", (actor, changes, _options, userId) => {
			if (actor?.type !== "character") return;
			const stFlags = changes?.flags?.[_FLAG_SCOPE];
			if (!stFlags) return;
			if (!Object.keys(stFlags).some(k => k.replace(/^-=/, "") === _INTRO_FLAG)) return;
			// The whole intro flag removed (a reset): what was harvested from it goes too.
			if (!actor.getFlag(_FLAG_SCOPE, _INTRO_FLAG)) {
				if (game.user?.isGM) this._clearHarvested(actor);
				this._scheduleChronicleSync();
				scheduleRender(actor);
				return;
			}
			// Bring the capture field on screen up to date NOW, in place, before anything else: the
			// re-render below is skipped while somebody's caret is in it, and a field left showing
			// an old value is exactly what used to save straight back over the other editor's words.
			if (this._absorbCaptureWrite(actor, userId)) forceNext = true;
			// Only a step4/step6 change (a recorded answer or a pass) is worth mirroring
			// into the world setting — not a live-typing keystroke, so per-keystroke draft
			// writes don't churn the world setting. Harvest immediately (primary GM only).
			const introDelta   = stFlags[_INTRO_FLAG];
			const stepChanged  = !!introDelta && ("step4" in introDelta || "step6" in introDelta);
			if (game.user?.isGM && stepChanged) this._harvestActor(actor);
			// Fill the shared Chronicle in as answers are recorded and narration is typed. Fires on
			// any intro change, keystrokes included; _syncChronicle is debounced, and a prose section
			// follows its source until somebody edits it in the journal, so a half-typed round is
			// refreshed on the next tick rather than frozen. Primary-GM-guarded inside.
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
		if (this._closing) return;
		// From here on no render draws and nothing writes the cursor or the resume record (see
		// _render): a render that began before this must not undo what closing does.
		this._closing = true;
		try {
			return await this._closeNow(options);
		} finally {
			this._closing = false;
			this._finishing = false;
		}
	}

	async _closeNow(options) {
		// Keep what was typed in the last moments before the window went. The player's window is
		// closed for them when the session ends, often mid-sentence, and dropping the pending
		// keystroke write lost the tail of it. The flush saves only typing not saved yet.
		await this._flushCaptureFromDom();
		this._cancelLiveDraft();
		this._editingAnswer = null;
		// A live Chronicle sync still pending: dropped, so it can't run over the final save. When the
		// window is closed WITHOUT that save, its changes are compiled once below instead.
		const syncPending = this._cancelChronicleSync();
		// Harvest every PC's answers — narration INCLUDED — into the world setting before we
		// go. The live updateActor harvest only fires on step (step4/step6) changes, so without
		// this, narration typed then closed with the X (rather than the Save-to-Chronicle
		// button) would never reach the setting the Chronicle compiler reads. Primary GM only
		// (only a GM can write a world setting, and only the primary should).
		// Non-fatal — closing must not be blockable — but NOT silent. This is the only path that
		// persists narration typed and then closed with the X, so a swallowed failure here loses
		// player-written text outright, and the table's only clue is that the Chronicle came out
		// short. Say so loudly enough that it can be retyped before anyone moves on.
		if (runsIntroductions()) {
			try { await this._harvestAll(); }
			catch (err) {
				console.error("Stonetop | Introductions: harvesting answers on close failed", err);
				ui.notifications?.error(
					"Stonetop: the Introductions answers could not be saved. Reopen the window and "
					+ "check the latest narration before continuing.");
			}
			// Closed with the X while a live sync was still waiting: compile its changes now, once,
			// since the timer that would have is gone. Not after "Save to Chronicle", which just did.
			if (syncPending && !this._finishing) await this._syncChronicle();
		}
		this._unregisterRosterHooks();
		this._unregisterIntroHooks();
		// Closing on purpose (the X or "Let spring burst forth!") clears the open flag
		// so we don't auto-reopen on the next load; a browser reload skips close() and
		// leaves it set. The saved round/turn stays, so a manual reopen still resumes.
		patchWalkthroughResume(_RESUME_KEY, { open: false });
		// The primary GM closing on purpose ends the shared session, so players' dialogs
		// close too. (A secondary GM or a player closing their own window doesn't end it; a
		// GM browser reload skips close(), leaving the cursor active for reopen.)
		if (runsIntroductions() && this._cursor().active) this._writeCursor({ active: false });
		return super.close(options);
	}

	getData() {
		if (this._phase === 0) {
			// The pre-check roster is only needed on this screen; the round-robin below
			// reads this._pcs instead. Building it here keeps the per-keystroke re-render
			// off a full actor scan it would only throw away.
			const pcs  = introductionsRoster();
			const isGM = game.user?.isGM ?? false;
			// Reordering is a world-setting write, so it is offered to a GM only, and only
			// once there are two names to put in an order.
			const canReorder = isGM && pcs.length > 1;
			return {
				isPreCheck: true,
				isGM,
				canReorder,
				canBegin:   pcs.length > 0,
				hasNone:    pcs.length === 0,
				pcCount:    pcs.length,
				pcs: pcs.map((a, i) => ({
					id:        a.id,
					name:      a.name,
					first:     i === 0,
					last:      i === pcs.length - 1,
					upLabel:   `Move ${a.name} earlier`,
					downLabel: `Move ${a.name} later`,
				})),
			};
		}

		const isGM  = game.user?.isGM ?? false;
		// The GM running the table: the only one who moves it on, saves it, or corrects a record.
		// A second GM watches, with a note saying who is running it in place of those controls.
		const isDriver = runsIntroductions();
		const pcs   = this._pcs;
		const phase = _PHASES[this._phase];
		// Nobody's turn as far as this follower can tell (see _syncFromCursor): drawn as a wait
		// rather than as the first PC being up.
		const waiting = !isDriver && _isRoundRobin(phase) && !!this._waitingOnTurn;
		const actor = _isRoundRobin(phase) && !waiting ? (pcs[this._pcIndex] ?? null) : null;

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
				// WHO AN ANSWER IS ABOUT, picked from the table itself rather than left to be read
				// back out of the prose. The relationship map's party board draws an arrow to the
				// person named here (see relmap/relmap-intros.js): a question like "which one of
				// you has stayed my hand?" is answered about somebody at this table by
				// construction, but the ANSWER is a sentence, and "I asked her outright and she
				// only laughed" names nobody the board can find. Everyone but the writer, in the
				// turn order the table is already reading down.
				const about = pcs
					.filter(other => other.id !== actor.id)
					.map(other => ({ id: other.id, name: other.name, isSelected: other.id === draft.who }));
				const nameOf = id => pcs.find(other => other.id === id)?.name ?? "";
				const editing = this._editingAnswer?.actorId === actor.id && this._editingAnswer.stepKey === stepKey
					? this._editingAnswer : null;
				const recorded = answers.map((x, index) => ({
					index,
					question: Number.isInteger(x.q) ? wrapLoreTerms(qList[x.q] ?? "") : "",
					answer:   x.a,
					// The GM's inline edit of this answer, when it is the one open for editing; the
					// text is what has been typed into it so far, so a redraw mid-edit keeps it.
					editing:  isDriver && editing?.index === index,
					editText: editing?.index === index ? editing.text : "",
					editLabel:   `Edit this answer`,
					deleteLabel: `Delete this answer`,
					// Said back on the recorded line so a pick can be SEEN to have stuck. It is the
					// one part of a recorded answer that is not in the writing itself, so without
					// this there is nothing on screen to show it was ever made. A person since
					// removed from the run resolves to nothing and simply is not shown.
					about:    nameOf(x.who),
				}));
				const total   = qList.length;
				// A playbook with no questions for this step (one the introductions have no data
				// for): the PC counts as done, the turn passes them by, and if they are shown anyway
				// the window says why there is nothing to pick, rather than offering a Done that can
				// only ever answer "Tap the question".
				const noQuestions = total === 0;
				capture = {
					isStep:       true,
					isAsk:        phase.kind === "ask",
					actorId:      actor.id,
					stepKey,
					coEdit,
					draftAnswer:  typeof draft.a === "string" ? draft.a : "",
					about,
					// A one-person run has nobody to point at, so the picker is not offered at all
					// rather than offered empty.
					hasAbout:     about.length > 0,
					// What the read-only watcher sees instead of the control.
					aboutName:    nameOf(draft.who),
					saveState:    String(draft.a ?? "").trim() ? "saved" : "idle",
					placeholder:  phase.kind === "ask" ? "Who you asked, and what they answered…" : "Their answer…",
					canEdit,
					// The GM watches a present player's live typing read-only (it can't write the
					// shared draft), so it still sees the answer appear but never clobbers it.
					canPreview,
					recorded,
					hasRecorded:  recorded.length > 0,
					passed,
					noQuestions,
					// Pass is offered on any un-passed turn (a PC may pass without answering).
					canPass:      !passed && !noQuestions,
					// The player's Done: only while there is still something to record.
					canDone:      canEdit && !isGM && !passed && !noQuestions,
					// The GM's corrections: un-pass, and edit or delete a recorded answer.
					canManage:    isDriver,
					unpassLabel:  `Un-pass ${actor.name}`,
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
		const steps = isDriver ? _PHASES.slice(1).map((p, i) => ({
			index:    i + 1,
			title:    p.title,
			icon:     p.icon,
			isActive: i + 1 === this._phase,
		})) : null;

		return {
			isPreCheck:     false,
			isGM,
			isDriver,
			watchingNote:   isGM && !isDriver ? `Watching: ${IntroductionsDialog._primaryGmName()} is running the introductions.` : "",
			waiting,
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

	// Randomize the round-robin order, saved to the introductions' own setting. Every
	// client's pre-check redraws from that setting's onChange (onOrderChanged), this one's
	// included, so nothing re-renders here. reshuffle never hands back the order it was given.
	async _shuffleOrder() {
		if (!game.user?.isGM) return;
		const ids = introductionsRoster().map(a => a.id);
		if (ids.length < 2) return;
		await this._saveOrder(reshuffle(ids, shuffle));
	}

	// Move one PC a place earlier (delta -1) or later (delta +1) in the saved order. The
	// buttons at either end are disabled, and moveId answers null there anyway.
	async _moveInOrder(actorId, delta) {
		if (!game.user?.isGM) return;
		const next = moveId(introductionsRoster().map(a => a.id), actorId, delta);
		if (next) await this._saveOrder(next);
	}

	// Write the order, saying so if it fails: the list on screen would otherwise sit unchanged
	// with nothing to explain why the press did nothing.
	async _saveOrder(ids) {
		try { await writeIntroOrder(ids); }
		catch (err) {
			console.error("Stonetop | Introductions: saving the turn order failed", err);
			ui.notifications?.error("Stonetop: the new introductions order could not be saved.");
		}
	}

	_begin() {
		// Only the PRIMARY GM starts the session — it authors the cursor every other client
		// follows; a secondary GM beginning locally would move only its own view and desync.
		if (!runsIntroductions()) return;
		this._pcs     = introductionsRoster();
		this._phase   = 1;
		this._pcIndex = 0;
		this.render(false);
	}

	// ONE MOVE AT A TIME. Next awaits its flag writes before it moves the turn, and a second press
	// arriving in between (a double click, or Next landing while Pass is still writing) moved it a
	// second time from wherever the first left it: a PC skipped, or a whole round. Presses that
	// arrive while a move is under way are dropped, not queued; the window redraws when it is done.
	async _navLatch(fn) {
		if (this._navBusy) return undefined;
		this._navBusy = true;
		try { return await fn(); }
		finally { this._navBusy = false; }
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
		return this._navLatch(() => this._advanceNow());
	}

	async _advanceNow() {
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
	// not-yet-debounced characters. The DOM's own data-* is authoritative (not
	// this._pcIndex), so the flush still fires the instant AFTER the cursor moved the turn on.
	// A GM watching a present player sees a readonly mirror, excluded by :not([readonly]).
	//
	// ⚠ ONLY WHAT WAS TYPED HERE AND NOT SAVED YET (_captureDirty). This flush used to write
	// the field whenever it differed from the flag, and on a CO-EDITED turn that is backwards:
	// the other editor's newer words are exactly what makes the two differ. The GM typed, the
	// player's window re-rendered to show it, and this flush saved the player's old copy over
	// it first, so a player who was not even typing kept erasing the GM's notes until they
	// closed their window. A field that still shows what this client last saw in the flag has
	// nothing of its own to add, whatever the flag says now; one with unsaved typing has
	// already had every newer value merged into it as it landed (_absorbCaptureWrite), so
	// saving it keeps both. That is what makes this safe for the co-editing GM too, which it
	// used to skip outright and so dropped its own last keystrokes on a re-render.
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
			// No ownership test here: _saveNarration / _saveDraft refuse a PC this client can't write.
			const nar = root.querySelector("textarea.stonetop-intros-answer:not([readonly])");
			if (nar?.dataset.actorId && nar.dataset.roundKey && this._captureDirty(nar)) {
				await this._saveNarration(nar.dataset.actorId, nar.dataset.roundKey, nar.value);
			}
			const draft = root.querySelector("textarea.stonetop-intros-draft:not([readonly])");
			if (!justCommitted && draft?.dataset.actorId && draft.dataset.stepKey
				&& this._captureDirty(draft) && this._draftWorthFlushing(draft)) {
				// The DOM is authoritative for the TEXT and only the text: a keystroke can sit
				// in the textarea unwritten (that is the whole reason for this flush), but a
				// PICK is never DOM-only — every click writes the flag before re-rendering. So
				// read q from the flag. Reading it back off the last render instead re-wrote the
				// pick the player had just moved OFF, which is what made a second choice on
				// "Bonds & ties" / "Asking the others" look like it did nothing at all. The same
				// holds for `who`: choosing somebody writes the flag on the `change` event, so
				// the flag is never behind the select, and carrying it here is what stops this
				// flush from writing the whole buffer back with the pick missing.
				await this._saveDraft(draft.dataset.actorId, draft.dataset.stepKey, { a: draft.value });
			}
		} catch (err) {
			console.warn("Stonetop | Introductions: capture flush before re-render failed", err);
		}
	}

	// Does a draft for this step actually EXIST on the actor? _stepDraft answers the
	// same empty { q: null, a: "" } for "no draft" and "an empty one", which is right for
	// reading and wrong for deciding whether to write.
	_hasLiveDraft(actorId, stepKey) {
		return !!this._draftSource(actorId, stepKey);
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
	//
	// And never when the step's record has moved on since the field was drawn (an answer recorded,
	// the PC passed): whatever the field holds was typed against a record that no longer stands,
	// most often the answer just recorded plus a word or two, and writing that back is the answer
	// coming back as a draft. Checked first, since a NEW draft (somebody else's) may exist by then.
	_draftWorthFlushing(el) {
		const seen = this._captureSeen;
		if (seen?.key === this._captureKey(el) && typeof seen.mark === "string"
			&& seen.mark !== this._commitMark(el.dataset.actorId, el.dataset.stepKey)) return false;
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
	// The textarea is authoritative for text typed here and not saved yet, and only then (see
	// _captureDirty); the PICKS come from the flag, which a click always writes before the
	// highlight moves (see _flushCaptureFromDom).
	async _flushDraftFromDom(actor, phase) {
		const el = this.element?.[0]?.querySelector(".stonetop-intros-draft:not([readonly])");
		if (!el || el.dataset.actorId !== actor.id || !this._captureDirty(el)) return;
		await this._saveDraft(actor.id, phase.stepKey, { a: el.value });
	}

	// Record the active PC's draft, then move the cursor on within the step. Only the GM has
	// Next, so this runs on the GM. It flushes whatever the GM typed and hasn't saved yet into
	// the draft first, so a fast type-then-Next captures the last text, then records the flag.
	//
	// COMPARE, THEN MOVE. The record is awaited, and while it is in flight the PC's own player can
	// press Done on the same answer, which the primary GM answers by handing the turn on
	// (_autoAdvanceOnRemoteStep). Moving on again from wherever that left the turn skipped the
	// next PC. So the turn only moves if it is still where this press found it.
	async _advanceStep(phase) {
		this._cancelLiveDraft();
		const actor = this._pcs[this._pcIndex];
		const from  = { phase: this._phase, id: actor?.id ?? null };
		// Record the shown PC's draft first; a draft with text but no chosen question is
		// rejected (below) and holds the turn. No actor (empty roster) still advances.
		if (actor && !(await this._commitComposedDraft(actor, phase, "Tap the question they chose before recording it."))) return;
		if (this._phase === from.phase && (this._pcs[this._pcIndex]?.id ?? null) === from.id) this._advanceStepCursor(phase);
		this.render(false);
	}

	// Flush the shown PC's typed text into the draft (when this client is its editor), then
	// record it as an answer. A draft with answer text but no chosen question is rejected —
	// warn and return false so the caller holds the turn; anything else returns true. Shared
	// by the GM's Next (_advanceStep) and the player's Done (_recordCurrentDraft).
	async _commitComposedDraft(actor, phase, warnMsg) {
		// Flush our own textarea into the draft first, but only typing that hasn't been saved
		// (_flushDraftFromDom asks _captureDirty). The co-editing GM used to be kept out of this
		// altogether, because its copy of the player's draft lagged: flushing it could re-create
		// a draft the player had just recorded and so record the same answer twice. Its copy no
		// longer lags (_absorbCaptureWrite merges every save in as it lands), and a copy that only
		// shows what was saved is never flushed, so the GM's own last keystrokes now count too.
		if (this._canEditActor(actor)) await this._flushDraftFromDom(actor, phase);
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
		return this._navLatch(async () => {
			const phase = _PHASES[this._phase];
			if (!_isStep(phase)) return;
			const actor = this._pcs[this._pcIndex];
			if (!actor || !this._canEditActor(actor)) return;
			this._cancelLiveDraft();
			if (!(await this._commitComposedDraft(actor, phase, "Tap the question you're answering before recording it."))) return;
			this.render(false);
		});
	}

	// Pass, with a confirmation for the player explaining what passing means. The GM — who
	// paces the table and may pass on behalf of an offline PC — passes without the prompt.
	//
	// The step and PC are taken when the prompt OPENS: it stays up for as long as the player
	// takes to read it, and the GM may move the table on meanwhile. Passing whatever step and PC
	// the window shows by the time they answer passed the wrong one.
	async _confirmPass() {
		const phase = _PHASES[this._phase];
		if (!_isStep(phase)) return;
		const target = { phaseIndex: this._phase, actorId: this._pcs[this._pcIndex]?.id ?? null };
		if (game.user?.isGM) return this._pass(target);
		const isAsk = phase.kind === "ask";
		const confirmed = await confirmOutcome({
			title:   "Pass this part?",
			content: `<p>Passing means you're <strong>done ${isAsk ? "asking" : "answering"}</strong> for this part of the introductions: you won't be asked to ${isAsk ? "ask" : "answer"} another question about <em>${escHtml(phase.title)}</em>.</p>`
			       + `<p>Anything you've already recorded is kept, and the group carries on. If you change your mind, just ask your GM.</p>`,
			yes:     { label: "Pass this part", icon: "fa-forward" },
			no:      { label: `Keep ${isAsk ? "asking" : "answering"}` },
		});
		if (confirmed) await this._pass(target);
	}

	// Pass: the active PC opts out of the rest of this step. The turn then moves to the next
	// still-active PC — the GM advances its own view right here; a player's pass writes their
	// flag and the primary GM's updateActor hook (_autoAdvanceOnRemoteStep) advances for them.
	// A pass never auto-leaves the step (GM-paced: when all are done the GM's lit-up Next is
	// what advances the phase), and the GM's Next always skips already-passed PCs.
	//
	// `target` ({ phaseIndex, actorId }) is the step and PC the press was made on (see
	// _confirmPass); when the table has moved on from either since, nothing is passed.
	async _pass(target = null) {
		return this._navLatch(async () => {
			const phase = _PHASES[this._phase];
			if (!_isStep(phase)) return;
			const actor = this._pcs[this._pcIndex];
			if (!actor || !this._canEditActor(actor)) return;
			if (target && (target.phaseIndex !== this._phase || target.actorId !== actor.id)) {
				ui.notifications?.info("The introductions moved on while you were deciding, so nothing was passed.");
				return;
			}
			this._cancelLiveDraft();
			const phaseIndex = this._phase;
			await this._setPassed(actor.id, phase.stepKey, true);
			// GM: hand the turn on, from this PC, and only if the turn is still theirs (compare, then
			// move: see _advanceStep). A player stays put; their pass reaches the GM, who moves it.
			if (game.user?.isGM && this._phase === phaseIndex && this._pcs[this._pcIndex]?.id === actor.id) {
				this._stepToNextActivePc(phase);
			}
			this.render(false);
		});
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
		if (!runsIntroductions()) return false;
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
	// A step everyone is already done with parks on the first PC for the GM's own view, but names
	// nobody in the cursor (see _syncCursorFromLocal), so no player is summoned to it.
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

	// Back. On a step it steps over PCs who are done with it (passed, or answered everything):
	// they have no turn to go back to, and landing on one summoned their player for nothing. Off
	// the front of a step it goes to the step before, landing on its last PC still taking turns
	// (on a narration round, simply its last PC).
	_retreat() {
		// Back is GM-paced too: only the primary GM moves the shared cursor (see _advance).
		if (game.user?.isGM && !isPrimaryGM()) return;
		if (this._phase === 0 || this._navBusy) return;
		const phase = _PHASES[this._phase];
		const doneIn = def => i => this._isPcDone(this._pcs[i], def);
		const prevHere = !_isRoundRobin(phase) ? -1
			: _isStep(phase) ? prevActiveIndex(this._pcIndex, doneIn(phase))
			: this._pcIndex - 1;
		if (prevHere >= 0) {
			this._pcIndex = prevHere;
		} else if (this._phase > 1) {
			this._phase--;
			const prev = _PHASES[this._phase];
			if (_isStep(prev)) {
				const last = lastActiveIndex(this._pcs.length, doneIn(prev));
				this._pcIndex = last >= 0 ? last : Math.max(this._pcs.length - 1, 0);
			} else {
				this._pcIndex = _isRoundRobin(prev) ? Math.max(this._pcs.length - 1, 0) : 0;
			}
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
		if (!runsIntroductions()) return;
		if (!Number.isInteger(index) || index < 1 || index > _LAST_PHASE || index === this._phase) return;
		if (this._navBusy) return;
		this._cancelLiveDraft();
		this._enterPhase(index);
		this._scheduleChronicleSync();
		this.render(false);
	}

	// Resume the phase/turn this browser saved (the dialog doesn't survive a refresh), for a GM
	// reopening a session nobody is running: while one IS running, the cursor wins (see _doOpen).
	// Returns true when it restored a position; false (leaving the dialog on the pre-check) when
	// nothing's saved or there are no PCs.
	//
	// The order comes from the running session's cursor when there is one, and only otherwise
	// from the saved order: the saved turn index counts into the order the session BEGAN with,
	// and a saved order edited since (by a second GM on their pre-check) would otherwise hand
	// the turn to somebody else on reload.
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
		const cur = this._cursor();
		const pcs = this._cursorRoster(cur.active ? cur : {});
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
	//
	// The GM's only. A player never reopens this from a saved record: they follow the cursor, which
	// is what says whether a session is running at all. A record of theirs reopened the window on
	// a dead "Waiting for the GM to begin" screen after the session had ended.
	_saveResume() {
		if (!game.user?.isGM) return;
		saveWalkthroughPosition(_RESUME_KEY, { v: _RESUME_VERSION, phase: this._phase, pcIndex: this._pcIndex });
	}
}
