import { escHtml } from "../utils/strings.js";
import { stonetopChatCard } from "../utils/chat.js";
import { STONETOP_SCOPE, resolvedFlagProperty } from "../actors/character/StonetopFlags.js";
import {
	DEATHS_DOOR_FLAG,
	DEATHS_DOOR_ROLLING_FLAG,
	DEATHS_DOOR_STATE,
	HARD_TO_KILL_TRADE_FLAG,
	effectiveDeathsDoorState,
	nextDeathsDoorState,
	raisedFromDead,
	zeroHpMove,
} from "../actors/character/deaths-door.js";
import {
	UNSTOPPABLE_INSTEAD_OPTION, UNSTOPPABLE_REGAIN_OPTION, fightsOnWhenDropped, keepsFightingAtZero, regainInstead,
} from "../actors/character/unstoppable.js";
import { BATTLE_JOY_DROPPED_OPTION, BATTLE_JOY_FLAG } from "../actors/character/battle-joy.js";
import { canKeepOneHp } from "../actors/character/inspiration.js";
import { deletionEntry } from "../utils/foundry-compat.js";
import { format, localize } from "../utils/i18n.js";
import { getSetting } from "../settings.js";
import { bringDialogToFront } from "../utils/front-on-open.js";

// The dying card's strings in languages/en.json, beside the Death's Door window's own.
const _I18N = "stonetop.specialMoves.deathsDoor";

/**
 * Document-update option marking "this write took a dead character above 0 HP". Set by the
 * preUpdate half, read by the update half — Foundry hands both the same options object, which is
 * the only way the second can know what the HP WAS.
 */
export const RAISED_OPTION = "stonetopRaisedFromDead";

/**
 * "When a PC is reduced to 0 HP by an attack that could kill them, they're dying and must
 * make this move" (Book I, Harm & Healing p.245).
 *
 * Nothing used to notice that moment, so the table found out only when someone happened to
 * look at the sheet. This watches the HP write, records the dying state, and posts one card
 * naming the move that PC actually triggers — which is Death's Door only until they take a
 * post-death insert (see deaths-door.js).
 *
 * Nothing here decides that the damage was lethal — that's the GM's call ("an attack that could
 * kill them"). A PC knocked to 0 by something harmless just closes the card.
 *
 * The work is split across the two halves of one write, and which half a thing belongs in comes
 * down to whether it can be taken back.
 *
 * DECIDING is preUpdate's: the document still holds the OUTGOING HP there, so the transition is
 * readable without stashing it, and the state flag folds into the same `changes` object — no
 * second document update, and no way for it to race the HP write.
 *
 * ANNOUNCING is `updateActor`'s. A preUpdate can still be refused, and while a discarded write
 * takes the hit points and the flag with it, it cannot recall a chat card: that stays in the log
 * announcing a death that never happened. So the card waits for the commit and reads the flag
 * back out of the committed diff, which is the same transition one beat later. `updateActor`
 * broadcasts to every client, so both halves below have to claim exactly one — the card by
 * `userId` (whoever applied the damage), the walkthrough by `autoOpenUserId`.
 *
 * The walkthrough can open on its own (setting `deathsDoorAutoOpen`), and never belonged on
 * preUpdate for a second reason: whoever applied the damage is usually the GM, and a dialog
 * opened there lands on the wrong screen. Even auto-opened it remains an invitation, since its
 * Cancel closes it and leaves the card in chat: the book explicitly allows holding the roll off
 * "until the scene wraps up or the other PCs get a little spotlight".
 */
