import { STONETOP_SCOPE } from "./StonetopFlags.js";
import { escHtml } from "../../utils/strings.js";
import { stonetopChatCard, canUserWriteCard, whisperedAs } from "../../utils/chat.js";
import { playbookSlug } from "../../utils/playbook-slug.js";
import { ownsLearnedMoveNamed } from "./owns-move.js";
import { MARK_STAT_CAPS } from "./stat-rules.js";
import { POTENTIAL_FOR_GREATNESS, filledMarkCount, markCapacity, hasMarkAtLevel, markEntries, isFilledMark } from "./pfg-marks.js";
import { ROLLED_FLAG, countedTier, totalTier, isStrongHit } from "../../utils/counted-tier.js";
import { format, localize } from "../../utils/i18n.js";

const KEY = "stonetop.wouldBeHero";
const PFG_KEY = `${KEY}.potentialForGreatness`;

// The NAME is for display and the SLUG is for matching, and the difference matters more
// for this playbook than for any of the other eight: it is the one that renames itself.
// A Would-Be Hero who crosses off "Would-be" reads as "The Hero" everywhere they are
// named (heroDisplayName, below), and a player is free to retitle the field besides. Both
// of the guards further down decide whether a RULE applies, so both ask the slug — which
// is the pack's id for the playbook and moves only when the pack does. Match either of
// them on the name and the feature switches itself off for the sheet that renamed it,
// silently, with the move sitting right there on it.
export const WBH_PLAYBOOK_NAME = "The Would-Be Hero";
export const WBH_PLAYBOOK_SLUG = "the-would-be-hero";
export const WBH_HERO_NAME     = "The Hero";
export const WBH_HERO_FLAG     = "wbhBecameHero";

const _STAT_KEYS = new Set(["str", "dex", "con", "int", "wis", "cha"]);

// -- THE ASTERISK: "The first time you use any move marked with an asterisk (*), cross off 'Would-be'" --
//
// On first USE, not on gaining the move (the user's ruling, 2026-09-27; Book I: "Caradoc uses Big Damn
// Hero and crosses 'Would-be' off his playbook"). The four starred moves are the level-6 replacements
// below, and each use point calls asteriskMoveUsed:
//  • Undaunted: its +1d6 taken on a blow, or its +1 armor applied to one (fight/hero-moves.js,
//    from the damage window and combat/attack-flow.js#applyOwedDamage).
//  • Big Damn Hero: the leap, or locking eyes (fight/hero-moves.js#leapIn, #lockEyes).
//  • A Force to Be Reckoned With: a 12+ Defy Danger with its line taken (would-be-hero-cards.js#forceTurnedTables).
//  • Voice of Experience: its free Seek Insight question asked (the card's "Ask it" button,
//    would-be-hero-cards.js), or its advice given (give-advantage-flow.js#offerAdvantage).
// Whatever the sheet cannot see (A Force's first paragraph, a leap made at the table) is the Moves tab's
// "I used it" button on each starred move's card, while the hero is still Would-be.
//
// Crossed off is the flag (WBH_HERO_FLAG) and nothing else: owning a starred move is not using it, and
// losing one later does not un-cross it. A character flagged before this ruling (when a GAIN crossed it
// off) stays The Hero.
//
// A crossing-off made by mistake (the "I used it" button pressed for a use that never happened) is
// undone by restoreWouldBe, which writes the flag FALSE rather than removing it: false is "Would-be on
// purpose", and it keeps the grandfathering (migration/would-be-hero-grandfather.js) from crossing it
// off again on the next release.

/** The Would-Be Hero's starred moves, as the pack names them. */
export const ASTERISK_MOVES = Object.freeze([
	"A Force to Be Reckoned With",
	"Big Damn Hero",
	"Undaunted",
	"Voice of Experience",
]);

/** Display name for the playbook header: "The Hero" once "Would-be" is crossed off. */
export function heroDisplayName(playbookName, becameHero) {
	return (becameHero && playbookName === WBH_PLAYBOOK_NAME) ? WBH_HERO_NAME : playbookName;
}

