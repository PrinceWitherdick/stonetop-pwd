// A named crew member's Person.
//
// Every other follower kind gets an npc of its own (follower-actors.js), but the crew is one card
// for a whole group, and its one npc is the GROUP: an unlinked token whose hits spread across the
// roster. A member who has stood out (a row in `crew.individuals`) is a person in their own right,
// though: the table wants them on the relationship map and wants to know how they feel about each
// PC, and an npc's sheet already keeps both. So each named member gets a Person, filed in the
// "Followers" folder, and the two stay in step:
//
//   • NAME and FACE sync BOTH ways. Whichever side was edited since they last agreed wins; the
//     stamp (`crewMemberCard`) is what remembers where they last agreed, so a rename on the
//     Person's sheet by somebody who cannot write the character is pulled across by the next
//     render of the roster rather than overwritten by it.
//   • Tag and traits follow the ROSTER, and only while the Person still holds what the roster gave
//     it (the same rule follower-actors.js#fieldFollowsCard keeps).
//   • HP, gear and fighting stay on the crew card. The Person carries no stat block, so nothing
//     about them is kept in two places.
//
// THE LINK IS `personUuid` ON THE ROW, never `actorUuid`. follower-masters.js#followerLinks walks
// the crew flags for `actorUuid`/`sourceUuid` and would read a member's Person as the crew CARD,
// and then the fight, the pool mirror and the NPC sheet would all treat it as the group token. The
// row rides every splice and in-place edit the roster makes, so the link needs no ids of its own.
// The back-link on the Person is `crewMember`, never `followerOrigin`, for the same reason.

import { ensureFollowerFolder, makerRank, MAKER_STAGGER_MS, worldActorFromUuid } from "./follower-actors.js";
import { followerMarkerImg, isFollowerMarkerImg } from "../../data/follower-actor.js";
import { followerOwnershipFrom } from "./shared-sheets.js";
import { resolvedFlags } from "./StonetopFlags.js";
import { deletionEntry } from "../../utils/foundry-compat.js";
import { rectEq, sameSrc } from "../../utils/portrait-frame.js";
import { isDefaultImg } from "../../utils/strings.js";
import { SYSTEM_ID } from "../../system-id.js";

/** The flag on a Person naming whose crew they are on: `{characterUuid}`. */
export const CREW_MEMBER_FLAG = "crewMember";
/** The flag on a Person remembering what the roster and the Person last agreed on. */
const STAMP_FLAG = "crewMemberCard";
/** The update option every write this file makes to a Person carries, so the hook below skips it. */
export const CREW_SYNC_OPTION = "stonetopCrewSync";

const INDIVIDUALS_PATH = `flags.${SYSTEM_ID}.crew.individuals`;

// Fresh every time: Foundry writes into the options object it is handed (see follower-actors.js#silent).
const silentSync = () => ({ stonetopLedger: true, [CREW_SYNC_OPTION]: true });

const _wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------- */
/*  Pure pieces                                 */
/* -------------------------------------------- */

/** A roster row's name, trimmed; "" for an unnamed or malformed row. */
const rowName = (row) => String(row?.name ?? "").trim();

/** The character's named crew rows, as stored. */
export function crewIndividuals(character) {
	const rows = resolvedFlags(character ?? {})?.crew?.individuals;
	return Array.isArray(rows) ? rows : [];
}

/** What a member's Person says they do: "Pim's crew", or "The Grey Company (Pim's crew)". */
export function crewPersonOccupation(characterName, crewName) {
	const whose = String(characterName ?? "").trim();
	const crew  = String(crewName ?? "").trim();
	const base  = whose ? `${whose}'s crew` : "Crew";
	return crew ? `${crew} (${base})` : base;
}

/** A row's tag and traits as the Person's one line of traits. */
export function crewPersonTraits(row) {
	const traits = Array.isArray(row?.traits) ? row.traits : [];
	return [row?.tag, ...traits]
		.map(t => (typeof t === "string" ? t.trim() : ""))
		.filter(Boolean)
		.join(", ");
}

