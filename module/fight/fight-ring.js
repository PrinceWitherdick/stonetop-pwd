// The fight ring: click a token that is in the fight, and what it does in a fight comes up around it.
//
// Core puts its token HUD round a token on a RIGHT-click (visibility, effects, configuration). A plain
// LEFT-click on a token in the fight puts this one there instead, laid out the same way, so a player can
// act without opening a sheet:
//  • a character: Clash, Let Fly, Defend and Defy Danger on the left, their damage die on the right, and while they
//    hold Readiness, Defend's "strike back at an attacker (deal your damage, with disadvantage)" (p.216),
//    Big Damn Hero's "lock eyes with an attacker" for a Would-Be Hero who has it, and the Readiness they
//    hold, shown over the token so the table can see what they have to spend;
//  • a monster: one button per blow its stat block rolls, on the right. The Gwyllgi offers its claws,
//    its bite, and the baleful cloud its move breathes;
//  • a follower: Clash, Let Fly, Defend and Order on the left, their damage on the right;
//  • any other NPC: its damage, on the right.
// A monster gets no Clash or Let Fly: those are the players' moves, and the GM does not roll them. A
// follower does get them, because a follower ordered to Clash triggers the player move and their
// character rolls it for them (Order Followers, Book I p.462) — see fight/follower-fight.js.
//
// EVERY BUTTON IS A CLICK THE SHEET ALREADY HAS. Clash and Let Fly go through the character sheet's
// `rollMoveById`, the door a move on the hotbar uses, so the weapon pick, targets, damage window and
// counter-attack all happen exactly as from the Moves tab. A follower's three go through that same
// sheet's `orderFollower`, the door its Followers tab uses. A damage button makes the same call as
// that stat block's own die (combat/attack-flow.js#rollDamageAt): the same card title, tags,
// advantage, fight pre-fill, and target, which is whoever the token is fighting. The ring cannot roll
// something the sheet would not.
//
// WHO GETS IT: whoever just selected the token, which is core's rule for who may (a player their
// character and followers, the GM everyone), with the Select tool, and without Shift, Ctrl, Alt or
// Meta held (adding to a selection is not asking for a ring). A drag moves the token and opens nothing.
//
// IT GOES AWAY like core's HUD does: any press on the map, pressing the same token again, the token
// being released or deleted, the token leaving the fight, the map closing. A button closes it as it rolls.
//
// ZOOM: it is drawn in map space like core's HUD, so it follows the token as the map pans and zooms. It
// never gets smaller ON SCREEN than its natural size, though: zoomed out, core's buttons shrink to specks,
// and a player on a screen magnifier has to be able to read these.

import { SYSTEM_ID } from "../system-id.js";
import { isFightTabEnabled, isFightRingOn } from "../settings.js";
import { fightOnScene } from "./fight-state.js";
import { damageBlows, damageCardText, printedBlow } from "../utils/damage.js";
import { pcDamageDie, rollDamageAt, rollCharacterDamageAt, letFlyAmmoStatuses } from "../combat/attack-flow.js";
import { followerRingInfo, openFollowerOrder } from "./follower-fight.js";
import { heldReadiness } from "../combat/defend-readiness.js";
import { spendReadiness, pickOne } from "./defend-spend.js";
import { HERO_MOVES, lockEyesCandidates, lockEyes } from "./hero-moves.js";
import { ownsLearnedMoveNamed } from "../actors/character/owns-move.js";
import { rollerEngagement } from "./damage-seed.js";
import { escHtml } from "../utils/strings.js";
import { stonetopChatCard } from "../utils/chat.js";
import { format, localize } from "../utils/i18n.js";

// A plain literal, not built from SYSTEM_ID: the precache check in tests finds template paths by it.
const RING_TEMPLATE = "systems/stonetop-pwd/templates/hud/fight-ring.hbs";

/**
 * The moves a ring offers, left column top to bottom. A character rolls the move item of that name;
 * a follower is ORDERED to it, so the same row carries the key the Order dialog knows it by.
 */
