// +1 to a roll just made, pressed on its roll card. Three moves say it, each a little differently:
//
//  • CHRONICLER OF STONETOP (Judge): "You can spend 1 Diligence at any time to add +1 to a roll that you
//    or a fellow player just made." Offered on any PC's roll card, the Judge's own included, to whoever
//    plays a Judge holding Diligence.
//  • COMMUNE WITH ARATIS (the Judge's Prophet background): "While acting on her orders, spend 1 Sanction
//    to add +1 to a roll you just made." The Prophet's OWN roll cards only. Whether they are acting on her
//    orders is the fiction's to say, so pressing it says they are.
//  • MANY HANDS MAKE LIGHT WORK (Judge): "When you jump in to help another character who just rolled, tell
//    us how and ask the GM what else is required or what the consequences will be. If you accept, increase
//    your ally's roll by +1." ANOTHER PC's roll card, and free: the price is the GM's answer.
//  • PIETY (Lightbearer): "When you spend at least an hour in proper worship to Helior, hold 1 Blessing.
//    Other faithful PCs who partake in this worship also hold 1 Blessing. At any time, you can spend 1
//    Blessing to add +1 to a roll you just made in pursuit of a righteous cause." The holder's OWN roll
//    cards, like Sanction, and the cause is the player's to call. Unlike the three above it is not the MOVE
//    that says who is offered it: the Lightbearer holds theirs on Piety's pip, and anyone who worshipped
//    with them holds one as a flag (`blessing`) on their own character, Piety or not. One at most either
//    way: worshipping again holds 1, never 2 (see holdBlessing and shareBlessing below).
//
// ONE OF EACH PER ROLL PER HELPER. Diligence could in principle be spent twice on one roll; the card offers
// each source once for each helper, so a Judge with 3 Diligence cannot turn a 7 into a 10 alone. Who used
// which is kept on the message (`rollBoosts`), which is what hides a button once it has been pressed, and
// what the card reads to name each +1 ("+1 Diligence (Aeron)") in its Conditions row.
//
// THE SAME +1 THE GM'S SHIFT UP ADDS. The total moves through the roll's shift term and the card is redrawn
// for the new total and tier (stonetop.js _shiftRoll and _shiftRollCardFlavor, handed in as `deps`), exactly
// as Burn Brightly does, so the two never drift.
//
// A CARD SOMEONE ELSE WROTE cannot be written by a player: a Judge helping the Fox is pressing a button on
// the Fox's message. Then the GM's client records it (BOOST_QUERY), after checking the asker plays the helper,
// the way a Readiness spend on the GM's damage card goes (fight/defend-spend.js#handleSpendQuery). With a GM
// online the card's own author sends theirs there too, as every rewrite of a card's dice goes
// (utils/roll-card-writer.js): one client writes them all, in that card's turn.
//
// NOT MANY HANDS ON A STRUGGLE AS ONE ROLL. The struggle bars it for anyone in it (struggle-rules.js MOVE),
// and a Judge outside it is the GM's +1 on the row (`bump`), which a +1 on the card would count twice.
//
// Only a move or stat roll's card: one with a hit tier (`stonetop-roll-result-label`), and not a damage roll.

import { SYSTEM_ID } from "../../system-id.js";
import { format, localize } from "../../utils/i18n.js";
import { escHtml } from "../../utils/strings.js";
import { inCardTurn } from "../../utils/card-queue.js";
import { rollCardRoute, writeCardRoll } from "../../utils/roll-card-writer.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
import { askGMClient, queryAsker, resolveSync } from "../../utils/foundry-compat.js";
import { holdForEach, shareHold } from "../../utils/share-hold.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { cardTierNow } from "../../utils/counted-tier.js";
import { asArray } from "../../utils/playbook-actors.js";
import { ownerUsers } from "../../hooks/DeathsDoorPrompt.js";
import { DEATHS_DOOR_ROLL_FLAG, DEATHS_DOOR_ROLLING_FLAG, isDeathsDoorCard, isUndeathCard } from "./deaths-door.js";
import { deathsDoorRollMarker } from "./deaths-door-actor.js";
import { ownsLearnedMoveNamed, ownedMove } from "./owns-move.js";
import { heldOnTrack, learnedTrack, takeBackHeld } from "./MoveResources.js";
import { STRUGGLE_MESSAGE_FLAG } from "../../struggle/struggle-rules.js";

