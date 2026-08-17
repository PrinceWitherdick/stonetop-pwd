// Follower-building data & helpers (Book I, "NPCs & Followers" — Creating
// followers, pp.474–479). This is the rules content behind the Create-a-Follower
// walkthrough and the monster→follower conversion. It's deliberately
// framework-free (no Foundry globals) so the derivations can be unit-tested and
// reused by both dialogs and the character sheet.

import { creatureTypeFaIcon } from "../bestiary/creature-types.js";
import { isDefaultImg } from "../utils/strings.js";
import { customGroupSize } from "../utils/crew.js";
import { documentPortraitFrame } from "../utils/portrait-frame.js";

// ── Step 3: hit points (p.476–477) ───────────────────────────────────────────
// "How resilient are they? (pick 1)" then "What else applies? (pick all)".
export const FOLLOWER_HP_BASE = [
	{ key: "weak",  label: "Weak / frail / soft", hp: 3 },
	{ key: "able",  label: "Able-bodied",         hp: 6 },
	{ key: "tough", label: "Tough / strong / hard", hp: 9 },
];
export const FOLLOWER_HP_MODS = [
	{ key: "tiny",  label: "They are tiny",         hp: -2 },
	{ key: "large", label: "They are large",        hp: 4 },
	{ key: "fates", label: "The fates smile on them", hp: 2 },
];

// ── Step 4: armor (p.477) ────────────────────────────────────────────────────
export const FOLLOWER_ARMOR_BASE = [
	{ key: "cloth",   label: "Naught but cloth and flesh", armor: 0 },
	{ key: "leather", label: "Leathers or thick hide",     armor: 1 },
	{ key: "mail",    label: "Mail, scale, or similar",    armor: 2 },
	{ key: "steel",   label: "Steel, boney plates, carapace", armor: 3 },
	{ key: "magical", label: "Potent magical wards or supernatural resilience", armor: 4 },
];
export const FOLLOWER_ARMOR_MODS = [
	{ key: "tiny",    label: "They are tiny",          armor: 1 },
	{ key: "shield",  label: "They bear a shield or similar", armor: 1 },
	{ key: "skilled", label: "They are skilled in defense", armor: 1 },
	{ key: "organs",  label: "They lack vital organs", armor: 1 },
];

// ── Step 5: damage (p.477) ───────────────────────────────────────────────────
// "How dangerous are they? (pick 1)". Range and other tags come from gear.
export const FOLLOWER_DAMAGE_OPTIONS = [
	{ key: "weak",    label: "Not very",                  die: "d4" },
	{ key: "defends", label: "Can defend themselves",     die: "d6" },
	{ key: "veteran", label: "Veteran fighter or predator", die: "d8" },
];

// "Range and other tags come from their gear." Offered as chips on the damage
// step (grounded in the weapon ranges & tags used across Stonetop's gear); the
// player can also type their own. Selected chips + custom entries become the
// damage parenthetical, e.g. d6 (near, low ammo, forceful).
export const FOLLOWER_DAMAGE_TAG_GROUPS = [
	{ label: "Range", tags: ["hand", "close", "reach", "near", "far"] },
	{ label: "Gear tags", tags: [
		"forceful", "messy", "piercing", "thrown", "reload", "low ammo",
		"precise", "slow", "stun", "dangerous", "awkward", "grabby",
	] },
];

// ── Step 2: tags (p.476) ─────────────────────────────────────────────────────
// "Give followers a mix of tags that are useful, problematic, and mixed
// blessings." Offered as suggestions; the walkthrough also takes free-text tags.
export const FOLLOWER_TAG_GROUPS = [
	{ label: "Useful", tags: [
		"agile", "archer", "athletic", "beautiful", "brave", "cunning", "fast",
		"fierce", "hardy", "healer", "intimidating", "magical", "observant",
		"organized", "patient", "respected", "self-sufficient", "sharp-eyed",
		"stealthy", "tireless", "tracker", "warrior",
	] },
	{ label: "Problematic", tags: [
		"bigoted", "drunk", "greedy", "gullible", "lecherous", "naive", "proud",
		"rookie", "reckless", "short-fused", "stubborn", "frail",
	] },
	{ label: "Mixed blessing", tags: [
		"animal-lover", "annoying", "big", "bully", "callous", "cautious",
		"devious", "eager", "thieving", "gossipy", "honest", "kind", "little",
		"shameless", "terrifying",
	] },
];

