// The Ranger's bond with the animal companion, as its card and Loyal to the End's card act on it.
//
// BEAST-BONDED: "When you focus on your animal companion for a few moments, you can use any of the
// actions you've marked below, no matter the distance between you." The marks are the background's own
// (the Details tab marks them, a level-up adds one at 3rd, 5th, 7th and 9th); the companion card lists
// the ones marked while that background is the one taken, read-only (beastBondActions). Four of the five
// are fiction. The fifth, "Lend it your strength: lose 1d6 HP, and it regains an equal amount", is a
// button (lendStrength): the 1d6 is thrown where the table sees it, the Ranger LOSES THE WHOLE ROLL
// through the plain HP writer (utils/damage.js#applyDamageToActor, the Vessel's price's path, so 0 HP
// opens Death's Door as any HP loss does), and the companion regains as much, never past its max, the
// rest wasted (the user's ruling). The companion is raised as Bath of Healing Light raises a follower's
// card (invocation-apply.js#restoreFollowerCardHp, through follower-hp.js#setFollowerHp): the NPC that
// stands for it, whose HP is its own while there is one (the card's box mirrors it), else the box, to its
// max. Offered at full HP too: the book does not forbid it, so the card only says the HP would be wasted.
// Refused BEFORE the die when the companion's HP cannot be written from here (an NPC this client does not
// own, and no GM connected to write it for them: lendStrengthWritable), so the Ranger never loses HP the
// companion cannot regain; the warning is the one setFollowerHp gives (follower-hp.js#NO_GM_KEY).
//
// LOYAL TO THE END: "On a 7-9, it gets the injured tag. On a 6-, it's injured and will die soon unless
// someone saves it." Both tiers carry an "Add the injured tag" button (roll-engine's tierActions), spent
// once per card, which files "injured" among the companion's CONDITIONS (`animalCompanion.conditions`):
// a list of its own, apart from the options it was built with (`traits`, which spend the allowance and
// feed its numbers). The card shows a condition as a tag with a remove button, and Order Followers
// offers it as a tag already marked "in the way" (StonetopCharacterSheet#orderFollower).

import { SYSTEM_ID } from "../../system-id.js";
import { STONETOP_SCOPE, readableFlags } from "./StonetopFlags.js";
import { restoreFollowerCardHp } from "./invocation-apply.js";
import { followerActorFromLink } from "./follower-actors.js";
import { NO_GM_KEY, canSetFollowerHp } from "./follower-hp.js";
import { applyDamageToActor } from "../../utils/damage.js";
import { rolledTotalCard } from "../../utils/chat.js";
import { withCardLatch, wireLatchedButtons } from "../../utils/card-latch.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

const KEY = "stonetop.character.followers.companion";

/** Where the companion's conditions are kept, under the system scope. */
export const COMPANION_CONDITIONS_FLAG = "animalCompanion.conditions";

/** The tag Loyal to the End's 7-9 and 6- give the companion. */
export const INJURED_TAG = "injured";

/** The move whose result card carries the "Add the injured tag" button. */
export const LOYAL_TO_THE_END = "Loyal to the End";

/** The Beast-Bonded action that is a button rather than fiction. */
export const LEND_STRENGTH_ACTION = "lend-strength";

/** "Lend it your strength": the move's name on its card and in the ledger, and its die. */
export const LEND_STRENGTH = "Lend it your strength";
export const LEND_STRENGTH_FORMULA = "1d6";

/** The message flag latching a Loyal to the End card's "Add the injured tag". */
export const COMPANION_INJURED_FLAG = "companionInjured";

/** The companion's conditions, as stored: strings, trimmed, each once. */
export function companionConditions(flags) {
	const raw = flags?.animalCompanion?.conditions;
	return [...new Set((Array.isArray(raw) ? raw : []).map(t => String(t ?? "").trim()).filter(Boolean))];
}

/** File `tag` among the companion's conditions. Answers whether it was added (false: already there). */
export async function addCompanionCondition(actor, tag = INJURED_TAG) {
	const list = companionConditions(readableFlags(actor));
	if (!tag || list.includes(tag)) return false;
	await actor.setFlag(STONETOP_SCOPE, COMPANION_CONDITIONS_FLAG, [...list, tag]);
	return true;
}

/** Take `tag` off the companion's conditions, by hand on its card. Answers whether it was there. */
export async function removeCompanionCondition(actor, tag) {
	const list = companionConditions(readableFlags(actor));
	if (!list.includes(tag)) return false;
	await actor.setFlag(STONETOP_SCOPE, COMPANION_CONDITIONS_FLAG, list.filter(t => t !== tag));
	return true;
}

/**
 * The background's actions the character has marked, in the background's order, as the companion card
 * lists them; null when the background has no markable actions (anyone but a Beast-Bonded Ranger).
 *
 * @param {object|null} background  the taken background (the playbook's `backgrounds` entry)
 * @param {string[]} marked         flags.background.markedActions
 * @returns {null|Array<{slug: string, label: string, lend: boolean}>}
 */
