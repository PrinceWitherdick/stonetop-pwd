// Which lines on a relationship map say FAMILY, and the household they add up to.
//
// WHY A FIELD ON THE LINE AND NOT THE WRITING ON IT. A caption is prose, and prose is the one thing
// on this board nobody should have to phrase a particular way: "her mother", "raised the boy",
// "never told him he was hers" all say the same tie, and a tree that only understood the first
// would be a feature that works for whoever guessed the vocabulary. So the tie is a stored key and
// the caption stays somebody's own sentence. The guess below exists only to SEED that key on a map
// somebody has already written, and every guess it makes is offered for confirmation rather than
// applied behind the reader's back.
//
// WHICH WAY ROUND A CAPTION READS, since the whole feature turns on it. A line's label is written
// about the first person and aimed at the second, the way the field's own placeholder says it
// ("best friends", "secretly in love with"), so "mother" on a line drawn from Ordga to Marrec reads
// ORDGA IS MARREC'S MOTHER. That is the reading the guess uses and the one the editor's own wording
// spells out with both names in it, because a family tie set backwards is invisible in the data and
// obvious in the picture.
//
// TWO KEYS FOR ONE TIE, deliberately: `parent` and `child` are the same relation seen from the two
// ends, and a line drawn the other way round would otherwise have to be redrawn rather than
// relabelled. `kinTies` collapses them into one direction and nothing downstream sees the pair.
//
// EVERYTHING HERE IS DETERMINISTIC and every walk is over a sorted copy, for the reason
// relmap-layout.js gives at length: this feeds a picture shared by everyone at the table, and a
// board that arranged itself differently on each client would be unusable.

import { localize } from "./i18n.js";
import { localizedOnce } from "./localized-once.js";
import { wholeWordPattern } from "./strings.js";

/** Not family. The default, and what nearly every line on a map is. */
export const RELMAP_KIN_NONE = "none";
/** The first person is the second's parent. */
export const RELMAP_KIN_PARENT = "parent";
/** The first person is the second's child. The same tie as `parent`, drawn the other way. */
export const RELMAP_KIN_CHILD = "child";
/** The two are partners: married, handfasted, or simply together. Not directional. */
export const RELMAP_KIN_PARTNER = "partner";

export const RELMAP_KINS = Object.freeze([
	RELMAP_KIN_NONE, RELMAP_KIN_PARENT, RELMAP_KIN_CHILD, RELMAP_KIN_PARTNER,
]);
export const RELMAP_KIN_DEFAULT = RELMAP_KIN_NONE;

/**
 * NOBODY HAS BEEN ASKED YET, which is not the same thing as "not family" and is why it exists.
 *
 * Every line drawn since this feature was built carries an answer, because the editor writes one
 * whichever radio is chosen. A line drawn before it carries nothing. The difference is the whole of
 * what makes "find family ties" safe to press twice: it offers a guess on the lines nobody has
 * answered for, and leaves alone every line somebody HAS answered for, including the ones they
 * answered with a firm "not a family tie". Collapse the two and the button quietly overturns that
 * answer every time it is pressed, on the exact lines whose captions are misleading enough to have
 * needed the answer in the first place.
 *
 * Deliberately not in `RELMAP_KINS`: it is a state stored data can be in, never an option the
 * reader is offered, and `normalizeKin` reads it as "not family" like anything else it does not
 * recognise.
 */
export const RELMAP_KIN_UNSET = "";

/** The ties the word list below can offer a guess at, in the order a label is searched for them. */
export const RELMAP_KIN_GUESSABLE = Object.freeze([
	RELMAP_KIN_PARENT, RELMAP_KIN_CHILD, RELMAP_KIN_PARTNER,
]);

/** One stored tie, or none. Anything else is a newer version's key read by an older one, or
 * somebody's rubbish, and "not family" is the safe answer to both. */
export function normalizeKin(kin) {
	return RELMAP_KINS.includes(kin) ? kin : RELMAP_KIN_DEFAULT;
}

/** Is this a tie the tree can draw anything from? */
export function isKin(kin) {
	return normalizeKin(kin) !== RELMAP_KIN_NONE;
}

