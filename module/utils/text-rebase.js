// ── Two people typing into one text field (pure core) ──────────────────────────
// A shared field stored as one whole string (a flag, a setting) is last-writer-wins: every
// write replaces the lot, so whoever saves second rubs out whatever the first had typed that
// the second had not yet seen. These helpers let a client take a newer value written by
// somebody else WITHOUT losing what it has typed since it last saw the field: a three-way
// merge of the two against the value both started from, the way version control merges two
// branches.
//
// Edits in different places are all kept. Where both sides changed the same words there is no
// right answer, and the text typed HERE wins: the person at this keyboard never watches their
// own words vanish, and their next save hands the result on. Where both sides hold the SAME
// addition (which happens when a save that already carried the other's words crosses one that
// didn't), it is kept once, not twice.

// Past this many edits the two texts are treated as simply different: one edit replacing
// everything between their common start and end. Keeps a paste over the whole field from
// costing a quadratic diff.
const _MAX_EDITS = 400;

// A word, a run of whitespace, or any other single character (punctuation, an emoji).
const _WORD = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

// How a text is cut up for diffing. By WORD for merging: two people changing the same word get
// one clash over the word rather than their letters shuffled together ("red" made "blue" here and
// "green" there must not come out "gblueen"). By character (code point, so an emoji is never cut
// in half) for following the caret precisely.
const _tokens = (s, words) => (words ? (s.match(_WORD) ?? []) : Array.from(s));

// Myers' O(ND) shortest edit script from token list A to B, as single-token steps in A's
// indices: { at, ins } inserts B's token before A[at]; { at, del: true } removes A[at]. Null
// when it would take more than maxD steps.
function _editScript(A, B, maxD) {
	const N = A.length, M = B.length;
	const trace = [];
	let v = new Map([[1, 0]]);
	for (let d = 0; d <= Math.min(N + M, maxD); d++) {
		const next = new Map();
		for (let k = -d; k <= d; k += 2) {
			const down = k === -d || (k !== d && v.get(k - 1) < v.get(k + 1));
			let x = down ? v.get(k + 1) : v.get(k - 1) + 1;
			let y = x - k;
			while (x < N && y < M && A[x] === B[y]) { x++; y++; }
			next.set(k, x);
			if (x >= N && y >= M) { trace.push(next); return _backtrack(trace, d, N, M, B); }
		}
		trace.push(next);
		v = next;
	}
	return null;
}

function _backtrack(trace, D, N, M, B) {
	const steps = [];
	let x = N, y = M;
	for (let d = D; d > 0; d--) {
		const v    = trace[d - 1];
		const k    = x - y;
		const down = k === -d || (k !== d && v.get(k - 1) < v.get(k + 1));
		const pk   = down ? k + 1 : k - 1;
		const px   = v.get(pk), py = px - pk;
		const mx   = down ? px : px + 1;
		while (x > mx) { x--; y--; }                     // the run of equal tokens
		steps.push(down ? { at: px, ins: B[py] } : { at: px, del: true });
		x = px; y = py;
	}
	return steps.reverse();
}

/**
 * The edits that turn `from` into `to`, as a sorted list of non-touching hunks: each replaces
 * `from.slice(at, end)` with `text` (an insertion has at === end, a deletion empty text).
 * @param {object} [opts]
 * @param {boolean} [opts.words]  diff whole words rather than characters (see _tokens)
 * @returns {Array<{at:number, end:number, text:string}>}
 */
export function diffHunks(from, to, { words = false } = {}) {
	from = String(from ?? ""); to = String(to ?? "");
	if (from === to) return [];
	const A = _tokens(from, words), B = _tokens(to, words);
	const offset = [0];
	for (const t of A) offset.push(offset[offset.length - 1] + t.length);
	const max = Math.min(A.length, B.length);
	let pre = 0;
	while (pre < max && A[pre] === B[pre]) pre++;
	let endA = A.length, endB = B.length;
	while (endA > pre && endB > pre && A[endA - 1] === B[endB - 1]) { endA--; endB--; }
	const midA = A.slice(pre, endA), midB = B.slice(pre, endB);
	const steps = (midA.length && midB.length) ? _editScript(midA, midB, _MAX_EDITS) : null;
	if (!steps) return [{ at: offset[pre], end: offset[endA], text: midB.join("") }];
	const hunks = [];
	let cur = null;
	for (const step of steps) {
		const i = step.at + pre;
		if (!cur || cur.next !== i) hunks.push(cur = { at: offset[i], end: offset[i], text: "", next: i });
		if (step.del) { cur.next = i + 1; cur.end = offset[i + 1]; }
		else cur.text += step.ins;
	}
	return hunks.map(({ at, end, text }) => ({ at, end, text }));
}