/**
 * Whether using `moveName` now would cross off "Would-be": a Would-Be Hero (by slug), not yet crossed
 * off, holding that starred move LEARNED. A non-Would-Be Hero holding one (a cross-playbook pick) never
 * crosses anything off. PURE apart from the actor.
 */
export function asteriskUseCounts(actor, moveName) {
	if (actor?.type !== "character" || !ASTERISK_MOVES.includes(moveName)) return false;
	if (playbookSlug(actor) !== WBH_PLAYBOOK_SLUG) return false;
	if (actor.getFlag?.(STONETOP_SCOPE, WBH_HERO_FLAG)) return false;
	return ownsLearnedMoveNamed(actor, moveName);
}

/**
 * A starred move was USED: cross off "Would-be" and announce it, the first time. Every use point calls
 * this (see above); it answers whether this use was the one that crossed it off.
 */
export async function asteriskMoveUsed(actor, moveName) {
	if (!asteriskUseCounts(actor, moveName)) return false;
	return crossOffWouldBe(actor, moveName);
}

// -- POTENTIAL FOR GREATNESS: the reminder on a 10+ ----------------------------
//
// "Once per level, when you roll a stat and get a 10+, mark one of the following (note the level during
// which you marked it)." It is NOT collected at level-up, so a 10+ on a stat roll posts a reminder, with a
// button per box still open. ANY final 10+ counts (the user's ruling): the roll's own, and one a rewrite
// lifts it to afterwards (a Shift, a +1, Burn Brightly, the Logbook, Impetuous Youth), which is why the card
// latches it (PFG_REMINDED_FLAG) rather than the roll: one card, one reminder, however often it moves.

/** The roll card's latch: this card has posted its reminder. Kept when the card later drops below 10. */
export const PFG_REMINDED_FLAG = "pfgReminded";
/** The reminder card's own record: `{ stat }`, the stat the 10+ was rolled with. */
export const PFG_REMINDER_FLAG = "pfgReminder";
/** The reminder card's latch once a box was marked from it: the kind marked ("stat", "hp", "damage"). */
export const PFG_MARKED_FLAG = "pfgMarked";

// Which of the three kinds a mark option is. Read off the pack's own fields (a stat slot's `choice`, the
// HP box's `hp`, the damage box's `damageDie`), with the slug as a fallback for an older owned copy.
function _pfgKind(opt) {
	if (opt?.choice === "stat") return "stat";
	if (opt?.hp != null || opt?.slug === "hp") return "hp";
	if (opt?.damageDie || opt?.slug === "damage") return "damage";
	return null;
}

// Potential for Greatness's mark options: the pack definition's first (the owned copy of an older
// character may carry none), the owned copy's after. Empty when neither has them.
async function _pfgMarkOptions(actor) {
	let def = null;
	try { def = await actor?.typedActor?._moveMarkDefinition?.(POTENTIAL_FOR_GREATNESS); }
	catch (err) { console.warn("Stonetop | could not read Potential for Greatness from its pack", err); }
	if (def?.markOptions?.length) return def.markOptions;
	const owned = actor?.items?.find?.(i => i.type === "move" && i.name === POTENTIAL_FOR_GREATNESS);
	return owned?.system?.markOptions ?? [];
}

/** This character's Potential for Greatness marks, as the mark store keeps them (option slug to entries). */
function _pfgMarks(actor) {
	return (actor?.getFlag?.(STONETOP_SCOPE, "moves.moveMarks") ?? {})[POTENTIAL_FOR_GREATNESS] ?? {};
}

const _level = actor => actor?.system?.attributes?.level?.value ?? 1;

