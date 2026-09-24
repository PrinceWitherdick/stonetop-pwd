// ── What a blow looks and sounds like ────────────────────────────────────────────────────────
// The pure half of the attack effects (combat/attack-fx.js is the half that talks to Sequencer
// and the speakers). Nothing here reads a Foundry global, so every question it answers -- "what is
// a bandit's `spears (close, thrown)`?", "does a spear thrown with Let Fly fly or stab?" -- is a
// plain function a test can ask without standing a world up.
//
// WHY THE SYSTEM PICKS THE ANIMATION ITSELF. A dnd5e table gets its swings from Automated
// Animations, which matches an ITEM's name against a menu the GM keeps. Stonetop's weapons are
// mostly not items at all: a PC's sword is an inventory slug, a gear choice is `possession:choice`,
// and a monster's bite is a phrase in its stat block's damage line. So the kinds below are read off
// what the attack flow actually carries -- the WEAPON_META slug, the weapon's name, the blow's
// printed name, its range tags -- and a table that has never configured anything still sees an
// arrow fly when an arrow is loosed.
//
// JB2A KEYS ARE LISTS, IN PREFERENCE ORDER. The free module (JB2A_DnD5e) and the Patreon one
// (jb2a_patreon) each carry keys the other lacks, so every kind names what it would like best
// first and something the free module surely has last. The caller (attack-fx.js#jb2aHas) takes
// the first one Sequencer's database actually holds. Marked P (Patreon only) and F (free only)
// where it matters; unmarked keys are in both.

/** The SoundFx Library module's folder; its folder names carry spaces, which the browser encodes. */
const SFX = "modules/soundfxlibrary/";

const span = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const numbered = (dir, stem, nums) => Object.freeze(nums.map(n => `${SFX}${dir}/${stem}-${n}.mp3`));

/**
 * Every sound this system plays, one explicit file per entry.
 *
 * NEVER A WILDCARD. A `*` path is resolved through the file browser, which a player may not be
 * allowed to open, and the sound they triggered would fail on their client alone. Shield Hit has
 * no `-2` in the module; the list says so rather than a range that would name a missing file.
 */
export const SOUND_FILES = Object.freeze({
	meleeHit:    numbered("Combat/Single/Melee Hit", "melee-hit", span(1, 13)),
	whoosh:      numbered("Combat/Single/Melee Miss", "melee-miss", [1]),
	flyBy:       numbered("Combat/Single/Arrow Fly-By", "arrow-fly-by", span(1, 3)),
	arrowImpact: numbered("Combat/Single/Arrow Impact", "arrow-impact", span(1, 5)),
	shieldHit:   numbered("Combat/Single/Shield Hit", "shield-hit", [1, ...span(3, 12)]),
	throwHit:    numbered("Combat/Single/Throw Hit", "throw-hit", [1]),
	impact:      numbered("Misc/Single/Impact", "impact", span(1, 6)),
	growl:       numbered("Creatures/Monsters/Growl", "growl", span(1, 6)),
});

const kind = files => Object.freeze(Object.fromEntries(
	Object.entries(files).map(([delivery, list]) => [delivery, Object.freeze(list.map(k => `jb2a.${k}`))]),
));

/**
 * Each kind of blow, by the way it can be delivered: `swing` (a melee arc from the attacker toward
 * the target), `throw` and `projectile` (stretched from one to the other), `onTarget` (played on
 * the one struck), and `landing` (on the target as a projectile arrives, for the flask's fire).
 */