/** A Person's portrait as the roster would hold it: "" while they wear a stand-in. */
function personImg(actor) {
	const img = String(actor?.img ?? "").trim();
	return isDefaultImg(img) || isFollowerMarkerImg(img) ? "" : img;
}

/** A row's portrait, "" for none. */
const rowImg = (row) => String(row?.img ?? "").trim();

/** Same crop of the same picture, or both uncropped. */
function sameFrame(a, b) {
	if (!a && !b) return true;
	if (!a || !b) return false;
	return sameSrc(a.src, b.src) && rectEq(a.rect, b.rect);
}

/**
 * Does a Person's field still hold what the roster gave it (or nothing)? Typed on the Person's own
 * sheet, it is theirs and the roster leaves it alone.
 */
function followsRoster(person, path, given) {
	const current = String(foundry.utils.getProperty(person, path) ?? "");
	return current === "" || current === String(given ?? "");
}

/**
 * Whether a crew Person's traits line is still the roster's tag and traits, so their sheet may draw
 * the crew card's chips in its place. Hand-typed traits are shown as typed.
 */
export function crewPersonTraitsFollowRoster(person) {
	return followsRoster(person, "system.traits", person?.flags?.[SYSTEM_ID]?.[STAMP_FLAG]?.traits);
}

const sameText = (a, b) => String(a ?? "") === String(b ?? "");
const sameImg  = (a, b) => (!a && !b) || sameSrc(a, b);

/**
 * Which way one two-way field moves: "same", "push" (roster → Person) or "pull" (Person → roster).
 *
 * With a stamp, the side that still holds the stamped value is the one that did NOT change, so the
 * other one wins; both changed, the roster wins. With no stamp (a Person just linked from the
 * crew member window, or made before the stamp) the roster wins unless it holds nothing.
 */
function direction(rowValue, personValue, stamp, hasStamp, same) {
	if (same(rowValue, personValue)) return "same";
	if (!hasStamp) return rowValue ? "push" : "pull";
	if (same(personValue, stamp)) return "push";
	if (same(rowValue, stamp)) return "pull";
	return "push";
}

/**
 * What it takes to bring one named member and their Person back into step.
 *
 * @param {Actor|object} person
 * @param {object} row            the member's `crew.individuals` row
 * @param {object} ctx            {characterName, crewName}
 * @returns {{personUpdate: object, rowPatch: object|null}|null}  null when they already agree
 */