/**
 * What a Would-Be Hero could mark in Potential for Greatness after a 10+ rolled with `statKey`, or null
 * when there is nothing to remind them of: not a Would-Be Hero, the move not LEARNED, not a stat roll, a box
 * already marked this level, or no box left that would do anything. A stat slot is open only while the
 * rolled stat is below the move's cap (stat-rules.js#MARK_STAT_CAPS, "to a max of +2").
 *
 * @returns {Promise<null|{ level: number, statCapped: boolean,
 *   open: Array<{ kind: "stat"|"hp"|"damage", slug: string, index?: number, count?: number }> }>}
 *   `index` is the stat slot to fill, `count` the box count to set (StonetopCharacter#setStatSlot /
 *   #setCountMark)
 */
export async function pfgOpenMarks(actor, statKey) {
	if (actor?.type !== "character") return null;
	if (playbookSlug(actor) !== WBH_PLAYBOOK_SLUG) return null;
	if (!_STAT_KEYS.has(statKey)) return null; // follower/crew rolls aren't "rolling a stat"
	// A rule asks the LEARNED move: an un-learned Potential for Greatness marks nothing.
	if (!ownsLearnedMoveNamed(actor, POTENTIAL_FOR_GREATNESS)) return null;

	const markOptions = await _pfgMarkOptions(actor);
	if (!markOptions.length) return null;
	const moveMarks = _pfgMarks(actor);
	// FILLED marks, not stored entries: a stat slot picked out of order pads the ones before it.
	if (filledMarkCount(moveMarks, markOptions) >= markCapacity(markOptions)) return null;
	const level = _level(actor);
	if (hasMarkAtLevel(moveMarks, markOptions, level)) return null; // already marked this level

	const cap = MARK_STAT_CAPS[POTENTIAL_FOR_GREATNESS];
	const statCapped = Number.isFinite(cap) && (Number(actor.system?.stats?.[statKey]?.value) || 0) >= cap;
	const open = [];
	for (const opt of markOptions) {
		const kind = _pfgKind(opt);
		if (!kind) continue;
		const boxes = opt.marks ?? 1;
		const entries = markEntries(moveMarks[opt.slug]);
		if (kind === "stat") {
			if (statCapped) continue;
			const index = Array.from({ length: boxes }, (_, i) => i).find(i => !isFilledMark(entries[i], opt));
			if (index !== undefined) open.push({ kind, slug: opt.slug, index });
		} else if (entries.length < boxes) {
			open.push({ kind, slug: opt.slug, count: entries.length + 1 });
		}
	}
	return open.length ? { level, statCapped, open } : null;
}

// Each kind's button label and its clause in the reminder's sentence (`buttons.<kind>`, `clauses.<kind>`).
const _pfgLabel  = (kind, stat) => format(`${PFG_KEY}.buttons.${kind}`, { stat: stat.toUpperCase() });
const _pfgClause = (kind, stat) => format(`${PFG_KEY}.clauses.${kind}`, { stat: stat.toUpperCase() });

function _orList(parts) {
	if (parts.length <= 1) return parts.join("");
	if (parts.length === 2) return format(`${PFG_KEY}.orTwo`, { first: parts[0], second: parts[1] });
	return format(`${PFG_KEY}.orMany`, { rest: parts.slice(0, -1).join(localize(`${PFG_KEY}.separator`)), last: parts.at(-1) });
}

/**
 * The reminder, when one is owed: a Would-Be Hero's stat roll whose COUNTED tier is a 10+ (`options.tier`,
 * or the total's own when none is given). Goes where the roll went (`whisper`, `rollMode`), and latches on
 * the roll card (`message`) so a card lifted to 10+ later asks nothing twice. Whether it posted.
 *
 * @param {Actor} actor
 * @param {string} statKey
 * @param {number} total
 * @param {object} [options]
 * @param {string} [options.tier]  the tier the roll COUNTS as (utils/counted-tier.js#countedTier)
 * @param {string[]} [options.whisper]  the roll card's whisper list (Struggle as One)
 * @param {string} [options.rollMode]  the table's chat mode the roll went out under
 * @param {ChatMessage} [options.message]  the roll card, to latch
 * @returns {Promise<boolean>}
 */
