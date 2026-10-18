// Livestock & Other Beasts catalog (Moves & Gear handout). Drives the Followers
// tab beast cards: when a character adds one of these via the Add Special Item
// picker, its slug lands in the `inventory.addedSpecial` flag and the sheet pairs
// it with the full stats here. `slug` matches the inventory-items compendium entry
// and the SPECIAL_ITEM_CATALOG "Livestock & Other Beasts" category in
// special-items.js (which only carries traits/Value for the picker).
//
// Stats are copied verbatim from the Moves & Gear handout's "Livestock & Other Beasts"
// table (also printed in Book I, p. 98). `follower: true` marks the beasts the rules treat as proper followers:
// they have a Cost and earn Loyalty (dog, mule, horse). The rest are livestock:
// no Loyalty, and most can be butchered for Provisions.
//
// `traitsNote` holds the handout's "choose" instruction (e.g. "pick 2 more",
// "swift or hardy") shown as a muted hint after the fixed trait tags.

export const BEAST_CATALOG = {
	"dog-follower": {
		name:       "Dog",
		subtitle:   "follower",
		traits:     ["keen-nosed"],
		traitsNote: "pick 2 more",
		hp:         6,
		damage:     "d6",
		damageForm: "hand, grabby",
		armor:      0,
		instinct:   "get distracted",
		cost:       "training",
		follower:   true,
		portraitIcon: "fas fa-dog",
	},
	"goat": {
		name:       "Goat",
		traits:     ["sure-footed", "curious", "hungry"],
		hp:         3,
		damage:     "d4",
		damageForm: "hand",
		armor:      0,
		instinct:   "explore",
		butcher:    "4 Provisions (6 uses)",
		follower:   false,
	},
	"sheep": {
		name:       "Sheep",
		traits:     ["timid", "hardy", "wooly"],
		hp:         3,
		damage:     "d4",
		damageForm: "hand",
		armor:      0,
		instinct:   "follow the herd",
		butcher:    "4 Provisions (6 uses)",
		follower:   false,
	},
	"pig": {
		name:       "Pig",
		traits:     ["keen-nosed", "stubborn", "gluttonous", "clever"],
		hp:         6,
		damage:     "d4",
		damageForm: "hand",
		armor:      0,
		instinct:   "eat anything",
		butcher:    "4 Provisions (d6+10 uses)",
		follower:   false,
	},
	"donkey": {
		name:       "Donkey",
		traits:     ["hardy", "sure-footed", "cautious", "slow"],
		hp:         10,
		damage:     "d4+2",
		damageForm: "hand, forceful",
		armor:      0,
		instinct:   "be stubborn",
		follower:   false,
	},
	"mule": {
		name:       "Mule",
		subtitle:   "follower",
		traits:     ["large", "hardy", "sure-footed", "cautious", "keen-nosed", "sterile"],
		hp:         14,
		damage:     "d6+1",
		damageForm: "hand, close",
		armor:      0,
		instinct:   "avoid danger",
		cost:       "care & grooming",
		follower:   true,
		portraitIcon: "fas fa-horse-head",
	},
	"horse": {
		name:       "Horse",
		subtitle:   "follower",
		traits:     ["large", "powerful", "keen-nosed"],
		traitsNote: "swift or hardy",
		hp:         10,
		damage:     "d6+3",
		damageForm: "hand, close, forceful",
		armor:      0,
		instinct:   "panic",
		cost:       "care & grooming",
		follower:   true,
		portraitIcon: "fas fa-horse",
	},
};

// Display order — matches the handout's Livestock & Other Beasts table (and the
// inventory-items sortOrder: dog 59 → horse 65).
export const BEAST_ORDER = ["dog-follower", "goat", "sheep", "pig", "donkey", "mule", "horse"];

export const BEAST_SLUGS = new Set(BEAST_ORDER);

// Keywords that mark a requisitionable steading asset as a follower-capable animal
// (Book I: "a PC might Requisition one of the town's horses"). Only the beasts the
// rules treat as proper followers (dog / mule / horse) are offered — livestock like
// goats aren't followers. Matched on the asset's free-text name, for a row with no
// structured `beast` field (a GM's own asset, or a custom requisition). "Horse" used as a
// modifier names gear, not an animal: "horse-drawn plows", "horse harness".
const REQUISITION_MOUNT_KEYWORDS = [
	{ re: /\b(draft\s+)?horses?\b(?!-|\s+(?:harness|tack|shoes?|feed|blankets?)\b)|\bmares?\b|\bstallions?\b|\bsteeds?\b|\bponies?\b|\bpony\b/i, slug: "horse" },
	{ re: /\bmules?\b/i, slug: "mule" },
	{ re: /\bdogs?\b|\bhounds?\b|\bmastiffs?\b/i, slug: "dog-follower" },
];

