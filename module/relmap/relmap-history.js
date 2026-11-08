// Taking a change back on the relationship map, and putting it forward again.
//
// WHY THIS IS NOT A STACK OF SAVED BOARDS, which is the shape "keep the last twenty states" asks
// for out loud and is the one thing this feature must not do. Every write the map makes is a DOTTED
// PATH TO A LEAF, and relmap-store.js opens by explaining that this is the whole concurrency story:
// two players dragging two portraits write `...nodes.a.x` and `...nodes.b.x`, the server merges
// both, and both survive. An undo that wrote a whole saved graph back would be a write of the
// `nodes` object, landing on a copy read minutes ago — so pressing it would silently throw away
// every change anybody else at the table had made in between. On a board four people are arranging
// at once, that is not an undo, it is a rollback of the evening.
//
// SO A STEP IS RECORDED AS THE WRITE THAT REVERSES IT, leaf for leaf, and it merges with everybody
// else's work exactly as the original did. Undoing a portrait you moved puts THAT portrait back and
// touches nothing else. The honest cost, said out loud: if somebody else has moved the same
// portrait since, your undo puts it where YOU found it, because last write wins is the rule this
// whole feature already runs on.
//
// AND THE HISTORY IS YOUR OWN, held on this machine and never written to the document. Two reasons,
// and the second is the one that decided it. A shared stack means the GM's undo silently rubs out a
// player's last edit, which is a table argument rather than a feature. And twenty states in a flag
// on a page is twenty broadcasts' worth of data on a document every open window in the world is
// listening to. It lasts as long as the session and no longer, which is the bargain every drawing
// program strikes.
//
// ⚠ A STEP IS BUILT AGAINST THE BOARD AS IT WAS, AND APPLIED AGAINST THE BOARD AS IT IS. `stepPatch`
// is where those two meet, and it is the only place that can catch the difference: a leaf write put
// back onto somebody who has since been taken off the map would CREATE them again — a nameless,
// faceless portrait carrying nothing but coordinates — so it is dropped instead.

import {
	addChipPatch, addEdgePatch, addGroupPatch, addNodePatch, chipPatch, dropChipPatch, dropEdgePatch,
	dropGroupPatch, dropNodePatch, edgePatch, groupMembersPatch, groupPatch, isSafeId, nodeChipsPatch,
	nodePatch, relmapPath,
} from "./relmap-store.js";

import { deletionTarget } from "../utils/foundry-compat.js";

/**
 * How many changes one board remembers.
 *
 * The ask was "at least twenty", and this is that with room to spare rather than exactly twenty,
 * because the number a reader actually feels is not the count of writes: a caption typed in a burst
 * coalesces into one, but each of the six portraits somebody nudges after it is a step of its own.
 * Twenty-five costs nothing — a step is a handful of small
 * objects — and it is the difference between "I can get back to before I started fiddling" and
 * "nearly".
 */
export const RELMAP_HISTORY_MAX = 25;

/**
 * How long a burst of writes to the same thing stays ONE step.
 *
 * ⚠ WITHOUT THIS, TYPING FILLS THE HISTORY. The tie bar writes a caption within a breath of the
 * last keystroke, and an arrow key held down commits every time the reader pauses — so a reader who
 * types "best friends since the mill fire" and then wants it gone would have to press undo six
 * times, and the twenty steps before it would be gone off the end of the stack. Opted into by the
 * caller and never guessed at here: two deliberate drags a second apart are two changes, and only
 * the caller knows which of its writes are one gesture.
 */
export const RELMAP_COALESCE_MS = 1500;

/** The parts of a graph a step can name. Anything else in a patch is not one of ours. */
const KINDS = Object.freeze(["nodes", "edges", "groups", "chips"]);

/**
 * ⚠ THE ONE FOUR-PART PATH THIS FILE READS: `groups.<id>.members.<person>`, a single person going
 * into or out of a group. Membership is one leaf per person so that two players filling the same
 * group at once both win (see `groupMembersPatch`), which makes it the only write here that reaches
 * BELOW a field. It is recorded as a `set` that carries the person as `key`, so a fold and a step
 * both tell "Ordga into the hunters" apart from "Marrec into the hunters".
 */
