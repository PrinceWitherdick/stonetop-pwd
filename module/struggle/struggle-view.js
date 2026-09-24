import { escHtml, joinNames } from "../utils/strings.js";
import {
	MOVE, ROW_KIND, SPOTS, STAT_LABELS, STRUGGLE_STATUS, TIER, allowedStats, bundleChoices, canPickBundleAlly, endWarnings,
	halfMissesFor, rescueTargets, tierOf,
} from "./struggle-rules.js";

/**
 * WHAT A STRUGGLE SAYS: the shared window's rows for whoever is reading it, and the cards it posts.
 * Pure, like struggle-rules.js, so every sentence can be tested without Foundry.
 *
 * WHO SEES WHAT. Until the GM shares them, a roll is between its player and the GM (p.329: "Encourage
 * them to keep their results quiet for the moment"): the GM reads every result, a player reads the
 * rows they roll for, and everyone else's row says only whether they have rolled yet.
 *
 * Sentences name characters and never give them pronouns.
 */

/** What each result means in this move, in the book's words (Book I p.78). */
export const TIER_TEXT = Object.freeze({
	[TIER.SUCCESS]: "does well enough to get someone else out of a spot",
	[TIER.PARTIAL]: "pulls their weight",
	[TIER.FAILURE]: "in a spot",
});

const TIER_BAND = Object.freeze({ [TIER.SUCCESS]: "10+", [TIER.PARTIAL]: "7-9", [TIER.FAILURE]: "6-" });

function signed(n) {
	const v = Math.trunc(Number(n) || 0);
	return v < 0 ? `−${Math.abs(v)}` : `+${v}`;
}

function statLabel(key) {
	return STAT_LABELS[key] ?? String(key ?? "").toUpperCase();
}

function plural(n, one, many) {
	return n === 1 ? one : many;
}

/** "+WIS", "+STR or +CON", "any stat". */
export function statsText(row) {
	if (row.kind === ROW_KIND.FOLLOWER) return signed(row.bonus);
	if (!row.stats.length) return "any stat";
	return row.stats.map(s => `+${statLabel(s)}`).join(" or ");
}

/** The pill under a row's name that says how it rolls: "Advantage (Aid from Blodwen)". */
export function modeText(rollMode) {
	if (rollMode.mode === "normal") {
		// Both sides present and cancelled: said, or a player told "advantage" by the GM wonders where it went.
		return rollMode.adv.length && rollMode.dis.length
			? `Advantage and disadvantage cancel (${joinNames([...rollMode.adv, ...rollMode.dis])})`
			: "";
	}
	const sources = rollMode.mode === "adv" ? rollMode.adv : rollMode.dis;
	const word = rollMode.mode === "adv" ? "Advantage" : "Disadvantage";
	const named = sources.filter(s => s !== "The GM");
	return named.length ? `${word} (${joinNames(named)})` : word;
}

/** A result, as the row states it: "8: pulls their weight". */
export function resultText(row) {
	if (!row.rolled) return "";
	return `${row.total}: ${TIER_TEXT[row.tier]}`;
}

/** Whether this reader may see a row's dice yet. */
export function canSeeResult(row, struggle, reader) {
	if (!row.rolled) return false;
	if (struggle.status !== STRUGGLE_STATUS.ROLLING) return true;
	return !!reader.isGM || reader.drives.has(row.key) || reader.mine.has(row.key);
}

function nameOf(board, key) {
	return board.byKey.get(key)?.name ?? "someone";
}

/** The book's two ways of putting several people in a spot (p.329), as the GM chooses between them. */
export const SPOTS_TEXT = Object.freeze({
	[SPOTS.APART]:    "Separate spots: each 10+ gets one of them out",
	[SPOTS.TOGETHER]: "The same spot: one 10+ can get them all out",
});

/**
 * Whether the Many Hands +1 would change anything on this row. A Judge jumps in to help "another
 * character who just rolled", and a +1 that leaves the result where it was is not worth the price.
 */
