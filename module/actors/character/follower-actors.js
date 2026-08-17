// The Actor behind a follower card.
//
// A follower is flag data on a character, but what it describes is a creature at the table: it
// stands on the map, takes damage, and is ordered about. So every follower gets an `npc` Actor
// made for it — the same Actor the canvas drop has always found or built
// (module/hooks/FollowerDrop.js), except that it is now made when the follower is ADDED rather
// than only when somebody first drags them onto a scene.
//
// ONE place decides all three parts of that, because they have to agree:
//
//   • WHO a follower already is (followerActorFromLink), so nothing creates a second copy of a
//     creature that exists — the drop, the card's Tokenizer pip, and this sweep all ask here.
//   • What making one MEANS (createFollowerActor): the folder, the provenance stamp, and the
//     ownership, which is the character's own — your follower's NPC is yours, whoever's client
//     happened to make it.
//   • That the actor goes on MATCHING the card (syncFollowerActors). Making it once was not
//     enough: a follower renamed, re-tagged or given a portrait after their NPC existed kept the
//     name, face and numbers it was born with — most visibly as the token dropped on a scene.
//
// Never a one-shot. Followers arrive from a dozen places (the walkthrough, a converted monster
// or NPC, a possession, an arcana summon, the onboarding dialog's animal companion / crew /
// initiates), and a "followersMigrated" flag would strand every follower written after the pass
// that set it — the mistake migrateSteadingPeople carries a paragraph about. Instead the sweep is
// cheap enough to run on every render and does nothing in the steady state.

import {
	CARD_FIELD_PATHS, FOLLOWER_FOLDER, followerActorFields, followerActorMoves, followerCardStamp,
	followerNpcActorData, followerPortraitFrame, isFollowerMarkerImg,
} from "../../data/follower-actor.js";
import { ensureNamedActorFolder } from "../steading/steading-people.js";
import { deletionEntry } from "../../utils/foundry-compat.js";
import { resolvedFlags } from "./StonetopFlags.js";
import { rectEq, sameSrc } from "../../utils/portrait-frame.js";
import { isDefaultImg } from "../../utils/strings.js";
import { SYSTEM_ID } from "../../system-id.js";

/**
 * The Actor folder followers-turned-actors are filed in, created on demand. A player can't
 * create folders, so they just land at the sidebar root — an unfiled actor beats no actor.
 */
export const ensureFollowerFolder = () => ensureNamedActorFolder(FOLLOWER_FOLDER);

/** A world Actor for a uuid, or null. World only: fromUuidSync hands back a bare index stub for
 *  a compendium entry, which is not a document anything here can act on. */
function worldActorFromUuid(uuid) {
	if (!uuid) return null;
	try {
		const doc = globalThis.fromUuidSync?.(String(uuid));
		return doc?.documentName === "Actor" && !doc.pack ? doc : null;
	} catch (_) {
		return null;
	}
}

/**
 * The Actor that IS this follower, if one exists yet — never one made on the spot.
 *
 * Two steps, and the drop resolves the same two before it falls through to creating: the actor
 * already made for this card (`actorUuid`, written back onto it the first time one was made),
 * else the NPC they were recruited from, because "a follower is first an NPC" (Book I, p.475)
 * and that person already exists at the table. A `sourceUuid` pointing anywhere else — a
 * bestiary monster, the compendium item behind a possession-follower — is provenance rather than
 * identity: that entry is a template for its kind, while this follower is one individual with
 * their own name, tags and hit points.
 *
 * Synchronous, because the sheet has to answer while it builds a card.
 *
 * @param {{actorUuid?: string, sourceUuid?: string}} link  a follower's stored links
 */
export function followerActorFromLink({ actorUuid, sourceUuid } = {}) {
	const linked = worldActorFromUuid(actorUuid);
	if (linked) return linked;
	const source = worldActorFromUuid(sourceUuid);
	return source?.type === "npc" ? source : null;
}

