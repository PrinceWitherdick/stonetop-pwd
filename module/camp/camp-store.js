import { SYSTEM_ID } from "../system-id.js";
import { autoOpenUserId, ownerUsers } from "../hooks/DeathsDoorPrompt.js";
import { THRALL_MARK, hasThrallMark, isOutOfPlay, isUnliving, slowToHeal } from "../actors/character/deaths-door-actor.js";
import { crewExists } from "../utils/crew.js";
import { readableFlags } from "../actors/character/StonetopFlags.js";
import { followerInPartyFlags, followerMouths, partyFollowers, partyMouths } from "../actors/character/follower-party.js";
import { partyFollowersOf } from "../actors/character/follower-roster.js";
// Now is the server's clock (serverNow): a camp goes cold CAMP_STALE_MS after it opened, and the clients
// that stamp and read that time can sit hours apart on their own clocks.
import { deletionTarget, serverNow } from "../utils/foundry-compat.js";
import { asArray, playsCharacter } from "../utils/playbook-actors.js";
import { postMoveToChat, rolledTotalCard } from "../utils/chat.js";
import { capitalizeFirst } from "../utils/strings.js";
import {
	BREAK_BREAD, CAMP_FLAG, CAMP_OWED_FLAG, CAMP_STATE, CAMP_STATUS, HAD_ALL_ALONG, HOME_FIRES, SETTLE_REFUSAL,
	campLedger, campShareUpdate, campState, count, freezeCampPlan, messKitAllAlong, newCampRecord, readCampRecord,
	readOwedCamps, rollsBedroll, rollsBreakBread, suppliesAllAlong,
} from "./camp-rules.js";
import { ownsLearnedMoveNamed } from "../actors/character/owns-move.js";
import { walkItOffChoice } from "../actors/character/walk-it-off.js";
import { CLEARS_ON, markedTracks, snapshotTracksClearedBy } from "../actors/character/background-tracks.js";
import { campSummaryRows, hadAllAlongRows } from "./camp-view.js";
import { campFollowerShare } from "./camp-followers.js";

/**
 * THE CAMP'S DOCUMENTS: who is sitting at the fire, the choices they make there, and the moment
 * the camp is settled and every share is paid. The arithmetic is camp-rules.js and the words are
 * camp-view.js; this file reads and writes the actors.
 *
 * Three rules hold every write here together.
 *
 *  1. A character's part of the camp is written to that character only, by a client that owns
 *     them. No write in this file reaches into one character's pack on another player's behalf.
 *  2. The host's record is the camp's authority: whether it is open, settled or broken up, and,
 *     once settled, the frozen plan.
 *  3. Each share of a settled camp is paid by exactly ONE client, elected the way Death's Door
 *     elects whose screen its walkthrough opens on: the player the character is assigned to, then
 *     any logged-in player who owns them, then a GM. Every client runs the same election over the
 *     same user list, so they agree without talking to each other, and the share's `applied` mark
 *     stops a client that turns up later from paying it twice.
 *
 * Nothing here needs a socket. Foundry sends every actor update to every connected client, so the
 * host's settle reaches every machine as an ordinary updateActor, and the elected one pays.
 */

const FLAG_PATH = `flags.${SYSTEM_ID}.${CAMP_FLAG}`;
const OWED_PATH = `flags.${SYSTEM_ID}.${CAMP_OWED_FLAG}`;

/** The message flag a camp's join card carries: `{campId, hostId}`, the camp its button leads to. */
export const CAMP_CARD_FLAG = "campJoin";

/** The fields a seated character may change on their own record. `offer` is a map by purse. */
const CHOICE_FIELDS = new Set(["offer", "followers", "eats", "messKit", "benefit", "debility", "bedroll", "peaceful", "ready", "properMeal", "hearthAsh"]);

/**
 * How far back through the chat log a camp's cards are looked for. A join card is posted the
 * moment a camp opens and the camp lasts minutes, so it is always near the bottom; walking a
 * world's whole log on every settle would be paying for cards that are long over.
 */