const MEMBERS = "members";
/**
 * And the second, built the same way for the same reason: `nodes.<id>.chips.<chip>`, one chip going
 * onto or off one person (`nodeChipsPatch`). Each kind has at most one such set-of-keys field.
 */
const CHIPS = "chips";
const SET_FIELDS = Object.freeze({ groups: MEMBERS, nodes: CHIPS });
const isSetPath = parts => parts.length === 4 && SET_FIELDS[parts[0]] === parts[2] && isSafeId(parts[3]);

/**
 * ONE STEP, either way round.
 *
 * A DESCRIPTION AND NOT A PATCH, which is the point of the whole file. A patch is a set of paths
 * built for the board as it stood when it was written; a step says what it MEANS — put this field
 * back, re-make this person whole, take this line off — so that `stepPatch` can build the paths
 * again against the board as it stands now. Stored flat, and the patch built at the moment of
 * pressing, is what lets an undo recorded ten minutes ago still be safe to apply.
 *
 * @typedef {object} RelmapStep
 * @property {Array<{kind: string, id: string, data: object}>} make  people and lines to re-create whole.
 * @property {Array<{kind: string, id: string, field: string, value: *}>} set  one field each.
 * @property {Array<{kind: string, id: string}>} drop  people and lines to take off.
 */

function emptyStep() {
	return { make: [], set: [], drop: [] };
}

/**
 * WHAT ONE WRITE DOES, AND WHAT WOULD PUT IT BACK, read off the patch and the board it is about to
 * land on.
 *
 * Both halves come out of one pass because they are one reading: whether a write CHANGES a person
 * or CREATES one is a question about the board before it, and the answer decides the shape of both
 * directions at once. A field written onto somebody already there is a field to put back; the same
 * field written onto nobody is somebody being made, so putting it back means taking them off — and
 * the forward direction has to know that too, or a redo would write the same lone leaf onto nobody
 * and half-create them.
 *
 * ⚠ ANYTHING IT DOES NOT RECOGNISE MAKES IT REFUSE, whole, rather than invert the part it
 * understood. A half-invertible step is an undo button that does most of what it says, which is
 * worse than one that was never offered: the reader presses it, watches something change, and has
 * no way of knowing what it left behind. Every patch this feature builds comes out of
 * relmap-store.js and is recognised here; a future one that is not simply goes unrecorded.
 *
 * @param {object} graph  the board as it stands, normalized, BEFORE the write.
 * @param {object} patch  a patch built by relmap-store.js.
 * @returns {{forward: RelmapStep, back: RelmapStep}|null}
 */
