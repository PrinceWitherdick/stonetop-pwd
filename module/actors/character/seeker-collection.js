/**
 * The Seeker's Collection (the playbook's first page): the arcana a Seeker starts with, and what
 * becomes of them when creation is run again, a role is changed on the sheet, the background is
 * switched on the Details tab, or the playbook is changed.
 *
 *   MAJOR ARCANA. "Your Background grants you 1 major arcanum. ... mark 1 ○ or □ on the front of
 *   its insert."
 *   MINOR ARCANA. "Draw 3 at random and review both sides. Choose one whose secrets you have
 *   unlocked [mastered] ... Choose another, which you have not yet mastered [found] ... The third
 *   you have not yet found, but you have a lead on it [lead]."
 *
 * What creation chose is kept as bookkeeping beside the cards (`arcana.major`, `minorDraw`,
 * `minorRoles`, `majorMarks`), and StonetopCharacter#settleSeekerArcana diffs the old bookkeeping
 * against the new to change the cards. Everything here is pure: the decisions, not the writes.
 */

import { stripHtmlToText } from "../../utils/strings.js";

export const SEEKER_MINOR_ROLES = Object.freeze(["mastered", "found", "lead"]);

/** The stored (or selected) creation bookkeeping, with every field present. */
export function seekerArcanaState(raw = {}) {
	const roles = raw?.minorRoles ?? {};
	return {
		major:      String(raw?.major ?? ""),
		minorDraw:  [...(raw?.minorDraw ?? [])].filter(Boolean),
		minorRoles: Object.fromEntries(SEEKER_MINOR_ROLES.map(role => [role, String(roles[role] ?? "")])),
		majorMarks: [...new Set((raw?.majorMarks ?? []).map(String))],
	};
}

/** Whether a state chose anything at all (a non-Seeker's empty selections choose nothing). */
export function seekerArcanaChosen(state) {
	const s = seekerArcanaState(state);
	return !!(s.major || s.minorDraw.length || s.majorMarks.length || SEEKER_MINOR_ROLES.some(role => s.minorRoles[role]));
}

/** Each card creation gave, by slug: "major", "mastered", "found" or "lead". */
export function seekerCardRoles(state) {
	const s = seekerArcanaState(state);
	const roles = new Map();
	for (const role of SEEKER_MINOR_ROLES) {
		const slug = s.minorRoles[role];
		if (slug && !roles.has(slug)) roles.set(slug, role);
	}
	if (s.major) roles.set(s.major, "major");
	return roles;
}

/** "context:index" mark keys as box rows ({ context, index }) for CharacterArcana#isAsGranted. */
export function majorMarkBoxes(marks = []) {
	return marks.flatMap(key => {
		const [context, index] = String(key).split(":");
		const n = Number(index);
		return context && Number.isInteger(n) ? [{ context, index: n }] : [];
	});
}

/**
 * The minor roles with `slug` put in `role`: the card leaves any other role it held, so one card is
 * never two of the three. An empty `slug` empties the role. For the sheet's lore role pickers.
 */
export function withMinorRole(roles = {}, role, slug) {
	const next = seekerArcanaState({ minorRoles: roles }).minorRoles;
	if (!SEEKER_MINOR_ROLES.includes(role)) return next;
	for (const other of SEEKER_MINOR_ROLES) if (slug && next[other] === slug) next[other] = "";
	next[role] = slug ?? "";
	return next;
}

/**
 * Whether the minor roles are all given out: Mastered, Found and Lead each on a card, and no card
 * in two of them (the book's "Choose one ... Choose another ... The third"). One half of
 * onboarding's minor-arcana step; the other half is its three written questions (seekerMinorStepComplete).
 */
export function seekerMinorRolesAssigned(roles = {}) {
	const s = seekerArcanaState({ minorRoles: roles }).minorRoles;
	const slugs = SEEKER_MINOR_ROLES.map(role => s[role]).filter(Boolean);
	return slugs.length === SEEKER_MINOR_ROLES.length && new Set(slugs).size === slugs.length;
}

/**
 * Whether onboarding's "Minor Arcana & Questions" step is done. THE one rule, read both by the Next
 * button (CharacterOnboardingDialog#_isStepComplete) and by the reopen that lands on the first
 * unfinished page (#_isStepAnsweredForResume), so the two can't disagree. The page asks for two
 * things: a role on each of the three drawn cards, and the answers under them ("Where is it now?
 * How did you come to master it?", "Where is it? How did you find it?", the lead's note). The
 * answers are counted by the same lore check every question page uses, passed in as
 * `questionsAnswered`, since the "Minor Arcana" section states no "answer at least N" and so wants
 * all three.
 */
export function seekerMinorStepComplete({ minorRoles = {}, questionsAnswered = false } = {}) {
	return seekerMinorRolesAssigned(minorRoles) && !!questionsAnswered;
}

/**
 * The "mysteries" track on the front of a major arcanum's insert, which the Seeker has "begun to
 * unlock": a run of ○ on the unlock lead (most majors), or else the □ tasks in the front text (the
 * Mindgem, the Twisted Spear; see frontTaskTrack). Each marker carries the arcana box key it is
 * stored under (context + index, in document order as CharacterArcana._injectMarkers numbers them)
 * and, for a □ task, the task's text. `front` is a card's front ({ description, unlock: { description } }).
 */
export function seekerMajorTrack(front) {
	const unlock = String(front?.unlock?.description ?? "");
	const circles = (unlock.match(/○/g) || []).length;
	if (circles) {
		return { kind: "circle", markers: Array.from({ length: circles }, (_, index) => ({ context: "unlock", index, label: "" })) };
	}
	const tasks = frontTaskTrack(front);
	return tasks ? { kind: "box", markers: tasks.markers } : { kind: null, markers: [] };
}