export const RING_MOVES = [
	{ name: "Clash", icon: "fa-solid fa-swords", orderKey: "clash" },
	{ name: "Let Fly", icon: "fa-solid fa-bow-arrow", orderKey: "let-fly" },
	// The third fighting move (p.216): holding a position, or jumping in for someone.
	{ name: "Defend", icon: "fa-solid fa-shield", orderKey: "defend" },
	// Not a fighting move, but the one a fight asks for most: ducking the club, crossing the melee. A
	// character's only: a follower's Order button already opens on it, the book's default (Order Followers).
	{ name: "Defy Danger", icon: "fa-solid fa-person-running", orderKey: "defy-danger", characterOnly: true },
];

/** The glyph on Defend's strike back, the one spend of Readiness that is a roll of its own. */
const STRIKE_BACK_ICON = "fa-solid fa-shield-halved";

/** The glyph on Big Damn Hero's lock eyes. */
const LOCK_EYES_ICON = "fa-solid fa-eye";

/** The glyph on a follower's plain Order button, which opens the dialog on no particular move. */
const ORDER_ICON = "fa-solid fa-hand-point-right";

/** Tools a click on a token means something else under: aiming, and measuring. */
const OTHER_TOOLS = new Set(["target", "ruler"]);

/** The dice Font Awesome draws a face for. */
const DRAWN_DICE = new Set([4, 6, 8, 10, 12, 20]);

/** A formula's glyph: the die it opens with, when there is a drawing of that die. */
export function dieIcon(formula) {
	const sides = Number(/d(\d+)/i.exec(String(formula ?? ""))?.[1]);
	return DRAWN_DICE.has(sides) ? `fa-solid fa-dice-d${sides}` : "fa-solid fa-dice";
}

/** An actor's items, in the order its sheet lists them. */
function itemsOf(actor) {
	const items = typeof actor?.items?.[Symbol.iterator] === "function" ? [...actor.items] : [];
	return items.sort((a, b) => (Number(a?.sort) || 0) - (Number(b?.sort) || 0));
}

/** A formula as a button and a card print it: no spaces. */
const tidy = formula => String(formula ?? "").replace(/\s+/g, "");

/**
 * @typedef {object} RingButton
 * @property {"move"|"damage"|"item"|"order"|"strikeBack"|"lockEyes"} run  roll a character's move through
 *   their sheet, roll a damage formula, roll a stat block's move item, order a follower to a move, spend a
 *   Readiness to strike back, or spend one to lock eyes with a foe (Big Damn Hero)
 * @property {string} label       the button's text, and a damage card's title
 * @property {string} icon        Font Awesome classes
 * @property {string} [itemId]    the move ("move", "item")
 * @property {string} [formula]   the die ("damage"), or the die a move rolls ("item"), shown on the button
 * @property {string} [keywords]  what a damage card prints beside the total: the blow's tags
 * @property {string} [rollMode]  "adv"/"dis"/"normal", as the stat block's own button passes it
 * @property {object|null} [weapon]  the blow's armor clause for Apply (utils/damage.js#attackWeapon)
 * @property {object} [order]     whose follower this is, and what the Order dialog weighs ("order")
 * @property {string|null} [moveKey]  the move that dialog starts on, or null for its default ("order")
 * @property {string} [aria]      this button's own spoken name, where the usual wording will not do
 */

/**
 * What an actor's ring holds.
 *
 * @param {Actor} actor         the token's actor (its own, for an unlinked token)
 * @param {object} [p]
 * @param {string} [p.die]      a character's damage die (combat/attack-flow.js#pcDamageDie), which
 *   takes a lookup to work out and so is asked for by the caller
 * @param {object|null} [p.order]  for a follower, fight/follower-fight.js#followerOrderInfo — also a
 *   lookup (whose follower is this?), so it too is asked for by the caller
 * @param {object|null} [p.swarm]  for a group follower, fight/follower-fight.js#followerSwarm — the
 *   same lookup, which is why ringButtonsFor gets both from followerRingInfo at once
 * @param {number} [p.readiness]  a character's held Defend Readiness
 * @param {boolean} [p.canLockEyes]  a foe in the fight they could lock eyes with (Big Damn Hero)
 * @param {{name: string, label: string, allOut: boolean}[]} [p.ammo]  a character's carried Let Fly
 *   weapons that are low or out (combat/attack-flow.js#letFlyAmmoStatuses), shown on the Let Fly button
 * @param {boolean} [p.ammoOut]  whether nothing they carry for Let Fly has any left, weapons full or
 *   with no track included, which `ammo` alone cannot say
 * @returns {{moves: RingButton[], damage: RingButton[], readiness: number}}
 */
