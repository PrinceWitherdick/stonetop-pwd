/**
 * WHICH Invocation the Lightbearer is holding open — the one they are concentrating on.
 *
 * The Invocations tab has always printed the rule ("While one Invocation is ongoing, you can't
 * use another. You can end an Invocation whenever you wish, and it will end immediately if your
 * holy light is extinguished") and nothing on the sheet ever recorded which one was running. Seven
 * of the ten Invocations are ongoing, so the two things that rule turns on — that reaching for a
 * second Invocation drops the first, and that a snuffed light drops it too — were exactly the two
 * nobody noticed, because the first one was never written down.
 *
 * A bare slug rather than an object, for holy-light.js's reason: setFlag deep-merges plain
 * objects, so a stored `{slug, label}` could only ever shed a key through the `-=` dance, while a
 * string is replaced wholesale. The printed name is not stored at all: it is looked up in the
 * playbook's own Invocation list, where it cannot go stale, and falls back to a prettified slug
 * for an Invocation stranded by a playbook swap.
 *
 * TWO SLOTS, each its own scalar flag (the same reason again). The first is the Invocation being
 * held; the second is filled only by the two moves that let a Lightbearer run two at once:
 *  - Burn Twice as Bright: "you may mark a debility to use 2 Invocations at once" (both at once,
 *    so both slots are written together).
 *  - an EMPOWERED Dancing Light: "you can use another Invocation through the Dancing Light while
 *    it is ongoing", so the next Invocation goes into the second slot and the Dancing Light keeps
 *    the first. That is why whether the first was empowered is stored beside it.
 * And one "snuff" stamp per slot: the Invoke consequence "the light is snuffed out when the
 * Invocation is complete" is paid when THAT Invocation ends, however it ends. The model honours it
 * (StonetopCharacter#setInvocationState); the stamp is written by whoever reads the consequence.
 *
 * Kept out of the sheet and the character model so the rules below can be tested without a
 * Foundry global in sight — the same split holy-light.js and condemn.js make.
 */

export const ONGOING_INVOCATION_FLAG = "ongoingInvocation";
/** The second running Invocation (Burn Twice as Bright, or one used through an empowered Dancing Light). */
export const ONGOING_SECOND_FLAG = "ongoingInvocationSecond";
/** The first slot's Invocation was used empowered. Only a Dancing Light reads it today. */
export const ONGOING_EMPOWERED_FLAG = "ongoingInvocationEmpowered";
/** Ending the first slot's Invocation also snuffs the holy light. */
export const ONGOING_SNUFF_FLAG = "ongoingInvocationSnuff";
/** Ending the second slot's Invocation also snuffs the holy light. */
export const ONGOING_SECOND_SNUFF_FLAG = "ongoingInvocationSecondSnuff";
/** Every flag the ongoing state is stored in, for whatever clears it wholesale (MOVE_STATE). */
export const ONGOING_INVOCATION_FLAGS = [
	ONGOING_INVOCATION_FLAG, ONGOING_SECOND_FLAG, ONGOING_EMPOWERED_FLAG,
	ONGOING_SNUFF_FLAG, ONGOING_SECOND_SNUFF_FLAG,
];

/**
 * The Invocations waiting on the sun: the Invoke consequence "You must bask in sunlight for an
 * hour or so before using that Invocation again". A list of slugs (an array, so a write replaces
 * it whole), under the `invocations` flag, so whatever clears that clears this too (MOVE_STATE).
 * A CUE and never a block: the player clears it when they have basked, and using the Invocation
 * again clears it as well (the sheet's invoke window has already said so).
 */
export const NEEDS_SUN_FLAG = "invocations.needsSun";

/** The stored list, normalised: unique, trimmed, non-empty slugs. */
export function readNeedsSun(raw) {
	return [...new Set((Array.isArray(raw) ? raw : []).map(readOngoing).filter(Boolean))];
}

export const DANCING_LIGHT = "dancing-light";

/**
 * Invocations that are instant as printed and ongoing when empowered. Cleansing Light's empowered
 * line: "the invocation is ongoing; while it lasts, any magical effects created in or brought into
 * range are dispelled/suppressed." A rule of the book, not of the data, so it lives here rather
 * than as a second `ongoing` field on the option.
 */
export const EMPOWERED_MAKES_ONGOING = new Set(["cleansing-light"]);