const CARD_REFRESH_WINDOW = 200;

function characters() {
	return (game.actors?.contents ?? []).filter(a => a?.type === "character");
}

/** A character's part of a camp, or null. */
export function campRecordOf(actor) {
	return readCampRecord(actor?.getFlag?.(SYSTEM_ID, CAMP_FLAG));
}

/** Where a camp stands (CAMP_STATE), read off its host. */
export function stateOfCamp({ campId, hostId } = {}, now = Date.now()) {
	return campState(campRecordOf(game.actors?.get(hostId)), { campId, hostId }, now);
}

/** Whether a character can sit at a camp at all. Whoever has left play cannot (deaths-door-actor.js#isOutOfPlay). */
export function canCamp(actor) {
	return actor?.type === "character" && !isOutOfPlay(actor);
}

/**
 * A Ghost or a Revenant: at the fire, but no mouth, and the night buys them nothing. The rule is
 * Death's Door's (deaths-door-actor.js#isUnliving), since Recover, Convalesce and magical healing
 * ask it too; named here as well for the camp's own readers.
 */
export { isUnliving };

/** Every camp in the world that can still be joined, as `{campId, hostId, hostName}`. */
export function openCamps(now = Date.now()) {
	const camps = [];
	for (const actor of characters()) {
		const record = campRecordOf(actor);
		if (!record || record.host !== actor.id || !canCamp(actor)) continue;
		if (campState(record, { campId: record.id, hostId: actor.id }, now) !== CAMP_STATE.OPEN) continue;
		camps.push({ campId: record.id, hostId: actor.id, hostName: actor.name });
	}
	return camps;
}

/** The characters sitting at a camp, whatever state the camp is in. */
export function campActors(campId) {
	if (!campId) return [];
	return characters().filter(a => canCamp(a) && campRecordOf(a)?.id === campId);
}

/**
 * The debilities a character has marked right now, named from what they published on joining.
 * Which ones are marked is read live: a debility cleared by Recover while the camp sits open must
 * not stay on offer. A marked Walk It Off box counts, since it is cleared as a debility is.
 */
function markedDebilities(actor, vitals) {
	const marked = actor?.system?.attributes?.debilities?.options ?? {};
	const named  = new Map((vitals?.debilities ?? []).map(d => [d.key, d.name]));
	const walkItOff = walkItOffChoice(actor);
	return Object.keys(marked)
		.filter(key => marked[key]?.value)
		.map(key => ({ key, name: named.get(key) ?? capitalizeFirst(key) }))
		.concat(walkItOff?.marked ? [{ key: walkItOff.key, name: walkItOff.name }] : []);
}

/** One character at the fire, in the shape camp-rules.js reads (its CampMember). */
export function campMember(actor, hostId) {
	const record = campRecordOf(actor);
	return {
		actorId:          actor.id,
		name:             actor.name,
		img:              actor.img ?? "",
		isHost:           actor.id === hostId,
		record,
		resources:        actor.getFlag?.(SYSTEM_ID, "inventory.resources") ?? {},
		hpValue:          count(actor.system?.attributes?.hp?.value),
		// The published max is the computed one. The stored field is a mirror that only moves when
		// the owner's sheet renders, so it is the fallback, not the source.
		maxHp:            record?.vitals.maxHp || count(actor.system?.attributes?.hp?.max),
		activeDebilities: markedDebilities(actor, record?.vitals),
		unliving:         isUnliving(actor),
		// At 0 HP with their 0-HP move still to face: the night restores them no HP (camp-rules.js
		// #freezeCampPlan). Read live, so one brought back up mid-camp heals as anyone does.
		dying:            !!actor.typedActor?.canFaceDeathsDoor,
		// Read live, like the debilities: a move learned or switched off mid-camp counts as it is now.
		breaksBread:      ownsLearnedMoveNamed(actor, BREAK_BREAD),
		hearthCha:        ownsLearnedMoveNamed(actor, HOME_FIRES) ? Math.trunc(Number(actor.system?.stats?.cha?.value) || 0) : null,
		// The tracks were named on sitting down (campVitalsFor); whether one is marked is read live.
		clearsTonight:    markedTracks(record?.vitals.clears, actor.getFlag?.(SYSTEM_ID, "background.setupResources")),
		pack:             packFor(actor),
		// A Thrall's Marks that reach the fire, read live like the moves.
		slowToHeal:       slowToHeal(actor),
		ravenous:         hasThrallMark(actor, THRALL_MARK.RAVENOUS),
		nightmarish:      hasThrallMark(actor, THRALL_MARK.QUICKSILVER_DREAMS),
	};
}