export function describeWrite(graph, patch) {
	if (!patch || typeof patch !== "object") return null;
	const entries = Object.entries(patch);
	if (!entries.length) return null;
	const prefix = `${relmapPath()}.`;

	const forward = emptyStep();
	const back = emptyStep();
	// Leaf writes gathered per subject rather than handled as they arrive: whether a person is
	// being made or merely moved is a question about the whole group of fields, not about one.
	const touched = new Map();
	const dropped = [];

	for (const [key, value] of entries) {
		// Through `deletionTarget` and never by looking for "-=", because the two live cores spell a
		// deletion differently and only that function knows both. See utils/foundry-compat.js.
		const target = deletionTarget(key, value);
		const path = target ?? key;
		if (!path.startsWith(prefix)) return null;
		const parts = path.slice(prefix.length).split(".");

		const [kind, id, field] = parts;
		if (!KINDS.includes(kind) || !isSafeId(id)) return null;
		const at = `${kind}/${id}`;
		if (isSetPath(parts)) {
			const held = touched.get(at) ?? { kind, id, fields: {} };
			held.keys ??= {};
			// In or out, and nothing in between: a deletion is out, any write is in.
			held.keys[parts[3]] = target ? null : true;
			touched.set(at, held);
			continue;
		}
		if (target) {
			// A deletion reaches a whole person or a whole line and never one of their fields.
			if (parts.length !== 2) return null;
			dropped.push({ kind, id });
			continue;
		}
		if (parts.length !== 3) return null;
		const held = touched.get(at) ?? { kind, id, fields: {} };
		held.fields[field] = value;
		touched.set(at, held);
	}

	for (const { kind, id, fields, keys } of touched.values()) {
		const setField = SET_FIELDS[kind];
		const was = graph?.[kind]?.[id];
		if (was) {
			for (const [field, value] of Object.entries(fields)) {
				// A field `normalizeGraph` does not keep is one this file cannot say the old value
				// of, so the whole write goes unrecorded rather than half-recorded.
				if (!(field in was)) return null;
				forward.set.push({ kind, id, field, value });
				back.set.push({ kind, id, field, value: was[field] });
			}
			for (const [key, value] of Object.entries(keys ?? {})) {
				forward.set.push({ kind, id, field: setField, key, value });
				back.set.push({ kind, id, field: setField, key, value: was[setField]?.[key] ? true : null });
			}
			continue;
		}
		if (keys && kind === "nodes") {
			// Chips on somebody who is not on the board: the race `normalizeGraph` hides (a chip put on
			// a person just as another reader took them off). Nothing a step could put back.
			if (!Object.keys(fields).length) continue;
			const into = Object.fromEntries(Object.entries(keys).filter(([, on]) => on));
			forward.make.push({ kind, id, data: { ...fields, chips: into } });
			back.drop.push({ kind, id });
			continue;
		}
		if (keys) {
			const members = keys;
			// A group being MADE: its members are part of what makes it, and putting it back means
			// rubbing the whole group out. Taking somebody out of a group that is not there is nothing.
			const into = Object.fromEntries(Object.entries(members).filter(([, on]) => on));
			if (!Object.keys(into).length && !Object.keys(fields).length) continue;
			forward.make.push({ kind, id, data: { ...fields, members: into } });
			back.drop.push({ kind, id });
			continue;
		}
		// Nobody there yet, so this write MAKES them, and putting it back means taking them off.
		forward.make.push({ kind, id, data: { ...fields } });
		back.drop.push({ kind, id });
	}

	for (const { kind, id } of dropped) {
		forward.drop.push({ kind, id });
		const was = graph?.[kind]?.[id];
		// Already gone, so there is nothing to put back — and it is not an error. Somebody at the
		// far end of the table taking a person off while this reader pressed Delete on the same
		// person is exactly this, and the outcome both of them wanted has happened.
		if (was) back.make.push({ kind, id, data: { ...was } });
		// ⚠ AND PUT BACK INTO EVERY GROUP THEY WERE IN, said out loud rather than left to the membership
		// key `dropNodePatch` leaves behind. That key goes when the group is rubbed out, and undoing the
		// rubbing-out re-makes it with only the people then standing (`stepPatch`). So: take Ordga off,
		// rub out "The hunters", undo, undo, and Ordga and the hunters were both back with Ordga outside
		// it. `stepPatch` skips this for a group that is not on the board when it is pressed, so a group
		// somebody has rubbed out since is never drawn again by it; one that went off the board only
		// because its last member left still comes back through the key it kept.
		if (kind === "nodes" && was) {
			for (const [groupId, group] of Object.entries(graph?.groups ?? {})) {
				if (group?.members?.[id]) back.set.push({ kind: "groups", id: groupId, field: MEMBERS, key: id, value: true });
			}
		}
	}

	if (!forward.make.length && !forward.set.length && !forward.drop.length) return null;
	return { forward, back };
}

