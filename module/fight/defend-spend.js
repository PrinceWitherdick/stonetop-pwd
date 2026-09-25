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
//    character advantage and +1d4 (fight/hero-moves.js).
//
// WHO MAY DEFEND. The one hit, when they hold Readiness, can halve their own blow; any character in the
// fight standing beside them (touching, or fighting the same foe) who holds Readiness can do either. "They
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
import { stonetopChatCard, firstOptionList } from "../utils/chat.js";
import { damageRowActor } from "../utils/damage.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { contentElement } from "../dialogs/content-picker.js";
import { heldReadiness, READINESS_FLAG } from "../combat/defend-readiness.js";
import { ownsLearnedMoveNamed, ownedMove } from "../actors/character/owns-move.js";
import { touching, HEROES } from "./engagements.js";
import { engagementFor, fightOnScene, gridOf, isFight } from "./fight-state.js";
import { HERO_MOVES, recordKnockedDownBy } from "./hero-moves.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { inCardTurn } from "../utils/card-queue.js";
import { resolveSync, queryAsker } from "../utils/foundry-compat.js";

const KEY = "stonetop.fight.defend";
const HERO_KEY = "stonetop.fight.heroMoves";

/** Take `cost` Readiness off a character, never below none. */
export function spendReadiness(actor, cost = 1) {
	return actor.setFlag(SYSTEM_ID, READINESS_FLAG, Math.max(0, heldReadiness(actor) - cost));
}

/** Halve a blow, rounded up (p.216; the book's halvings round up). */
export const halveDamage = raw => Math.ceil(Math.max(0, Number(raw) || 0) / 2);

/**
 * What the spends on a card have settled so far, by row uuid: the blows halved (a halving or a parry),
 * the ones a defender took in the ward's place, and the ones ignored. PURE.
 *
 * @param {object} damage  the card's damage flag
 * @returns {{halved: Set<string>, standIns: Map<string, object>, ignored: Set<string>}}
 */
export function spentOn(damage) {
	return {
		halved: new Set((damage?.halvedBy ?? []).map(spend => spend.uuid)),
		standIns: new Map((damage?.standIns ?? []).map(spend => [spend.uuid, spend])),
		ignored: new Set((damage?.ignoredBy ?? []).map(spend => spend.uuid)),
		// I Get Knocked Down halves as Readiness does, from its own list: it is a different move with a
		// different price, and "each option once against any given attack" counts them apart.
		knockedDown: new Set((damage?.knockedDownBy ?? []).map(spend => spend.uuid)),
	};
}

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
		if (!isFight(combat)) continue;
		for (const c of combat.combatants ?? []) {
			if (c.actorId === doc.id && c.token && !fought.includes(c.token)) fought.push(c.token);
		}
	}
	return fought.length === 1 ? fought[0] : null;
}


/**
 * Who could spend Readiness on the blow a row owes: the one hit, and the characters standing by them.
 *
 * @param {string} uuid  the row's target
 * @returns {{self: Actor|null, allies: Actor[]}}  those holding Readiness this reader may write
 */
