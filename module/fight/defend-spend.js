// Spending Defend's Readiness on a blow, from the damage card that carries it.
//
// DEFEND (Book I p.216): "You can spend Readiness 1-for-1 to: suffer an attack's damage/effects instead of
// your ward; halve an attack's effect or damage; draw all attention from your ward to yourself; strike back
// at an attacker (deal your damage, with disadvantage)." Two of those four change a number the damage card
// is about to write, so the card offers them while the damage is still owed:
//  • HALVE IT: "Halving an attack's damage/effects reduces the damage before applying armor", rounded up
//    like every halving in the book.
//  • TAKE IT FOR THEM: the defender takes the blow in the ward's place, against the defender's own armor.
// "Players can spend Readiness multiple times in response to a single attack, but can only pick each option
// once against any given attack", so each is offered once per blow. Strike back is a damage roll of its own
// (the fight ring's button); drawing attention is fiction, and the GM's to play.
//
// PLAYBOOK MOVES CHANGE THE SPENDS, and the card follows the defender's sheet (owns-move.js#ownsLearnedMoveNamed):
//  • PARRY & RIPOSTE (Fox): "spend 1 Readiness to both halve an attack's effects/damage and strike back at
//    the attacker (deal your damage with disadvantage), instead of spending 1 Readiness for each." One more
//    button, which halves the blow and rolls the strike back at whoever struck it. With SECOND INTENT it
//    also puts the Ambush list in front of them: "also pick 1 option from the Ambush list", and offers its
//    "Deal +1d4 damage" on the strike back's own damage window. Whether the weapon is one "you can wield
//    quickly" is the table's to say.
//  • STEADFAST GUARDIAN (Heavy): "While you hold Readiness (from Defend), you can always suffer the
//    damage/effects of an attack instead of your ward; no need to spend Readiness". Taking it for them is
//    free, for as long as they hold any.
//  • A MIGHTY RAMPART (Judge): "you can spend 1 Readiness to completely ignore the effects/damage of an
//    attack that you suffer". Offered to whoever will take the blow: the one hit, or the defender who took
//    it for them.
//  • I GET KNOCKED DOWN (Would-Be Hero): "When you take damage despite your best efforts to avoid it, you
//    can choose to halve the damage but pick 1 of the following". The ONE spend here that costs no
//    Readiness — its price is the pick, which is asked before the halving is written and said out loud on
//    the card. With BUT I GET UP AGAIN it also writes down who dealt it, and that foe then owes the
//    character advantage and +1d4 (fight/hero-moves.js). Offered to whoever takes the blow: a Would-Be
//    Hero who stood in for someone may use it (the user's ruling), their ward may not. NOT on a move's own
//    price the character chose to pay (Iron Will's 1d4, combat/attack-flow.js#rollOptionDamage marks it
//    `ownPrice`): that is no blow they tried to avoid.
//  • NEVER GONNA KEEP ME DOWN (Would-Be Hero): "When you have 5 or fewer current HP, you impose disadvantage
//    on any damage you take." The blow's roll was settled by whoever it was aimed at, so a Would-Be Hero who
//    stands in for them afterwards (the user's ruling) is offered the disadvantage on the card: the row's
//    own formula rolled again, the lower of the two kept (a row rolled at advantage is rolled again
//    straight instead: the two cancel). Not on a row already rolled at disadvantage (its formula keeps the
//    lowest, `kl`), once per row, and like I Get Knocked Down it costs no Readiness.
//  • SAFETY FIRST (Seeker): "When you are affected by harmful magic, spend 1 Protection either to gain
//    advantage on any roll to resist it or to halve its damage/effects." The halving is offered to whoever
//    suffers the blow while they hold Protection (the user's ruling, 2026-09-26), priced in Protection, not
//    Readiness. Whether the blow is harmful magic is the table's to say, so the button says so. The
//    advantage half is a roll-window line (StonetopCharacter.js's FICTION_ROLL_OFFERS).
//  • MIRRORSHIELD (Judge, Book I p.119): "When you Defend with a shield, you can spend 1 Readiness to intercept
//    a magical force and redirect it to a different target (or none)." LIGHTNING ROD (Blessed, p.106): "When
//    you Defend while touching the earth, you can spend 1 Readiness to intercept a nearby magical attack and
//    redirect it harmlessly into the ground." Offered to whoever could spend Readiness on the blow, as a
//    halving is; the blow then lands on nobody here (where Mirrorshield sends it is the table's, and is rolled
//    at them as its own blow). Whether the blow is magical, and whether the Blessed is touching the earth,
//    is the table's to say, so the button says so; the shield is checked when the Judge presses it.
//  • AMULETS & TALISMANS (Blessed, Book I p.106): "When they would suffer such harm while bearing your charm, roll
//    +INT: on a 10+, they ignore the harm entirely; on a 7-9, they suffer only half the damage or effect; on a
//    6-, they suffer the harm normally." A Charm spend on the BEARER's row (the user's ruling, 2026-10-23), offered
//    to whoever may roll for the Blessed who crafted it: their player, or a GM. Pressing it rolls the Blessed's
//    +INT, and the card records the tier: a 10+ voids the blow, a 7-9 halves it (before armor, rounded up, as
//    Defend's halving). Whether this blow is the harm the charm names is the table's to say, so the button names
//    it. Only once the card has recorded the spend does the charm lose its potency (blessed-marks.js#charmSpentByRoll)
//    on the Blessed's own sheet: a spend the card refuses (two presses at once, a blow mid-apply) uses nothing up.
//  • FRONT LINE LEADER (Marshal, Book I p.126): "Spend Presence ... as Readiness (as if you Defended them)".
//    A blow on the Marshal's crew (the NPC that stands for their crew card) is offered to the Marshal to
//    halve or to take for them, paid in Presence rather than Readiness (`purse: "presence"` on the offer and
//    on the spend it records), while they hold any (actors/character/front-line-presence.js). The crew
//    being led into battle is what put the Presence there, so no nearness is asked beyond that.
//
// WHO MAY DEFEND. The one hit, when they hold Readiness, can halve their own blow; any character in the
// fight standing beside them (touching, or fighting the same foe) who holds Readiness can do either. So can
// a follower holding Readiness from an ordered Defend (p.469), kept on their card. "They
// can't interrupt an attack that they can't perceive, or strike back at a foe that's out of reach", which is
// why it is the people standing there. Pressed by anyone who can record the spend on the card (its author,
// or the one GM who acts), for a defender they may write: a player cannot spend another player's Readiness.
// Not by whoever may press Apply: the ward's player applies their own blow, and an ally or the GM spends on it.
//
// A CARD THE GM WROTE (a monster's blow, a counter-attack) cannot be written by a player, so a player's
// spend on it is recorded by the GM's client (SPEND_QUERY), which checks the asker owns the defender. A
// parry's strike back is still rolled on the player's own screen; only its Readiness and the halving go
// through the GM, once that roll is settled.

import { SYSTEM_ID } from "../system-id.js";
import { isFightTabEnabled } from "../settings.js";
import { format, localize } from "../utils/i18n.js";
import { escHtml, stripHtmlToText } from "../utils/strings.js";
import { stonetopChatCard, firstOptionList, multiDieFaces } from "../utils/chat.js";
import { damageRowActor } from "../utils/damage.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { contentElement } from "../utils/dialogv2-content.js";
import { spendHeldReadiness as spendReadiness, readinessHeldBy as heldReadiness } from "./follower-readiness.js";
import { ownsLearnedMoveNamed, ownsLearnedBookMoveNamed, ownedLearnedBookMove } from "../actors/character/owns-move.js";
import { learnedTrack, takeBackHeld } from "../actors/character/MoveResources.js";
import { presenceKeeperFor, presenceHeld, spendPresence } from "../actors/character/front-line-presence.js";
import { followerCardMemo } from "../actors/character/follower-masters.js";
import { touching, HEROES } from "./engagements.js";
import { combatantSide, engagementFor, fightersOf, fightOnScene, gridOf } from "./fight-state.js";
import { HERO_MOVES, recordKnockedDownBy, neverGonnaNow } from "./hero-moves.js";
import { rollerEngagement, asTarget } from "./damage-seed.js";
import { askWhoItHits } from "./fight-targets.js";
import { rolledAtDisadvantage, rolledAtAdvantage, straightFormula, classifyResult } from "../utils/roll-engine.js";
import { AMULETS_TALISMANS, BLESSED_MARKS_FLAG, blessedMarkRows, markIsOn, markKindKey, charmSpentByRoll, worldMarkScan } from "../actors/character/blessed-marks.js";
import { carerStockAnswerer } from "../actors/character/healers-arts.js";
import { spendOrAskOwner, answerOwnerAsk, gmAnswersNote } from "../utils/owner-ask.js";
import { DIE_FLAG as INSPIRATION_DIE_FLAG } from "../actors/character/inspiration-flow.js";
import { giveAdvantageButtonHtml } from "../actors/character/give-advantage.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { inCardTurn } from "../utils/card-queue.js";
import { askGMClient, resolveSync, queryAsker } from "../utils/foundry-compat.js";
import { NO_ANSWER, relayOutcome } from "../utils/relay-landed.js";