export function bumpMatters(row, struggle) {
	if (!row.rolled || row.bump) return false;
	const next = tierOf(row.total + 1);
	// Read the way the row's own result is: a 6- a move counts as a 7-9 is a 7-9 before and after.
	const after = next === TIER.FAILURE && halfMissesFor(row, struggle).length ? TIER.PARTIAL : next;
	return after !== row.tier;
}

/**
 * One row of the window, for one reader.
 *
 * @param {object} row       a board row
 * @param {object} ctx
 * @param {object} ctx.struggle
 * @param {object} ctx.board
 * @param {object} ctx.reader     {isGM, drives: Set<rowKey>, mine: Set<rowKey>}
 * @param {object} [ctx.statValues]   rowKey => {str: 2, ...}, for the rows this reader drives
 * @param {object} [ctx.approaches]   stat => Defy Danger's printed clause for it
 * @param {object} [ctx.rollerNames]  actorId => the character a follower's roll is made through
 */
export function struggleRowView(row, { struggle, board, reader, statValues = {}, approaches = {}, rollerNames = {} }) {
	const status = struggle.status;
	const drives = reader.drives.has(row.key);
	const visible = canSeeResult(row, struggle, reader);
	const lines = [];
	const notes = [];

	if (row.kind === ROW_KIND.FOLLOWER) {
		lines.push(row.isGroup
			? `Rolls ${signed(row.bonus)} once for the whole group, through ${rollerNames[row.actorId] ?? "their leader"}.`
			: `Rolls ${signed(row.bonus)}, through ${rollerNames[row.actorId] ?? "their leader"}.`);
	} else {
		lines.push(row.stats.length === 1 ? `Rolls +${statLabel(row.stats[0])}.` : `Rolls ${statsText(row)}, their choice.`);
	}
	const mode = modeText(row.rollMode);
	if (row.aid) {
		notes.push(row.aid.advantage
			? `Aided by ${row.aid.by}.`
			: `Aided by ${row.aid.by}: can accomplish more than alone.`);
	}
	for (const name of halfMissesFor(row, struggle)) notes.push(`${name}: a 6- counts as a 7-9.`);
	if (row.bump) notes.push(`+1 from ${row.bumpBy || "a Judge"} (${MOVE.MANY_HANDS}).`);

	// State: the badge beside the name.
	let state;
	if (!row.rolled) state = { cls: "is-waiting", text: status === STRUGGLE_STATUS.ROLLING ? "Waiting to roll" : "Did not roll" };
	else if (!visible) state = { cls: "is-rolled", text: "Rolled" };
	else state = { cls: `is-${row.tier}`, text: TIER_BAND[row.tier] };

	const view = {
		key: row.key,
		actorId: row.actorId,
		name: row.name,
		img: row.img,
		isMine: reader.mine.has(row.key),
		canDrive: drives,
		stateClass: state.cls,
		stateText: state.text,
		lines,
		modeText: mode,
		notes,
		result: visible ? resultText(row) : "",
		halfMissText: visible && row.halfMiss ? `Rolled a 6-, counted as a 7-9 (${row.halfMiss}).` : "",
		dice: visible && row.roll?.dice ? `${row.roll.dice}${row.roll.stat ? ` +${statLabel(row.roll.stat)}` : ""}` : "",
		outcome: [],
		rollForm: null,
		bundle: null,
		rescue: null,
		gm: null,
	};

	// ROLLING: the driver's controls.
	if (status === STRUGGLE_STATUS.ROLLING && drives && !row.rolled) {
		if (row.kind === ROW_KIND.FOLLOWER) {
			view.rollForm = { choices: null, label: `Roll ${signed(row.bonus)}` };
		} else {
			const values = statValues[row.key] ?? {};
			const stats = allowedStats(row);
			view.rollForm = {
				choices: stats.length > 1
					? stats.map((s, i) => ({
						value: s,
						label: `+${statLabel(s)} (${signed(values[s])})${approaches[s] ? `: ${approaches[s]}` : ""}`,
						selected: i === 0,
					}))
					: null,
				label: stats.length === 1 ? `Roll +${statLabel(stats[0])} (${signed(values[stats[0]])})` : "Roll",
				stat: stats.length === 1 ? stats[0] : "",
			};
		}
	}

	// A Judge with A Bundle of Sticks Unbroken picks the ally who rolls with advantage beside them.
	if (row.kind === ROW_KIND.PC && row.owns.includes(MOVE.BUNDLE_OF_STICKS) && status === STRUGGLE_STATUS.ROLLING) {
		const current = row.bundleAlly ? board.byKey.get(row.bundleAlly) : null;
		if (drives && canPickBundleAlly(board, row, struggle)) {
			const choices = bundleChoices(board, row);
			view.bundle = {
				editable: true,
				options: [
					{ value: "", label: "Nobody yet", selected: !current },
					...choices.map(r => ({ value: r.key, label: r.name, selected: r.key === current?.key })),
				],
			};
		} else if (current) {
			view.bundle = { editable: false, text: `${MOVE.BUNDLE_OF_STICKS}: ${current.name} has advantage too.` };
		}
	}

	// SHARED: spots and rescues.
	if (status !== STRUGGLE_STATUS.ROLLING && row.rolled) {
		if (row.inSpot) {
			view.outcome.push(row.savedBy.length
				? `Got out by ${joinNames(row.savedBy.map(k => nameOf(board, k)))}. No XP for this 6-.`
				: (status === STRUGGLE_STATUS.CLOSED ? "Left in the spot: marked XP." : "In a spot. The GM describes it, or asks what it looks like."));
			if (row.isGroup && row.stillInSpot) view.outcome.push("GM: say which of them are in the spot.");
			if (row.aid && row.stillInSpot) view.outcome.push(`${row.aid.by} gave Aid, so is in the spot too, or instead.`);
		}
		if (row.tier === TIER.SUCCESS) {
			if (row.saves.length) {
				view.outcome.push(`Got ${joinNames(row.saves.map(k => nameOf(board, k)))} out of the spot.`);
			} else if (row.isGroup) {
				view.outcome.push("Their player says which of them steps up.");
			}
			if (struggle.journey && row.owns.includes(MOVE.TRAILBLAZER)) {
				view.outcome.push(`${MOVE.TRAILBLAZER}: also learns or discovers something interesting and useful. GM, say what.`);
			}
		}
	}

	// The 10+ rescuer's own controls, while the struggle is shared and not yet ended.
	if (status === STRUGGLE_STATUS.REVEALED && row.tier === TIER.SUCCESS && (drives || reader.isGM)) {
		const targets = rescueTargets(board, row.key, struggle.spots);
		if (row.claimed.length) {
			view.rescue = { canUndo: true, undoLabel: reader.isGM && !drives ? "That doesn't get them out" : "Take it back" };
		} else if (drives && targets.length) {
			view.rescue = struggle.spots === SPOTS.TOGETHER
				? { all: true, label: "Get them out", allKeys: targets.map(t => t.key).join(" ") }
				: {
					all: false,
					label: "Get them out",
					options: targets.map((t, i) => ({ value: t.key, label: t.name, selected: i === 0 })),
				};
			view.rescue.hint = "Say how, if you can. If it doesn't hold up, the GM will say so.";
		}
	}

	// The GM's per-row tools.
	if (reader.isGM && (status === STRUGGLE_STATUS.ROLLING || status === STRUGGLE_STATUS.REVEALED)) {
		const gm = {};
		if (!row.rolled && status === STRUGGLE_STATUS.ROLLING) gm.leaveOut = true;
		if (struggle.helpers.length && bumpMatters(row, struggle)) {
			gm.bump = { label: `+1 from ${struggle.helpers[0]} (${MOVE.MANY_HANDS})`, by: struggle.helpers[0] };
		}
		if (Object.keys(gm).length) view.gm = gm;
	}
	return view;
}