/**
 * Has this follower been answered for — either by an actor of their own or by the NPC they are?
 *
 * Keyed on the STORED link rather than on whether it still resolves. A card whose actor has been
 * deleted keeps its stale uuid and is deliberately left alone: deleting the NPC is a decision,
 * and a sweep that ran on "does it resolve" would undo it on the next render, which would make
 * the actor impossible to be rid of. Dragging the card onto a scene still makes a fresh one —
 * that is an explicit act, and the drop is where it belongs.
 */
function answeredFor(snapshot, storedUuid) {
	if (String(storedUuid ?? "").trim()) return true;
	return !!followerActorFromLink({ sourceUuid: snapshot?.follower?.sourceUuid });
}

/** The uuid currently stored on a follower's own flags, read live rather than off a snapshot. */
function storedActorUuid(character, detailBase) {
	if (!character || !detailBase) return "";
	const value = foundry.utils.getProperty(resolvedFlags(character), `${detailBase}.actorUuid`);
	return String(value ?? "").trim();
}

/**
 * Make the Actor for one follower snapshot (the character sheet's `_followerDragSnapshot` shape).
 * Returns it, or null when creation was refused — a caller is expected to carry on with the rest.
 *
 * `ownership` is the CHARACTER's, so a follower's NPC is owned by exactly the people who own the
 * follower. Without it the actor would belong to whoever's client happened to make it: a GM
 * tidying up a player's sheet would create an NPC that player cannot see, and the token they were
 * ordering about a moment ago would stop opening for them.
 *
 * @param {object} snapshot   {ftype, slug, follower: {...}}
 * @param {Actor}  character  whose follower it is
 * @param {object} [opts]
 * @param {string|null} [opts.folder]  folder id, resolved once by a batching caller
 */
export async function createFollowerActor(snapshot, character, { folder = null } = {}) {
	if (!snapshot?.follower || !character) return null;
	const data = followerNpcActorData(snapshot.follower, {
		folder: folder ?? (await ensureFollowerFolder())?.id ?? null,
		origin: { characterUuid: character.uuid ?? null, ftype: snapshot.ftype ?? null, slug: snapshot.slug ?? null },
	});
	data.ownership = foundry.utils.deepClone(character.ownership ?? {});
	try {
		return await Actor.create(data);
	} catch (err) {
		console.error("Stonetop | Could not create the actor for follower", snapshot.follower?.name, err);
		return null;
	}
}

// Characters a sweep is mid-flight on. A follower add re-renders the sheet, and so does the
// write this sweep makes at the end of it — without this, the second pass would see the same
// unanswered followers as the first (its creates have not landed yet) and make them twice.
const _sweepsInFlight = new Set();

// How long a client that is NOT first in line waits before looking again. Two people with the
// same sheet open both see every write to it, so both would otherwise start creating in the same
// instant; staggering them means the later one re-reads the flags and finds the work already
// done. Ranked by user id rather than randomly, so the order is stable — and it is only a
// stagger, not an election: if the first in line never renders this sheet, the next one still
// makes them a beat later, which is what keeps this working at a table with no GM present.
const MAKER_STAGGER_MS = 500;

const _wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** This client's place in the queue of connected owners: 0 goes first, and waits for nobody. */
function makerRank(character) {
	const owners = (game.users?.contents ?? [])
		.filter(u => u.active && character?.testUserPermission?.(u, "OWNER"))
		.map(u => u.id)
		.sort();
	const rank = owners.indexOf(game.user?.id);
	return rank < 0 ? 0 : rank;
}

/**
 * Give every follower on this character an Actor, and remember it on the card.
 *
 * Run from the character sheet after it renders, which is the one place a follower card is
 * finished enough to be turned into an actor — the numbers on it come from the playbook, the
 * override layer and the stat passes, not from the raw flags. Every route a follower can arrive
 * by ends in that render, so none of them has to know about this.
 *
 * Returns how many were made, for the tests and for a caller that wants to log.
 *
 * @param {Actor}    character
 * @param {object[]} snapshots  the finished cards' drag snapshots (_followerDragSnapshot)
 */
