/**
 * THE three result tiers: their keys, their card order, and the label each is printed under.
 *
 * This file already claimed to be the one place the tier labels live, and it was not: the same
 * three strings were retyped in the Death's Door and Undeath dialogs, the love letter reader,
 * the expedition Requisition table, and the spring Seasons Change table — six copies, which had
 * already drifted (two of them spelled the partial `7&ndash;9`, so the same rung printed with an
 * en dash on two surfaces and a hyphen on the rest). Import from here; do NOT retype them.
 */
export const MOVE_TIERS = Object.freeze([
	Object.freeze({ key: "success", label: "10+" }),
	Object.freeze({ key: "partial", label: "7-9" }),
	Object.freeze({ key: "failure", label: "6-"  }),
]);

/** The tier keys in card order — for the many `["success","partial","failure"]` walks. */
export const TIER_KEYS = Object.freeze(MOVE_TIERS.map(t => t.key));

/** Tier key → printed label, for the lookups that have a key in hand rather than a list. */
export const TIER_LABELS = Object.freeze(Object.fromEntries(MOVE_TIERS.map(t => [t.key, t.label])));

/**
 * The class on the tier LADDER's `<ul>` (utils/move-tiers.js `moveTiersHtml`), and the attribute
 * a roll card stamps on it to say which rung the dice landed on.
 *
 * Here rather than in move-tiers.js because the four places that need the class do not all share
 * an import edge with it: move-tiers.js BUILDS the ladder, utils/chat.js `firstOptionList` must
 * SKIP it (a ladder is never a move's option list, and tier rows handed a checkbox each was the
 * bug), stonetop.js re-stamps the attribute when a GM shifts a result, and the stylesheet paints
 * it. This file imports nothing, so chat.js can read it without closing the move-tiers → chat
 * cycle. Retyping the string is what let those four disagree silently.
 */
export const MOVE_TIERS_CLASS = "stonetop-move-tiers";
export const ROLLED_TIER_ATTR = "data-rolled-tier";

// Shared shaping for a move's 10+ / 7-9 / 6- result tiers, in the shape rollStat
// consumes ({ success|partial|failure: { label, value } }). Every move that authors
// result text goes through here — custom moves and love letters. When `picks` is given, each
// tier also carries a `pick` count (love letters' "on a 10+, pick 1" pools); custom moves pass
// none, so no `pick` key is added and their stored shape is unchanged.
export function buildMoveTierResults({ success = "", partial = "", failure = "" }, picks = null) {
	const text = { success, partial, failure };
	return Object.fromEntries(MOVE_TIERS.map(({ key, label }) => [
		key,
		picks
			? { label, value: text[key], pick: picks[key] ?? 0 }
			: { label, value: text[key] },
	]));
}

/**
 * Read the roll-type + tier text out of raw move-authoring dialog input, shared by every
 * move builder (custom moves, love letters). `allowedTypes` is the builder's whitelist of
 * roll types (the six stats for love letters, the wider custom set otherwise); an input
 * outside it collapses to "" (a no-roll move). Returns `{ rollType, success, partial,
 * failure }` with the tier strings trimmed.
 */
export function parseTierInput(input, allowedTypes) {
	const rt = String(input?.rollType ?? "").trim().toLowerCase();
	const r = input?.results ?? {};
	return {
		rollType: allowedTypes.includes(rt) ? rt : "",
		success: String(r.success ?? "").trim(),
		partial: String(r.partial ?? "").trim(),
		failure: String(r.failure ?? "").trim(),
	};
}

/**
 * The lead-in for a love-letter pick tier: "<pick> N", plus a "<fromList>" tail when the
 * letter carries a shared choose-from pool. Returns "" for a non-positive count. Callers
 * pass their own wording — the chat card ships English literals so the persisted outcome
 * string stays stable across clients and the GM Shift Up/Down flow, while the reader dialog
 * localizes — so only the shared count/branch logic lives here.
 *
 * @param {number}  count
 * @param {boolean} hasOptions       whether a shared pick-from pool is present
 * @param {object}  labels           { pick, fromList } wording
 */
export function pickLeadText(count, hasOptions, { pick, fromList }) {
	const c = Number(count) || 0;
	if (c <= 0) return "";
	return hasOptions ? `${pick} ${c} ${fromList}` : `${pick} ${c}`;
}
