/**
 * The "Give advantage to..." button at the table (the rules and the button are give-advantage.js's).
 *
 * Only whoever can write the card and the giver presses it (the giver's player, or the GM:
 * chat.js#canRewriteCard). A character this client owns is written here; any other goes to the GM's
 * client (GIVE_ADVANTAGE_QUERY), whose handler checks the asker plays the giver and has the move
 * learned, as Piety's Blessing is given. The card is latched on the press (GIVING_FLAG) and
 * remembers who it gave it to (GIVEN_FLAG), so the button goes once pressed.
 */

import { SYSTEM_ID } from "../../system-id.js";
import { ownsLearnedMoveNamed } from "./owns-move.js";
import { GIVE_ADVANTAGE_MOVES, advantageRecipients, givenSource, mayReceive } from "./give-advantage.js";
import { asteriskMoveUsed } from "./WouldBeHeroAsterisk.js";
import { pickPersonOnMap } from "../../dialogs/RelationshipLinkDialog.js";
import { partyCharacters } from "../../utils/playbook-actors.js";
import { canRewriteCard, stonetopChatCard } from "../../utils/chat.js";
import { HERO_MOVES, commandHeld, orderFocusFire } from "../../fight/hero-moves.js";
import { belongsToMessage } from "../../utils/picked-option-button.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
import { askGMClient, deletionEntry, queryAsker, resolveSync } from "../../utils/foundry-compat.js";
import { withCardLatch } from "../../utils/card-latch.js";
import { cardCountedTier, outcomeTier } from "../../utils/counted-tier.js";
import { format, localize } from "../../utils/i18n.js";
import { learnedTrack, takeBackHeld } from "./MoveResources.js";
import { escHtml, joinNames } from "../../utils/strings.js";

/** The User query a gift of advantage goes through when this client cannot write the character. */
export const GIVE_ADVANTAGE_QUERY = "stonetop.giveAdvantage";
/**
 * Message flag: who this card gave its advantage to, `{name, move, uuid, source}`: the character's uuid and
 * the name the promise is held under, so a card moved off the tier that gave it can take it back
 * (reconcileGivenAdvantage). A card from before carries `{name, move}` only, and keeps its gift.
 */
export const GIVEN_FLAG = "advantageGiven";
/**
 * Message flag: the user whose press is giving it (card-latch.js#withCardLatch), written before the
 * picker opens, so another client's button goes while they choose.
 */
export const GIVING_FLAG = "advantageGiving";

/** The cards this client is choosing on right now, by message id. */
const _choosing = new Set();

/**
 * Hold advantage on `target`'s next roll for `moveName`: written here when this client owns them,
 * otherwise by the GM's client. Whether it was held.
 */
export async function giveAdvantage(giver, target, moveName, {
	gm = globalThis.game?.users?.activeGM ?? null, userId = globalThis.game?.user?.id ?? null,
} = {}) {
	if (target?.type !== "character") return false;
	if (!mayReceive(giver, target, moveName)) return false;
	if (target.isOwner) {
		await target.typedActor?.holdAdvantage?.(givenSource(moveName, giver, target));
		return true;
	}
	return !!(await askGMClient(gm, GIVE_ADVANTAGE_QUERY, {
		giverUuid: giver?.uuid ?? null, targetUuid: target.uuid, moveName, userId,
	}, { fallback: false, what: "give advantage" }));
}

/**
 * The GM's side of GIVE_ADVANTAGE_QUERY, for the primary GM only: the asker must play the giver, the
 * giver hold the move learned, and the target be a character the move allows. Who asked is read as
 * roll-boosts.js reads it (foundry-compat.js#queryAsker). Whether it was held.
 */
export async function handleGiveAdvantageQuery(data, context = {}, deps = {}) {
	const { users = globalThis.game?.users, resolve = resolveSync } = deps;
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return false;
	const user = queryAsker(data, context, users);
	const giver = data?.giverUuid ? resolve(data.giverUuid) : null;
	const target = data?.targetUuid ? resolve(data.targetUuid) : null;
	const moveName = data?.moveName;
	if (!user || !GIVE_ADVANTAGE_MOVES[moveName] || !giver?.testUserPermission?.(user, "OWNER")) return false;
	if (!ownsLearnedMoveNamed(giver, moveName) || target?.type !== "character") return false;
	if (!mayReceive(giver, target, moveName)) return false;
	await target.typedActor?.holdAdvantage?.(givenSource(moveName, giver, target));
	return true;
}

