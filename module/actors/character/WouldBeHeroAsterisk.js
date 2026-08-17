import { STONETOP_SCOPE } from "./StonetopFlags.js";
import { escHtml } from "../../utils/strings.js";
import { stonetopChatCard } from "../../utils/chat.js";

export const WBH_PLAYBOOK_NAME = "The Would-Be Hero";
export const WBH_HERO_NAME     = "The Hero";
export const WBH_HERO_FLAG     = "wbhBecameHero";

const POTENTIAL_FOR_GREATNESS = "Potential for Greatness";
const _STAT_KEYS = new Set(["str", "dex", "con", "int", "wis", "cha"]);

// The Would-Be Hero's "hero-making" moves are marked with system.asterisk (all of
// them are level-6 replacement moves). "The first time you use any move marked with
// an asterisk, cross off 'Would-be'." We treat simply OWNING such a move as the
// trigger: the playbook header renders "The Hero" automatically (see ownsAsteriskMove
// + heroDisplayName), and the first time a Would-Be Hero gains one we announce it in
// chat once (maybeAnnounceBecameHero, wired to the createItem hook).

/** True if the actor owns any Would-Be Hero "hero-making" (asterisked) move. */
export function ownsAsteriskMove(actor) {
	return !!actor?.items?.some(i => i.type === "move" && i.system?.asterisk);
}

/** Display name for the playbook header — "The Hero" once "Would-be" is crossed off. */
export function heroDisplayName(playbookName, becameHero) {
	return (becameHero && playbookName === WBH_PLAYBOOK_NAME) ? WBH_HERO_NAME : playbookName;
}

/**
 * createItem hook handler. The first time a Would-Be Hero gains a hero-making
 * (asterisked) move, cross off "Would-be" and announce it in chat. The one-time
 * guard lives in crossOffWouldBe (keyed on WBH_HERO_FLAG); the header already
 * derives "The Hero" from ownership regardless, so this is purely the announcement.
 */
export async function maybeAnnounceBecameHero(item, userId, options = {}) {
	if (game.userId !== userId) return;               // only the responsible client writes/announces
	// Don't fire on bulk / non-interactive item creation (world data import, a drop from a
	// compendium, or duplicating a pre-built character) — the announcement marks an in-play
	// gain, not materializing an actor that already carries the move. crossOffWouldBe's flag
	// guard still catches an already-crossed-off hero; this covers the un-flagged template case.
	if (options?.temporary || options?.fromCompendium || options?.keepId) return;
	if (item?.type !== "move" || !item.system?.asterisk) return;
	const actor = item.parent;
	if (actor?.type !== "character") return;
	if (actor.system?.playbook?.name !== WBH_PLAYBOOK_NAME) return;
	if (actor.getFlag(STONETOP_SCOPE, WBH_HERO_FLAG)) return; // already announced
	await crossOffWouldBe(actor);
}

/**
 * Called after a stat roll. Potential for Greatness is marked "Once per level, when you
 * roll a stat and get a 10+." It is NOT collected at level-up — so when a Would-Be Hero who
 * still owns an unmarked PfG box rolls a 10+ on an actual stat roll (not a follower/crew
 * roll) and hasn't yet taken this level's mark, post a chat reminder. The once-per-level
 * cap is read straight from the stored marks ({ stat, level }) keyed by move name.
 */
export async function maybeRemindPotentialForGreatness(actor, statKey, total) {
	if (actor?.type !== "character" || total < 10) return;
	if (actor.system?.playbook?.name !== WBH_PLAYBOOK_NAME) return;
	if (!_STAT_KEYS.has(statKey)) return; // follower/crew rolls aren't "rolling a stat"

	const pfg = actor.items.find(i => i.type === "move" && i.name === POTENTIAL_FOR_GREATNESS);
	const markOptions = pfg?.system?.markOptions ?? [];
	if (!markOptions.length) return;

	const moveMarks = (actor.getFlag(STONETOP_SCOPE, "moves.moveMarks") ?? {})[POTENTIAL_FOR_GREATNESS] ?? {};
	const entriesAt = slug => Array.isArray(moveMarks[slug]) ? moveMarks[slug] : [];
	const capacity  = markOptions.reduce((n, o) => n + (o.marks ?? 1), 0);
	const used      = markOptions.reduce((n, o) => n + entriesAt(o.slug).length, 0);
	if (used >= capacity) return; // all six boxes already filled

	const level = actor.system?.attributes?.level?.value ?? 1;
	if (markOptions.some(o => entriesAt(o.slug).some(e => e?.level === level))) return; // already marked this level

	await ChatMessage.create({
		content: stonetopChatCard("Potential for Greatness",
			`<div class="stonetop-roll-card-description">
				<p><strong>${escHtml(actor.name)}</strong> rolled a <strong>10+</strong> on a stat roll and hasn't yet marked <strong>Potential for Greatness</strong> this level.</p>
				<p><em>Once per level, when you roll a stat and get a 10+,</em> mark one box: increase the stat you rolled (${statKey.toUpperCase()}) by 1 to a max of +2, increase your max HP by 4, or increase your damage die to a d8.</p>
			</div>`),
		speaker: ChatMessage.getSpeaker({ actor }),
	});
}

/** Cross off "Would-be": flag the actor as a Hero and announce it. */
export async function crossOffWouldBe(actor) {
	if (!actor || actor.getFlag(STONETOP_SCOPE, WBH_HERO_FLAG)) return;
	await actor.setFlag(STONETOP_SCOPE, WBH_HERO_FLAG, true);
	await ChatMessage.create({
		content: stonetopChatCard("A Would-Be Hero No Longer",
			`<div class="stonetop-roll-card-description">
				<p><strong>${escHtml(actor.name)}</strong> has crossed off &ldquo;Would-be&rdquo;: they are now <strong>${WBH_HERO_NAME}</strong>.</p>
			</div>`),
		speaker: ChatMessage.getSpeaker({ actor }),
	});
}