// ── Step 6: instinct prompts for a follower (p.478) ──────────────────────────
// A follower's instinct "should cause trouble for the PC who leads them."
export const FOLLOWER_INSTINCT_EXAMPLES = [
	"To take things too far",
	"To question leadership and authority",
	"To cling tightly to tradition",
	"To act impulsively",
	"To give in to temptation",
	"To not take things seriously",
	"To freeze up in the face of danger",
];

// ── Step 8: cost (p.479) ─────────────────────────────────────────────────────
export const FOLLOWER_COST_EXAMPLES = [
	"Coin, payment, treasure",
	"Renown, public recognition",
	"Affection, respect (from you)",
	"Knowledge (about what?)",
	"Wrongs righted, good deeds done",
	"Amusement, entertainment",
	"Progress (towards a particular goal)",
];

// Sum a base option's value with the chosen modifiers' values, never below the
// floor (HP can't fall below 1; armor not below 0).
function _sum(base, mods, picks, field, floor) {
	const baseVal = base.find(o => o.key === picks?.base)?.[field] ?? 0;
	const set = new Set(Array.isArray(picks?.mods) ? picks.mods : []);
	const modVal = mods.reduce((t, o) => t + (set.has(o.key) ? o[field] : 0), 0);
	return Math.max(floor, baseVal + modVal);
}

/** Derived max HP from a {base, mods} pick. Floors at 1. */
export function deriveHp(picks) {
	return _sum(FOLLOWER_HP_BASE, FOLLOWER_HP_MODS, picks, "hp", 1);
}

/** Derived armor from a {base, mods} pick. Floors at 0. */
export function deriveArmor(picks) {
	return _sum(FOLLOWER_ARMOR_BASE, FOLLOWER_ARMOR_MODS, picks, "armor", 0);
}

/** The damage die for a chosen "how dangerous" key (e.g. "defends" → "d6"). */
export function deriveDamageDie(key) {
	return FOLLOWER_DAMAGE_OPTIONS.find(o => o.key === key)?.die ?? "d6";
}

// Join a damage die with an optional parenthetical form, e.g. ("d6", "hand") →
// "d6 (hand)". A form already wrapped in parens is left as-is.
export function formatDamage(die, form) {
	const d = String(die ?? "").trim();
	const f = String(form ?? "").trim().replace(/^\(|\)$/g, "").trim();
	if (!d) return f ? `(${f})` : "";
	return f ? `${d} (${f})` : d;
}

// Extract a follower's numeric armor from a value that may already be a number,
// a plain string ("2"), the book's conditional form ("2 (0 vs. iron)"), or a
// placeholder ("—"). Returns the leading non-negative integer, or 0 when there's
// no number. Followers don't model conditional armor, so the "(0 vs. iron)"
// remainder is dropped here — keep it in a notes field if it matters.
export function parseFollowerArmor(raw) {
	if (typeof raw === "number") return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
	const m = String(raw ?? "").match(/-?\d+/);
	return m ? Math.max(0, parseInt(m[0], 10)) : 0;
}

// Normalize a free-text or array tag list into a clean, de-duplicated array of
// trimmed strings (case-insensitive de-dupe, first spelling wins).
export function normalizeTags(tags) {
	const out = [];
	const seen = new Set();
	const push = (t) => {
		const s = String(t ?? "").trim();
		if (!s) return;
		const k = s.toLowerCase();
		if (seen.has(k)) return;
		seen.add(k);
		out.push(s);
	};
	if (Array.isArray(tags)) tags.forEach(push);
	else String(tags ?? "").split(",").forEach(push);
	return out;
}

/**
 * Build the stored shape for a custom follower (the object kept at
 * flags.stonetop-pwd.customFollowers.<id>). Pure: the caller assigns the id and
 * an `order` for stable sorting. hpCurrent defaults to full unless given.
 */