/**
 * A roll card's total has moved (a Shift, a +1, Burn Brightly): a gift its tier gave is taken back once the
 * card no longer stands on a tier that gives it (Everything Burns' 10+, Work With What You've Got's 7+,
 * Resourceful's 6-), as the other things a tier holds are (tier-effects.js). The card forgets it gave
 * anything, so its button is back should the card return to such a tier (unless the gift was already spent,
 * below). Run where every rewrite's tier
 * effects run (tier-effects.js#reconcileTierEffects), on the client that rewrote the card.
 *
 * Left as it is when this client cannot write the character who holds it, and for a card from before the
 * gift's uuid was kept: a card that forgot a gift it could not take back would let it be given twice. For
 * the same reason a gift already SPENT (used on a roll since) is not forgotten: the card marks it `spent`
 * and keeps its readout, and its button never comes back.
 * Whether it was taken back.
 *
 * @param {ChatMessage} message
 * @param {number} total  the card's new total
 */
export async function reconcileGivenAdvantage(message, total, { scope = SYSTEM_ID, resolve = resolveSync } = {}) {
	const given = message?.getFlag?.(scope, GIVEN_FLAG);
	const tiers = GIVE_ADVANTAGE_MOVES[given?.move]?.tiers;
	if (!given?.uuid || given.spent || !tiers?.length || !Number.isFinite(Number(total))) return false;
	if (tiers.includes(outcomeTier(cardCountedTier(message, Number(total), scope)))) return false;
	const target = resolve(given.uuid);
	if (target && target.isOwner === false) {
		console.warn(`Stonetop | this client cannot write ${target.name}, so the advantage their moved roll card gave was not taken back`);
		return false;
	}
	const released = await target?.typedActor?.releaseHeldAdvantage?.(given.source ?? given.move);
	// Nothing held to take back (spent on a roll since, or the character gone): the card keeps its record,
	// marked spent, so a card brought back onto the tier does not give the same roll's advantage twice.
	if (!released) {
		await message.setFlag(scope, GIVEN_FLAG, { ...given, spent: true });
		return false;
	}
	const update = Object.fromEntries([GIVEN_FLAG, GIVING_FLAG]
		.filter(key => message.getFlag(scope, key) !== undefined && message.getFlag(scope, key) !== null)
		.map(key => deletionEntry(`flags.${scope}.${key}`)));
	if (Object.keys(update).length) await message.update(update);
	return true;
}

/**
 * Ask who, give it, and write it on the card. Whether it was given. `stillMine`, from the card's
 * button, answers whether this client still holds the card's latch once someone is picked: when
 * another client pressed it too, the later press holds the card, and this one gives nothing and
 * answers true, so the latch it lost is not taken back from the other.
 *
 * A `selfOnly` move (Resourceful, Inquiring Minds) asks nobody: the giver is the one who holds it.
 */
