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
//   • Held POOLS. Favor, Blessing, Sanction and the rest are effects that already landed: you
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
 */
export const HOLD_DEFS = [
	{
		key: "fortunesAdvantage",
		icon: "fortunes-advantage",
		tone: "boon",
		label: "Fortunes advantage",
		tooltip: v => `Advantage on the steading's next roll of +Fortunes${String(v.source ?? "").trim() ? `, promised by ${String(v.source).trim()}` : ""}. Spent when that roll is made.`,
	},
	{
		key: "muster",
		icon: "muster",
		tone: "boon",
		label: "The muster holds",
		// The only row with a control: standing the muster down has to give back the Defenses
		// it borrowed, and nobody should have to remember that by hand.
		action: "stand-down-muster",
		tooltip: v => `The steading is alert and ready for action${v.defenses ? ", with +1 Defenses while it holds" : ""}. It lasts until the threat passes, the Seasons Change, or you stand it down.`,
	},
	{
		key: "torsBlessing",
		icon: "tors-blessing",
		tone: "boon",
		label: "Tor's blessing",
		tooltip: () => "Fine weather abounds: +1 to Pull Together this season, and roll the weather Die of Fate twice, taking your pick. Lasts the season.",
	},
	{
		key: "innGathering",
		icon: "inn-gathering",
		tone: "due",
		label: "Gathering at the inn",
		action: "inn-gathering",
		tooltip: () => "Folks have not yet gathered at the inn this season. Spend 1 Surplus to clear one of the steading's debilities.",
	},
	{
		key: "standingWatch",
		icon: "standing-watch",
		tone: "due",
		label: "Watch upkeep due",
		tooltip: () => "The standing watch consumes 1 Surplus this season, or it disbands. Settle it when the Seasons Change.",
	},
	{
		key: "weaponsUpkeep",
		icon: "weapons-upkeep",
		tone: "due",
		label: "Weapons upkeep due",
		tooltip: () => "The village owes 1 Surplus this spring to maintain and replace the town's weapons of war.",
	},
];

/**
 * The tray, from plain state. Pure, so every combination is testable without a world.
 *
 * @param {object} s
 * @param {{source: string}|null} [s.fortunesAdvantage]  the held +Fortunes advantage, if any
 * @param {{defenses: boolean}|null} [s.muster]          the muster, if it still holds
 * @param {boolean} [s.torsBlessing]                     is Tor's blessing active this season
 * @param {boolean} [s.innGathering]                     inn built, gathering unspent AND useful
 * @param {boolean} [s.standingWatch]                    watch raised, upkeep unpaid this season
 * @param {boolean} [s.weaponsUpkeep]                    weapons raised, spring upkeep unpaid
 * @returns {Array<{key,icon,tone,label,tooltip,action}>}
 */
export function steadingHolds(s = {}) {
	// Driven straight off HOLD_DEFS, so a row can never appear out of the declared order and a
	// seventh hold is one table entry rather than an entry plus a matching `if` down here.
	return HOLD_DEFS.filter(def => s[def.key]).map(({ tooltip, ...def }) => ({
		...def,
		tooltip: tooltip(s[def.key]),
	}));
}