export function buildCustomFollower(input = {}) {
	const hpMax = Math.max(0, Math.trunc(Number(input.hp) || 0));
	const hpCurrent = input.hpCurrent == null
		? hpMax
		: Math.min(hpMax, Math.max(0, Math.trunc(Number(input.hpCurrent) || 0)));
	const gear = (Array.isArray(input.gear) ? input.gear : [])
		.map(g => (typeof g === "string"
			? { label: g.trim(), checked: false }
			: { label: String(g?.label ?? "").trim(), checked: !!g?.checked }))
		.filter(g => g.label);
	// Group followers (NPCs & Followers p.470): a warband, posse, or converted
	// group-organization monster. `isGroup` turns on the roster + group-fight tools
	// (per-member HP against the shared `hpMax`, an abstracted group-HP pool, and the
	// outnumber calculator); `size` is the headcount. A group is at least 2 strong.
	const isGroup = !!input.isGroup;
	const size = isGroup ? customGroupSize(input) : 0;
	return {
		name:         String(input.name ?? "").trim(),
		pronoun:      String(input.pronoun ?? "").trim(),
		typeLabel:    String(input.typeLabel ?? "").trim() || (isGroup ? "group follower" : "follower"),
		portraitIcon: String(input.portraitIcon ?? "").trim() || (isGroup ? "fas fa-users" : "fas fa-user"),
		// A chosen portrait, shown on the card in place of the glyph above. Empty is the
		// normal state and means "no portrait", which is exactly what falls the card back to
		// portraitIcon — so a follower never needs one and nothing has to be migrated.
		img:          String(input.img ?? "").trim(),
		tags:         normalizeTags(input.tags),
		hpMax,
		hpCurrent,
		armor:        parseFollowerArmor(input.armor),
		damage:       String(input.damage ?? "").trim(),
		instinct:     String(input.instinct ?? "").trim(),
		moves:        String(input.moves ?? "").trim(),
		cost:         String(input.cost ?? "").trim(),
		notes:        String(input.notes ?? "").trim(),
		gear,
		butcher:      input.butcher ? String(input.butcher).trim() : null,
		loyalty:      Math.max(0, Math.trunc(Number(input.loyalty) || 0)),
		isGroup,
		size,
		sourceUuid:   input.sourceUuid ? String(input.sourceUuid) : null,
	};
}

/**
 * The portrait a follower recruited from an existing actor should wear: that actor's own
 * art, so the card shows the face the table already knows rather than a generic glyph.
 *
 * A stock placeholder is not art. Carrying one across would trade the follower type's
 * meaningful glyph (a paw, a seedling, a crowd) for Foundry's mystery-man silhouette, so
 * it resolves to "" and the glyph keeps the slot.
 */
function sourceActorImg(img) {
	return isDefaultImg(img) ? "" : String(img ?? "").trim();
}

// ── Order Followers roll math (p.462) ────────────────────────────────────────
// "Instead of rolling +STAT, roll and… +1 if they have at least one appropriate
// tag or move, or +2 if they're also exceptional; +0 if no relevant tag or move;
// roll with disadvantage if any of their tags would get in the way." Which tags
// help or hinder is a table judgment call, so the caller passes the counts the
// player resolved rather than this guessing from tag text.
//
// `helps` is how many of the follower's tags AND moves the player marked as
// applicable — the book counts both toward the bonus ("at least one appropriate
// tag or move"). `hinders` is tags only: only a tag can get in the way.
// `advantage`/`disadvantage` are the outside sources that don't come from the
// follower at all (Stentorian, Aid, Seek Insight; Interfere, a GM move), which is
// why they're separate toggles rather than more chips.
//
// Returns { bonus, rollMode } ready for rollStat. Note the rulebook edge case: an
// exceptional follower with no other applicable tag is still +0 — only helps > 0
// earns the +1/+2.
export function orderFollowersBonus({ helps = 0, hinders = 0, exceptional = false, advantage = false, disadvantage = false } = {}) {
	const h = Math.max(0, Math.trunc(Number(helps)   || 0));
	const x = Math.max(0, Math.trunc(Number(hinders) || 0));
	const bonus = h <= 0 ? 0 : (exceptional ? 2 : 1);
	// Advantage and disadvantage are binary and CANCEL each other out (p.230), so a
	// hindering tag does not simply beat an outside source of advantage: a Marshal
	// spending Command on Stentorian to order a follower whose mischievous tag is in
	// the way rolls a straight 2d6. Neither side stacks either — "by default, it
	// doesn't matter if you have multiple sources of advantage vs. a single source of
	// disadvantage" — so this is a boolean XOR, not a tally.
	const adv = !!advantage;
	const dis = x > 0 || !!disadvantage;
	const rollMode = adv === dis ? "normal" : (adv ? "adv" : "dis");
	return { bonus, rollMode };
}