/**
 * A Ravenous Thrall's "extra 1d4 provisions or uses of supplies", rolled as they sit down and posted
 * as its own die, so the table watches it land and every window reads the same bill off their record.
 * Rolled once for the camp: a roll per render would give every reader a different bill. 0, and no
 * die, for anyone without the Mark. A Mark taken while already seated counts from their next camp.
 */
async function rollHunger(actor) {
	if (!hasThrallMark(actor, THRALL_MARK.RAVENOUS)) return 0;
	const roll = await new Roll("1d4").evaluate();
	await roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor:  rolledTotalCard(roll, "Ravenous", "extra provisions or uses of supplies", "at the camp"),
	});
	return count(roll.total);
}

/**
 * What Have What You Need can draw on in a character's pack, read live off the flags, since a mark
 * spent at the fire must show on every reader's window at once.
 */
function packFor(actor) {
	let usesPerSupply = null;
	try {
		usesPerSupply = actor.typedActor?.getUsesPerSupply?.() ?? null;
	} catch {
		// No readable steading: the rules fall back to the book's default of 4.
	}
	return {
		undefinedMarks: count(actor.getFlag?.(SYSTEM_ID, "inventory.regularPool")),
		checked:        actor.getFlag?.(SYSTEM_ID, "inventory.checked") ?? {},
		usesPerSupply,
	};
}

/** Everyone at a camp, as CampMembers. */
export function campMembers(campId, hostId) {
	return campActors(campId).map(actor => campMember(actor, hostId));
}

/** The one user whose client pays this character's share of a settled camp, or null for nobody. */
export function campWriterId(actor) {
	return autoOpenUserId(ownerUsers(actor));
}

/** Whether THIS client is the one that pays this character's share. */
export function isCampWriter(actor) {
	const me = game.user?.id;
	return !!me && !!actor && campWriterId(actor) === me;
}

/**
 * Whether `user` plays this character, as opposed to merely being allowed to edit it. The rule is
 * playbook-actors.js#playsCharacter, since a Struggle, an asking card and the end of a session ask it
 * too; named here as well for the camp's own readers.
 */
export { playsCharacter };

/** The living characters this user plays and can write, which are the ones they can bring to a camp. */
export function myCampCharacters() {
	return characters().filter(a => canCamp(a) && a.isOwner && playsCharacter(a));
}

/**
 * The numbers a character publishes on sitting down, from their own character model. Only a
 * client that owns them can build that, which is exactly who sits them down: their player, or a
 * GM bringing them along.
 *
 * A model that fails to build still lets them sit. The stored max stands in, and nothing counts
 * as carried, which errs toward a bedroll left unrolled rather than one rolled that is not there.
 */
export async function campVitalsFor(actor) {
	const storedMax = count(actor?.system?.attributes?.hp?.max);
	try {
		const snapshot = await actor.typedActor?.buildSnapshot?.();
		const outfit   = snapshot?.inventory?.outfit?.regularItems ?? [];
		const carried  = slug => !!outfit.find(item => item.slug === slug)?.checked;
		return {
			maxHp:      count(snapshot?.vitals?.hp?.max) || storedMax,
			bedroll:    carried("bedroll"),
			messKit:    carried("mess-kit"),
			debilities: (snapshot?.debilities ?? []).map(d => ({ key: d.key, name: d.name })),
			// Auspicious Birth's circle, which Make Camp clears.
			clears:     snapshotTracksClearedBy(snapshot, CLEARS_ON.MAKE_CAMP).map(t => ({ key: t.key, name: t.name })),
		};
	} catch (err) {
		console.warn(`Stonetop | Make Camp: could not read ${actor?.name}'s sheet, so the stored max HP stands in`, err);
		return { maxHp: storedMax, bedroll: false, messKit: false, debilities: [], clears: [] };
	}
}

