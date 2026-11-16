import { CUSTOM_MOVE_ROLL_TYPES } from "./roll-types.js";
import { formatCustomMoveDescription } from "./custom-move-text.js";
import { buildMoveTierResults, parseTierInput } from "./move-results.js";
import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";

// Coerce a value to an integer clamped to [lo, hi]; non-numeric / out-of-range → nearest bound.
// With a `fallback`, a value that is no finite number at all (missing, "abc", Infinity) is that
// instead (an imported playbook's unreadable count keeps its default).
export function clampInt(value, lo, hi, fallback) {
	const n = Math.trunc(Number(value));
	if (!Number.isFinite(n) && fallback !== undefined) return fallback;
	return Math.max(lo, Math.min(hi, n || 0));
}

/**
 * Shape raw custom-move dialog input into the item document data shared by every save
 * target — an actor-embedded "other" move (the on-sheet flow) and a reusable world Item
 * (the "Create Item → Move" flow). Returns `{ name, system, flags }` with NO `type`; the
 * caller adds `type:"move"`. Pure (no Foundry calls) so it stays unit-testable.
 *
 * moveResults follows the shape rollStat consumes:
 * `{ success|partial|failure: { label, value } }`, or null for a no-roll move. The move
 * then rolls through the same engine as any shipped move (StonetopItem.roll → rollStat).
 *
 * @param {object} input
 * @param {object} [opts]
 * @param {object|null} [opts.requirement] the move's stored requirement, when this is an EDIT:
 *        the dialog only shows its `note`, so the rest (the moves, stats or marks a move
 *        duplicated from a book one carries) is kept rather than wiped by a save that never
 *        showed it.
 */
export function buildCustomMoveData(input, { requirement: stored = null } = {}) {
	const { rollType, success, partial, failure } = parseTierInput(input, CUSTOM_MOVE_ROLL_TYPES);
	const moveResults = (rollType && (success || partial || failure))
		? buildMoveTierResults({ success, partial, failure })
		: null;

	// Optional resource track ({ max, title, labels }); null unless a positive max.
	const res = input?.resource ?? {};
	const resMax = clampInt(res.max, 0, 20);
	const resLabels = Array.isArray(res.labels)
		? res.labels.map(l => String(l).trim()).filter(Boolean)
		: String(res.labels ?? "").split(",").map(l => l.trim()).filter(Boolean);
	const resource = resMax > 0
		? { max: resMax, title: String(res.title ?? "").trim() || null, labels: resLabels }
		: null;

	const intIn = (v) => clampInt(v, 0, 99);
	// A printed prerequisite, kept as the book words it ({ note } is what requirementLabel reads).
	// null, not {}, when there is none: a whole-object update has to be able to clear it.
	const requires = String(input?.requires ?? "").replace(/\s+/g, " ").trim();
	// Anything else the stored requirement says rides along. Its note goes to null rather than
	// away when cleared, since an update merges into the stored object.
	const { note: _note, ...kept } = (stored && typeof stored === "object") ? stored : {};
	const requirement = Object.keys(kept).length
		? { ...kept, note: requires || null }
		: (requires ? { note: requires } : null);
	return {
		name: String(input?.name ?? "").trim() || "New Move",
		system: {
			moveType: "other",
			description: formatCustomMoveDescription(input?.description ?? ""),
			rollType,
			moveResults,
			resource,
			requirement,
			noXpOnMiss: !!input?.noXpOnMiss,
			hpBonus:   intIn(input?.hpBonus),
			armorBonus: intIn(input?.armorBonus),
			loadBonus:  intIn(input?.loadBonus),
		},
		flags: { [STONETOP_SCOPE]: { custom: true } },
	};
}
