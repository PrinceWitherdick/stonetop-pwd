// ── What the steading is still owed, and what it still owes ─────────────────────
// The row of glyphs beside the steading's title. ONE RULE decides what belongs here:
//
//     an icon shows only while something is UNRESOLVED, and it goes away when it resolves.
//
// That is narrower than "anything with a future trigger", and deliberately so. Three kinds of
// thing are kept OUT by it:
//
//   • Instant effects, even when the paperwork waits. A Population boom is +1 Population the
//     moment it is picked; ticking the box later does not make it pending.
//   • Held POOLS. Boon, Blessing, Sanction and the rest are effects that already landed: you
//     hold them, and nothing fires on its own. They have tracks on their own moves.
//   • Permanent passives. Greater Harvest gives +1d4 Surplus every autumn forever, so an icon
//     for it never disappears, stops carrying information, and becomes a worse second copy of
//     the Improvements tab.
//
// What is left is small on purpose, and it means one specific thing: IF A GLYPH IS SHOWING,
// SOMEONE HAS SOMETHING TO DO. Note that "recurring" is not the same as "permanent" here —
// the watch's upkeep comes back every season and still belongs, because its glyph toggles
// (due, paid, due again) rather than sitting lit forever.

/** Where the tray's art lives. One un-plated game-icons drawing per row, worn as a CSS mask. */
export const HOLD_ICON_DIR = "systems/stonetop-pwd/assets/icons/holds";

/**
 * The rows, in the order they appear. `tone` splits what the steading HAS from what it OWES,
 * which is the only distinction the tray draws: boons read in the header's own ink, dues in a
 * warmer one, so an unpaid obligation is not mistaken for a gift at a glance.
 *
 * `label` does three jobs, which is why they are all short Title Case noun phrases naming the
 * THING rather than sentences describing its state: it is the row's accessible name, it is what
 * a screen reader announces for a glyph that has no text of its own, and it is the heading line
 * of the hover, above `tooltip`. A glyph is a picture somebody has to learn, so the hover names
 * it before it explains it — "The Herd's Feed", then what the herd eats and what it costs to
 * skip. One field for all three, because two that said nearly the same thing would drift.
 *
 * `tooltip` is therefore free to be a full sentence and never has to re-introduce its subject.
 */
