import { GM_TICKED_HALF_MISSES, MOVE, ROLL_MODES, ROW_KIND, STAT_KEYS, STAT_LABELS } from "./struggle-rules.js";

/**
 * THE GM'S SETUP, pure: what the Call for Struggle as One window shows, and the rows it turns into.
 *
 * The book's order (p.328): clarify the danger and the stakes, establish the party's approach, then
 * "figure out which stat(s) make the most sense... Everyone might roll the same stat, or (if they
 * break up the jobs), they might each roll something different." So each character gets the stats
 * the GM allows (none ticked = their choice), a mode, and anyone OUTSIDE the struggle who Aids them.
 *
 * A ROSTER entry is one character as StruggleSetupDialog read them:
 *   {actorId, name, img, owns: string[], load: "light"|"normal"|"heavy"|"", overloaded: boolean,
 *    followers: [{fkey, ftype, slug, name, img, tags: string[], exceptional, isGroup, party}]}
 */

const MODE_LABELS = { normal: "Normal", adv: "Advantage", dis: "Disadvantage" };

/** Why the GM would tick each of the fiction-gated moves, in the moves' own words. */
export const HALF_MISS_WHEN = Object.freeze({
	[MOVE.STONE_COLD]:    "they keep calm and carry on",
	[MOVE.TOWER_ETERNAL]: "the danger is magic",
});

/** The moves a row carries into the struggle for later: its rules read these by name. */
const CARRIED = [MOVE.BUNDLE_OF_STICKS, MOVE.TRAILBLAZER, MOVE.HOME_ON_THE_RANGE];

/** A follower's key in the setup: which character's, and which card. */
export function followerKey(actorId, ftype, slug) {
	return `${actorId}:${ftype}:${slug ?? ""}`;
}

/**
 * The draft a setup opens on. Every character in, rolling their choice of stat at no advantage; a
 * follower is in when the player has marked them as travelling with the party.
 */
export function newSetupDraft(roster, { danger = "", approach = "", journey = false, only = null } = {}) {
	const pcs = {};
	const followers = {};
	for (const pc of roster) {
		pcs[pc.actorId] = { include: only ? only.includes(pc.actorId) : true, stats: [], mode: "normal", aidBy: "", aidAdv: true, ticks: [] };
		for (const f of pc.followers ?? []) {
			followers[f.fkey] = { include: !!f.party, bonus: 0, mode: "normal" };
		}
	}
	return { danger, approach, journey, pcs, followers };
}

function clampBonus(value, exceptional) {
	const n = Math.max(0, Math.min(exceptional ? 2 : 1, Math.trunc(Number(value) || 0)));
	return n;
}

/**
 * The rows the struggle is called with, from the roster and the GM's draft. A character's playbook
 * moves travel with their row: the half-miss moves only when the GM ticked them (they turn on how the
 * character goes about it), and the rest by name for the rules to read.
 */
export function setupRows(roster, draft) {
	const rows = [];
	for (const pc of roster) {
		const choice = draft.pcs[pc.actorId];
		if (choice?.include) {
			rows.push({
				kind: ROW_KIND.PC,
				actorId: pc.actorId,
				name: pc.name,
				img: pc.img,
				stats: (choice.stats ?? []).filter(s => STAT_KEYS.includes(s)),
				mode: ROLL_MODES.includes(choice.mode) ? choice.mode : "normal",
				halfMisses: (choice.ticks ?? []).filter(m => GM_TICKED_HALF_MISSES.includes(m) && pc.owns.includes(m)),
				owns: CARRIED.filter(m => pc.owns.includes(m)),
				aid: choice.aidBy?.trim() ? { by: choice.aidBy.trim(), advantage: !!choice.aidAdv } : null,
			});
		}
		for (const f of pc.followers ?? []) {
			const fc = draft.followers[f.fkey];
			if (!fc?.include) continue;
			rows.push({
				kind: ROW_KIND.FOLLOWER,
				actorId: pc.actorId,
				ftype: f.ftype,
				slug: f.slug,
				name: f.name,
				img: f.img,
				bonus: clampBonus(fc.bonus, f.exceptional),
				mode: ROLL_MODES.includes(fc.mode) ? fc.mode : "normal",
				isGroup: !!f.isGroup,
			});
		}
	}
	return rows;
}