export function ringButtons(actor, { die = "", order = null, swarm = null, readiness = 0, canLockEyes = false, canStrikeBack = true, ammo = [], ammoOut = false } = {}) {
	const moves = [];
	const damage = [];
	const system = actor?.system ?? {};
	const printed = system.attributes?.damage ?? {};
	const damageText = localize("stonetop.fight.ring.damage");

	if (actor?.type === "character") {
		const items = itemsOf(actor);
		for (const { name, icon } of RING_MOVES) {
			const item = items.find(i => i?.type === "move" && i.name === name);
			if (!item) continue;
			const button = { run: "move", itemId: item.id, label: item.name, icon };
			// A bow that is low or out says so on the button that fires it, before the dice are thrown.
			if (name === "Let Fly" && ammo?.length) {
				button.ammo = ammo;
				button.ammoOut = !!ammoOut;
			}
			moves.push(button);
		}
		// Big Damn Hero: "When you Defend, you can spend 1 Readiness to lock eyes with an attacker".
		if (readiness > 0 && canLockEyes && ownsLearnedMoveNamed(actor, HERO_MOVES.BIG_DAMN_HERO)) {
			moves.push({ run: "lockEyes", label: localize("stonetop.fight.ring.lockEyes"), icon: LOCK_EYES_ICON, aria: format("stonetop.fight.ring.lockEyesAria", { readiness }) });
		}
		// The sheet's Damage button: the die, titled "Damage", carrying no armor clause of its own.
		const formula = tidy(die);
		// The die is the button's face only: the roll asks which weapon is in hand and rolls ITS die
		// (combat/attack-flow.js#rollCharacterDamageAt).
		if (formula) damage.push({ run: "damage", label: damageText, formula, icon: dieIcon(formula) });
		// Held Readiness can be spent to "strike back at an attacker (deal your damage, with disadvantage)"
		// (p.216): the same roll, with disadvantage, and one Readiness gone. Only while somebody is
		// attacking them: "they can't ... strike back at a foe that's out of reach".
		if (formula && readiness > 0 && canStrikeBack) {
			damage.push({
				run: "strikeBack", label: localize("stonetop.fight.ring.strikeBack"), formula, rollMode: "dis",
				icon: STRIKE_BACK_ICON,
				aria: format(ownsLearnedMoveNamed(actor, HERO_MOVES.DANGEROUS) ? "stonetop.fight.ring.strikeBackAriaDangerous" : "stonetop.fight.ring.strikeBackAria", { formula, readiness }),
			});
		}
	}

	else if (actor?.type === "monster") {
		// One button per blow on the damage line, read by the reader the stat block's buttons use
		// (utils/damage.js#damageBlows): its name, die, tags, advantage and armor clause.
		for (const { formula, title, keywords, rollMode, weapon } of damageBlows(printed.value)) {
			if (!formula) continue;
			damage.push({ run: "damage", label: title || damageText, formula, keywords, rollMode: rollMode || "normal", weapon, icon: dieIcon(formula) });
		}
		// A stat block written by hand may keep its die only in the formula field.
		const fallback = tidy(printed.rollFormula);
		if (!damage.length && fallback) {
			damage.push({ run: "damage", label: damageText, formula: fallback, keywords: "", rollMode: "normal", weapon: null, icon: dieIcon(fallback) });
		}
		// And every move with a die of its own: a monster's second attack often lives there (utils/damage.js#foeAttacks).
		for (const item of itemsOf(actor)) {
			const formula = tidy(item?.system?.rollFormula);
			if (item?.type !== "monsterMove" || !formula) continue;
			damage.push({ run: "item", itemId: item.id, label: damageCardText(item.name, formula).title || item.name, formula, icon: dieIcon(formula) });
		}
	}

	else if (actor?.type === "npc") {
		// A follower takes orders, and in a fight the two they most often take are Clash and Let Fly
		// (Book I p.473). Their character rolls all three (p.462), through the same dialog their card
		// opens; Order is last because it is the one that asks which move rather than saying.
		if (order) {
			const offered = [...RING_MOVES.filter(m => !m.characterOnly), { name: localize("stonetop.fight.ring.order"), icon: ORDER_ICON, orderKey: null }];
			for (const { name, icon, orderKey } of offered) {
				moves.push({ run: "order", moveKey: orderKey, label: name, icon, order });
			}
		}
		// The NPC sheet's one damage button: its formula, titled with the blow that prints that die. Its
		// moves stay off: a GM types those, and one may roll something other than damage.
		const formula = tidy(printed.rollFormula);
		if (formula) {
			// The blow's printed "w/disadvantage" (a Mighty Servant's stone fists), as a monster's buttons keep theirs.
			const { title, keywords, weapon, rollMode: printedMode } = printedBlow(printed.value, formula);
			const rollMode = printedMode || "normal";
			damage.push({ run: "damage", label: title || damageText, formula, keywords, rollMode, weapon, icon: dieIcon(formula) });
			// And, for a group, all of them on one foe. BESIDE the plain die, not instead of it: one
			// crewman's blow is still a blow, and it is what the group takes when the fight is run as
			// the abstracted exchange. The blow is the same one, so its tags and armor clause ride along.
			if (swarm) {
				damage.push({
					run: "damage", label: localize("stonetop.fight.ring.swarm"), formula: swarm.formula,
					keywords, rollMode, weapon, icon: dieIcon(swarm.formula),
					aria: format("stonetop.fight.ring.swarmAria", { count: swarm.standing, formula: swarm.formula }),
				});
			}
		}
	}

	return { moves, damage, readiness: actor?.type === "character" ? Math.max(0, Math.trunc(Number(readiness) || 0)) : 0 };
}