/**
 * Ongoing Invocations whose REDUCED effect is over almost at once, so a reduced one gives up its slot
 * the moment it is reduced instead of blocking the next Invocation until End it. Blinding Light: "the
 * light flares only for a moment". Cold Light of Day: "it lasts only a few moments, just long enough
 * to glimpse the truth". Like EMPOWERED_MAKES_ONGOING, a rule of the book kept beside the slots.
 */
export const REDUCED_IS_BRIEF = new Set(["blinding-light", "cold-light-of-day"]);

/**
 * Ongoing Invocations whose reduced effect MAY be brief, at the GM's say. Moth to a Flame: "it lasts
 * only briefly OR only some of the named creatures are affected (GM's choice)", so the card asks.
 */
export const REDUCED_GM_CHOICE = new Set(["moth-to-a-flame"]);

/**
 * What a reduced effect does to the ongoing slots, for the Invocations a card names (`slugs`, two
 * under Burn Twice as Bright): `brief`, the running ones it ends at once, and `ask`, the running ones
 * the GM decides. Only what is running counts: an Invocation already ended has no slot to give up.
 */
export function reducedEndings({ current, slugs } = {}) {
	const running = new Set(runningSlugs(current));
	const named = [...new Set((slugs ?? []).map(readOngoing))].filter(s => running.has(s));
	return { brief: named.filter(s => REDUCED_IS_BRIEF.has(s)), ask: named.filter(s => REDUCED_GM_CHOICE.has(s)) };
}

/** The stored slug, normalised. "" means nothing is being concentrated on. */
export function readOngoing(raw) {
	return typeof raw === "string" ? raw.trim() : "";
}

/** Is this use of an Invocation an ongoing one? `{slug, ongoing, empowered}`. */
export function usesOngoing(used) {
	return !!used?.ongoing || (!!used?.empowered && EMPOWERED_MAKES_ONGOING.has(readOngoing(used?.slug)));
}

/**
 * The whole ongoing state, normalised: `{primary, second, empowered, snuff, secondSnuff}`. Takes
 * either that shape or a bare slug (the one-slot callers). A second slot with no first is promoted
 * into the first, and a second that repeats the first is dropped, so no reader has to ask.
 */
export function readInvocationState(raw) {
	const src = typeof raw === "string" ? { primary: raw } : (raw ?? {});
	let primary = readOngoing(src.primary);
	let second  = readOngoing(src.second);
	let snuff = !!src.snuff, secondSnuff = !!src.secondSnuff, empowered = !!src.empowered;
	if (!primary && second) {
		primary = second; snuff = secondSnuff; second = ""; secondSnuff = false; empowered = false;
	}
	if (second === primary) { second = ""; secondSnuff = false; }
	if (!primary) { snuff = false; empowered = false; }
	return { primary, second, empowered, snuff, secondSnuff };
}

/** The slugs running, first slot first. */
export function runningSlugs(state) {
	const s = readInvocationState(state);
	return [s.primary, s.second].filter(Boolean);
}

/** Is an empowered Dancing Light holding the first slot, so another Invocation can go through it? */
export function carriesAnother(state) {
	const s = readInvocationState(state);
	return s.primary === DANCING_LIGHT && s.empowered;
}

/** What is running in `before` and not in `after`, and whether any of those carried a snuff stamp. */
export function invocationEndings(before, after) {
	const b = readInvocationState(before);
	const kept = new Set(runningSlugs(after));
	const slots = [[b.primary, b.snuff], [b.second, b.secondSnuff]];
	const ended = slots.filter(([slug]) => slug && !kept.has(slug));
	return { ended: ended.map(([slug]) => slug), snuffs: ended.some(([, snuff]) => snuff) };
}

const _sameState = (a, b) => ["primary", "second", "empowered", "snuff", "secondSnuff"].every(k => a[k] === b[k]);

// The words a title keeps lowercase unless they lead. Enough to reproduce all ten printed names
// from their slugs ("go-back-to-the-shadow" → "Go Back to the Shadow"), which is the only job:
// this is the fallback for a slug whose playbook is no longer on the sheet, not a general
// title-caser.
const MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on",
	"or", "the", "to", "with"]);