export function onPreUpdateActorDeathsDoor(actor, changes, options = {}) {
	if (actor?.type !== "character") return;

	const raw = foundry.utils.getProperty(changes, "system.attributes.hp.value");
	if (raw === undefined) return;

	// A throw out of a preUpdate hook aborts the document update, so a fault in here would
	// stop HP being written at all — losing damage rather than merely losing the card. Nothing
	// this hook does is worth that, so it fails quiet and lets the write through.
	try {
		let newHp = Number(raw) || 0;
		const oldHp = Number(actor.system?.attributes?.hp?.value) || 0;

		// Unstoppable: "If you would regain HP while fighting, clear one mark instead." Decided here,
		// before the state below reads the hit points, so a Heavy fighting on stays dying: the write
		// keeps its HP where it was and clears the mark in the same update, and the committed half
		// offers the HP back (actors/character/unstoppable.js#onUpdateActorUnstoppable). Never for a
		// write that settles the Door itself (Death's Door's 1 HP, Hard to Kill's trade), which
		// carries the state flag: rolling is when they stopped fighting.
		const named = foundry.utils.getProperty(changes, `flags.${STONETOP_SCOPE}.${DEATHS_DOOR_FLAG}`);
		const settlesDoor = named !== undefined;
		const instead = options[UNSTOPPABLE_REGAIN_OPTION] || settlesDoor ? null : regainInstead(actor, { oldHp, newHp });
		if (instead) {
			foundry.utils.setProperty(changes, "system.attributes.hp.value", oldHp);
			for (const [path, value] of Object.entries(instead.update)) foundry.utils.setProperty(changes, path, value);
			options[UNSTOPPABLE_INSTEAD_OPTION] = { hp: instead.hp, marks: instead.marks };
			newHp = oldHp;
		}
		// Read the same way the character model reads it: `fate-pending` is one of the two states
		// this function refuses to move off, so a stale one left beside an insert would freeze this
		// character's state for good — never dying again, and so never announcing it. See
		// effectiveDeathsDoorState for how the pair used to come about.
		const state = effectiveDeathsDoorState({
			state:      resolvedFlagProperty(actor, DEATHS_DOOR_FLAG) ?? null,
			insertSlug: resolvedFlagProperty(actor, "postDeathInsert.slug") ?? null,
		});
		// A write that settles the Door names the state it leaves them in, and that is its call, not the
		// hit points': Undying's "regain half your max HP" beside "you're out of the action until the next
		// sunset" is HP up AND out of the action, in one write (dialogs/UndeathDialog.js#_onApply), which the
		// HP rule alone would read as "back up, no state" and overwrite.
		const next  = settlesDoor ? (named ?? null) : nextDeathsDoorState({ oldHp, newHp, state });

		if (next !== state) {
			if (!settlesDoor) foundry.utils.setProperty(changes, `flags.${STONETOP_SCOPE}.${DEATHS_DOOR_FLAG}`, next ?? null);
			// A Death's Door roll in progress belongs to ONE brush with death (DEATHS_DOOR_ROLLING_FLAG). Going
			// down afresh, or being brought back up before it lands (the 10+'s own hit point included), ends it
			// in this same write: a marker left over from an earlier visit must never tell the next one that
			// somebody is already rolling, or hand their old card to a Take over.
			if (resolvedFlagProperty(actor, DEATHS_DOOR_ROLLING_FLAG)) {
				const [key, value] = deletionEntry(`flags.${STONETOP_SCOPE}.${DEATHS_DOOR_ROLLING_FLAG}`);
				foundry.utils.setProperty(changes, key, value);
			}
			// So does a Hard to Kill trade left open by the last one's 7-9: a new brush is a new roll.
			if (next === DEATHS_DOOR_STATE.DYING && resolvedFlagProperty(actor, HARD_TO_KILL_TRADE_FLAG)) {
				const [key, value] = deletionEntry(`flags.${STONETOP_SCOPE}.${HARD_TO_KILL_TRADE_FLAG}`);
				foundry.utils.setProperty(changes, key, value);
			}
		}

		// The Heavy's Battle Joy lasts "as long as you keep fighting", and one who drops to 0 HP has
		// stopped (the user's ruling): it ends in this same write, with no roll, so the Death's Door
		// roll that follows takes their debilities again. Not for a Heavy whose Unstoppable keeps them
		// fighting at 0: theirs ends when the fight does (combat/battle-joy-offer.js#actionStops). The
		// committed half says so in chat, off the option.
		if (next === DEATHS_DOOR_STATE.DYING && state !== DEATHS_DOOR_STATE.DYING
			&& resolvedFlagProperty(actor, BATTLE_JOY_FLAG) && !fightsOnWhenDropped(actor)) {
			const [key, value] = deletionEntry(`flags.${STONETOP_SCOPE}.${BATTLE_JOY_FLAG}`);
			foundry.utils.setProperty(changes, key, value);
			options[BATTLE_JOY_DROPPED_OPTION] = true;
		}

		// Someone through the Last Door whose hit points have just gone above 0. Marked on the
		// OPTIONS rather than acted on: `dead` is the one state nothing walks back on its own
		// ("only the rarest of magic can bring them back"), and a GM fixing a typo in the HP box
		// looks identical from here — so the update half asks rather than assuming. The stamp is
		// what makes it a transition: `updateActor` can't see the old HP, and without it a second
		// write while they were up would ask again.
		//
		// NOT subordinate to `deathsDoorPrompt`, unlike the card below and the auto-open. That
		// setting is "Announce When a Character Is Dying" — it silences a piece of table theatre at
		// the moment of a hit. This is not an announcement: it is the only question that can take a
		// sheet back off `dead`, a state nothing else walks back, and a table that wanted the dying
		// card kept quiet has said nothing about wanting resurrections to go unrecorded.
		if (raisedFromDead({ oldHp, newHp, state })) options[RAISED_OPTION] = true;

		// The CARD is not posted here. This hook runs before the update is committed, and the
		// update can still be refused — a later preUpdate hook returning false, a permission, a
		// lost connection — at which point the hit points and the state flag are both discarded
		// together. A card already on its way is not: it stays in the log announcing a death that
		// never happened, with a live "Face Death's Door" button on a character who is not dying.
		// The flag rides `changes` for exactly this reason; the announcement now waits for the
		// same commit, on `updateActor`. See onUpdateActorDeathsDoorCard.
	} catch (err) {
		console.error("Stonetop | Error recording the dying state:", err);
	}
}

