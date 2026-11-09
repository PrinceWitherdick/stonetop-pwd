// A token hidden or revealed on the map takes its row in the fight with it.
//
// CORE KEEPS TWO SWITCHES. A token has `hidden` (the token HUD's eye) and so does its combatant (the tracker
// row's eye), and core copies the token's onto the combatant once, when the combatant is made
// (TokenDocument.createCombatants; fight/start-fight.js does the same), and never again. The fight reads BOTH
// before it shows a player anyone (fight-state.js#fighterOf), so an ambusher revealed the natural way, from
// its token, stayed out of every player's fight: not on their tab or in their window, never aimed at by an
// engagement, never in a pile-on. One switch now moves the other:
//  • the token's eye: the primary GM's client writes the same `hidden` onto every combatant standing on that
//    token, in every fight (installHiddenMirror);
//  • the row's eye: the Fight tab writes it onto the token as well (FightTracker#_onToggleHidden).
//
// The token is the one the map shows, so it leads: a combatant hidden on its own (the row's eye with core's
// tracker) is left as it is until its token next changes.

import { each } from "./in-battle.js";
import { isPrimaryGM } from "../utils/primary-gm.js";

/**
 * The combatant updates that bring every fight in line with a token's `hidden`, per Combat. PURE.
 *
 * @param {Iterable<Combat>} combats
 * @param {{id: string, parent?: {id: string}}} tokenDoc
 * @param {boolean} hidden
 * @returns {Array<{combat: Combat, updates: Array<{_id: string, hidden: boolean}>}>}
 */
export function hiddenMirrorUpdates(combats, tokenDoc, hidden) {
	const sceneId = tokenDoc?.parent?.id ?? null;
	if (!tokenDoc?.id) return [];
	return each(combats)
		.map(combat => ({
			combat,
			updates: each(combat?.combatants)
				.filter(c => c?.tokenId === tokenDoc.id && (!sceneId || c.sceneId === sceneId) && !!c.hidden !== !!hidden)
				.map(c => ({ _id: c.id, hidden: !!hidden })),
		}))
		.filter(({ updates }) => updates.length);
}

/**
 * Mirror a token's `hidden` onto its combatants, on the primary GM's client alone (`updateToken` fires on every
 * client, and a combatant is the GM's to write in any case).
 *
 * @returns {() => void} stops mirroring
 */
export function installHiddenMirror({ hooks = globalThis.Hooks } = {}) {
	const id = hooks.on("updateToken", (tokenDoc, changes) => {
		if (!changes || !("hidden" in changes)) return;
		if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return;
		for (const { combat, updates } of hiddenMirrorUpdates(globalThis.game?.combats, tokenDoc, changes.hidden)) {
			Promise.resolve(combat.updateEmbeddedDocuments("Combatant", updates))
				.catch(err => console.error("Stonetop | showing a fighter as their token is shown failed", err));
		}
	});
	return () => hooks.off("updateToken", id);
}