export const HOLD_DEFS = [
	{
		key: "fortunesAdvantage",
		icon: "fortunes-advantage",
		tone: "boon",
		label: "Fortunes Advantage",
		tooltip: v => `Advantage on the steading's next roll of +Fortunes${String(v.source ?? "").trim() ? `, promised by ${String(v.source).trim()}` : ""}. Spent when that roll is made.`,
	},
	{
		key: "muster",
		icon: "muster",
		tone: "boon",
		label: "The Muster",
		// The only row with a control: standing the muster down has to give back the Defenses
		// it borrowed, and nobody should have to remember that by hand.
		action: "stand-down-muster",
		tooltip: v => `The steading is alert and ready for action${v.defenses ? ", with +1 Defenses while it holds" : ""}. It lasts until the threat passes, the Seasons Change, or you stand it down.`,
	},
	{
		key: "torsBlessing",
		icon: "tors-blessing",
		tone: "boon",
		label: "Tor's Blessing",
		tooltip: () => "Fine weather abounds: +1 to Pull Together this season, and roll the weather Die of Fate twice, taking your pick. Lasts the season.",
	},
	{
		key: "herdAdvance",
		icon: "herd-advance",
		tone: "boon",
		label: "The Herd's Growth",
		// A boon rather than a due: nothing is lost by leaving it, the year's growth is simply
		// not taken. It still belongs, because it is unresolved and it goes away when done.
		tooltip: () => "This summer's growth is unclaimed: the yearlings become grown, the foals become yearlings, and a new crop of foals arrives. Take it when the Seasons Change.",
	},
	{
		key: "innGathering",
		icon: "inn-gathering",
		tone: "due",
		label: "Gathering at the Inn",
		action: "inn-gathering",
		tooltip: () => "Folks have not yet gathered at the inn this season. Spend 1 Surplus to clear one of the steading's debilities.",
	},
	{
		key: "standingWatch",
		icon: "standing-watch",
		tone: "due",
		label: "The Watch's Upkeep",
		tooltip: () => "The standing watch consumes 1 Surplus this season, or it disbands. Settle it when the Seasons Change.",
	},
	{
		key: "weaponsUpkeep",
		icon: "weapons-upkeep",
		tone: "due",
		label: "Weapons Upkeep",
		tooltip: () => "The village owes 1 Surplus this spring to maintain and replace the town's weapons of war.",
	},
	{
		key: "militiaTraining",
		icon: "militia-drill",
		tone: "due",
		label: "The Militia's Drills",
		// A due rather than a boon, and one of only two whose neglect the book actually prices:
		// skipping the drills costs a trained tactic, which is a thing the militia had and then
		// does not. Summer only, unlike the watch's every-season bill.
		tooltip: () => "The militia wants 1 Surplus and a week of drills this summer, or it loses its training in 1 tactic. Settle it when the Seasons Change.",
	},
	{
		key: "herdFeed",
		icon: "herd-feed",
		tone: "due",
		label: "The Herd's Feed",
		// The one seasonal upkeep whose neglect the book actually prices, so the row says the
		// price. The watch disbands and the weapons are the GM's call; horses die by the d6.
		tooltip: v => `The herd eats ${v.needed} Surplus this winter${v.surplus < v.needed ? `, and the steading has ${v.surplus}` : ""}. Every Surplus it goes short costs 1d6 horses. Settle it when the Seasons Change.`,
	},
	{
		key: "winterDebt",
		icon: "winter-debt",
		tone: "due",
		label: "Winter's Debt",
		// The only due with a control, because it is the only one that comes due AFTER the
		// Seasons Change window is shut. The others are settled inside it; this one has to be
		// reachable from wherever the table is when they get to it.
		action: "settle-winter-debt",
		// The only row created by a ROLL rather than by a season turning, and the only one the
		// steading had no memory of before it existed: the 7-9 was said once, in chat, and then
		// the table had to carry it until winter ended.
		tooltip: v => `Winter still wants ${v.amount} more Surplus before it ends, or the steading suffers the consequences again. It has ${v.surplus}.`,
	},
];

/**
 * The tray, from plain state. Pure, so every combination is testable without a world.
 *
 * @param {object} s
 * @param {{source: string}|null} [s.fortunesAdvantage]  the held +Fortunes advantage, if any
 * @param {{defenses: boolean}|null} [s.muster]          the muster, if it still holds
 * @param {boolean} [s.torsBlessing]                     is Tor's blessing active this season
 * @param {boolean} [s.herdAdvance]                      herd earned, this summer's growth untaken
 * @param {boolean} [s.innGathering]                     inn built, gathering unspent AND useful
 * @param {boolean} [s.standingWatch]                    watch raised, upkeep unpaid this season
 * @param {boolean} [s.weaponsUpkeep]                    weapons raised, spring upkeep unpaid
 * @param {boolean} [s.militiaTraining]                  militia raised, summer drills unpaid
 * @param {{needed: number, surplus: number}|null} [s.herdFeed]  herd unfed this winter
 * @param {{amount: number, surplus: number}|null} [s.winterDebt] winter's second consumption, owed
 * @returns {Array<{key,icon,tone,label,tooltip,action}>}
 */
export function steadingHolds(s = {}) {
	// Driven straight off HOLD_DEFS, so a row can never appear out of the declared order and a
	// tenth hold is one table entry rather than an entry plus a matching `if` down here.
	return HOLD_DEFS.filter(def => s[def.key]).map(({ tooltip, ...def }) => ({
		...def,
		tooltip: tooltip(s[def.key]),
	}));
}
