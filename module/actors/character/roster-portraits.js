// The faces on a group follower's ROSTER: the crew's named individuals and anonymous members,
// and the members of any custom group follower.
//
// Every other portrait in the system hangs off something that already has a home. An Actor wears
// `img`. A follower CARD keeps one under its own detail namespace (_FOLLOWER_FLAGS in
// StonetopCharacterSheet.js), which is why one picker serves all five card types. A roster member
// has neither: a named crew individual is a row inside the `crew.individuals` flag ARRAY, and an
// anonymous member is not stored at all — it is derived from the headcount, and the only thing
// tracked per anonymous body is its current HP, in an array parallel to that count. So this is
// where the two of them get somewhere to keep a face, and it is one module rather than three
// scattered reads because the write rule below is easy to get wrong and must be stated once.
//
// ⚠ EVERY STORE HERE IS A FLAG ARRAY, and Foundry's update merge treats an array as an ATOMIC
// value. A dotted `crew.individuals.2.img` does NOT reach into element 2: it expands to
// `{ individuals: { 2: {…} } }` and replaces the whole array with an OBJECT, silently destroying
// the roster. Every write therefore clones the array, mutates the one slot, and writes the array
// back whole — the same rule, for the same reason, as legacyRowFrameHandle in
// utils/portrait-frame-handles.js. The flip side is that a plain `delete` on a slot key really
// does remove it, where an object flag would need an `-=` (see that file's asymmetry note).

import { SYSTEM_ID } from "../../system-id.js";
import { resolvedFlags } from "./StonetopFlags.js";
import { crewExists, crewAnonymousCount, customGroupSize } from "../../utils/crew.js";
import { normalizeFrame, resolvePortrait, portraitActionLabel } from "../../utils/portrait-frame.js";
import { PERSON_ROSTER_IMG } from "../../utils/person-portrait.js";

/**
 * Where each kind of roster member keeps its face. The keys are the SAME strings the HP writer
 * uses for these rows (follower-fate.js#followerFateHpPath: crew-individual / crew-member /
 * custom-member), so a roster row names itself one way for both of the things it stores.
 *
 * Where the face actually sits differs by kind, which is why the crew's two stores are different
 * arrays rather than one:
 *
 *  • A named individual already IS a stored object — `{name, tag, traits}` — so the portrait goes
 *    ON that object. It then rides the array splice when the member is removed, and needs none of
 *    the index re-keying `crew.individualsHp` (an index-keyed MAP) has to do.
 *  • An anonymous member has no object to hang it on, so its portrait IS the array slot, parallel
 *    to `memberHp` and spliced/sliced in lockstep with it.
 *
 * `{slug}` is the custom follower's id, filled in by rosterPortraitListPath.
 */
const ROSTER_STORES = {
	"crew-individual": "crew.individuals",
	"crew-member":     "crew.memberPortrait",
	"custom-member":   "customFollowers.{slug}.memberPortrait",
};

/**
 * Flag path (under this system's scope) of the array a roster kind stores into, or null for a
 * kind this module does not know. `slug` is the custom follower's id; the crew's stores are
 * singular and ignore it.
 *
 * Doubles as the WHITELIST for anything resolving a kind off a `data-roster` attribute (the
 * sheet's `_rosterAvatarRef`, `rosterMemberFrameHandle`): a null here is the one gate, so there is
 * no second list of legal kinds to fall out of step with this one.
 */
export function rosterPortraitListPath(kind, slug = "") {
	const path = ROSTER_STORES[kind];
	if (!path) return null;
	if (!path.includes("{slug}")) return path;
	// A custom follower's id is a randomID and never contains a dot, so the built path is safe —
	// but an EMPTY one would build `customFollowers..memberPortrait` and write into a phantom
	// follower, so a kind that needs a slug and has none resolves to nothing instead.
	return slug ? path.replace("{slug}", slug) : null;
}

/**
 * How many members of this roster actually exist right now — the bound a portrait write has to sit
 * inside. Read from the ROSTER's own headcount, not from the portrait array: the portrait store is
 * sparse (most members never get a face), so its length says nothing about who is on the roster.
 *
 *  • a named individual IS a stored row, so the row itself is the bound;
 *  • the crew's anonymous members are the unnamed tail of its headcount (utils/crew.js) — but
 *    only once there is a crew at all. `effectiveCrewSize` answers an absent size with the
 *    rulebook's half-dozen, so a character with NO crew record read as six anonymous members and
 *    the bound let every index 0-5 through, which is precisely the case below. Gated on the same
 *    `crewExists` the sheet draws the roster by, so the bound and the rendered roster agree;
 *  • a custom group's members are its whole `size`, since it has no named individuals.
 */
