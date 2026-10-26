// Turning the Fight tab on, at init.
//
// ONE DECISION, MADE ONCE. Core builds its sidebar tabs from `CONFIG.ui` when the interface is first
// drawn, so which class the Combat tab is made from has to be settled at init, from the world setting
// `fightTab`. That is why the setting takes a reload, and why switching it off hands back core's own
// tracker with nothing of ours left running: no stamps, no watcher, no map lines, no damage pre-fill.
//
// ONE THING SURVIVES THE SWITCH: the window. A table running an initiative module wants the tracker in
// front of them when a fight starts just as much as ours does, and a window holding core's own tracker
// says nothing about how Stonetop fights. So with the tab off, `installCombatWindow` opens and closes
// core's pop-out on the same rules and the same `fightWindowAuto` switch (fight-window.js).
//
// AND THE CLEAN-UP A FIGHT'S END OWES (combat/readiness-loss.js): Readiness, the Marshal's battle holds, the
// shield wall and the mooks' grudges go when a fight ends whichever tracker ran it, so it is installed either
// way, told that with the tab off every Combat is the fight.
//
// Wired in stonetop.js right after the settings are registered (a setting cannot be read before).

import { SYSTEM_ID } from "../system-id.js";
import { isFightTabEnabled } from "../settings.js";
import { PALETTE_HOOK } from "../utils/palette.js";
import { HEROES, FOES } from "./engagements.js";
import { createFightTrackerClass } from "./FightTracker.js";
import { installFightWatcher } from "./fight-watcher.js";
import { combatantSide, snapshotFight, FIGHT_FLAG, SIDE_FLAG } from "./fight-state.js";
import { refreshFightOverlay, invalidateFightOverlay, teardownFightOverlay } from "./fight-overlay.js";
import { openStartFight, lineUpFight } from "./start-fight.js";
import { sendAgainst, handleSendQuery, SEND_QUERY } from "./send-against.js";
import { installCombatWindow, installFightWindow, syncFightWindow } from "./fight-window.js";
import { fightVitalsKey } from "./fight-vitals.js";
import { createFightTokenClass, installFightRing, syncFightRing } from "./fight-ring.js";
import { installReadinessLoss } from "../combat/readiness-loss.js";

/**
 * `preCreateCombat`: mark a new Combat as a fight, and tie it to the scene it is started on.
 *
 * A combat the token HUD makes (select tokens, toggle combat) arrives with no scene, and an unlinked
 * combat follows the GM from map to map; a fight is fought somewhere. An explicit scene, or an explicit
 * "no scene", is left as given.
 */
export function stampFight(combat, data = {}) {
	const changes = {};
	if (!data?.flags?.[SYSTEM_ID]?.[FIGHT_FLAG]) changes.flags = { [SYSTEM_ID]: { [FIGHT_FLAG]: { v: 1 } } };
	const sceneId = globalThis.canvas?.scene?.id ?? null;
	if (!("scene" in (data ?? {})) && !combat?.scene && sceneId) changes.scene = sceneId;
	if (Object.keys(changes).length) combat.updateSource(changes);
}

/**
 * `preCreateCombatant`: give a new combatant a side, unless whoever added them already said which.
 * Runs on the creating client, which may be a player adding their own token from its HUD.
 */
export function stampSide(combatant, data = {}) {
	const given = data?.flags?.[SYSTEM_ID]?.[SIDE_FLAG];
	if (given === HEROES || given === FOES) return;
	const side = combatantSide(combatant);
	if (side) combatant.updateSource({ flags: { [SYSTEM_ID]: { [SIDE_FLAG]: side } } });
}

/**
 * Redraw the Fight tab's body when the engagements or anyone's HP or armor have changed, and not
 * otherwise: a token sliding one square along a wall changes nothing the tab says.
 */
export function refreshFightTab(tab = globalThis.ui?.combat) {
	const combat = tab?.viewed;
	if (!tab?.rendered || !combat) return;
	const scene = combat.scene ?? globalThis.canvas?.scene ?? null;
	const signature = snapshotFight(combat, { scene })?.result.signature ?? null;
	if (signature !== tab.fightSignature || fightVitalsKey(combat) !== tab.fightVitals) tab.render({ parts: ["tracker"] });
}

/**
 * Make the Combat tab the Fight tab, when the world has it on.
 *
 * @returns {boolean} whether it was turned on
 */
export function registerFightTab({ config = globalThis.CONFIG, hooks = globalThis.Hooks, foundryNs = globalThis.foundry, game = globalThis.game } = {}) {
	if (!isFightTabEnabled()) {
		// The tab is core's, and so is everything in it; only the window is ours (see the head of this file).
		installCombatWindow({ hooks });
		// And the rules a fight ending keeps, which are Stonetop's however the tracker looks: a core Combat is
		// the fight then, so its end lets Readiness, the Marshal's holds and the mooks' grudges go (p.216).
		installReadinessLoss({ hooks });
		return false;
	}
	const Base = foundryNs?.applications?.sidebar?.tabs?.CombatTracker;
	if (!Base || !config?.ui) return false;

	config.ui.combat = createFightTrackerClass(Base);
	const combatTab = config.ui.sidebar?.TABS?.combat;
	if (combatTab) combatTab.tooltip = "stonetop.fight.tab";
	// A click on a token in the fight puts its moves and damage dice round it (fight-ring.js). Built on
	// whatever token class is configured by now, so a module that got there first keeps its changes.
	if (config.Token?.objectClass) config.Token.objectClass = createFightTokenClass(config.Token.objectClass);

	hooks.on("preCreateCombat", stampFight);
	hooks.on("preCreateCombatant", stampSide);

	// What the tab's buttons call.
	if (game) {
		game.stonetop ??= {};
		game.stonetop.fight = {
			...(game.stonetop.fight ?? {}),
			openStart: options => openStartFight(options),
			lineUp: combat => lineUpFight(combat),
			sendAgainst: (combat, moverId, targetId) => sendAgainst(combat, moverId, targetId),
		};
	}
	// A player sending a monster or NPC asks the GM's client to move it (send-against.js).
	if (config.queries) config.queries[SEND_QUERY] = (data, context) => handleSendQuery(data, context);
	installFightWatcher({
		hooks,
		// The watcher follows an engagement change with a geometry run, which then paints afresh.
		// Everything that can start, end or reveal a fight is an engagement change, so the Fight
		// window (fight-window.js) opens and closes from here too.
		onEngagement: () => { invalidateFightOverlay(); refreshFightTab(); syncFightWindow(); syncFightRing(); },
		onGeometry: () => refreshFightOverlay({ reuse: true }),
	});
	installFightWindow({ hooks });
	installFightRing({ hooks });
	// Defend's Readiness goes when the fight ends, or a character leaves it or goes down (p.216).
	installReadinessLoss({ hooks });
	// The canvas destroys the overlay with its interface group; drop the handles to it.
	hooks.on("canvasTearDown", teardownFightOverlay);
	// A change of palette (high contrast, a dark page, Follow Foundry re-resolving) gets the lines
	// repainted in that palette's ink.
	hooks.on(PALETTE_HOOK, () => refreshFightOverlay());
	return true;
}