/**
 * The mouths a character brings besides their own: every living follower they have marked as
 * travelling with the party, a group follower counting as its members still with it (a member
 * marked fallen eats nothing; one who is only down still eats). Only where the count starts; the
 * player changes it at the fire.
 *
 * Every kind of follower counts (follower-party.js): `followers` are the character's party followers
 * (follower-roster.js#partyFollowersOf), which reads which built-in followers a character
 * HAS. Without them (no sheet to read) the flags alone can still answer for custom followers and a
 * crew; the companion, initiates and beasts need the playbook to be known at all.
 */
export function partyFollowerMouths(actor, followers = null) {
	const flags = readableFlags(actor ?? {});
	if (Array.isArray(followers)) return partyMouths(flags, partyFollowers(followers));
	const custom = Object.entries(flags?.customFollowers ?? {})
		.filter(([slug, f]) => followerInPartyFlags(flags, "custom", slug) && !f?.dead)
		.reduce((sum, [slug]) => sum + followerMouths(flags, { ftype: "custom", slug }), 0);
	const crew = crewExists(flags?.crew) && followerInPartyFlags(flags, "crew")
		? followerMouths(flags, { ftype: "crew", slug: "" }) : 0;
	return custom + crew;
}

/**
 * The settled camps this character hosted whose plans may still owe somebody a share: the ones set
 * aside under CAMP_OWED_FLAG, and the one on their own camp record, while it is settled.
 */
function owedCamps(host) {
	const camps  = readOwedCamps(host?.getFlag?.(SYSTEM_ID, CAMP_OWED_FLAG));
	const record = campRecordOf(host);
	if (record && record.host === host.id && record.status === CAMP_STATUS.SETTLED && record.plan) {
		camps.push({ id: record.id, plan: record.plan });
	}
	return camps;
}

/** A settled camp's plan cut down to the shares still unpaid, or null once every one is paid. */
function unpaidPart({ id, plan }) {
	const unpaid = plan.filter(entry => {
		const theirs = campRecordOf(game.actors?.get(entry?.actorId));
		return theirs?.id === id && !theirs.applied;
	});
	return unpaid.length ? { id, plan: unpaid } : null;
}

/** Sit a character down at a camp: one write of a whole fresh record. */
async function sitDown(actor, { campId, hostId }) {
	// Every follower travelling with them, built-in or custom (follower-roster.js); read
	// alongside the vitals, as neither waits on the other.
	const [vitals, party] = await Promise.all([campVitalsFor(actor), partyFollowersOf(actor)]);
	// A host walking away from their own unsettled camp breaks it up, and this write replaces the record
	// that said so. The new one names it, along with every camp the old one named, so their cards and
	// windows go on saying they broke up (campState) however many fires this character moves between.
	const last  = campRecordOf(actor);
	const broke = last && last.host === actor.id && last.id !== campId
		&& [CAMP_STATE.OPEN, CAMP_STATE.CANCELLED].includes(campState(last, { campId: last.id, hostId: actor.id }, Date.now()));
	const left  = [...(last?.leftCamps ?? []), ...(broke ? [last.id] : [])];
	const record = newCampRecord({
		id:                 campId,
		hostId,
		actorId:            actor.id,
		now:                Date.now(),
		vitals,
		followers:          partyFollowerMouths(actor, party),
		hpValue:            actor.system?.attributes?.hp?.value,
		activeDebilityKeys: markedDebilities(actor, vitals).map(d => d.key),
		unliving:           isUnliving(actor),
		leftCamps:          left,
		hunger:             await rollHunger(actor),
	});
	const update = { [FLAG_PATH]: record };
	// The fresh record replaces the one a settled camp's plan is kept on. Whatever of that plan is
	// still owed to somebody (a player who was away when it settled, with no GM on to pay for them)
	// moves aside in the same write, and a camp paid in full is let go.
	const kept = readOwedCamps(actor.getFlag?.(SYSTEM_ID, CAMP_OWED_FLAG));
	const owed = owedCamps(actor).map(unpaidPart).filter(Boolean);
	if (owed.length || kept.length) update[OWED_PATH] = owed;
	// Bookkeeping, not an event in the character's life: the ledger hears about the camp when the
	// share is paid, as "via Make Camp", and not about every stepper on the way there.
	await actor.update(update, { stonetopLedger: true });
	return record;
}