/** An actor's ring, with the character's damage die, or a follower's character and roster, looked up. */
export async function ringButtonsFor(actor) {
	const isCharacter = actor?.type === "character";
	// The ammo only for someone with a Let Fly button to put it on.
	const letFly = isCharacter && itemsOf(actor).some(i => i?.type === "move" && i.name === "Let Fly");
	// Both read the character's gear, and neither waits on the other.
	const [die, ammo] = await Promise.all([isCharacter ? pcDamageDie(actor) : "", letFly ? letFlyAmmoStatuses(actor) : null]);
	const { order, swarm } = followerRingInfo(actor);
	const readiness = heldReadiness(actor);
	// Working out who they could lock eyes with takes the whole fight, so only for someone who could spend on it.
	const canLockEyes = isCharacter && readiness > 0 && ownsLearnedMoveNamed(actor, HERO_MOVES.BIG_DAMN_HERO) && lockEyesCandidates(actor).length > 0;
	const canStrikeBack = isCharacter && readiness > 0 && hasAttacker(actor);
	return ringButtons(actor, { die, order, swarm, readiness, canLockEyes, canStrikeBack, ammo: ammo?.weapons ?? [], ammoOut: !!ammo?.allOut });
}

/**
 * Whether anyone is attacking a character, for Defend's strike back: a foe in contact, or one shooting at
 * them. Not in a fight the ring can read: say yes, and leave it to the table.
 */
export function hasAttacker(actor, { engagementOf = rollerEngagement } = {}) {
	const place = engagementOf(actor);
	if (!place) return true;
	return !!place.entry?.attackers?.length;
}

/**
 * Big Damn Hero from the ring: pick the foe (asked only when there is more than one), spend the Readiness,
 * and say so. Returns whether eyes were locked.
 */
export async function lockEyesFromRing(actor) {
	if (heldReadiness(actor) < 1) return false;
	const foe = await pickOne(lockEyesCandidates(actor), {
		title: localize("stonetop.fight.ring.lockEyes"),
		question: format("stonetop.fight.ring.lockEyesAsk", { name: actor.name }),
		labelOf: c => c.name || c.token?.name || "",
	});
	if (!foe || !(await lockEyes(actor, foe.id))) return false;
	await spendReadiness(actor);
	await globalThis.ChatMessage?.create?.({
		content: stonetopChatCard(HERO_MOVES.BIG_DAMN_HERO, `<div class="card-content"><p>${escHtml(format("stonetop.fight.ring.lockEyesSaid", { name: actor.name, foe: foe.name || foe.token?.name || "" }))}</p></div>`, "stonetop-lock-eyes-card"),
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
	});
	return true;
}