/**
 * Is this committed diff the moment the character became dying?
 *
 * The transition itself was already decided by `nextDeathsDoorState` in the preUpdate half, which
 * writes the flag only when the state actually changes — so a downed PC hit again carries no flag
 * in its diff and neither hook below re-fires. Both of them ask this same question, of the same
 * `updateActor` payload (so does We Happy Few's Keep 1 HP), and would otherwise spell the flag path out.
 */
export const becameDyingInDiff = (changes) =>
	foundry.utils.getProperty(changes, `flags.${STONETOP_SCOPE}.${DEATHS_DOOR_FLAG}`) === DEATHS_DOOR_STATE.DYING;

/**
 * The announcement: a card in chat saying this character is down, once the write that put them
 * there has actually landed.
 *
 * Keyed on the state flag arriving as `dying` in the committed diff — the same signal the
 * auto-open below uses, and written only on the transition, so a downed PC hit again does not
 * announce twice. Posting it from `preUpdate` instead read the transition a beat early: correct
 * whenever the update went through, and a permanent card about a death that did not happen
 * whenever it did not.
 *
 * Posted by the user who made the change and nobody else, like the raise prompt: `updateActor`
 * fires on every client, and the card is public, so all of them posting one is N copies. Whoever
 * applied the damage is the natural author and is guaranteed to exist.
 */
export function onUpdateActorDeathsDoorCard(actor, changes, _options = {}, userId = null) {
	if (actor?.type !== "character") return;
	if (!becameDyingInDiff(changes)) return;
	if (userId && userId !== game.user?.id) return;

	try {
		// "Announce When a Character Is Dying" — a table can silence the theatre of the moment.
		if (!getSetting("deathsDoorPrompt")) return;
		postDyingPrompt(actor).catch(err => console.error("Stonetop | Error posting the dying prompt:", err));
	} catch (err) {
		console.error("Stonetop | Error posting the dying prompt:", err);
	}
}

/**
 * The other half: open the walkthrough on the dying character's own screen.
 *
 * Runs on `updateActor`, which fires on EVERY connected client, so the deciding question is
 * which one of them this is — the transition itself is `becameDyingInDiff`'s to answer.
 *
 * Fails quiet for the same reason the preUpdate half does, minus the stakes: a fault here is
 * only a window that didn't open.
 */