const KEY = "stonetop.rollBoosts";

export const CHRONICLER = "Chronicler of Stonetop";
export const COMMUNE_WITH_ARATIS = "Commune with Aratis";
export const MANY_HANDS = "Many Hands Make Light Work";
export const PIETY = "Piety";

/**
 * Each source of a +1: the move that gives it, what it costs off that move's track, and whose roll it may
 * go on (`any` PC's, the helper's `own`, or an `other` PC's). In the order the buttons stand.
 *
 * A source with its own `held` and `spend` is offered to whoever holds it, whether or not they have the
 * move: Piety's Blessing is held by the faithful who worshipped beside a Lightbearer too.
 */
const SOURCES = {
	diligence: { move: CHRONICLER, cost: 1, on: "any" },
	sanction:  { move: COMMUNE_WITH_ARATIS, cost: 1, on: "own" },
	manyHands: { move: MANY_HANDS, cost: 0, on: "other", notInStruggle: true },
	blessing:  { move: PIETY, cost: 1, on: "own", held: blessingHeld, spend: spendBlessing, refund: holdBlessing },
};
export const BOOST_SOURCES = Object.freeze(Object.keys(SOURCES));

/** The message flag listing the +1s taken on a roll, each `{source, by: actorUuid, name}`. */
export const BOOSTS_FLAG = "rollBoosts";

/** The User query a player's +1 goes through on a card they did not write. */
export const BOOST_QUERY = "stonetop.rollBoost";

/** The character flag a PC who worshipped beside a Lightbearer holds their Blessing on. */
export const BLESSING_FLAG = "blessing";

/** The User query a Lightbearer's player sends to bless a character they do not own. */
export const BLESSING_QUERY = "stonetop.pietyBlessing";

/** The +1s already taken on this card. */
export function boostsOn(message, scope = SYSTEM_ID) {
	const list = message?.getFlag?.(scope, BOOSTS_FLAG);
	return Array.isArray(list) ? list : [];
}

/**
 * Whether this is a card a +1 can ever go on: a move or stat roll, carrying a roll and a hit tier to move, and
 * not a damage card. Read off the stored flavor rather than the rendered card, so the GM's client answering a
 * relayed press asks the same question the button did. PURE. The +1s a card already took are drawn on any
 * such card (wireRollBoosts), a Death's Door card whose tier has since landed included.
 *
 * Not an insert's 0-HP move's card (Undying, Dark Succor): its window settles the tier when the dice land, so a
 * +1 pressed on the card afterwards would relabel it, spend the helper's hold, and change nothing
 * (deaths-door.js#isUndeathCard).
 */
function isBoostableCard(message, scope = SYSTEM_ID) {
	if (!message?.rolls?.length) return false;
	if (message.getFlag?.(scope, "damage")) return false;
	if (isUndeathCard(message)) return false;
	const flavor = String(message.flavor ?? "");
	return flavor.includes("stonetop-roll-result-label") && !flavor.includes("stonetop-damage-roll-card");
}

/**
 * Whether this card takes a +1 NOW: a card that ever can (isBoostableCard), and a Death's Door card only while
 * its window is still waiting on the tier (deathsDoorAwaitsPlusOnes). The Door is a roll like any other (Book I
 * p.245), and Diligence is spent "at any time" on "a roll that you or a fellow player just made" (the Judge, Book
 * I p.118), so the Door's window pauses for these +1s as it does for Burn Brightly
 * (dialogs/DeathsDoorDialog.js#_boostsLeft). `doorOpen` is that window's own word, for a marker its client has
 * not yet heard (the GM's client writes a claim it rules on). Reads the card, and for a Death's Door card its
 * roller's marker.
 */
export function isBoostableRoll(message, scope = SYSTEM_ID, { doorOpen = false } = {}) {
	if (!isBoostableCard(message, scope)) return false;
	return !isDeathsDoorCard(message) || doorOpen || deathsDoorAwaitsPlusOnes(message);
}

/**
 * Whether a Death's Door card is still open to a +1: its dice are down and its tier not yet written. That is
 * exactly while the roller's marker (deaths-door-actor.js#deathsDoorRollMarker) is this card's roll, which the
 * window claims before the dice and clears as the tier lands, on anything below a 10+ (the move's top, where a
 * +1 buys nothing). The roll is matched by its nonce, which the card is stamped with as it is posted
 * (deaths-door.js#DEATHS_DOOR_ROLL_FLAG), so the card is open from the moment it exists, before the marker
 * names it; or by the card the marker names. Until the marker has the tier, the card's own reading of it
 * stands in, so a 10+ is shut from the first. `actorOf` is the card's speaker by default.
 */