export function crewPersonReconcile(person, row, { characterName = "", crewName = "" } = {}) {
	if (!person || !row) return null;
	const flags = person.flags?.[SYSTEM_ID] ?? {};
	const stamp = flags[STAMP_FLAG] ?? null;
	const has   = !!stamp;
	const personUpdate = {};
	const rowPatch     = {};

	// Name. A Person with no name is never pulled across: a member does not go back to nobody.
	let name = rowName(row);
	const pName = String(person.name ?? "").trim();
	const nameWay = direction(name, pName, stamp?.name, has, sameText);
	if (nameWay === "pull" && pName) { rowPatch.name = pName; name = pName; }
	else if (nameWay !== "same" && name) personUpdate.name = name;

	// Face, and the crop that goes with it. The crop moves with its picture; when the picture is
	// the same on both sides, the crop is weighed on its own (a re-crop changes nothing else).
	let img   = rowImg(row);
	let frame = img ? (row.portraitFrame ?? null) : null;
	const pImg   = personImg(person);
	const pFrame = pImg ? (flags.portraitFrame ?? null) : null;
	const imgWay = direction(img, pImg, stamp?.img, has, sameImg);
	const frameWay = imgWay === "same"
		? direction(frame, pFrame, stamp?.frame ?? null, has, sameFrame)
		: imgWay;
	if (imgWay === "pull") {
		rowPatch.img = pImg;
		img = pImg;
	} else if (imgWay === "push") {
		personUpdate.img = img || followerMarkerImg("");
	}
	if (frameWay === "pull" && !sameFrame(frame, pFrame)) {
		rowPatch.portraitFrame = pFrame;
		frame = pFrame;
	} else if (frameWay === "push" && !sameFrame(frame, flags.portraitFrame ?? null)) {
		if (frame) personUpdate[`flags.${SYSTEM_ID}.portraitFrame`] = frame;
		else if (flags.portraitFrame) {
			const [key, value] = deletionEntry(`flags.${SYSTEM_ID}.portraitFrame`);
			personUpdate[key] = value;
		}
	}

	// Occupation and traits follow the roster while the Person holds what the roster gave it, or
	// nothing. Typed on the Person's own sheet, they are left alone.
	const occupation = crewPersonOccupation(characterName, crewName);
	const traits     = crewPersonTraits(row);
	const follows = (path, given) => followsRoster(person, path, given);
	if (follows("system.occupation", stamp?.occupation) && !sameText(person.system?.occupation, occupation)) {
		personUpdate["system.occupation"] = occupation;
	}
	if (follows("system.traits", stamp?.traits) && !sameText(person.system?.traits, traits)) {
		personUpdate["system.traits"] = traits;
	}

	const next = { name, img, frame, occupation, traits };
	const stampMoved = !stamp || !sameText(stamp.name, next.name) || !sameImg(stamp.img, next.img)
		|| !sameFrame(stamp.frame ?? null, next.frame) || !sameText(stamp.occupation, next.occupation)
		|| !sameText(stamp.traits, next.traits);
	if (stampMoved) personUpdate[`flags.${SYSTEM_ID}.${STAMP_FLAG}`] = next;

	const patched = Object.keys(rowPatch).length ? rowPatch : null;
	if (!Object.keys(personUpdate).length && !patched) return null;
	return { personUpdate, rowPatch: patched };
}

/** A row with a patch from crewPersonReconcile applied. An empty face takes its crop with it. */
export function applyCrewRowPatch(row, patch) {
	const next = { ...row };
	if (patch.name !== undefined) next.name = patch.name;
	if (patch.img !== undefined) {
		if (patch.img) next.img = patch.img;
		else { delete next.img; delete next.portraitFrame; }
	}
	if (patch.portraitFrame !== undefined) {
		if (patch.portraitFrame) next.portraitFrame = patch.portraitFrame;
		else delete next.portraitFrame;
	}
	return next;
}

/**
 * The `crew.individuals` array with one member's row patched, found by their Person; null when no
 * row points at that Person any more (they left the crew in the meantime).
 */
export function crewRowWriteBack(individuals, personUuid, patch) {
	const rows = Array.isArray(individuals) ? individuals : [];
	const idx = rows.findIndex(r => r?.personUuid === personUuid);
	if (idx < 0 || !patch) return null;
	const next = [...rows];
	next[idx] = applyCrewRowPatch(rows[idx], patch);
	return next;
}

/**
 * The data a new Person is made from.
 *
 * @param {object} row  the member's `crew.individuals` row
 * @param {object} o
 * @param {string} o.characterUuid
 * @param {string} [o.characterName]
 * @param {string} [o.crewName]
 * @param {string|null} [o.folder]
 * @param {object} [o.ownership]
 */
export function crewMemberPersonData(row, { characterUuid, characterName = "", crewName = "", folder = null, ownership = {} } = {}) {
	const name       = rowName(row);
	const own        = rowImg(row);
	const img        = own || followerMarkerImg("");
	const frame      = own ? (row.portraitFrame ?? null) : null;
	const occupation = crewPersonOccupation(characterName, crewName);
	const traits     = crewPersonTraits(row);
	const consts     = globalThis.CONST ?? {};
	const data = {
		name, type: "npc", img, folder, ownership,
		system: { occupation, traits, hasStats: false },
		prototypeToken: {
			displayName: consts.TOKEN_DISPLAY_MODES?.HOVER ?? 30,
			disposition: consts.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1,
			actorLink:   true,
			texture:     { src: img },
		},
		flags: {
			[SYSTEM_ID]: {
				// `made`: this file made them, so swapping them for a Person somebody links by hand
				// may delete them (replaceCrewPerson). A linked Person is never deleted that way.
				[CREW_MEMBER_FLAG]: { characterUuid, made: true },
				[STAMP_FLAG]: { name, img: own, frame, occupation, traits },
			},
		},
	};
	if (frame) data.flags[SYSTEM_ID].portraitFrame = frame;
	return data;
}