/**
 * THE WRITE ONE STEP MAKES, built against the board as it stands right now.
 *
 * This is the half that makes a step recorded ten minutes ago safe to press. Everything it refuses
 * is a case where the board has moved on underneath the step, and in every one of them doing
 * nothing is the honest answer:
 *
 * - A FIELD OF SOMEBODY WHO IS NO LONGER THERE. A leaf write is a path, and a path writes whatever
 *   is missing along it into existence — so putting `nodes.<id>.x` back for a person taken off the
 *   map would create a nameless, faceless portrait holding nothing but coordinates. The one case
 *   where this does NOT apply is a step that re-makes that very person in the same breath, which
 *   is why what is being made is gathered before the fields are written.
 * - A LINE WHOSE END HAS LEFT THE BOARD. `normalizeGraph` drops it on the next read anyway, so
 *   writing it would only leave a dead line in the document nobody will ever see.
 * - A LINE ALREADY RUBBED OUT. Nothing to rub out twice.
 *
 * ⚠ AND TAKING A PERSON OFF GOES THROUGH `dropNodePatch`, not through the deletion the step
 * happens to name, so it takes the lines drawn to them SINCE with it. Undoing "add Ordga" while
 * somebody else was drawing a line to Ordga must not leave that line hanging in the document
 * pointing at nobody.
 *
 * @param {object} graph  the board as it stands, normalized.
 * @param {RelmapStep} step
 * @returns {object|null}  a patch for `applyPatch`, or null when there is nothing left to do.
 */
export function stepPatch(graph, step) {
	if (!step) return null;
	const patch = {};

	const make = step.make ?? [];
	// ⚠ SOMEBODY PUT BACK WHO IS ALREADY HERE UNDER ANOTHER ID: taken off, then put on again by
	// another reader, then the removal undone. Re-made, the same actor stood on the board twice. So
	// they are NOT re-made, and what this step puts back about them (their lines, their groups) goes
	// onto the one already standing. `alias` maps the id the step knew to the id on the board.
	const byActor = new Map();
	for (const [nodeId, node] of Object.entries(graph?.nodes ?? {})) if (node?.uuid) byActor.set(node.uuid, nodeId);
	const alias = new Map();
	for (const one of make) {
		if (one.kind !== "nodes" || graph?.nodes?.[one.id]) continue;
		const there = one.data?.uuid ? byActor.get(one.data.uuid) : null;
		if (there) alias.set(one.id, there);
	}
	const as = nodeId => alias.get(nodeId) ?? nodeId;
	// Who will be on the board once this step has landed: what is there now, plus what this very
	// step puts back. A line re-made alongside both its people has both its ends.
	const standing = new Set(Object.keys(graph?.nodes ?? {}));
	for (const one of make) if (one.kind === "nodes" && !alias.has(one.id)) standing.add(one.id);
	const making = new Set(make.filter(one => !(one.kind === "nodes" && alias.has(one.id)))
		.map(one => `${one.kind}/${one.id}`));

	for (const { kind, id, data } of make) {
		if (kind === "nodes") {
			if (alias.has(id)) continue;
			Object.assign(patch, addNodePatch(id, data ?? {}) ?? {});
			continue;
		}
		if (kind === "groups") {
			// Only the people who will be standing: a membership leaf for somebody gone is a key
			// nothing will ever draw. A group left with nobody in it is not re-made at all.
			const members = [...new Set(Object.keys(data?.members ?? {}).map(as))].filter(nodeId => standing.has(nodeId));
			Object.assign(patch, addGroupPatch(id, { ...(data ?? {}), members }) ?? {});
			continue;
		}
		if (kind === "chips") {
			Object.assign(patch, addChipPatch(id, data ?? {}) ?? {});
			continue;
		}
		const a = as(data?.a);
		const b = as(data?.b);
		if (!standing.has(a) || !standing.has(b) || a === b) continue;
		Object.assign(patch, addEdgePatch(id, { ...(data ?? {}), a, b }) ?? {});
	}

	for (const { kind, id, field, key, value } of step.set ?? []) {
		if (!graph?.[kind]?.[id] && !making.has(`${kind}/${id}`)) continue;
		if (kind === "groups" && field === MEMBERS) {
			// Putting somebody back into a group they have since left the BOARD from would leave a
			// key behind for nobody; the same rule as a field put back onto a person who has gone.
			const member = as(key);
			if (value && !standing.has(member)) continue;
			Object.assign(patch, (value ? groupMembersPatch(id, [member]) : groupMembersPatch(id, [], [member])) ?? {});
			continue;
		}
		if (kind === "nodes" && field === CHIPS) {
			// A chip put back onto somebody must still be on the board (or coming back in this step),
			// or the leaf would name a chip nothing draws.
			if (value && !graph?.chips?.[key] && !making.has(`chips/${key}`)) continue;
			Object.assign(patch, (value ? nodeChipsPatch(id, [key]) : nodeChipsPatch(id, [], [key])) ?? {});
			continue;
		}
		// Through the store's own builders, so an undo is held to every bound and every clamp an
		// ordinary edit is. A value recorded before a bound was tightened is trimmed on its way
		// back in, exactly as it would be if the reader had typed it again today.
		const build = { nodes: nodePatch, edges: edgePatch, groups: groupPatch, chips: chipPatch }[kind];
		Object.assign(patch, build?.(id, { [field]: value }) ?? {});
	}

	for (const { kind, id } of step.drop ?? []) {
		if (kind === "nodes") {
			if (graph?.nodes?.[id]) Object.assign(patch, dropNodePatch(graph, id) ?? {});
			continue;
		}
		if (kind === "groups") {
			if (graph?.groups?.[id]) Object.assign(patch, dropGroupPatch(id) ?? {});
			continue;
		}
		if (kind === "chips") {
			if (graph?.chips?.[id]) Object.assign(patch, dropChipPatch(graph, id) ?? {});
			continue;
		}
		if (graph?.edges?.[id]) Object.assign(patch, dropEdgePatch(id) ?? {});
	}

	return Object.keys(patch).length ? patch : null;
}

