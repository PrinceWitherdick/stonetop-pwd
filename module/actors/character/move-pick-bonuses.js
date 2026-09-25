/**
 * Moves (and backgrounds) that change how many options a roller may take off ANOTHER move's
 * printed list, or add to that list: the Fox's Perceptive ("When you Seek Insight, you may ask 1
 * additional question. Even on a 6-, you can ask 1 question"), the Ranger's Survivalist ("When
 * you Forage, pick 1 extra choice (even on a 6-, pick 1) and add ... to the list of options"), the
 * Fox's The Natural ("add 'What opportunity does no one else see?' to the list of possible
 * questions").
 *
 * The caps themselves are read off the move's own prose and stamped on its tickable list
 * (utils/chat.js#pickableMoveDescription), which is a reading of the MOVE and knows nothing of who
 * rolled it. So a Perceptive Fox's 4th question on a 10+ quietly let go of her 1st, and her 6-
 * showed no list at all. This is the per-roller half, laid over that stamp where the roll card is
 * built and the roller is known (item/StonetopItem.js#roll).
 *
 * Deliberately NOT here, because they are a different shape: the "you can always ask X for free,
 * even on a 6-" moves (Hound of Aratis, Vision Unclouded, Sniff Out Corruption, Attuned, Voice of
 * Experience, Expert Tracker) grant ONE named question outside the count, which a single capped
 * list cannot say; Deep Insight's extra question is "not limited to the list" and only "about
 * something magical"; Well Versed's follow-up rides Know Things, which prints no list.
 */

import { ownsLearnedMoveNamed } from "./owns-move.js";
import { THE_NATURAL } from "../../data/alt-stat-grants.js";
import { tookBackground } from "./took-background.js";
import { readableFlags } from "./StonetopFlags.js";
import { pickListItem, pickListStampAttrs, readPickListStamp } from "../../utils/chat.js";
import { escHtml } from "../../utils/strings.js";
import { TIER_KEYS } from "../../utils/move-results.js";
import { format, localize } from "../../utils/i18n.js";

/**
 * `move` is the move whose list changes. The row applies when the roller has `ownsLearned`
 * LEARNED, or took `background` (`{ playbook, slug, label }`).
 *
 * `plus` raises every tier that already reaches the list; `missFloor` opens the 6- with that many.
 * `addOptions` are appended to the list, in the granting text's own words (pinned against the pack
 * by tests/actors/character/move-pick-bonuses.test.js, so a reworded source fails a test rather
 * than drifting).
 */
export const MOVE_PICK_BONUSES = [
	{ move: "Seek Insight", ownsLearned: "Perceptive", plus: 1, missFloor: 1 },
	{ move: "Seek Insight", background: THE_NATURAL,
		addOptions: ["What opportunity does no one else see?"] },
	{ move: "Forage", ownsLearned: "Survivalist", plus: 1, missFloor: 1,
		addOptions: ["Find or fashion some useful item or supply (GM can veto)"] },
];

/**
 * The MOVE_PICK_BONUSES rows `actor` brings to a roll of `moveName`, in table order. A character's
 * alone: a monster or NPC rolling a move brings nothing to it.
 */
export function movePickBonusesFor(actor, moveName) {
	if (actor?.type !== "character" || !moveName) return [];
	const rows = MOVE_PICK_BONUSES.filter(b => b.move === moveName);
	if (!rows.length) return [];
	const playbook   = actor.system?.playbook?.name ?? null;
	// Read without throwing: a roll is no place to fail over a flag bag (CharacterBackgrounds#selectedSlug
	// is the same key, through a class this pure module has no instance of).
	const bag        = rows.some(b => b.background) ? readableFlags(actor) : {};
	const background = bag?.background?.selected ?? bag?.["background.selected"] ?? null;
	return rows.filter(b => b.background
		? tookBackground({ playbook, background }, b.background)
		: ownsLearnedMoveNamed(actor, b.ownsLearned));
}

const _OPEN_RE = /<ul class="stonetop-picklist"([^>]*)>([\s\S]*?)<\/ul>/i;

/**
 * `html` (a card body whose FIRST tickable list is the move's own) with `bonuses` laid over that
 * list's stamp and rows. Unchanged when there is no list or nothing to lay.
 *
 * The caps go per tier, since a miss that opens with a floor of 1 must not also lift a 10+ to its
 * cap: a flat `data-pick-max` is spread over the tiers first. A tier the move left uncapped stays
 * uncapped. Added options go on the END, because `data-index` is positional and a message's saved
 * ticks must still land on the options they were put on.
 */
export function applyPickBonuses(html, bonuses = []) {
	const src = String(html ?? "");
	if (!bonuses.length) return src;
	const open = _OPEN_RE.exec(src);
	if (!open) return src;
	const attrs = open[1];

	const { caps, tiers: stampedTiers } = readPickListStamp(attrs);
	// An unstamped list reaches every tier (utils/pick-tally.js#tierOffersPicks).
	const reaches = new Set(stampedTiers.length ? stampedTiers : TIER_KEYS);

	for (const b of bonuses) {
		for (const t of TIER_KEYS) {
			if (b.plus && reaches.has(t) && caps[t] > 0) caps[t] += b.plus;
		}
		if (b.missFloor && !reaches.has("failure")) {
			reaches.add("failure");
			caps.failure = b.missFloor;
		}
	}

	const kept = attrs
		.replace(/\sdata-pick-max(?:-[a-z]+)?="[^"]*"/gi, "")
		.replace(/\sdata-pick-tiers="[^"]*"/gi, "");
	const stamp = pickListStampAttrs(
		Object.fromEntries(TIER_KEYS.filter(t => caps[t] > 0).map(t => [t, caps[t]])),
		stampedTiers.length ? TIER_KEYS.filter(t => reaches.has(t)) : []);

	const start = (open[2].match(/<li\b/gi) ?? []).length;
	const added = bonuses.flatMap(b => b.addOptions ?? []).map((text, i) => pickListItem(escHtml(text), start + i)).join("");

	const rebuilt = `<ul class="stonetop-picklist"${kept}${stamp}>${open[2]}${added}</ul>`;
	return src.slice(0, open.index) + rebuilt + src.slice(open.index + open[0].length);
}

/**
 * The line a card carries under the list, naming what changed its count, so a "0/4 selected" over
 * a move that prints "ask 3" says where the 4th came from. Empty for a row that only adds options:
 * the added option is on the list itself, and says so.
 */
export function pickBonusNotes(bonuses = []) {
	return bonuses.filter(b => b.plus || b.missFloor).map(b => {
		const detail = [
			b.plus      ? format("stonetop.pickBonus.plus",      { n: b.plus }) : null,
			b.missFloor ? format("stonetop.pickBonus.missFloor", { n: b.missFloor }) : null,
		].filter(Boolean).join(localize("stonetop.pickBonus.joiner"));
		const source = b.ownsLearned ?? b.background?.label ?? "";
		return `<p class="stonetop-pick-bonus-note"><em>${escHtml(format("stonetop.pickBonus.note", { source, detail }))}</em></p>`;
	}).join("");
}

/** `applyPickBonuses` and its note, for `actor` rolling `moveName`: the one call a card builder makes. */
export function withMovePickBonuses(html, actor, moveName) {
	const bonuses = movePickBonusesFor(actor, moveName);
	if (!bonuses.length) return String(html ?? "");
	const applied = applyPickBonuses(html, bonuses);
	// No list to lay them over, no note: it would name a count nothing on the card shows.
	return applied === String(html ?? "") ? applied : applied + pickBonusNotes(bonuses);
}
