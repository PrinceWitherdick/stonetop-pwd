// A PC OR A FOLLOWER WHO BECOMES A THREAT (GM utility).
//
// Book I p.584, "Becoming a threat": "When a PC descends into villainy and monstrosity, they stop becoming a PC
// and become a threat under the GM's control. Write them up as both a threat (page 282) and a monster (page
// 391), using their established moves, possessions, and abilities as inspiration. Don't worry about replicating
// their playbook abilities exactly, and feel free to make them scarier than they were as a PC."
//
// p.481, a follower: "If the breakup is messy, then the follower might very well become a threat (page 277)",
// and "... they've become a source of ongoing, active trouble for one of the PCs or the village at large,
// write them up as a threat (page 277) in addition to or instead of being a follower."
//
// So this STARTS the write-up and no more: a threat page on the steading's tracker with the name, the face and
// the way back to the actor, and (ticked for a PC, as the book says; unticked for a follower, whose page only
// names a threat) a monster stat block seeded from their sheet's numbers. Everything else, the instinct, the
// doom track, the moves, is the GM's to write in the editor that opens next.

import { createThreat } from "../threats/threat-store.js";
import { DEFAULT_PROXIMITY, DEFAULT_THREAT_TYPE, threatProximity, threatType } from "../threats/threat-types.js";
import { buildMonsterActorData } from "../data/monster-builder.js";
import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { isOutOfPlay } from "../actors/character/deaths-door-actor.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { actorLinkHtml } from "../utils/actor-link.js";
import { LEFT_PLAY_FLAG, LEFT_PLAY_HOW } from "./left-play.js";

/** The actor flag (STONETOP_SCOPE) naming the threat page it became, so it is not made twice by accident. */
export const BECAME_THREAT_FLAG = "becameThreat";

/** Whether this is a PC (p.584's rule) rather than a follower or other NPC (p.481's). */
export const isPc = actor => actor?.type === "character";

/** Whether the threat page a uuid names is still there (`{strict: false}`: a missing one answers null). */
const threatPageExists = uuid => !!globalThis.fromUuidSync?.(uuid, { strict: false });

/**
 * Who the GM can turn into a threat: a PC still in play, or an NPC (a follower's actor among them), unless they
 * already became one (BECAME_THREAT_FLAG) whose page is still there. A page since deleted frees them again.
 *
 * @param {{pageExists?: (uuid: string) => boolean}} [deps]  injectable for tests
 */
export function canBecomeThreat(actor, user = globalThis.game?.user, { pageExists = threatPageExists } = {}) {
	if (!user?.isGM) return false;
	const became = actor?.flags?.[STONETOP_SCOPE]?.[BECAME_THREAT_FLAG];
	if (became && pageExists(became)) return false;
	if (isPc(actor)) return !isOutOfPlay(actor);
	return actor?.type === "npc";
}

/** What the threat page says about where it came from. PURE. */
export function threatOriginHtml(actor) {
	const link = actorLinkHtml(actor);
	return isPc(actor)
		? `<p>Once a player character: ${link}. They crossed the line from protagonist to villain, and are now a threat under the GM's control (Book I p.584). Use their established moves, possessions, and abilities as inspiration; don't worry about replicating their playbook abilities exactly, and feel free to make them scarier than they were as a PC.</p>`
		: `<p>Once a follower or friend: ${link}. The parting was messy, and now they are a source of ongoing, active trouble (Book I p.481).</p>`;
}

/**
 * The threat page's creation seed. PURE.
 *
 * @param {Actor} actor
 * @param {object} [o]
 * @param {string} [o.name]
 * @param {string} [o.type]       a threat type id (threat-types.js); the villain by default
 * @param {string} [o.proximity]  homefront / nearby / distant
 * @param {string} [o.instinct]
 */
