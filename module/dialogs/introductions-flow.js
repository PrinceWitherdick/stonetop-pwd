// ── Character Introductions: answer/ask step flow (pure core) ───────────────────
// The looping "go around again" answer step (step4) and ask step (step6) cycle the
// table until every PC has either passed or answered all of their playbook's
// questions. This module holds that round-robin/done logic as pure functions so it
// can be unit-tested without a running Foundry — IntroductionsDialog.js and the GM's
// step-advance detection both call in. A PC's per-step record is
// { answers: [{q,a}], passed } (see the introductionsAnswers / flags.stonetop-pwd.intro
// shapes); `total` is that playbook's question count for the step (4).

// Is a PC finished with a step? Done when they passed, when they've answered every
// question, or when the step has no questions to offer them (defensive — every
// playbook has four, but a PC with none can neither answer nor be exhausted, so treat
// them as done rather than letting them trap the loop forever).
export function stepPcDone(step, total) {
	if (!Number.isFinite(total) || total <= 0) return true;
	const answers = Array.isArray(step?.answers) ? step.answers : [];
	return !!step?.passed || answers.length >= total;
}

// The next still-active PC index at or after `fromIndex` (exclusive), cycling with
// wrap-around, or -1 when everyone is done. `isDone(idx)` reports whether the PC at
// idx has finished the step. When only the current PC is still active it returns that
// same index (the turn stays on them until they answer or pass).
export function nextActiveIndex(fromIndex, count, isDone) {
	if (count <= 0) return -1;
	for (let s = 1; s <= count; s++) {
		const idx = (fromIndex + s) % count;
		if (!isDone(idx)) return idx;
	}
	return -1;
}

// The first still-active PC index (for parking the cursor when a step opens), or -1
// when everyone is already done.
export function firstActiveIndex(count, isDone) {
	for (let i = 0; i < count; i++) if (!isDone(i)) return i;
	return -1;
}

// The nearest still-active PC index BEFORE `fromIndex`, walking back without wrapping, or -1
// when every earlier PC is done. What Back steps to inside a looping step: a PC who has passed
// or answered everything has no turn to go back to, and landing on one summoned their player
// to a window with nothing for them to do.
export function prevActiveIndex(fromIndex, isDone) {
	for (let i = fromIndex - 1; i >= 0; i--) if (!isDone(i)) return i;
	return -1;
}

// The last still-active PC index, or -1 when everyone is done. Where Back lands on stepping
// into a looping step from the one after it.
export function lastActiveIndex(count, isDone) {
	for (let i = count - 1; i >= 0; i--) if (!isDone(i)) return i;
	return -1;
}

// ── A step's recorded answers, rewritten whole ─────────────────────────────────
// The list lives on an actor flag and is always written as a whole array (a flag merge cannot
// drop an element), so each change is a pure function from the old list to the new one.

// The list with one more answer recorded. An answer to a question that is ALREADY in the list
// replaces that answer instead of joining it: a question is answered once per step (the picker
// grays out a used one), so a second record for it can only be the first coming back, from a
// draft write that landed just after the answer was recorded. Appending it is what double-
// recorded answers. An answer with no question (null) is always appended.
export function withRecordedAnswer(answers, entry) {
	const list = Array.isArray(answers) ? [...answers] : [];
	const at = Number.isInteger(entry?.q) ? list.findIndex(x => x?.q === entry.q) : -1;
	if (at >= 0) list[at] = entry;
	else list.push(entry);
	return list;
}

// The list with the answer at `index` reworded (its question and who it is about kept), or
// null when there is no such answer or the new wording is blank (that is a delete, not an edit).
export function withAnswerEdited(answers, index, text) {
	const list = Array.isArray(answers) ? [...answers] : [];
	const a = String(text ?? "").trim();
	if (!Number.isInteger(index) || !list[index] || !a) return null;
	list[index] = { ...list[index], a };
	return list;
}

// The list without the answer at `index`, or null when there is no such answer.
export function withoutAnswer(answers, index) {
	const list = Array.isArray(answers) ? [...answers] : [];
	if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
	list.splice(index, 1);
	return list;
}

// ── Follower reaction to a cursor write ────────────────────────────────────────
// The GM authors the world cursor; every other client reacts to it. Deciding WHAT to
// do — open, repaint, raise, announce — is pure, so it lives here with the rest of the
// flow logic and IntroductionsDialog.handleIntroCursor is left as a thin adapter.