export async function offerAdvantage(message, giver, moveName, {
	pick = pickPersonOnMap, party = partyCharacters, give = giveAdvantage, scope = SYSTEM_ID, stillMine = null,
} = {}) {
	const rule = GIVE_ADVANTAGE_MOVES[moveName];
	const selfOnly = !!rule?.selfOnly;
	// A press paid for off a hold (Stentorian's Command): refused, and nothing asked, with none held.
	if (rule?.spendHeld && !(learnedTrack(giver, rule.spendHeld)?.held > 0)) {
		globalThis.ui?.notifications?.warn?.(format("stonetop.heldAdvantage.noneHeld", { move: rule.spendHeld }));
		return false;
	}
	const recipients = advantageRecipients(giver, moveName, selfOnly ? [] : party({ exclude: giver?.id }));
	if (!recipients.length) {
		globalThis.ui?.notifications?.info?.("There is no other player character to give it to.");
		return false;
	}
	const options = recipients.map(actor => ({ id: actor.id, name: actor.name, actor, hint: actor.id === giver?.id ? "You" : "" }));
	// "PCs get advantage" (Stentorian): whoever heard, ticked in one window.
	const ids = selfOnly ? [giver?.id] : [await pick({
		options,
		multiple: !!rule?.many,
		title: `${moveName}: advantage on the next roll`,
		hint: rule?.many ? localize("stonetop.heldAdvantage.whoHeard") : "Who gains advantage on their next roll?",
		icon: "fa-angles-up",
		buttonLabel: "Choose someone",
		formatLabel: name => `Give ${name} advantage`,
		formatManyLabel: count => `Give ${count} of them advantage`,
	})].flat();
	const targets = recipients.filter(actor => ids.includes(actor.id));
	if (!targets.length) return false;
	if (stillMine && !stillMine()) return true;
	const gave = await Promise.all(targets.map(target => give(giver, target, moveName)));
	const given = targets.filter((target, i) => gave[i]);
	for (const target of targets.filter((target, i) => !gave[i])) {
		globalThis.ui?.notifications?.warn?.(`${target.name} could not be given advantage: no GM is online to write it.`);
	}
	if (!given.length) return false;
	// Paid once the advantage is held, so a press that gave nobody anything costs nothing.
	if (rule?.spendHeld) await takeBackHeld(giver, rule.spendHeld, 1);
	const [target] = given;
	const names = joinNames(given.map(actor => actor.name));
	await message.setFlag(scope, GIVEN_FLAG, {
		name: names, move: moveName, uuid: target.uuid ?? null, source: givenSource(moveName, giver, target),
		...(given.length > 1 ? { several: true } : {}),
	});
	globalThis.ui?.notifications?.info?.(`${names} ${given.length > 1 ? "have" : "has"} advantage on their next roll (${moveName}).`);
	// Voice of Experience's advice given is a use of the starred move: the first crosses off "Would-be"
	// (WouldBeHeroAsterisk.js). Never at the cost of the gift, which is already held and written.
	await asteriskMoveUsed(giver, moveName).catch(err => console.warn(`Stonetop | could not note ${moveName}'s use`, err));
	return true;
}

/**
 * Wire a card's "Give advantage to..." buttons (stonetop.js renderChatMessageHTML). Once given, the
 * button is replaced by who has it; before then, only whoever can write the card and the giver sees
 * it.
 */
export function wireGiveAdvantage(message, html, deps = {}) {
	const root = html?.[0] ?? html;
	const scope = deps.scope ?? SYSTEM_ID;
	const buttons = [...(root?.querySelectorAll?.(".stonetop-give-advantage") ?? [])].filter(btn => belongsToMessage(btn, message));
	if (!buttons.length) return;
	const giver = deps.giver ?? speakerActor(message);
	const given = message?.getFlag?.(scope, GIVEN_FLAG) ?? null;
	const usable = deps.usable ?? canRewriteCard(message, giver);
	const me = deps.userId ?? globalThis.game?.user?.id ?? "";
	// Someone is choosing: another user, or this client already (a re-render mid-choice). A latch of
	// this user's own with nothing in flight (a reload mid-choice) is theirs to press again.
	const giving = message?.getFlag?.(scope, GIVING_FLAG) ?? null;
	const heldElsewhere = (!!giving && giving !== me) || _choosing.has(message?.id);
	for (const btn of buttons) {
		if (given?.name) {
			const doc = root.ownerDocument ?? globalThis.document;
			const note = doc.createElement("span");
			note.className = "stonetop-give-advantage-readout";
			note.textContent = given.spent
				? format("stonetop.heldAdvantage.givenSpent", { name: given.name })
				: `${given.name} ${given.several ? "have" : "has"} advantage on their next roll.`;
			btn.replaceWith(note);
			continue;
		}
		const moveName = btn.dataset?.move;
		if (!usable || !giver || !GIVE_ADVANTAGE_MOVES[moveName]) { btn.remove(); continue; }
		btn.disabled = heldElsewhere;
		if (btn.dataset.giveWired === "1") continue;
		btn.dataset.giveWired = "1";
		// Latched on the card FIRST (card-latch.js), as every once-per-card button is: the GM and
		// the giver's player can both press it, and a gift is given once.
		btn.addEventListener("click", async () => {
			if (btn.disabled) return;
			const stillMine = () => message.getFlag(scope, GIVING_FLAG) === me;
			_choosing.add(message.id);
			try {
				await withCardLatch(message, GIVING_FLAG, me, buttons,
					() => offerAdvantage(message, giver, moveName, { ...deps, stillMine }));
			} catch (err) {
				console.error(`Stonetop | ${moveName}'s advantage could not be given`, err);
			} finally {
				_choosing.delete(message.id);
			}
		});
	}
}