/** The line under the banner, for this reader. */
export function statusText(struggle, board, reader) {
	switch (struggle.status) {
		case STRUGGLE_STATUS.ROLLING: {
			if (reader.isGM) {
				return board.allRolled
					? "Everyone has rolled. Share the results when you're ready to describe the spots."
					: `Everyone rolls at once. Waiting on ${joinNames(board.waiting.map(r => r.name))}.`;
			}
			const mineToRoll = board.rows.some(r => reader.drives.has(r.key) && !r.rolled);
			return mineToRoll
				? "Everyone rolls at once. Your result goes to you and the GM; the GM shares everyone's when all have rolled."
				: "Your result is with the GM. Keep it quiet for now: the GM shares everyone's when all have rolled.";
		}
		case STRUGGLE_STATUS.REVEALED:
			if (board.stillInSpot.length && board.freeRescuers.length) {
				return "Anyone in a spot, the GM describes it. Anyone on a 10+ can get somebody out, if they can say how.";
			}
			if (board.stillInSpot.length) return "Nobody is left with a 10+ to spend. The GM plays out the spots from here.";
			return "Nobody is left in a spot.";
		case STRUGGLE_STATUS.CLOSED:
			return "The struggle is over.";
		case STRUGGLE_STATUS.CANCELLED:
			return "The GM called this struggle off.";
		default:
			return "";
	}
}