export function onUpdateActorDeathsDoorAutoOpen(actor, changes) {
	if (actor?.type !== "character") return;
	if (!becameDyingInDiff(changes)) return;

	try {
		// Subordinate to the announcement: a table that silenced the card doesn't want a window.
		if (!getSetting("deathsDoorPrompt") || !getSetting("deathsDoorAutoOpen")) return;
		if (autoOpenUserId(ownerUsers(actor)) !== game.user?.id) return;

		// Unstoppable: "you can keep fighting ... When you stop fighting, roll for Death's Door." So the
		// walkthrough waits: they are told, the card's button (and the sheet's dying glyph) opens it when
		// they choose, and the fight ending asks for it (combat/battle-joy-offer.js#actionStops).
		if (keepsFightingAtZero(actor)) {
			ui.notifications?.info?.(format("stonetop.unstoppable.fightsOn", { name: actor.name }));
			return;
		}

		// We Happy Few's "Keep 1 HP instead of being reduced to 0 HP": a character holding Inspiration
		// in a fight is asked that first, and the walkthrough opens only if they go down after all
		// (actors/character/inspiration-flow.js#offerKeepOneHp).
		if (canKeepOneHp(actor)) return;

		openZeroHpMove(actor).catch(err => console.error("Stonetop | Error opening the dying walkthrough:", err));
	} catch (err) {
		console.error("Stonetop | Error deciding whether to open the dying walkthrough:", err);
	}
}

/**
 * Ask whether a character through the Last Door is being raised, when their hit points go above 0.
 *
 * `dead` is the only state nothing walks back on its own, deliberately: the book leaves the door
 * open ("only the rarest of magic can bring them back") without letting a hit point do it. But the
 * two things that put HP on a dead sheet look identical to code — a table playing out a
 * resurrection, and a GM tidying a number — so this asks instead of choosing, and the answer is
 * what clears the state.
 *
 * Asked of the user who made the change and nobody else. Every other prompt in this file has to
 * work out which client to claim (see autoOpenUserId); this one doesn't, because the question is
 * about an edit somebody just made and they are the one who can answer it. `userId` is Foundry's
 * own answer to who that was.
 */
export function onUpdateActorDeathsDoorRaised(actor, changes, options = {}, userId = null) {
	if (actor?.type !== "character" || !options?.[RAISED_OPTION]) return;
	if (userId && userId !== game.user?.id) return;

	try {
		promptRaiseFromDead(actor, { fromHp: true })
			.catch(err => console.error("Stonetop | Error asking about the raise:", err));
	} catch (err) {
		console.error("Stonetop | Error asking about the raise:", err);
	}
}

/**
 * The question itself. Two ways in: the hit points going above 0 (above), and the `Dead` tag on the
 * sheet, which is clickable for exactly this — a table that plays out a resurrection without
 * touching HP first has no other route back. `fromHp` adds the one sentence that only makes sense
 * on the first of those.
 *
 * Its own buttons rather than `Dialog.confirm`'s stock Yes/No: against "is that what happened?"
 * both of those read as a shrug, and one of the two answers is a resurrection. The affirmative
 * takes the left, Foundry's order, and neither is the default — closing the window with the X
 * leaves the sheet exactly as it was, which is the safe answer to a question nobody meant to
 * raise.
 *
 * "No" writes nothing at all. The hit points stay where they were put: a GM may well be setting up
 * a body, a vision, or a corpse with numbers on it, and none of that is this hook's business. The
 * only thing at stake here is whether the sheet still says they are dead.
 */
export function promptRaiseFromDead(actor, { fromHp = false } = {}) {
	const name = actor.name ?? "This character";
	const l = (key, data) => (data
		? game.i18n.format(`stonetop.postDeath.${key}`, data)
		: game.i18n.localize(`stonetop.postDeath.${key}`));

	return new Promise(resolve => {
		new Dialog({
			title:   l("raiseTitle", { name }),
			content: `<p>${l("raiseBody", { name })}${fromHp ? ` ${l("raiseHpNote")}` : ""}</p>`
				+ `<p>${l("raiseAsk")}</p>`,
			buttons: {
				yes: {
					icon:     '<i class="fas fa-heart-pulse"></i>',
					label:    l("raiseYes"),
					callback: () => resolve(applyRaise(actor, name, l)),
				},
				no: {
					icon:  '<i class="fas fa-skull"></i>',
					label: l("raiseNo"),
					callback: () => resolve(),
				},
			},
			close:  () => resolve(),
			render: bringDialogToFront,
		}, { classes: ["dialog", "stonetop", "stonetop-raise-dialog"] }).render(true);
	});
}

/** Clear the dead state, and say so. The sheet's black and its tag both hang off this flag. */
async function applyRaise(actor, name, l) {
	try {
		await actor.unsetFlag(STONETOP_SCOPE, DEATHS_DOOR_FLAG);
		ui.notifications?.info?.(l("raised", { name }));
	} catch (err) {
		console.error("Stonetop | Could not clear the dead state:", err);
		ui.notifications?.warn?.(l("raiseFailed"));
	}
}