// An unlock lead that makes the front's □ its track speaks of them: "When you have marked 3 tasks"
// (the Twisted Spear), "When you've completed all the requirements" (the Mindgem).
const _TASK_LEAD  = /\b(?:tasks?|requirements?)\b/i;
const _TASK_COUNT = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:of\s+(?:the|its|these|those)\s+(?:\w+\s+)?)?(?:tasks?|requirements?)\b/i;
const _WORD_COUNTS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/**
 * A card whose unlock track is the □ tasks in its FRONT text (the Mindgem, the Twisted Spear), as
 * `{ markers, needed }`: the tasks (frontTaskMarkers) and how many of them unlock it. Null for any
 * other card. Read off the unlock lead, which has no ○ and names the tasks or requirements: a
 * count there ("marked 3 tasks") is how many are needed, and otherwise all of them are. A □ on a
 * card whose lead says neither is some other box (a one-shot move, a consequence), not a lock, and
 * a card that lists requirements under its lead unlocks by those.
 *
 * The one rule for "the front □ are the track": CharacterArcana's unlock and mastery, the Seeker's
 * major track above, and Improvise's step all read it here.
 *
 * @param {{description?: string, unlock?: {description?: string, requirements?: object[]}}} front
 * @returns {{markers: {context: string, index: number, label: string}[], needed: number}|null}
 */
export function frontTaskTrack(front) {
	const lead = stripHtmlToText(front?.unlock?.description ?? "");
	if (lead.includes("○") || !_TASK_LEAD.test(lead)) return null;
	if ((front?.unlock?.requirements ?? []).length) return null;
	const markers = frontTaskMarkers(front?.description);
	if (!markers.length) return null;
	const said = _TASK_COUNT.exec(lead)?.[1]?.toLowerCase();
	const n = _WORD_COUNTS[said] ?? Number(said);
	return { markers, needed: n > 0 ? Math.min(n, markers.length) : markers.length };
}

/**
 * The □ of a card's front text as task markers, in the order CharacterArcana._injectMarkers
 * indexes them (context "front"): `{ context, index, label }`, the label being the text of the
 * list item the □ sits in (trimmed, the □ dropped), or "" for a □ outside a list item.
 */
export function frontTaskMarkers(description) {
	const html = String(description ?? "");
	const markers = [];
	for (const match of html.matchAll(/□/g)) {
		const before  = html.slice(0, match.index);
		const liOpen  = before.lastIndexOf("<li");
		const inItem  = liOpen > before.lastIndexOf("</li>");
		const end     = inItem ? html.indexOf("</li>", match.index) : -1;
		const label   = inItem ? stripHtmlToText(html.slice(liOpen, end < 0 ? undefined : end)).replace(/□/g, "").trim() : "";
		markers.push({ context: "front", index: markers.length, label });
	}
	return markers;
}

/**
 * "Mark 1 ○ or □": the marks after the player ticks (or unticks) `key`. A tick replaces the mark
 * held, so exactly one is ever marked; an untick leaves none.
 */
export function pickSeekerMajorMark(marks = [], key, checked) {
	if (checked) return [String(key)];
	return marks.filter(k => k !== String(key));
}

/**
 * The minor arcana no draw may deal: every card another character holds (owned, and not a mere
 * lead), and this character's own held cards that its last creation draw did not deal (a card it
 * came by in play is not in the deck either). `characters` are `{ id, arcana }`, `arcana` being the
 * character's arcana flags.
 */
export function minorArcanaHeldElsewhere(characters = [], selfId = null) {
	const held = new Set();
	for (const { id, arcana } of characters) {
		const leads = new Set(arcana?.leads ?? []);
		const own   = id === selfId ? new Set(arcana?.minorDraw ?? []) : new Set();
		for (const slug of arcana?.owned ?? []) {
			if (!leads.has(slug) && !own.has(slug)) held.add(slug);
		}
	}
	return held;
}

/** The slugs a draw may deal from `options` ({ slug }), leaving out `held`. */
export function drawableMinorSlugs(options = [], held = new Set()) {
	return options.map(option => option.slug).filter(slug => slug && !held.has(slug));
}

/**
 * What a background switch on the Details tab does to the Seeker's major arcanum (user ruling
 * 2026-09-26): the new background's list is `offered`. A major on that list stays. Otherwise the old
 * major goes only while it is as granted (its onboarding mark and nothing else), and then 1 of the
 * new list is asked for with its mark; a played major stays, and nothing is asked. With no major
 * held (a first background picked there, or the card is gone), the new list is asked.
 *
 *   "none"         the new background grants no major (nothing to do)
 *   "keep"         the major held is on the new list
 *   "stays"        the major held has play on it: it stays, and no second one is offered
 *   "replace"      release the as-granted major, then ask
 *   "ask"          no major held: ask
 */
export function seekerMajorSwitchPlan({ major = "", held = true, offered = [], asGranted = false } = {}) {
	if (!offered.length) return "none";
	if (!major || !held) return "ask";
	if (offered.includes(major)) return "keep";
	return asGranted ? "replace" : "stays";
}

/**
 * Whether the Seeker's background still owes its major arcanum ("Your Background grants you 1
 * major arcanum"), for the Arcana tab's cue: the background lists majors (`offered`), and the
 * character holds none of them and no creation major either (`major`, the one creation or the
 * Details tab gave; a played one kept from an earlier background counts, as the "stays" plan
 * keeps it). `owned` are the slugs held, leads left out. "Choose later" on the ask leaves this true.
 */
export function seekerMajorOwed({ offered = [], owned = [], major = "" } = {}) {
	if (!offered.length) return false;
	const held = new Set(owned);
	if (major && held.has(major)) return false;
	return !offered.some(slug => held.has(slug));
}
