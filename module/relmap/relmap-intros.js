// What the party answered ABOUT EACH OTHER during the introductions, as lines a relationship map
// can draw.
//
// This is what the board called "The Party" is seeded from, and it is the one thing on this window
// that comes from somewhere other than the board itself. Asked for as: no information should be pulled onto the lines
// automatically "except for the character's only sheet that shows the introduction answers to each
// other". Its predecessor read the 1-5 hearts, which was the wrong record; these are the answers
// that go into the Chronicle.
//
// ⚠ NOTHING HERE WRITES ANYTHING. There was a button ("Pull in ratings") that copied its findings
// into the shared board, permanently, and it is gone: a table that pressed it during session zero
// ended up with a hundred lines nobody drew, on top of the handful they did. This is derived on the
// reader's own machine every time the board is painted, and stored nowhere. That is also what makes
// the guess below affordable: a wrong line costs nothing and is gone the moment the reader switches
// views, where a wrong line WRITTEN into somebody's map is theirs to find and rub out.
//
// ⚠ AN ANSWER SAYS WHO IT IS ABOUT ONLY WHEN THE WRITER SAID SO. The introductions now ask, beside
// the answer field: "Who is this about?", a pick from the table itself, stored as `who` on the
// record. When it is there it is the answer, because it is not a guess: somebody chose it.
//
// ⚠ AND MOST ANSWERS DO NOT HAVE ONE, which is why the guessing below stays. Every answer recorded
// before the picker existed has no `who` at all; so does every answer whose writer left it blank,
// and every "Bonds & ties" answer about somebody outside the party. For those, the only thing that
// can join two people is the NAME inside the writing. The step-6 questions are built to force it
// ("Which one of you has stayed my hand?"), and read against a real table's recorded answers they
// do: "I put it to Sela, who only nodded once", "asked Gwendyl outright". So the target is found by
// matching names, whole word, and an answer that names nobody on this board simply draws no line.

import { introQaPairs } from "../utils/chronicle-core.js";
import { wholeWordPattern } from "../utils/strings.js";
import { RELMAP_LABEL_MAX } from "./relmap-store.js";

/**
 * Which colour a line wears, by which step of the introductions it came out of.
 *
 * TWO INKS AND NOT THREE, because there are two questions being asked and they are different in
 * kind. Step 4 is "Bonds & ties" -- who matters to you, answered about anyone at all, so only some
 * of them land on another player character. Step 6 is "Asked of the others", whose questions all
 * begin "which one of you" and are therefore about this table by construction.
 *
 * ⚠ AND THE COLOUR IS NEVER THE ONLY THING THAT SAYS SO. Every line here carries the question it
 * came from as its caption, which is what a reader on a screen magnifier reads instead of the
 * stroke's hue (see the accessibility rules the ink tokens are held to). The ink is the fast way to
 * tell the two kinds apart at a glance, not the record of which they are.
 */
export const INTRO_STEP_INKS = Object.freeze({ step4: "green", step6: "indigo" });

/** The steps this reads, in the order the introductions run them. */
export const INTRO_STEPS = Object.freeze(["step4", "step6"]);

/**
 * The scaffolding stripped off the front of an authored question to leave a phrase about the pair.
 *
 * WHY STRIP AT ALL. The caption on a line is read as a phrase about the two people it joins ("her
 * apprentice", "cannot stand him"), and a question in the interrogative reads as neither. "Which
 * one of you has stayed my hand?" says the tie in its tail and spends its head on grammar the
 * arrow already provides: the line runs from the person who asked to the person they named.
 *
 * ⚠ LONGEST FIRST, and that is load-bearing rather than tidy: "Who is your lover, spouse, or
 * betrothed?" must lose "Who is your " and not "Who ", or the caption reads "is your lover".
 *
 * DELIBERATELY SHORT. Only the four openings that leave a clean phrase behind are here. "Whose
 * forgiveness do you strive to earn?" and "To whom do you owe a debt that cannot be repaid?" are
 * NOT stripped: cutting their heads off leaves a fragment with the possessive gone, which is worse
 * than the question standing whole. An authored question that is not recognised is used as it was
 * written, which is always a defensible caption.
 */
const QUESTION_OPENERS = Object.freeze([
	"which one of you ",
	"which of you ",
	"who is your ",
	"who is ",
	"who ",
]);

/**
 * One authored question as a caption: its scaffolding off, its question mark off, and no more.
 *
 * The first letter is NOT re-capitalised. A caption on this board is a phrase and not a sentence
 * ("her apprentice", "cannot stand him"), so lower case is what the ones drawn by hand look like,
 * and a capital here would make the derived lines shout beside them.
 */