/**
 * The Judges who could jump in with Many Hands Make Light Work: characters who know it and are NOT
 * rolling in the struggle (see MOVE in struggle-rules.js for why only those).
 */
export function setupHelpers(roster, draft) {
	return roster
		.filter(pc => !draft.pcs[pc.actorId]?.include && pc.owns.includes(MOVE.MANY_HANDS))
		.map(pc => pc.name);
}

/** Whether "part of a journey" means anything to anybody on the roster. */
export function journeyMatters(roster) {
	return roster.some(pc => pc.owns.includes(MOVE.HOME_ON_THE_RANGE) || pc.owns.includes(MOVE.TRAILBLAZER));
}

function loadText(pc) {
	if (pc.overloaded) return "Overloaded";
	if (pc.load === "heavy") return "Heavy load";
	if (pc.load === "normal") return "Normal load";
	if (pc.load === "light") return "Light load";
	return "";
}

/** The setup window, for the template. */
export function setupView(roster, draft, { askerName = "", live = false } = {}) {
	const pcs = roster.map(pc => {
		const choice = draft.pcs[pc.actorId] ?? {};
		return {
			actorId: pc.actorId,
			name: pc.name,
			img: pc.img,
			include: !!choice.include,
			loadText: loadText(pc),
			stats: STAT_KEYS.map(key => ({ key, label: STAT_LABELS[key], checked: (choice.stats ?? []).includes(key) })),
			modes: ROLL_MODES.map(mode => ({ value: mode, label: MODE_LABELS[mode], selected: (choice.mode ?? "normal") === mode })),
			aidBy: choice.aidBy ?? "",
			aidAdv: choice.aidAdv !== false,
			ticks: GM_TICKED_HALF_MISSES.filter(m => pc.owns.includes(m)).map(m => ({
				name: m,
				label: `${m}: ${HALF_MISS_WHEN[m]}, so a 6- counts as a 7-9`,
				checked: (choice.ticks ?? []).includes(m),
			})),
			notes: [
				...(pc.owns.includes(MOVE.HOME_ON_THE_RANGE) ? [`${MOVE.HOME_ON_THE_RANGE}: a 6- counts as a 7-9 on a journey.`] : []),
				...(pc.owns.includes(MOVE.TRAILBLAZER) ? [`${MOVE.TRAILBLAZER}: on a journey, a 10+ also discovers something useful.`] : []),
				...(pc.owns.includes(MOVE.BUNDLE_OF_STICKS) ? [`${MOVE.BUNDLE_OF_STICKS}: rolls with advantage, and picks an ally who does too.`] : []),
			],
			followers: (pc.followers ?? []).map(f => {
				const fc = draft.followers[f.fkey] ?? {};
				const bonus = clampBonus(fc.bonus, f.exceptional);
				return {
					fkey: f.fkey,
					name: f.name,
					include: !!fc.include,
					isGroup: !!f.isGroup,
					tagsText: f.tags?.length ? `Tags: ${f.tags.join(", ")}` : "No tags",
					bonuses: [0, 1, ...(f.exceptional ? [2] : [])].map(n => ({
						value: n,
						label: n === 0 ? "+0: no tag or move applies" : n === 1 ? "+1: a tag or move applies" : "+2: exceptional, and a tag applies",
						selected: bonus === n,
					})),
					modes: ROLL_MODES.map(mode => ({ value: mode, label: MODE_LABELS[mode], selected: (fc.mode ?? "normal") === mode })),
				};
			}),
		};
	});
	const rows = setupRows(roster, draft);
	return {
		askerName,
		live,
		danger: draft.danger,
		approach: draft.approach,
		journey: !!draft.journey,
		showJourney: journeyMatters(roster),
		pcs,
		empty: roster.length === 0,
		canCall: !live && rows.length > 0,
		callBlocked: live ? "A Struggle as One is already under way. End it first." : (rows.length ? "" : "Tick at least one character to call for rolls."),
		helpers: setupHelpers(roster, draft),
	};
}