export const FX_KINDS = Object.freeze({
	sword:      kind({ swing: ["sword.melee.01.white"] }),
	shortsword: kind({ swing: ["shortsword.melee.01.white"] }),
	dagger:     kind({ swing: ["dagger.melee.02.white"], throw: ["dagger.throw.01.white"] }),
	handaxe:    kind({ swing: ["handaxe.melee.standard.white"], throw: ["handaxe.throw.01" /* P */, "dagger.throw.01.white"] }),
	greataxe:   kind({ swing: ["greataxe.melee.standard.white"] }),
	mace:       kind({ swing: ["mace.melee.01.white"] }),
	flail:      kind({ swing: ["melee_attack.01.flail.01" /* F */, "mace.melee.01.white"] }),
	club:       kind({ swing: ["club.melee.01.white"] }),
	maul:       kind({ swing: ["maul.melee.standard.white"] }),
	hammer:     kind({ swing: ["warhammer.melee.01.white"] }),
	spear:      kind({ swing: ["spear.melee.01.white"], throw: ["spear.throw.01" /* P */, "javelin.01.throw" /* P */, "arrow.physical.white.01"] }),
	staff:      kind({ swing: ["quarterstaff.melee.01.white"] }),
	holy:       kind({ swing: ["melee_attack.01.magic_sword.yellow.01", "sword.melee.01.white"] }),
	fist:       kind({ swing: ["melee_generic.creature_attack.fist.001.red" /* F */, "unarmed_strike.physical.01.blue"] }),
	slash:      kind({ swing: ["melee_generic.slash.01.orange"] }),
	javelin:    kind({ throw: ["javelin.01.throw" /* P */, "spear.throw.01" /* P */, "arrow.physical.white.01"] }),
	arrow:      kind({ projectile: ["arrow.physical.white.01"] }),
	bolt:       kind({ projectile: ["bolt.physical.orange"] }),
	sling:      kind({ projectile: ["slingshot" /* P */, "bullet.01.orange"] }),
	flask:      kind({ projectile: ["throwable.throw.flask.01.orange"], landing: ["impact.fire.01.orange"] }),
	bite:       kind({ onTarget: ["bite.400px.red"] }),
	claw:       kind({ onTarget: ["claws.400px.red"] }),
	fire:       kind({ onTarget: ["impact.fire.01.orange"] }),
	burst:      kind({ onTarget: ["impact.010.red" /* P */, "impact.010.orange"] }),
});

/**
 * What any delivery falls back to when its kind's own list finds nothing in this world's database:
 * a JB2A update that renames a key should cost the blow its flourish, not its animation.
 */
const DELIVERY_FALLBACK = Object.freeze({
	swing:      FX_KINDS.slash.swing,
	throw:      FX_KINDS.arrow.projectile,
	projectile: FX_KINDS.arrow.projectile,
	onTarget:   FX_KINDS.burst.onTarget,
	landing:    [],
});

/** The burst a token wears when Apply actually takes HP off it (hitReaction). */
export const HIT_BURST = FX_KINDS.burst.onTarget;

/**
 * WEAPON_META's slugs (data/weapons.js), plus the Lightbearer's holy light, as kinds. A gear-choice
 * weapon's slug is `possession:choice` and is read by its choice (blowKind strips the rest).
 */
const SLUG_KINDS = Object.freeze({
	"staff": "staff",
	"knife-dagger": "dagger",
	"silver-alloy-dagger": "dagger",
	"spear": "spear",
	// Reach and no `thrown`, so it always swings (blowDelivery): nobody throws a long spear.
	"long-spear": "spear",
	"maul": "maul",
	"hatchet": "handaxe",
	"mattock": "hammer",
	"mace-or-flail": "mace",
	"battleaxe": "greataxe",
	"short-sword": "shortsword",
	"sword": "sword",
	"warhammer": "hammer",
	"javelins": "javelin",
	"bow-arrows": "arrow",
	"composite-bow": "arrow",
	"crossbow": "bolt",
	"sling": "sling",
	"naphtha": "flask",
	"purifying-flames-holy-light": "holy",
});

/**
 * Words in a weapon's or a blow's name, as kinds. The EARLIEST match in the text wins, and a tie
 * goes to the row higher up: "bite or maul" is a bite, the Spirit-talker's "club, adz" is a club,
 * and "short sword" is a short sword rather than a sword. `crossbow` sits above `bow` for reading
 * order only; `\bbow` cannot match inside "crossbow" in any case.
 */
