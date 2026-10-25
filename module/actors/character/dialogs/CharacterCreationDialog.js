// ── CharacterCreationDialog ──────────────────────────────────────────────────
// The player-facing first step of character creation. When the GM mints a fresh
// character from the Welcome guide, the owning client greets the player with this
// modal instead of dropping them onto a blank sheet (see _maybeOpenCharacterCreation
// in hooks/Ready.js). Its single "Create Character" button hands off to the sheet's
// guided flow — the playbook picker, then onboarding — and asks that flow to open
// the finished sheet once the player is done (see _onNewCharacter's
// `openSheetWhenDone`). Until then, the player never sees an empty sheet.

import { findOpenApp } from "../../../utils/open-windows.js";
import { closeAndSettle, holdCreationFlow, trackCreationFlow } from "../creation-flow.js";

export class CharacterCreationDialog extends Application {
	constructor(actor, options = {}) {
		const { startedByGM = false, ...appOptions } = options;
		super(appOptions);
		this._actor = actor;
		// Whether someone else (the GM) made this character for the player, which is all the
		// greeting's first line changes on. See _maybeOpenCharacterCreation in hooks/Ready.js.
		this._startedByGM = !!startedByGM;
	}

	/**
	 * Greet a player with this intro, at most once on screen.
	 *
	 * Every instance shares the `stonetop-character-creation` DOM id, so opening a second
	 * while the first is up puts two elements with the same id in the document and leaves the
	 * loser unreachable. The two ways that happened: the ready-time sweep and the `createActor`
	 * hook both reaching the same character, and the GM replacing a character while its
	 * predecessor's greeting was still open.
	 */
	static async open(actor, { startedByGM = false } = {}) {
		const existing = findOpenApp(w => w instanceof CharacterCreationDialog);
		// Already greeting them about this same character — surface it rather than stack. One
		// still painting counts: it is about to be on screen, and a second would share its id.
		const states = Application.RENDER_STATES ?? {};
		const painting = existing?._state === states.RENDERING;
		if ((existing?.rendered || painting) && existing._actor?.id === actor?.id) {
			if (existing.rendered) existing.bringToTop();
			return existing;
		}
		// A greeting for a DIFFERENT character (the GM just replaced this player's) points at a
		// document on its way out; retire it before opening the new one, and wait until it has
		// GONE (closeAndSettle). close() fades the old element out over 200ms, and core's close()
		// returns at once for a window already fading, which is exactly the state the replace
		// leaves it in (the delete's cleanup closed it a moment earlier). A replacement opened
		// then found the old element by its id, drew into it, and vanished with it.
		if (existing) await closeAndSettle(existing);
		// Registered against its character so a delete takes it with them (see creation-flow.js).
		return trackCreationFlow(new CharacterCreationDialog(actor, { startedByGM }), actor?.id).render(true);
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:       "stonetop-character-creation",
			template: "systems/stonetop-pwd/templates/dialogs/character-creation.hbs",
			title:    "Create Your Character",
			width:    480,
			height:   "auto",
			resizable: true,
			classes:  ["stonetop", "stonetop-charintro-dialog"],
		});
	}

	getData() {
		return {
			playerName:    game.user?.name ?? "",
			characterName: this._actor?.name ?? "",
			startedByGM:   this._startedByGM,
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		html.find(".stonetop-charintro-create").on("click", () => this._onCreate());
	}

	// Kick off the sheet's guided creation flow (picker → onboarding), asking it to
	// pop the sheet open when the player finishes, then close this intro so the
	// picker has the screen to itself. The sheet instance exists even though it has
	// never been rendered — `actor.sheet` instantiates it lazily.
	//
	// Once only. The button stays live through the intro's 200ms fade-out, so a double-click
	// started the flow twice: two playbook pickers sharing one DOM id.
	//
	// Only for a player who may write the character: _onNewCharacter quietly does nothing for
	// anyone else, and closing the intro on top of that left them with nothing at all. Say why
	// and leave the intro up instead.
	//
	// Held (holdCreationFlow) until _onNewCharacter has opened its first window, so the moment
	// between this intro closing and the picker registering doesn't read as "no flow open" and
	// let a parked greeting (creation-flow.js) open beside it.
	_onCreate() {
		if (this._started) return;
		const actor = this._actor;
		if (!actor?.isOwner || typeof actor.sheet?._onNewCharacter !== "function") {
			ui.notifications?.warn?.("You can't edit this character yet. Ask your GM to give you ownership of it, then try again.");
			return;
		}
		this._started = true;
		Promise.resolve(holdCreationFlow(actor.id, actor.sheet._onNewCharacter({ openSheetWhenDone: true })))
			.catch(err => console.error("Stonetop | could not start character creation", err));
		this.close();
	}
}