/** What ending the struggle now will do, said before the GM presses it (and on the summary card after). */
export function endPreviewLines(board) {
	const lines = [];
	const owed = board.xpOwed;
	lines.push(owed.length
		? `${joinNames(owed.map(o => o.name))} ${plural(owed.length, "is", "are")} still in a spot, and ${plural(owed.length, "marks", "each mark")} XP.`
		: "Nobody marks XP.");
	const { unrolled, unusedRescues } = endWarnings(board);
	if (unrolled.length) lines.push(`${joinNames(unrolled.map(r => r.name))} never rolled.`);
	if (unusedRescues.length) {
		lines.push(`${joinNames(unusedRescues.map(r => r.name))} rolled a 10+ and ${plural(unusedRescues.length, "hasn't", "haven't")} got anyone out.`);
	}
	return lines;
}

/**
 * The whole window, for one reader.
 *
 * @param {object} struggle  readStruggle's answer
 * @param {object} board     struggleBoard's answer
 * @param {object} reader    {isGM, drives: Set<rowKey>, mine: Set<rowKey>}
 * @param {object} [extra]   statValues, approaches, rollerNames (see struggleRowView)
 */
export function struggleWindowView(struggle, board, reader, extra = {}) {
	const status = struggle.status;
	const rows = board.rows.map(row => struggleRowView(row, { struggle, board, reader, ...extra }));
	const gm = reader.isGM ? {
		canShare: status === STRUGGLE_STATUS.ROLLING && board.allRolled,
		canCancel: status === STRUGGLE_STATUS.ROLLING,
		canEnd: status === STRUGGLE_STATUS.REVEALED,
		spots: status === STRUGGLE_STATUS.REVEALED && board.inSpot.length >= 2
			? Object.values(SPOTS).map(value => ({ value, label: SPOTS_TEXT[value], checked: struggle.spots === value }))
			: null,
		endLines: status === STRUGGLE_STATUS.REVEALED ? endPreviewLines(board) : [],
	} : null;
	return {
		title: "Struggle as One",
		danger: struggle.danger,
		approach: struggle.approach,
		journey: struggle.journey,
		statusText: statusText(struggle, board, reader),
		keepCompany: status !== STRUGGLE_STATUS.ROLLING && board.everyoneSevenPlus
			? "Everyone got a 7+: a good moment to Keep Company."
			: "",
		rows,
		gm,
		hasGmTools: !!gm && !!(gm.canShare || gm.canCancel || gm.canEnd),
	};
}

