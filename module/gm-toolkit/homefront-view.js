// The Homefront tab's view-model: the seven sections of homefront-text.js, with their headings
// localized and their book citations resolved, in the order the playbook prints them.
//
// Its own module rather than a lambda in the sheet, which is where the Moves tab's equivalent
// lives, and the reason is size rather than taste. Seven sections of six different SHAPES need a
// per-section builder each; inlined, that is a hundred lines of assembly sitting between the
// sheet's constructor and its listeners, and none of it is about being a sheet. Out here it is
// also drivable by a test without an Application, a Handlebars environment or a fake actor.
//
// What this module does NOT do is decide which season is now. That is a live reading off the
// steading's clock, it changes during a session, and this table is built once and frozen for the
// life of the page — see `localizedHomefrontSections`. The tab marks the current season by
// comparing each block's `key` against a value the sheet puts on the context beside this list.
import { localize } from "../utils/i18n.js";
import { localizedOnce } from "../utils/localized-once.js";
import { bookPageRef } from "./book-ref.js";
import {
	HOMEFRONT_SECTIONS, LIFE_IN_STONETOP, HOMEFRONT_QUESTIONS, THE_YEARS_WORK,
	AFTERMATH, DOWNTIME, MAKE_A_PLAN, RELATIVE_VALUE,
} from "./homefront-text.js";

/**
 * A step list, with a citation on any step that named its own page.
 *
 * Only one step does (downtime's "Eventually, the Seasons Change", which is a move with its own
 * chapter), so the untouched steps are handed back AS THEY ARE rather than shallow-copied. The
 * table is frozen and the template only reads, so sharing the object is free; copying all eight to
 * decorate one is the kind of tidiness that reads as though something needed the copy.
 */
function stepsWithRefs(steps) {
	return steps.map(step => (step.page ? { ...step, pageRef: bookPageRef(step) } : step));
}

/**
 * How each section's body is assembled, by section key.
 *
 * Keyed by KEY rather than by `kind`, though the template switches on kind: Aftermath and Downtime
 * are both `kind: "steps"` and render through the same markup, but they are different tables and
 * Downtime carries an end condition Aftermath has no equivalent of. One builder per section is
 * what lets the two share a renderer without sharing a source.
 *
 * Every entry resolves its own `pageRef`, and that is the whole reason this file needs `localize`
 * at all — a citation is a formatted i18n string ("Book II, page 16"), so none of these can be
 * built at import time. See `localizedHomefrontSections`.
 */
const SECTION_BODIES = {
	// Four groups of facts, each citing its own Book II spread rather than the entry's first page.
	life: () => ({
		groups: LIFE_IN_STONETOP.map(group => ({ ...group, pageRef: bookPageRef(group) })),
	}),
	questions: () => ({
		items:   HOMEFRONT_QUESTIONS.items,
		pageRef: bookPageRef(HOMEFRONT_QUESTIONS),
	}),
	year: () => ({
		seasons: THE_YEARS_WORK.seasons,
		pageRef: bookPageRef(THE_YEARS_WORK),
	}),
	// NUMBERED, unlike downtime's: the playbook numbers these three because they are a sequence.
	aftermath: () => ({
		numbered: true,
		steps:    stepsWithRefs(AFTERMATH.steps),
		pageRef:  bookPageRef(AFTERMATH),
	}),
	downtime: () => ({
		steps:   stepsWithRefs(DOWNTIME.steps),
		ends:    DOWNTIME.ends,
		pageRef: bookPageRef(DOWNTIME),
	}),
	plan: () => ({
		trigger:      MAKE_A_PLAN.trigger,
		guidance:     MAKE_A_PLAN.guidance,
		requirements: MAKE_A_PLAN.requirements,
		pageRef:      bookPageRef(MAKE_A_PLAN),
	}),
	value: () => ({
		lead:    RELATIVE_VALUE.lead,
		intro:   RELATIVE_VALUE.intro,
		tiers:   RELATIVE_VALUE.tiers,
		notes:   RELATIVE_VALUE.notes,
		pageRef: bookPageRef(RELATIVE_VALUE),
	}),
};

/**
 * The Homefront tab's sections, localized once.
 *
 * Same reasoning as the Moves tab's `localizedMoveSections`: the catalog is a frozen module
 * constant and everything else is an i18n key, so the finished list never differs between renders
 * — and this sheet re-renders on every prep-page write in the world, which is a great deal of
 * rebuilding for a page of static reference text.
 *
 * Lazy rather than a top-level constant because `game.i18n` does not exist at import time; never
 * invalidated because the language cannot change without a reload. `localizedOnce` is what makes
 * "not ready yet" safe rather than permanent, and it FREEZES what comes out — which is why the
 * current-season mark is not stamped onto a season here.
 *
 * @returns {ReadonlyArray<{key: string, kind: string, title: string, note: string,
 *          collapseId: string, body: object}>}
 */
export const localizedHomefrontSections = localizedOnce(() =>
	HOMEFRONT_SECTIONS.map(section => ({
		key:        section.key,
		kind:       section.kind,
		title:      localize(section.titleKey),
		note:       localize(section.noteKey),
		collapseId: section.collapseId,
		body:       SECTION_BODIES[section.key](),
	})));