/** Whether a ring has anything on it. */
const ringHasButtons = buttons => !!(buttons?.moves?.length || buttons?.damage?.length);

/**
 * Press one of the ring's buttons: the same call the sheet's own control makes.
 *
 * @param {RingButton} button
 * @param {Actor} actor
 * @param {{shiftKey?: boolean}} [options]  Shift skips the pre-roll windows, as it does on the sheet
 */
export async function runRingButton(button, actor, { shiftKey = false } = {}) {
	if (!button || !actor) return;
	if (button.run === "move") {
		const sheet = actor.sheet;
		if (typeof sheet?.rollMoveById === "function") return sheet.rollMoveById(button.itemId, { shiftKey });
		return actor.items?.get?.(button.itemId)?.roll?.();
	}
	// Shift is deliberately not passed on: it skips the windows a roll would otherwise open, and the
	// Order dialog is not one of those — it IS the roll, the place the tags in play are weighed.
	if (button.run === "order") return openFollowerOrder(button.order, button.moveKey);
	if (button.run === "item") return actor.items?.get?.(button.itemId)?.roll?.({ shiftKey });
	if (button.run === "lockEyes") return lockEyesFromRing(actor);
	// Strike back is the damage button's roll, at its disadvantage, and costs a Readiness once it is rolled.
	const strikeBack = button.run === "strikeBack";
	if (strikeBack && heldReadiness(actor) < 1) return;
	// A character's own damage is dealt with the weapon in hand (asked as Clash asks), its +N, die, piercing
	// and tags riding along; a strike back is one defender's blow, so no fight +N.
	const rolled = actor.type === "character" ? await rollCharacterDamageAt(actor, {
		label: button.label,
		rollMode: button.rollMode,
		seeded: !strikeBack,
		strikeBack,
		shiftKey,
	}) : await rollDamageAt(actor, {
		formula: button.formula,
		label: button.label,
		keywords: button.keywords,
		rollMode: button.rollMode,
		weapon: button.weapon,
		shiftKey,
	});
	if (strikeBack && rolled) await spendReadiness(actor);
	return rolled;
}

/**
 * The fight a token stands in, when its ring may come up for this reader, else null.
 *
 * @param {Token} token  the placeable
 * @returns {null|{combat: Combat, combatant: Combatant}}
 */
export function ringFightFor(token, { canvasScene = globalThis.canvas?.scene } = {}) {
	if (!isFightTabEnabled() || !isFightRingOn()) return null;
	const doc = token?.document;
	const scene = doc?.parent ?? null;
	if (!doc || !scene || scene.id !== canvasScene?.id) return null;
	const combat = fightOnScene(scene);
	const combatants = typeof combat?.combatants?.[Symbol.iterator] === "function" ? [...combat.combatants] : [];
	const combatant = combatants.find(c => c.tokenId === doc.id && c.sceneId === scene.id);
	return combatant ? { combat, combatant } : null;
}

/**
 * Whether a click that has just let go of a token should put its ring up.
 *
 * @param {object} p
 * @param {string|null} p.pressedOn  the token whose ring this same press closed, if any
 * @param {string} p.tokenId
 * @param {string|null} p.tool       the active token tool
 * @param {boolean} p.modifiers      Shift, Ctrl, Alt or Meta held
 * @param {boolean} p.controlled     whether the token is selected once the click is done
 */
export function clickOpensRing({ pressedOn = null, tokenId, tool = null, modifiers = false, controlled = false }) {
	// Pressing a token whose ring is up puts the ring away, the way a second right-click does core's.
	if (pressedOn && pressedOn === tokenId) return false;
	if (OTHER_TOOLS.has(tool) || modifiers) return false;
	return !!controlled;
}

/**
 * How much bigger than core's scale to draw the ring, so it is never smaller on screen than its
 * natural size: 1 at a zoom where the map's own scale already gets it there.
 *
 * @param {number} zoom     the canvas stage's scale
 * @param {number} scale    the scale core's HUD positioning gives it (the grid's size over 100)
 */
export function ringGrowth(zoom, scale) {
	const onScreen = Number(zoom) * Number(scale);
	return onScreen > 0 && onScreen < 1 ? 1 / onScreen : 1;
}