/**
 * Two steps of one burst folded into one, in whichever direction is being folded.
 *
 * Everything a burst touches piles up; the only question is what happens when both halves name the
 * SAME field of the same subject, and the answer is opposite for the two directions. `keep` says
 * which one wins, and the two callers below say why each of them wants what it does.
 *
 * @param {RelmapStep} first
 * @param {RelmapStep} second
 * @param {"later"|"earlier"} keep  whose value of a twice-written field survives the fold.
 */
function foldSteps(first, second, keep) {
	const later = keep === "later";
	const out = {
		make: [...first.make, ...second.make],
		set: [...first.set],
		drop: [...first.drop, ...second.drop],
	};
	for (const one of second.set) {
		const at = out.set.findIndex(
			held => held.kind === one.kind && held.id === one.id && held.field === one.field
				&& held.key === one.key,
		);
		if (at < 0) out.set.push(one);
		// Already held, so the earlier value is the one already in `out` and there is nothing to do.
		else if (later) out.set[at] = one;
	}
	return out;
}

/** The two FORWARD halves of a burst, so that one redo replays all of it. The later write of a
 * field wins, because replaying a burst means ending where it ended. */
function mergeSteps(first, second) {
	return foldSteps(first, second, "later");
}

/**
 * And the two BACK halves, where the EARLIEST write of a field wins instead.
 *
 * ⚠ NOT SYMMETRY FOR ITS OWN SAKE — WITHOUT IT, HALF A BURST IS NOT TAKEN BACK. Folding exists so
 * that ONE press gets the reader to before the burst started, and the mistake this replaces was to
 * keep the first `back` verbatim on the assumption that a burst is one field written over and over.
 * A coalesce key names a GESTURE, not a field: the tie bar keys every press on a line as
 * `edge:<id>`, so recolouring a line and then dashing it within a breath is two DIFFERENT fields
 * folded into one step. Keeping only the first `back` there undid the colour, left the dashes, and
 * told the reader it had taken the whole change back — which is the one thing an undo may never do.
 *
 * A field written twice INSIDE the burst is the case the direction settles: the reader is owed the
 * value it had before any of it, so the first `back` to name that field is the one that stands.
 */