/**
 * A stored tie as it should be READ BACK: the answer somebody gave, or `RELMAP_KIN_UNSET` where
 * there is no answer at all.
 *
 * A KEY THIS VERSION DOES NOT KNOW READS AS AN ANSWER, not as an absence. It can only have come
 * from a newer version of the system writing a tie this one has never heard of, and the guess must
 * not march in and overwrite it with its opinion of the caption. Drawn as nothing either way, by
 * `normalizeKin`, so the chart is merely poorer on an old client rather than wrong on a new one.
 */
export function readKin(raw) {
	return raw === undefined || raw === null || raw === "" ? RELMAP_KIN_UNSET : normalizeKin(raw);
}

/**
 * The words that give a tie away, read out of the language file.
 *
 * IN i18n AND NOT IN THIS FILE, because they are a fact about English rather than about maps, and
 * the person best placed to add "gaffer" or to translate the lot is the one holding the language
 * file. Through `localizedOnce` because `game.i18n` does not exist at module evaluation time: a
 * table built at import would be a list of untranslated keys for the life of the page.
 */
const kinWords = localizedOnce(() => Object.fromEntries(
	RELMAP_KIN_GUESSABLE.map(kind => [kind, splitWords(localize(`stonetop.relmap.kinWords.${kind}`))]),
));

/** A comma-separated list from the language file, as lowercase phrases with the pattern each is
 * looked for by, longest first so that "father in law" is tried before the "father" hiding inside
 * it.
 *
 * THE PATTERNS ARE BUILT HERE, ONCE, and not per lookup. The list runs to fifty-odd words and the
 * guess runs on every KEYSTROKE in the link editor's caption box, so compiling fifty Unicode
 * lookbehinds per letter typed is real work for an answer that never changes. `kinWords` is held
 * for the life of the page by `localizedOnce`, so this is where the compiling belongs. */
function splitWords(list) {
	return String(list ?? "")
		.split(",")
		.map(word => word.trim().toLowerCase())
		.filter(Boolean)
		.sort((a, b) => b.length - a.length || a.localeCompare(b))
		.map(word => ({ word, re: wordPattern(word) }));
}

/**
 * WHOLE WORDS ONLY, and this is not fussiness.
 *
 * "smothered her at the mill" contains "mother", and a substring match would mark that line as a
 * birth. The compounds worth catching ("stepmother", "godfather") are spelled out in the word list
 * instead, where they can be read and argued with, rather than bought by a loose match that also
 * buys the false ones.
 *
 * Through `wholeWordPattern` (utils/strings.js) so that this and relmap-intros.js, which asks the
 * same question of the same captions, cannot come to disagree about where a word ends.
 */
function wordPattern(word) {
	return wholeWordPattern(word);
}

/**
 * What family tie, if any, a caption reads like.
 *
 * THE EARLIEST WORD WINS. "his mother's boy" says both things, and the one at the head of the
 * phrase is the one the sentence is actually about. Ties go to the longer phrase, and then to the
 * order in `RELMAP_KIN_GUESSABLE`, so the answer is the same on every client.
 *
 * @param {string} label  the writing on the line.
 * @returns {string}  one of `RELMAP_KINS`; `none` when nothing in it reads like family.
 */
export function guessKin(label) {
	const text = String(label ?? "").toLowerCase();
	if (!text) return RELMAP_KIN_NONE;
	const words = kinWords();
	let best = RELMAP_KIN_NONE;
	let bestAt = Infinity;
	let bestLength = 0;
	for (const kind of RELMAP_KIN_GUESSABLE) {
		for (const { word, re } of words[kind] ?? []) {
			const found = re.exec(text);
			if (!found) continue;
			if (found.index < bestAt || (found.index === bestAt && word.length > bestLength)) {
				best = kind;
				bestAt = found.index;
				bestLength = word.length;
			}
		}
	}
	return best;
}

/**
 * Every line that reads like family and that nobody has answered for, as `{id, kin}`.
 *
 * What "find family ties" offers to write, and the reason it is a button rather than something the
 * tree does quietly on its way to drawing itself: a guess about somebody's map should be applied
 * where they can see how many it touched.
 *
 * UNANSWERED, not "not marked as family" (see `RELMAP_KIN_UNSET`). A line somebody has looked at
 * and called "not a family tie" has an answer, and this must never overrule it.
 */
