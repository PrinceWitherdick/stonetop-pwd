import { STAT_KEYS } from "../utils/roll-types.js";
import { foldModes } from "../utils/roll-mode.js";

/**
 * STRUGGLE AS ONE, the rules (Book I p.78, run in full on p.328-331).
 *
 *   When you Defy Danger as a group, establish the party's approach and each roll +STAT (per
 *   Defy Danger): on a 6-, you find yourself in a spot, the GM will describe it or ask you to; on
 *   a 7-9, you pull your weight; on a 10+, you do well enough to get someone else out of a spot,
 *   if you can tell us how. If you roll a 6- but someone saves you, don't mark XP.
 *
 * Pure: nothing here touches a document. struggle-store.js reads and writes the actors, and
 * struggle-view.js holds the words.
 *
 * WHERE A STRUGGLE LIVES. The GM calls it, sets it up, shares the results and ends it, so the
 * struggle itself is one record on the GM Toolkit, which only a GM writes (STRUGGLE_FLAG). What a
 * player does (the stat they pick, the dice, who their 10+ gets out) is written to their OWN
 * character (STRUGGLE_ROLL_FLAG), so a player never writes anything but their own sheet. A follower
 * rolls through the character they follow (p.462: "you roll for them"), so a follower's row is
 * written there too.
 *
 * WHAT THE BOOK ADDS ON P.328-331, all of it kept here:
 *  - "Everyone rolls at once... Encourage them to keep their results quiet for the moment." Each
 *    roll goes to its player and the GM, and the GM shares them all at once (REVEALED).
 *  - "Those participating in the struggle can't Aid each other". Only somebody OUTSIDE it can, and
 *    the GM sets that up per row (`aid`), so it is never offered between two rows.
 *  - Several 6-: the GM puts them in one spot, where "a single 10+ might save everyone", or in
 *    separate spots, where "each 10+ will save only one of them" (SPOTS). Taking them one at a time
 *    is also "each 10+ can be used only once", so it is the same count as separate spots.
 *  - A group follower "roll[s] once for the group" (p.473), so a crew is one row, not six.
 */

export const STRUGGLE_MOVE = "Struggle as One";

/** On the GM Toolkit: the struggle itself. Only a GM writes it. */
export const STRUGGLE_FLAG = "struggle";
/** On each character: their rows' dice, their 10+'s rescues, and a Judge's Bundle of Sticks pick. */
export const STRUGGLE_ROLL_FLAG = "struggleRoll";
/** On a character: their player asking the GM to call a Struggle as One. */
export const STRUGGLE_ASK_FLAG = "struggleAsk";
/** On each roll's chat message: `{id, row}`, so the GM can share exactly this struggle's rolls. */
export const STRUGGLE_MESSAGE_FLAG = "struggleRoll";

export const STRUGGLE_STATUS = Object.freeze({
	/** Called: everyone rolls, and each result goes only to its player and the GM. */
	ROLLING:   "rolling",
	/** The GM has shared the results: spots, rescues. */
	REVEALED:  "revealed",
	/** Ended: XP marked for anyone left in a spot, and the summary posted. */
	CLOSED:    "closed",
	/** Called off. Nothing further happens. */
	CANCELLED: "cancelled",
});

export const TIER = Object.freeze({ SUCCESS: "success", PARTIAL: "partial", FAILURE: "failure" });

/** How several people in a spot are put there (p.329). */
export const SPOTS = Object.freeze({
	/** Different spots, at once or one after another: each 10+ gets one of them out. */
	APART:    "apart",
	/** Put in the same spot, or close enough: one 10+ may get them all out. */
	TOGETHER: "together",
});

export const ROW_KIND = Object.freeze({ PC: "pc", FOLLOWER: "follower" });