function liveMemberCount(actor, kind, slug) {
	const flags = resolvedFlags(actor);
	if (kind === "crew-individual") return (flags?.crew?.individuals ?? []).length;
	if (kind === "crew-member")     return crewExists(flags?.crew) ? crewAnonymousCount(flags?.crew) : 0;
	// A custom group that is not there at all has no members; one that IS there has at least two,
	// even before a size is ever stored (customGroupSize).
	const group = flags?.customFollowers?.[slug];
	return group ? customGroupSize(group) : 0;
}

/**
 * The stored array for a roster kind, CLONED so a caller can splice or slice it and write it
 * back whole. Always an array — a store that has never been written reads as empty.
 *
 * Read through resolvedFlags rather than a bare flag read, so a world not yet cut over from a
 * legacy flag scope still finds its roster.
 */
export function rosterPortraitList(actor, kind, slug = "") {
	const path = rosterPortraitListPath(kind, slug);
	if (!actor || !path) return [];
	const stored = foundry.utils.getProperty(resolvedFlags(actor), path);
	return Array.isArray(stored) ? foundry.utils.deepClone(stored) : [];
}

/**
 * What a roster member is wearing: `{ img, portraitFrame }`, both empty when they have no face.
 * The shape matches what `_followerExtras` reads off a follower card's detail flags, so the
 * render helper below and the frame handle can treat a roster row and a card alike.
 */
export function readRosterPortrait(actor, kind, slug = "", index = 0) {
	const slot = rosterPortraitList(actor, kind, slug)[Number(index)] ?? {};
	return {
		img:           String(slot?.img ?? "").trim(),
		portraitFrame: slot?.portraitFrame ?? null,
	};
}

/**
 * Store a face (and/or its frame) on one roster member, leaving everything else on that row
 * alone — a named individual's name, tag and traits live in the same object.
 *
 * `patch` keys set to `undefined` are DELETED rather than written, which is what "Use default"
 * and a frame clear both want. A plain delete is correct here precisely because the array is
 * replaced wholesale (see the warning at the top of this file).
 *
 * Writing past the end fills the gap with nulls rather than leaving holes, so the array survives
 * the JSON round-trip into the world database as the same length it was written at.
 *
 * Returns whether the write actually landed. Every refusal below is silent by design — none of
 * them is the viewer's mistake to be told about — but a caller with something of its own to keep
 * in step (the enlarged portrait window, which swaps to the picture it was handed) has to be able
 * to tell a stored face from a dropped one, or it goes on showing a picture nobody saved.
 */
export async function writeRosterPortrait(actor, kind, slug = "", index = 0, patch = {}) {
	const path = rosterPortraitListPath(kind, slug);
	if (!actor || !path) return false;
	const idx = Number(index);
	if (!Number.isInteger(idx) || idx < 0) return false;
	// The member must still be ON the roster. One bound serves all three kinds — a named
	// individual's own row count, or the anonymous headcount — so a portrait can never be stored
	// against somebody who is not there.
	//
	// Not paranoia about a hand-edited attribute (though it covers that, and stops a silly index
	// asking the pad loop below for a million-element array). The reachable case is an enlarged
	// portrait window left open across a roster change: it is keyed on a ref, deliberately, so it
	// survives the sheet closing — which means it also survives the crew shrinking beneath it.
	// Without this, picking a face in that window would pad the array back out and store it
	// against a member the crew has lost, to reappear on a stranger if the crew ever grew again.
	if (idx >= liveMemberCount(actor, kind, slug)) return false;
	const arr = rosterPortraitList(actor, kind, slug);
	while (arr.length < idx) arr.push(null);
	const slot = (arr[idx] && typeof arr[idx] === "object") ? arr[idx] : {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) delete slot[key];
		else slot[key] = key === "portraitFrame" ? normalizeFrame(value) : value;
	}
	arr[idx] = slot;
	await actor.update({ [`flags.${SYSTEM_ID}.${path}`]: arr });
	return true;
}

/**
 * Take the face off a roster member: the portrait AND any frame authored against it, in one
 * write. Dropping the frame with it is not tidiness — an orphan rect would otherwise sit there
 * forever, applying to nothing (the frame's `src` stamp neutralises it) with nothing to clear it.
 *
 * Reports whether the clear landed, on the same terms as the write above.
 */
export function clearRosterPortrait(actor, kind, slug = "", index = 0) {
	return writeRosterPortrait(actor, kind, slug, index, { img: undefined, portraitFrame: undefined });
}