export async function maybeRemindPotentialForGreatness(actor, statKey, total, { tier = null, whisper = [], rollMode = null, message = null } = {}) {
	if (!isStrongHit(tier ?? totalTier(total))) return false;
	if (message?.getFlag?.(STONETOP_SCOPE, PFG_REMINDED_FLAG)) return false;
	const offer = await pfgOpenMarks(actor, statKey);
	if (!offer) return false;

	// Latched first, so a second rewrite racing this one finds it.
	if (message?.setFlag) {
		try { await message.setFlag(STONETOP_SCOPE, PFG_REMINDED_FLAG, true); }
		catch (err) { console.warn("Stonetop | could not latch the Potential for Greatness reminder on its card", err); }
	}

	const clauses = offer.open.map(o => _pfgClause(o.kind, statKey));
	const capped = offer.statCapped
		? ` <em>${format(`${PFG_KEY}.statCapped`, { stat: escHtml(statKey.toUpperCase()) })}</em>` : "";
	const buttons = offer.open.map(o =>
		`<button type="button" class="stonetop-pfg-mark-btn" data-pfg-kind="${o.kind}">${escHtml(_pfgLabel(o.kind, statKey))}</button>`).join("");
	const list = Array.isArray(whisper) ? whisper.filter(Boolean) : [];
	const messageData = {
		content: stonetopChatCard(POTENTIAL_FOR_GREATNESS,
			`<div class="stonetop-roll-card-description">
				<p>${format(`${PFG_KEY}.rolled`, { name: escHtml(actor.name) })}</p>
				<p>${format(`${PFG_KEY}.rule`, { options: _orList(clauses) })}${capped}</p>
			</div>
			<div class="card-buttons stonetop-roll-actions stonetop-pfg-mark-buttons">${buttons}</div>`),
		speaker: ChatMessage.getSpeaker({ actor }),
		flags: { [STONETOP_SCOPE]: { [PFG_REMINDER_FLAG]: { stat: statKey } } },
	};
	// Where the roll went: an explicit whisper list, else the roll card's own whisper (and blindness), else
	// the chat mode applied the way core does it, so a Blind or Private GM roll's 10+ is not announced to
	// the whole table.
	if (list.length) messageData.whisper = list;
	else whisperedAs(messageData, message, rollMode);
	await ChatMessage.create(messageData);
	return true;
}

/**
 * A roll card's total was rewritten (stonetop.js#_resyncRewrittenTotal): remind when the tier it now COUNTS
 * as is a 10+ and the card has not reminded yet. The stat, and any "treat a 7-9 as a 10+", are the ones the
 * roll stamped on its card (utils/counted-tier.js#ROLLED_FLAG); a card without that record (rolled before it
 * was kept, or not a stat roll) is left alone. A whispered card's reminder is whispered to the same people.
 */
export async function remindPotentialForGreatnessOnCard(message, actor, total) {
	const record = message?.getFlag?.(STONETOP_SCOPE, ROLLED_FLAG);
	if (!record?.stat || !Number.isFinite(Number(total))) return false;
	const whisper = Array.isArray(message.whisper) ? message.whisper : [];
	return maybeRemindPotentialForGreatness(actor, record.stat, Number(total), {
		tier: countedTier(Number(total), record), whisper, message,
	});
}

/**
 * Mark one box from the reminder: the first open stat slot with the rolled stat, or the next HP or damage
 * box, at the current level (StonetopCharacter#setStatSlot / #setCountMark note it). Asked again at the
 * press, so a box marked some other way since the card was posted is not marked twice. Whether it marked.
 */
export async function markPotentialForGreatness(actor, statKey, kind) {
	const offer = await pfgOpenMarks(actor, statKey);
	const box = offer?.open.find(o => o.kind === kind);
	const character = actor?.typedActor;
	if (!box || !character) return false;
	if (kind === "stat") await character.setStatSlot(POTENTIAL_FOR_GREATNESS, box.slug, box.index, statKey);
	else await character.setCountMark(POTENTIAL_FOR_GREATNESS, box.slug, box.count);
	return true;
}