export function questionAsPhrase(prompt) {
	const said = String(prompt ?? "").trim();
	if (!said) return "";
	const lower = said.toLowerCase();
	const opener = QUESTION_OPENERS.find(head => lower.startsWith(head));
	const body = opener ? said.slice(opener.length) : said;
	return body.replace(/\s*\?+\s*$/, "").trim();
}

/**
 * WHOLE WORDS ONLY, through `wholeWordPattern` (utils/strings.js) and never `\b`: that boundary is
 * defined on `\w`, which is ASCII, so it fires in the middle of any name with an accent in it. Here
 * it also stops "Pim" from matching inside "Pimble".
 */
const wordPattern = word => wholeWordPattern(word, "i");

/**
 * Every name one person can be found by, longest first.
 *
 * THE GIVEN NAME COUNTS, because players write "I asked Emrys" and not "I asked Emrys Tal". So a
 * multi-word name is searchable by its first word as well as whole.
 *
 * ⚠ UNLESS TWO PEOPLE SHARE IT. "Emrys Tal" and "Emrys Vane" at one table make "Emrys" an ambiguous
 * name, and a guess that picked either would be a line asserting something nobody said. The caller
 * builds the whole set at once (`introRegards`) precisely so that this can be decided across the
 * party rather than one person at a time.
 */
function namesOf(person, shared) {
	const full = String(person?.name ?? "").trim();
	if (!full) return [];
	const first = full.split(/\s+/)[0];
	const names = [full];
	if (first && first !== full && !shared.has(first.toLowerCase())) names.push(first);
	return names.sort((a, b) => b.length - a.length);
}

/** Which first names more than one of these people answer to. */
function sharedFirstNames(people) {
	const seen = new Map();
	for (const person of people) {
		const first = String(person?.name ?? "").trim().split(/\s+/)[0]?.toLowerCase();
		if (!first) continue;
		seen.set(first, (seen.get(first) ?? 0) + 1);
	}
	return new Set([...seen].filter(([, count]) => count > 1).map(([name]) => name));
}

/**
 * A candidate list as the matcher reads it: every name each person answers to, longest first, with
 * the pattern it is looked for by and the ambiguous first names already dropped.
 *
 * ⚠ BUILT ONCE PER LIST AND HELD. `introAnswerRows` calls `namedIn` once per recorded answer per writer,
 * and every call was rebuilding the shared-first-name set and compiling up to two Unicode
 * lookbehinds per candidate: a nine-character table with seventy answers is about a thousand regex
 * compilations to open the match window, for an answer that cannot change between them.
 *
 * A WeakMap ON THE LIST ITSELF, so nothing is held past the pass that built it and nothing has to
 * be invalidated. It assumes what every caller here does: a candidate list is built, read, and
 * thrown away, never mutated in place.
 */
const readers = new WeakMap();

function nameReaders(candidates) {
	const held = readers.get(candidates);
	if (held) return held;
	const shared = sharedFirstNames(candidates);
	const built = [];
	for (const person of candidates) {
		if (!person?.uuid) continue;
		for (const name of namesOf(person, shared)) {
			built.push({ uuid: person.uuid, name, re: wordPattern(name) });
		}
	}
	readers.set(candidates, built);
	return built;
}

/**
 * Who, of `candidates`, this piece of writing names.
 *
 * THE FALLBACK, and only ever that: an answer whose writer picked somebody from the table is
 * already decided (`pickedTarget`), and this is what reads the ones nobody was asked about. That
 * is every answer in every world that ran its introductions before the picker existed, so it stays
 * exactly as careful as it was when it was the only reader.
 *
 * ⚠ THE EARLIEST NAME WINS, and it is right for prose. These answers are prose: "I asked Rhianna whether she still trusted me after the
 * business at the broken gate. She held my eye a while, then said she did." The person the sentence
 * is ABOUT is the one it opens with; anybody mentioned later is scenery. A tie on position goes to
 * the LONGER name, so "Emrys Tal" beats a bare "Emrys" starting at the same place.
 *
 * ONE ANSWER IS ONE LINE. An answer that names two people is not split into two: the questions ask
 * for one person ("which ONE of you"), and a board that drew a line for every name in a paragraph
 * would assert ties out of passing mentions.
 *
 * @param {string} text  what somebody wrote.
 * @param {Array<{uuid, name}>} candidates  who they could have meant. The writer is not among them.
 * @returns {string|null}  that person's uuid, or null where nobody on the list is named.
 */