/** Open a new camp with this character as its host. */
export async function hostCamp(actor) {
	const camp = { campId: foundry.utils.randomID(), hostId: actor.id };
	await sitDown(actor, camp);
	return camp;
}

/**
 * Sit this character down at an existing camp. Whatever camp they were at before, they have left.
 * Every client's watch (onUpdateActorCamp) redraws the camp cards when anybody sits down, this
 * client included, so the Join button this character just used comes back as "Open the camp".
 */
export async function joinCamp(actor, camp) {
	await sitDown(actor, camp);
}

/**
 * Take a character away from the fire: the GM's undo for bringing the wrong one to it. Their whole
 * record goes with them, so bringing them back seats them fresh. Never the host, whose camp would be
 * left with nobody to settle it; breaking the camp up is its own button.
 *
 * ⚠ AND ONLY WHILE THE CAMP IS OPEN. A settled camp's plan counts everyone who was at the fire, and
 * each share is paid against that character's own record (applyCampShares), so a record taken away
 * after the settle is a share never paid: the food they were counted for never leaves their pack, and
 * the night never heals them. The window queues this behind Make Camp, so a GM pressing both in one
 * breath would do exactly that.
 */
export async function sendAwayFromCamp(actor, { campId, hostId } = {}) {
	if (!actor || actor.id === hostId || campRecordOf(actor)?.id !== campId) return;
	if (stateOfCamp({ campId, hostId }) !== CAMP_STATE.OPEN) return;
	await actor.unsetFlag(SYSTEM_ID, CAMP_FLAG);
}

/**
 * Whether an update written by somebody else's client has taken a character this user plays away
 * from a camp: a GM sending them away, or bringing them to another fire. That player's window closes
 * when their last character goes, and this is what lets it say why.
 */
export function takenFromCamp(actor, campId, userId) {
	return !!userId && userId !== game.user?.id && playsCharacter(actor) && campRecordOf(actor)?.id !== campId;
}

/**
 * Write some of a seated character's own choices. Keys are record fields, and `offer.<slug>` for
 * one purse; anything else throws, because a typo here would write a field nothing ever reads.
 */
export async function setCampChoices(actor, patch = {}) {
	const update = {};
	for (const [key, value] of Object.entries(patch)) {
		if (!CHOICE_FIELDS.has(key.split(".")[0])) throw new Error(`Stonetop | Make Camp: "${key}" is not a camp choice`);
		update[`${FLAG_PATH}.${key}`] = value;
	}
	if (Object.keys(update).length) await actor.update(update, { stonetopLedger: true });
}

/**
 * HAVE WHAT YOU NEED at the fire (Book I p.78): one undefined ◇ becomes a supplies row, full, or a
 * mess kit the character is now cooking with. Through the same StonetopCharacter#toggleCarriedItem
 * as ticking the item on the Inventory tab, so the ◇ is recorded as drawn from the undefined pool
 * and un-ticking it later gives the ◇ back. Load is unchanged: the mark only moves.
 *
 * The table hears about it in chat, because the move lets the GM or any player veto it.
 *
 * @param {Actor}  actor
 * @param {string} what  HAD_ALL_ALONG
 * @returns {Promise<{ok: boolean, row?: string, uses?: number}>}
 */
