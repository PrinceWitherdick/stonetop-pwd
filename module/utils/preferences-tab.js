// The Preferences tab's WIRING, shared by every sheet that carries the tab.
//
// The tab itself is one partial (templates/actor/partials/tab-preferences.hbs) over one
// descriptor module (module/utils/sheet-preferences.js): the rows, their labels and their
// current values are built there, and every control writes the client setting it names rather
// than anything on the actor. So a sheet that wants the tab needs three things and nothing
// else: `buildPreferenceGroups()` on `context.stonetop.preferences`, the partial in its body
// with a rail entry pointing at it, and the handlers below.
//
// This file is the third of those, a mixin rather than a copy, because it was written for the
// character sheet and the GM Toolkit asked for the same tab afterwards. Two hand-kept copies of
// a delegated handler is exactly the shape that drifts: the failure would be one sheet's slider
// writing on every pixel of a drag, or one sheet's "Open Settings" doing nothing, on a surface
// nobody re-reads once it works.
//
// Nothing here is gated on editability, and callers must not gate it either: none of this tab is
// actor data, so a reader looking at a locked sheet still owns their own font size. WHOSE sheet
// it is, on the other hand, decides whether the tab is there at all — see `showsPreferencesTab`.
import { setPreference, formatRange, openPreferenceMenu } from "./sheet-preferences.js";
import { openSystemSettings } from "./open-settings.js";
import { GM_TOOLKIT_TYPE } from "../actors/gmtoolkit/gm-toolkit-actor.js";

/** OWNER, from a client that has core's constants; 3 is its value where one does not (tests). */
function ownerLevel() {
	return globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
}

/**
 * The actor subtypes whose sheets carry the tab — the two that register the partial.
 *
 * A list rather than a truth read off the sheet class, because this is asked about `user.character`
 * (an Actor, not an open sheet) and often before any sheet of it exists. A third sheet growing the
 * tab adds itself here; forgetting to only costs its owner the fallback, never a wrong answer on
 * somebody else's sheet.
 */
const TAB_TYPES = new Set(["character", GM_TOOLKIT_TYPE]);

/** Is this actor one whose sheet can show the tab at all? */
function carriesTab(actor) {
	return !!actor && TAB_TYPES.has(actor.type);
}

/**
 * Does the person reading this sheet get the Preferences tab on it?
 *
 * ONE PLACE PER PERSON, is the whole rule. The tab is a surface onto that reader's own client
 * settings — the same values wherever they are changed from — so a second copy on a sheet that
 * is not theirs is not extra reach, it is the same tab in someone else's house. A GM opening a
 * player's character to fix a stat found their own font size sitting on it, which reads as the
 * PLAYER's setting and is not; and a player looking at another player's sheet found the same.
 *
 * So: everyone is offered the tab on the sheet that is THEIRS, and on no other. Nobody is left
 * without one: the world's toolkit is found-or-minted and assigned to every GM's `user.character`
 * on load (hooks/Ready.js, `_assignGmToolkitToGm`), and Foundry's own settings menu is still
 * there for anyone the rule leaves out — which is what the button at the foot of the tab opens.
 *
 * NOT `actor.isOwner`, and this is the trap the rule is written around: `isOwner` short-circuits
 * to true for ANY gamemaster, so it answers "yes" for every actor in the world on a GM's client
 * and the tab would go back on every sheet it was just taken off. The test is the ownership
 * entry made out to this user BY NAME, which is what `charactersOwnedBy` reads and what the
 * character mint stamps, plus the assignment in `user.character` for a world that hands its
 * players a sheet through `ownership.default` instead. Same pair of legs as `_isMyCharacter`
 * in hooks/Ready.js, which asks a neighbouring question about a character being created.
 *
 * And NOT a bare `user.isGM` on the other side of it either, which is the second trap and the
 * subtler one: `isGM` is true for an ASSISTANT gamemaster, and an assistant who also plays a
 * character at the table is a normal arrangement. `_assignGmToolkitToGm` knows that — it finds
 * their own PC already in `user.character` and deliberately leaves it there — so a rule that
 * shut every GM out of every character sheet took the tab off the assistant's OWN sheet and left
 * them the world's shared toolkit as the only place to set their own text size. `user.character`
 * is what separates the two cases, because it is the sheet each of them was actually given.
 *
 * The GM Toolkit is otherwise answered by TYPE rather than by ownership, for the reason its own
 * module gives at length: it is ONE actor per world at `ownership.default = NONE`, reached by
 * every GM through their GM role rather than through an entry, so there is no per-user ownership
 * on it to read and a permission test there could only ever say "you are a GM" the long way round.
 *
 * @param {object|null} actor the sheet's actor
 * @param {object|null} user  the reader; defaults to this client's own
 */