/**
 * The ring's window class, built on core's token HUD base so it sits in `#hud`, over the token, and is
 * placed and scaled the way core's HUD is.
 *
 * @param {object} [foundryNs]  the `foundry` namespace (injectable for tests)
 */
export function createFightRingClass(foundryNs = globalThis.foundry) {
	const { BasePlaceableHUD } = foundryNs.applications.hud;
	const { HandlebarsApplicationMixin } = foundryNs.applications.api;

	class FightRing extends HandlebarsApplicationMixin(BasePlaceableHUD) {
		static DEFAULT_OPTIONS = {
			id: "stonetop-fight-ring",
			classes: ["stonetop-fight-ring"],
			actions: { ringRoll: FightRing.#onRoll },
		};

		static PARTS = {
			ring: { root: true, template: RING_TEMPLATE },
		};

		/** What the buttons on screen do, by their `data-index`. */
		#buttons = [];

		get actor() {
			return this.document?.actor ?? null;
		}

		/** @override  The ring needs none of the token's own data that core's HUD puts in its context. */
		async _prepareContext(options) {
			const buttons = options?.ringButtons ?? await ringButtonsFor(this.actor);
			this.#buttons = [...(buttons?.moves ?? []), ...(buttons?.damage ?? [])];
			return ringContext(buttons, { name: this.document?.name ?? this.actor?.name ?? "" });
		}

		/** @inheritDoc */
		_updatePosition(position) {
			const placed = super._updatePosition(position);
			const grow = ringGrowth(globalThis.canvas?.stage?.scale?.x ?? 1, placed.scale ?? 1);
			if (grow > 1) {
				placed.width /= grow;
				placed.height /= grow;
				placed.scale = (placed.scale ?? 1) * grow;
			}
			return placed;
		}

		/** A button: put the ring away, then do what the sheet's own control does. */
		static async #onRoll(event, target) {
			const button = this.#buttons[Number(target?.dataset?.index)];
			const actor = this.actor;
			await this.close();
			try {
				await runRingButton(button, actor, { shiftKey: !!event?.shiftKey });
			} catch (err) {
				console.error("Stonetop | fight ring: the roll failed", err);
			}
		}
	}
	return FightRing;
}

/**
 * What a Let Fly button says about the ammo. One weapon needs no name, the button already being the one
 * that fires it; several are told apart. `named` always names them, for the spoken label.
 */
function ammoText(ammo, { named = false } = {}) {
	if (ammo.length === 1 && !named) return ammo[0].label;
	return ammo.map(a => `${a.name}: ${a.label.toLowerCase()}`).join(", ");
}

/**
 * The template's context: the buttons with their places and spoken names. `data-index` counts through
 * the moves, then the damage buttons.
 */
export function ringContext(buttons, { name = "" } = {}) {
	const moves = buttons?.moves ?? [];
	const damage = buttons?.damage ?? [];
	// An order is spoken as one — "Order Enfys to Clash" — because the roll it opens is the
	// character's, made on their follower's behalf, and not the follower rolling a move of their own.
	// A button carrying its own wording keeps it: the swarm die says how many of them are piling on.
	const spoken = (button) => {
		if (button.aria) return button.aria;
		if (button.run === "order") {
			return button.moveKey
				? format("stonetop.fight.ring.orderMove", { name, move: button.label })
				: format("stonetop.fight.ring.orderAria", { name });
		}
		if (button.run === "move" && button.ammo?.length) {
			return format("stonetop.fight.ring.rollMoveAmmo", { move: button.label, ammo: ammoText(button.ammo, { named: true }) });
		}
		return button.run === "move"
			? format("stonetop.fight.ring.rollMove", { move: button.label })
			: format("stonetop.fight.ring.rollDamage", { label: button.label, formula: button.formula });
	};
	const view = (button, index) => ({
		index,
		label: button.label,
		// Only a damage button carries one; a move or an order has none to print.
		formula: button.formula ?? "",
		icon: button.icon,
		aria: spoken(button),
		// Let Fly's bow, low or out. Red only when nothing it could fire has any left.
		ammo: button.ammo?.length ? ammoText(button.ammo) : "",
		ammoOut: !!button.ammo?.length && !!button.ammoOut,
	});
	// The Readiness a character holds, over the token: what they have to spend on a blow (Defend, p.216).
	const held = Math.max(0, Math.trunc(Number(buttons?.readiness) || 0));
	return {
		ringLabel: format("stonetop.fight.ring.label", { name }),
		movesLabel: localize("stonetop.fight.ring.moves"),
		damageLabel: localize("stonetop.fight.ring.damageGroup"),
		readiness: held > 0 ? { count: held, label: format("stonetop.fight.ring.readiness", { name, count: held }), pips: Array.from({ length: held }, (_, i) => i) } : null,
		moves: moves.map((button, i) => view(button, i)),
		damage: damage.map((button, i) => view(button, moves.length + i)),
	};
}