export async function haveWhatYouNeedAtCamp(actor, what) {
	const record = campRecordOf(actor);
	const character = actor?.typedActor;
	if (!record || !character || stateOfCamp({ campId: record.id, hostId: record.host }) !== CAMP_STATE.OPEN) return { ok: false };
	const member = campMember(actor, record.host);
	if (what === HAD_ALL_ALONG.MESS_KIT) {
		if (!messKitAllAlong(member)) return { ok: false };
		await character.toggleCarriedItem(HAD_ALL_ALONG.MESS_KIT, true, { weight: 1 });
		// Published on the record, like a mess kit packed before the camp began, and put to use.
		await actor.update({ [`${FLAG_PATH}.vitals.messKit`]: true, [`${FLAG_PATH}.messKit`]: true }, { stonetopLedger: true });
		postMoveToChat(actor, "Have What You Need", hadAllAlongRows(what));
		return { ok: true };
	}
	const supplies = suppliesAllAlong(member);
	if (!supplies.ok) return { ok: false };
	await character.toggleCarriedItem(supplies.row, true, { weight: 1 });
	await character.setInventoryResource(supplies.row, supplies.uses);
	postMoveToChat(actor, "Have What You Need", hadAllAlongRows(what, supplies));
	return { ok: true, row: supplies.row, uses: supplies.uses };
}

/** Break a camp up without anyone eating. Nothing is spent and nothing is gained. */
export async function breakCamp(host) {
	await host.update({ [`${FLAG_PATH}.status`]: CAMP_STATUS.CANCELLED }, { stonetopLedger: true });
}

/** The camps this client is settling right now, by id. */
const settling = new Set();

/**
 * Settle the camp: freeze the plan onto the host, then say what happened.
 *
 * Only the host's owner or a GM may ask for it, since only they can write the host. ONE CLIENT
 * SETTLES: the one elected to pay the host's share (isCampWriter), which is the host's own player
 * whenever they are on. Anybody else pressing Make Camp writes a fresh `settleAsk` onto the host,
 * and the elected client settles from that update (onUpdateActorCamp). With two settlers, the
 * host's player and a GM pressing in the same moment would each still see the camp open, each roll
 * the bedrolls, and each write a plan and post a summary. `settling` stops the elected client
 * answering its own press and somebody else's request both.
 *
 * The shares are NOT paid here. The plan landing on the host is an updateActor on every client,
 * and the client elected for each character pays that character's share from it
 * (applyCampShares), this one included.
 *
 * @returns {Promise<{ok: true, plan: object[]|null} | {ok: false, reason: string}>}  `plan` is null
 *          when the settle was handed to the elected client; `reason` is a SETTLE_REFUSAL
 */
export async function settleCamp(camp) {
	const { campId, hostId } = camp ?? {};
	const host = game.actors?.get(hostId);
	if (!host || stateOfCamp(camp) !== CAMP_STATE.OPEN) return { ok: false, reason: SETTLE_REFUSAL.CLOSED };
	if (!(game.user?.isGM || host.isOwner)) return { ok: false, reason: SETTLE_REFUSAL.NOT_YOURS };
	const ledger = campLedger(campMembers(campId, hostId));
	if (!ledger.canSettle) return { ok: false, reason: SETTLE_REFUSAL.SHORT };
	if (!isCampWriter(host)) {
		await host.update({ [`${FLAG_PATH}.settleAsk`]: foundry.utils.randomID() }, { stonetopLedger: true });
		return { ok: true, plan: null };
	}
	if (settling.has(campId)) return { ok: false, reason: SETTLE_REFUSAL.CLOSED };
	settling.add(campId);
	try {
		return await settleHere(camp, host, ledger);
	} finally {
		settling.delete(campId);
	}
}