const KEY = "stonetop.fight.defend";
const HERO_KEY = "stonetop.fight.heroMoves";

// spendReadiness (follower-readiness.js#spendHeldReadiness, for the fight ring too): take `cost` Readiness off a
// character, or off a follower's card, refused when less is held. A follower ordered to Defend spends on Defend's own
// terms (p.469), so every spend here is theirs too. heldReadiness (readinessHeldBy): what a defender holds.
export { spendReadiness };

/** Halve a blow, rounded up (p.216; the book's halvings round up). */
export const halveDamage = raw => Math.ceil(Math.max(0, Number(raw) || 0) / 2);

/**
 * The kinds of spend a card can offer, in the order its buttons stand: `list`, which list on the
 * card's flag records one (spentOn reads them back), `free`, a kind that costs no Readiness (I
 * Get Knocked Down is paid for in the fiction; Safety First in Protection), and `bySufferer`, a kind
 * that is the sufferer's own move, so its spend says whose it was (`by`) and is once per blow PER
 * SPENDER (takeSpend). `voids` marks a kind that takes the whole blow off the row (spentOn's `voided`),
 * naming the words Apply says it in, and `note` is the words the card says a spend in (defendNotes):
 * a key under `stonetop.fight.defend`, or one picked by the spend. A new kind is one row here, its
 * offers in defendOffers and its words in the lang file.
 */
const SPEND_KINDS = {
	halve:       { list: "halvedBy", note: "noteHalve" },
	parry:       { list: "halvedBy", note: "noteParry" },
	standIn:     { list: "standIns", note: spend => (spend.free ? "noteStandInFree" : "noteStandIn") },
	ignore:      { list: "ignoredBy", note: "noteIgnore", voids: "ignoredLine" },
	knockedDown: { list: "knockedDownBy", note: "noteKnockedDown", free: true, bySufferer: true },
	neverGonna:  { list: "neverGonnaBy", note: spend => (spend?.straight ? "noteNeverGonnaStraight" : "noteNeverGonna"), free: true },
	safetyFirst: { list: "safetyFirstBy", note: "noteSafetyFirst", free: true },
	// Amulets & Talismans: free of Readiness, its price is the charm itself. What it did is the tier the Blessed
	// rolled, kept on the spend (spentOn reads a 10+ as void, a 7-9 as halved).
	charm:       { list: "charmedBy", note: spend => CHARM_NOTE[spend?.tier] ?? "noteCharmMiss", free: true },
	redirect:    { list: "redirectedBy", note: "noteRedirect", voids: "redirectedLine" },
};

/** A charm's roll, by tier, as the card says it. */
const CHARM_NOTE = Object.freeze({ success: "noteCharmIgnore", partial: "noteCharmHalve", failure: "noteCharmMiss" });

/** The tiers a charm spend can record. */
const CHARM_TIERS = new Set(Object.keys(CHARM_NOTE));

/**
 * The charms a bearer wears, as `{blessed, mark}`: every Blessed with Amulets & Talismans learned whose roster has a
 * charm row on them, by document (the trailing actor id, as marked-people.js folds it) or, for a row laid on a
 * name alone, by that name. PURE apart from reading the actors.
 *
 * @param {Actor|null} bearer
 * @param {Iterable<Actor>} [actors]  the world's actors
 */
export function charmsOn(bearer, actors = globalThis.game?.actors ?? []) {
	return charmsAmong(bearer, charmMakers(actors));
}

/** Every charm row laid by a Blessed with Amulets & Talismans learned, as `{blessed, row}`. */
const charmMakers = actors => [...blessedMarkRows(actors, "charm", AMULETS_TALISMANS)];

/** The charms on `bearer` among the rows already gathered (charmMakers). */
function charmsAmong(bearer, makers) {
	if (!bearer) return [];
	return makers.filter(({ blessed, row }) => blessed !== bearer && markIsOn(row, bearer))
		.map(({ blessed, row }) => ({ blessed, mark: row }));
}

// The world's charm makers, kept between renders with the other mark scans (blessed-marks.js#worldMarkScan):
// every card still owing damage asks for them on each of its renders, and nearly always nobody has laid a charm.
const worldCharmMakers = actors => worldMarkScan("charm", charmMakers, actors);

/** charmsOn for a whole card: the charm makers are gathered once, on the first bearer asked about. */
function charmsMemo(actors = globalThis.game?.actors ?? []) {
	let makers = null;
	return bearer => (bearer ? charmsAmong(bearer, makers ??= worldCharmMakers(actors)) : []);
}

/** The harm a charm wards against, as the button says it: its note, and Potent Workings' second harm. */
function charmHarm(mark) {
	const harms = [String(mark?.note ?? "").trim(), String(mark?.extraHarm ?? "").trim()].filter(Boolean);
	return harms.length ? harms.join(" or ") : localize(`${KEY}.charmAnyHarm`);
}

/** The moves that turn a magical blow aside for 1 Readiness, in the order a defender holding both is offered them. */
const REDIRECT_MOVES = [HERO_MOVES.MIRRORSHIELD, HERO_MOVES.LIGHTNING_ROD];
const isSpendKind = kind => Object.hasOwn(SPEND_KINDS, kind);
const costsReadiness = kind => !SPEND_KINDS[kind]?.free;

/** An offer (or a spend recorded off one) paid in Front Line Leader's Presence rather than Readiness. */
const paysPresence = offer => offer?.purse === "presence";

/** Whether the defender can still pay for this spend: Presence held for a Presence offer, else its Readiness. */
function canPay(kind, offer, cost) {
	if (paysPresence(offer)) return presenceHeld(offer.defender) > 0;
	return !costsReadiness(kind) || heldReadiness(offer.defender) >= Math.max(1, cost);
}

/**
 * What the spends on a card have settled so far, by row uuid: the blows halved (a halving or a parry),
 * the ones a defender took in the ward's place, and the ones VOIDED, which land on nobody at all: A Mighty
 * Rampart's ignored blow and Mirrorshield's or Lightning Rod's redirected magic, each with the words Apply
 * says it in (`lineKey`) and the move that did it (`move`, for a redirect). PURE.
 *
 * @param {object} damage  the card's damage flag
 * @returns {{halved: Set<string>, standIns: Map<string, object>, voided: Map<string, {lineKey: string, move: string}>}}
 */
