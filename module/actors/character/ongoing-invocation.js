/**
 * WHICH Invocation the Lightbearer is holding open — the one they are concentrating on.
 *
 * The Invocations tab has always printed the rule ("While one Invocation is ongoing, you can't
 * use another. You can end an Invocation whenever you wish, and it will end immediately if your
 * holy light is extinguished") and nothing on the sheet ever recorded which one was running. Six
 * of the ten Invocations are ongoing, so the two things that rule turns on — that reaching for a
 * second Invocation drops the first, and that a snuffed light drops it too — were exactly the two
 * nobody noticed, because the first one was never written down.
 *
 * ONE SLOT, and a bare slug rather than an object, for holy-light.js's reason: setFlag
 * deep-merges plain objects, so a stored `{slug, label}` could only ever shed a key through the
 * `-=` dance, while a string is replaced wholesale. The printed name is not stored at all — it is
 * looked up in the playbook's own Invocation list, where it cannot go stale, and falls back to a
 * prettified slug for an Invocation stranded by a playbook swap.
 *
 * Kept out of the sheet and the character model so the rules below can be tested without a
 * Foundry global in sight — the same split holy-light.js and condemn.js make.
 */

export const ONGOING_INVOCATION_FLAG = "ongoingInvocation";

/** The stored slug, normalised. "" means nothing is being concentrated on. */
export function readOngoing(raw) {
	return typeof raw === "string" ? raw.trim() : "";
}

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

/**
 * What USING an Invocation does to the ongoing slot.
 *
 * Every Invocation clears the slot, not just the ongoing ones: "while one Invocation is ongoing,
 * you can't use another" is a bar on using any second Invocation at all, so casting an instant one
 * means the ongoing one was let go first. Only an ongoing Invocation fills the slot again.
 *
 * `ended` is what actually STOPPED, and is deliberately empty when the same Invocation is used
 * again: renewing the one you are already holding does not drop it and pick it back up, and a
 * chat line saying it ended in the same breath as its own card would read as a bug.
 */
export function resolveInvocationUse({ current, used } = {}) {
	const now  = readOngoing(current);
	const slug = readOngoing(used?.slug);
	const next = used?.ongoing && slug ? slug : "";
	return {
		next,
		ended:   now && now !== next ? now : "",
		changed: next !== now,
	};
}

/**
 * What the invoke window has to say BEFORE the roll, as a kind plus the name at stake — the
 * sentences themselves belong with the window's other copy, and the label has to be escaped by
 * whoever builds that HTML.
 *
 * Null when there is nothing to warn about: an instant Invocation used by a Lightbearer holding
 * nothing open changes no state and needs no line.
 */
export function invokeNotice({ current, used, options } = {}) {
	const now  = readOngoing(current);
	const slug = readOngoing(used?.slug);
	const on   = !!used?.ongoing;
	if (!now) return on ? { kind: "start", ending: "" } : null;
	const ending = invocationLabel(now, options);
	if (now === slug && on) return { kind: "renew", ending };
	// "replace" swaps one held Invocation for another; "interrupt" spends it on an instant one and
	// leaves the Lightbearer holding nothing. Two kinds because the second is the one that
	// surprises people — the Invocation they lose isn't replaced by anything.
	return { kind: on ? "replace" : "interrupt", ending };
}
