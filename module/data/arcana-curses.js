/**
 * How badly each Major Arcanum's Consequences track punishes the character who carries it.
 *
 * The escalating □ Consequences ladder on an arcanum's reverse is a Major-arcana mechanic:
 * 17 of the 18 shipped majors have one (the Blackwood Fetishes do not), and no minor
 * arcanum does — minors charge you as you go (mark a debility, lose 1d8 HP) rather than
 * ratcheting permanently. So this table is Major-only by nature, not by omission.
 *
 * The rulebook grades none of this, and the tracks are plainly not equal — Shield of the
 * Wisent Witch makes you tall and smelly; the Hungering Maw of Hlad takes 4 max HP, your
 * instinct, and eventually your hand. The tiers below are an editorial reading of the 17
 * tracks, applied by this rubric:
 *
 *   ruinous — permanently maims or rewrites the character: max HP or a permanent debility
 *             lost, instinct overridden, or a Death's Door 6- that ends them as a player
 *             character (Ghost / Revenant / the ring's final □).
 *   grim    — a permanent bodily, social or mechanical burden you carry for the rest of
 *             play, but you are still yourself and still playable.
 *   mild    — cosmetic, social, or aimed somewhere other than you: at the world, at the
 *             arcanum itself, or at its follower.
 *
 * `cost` is the one-line "what it actually takes from you" shown in the chip tooltip and
 * on the browser card, so the tier is never just an unexplained label.
 *
 * Homebrew majors aren't in here. They're graded at runtime as "ungraded" when their back
 * has a Consequences heading (see {@link hasConsequencesSection}), which keeps them
 * visible in the browser under the curse filter without inventing a severity for them.
 */

export const CURSE_TIERS = [
	{
		key:   "ruinous",
		label: "Ruinous",
		icon:  "fas fa-skull",
		hint:  "Costs you the character in the end: max HP, a permanent debility, your instinct, or your death",
	},
	{
		key:   "grim",
		label: "Grim",
		icon:  "fas fa-hand-holding-medical",
		hint:  "A permanent burden you carry for the rest of play, but you're still yourself",
	},
	{
		key:   "mild",
		label: "Mild",
		icon:  "fas fa-feather",
		hint:  "Cosmetic or social, or it lands on the world, the arcanum, or its follower rather than on you",
	},
];


/**
 * The grading for a card the table below does not cover: a homebrew major whose back carries a
 * Consequences heading. Not a fourth rung of the ladder — it is the ABSENCE of a grade, named so
 * the browser can show and filter one without this file claiming to know how bad it is.
 */
export const UNGRADED_CURSE = {
	key:   "ungraded",
	label: "Ungraded",
	icon:  "fas fa-question",
	hint:  "Carries a Consequences track that hasn't been graded here: homebrew majors",
	cost:  "Carries a Consequences track that hasn't been graded here.",
};

/**
 * Every value arcanumCurse can put on a row's `curse` facet, as filter chips.
 *
 * Lives here, beside the grading, rather than in the browser: a facet value with no chip is not
 * merely unfilterable, it is HIDDEN by every chip in its group, since the groups AND (see
 * utils/catalog-filters.js). Built from the same two exports the grading itself uses, so the two
 * cannot fall out of step — which is exactly what left ungraded homebrew invisible under the very
 * filter its grading was invented to keep it visible under.
 */
export const CURSE_FILTERS = [...CURSE_TIERS, UNGRADED_CURSE];

const _TIERS_BY_KEY = Object.fromEntries(CURSE_TIERS.map(t => [t.key, t]));