export async function ensureFollowerActors(character, snapshots = []) {
	// Cheap scan first, and in this order: the steady state is "every follower has one", and the
	// price of that answer on every render must be one walk of a handful of snapshots — not a
	// permission lookup and a user sweep.
	const missing = (snapshots ?? []).filter(s => s?.detailBase && !answeredFor(s, s.follower?.actorUuid));
	if (!missing.length) return 0;
	if (!character?.isOwner) return 0;
	// A world whose GM revoked the permission this system grants players
	// (hooks/Ready.js#_ensurePlayerActorCreationGrant) leaves the followers to whoever can — the
	// GM, next time they have the sheet open. Silent: a player who cannot create actors can do
	// nothing about it, and a notification on every render would be noise, not news.
	if (!Actor.canUserCreate(game.user)) return 0;
	if (_sweepsInFlight.has(character.id)) return 0;

	_sweepsInFlight.add(character.id);
	try {
		const rank = makerRank(character);
		if (rank > 0) await _wait(rank * MAKER_STAGGER_MS);

		// One folder for the batch: every create would otherwise ask after it again, and the
		// first of them is what makes it.
		const folder = (await ensureFollowerFolder())?.id ?? null;

		// Re-read each link off the document rather than trusting the snapshot: it was taken
		// before the wait above, and the whole point of that wait is to let another client's
		// writes land first.
		const made = new Map();
		for (const snapshot of missing) {
			if (answeredFor(snapshot, storedActorUuid(character, snapshot.detailBase))) continue;
			const actor = await createFollowerActor(snapshot, character, { folder });
			if (actor) made.set(snapshot.detailBase, actor);
		}
		if (!made.size) return 0;

		// One update for the lot, built from what is on the document NOW — the creates above
		// awaited, and a follower's HP or Loyalty may well have been clicked in the meantime.
		// Only the actorUuid keys are written, so nothing else can be trodden on, and they are
		// written to SYSTEM_ID: resolvedFlags above is what READS a world not yet cut over from
		// the legacy scope, but everything in this system writes to the current one.
		const update = {};
		const lost = [];
		for (const [base, actor] of made) {
			// Claimed while this pass was still creating — the check before each create above
			// cannot cover the ones made before it. Take our own copy back out rather than write
			// over their link: two clients each keeping the NPC they made is the duplicate this
			// is all here to avoid, and an unwritten one is worse still, since nothing would
			// point at it and the sidebar would just quietly grow. Safe to delete: we made it a
			// moment ago and it was never linked to anything.
			if (storedActorUuid(character, base)) lost.push(actor);
			else update[`flags.${SYSTEM_ID}.${base}.actorUuid`] = actor.uuid;
		}
		for (const actor of lost) {
			await actor.delete?.().catch(err =>
				console.warn("Stonetop | Could not remove a duplicate follower actor.", err));
		}
		if (Object.keys(update).length) await character.update(update);
		return Object.keys(update).length;
	} catch (err) {
		console.error("Stonetop | Could not make this character's follower actors.", err);
		return 0;
	} finally {
		_sweepsInFlight.delete(character.id);
	}
}

// Characters a sync is mid-flight on. The sheet re-renders freely — a portrait pick calls render
// itself — and each render would otherwise start another pass over updates that have not landed.
const _syncsInFlight = new Set();

/**
 * Every write this sweep makes, marked as the machine's rather than a person's.
 *
 * `stonetopLedger` is the ledgers' own kill switch (StonetopActor#_preUpdate and the two
 * descendant hooks read it), and this sweep is exactly what it is for: NpcLedger watches all
 * thirteen fields the card governs, plus move adds and removes, so without this a follower
 * RENAMED ON A CHARACTER SHEET would file a column of "Name changed", "Tags changed", "Move
 * added:" entries against their NPC — in the voice of whichever client's render happened to win
 * the makerRank stagger, as though somebody had sat down and typed them. The card is the author
 * here; the NPC's log is for what people do to the NPC.
 *
 * A FUNCTION, and never a shared constant, because Foundry writes to the options object it is
 * handed: Document#update does `operation.parent = this.parent; operation.pack = this.pack;`
 * before it does anything else, and the two embedded-document calls do the same. A frozen object
 * therefore throws TypeError on the first write in strict mode (which every ES module is), and a
 * merely shared one would carry one actor's `parent` into the next actor's call. Every other
 * ledger-silenced call site in this system passes a fresh literal for the same reason.
 */