export function spentOn(damage) {
	const spent = kind => (damage?.[SPEND_KINDS[kind].list] ?? []);
	const uuids = kind => new Set(spent(kind).map(spend => spend.uuid));
	const standIns = new Map(spent("standIn").map(spend => [spend.uuid, spend]));
	const voided = new Map();
	for (const [kind, { voids }] of Object.entries(SPEND_KINDS)) {
		if (!voids) continue;
		for (const spend of spent(kind)) {
			if (!voided.has(spend.uuid)) voided.set(spend.uuid, { lineKey: `${KEY}.${voids}`, move: spend.move ?? "" });
		}
	}
	// A charm wards its bearer only: once someone else stands in and takes the blow, the ward's charm no longer
	// reaches it, and the stand-in may roll their own. A spend written before `bearerUuid` was kept counts as before.
	const charms = spent("charm").filter(spend => !spend.bearerUuid || !standIns.has(spend.uuid) || spend.bearerUuid === standIns.get(spend.uuid).by);
	// A charm's 10+: "they ignore the harm entirely".
	for (const spend of charms) {
		if (spend.tier === "success" && !voided.has(spend.uuid)) voided.set(spend.uuid, { lineKey: `${KEY}.charmIgnoredLine`, move: spend.move ?? AMULETS_TALISMANS });
	}
	return {
		halved: uuids("halve"),
		standIns,
		voided,
		// I Get Knocked Down halves as Readiness does, from its own list: it is a different move with a
		// different price, and "each option once against any given attack" counts them apart. And only for
		// whoever it was spent by, while they still take the blow: a ward who used it and then had someone
		// stand in for them no longer takes it, so their halving does not follow the blow onto the
		// stand-in. A spend written before `by` was kept counts as it always did.
		knockedDown: new Set(spent("knockedDown")
			.filter(spend => !spend.by || !standIns.has(spend.uuid) || spend.by === standIns.get(spend.uuid).by)
			.map(spend => spend.uuid)),
		// Safety First's halving the same way: its own move, paid in Protection.
		safetyFirst: uuids("safetyFirst"),
		// The rows a stand-in's Never Gonna Keep Me Down rolled again: once per row, its number already
		// written onto the row (takeSpend), so nothing at apply time reads it.
		neverGonna: uuids("neverGonna"),
		// A charm's 7-9: "they suffer only half the damage or effect", its own halving beside Defend's.
		charmHalved: new Set(charms.filter(spend => spend.tier === "partial").map(spend => spend.uuid)),
		// Every row a charm was rolled for by whoever takes the blow now, whatever it came to: one charm at a
		// time, once per blow per bearer.
		charmed: new Set(charms.map(spend => spend.uuid)),
	};
}

/** Whether a formula has a die in it to roll again. PURE. */
const hasDie = formula => /\d*d\d+/i.test(String(formula ?? ""));

/**
 * The token a damage row's target stands as: its one token on the canvas scene, else the one it fights
 * as. The GM's client answering a player's spend (handleSpendQuery) may be looking at another scene.
 */
export function rowToken(doc, { scene = globalThis.canvas?.scene ?? null, combats = globalThis.game?.combats } = {}) {
	if (doc?.documentName === "Token") return doc;
	if (!doc) return null;
	const tokens = (doc.getActiveTokens?.(false, true) ?? []).filter(t => t?.parent?.id === scene?.id);
	if (tokens.length) return tokens.length === 1 ? tokens[0] : null;
	const fought = [];
	for (const combat of combats ?? []) {
		for (const c of fightersOf(combat)) {
			if (c.actorId === doc.id && c.token && !fought.includes(c.token)) fought.push(c.token);
		}
	}
	return fought.length === 1 ? fought[0] : null;
}


/**
 * With the Fight tab off: everyone else on the heroes' side of a Combat the one hit stands in (fight-state.js
 * #combatantSide, which reads an unstamped combatant as the tab would), once each, never the one hit nor a
 * defeated combatant. None when the one hit is no hero there, or stands in no fight (fight-state.js#fightersOf:
 * never the old Introductions' tokenless roster Combat, which holds every PC). PURE apart from the reads.
 *
 * @param {Actor|null} target  the row's actor
 * @param {object|null} doc  what the row's uuid resolved to (a token, or an actor)
 */
export function combatAlliesOf(target, doc, { combats = globalThis.game?.combats } = {}) {
	if (!target) return [];
	const isHit = c => (doc?.documentName === "Token" && (c.tokenId === doc.id || c.token?.id === doc.id))
		|| (c.actor ?? null) === target;
	const allies = [];
	for (const combat of combats ?? []) {
		const all = fightersOf(combat);
		const hit = all.find(isHit);
		if (!hit || combatantSide(hit) !== HEROES) continue;
		for (const c of all) {
			const actor = c.actor ?? null;
			if (!actor || c === hit || actor === target || c.isDefeated || combatantSide(c) !== HEROES) continue;
			if (!allies.includes(actor)) allies.push(actor);
		}
	}
	return allies;
}

/**
 * Who could spend Readiness on the blow a row owes: the one hit, and the characters standing by them.
 *
 * @param {string} uuid  the row's target
 * @param {object} [p]
 * @param {Function} [p.cardFor]  finds a follower's card (defendOffers hands in one followerCardMemo per pass)
 * @returns {{self: Actor|null, allies: Actor[]}}  those holding Readiness this reader may write
 */
function defendersFor(uuid, { user = globalThis.game?.user, cardFor } = {}) {
	const doc = resolveSync(uuid);
	const target = damageRowActor(doc);
	const writable = actor => !!actor && (user?.isGM || actor.isOwner) && heldReadiness(actor, { cardFor }) > 0;
	const self = writable(target) ? target : null;
	const allies = [];
	// THE FIGHT TAB OFF: no engagements to read, so the people standing by are everyone on the heroes' side of the
	// same Combat (the user's ruling, 2026-10-23). The table says whether they were close enough, as it does for
	// every spend that "makes sense" (p.216).
	if (!isFightTabEnabled()) {
		for (const actor of combatAlliesOf(target, doc)) {
			if (writable(actor) && !allies.includes(actor)) allies.push(actor);
		}
		return { self, allies };
	}
	const token = rowToken(doc);
	// Drawn on every render of every card still owing damage, and most of the time nobody holds any
	// Readiness at all: the fight is only worked out when somebody else in it could spend some.
	const combatants = [...(fightOnScene(token?.parent ?? null)?.combatants ?? [])];
	const anyAlly = combatants.some(c => c.actor !== target && writable(c.actor));
	const found = anyAlly ? engagementFor(token) : null;
	if (found) {
		const me = found.fighters.find(f => f.id === found.combatant.id);
		if (me?.side === HEROES) {
			const grid = gridOf(found.scene);
			const myFoes = new Set(found.entry.melee);
			for (const fighter of found.fighters) {
				if (fighter.id === me.id || fighter.side !== HEROES || fighter.out) continue;
				const theirs = found.result.byFighter[fighter.id]?.melee ?? [];
				if (!touching(me, fighter, grid) && !theirs.some(id => myFoes.has(id))) continue;
				const actor = found.combatants.get(fighter.id)?.actor ?? null;
				if (writable(actor) && actor !== target && !allies.includes(actor)) allies.push(actor);
			}
		}
	}
	return { self, allies };
}


/**
 * The spends a card still offers: one entry per blow and defender, for each option, leaving out an option
 * already taken on that blow. Each carries what it costs: a Steadfast Guardian takes a blow for nothing.
 * PURE apart from `defendersOf` and `resolveActor`.
 *
 * @param {object} damage  the card's damage flag
 * @param {(uuid: string, p: {cardFor: Function}) => {self: Actor|null, allies: Actor[]}} [defendersOf]
 * @param {(uuid: string) => Actor|null} [resolveActor]  a stand-in's actor, from the uuid on the card
 * @param {(actor: Actor, p: {cardFor: Function}) => Actor|null} [presenceOf]  whose Front Line Leader Presence guards the one hit
 * @param {(bearer: Actor|null) => Array<{blessed: Actor, mark: object}>} [charmsOf]  the charms the one suffering the blow wears
 * @returns {{halve: object[], parry: object[], standIn: object[], ignore: object[]}}
 */
