// ── Where a player has got to in character creation ────────────────────────────
// The creation flow stamps its position on the character as
// flags.stonetop-pwd.onboardingProgress (see StonetopCharacterSheet#_setOnboardingState),
// which is the only part of a player's local, uncommitted progress the GM can read.
//
// Two surfaces read it, and they must agree: the Welcome guide's player roster ("on page
// 4 of 9"), and the confirmation shown before a replacement mint deletes that character —
// where "they are halfway through creation" is the fact that should stop the GM's hand.

import { STONETOP_SCOPE } from "./StonetopFlags.js";

/**
 * Actor flag stamped (true) when a player really finishes creation: the walkthrough's Finish,
 * from the first pass or from the sheet's "finish your character" re-entry. A committed playbook
 * alone does not mean finished, because "Save & close" commits one part-way through.
 */
export const CREATION_FINISHED_FLAG = "creationFinished";

/**
 * Turn a character's onboardingProgress flag (+ its committed playbook, if any) into a
 * short note: { playbook, text, status }, where status keys the styling and playbook
 * names the chosen playbook (committed wins; otherwise the in-progress pick the flow
 * stamps onto the flag, since the GM can't read the player's local resume snapshot).
 * With no flag, a character with no playbook yet hasn't been touched; one that has a
 * playbook is finished.
 *
 * `finished` is the CREATION_FINISHED_FLAG. A playbook WITH it is finished whatever the
 * progress flag says. A playbook without it is finished only when no progress flag is live:
 * that is every character made before the flag existed, and must not suddenly read as half
 * built. A playbook without it and with a live progress flag is a "Save & close" part-way
 * through, and reads where it stopped.
 */
export function progressLabel(p, playbook, finished = false) {
	const hasPlaybook = !!playbook?.slug;
	// Committed name wins; before commit, fall back to the playbook stamped on the
	// progress flag (blank at the picker stage, where nothing is chosen yet).
	const name = (hasPlaybook ? playbook.name : p?.playbook) || "";
	// `playbook` is attached once at the return, so each branch only carries its own status text.
	const label =
		hasPlaybook && (finished || !p) ? { text: "Finished", status: "finished" } :
		!p                   ? { text: "not started yet", status: "not-started" } :
		p.state === "picker" ? { text: "on playbook picker", status: "picker" } :
		// Both exits write "exited". Closing the playbook picker writes it bare, while leaving the
		// walkthrough stamps the playbook being filled in, so no playbook at all means they only
		// got as far as the picker.
		p.state === "exited" ? { text: name ? "exited onboarding" : "closed the playbook picker", status: "exited" } :
		// "onboarding" — or a legacy flag with just step/total and no state. A
		// known page count reads "on page N of M"; otherwise (a partial/legacy flag
		// with no usable total) still show the player as mid-creation rather than
		// dropping them from the roster entirely.
		p.total > 0          ? { text: `on page ${p.step} of ${p.total}`, status: "onboarding" } :
		                       { text: "in character creation", status: "onboarding" };
	return { playbook: name, ...label };
}

/** A character's progress note, read straight off the actor. */
export function progressFor(actor) {
	return progressLabel(
		actor?.getFlag?.(STONETOP_SCOPE, "onboardingProgress"),
		actor?.system?.playbook,
		!!actor?.getFlag?.(STONETOP_SCOPE, CREATION_FINISHED_FLAG),
	);
}

/**
 * Has someone started building this character without finishing it?
 *
 * True for every live creation state — at the picker, part-way through onboarding, or
 * backed out with answers saved — and false both for an untouched character and a
 * finished one. This is the question worth asking before deleting a character: the two
 * false cases lose nothing, and the true ones lose work the player can't get back.
 */
export function isMidCreation(actor) {
	const { status } = progressFor(actor);
	return status !== "finished" && status !== "not-started";
}