/* -------------------------------------------- */
/*  Reading the world                           */
/* -------------------------------------------- */

/** The Person a row is linked to, if it still exists in the world. */
export function crewPersonFor(row) {
	const actor = worldActorFromUuid(row?.personUuid);
	return actor?.type === "npc" ? actor : null;
}

/** Whose crew a Person is on, by uuid, or "". */
const crewOwnerUuid = (person) => String(person?.flags?.[SYSTEM_ID]?.[CREW_MEMBER_FLAG]?.characterUuid ?? "");

/**
 * Whose crew a Person is on, and their row there: `{character, row}`, or null for a Person on no
 * crew, whose character is gone, or whose row no longer points at them (they left the roster).
 *
 * The NPC sheet's one door to the crew card. Deliberately NOT followerCardFor: that would make the
 * member the crew's group token (see the header).
 */
export function crewMemberOf(person) {
	const ownerUuid = crewOwnerUuid(person);
	if (person?.type !== "npc" || !ownerUuid || !person.uuid) return null;
	const character = worldActorFromUuid(ownerUuid);
	if (character?.type !== "character") return null;
	const row = crewIndividuals(character).find(r => r?.personUuid === person.uuid);
	return row ? { character, row } : null;
}

/**
 * Redraw every OPEN sheet of a Person on this character's crew: their HP, Loyalty, tags and
 * instinct are read off the crew card, never copied, so the sheet is only as new as its last draw.
 */
export function redrawCrewMemberSheets(character) {
	if (character?.type !== "character" || !character.uuid) return;
	for (const person of globalThis.game?.actors?.contents ?? []) {
		if (person?.type !== "npc" || crewOwnerUuid(person) !== character.uuid) continue;
		if (person.sheet?.rendered) person.sheet.render(false);
	}
}

/**
 * `updateActor`: ANY change to the character, not only to `crew`. The card is built from more than
 * the crew's own flags: Heroes to the Last's picks live with the move marks, the background's tag
 * with the background, the max HP with the moves, and "Following" with the character's name. Only
 * open member sheets redraw, so a character with none (the usual case) costs a walk of the actors.
 */
export function onUpdateActorCrewSheets(actor) {
	redrawCrewMemberSheets(actor);
}

/** `createItem` / `deleteItem`: a move learned or dropped (Heroes to the Last, Veteran Crew...). */
export function onItemChangeCrewSheets(item) {
	redrawCrewMemberSheets(item?.parent);
}

function crewContext(character) {
	return { characterName: character?.name ?? "", crewName: resolvedFlags(character ?? {})?.crew?.name ?? "" };
}

/**
 * The world's people who could be linked to a member from the crew member window: npcs this user
 * can write, that are not somebody's follower actor and not already on a crew. `keep` is the one
 * this member is linked to now, which stays on the list.
 */
export function linkableCrewPeople(keep = "") {
	return (globalThis.game?.actors?.contents ?? []).filter(actor =>
		actor.type === "npc" && actor.isOwner
		&& !actor.flags?.[SYSTEM_ID]?.followerOrigin
		&& (!crewOwnerUuid(actor) || actor.uuid === keep));
}

/* -------------------------------------------- */
/*  Writes                                      */
/* -------------------------------------------- */

const _sweepsInFlight = new Set();
const _syncsInFlight  = new Set();

/**
 * Give every named crew member a Person, and remember it on their row.
 *
 * Run from the character sheet after it renders, beside ensureFollowerActors and under the same
 * guards: free in the steady state; only an owner who may create actors; one pass per character
 * at a time; connected owners staggered so two open sheets do not both make one.
 *
 * A row whose STORED link no longer resolves counts as answered: deleting a member's Person is a
 * decision, and a sweep that remade it on the next render would make it impossible to be rid of.
 *
 * @returns {Promise<number>} how many were made
 */