export function defendOffers(damage, defendersOf = defendersFor, resolveActor = uuid => damageRowActor(resolveSync(uuid)), presenceOf = presenceKeeperFor, charmsOf = charmsMemo()) {
	const done = new Set((damage?.applied ?? []).map(a => a.uuid));
	const { halved, standIns, voided, knockedDown, safetyFirst, neverGonna, charmed } = spentOn(damage);
	const offers = { halve: [], parry: [], standIn: [], ignore: [], knockedDown: [], neverGonna: [], safetyFirst: [], redirect: [], charm: [] };
	const user = globalThis.game?.user;
	// Whose follower card each NPC is, searched once per NPC for the whole pass rather than once per row and
	// question: the Readiness a follower holds and the Presence guarding a crew are both read off it.
	const cardFor = followerCardMemo();
	// "Despite your best efforts to avoid it": a move's own price the character chose to pay is not such a
	// blow, so I Get Knocked Down is not offered on it. A counter-attack is selfHarm too, and keeps it.
	const ownPrice = !!(damage?.selfHarm && damage?.ownPrice);
	// Which of the two redirecting moves each defender would spend, asked once per defender rather than once per
	// row they stand by: this is drawn on every render of every card still owing damage.
	const redirects = new Map();
	const redirectOf = defender => {
		const key = defender.uuid ?? defender;
		if (!redirects.has(key)) redirects.set(key, REDIRECT_MOVES.find(name => ownsLearnedMoveNamed(defender, name)) ?? null);
		return redirects.get(key);
	};
	for (const row of damage?.results ?? []) {
		if (!row?.uuid || done.has(row.uuid) || voided.has(row.uuid)) continue;
		const hit = resolveActor(row.uuid);
		// Whoever will suffer the blow: the defender who took it, or the one it was aimed at.
		const standIn = standIns.get(row.uuid);
		const stoodIn = standIn ? resolveActor(standIn.by) : null;
		// I Get Knocked Down needs no Readiness, so it is offered to whoever takes the blow whether or not
		// they hold any: the whole point of the move, and why it cannot come from `defendersFor`. "When YOU
		// take damage": a Would-Be Hero who stood in for someone may use it (the user's ruling), and the
		// ward they stood in for, who no longer takes the blow, may not.
		if (!ownPrice && !knockedDown.has(row.uuid)) {
			const sufferer = standIn ? stoodIn : hit;
			if (sufferer && (user?.isGM || sufferer.isOwner || !user) && ownsLearnedMoveNamed(sufferer, HERO_MOVES.KNOCKED_DOWN)) {
				offers.knockedDown.push({ row, defender: sufferer, cost: 0 });
			}
		}
		// Never Gonna Keep Me Down, to a Would-Be Hero who stood in at 5 or fewer current HP: the roll was the
		// ward's, so the disadvantage they impose is owed now, once, on a row not already rolled at it.
		if (stoodIn && !neverGonna.has(row.uuid) && !rolledAtDisadvantage(row) && hasDie(row.formula)
			&& (user?.isGM || stoodIn.isOwner || !user) && neverGonnaNow(stoodIn)) {
			offers.neverGonna.push({ row, defender: stoodIn, cost: 0 });
		}
		const { self, allies } = defendersOf(row.uuid, { cardFor });
		// Mirrorshield and Lightning Rod, by whoever could spend Readiness on this blow: one offer per defender,
		// under the first of the two moves they hold.
		for (const defender of [self, ...allies].filter(Boolean)) {
			const move = redirectOf(defender);
			if (move) offers.redirect.push({ row, defender, cost: 1, move });
		}
		if (!halved.has(row.uuid)) {
			for (const defender of [self, ...allies].filter(Boolean)) {
				offers.halve.push({ row, defender, cost: 1 });
				// The book's Parry & Riposte: a player's own move of that name acts as itself (owns-move.js#bookMoveName).
				if (ownsLearnedBookMoveNamed(defender, HERO_MOVES.PARRY)) offers.parry.push({ row, defender, cost: 1 });
			}
		}
		if (!standIns.has(row.uuid)) {
			for (const defender of allies) offers.standIn.push({ row, defender, cost: ownsLearnedMoveNamed(defender, HERO_MOVES.STEADFAST) ? 0 : 1 });
		}
		// Front Line Leader: a blow on the crew, still theirs to take, and their Marshal holding Presence spends
		// it as Readiness, as if they had Defended them: to halve it, or to take it in their place.
		const keeper = !standIn && hit ? presenceOf(hit, { cardFor }) : null;
		if (keeper && (user?.isGM || keeper.isOwner || !user)) {
			if (!halved.has(row.uuid)) offers.halve.push({ row, defender: keeper, cost: 1, purse: "presence" });
			offers.standIn.push({ row, defender: keeper, cost: 1, purse: "presence" });
		}
		const sufferer = standIn ? stoodIn : self;
		const mayWrite = !!sufferer && (user?.isGM || sufferer.isOwner || !user);
		// The move asked first: it is the cheaper question, and the one that is most often no.
		if (mayWrite && ownsLearnedMoveNamed(sufferer, HERO_MOVES.RAMPART) && heldReadiness(sufferer, { cardFor }) > 0) {
			offers.ignore.push({ row, defender: sufferer, cost: 1 });
		}
		// Safety First, to whoever suffers the blow while they hold Protection: no Readiness asked, so the
		// one hit is read here rather than out of `defendersFor`.
		if (!safetyFirst.has(row.uuid)) {
			const protectedOne = standIn ? stoodIn : hit;
			const mayProtect = !!protectedOne && (user?.isGM || protectedOne.isOwner || !user);
			if (mayProtect && learnedTrack(protectedOne, HERO_MOVES.SAFETY_FIRST)?.held > 0) offers.safetyFirst.push({ row, defender: protectedOne, cost: 0 });
		}
		// Amulets & Talismans, on whoever bears the charm and suffers the blow; the roll is the Blessed's +INT.
		// Pressed by anyone who can get it rolled: the Blessed's own player rolls it, anyone else ASKS whoever decides
		// for the Blessed (charmRollAnswerer: their player, else the GM), as a carer's Stock is asked for.
		if (!charmed.has(row.uuid)) {
			const bearer = standIn ? stoodIn : hit;
			for (const { blessed, mark } of charmsOf(bearer)) {
				if (!user || user.isGM || blessed.isOwner || charmRollAnswerer(blessed, bearer, user)) {
					offers.charm.push({ row, defender: blessed, bearer, mark, harm: charmHarm(mark), cost: 0, move: AMULETS_TALISMANS });
				}
			}
		}
	}
	return offers;
}

/**
 * Ask which one, when there is more than one: a button each, and Cancel. Resolves to the one picked, or
 * null. The Readiness spends here and the ring's Big Damn Hero (fight-ring.js#lockEyesFromRing) ask this.
 *
 * @param {object[]} items
 * @param {object} p
 * @param {string} p.title
 * @param {string} p.question
 * @param {(item: object) => string} p.labelOf  each item's button
 */
export async function pickOne(items, { title, question, labelOf }) {
	if (items.length <= 1) return items[0] ?? null;
	// A list of spends, each named for who takes what: the `stonetop-ask` window askWithButtons opens
	// caps its width and gives every offer a row of its own (stonetop.css). The first is the default,
	// as it was when DialogV2 picked it for a list with none marked.
	const index = await askWithButtons({
		title,
		content: contentElement(`<p>${escHtml(question)}</p>`),
		buttons: [
			...items.map((item, i) => ({ key: `o${i}`, label: labelOf(item), value: i })),
			{ key: "cancel", label: localize(`${KEY}.cancel`), value: null },
		],
	});
	return Number.isInteger(index) ? items[index] : null;
}

/** Ask which spend, when there is more than one; resolves to one offer or null. */
function pickOffer(offers, kind) {
	return pickOne(offers, {
		title: format(`${KEY}.${kind}`, {}),
		question: format(`${KEY}.ask`, {}),
		labelOf: offer => format(`${KEY}.${kind}${paysPresence(offer) ? "Presence" : ""}Choice`, { defender: offer.defender.name, ward: offer.row.name, move: offer.move ?? "", harm: offer.harm ?? "" }),
	});
}

/**
 * Take one spend: its Readiness off the defender (none for a Steadfast Guardian taking a blow, though they
 * must still hold some), and the card's flag told, so apply-time arithmetic (attack-flow.js#wireApplyDamage)
 * halves the blow, hands it to the defender, or lets it pass.
 *
 * A PARRY STRIKES BACK AT THE ATTACKER, and pays only once that strike back is settled: its weapon chosen
 * and its damage window answered (combat/attack-flow.js#strikeBackAt calls `commit`). Backing out of either
 * spends nothing and halves nothing. The card and the Readiness are read again then, since the questions
 * took time.
 *
 * @param {object} [deps]
 * @param {(defender: Actor, attackerUuid: string, label: string, options: {commit: (ticked?: string[]) => Promise<boolean>}) => Promise<unknown>} [deps.strikeBack]
 * @returns {Promise<boolean>} whether the spend was taken
 */
