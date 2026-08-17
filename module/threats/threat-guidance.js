// The Threats chapter's prep guidance, condensed for the tab that holds the cards
// (Book I, "Threats", pp. 277-299).
//
// Reference only. Nothing here rolls, nothing is stored, and nothing here reads a threat:
// these are the questions the chapter tells a GM to ask while writing one up and while
// reviewing them between sessions, boiled down to the operative line so they can sit under
// the cards and be glanced at rather than read. The book itself is where the discussion,
// the worked Sajra example and the sample threats live, so every section carries the page
// its advice comes from and none of them try to replace it.
//
// The house shape is the one gm-moves.js already uses: a short name, then one line on what
// it looks like at the table. Same reason, too. A GM reaches for this mid-sentence.
//
// Order within each section is the chapter's, which is a working order rather than an
// alphabetical one: the steps run most important first, and the review checklist runs in
// the order you would actually walk a card.

/**
 * @typedef {object} GuidanceItem
 * @property {string} name   The prompt, as short as it can be said.
 * @property {string} gloss  One line on what answering it looks like.
 */

/**
 * The write-up steps (p.282).
 *
 * `optional` marks the tail the chapter explicitly calls optional, which is the load-bearing
 * part of the list: a threat with nothing but a name, a type, a tracker and an instinct is a
 * finished threat, and a GM who reads all eight as required writes four times the prep the
 * game asks for.
 *
 * @type {ReadonlyArray<GuidanceItem & {optional?: boolean}>}
 */
export const THREAT_WRITEUP_STEPS = Object.freeze([
	{ name: "Name it, and pick its type",   gloss: "If the type isn't obvious, skim each one's moves and take the closest fit." },
	{ name: "Put it on a tracker",          gloss: "Homefront, Nearby or Distant, by where it sits relative to town." },
	{ name: "Give it an instinct",          gloss: "Reuse the one it already has as a monster or a danger, unless it has changed." },
	{ name: "Write a quick description",    gloss: "Who it is, how it became a problem, and what it is tied to. Notes to yourself, nothing more." },
	{ name: "If it has momentum, write its doom", gloss: "Ask \"where is this going?\", then 2 to 4 grim portents on the way there." },
	{ name: "Stakes questions",             gloss: "Things about its future you are genuinely curious about.", optional: true },
	{ name: "GM moves",                     gloss: "Anything it can or will do that its type's list doesn't already cover.", optional: true },
	{ name: "Custom player moves",          gloss: "Only if the threat changes what the PCs can do. Most don't.", optional: true },
]);

/**
 * The four moments the chapter says to write a threat up (pp. 280-281), plus the caution that
 * frames them: threats are PREP. They are written between sessions, because writing one makes
 * binding decisions about the world, and that is not a thing to do at the table.
 *
 * @type {ReadonlyArray<GuidanceItem>}
 */
export const THREAT_WRITEUP_MOMENTS = Object.freeze([
	{ name: "After introductions",      gloss: "Comb the first session's notes for the problems the players themselves put in the world." },
	{ name: "When the Seasons Change",  gloss: "A roll that worsens a threat, or says threats abound, is asking you for one." },
	{ name: "After a session",          gloss: "Anything introduced in play that could sour later. Write it while it is fresh." },
	{ name: "When prepping an adventure", gloss: "You already know what is coming and roughly what it looks like. Put it on paper first." },
]);

/**
 * The line that decides whether a thing is a threat at all (p.278). A KEY, not the sentence:
 * it is a standing caution over the whole "when" section rather than one of its prompts, which
 * puts it on the chrome side of the split described on THREAT_GUIDANCE_SECTIONS below.
 */
export const THREAT_WRITEUP_CAUTION = "stonetop.gmToolkit.threats.guide.whenCaution";

/**
 * Grim portents and the impending doom (pp. 290-291).
 *
 * The two "never" lines are the ones worth having on screen: both failure modes look like
 * good prep while you are writing them, and both turn a portent into a railroad, which is
 * the one thing a portent must not be.
 *
 * @type {ReadonlyArray<GuidanceItem>}
 */