// ── CARDS ──────────────────────────────────────────────────────────────────────────────────────

function cardLine(label, value) {
	return `<li><strong>${escHtml(label)}:</strong> ${escHtml(value)}</li>`;
}

/** The card a struggle posts when the GM calls it, so the log says what the rolls that follow are for. */
export function struggleCalledRows(struggle) {
	const rows = [];
	if (struggle.danger) rows.push(cardLine("The danger", struggle.danger));
	if (struggle.approach) rows.push(cardLine("The approach", struggle.approach));
	rows.push(cardLine("Rolling", joinNames(struggle.rows.map(r => r.name))));
	rows.push(`<li>Everyone rolls at once. Each result goes to its player and the GM until the GM shares them.</li>`);
	return rows.join("");
}

/** One row's line on the summary card. */
function summaryValue(row, board) {
	if (!row.rolled) return "did not roll";
	const how = row.kind === ROW_KIND.FOLLOWER ? signed(row.bonus) : (row.roll?.stat ? `+${statLabel(row.roll.stat)}` : "");
	const parts = [`${how ? `${how}, ` : ""}${row.total}: ${TIER_TEXT[row.tier]}`];
	if (row.halfMiss) parts.push(`a 6- counted as a 7-9 (${row.halfMiss})`);
	if (row.inSpot) {
		parts.push(row.savedBy.length ? `got out by ${joinNames(row.savedBy.map(k => nameOf(board, k)))}` : "marked XP");
	}
	if (row.saves.length) parts.push(`got ${joinNames(row.saves.map(k => nameOf(board, k)))} out`);
	return parts.join("; ");
}

/** The card a struggle posts when it ends: the danger, every roll, every rescue, and the XP. */
export function struggleSummaryRows(struggle, board) {
	const rows = [];
	if (struggle.danger) rows.push(cardLine("The danger", struggle.danger));
	for (const row of board.rows) rows.push(cardLine(row.name, summaryValue(row, board)));
	if (board.everyoneSevenPlus) rows.push(`<li>Everyone got a 7+: a good moment to Keep Company.</li>`);
	for (const row of board.rows) {
		if (row.tier === TIER.SUCCESS && struggle.journey && row.owns.includes(MOVE.TRAILBLAZER)) {
			rows.push(`<li>${escHtml(`${MOVE.TRAILBLAZER}: ${row.name} also learns or discovers something interesting and useful.`)}</li>`);
		}
	}
	return rows.join("");
}

/**
 * The GM's button onto the move, wherever a GM screen offers one (the toolkit's Expeditions tab, the
 * walkthrough's journey step). With nothing under way it calls one; while one is, it opens that one,
 * and says how far it has got, so a GM who closed the window can find it again.
 *
 * @param {object|null} struggle  the live struggle, or null
 * @param {object|null} board     its board, when there is one
 */
export function struggleCallView(struggle, board = null) {
	if (!struggle) {
		return {
			live: false,
			label: "Call for Struggle as One",
			hint: "When the whole party faces the same danger, everyone rolls at once, and a 10+ can get someone else out of a spot.",
		};
	}
	const rolled = board ? board.rows.length - board.waiting.length : 0;
	const total = board?.rows.length ?? struggle.rows.length;
	return {
		live: true,
		label: "Open the Struggle as One",
		hint: struggle.status === STRUGGLE_STATUS.ROLLING
			? `Under way: ${rolled} of ${total} ${plural(total, "has", "have")} rolled.`
			: "Under way: the results are shared.",
	};
}

/** The notice a player gets when the GM does not take up their ask. */
export function askDeclinedNotice(actorName) {
	return `The GM didn't call a Struggle as One${actorName ? ` for ${actorName}` : ""}.`;
}
