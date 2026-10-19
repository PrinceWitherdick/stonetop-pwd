// Bring the follower cards made from the system's own lists up to those lists.
//
// A possession's follower (possession-followers.js) and an arcanum's summon (arcana-summons.js) are
// built into a card once, when they are added, and nothing revisits the card. Most of what has
// changed in those lists since is a player's call the card already records (how many Hounds), or is
// put right by asking (the beautiful scroll's tulpa, summon-repair.js). What is left is a handful of
// values that were simply wrong:
//   • the Would-be Hero's good dog was baked as a HERDER, with a note to change it by hand, before
//     the retriever-or-herder pick on the possession led its tags (2026-09-25);
//   • Thistlewik's "indistinguishable voice" is a "disembodied voice" (2026-08-23);
//   • the Servants of Daagon's move list was cut short (2026-08-23);
//   • Halix and the Mighty Servant carried "exceptional" as a plain tag, so their orders rolled +1, not
//     +2; the tag became the card's flag (2026-10-18);
//   • the Blessed's Olwin was printed "Armor 1 (shield)" with no Gear, so her shield never bought its
//     +1 Readiness; the playbook now gives her a ticked Shield row, seeded onto a card with no Gear
//     stored (2026-10-18).
//
// THE SAME RULE AS THE HELD MOVES (move-refresh.js), with the old values listed here by hand: the
// lists are code, not pack data, so the history generator cannot read them. A card is corrected only
// while its field still holds exactly a value an older release wrote, so a player's own edit stays.
// The dog's tags change only when the player has picked: with no pick there is no right answer yet,
// and the old note asking for one stays with it. Per version, from Ready.

import { STONETOP_SCOPE, resolvedFlags } from "../actors/character/StonetopFlags.js";
import { possessionFollower } from "../data/possession-followers.js";
import { summonEntryFor } from "../data/arcana-summons.js";
import { normalizeTags } from "../data/follower-build.js";
import { initiateGearSeedData } from "../actors/character/initiates.js";
import { sameValue } from "./superseded-values.js";
import { SweepFailures } from "./sweep-failures.js";

const DOG = "possession:a-good-dog";
const DOG_KEY = DOG.split(":")[1];

/** Every value an older release wrote to these cards and no longer does, by sourceUuid then field. */
export const FOLLOWER_SUPERSEDED = {
	"possession:a-good-dog": {
		"tags": [
			[
				"herder",
				"keen-nosed",
				"clever"
			]
		],
		"notes": [
			"Choose when you gain it: a retriever, or a herder (keen-nosed, clever)."
		]
	},
	"stone-idol:thistlewik": {
		"notes": [
			"Armor 6 (stone, resilience), 2 vs. iron. Special qualities: inert; indistinguishable voice. It hardly considers itself a follower."
		]
	},
	"blackwood-fetishes:halix": {
		"tags": [
			["undead", "spirit", "magical", "hedonistic", "cautious", "devious", "stealthy", "exceptional"]
		]
	},
	"mindgem:mighty-servant": {
		"tags": [
			["large", "construct", "Maker-wise", "beautiful", "meek", "hardy", "slow", "strong", "exceptional"]
		]
	},
	"ring-of-daagon:servant-of-daagon": {
		"notes": [
			"Base 'group' build \u2014 adjust this card to your roll. Each Call Up, roll five d4s and assign each to one aspect:\n• Tags: 1 +craven; 2 +ravenous; 3 +cunning; 4 +exceptional (roll +2 for moves).\n• No. Appearing: 1 horde (2d6, HP 3, d6); 2-3 group (1d6+1, HP 6, d8); 4 solitary (HP 12, d10).\n• Size: 1 small (-2 HP, -2 damage, hand); 2-3 medium (close); 4 large (+4 HP, +1 damage, close, reach).\n• Traits (choose N = assigned die): blubbery/scaly hide (2 armor) / +stealthy & +cautious / powerful (+2 damage, forceful) / tentacles, pincers (reach, grabby) / big claws, fangs (1 piercing, messy) / projectiles (+near).\n• Moves (choose N = assigned die): Wriggle free / Heal at a prodigious rate / Smother, constrict, engulf / Dissolve organic material / Mesmerize the weak-willed / Paralyze with venom."
		]
	}
};