export function beastBondActions(background, marked) {
	const options = background?.markableActions?.options ?? [];
	if (!options.length) return null;
	const set = new Set(Array.isArray(marked) ? marked : []);
	return options.filter(o => set.has(o.slug)).map(o => ({ slug: o.slug, label: o.label, lend: o.slug === LEND_STRENGTH_ACTION }));
}

/** The NPC standing for the companion (its card's actor link), or null. */
export function companionNpc(actor) {
	const details = readableFlags(actor)?.animalCompanion?.details ?? {};
	return followerActorFromLink({ actorUuid: details.actorUuid, sourceUuid: details.sourceUuid });
}

/**
 * Whether the companion's HP can be raised from this client, by setFollowerHp's own rule
 * (follower-hp.js#canSetFollowerHp): it has no NPC (its card's box is on the Ranger), or this client owns
 * the NPC, or a GM is connected to write it. PURE apart from the flags.
 *
 * @param {Actor} actor           the Ranger
 * @param {Actor|null} npc        the companion's NPC, as its card links it
 * @param {User|null} [gm]        the active GM
 */
export function lendStrengthWritable(actor, npc, gm = globalThis.game?.users?.activeGM ?? null) {
	return canSetFollowerHp(actor, { follower: "animal-companion" }, { link: () => npc, gm });
}

/**
 * "Lend it your strength": throw 1d6, lose all of it, and give the companion as much back, to its max: its
 * NPC when it has one, else its card's box (restoreFollowerCardHp). The card goes out after the writes, so
 * it can say where the companion ended. Refused before the die, with nothing lost, when the companion's HP
 * cannot be written from here (lendStrengthWritable).
 *
 * @param {Actor} actor  the Ranger
 * @param {object} [options]
 * @param {Function} [options.cardHp]  reads the card's HP box (restoreFollowerCardHp's; the sheet's by default)
 * @param {Actor|null} [options.npc]   the companion's NPC; one this client cannot write is healed by the GM's
 * @param {User|null} [options.gm]     the active GM, for the tests
 * @returns {Promise<null|{amount: number, hp: object|null, card: object|null}>}
 */
export async function lendStrength(actor, { cardHp, npc = companionNpc(actor), gm } = {}) {
	if (!actor) return null;
	if (!lendStrengthWritable(actor, npc, gm)) {
		globalThis.ui?.notifications?.warn?.(format(NO_GM_KEY, { name: npc?.name ?? "" }));
		return null;
	}
	const roll = await new Roll(LEND_STRENGTH_FORMULA).evaluate();
	const amount = Math.max(0, Math.trunc(Number(roll.total) || 0));
	const hp = await applyDamageToActor(actor, amount, { stonetopMove: LEND_STRENGTH });
	const card = await restoreFollowerCardHp({ character: actor, ftype: "animal-companion", slug: "" }, amount,
		{ moveName: LEND_STRENGTH, link: () => npc, ...(cardHp ? { cardHp } : {}) });
	const companion = String(readableFlags(actor)?.animalCompanion?.name ?? "").trim() || localize(`${KEY}.fallbackName`);
	const lines = [
		format(`${KEY}.lendLost`, { name: actor.name ?? "", amount, from: hp?.oldHp ?? 0, to: hp?.newHp ?? 0 }),
		card
			? format(`${KEY}.lendGained`, { name: companion, gain: card.to - card.from, from: card.from, to: card.to })
			: format(`${KEY}.lendNoBox`, { name: companion }),
	];
	await roll.toMessage({
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
		flavor:  rolledTotalCard(roll, [LEND_STRENGTH, localize(`${KEY}.bondHeading`)], localize(`${KEY}.lendLabel`), lines),
	});
	return { amount, hp, card };
}

// -- Loyal to the End's card --------------------------------------------------------------------------

/** The buttons Loyal to the End's roll card carries (roll-engine's tierActions): the 7-9's and the 6-'s. */
export function loyalToTheEndTierActions() {
	const button = `<button type="button" class="stonetop-companion-injured"><i class="fas fa-band-aid"></i> `
		+ `${escHtml(localize(`${KEY}.injuredButton`))}</button>`;
	return { partial: button, failure: button };
}

/** Spend the card's "Add the injured tag", once. Answers whether it did. */
export async function settleCompanionInjured(message, actor, { buttons = [] } = {}) {
	if (!actor || message?.getFlag?.(SYSTEM_ID, COMPANION_INJURED_FLAG)) return false;
	return withCardLatch(message, COMPANION_INJURED_FLAG, true, buttons, async () => {
		await addCompanionCondition(actor, INJURED_TAG);
		return true;
	});
}

/** Wire a Loyal to the End card's "Add the injured tag" (stonetop.js renderChatMessageHTML). */
export function wireLoyalToTheEnd(message, html) {
	wireLatchedButtons(message, html, { selector: ".stonetop-companion-injured", flag: COMPANION_INJURED_FLAG,
		what: "adding the companion's injured tag",
		act: (actor, _btn, buttons) => settleCompanionInjured(message, actor, { buttons }) });
}