export function deathsDoorAwaitsPlusOnes(message, { actorOf = speakerActor } = {}) {
	if (!message?.id || !isDeathsDoorCard(message)) return false;
	const marker = deathsDoorRollMarker(actorOf(message));
	if (!marker) return false;
	if (marker.messageId !== message.id && marker.nonce !== message.getFlag?.(SYSTEM_ID, DEATHS_DOOR_ROLL_FLAG)) return false;
	return (marker.tier ?? cardTierNow(message, SYSTEM_ID)) !== "success";
}

/** Whether this card is one row's roll in a Struggle as One (struggle-store.js stamps it). PURE. */
export function isStruggleRoll(message, scope = SYSTEM_ID) {
	return !!message?.getFlag?.(scope, STRUGGLE_MESSAGE_FLAG);
}

/** How much of a source's track a helper holds, or 0 when the move has no track (or is not theirs). */
export function heldFor(helper, source, scope = SYSTEM_ID) {
	if (SOURCES[source]?.held) return SOURCES[source].held(helper, scope);
	return learnedTrack(helper, SOURCES[source]?.move)?.held ?? 0;
}

/**
 * Whether `user` is the one who presses a helper's buttons: any logged-in player who owns them, or, with
 * none of those online, the GM. A GM owns every character, and a +1 button for every Judge in the world on
 * every card the GM sees would be clutter; the GM stands in for an absent player. PURE.
 *
 * @param {{id: string, isGM?: boolean}|null} user
 * @param {{id: string, isGM: boolean, active: boolean}[]} owners  as DeathsDoorPrompt.js#ownerUsers lists them
 */
export function actsForHelper(user, owners = []) {
	if (!user?.id || !owners.some(o => o.id === user.id)) return false;
	if (!user.isGM) return true;
	return !owners.some(o => o.active && !o.isGM);
}

/**
 * The +1s this card still offers `user`: one per helper and source, leaving out a source that helper has
 * already used on this roll, a track with nothing held, and a move not learned. PURE apart from reading the
 * actors (and `ownersOf`, which reads the world's users).
 *
 * @param {object} p
 * @param {ChatMessage} p.message
 * @param {Actor|null} p.roller  the character who rolled (utils/speaker-actor.js)
 * @param {Actor[]} p.helpers  characters who might help: the world's, or the one a relayed press names
 * @param {object} p.user
 * @param {(actor: Actor) => object[]} [p.ownersOf]
 * @param {boolean} [p.anyone]  every helper's that someone connected could press for, not just this user's: the
 *   Death's Door window asks whether ANYONE could still add a +1, to know whether to wait on it. A helper with
 *   nobody online who owns them is left out (a GM online owns them all, and stands in for an absent player:
 *   actsForHelper), so the window never waits on a +1 nobody can press.
 * @param {boolean} [p.doorOpen]  the Death's Door window's own word that its card still waits on the tier, for
 *   the moment before its marker says so (deathsDoorAwaitsPlusOnes)
 * @returns {{source: string, helper: Actor, cost: number, held: number}[]}
 */
export function boostOffers({ message, roller, helpers = [], user, ownersOf = ownerUsers, scope = SYSTEM_ID, anyone = false, doorOpen = false }) {
	if (roller?.type !== "character" || !isBoostableRoll(message, scope, { doorOpen })) return [];
	const used = boostsOn(message, scope);
	const struggle = isStruggleRoll(message, scope);
	// This user's helpers first: on a player's client that is their own character, so the item scans
	// below run for one sheet rather than every character in the world, on every render of the card.
	const mine = helpers.filter(h => h?.type === "character" && (anyone ? ownersOf(h).some(o => o.active) : actsForHelper(user, ownersOf(h))));
	const offers = [];
	for (const source of BOOST_SOURCES) {
		const { move, cost, on, held: holds, notInStruggle } = SOURCES[source];
		if (notInStruggle && struggle) continue;
		for (const helper of mine) {
			const own = helper.id === roller.id;
			if ((on === "own" && !own) || (on === "other" && own)) continue;
			if (used.some(b => b.source === source && b.by === helper.uuid)) continue;
			if (!holds && !ownsLearnedMoveNamed(helper, move)) continue;
			const held = cost ? heldFor(helper, source, scope) : 0;
			if (held < cost) continue;
			offers.push({ source, helper, cost, held });
		}
	}
	return offers;
}