export function showsPreferencesTab(actor, user = globalThis.game?.user) {
	if (!actor || !user || !actor.id) return false;

	// A GM's place is whatever sits in `user.character`; their blanket reach over every other
	// actor in the world is not a claim on any of them. For a full GM that assignment is the
	// toolkit, and for an assistant who also plays it is their own character — both land here.
	// The unassigned case falls back to the toolkit so a GM who cleared theirs still has one.
	//
	// An assignment only counts as their PLACE when it points at a sheet the tab can actually
	// appear on. `user.character` is a GM's speaking-as choice as much as it is their character,
	// and one left on an NPC is common — `_assignGmToolkitToGm` deliberately does not disturb an
	// assignment it finds, so it latches. Homing a GM there sent the tab to a sheet that does not
	// carry it and took it off the toolkit at the same time, which left them no copy anywhere.
	if (user.isGM) {
		return carriesTab(user.character) ? user.character.id === actor.id : actor.type === GM_TOOLKIT_TYPE;
	}

	// Nobody else is offered the toolkit: it is the GM's sheet, and a player who can open it at
	// all is looking into somebody else's house rather than at their own settings.
	if (actor.type === GM_TOOLKIT_TYPE) return false;

	// Every other sheet: mine by assignment, or mine by an ownership entry made out to me by name.
	return user.character?.id === actor.id
		|| (actor.ownership?.[user.id] ?? 0) >= ownerLevel();
}

/**
 * @template {new (...args: any[]) => object} T
 * @param {T} Base
 */
export function withPreferencesTab(Base) {
	return class extends Base {
		/**
		 * The Preferences tab: read a control, write the client setting behind it.
		 *
		 * Delegated off the PANEL rather than bound per control, so the wiring survives the tab
		 * being re-rendered under it and costs three listeners instead of one per row.
		 *
		 * The setting key is the control's `data-pref`, and `setPreference` refuses any key the tab
		 * does not offer - the attribute is DOM, and a delegated handler that trusted it would write
		 * whatever a stray one named, world-scoped settings included.
		 *
		 * No `stopPropagation` and no re-render here. These inputs carry no `name`, so the form
		 * submit they set off collects exactly the fields it collected before and writes nothing new
		 * (see the note at the top of tab-preferences.hbs) - the same bargain the moves tab's unnamed
		 * view checkboxes have always made. Repainting is the SETTING's job: the ones that change
		 * what a sheet draws re-render every open sheet from their own `onChange`, and the ones that
		 * only move a CSS variable must not, or a font-size drag would rebuild the sheet under the
		 * handle mid-drag.
		 *
		 * A sheet without the tab is not an error: the panel is simply absent and nothing binds.
		 */
		_wirePreferences(html) {
			const root  = html?.[0] ?? html;
			const panel = root?.querySelector?.(".stonetop-preferences");
			if (!panel) return;

			// `change`, not `input`: a dragged slider fires `input` per pixel, and each of those
			// would be a localStorage write plus whatever the setting's onChange does - for values
			// the player is only passing through on the way to the one they want.
			panel.addEventListener("change", ev => {
				const control = ev.target.closest("[data-pref]");
				if (!control) return;
				const raw = control.type === "checkbox" ? control.checked : control.value;
				// Caught, not dropped: a failed write leaves the control showing a preference the
				// player believes is set, which is the one state nothing else would report.
				setPreference(control.dataset.pref, raw).catch(err => {
					console.error("Stonetop | could not save that preference", err);
					ui.notifications?.error("That preference could not be saved.");
				});
			});

			// The slider's number, repainted while the handle moves so the value being chosen can
			// be read before the `change` above commits it.
			panel.addEventListener("input", ev => {
				const control = ev.target.closest('input[type="range"][data-pref]');
				if (!control) return;
				const readout = control.parentElement?.querySelector(".stonetop-preference-range-value");
				if (readout) readout.textContent = formatRange(control.value, control.step);
			});

			panel.addEventListener("click", ev => {
				const menuButton = ev.target.closest("[data-preference-menu]");
				if (menuButton) {
					ev.preventDefault();
					openPreferenceMenu(menuButton.dataset.preferenceMenu);
					return;
				}
				if (!ev.target.closest(".stonetop-preferences-open-settings")) return;
				ev.preventDefault();
				openSystemSettings();
			});
		}
	};
}
