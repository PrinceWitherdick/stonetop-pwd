// Follower → NPC Actor: the shape a follower card takes when it steps off the sheet
// and onto the map.
//
// Book I ("NPCs & Followers", p.475) already makes an NPC the substrate of every
// follower — "First, create them as an NPC," then give them the follower-only stats.
// Dragging a follower card onto the canvas reads that sentence backwards: the card's
// stats become an `npc` Actor, so a follower can stand on the battlemap like anyone
// else at the table. The conversion is the mirror of followerFromNpc (follower-build.js),
// and the two agree field for field — HP / armor / damage / instinct / tags / moves —
// so a follower recruited from an NPC and one that became an NPC read the same.
//
// Deliberately framework-free (Foundry globals are read defensively, never imported) so
// the mapping can be unit-tested without a world.

import { normalizeTags, parseFollowerArmor } from "./follower-build.js";
import { CREATURE_TYPES, CREATURE_TYPE_ICON_SUFFIX, creatureTypeIcon, creatureTypeForFaIcon } from "../bestiary/creature-types.js";
import { escHtml, isDefaultImg, stripHtmlToText } from "../utils/strings.js";
import { systemAssetVariants } from "../migration/compat.js";
import { SYSTEM_ID } from "../system-id.js";

/** dataTransfer `type` for a follower card dragged off a character sheet. */
export const FOLLOWER_DRAG_TYPE = "StonetopFollower";

/** Where followers-turned-actors are filed, so they don't scatter through the sidebar. */
export const FOLLOWER_FOLDER = { name: "Followers", color: "#6b5a3e" };

// Read defensively: this module is unit-tested outside Foundry, where CONST doesn't exist.
const _const = (group, key, fallback) => globalThis.CONST?.[group]?.[key] ?? fallback;

// Written once, spelled twice: NEW_SHOOT_MARKER is the file we WRITE, MARKER_IMGS below is
// every id it could already have been written under.
const SHOOT_SUFFIX = "assets/icons/followers/new-shoot.svg";

/** The shoot an initiate of Danu wears: the one follower glyph outside the taxonomy. */
export const NEW_SHOOT_MARKER = `systems/${SYSTEM_ID}/${SHOOT_SUFFIX}`;

/**
 * The path this marker used to live at, kept so hooks/Ready.js can lift an actor stamped
 * before the art changed onto the current file. Nothing else may read it: it is a migration
 * rung, not a fallback, and the file it names no longer exists.
 */
export const LEGACY_SHOOT_MARKERS = Object.freeze(
	systemAssetVariants("assets/icons/followers/sprout.svg")
);

// Follower cards show a Font Awesome glyph where they have no portrait, and most of those
// glyphs are the monster taxonomy's own (a converted monster literally carries its type's
// glyph), so the marks in assets/icons/bestiary/ answer for nearly all of them. These are
// the ones that aren't: two animals the taxonomy would call natural beasts, an initiate's
// shoot, and the generic monster glyph creatureTypeFaIcon falls back to.
const FOLLOWER_GLYPH_TYPES = Object.freeze({
	"fa-dog":        "natural-beast",     // a beast follower (the dog, the Hounds)
	"fa-wheat-awn":  "natural-beast",     // livestock
	"fa-dragon":     "unknown-origin",    // creatureTypeFaIcon's fallback glyph
});

// Most followers are people, so an unrecognised glyph stands in as one rather than as a
// question mark.
const DEFAULT_MARKER_TYPE = "human-individual";

// Font Awesome style/utility classes, which sit alongside the icon class ("fas fa-paw") and
// must not be mistaken for it.
const FA_NON_ICON = /^fa-(solid|regular|light|thin|duotone|brands|sharp|fw|lg|sm|xs|xl|2xl|spin|pulse|border|inverse|stack|beat|fade|flip|shake|bounce|rotate|pull)/;

/**
 * The stand-in art for a follower with no portrait of their own: the same mark their card
 * shows as a glyph, as a real image.
 *
 * A card's glyph can't be an Actor's `img` (Font Awesome is a font), so it resolves to the
 * nearest of the circular marks the rest of the system already uses for art-less creatures
 * (the Book I p.392 creature-type discs, which is what a monster created in this system gets
 * too). Nothing is invented: these are category marks that say what kind of thing this is,
 * never a picture of this particular follower.
 *
 * The initiate is the one case where the marker is not merely the nearest mark but the SAME
 * drawing the card wears, because Font Awesome ships that glyph as a Free CC BY 4.0 icon we
 * can carry as a file. See assets/icons/followers/new-shoot.svg for why it is the Free copy
 * and not the Pro one Foundry bundles.
 *
 * @param {string} portraitIcon  the card's icon classes, e.g. "fas fa-paw"
 */