/**
 * A token class whose plain left-click also puts its ring up. Everything else is core's (or whatever
 * `Base` a module installed before us).
 */
export function createFightTokenClass(Base) {
	return class StonetopToken extends Base {
		/** @inheritDoc */
		_onUnclickLeft(event) {
			super._onUnclickLeft(event);
			openRingOnClick(this, event);
		}
	};
}

// -- The one ring on this client ------------------------------------------------------------------

let ring = null;
/** The token whose ring the latest press on the map put away, so letting go of that token keeps it away. */
let pressedOn = null;
const boards = new WeakSet();

/** The ring, made the first time a click wants it (core's HUD classes do not exist at import). */
function theRing() {
	ring ??= new (createFightRingClass())();
	return ring;
}

/** This client's ring, or null before anything has been clicked. */
export function currentFightRing() {
	return ring;
}

/** Put the ring away, if it is up. */
export function closeFightRing() {
	if (ring?.rendered) return ring.close();
}

/** A press anywhere on the map: remember whose ring was up, and put it away. */
export function onBoardPress() {
	pressedOn = ring?.rendered ? (ring.object?.document?.id ?? null) : null;
	return closeFightRing();
}

/** A click has let go of `token`: put its ring up, if it should have one. */
export async function openRingOnClick(token, event) {
	const pressed = pressedOn;
	pressedOn = null;
	const modifiers = !!(event?.shiftKey || event?.ctrlKey || event?.altKey || event?.metaKey);
	const tokenId = token?.document?.id ?? null;
	if (!clickOpensRing({ pressedOn: pressed, tokenId, tool: globalThis.game?.activeTool ?? null, modifiers, controlled: !!token?.controlled })) return;
	if (!ringFightFor(token)) return;
	try {
		const ringButtons = await ringButtonsFor(token.document?.actor ?? token.actor);
		// Selected and let go of in the time that took: the reader has moved on.
		if (!ringHasButtons(ringButtons) || !token.controlled || token.destroyed) return;
		await theRing().render({ force: true, position: true, object: token, ringButtons });
	} catch (err) {
		console.error("Stonetop | fight ring: could not put the buttons up", err);
	}
}

/** The fight changed: a ring on a token no longer in it goes away. */
export function syncFightRing() {
	if (ring?.rendered && !ringFightFor(ring.object)) closeFightRing();
}

/** Listen for everything that moves the ring or puts it away. */
export function installFightRing({ hooks = globalThis.Hooks } = {}) {
	// Any press on the map. The board is the same element for the whole session, so listen once.
	hooks.on("canvasReady", board => {
		const view = board?.app?.view ?? globalThis.canvas?.app?.view;
		if (!view || boards.has(view)) return;
		boards.add(view);
		// Capture, so the ring is put away before core handles the press.
		view.addEventListener("pointerdown", onBoardPress, { capture: true });
	});
	const onToken = token => ring?.rendered && ring.object === token;
	hooks.on("controlToken", (token, controlled) => { if (!controlled && onToken(token)) closeFightRing(); });
	hooks.on("deleteToken", doc => { if (ring?.rendered && ring.object?.document?.id === doc?.id) closeFightRing(); });
	// Follow the token as it moves, and the zoom, which decides how much the ring grows.
	hooks.on("refreshToken", token => { if (onToken(token)) ring.setPosition(); });
	hooks.on("canvasPan", () => { if (ring?.rendered) ring.setPosition(); });
	hooks.on("canvasTearDown", () => { pressedOn = null; return closeFightRing(); });
	hooks.on("clientSettingChanged", key => { if (String(key ?? "") === `${SYSTEM_ID}.fightRing`) closeFightRing(); });
}