// A space between two people's additions at the one point when neither brought one of its own.
// Both typing into an empty box at once is the usual way to get here, and "she is dying" and
// "Olwin taught me" set side by side must not come out as "dying)Olwin". Not before punctuation
// that hangs on the word ahead of it (", north"), nor after an opening bracket or quote.
const _gap = (first, second) =>
	(/[^\s([{"'‘“]$/u.test(first) && /^[^\s,.;:!?)\]}"'’”…]/u.test(second) ? " " : "");

// `base.slice(start, end)` with the given hunks (all inside that stretch, in order) applied.
function _applyWithin(base, hunks, start, end) {
	let out = "", pos = start;
	for (const h of hunks) { out += base.slice(pos, h.at) + h.text; pos = h.end; }
	return out + base.slice(pos, end);
}

/**
 * Carry the edits made in `mine` since `base` over onto `theirs`, a newer value of the same
 * field that somebody else wrote.
 *
 * Their edits and mine are gathered into stretches of `base` that one or both touched. A stretch
 * only one side touched takes that side's version. Where both did: the same result, or one that
 * contains the other, is kept once; two additions at the same point are both kept, mine first
 * (the writer's own words stay together, and the caret, which sits at their end, lands just
 * before the newcomer's) with a space between if neither has one there; anything else is a
 * real clash, and mine wins.
 *
 * @param {string} base   the value this client last knew the field to hold
 * @param {string} mine   what this client's field holds now
 * @param {string} theirs the newer value just written by somebody else
 * @returns {string}
 */
export function merge3(base, mine, theirs) {
	base = String(base ?? ""); mine = String(mine ?? ""); theirs = String(theirs ?? "");
	if (theirs === mine || theirs === base) return mine;
	if (mine === base) return theirs;
	// By position; at one position an insertion before a replaced stretch; then mine first.
	const hunks = [
		...diffHunks(base, mine, { words: true }).map(h => ({ ...h, mine: true })),
		...diffHunks(base, theirs, { words: true }).map(h => ({ ...h, mine: false })),
	].sort((p, q) => p.at - q.at || p.end - q.end || (p.mine === q.mine ? 0 : p.mine ? -1 : 1));
	// A hunk joins the stretch before it when it starts inside it, or when both are insertions
	// at the one point. An insertion at either edge of a replaced stretch does not clash with it.
	const groups = [];
	for (const h of hunks) {
		const g = groups[groups.length - 1];
		if (g && (h.at < g.end || (h.at === h.end && g.at === g.end && h.at === g.at))) {
			g.items.push(h);
			g.end = Math.max(g.end, h.end);
		} else {
			groups.push({ at: h.at, end: h.end, items: [h] });
		}
	}
	let out = "", pos = 0;
	for (const g of groups) {
		out += base.slice(pos, g.at);
		const ours   = g.items.filter(h => h.mine);
		const others = g.items.filter(h => !h.mine);
		const va = _applyWithin(base, ours, g.at, g.end);
		const vb = _applyWithin(base, others, g.at, g.end);
		if (!others.length)          out += va;
		else if (!ours.length)       out += vb;
		else if (va.includes(vb))    out += va;         // the same, or mine already holds theirs
		// Theirs already holds mine. NOT when mine is a deletion: every string "holds" the empty
		// one, so this used to hand a word I deleted straight back whenever they had touched it.
		// A deletion against their edit is a clash like any other, and mine wins.
		else if (va && vb.includes(va)) out += vb;
		else if (g.at === g.end)     out += va + _gap(va, vb) + vb;   // two additions at one point
		else                         out += va;         // a real clash
		pos = g.end;
	}
	return out + base.slice(pos);
}

/**
 * Where a position in a string lands once `hunks` (from diffHunks) have been applied to it:
 * before a hunk it stays put (so an insertion right at it goes AFTER it), past one it moves
 * with the text, and inside a replaced stretch it goes to the end of the replacement.
 */
export function mapIndex(index, hunks) {
	let shift = 0;
	for (const h of hunks ?? []) {
		if (index <= h.at) break;
		if (index < h.end) return h.at + h.text.length + shift;
		shift += h.text.length - (h.end - h.at);
	}
	return index + shift;
}