/**
 * One +1 button's face, as the card and the Death's Door window both draw it: its label, named for the
 * helper only when this user could press the same source for two of them (`offers`, all they are drawn
 * beside), and its tooltip. PURE apart from the localization.
 */
export function boostButtonFace(offer, offers = []) {
	const label = localize(`${KEY}.button.${offer.source}`);
	const twin  = offers.some(o => o !== offer && o.source === offer.source);
	return {
		label: twin ? format(`${KEY}.buttonFor`, { label, name: offer.helper.name }) : label,
		tip:   format(`${KEY}.tip.${offer.source}`, { name: offer.helper.name, held: offer.held }),
	};
}

/** The line the card prints for one +1 taken: "+1 Diligence (Aeron)". PURE. */
export function boostNote(boost) {
	return format(`${KEY}.note.${boost?.source}`, { name: boost?.name ?? "" });
}

/**
 * Take one +1: its pip off the helper's track (none for Many Hands), the roll's total shifted by one, the
 * card redrawn, and the helper written on the message so the button goes. Run in the card's turn on this
 * client (utils/card-queue.js) and read again there, so two presses cannot both land. Refused when that
 * helper already used that source here, or the track has run dry since the button was drawn.
 *
 * @param {object} deps
 * @param {(roll: Roll, shift: number) => Promise<void>} deps.shiftRoll  stonetop.js#_shiftRoll
 * @param {(flavor: string, total: number, formula: string) => string} deps.cardFlavor  stonetop.js#_shiftRollCardFlavor
 * @param {(message: ChatMessage, total: number) => Promise<void>} [deps.afterShift]
 * @returns {Promise<boolean>} whether the +1 was added
 */
export function takeBoost(message, offer, { shiftRoll, cardFlavor, afterShift = null, scope = SYSTEM_ID } = {}) {
	return inCardTurn(message, async () => {
		const { source, helper } = offer ?? {};
		const def = SOURCES[source];
		if (!def || !helper) return false;
		const used = boostsOn(message, scope);
		if (used.some(b => b.source === source && b.by === helper.uuid)) return false;
		// A Death's Door card whose tier has landed since the button was drawn: a +1 now would change nothing.
		if (isDeathsDoorCard(message) && !deathsDoorAwaitsPlusOnes(message)) return false;
		if (def.cost) {
			const held = heldFor(helper, source, scope);
			if (held < def.cost) return false;
			if (def.spend) await def.spend(helper, scope);
			else await helper.typedActor.moveResources.setUses(def.move, held - def.cost, { stonetopMove: def.move });
		}
		try {
			await writeCardRoll(message, roll => shiftRoll(roll, 1), { cardFlavor, afterShift }, {
				flags: { [scope]: { [BOOSTS_FLAG]: [...used, { source, by: helper.uuid, name: helper.name }] } },
			});
		} catch (err) {
			// The pip is paid back when the +1 never reached the card (the card gone, the write refused). The +1
			// and its name land in ONE write, so a card that names it took it, and a throw after that (the
			// tier effects that follow a new total) keeps the spend.
			if (def.cost && !boostsOn(message, scope).some(b => b.source === source && b.by === helper.uuid)) {
				await refundBoost(helper, source, scope).catch(e => console.error("Stonetop | could not pay back a +1's spend", e));
			}
			throw err;
		}
		return true;
	});
}

/** Give back the pip a +1 spent off its source, for a +1 that never reached the card (one that cost a pip: takeBoost asks). */
async function refundBoost(helper, source, scope = SYSTEM_ID) {
	const def = SOURCES[source];
	if (def.refund) return def.refund(helper, scope);
	await helper.typedActor.moveResources.setUses(def.move, heldFor(helper, source, scope) + def.cost, { stonetopMove: def.move });
}

/** A player's +1 on a card they did not write: the GM's client records it. Whether it was taken. */
async function askGMToBoost(message, offer) {
	return !!(await askGMClient(globalThis.game?.users?.activeGM, BOOST_QUERY, {
		messageId: message.id, source: offer.source, helperUuid: offer.helper.uuid,
		userId: globalThis.game?.user?.id ?? null,
	}, { fallback: false, what: "add a +1 to a roll" }));
}