export function namedIn(text, candidates = []) {
	const said = String(text ?? "");
	if (!said.trim()) return null;
	let best = null;
	let bestAt = Infinity;
	let bestLength = 0;
	// The patterns carry no `g` flag, so `exec` keeps no position between calls and one compiled
	// pattern is safe to read every answer at this table with.
	for (const { uuid, name, re } of nameReaders(candidates)) {
		const found = re.exec(said);
		if (!found) continue;
		if (found.index < bestAt || (found.index === bestAt && name.length > bestLength)) {
			best = uuid;
			bestAt = found.index;
			bestLength = name.length;
		}
	}
	return best;
}

/**
 * WHICH RECORDED ANSWER this is, as a key that survives the words being rewritten.
 *
 * WHAT IT IS FOR is the party board. A line seeded from an answer carries this, so that opening the
 * map again can tell the answers that are already drawn from the ones that are not -- by identity,
 * wherever they have moved to in the list, rather than by counting a list that reorders itself the
 * moment somebody matches an old answer to a person. See `RELMAP_ORIGIN_MAX` in relmap-store.js.
 *
 * THE SLOT AND NOT THE PROSE, because prose is the one thing on this board that is the table's to
 * change: the caption on a seeded line is meant to be rewritten in the words the table uses, and a
 * key read back out of the writing would make the board draw a duplicate the moment it was.
 *
 * ⚠ THE SAME THREE PARTS `rowKey` USES, and it is that function -- the match window posts its form
 * back against these, and two spellings of "which answer is this" is how a key written by the board
 * comes to name a different answer from the one the matcher wrote. It lives HERE, with the reader
 * both files share, because relmap-intro-match.js imports from this module and not the other way
 * about.
 *
 * @param {string} writerId  the actor id of whoever recorded it.
 * @param {{source: string, index: number|null}} at  the slot it is stored in, from `introQaPairs`.
 */
export function introAnswerKey(writerId, at) {
	return `${writerId}::${at?.source ?? ""}::${at?.index ?? ""}`;
}

/**
 * The person the writer PICKED, where they picked one: their uuid, or null.
 *
 * ⚠ THE PICK OUTRANKS THE PROSE, always, and that is the whole point of it existing. "I asked her
 * outright and she only laughed" names nobody at all, and "Sela told me Marrec would never" names
 * the wrong one first; a writer who chose from the list has settled both cases, and second-guessing
 * that from the words would be the map telling somebody they meant somebody else.
 *
 * Refused where the id is not one of THIS party's (a player character since deleted, or a record
 * carried in from another world) or is the writer's own, both of which fall back to the names. A
 * refused pick is silent: it is one line not drawn on a board the reader can draw on themselves.
 *
 * @param {string} who     the recorded actor id.
 * @param {Map<string, string>} byId  this party's actor id -> uuid.
 * @param {string} mine    the writer's own uuid.
 */
function pickedTarget(who, byId, mine) {
	const uuid = byId.get(String(who ?? "")) ?? null;
	return uuid && uuid !== mine ? uuid : null;
}

/**
 * Every answer one player character recorded about another, as lines, by uuid on both sides.
 *
 * ⚠ READ THROUGH `introQaPairs`, THE CHRONICLE'S OWN READER. What counts as "what they recorded" is
 * four rules at once (a list per step, the legacy single-answer rounds folded in behind it, a
 * question index resolved back to its authored text, and a dedupe on the pair), and a second
 * spelling of any of them is how this board comes to show a bond the Chronicle page does not.
 *
 * ⚠ THE PARTY AND NOBODY ELSE. Both ends: the answers read are the party's, and the only names
 * looked for are the party's. An answer naming an NPC ("my sister Maeve") draws nothing, which is
 * right for a view whose whole promise is the player characters and what they said about each
 * other. It is also what keeps this cheap enough to run inside a repaint, which arrives every time
 * anybody at the table nudges a portrait.
 *
 * A PERSON CAN ANSWER SEVERAL TIMES ABOUT THE SAME PERSON. Four step-4 questions and four step-6
 * ones, and nothing stops all eight naming one friend, so this hands back a LIST per direction
 * rather than one line. The board fans them apart.
 *
 * @param {Array<{id, uuid, name, slug}>} pcs  the party, as the Chronicle already describes them.
 * @param {object} answers  the `introductionsAnswers` blob, keyed by actor id.
 * @returns {Map<string, Map<string, Array<{key, label, said, ink}>>>}  from-uuid -> to-uuid -> lines.
 */