export { STAT_KEYS };
export const STAT_LABELS = Object.freeze({ str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" });
export const ROLL_MODES = Object.freeze(["normal", "adv", "dis"]);

/**
 * The playbook moves that name Struggle as One, and the two the book leaves to the table.
 *
 * Stone Cold and Home on the Range turn a 6- into a 7-9, each only when the fiction fits ("by
 * keeping calm and carrying on"; "when a journey requires you to"), so the GM confirms it. The
 * Tower Eternal says only "When you Defy Danger against magic", but Struggle as One's own trigger
 * is "When you Defy Danger as a group", so it is offered on the same terms: the GM ticks it when the
 * danger is magic.
 *
 * Many Hands Make Light Work is NOT offered to anybody in the struggle. It is not the Aid move, but
 * it is help given to someone who has just rolled, and the book's reason for barring Aid inside a
 * struggle ("they're already involved!", p.328) is just as true of it. A Judge OUTSIDE the struggle
 * can still jump in, and the GM applies the +1. A Bundle of Sticks Unbroken, which requires Many
 * Hands, is the Judge's own way to help inside one.
 */
export const MOVE = Object.freeze({
	STONE_COLD:        "Stone Cold",
	HOME_ON_THE_RANGE: "Home on the Range",
	TOWER_ETERNAL:     "The Tower Eternal",
	BUNDLE_OF_STICKS:  "A Bundle of Sticks Unbroken",
	TRAILBLAZER:       "Trailblazer",
	MANY_HANDS:        "Many Hands Make Light Work",
});

/** The moves a GM confirms per row because they turn on how that character goes about it. */
export const GM_TICKED_HALF_MISSES = Object.freeze([MOVE.STONE_COLD, MOVE.TOWER_ETERNAL]);

/** Every move this feature reads off a character, for one pass over their items. */
export const STRUGGLE_MOVES = Object.freeze(Object.values(MOVE));

const STATUSES = new Set(Object.values(STRUGGLE_STATUS));

function text(value, max = 2000) {
	return String(value ?? "").trim().slice(0, max);
}

function list(value) {
	return Array.isArray(value) ? value : [];
}

function whole(value, min = 0, max = Infinity) {
	const n = Math.trunc(Number(value));
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

/** The tier a 2d6 total lands on. */
export function tierOf(total) {
	const n = Number(total);
	if (n >= 10) return TIER.SUCCESS;
	if (n >= 7) return TIER.PARTIAL;
	return TIER.FAILURE;
}

/**
 * A row's key. Written as a key inside a flag object, so it may hold no dot: Foundry expands a
 * dotted key into nested objects on write, and the row would come back filed under a path nobody
 * reads.
 */
export function rowKeyFor({ kind, actorId, ftype = "", slug = "" }) {
	const safe = s => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
	return kind === ROW_KIND.FOLLOWER
		? `fo_${safe(actorId)}_${safe(ftype)}_${safe(slug)}`
		: `pc_${safe(actorId)}`;
}

function readAid(raw) {
	const by = text(raw?.by, 120);
	return by ? { by, advantage: !!raw?.advantage } : null;
}

/** One participant, as the GM set them up. */
export function readRow(raw) {
	if (!raw || typeof raw !== "object") return null;
	const kind = raw.kind === ROW_KIND.FOLLOWER ? ROW_KIND.FOLLOWER : ROW_KIND.PC;
	const actorId = text(raw.actorId, 64);
	if (!actorId) return null;
	const row = {
		kind,
		actorId,
		ftype:      kind === ROW_KIND.FOLLOWER ? text(raw.ftype, 64) : "",
		slug:       kind === ROW_KIND.FOLLOWER ? text(raw.slug, 128) : "",
		name:       text(raw.name, 200),
		img:        text(raw.img, 1000),
		// Empty = the player's choice of any stat. Otherwise the GM's list: "Blodwen, you'll be rolling
		// WIS. Everyone else, I think either STR or CON, your choice" (p.330).
		stats:      [...new Set(list(raw.stats).map(s => String(s).toLowerCase()).filter(s => STAT_KEYS.includes(s)))],
		mode:       ROLL_MODES.includes(raw.mode) ? raw.mode : "normal",
		// A follower rolls +0, +1 or +2 instead of +STAT (Order Followers, p.462).
		bonus:      kind === ROW_KIND.FOLLOWER ? whole(raw.bonus, 0, 2) : 0,
		isGroup:    kind === ROW_KIND.FOLLOWER && !!raw.isGroup,
		// The moves on this row that count a 6- as a 7-9 this time, by name, already confirmed.
		halfMisses: [...new Set(list(raw.halfMisses).map(m => text(m, 80)).filter(Boolean))],
		// The struggle moves this character knew when it was called: Bundle of Sticks, Trailblazer.
		owns:       [...new Set(list(raw.owns).map(m => text(m, 80)).filter(Boolean))],
		aid:        readAid(raw.aid),
		// Many Hands Make Light Work, from a Judge outside the struggle: +1 to the roll, after it.
		bump:       whole(raw.bump, 0, 1),
		bumpBy:     text(raw.bumpBy, 120),
	};
	row.key = rowKeyFor(row);
	return row;
}

/** The struggle on the GM Toolkit, or null when there is none worth reading. */
export function readStruggle(raw) {
	if (!raw || typeof raw !== "object") return null;
	const id = text(raw.id, 64);
	if (!id || !STATUSES.has(raw.status)) return null;
	const seen = new Set();
	const rows = [];
	for (const entry of list(raw.rows)) {
		const row = readRow(entry);
		if (!row || seen.has(row.key)) continue;
		seen.add(row.key);
		rows.push(row);
	}
	return {
		id,
		status:     raw.status,
		danger:     text(raw.danger),
		approach:   text(raw.approach),
		// "A journey requires you to" (Home on the Range) and "a journey causes you to" (Trailblazer).
		journey:    !!raw.journey,
		spots:      raw.spots === SPOTS.TOGETHER ? SPOTS.TOGETHER : SPOTS.APART,
		// Judges outside the struggle, who can jump in with Many Hands Make Light Work.
		helpers:    [...new Set(list(raw.helpers).map(h => text(h, 120)).filter(Boolean))],
		askedBy:    text(raw.askedBy, 64),
		startedAt:  whole(raw.startedAt),
		closedAt:   whole(raw.closedAt),
		xpMarked:   list(raw.xpMarked).map(k => text(k, 200)).filter(Boolean),
		rows,
	};
}

function readRoll(raw) {
	if (!raw || typeof raw !== "object") return null;
	const total = Number(raw.total);
	if (!Number.isFinite(total)) return null;
	return {
		stat:      STAT_KEYS.includes(raw.stat) ? raw.stat : "",
		total:     Math.trunc(total),
		dice:      text(raw.dice, 60),
		mode:      ROLL_MODES.includes(raw.mode) ? raw.mode : "normal",
		messageId: text(raw.messageId, 64),
		at:        whole(raw.at),
	};
}

/**
 * A character's part of a struggle: their rows' dice, the people their 10+ rows have got out, and a
 * Judge's Bundle of Sticks pick. An empty record for any other struggle, so a character's leftovers
 * from the last one never count toward this one.
 */
export function readStruggleRoll(raw, struggleId) {
	const empty = { id: struggleId ?? "", rolls: {}, saves: {}, bundleAlly: "" };
	if (!raw || typeof raw !== "object" || !struggleId || raw.id !== struggleId) return empty;
	const rolls = {};
	for (const [key, value] of Object.entries(raw.rolls ?? {})) {
		const roll = readRoll(value);
		if (roll) rolls[key] = roll;
	}
	const saves = {};
	for (const [key, value] of Object.entries(raw.saves ?? {})) {
		const targets = [...new Set(list(value).map(t => text(t, 200)).filter(Boolean))];
		if (targets.length) saves[key] = targets;
	}
	return { id: struggleId, rolls, saves, bundleAlly: text(raw.bundleAlly, 200) };
}

/** Whether a struggle is still being played: called, or shared and not yet ended. */
export function isLive(struggle) {
	return struggle?.status === STRUGGLE_STATUS.ROLLING || struggle?.status === STRUGGLE_STATUS.REVEALED;
}

/** The stats a row may roll: the GM's list, or all six. */
export function allowedStats(row) {
	return row?.stats?.length ? row.stats : [...STAT_KEYS];
}

/**
 * The Judges' Bundle of Sticks picks in this struggle: "you and one ally of your choice have
 * advantage". Only a Judge rolling in it who knows the move counts, and only an ally who is also in
 * it. Keyed by the ally's row, naming the Judge.
 */
export function bundleAllies(struggle, recordFor) {
	const allies = new Map();
	for (const row of struggle?.rows ?? []) {
		if (row.kind !== ROW_KIND.PC || !row.owns.includes(MOVE.BUNDLE_OF_STICKS)) continue;
		const ally = recordFor(row.actorId)?.bundleAlly;
		if (ally && ally !== row.key && struggle.rows.some(r => r.key === ally)) allies.set(ally, row.name);
	}
	return allies;
}

/**
 * How a row rolls, and why. Advantage and disadvantage CANCEL, and neither stacks (p.230), so
 * this is a pair of lists and a verdict, not a tally.
 *
 * @returns {{mode: "normal"|"adv"|"dis", adv: string[], dis: string[]}}  the sources, for the card's pills
 */
export function rowRollMode(row, { bundledBy = null } = {}) {
	const adv = [];
	const dis = [];
	if (row.mode === "adv") adv.push("The GM");
	if (row.mode === "dis") dis.push("The GM");
	if (row.aid?.advantage) adv.push(`Aid from ${row.aid.by}`);
	if (row.kind === ROW_KIND.PC && row.owns.includes(MOVE.BUNDLE_OF_STICKS)) adv.push(MOVE.BUNDLE_OF_STICKS);
	else if (bundledBy) adv.push(`${MOVE.BUNDLE_OF_STICKS} (${bundledBy})`);
	return { mode: foldModes([adv.length ? "adv" : "", dis.length ? "dis" : ""], "normal"), adv, dis };
}

/**
 * The moves that turn this row's 6- into a 7-9 right now: whatever the GM ticked when calling it,
 * plus Home on the Range on a journey. The FIRST names the card.
 */
export function halfMissesFor(row, struggle) {
	const names = [...(row?.halfMisses ?? [])];
	if (struggle?.journey && row?.owns?.includes(MOVE.HOME_ON_THE_RANGE) && !names.includes(MOVE.HOME_ON_THE_RANGE)) {
		names.push(MOVE.HOME_ON_THE_RANGE);
	}
	return names;
}

/**
 * A row's result, from its dice. `liveTotal` is the total on the roll's chat message when this
 * client can read it: a GM's Shift Up or Shift Down rewrites that roll, and the struggle follows.
 * Many Hands' +1 lands on top, and a 6- a move counts as a 7-9 is read last, the way the card reads it.
 */
export function rowResult(row, roll, struggle, { liveTotal = null } = {}) {
	if (!roll) return { rolled: false, total: null, tier: null, halfMiss: "" };
	const base = Number.isFinite(Number(liveTotal)) && liveTotal !== null ? Math.trunc(Number(liveTotal)) : roll.total;
	const total = base + (row.bump || 0);
	const rolled = tierOf(total);
	const half = rolled === TIER.FAILURE ? (halfMissesFor(row, struggle)[0] ?? "") : "";
	return { rolled: true, total, tier: half ? TIER.PARTIAL : rolled, halfMiss: half, rolledTier: rolled };
}

/**
 * The whole struggle worked out: every row with its result, who is in a spot, who got whom out, who
 * is still waiting to roll, and who marks XP if it ended now.
 *
 * RESCUES are read off the rescuer's record and only COUNT when they still make sense: the rescuer
 * rolled a 10+, the one rescued is in a spot, and nobody rescues themselves. That way a GM's Shift
 * Down on a rescuer's roll, or a shift that lifts somebody out of their spot, needs no clean-up
 * write: the save just stops counting. With the party in separate spots (SPOTS.APART) a 10+ gets one
 * person out, the first one it named; in one shared spot it can get everybody out.
 *
 * @param {object}   struggle   readStruggle's answer
 * @param {function} recordFor  actorId => readStruggleRoll's answer for that character
 * @param {object}   [opts]
 * @param {Record<string, number>} [opts.liveTotals]  rowKey => the total on its chat message now
 */
export function struggleBoard(struggle, recordFor, { liveTotals = {} } = {}) {
	const bundled = bundleAllies(struggle, recordFor);
	const rows = (struggle?.rows ?? []).map(row => {
		const record = recordFor(row.actorId);
		const roll = record?.rolls?.[row.key] ?? null;
		const result = rowResult(row, roll, struggle, { liveTotal: liveTotals[row.key] ?? null });
		return {
			...row,
			roll,
			...result,
			rollMode: rowRollMode(row, { bundledBy: bundled.get(row.key) ?? null }),
			bundledBy: bundled.get(row.key) ?? "",
			bundleAlly: row.owns.includes(MOVE.BUNDLE_OF_STICKS) ? (record?.bundleAlly ?? "") : "",
			claimed: record?.saves?.[row.key] ?? [],
		};
	});
	const byKey = new Map(rows.map(r => [r.key, r]));
	const inSpot = rows.filter(r => r.tier === TIER.FAILURE);
	const inSpotKeys = new Set(inSpot.map(r => r.key));
	const savedBy = new Map();
	const saves = new Map();
	for (const rescuer of rows) {
		if (rescuer.tier !== TIER.SUCCESS) continue;
		const claimed = rescuer.claimed.filter(key => key !== rescuer.key && inSpotKeys.has(key));
		const counted = struggle?.spots === SPOTS.TOGETHER ? claimed : claimed.slice(0, 1);
		if (counted.length) saves.set(rescuer.key, counted);
		for (const key of counted) {
			if (!savedBy.has(key)) savedBy.set(key, []);
			savedBy.get(key).push(rescuer.key);
		}
	}
	for (const row of rows) {
		row.savedBy = savedBy.get(row.key) ?? [];
		row.saves = saves.get(row.key) ?? [];
		row.inSpot = row.tier === TIER.FAILURE;
		row.stillInSpot = row.inSpot && row.savedBy.length === 0;
	}
	const waiting = rows.filter(r => !r.rolled);
	const everyone = rows.length > 0;
	return {
		rows,
		byKey,
		waiting,
		allRolled: everyone && waiting.length === 0,
		inSpot,
		stillInSpot: rows.filter(r => r.stillInSpot),
		// A 10+ with nobody got out yet, while somebody is still in a spot.
		freeRescuers: rows.filter(r => r.tier === TIER.SUCCESS && r.saves.length === 0),
		// "... they Struggle as One (page 328), and everyone gets a 7+" is one of Keep Company's cues (p.332).
		everyoneSevenPlus: everyone && waiting.length === 0 && rows.every(r => r.tier !== TIER.FAILURE),
		xpOwed: xpOwed(rows),
	};
}

/**
 * Who marks XP when the struggle ends: every 6- nobody got out. A follower's miss is marked by the
 * character who rolled for them, as Order Followers' own rolls are. Only rows that have rolled.
 */
export function xpOwed(rows) {
	return rows
		.filter(r => r.rolled && r.tier === TIER.FAILURE && !(r.savedBy?.length))
		.map(r => ({ actorId: r.actorId, key: r.key, name: r.name }));
}

/**
 * Which rows a 10+ may still name as the one it gets out: everyone else in a spot, less anyone a
 * 10+ has already got out when the party is in separate spots (there, "each 10+ will save only one of
 * them", and one saved person does not need two).
 */
export function rescueTargets(board, rescuerKey, spots) {
	return board.rows.filter(r => r.inSpot && r.key !== rescuerKey
		&& (spots === SPOTS.TOGETHER || !r.savedBy.some(k => k !== rescuerKey)));
}

/**
 * Whether ending the struggle now leaves anything undecided that the GM should hear about first:
 * rows that never rolled, and 10+ rolls nobody used while somebody is still in a spot.
 */
export function endWarnings(board) {
	return {
		unrolled: board.waiting,
		unusedRescues: board.stillInSpot.length ? board.freeRescuers : [],
	};
}

/**
 * Tidy a GM's setup into the record the toolkit keeps. Throws nothing: an unusable row is dropped,
 * and a struggle with nobody in it comes back with no rows for the caller to refuse.
 */
export function newStruggleRecord({ id, danger = "", approach = "", journey = false, rows = [], helpers = [], askedBy = "", now = 0 }) {
	return readStruggle({
		id,
		status: STRUGGLE_STATUS.ROLLING,
		danger,
		approach,
		journey,
		spots: SPOTS.APART,
		helpers,
		askedBy,
		startedAt: now,
		closedAt: 0,
		xpMarked: [],
		rows,
	});
}

/** Whether a Judge's Bundle of Sticks pick can still change: before the ally has rolled, and before the reveal. */
export function canPickBundleAlly(board, judgeRow, struggle) {
	if (struggle?.status !== STRUGGLE_STATUS.ROLLING) return false;
	const current = judgeRow.bundleAlly ? board.byKey.get(judgeRow.bundleAlly) : null;
	return !current?.rolled;
}

/** The allies a Judge may pick for Bundle of Sticks: anyone else in the struggle who has not rolled yet. */
export function bundleChoices(board, judgeRow) {
	return board.rows.filter(r => r.key !== judgeRow.key && !r.rolled);
}
