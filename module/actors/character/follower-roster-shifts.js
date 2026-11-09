// WHICH ROSTER ROW A REMEMBERED INDEX MEANS NOW (round-2 audit FOE-2).
//
// A group follower's members are rows in arrays: the crew's named individuals (`crew.individuals`, HP keyed
// by index in `crew.individualsHp`), its anonymous tail (`crew.memberHp`), a custom group's members
// (`customFollowers.<id>.memberHp`). A member struck off the roster (the fate's Dead, a Remove button) or
// named out of the tail is CUT out of their array, and every row after them moves up one. Anything that
// remembered a member by index before the cut, a Death's Door card's "Back to 1 HP", a fate window still
// open, a damage card's "Took it", then names whoever moved into that slot: a healthy member set to 1 HP, the
// wrong one struck off, a blow given back to someone who never took it.
//
// So every cut is LOGGED on the roster it changes (`rosterShifts`, the last SHIFTS_KEPT of them, each
// numbered), whatever remembers a row also remembers the roster's number at that moment (rosterStamp), and
// reads the row back through the cuts made since (remapRosterRow): moved up, carried to the named list,
// or gone (null). A remembered row with no stamp (a card from before this) is read as it was. What remembers
// a row builds it with rosterRef and reads it back with resolveRosterRef.
//
// PURE: plain values in, plain values out.

import { escHtml } from "../../utils/strings.js";

/**
 * The data attributes a card button carries to say whose follower and which HP row, with the roster's number when
 * the card was posted (rosterStamp), so the row is found again after another member is struck off. PURE.
 */
export function rowButtonData({ follower = "", slug = "", index = null, name = "", stamp = null } = {}) {
	return `data-follower="${escHtml(follower)}" data-slug="${escHtml(slug)}" data-index="${index == null ? "" : escHtml(String(index))}" data-name="${escHtml(name)}"`
		+ (stamp == null ? "" : ` data-stamp="${escHtml(String(stamp))}"`);
}

/** Read a button's row back, the inverse of rowButtonData. PURE. */
export function rowFromButton(btn) {
	const d = btn?.dataset ?? {};
	const index = d.index === "" || d.index == null ? null : Number(d.index);
	const stamp = d.stamp === "" || d.stamp == null ? null : Number(d.stamp);
	return {
		follower: d.follower ?? "", slug: d.slug ?? "", index: Number.isInteger(index) ? index : null, name: d.name ?? "",
		...(Number.isInteger(stamp) ? { stamp } : {}),
	};
}

/** How many cuts a roster keeps, newest last. A row remembered from before the oldest kept cannot be read. */
export const SHIFTS_KEPT = 40;

/** The rows a roster cut can move, by HP row type (follower-fate.js#followerFateHpPath). */
const ROSTER_ROWS = new Set(["crew-member", "crew-individual", "custom-member"]);

/** Whether `follower` (an HP row type) is a roster row whose index a cut can move. */
export function isShiftingRow(follower) {
	return ROSTER_ROWS.has(String(follower ?? ""));
}

/** Where a roster keeps its cuts, under the system's flags: the crew's for both crew rows, else the group's. */
export function rosterShiftsPath(follower, slug = "") {
	if (follower === "crew-member" || follower === "crew-individual") return "crew.rosterShifts";
	if (follower === "custom-member" && slug) return `customFollowers.${slug}.rosterShifts`;
	return null;
}

/** The readable entries of a stored cut list, oldest first. */
function validShifts(list) {
	return Array.isArray(list) ? list.filter(entry => entry && Number.isInteger(Number(entry.n))) : [];
}

/** The number of the last cut in a list of readable entries, or 0 for none. */
const lastShift = list => (list.length ? Number(list[list.length - 1].n) : 0);

/** The cuts a roster has logged, oldest first. */
function shiftsAt(flags, follower, slug) {
	const path = rosterShiftsPath(follower, slug);
	return validShifts(path ? foundry.utils.getProperty(flags ?? {}, path) : null);
}

/** A roster's number now: the last cut's, or 0 for one never cut. */
export function rosterStamp(flags, follower, slug = "") {
	return lastShift(shiftsAt(flags, follower, slug));
}

/**
 * The roster's cut list with one more cut on the end: `row`'s member at `index` gone, or moved to `to`
 * (`{row, index}`, a member named out of the anonymous tail). Pass it whole as the update's value.
 *
 * @param {Array|undefined} list  the roster's `rosterShifts` as stored
 */
export function withRosterShift(list, row, index, to = null) {
	const kept = validShifts(list);
	const entry = { n: lastShift(kept) + 1, row: String(row), index: Math.trunc(Number(index)) };
	if (to?.row) entry.to = { row: String(to.row), index: Math.trunc(Number(to.index)) };
	return [...kept, entry].slice(-SHIFTS_KEPT);
}

/**
 * The row a member remembered at `{follower, index}` when the roster read `stamp` is at now: `{follower,
 * index}`, or null when they were cut out since (or the log no longer reaches back that far). A row that is
 * not a roster's, or remembered with no stamp, comes back as it was.
 */
export function remapRosterRow(flags, { follower, slug = "", index }, stamp) {
	const row = { follower, index: Math.trunc(Number(index)) };
	if (!isShiftingRow(follower) || stamp == null || stamp === "" || !Number.isInteger(row.index)) return row;
	const since = Number(stamp);
	if (!Number.isFinite(since)) return row;
	const list = shiftsAt(flags, follower, slug);
	// Older than the oldest cut kept: whatever happened in between is gone with the log.
	if (list.length >= SHIFTS_KEPT && since < Number(list[0].n) - 1) return null;
	let at = { ...row };
	for (const cut of list) {
		if (Number(cut.n) <= since) continue;
		// A member moved INTO this row's list at or above it pushes it down one (an append moves nothing).
		if (cut.row !== at.follower) {
			if (cut.to?.row === at.follower && cut.to.index <= at.index) at = { ...at, index: at.index + 1 };
			continue;
		}
		if (cut.index === at.index) {
			if (!cut.to) return null;
			at = { follower: cut.to.row, index: cut.to.index };
		} else if (cut.index < at.index) {
			at = { ...at, index: at.index - 1 };
		}
	}
	return at;
}

/**
 * A ROSTER REF: a row as something remembers it, `row` (`{follower, slug, index, name, ...}`) with the roster's
 * number now (rosterStamp), so resolveRosterRef finds it again after later cuts. This is the one shape everything
 * that remembers a row carries (a fate window, a Death's Door card, a damage card's roster hit) and the one
 * rowButtonData writes onto a button. Stable member ids would make it unneeded, but they need a migration. PURE.
 */
export function rosterRef(flags, row) {
	return { ...row, stamp: rosterStamp(flags, row?.follower, row?.slug ?? "") };
}

/**
 * Where a ref's row is NOW, `{follower, index}`, or null when its member was cut out since (remapRosterRow). A row
 * no cut can move comes back as it was; so does a ref with no stamp (one remembered before the log existed). PURE.
 */
export function resolveRosterRef(flags, ref) {
	if (!ref?.follower) return null;
	if (!isShiftingRow(ref.follower)) return { follower: ref.follower, index: ref.index };
	return remapRosterRow(flags, ref, ref.stamp);
}