const silent = () => ({ stonetopLedger: true });

/** The stamp: what the card last dictated to this actor, or null for one made before it existed. */
const cardStamp = (actor) => actor?.flags?.[SYSTEM_ID]?.[STAMP_KEY] ?? null;
const STAMP_KEY = "followerCard";

/**
 * Is this field still ours to write?
 *
 * The same three-state rule `tokenFollowsPortrait` (utils/portrait-token-frame.js) applies to a
 * token, raised one level and generalised:
 *   • the actor holds exactly what the card last gave it — it was following, so it follows on;
 *   • the actor holds nothing at all — an empty field has nothing to lose.
 * Anything else was typed on the NPC's own sheet, and the card does not overrule it.
 *
 * `img` keeps a wider first test, because a portrait has stand-ins a blank string doesn't: a stock
 * placeholder or one of our category discs is exactly as empty as an empty field, and is what an
 * actor made before the stamp existed is wearing — which is the case the whole sweep began with.
 *
 * An actor with no stamp therefore only takes fields it is missing. That is deliberate: for a
 * value it already holds there is no way to tell "the card changed since" from "a GM typed this",
 * and guessing wrong overwrites somebody's work. The first pass plants the stamp, and from then on
 * every change follows.
 */
function fieldFollowsCard(actor, key, stamped) {
	const current = foundry.utils.getProperty(actor, CARD_FIELD_PATHS[key]);
	if (key === "img") {
		return isDefaultImg(current) || isFollowerMarkerImg(current) || sameSrc(current, stamped);
	}
	if (_holdsNothing(key, current)) return true;
	return current === stamped;
}

// The card's two NUMBER fields. NpcModel starts both at 0, which is that schema's way of saying
// "nothing here" — so for these, 0 is the empty field, exactly as "" is for the text ones.
const NUMERIC_CARD_FIELDS = new Set(["hpMax", "armor"]);

/**
 * Is this field empty — nothing to lose, so the card may fill it?
 *
 * Spelled out rather than left as a bare `=== ""` because a numeric 0 read as "the actor holds
 * something", and that quietly stranded every follower actor made before the stamp existed at
 * 0 armour and a 0 HP ceiling — permanently, not merely on the first pass. 0 is not undefined,
 * null or "", so the field looked held and was skipped; the stamp was then planted saying the
 * card had given 6; and every pass after compared 0 against 6, disagreed, and skipped it again.
 * The token dropped on the map read 0/0 forever, which is the exact drift this sweep exists to
 * undo.
 *
 * The trade is the same one the blank-string rule already makes: an NPC deliberately zeroed
 * while its card says otherwise takes the card's number back. At 0 there is no way to tell
 * "nobody has touched this" from "somebody meant it", and the schema default has to win, or the
 * default state — which is what nearly every one of these actors is in — can never be filled at
 * all.
 */
function _holdsNothing(key, current) {
	if (current === undefined || current === null || current === "") return true;
	return NUMERIC_CARD_FIELDS.has(key) && Number(current) === 0;
}

/** Equal for our purposes: a portrait ignores the cache-buster stamp, everything else is strict. */
const _sameValue = (key, a, b) => (key === "img" ? sameSrc(a, b) : a === b);

/** The same picture cut to the same rect. Float-tolerant, because the rect made a box round trip. */
const _sameFrame = (a, b) => !!a && !!b && sameSrc(a.src, b.src) && rectEq(a.rect, b.rect);