export async function ensureCrewMemberPeople(character) {
	const missing = () => crewIndividuals(character).filter(r => rowName(r) && !String(r?.personUuid ?? "").trim());
	if (!missing().length) return 0;
	if (!character?.isOwner) return 0;
	if (!globalThis.Actor?.canUserCreate?.(game.user)) return 0;
	if (_sweepsInFlight.has(character.id)) return 0;

	_sweepsInFlight.add(character.id);
	try {
		const rank = makerRank(character);
		if (rank > 0) await _wait(rank * MAKER_STAGGER_MS);
		const wanted = missing();
		if (!wanted.length) return 0;

		const folder = (await ensureFollowerFolder())?.id ?? null;
		const ctx = crewContext(character);
		const made = [];
		for (const row of wanted) {
			const data = crewMemberPersonData(row, {
				...ctx, characterUuid: character.uuid ?? null, folder,
				ownership: followerOwnershipFrom(character),
			});
			try {
				const actor = await Actor.create(data);
				if (actor) made.push({ name: rowName(row), actor });
			} catch (err) {
				console.error("Stonetop | Could not make the Person for crew member", rowName(row), err);
			}
		}
		if (!made.length) return 0;

		// Matched against the rows as they are NOW, by name, to the first unlinked row of that name:
		// the creates awaited, and the roster may have been edited (or another client may have linked
		// the same member) in the meantime. A Person no row takes is deleted, never left unlinked.
		const rows = [...crewIndividuals(character)];
		const lost = [];
		for (const { name, actor } of made) {
			const idx = rows.findIndex(r => rowName(r) === name && !String(r?.personUuid ?? "").trim());
			if (idx < 0) { lost.push(actor); continue; }
			rows[idx] = { ...rows[idx], personUuid: actor.uuid };
		}
		for (const actor of lost) {
			await actor.delete?.().catch(err =>
				console.warn("Stonetop | Could not remove a duplicate crew member Person.", err));
		}
		const linked = made.length - lost.length;
		if (linked) await character.update({ [INDIVIDUALS_PATH]: rows }, { stonetopLedger: true });
		return linked;
	} catch (err) {
		console.error("Stonetop | Could not make this character's crew member People.", err);
		return 0;
	} finally {
		_sweepsInFlight.delete(character.id);
	}
}

/**
 * Bring every named member's Person back into step with their row, both ways (see the header).
 * Run from the character sheet after it renders.
 *
 * @returns {Promise<number>} how many members were brought into step
 */
export async function syncCrewMemberPeople(character) {
	if (!character || _syncsInFlight.has(character.id)) return 0;
	const plan = () => {
		const ctx = crewContext(character);
		const out = [];
		for (const row of crewIndividuals(character)) {
			const person = crewPersonFor(row);
			if (!person?.isOwner || crewOwnerUuid(person) !== character.uuid) continue;
			const step = crewPersonReconcile(person, row, ctx);
			if (step) out.push({ person, row, step });
		}
		return out;
	};
	let drifted;
	try {
		drifted = plan();
	} catch (err) {
		console.error("Stonetop | Could not work out which crew member People need updating.", err);
		return 0;
	}
	if (!drifted.length) return 0;

	_syncsInFlight.add(character.id);
	try {
		const rank = makerRank(character);
		if (rank > 0) await _wait(rank * MAKER_STAGGER_MS);
		let moved = 0;
		let rows = null;
		for (const { person, row, step } of plan()) {
			// A pull needs the character, and a client that cannot write it leaves the whole step,
			// stamp included, for one that can: stamping it here would lose the Person's edit.
			if (step.rowPatch && !character.isOwner) continue;
			try {
				if (Object.keys(step.personUpdate).length) await person.update(step.personUpdate, silentSync());
				if (step.rowPatch) {
					rows = crewRowWriteBack(rows ?? crewIndividuals(character), row.personUuid, step.rowPatch) ?? rows;
				}
				moved++;
			} catch (err) {
				console.warn("Stonetop | Could not bring this crew member's Person back in step.", person?.name, err);
			}
		}
		if (rows) await character.update({ [INDIVIDUALS_PATH]: rows });
		return moved;
	} catch (err) {
		console.error("Stonetop | Could not sync this character's crew member People.", err);
		return 0;
	} finally {
		_syncsInFlight.delete(character.id);
	}
}

