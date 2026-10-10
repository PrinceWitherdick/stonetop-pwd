// WHO A CHARACTER'S FOLLOWERS ARE, read from their flags and playbook rather than off a sheet.
//
// The Followers tab builds a card per follower (StonetopCharacterSheet#_buildFollowersData), and that
// build is a whole tab's worth of display work. The camp (mouths, the night's heal) and the expedition
// (load rows) only need to know which followers a character HAS, whether each travels with the party,
// and their HP. Reading that off the sheet tied them to the Stonetop sheet class being the one in use,
// and to the tab building without a throw. This module is where both sides read it from instead: the
// flag layout per follower kind, which built-in followers are present, and each one's max HP. The sheet
// builds its cards on the same readers, so a card's HP box and the camp's heal cannot disagree.

import { BEAST_CATALOG, BEAST_ORDER } from "../../data/beasts.js";
import { crewExists } from "../../utils/crew.js";
import { readableFlags } from "./StonetopFlags.js";
import { ownsMoveNamed } from "./owns-move.js";
import { ANIMAL_COMPANION_MOVE, canonicalCompanionTraits, companionStats } from "./animal-companion.js";
import { activeInitiateOptions } from "./initiates.js";
import { followerInPartyFlags, partyFollowers } from "./follower-party.js";

// Per-follower-type flag layout — the single source of truth the read side (the sheet's
// _buildFollowersData, followerRoster below) and the write side (the sheet's activateListeners)
// resolve paths through, so the two can't drift and a new follower type is one row:
//   detailBase  – `.details` namespace for hand-edited extras (moves / notes /
//                 gear) and the Damage / Instinct / Cost overrides. The `.details`
//                 sub-key on the singular types keeps these clear of the
//                 structural flags (name, loyalty, the crew's gear-pip inventory
//                 at `crew.gear`, tags…). `{slug}` is filled per instance for the
//                 repeatable types.
//   loyalty     – the (older) Loyalty store: scalar for the singular animal
//                 companion / crew, per-slug for initiates / beasts.
//   structural  – type-root fields the player edits directly. name / pronoun,
//                 plus instinct / cost on the types that carry them from
//                 onboarding. Editing one writes here, NOT to the override layer,
//                 so it can be cleared — an empty override would otherwise fall
//                 back to the onboarding value (see withStatOverrides).
export const FOLLOWER_FLAGS = {
	"animal-companion": { detailBase: "animalCompanion.details", loyalty: "animalCompanion.loyalty", readiness: "animalCompanion.readiness", ammo: "animalCompanion.ammo",
		structural: { name: "animalCompanion.name", pronoun: "animalCompanion.pronoun", instinct: "animalCompanion.instinct", cost: "animalCompanion.cost" } },
	"crew":             { detailBase: "crew.details",            loyalty: "crew.loyalty",            readiness: "crew.readiness",            ammo: "crew.ammo",
		structural: { name: "crew.name", instinct: "crew.instinct", cost: "crew.cost" } },
	"initiate":         { detailBase: "initiateDetails.{slug}",  loyalty: "initiatesLoyalty.{slug}", readiness: "initiatesReadiness.{slug}", ammo: "initiatesAmmo.{slug}", structural: {} },
	"beast":            { detailBase: "beastDetails.{slug}",     loyalty: "beastLoyalty.{slug}",     readiness: "beastReadiness.{slug}",     ammo: "beastAmmo.{slug}",     structural: {} },
	// Custom followers (the walkthrough / monster conversion) store everything —
	// structural stats, the hand-edited overrides, Loyalty and current HP — in one
	// object keyed by the follower's id. detailBase points at that whole object, so
	// the shared override (damage/instinct/cost) and extras (moves/notes/gear)
	// handlers read and write it directly; name/pronoun fall through to it too
	// (structural is empty, so the name-field change handler uses the detail path).
	"custom":           { detailBase: "customFollowers.{slug}",  loyalty: "customFollowers.{slug}.loyalty", readiness: "customFollowers.{slug}.readiness", ammo: "customFollowers.{slug}.ammo", structural: {} },
};