/** Shallow equality over two stamps, so an unchanged one is never re-written. */
function _stampEq(a, b) {
	if (!a || !b) return false;
	const keys = new Set([...Object.keys(a.fields ?? {}), ...Object.keys(b.fields ?? {})]);
	for (const key of keys) if (a.fields?.[key] !== b.fields?.[key]) return false;
	return (a.moves ?? []).join("\u0000") === (b.moves ?? []).join("\u0000");
}

/**
 * What this one actor needs to catch up with its card: an update object, the moves to add, and the
 * `npcMove` items to take away. Null when it is already in step.
 */
function followerActorPlan(actor, follower) {
	const fields = followerActorFields(follower);
	const moves  = followerActorMoves(follower);
	const stamp  = cardStamp(actor);
	const update = {};

	for (const [key, value] of Object.entries(fields)) {
		const path = CARD_FIELD_PATHS[key];
		if (!fieldFollowsCard(actor, key, stamp?.fields?.[key])) continue;
		if (_sameValue(key, foundry.utils.getProperty(actor, path), value)) continue;
		update[path] = value;
	}

	// A ceiling the card just lowered cannot leave the token reading 6/4. Only ever downward:
	// healing a follower back to full because their sheet re-rendered is not this sweep's business.
	if (update[CARD_FIELD_PATHS.hpMax] !== undefined) {
		const current = Number(foundry.utils.getProperty(actor, "system.attributes.hp.value") ?? 0);
		if (current > fields.hpMax) update["system.attributes.hp.value"] = fields.hpMax;
	}

	// The frame goes with the picture it was measured on, so a face arriving without one takes the
	// old rect away rather than leaving an orphan behind — the same atomic pair the card's own
	// clear handler writes.
	//
	// Weighed on its own rather than only when `img` moves, because RE-CROPPING a portrait is a
	// change to the rect and nothing else: the src is identical, so the field loop above skips it,
	// `update` stays empty, and the stamp — which carries the fields and the moves, never the frame
	// — compares equal too, so the whole plan came back null and the NPC wore the first crop for
	// good. Gated on the picture still being the card's to write, so a face typed on the NPC's own
	// sheet keeps the crop that was measured on it.
	if (fieldFollowsCard(actor, "img", stamp?.fields?.img)) {
		const frame = followerPortraitFrame(follower);
		const held  = actor.flags?.[SYSTEM_ID]?.portraitFrame ?? null;
		if (frame && !_sameFrame(frame, held)) update[`flags.${SYSTEM_ID}.portraitFrame`] = frame;
		else if (!frame && held) {
			const [frameKey, frameVal] = deletionEntry(`flags.${SYSTEM_ID}.portraitFrame`);
			update[frameKey] = frameVal;
		}
	}

	// Moves are documents, not fields, so they are reconciled by name rather than overwritten. Only
	// the ones the card LOST are removed, and only if the card put them there: a GM move written on
	// the NPC is never in the stamp, so it is never in this list.
	const have    = new Map(_npcMoves(actor).map(i => [i.name, i]));
	const add     = moves.filter(m => !have.has(m));
	const dropped = (stamp?.moves ?? []).filter(m => !moves.includes(m));
	const remove  = dropped.map(m => have.get(m)?.id).filter(Boolean);

	// Through followerCardStamp, which is also what creation writes: the stamp is a flag object and
	// Foundry merges one of those, so it has to carry every key or a dropped one lives forever.
	const next = followerCardStamp(fields, moves);
	if (!_stampEq(stamp, next)) update[`flags.${SYSTEM_ID}.${STAMP_KEY}`] = next;

	if (!Object.keys(update).length && !add.length && !remove.length) return null;
	return { update, add, remove };
}

/** This actor's GM-move items. */
function _npcMoves(actor) {
	return [...(actor?.items ?? [])].filter(i => i?.type === "npcMove");
}