/**
 * "hold-back-the-darkness" → "Hold Back the Darkness".
 *
 * Only ever reached when the label can't be looked up — a Lightbearer whose playbook was swapped
 * away mid-Invocation still has to be able to READ what they are holding in order to end it, and
 * a raw slug in the header is not that.
 */
export function prettifySlug(slug) {
	return readOngoing(slug)
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((word, i) => (i > 0 && MINOR_WORDS.has(word) ? word : word[0].toUpperCase() + word.slice(1)))
		.join(" ");
}

/**
 * The printed name of an Invocation, given the playbook's option list. "" for no slug at all, so
 * callers can use the result as both the label and the "is anything running" test.
 */
export function invocationLabel(slug, options) {
	const wanted = readOngoing(slug);
	if (!wanted) return "";
	const match = (options ?? []).find(opt => opt?.slug === wanted);
	return match?.label || prettifySlug(wanted);
}

/** Several Invocations' printed names as one phrase: "Warmth of the Sun and Blinding Light". */
export function invocationLabels(slugs, options, joiner = " and ") {
	return (slugs ?? []).map(slug => invocationLabel(slug, options)).filter(Boolean).join(joiner);
}

// A slot keeps its snuff stamp while the same Invocation stays in it: renewing is not ending.
const _stampOf = (state, slug) =>
	(slug && slug === state.primary && state.snuff) || (slug && slug === state.second && state.secondSnuff) || false;

/**
 * What USING an Invocation does to the ongoing slots.
 *
 * `current` is the stored state (readInvocationState's shape, or a bare slug). `used` is
 * `{slug, ongoing, empowered, also}`, where `also` is the second Invocation of a Burn Twice as
 * Bright (`{slug, ongoing}`; "apply any consequences to both", so it is empowered with the first).
 *
 * Every Invocation clears the slots, not just the ongoing ones: "while one Invocation is ongoing,
 * you can't use another" is a bar on using any second Invocation at all, so casting an instant one
 * means the ongoing ones were let go first. Only an ongoing Invocation fills a slot again. The two
 * exceptions are the two moves that run two at once:
 *  - Burn Twice as Bright fills both slots at once (each only if it is ongoing).
 *  - an empowered Dancing Light in the first slot KEEPS it, and the Invocation used goes through
 *    it into the second slot (replacing whatever was there). Re-invoking the Dancing Light
 *    empowered keeps the second too; re-invoking it plain lets the second go.
 *
 * `ended` lists what actually STOPPED, and is deliberately empty when the same Invocation is used
 * again: renewing the one you are already holding does not drop it and pick it back up, and a
 * chat line saying it ended in the same breath as its own card would read as a bug. `snuffs` is
 * whether any of those carried the "light is snuffed" stamp.
 */
export function resolveInvocationUse({ current, used } = {}) {
	const before = readInvocationState(current);
	const slug   = readOngoing(used?.slug);
	const emp    = !!used?.empowered;
	const on     = !!slug && usesOngoing(used);
	const also   = readOngoing(used?.also?.slug);
	let after;
	if (!slug) {
		after = before;
	} else if (also && also !== slug) {
		const pair = [[slug, on], [also, usesOngoing({ ...used.also, empowered: emp })]].filter(([, going]) => going).map(([s]) => s);
		after = { primary: pair[0] ?? "", second: pair[1] ?? "", empowered: emp,
			snuff: _stampOf(before, pair[0]), secondSnuff: _stampOf(before, pair[1]) };
	} else if (carriesAnother(before) && slug !== DANCING_LIGHT) {
		after = { ...before, second: on ? slug : "", secondSnuff: on && _stampOf(before, slug) };
	} else {
		const keepSecond = on && emp && slug === DANCING_LIGHT && before.primary === DANCING_LIGHT;
		after = { primary: on ? slug : "", empowered: on && emp, snuff: on && _stampOf(before, slug),
			second: keepSecond ? before.second : "", secondSnuff: keepSecond && before.secondSnuff };
	}
	after = readInvocationState(after);
	return { next: after.primary, second: after.second, empowered: after.empowered, state: after,
		...invocationEndings(before, after), changed: !_sameState(before, after) };
}

/**
 * What ENDING one running Invocation does (End it, on the chip or the banner). `ending` is the slug
 * to end; "" or absent ends everything.
 *
 * Ending the first slot promotes the second into it (the other half of a Burn Twice keeps going),
 * except when the first is an empowered Dancing Light: the second was going THROUGH it, so it goes
 * out with it.
 */
