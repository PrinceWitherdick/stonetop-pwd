// Identifying artifacts — Book I, Discoveries pp.430-431.
//
// "When the PCs find an artifact, describe it! Tell them what they've found, and what's obvious
// at a glance… If there is more to the artifact, then make that clear as part of your
// description, or hint at more than meets the eye, or just offer an opportunity to learn more."
//
// The two rolls the book names:
//   "If they Seek Insight about the artifact, resolve the move! On a 7+, answer their
//    question(s) honestly and helpfully, with as much detail as the situation warrants."
//   "If they Know Things about the artifact and get a 7+, then tell them some combo of what it
//    is, what it does, what it's worth, how they might activate it or sell it for its full
//    value, or how they might learn more. If the artifact has a custom move, then maybe you'd
//    give them some inkling of what it does on a 7-9, and give them the move's full text on a
//    10+."
// And the settlement: "Once a PC figures an artifact out, give the player its tags, write-up,
// and any custom moves, etc."
//
// Pure and Foundry-free: the ladder, the concealment rule and the card text are unit-testable
// on their own; the sheet does the DOM, the rolls and the document writes. Arcana are the
// SEPARATE ladder on p.440 (see arcana-identify.js) — this one never touches an arcanum.

/**
 * An artifact's identification state, stored on the item as `system.identifyState`.
 *
 * NONE is the resting state of every ordinary piece of gear AND of an artifact the GM never
 * bothered to hide — nothing is concealed, so nothing about the row changes. It has to be the
 * empty string: a StringField initialises to "" and every item in every existing world already
 * reads that way, so "no hidden artifact here" must be what "" means.
 */
export const ARTIFACT_STATE = Object.freeze({
	NONE:    "",
	UNKNOWN: "unknown",   // found, described, not yet figured out
	PARTIAL: "partial",   // a 7-9: what it is and what it's worth; the full write-up still owed
	KNOWN:   "known",     // a 10+, or the GM simply handing it over
});

const ORDER = { "": 0, unknown: 1, partial: 2, known: 3 };

/** Every state a stored value may legally hold; anything else reads as NONE. */
export function normalizeArtifactState(state) {
	return Object.hasOwn(ORDER, state ?? "") ? (state ?? "") : ARTIFACT_STATE.NONE;
}

/** Is this item an artifact whose nature the character hasn't fully worked out? */
export function isConcealedArtifact(state) {
	const s = normalizeArtifactState(state);
	return s === ARTIFACT_STATE.UNKNOWN || s === ARTIFACT_STATE.PARTIAL;
}

/**
 * Does `next` tell the character MORE than `current` does?
 *
 * Identification only ever moves forward on its own. The Logbook's "treat the result as a 10+"
 * and a GM Shift both rewrite a settled roll card, and re-applying a weak hit over a strong one
 * would take back a write-up the player has already read. Only the GM's own hand-over control
 * moves an artifact backwards, and it does so by setting the state outright.
 */
export function isArtifactUpgrade(current, next) {
	return ORDER[normalizeArtifactState(next)] > ORDER[normalizeArtifactState(current)];
}

/**
 * Which state a Know Things roll about an artifact settles on.
 *
 * 10+ and 7-9 both "tell them some combo of what it is, what it does, what it's worth" — the
 * book draws its line between them at the write-up and the custom move, so both hits reveal the
 * tags and Value and only the strong hit hands over the full text. A 6- deliberately settles
 * nothing: the book's answer there is a path toward learning more, which is the GM's to name.
 * `critical` is this system's 12+ label, which p.430 doesn't distinguish from a 10+.
 */
export function artifactStateForTier(tier) {
	if (tier === "success" || tier === "critical") return ARTIFACT_STATE.KNOWN;
	if (tier === "partial") return ARTIFACT_STATE.PARTIAL;
	return null;
}

/**
 * What the sheet may show about an artifact, given its state and who's looking.
 *
 * The concealed fields are exactly the ones the book withholds until a PC figures the artifact
 * out — "give the player its tags, write-up, and any custom moves". So:
 *
 *   note      the tags-and-Value parenthetical ("fragile, magical, Value 3"). Hidden while
 *             UNKNOWN, shown from PARTIAL on: a 7+ tells them "what it is… what it's worth".
 *   resource  the ○ uses track. Hidden with the note and for the same reason — knowing a thing
 *             has three charges left is knowing what it does.
 *   lore      the GM's fuller write-up and any custom move. Shown only at KNOWN, the 10+'s
 *             "give them the move's full text".
 *   hint      the GM's "more than meets the eye" line. Shown while anything is still hidden;
 *             it's what stands in for the note on the row, so it must vanish at KNOWN or the
 *             row would carry both the tease and the answer.
 *   lead      "how they could learn more" (p.431). Same visibility as the hint.
 *
 * The ◇ load is NEVER concealed. p.428 has the PCs "accounting for its load" the moment they
 * pick the thing up — you can feel how heavy a thing is without knowing what it is — and a
 * hidden weight would silently mis-state encumbrance, which is a mechanical readout the player
 * is entitled to.
 *
 * The GM sees everything, always: they wrote it. `viewerIsGM` defaults false so a caller that
 * forgets to say conceals rather than leaks.
 */