/**
 * Keep every follower's Actor in step with the card it was made from.
 *
 * Run beside ensureFollowerActors, from the same post-render call, and for the same reason: a
 * follower can be renamed, re-tagged, re-armed or given a portrait from the card, the walkthrough,
 * an NPC or monster conversion, a possession or an arcana summon — and every one of those ends in
 * a render of this sheet, so none of them has to know about this. Making the actor once was not
 * enough; it went on wearing the name, face and numbers it was born with.
 *
 * Only the actor made FOR this card (`actorUuid`). The NPC a follower was recruited from is a
 * document in their own right — changing the card is not a licence to rewrite the villager they
 * came from.
 *
 * Current HP is the one thing the card does not govern: the token takes damage on the map. The
 * ceiling follows, and drags the current value down with it when it is lowered past it.
 *
 * The prototype token comes along for free where the portrait moves: writing `img` is what
 * StonetopActor#_syncPrototypeTokenImage watches, and it carries a token that was following.
 *
 * Returns how many actors were brought back into step.
 *
 * @param {Actor}    character
 * @param {object[]} snapshots  the finished cards' drag snapshots (_followerDragSnapshot)
 */
export async function syncFollowerActors(character, snapshots = []) {
	// The in-flight guard first: a pass already running is about to answer for these snapshots,
	// so planning them again is work whose result we would throw away.
	if (_syncsInFlight.has(character?.id)) return 0;

	// Then the cheap scan, as above: the steady state is "every actor already matches its card",
	// and the price of that answer on every render must be one walk of a handful of snapshots.
	//
	// Guarded, and separately from the writes below, because this is where a malformed snapshot
	// lands: followerActorPlan reads every field on the card. The same guard ensureFollowerActors
	// keeps, and for the same reason — both are fired and forgotten from the character sheet's
	// post-render with no `.catch` of their own to fall back on, so a throw here is an unhandled
	// rejection on EVERY render of that sheet, and one nothing on screen connects to the sheet
	// the player is looking at.
	const drifted = [];
	try {
		for (const snapshot of snapshots ?? []) {
			const follower = snapshot?.follower;
			if (!follower) continue;
			const actor = worldActorFromUuid(follower.actorUuid);
			if (!actor?.isOwner) continue;
			if (followerActorPlan(actor, follower)) drifted.push({ actor, follower });
		}
	} catch (err) {
		console.error("Stonetop | Could not work out which follower actors need updating.", err);
		return 0;
	}
	if (!drifted.length) return 0;

	_syncsInFlight.add(character?.id);
	let moved = 0;
	try {
		// The same queue the creating sweep waits in, for a sharper version of the same reason.
		// Two people with this sheet open both see every write to it, so both would otherwise
		// reconcile in the same instant — and while writing a field twice is merely wasteful,
		// ADDING a move twice leaves the follower carrying it twice, which nothing takes back.
		const rank = makerRank(character);
		if (rank > 0) await _wait(rank * MAKER_STAGGER_MS);

		for (const { actor, follower } of drifted) {
			// Re-planned after the wait rather than trusting the scan above, because the whole
			// point of the wait is to let the other client's writes land first.
			const plan = followerActorPlan(actor, follower);
			if (!plan) continue;
			try {
				if (Object.keys(plan.update).length) await actor.update(plan.update, silent());
				// Removals first: a move renamed on the card is an add and a drop on the same
				// creature's list, and doing it in this order never leaves the two side by side.
				if (plan.remove.length) await actor.deleteEmbeddedDocuments?.("Item", plan.remove, silent());
				if (plan.add.length) {
					await actor.createEmbeddedDocuments?.("Item",
						plan.add.map(m => ({ name: m, type: "npcMove" })), silent());
				}
				moved++;
			} catch (err) {
				console.warn("Stonetop | Could not bring this follower's actor back in step.", actor?.name, err);
			}
		}
	} catch (err) {
		// Outside the per-actor guard above: makerRank walks the connected users and asks the
		// character about each one's permissions, and that is before any single actor is in hand.
		console.error("Stonetop | Could not sync this character's follower actors.", err);
	} finally {
		_syncsInFlight.delete(character?.id);
	}
	return moved;
}