export function resolveInvocationEnd({ current, ending = "" } = {}) {
	const before = readInvocationState(current);
	const slug = readOngoing(ending);
	let after;
	if (!slug) after = readInvocationState({});
	else if (slug === before.primary) {
		after = carriesAnother(before)
			? readInvocationState({})
			: readInvocationState({ primary: before.second, snuff: before.secondSnuff, empowered: false });
	} else if (slug === before.second) after = { ...before, second: "", secondSnuff: false };
	else after = before;
	after = readInvocationState(after);
	return { state: after, ...invocationEndings(before, after), changed: !_sameState(before, after) };
}

/**
 * What the invoke window has to say BEFORE the roll, as a kind plus the name at stake — the
 * sentences themselves belong with the window's other copy, and the label has to be escaped by
 * whoever builds that HTML.
 *
 * Null when there is nothing to warn about: an instant Invocation used by a Lightbearer holding
 * nothing open changes no state and needs no line.
 *
 * `through` is the empowered Dancing Light carrying this one: nothing ends but the second slot's
 * Invocation, named in `ending` when there is one.
 */
export function invokeNotice({ current, used, options } = {}) {
	const before  = readInvocationState(current);
	const slug    = readOngoing(used?.slug);
	const on      = usesOngoing(used);
	const running = runningSlugs(before);
	if (!running.length) return on ? { kind: "start", ending: "" } : null;
	if (carriesAnother(before) && slug !== DANCING_LIGHT) {
		if (on && slug === before.second) return { kind: "renew", ending: invocationLabel(slug, options) };
		return { kind: "through", ending: invocationLabel(before.second, options) };
	}
	if (on && running.includes(slug)) {
		const others = running.filter(s => s !== slug);
		if (!others.length) return { kind: "renew", ending: invocationLabel(slug, options) };
		return { kind: "replace", ending: invocationLabels(others, options) };
	}
	// "replace" swaps one held Invocation for another; "interrupt" spends it on an instant one and
	// leaves the Lightbearer holding nothing. Two kinds because the second is the one that
	// surprises people — the Invocation they lose isn't replaced by anything.
	return { kind: on ? "replace" : "interrupt", ending: invocationLabels(running, options) };
}

/**
 * The invoke window's notice for what is ticked in it NOW: invokeNotice's `{kind, ending}`, worked
 * out for the tapped Invocation as the window would use it. Re-read on every change to the window
 * (the sheet's _promptInvokeInvocation), because two of its controls change the answer:
 *  - `empower`: an empowered Cleansing Light is ongoing (EMPOWERED_MAKES_ONGOING), so ticking the
 *    box turns "nothing to say" into "you'll be concentrating on it", or "lets it go" into "ends it".
 *  - `partner` (`{slug, ongoing}`, or null): Burn Twice as Bright's second Invocation fills the slots
 *    beside the first (resolveInvocationUse), so what ends is what the PAIR does not keep.
 *
 * `used` is `{slug, ongoing}` as on the tapped card. Null when there is nothing to say.
 */
export function invokeWindowNotice({ current, used, empower = false, partner = null, options } = {}) {
	const slug = readOngoing(used?.slug);
	const also = readOngoing(partner?.slug);
	const one  = { slug, ongoing: !!used?.ongoing, empowered: !!empower };
	if (!also || also === slug) return invokeNotice({ current, used: one, options });
	const before = readInvocationState(current);
	const use = resolveInvocationUse({ current: before, used: { ...one, also: { slug: also, ongoing: !!partner.ongoing } } });
	const after = runningSlugs(use.state);
	if (use.ended.length) return { kind: after.length ? "replace" : "interrupt", ending: invocationLabels(use.ended, options) };
	if (!after.length) return null;
	// Nothing ends: either the pair only renews what is already held, or it takes hold of something new.
	// The single "start" line says "this one", which reads wrong for two: a pair names what it holds,
	// both ("startPair") or the one of them that is ongoing ("startOne").
	const held = new Set(runningSlugs(before));
	if (after.every(s => held.has(s))) return { kind: "renew", ending: invocationLabels(after, options) };
	return { kind: after.length > 1 ? "startPair" : "startOne", ending: invocationLabels(after, options) };
}