export const ARCANA_CURSES = {
	// Ruinous — the track ends the character, one way or another.
	"hungering-maw-of-hlad": {
		tier: "ruinous",
		cost: "-4 max HP, your instinct becomes Hunger, and a 6- at Death's Door is the ring's to answer; the last □ withers your hand away",
	},
	"redwood-effigy": {
		tier: "ruinous",
		cost: "You can no longer Recover HP, and a 6- at Death's Door hands you the Revenant insert: then the GM plays your wraith",
	},
	"norubas-ice-sphere": {
		tier: "ruinous",
		cost: "Permanently marks weakened, dulls your emotions to nothing, and a 6- at Death's Door makes you a Ghost tethered to the sphere",
	},
	"hectumel-codex": {
		tier: "ruinous",
		cost: "Remakes your body scale by scale into something that isn't human, and everything you perceive, Hec'tumel perceives too",
	},
	"ring-of-daagon": {
		tier: "ruinous",
		cost: "Only raw flesh feeds you, sinkholes open wherever you walk, and the ring's Cost becomes living, helpless sacrifices",
	},
	"blood-quenched-sword": {
		tier: "ruinous",
		cost: "Blood-rage that can't tell friend from bystander; you can't sleep without the Sword, and food stops feeding you",
	},

	// Grim — permanent, heavy, survivable.
	"staff-of-the-lidless-orb": {
		tier: "grim",
		cost: "One eye bulges, the other withers; you become incapable of seeing beauty, and El'rash-Orra sets you a task you can't refuse twice",
	},
	"demonhide-cloak": {
		tier: "grim",
		cost: "Your instinct becomes Recklessness, the seams tear, and the demons sewn into it start talking back",
	},
	"azure-hand": {
		tier: "grim",
		cost: "Burns you for 2d4 and a debility, binds you to the staff, and every storm near your steading eats its Surplus",
	},
	"whispering-rocks": {
		tier: "grim",
		cost: "Black eyes blinded by daylight, deathly cold skin, and spirits with purchase on your soul that compel you",
	},
	"rune-laden-scales": {
		tier: "grim",
		cost: "The bar for marking rises and rises, killing in anger costs you disadvantage until you atone, and the Things Below take an interest",
	},
	"ineffable-words": {
		tier: "grim",
		cost: "Your voice can never lie again, the Word tears rifts in reality, and an ancient being of Order comes to reprimand you",
	},
	"storm-markings": {
		tier: "grim",
		cost: "Lightning arcs off you at random, you can't hold your temper, and the storms you raise wreck your steading's Surplus for a season",
	},

	// Mild — cosmetic, social, or aimed elsewhere.
	"red-scepter": {
		tier: "mild",
		cost: "Nine boxes of feverish skin, ember eyes and howling in your ears: mostly it just makes the Scepter harder and uglier to use",
	},
	"shield-of-the-wisent-witch": {
		tier: "mild",
		cost: "You grow huge, loud and musky, eat double rations, and predators decide you look delicious",
	},
	"twisted-spear": {
		tier: "mild",
		cost: "Barely touches you: it's the elder tree that sickens, and the evils bound beneath its roots that get loose",
	},
	"mindgem": {
		tier: "mild",
		cost: "Lands on the Servant, not on you: it grows proud, then aggressive, then remembers its purpose and walks away",
	},
};

/**
 * Match a "Consequences" section heading on an arcanum's BACK description. Deliberately
 * matched on the heading tag rather than the bare word, which also shows up in body prose
 * ("mark a Consequence") well before the section itself — the same reason
 * CharacterArcana's fold pass matches it this way.
 */
const _CONSEQUENCES_HEADING_RE = /<h([1-6])\b[^>]*>\s*Consequences\s*<\/h\1>/i;

/** Whether a resolved arcanum's reverse carries a Consequences track at all. */
export function hasConsequencesSection(arc) {
	return _CONSEQUENCES_HEADING_RE.test(arc?.back?.description ?? "");
}

/**
 * The graded curse for an arcanum, or null when it has no Consequences track.
 *
 * Shipped majors resolve from the table above. A homebrew card whose back has a
 * Consequences heading resolves to the `ungraded` shape, so the browser can still show and
 * filter it without this file claiming to know how bad it is.
 *
 * `key` is the filter-chip key this card files under, and is always one of CURSE_FILTERS — read
 * it rather than deriving one from `tier`, which is blank for an ungraded card and would leave
 * the row on a facet value no chip carries.
 *
 * @param {object} arc  A resolved arcanum (MinorArcanum or snapshot); needs `slug`/`back`.
 * @returns {{key: string, tier: string, label: string, icon: string, cost: string, ungraded: boolean}|null}
 */
export function arcanumCurse(arc) {
	const graded = ARCANA_CURSES[arc?.slug];
	if (graded) {
		const tier = _TIERS_BY_KEY[graded.tier];
		return { key: graded.tier, tier: graded.tier, label: tier.label, icon: tier.icon, cost: graded.cost, ungraded: false };
	}
	if (!hasConsequencesSection(arc)) return null;
	return {
		key:      UNGRADED_CURSE.key,
		tier:     "",
		// "Cursed" on the row's own badge, where the reader wants to know THAT it has a track; the
		// chip that gathers these says "Ungraded", where the reader is choosing between gradings.
		label:    "Cursed",
		icon:     UNGRADED_CURSE.icon,
		cost:     UNGRADED_CURSE.cost,
		ungraded: true,
	};
}
