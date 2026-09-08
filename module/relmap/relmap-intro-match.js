// Matching introduction answers to the people they are about, after the fact.
//
// WHAT IT IS FOR. The answer/ask step asks "Who is this about?" and stores the pick, so a board
// drawn from answers recorded from now on knows exactly where to point. Every table that ran its
// session zero before that existed has a pile of answers with no such pick, read only by the names
// in the writing -- and an answer that says "I asked her outright and she only laughed" names
// nobody at all. Asked for as: a popup that can "help you quickly figure out which answer belongs
// to which person in the case they ran introductions before we made this fix".
//
// ⚠ THE GUESS IS OFFERED, NEVER APPLIED BEHIND ANYONE. Every row arrives with the name-match
// already chosen where there is one, so the common case is read it and press Save; but nothing is
// written until somebody presses, and what is written is what is on screen. A guess quietly
// promoted to a recorded fact is the one thing this must not do: `who` outranks the writing
// afterwards (relmap-intros.js), so a wrong one is not something a later reader can spot.
//
// ⚠ IT READS THROUGH THE CHRONICLE'S OWN READER, `introQaPairs`, exactly as the board does. What
// counts as an answer is four rules at once, and the slot each answer is stored in comes back with
// it (`at`), so this can write to the same record the Chronicle compiled from. A second walk of the
// blob is how a matcher comes to offer a row nothing draws, or to write `who` where nothing reads.

import { INTRO_ANSWER_SLOTS, introQaPairs } from "../utils/chronicle-core.js";
import { INTRO_STEPS, introAnswerKey, namedIn } from "./relmap-intros.js";

/**
 * The legacy single-answer rounds, which are stored as one record rather than in a list.
 *
 * READ OFF THE CHRONICLE'S OWN SLOT TABLE rather than spelled again here, so that a round added to
 * the introductions is one edit and not three. Which step each belongs to does not matter to this
 * file -- only that a slot named this way is written whole rather than by index.
 */
const LEGACY_SOURCES = Object.freeze(Object.values(INTRO_ANSWER_SLOTS).flat());

const isLegacy = source => LEGACY_SOURCES.includes(source);

/**
 * Is there anything here to match at all?
 *
 * Cheap ON PURPOSE, and that is why it does not go through the reader: it decides whether the
 * button appears, so it runs on every repaint of the board, where the full read (a name scan of
 * every answer against every player character) would not be welcome. It only has to know whether
 * anybody wrote anything.
 */
export function hasIntroAnswers(pcs = [], answers = {}) {
	return (pcs ?? []).some(pc => {
		const rec = answers?.[pc?.id];
		if (!rec) return false;
		// Both halves of the record, off the one table that describes it: each step's own list, and
		// the legacy rounds behind it. Cheap, but not a second opinion about where an answer lives.
		const said = [
			...INTRO_STEPS.flatMap(step => rec[step]?.answers ?? []),
			...LEGACY_SOURCES.map(source => rec[source]),
		];
		return said.some(entry => String(entry?.a ?? "").trim());
	});
}

/**
 * Every introduction answer the party recorded, as a row somebody can point at a person.
 *
 * ONE ROW PER ANSWER, in the order the Chronicle reads them: each writer in turn, their bonds
 * before what they asked of the others. Answers about people outside the party are here too, and
 * that is deliberate -- "my sister Maeve" is the commonest answer of all, and a list that hid
 * everything it could not guess at would leave the reader wondering what it had decided for them.
 *
 * @param {Array<{id, uuid, name, slug}>} pcs  the party, as the Chronicle describes them.
 * @param {object} answers  the `introductionsAnswers` blob, keyed by actor id.
 * @returns {Array<object>} rows: `{key, writerId, writerName, step, at, prompt, answer, who,
 *   guess, target}` -- `who` is what is recorded, `guess` what the writing suggests, and `target`
 *   what a control should start on.
 */