/**
 * Every user who owns this actor, as the plain shape `autoOpenUserId` rules on.
 *
 * `assigned` is the one that actually answers "who died": the user this character is set as
 * the character OF, in the Foundry user configuration. Ownership can't answer it — a table that
 * lets the party read each other's sheets has several owners per PC, and a player running two
 * characters owns both.
 */
export function ownerUsers(actor) {
	const users = game.users?.contents ?? game.users ?? [];
	return [...users]
		.filter(u => actor?.testUserPermission?.(u, "OWNER"))
		.map(u => ({
			id:       u.id,
			isGM:     !!u.isGM,
			active:   !!u.active,
			assigned: !!actor?.id && u.character?.id === actor.id,
		}));
}

/**
 * The one client that opens the walkthrough, or null for nobody. Pure, and exported for the
 * tests: whose screen this lands on is the whole feature.
 *
 * Three rungs, and the first one is the point of the whole thing:
 *
 *  1. The player this character is ASSIGNED to. It's their brush with death, so it opens in
 *     front of them and nobody else — however many other people can see the sheet.
 *  2. Failing that, any logged-in player who owns them. Covers a PC nobody is playing as their
 *     assigned character: a shared NPC-ish PC, a second character run by one player.
 *  3. Failing that, the GM — but only then. A GM is an owner of every actor in the world and is
 *     usually the one who just applied the damage; they should not catch a window meant for a
 *     player who is sitting right there.
 *
 * Ties within a rung break by lowest id rather than opening for everyone in it: every client
 * runs this same function over the same user list, so they must all reach the same answer or
 * the dialog opens two or three times over.
 */
export function autoOpenUserId(owners = []) {
	const active = owners.filter(u => u?.active);
	const first  = (pool) => pool.map(u => u.id).sort()[0] ?? null;
	return first(active.filter(u => u.assigned))
		?? first(active.filter(u => !u.isGM))
		?? first(active.filter(u => u.isGM));
}

/**
 * Whether THIS client is the one that answers for `actor`: its player, else the GM (autoOpenUserId).
 * The one test for every per-character prompt or write that must happen on exactly one client.
 */
export function answersFor(actor) {
	const me = game.user?.id;
	return !!me && !!actor && autoOpenUserId(ownerUsers(actor)) === me;
}

/**
 * Open the character's 0-HP walkthrough. Both ways in — the card's button and the auto-open —
 * come through here, so there is one answer to "what does facing the Door actually open".
 *
 * Goes through the sheet rather than constructing a dialog: the sheet owns the character model,
 * and its `_onDeathsDoorOpen` routes an insert-carrying character to their own move's
 * walkthrough instead. Re-implementing either here would be a second copy of the same rules.
 */
export async function openZeroHpMove(actor) {
	const sheet = actor?.sheet;
	if (!sheet) return;
	await sheet.render(true);
	await sheet._onDeathsDoorOpen?.();
}

/**
 * The card itself. Public: a PC going down is the whole table's business, and the book has the
 * other players Aiding the roll. The button opens the walkthrough for owners only.
 */
export async function postDyingPrompt(actor) {
	const insertSlug = resolvedFlagProperty(actor, "postDeathInsert.slug") ?? null;
	const move = zeroHpMove(insertSlug);
	const who  = escHtml(actor.name);

	// Death's Door has a walkthrough; an insert's 0-HP move is the character's own move, so the
	// card hands them that instead of a dialog that would say the wrong thing.
	const button = move.dialog
		? `<button type="button" class="stonetop-dying-btn stonetop-dying-open" data-actor="${escHtml(actor.uuid)}">
				<i class="fas fa-door-open"></i> ${localize(`${_I18N}.button`)}
			</button>`
		: `<button type="button" class="stonetop-dying-btn stonetop-dying-move" data-actor="${escHtml(actor.uuid)}" data-move="${escHtml(move.name)}">
				<i class="fas fa-skull"></i> ${escHtml(move.name)}
			</button>`;

	// Markup in the string, so what rides into it is escaped on the way in.
	const lead = move.dialog
		? `<p>${format(`${_I18N}.dyingCard.lead`, { name: who })}</p>`
		: `<p>${format(`${_I18N}.dyingCard.leadUndeath`, { name: who, move: escHtml(move.name) })}</p>`;
	// Unstoppable keeps them in the fight, and the roll waits until they stop (see the auto-open above).
	const fightsOn = keepsFightingAtZero(actor)
		? `<p class="stonetop-dying-unstoppable">${escHtml(format("stonetop.unstoppable.fightsOnCard", { name: actor.name }))}</p>`
		: "";

	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content: stonetopChatCard(move.dialog ? localize(`${_I18N}.title`) : move.name, `<div class="card-content">
			${lead}
			<p class="stonetop-dying-trigger">${move.trigger}</p>
			${fightsOn}
			<div class="card-buttons stonetop-card-buttons stonetop-dying-actions">${button}</div>
		</div>`, "stonetop-dying-card"),
		flags: { [STONETOP_SCOPE]: { dying: { actorUuid: actor.uuid, move: move.name } } },
	});
}