function defendersFor(uuid, { user = globalThis.game?.user } = {}) {
	const doc = resolveSync(uuid);
	const target = damageRowActor(doc);
	const writable = actor => !!actor && (user?.isGM || actor.isOwner) && heldReadiness(actor) > 0;
	const self = writable(target) ? target : null;
	const allies = [];
	const token = isFightTabEnabled() ? rowToken(doc) : null;
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

/** The kinds of spend a card can offer, in the order its buttons stand. */
const SPEND_KINDS = ["halve", "parry", "standIn", "ignore", "knockedDown"];

/** The kinds that cost Readiness. I Get Knocked Down is paid for in the fiction instead. */
const FREE_KINDS = new Set(["knockedDown"]);

/** Which list on the card's flag records a spend of this kind. */
const SPEND_LIST = { halve: "halvedBy", parry: "halvedBy", ignore: "ignoredBy", knockedDown: "knockedDownBy", standIn: "standIns" };

/**
 * The spends a card still offers: one entry per blow and defender, for each option, leaving out an option
 * already taken on that blow. Each carries what it costs: a Steadfast Guardian takes a blow for nothing.
 * PURE apart from `defendersOf` and `resolveActor`.
 *
 * @param {object} damage  the card's damage flag
 * @param {(uuid: string) => {self: Actor|null, allies: Actor[]}} [defendersOf]
 * @param {(uuid: string) => Actor|null} [resolveActor]  a stand-in's actor, from the uuid on the card
 * @returns {{halve: object[], parry: object[], standIn: object[], ignore: object[]}}
 */
export function defendOffers(damage, defendersOf = defendersFor, resolveActor = uuid => damageRowActor(resolveSync(uuid))) {
	const done = new Set((damage?.applied ?? []).map(a => a.uuid));
	const { halved, standIns, ignored, knockedDown } = spentOn(damage);
	const offers = { halve: [], parry: [], standIn: [], ignore: [], knockedDown: [] };
	const user = globalThis.game?.user;
	for (const row of damage?.results ?? []) {
		if (!row?.uuid || done.has(row.uuid) || ignored.has(row.uuid)) continue;
		// I Get Knocked Down needs no Readiness, so it is offered to the one hit whether or not they hold
		// any — which is the whole point of the move, and why it cannot come from `defendersFor`.
		if (!knockedDown.has(row.uuid)) {
			const hit = resolveActor(row.uuid);
			if (hit && (user?.isGM || hit.isOwner || !user) && ownsLearnedMoveNamed(hit, HERO_MOVES.KNOCKED_DOWN)) {
				offers.knockedDown.push({ row, defender: hit, cost: 0 });
			}
		}
		const { self, allies } = defendersOf(row.uuid);
		if (!halved.has(row.uuid)) {
			for (const defender of [self, ...allies].filter(Boolean)) {
				offers.halve.push({ row, defender, cost: 1 });
				if (ownsLearnedMoveNamed(defender, HERO_MOVES.PARRY)) offers.parry.push({ row, defender, cost: 1 });
			}
		}
		if (!standIns.has(row.uuid)) {
			for (const defender of allies) offers.standIn.push({ row, defender, cost: ownsLearnedMoveNamed(defender, HERO_MOVES.STEADFAST) ? 0 : 1 });
		}
		// Whoever will suffer the blow: the defender who took it, or the one it was aimed at.
		const standIn = standIns.get(row.uuid);
		const sufferer = standIn ? resolveActor(standIn.by) : self;
		const mayWrite = !!sufferer && (user?.isGM || sufferer.isOwner || !user);
		if (mayWrite && heldReadiness(sufferer) > 0 && ownsLearnedMoveNamed(sufferer, HERO_MOVES.RAMPART)) {
			offers.ignore.push({ row, defender: sufferer, cost: 1 });
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
		labelOf: offer => format(`${KEY}.${kind}Choice`, { defender: offer.defender.name, ward: offer.row.name }),
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
	if (!FREE_KINDS.has(kind) && heldReadiness(offer.defender) < Math.max(1, cost)) return false;
	// Written here, or by the GM's client for a card this reader cannot write (see the note at the top).
	const take = relay ? () => askGMToSpend(message, kind, offer) : () => takeSpend(message, kind, offer, { scope });

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
	if (ownsLearnedMoveNamed(offer.defender, HERO_MOVES.SECOND_INTENT)) {
		await postSecondIntent(offer.defender, { dieTaken: ticked.includes("secondIntent") });
	}
	return true;
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
export function takeSpend(message, kind, offer, { scope = SYSTEM_ID } = {}) {
	const cost = Number.isFinite(offer?.cost) ? offer.cost : 1;
	// Each kept as a list of who spent what, which is all spentOn and defendNotes read.
	const list = SPEND_LIST[kind] ?? "standIns";
	const take = async () => {
		const now = message.getFlag(scope, "damage");
		if (!now || (now.applied ?? []).some(a => a.uuid === offer.row.uuid)) return false;
		if (!FREE_KINDS.has(kind) && heldReadiness(offer.defender) < Math.max(1, cost)) return false;
		// The same option twice on one blow is refused (p.216: "each option once against any given attack").
		if ((now[list] ?? []).some(s => s.uuid === offer.row.uuid)) return false;
		if (cost > 0) await spendReadiness(offer.defender, cost);
		const spend = { uuid: offer.row.uuid, name: offer.defender.name, how: kind };
		const entry = list === "standIns" ? { ...spend, by: offer.defender.uuid, free: cost === 0 } : spend;
		await message.setFlag(scope, `damage.${list}`, [...(now[list] ?? []), entry]);
		return true;
	};
	return inCardTurn(message, take);
}

/** The User query a player's spend goes through on a card the GM wrote. */
export const SPEND_QUERY = "stonetop.defendSpend";

/** A player's spend on a card the GM wrote: the GM's client records it. Whether it was taken. */
async function askGMToSpend(message, kind, offer) {
	const gm = globalThis.game?.users?.activeGM;
	if (!gm) return false;
	try {
		return !!(await gm.query(SPEND_QUERY, {
			messageId: message.id, kind, rowUuid: offer.row.uuid, defenderUuid: offer.defender.uuid,
			userId: globalThis.game?.user?.id ?? null,
		}, { timeout: 10000 }));
	} catch (err) {
		console.warn("Stonetop | the GM's client could not record a Readiness spend", err);
		return false;
	}
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
	if (!user || !SPEND_KINDS.includes(kind) || !damage) return false;
	const offer = (offersOf(damage)[kind] ?? []).find(o => o.row?.uuid === data.rowUuid && o.defender?.uuid === data.defenderUuid);
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
	const ambush = ownedMove(actor, "Ambush");
	const options = (firstOptionList(ambush?.system?.description)?.items ?? []).map(stripHtmlToText).filter(Boolean);
	const list = !dieTaken && options.length ? `<ul>${options.map(o => `<li>${escHtml(o)}</li>`).join("")}</ul>` : "";
	const said = format(`${KEY}.${dieTaken ? "secondIntentTookDie" : "secondIntent"}`, { name: actor.name });
	return globalThis.ChatMessage?.create?.({
		content: stonetopChatCard(HERO_MOVES.SECOND_INTENT, `<div class="card-content"><p>${escHtml(said)}</p>${list}</div>`, "stonetop-second-intent-card"),
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
	});
}

/** The line a card prints for each spend taken. PURE. */
export function defendNotes(damage) {
	const notes = [];
	const ward = spend => damage.results?.find(r => r.uuid === spend.uuid)?.name ?? "";
	for (const spend of damage?.halvedBy ?? []) {
		notes.push(format(`${KEY}.${spend.how === "parry" ? "noteParry" : "noteHalve"}`, { defender: spend.name, ward: ward(spend) }));
	}
	for (const spend of damage?.standIns ?? []) {
		notes.push(format(`${KEY}.${spend.free ? "noteStandInFree" : "noteStandIn"}`, { defender: spend.name, ward: ward(spend) }));
	}
	for (const spend of damage?.ignoredBy ?? []) {
		notes.push(format(`${KEY}.noteIgnore`, { defender: spend.name }));
	}
	for (const spend of damage?.knockedDownBy ?? []) {
		notes.push(format(`${KEY}.noteKnockedDown`, { defender: spend.name }));
	}
	return notes;
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

	const actions = root.querySelector(".stonetop-attack-actions");
	if (!actions || !root.querySelector(".stonetop-apply-damage")) return;
	// A spend is written to the card: a client that may write it offers one (of several GMs, one), and a
	// player who may not asks the GM's client to (SPEND_QUERY), while a GM is there to.
	if (user?.isGM && !isPrimaryGM()) return;
	const relay = !message.isOwner;
	if (relay && (user?.isGM || !globalThis.game?.users?.activeGM)) return;
	const offers = defendOffers(damage);
	for (const kind of SPEND_KINDS) {
		if (!offers[kind].length) continue;
		const button = document.createElement("button");
		button.type = "button";
		button.className = `stonetop-attack-btn stonetop-damage-defend stonetop-damage-defend--${kind}`;
		const [one] = offers[kind];
		// A Steadfast Guardian's stand-in says it is free, so nobody waits for a Readiness to come off.
		const free = kind === "standIn" && one.cost === 0 ? "Free" : "";
		const label = offers[kind].length === 1
			? format(`${KEY}.${kind}${free}One`, { defender: one.defender.name, ward: one.row.name })
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