/**
 * The reminder's buttons, for whoever owns the character; everyone else sees the sentence alone. Latched
 * once a box is marked from it (PFG_MARKED_FLAG) or any box this level was marked some other way.
 */
export function wirePotentialForGreatnessReminder(message, html, { actor = null } = {}) {
	const row = html?.querySelector?.(".stonetop-pfg-mark-buttons");
	if (!row) return;
	const record = message?.getFlag?.(STONETOP_SCOPE, PFG_REMINDER_FLAG);
	if (!actor?.isOwner || !record?.stat) { row.remove(); return; }
	const marked = message.getFlag(STONETOP_SCOPE, PFG_MARKED_FLAG)
		|| hasMarkAtLevel(_pfgMarks(actor), null, _level(actor));
	const buttons = [...row.querySelectorAll(".stonetop-pfg-mark-btn")];
	for (const button of buttons) {
		if (marked) { button.disabled = true; continue; }
		button.addEventListener("click", async () => {
			if (button.disabled) return;
			for (const b of buttons) b.disabled = true;
			try {
				const kind = button.dataset.pfgKind;
				if (!(await markPotentialForGreatness(actor, record.stat, kind))) {
					globalThis.ui?.notifications?.warn(localize(`${PFG_KEY}.markRefused`));
					return;
				}
				if (canUserWriteCard(message, globalThis.game?.user, { whenUnknown: false })) {
					await message.setFlag(STONETOP_SCOPE, PFG_MARKED_FLAG, kind);
				}
			} catch (err) {
				console.error("Stonetop | marking Potential for Greatness failed", err);
				for (const b of buttons) b.disabled = false;
			}
		});
	}
}

/**
 * Cross off "Would-be": flag the actor as a Hero and announce it, naming the starred move used when
 * there is one. Once: a Hero already flagged answers false and posts nothing.
 */
export async function crossOffWouldBe(actor, moveName = "") {
	if (!actor?.setFlag || actor.getFlag?.(STONETOP_SCOPE, WBH_HERO_FLAG)) return false;
	await actor.setFlag(STONETOP_SCOPE, WBH_HERO_FLAG, true);
	const said = format(`${KEY}.${moveName ? "heroCrossedOffUsing" : "heroCrossedOff"}`, {
		name: escHtml(actor.name), move: escHtml(moveName), hero: escHtml(WBH_HERO_NAME),
	});
	const ChatMessage = globalThis.ChatMessage;
	await ChatMessage?.create?.({
		content: stonetopChatCard(localize(`${KEY}.heroCardTitle`),
			`<div class="stonetop-roll-card-description">
				<p>${said}</p>
			</div>`),
		speaker: ChatMessage.getSpeaker?.({ actor }),
	});
	return true;
}

/**
 * Whether `actor` is a Would-Be Hero who has crossed off "Would-be", the one state restoreWouldBe undoes.
 * By slug, like the guards above. PURE apart from the actor.
 */
export function canRestoreWouldBe(actor) {
	if (actor?.type !== "character" || playbookSlug(actor) !== WBH_PLAYBOOK_SLUG) return false;
	return !!actor.getFlag?.(STONETOP_SCOPE, WBH_HERO_FLAG);
}

/**
 * Write "Would-be" back in, for a crossing-off made by mistake, and say so in chat as the crossing-off
 * was. The flag goes to false, not away (see the top of this file). The next starred move used crosses
 * it off again as usual. Whether it restored anything.
 */
export async function restoreWouldBe(actor) {
	if (!canRestoreWouldBe(actor)) return false;
	await actor.setFlag(STONETOP_SCOPE, WBH_HERO_FLAG, false);
	const ChatMessage = globalThis.ChatMessage;
	await ChatMessage?.create?.({
		content: stonetopChatCard(localize(`${KEY}.restoreCardTitle`),
			`<div class="stonetop-roll-card-description">
				<p>${format(`${KEY}.heroRestored`, { name: escHtml(actor.name) })}</p>
			</div>`),
		speaker: ChatMessage.getSpeaker?.({ actor }),
	});
	return true;
}