/**
 * Wire the prompt card's button (dispatched from stonetop.js renderChatMessageHTML).
 * Non-owners see it disabled: whose brush with death this is matters.
 */
export function wireDyingPrompt(message, html, { user = globalThis.game?.user } = {}) {
	const root = html?.[0] ?? html;
	const btn = root.querySelector(".stonetop-dying-open, .stonetop-dying-move");
	if (!btn) return;

	const doc   = fromUuidSync(btn.dataset.actor);
	const actor = doc?.actor ?? doc;
	if (!actor?.isOwner) { btn.disabled = true; return; }

	btn.addEventListener("click", () => openZeroHpMove(actor));
	if (user?.isGM) wireDyingGmButtons(root, actor);
}

/**
 * The 0-HP moves whose trigger asks whether the blow could kill: Death's Door ("When a PC is reduced to 0 HP by
 * an attack that could kill them, they're dying", p.245) and Dark Succor ("When you are dying or killed
 * outright", p.152). Undying and Tethered trigger "When you are reduced to 0 HP" (p.150, p.148), lethal or not,
 * so a GM's "not lethal" has nothing to call off for them.
 */
const LETHALITY_MOVES = new Set([zeroHpMove(null).name, zeroHpMove("thrall").name]);

/**
 * What the GM may rule from the dying card right now, off the character's hit points, Death's Door state and
 * the 0-HP move they trigger (`insertSlug`, as zeroHpMove reads it). Pure. The card lives in the log long after
 * the moment, so it is asked at every draw and again at the press.
 *
 *  • `notLethal` while they are dying, on a move that asks about lethality (LETHALITY_MOVES): "If the source
 *    of damage isn't likely to kill anyone, then the PC is simply out of the action" (p.240). The hit points
 *    dropped them, but whether it was lethal is the GM's call.
 *  • `markDying` at 0 HP with nothing owed (out of the action, or nothing at all): "They might also be dying
 *    because the fiction demands it" (p.245). A character already at 0 HP who takes a lethal blow writes no new
 *    hit points, so nothing else can send them to the Door.
 */
export function dyingCardGmOptions({ hp = 0, state = null, insertSlug = null } = {}) {
	return {
		notLethal: state === DEATHS_DOOR_STATE.DYING && LETHALITY_MOVES.has(zeroHpMove(insertSlug).name),
		markDying: (Number(hp) || 0) <= 0 && (state === null || state === DEATHS_DOOR_STATE.OUT_OF_ACTION),
	};
}

/** The character's hit points, Death's Door state as it should be read, and insert, for dyingCardGmOptions. */
function dyingCardFacts(actor) {
	const insertSlug = resolvedFlagProperty(actor, "postDeathInsert.slug") ?? null;
	return {
		hp: Number(actor?.system?.attributes?.hp?.value) || 0,
		state: effectiveDeathsDoorState({
			state:      resolvedFlagProperty(actor, DEATHS_DOOR_FLAG) ?? null,
			insertSlug,
		}),
		insertSlug,
	};
}

/**
 * The GM's ruling that what dropped them was not lethal: out of the action, and no Death's Door (or Dark Succor)
 * to face (p.240). Refused for Undying and Tethered, which trigger on any drop to 0 HP (dyingCardGmOptions).
 * One write, the state and the end of any roll in progress with it (a window still rolling lands nothing: it
 * reads the character as no longer dying). The GM writes every actor, so it is written here. Whether it was.
 */
