// HOW A CHARACTER'S HOMEBREW MOVES AND BACKGROUND CHANGE THEIR OTHER ROLLS, read from their own words
// (playbooks/move-words.js#rollBendsFrom), for the two places the book's moves do the same: the stat
// picker (a stat swap, as Skill at Arms' "Clash with DEX": data/alt-stat-grants.js) and the roll window's
// lines (advantage, a 6- as a 7-9, a flat +N: StonetopCharacter FICTION_ROLL_OFFERS). Every line is
// offered UNTICKED, as the book's are: whether the fiction fits ("within a dream", "with the intent to
// kill") is the table's call.
//
// Only a homebrew playbook's: a book move's or background's rules are the code's own, never re-read.

import { rollBendsFrom, damageFromWords, backgroundFollowerFrom, stockStandInsFrom, lastDoorInsertsFrom } from "../../playbooks/move-words.js";
import { playbookTextFromHtml } from "../../playbooks/playbook-text.js";
import { HOMEBREW_MOVE_FLAG, HOMEBREW_SLUG_PREFIX, homebrewPlaybookBySlug } from "../../playbooks/playbook-catalog.js";
import { SYSTEM_ID, ITEM_FLAG_SCOPE } from "../../system-id.js";
import { moveLearnedIn } from "./owns-move.js";
import { isPersuadeMove } from "./fine-whisky.js";

/** A taken line's effect on the roll (StonetopCharacter#_foldTakenOffers), by the bend's kind; null is advantage. */
export const BEND_EFFECTS = Object.freeze({
	advantage: null, missAsPartial: "missAsPartial", partialAsSuccess: "partialAsSuccess",
	statValue: "statValue", modifier: "modifier",
});

/**
 * THE one walk over a character's LEARNED homebrew moves, each with its words as the readers take them
 * (playbookTextFromHtml): `{item, words}`. Every rule read off a homebrew move's words (the bends, Stock
 * stand-ins, damage lines, armor, a Minor Arcana draw) starts here, so which moves count is said once.
 */
export function* learnedHomebrewMoves(actor) {
	for (const item of actor?.items ?? []) {
		if (item?.type !== "move" || !item.flags?.[SYSTEM_ID]?.[HOMEBREW_MOVE_FLAG] || !moveLearnedIn(item, actor.items)) continue;
		yield { item, words: playbookTextFromHtml(item.system?.description ?? "") };
	}
}

/** Whether `bend` rides a roll made under `moveName`: one it names ("Persuade" is either Persuade), or any. */
export function bendRides(bend, moveName) {
	if (!moveName) return false;
	if (!bend?.moves) return true;
	return bend.moves.some(m => (m === "Persuade" ? isPersuadeMove(moveName) : m === moveName));
}

/**
 * The selected background of a HOMEBREW playbook, as the bends read it: `{slug, label, description,
 * resources: [{key, label, max}]}`, or null (no background, or a book playbook's).
 */
export function homebrewBackgroundOf(playbookData, selectedSlug) {
	if (!String(playbookData?.slug ?? "").startsWith(HOMEBREW_SLUG_PREFIX) || !selectedSlug) return null;
	const b = (playbookData.backgrounds ?? []).find(x => x?.slug === selectedSlug);
	if (!b) return null;
	return {
		slug: b.slug, label: playbookTextFromHtml(b.label ?? b.slug), description: b.description ?? "",
		resources: (b.setup?.resources ?? []).map(r => ({ key: r.key, label: String(r.label ?? ""), max: Number(r.max) || 1 })),
	};
}

/**
 * Every bend this character has: `[{key, source, bend, item?, background?}]`, from each LEARNED homebrew
 * move (`item`) and the homebrew background they took (`background`, homebrewBackgroundOf).
 */
export function homebrewRollBends(actor, background = null) {
	const out = [];
	for (const { item, words } of learnedHomebrewMoves(actor)) {
		rollBendsFrom(words).forEach((bend, i) => {
			out.push({ key: `hb-${item.id ?? item._id}-${i}`, source: item.name, bend, item });
		});
	}
	if (background) {
		rollBendsFrom(playbookTextFromHtml(background.description)).forEach((bend, i) => {
			out.push({ key: `hb-bg-${background.slug}-${i}`, source: background.label, bend, background });
		});
	}
	return out;
}

