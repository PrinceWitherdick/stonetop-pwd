// Plain-language meanings for the recurring monster tags used on stat blocks —
// the organization, size, nature, and behavior terms from Book I "Dangers"
// (pp.392-398). Surfaced as hover tooltips on the stat-block header tag line.
//
// Only the recurring, meaningful tags live here; the long tail of one-off
// flavor tags (e.g. "grumpy", "drunkard") intentionally has no entry and simply
// renders as plain text. Shared as a Foundry-free ES module so it can be unit
// tested and reused by the importer.

export const MONSTER_TAGS = {
	// ── Organization (every monster has one; drives HP & damage, Book I pp.395-398) ──
	solitary:   "Hunts or fights by itself: 12 HP and d10 damage.",
	group:      "Hunts or fights in small groups (2-5 per group): 6 HP and d8 damage each.",
	horde:      "Hunts or fights in large groups (6 or more): 3 HP and d6 damage each.",

	// ── Size (Book I pp.395-398: HP, damage, range, armor) ────────────────────
	tiny:       "Cat-sized or smaller: -2 HP, -2 damage, +1 armor, and its attack's range is one step lower.",
	small:      "Like a human child: its attack's range is one step lower.",
	large:      "Like a horse, cart, etc.: +4 HP, +1 damage, and its attack gains a range.",
	huge:       "Like an elephant, or bigger: +8 HP, +3 damage, and its attack gains a range.",

	// ── Nature (Book I p.395, "What is its nature?") ──────────────────────────
	construct:  "Made by someone.",
	spirit:     "Lacks physical form.",
	undead:     "Dead, but in denial.",
	corrupted:  "Changed by the Things Below.",
	fae:        "Between physical and spiritual.",
	primordial: "From the first age of creation.",
	emanation:  "A manifestation of a greater power, not a body of its own.",

	// ── Notable for (Book I p.395, "What is it notable for?") ─────────────────
	hoarder:     "Amassing trinkets and treasure.",
	cautious:    "Avoiding fights, fleeing early.",
	cunning:     "Intelligence.",
	devious:     "Intelligence.",
	terrifying:  "Disturbing or terrible presence.",
	stealthy:    "Sneaking, surprising, ambushing.",
	magical:     "Using spells or magic.",
	organized:   "Working well in groups.",

	// ── Other recurring tags (made up per creature, as Book I p.395 invites) ──
	hardy:       "Tough and resilient; shrugs off hardship and punishment.",
	amorphous:   "Has no fixed form; able to squeeze through gaps.",
	fearless:    "Knows no fear: won't flee, falter, or be cowed.",
	implacable:  "Relentless and unstoppable; cannot be reasoned with or deterred.",
	fierce:      "Ferocious and aggressive in a fight.",
	clever:      "Quick-witted and resourceful.",
	beautiful:   "Strikingly beautiful, in a way that draws others in or disarms them.",
	tireless:    "Never wearies; can press on without rest.",
	amphibious:  "Equally at home on land and in water.",
	aquatic:     "Lives in the water; swims swiftly and breathes beneath the surface.",
	athletic:    "Powerful and agile: climbs, leaps, and runs well.",
	aggressive:  "Quick to attack and press the fight.",
	violent:     "Prone to sudden, brutal violence.",
	vicious:     "Cruel and savage; fights to maim and kill.",
	gluttonous:  "Driven by relentless hunger; consumes without restraint.",
	disciplined: "Trained and self-controlled; holds formation and follows orders.",
};

/**
 * Look up the description for a single raw tag string (case/space-insensitive),
 * or null if it isn't a known monster tag.
 */
export function findMonsterTag(rawText) {
	const text = String(rawText ?? "").trim().toLowerCase();
	return MONSTER_TAGS[text] ?? null;
}