/** The elected client's half of settleCamp: the dice, the plan, and telling the table. */
async function settleHere(camp, host, ledger) {
	// The dice now and their messages last: a plan that then failed to write would otherwise leave
	// bedroll rolls in the log for a night that never happened.
	const rolls  = [];
	const breads = [];
	for (const member of ledger.rows) {
		if (rollsBedroll(member, ledger)) rolls.push({ member, roll: await new Roll("1d6").evaluate() });
		// One meal, so one 1d8 each, however many at the fire hold Break Bread.
		if (rollsBreakBread(member, ledger)) breads.push({ member, roll: await new Roll("1d8").evaluate() });
	}
	// Somebody else may have settled it, or broken it up, while the dice were out.
	if (stateOfCamp(camp) !== CAMP_STATE.OPEN) return { ok: false, reason: SETTLE_REFUSAL.CLOSED };

	const byActor = list => Object.fromEntries(list.map(({ member, roll }) => [member.actorId, roll.total]));
	const plan = freezeCampPlan(ledger, { bedrolls: byActor(rolls), breads: byActor(breads) });
	await host.update({
		[`${FLAG_PATH}.status`]:    CAMP_STATUS.SETTLED,
		[`${FLAG_PATH}.plan`]:      plan,
		[`${FLAG_PATH}.settledAt`]: Date.now(),
	}, { stonetopLedger: true });

	// Each die is its own message in the log, the way the one-person camp always rolled it: a die the
	// table can watch land, spoken by the character it heals. Made together, in one request, bedrolls
	// first.
	const dice = [
		...rolls.map(die => ({ ...die, flavor: rolledTotalCard(die.roll, "Bedroll", "extra HP") })),
		...breads.map(die => ({ ...die, flavor: rolledTotalCard(die.roll, "Break Bread", "extra HP") })),
	];
	const messages = await Promise.all(dice.map(({ member, roll, flavor }) => roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor: game.actors?.get(member.actorId) }),
		flavor,
	}, { create: false })));
	if (messages.length) await ChatMessage.implementation.createDocuments(messages);
	postMoveToChat(host, "Make Camp", campSummaryRows(ledger, plan));
	return { ok: true, plan };
}

/**
 * The shares this client has claimed and is writing right now, as `campId:actorId`.
 *
 * The `applied` mark is written by the very update that pays a share, so between the write going
 * out and coming back it cannot stop a second attempt; and that update is itself an updateActor
 * that runs this again. The latch covers that gap.
 */
const paying = new Set();

/**
 * Pay every share this host's settled camps still owe that is this client's to pay: the camp on
 * their record, and any set aside when they sat down again (CAMP_OWED_FLAG).
 *
 * Safe to call as often as anything likes: a share already paid, one another client is elected
 * for, or one whose character has since moved on to a different camp is passed over.
 */
export async function applyCampShares(host) {
	for (const camp of owedCamps(host)) {
		for (const entry of camp.plan) {
			const actor  = game.actors?.get(entry?.actorId);
			const theirs = campRecordOf(actor);
			// The flag first: the election tests every user's ownership, and most shares are long paid.
			if (!theirs || theirs.id !== camp.id || theirs.applied || !isCampWriter(actor)) continue;
			await payShare(actor, entry, camp.id);
		}
	}
}

async function payShare(actor, entry, campId) {
	const key = `${campId}:${actor.id}`;
	if (paying.has(key)) return;
	paying.add(key);
	try {
		const character = actor.typedActor;
		const { update, shortfall } = campShareUpdate(entry, {
			resources:     actor.getFlag(SYSTEM_ID, "inventory.resources") ?? {},
			hpValue:       actor.system?.attributes?.hp?.value,
			resourceData:  (slug, count) => character.inventoryResourceData(slug, count),
			advantageData: source => character.heldAdvantageData(source),
			disadvantageData: source => character.heldDisadvantageData(source),
		});
		// The followers the meal fed regain half their max HP in the same write (camp-followers.js). A
		// card that can't be read costs them the heal, never the character's own share.
		// Read only when the meal fed any of them: it looks up the playbook.
		const party = entry?.followersFed > 0 ? await partyFollowersOf(actor) : null;
		const followers = await campFollowerShare(actor, entry, { partyMouths: partyFollowerMouths(actor, party), followers: party })
			.catch(err => {
				console.warn(`Stonetop | Make Camp: could not read ${actor.name}'s followers`, err);
				return { update: {}, rows: [] };
			});
		await actor.update({ ...update, ...followers.update }, { stonetopMove: "Make Camp" });
		if (followers.rows.length) postMoveToChat(actor, "Make Camp", followers.rows);
		if (shortfall > 0) {
			ui.notifications?.warn?.(`By the time the camp was settled, ${actor.name}'s pack held ${shortfall} ${shortfall === 1 ? "use" : "uses"} less than was shared from it.`);
		}
	} catch (err) {
		console.error(`Stonetop | Make Camp: could not pay ${actor.name}'s share of the camp`, err);
		ui.notifications?.error?.(`${actor.name}'s share of the camp could not be recorded. Check the sheet before the next roll.`);
	} finally {
		paying.delete(key);
	}
}