export async function spendOnBlow(message, kind, offer, { scope = SYSTEM_ID, strikeBack = null, relay = false } = {}) {
	const current = message.getFlag(scope, "damage");
	if (!current || !offer) return false;
	const cost = Number.isFinite(offer.cost) ? offer.cost : 1;
	if (!canPay(kind, offer, cost)) return false;
	// Written here, or by the GM's client for a card this reader cannot write (see the note at the top).
	const take = relay ? () => askGMToSpend(message, kind, offer, { scope }) : () => takeSpend(message, kind, offer, { scope });

	// I Get Knocked Down: the pick IS the price, so it is asked before anything is written, and backing
	// out of it halves nothing. Then the foe is remembered for But I Get Up Again.
	if (kind === "knockedDown") {
		const cost1 = await askKnockedDownCost(offer.defender);
		if (!cost1 || !(await take())) return false;
		const striker = current.selfHarm ? (current.foeUuid ?? "") : (current.attackerUuid ?? "");
		const foe = striker ? resolveSync(striker) : null;
		await postKnockedDown(offer.defender, cost1, foe);
		if (foe) await recordKnockedDownBy(offer.defender, foe);
		return true;
	}
	// Mirrorshield: "When you Defend WITH A SHIELD". The shield is read off their gear as they press it (the
	// offer is drawn without it: the gear stores are read asynchronously), and its absence said, not hidden.
	if (kind === "redirect" && offer.move === HERO_MOVES.MIRRORSHIELD
		&& offer.defender?.typedActor?.bearsShield && !(await offer.defender.typedActor.bearsShield())) {
		globalThis.ui?.notifications?.warn?.(format(`${KEY}.redirectNoShield`, { defender: offer.defender.name }));
		return false;
	}
	// Amulets & Talismans: the Blessed's +INT is rolled first, by whoever decides for the Blessed (askCharmRoll:
	// here when that is this user, else their player is asked), and its tier is what the card records. No roll,
	// a "no" or no answer records nothing.
	// The charm is used up only once the card holds the spend: by the GM's client on a relayed one
	// (handleSpendQuery), else here or by whoever decides for the Blessed (settleCharmAfterSpend).
	if (kind === "charm") {
		const tier = await askCharmRoll(offer);
		if (!tier) return false;
		const tested = { ...offer, tier };
		if (relay) return askGMToSpend(message, kind, tested, { scope });
		if (!(await takeSpend(message, kind, tested, { scope }))) return false;
		await settleCharmAfterSpend(message, tested);
		return true;
	}
	if (kind !== "parry") return take();

	const strike = strikeBack ?? (await import("../combat/attack-flow.js")).strikeBackAt;
	// On a blow a character takes, the card's attacker IS that character: the foe is `foeUuid`.
	const attacker = current.selfHarm ? (current.foeUuid ?? "") : (current.attackerUuid ?? "");
	let taken = false;
	// Which of the damage window's lines went out ticked: Second Intent's +1d4 is one of them, and if the
	// player took it there, that WAS their pick from the Ambush list.
	let ticked = [];
	await strike(offer.defender, attacker, format(`${KEY}.parryStrike`, {}), {
		commit: async (keys = []) => { ticked = keys; return (taken = await take()); },
	});
	if (!taken) return false;
	if (ownsLearnedBookMoveNamed(offer.defender, HERO_MOVES.SECOND_INTENT)) {
		await postSecondIntent(offer.defender, { dieTaken: ticked.includes("secondIntent") });
	}
	return true;
}

/**
 * Whom a strike back with nobody targeted is aimed at: "strike back at an attacker" (p.216), so whoever is
 * attacking the defender, in contact or shooting at them (the fight's `attackers`, the same list that lets the
 * fight ring offer Strike back at all). One is aimed at outright, several are asked which, as a Clash asks
 * (fight-targets.js#askWhoItHits). [] where the fight cannot be read, null when the question was closed.
 *
 * @param {Actor} actor  the defender striking back
 */
export async function strikeBackAim(actor, { engagement = rollerEngagement(actor), ask = askWhoItHits } = {}) {
	if (!engagement?.entry) return [];
	const candidates = (engagement.entry.attackers ?? [])
		.map(id => engagement.combatants?.get?.(id))
		.filter(c => c?.token)
		.map(asTarget);
	return candidates.length < 2 ? candidates : ask({ roller: actor?.name ?? "", candidates });
}

/**
 * Roll a Blessed's +INT for their charm (Amulets & Talismans), as a roll card of its own, and answer its tier
 * ("success", "partial", "failure"), or null when nothing was rolled.
 */
export async function rollCharm(blessed) {
	const roll = await blessed?.typedActor?.onDirectStatRoll?.("int", { moveName: AMULETS_TALISMANS, targets: [] });
	const total = Number(roll?.total);
	return roll && Number.isFinite(total) ? classifyResult(total).key : null;
}

/** The User query a charm's roll is asked through when someone else decides for the Blessed. */
export const CHARM_QUERY = "stonetop.charmRoll";

/**
 * Who decides on rolling a Blessed's charm, as they decide on spending the Blessed's Stock for someone else
 * (healers-arts.js#carerStockAnswerer): the Blessed's own player, else whoever plays them, else the GM. Null
 * when nobody can.
 */
export function charmRollAnswerer(blessed, bearer, asker = globalThis.game?.user ?? null, users = globalThis.game?.users) {
	return carerStockAnswerer(blessed, users, { asker, patient: bearer });
}

/**
 * Roll the charm, here or by asking (utils/owner-ask.js#spendOrAskOwner): the roll card is the Blessed's. Nothing
 * is used up yet: that waits for the card to record the spend (settleCharmAfterSpend). Answers the tier, or null.
 */
async function askCharmRoll(offer) {
	const { defender: blessed, bearer, mark, row } = offer;
	const receipt = await spendOrAskOwner({
		owner: blessed,
		answerer: charmRollAnswerer(blessed, bearer),
		spend: () => rollCharmTier(blessed),
		query: CHARM_QUERY,
		data: { blessedId: blessed?.id ?? null, markId: mark?.id ?? null, ward: row?.name ?? "" },
		whether: format(`${KEY}.charmAskWhether`, { defender: blessed?.name ?? "", ward: row?.name ?? "" }),
		what: "a charm's roll",
	});
	return CHARM_TIERS.has(receipt?.tier) ? receipt.tier : null;
}

/** Roll the charm on this client: `{tier}`, or null when nothing was rolled. */
async function rollCharmTier(blessed) {
	const tier = await rollCharm(blessed);
	return tier ? { tier } : null;
}

/**
 * The answering side of CHARM_QUERY, on the Blessed's player's client (or the primary GM's, when none of them is
 * on): for a Blessed who has Amulets & Talismans learned and a charm row still standing under `markId`, ASK
 * whether to roll it, then roll it here. Answers `{tier}`, `{declined: true}`, or null. The charm is used up once
 * the card records the spend (CHARM_SETTLE_QUERY).
 */
export async function handleCharmQuery(data, context = {}, { actors = globalThis.game?.actors, users = globalThis.game?.users, confirm } = {}) {
	const blessed = actors?.get?.(data?.blessedId);
	const mark = (blessed?.getFlag?.(SYSTEM_ID, BLESSED_MARKS_FLAG) ?? []).find?.(row => row?.id === data?.markId && markKindKey(row.kind) === "charm") ?? null;
	return answerOwnerAsk(data, context, {
		users, ...(confirm ? { confirm } : {}),
		question: (asker, me) => {
			if (!blessed?.isOwner || !mark || !ownsLearnedMoveNamed(blessed, AMULETS_TALISMANS)) return null;
			const words = { asker: asker?.name ?? "", defender: blessed.name ?? "", ward: String(data?.ward ?? "") || mark.name || "", harm: charmHarm(mark) };
			return {
				title: format(`${KEY}.charmAskTitle`, words),
				content: `<p>${escHtml(format(`${KEY}.charmAskBody`, words))}</p>${gmAnswersNote(me, blessed.name ?? "")}`,
				yes: { label: localize(`${KEY}.charmAskYes`), icon: "fa-gem" },
				no: { label: localize(`${KEY}.charmAskNo`) },
			};
		},
		settle: () => rollCharmTier(blessed),
	});
}