export function introAnswerRows(pcs = [], answers = {}) {
	const party = (pcs ?? []).filter(pc => pc?.id);
	const rows = [];

	for (const pc of party) {
		// ⚠ CANDIDATES KEYED BY ACTOR ID, not by uuid. `namedIn` hands back whatever it was given as
		// the identifier, and what is STORED on an answer is the actor id (the dialog has ids in its
		// hands, and `introductionsAnswers` is itself keyed by one). The board converts to uuids on
		// its own side; here the id is the currency.
		//
		// BUILT ONCE PER WRITER and not once per answer. `namedIn` holds the compiled name patterns
		// against the list it was handed (see `nameReaders`), so a fresh list per answer threw that
		// away and recompiled every name in the party for every sentence anybody wrote.
		const others = party
			.filter(other => other.id !== pc.id)
			.map(other => ({ uuid: other.id, name: other.name }));
		const said = introQaPairs(answers?.[pc.id], pc.slug);
		for (const step of INTRO_STEPS) {
			for (const pair of said[step] ?? []) {
				const guess = namedIn(pair.answer, others);
				const who = party.some(other => other.id === pair.who) && pair.who !== pc.id ? pair.who : "";
				rows.push({
					key: rowKey(pc.id, pair.at),
					writerId: pc.id,
					writerName: pc.name ?? "",
					step,
					at: pair.at,
					prompt: pair.prompt ?? "",
					answer: pair.answer ?? "",
					who,
					// The guess is only ever offered where nothing is recorded. A pick somebody made
					// is an answer, and re-guessing at it every time this window opens would put the
					// reader in the position of defending it.
					guess: who ? "" : (guess ?? ""),
					target: who || guess || "",
				});
			}
		}
	}
	return rows;
}

/**
 * The picks that have a counterpart on a player character's own answer flag, grouped by writer.
 *
 * ⚠ WHICH PICKS THOSE ARE IS THIS MODULE'S QUESTION, not the caller's, and it is two rules rather
 * than one. An answer has a flag counterpart when it came out of a step LIST -- the legacy
 * single-answer rounds were only ever GM-typed, straight into the world setting, and there is no
 * actor flag behind them. Both rules are already written down here (`INTRO_STEPS`, `isLegacy`), and
 * the window that does the writing was restating them as two literal comparisons: a third place to
 * edit when the introductions grow a round, and the one where a miss silently stops mirroring.
 *
 * PURE, like everything else in this file: it hands back a plan, and the caller does the I/O. The
 * mirroring itself is per-actor best effort and belongs where the documents are.
 *
 * @param {Array<{writerId, step, at, answer, who}>} picks
 * @returns {Map<string, Map<string, Array>>} writer id -> step -> that step's picks.
 */
export function picksByWriter(picks = []) {
	const byWriter = new Map();
	for (const pick of picks ?? []) {
		if (!INTRO_STEPS.includes(pick?.step)) continue;
		// A pick whose slot is a legacy round has no list to mirror into, whatever step it belongs to.
		if (isLegacy(pick.at?.source)) continue;
		if (pick.at?.source !== pick.step) continue;
		const mine = byWriter.get(pick.writerId) ?? new Map();
		mine.set(pick.step, [...(mine.get(pick.step) ?? []), pick]);
		byWriter.set(pick.writerId, mine);
	}
	return byWriter;
}

/**
 * One row's identity, stable across a re-read so a form can be posted back against it.
 *
 * ⚠ THE SAME KEY THE PARTY BOARD STAMPS ON A SEEDED LINE, which is why it is `introAnswerKey`
 * rather than a spelling of its own. Two answers to "which recorded answer is this" is how a line
 * the board drew comes to name a different answer from the one this window matched, and neither
 * side would say so.
 */
export const rowKey = introAnswerKey;