/**
 * The GM's side of `BOOST_QUERY`: add a player's +1 if the card still offers that source to that helper for
 * the player who asked (read on the GM's client, with the asker as the user). Only the primary GM answers.
 *
 * WHO ASKED is foundry-compat.js#queryAsker's business: v13 names nobody in the context, so the id in the
 * data is read instead, and never taken for a GM's.
 *
 * @returns {Promise<boolean>}
 */
export async function handleBoostQuery(data, context = {}, deps = {}) {
	const { messages = globalThis.game?.messages, users = globalThis.game?.users, resolve = resolveSync,
		rollerOf = speakerActor, ownersOf = ownerUsers, scope = SYSTEM_ID } = deps;
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return false;
	const user = queryAsker(data, context, users);
	const message = messages?.get?.(data?.messageId);
	const helper = data?.helperUuid ? resolve(data.helperUuid) : null;
	if (!user || !message || !helper || !BOOST_SOURCES.includes(data?.source)) return false;
	if (!helper.testUserPermission?.(user, "OWNER")) return false;
	const offer = boostOffers({ message, roller: rollerOf(message), helpers: [helper], user, ownersOf, scope })
		.find(o => o.source === data.source);
	if (!offer) return false;
	return takeBoost(message, offer, { ...deps, scope });
}

/** The world's characters, the helpers a card asks about. */
function worldCharacters() {
	return asArray(globalThis.game?.actors).filter(a => a?.type === "character");
}

/**
 * Press one +1, by the route the card is written by (utils/roll-card-writer.js#rollCardRoute): here, or through
 * the GM's client (BOOST_QUERY). Whether it was taken. The card's own button and the Death's Door window both
 * press here.
 */
export function pressBoost(message, offer, deps, { route = rollCardRoute(message, globalThis.game?.user), scope = SYSTEM_ID } = {}) {
	if (!route || !offer) return Promise.resolve(false);
	return route === "relay" ? askGMToBoost(message, offer) : takeBoost(message, offer, { ...deps, scope });
}

/**
 * The +1s a Death's Door card can still take, for its window (dialogs/DeathsDoorDialog.js#_boostsLeft): `any`,
 * whether anyone at all could add one (the window waits on it: a Judge's player can press theirs on the card),
 * and `mine`, the ones this user presses for their own characters, which the window draws as buttons of its own.
 * Asked with the window's word that the card is still open (`doorOpen`), since its marker may not name it yet.
 *
 * @returns {{any: boolean, mine: {source: string, helper: Actor, cost: number, held: number}[]}}
 */
export function deathsDoorPlusOnes(message, roller, { user = globalThis.game?.user, helpers = worldCharacters(), ownersOf = ownerUsers, scope = SYSTEM_ID } = {}) {
	// One pass over every helper, split after: the window needs both answers, and a second pass would scan
	// this user's helpers twice.
	const all = boostOffers({ message, roller, helpers, ownersOf, scope, doorOpen: true, anyone: true });
	return { any: all.length > 0, mine: all.filter(o => actsForHelper(user, ownersOf(o.helper))) };
}

/**
 * `updateActor`: a Death's Door roll's marker moved (deaths-door.js#DEATHS_DOOR_ROLLING_FLAG), so the Door
 * cards of that character redraw on this client: one now waiting on its tier gains its +1 buttons, and one whose
 * tier has landed loses them. The marker is written with `render: false`, and a card only redraws when IT
 * changes, so nothing else would. The latest few cards only: the roll's card is always among them.
 */
export function onUpdateActorDoorPlusOnes(actor, changes, { messages = globalThis.game?.messages, redraw = m => globalThis.ui?.chat?.updateMessage?.(m) } = {}) {
	if (actor?.type !== "character") return;
	const flags = changes?.flags?.[SYSTEM_ID] ?? {};
	if (!(DEATHS_DOOR_ROLLING_FLAG in flags) && !(`-=${DEATHS_DOOR_ROLLING_FLAG}` in flags)) return;
	for (const message of asArray(messages).slice(-DOOR_CARD_REDRAW_DEPTH)) {
		// Not a card this client has not drawn: core's updateMessage would post it at the foot of the log.
		if (!message?.logged || !isDeathsDoorCard(message) || speakerActor(message)?.id !== actor.id) continue;
		try { redraw(message); } catch { /* the log is not drawn on this client */ }
	}
}