const NAME_KINDS = Object.freeze([
	[/\bcrossbows?\b/, "bolt"],
	[/\b(?:bows?|longbows?|shortbows?|arrows?)\b/, "arrow"],
	[/\bslings?\b/, "sling"],
	[/\bjavelins?\b/, "javelin"],
	[/\b(?:naphtha|flasks?)\b/, "flask"],
	[/\b(?:spears?|lances?|pikes?)\b/, "spear"],
	[/\b(?:hatchets?|hand-?axes?)\b/, "handaxe"],
	[/\b(?:axes?|battleaxes?|adzes?|adz)\b/, "greataxe"],
	[/\b(?:knife|knives|daggers?)\b/, "dagger"],
	[/\bshort[ -]?swords?\b/, "shortsword"],
	[/\b(?:swords?|blades?)\b/, "sword"],
	[/\bmauls?\b/, "maul"],
	[/\b(?:hammers?|warhammers?|mattocks?|picks?)\b/, "hammer"],
	[/\bflails?\b/, "flail"],
	[/\bmaces?\b/, "mace"],
	[/\b(?:clubs?|cudgels?)\b/, "club"],
	[/\b(?:staff|staves|quarterstaff)\b/, "staff"],
	[/\b(?:bites?|jaws?|fangs?|maw)\b/, "bite"],
	[/\b(?:claws?|talons?)\b/, "claw"],
	[/\b(?:breath\w*|fire|flames?)\b/, "fire"],
	[/\b(?:unarmed|fists?|punch\w*|kicks?|gore|horns?|antlers?|tusks?|slam\w*)\b/, "fist"],
]);

const MELEE_REACH = new Set(["hand", "close", "reach"]);
const AT_RANGE = new Set(["near", "far", "thrown"]);

/** The moves that throw a weapon that could be thrown or swung: they are Let Fly's shape. */
const THROWING_MOVES = new Set(["let-fly", "call-the-shot"]);

const PROJECTILE_KINDS = new Set(["arrow", "bolt", "sling", "flask"]);
const ON_TARGET_KINDS = new Set(["bite", "claw", "fire", "burst"]);

function kindInName(text) {
	const said = String(text ?? "").toLowerCase();
	if (!said) return null;
	let best = null;
	for (const [pattern, found] of NAME_KINDS) {
		const at = said.search(pattern);
		if (at >= 0 && (best === null || at < best.at)) best = { at, kind: found };
	}
	return best?.kind ?? null;
}

/**
 * What kind of blow this is, from what the attack flow carries.
 *
 * In order: the weapon's slug; a word in the weapon's name, then in the blow's printed name (a
 * monster's weapon record is nameless, and its "bite" is the card's title); bare hands; the range
 * words among its tags; and at the last a plain slash, because a blow nothing here recognises is
 * still a blow.
 *
 * @param {object} p
 * @param {object|null} p.weapon  the card's weapon record (attack-flow.js#serializeWeapon, or
 *   utils/damage.js#attackWeapon for a stat block's blow), or null for bare hands
 * @param {string} [p.blow]       the blow's printed name, e.g. "bite", "slings", "Damage: Sword"
 * @returns {{kind: string, thrownCapable: boolean}}
 */
export function blowKind({ weapon = null, blow = "" } = {}) {
	const words = new Set([...(weapon?.range ?? []), ...(weapon?.tags ?? [])].map(w => String(w).toLowerCase()));
	const thrownCapable = words.has("thrown");
	const slug = String(weapon?.slug ?? "").split(":").pop();
	const found = SLUG_KINDS[slug] ?? kindInName(weapon?.name) ?? kindInName(blow);
	if (found) return { kind: found, thrownCapable };

	// Bare hands: no weapon at all, or the attack flow's own nameless hand-range record.
	if (!weapon || (!weapon.name && (weapon.range ?? []).includes("hand"))) return { kind: "fist", thrownCapable };

	if ([...words].some(w => MELEE_REACH.has(w))) return { kind: "slash", thrownCapable };
	if ([...words].some(w => AT_RANGE.has(w))) return { kind: "burst", thrownCapable };
	return { kind: "slash", thrownCapable };
}

/**
 * How a blow of `kind` travels: "swing", "throw", "projectile" or "onTarget".
 *
 * A weapon that can be thrown or swung (a spear, a hatchet) is thrown by the moves that throw and
 * swung by Clash, because the move is what the player chose. Anywhere else -- the sheet's Damage
 * button, the fight ring, a monster's stat block -- the map decides: in contact it stabs, at a
 * distance it flies.
 *
 * @param {string} kind
 * @param {object} [p]
 * @param {boolean} [p.thrownCapable]
 * @param {string}  [p.moveKey]   attack-flow.js ATTACK_MOVES key, or "" off a move
 * @param {boolean} [p.touching]  attacker and target tokens in contact
 */