// ── Readiness cap (Defend, p.216 / followers p.469) ──────────────────────────
// A follower (or crew) holds up to 3 Readiness on a 10+ Defend, 1 on a 7–9; a
// borne shield adds +1 to either, raising the cap to 4. Centralized so the pip
// builders and the on-sheet tooltips read the same numbers.
export const READINESS_BASE_CAP = 3;
export const READINESS_SHIELD_BONUS = 1;
// The Marshal's "Shield Wall" upgrades the shield bonus from +1 to +2 (they hold +2
// Readiness on a 7+ "instead of the usual +1 for shields"), so a Shield-Wall crew
// with shields can hold up to 5 — the cap has to allow it.
export const READINESS_SHIELD_WALL_BONUS = 2;
export function readinessCap(hasShield = false, shieldBonus = READINESS_SHIELD_BONUS) {
	return READINESS_BASE_CAP + (hasShield ? shieldBonus : 0);
}
// The move whose presence grants a crew the Shield-Wall Readiness bonus. Kept as data
// (like FOLLOWER_EXCEPTIONAL's move names) so the sheet doesn't hardcode the literal.
export const SHIELD_WALL_MOVE = "Shield Wall";

// ── Outnumber bonus (Followers in Fights / Dangers, Book I p.416) ─────────────
// A group that outnumbers its foe gets +1 damage AND +1 armor for each whole
// multiplier past 1:1 (3:1 → +2). The armor half is a fiction note (nothing auto-
// applies it); only the damage rewrites the group's roll. Shared by the crew /
// custom-group follower cards and the monster stat block's group-fight tools, so
// the rule, the readout string, and the roll rebuild can't drift between them.
export function outnumberBonus(yours, theirs) {
	const y = Math.max(1, parseInt(yours, 10)  || 1);
	const t = Math.max(1, parseInt(theirs, 10) || 1);
	const bonus = Math.max(0, Math.floor(y / t) - 1);
	return {
		bonus,
		label:   bonus > 0 ? `+${bonus} damage, +${bonus} armor` : "no bonus",
		rollFor: (base) => bonus > 0 ? `${base || "d6"}+${bonus}` : String(base || "d6"),
	};
}

// Next creation-order stamp for a custom follower: one past the largest existing
// `order` in the map, floored at Date.now() so two followers added the same
// millisecond still sort by insertion. Shared by the sheet and the dialogs that
// materialize followers (Requisition / arcana / possession summons).
export function nextFollowerOrder(existing = {}) {
	const max = Object.values(existing).reduce((m, f) => Math.max(m, Number(f?.order) || 0), 0);
	return Math.max(max + 1, Date.now());
}

// A monster's flavor tags are its tag string minus the organization and size,
// which the follower card surfaces differently (mirrors the monster sheet's
// display-tag split, NPCs & Followers vs. Dangers).
export function monsterFollowerTags(system = {}) {
	const org  = String(system.organization ?? "").trim().toLowerCase();
	const size = String(system.size ?? "").trim().toLowerCase();
	return normalizeTags(system.tags).filter(t => {
		const k = t.toLowerCase();
		return k !== org && k !== size;
	});
}

/**
 * Convert a monster's stats into custom-follower data (NPCs & Followers p.475:
 * "use its stats as-is", plus added tags, a chosen cost, and a Loyalty track).
 * `monster` carries { name, system, moves } (moves = array of move names); opts
 * supplies the player's added tags, cost, and pronoun.
 */
export function followerFromMonster(monster = {}, opts = {}) {
	const system = monster.system ?? {};
	const attrs  = system.attributes ?? {};
	const tags   = [...monsterFollowerTags(system), ...normalizeTags(opts.tags)];
	const hpMax  = Number(attrs.hp?.max ?? attrs.hp?.value) || 0;
	const damage = String(attrs.damage?.value ?? attrs.damage?.rollFormula ?? "").trim();
	return buildCustomFollower({
		name:         monster.name ?? "",
		pronoun:      opts.pronoun ?? "",
		typeLabel:    "follower",
		// Match the conversion dialog's banner: a follower keeps its monster's
		// creature-type glyph (an Adept is human → fa-user, not the generic paw).
		portraitIcon: `fas ${creatureTypeFaIcon(system.creatureType)}`,
		// …and its art, when the monster has any. The glyph above still backs it up for a
		// monster that never got a portrait.
		img:          sourceActorImg(monster.img),
		portraitFrame: documentPortraitFrame(monster),
		tags,
		hp:           hpMax,
		// Carry current HP as-is (buildCustomFollower clamps/normalizes); `?? hpMax`
		// only fills in when the monster has no current value. A `||` here would wrongly
		// promote a monster sitting at 0 HP to full.
		hpCurrent:    attrs.hp?.value ?? hpMax,
		armor:        parseFollowerArmor(attrs.armor?.value),
		damage,
		instinct:     String(attrs.instinct?.value ?? "").trim(),
		moves:        (Array.isArray(monster.moves) ? monster.moves : []).join("\n"),
		cost:         opts.cost ?? "",
		// A group- or horde-organization monster keeps its group identity as a
		// follower (the roster + group-fight tools), instead of collapsing to one
		// creature. The conversion dialog decides this from system.organization.
		isGroup:      !!opts.isGroup,
		size:         opts.size,
		sourceUuid:   monster.uuid ?? null,
	});
}