// How far back through the chat log onUpdateActorDoorPlusOnes looks for a Door card to redraw.
const DOOR_CARD_REDRAW_DEPTH = 30;

/** Name each +1 taken in the card's Conditions row, making the row when the roll had none. */
function drawBoostNotes(card, boosts) {
	if (!boosts.length) return;
	const pills = boosts.map(b => `<li class="stonetop-condition-note stonetop-roll-boost-note">${escHtml(boostNote(b))}</li>`).join("");
	const list = card.querySelector(".stonetop-roll-conditions ul");
	if (list) { list.insertAdjacentHTML("beforeend", pills); return; }
	const row = `<div class="row row--border conditions stonetop-roll-conditions">
		<h3 class="cell__subtitle">${escHtml(localize(`${KEY}.conditionsHeading`))}</h3>
		<ul>${pills}</ul>
	</div>`;
	const before = card.querySelector(".stonetop-roll-actions, .stonetop-card-buttons");
	if (before) before.insertAdjacentHTML("beforebegin", row);
	else card.querySelector(".cell--chat")?.insertAdjacentHTML("beforeend", row);
}

/**
 * Put the +1 buttons on a roll card and name the +1s already taken. Drawn every render, from the flag.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 * @param {object} deps  what takeBoost needs to shift the roll (see there)
 */
export function wireRollBoosts(message, html, deps, { user = globalThis.game?.user, scope = SYSTEM_ID } = {}) {
	const card = html?.querySelector?.(".stonetop-roll-card");
	// The +1s already taken stay on the card for good; what is still on offer is boostOffers' to say.
	if (!card || !isBoostableCard(message, scope)) return;
	drawBoostNotes(card, boostsOn(message, scope));

	const row = card.querySelector(".stonetop-card-buttons");
	const route = row ? rollCardRoute(message, user) : null;
	if (!route) return;
	const offers = boostOffers({ message, roller: speakerActor(message), helpers: worldCharacters(), user, scope });
	for (const offer of offers) {
		const face = boostButtonFace(offer, offers);
		const button = document.createElement("button");
		button.type = "button";
		button.className = `stonetop-roll-boost-btn stonetop-roll-boost-btn--${offer.source}`;
		button.textContent = face.label;
		button.dataset.tooltip = face.tip;
		button.dataset.tooltipDirection = "UP";
		button.addEventListener("click", async () => {
			if (button.disabled) return;
			button.disabled = true;
			try {
				const taken = await pressBoost(message, offer, deps, { route, scope });
				if (!taken) {
					globalThis.ui?.notifications?.warn(localize(`${KEY}.refused`));
					button.disabled = false;
				}
			} catch (err) {
				console.error("Stonetop | adding +1 to a roll failed", err);
				button.disabled = false;
			}
		});
		row.appendChild(button);
	}
	if (offers.length) row.style.display = "flex";
}

/**
 * Commune with Aratis's 10+: "you also hold 2 Sanction". Fills the track, as the pips count what is held
 * (MoveResources#setUses). Whether it filled anything.
 *
 * @returns {Promise<boolean>}
 */
export async function holdSanctionOnHit(actor, item, tier) {
	if (item?.name !== COMMUNE_WITH_ARATIS || tier !== "success") return false;
	const track = sanctionTrack(actor);
	if (!track || track.held >= track.max) return false;
	await track.resources.setUses(COMMUNE_WITH_ARATIS, track.max, { stonetopMove: COMMUNE_WITH_ARATIS });
	return true;
}

/** The Sanction track, `{held, max, resources}`, or null for a character without Commune with Aratis learned. */
export function sanctionTrack(actor) {
	return learnedTrack(actor, COMMUNE_WITH_ARATIS);
}

/**
 * Take back Sanction a 10+ filled, when the card is moved off it (actors/character/tier-effects.js): never
 * below none, so Sanction spent since is not taken twice. How many came off.
 *
 * @returns {Promise<number>}
 */
export function releaseSanction(actor, count) {
	return takeBackHeld(actor, COMMUNE_WITH_ARATIS, count);
}

// -- Piety's Blessing ---------------------------------------------------------------------------------

/** How many pips Piety's track has for this character: 0 unless they have the move learned. */
function pietyMax(actor) {
	if (!ownsLearnedMoveNamed(actor, PIETY)) return 0;
	return Math.trunc(Number(ownedMove(actor, PIETY)?.system?.resource?.max) || 0);
}