/** The User query that asks whoever may write the Blessed to use up a charm the card has now recorded. */
export const CHARM_SETTLE_QUERY = "stonetop.charmSettle";

/** Whether the card records `blessed`'s charm roll at `tier` on the row `rowUuid` (and of the charm `markId`, when both say). PURE but for the read. */
function charmRecorded(message, rowUuid, blessed, tier, scope = SYSTEM_ID, markId = "") {
	const list = message?.getFlag?.(scope, "damage")?.[SPEND_KINDS.charm.list] ?? [];
	return list.some(s => s?.uuid === rowUuid && s.by === blessed?.uuid && s.tier === tier && (!s.markId || !markId || s.markId === markId));
}

/**
 * Use up a charm whose spend this client has just recorded: here when this user can write the Blessed, else by
 * asking whoever decides for them (charmRollAnswerer), who checks the card first (handleCharmSettleQuery).
 */
async function settleCharmAfterSpend(message, offer, { scope = SYSTEM_ID } = {}) {
	const { defender: blessed, bearer, mark, tier } = offer;
	if (!mark?.id) return;
	if (blessed?.isOwner) return settleCharm(blessed, mark, tier);
	const answerer = charmRollAnswerer(blessed, bearer);
	try {
		const done = answerer?.query
			? await answerer.query(CHARM_SETTLE_QUERY, { messageId: message.id, rowUuid: offer.row.uuid, blessedId: blessed?.id ?? null, markId: mark.id, tier, scope }, { timeout: 30000 })
			: false;
		if (done) return;
	} catch (err) {
		console.warn("Stonetop | no answer came about using up a charm", err);
	}
	globalThis.ui?.notifications?.warn?.(format(`${KEY}.charmNotLifted`, { name: mark.name ?? "", defender: blessed?.name ?? "" }));
}

/**
 * The answering side of CHARM_SETTLE_QUERY, on a client that can write the Blessed: the charm is used up only
 * when the card really records that Blessed's roll at that tier on that row, so the query cannot strip a charm
 * nobody rolled. Whether it was settled.
 */
export async function handleCharmSettleQuery(data, _context = {}, { actors = globalThis.game?.actors, messages = globalThis.game?.messages } = {}) {
	const blessed = actors?.get?.(data?.blessedId);
	if (!blessed?.isOwner || !CHARM_TIERS.has(data?.tier)) return false;
	const mark = (blessed.getFlag?.(SYSTEM_ID, BLESSED_MARKS_FLAG) ?? []).find?.(row => row?.id === data?.markId && markKindKey(row.kind) === "charm") ?? null;
	const message = messages?.get?.(data?.messageId);
	if (!mark || !charmRecorded(message, data?.rowUuid, blessed, data.tier, data?.scope ?? SYSTEM_ID, mark.id)) return false;
	await settleCharm(blessed, mark, data.tier);
	return true;
}

/**
 * "It loses its potency after 1 use": the charm comes off the Blessed's roster, unless Potent Workings' "On a 10+,
 * the charm retains its potency" was bought for it and this was a 10+ (blessed-marks.js#charmSpentByRoll). Said
 * either way. Never at the cost of the card: the spend is already recorded.
 */
async function settleCharm(blessed, mark, tier) {
	if (!mark?.id) return;
	try {
		if (!charmSpentByRoll(mark, tier)) {
			globalThis.ui?.notifications?.info?.(format(`${KEY}.charmKept`, { name: mark.name ?? "" }));
			return;
		}
		if (await blessed?.typedActor?.liftBlessedMark?.(mark.id)) {
			globalThis.ui?.notifications?.info?.(format(`${KEY}.charmSpent`, { name: mark.name ?? "" }));
		}
	} catch (err) {
		console.warn("Stonetop | could not lift the spent charm", err);
	}
}

/**
 * Whether a damage card is being applied right now: its `applying` mark (combat/attack-flow.js#applyOwedDamage)
 * names a user who is still connected. A mark left by someone who dropped mid-apply holds nothing. PURE apart
 * from `users`.
 *
 * @param {object} damage  the card's damage flag
 * @param {{get?: Function}} [users]
 */
export function beingApplied(damage, users = globalThis.game?.users) {
	const by = damage?.applying;
	if (!by) return false;
	if (typeof by !== "string") return true;
	const user = users?.get?.(by);
	return user ? !!user.active : !users?.get;
}

/**
 * Record one spend on the card: the Readiness off the defender and the card's flag told. Run in the card's
 * turn on this client (utils/card-queue.js), behind any Apply or other spend already pressed, so each reads
 * what the other wrote: a halving that comes after the blow is applied is refused, not lost. Writes only
 * its own list, so an Apply's `applied` written from another client is never put back. Refused once the
 * blow is applied, or with too little Readiness left.
 *
 * @returns {Promise<boolean>} whether the spend was taken
 */
export function takeSpend(message, kind, offer, { scope = SYSTEM_ID, reroll = rollFormula } = {}) {
	const cost = Number.isFinite(offer?.cost) ? offer.cost : 1;
	// Each kept as a list of who spent what, which is all spentOn and defendNotes read.
	const list = SPEND_KINDS[kind]?.list ?? "standIns";
	const bySufferer = !!SPEND_KINDS[kind]?.bySufferer;
	const take = async () => {
		const now = message.getFlag(scope, "damage");
		if (!now || (now.applied ?? []).some(a => a.uuid === offer.row.uuid)) return false;
		// Being applied right now, perhaps on another client (combat/attack-flow.js#applyOwedDamage): the HP
		// may already be written whole, so the Readiness would buy nothing.
		if (beingApplied(now)) return false;
		if (!canPay(kind, offer, cost)) return false;
		// A charm records the tier its roll came to, and nothing without one.
		if (kind === "charm" && !CHARM_TIERS.has(offer.tier)) return false;
		// The same option twice on one blow is refused (p.216: "each option once against any given attack").
		// A sufferer's own move (I Get Knocked Down), so a stand-in may still take it on a blow whose ward took
		// it before they stepped in (spentOn: the ward's no longer counts).
		// A charm, once per blow for whoever bears it: a stand-in's own charm after the ward's (spentOn).
		const again = bySufferer
			? s => s.uuid === offer.row.uuid && (!s.by || s.by === offer.defender.uuid)
			: kind === "charm"
				? s => s.uuid === offer.row.uuid && (!s.bearerUuid || s.bearerUuid === offer.bearer?.uuid)
				: s => s.uuid === offer.row.uuid;
		if ((now[list] ?? []).some(again)) return false;
		// Never Gonna Keep Me Down writes its number onto the row with its record, in one write.
		if (kind === "neverGonna") return rollAgainKeepLower(message, now, offer, { scope, reroll });
		// Each pool re-reads itself in the defender's spending turn (utils/spender-queue.js) and refuses when it
		// no longer holds enough, so the last point never pays twice.
		// Safety First is paid in Protection, 1 off what is HELD.
		if (kind === "safetyFirst" && !await takeBackHeld(offer.defender, HERO_MOVES.SAFETY_FIRST, 1)) return false;
		// Front Line Leader's Presence pays in Readiness's place.
		if (paysPresence(offer)) { if (!await spendPresence(offer.defender)) return false; }
		else if (cost > 0 && !await spendReadiness(offer.defender, cost)) return false;
		const spend = { uuid: offer.row.uuid, name: offer.defender.name, how: kind, ...(paysPresence(offer) ? { purse: "presence" } : {}) };
		// A stand-in, and a sufferer's own move (a knock-down), say whose it was: spentOn reads the knock-down
		// against whoever takes the blow now.
		const entry = list === "standIns" ? { ...spend, by: offer.defender.uuid, free: cost === 0 }
			: kind === "charm" ? { ...spend, by: offer.defender.uuid, move: offer.move ?? AMULETS_TALISMANS, tier: offer.tier, bearer: offer.bearer?.name ?? "", bearerUuid: offer.bearer?.uuid ?? "", markId: offer.mark?.id ?? "" }
			: bySufferer ? { ...spend, by: offer.defender.uuid }
			: offer.move ? { ...spend, move: offer.move }
			: spend;
		await message.setFlag(scope, `damage.${list}`, [...(now[list] ?? []), entry]);
		return true;
	};
	return inCardTurn(message, take);
}