const sameTags = (a, b) => JSON.stringify(normalizeTags(a).map(t => t.toLowerCase())) === JSON.stringify(normalizeTags(b).map(t => t.toLowerCase()));

/**
 * What a follower card's fields should become, `{ field: value }`, or null. PURE.
 *
 * @param {object} card     a stored custom follower
 * @param {string[]} picked  the possession's sub-choice slugs (the dog's retriever or herder)
 */
export function followerRefresh(card, picked = []) {
	const old = FOLLOWER_SUPERSEDED[card?.sourceUuid];
	if (!old) return null;
	const now = card.sourceUuid === DOG
		? (() => {
			const built = possessionFollower(DOG_KEY, picked);
			// Nothing picked: no right answer to correct towards, so the card (note included) waits.
			if (!built || sameTags(built.tags, possessionFollower(DOG_KEY, []).tags)) return null;
			return { tags: built.tags, notes: built.notes ?? "" };
		})()
		: summonEntryFor(card);
	if (!now) return null;
	const update = {};
	for (const [field, values] of Object.entries(old)) {
		const same = field === "tags" ? sameTags : sameValue;
		if (same(card[field], now[field])) continue;
		if (values.some(v => same(card[field], v))) update[field] = field === "tags" ? normalizeTags(now[field]) : String(now[field] ?? "");
	}
	// A tag list put right that dropped "exceptional" hands it to the flag, which is what rolls the +2.
	if (update.tags && now.exceptional && !card.exceptional) update.exceptional = true;
	return Object.keys(update).length ? update : null;
}

/**
 * The Blessed's initiates picked before the playbook carried their starting Gear (Olwin's "Armor 1
 * (shield)" became a ticked Shield row, 2026-10-18), as an `actor.update()` fragment. Seeded only onto
 * a card with no Gear stored at all (initiates.js#initiateGearSeed), so a player's own list stays.
 * The playbook is read only for a character with a background pick stored.
 */
async function initiateGearData(actor) {
	const flags = resolvedFlags(actor);
	const slugs = Object.entries(flags.background?.choices ?? {}).filter(([, on]) => on).map(([slug]) => slug);
	if (!slugs.length) return {};
	const playbook = await actor.typedActor?.playbook?.();
	return initiateGearSeedData(playbook?.backgrounds, flags, slugs, STONETOP_SCOPE);
}

/**
 * Refresh every character's catalog-made follower cards. Per version, from Ready.
 *
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @returns {Promise<number>} how many characters were written to
 */
export async function refreshCatalogFollowers({ actors = globalThis.game?.actors ?? [] } = {}) {
	let written = 0;
	const failures = new SweepFailures("refreshing catalog followers");
	for (const actor of actors) {
		if (actor?.type !== "character") continue;
		const followers = actor.getFlag?.(STONETOP_SCOPE, "customFollowers") ?? {};
		const picked = resolvedFlags(actor).possessions?.subChoices?.[DOG_KEY] ?? [];
		const data = {};
		for (const [id, card] of Object.entries(followers)) {
			const update = followerRefresh(card, picked);
			for (const [field, value] of Object.entries(update ?? {})) data[`flags.${STONETOP_SCOPE}.customFollowers.${id}.${field}`] = value;
		}
		await failures.attempt(actor.name, async () => {
			Object.assign(data, await initiateGearData(actor));
			if (!Object.keys(data).length) return;
			// Quiet in the ledger: the list corrected, not an edit anybody made.
			await actor.update(data, { stonetopLedger: true });
			written += 1;
		});
	}
	failures.throwIfAny();
	return written;
}
