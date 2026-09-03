import { fxMasterActive } from "./weather-fx.js";
import { getSetting, setSetting } from "../settings.js";
import { sessionZeroComplete } from "../dialogs/walkthrough-resume.js";
import { stonetopChatCard } from "../utils/chat.js";

// ── "You could have weather on the map" ───────────────────────────────────────
// The one place this system says the name FXMaster to a GM who has not got it.
//
// Everywhere else deliberately stays quiet about it: the Weather window HIDES its Pause control
// rather than greying it out, because a disabled button is a promise that something could happen
// if the reader worked out what they were missing (see WeatherDialog._fxControl). That rule is
// about the moment of picking a weather, where a name the GM cannot act on is only in the way. It
// leaves a gap, though: the canvas half of the weather is wired, free, and completely invisible to
// a GM who never opens the settings screen and reads a hint about a module nobody told them about.
// So it is said exactly once, in chat, where it can be scrolled past and deleted.
//
// Whispered to the GMs and never modal: installing a module means leaving the world for the Setup
// screen, which is not a thing to interrupt anyone's session over.

/** World flag: has this world had the nudge (or been found not to need it)? */
export const FXMASTER_SUGGESTION_SETTING = "fxMasterSuggestionShown";

/** The package page, which is also what Foundry's own module installer lists it under. */
export const FXMASTER_PACKAGE_URL = "https://foundryvtt.com/packages/fxmaster";

/**
 * Whisper the one-time FXMaster card to the GMs, if this world still has anything to gain.
 *
 * Resolves exactly once, then the flag stops it re-checking, on the same three-way shape as the
 * book-art reminder: post when there is something to say, mark it done either way, and hold off
 * entirely while the answer is still "not yet".
 *
 *  • HELD, unflagged, while the first-session Welcome guide is still auto-opening. A fresh world
 *    already gets the big greeting card on that load, and a second card about an optional module
 *    is noise at the moment the GM has the most to read. A world legitimately sits here for
 *    several loads, so this deliberately does not latch: it asks again next time.
 *  • FLAGGED WITHOUT POSTING when FXMaster (or FXMaster+, which counts) is already active. They
 *    have it, so there is nothing to tell them, and latching now means a GM who later disables the
 *    module is not met by a pitch for the thing they just switched off on purpose.
 *  • POSTED, then flagged, otherwise.
 *
 * @returns {Promise<boolean>} Whether a card was actually posted.
 */
export async function postFxMasterSuggestionOnce() {
	if (!globalThis.game?.user?.isGM) return false;
	if (getSetting(FXMASTER_SUGGESTION_SETTING)) return false;
	// Mirrors _postBook2ArtReminderOnce's gate: past the guide means the GM ticked "Don't show
	// this automatically", or finished both session-zero walkthroughs.
	if (!getSetting("gmWelcomeShown") && !sessionZeroComplete()) return false;

	let posted = false;
	if (!fxMasterActive()) {
		if (!globalThis.ChatMessage?.create) return false; // chat isn't up yet; try again next load
		await ChatMessage.create({
			content: fxMasterSuggestionContent(),
			whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
			speaker: { alias: "Stonetop" },
		});
		posted = true;
	}
	await setSetting(FXMASTER_SUGGESTION_SETTING, true);
	return posted;
}

/**
 * The card itself.
 *
 * Written so the GM who does nothing has lost nothing: the weather is rolled and posted either
 * way, and all that is on offer is the picture of it. Both switches are named, because the
 * question after "what is FXMaster" is always "and how do I turn it off".
 */
export function fxMasterSuggestionContent() {
	return stonetopChatCard(
		"Weather On The Map",
		`<div class="stonetop-roll-card-description">
			<p>Your <strong>Weather</strong> macro rolls the season's weather and posts it here. It can also
			put that weather on the scene your players are on: rain falling when the roll says rain, snow
			drifting in winter, cloud racing across a storm sky.</p>
			<p>That half needs a free module this system doesn't ship,
			<a href="${FXMASTER_PACKAGE_URL}">FXMaster</a>. Install it from Foundry's
			<strong>Setup &rarr; Add-on Modules</strong> screen and enable it in this world. Everything on
			the Stonetop side is already wired, so there is nothing else to set up.</p>
			<p>Nothing is broken without it: the weather is still rolled and still posted, it just stays in
			the chat log. Once the module is in, you can pause the effects from the Weather window, or turn
			them off for good under <strong>Configure Settings &rarr; Stonetop &rarr; Weather on the
			Scene</strong>.</p>
		</div>`,
		"stonetop-fxmaster-card");
}