export function unmarkedKin(graph) {
	return Object.entries(graph?.edges ?? {})
		.filter(([, edge]) => readKin(edge?.kin) === RELMAP_KIN_UNSET)
		.map(([id, edge]) => ({ id, kin: guessKin(edge?.label) }))
		.filter(row => isKin(row.kin))
		.sort((a, b) => a.id.localeCompare(b.id));
}

const sorted = set => [...set].sort();

/**
 * The family a map's marked lines describe: who descends from whom, and who is with whom.
 *
 * THE TWO GUARDS HERE ARE BOTH ABOUT A PICTURE THAT CANNOT BE DRAWN, and both are honest mistakes
 * somebody makes on a shared board rather than corrupt data:
 *
 *  • A line saying A is B's parent AND another saying B is A's parent. Somebody drew the tie twice
 *    from both ends and got one of them backwards. There is no generation order that satisfies
 *    both, so the FIRST by line id is kept and the reverse dropped: an arbitrary answer, but the
 *    same arbitrary answer on every client, which is what stops two players seeing two trees.
 *  • The same pair marked as partners twice (or from both ends). Collapsed to one bar, or the
 *    chart draws the same rung over itself and it reads as one heavier line for no reason.
 *
 * Longer loops (A parents B parents C parents A) are left to `generationOf`, which cannot spin on
 * them; there is no sensible picture of them either way and refusing to draw the rest of the board
 * over one would be the worse answer.
 *
 * @param {object} graph  a normalized graph, from `readGraph`.
 */
export function kinTies(graph) {
	const nodes = graph?.nodes ?? {};
	const parents = new Map();
	const children = new Map();
	const partnersOf = new Map();
	const partners = [];
	const seenDescent = new Set();
	const seenPartners = new Set();

	const push = (table, key, value) => {
		if (!table.has(key)) table.set(key, new Set());
		table.get(key).add(value);
	};

	// SORTED BY LINE ID, so that which of two contradictory lines wins is decided by the data and
	// not by the order a flag merge happened to leave the object in.
	for (const id of Object.keys(graph?.edges ?? {}).sort()) {
		const edge = graph.edges[id];
		const kin = normalizeKin(edge?.kin);
		if (kin === RELMAP_KIN_NONE) continue;
		// `normalizeGraph` has already dropped links to nobody and links to oneself; this is the
		// belt to that braces, because a graph can also reach here from a test or a caller that
		// built one by hand.
		if (!nodes[edge.a] || !nodes[edge.b] || edge.a === edge.b) continue;

		if (kin === RELMAP_KIN_PARTNER) {
			const pair = [edge.a, edge.b].sort();
			const key = pair.join("|");
			if (seenPartners.has(key)) continue;
			seenPartners.add(key);
			partners.push(pair);
			push(partnersOf, pair[0], pair[1]);
			push(partnersOf, pair[1], pair[0]);
			continue;
		}

		const [parent, child] = kin === RELMAP_KIN_PARENT ? [edge.a, edge.b] : [edge.b, edge.a];
		// Either direction of this pair already settled, including the contradictory one.
		if (seenDescent.has(`${parent}|${child}`) || seenDescent.has(`${child}|${parent}`)) continue;
		seenDescent.add(`${parent}|${child}`);
		push(parents, child, parent);
		push(children, parent, child);
	}

	const people = new Set([...parents.keys(), ...children.keys(), ...partnersOf.keys()]);
	return {
		people: sorted(people),
		parents: new Map([...parents].map(([id, set]) => [id, sorted(set)])),
		children: new Map([...children].map(([id, set]) => [id, sorted(set)])),
		partnersOf: new Map([...partnersOf].map(([id, set]) => [id, sorted(set)])),
		partners: partners.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])),
	};
}

