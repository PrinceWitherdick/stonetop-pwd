// The six character stats in the canonical sheet display order (matches `_STAT_DEFS`
// in StonetopCharacter, the order the character sheet renders and rolls with).
export const STAT_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

// Roll types a player may pick for a custom move: any stat, or "ask" (choose a
// stat each time). "" / absent means a no-roll narrative move.
export const CUSTOM_MOVE_ROLL_TYPES = [...STAT_KEYS, "ask"];

export function normalizeRollType(rollType) {
	if (rollType == null || rollType === "") return null;
	if (typeof rollType === "string") return rollType;
	if (typeof rollType === "object") {
		return normalizeRollType(
			rollType.value
			?? rollType.key
			?? rollType.id
			?? rollType.slug
			?? rollType.stat
			?? rollType.type
			?? null
		);
	}
	return String(rollType);
}

/**
 * A "stat" that is a number rather than a stat: a homebrew move's "roll +3 instead of rolling as normal"
 * (Your Finest Hour, StonetopCharacter#_foldTakenOffers) rolls "+3". No stat is rolled then, so no debility
 * touches it, and an "ask" move keeps its whole text and its own name (StonetopItem#roll).
 */
export function isFixedRollValue(stat) {
	return typeof stat === "string" && /^[+-]\d+$/.test(stat.trim());
}