/**
 * `updateActor`: a member's Person renamed or given a new face on its own sheet takes the roster
 * with it, straight away, on the client that made the edit. One that cannot write the character
 * leaves it to the next render of the roster, which pulls it across (the stamp still says so).
 */
export function onUpdateActorCrewPerson(actor, changed, options, userId) {
	if (userId !== game.user?.id || options?.[CREW_SYNC_OPTION]) return;
	if (actor?.type !== "npc") return;
	const ownerUuid = crewOwnerUuid(actor);
	if (!ownerUuid) return;
	// In brackets: a dotted read of the hyphenated id parses as a subtraction.
	const flags = changed?.flags?.[SYSTEM_ID] ?? {};
	const touched = !!changed && ("name" in changed || "img" in changed
		|| "portraitFrame" in flags || "-=portraitFrame" in flags);
	if (!touched) return;
	const character = worldActorFromUuid(ownerUuid);
	if (!character?.isOwner) return;
	syncCrewMemberPeople(character)
		.catch(err => console.warn("Stonetop | Could not carry a crew member's new name to the roster.", err));
}

/**
 * A member who died: their Person stays, marked Dead (the relationship map's Dead chip follows),
 * and no longer on anybody's crew. Read the row BEFORE the death update splices it out.
 */
export async function markCrewPersonDead(row) {
	const person = crewPersonFor(row);
	if (!person?.isOwner) return;
	const [key, value] = deletionEntry(`flags.${SYSTEM_ID}.${CREW_MEMBER_FLAG}`);
	await person.update({ "system.status": "dead", [key]: value }, silentSync())
		.catch(err => console.warn("Stonetop | Could not mark a fallen crew member's Person dead.", err));
}

/**
 * A member removed from the roster: their Person is deleted, or kept as a Person in their own right
 * (no longer on the crew, so nothing syncs it again).
 */
export async function releaseCrewPerson(row, { remove = false } = {}) {
	const person = crewPersonFor(row);
	if (!person) return;
	if (remove) {
		if (person.canUserModify?.(game.user, "delete") === false) return;
		await person.delete().catch(err => console.warn("Stonetop | Could not delete a crew member's Person.", err));
		return;
	}
	if (!person.isOwner) return;
	const [key, value] = deletionEntry(`flags.${SYSTEM_ID}.${CREW_MEMBER_FLAG}`);
	await person.update({ [key]: value }, silentSync())
		.catch(err => console.warn("Stonetop | Could not release a crew member's Person.", err));
}

/** Put a Person someone picked in the crew member window on this character's crew. */
export async function adoptCrewPerson(person, character) {
	if (!person?.isOwner || !character?.uuid) return false;
	if (crewOwnerUuid(person) === character.uuid) return true;
	await person.update({ [`flags.${SYSTEM_ID}.${CREW_MEMBER_FLAG}`]: { characterUuid: character.uuid } }, silentSync());
	return true;
}

/**
 * A member's link moved from one Person to another in the crew member window. The one they had
 * goes: deleted if this file made it for them (it is the copy the link replaces), released as a
 * Person in their own right if somebody linked it by hand.
 */
export async function replaceCrewPerson(oldUuid, character) {
	const old = worldActorFromUuid(oldUuid);
	if (old?.type !== "npc" || crewOwnerUuid(old) !== character?.uuid) return;
	const made = !!old.flags?.[SYSTEM_ID]?.[CREW_MEMBER_FLAG]?.made;
	await releaseCrewPerson({ personUuid: oldUuid }, { remove: made });
}