/**
 * The post-death inserts (`"ghost"`, `"revenant"`, `"thrall"`) this character's HOMEBREW background lets
 * them take after coming back from the Last Door on any result (move-words.js#lastDoorInsertsFrom: the
 * Stranger's Grave Tender), with the background's name: `{slugs, background}`. Read off the world's playbook
 * Item, so a window can ask it while it draws.
 */
export function lastDoorAdoptions(actor) {
	const pb = homebrewPlaybookBySlug(actor?.system?.playbook?.slug);
	// The background as every other bend reads it (homebrewBackgroundOf), chosen as backgroundState says.
	const selected = actor?.typedActor?.backgroundState?.().slug ?? actor?.flags?.[SYSTEM_ID]?.background?.selected;
	const bg = pb ? homebrewBackgroundOf({ slug: pb.system?.slug, backgrounds: pb.flags?.[ITEM_FLAG_SCOPE]?.backgrounds }, selected) : null;
	if (!bg) return { slugs: [], background: "" };
	return { slugs: lastDoorInsertsFrom(playbookTextFromHtml(bg.description)), background: bg.label };
}

/**
 * What this character's LEARNED homebrew moves let them pay in place of Stock (move-words.js
 * #stockStandInsFrom: Witchcraft's "mark a debility, lose 5HP, or sacrifice an item"), each stamped with
 * the move's name as `from`, for stock-cost.js#stockSources. Without it a Blessed move learned through
 * such a move could never be made: the character has no sacred pouch to pay from.
 */
export function homebrewStockStandIns(actor) {
	const out = [];
	for (const { item, words } of learnedHomebrewMoves(actor)) {
		for (const s of stockStandInsFrom(words) ?? []) out.push({ ...s, from: item.name });
	}
	return out;
}

/**
 * The damage window's lines from a character's LEARNED homebrew moves (move-words.js#damageFromWords):
 * Deadly's "increase all damage dice by one size" as a `dieStep` line, a "+1d4 damage" as its dice. Each
 * UNTICKED, as the book's Predator is: whether this blow meant to kill is the table's to say. In the
 * shape fight/hero-moves.js#blowOffers gives its own lines.
 */
export function homebrewBlowOffers(actor) {
	const out = [];
	for (const { item, words } of learnedHomebrewMoves(actor)) {
		const read = damageFromWords(words);
		if (!read) continue;
		const what = read.dieStep ? (read.dieStep > 1 ? `damage dice ${read.dieStep} sizes larger` : "damage dice one size larger") : `+${read.dice} damage`;
		out.push({
			key: `hb-dmg-${item.id ?? item._id}`, applied: false, tags: [],
			...(read.dieStep ? { dieStep: read.dieStep } : { dice: read.dice }),
			label: `${item.name}: ${what}`,
			pill: `${item.name} (${what})`,
		});
	}
	return out;
}

/**
 * The follower a homebrew background still owes ("work with the GM to create a monstrous follower. They
 * start with loyalty 2", the Stranger's Moon Blessed), for the Followers tab's add bar beside "Create your
 * crew": `{slug, background, kind, loyalty}`, or null when the background gives none or a follower made
 * from this offer is already on the sheet (`fromBackground` on its stored data).
 */
export function backgroundFollowerOffer(playbookData, selectedSlug, customFollowers = {}) {
	const background = homebrewBackgroundOf(playbookData, selectedSlug);
	if (!background) return null;
	const read = backgroundFollowerFrom(playbookTextFromHtml(background.description));
	if (!read) return null;
	if (Object.values(customFollowers ?? {}).some(f => f?.fromBackground === background.slug)) return null;
	return { slug: background.slug, background: background.label, kind: read.kind, loyalty: read.loyalty };
}

/** The learned move whose track is titled `title` ("Fear" is Pariah's), or null. */
export function moveWithTrackTitled(actor, title) {
	if (!title) return null;
	const want = String(title).toLowerCase();
	return (actor?.items ?? []).find(i => i?.type === "move" && moveLearnedIn(i, actor.items)
		&& String(i.system?.resource?.title ?? "").toLowerCase() === want) ?? null;
}
