// What a follower's token offers in a fight: the orders their character rolls for them, and the
// swarm die their numbers earn. Both need the same answer first — whose follower is this, and which
// of their cards does it stand for (actors/character/follower-masters.js) — so both live here, with
// the same answer read the other way: which token in the fight a card stands for.
//
// ── ORDERS ──────────────────────────────────────────────────────────────────────────────────────
// A follower has no moves of their own to roll. When a character directs one to do something that
// would trigger a player move, "they trigger the move. If the move involves rolling, you roll for
// them" — Order Followers, Book I p.462 — and instead of +STAT the roll takes +1 if a tag or move of
// theirs applies, +2 if they are also exceptional, or disadvantage if a tag of theirs is in the way.
//
// So a follower's ring buttons are not the follower's rolls: they are the CHARACTER's, made through
// the very dialog their card's own Order button opens. Nothing here rolls anything; it works out
// whose follower the token is and hands that dialog what it weighs.
//
// CLASH AND LET FLY GET BUTTONS OF THEIR OWN. The ring only ever comes up on a token that is in a
// fight, and those are the two things a follower is most often ordered to do in one — Book I p.473
// describes a group follower that "Clashes or Lets Fly", and the crew's card prints exactly that
// pair. On the map every follower gets them, with Order beneath for everything else the dialog
// offers: Defend, Aid, Interfere, Seek Insight, or a move typed in.
//
// WHAT THE FOLLOWER IS is read off the NPC standing on the map, not rebuilt from the card: its name,
// its tags and its `npcMove` items ARE the card's, written there when the actor was made and kept in
// step afterwards by syncFollowerActors. The one thing the actor does not carry is `exceptional`,
// which is read from the character's flags.

import { followerCardFor, followerDetailBase } from "../actors/character/follower-masters.js";
import { readableFlags } from "../actors/character/StonetopFlags.js";
import { isFightTabEnabled } from "../settings.js";
import { fightOnScene } from "./fight-state.js";
import { groupFollowerStanding } from "../utils/crew.js";
import { normalizeTags, pileOnBonus } from "../data/follower-build.js";
import { BEAST_CATALOG } from "../data/beasts.js";

/**
 * Whether a card is a follower who takes orders at all.
 *
 * A Loyalty track marks a true follower, and livestock has none: the goat in the pen is not ordered
 * to Clash, and its card carries no Order button either (see `canOrder` on the character sheet).
 * Beasts are the one type that splits both ways, and which of them are followers is the catalog's
 * answer, not a guess from the card.
 */
export function followerTakesOrders({ ftype = "", slug = "" } = {}) {
	if (!ftype) return false;
	if (ftype === "beast") return !!BEAST_CATALOG[slug]?.follower;
	return true;
}

/**
 * A follower's tags as the dialog chips them: the NPC keeps them as one comma-separated line.
 *
 * Through the same normalizer the card's own tags went through when it was built
 * (data/follower-build.js), so a follower with a repeated tag gets the one chip from either door.
 */
export function followerTags(raw) {
	return normalizeTags(raw);
}

/** A follower's own moves: the NPC move items the card's Moves lines became. */
function followerMoves(actor) {
	const items = typeof actor?.items?.[Symbol.iterator] === "function" ? [...actor.items] : [];
	return items
		.filter(item => item?.type === "npcMove")
		.map(item => String(item?.name ?? "").trim())
		.filter(Boolean);
}

/**
 * Everything ordering this token's follower takes, or null when it is not a follower, is livestock,
 * or the character it follows cannot be found.
 *
 * @param {Actor} actor  the token's actor
 * @param {{character: Actor, ftype: string, slug: string}|null} card  followerCardFor's answer
 * @returns {null|{character: Actor, ftype: string, slug: string,
 *   follower: {name: string, tags: string[], moves: string[], exceptional: boolean}}}
 */
export function followerOrderInfo(actor, card) {
	if (!card || !followerTakesOrders(card)) return null;
	// Whatever the type, exceptional is read at the card's own detail path, the one the sheet's
	// control writes to. Book I p.462 gates the crew and the animal companion behind a move, but lets
	// the GM call ANY outstanding follower exceptional, so no type is left out here. An initiate the
	// insert prints "Exceptional" (Seren) is so until that toggle says otherwise; the default is playbook
	// data this cannot read synchronously, so the sheet's orderFollower, which this is handed to, settles it.
	const base = followerDetailBase(card.ftype, card.slug);
	const details = base ? foundry.utils.getProperty(readableFlags(card.character), base) : null;
	return {
		...card,
		follower: {
			name:        String(actor?.name ?? "").trim(),
			tags:        followerTags(actor?.system?.tags),
			moves:       followerMoves(actor),
			exceptional: !!details?.exceptional,
		},
	};
}