function mergeBackSteps(first, second) {
	return foldSteps(first, second, "earlier");
}

/**
 * ONE BOARD'S HISTORY: what this reader has done to it, and what they have taken back.
 *
 * Two stacks and the usual bargain between them. Recording anything empties the forward one,
 * because a change made after an undo is a new branch and there is no longer a single "again" to
 * put back.
 *
 * ⚠ ONE BOARD, TWO VIEWS, ONE HISTORY. The steading sheet's map tab and the map window are separate
 * windows, and both find a board's history by its page (`historyFor`), which is right: it is the same
 * reader taking back the same change. So two things that would otherwise be each window's own live
 * here instead. The one-step-at-a-time guard (`step`), or an Undo in each applied one step twice. And
 * the word that the stacks have moved (`subscribe`), so every view's buttons are repainted after a
 * change made in either, or the other one went on offering a change already taken back.
 */
export class RelmapHistory {
	constructor({ max = RELMAP_HISTORY_MAX, now = () => Date.now() } = {}) {
		this._max = Math.max(1, Number(max) || RELMAP_HISTORY_MAX);
		this._now = now;
		this._back = [];
		this._forward = [];
		this._stepping = false;
		this._listeners = new Set();
	}

	/**
	 * Be told whenever either stack moves: a change recorded, one taken back or put forward, or the
	 * lot forgotten. The listener is handed this history.
	 *
	 * @param {Function} listener
	 * @returns {Function}  takes the listener back off; a view calls it when it closes or moves to
	 *          another board.
	 */
	subscribe(listener) {
		if (typeof listener !== "function") return () => {};
		this._listeners.add(listener);
		return () => { this._listeners.delete(listener); };
	}

	/** Tell every listener the stacks have moved. Off a copy, so a listener that unsubscribes as it
	 * is told does not upset the walk. */
	_changed() {
		for (const listener of [...this._listeners]) listener(this);
	}

	/** Whether a step (`step`) is under way on this board right now, from any view of it. */
	get stepping() {
		return this._stepping;
	}

	/**
	 * Run one undo or redo, and refuse a second while it is under way.
	 *
	 * ⚠ ONE STEP AT A TIME. A step PEEKS its entry, awaits a write to the document, and only then
	 * commits it. Two of them overlapping would both peek the SAME entry, apply the same reversal
	 * twice and commit twice: taking one change back and throwing a second away unread. Two presses
	 * land that close together easily enough: a double-press on the tool, a held key on a board whose
	 * write is waiting on the network, or an Undo in each of two views of this board.
	 *
	 * @param {Function} run  `() => Promise<boolean>`, the step itself.
	 * @returns {Promise<boolean>}  what `run` answered, or false without running it when a step is
	 *          already under way.
	 */
	async step(run) {
		if (this._stepping) return false;
		this._stepping = true;
		try {
			return await run();
		} finally {
			this._stepping = false;
		}
	}

	/** How many changes are remembered. For the tests and for nothing else. */
	get depth() {
		return this._back.length;
	}

	get canUndo() {
		return this._back.length > 0;
	}

	get canRedo() {
		return this._forward.length > 0;
	}

	/** What the next undo would take back, in the words it was announced in. Empty when there is
	 * nothing, which is what the button's own label falls back on. */
	get undoLabel() {
		return this._back[this._back.length - 1]?.label ?? "";
	}

	get redoLabel() {
		return this._forward[this._forward.length - 1]?.label ?? "";
	}