/**
 * Which generation everybody is in, counting down from whoever has no recorded parents.
 *
 * TWO RULES, APPLIED UNTIL THEY BOTH HOLD. A child sits at least one row below every one of their
 * parents, and partners sit on the same row as each other. They pull against one another (levelling
 * a couple can push their children down, which can push a grandchild down again), so they are
 * relaxed together rather than applied once each: the answer is the shallowest arrangement that
 * satisfies both, which is what puts a family with one long line and one short one on the rows a
 * reader expects rather than leaving the short line floating at the top.
 *
 * THE PASS CAP IS THE CYCLE GUARD. Each pass can only ever push somebody DOWN, and a graph with no
 * loop in it settles in at most one pass per generation. A loop cannot settle at all, so the cap is
 * what stops the relaxation spinning on one; what comes out is a arrangement that is wrong in the
 * loop (it has to be) and correct everywhere else, which beats refusing to draw the map.
 *
 * @returns {Map<string, number>}  everybody in `ties.people`, by their row, 0 at the top.
 */
export function generationOf(ties) {
	const rows = new Map(ties.people.map(id => [id, 0]));
	const passes = Math.max(1, ties.people.length) * 2;
	for (let pass = 0; pass < passes; pass++) {
		let moved = false;
		for (const id of ties.people) {
			let want = rows.get(id);
			for (const parent of ties.parents.get(id) ?? []) {
				want = Math.max(want, (rows.get(parent) ?? 0) + 1);
			}
			if (want > rows.get(id)) { rows.set(id, want); moved = true; }
		}
		for (const [a, b] of ties.partners) {
			const level = Math.max(rows.get(a) ?? 0, rows.get(b) ?? 0);
			if (rows.get(a) !== level) { rows.set(a, level); moved = true; }
			if (rows.get(b) !== level) { rows.set(b, level); moved = true; }
		}
		if (!moved) break;
	}
	return compact(rows);
}

/**
 * The rows people actually stand in, with the empty ones taken out.
 *
 * WHAT LEAVES EMPTY ROWS is a loop: three people each marked as the next one's parent cannot
 * settle, so the relaxation above spends its whole budget pushing them down and they come out at
 * rows sixteen, seventeen and eighteen. Drawn as given, that is a chart nineteen generations tall
 * with three people at the bottom of it and a sheet sized for nineteen rows of nothing.
 *
 * Order is all the numbers ever meant, so squeezing out the gaps loses nothing: whoever was above
 * somebody is still above them. On any map without a loop in it there are no gaps and this changes
 * nothing at all.
 */
function compact(rows) {
	const used = [...new Set(rows.values())].sort((a, b) => a - b);
	const dense = new Map(used.map((row, i) => [row, i]));
	return new Map([...rows].map(([id, row]) => [id, dense.get(row)]));
}

/**
 * The households: each set of parents who share a child, and each couple with none.
 *
 * WHY A HOUSEHOLD RATHER THAN A LINE PER PARENT, which is the obvious way to draw this and is what
 * the plain "generation rows" version of the feature would have done. Two parents drawn as two
 * separate lines to each of four children is eight lines crossing each other in the gap between the
 * rows; the same family drawn as one bar between the parents, one stem down from it and one rail
 * across the children is four short drops and nothing crossing at all. It is also simply what a
 * family tree looks like, which is the thing that was asked for.
 *
 * A childless couple is a household too, so that two people who are together but have no children
 * on this map still get their bar rather than standing next to each other saying nothing.
 *
 * NO "IS THIS A COUPLE" FLAG, though the second pass below is exactly that question. Whether a
 * household is DRAWN as a couple is decided by `drawHouseholds` on the seats it actually has -- two
 * parents on one row get a bar between them whether or not they are marked partners -- and a flag
 * recording a near-miss of that rule beside it would be a second answer to one question, free to
 * drift from the one the chart is painted with.
 *
 * @returns {Array<{key: string, parents: string[], children: string[]}>}
 */
export function households(ties) {
	const byParents = new Map();
	const add = (parents, child = null) => {
		const key = parents.join("|");
		if (!byParents.has(key)) byParents.set(key, { key, parents, children: [] });
		if (child) byParents.get(key).children.push(child);
		return byParents.get(key);
	};

	for (const child of [...ties.parents.keys()].sort()) {
		add(ties.parents.get(child), child);
	}
	// After the children, so that a couple who have some are ONE household with a bar and a stem
	// rather than a bar beside a separate descent from the same two people.
	for (const pair of ties.partners) add(pair);
	for (const home of byParents.values()) home.children.sort();
	return [...byParents.values()].sort((a, b) => a.key.localeCompare(b.key));
}
