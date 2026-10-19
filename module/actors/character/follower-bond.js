// A follower's Loyalty, as the two follower moves move it (Book I p.464):
//
//   STRENGTHEN YOUR BOND: "When you pay your follower's cost, and you haven't done so recently, they
//   hold +1 Loyalty (max 3)." And: "If a follower holds 3 Loyalty, then Strengthen Your Bond doesn't
//   trigger." The "recently" clause is the table's ("The PC and/or follower should have a significant
//   scene 'on camera' before they can Strengthen Their Bond again"), so the card names it and the
//   button does not count scenes.
//
//   "Spend your follower's Loyalty 1-for-1": never below 0.
//
// WHO MAY. "As a rule, a follower is tied to one PC, and only that PC can pay its cost or spend its
// Loyalty. But if an NPC follows the party as a whole, then any PC can generate or spend that follower's
// Loyalty." A follower is stored on the one character who leads them, so the rule's exception is a
// permission path: a custom follower marked as following the party as a whole (`wholeParty`, see
// follower-party.js) can have its Loyalty moved by any player with a character, and when that player
// cannot write the leader's character the change goes through the GM's client (FOLLOWER_LOYALTY_QUERY).

import { SYSTEM_ID } from "../../system-id.js";
import { FOLLOWER_FLAGS, fillFollowerSlug } from "./follower-roster.js";
import { followsPartyAsWhole } from "./follower-party.js";
import { readableFlags } from "./StonetopFlags.js";
import { askGMClient, queryAsker, resolveSync } from "../../utils/foundry-compat.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
import { moveChatCard } from "../../utils/chat.js";
import { escHtml } from "../../utils/strings.js";
import { format } from "../../utils/i18n.js";

/** The most Loyalty a follower holds (p.464, and every printed track's three circles). */
export const FOLLOWER_LOYALTY_MAX = 3;

export const STRENGTHEN_YOUR_BOND = "Strengthen Your Bond";
export const SPEND_LOYALTY = "Spend Loyalty";

/** The GM's side of a Loyalty change asked by a player who cannot write the leader's character. */
export const FOLLOWER_LOYALTY_QUERY = "stonetop.followerLoyalty";

// WHEN THE COST WAS LAST PAID. "The PC and/or follower should have a significant scene 'on camera' before
// they can Strengthen Their Bond again" (p.464) is the table's to judge, so nothing here refuses a payment.
// But a card that remembers when it was last paid can SAY so: a payment since the last End of Session
// (dialogs/EndOfSessionDialog.js, the one session boundary the system records) is shown on the button.
// One map on the leader, keyed "<ftype>:<slug>", because some Loyalty stores are bare numbers with nowhere
// beside them to keep a date.
export const COST_PAID_FLAG = "followerCostPaid";

/** The key a follower's last payment is kept under. PURE. */
export const costPaidKey = (ftype, slug = "") => `${ftype}:${slug ?? ""}`;

/**
 * Whether a follower's cost was paid since `since` (the last End of Session's time; 0 with none recorded,
 * so any payment counts). PURE.
 */
export function costPaidSince(flags, ftype, slug = "", since = 0) {
	const at = Number(flags?.[COST_PAID_FLAG]?.[costPaidKey(ftype, slug)]) || 0;
	return at > 0 && at > (Number(since) || 0);
}

/** Where a follower's Loyalty is stored (follower-roster.js#FOLLOWER_FLAGS), or null. */
export function followerLoyaltyPath(ftype, slug = "") {
	return fillFollowerSlug(FOLLOWER_FLAGS[ftype]?.loyalty, slug);
}

/**
 * One step of a Loyalty track, `{from, to}`, or null when nothing would change: a gain at 3 (Strengthen
 * Your Bond "doesn't trigger"), a spend at 0. PURE.
 */
export function loyaltyStep(current, delta) {
	const from = Math.min(FOLLOWER_LOYALTY_MAX, Math.max(0, Math.trunc(Number(current) || 0)));
	const to = Math.min(FOLLOWER_LOYALTY_MAX, Math.max(0, from + Math.trunc(Number(delta) || 0)));
	return to === from ? null : { from, to };
}

/** The follower's live Loyalty, off the leader's flags. */
export function followerLoyalty(character, ftype, slug = "") {
	const path = followerLoyaltyPath(ftype, slug);
	return path ? Math.max(0, Number(foundry.utils.getProperty(readableFlags(character), path)) || 0) : 0;
}

/**
 * Whether `user` may move this follower's Loyalty: the leader's owners always, and anyone with a
 * character of their own when the follower follows the party as a whole (p.464). PURE but for reads.
 */
export function mayMoveLoyalty(character, ftype, slug, user, actors = globalThis.game?.actors) {
	return loyaltyMover(character, user, actors)(ftype, slug);
}

/**
 * mayMoveLoyalty for many of one leader's followers at once, as `(ftype, slug) => boolean`: the answers
 * that do not depend on the follower (owning the leader, having a character of one's own) are asked
 * once, the scan of every actor only when a follower of the party as a whole first needs it.
 */
export function loyaltyMover(character, user, actors = globalThis.game?.actors) {
	if (!character || !user) return () => false;
	if (character.testUserPermission?.(user, "OWNER")) return () => true;
	let hasCharacter = null;
	return (ftype, slug) => {
		if (!followsPartyAsWhole(readableFlags(character), ftype, slug)) return false;
		hasCharacter ??= [...(actors ?? [])].some(a => a?.type === "character" && a.testUserPermission?.(user, "OWNER"));
		return hasCharacter;
	};
}