	/**
	 * Remember a change that has just landed.
	 *
	 * @param {{forward: RelmapStep, back: RelmapStep, label?: string, coalesce?: string}} change
	 *        `coalesce` is a key naming the GESTURE: a change carrying the same key as the one on
	 *        top of the stack, within `RELMAP_COALESCE_MS` of it, folds into that one rather than
	 *        becoming a step of its own, unless something has been undone since. See that constant.
	 * @returns {object|null}  the entry now on top, or null when there was nothing to record.
	 */
	record({ forward, back, label = "", coalesce = "" } = {}) {
		if (!forward || !back) return null;
		const at = this._now();
		const top = this._back[this._back.length - 1];
		// ⚠ NEVER INTO THE STEP BELOW AN UNDO. With something undone, the step on top is the one BELOW the
		// step just taken back, and it can still be inside its breath: caption a line, nudge somebody, undo
		// the nudge, recolour the line. Folded into the caption, the recolour would go back with it in one
		// press, where without the undo in between the nudge kept them two steps. So a change made after an
		// undo is always a step of its own, and recording it forgets what was undone, below.
		if (coalesce && !this._forward.length && top?.coalesce === coalesce && at - top.at < RELMAP_COALESCE_MS) {
			// ⚠ BOTH HALVES FOLD, IN OPPOSITE DIRECTIONS. One press has to get the reader back to
			// before the burst started, so the back half keeps the EARLIEST value of every field —
			// but a burst under one key is not one field, so the second write's back cannot simply
			// be thrown away. The forward half keeps the latest, so that a redo replays all of it.
			top.forward = mergeSteps(top.forward, forward);
			top.back = mergeBackSteps(top.back, back);
			top.label = label || top.label;
			top.at = at;
			this._changed();
			return top;
		}
		const entry = { forward, back, label, coalesce, at };
		this._back.push(entry);
		// The oldest falls off the end, which is what makes this bounded rather than a slow leak on
		// a table that leaves the window open all evening.
		while (this._back.length > this._max) this._back.shift();
		this._forward.length = 0;
		this._changed();
		return entry;
	}

	/** The change the next undo would take back, without taking it back. Peeked rather than popped
	 * because the write can fail — a reader whose ownership was lowered while the window was open —
	 * and a step popped off a stack it never left the document is a step nobody can press again. */
	peekUndo() {
		return this._back[this._back.length - 1] ?? null;
	}

	peekRedo() {
		return this._forward[this._forward.length - 1] ?? null;
	}

	/** The undo landed: move it across. */
	commitUndo() {
		const entry = this._back.pop();
		if (entry) {
			this._forward.push(entry);
			this._changed();
		}
		return entry ?? null;
	}

	/** And back again. */
	commitRedo() {
		const entry = this._forward.pop();
		if (entry) {
			this._back.push(entry);
			this._changed();
		}
		return entry ?? null;
	}

	clear() {
		this._back.length = 0;
		this._forward.length = 0;
		this._changed();
	}
}

/**
 * EVERY BOARD'S HISTORY, by the document that holds it.
 *
 * ⚠ KEYED BY THE DOCUMENT AND NOT HELD ON THE WINDOW, and that is the whole reason this is a
 * module-level map. One map is several named boards on several pages, and the reader flicks between
 * them with the tab strip — so a history on the window would be one stack shared by every board,
 * where undo means "take back whatever I last did, wherever I did it". Keyed here, each board keeps
 * its own, and closing the window and opening it again on the same board finds it still there.
 *
 * It lasts as long as the page is loaded and no longer. Nothing is written to any document.
 */
const HISTORIES = new Map();

/** This board's history, made the first time it is asked for. */
export function historyFor(doc) {
	const key = doc?.uuid;
	// A handle with no uuid is one nothing could ever find again; it gets a history of its own that
	// is thrown away with it, rather than sharing one under the key `undefined`.
	if (!key) return new RelmapHistory();
	let history = HISTORIES.get(key);
	if (!history) {
		history = new RelmapHistory();
		HISTORIES.set(key, history);
	}
	return history;
}

/** Forget one board's history, for a board that has been rubbed out. A step naming a page that no
 * longer exists is a step whose write would land nowhere. */
export function forgetHistory(doc) {
	if (doc?.uuid) HISTORIES.delete(doc.uuid);
}

/** Forget the lot. For the tests, so one file's stacks cannot reach another's. */
export function forgetAllHistory() {
	HISTORIES.clear();
}