export const GRIM_PORTENT_GUIDANCE = Object.freeze([
	{ name: "2 to 4 milestones",        gloss: "Steps on the road to the doom, in the order they would happen." },
	{ name: "Concrete and observable",  gloss: "Something the PCs can see, get word of, or feel the effects of." },
	{ name: "Things that happen AROUND the PCs", gloss: "\"Townsfolk form a cult\" is a portent. \"The PCs learn who the cultists are\" is not." },
	{ name: "Never dictate an outcome", gloss: "\"The cultists attack them at home\" is fine. \"The cultists capture them\" is a railroad." },
	{ name: "Something they could head off", gloss: "A portent the PCs can't react to is just scenery." },
	{ name: "Stuck? Work backwards",    gloss: "Start at the doom and ask what would happen just before it. Repeat until you reach today." },
]);

/** @type {ReadonlyArray<GuidanceItem>} */
export const IMPENDING_DOOM_GUIDANCE = Object.freeze([
	{ name: "Irreversible",       gloss: "Once it lands there is no going back. It changes the threat and everything it touches." },
	{ name: "Any size",           gloss: "\"The hordes sweep south\" and \"Dilwen never forgives her\" are both good dooms." },
	{ name: "Optional",           gloss: "Not every threat has one. Add it later if it occurs to you." },
	{ name: "It is your plan, not a promise", gloss: "What happens unless the PCs intervene. Keep it loose, an outline rather than a plot." },
]);

/**
 * Stakes questions (pp. 292-293), split into writing them and then honouring them. The second
 * half is the point of the first: a stakes question is a promise to yourself that you will NOT
 * answer it, and one you quietly answer in prep was never a stakes question.
 *
 * @type {ReadonlyArray<GuidanceItem>}
 */
export const STAKES_GUIDANCE = Object.freeze([
	{ name: "About the future",     gloss: "What will happen, not what has happened. A question about the past is a description." },
	{ name: "Not \"will the doom land?\"", gloss: "Already answered. It lands unless the PCs stop it. Ask about what is still undecided." },
	{ name: "Genuinely curious",    gloss: "If you don't want to know the answer, it isn't a stake. Not every threat needs one." },
	{ name: "Put them on screen",   gloss: "A stake nobody encounters never gets answered. Walk it up to a PC's door." },
	{ name: "Then let go of it",    gloss: "Hand it to the players, play your NPCs with integrity, and follow the moves and the dice." },
	{ name: "Let it simmer",        gloss: "If it doesn't resolve, leave it. Come back when it makes sense. Don't force an answer." },
]);

/**
 * The between-sessions review (p.298), in the order you would walk one card top to bottom:
 * is it still a threat, then its type, instinct, description, doom track, stakes, moves, and
 * finally where it sits. The last entry is not about any one card, which is why it reads
 * differently: it is the sweep back over the session for threats you have not written yet.
 *
 * @type {ReadonlyArray<GuidanceItem>}
 */
export const THREAT_REVIEW_CHECKLIST = Object.freeze([
	{ name: "Still a threat?",        gloss: "Dead, gone or resolved: cross it off." },
	{ name: "Type still right?",      gloss: "You may have called it wrong, or its nature may have changed. Pick again." },
	{ name: "Instinct still true?",   gloss: "If you found yourself playing it differently, the instinct is what to revise." },
	{ name: "Anything new to note?",  gloss: "Add what you want reminding of. Skip what is obvious to you." },
	{ name: "Portents come to pass?", gloss: "Tick them off." },
	{ name: "Knocked off course?",    gloss: "Redraw the doom and portents, or cross them off if the PCs averted it outright." },
	{ name: "Newly gathering speed?", gloss: "A threat that wasn't going anywhere, and now is, wants a doom and portents." },
	{ name: "Stakes answered?",       gloss: "Cross off the answered and the stale. Write new ones you find yourself wondering about." },
	{ name: "Shown you something?",   gloss: "New behaviour or capability revealed in play: write it up as a GM move." },
	{ name: "Moved?",                 gloss: "Closer or further than it was: shift it to the other tracker." },
	{ name: "Anything new from play?", gloss: "New enemies, rivals, monsters that got away, untrustworthy NPCs, or something the PCs picked up that others want." },
]);