/** A FOLLOWER_FLAGS path template with its `{slug}` filled, or null for no template. */
export const fillFollowerSlug = (tpl, slug) => tpl == null ? null : tpl.replaceAll("{slug}", slug ?? "");

/** `.details` namespace for a follower's hand-edited extras + stat overrides, or null. */
export function followerDetailBase(ftype, slug) { return fillFollowerSlug(FOLLOWER_FLAGS[ftype]?.detailBase, slug); }

/** A follower's detail flags (followerDetailBase), read out of the character's resolved flags. */
export function followerDetailFlags(sf, ftype, slug = "") {
	const base = followerDetailBase(ftype, slug);
	return base ? (foundry.utils.getProperty(sf ?? {}, base) ?? {}) : {};
}

/** Current HP against a max, with the shared "unset → full" default: a missing or non-numeric
 *  stored value means the follower is at full HP. */
export function clampFollowerHp(raw, max) {
	const n = Number(raw);
	return raw != null && Number.isFinite(n) ? Math.min(Math.max(0, n), max) : max;
}

/**
 * A hand-edited stat override (follower armor / max HP, or a crew's per-member stats): a
 * non-negative integer, or null when blank/non-numeric so callers can fall back to the
 * rules-derived value.
 */
export function intOverrideOrNull(value) {
	// Treat blank/empty/null as "no override" → null. (Number("") and Number(null)
	// are both 0, so without this guard a cleared field would read as an explicit 0,
	// zeroing crew armor or collapsing per-member HP instead of reverting to derived.)
	if (value == null || String(value).trim() === "") return null;
	const n = Number(value);
	return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}

/** A follower's hand-set Max HP (Updating followers, p.480) from its detail flags, or null for none. */
export function followerHpMaxOverride(details) {
	const m = intOverrideOrNull(details?.hpMax);
	return m !== null && m > 0 ? m : null;
}

/** The crew's per-member max HP: the hand-set override, else the Marshal's crew bonuses' (never 0). */
export function crewMemberHpMax(sf, crewStats = {}) {
	return (intOverrideOrNull(sf?.crew?.details?.hpMax) ?? crewStats?.memberHp ?? 6) || 1;
}

/**
 * The animal companion's base, or null when the character has none: a stored type, a companion
 * definition (the Ranger's, or one borrowed through a learned Animal Companion), and the move.
 * Its stats are the type's line, each held option's effects, and Beast of Legend's bonuses.
 */
export function companionBase(actor, sf, companionDef, companionBonuses) {
	const slug = sf?.animalCompanion?.type;
	if (!slug || !companionDef || !ownsMoveNamed(actor, ANIMAL_COMPANION_MOVE)) return null;
	const typeData = (companionDef.types ?? []).find(t => t.slug === slug);
	// Stored picks under the labels the type prints now (a renamed option's old
	// spelling is read through the type's `aliases`, animal-companion.js).
	const traits = canonicalCompanionTraits(typeData, sf.animalCompanion?.traits ?? []);
	const stats = typeData ? companionStats(typeData, traits, companionBonuses) : null;
	return { slug, typeData, traits, stats, hpMax: stats?.hp ?? 0 };
}

/** The beasts a character owns (added through the Add Special Item picker), in the handout's order. */
export function ownedBeastSlugs(sf) {
	const owned = sf?.inventory?.addedSpecial ?? [];
	return BEAST_ORDER.filter(slug => owned.includes(slug));
}

/** The custom followers as `[id, record]`, in their stored `order` (creation time). */
export function orderedCustomFollowers(sf) {
	return Object.entries(sf?.customFollowers ?? {})
		.sort((a, b) => (Number(a[1]?.order) || 0) - (Number(b[1]?.order) || 0));
}