export function blowDelivery(kind, { thrownCapable = false, moveKey = "", touching = false } = {}) {
	if (PROJECTILE_KINDS.has(kind)) return "projectile";
	if (ON_TARGET_KINDS.has(kind)) return "onTarget";
	if (kind === "javelin") return "throw";
	if (thrownCapable && FX_KINDS[kind]?.throw) {
		if (THROWING_MOVES.has(moveKey)) return "throw";
		if (moveKey === "clash") return "swing";
		return touching ? "swing" : "throw";
	}
	return "swing";
}

/** The JB2A keys worth trying for this kind and delivery, the delivery's own fallback last. */
export function fxFilesFor(kind, delivery) {
	return [...(FX_KINDS[kind]?.[delivery] ?? []), ...(DELIVERY_FALLBACK[delivery] ?? [])];
}

/** The first of `list` that `has` says exists, or null. */
export function fxFile(list, has) {
	return (list ?? []).find(path => has(path)) ?? null;
}

/**
 * A melee swing's size in grid units: five squares per square of the attacker's width, which is
 * Automated Animations' own sizing for these same files (they are 800x600 with the arc in the
 * middle, so a smaller number draws a swing that never reaches the foe beside you).
 */
export function swingSize(tokenWidth) {
	return 5 * Math.max(1, Number(tokenWidth) || 1);
}

/** A bite, a claw or a burst on a token: half again the token's larger side, in grid units. */
export function onTargetSize(width, height) {
	return 1.5 * Math.max(1, Number(width) || 1, Number(height) || 1);
}

/**
 * When a flight lands, for a client with no animation to wait on (attack-fx.js plays the landing
 * off the animation itself when there is one). Roughly JB2A's mid-range arrow and throw.
 */
export const LAND_WITHOUT_ANIMATION_MS = 1600;

/**
 * The sounds of one blow, however many it strikes: a volley is one volley.
 *
 * Each cue is `{sound, at}`: `sound` a SOUND_FILES key, `at` milliseconds after the blow begins or
 * "land" for the moment the flight arrives. A miss keeps only what is heard as it leaves.
 *
 * @param {string} kind
 * @param {string} delivery  blowDelivery's answer
 * @param {{missed?: boolean}} [p]
 * @returns {{sound: string, at: number|"land"}[]}
 */
export function blowSounds(kind, delivery, { missed = false } = {}) {
	if (delivery === "projectile") {
		const loosed = kind === "arrow" || kind === "bolt" ? "flyBy" : "whoosh";
		if (missed) return [{ sound: loosed, at: 0 }];
		const lands = kind === "flask" ? "impact" : kind === "sling" ? "throwHit" : "arrowImpact";
		return [{ sound: loosed, at: 0 }, { sound: lands, at: "land" }];
	}
	if (delivery === "throw") {
		return missed ? [{ sound: "whoosh", at: 0 }] : [{ sound: "whoosh", at: 0 }, { sound: "arrowImpact", at: "land" }];
	}
	if (missed) return [{ sound: "whoosh", at: 0 }];
	if (kind === "bite" || kind === "claw") return [{ sound: "growl", at: 0 }, { sound: "meleeHit", at: 350 }];
	if (kind === "fire" || kind === "burst") return [{ sound: "impact", at: 200 }];
	// A JB2A swing connects a little over half a second in.
	return [{ sound: "meleeHit", at: 550 }];
}

/**
 * What a token does when Apply is pressed on it: "burst" when its HP actually went down, "clank"
 * when the blow was stopped (armor took all of it, or a Defend's Mighty Rampart turned it aside),
 * null for a blow that was nothing to begin with.
 *
 * A clank is heard and not seen: the shield-hit says the armor held, and a burst over a token that
 * lost nothing would say the opposite.
 *
 * @param {{raw?: number, effective?: number, lowered?: boolean, ignored?: boolean}} row
 * @returns {"burst"|"clank"|null}
 */
export function hitReaction({ raw = 0, effective = 0, lowered = false, ignored = false } = {}) {
	if (lowered) return "burst";
	if (ignored || (Number(raw) > 0 && Number(effective) <= 0)) return "clank";
	return null;
}

/** The sound each hit reaction makes. */
export const REACTION_SOUNDS = Object.freeze({ burst: "impact", clank: "shieldHit" });