/** A damage formula rolled, as the card's own rows were (attack-flow.js#rollAndPostDamage). */
async function rollFormula(formula) {
	return new globalThis.Roll(formula).evaluate();
}

/**
 * Never Gonna Keep Me Down on a blow a Would-Be Hero stood in for: the row's own formula rolled again, and the
 * lower of the two totals kept ("roll damage twice, take the lower", Book I p.21). The new number goes onto the
 * row, as an Inspiration die's does, so Apply, the halvings and the fight's +N all reckon from it, and the
 * record says both totals. One write, so the row cannot be rolled again without its record, nor recorded
 * without its number. Run in the card's turn (takeSpend), so nothing has applied the row meanwhile.
 *
 * The row's formula is what its dice were (the fight's +N in it when it was rolled in), so the second roll is
 * the same blow. An Inspiration die added to the card afterwards stays on top of whichever total is kept.
 *
 * A row rolled WITH advantage: advantage and disadvantage cancel (Book I p.21), so the blow is rolled again
 * straight (`straightFormula`) and that total stands, whether higher or lower.
 */
async function rollAgainKeepLower(message, now, offer, { scope = SYSTEM_ID, reroll = rollFormula } = {}) {
	const row = (now.results ?? []).find(r => r.uuid === offer.row.uuid);
	if (!row || !hasDie(row.formula) || rolledAtDisadvantage(row)) return false;
	const straight = rolledAtAdvantage(row);
	const again = await reroll(straight ? straightFormula(row.formula) : row.formula);
	const total = Number(again?.total);
	if (!Number.isFinite(total)) return false;
	const extra = Math.trunc(Number(message.getFlag?.(scope, INSPIRATION_DIE_FLAG)?.amount) || 0);
	const was = Number(row.raw) || 0;
	const rolled = total + extra;
	const replace = straight || rolled < was;
	const kept = replace ? rolled : was;
	const results = now.results.map(r => (r === row && replace ? { ...r, raw: kept, faces: multiDieFaces(again) } : r));
	const list = SPEND_KINDS.neverGonna.list;
	const entry = { uuid: row.uuid, name: offer.defender.name, how: "neverGonna", by: offer.defender.uuid, was, rolled, kept, ...(straight ? { straight: true } : {}) };
	await message.update({ flags: { [scope]: { damage: { results, [list]: [...(now[list] ?? []), entry] } } } });
	return true;
}

/** The User query a player's spend goes through on a card the GM wrote. */
export const SPEND_QUERY = "stonetop.defendSpend";

/** How many of this defender's spends of `kind` on this blow the card records now. PURE but for the read. */
function spendsRecorded(message, kind, offer, scope = SYSTEM_ID) {
	const list = SPEND_KINDS[kind]?.list ?? "standIns";
	const now = message?.getFlag?.(scope, "damage")?.[list] ?? [];
	return now.filter(s => s?.uuid === offer?.row?.uuid && (s.how ?? kind) === kind
		&& (s.by ? s.by === offer?.defender?.uuid : s.name === offer?.defender?.name)).length;
}

/**
 * A player's spend on a card the GM wrote: the GM's client records it. Whether it was taken. An answer that never
 * came (out of time) is not read as a no: the card is watched a while longer (relay-landed.js), and a spend the
 * GM's client records all the same counts as taken, so a parry's strike back is not dropped for a Readiness paid.
 */
async function askGMToSpend(message, kind, offer, { scope = SYSTEM_ID } = {}) {
	const gm = globalThis.game?.users?.activeGM;
	if (!gm) return false;
	const before = spendsRecorded(message, kind, offer, scope);
	const grew = () => spendsRecorded(message, kind, offer, scope) > before;
	const answer = await askGMClient(gm, SPEND_QUERY, {
		messageId: message.id, kind, rowUuid: offer.row.uuid, defenderUuid: offer.defender.uuid, ...(offer.purse ? { purse: offer.purse } : {}),
		...(offer.tier ? { tier: offer.tier } : {}),
		// Which charm was rolled: one Blessed may have laid several on the same bearer.
		...(offer.mark?.id ? { markId: offer.mark.id } : {}),
		userId: globalThis.game?.user?.id ?? null,
	}, { fallback: NO_ANSWER, what: "record a Readiness spend" });
	return !!await relayOutcome(message, answer, grew);
}

/**
 * The GM's side of `SPEND_QUERY`: record a player's spend if the asker owns the defender and the card
 * still offers that spend to that defender (read on the GM's client, which sees every defender). Only the
 * primary GM answers. A parry's strike back was rolled by the player already: this only takes it.
 *
 * WHO ASKED is foundry-compat.js#queryAsker's business: v13 names nobody in the context, so the id in
 * the data is read instead, and never taken for a GM's.
 *
 * @returns {Promise<boolean>}
 */
export async function handleSpendQuery(data, context = {}, { messages = globalThis.game?.messages, users = globalThis.game?.users, scope = SYSTEM_ID, offersOf = defendOffers } = {}) {
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return false;
	const user = queryAsker(data, context, users);
	const kind = data?.kind;
	const message = messages?.get?.(data?.messageId);
	const damage = message?.getFlag?.(scope, "damage");
	if (!user || !isSpendKind(kind) || !damage) return false;
	const offer = (offersOf(damage)[kind] ?? []).find(o => o.row?.uuid === data.rowUuid && o.defender?.uuid === data.defenderUuid
		&& (o.purse ?? "") === (data.purse ?? "") && (kind !== "charm" || o.mark?.id === data.markId));
	// A charm's tier was rolled already, by whoever decides for the Blessed (askCharmRoll), and the asker is the
	// Blessed's player or the bearer's: the tier is the one thing taken from the ask.
	if (kind === "charm") {
		if (!offer || !CHARM_TIERS.has(data?.tier)) return false;
		const owns = doc => !!doc?.testUserPermission?.(user, "OWNER");
		if (!owns(offer.defender) && !owns(offer.bearer)) return false;
		const tested = { ...offer, tier: data.tier };
		if (!(await takeSpend(message, kind, tested, { scope }))) return false;
		// The GM can write the Blessed, so the charm is used up here, the moment its spend is recorded.
		await settleCharm(tested.defender, tested.mark, tested.tier);
		return true;
	}
	if (!offer || !offer.defender.testUserPermission?.(user, "OWNER")) return false;
	return takeSpend(message, kind, offer, { scope });
}

/**
 * I Get Knocked Down's price: "pick 1 of the following. Whatever you choose, the GM will describe the
 * details." Three buttons, the move's own words. Null when the window is closed, which halves nothing.
 */
async function askKnockedDownCost(actor) {
	const costs = ["lost", "broke", "outOfIt"].map(key => localize(`${HERO_KEY}.knockedDown.${key}`));
	// With no window to ask in, the first cost stands: the move is already spent and the blow is
	// already halved, so returning null here would quietly un-halve it.
	if (!globalThis.foundry?.applications?.api?.DialogV2) return costs[0];
	return pickOne(costs, {
		title: localize(`${HERO_KEY}.knockedDown.title`),
		question: format(`${HERO_KEY}.knockedDown.ask`, { name: actor?.name ?? "" }),
		labelOf: cost => cost,
	});
}