/**
 * Write a Loyalty step on the leader's character, named for the move that made it. Strengthen Your Bond also
 * stamps when the cost was paid (COST_PAID_FLAG), in the same write.
 */
async function writeLoyalty(character, path, step, move, { ftype = "", slug = "" } = {}) {
	const update = { [`flags.${SYSTEM_ID}.${path}`]: step.to };
	if (move === STRENGTHEN_YOUR_BOND && ftype) update[`flags.${SYSTEM_ID}.${COST_PAID_FLAG}.${costPaidKey(ftype, slug)}`] = Date.now();
	await character.update(update, { stonetopMove: move });
}

/**
 * Move a follower's Loyalty by `delta` (+1 to Strengthen Your Bond, -1 to spend it), here when this
 * client can write the leader's character, else through the GM's client. Answers `{from, to}`, or null
 * when nothing moved (at the bound, not allowed, no GM to ask).
 *
 * @param {Actor} character  the follower's leader
 * @param {{ftype: string, slug?: string, delta: number, move?: string}} change
 * @param {{gm?: object, user?: object}} [deps]
 */
export async function changeFollowerLoyalty(character, { ftype, slug = "", delta, move } = {}, deps = {}) {
	const { gm = globalThis.game?.users?.activeGM ?? null, user = globalThis.game?.user ?? null } = deps;
	const path = followerLoyaltyPath(ftype, slug);
	if (!character || !path) return null;
	const moveName = move || (Number(delta) > 0 ? STRENGTHEN_YOUR_BOND : SPEND_LOYALTY);
	if (character.isOwner) {
		const step = loyaltyStep(followerLoyalty(character, ftype, slug), delta);
		if (step) await writeLoyalty(character, path, step, moveName, { ftype, slug });
		return step;
	}
	if (!mayMoveLoyalty(character, ftype, slug, user)) return null;
	const answer = await askGMClient(gm, FOLLOWER_LOYALTY_QUERY,
		{ characterUuid: character.uuid, ftype, slug, delta, move: moveName, userId: user?.id ?? null },
		{ fallback: null, what: "move the follower's Loyalty" });
	return answer && typeof answer === "object" ? answer : null;
}

/**
 * The GM's side of FOLLOWER_LOYALTY_QUERY, on the primary GM only: move the Loyalty if the asker may
 * (mayMoveLoyalty), by one step either way. Answers `{from, to}` or null.
 */
export async function handleFollowerLoyaltyQuery(data, context = {}, deps = {}) {
	const { users = globalThis.game?.users, resolve = resolveSync, actors = globalThis.game?.actors } = deps;
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return null;
	const asker = queryAsker(data, context, users);
	const character = data?.characterUuid ? resolve(data.characterUuid) : null;
	const delta = Math.sign(Number(data?.delta) || 0);
	const path = followerLoyaltyPath(data?.ftype, data?.slug ?? "");
	if (character?.type !== "character" || !path || !delta) return null;
	if (!mayMoveLoyalty(character, data.ftype, data.slug ?? "", asker, actors)) return null;
	const step = loyaltyStep(followerLoyalty(character, data.ftype, data.slug ?? ""), delta);
	if (step) await writeLoyalty(character, path, step, String(data?.move || (delta > 0 ? STRENGTHEN_YOUR_BOND : SPEND_LOYALTY)), { ftype: data.ftype, slug: data.slug ?? "" });
	return step;
}

/**
 * The Lightbearer's Radiant Countenance (Book I p.123): "When you give someone your fond attention, you can
 * then Persuade them with advantage. If they are a follower, you can instead choose to Strengthen Your Bond
 * (as if you paid their cost)." The follower card's button for it, while the move is learned.
 */
export const RADIANT_COUNTENANCE = "Radiant Countenance";

/**
 * Strengthen Your Bond: +1 Loyalty, max 3, and a card naming the move. Answers the step, or null when
 * it did not trigger (already at 3, or not allowed).
 *
 * `radiant`: reached through Radiant Countenance rather than by paying the cost. The bookkeeping is the
 * same ("as if you paid their cost": the Loyalty, the paid-recently stamp, the ledger's move), and only
 * the card says otherwise, with no cost named since none was paid.
 *
 * @param {Actor} character  the follower's leader
 * @param {{ftype: string, slug?: string, name?: string, cost?: string, radiant?: boolean}} follower
 */
export async function strengthenBond(character, { ftype, slug = "", name = "", cost = "", radiant = false } = {}) {
	if (followerLoyalty(character, ftype, slug) >= FOLLOWER_LOYALTY_MAX && character?.isOwner) {
		globalThis.ui?.notifications?.info?.(format("stonetop.character.followers.bond.atMax", { name: name || "They" }));
		return null;
	}
	const step = await changeFollowerLoyalty(character, { ftype, slug, delta: 1, move: STRENGTHEN_YOUR_BOND });
	if (!step) return null;
	const who = `<strong>${escHtml(name || "Your follower")}</strong>`;
	const paid = cost && !radiant ? format("stonetop.character.followers.bond.cardCost", { cost: escHtml(cost) }) : "";
	const lead = radiant
		? format("stonetop.character.followers.bond.radiantCard",
			{ actor: `<strong>${escHtml(character?.name || "You")}</strong>`, name: who, loyalty: step.to })
		: format("stonetop.character.followers.bond.card", { name: who, loyalty: step.to });
	await globalThis.ChatMessage?.create?.({
		content: moveChatCard(STRENGTHEN_YOUR_BOND,
			`<p>${lead}${paid ? ` ${paid}` : ""}</p>`
			+ `<p>${format("stonetop.character.followers.bond.recently", {})}</p>`),
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: character }),
	});
	return step;
}