/** Pay any settled camp's shares still owed by this client: at startup, or when who is online changes. */
export async function payPendingShares() {
	for (const actor of characters()) await applyCampShares(actor);
}

/**
 * Redraw the join cards of one camp, or of every camp, on this client only.
 *
 * A card's button depends on its camp's state, which lives on an actor, and a chat message does
 * not re-render when an actor changes. Nothing is written: each client redraws its own copy of
 * the log, which is also why a player who could never write the card still sees it close.
 */
export function refreshCampCards(campId = null) {
	const messages = game.messages?.contents ?? [];
	for (const message of messages.slice(-CARD_REFRESH_WINDOW)) {
		const card = message?.getFlag?.(SYSTEM_ID, CAMP_CARD_FLAG);
		if (!card || (campId && card.campId !== campId)) continue;
		ui.chat?.updateMessage?.(message);
	}
}

/** Whether an actor update wrote, or removed, a character's camp flag. */
export function touchesCamp(changes) {
	const scoped = changes?.flags?.[SYSTEM_ID];
	return !!scoped && Object.keys(scoped).some(key => key.replace(/^-=/, "") === CAMP_FLAG);
}

/**
 * The world's half of a camp, on every client whether or not its window is open: the cards are
 * redrawn when anybody sits down, gets up, or a camp changes state; a request to settle reaches the
 * one client that settles; and a settled camp gets its shares paid.
 *
 * Every camp card is redrawn rather than only one camp's. The update carries the new record, not
 * the old one, and the old camp's cards (a host who moved to another fire and took an empty camp
 * with them) are exactly the ones that just closed. A choice made at the fire redraws nothing: no
 * card shows one.
 */
export function onUpdateActorCamp(actor, changes) {
	if (actor?.type !== "character" || !touchesCamp(changes)) return;
	// No record's fields when the flag was removed outright, which is a GM sending somebody away. A
	// removal is spelled one of two ways depending on the core (utils/foundry-compat.js#deletionTarget).
	const delta  = changes.flags[SYSTEM_ID][CAMP_FLAG];
	const fields = delta && typeof delta === "object" && !deletionTarget(FLAG_PATH, delta) ? delta : null;
	if (!fields || "id" in fields || "status" in fields) refreshCampCards();
	const record = campRecordOf(actor);
	if (!record || record.host !== actor.id) return;
	if (record.status === CAMP_STATUS.OPEN && fields && "settleAsk" in fields && isCampWriter(actor)) {
		settleCamp({ campId: record.id, hostId: actor.id })
			.catch(err => console.error(`Stonetop | Make Camp: could not settle ${actor.name}'s camp`, err));
	}
	if (record.status === CAMP_STATUS.SETTLED) applyCampShares(actor);
}

/** Registered once, at module scope in stonetop.js. */
export function registerCampHooks() {
	Hooks.on("updateActor", onUpdateActorCamp);
	// A share can be owed to a client that was not there when its camp settled: a player who dropped
	// out mid-camp with no GM on to pay it for them. Their next login pays it.
	Hooks.once("ready", () => { payPendingShares(); });
	// And somebody connecting or dropping out can move a share onto this client, GM or player alike.
	// Every client looks, and each pays only what is now its own.
	Hooks.on("userConnected", () => { payPendingShares(); });
}