export function artifactVisibility(state, { viewerIsGM = false } = {}) {
	const s = normalizeArtifactState(state);
	if (s === ARTIFACT_STATE.NONE) {
		return { concealed: false, showNote: true, showResource: true, showLore: true, showHint: false, showLead: false };
	}
	const known    = s === ARTIFACT_STATE.KNOWN;
	const unknown  = s === ARTIFACT_STATE.UNKNOWN;
	const reveal   = known || viewerIsGM;
	return {
		concealed:    !known,
		showNote:     reveal || !unknown,
		showResource: reveal || !unknown,
		showLore:     reveal,
		showHint:     !known,
		showLead:     !known,
	};
}

/**
 * Apply {@link artifactVisibility} to one inventory row's fields.
 *
 * Returns the row's visible `{ note, resource, hint, lore, lead }` plus the flags the template
 * needs. Concealment happens HERE rather than in the template so a hidden note never reaches
 * the DOM at all — the same posture the arcana card takes with a locked back.
 */
export function concealArtifactFields(fields = {}, { viewerIsGM = false } = {}) {
	const state = normalizeArtifactState(fields.state);
	const vis   = artifactVisibility(state, { viewerIsGM });
	return {
		state,
		isArtifact:  state !== ARTIFACT_STATE.NONE,
		concealed:   vis.concealed,
		// A GM looking at a concealed artifact sees the real note and needs telling that the
		// player does not. The template paints the row differently on this flag alone.
		gmPeeking:   vis.concealed && viewerIsGM,
		loreOwed:    state === ARTIFACT_STATE.PARTIAL,
		note:        vis.showNote     ? (fields.note ?? null)     : null,
		resource:    vis.showResource ? (fields.resource ?? null) : null,
		lore:        vis.showLore     ? (fields.lore ?? "")       : "",
		hint:        vis.showHint     ? (fields.hint ?? "")       : "",
		lead:        vis.showLead     ? (fields.lead ?? "")       : "",
	};
}

// ── Roll card text ────────────────────────────────────────────────────────────
// English literals, not localised: the flavor string is PERSISTED on the chat message and
// re-parsed by the GM's Shift Up/Down (see roll-engine.js `_shiftRollCardFlavor`), so it has to
// read the same way on every client and after every reload.

/** The three tiers of a Know Things roll aimed at an artifact (p.430). */
export function knowThingsArtifactResults() {
	return {
		success: "You work it out: what it is, what it does, what it's worth, how to use it or sell it for full value. The GM gives you its tags, its write-up, and any custom move in full.",
		partial: "You learn what it is and roughly what it's worth: its tags. Of what it truly does you get only an inkling, and the full write-up is still owed.",
		failure: "The GM tells you nothing useful about it, but names a path: who would know, what you'd need, or where to look.",
	};
}

/** The three tiers of a Seek Insight aimed at an artifact (p.430). */
export function seekInsightArtifactResults() {
	return {
		success: "Ask the GM 3 questions about the artifact from the list. They answer honestly and helpfully. Gain advantage on your next move that acts on the answers.",
		partial: "Ask the GM 1 question about the artifact from the list. They answer honestly and helpfully. Gain advantage on your next move that acts on the answers.",
		failure: "You're interrupted or surprised as you study it, or trouble announces itself.",
	};
}

/**
 * The Seek Insight question list, with the two the book's own worked example turns on the
 * artifact appended. p.430 resolves the move as written — the standard list — and its example
 * answers "What should you be on the lookout for?" about the urn; the last two here are that
 * same list read as questions about a thing rather than a place.
 */
export const ARTIFACT_INSIGHT_QUESTIONS = Object.freeze([
	"What happened here recently?",
	"What is about to happen?",
	"What should I be on the lookout for?",
	"What here is useful or valuable to me?",
	"Who or what is really in control here?",
	"What here is not what it appears to be?",
]);

/**
 * p.431's list of ways to give the PCs a path forward when they can't figure an artifact out
 * now. Offered to the GM as the suggestions behind the "how they could learn more" field, so
 * the miss tier has somewhere to land other than a chat message that scrolls away.
 */
export const ARTIFACT_LEAD_SUGGESTIONS = Object.freeze([
	"Name the requirements: who knows about this, or what you'd need to consult",
	"Make a Plan together to learn what it is or does",
	"Divulge it in a love letter",
	"Reveal it after a bit of downtime, then ask the player how their PC learned it",
	"Some combination of the above",
]);