export function followerMarkerImg(portraitIcon) {
	const glyph = String(portraitIcon ?? "").split(/\s+/)
		.find(c => c.startsWith("fa-") && !FA_NON_ICON.test(c));
	if (glyph === "fa-seedling") return NEW_SHOOT_MARKER;
	const type = FOLLOWER_GLYPH_TYPES[glyph] ?? creatureTypeForFaIcon(glyph) ?? DEFAULT_MARKER_TYPE;
	return creatureTypeIcon(type) ?? creatureTypeIcon(DEFAULT_MARKER_TYPE);
}

/**
 * Every mark followerMarkerImg can hand back, under every id this package has shipped under —
 * plus the shoot's retired file, since an actor still on it is just as plainly wearing a
 * stand-in. Matched as whole paths, tolerating a leading slash, exactly like the people
 * placeholders (utils/person-portrait.js).
 *
 * What this is FOR: telling a follower's Actor that is still wearing the disc WE gave it from one
 * somebody has since chosen art for. `isDefaultImg` cannot answer that — it knows Foundry's
 * mystery-man and the "human, individual" mark, but a converted beast's paw disc and an
 * initiate's shoot are just as much placeholders and are not in it. See
 * `syncFollowerActors` (actors/character/follower-actors.js), which is what asks.
 */
const MARKER_IMGS = new Set([
	...LEGACY_SHOOT_MARKERS,
	...systemAssetVariants(SHOOT_SUFFIX),
	...CREATURE_TYPES.flatMap(t => systemAssetVariants(`${CREATURE_TYPE_ICON_SUFFIX}/${t.slug}.svg`)),
]);