// The part of a cursor that decides whether a repaint is worth interrupting someone
// mid-sentence for. THREE fields, and the omissions are the point:
//   • `nonce`/`showNonce` exist only to make an otherwise-identical write fire onChange
//     at all, so they never mean the screen changed.
//   • `pcOrder` is the ROSTER, not the turn. It churns on its own during session zero —
//     _syncCursorFromLocal's no-op guard counts it, so every PC added to or dropped from
//     a running session rewrites the cursor, and none of that reaches the capture field the active player
//     is writing in. Excluding it is what stops a roster reshuffle eating their sentence;
//     their turn strip just refreshes on the next repaint instead.
// `activeUserId` IS included: it decides who may edit, so a change there has to reach the
// screen even mid-word (the field may need to go read-only).
export function cursorPositionKey(cursor = {}) {
	return [cursor.phase, cursor.activeActorId, cursor.activeUserId].join("|");
}

/**
 * What a follower client should do about a cursor write.
 *
 * One turn attracts SEVERAL cursor writes — a roster reshuffle as another player commits
 * a playbook, the active PC's owner going idle and back, the GM's "Show players" — and
 * every one of them used to repaint and re-raise the dialog on the active player's screen.
 * A repaint rebuilds the capture textarea from the last SAVED value, so a player typing
 * mid-word watched their sentence snap back to where the autosave had got to. Hence the
 * two gates below: repaint only when the screen is genuinely out of date, and raise only
 * on a real hand-off.
 *
 * @param {object}       args.cursor         The cursor just written.
 * @param {string|null}  args.prevKey        The position key this client last applied.
 * @param {string}       args.userId         This client's user id.
 * @param {boolean}      args.isRoundRobin   Is cursor.phase one the active PC authors?
 * @param {boolean}      args.hasDialog      Is the dialog open on this client?
 * @param {boolean}      args.typing         Is the caret inside that open dialog?
 * @param {number|null}  args.lastShowNonce  Highest "Show players" nonce already honoured.
 * @param {string|null}  args.lastTurnKey    Turn this client last announced.
 * @returns {{close: boolean, open: boolean, render: boolean, raise: boolean, toast: boolean,
 *           positionKey: string, turnKey: string|null, showNonce: number|null}}
 *          `positionKey`/`turnKey`/`showNonce` are the caller's new bookkeeping values.
 */
export function cursorReaction({
	cursor = {}, prevKey = null, userId = "", isRoundRobin = false,
	hasDialog = false, typing = false, lastShowNonce = null, lastTurnKey = null,
} = {}) {
	const positionKey = cursorPositionKey(cursor);

	// Session over: every follower's dialog closes and the turn bookkeeping resets.
	if (!cursor.active) {
		return { close: true, open: false, render: false, raise: false, toast: false,
			positionKey, turnKey: null, showNonce: lastShowNonce };
	}

	const myTurn = !!userId && cursor.activeUserId === userId && isRoundRobin;
	// "Show players" force-summons the dialog even for someone who closed it, and even
	// off-turn. Only a NEW nonce forces, so an ordinary turn write never does.
	const forceShow = Number.isInteger(cursor.showNonce)
		&& cursor.showNonce > (Number.isInteger(lastShowNonce) ? lastShowNonce : -1);

	// A turn lands once. Keyed on phase+PC so the repeated writes within a single turn
	// don't re-announce it, and cleared whenever it isn't this player's turn so the next
	// hand-off — including a later turn on the same PC in a looping step — announces again.
	const turnKey = myTurn ? `${cursor.phase}:${cursor.activeActorId}` : null;
	const newTurn = !!turnKey && turnKey !== lastTurnKey;

	return {
		close: false,
		// Nothing on screen yet: pop it on this player's turn, or when the GM force-shows.
		open:  !hasDialog && (myTurn || forceShow),
		// A move HAS to repaint even mid-sentence — the turn may just have ended — and the
		// dialog flushes the field to its flag before rebuilding, so nothing typed is lost.
		// A same-position bump carries nothing new, so it defers to whoever is typing.
		render: hasDialog && (positionKey !== prevKey || forceShow || !typing),
		raise:  hasDialog && (newTurn || forceShow),
		toast:  newTurn,
		positionKey,
		turnKey,
		showNonce: forceShow ? cursor.showNonce : lastShowNonce,
	};
}

// How many turns until the still-active PC at `targetIndex` comes up, cycling forward
// from `fromIndex` (the current turn) and skipping any PC that `isDone`. Returns 0 when
// the target IS the current turn, N when it's N active-turns away, or -1 when the target
// is itself done (nothing more this step) or the roster is empty. Powers the player-side
// "you're up in N turns" hint on the looping answer/ask steps.
export function turnsUntilActive(fromIndex, targetIndex, count, isDone) {
	if (count <= 0 || targetIndex < 0) return -1;
	if (isDone(targetIndex)) return -1;
	if (targetIndex === fromIndex) return 0;
	for (let s = 1, turns = 0; s <= count; s++) {
		const idx = (fromIndex + s) % count;
		if (isDone(idx)) continue;
		turns++;
		if (idx === targetIndex) return turns;
	}
	return -1;
}