/**
 * If a requisitioned asset is a follower-capable animal, return the beast catalog entry to
 * build a follower from (else null). Used by the Requisition flow to offer "add as a
 * follower" when a PC requisitions the town's horses/mules/dogs.
 *
 * Takes the asset row or just its name. A row with a `beast` field says exactly what it is
 * (`{slug, count, traits}`, or `null` for "not an animal, whatever its name says"), as the
 * steading's seeded assets do: see STEADING_DEFAULTS.assets. Anything else is read from
 * the name.
 */
export function beastFollowerForAsset(asset) {
	const row = typeof asset === "object" && asset !== null ? asset : { name: asset };
	if (row.beast !== undefined) return _structuredBeast(row.beast);
	const n = assetLabel(row.name);
	const hit = REQUISITION_MOUNT_KEYWORDS.find(k => k.re.test(n));
	if (!hit) return null;
	const b = BEAST_CATALOG[hit.slug];
	if (!b) return null;
	// An asset that names its own pick settles the beast's either/or: "A pair of hardy
	// draft horses" are horses that took hardy, not swift.
	const chosenTraits = _traitChoices(b).filter(t => new RegExp(`\\b${t}\\b`, "i").test(n));
	return { slug: hit.slug, beast: b, chosenTraits, count: _assetCount(n) };
}

function _structuredBeast(spec) {
	const b = spec?.slug ? BEAST_CATALOG[spec.slug] : null;
	if (!b) return null;
	const count = Math.min(Math.max(Number(spec.count) || 1, 1), MAX_ASSET_COUNT);
	return { slug: spec.slug, beast: b, chosenTraits: [...(spec.traits ?? [])], count };
}

/** An asset line's name without the stat block a seeded line trails after a dash or a
 *  semicolon: "A pair of hardy draft horses - HP 10 each; ..." is "A pair of hardy draft horses". */
export function assetLabel(name) {
	return String(name ?? "").split(/\s+\p{Pd}\s+|;/u)[0].trim();
}

// How many animals an asset line names: "A pair of hardy draft horses" is two followers, not
// one. Only a count that LEADS the name is read ("Three ponies", "4 mules"); a number later
// on is something else ("Mule, 4 years old", "A horse named Six-Toes"), and "a pack of
// hounds" says no number, so each of those stays one.
const ASSET_COUNT_WORDS = { pair: 2, brace: 2, two: 2, three: 3, four: 4, five: 5, six: 6 };
const MAX_ASSET_COUNT   = 6;

function _assetCount(label) {
	const m = String(label ?? "").match(/^\s*(?:an?\s+)?(pair|brace|two|three|four|five|six|[2-9])\b/i);
	if (!m) return 1;
	const n = ASSET_COUNT_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
	return Math.min(Math.max(n, 1), MAX_ASSET_COUNT);
}

/** The tags a beast's note offers as an either/or ("swift or hardy"), else []. A note that
 *  is not a choice between named tags ("pick 2 more") offers none. */
function _traitChoices(beast) {
	const note = String(beast?.traitsNote ?? "");
	return /\bor\b/i.test(note) ? note.split(/\s+or\s+/i).map(s => s.trim()).filter(Boolean) : [];
}

/**
 * buildCustomFollower input for a beast catalog entry (a requisitioned mount, etc.).
 * `chosenTraits` are tags the beast's note left open that are already settled (see
 * beastFollowerForAsset); a choice still open is written into `notes`, so the follower
 * card says what is left to pick rather than dropping the handout's instruction.
 */
export function followerInputFromBeast(beast, { name, chosenTraits = [] } = {}) {
	if (!beast) return null;
	const chosen = (chosenTraits ?? []).filter(Boolean);
	return {
		// Which beast it was made from, kept on the record so what the animal IS (whether it feeds
		// itself, follower-party.js#followerFeedsItself) does not hang on a label or glyph the table
		// can change. "" for a beast object that is not one of the catalog's.
		beastSlug:    Object.keys(BEAST_CATALOG).find(slug => BEAST_CATALOG[slug] === beast) ?? "",
		name:         name || beast.name,
		typeLabel:    beast.follower ? "beast follower" : "livestock",
		// Per-beast icon (a dog looks like a dog, not a horse); fall back to the same
		// follower/livestock split the sheet's beast cards use for any beast lacking one.
		portraitIcon: beast.portraitIcon || (beast.follower ? "fas fa-dog" : "fas fa-wheat-awn"),
		tags:         [...(beast.traits ?? []), ...chosen],
		hp:           beast.hp,
		armor:        beast.armor,
		damage:       beast.damage + (beast.damageForm ? ` (${beast.damageForm})` : ""),
		instinct:     beast.instinct,
		cost:         beast.cost,
		notes:        beast.traitsNote && !chosen.length ? `Tags still to choose: ${beast.traitsNote}.` : "",
	};
}