/** Message flag: the foe a Focus Fire card's order named, `{foe}`, so its button goes once pressed. */
export const FOCUS_FIRE_CARD_FLAG = "focusFireOrdered";

/** The tokens this user has targeted on the map. */
const userTargets = () => [...(globalThis.game?.user?.targets ?? [])];

/**
 * Wire Focus Fire's button (give-advantage.js#focusFireCardHtml): pressed by whoever can write the card and
 * the Marshal, at the ONE foe they have targeted, it spends 1 Command and gives the order
 * (fight/hero-moves.js#orderFocusFire). The card then says whom, and the button goes. Wired on its own
 * (stonetop.js renderChatMessageHTML), beside the giving moves' buttons on the same posted cards.
 */
export function wireFocusFire(message, html, deps = {}) {
	const root = html?.[0] ?? html;
	const buttons = [...(root?.querySelectorAll?.(".stonetop-focus-fire") ?? [])].filter(btn => belongsToMessage(btn, message));
	if (!buttons.length) return;
	const scope = deps.scope ?? SYSTEM_ID;
	const marshal = deps.giver ?? speakerActor(message);
	const ordered = message?.getFlag?.(scope, FOCUS_FIRE_CARD_FLAG) ?? null;
	const usable = deps.usable ?? canRewriteCard(message, marshal);
	const order = deps.order ?? orderFocusFire;
	const targets = deps.targets ?? userTargets;
	for (const btn of buttons) {
		if (ordered?.foe) {
			const doc = root.ownerDocument ?? globalThis.document;
			const note = doc.createElement("span");
			note.className = "stonetop-give-advantage-readout";
			note.textContent = format("stonetop.fight.heroMoves.focusFire.readout", { foe: ordered.foe });
			btn.replaceWith(note);
			continue;
		}
		if (!usable || !marshal) { btn.remove(); continue; }
		if (btn.dataset.focusWired === "1") continue;
		btn.dataset.focusWired = "1";
		btn.addEventListener("click", async () => {
			if (btn.disabled) return;
			const aimed = targets();
			if (aimed.length !== 1) {
				globalThis.ui?.notifications?.info?.(localize("stonetop.fight.heroMoves.focusFire.targetOne"));
				return;
			}
			if (!commandHeld(marshal)) {
				globalThis.ui?.notifications?.warn?.(format("stonetop.heldAdvantage.noneHeld", { move: HERO_MOVES.STENTORIAN }));
				return;
			}
			btn.disabled = true;
			try {
				const [token] = aimed;
				const foe = { uuid: token?.document?.uuid ?? token?.uuid ?? "", name: token?.name ?? token?.document?.name ?? "" };
				const entry = await order(marshal, foe);
				if (!entry) { btn.disabled = false; return; }
				await message.setFlag(scope, FOCUS_FIRE_CARD_FLAG, { foe: entry.name || foe.name });
				await globalThis.ChatMessage?.create?.({
					content: stonetopChatCard(HERO_MOVES.FOCUS_FIRE, `<div class="card-content"><p>${escHtml(format("stonetop.fight.heroMoves.focusFire.card", { name: marshal.name, foe: entry.name || foe.name }))}</p></div>`, "stonetop-focus-fire-card"),
					speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: marshal }),
				});
			} catch (err) {
				console.error("Stonetop | Focus Fire could not be ordered", err);
				btn.disabled = false;
			}
		});
	}
}