/**
 * The tab's reference sections, in the order they are drawn: how to write one, when, the
 * rules of thumb for the two hardest parts, and the between-sessions pass.
 *
 * Each section is its own box in the template. That is load bearing rather than tidy: the fold
 * walk claims a heading's FOLLOWING SIBLINGS until it meets the next heading
 * (utils/section-editing.js `_sectionFoldTargets`), so headings laid out in one flat run would
 * let the first caret swallow every section under it.
 *
 * `collapseId` is what each fold is remembered under, per user and per sheet. They are prefixed
 * `threatGuide` so they cannot collide with a proximity id ("homefront") or with the fold ids
 * any other tab on this sheet stores in the same per-actor list.
 *
 * WHAT IS LOCALIZED AND WHAT IS NOT follows the split gm-moves.js already draws on this sheet:
 * the section CHROME (title, page citation, group label, the caution line) is an i18n KEY,
 * resolved at the sheet boundary; the reference CONTENT (each prompt and its gloss) is held
 * here as text, exactly as `BASIC_GM_MOVES` holds the move names and glosses. Splitting it
 * anywhere else would put half of one list in the language file and half in a module.
 *
 * A module-level frozen constant rather than a per-render literal: nothing in it varies (every
 * field is either a constant above or an i18n key), and this tab re-renders on every prep page
 * write in the world (see gm-prep-tabs.js).
 *
 * @type {ReadonlyArray<{key: string, titleKey: string, noteKey: string, collapseId: string, ordered?: boolean, groups: Array<{labelKey?: string, items: ReadonlyArray<GuidanceItem>}>, cautionKey?: string}>}
 */
export const THREAT_GUIDANCE_SECTIONS = Object.freeze([
	{
		key:        "writeup",
		titleKey:   "stonetop.gmToolkit.threats.guide.writeup",
		noteKey:    "stonetop.gmToolkit.threats.guide.writeupNote",
		collapseId: "threatGuideWriteup",
		// The only NUMBERED section. These are steps in an order that matters (the type decides
		// which moves you are offered, the doom decides whether there are portents to write),
		// where every other section here is a checklist you can read in any order.
		ordered:    true,
		groups:     [{ items: THREAT_WRITEUP_STEPS }],
	},
	{
		key:        "when",
		titleKey:   "stonetop.gmToolkit.threats.guide.when",
		noteKey:    "stonetop.gmToolkit.threats.guide.whenNote",
		collapseId: "threatGuideWhen",
		groups:     [{ items: THREAT_WRITEUP_MOMENTS }],
		cautionKey: THREAT_WRITEUP_CAUTION,
	},
	{
		key:        "portents",
		titleKey:   "stonetop.gmToolkit.threats.guide.portents",
		noteKey:    "stonetop.gmToolkit.threats.guide.portentsNote",
		collapseId: "threatGuidePortents",
		groups:     [
			{ labelKey: "stonetop.gmToolkit.threats.guide.grimPortents",  items: GRIM_PORTENT_GUIDANCE },
			{ labelKey: "stonetop.gmToolkit.threats.guide.impendingDoom", items: IMPENDING_DOOM_GUIDANCE },
			{ labelKey: "stonetop.gmToolkit.threats.guide.stakes",        items: STAKES_GUIDANCE },
		],
	},
	{
		key:        "review",
		titleKey:   "stonetop.gmToolkit.threats.guide.review",
		noteKey:    "stonetop.gmToolkit.threats.guide.reviewNote",
		collapseId: "threatGuideReview",
		groups:     [{ items: THREAT_REVIEW_CHECKLIST }],
	},
]);

/** @returns {ReadonlyArray} The reference sections, in the order the tab draws them. */
export function threatGuidanceSections() {
	return THREAT_GUIDANCE_SECTIONS;
}