/**
 * The answers blob with these picks applied, and how many records actually changed.
 *
 * ⚠ A NEW BLOB, never the one it was handed. This is a world setting the Chronicle compiles from
 * and the map reads; mutating it in place would leave a half-applied write behind if the setting
 * write failed, with nothing on screen having said so.
 *
 * ⚠ A CLEARED PICK REMOVES THE KEY rather than storing an empty one, so an answer nobody has
 * matched looks exactly like an answer recorded before matching existed. That is what keeps the
 * readers from having to know which of the two they are looking at.
 *
 * @param {object} answers  the `introductionsAnswers` blob.
 * @param {Array<{writerId, at, who}>} picks
 * @returns {{answers: object, changed: number}}
 */
export function applyIntroPicks(answers = {}, picks = []) {
	const next = { ...(answers ?? {}) };
	let changed = 0;

	for (const pick of picks ?? []) {
		const rec = next[pick?.writerId];
		const source = pick?.at?.source;
		if (!rec || !source) continue;
		const who = String(pick.who ?? "").trim();

		if (isLegacy(source)) {
			const entry = rec[source];
			if (!entry || typeof entry !== "object") continue;
			const after = withWho(entry, who);
			if (!after) continue;
			next[pick.writerId] = { ...rec, [source]: after };
			changed += 1;
			continue;
		}

		const list = rec[source]?.answers;
		if (!Array.isArray(list) || !Number.isInteger(pick.at.index)) continue;
		const entry = list[pick.at.index];
		const after = entry && typeof entry === "object" ? withWho(entry, who) : null;
		if (!after) continue;
		const nextList = [...list];
		nextList[pick.at.index] = after;
		next[pick.writerId] = { ...rec, [source]: { ...rec[source], answers: nextList } };
		changed += 1;
	}

	return { answers: next, changed };
}

/** One answer record wearing this pick, or null when it already wears it. */
function withWho(entry, who) {
	const had = typeof entry.who === "string" ? entry.who : "";
	if (had === who) return null;
	if (!who) {
		const { who: _dropped, ...rest } = entry;
		return rest;
	}
	return { ...entry, who };
}

/**
 * The same picks applied to a player character's OWN flag list, which is where the answers live
 * before the GM harvests them.
 *
 * ⚠ WHY BOTH COPIES GET WRITTEN. `introductionsAnswers` is a harvested MIRROR of each PC's
 * `flags.stonetop-pwd.intro`: the primary GM's harvest overwrites the setting from the flag
 * whenever the two differ (IntroductionsDialog `_mergeActorIntoDraft`). Matching only the setting
 * would therefore hold until the next time anybody opened the introductions, and then be silently
 * undone -- the worst shape a bug can have, because the work looked like it landed.
 *
 * ⚠ MATCHED ON THE WRITING, not on the index. The two lists are copies of each other and their
 * indexes do line up, but a blob somebody has edited by hand is exactly the kind of world this
 * tool is for, and pointing at the wrong answer would put a pick on somebody else's sentence. A
 * prose match that finds two identical answers refuses rather than guessing between them.
 *
 * @param {Array<{q, a, who}>} list  the actor's own answers for one step.
 * @param {Array<{answer, who}>} picks  what to set, by what the answer says.
 * @returns {{list: Array, changed: number}}  the same list back when nothing matched.
 */
export function applyPicksToFlagList(list = [], picks = []) {
	if (!Array.isArray(list) || !list.length) return { list, changed: 0 };
	let next = list;
	let changed = 0;

	for (const pick of picks ?? []) {
		const said = String(pick?.answer ?? "").trim();
		if (!said) continue;
		const found = next.reduce(
			(acc, entry, index) => (String(entry?.a ?? "").trim() === said ? [...acc, index] : acc),
			[],
		);
		if (found.length !== 1) continue;
		const after = withWho(next[found[0]], String(pick.who ?? "").trim());
		if (!after) continue;
		next = [...next];
		next[found[0]] = after;
		changed += 1;
	}

	return { list: next, changed };
}