/**
 * Build custom-follower data from an "npc" Actor (NPCs & Followers p.475: "First,
 * create them as an NPC," then give tags / HP / armor / damage / instinct / cost).
 * An NPC that already carries game stats (system.hasStats) seeds its HP, armor,
 * damage and tags; one without stats seeds the book's able-bodied follower baseline
 * (6 HP, 0 armor, p.477). The dialog's editable fields (opts.hp/armor/damage) override
 * either. The follower keeps the NPC's uuid as its sourceUuid, so the card links back
 * to the actor it was recruited from and can never orphan.
 *
 * `npc` carries { name, system, uuid }; `opts` supplies the player's added tags, cost,
 * pronoun, moves (an array of GM-move names), any stat overrides, and group flags.
 */
export function followerFromNpc(npc = {}, opts = {}) {
	const system   = npc.system ?? {};
	const attrs    = system.attributes ?? {};
	const hasStats = !!system.hasStats;
	// Seed HP from the NPC's stats, else the "able-bodied" default (6). An explicit
	// opts.hp (the conversion dialog's editable field) always wins.
	const npcHp = hasStats ? (Number(attrs.hp?.max ?? attrs.hp?.value) || 0) : 0;
	const hpMax = opts.hp != null ? opts.hp : (npcHp || 6);
	const armor = opts.armor != null ? opts.armor : (hasStats ? attrs.armor?.value : 0);
	const damage = opts.damage != null
		? String(opts.damage)
		: (hasStats ? String(attrs.damage?.value ?? attrs.damage?.rollFormula ?? "").trim() : "");
	// A statted NPC carries its game-stat tags onto the follower; an unstatted one has none.
	const keptTags = hasStats ? normalizeTags(system.tags) : [];
	return buildCustomFollower({
		name:         npc.name ?? "",
		pronoun:      opts.pronoun ?? system.pronouns ?? "",
		typeLabel:    "follower",
		portraitIcon: "fas fa-user",
		// An NPC recruited off the steading's roster is usually already wearing a People of
		// Stonetop portrait, so the follower card shows the same face without being asked.
		img:          sourceActorImg(npc.img),
		// …and the square of it the roster was already showing, so a recruited NPC arrives on
		// the card wearing the face someone chose rather than a fresh blind top crop.
		portraitFrame: documentPortraitFrame(npc),
		tags:         [...keptTags, ...normalizeTags(opts.tags)],
		hp:           hpMax,
		hpCurrent:    opts.hpCurrent ?? (hasStats ? (attrs.hp?.value ?? hpMax) : hpMax),
		armor,
		damage,
		instinct:     String(system.instinct ?? "").trim(),
		moves:        (Array.isArray(opts.moves) ? opts.moves : []).join("\n"),
		cost:         opts.cost ?? "",
		isGroup:      !!opts.isGroup,
		size:         opts.size,
		sourceUuid:   npc.uuid ?? null,
	});
}

// Whether a monster's organization means it should become a GROUP follower, and a
// sensible starting headcount for it (NPCs & Followers p.470; the exact number is
// a table call, so these are just defaults the conversion dialog pre-fills).
export function monsterGroupDefaults(system = {}) {
	const org = String(system.organization ?? "").trim().toLowerCase();
	const count = Math.trunc(Number(system.count) || 0);
	if (org === "horde") return { isGroup: true, size: count > 1 ? count : 6 };
	if (org === "group") return { isGroup: true, size: count > 1 ? count : 3 };
	return { isGroup: false, size: 0 };
}