export async function markNotLethal(actor) {
	const facts = dyingCardFacts(actor);
	if (!dyingCardGmOptions(facts).notLethal) {
		// Dying on Undying or Tethered: the move triggers on 0 HP however it came, so there is nothing to call off.
		const move = zeroHpMove(facts.insertSlug);
		ui.notifications?.info?.(facts.state === DEATHS_DOOR_STATE.DYING && !LETHALITY_MOVES.has(move.name)
			? format(`${_I18N}.dyingCard.notLethalUndeath`, { name: actor?.name ?? "", move: move.name })
			: format(`${_I18N}.dyingCard.notDying`, { name: actor?.name ?? "" }));
		return false;
	}
	await actor.update({
		[`flags.${STONETOP_SCOPE}.${DEATHS_DOOR_FLAG}`]: DEATHS_DOOR_STATE.OUT_OF_ACTION,
		...Object.fromEntries([deletionEntry(`flags.${STONETOP_SCOPE}.${DEATHS_DOOR_ROLLING_FLAG}`)]),
	}, { stonetopMove: localize(`${_I18N}.title`) });
	await postDyingCard(actor, localize(`${_I18N}.title`), `
			<p>${format(`${_I18N}.dyingCard.notLethalCard`, { name: escHtml(actor.name) })}</p>
		`);
	return true;
}

/**
 * A card in the dying card's skin, `title` over `body` (markup, escaped by the caller), spoken as `actor` (or
 * as whoever is speaking, with none): the GM's not-lethal ruling here, and the Death's Door window's own lines
 * (dialogs/DeathsDoorDialog.js, Hard to Kill's trade among them).
 */
export async function postDyingCard(actor, title, body) {
	await ChatMessage.create({
		speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker(),
		content: stonetopChatCard(title, `<div class="card-content">${body}</div>`, "stonetop-dying-card"),
	});
}

/**
 * The GM sending a character already at 0 HP to the Door, because the fiction demands it (p.245). Written as the
 * hit points would have written it, so the same hooks answer: the dying card is posted and the walkthrough opens
 * on their player's screen (onUpdateActorDeathsDoorCard, onUpdateActorDeathsDoorAutoOpen). Whether it was.
 */
export async function markDyingByFiat(actor) {
	if (!dyingCardGmOptions(dyingCardFacts(actor)).markDying) {
		ui.notifications?.info?.(format(`${_I18N}.dyingCard.cannotMarkDying`, { name: actor?.name ?? "" }));
		return false;
	}
	// A new brush with death: whatever the last one's 7-9 left open for Hard to Kill goes with it, as on the HP path.
	await actor.update({
		[`flags.${STONETOP_SCOPE}.${DEATHS_DOOR_FLAG}`]: DEATHS_DOOR_STATE.DYING,
		...Object.fromEntries([deletionEntry(`flags.${STONETOP_SCOPE}.${HARD_TO_KILL_TRADE_FLAG}`)]),
	}, { stonetopMove: localize(`${_I18N}.title`) });
	return true;
}

/**
 * The GM's two buttons on the dying card, after the character's own: drawn on the GM's client only, on every
 * dying card (one posted before they existed included), and each enabled only while its ruling still applies.
 */
function wireDyingGmButtons(root, actor) {
	const row = root.querySelector(".stonetop-dying-actions");
	if (!row || row.querySelector(".stonetop-dying-gm")) return;
	const allowed = dyingCardGmOptions(dyingCardFacts(actor));
	const make = (cls, icon, key, enabled, act) => {
		const button = (root.ownerDocument ?? globalThis.document).createElement("button");
		button.type = "button";
		button.className = `stonetop-dying-btn stonetop-dying-gm ${cls}`;
		button.innerHTML = `<i class="fas ${icon}"></i> ${escHtml(localize(`${_I18N}.dyingCard.${key}`))}`;
		button.dataset.tooltip = localize(`${_I18N}.dyingCard.${key}Hint`);
		button.disabled = !enabled;
		button.addEventListener("click", async () => {
			if (button.disabled) return;
			button.disabled = true;
			try {
				await act(actor);
			} catch (err) {
				console.error("Stonetop | the GM's ruling on the dying card failed", err);
				button.disabled = false;
			}
		});
		row.appendChild(button);
	};
	make("stonetop-dying-not-lethal", "fa-bed", "notLethal", allowed.notLethal, markNotLethal);
	make("stonetop-dying-mark", "fa-skull", "markDying", allowed.markDying, markDyingByFiat);
}