/** True when `img` is one of the category marks this system hands an art-less follower. */
export function isFollowerMarkerImg(img) {
	if (!img) return false;
	return MARKER_IMGS.has(String(img).replace(/^\//, ""));
}

/**
 * The portrait the card chose for itself, or "" where it is wearing a stand-in.
 *
 * ONE predicate, because the two readers below must never disagree about it: if the picture
 * falls back to a marker disc but the frame does not, a rect measured against a picture the
 * actor no longer wears gets written anyway — which is the exact thing the frame rule exists
 * to prevent.
 */
function _ownPortrait(follower) {
	const own = String(follower?.img ?? "").trim();
	return own && !isDefaultImg(own) ? own : "";
}

/**
 * The picture a follower's Actor should wear: the portrait chosen on their card, or — where
 * there is none — the category mark their card shows as a glyph (followerMarkerImg).
 *
 * Its own function because two paths need the same answer and must not drift: the Actor built
 * when a follower is added (below), and the sweep that repoints an existing one after somebody
 * changes the card's portrait (syncFollowerActors).
 */
function followerPortraitImg(follower = {}) {
	return _ownPortrait(follower) || followerMarkerImg(follower?.portraitIcon);
}

/**
 * The frame that rides along with that picture, or null.
 *
 * Only where the follower's OWN portrait survived the placeholder check: a rect measured against
 * a picture the actor no longer wears is dead weight. The `src` stamp would neutralise it anyway;
 * not writing it is simply honest.
 */
export function followerPortraitFrame(follower = {}) {
	return _ownPortrait(follower) ? (follower?.portraitFrame ?? null) : null;
}

/** Lines of an HTML paragraph run, escaped; blank input yields nothing. */
function _paragraphs(text) {
	return String(text ?? "")
		.split("\n")
		.map(l => l.trim())
		.filter(Boolean)
		.map(l => `<p>${escHtml(l)}</p>`);
}

/**
 * The NPC's `system.notes`: everything the follower card carries that the NPC sheet has
 * no field of its own for — what they're owed (Cost), what they're carrying (Gear), and
 * the card's own free notes. Written as prose rather than dropped, so the token's actor
 * is a complete record of the follower and nothing has to be re-typed.
 *
 * Only TICKED gear is listed, which is what a ticked box on a follower card means — they
 * have it on them (the same reading `_followerBearsShield` takes of the same field). It
 * also keeps a Marshal's crew from dropping its entire printed inventory list in here when
 * it is carrying six things. Crew gear labels are the rulebook's marked-up strings, so the
 * markup is stripped before the text is escaped.
 */
export function followerNotesHtml(follower = {}) {
	const out = [];
	const cost = String(follower.cost ?? "").trim();
	if (cost) out.push(`<p><strong>Cost:</strong> ${escHtml(cost)}</p>`);
	const gear = (Array.isArray(follower.gear) ? follower.gear : [])
		.filter(g => (typeof g === "string" ? true : !!g?.checked))
		.map(g => (typeof g === "string" ? g : g.label))
		.map(l => stripHtmlToText(l))
		.filter(Boolean);
	if (gear.length) out.push(`<p><strong>Gear:</strong> ${escHtml(gear.join(", "))}</p>`);
	out.push(..._paragraphs(follower.notes));
	return out.join("");
}

/**
 * Split a follower's display name into the name they're called and the epithet trailing
 * it. Several followers are written as a name plus a descriptive tail — the Blessed's
 * initiates of Danu are printed exactly that way ("Enfys, your acolyte, beloved by
 * birds") — which reads well on the follower card, where it's set on stacked lines, and
 * badly as an Actor's name, where it becomes a title bar and a token label.
 *
 * The first comma is the seam: what precedes it is the name, everything after it is
 * descriptive and belongs in the NPC's own `traits` field, which prints right below the
 * name in the sheet header. A name with no comma is left whole, and a string that opens
 * with a comma is treated as having no name to lift out rather than yielding an empty one.
 *
 * @returns {{name: string, traits: string}}
 */
export function splitFollowerName(fullName) {
	const full = String(fullName ?? "").trim();
	const comma = full.indexOf(",");
	if (comma < 0) return { name: full, traits: "" };
	const name = full.slice(0, comma).trim();
	if (!name) return { name: full, traits: "" };
	return { name, traits: full.slice(comma + 1).trim().replace(/^[,\s]+|[,\s]+$/g, "") };
}

/**
 * Every field a follower CARD is the author of, and where it lives on the Actor.
 *
 * ONE table, because two paths walk it: the Actor built when a follower is added
 * (followerNpcActorData) and the sweep that keeps an existing one in step afterwards
 * (syncFollowerActors, actors/character/follower-actors.js). Adding a field the card dictates is
 * one row here rather than an edit in both, so the created actor and the reconciled one cannot
 * come to disagree about what the card governs.
 *
 * ⚠ KEYED BY A PLAIN NAME, NEVER BY THE PATH. The stamp these keys are stored under is a flag
 * OBJECT, and Foundry expands dotted keys inside one — a key literally named `system.tags` would
 * be written as a nested `{system: {tags}}` tree and match nothing on the way back out.
 */
export const CARD_FIELD_PATHS = Object.freeze({
	name:        "name",
	// The token's label is the actor's name, kept as its own row because it is its own path: a
	// renamed follower whose token still announces the old name is the rename half-done.
	tokenName:   "prototypeToken.name",
	img:         "img",
	pronouns:    "system.pronouns",
	// The card's type line ("animal companion", "group follower") is this NPC's lot in life —
	// the same slot the steading's people use for "farmer, ex-mercenary".
	occupation:  "system.occupation",
	// The epithet the name was carrying ("your acolyte, beloved by birds"), which is precisely
	// what this field is for — the memorable descriptors that print beside the name.
	traits:      "system.traits",
	instinct:    "system.instinct",
	tags:        "system.tags",
	// The CEILING only. Current HP is deliberately absent: the token takes damage on the map and
	// the card tracks its own, and a sweep that wrote `value` would heal a follower mid-fight
	// every time their sheet re-rendered.
	hpMax:       "system.attributes.hp.max",
	armor:       "system.attributes.armor.value",
	armorSource: "system.attributes.armor.source",
	damage:      "system.attributes.damage.value",
	// The card's rollable die, so the NPC sheet's damage roll works straight away.
	damageRoll:  "system.attributes.damage.rollFormula",
	notes:       "system.notes",
});

/**
 * What the card says each of those fields should be, keyed as above. `img` is omitted rather than
 * blank when there is nothing to wear, so neither caller writes an empty portrait over anything.
 */
export function followerActorFields(follower = {}) {
	// "Enfys, your acolyte, beloved by birds" is a card heading, not a name: the epithet comes
	// off and lands in `traits`, where the NPC sheet prints it under the name.
	const split = splitFollowerName(follower?.name);
	const name  = split.name || "Follower";
	const img   = followerPortraitImg(follower);
	const fields = {
		name,
		tokenName:   name,
		pronouns:    String(follower?.pronoun ?? "").trim(),
		occupation:  String(follower?.typeLabel ?? "").trim(),
		traits:      split.traits,
		instinct:    String(follower?.instinct ?? "").trim(),
		tags:        normalizeTags(follower?.tags).join(", "),
		hpMax:       followerHpMax(follower),
		armor:       parseFollowerArmor(follower?.armor),
		armorSource: String(follower?.armorSource ?? "").trim(),
		damage:      String(follower?.damage ?? "").trim(),
		damageRoll:  String(follower?.damageRoll ?? "").trim(),
		notes:       followerNotesHtml(follower),
	};
	if (img) fields.img = img;
	return fields;
}

/**
 * What the card dictated, in the shape it is REMEMBERED in — the `followerCard` stamp, written by
 * creation (below) and re-written by the sweep that keeps an actor in step (syncFollowerActors).
 *
 * Its own function, and every key spelled out, because the stamp is stored as a flag OBJECT and
 * Foundry MERGES one of those: a key missing from a later write cannot displace the one already
 * stored, since dropping a subkey takes an explicit `-=`. `img` is the one key followerActorFields
 * omits rather than blanks (so neither writer puts an empty portrait over anything), so a follower
 * who LOST their portrait would leave the old path stamped for good — `_stampEq` would then
 * disagree on every single pass, and the sweep would re-write the stamp, and re-fire the NPC's
 * change ledger, on every render of the character sheet, forever. Writing it as "" makes the merge
 * harmless: there is no absent key left for the old value to survive under.
 */
export function followerCardStamp(fields, moves) {
	return { fields: { img: "", ...fields }, moves: [...moves] };
}

/**
 * The card's moves, cleaned. They become `npcMove` items — the same ones NpcToFollowerDialog reads
 * back when an NPC is recruited, so the round trip loses nothing.
 */
export function followerActorMoves(follower = {}) {
	return (Array.isArray(follower?.moves) ? follower.moves : [])
		.map(m => String(m ?? "").trim())
		.filter(Boolean);
}

/** The card's HP ceiling as a whole non-negative number. */
export function followerHpMax(follower = {}) {
	return Math.max(0, Math.trunc(Number(follower?.hp?.max) || 0));
}

/** Write `value` at a dotted `path`, making the objects along the way. */
function _setPath(target, path, value) {
	const keys = path.split(".");
	let node = target;
	for (const key of keys.slice(0, -1)) node = (node[key] ??= {});
	node[keys[keys.length - 1]] = value;
}

/**
 * Actor creation data for one follower snapshot (see the character sheet's
 * `_followerDragSnapshot`, which is the only writer of that shape).
 *
 * `hasStats` is always true: a follower is by definition someone who "regularly acts on a
 * PC's orders" (p.459), which is exactly the case the NPC sheet's optional stat block
 * exists for — and the card has real numbers to put in it.
 *
 * The token is FRIENDLY (they follow a PC) and shows its name on hover, matching what
 * StonetopActor#_preCreate gives every other NPC. A group follower — a crew, a warband, a
 * summoned batch — is left UNLINKED so its several tokens each track their own HP against
 * the shared max, the way the card's roster does; a single follower is linked, so the one
 * token and the one actor stay the same creature.
 *
 * No art is invented. A follower with a portrait wears it; one without gets the same
 * category mark their card shows as a glyph (see followerMarkerImg) rather than Foundry's
 * mystery-man silhouette — a symbol for what kind of thing they are, never a picture of
 * this particular follower.
 */
export function followerNpcActorData(follower = {}, { folder = null, origin = null } = {}) {
	const fields = followerActorFields(follower);
	const moves  = followerActorMoves(follower);
	const hpMax  = fields.hpMax;
	const hpValue = follower.hp?.value == null
		? hpMax
		: Math.min(hpMax, Math.max(0, Math.trunc(Number(follower.hp.value) || 0)));

	const data = { type: "npc", folder, system: {}, prototypeToken: {}, flags: {} };
	for (const [key, value] of Object.entries(fields)) _setPath(data, CARD_FIELD_PATHS[key], value);
	data.system.hasStats = true;
	// Current HP, which only creation sets: from here on it is the token's own (see hpMax above).
	data.system.attributes.hp.value = hpValue;
	data.items = moves.map(m => ({ name: m, type: "npcMove" }));
	Object.assign(data.prototypeToken, {
		displayName: _const("TOKEN_DISPLAY_MODES", "HOVER", 30),
		disposition: _const("TOKEN_DISPOSITIONS", "FRIENDLY", 1),
		actorLink:   !follower.isGroup,
	});
	data.flags[SYSTEM_ID] = {
		// Provenance: which character's follower card this actor was made from
		// ({characterUuid, ftype, slug}). Nothing reads it back today — it's here so a GM tidying
		// the sidebar can tell where an actor came from.
		followerOrigin: origin ?? null,
		// What the card dictated, remembered, so a later edit on the card can tell a field this
		// actor still holds AS GIVEN from one somebody has since changed on the NPC itself — the
		// same three-state rule `tokenFollowsPortrait` applies to a token, one level up. See
		// syncFollowerActors (actors/character/follower-actors.js).
		followerCard: followerCardStamp(fields, moves),
	};
	if (fields.img) {
		data.prototypeToken.texture = { src: fields.img };
		const frame = followerPortraitFrame(follower);
		if (frame) data.flags[SYSTEM_ID].portraitFrame = frame;
	}
	return data;
}