/**
 * Open the Order Followers dialog for one follower, on the move a button named.
 *
 * Goes through the character sheet's own `orderFollower`, which is the single door the Followers
 * tab's buttons use as well — so a follower ordered from the map is ordered exactly as they are from
 * their card, down to the Readiness a 7+ Defend holds.
 *
 * @param {object} info      followerOrderInfo's answer
 * @param {string|null} moveKey  the move to start on, or null for the dialog's own default
 */
export async function openFollowerOrder(info, moveKey = null) {
	const sheet = info?.character?.sheet;
	if (typeof sheet?.orderFollower !== "function") return null;
	return sheet.orderFollower({ ...info.follower, moveKey: moveKey || null }, { ftype: info.ftype, slug: info.slug });
}

// ── THE SWARM DIE ───────────────────────────────────────────────────────────────────────────────
// A group follower's token carries one member's die, because the abstraction it fights under gives a
// group "HP/armor as per a single individual member". That is the right number for one of them and
// the wrong one for all of them: several attackers on a SINGLE foe "roll one attacker's damage, +1
// per each additional attacker" (Followers in Fights, Book I p.473). Without this the crew hits like
// one crewman, which is the number their own card tells them not to use.
//
// DAMAGE ONLY. The armor half of "+1 damage and +1 armor" belongs to the OTHER rule — the optional
// group-vs-group abstraction, which pays by how far one side outnumbers the other, not by how many
// pile on. The two agree only against a single foe. See data/follower-build.js, where both live.

/**
 * The swarm die a group follower's token earns, or null for a follower who is one body.
 *
 * It opens at the members still STANDING, exactly as the card's own Swarm row does — the roster is
 * the only count either of them can know. Send in fewer than all of them and the damage window, which
 * opens on every roll, is where that comes back off.
 *
 * @param {Actor} actor  the token's actor
 * @param {{character: Actor, ftype: string, slug: string}|null} card  followerCardFor's answer
 * @returns {null|{formula: string, standing: number, bonus: number}}
 */
export function followerSwarm(actor, card) {
	if (!card) return null;
	const base = String(actor?.system?.attributes?.damage?.rollFormula ?? "").trim();
	if (!base) return null;
	const roster = groupFollowerStanding(readableFlags(card.character), card);
	// Nobody to pile on with: a follower who is one person, or a group with one left standing.
	if (!(Number(roster?.standing) > 1)) return null;
	const { bonus, rollFor } = pileOnBonus(roster.standing);
	return { formula: rollFor(base), standing: roster.standing, bonus };
}

/**
 * Both of the above, for the fight ring, which wants them together and should not go looking for the
 * same character twice on one click.
 *
 * @param {Actor} actor  the token's actor
 * @param {object} [options]  passed through to followerCardFor (injectable for tests)
 * @returns {{order: object|null, swarm: object|null}}
 */
export function followerRingInfo(actor, options = {}) {
	if (actor?.type !== "npc") return { order: null, swarm: null };
	const card = followerCardFor(actor, options);
	if (!card) return { order: null, swarm: null };
	return { order: followerOrderInfo(actor, card), swarm: followerSwarm(actor, card) };
}

// ── THE CARD'S TOKEN ────────────────────────────────────────────────────────────────────────────
// The way back: a card's damage rolled from the character's sheet swings as the follower's token when
// there is one in the fight (combat/attack-flow.js#rollFollowerDamageAt), so it is aimed, seeded and
// recorded exactly as the same blow from the token's own ring.

/**
 * The follower's own actor, when the card has exactly one token in the fight on the canvas scene, else
 * null: no fight, the Fight tab off, the follower not in it, or a group split into several tokens, where
 * which of them swung is anybody's guess.
 *
 * @param {Actor} character  whose card it is
 * @param {{ftype: string, slug?: string}} card
 * @param {object} [options]
 * @param {Scene|null} [options.scene]
 * @param {Function} [options.cardFor]  followerCardFor (injectable for tests)
 * @returns {Actor|null}  the token's actor (its own, for an unlinked token)
 */
export function followerInFight(character, { ftype = "", slug = "" } = {}, { scene = globalThis.canvas?.scene ?? null, cardFor = followerCardFor } = {}) {
	if (!isFightTabEnabled() || !character?.uuid || !ftype || !scene) return null;
	const combat = fightOnScene(scene);
	if (!combat) return null;
	const mine = [...(combat.combatants ?? [])].filter(c => {
		if (c?.sceneId !== scene.id || c.actor?.type !== "npc") return false;
		const card = cardFor(c.actor, { characters: [character] });
		return card?.character?.uuid === character.uuid && card.ftype === ftype && (card.slug ?? "") === (slug ?? "");
	});
	return mine.length === 1 ? mine[0].actor : null;
}
