import { JB2A_IDS, SEQUENCER_ID, SOUNDFX_ID } from "./attack-fx.js";
import { getSetting, isAttackFxOn, setSetting } from "../settings.js";
import { stonetopChatCard, whisperGm } from "../utils/chat.js";

// ── "Your attacks could be seen and heard" ────────────────────────────────────
// The attack effects (attack-fx.js) arrived in an update, and the only place a NEW world hears
// about the modules they need is the footer of the greeting card (hooks/Ready.js
// _buildStartupWelcomeContent). A world that was greeted before that footer existed has no way to
// learn about them short of reading a settings hint, so it is told once, here, in the same shape
// as the FXMaster card (seasons/fxmaster-suggestion.js): whispered to the GMs, never modal, and
// written so a GM who does nothing has lost nothing.

/** World flag: has this world had the card (or been found not to need it)? */
export const ATTACK_FX_SUGGESTION_SETTING = "attackFxSuggestionShown";

/** Each module the effects use: the package page, and what it adds. */
export const ATTACK_FX_MODULES = Object.freeze([
	{ ids: [SEQUENCER_ID], name: "Sequencer", url: "https://foundryvtt.com/packages/sequencer" },
	{ ids: JB2A_IDS, name: "JB2A", url: "https://foundryvtt.com/packages/JB2A_DnD5e" },
	{ ids: [SOUNDFX_ID], name: "SoundFx Library", url: "https://foundryvtt.com/packages/soundfxlibrary" },
]);

const moduleActive = id => globalThis.game?.modules?.get?.(id)?.active === true;

/** The ATTACK_FX_MODULES entries this world has not got switched on. */
export function missingAttackFxModules() {
	return ATTACK_FX_MODULES.filter(m => !m.ids.some(moduleActive));
}

/**
 * Whisper the one-time attack-effects card to the GMs, if this world still has anything to gain.
 *
 * Resolves exactly once, then the flag stops it re-checking:
 *
 *  • FLAGGED WITHOUT POSTING in a world that had not been greeted before this load. It is
 *    getting the greeting card now, and that card already names all three modules.
 *  • FLAGGED WITHOUT POSTING when the GM has switched Attack Effects on the Map off (there is
 *    nothing to sell them) or when every module is already active.
 *  • POSTED, then flagged, otherwise, naming only the modules that are missing.
 *
 * @param {object} options
 * @param {boolean} options.greeted  Had this world been sent the greeting card BEFORE this load?
 *   Read by the caller ahead of posting the greeting, since afterwards every world has been.
 * @returns {Promise<boolean>} Whether a card was actually posted.
 */
export async function postAttackFxSuggestionOnce({ greeted } = {}) {
	if (!globalThis.game?.user?.isGM) return false;
	if (getSetting(ATTACK_FX_SUGGESTION_SETTING)) return false;

	const missing = missingAttackFxModules();
	let posted = false;
	if (greeted && isAttackFxOn() && missing.length) {
		if (!globalThis.ChatMessage?.create) return false; // chat isn't up yet; try again next load
		await whisperGm(attackFxSuggestionContent(missing));
		posted = true;
	}
	await setSetting(ATTACK_FX_SUGGESTION_SETTING, true);
	return posted;
}

/** "A", "A and B", "A, B and C", each linked to its package page. */
function linkedList(modules) {
	const links = modules.map(m => `<a href="${m.url}">${m.name}</a>`);
	return links.length < 2 ? links.join("") : `${links.slice(0, -1).join(", ")} and ${links.at(-1)}`;
}

/**
 * The card itself. What each half needs is said separately, because the halves work separately:
 * a world with only SoundFx Library hears every blow and sees none of them.
 *
 * @param {object[]} [missing]  ATTACK_FX_MODULES entries to name; all of them by default.
 */
export function attackFxSuggestionContent(missing = ATTACK_FX_MODULES) {
	const lacks = name => missing.some(m => m.name === name);
	const needVisuals = lacks("Sequencer") || lacks("JB2A");
	const needSounds = lacks("SoundFx Library");
	const halves = [];
	if (needVisuals) {
		halves.push(`<li><strong>On the map:</strong> a sword swings, an arrow flies, a thrown spear arcs,
			a bite snaps on whoever was bitten. A ranged 6- flies wide, and pressing Apply bursts on every
			token that loses HP. That needs ${linkedList(missing.filter(m => m.name !== "SoundFx Library"))};
			the free JB2A is enough.</li>`);
	}
	if (needSounds) {
		halves.push(`<li><strong>At the table:</strong> the hit of a blade, an arrow's fly-by and impact,
			a shield's clank when armor takes the whole blow. That needs
			${linkedList(missing.filter(m => m.name === "SoundFx Library"))}, and plays for everyone,
			including anyone who runs Foundry with the game canvas switched off.</li>`);
	}
	return stonetopChatCard(
		"Attacks You Can See And Hear",
		`<div class="stonetop-roll-card-description">
			<p>As of this update, a blow that lands when damage is rolled at a target can be drawn on
			the map and heard at the table. The system picks each one from the weapon or the monster's
			printed attack, so there is nothing to set up.</p>
			<ul>${halves.join("")}</ul>
			<p>These are free modules this system doesn't ship. Install them from Foundry's
			<strong>Setup &rarr; Add-on Modules</strong> screen and enable them in this world.</p>
			<p>Nothing is broken without them: attacks roll and damage applies exactly as before. Once
			they are in, you can turn the effects off under <strong>Configure Settings &rarr; Stonetop
			&rarr; Attack Effects on the Map</strong>.</p>
		</div>`,
		"stonetop-attack-fx-card");
}