/** Say what being knocked down cost, and — with But I Get Up Again — what the foe now owes them. */
async function postKnockedDown(actor, cost, foe) {
	const upAgain = ownsLearnedMoveNamed(actor, HERO_MOVES.UP_AGAIN)
		? `<p>${escHtml(format(`${HERO_KEY}.knockedDown.upAgain`, { name: actor.name, foe: foe?.name ?? "them" }))}</p>`
		: "";
	return globalThis.ChatMessage?.create?.({
		content: stonetopChatCard(HERO_MOVES.KNOCKED_DOWN, `<div class="card-content">
			<p>${escHtml(format(`${HERO_KEY}.knockedDown.note`, { name: actor.name, cost }))}</p>${upAgain}
		</div>`, "stonetop-knocked-down-card"),
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
	});
}

/**
 * Second Intent: "When you Defend and spend 1 Readiness to Parry & Riposte, also pick 1 option from the
 * Ambush list." The list is read off the character's own Ambush, so it is the book's words; the pick is
 * theirs to say.
 *
 * The strike back's damage window offered "Deal +1d4 damage" as a line of its own (hero-moves.js#blowOffers),
 * because by the time this card posts the strike back has already rolled. `dieTaken` says whether it went
 * out ticked: if so the pick is made and the card says so; if not, the card says the d4 is behind them, so
 * nobody reads "Deal +1d4 damage" on the list below as still to roll.
 */
async function postSecondIntent(actor, { dieTaken = false } = {}) {
	// The BOOK's Ambush, learned: a player's own move of that name (owns-move.js#bookMoveName) has a list
	// of its own words, and is not the one Second Intent points at.
	const ambush = ownedLearnedBookMove(actor, "Ambush");
	const options = (firstOptionList(ambush?.system?.description)?.items ?? []).map(stripHtmlToText).filter(Boolean);
	const list = !dieTaken && options.length ? `<ul>${options.map(o => `<li>${escHtml(o)}</li>`).join("")}</ul>` : "";
	const said = format(`${KEY}.${dieTaken ? "secondIntentTookDie" : "secondIntent"}`, { name: actor.name });
	// The list's "Create an opportunity; you or an ally gains advantage on the next move to act on it" (Ambush,
	// Book I p.110): the same button an Ambush 7+ carries (actors/character/give-advantage.js), for that pick.
	const opportunity = !dieTaken && ambush
		? `<div class="card-buttons stonetop-roll-actions stonetop-give-advantage-row"><p class="stonetop-give-advantage-lead">${escHtml(localize(`${KEY}.secondIntentOpportunity`))}</p>${giveAdvantageButtonHtml("Ambush")}</div>`
		: "";
	return globalThis.ChatMessage?.create?.({
		content: stonetopChatCard(HERO_MOVES.SECOND_INTENT, `<div class="card-content"><p>${escHtml(said)}</p>${list}</div>${opportunity}`, "stonetop-second-intent-card"),
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
	});
}

/**
 * The line a card prints for each spend taken, list by list in SPEND_KINDS' order, each in its kind's `note`.
 * A list two kinds share (a halving and a parry) says each spend in the words of the kind it records (`how`),
 * and a spend that names none in the first kind's. PURE.
 */
export function defendNotes(damage) {
	const notes = [];
	const ward = spend => damage.results?.find(r => r.uuid === spend.uuid)?.name ?? "";
	const lists = [...new Set(Object.values(SPEND_KINDS).map(kind => kind.list))];
	for (const list of lists) {
		const first = Object.values(SPEND_KINDS).find(kind => kind.list === list);
		for (const spend of damage?.[list] ?? []) {
			const kind = isSpendKind(spend.how) && SPEND_KINDS[spend.how].list === list ? SPEND_KINDS[spend.how] : first;
			const own = typeof kind.note === "function" ? kind.note(spend) : kind.note;
			// Paid in Front Line Leader's Presence: the same spend, said in its own words.
			const note = paysPresence(spend) ? `${own}Presence` : own;
			// A roll again's two totals and the one kept, never below 0 as the card shows them.
			const shown = value => String(Math.max(0, Number(value) || 0));
			notes.push(format(`${KEY}.${note}`, {
				defender: spend.name, ward: ward(spend), move: spend.move ?? "",
				was: shown(spend.was), rolled: shown(spend.rolled), kept: shown(spend.kept),
			}));
		}
	}
	return notes;
}

/**
 * How this client records a spend on this card: "direct" (it writes the card), "relay" (the GM's client does,
 * SPEND_QUERY), or null (it offers none). One GM of several offers them, the primary. A player asks the GM's
 * client while one is there, the card's author included (see wireDefendSpends); with no GM on, only a card's
 * author may, writing it directly. PURE apart from the primary-GM read.
 */
export function spendWriter(message, user, { gm = globalThis.game?.users?.activeGM ?? null, primary = isPrimaryGM } = {}) {
	if (user?.isGM) return primary() && message?.isOwner !== false ? "direct" : null;
	if (gm) return "relay";
	return message?.isOwner ? "direct" : null;
}

/**
 * Put the Readiness buttons on a damage card, and say which spends were taken. Drawn every render, from the
 * flag, like the fight's +N toggle.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement|object} html
 */
export function wireDefendSpends(message, html, { scope = SYSTEM_ID, user = globalThis.game?.user } = {}) {
	const root = html?.[0] ?? html;
	const damage = message?.getFlag?.(scope, "damage");
	if (!root || !damage?.results?.length) return;

	const notes = defendNotes(damage);
	if (notes.length) {
		const list = root.querySelector(".stonetop-damage-list");
		const block = document.createElement("p");
		block.className = "stonetop-damage-defend-note";
		block.textContent = notes.join(" ");
		list?.after?.(block);
	}
	// A row Never Gonna Keep Me Down rolled again carries its new number, which the card's own HTML was written
	// before: redrawn from the rows, as an Inspiration die's is. With a fight's +N on the card,
	// attack-flow.js#wireDamageSeed redraws them from the same rows.
	if (damage[SPEND_KINDS.neverGonna.list]?.length && !damage.seed) {
		for (const rowEl of root.querySelectorAll?.(".stonetop-damage-row[data-uuid]") ?? []) {
			const result = damage.results.find(r => r.uuid === rowEl.dataset.uuid);
			const number = rowEl.querySelector(".stonetop-roll-result-number");
			if (!result || !number) continue;
			number.textContent = String(Math.max(0, Number(result.raw) || 0));
			if (result.faces) number.dataset.tooltip = result.faces;
		}
	}

	const actions = root.querySelector(".stonetop-attack-actions");
	if (!actions || !root.querySelector(".stonetop-apply-damage")) return;
	// A spend is written to the card: a client that may write it offers one (of several GMs, one), and a
	// player who may not asks the GM's client to (SPEND_QUERY), while a GM is there to.
	// A PLAYER WHO WROTE THE CARD asks the GM's client too, while one is there: the GM's client writes every
	// other player's spends on it, and two clients each writing the same list of a card (a halving pressed by
	// both at once) leave one entry for two Readiness paid. The queue that keeps them apart is the GM's
	// (utils/card-queue.js is one client's). With no GM on, the author writes it as before.
	const how = spendWriter(message, user);
	if (!how) return;
	const relay = how === "relay";
	const offers = defendOffers(damage);
	for (const kind of Object.keys(SPEND_KINDS)) {
		if (!offers[kind].length) continue;
		const button = document.createElement("button");
		button.type = "button";
		button.className = `stonetop-attack-btn stonetop-damage-defend stonetop-damage-defend--${kind}`;
		const [one] = offers[kind];
		// A Steadfast Guardian's stand-in says it is free, so nobody waits for a Readiness to come off.
		const free = paysPresence(one) ? "Presence" : kind === "standIn" && one.cost === 0 ? "Free" : "";
		const label = offers[kind].length === 1
			? format(`${KEY}.${kind}${free}One`, { defender: one.defender.name, ward: one.row.name, move: one.move ?? "", harm: one.harm ?? "" })
			: format(`${KEY}.${kind}`, {});
		button.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${escHtml(label)}`;
		button.addEventListener("click", async () => {
			if (button.disabled) return;
			button.disabled = true;
			try {
				const offer = await pickOffer(offers[kind], kind);
				if (!offer || !(await spendOnBlow(message, kind, offer, { scope, relay }))) button.disabled = false;
			} catch (err) {
				console.error("Stonetop | spending Readiness failed", err);
				button.disabled = false;
			}
		});
		actions.append(button);
	}
}