/**
 * Every follower a character has, as plain records: `{ftype, slug, name, party, dead, hpMax,
 * hpCurrent, memberHp?, groupMemberHp?, isGroup, details}`. PURE but for ownsMoveNamed's read of the
 * actor's items. The same presence rules and max HP the Followers tab's cards are built from.
 *
 * @param {Actor} actor
 * @param {object} sf  the character's resolved flags
 * @param {{playbookDoc?: object, crewDef?: object, companionDef?: object, crewStats?: object,
 *          companionBonuses?: object}} ctx  what StonetopCharacter's follower readers return
 */
export function followerRoster(actor, sf, { playbookDoc = null, crewDef = null, companionDef = null, crewStats = {}, companionBonuses = {} } = {}) {
	const out = [];
	const push = (ftype, slug, rec) => {
		const details = followerDetailFlags(sf, ftype, slug);
		const hpMax = rec.hpMax == null ? null : (followerHpMaxOverride(details) ?? rec.hpMax);
		out.push({
			ftype, slug,
			dead: false,
			isGroup: false,
			...rec,
			hpMax,
			hpCurrent: hpMax == null ? null : clampFollowerHp(rec.hpRaw, hpMax),
			party: followerInPartyFlags(sf, ftype, slug),
			details,
		});
	};

	const companion = companionBase(actor, sf, companionDef, companionBonuses);
	if (companion) {
		push("animal-companion", "", { name: sf.animalCompanion?.name || "Animal Companion", hpMax: companion.hpMax, hpRaw: sf.animalCompanion?.hpCurrent });
	}
	if (crewDef && crewExists(sf?.crew)) {
		// A group: its HP is the roster's, member by member, against one per-member max.
		push("crew", "", { name: sf.crew.name || "Crew", hpMax: null, isGroup: true, memberHp: crewMemberHpMax(sf, crewStats) });
	}
	for (const opt of activeInitiateOptions(playbookDoc?.backgrounds, sf ?? {})) {
		push("initiate", opt.slug, { name: opt.label ?? "Initiate", hpMax: Number(opt.hp) || 0, hpRaw: sf.initiatesHp?.[opt.slug] });
	}
	for (const slug of ownedBeastSlugs(sf)) {
		const b = BEAST_CATALOG[slug];
		push("beast", slug, { name: b?.name ?? slug, hpMax: Number(b?.hp) || 0, hpRaw: sf.beastHp?.[slug] });
	}
	for (const [id, c] of orderedCustomFollowers(sf)) {
		// A Servant batch that broke free (Send Them Back 6-) is "no longer followers" (Book II p.561):
		// its card stays until removed, but it neither camps, fights nor travels as one.
		if (c?.brokenFree) continue;
		const hpMax = Number(c?.hpMax) || 0;
		push("custom", id, {
			name: c?.name || "Follower", hpMax, hpRaw: c?.hpCurrent, dead: !!c?.dead,
			isGroup: !!c?.isGroup, ...(c?.isGroup ? { groupMemberHp: hpMax || 1 } : {}),
		});
	}
	return out;
}

/**
 * A character's followers (followerRoster), with the playbook and move bonuses looked up through
 * their StonetopCharacter. Never throws: when the playbook can't be read, the followers the flags
 * alone can say (beasts and custom followers) still answer, and the console says why the rest don't.
 */
export async function followerRosterOf(actor) {
	if (!actor) return [];
	const character = actor.typedActor;
	try {
		const playbookDoc = await character.playbook();
		const [crewDef, companionDef] = await Promise.all([character.crewSource(playbookDoc), character.companionSource(playbookDoc)]);
		const { crewStats, companionBonuses } = await character.followerCardBonuses(playbookDoc, crewDef);
		return followerRoster(actor, readableFlags(actor), { playbookDoc, crewDef, companionDef, crewStats, companionBonuses });
	} catch (err) {
		console.warn(`Stonetop | could not read ${actor.name}'s playbook followers; only beasts and custom followers are counted`, err);
		return followerRoster(actor, readableFlags(actor));
	}
}

/** The followers travelling with a character's party, alive (followerRosterOf, filtered). */
export async function partyFollowersOf(actor) {
	return partyFollowers(await followerRosterOf(actor));
}