/**
 * Hand every face this character's roster members wear to `claim(img, who)`.
 *
 * The People gallery's "already assigned" marking is only honest if the scan reaches everywhere a
 * face can be worn, and a roster member is not a document and not a follower card — without this
 * they would be invisible to both sweeps, and a face on the crew's roster would read as free from
 * every sheet in the world. Called by utils/actor-portrait-picker.js#usedActorPortraits, which
 * owns the sweep; the paths live here because this module owns the stores.
 *
 * `flags` is the character's RESOLVED flags (the caller has them already). An anonymous member
 * has no name of its own, so those are named by the group they belong to.
 */
export function claimRosterPortraits(flags, claim) {
	const crew = flags?.crew ?? {};
	const crewName = String(crew.name ?? "").trim() || "the crew";
	for (const row of Array.isArray(crew.individuals) ? crew.individuals : []) {
		claim(row?.img, String(row?.name ?? "").trim() || crewName);
	}
	for (const slot of Array.isArray(crew.memberPortrait) ? crew.memberPortrait : []) {
		claim(slot?.img, crewName);
	}
	for (const group of Object.values(flags?.customFollowers ?? {})) {
		if (!Array.isArray(group?.memberPortrait)) continue;
		const groupName = String(group?.name ?? "").trim() || "a group follower";
		for (const slot of group.memberPortrait) claim(slot?.img, groupName);
	}
}

/**
 * What a roster row hands the template: the picture to draw, the inline style that applies the
 * chosen frame, and whether there is a real face there at all.
 *
 * The placeholder is PERSON_ROSTER_IMG — the lighter empty figure, not the darker mark an
 * art-less NPC wears. A roster is a dense column of small avatars, and that is the whole reason
 * the lighter one exists (see utils/person-portrait.js): a column of dark discs reads as clutter
 * rather than as blanks. It is drawn, never stored, so `hasPortrait` stays honest and the
 * gallery's "already taken" scan never sees a placeholder claiming a face.
 *
 * `stored` is a `{img, portraitFrame}` slot — readRosterPortrait's shape, or the raw row.
 */
export function rosterAvatar(stored) {
	const img = String(stored?.img ?? "").trim();
	const resolved = resolvePortrait(img, stored?.portraitFrame);
	return {
		avatarImg:     resolved.src || PERSON_ROSTER_IMG,
		avatarStyle:   resolved.style,
		hasPortrait:   !!img,
	};
}

/**
 * The whole of one roster row's avatar as the template wants it: the picture, what a tap does,
 * whether the crop control is offered, and the words for each.
 *
 * On the same terms the follower CARD's portrait is drawn on — because it is the same thing one
 * size down, and a face that behaved differently depending on which list it was in would be the
 * surprise. So: a tap with the Roster's pencil open goes to the People of Stonetop gallery;
 * READING the roster it ENLARGES what is there, and that window carries "Edit Photo" and "Frame
 * Face" of its own, so nothing is out of reach either way. A member with no face yet has nothing
 * to enlarge, so their tap opens the gallery in both modes — an avatar that does nothing when
 * clicked is exactly the state someone most needs it from. A viewer who can neither look nor write
 * gets no tab stop and no pointer cursor rather than one promising something that never happens.
 *
 * Lives here rather than on the sheet so the state matrix above is unit-testable: it is pure, it
 * decides reachability for three different rosters at once, and a silent hole in it is invisible
 * until someone tries the one combination nobody clicked.
 *
 * `stored` is the `{img, portraitFrame}` slot; `name` captions the hover preview and the windows.
 */
export function rosterAvatarContext(stored, { name, canWrite, rosterEditing } = {}) {
	const avatar   = rosterAvatar(stored);
	const who      = name || "this member";
	const editable = !!canWrite && (!!rosterEditing || !avatar.hasPortrait);
	return {
		...avatar,
		avatarName:        who,
		avatarMode:        editable ? "pick" : "view",
		avatarInteractive: editable || avatar.hasPortrait,
		// No crop control on the row. A 26px disc cannot carry the pip the 75px follower card puts
		// on its portrait — the disc IS the clipping box, so a pip on it would be shaved off, and
		// one large enough to hit would cover a quarter of the face — and a labelled crop button
		// beside every row was clutter in a dense list. Cropping is reached the way it is on every
		// other small face in the system: tap the avatar (reading the roster) to enlarge it, and
		// use "Frame Face" on the window that opens. Browsing a file from the gallery still chains
		// straight into the framer, since that is the one case with no hand-cut square behind it.
		// Worded by the shared labeller, so the roster and the follower card cannot end up
		// describing the same act two ways (see portraitActionLabel).
		avatarLabel:       portraitActionLabel(who, { editable, hasPortrait: avatar.hasPortrait }),
	};
}