export function introRegards(pcs = [], answers = {}) {
	const out = new Map();
	const party = (pcs ?? []).filter(pc => pc?.uuid);
	// What a recorded pick is an id INTO. The introductions store an actor id, because that is what
	// the dialog has in its hands and what `introductionsAnswers` is itself keyed by; the board
	// joins people by uuid, so the party is the lookup between the two.
	const byId = new Map(party.filter(pc => pc.id).map(pc => [String(pc.id), pc.uuid]));

	for (const pc of party) {
		// Never themselves: "who is your closest kin" answered with their own name is not a line,
		// and `normalizeGraph` refuses one from a person to themselves in any case.
		const others = party.filter(other => other.uuid !== pc.uuid);
		if (!others.length) continue;
		const said = introQaPairs(answers?.[pc.id], pc.slug);

		for (const step of INTRO_STEPS) {
			for (const { prompt, answer, who, at } of said[step] ?? []) {
				const to = pickedTarget(who, byId, pc.uuid) ?? namedIn(answer, others);
				if (!to) continue;
				let mine = out.get(pc.uuid);
				if (!mine) out.set(pc.uuid, mine = new Map());
				mine.set(to, [...(mine.get(to) ?? []),
					introLine(prompt, answer, step, introAnswerKey(pc.id, at))]);
			}
		}
	}
	return out;
}

/**
 * One answer as a line: what the caption says, the whole of what was recorded, and its colour.
 *
 * TWO LENGTHS, AND BOTH ARE USED. `label` is the question as a phrase, cut to the board's own bound
 * so one long question cannot run right across everybody else's lines; `said` is the question AND
 * the answer, whole, which is what the caption's tooltip carries. On this view the tooltip is the
 * only place the writing itself can be read, so it is not decoration.
 *
 * ⚠ THE ANSWER IS NOT THE CAPTION, and that was settled with the user rather than assumed. The
 * answer is prose written about a third party ("I put it to Sela, who only nodded once"), so cut to
 * sixty characters it reads as a fragment, and it repeats the name the arrow is already pointing
 * at. The question is what says the TIE.
 *
 * AND THE KEY, which is the one part of a line that is not for reading. It rides onto the edge the
 * party board draws so that the same answer is recognised again on the next open, however the words
 * have been rewritten since. `""` where the caller has no key, which the board takes as "this line
 * cannot be named" and falls back to counting for. See `introAnswerKey`.
 */
export function introLine(prompt, answer, step, key = "") {
	const phrase = questionAsPhrase(prompt);
	const words = String(answer ?? "").trim();
	// The caption falls back to the answer where the question could not be resolved at all: a
	// record whose question index is missing keeps a blank prompt (see `qaPairsFrom`), and a line
	// with no caption says nothing but its colour.
	const label = phrase || words;
	return {
		key,
		label: shorten(label),
		// Both, in the order they were asked and answered. Composed through the language file rather
		// than joined here, so the punctuation between them is somewhere it can be changed.
		said: prompt && words
			? (game.i18n?.format?.("stonetop.relmap.introLine", { question: prompt, answer: words })
				?? `${prompt} ${words}`)
			: (words || prompt || ""),
		ink: INTRO_STEP_INKS[step] ?? INTRO_STEP_INKS.step6,
	};
}

/** What the board has room for: the caption bound, ON A WORD.
 *
 * ⚠ THE WORD BOUNDARY IS THE POINT, and it was caught by running this over a real world rather than
 * over fixtures. "Who is beloved by the goddess, your charge to nurture, guide, protect, or heal?"
 * comes out at seventy-one characters, and a flat cut at sixty ends it "guide, prote" -- which
 * reads as a rendering fault rather than as a caption that was too long. These are AUTHORED
 * questions, so they will keep running past the bound; a hand-typed label is the writer's own
 * business and is trimmed flat by the store.
 *
 * The ellipsis says the sentence goes on, which on this board it always can: the whole question and
 * the whole answer are on the line's note, and the note is what the caption's tooltip shows.
 */
function shorten(text) {
	const said = String(text ?? "");
	if (said.length <= RELMAP_LABEL_MAX) return said;
	const room = said.slice(0, RELMAP_LABEL_MAX - 1);
	const space = room.lastIndexOf(" ");
	// Only back to a word if that leaves a caption worth reading. A single very long word would
	// otherwise be cut back to nothing at all.
	const cut = space > RELMAP_LABEL_MAX / 2 ? room.slice(0, space) : room;
	return `${cut.replace(/[\s,;:]+$/, "")}…`;
}