export function threatSeedFrom(actor, { name = "", type = DEFAULT_THREAT_TYPE, proximity = DEFAULT_PROXIMITY, instinct = "" } = {}) {
	return {
		name:      String(name ?? "").trim() || actor?.name || "",
		type:      threatType(type).id,
		proximity: threatProximity(proximity).id,
		instinct:  String(instinct ?? "").trim(),
		gmMoves:   [...threatType(type).suggestedMoves],
		description: threatOriginHtml(actor),
	};
}

/**
 * The monster stat block's creation data, from the sheet's own numbers (p.391 for the write-up). PURE but for
 * the shared builder.
 */
export function monsterDataFrom(actor, { name = "", instinct = "" } = {}) {
	const attrs = actor?.system?.attributes ?? {};
	const die = String(attrs.damage?.value ?? "").trim();
	return buildMonsterActorData({
		name:        String(name ?? "").trim() || actor?.name || "",
		img:         actor?.img,
		hp:          Math.max(0, Number(attrs.hp?.max) || 0),
		armorValue:  Math.max(0, Number(attrs.armor?.value) || 0),
		damageValue: die,
		rollFormula: die,
		instinct:    String(instinct ?? "").trim(),
		notes:       threatOriginHtml(actor),
	});
}

/** A PC's sheet's own instinct, or an NPC's, as a starting point for the threat's. */
export function instinctOf(actor) {
	if (isPc(actor)) return "";
	return String(actor?.system?.instinct ?? "").trim();
}

/**
 * Write the threat up (and the monster, if asked), and for a PC, take them out of play.
 *
 * @param {Actor} actor
 * @param {object} choice  `{name, type, proximity, instinct, monster: boolean, outOfPlay: boolean}`
 * @param {object} [deps]  injectable for tests
 * @returns {Promise<{page: object|null, monster: Actor|null}|null>}
 */
export async function makeThreatOf(actor, choice = {}, deps = {}) {
	const {
		steading = getStonetopSteadingActor(),
		create = createThreat,
		createActor = (data, options) => getDocumentClass("Actor").create(data, options),
	} = deps;
	if (!canBecomeThreat(actor) || !steading) return null;
	const seed = threatSeedFrom(actor, choice);
	const page = await create(steading, seed);
	if (!page) return null;

	let monster = null;
	if (choice.monster) {
		try {
			// `stonetopMonsterBuilt`: a deliberately prefilled stat block, not a blank one for the worksheet to
			// take over (hooks/StonetopSingleton.js).
			monster = await createActor(monsterDataFrom(actor, { name: seed.name, instinct: seed.instinct }), { stonetopMonsterBuilt: true });
		} catch (err) {
			console.error("Stonetop | could not make the monster stat block", err);
			globalThis.ui?.notifications?.warn?.("The threat is written, but the monster stat block could not be made.");
		}
		if (monster?.uuid) await page.update?.({ "system.linkedMonsterUuid": monster.uuid });
	}

	const record = { [`flags.${STONETOP_SCOPE}.${BECAME_THREAT_FLAG}`]: page.uuid ?? null };
	// "They stop becoming a PC" (p.584): out of every party list, the way the dead are.
	if (isPc(actor) && choice.outOfPlay) {
		record[`flags.${STONETOP_SCOPE}.${LEFT_PLAY_FLAG}`] = { how: LEFT_PLAY_HOW.VILLAIN, at: Date.now(), threatUuid: page.uuid ?? null };
	}
	await actor.update(record);
	return { page, monster };
}

/** Open the GM's window for `actor`, then the new threat in its editor. */
export async function openBecomeThreatDialog(actor) {
	if (!canBecomeThreat(actor)) return null;
	const { BecomeThreatDialog } = await import("./BecomeThreatDialog.js");
	const result = await new BecomeThreatDialog(actor).promise();
	if (result?.page) {
		const { ThreatEditorDialog } = await import("../threats/threat-editor-dialog.js");
		new ThreatEditorDialog(result.page).render(true);
	}
	return result;
}