/**
 * Whether a character holds Piety's Blessing, as 1 or 0: on Piety's pip when they have the move learned,
 * or on the `blessing` flag when they worshipped beside a Lightbearer. Never 2 (see holdBlessing).
 */
export function blessingHeld(actor, scope = SYSTEM_ID) {
	if (actor?.getFlag?.(scope, BLESSING_FLAG)) return 1;
	const max = pietyMax(actor);
	return max && heldOnTrack(actor?.typedActor?.moveResources, PIETY, max) > 0 ? 1 : 0;
}

/**
 * Hold 1 Blessing: on Piety's pip for a character with Piety learned, where their player can see it, and
 * on the flag for anyone else. A character who holds one already holds 1 still: worshipping twice does
 * not stack. Whether anything was written.
 */
export async function holdBlessing(actor, scope = SYSTEM_ID) {
	if (actor?.type !== "character") return false;
	const max = pietyMax(actor);
	const resources = actor.typedActor?.moveResources;
	if (max && resources) {
		if (heldOnTrack(resources, PIETY, max) > 0) return false;
		await resources.setUses(PIETY, 1, { stonetopMove: PIETY });
		// One kept on the flag from before they had Piety moves onto the pip, so there is only ever one.
		if (actor.getFlag?.(scope, BLESSING_FLAG)) await actor.unsetFlag(scope, BLESSING_FLAG);
		return true;
	}
	if (actor.getFlag?.(scope, BLESSING_FLAG)) return false;
	await actor.setFlag(scope, BLESSING_FLAG, true);
	return true;
}

/** Spend the Blessing: the pip unticked and the flag cleared, wherever it was held. Whether one was. */
export async function spendBlessing(actor, scope = SYSTEM_ID) {
	let spent = false;
	const max = pietyMax(actor);
	const resources = actor?.typedActor?.moveResources;
	if (max && resources && heldOnTrack(resources, PIETY, max) > 0) {
		await resources.setUses(PIETY, 0, { stonetopMove: PIETY });
		spent = true;
	}
	if (actor?.getFlag?.(scope, BLESSING_FLAG)) {
		await actor.unsetFlag(scope, BLESSING_FLAG);
		spent = true;
	}
	return spent;
}

/**
 * "Other faithful PCs who partake in this worship also hold 1 Blessing": each of `targets` holds 1.
 * Written here for a character this client owns. The rest go to the GM's client in one query
 * (BLESSING_QUERY), since a Lightbearer's player cannot write another player's character.
 *
 * @returns {Promise<{blessed: Actor[], missed: Actor[]}>}  who holds a Blessing now, and who could not
 *   be reached (no GM online to write it)
 */
export async function shareBlessing(lightbearer, targets, {
	scope = SYSTEM_ID, gm = globalThis.game?.users?.activeGM ?? null, userId = globalThis.game?.user?.id ?? null,
} = {}) {
	const { given, missed } = await shareHold(lightbearer, targets, {
		hold: target => holdBlessing(target, scope),
		relay: relayed => askGMClient(gm, BLESSING_QUERY, {
			lightbearerUuid: lightbearer?.uuid ?? null, targetUuids: relayed.map(t => t.uuid), userId,
		}, { fallback: [], what: "give a Blessing" }),
	});
	return { blessed: given, missed };
}

/**
 * The GM's side of `BLESSING_QUERY`: each named character holds 1 Blessing, if the player who asked plays
 * the Lightbearer and that Lightbearer has Piety learned. Only the primary GM answers. Who asked is read
 * as handleBoostQuery reads it (foundry-compat.js#queryAsker).
 *
 * @returns {Promise<string[]>}  the uuids of the characters who hold a Blessing now
 */
export async function handleBlessingQuery(data, context = {}, deps = {}) {
	const { users = globalThis.game?.users, resolve = resolveSync, scope = SYSTEM_ID } = deps;
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return [];
	const user = queryAsker(data, context, users);
	const lightbearer = data?.lightbearerUuid ? resolve(data.lightbearerUuid) : null;
	if (!user || !lightbearer?.testUserPermission?.(user, "OWNER") || !ownsLearnedMoveNamed(lightbearer, PIETY)) return [];
	return holdForEach(lightbearer, data?.targetUuids, target => holdBlessing(target, scope), resolve);
}
