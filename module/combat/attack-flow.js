// Interactive attack flow for every move that deals a character's damage: the Clash (+STR) and
// Let Fly (+DEX) basic moves, and the playbook moves whose hit tiers say the same thing —
// Ambush, Call the Shot, The Hammer and the Book.
//
// The player targets one or more foes with Foundry's target key (T), clicks the move,
// picks a weapon (when they carry more than one that fits the move), and rolls. On a
// hit the roll card grows a "Roll damage" action that rolls the PC's damage die once
// per target; a follow-up card lists each target's damage with a GM-only "Apply damage"
// button. Clash additionally resolves "suffer your enemy's attack" — incoming damage to
// the PC — which nobody has to ask for: the tier that states it rolls it (see
// sufferEnemyAttack) and posts it on that same damage card.
//
// Design notes (see project memory project_clash-letfly-combat-flow):
//  - A PC has ONE damage die (system.attributes.damage.value); the weapon never changes
//    the die, only rides +N damage / piercing / tags on top (module/data/weapons.js). A
//    weapon with its own fixed damageDie (naphtha) replaces the PC die.
//  - game.user.targets is per-user and client-side, so targets are SNAPSHOT into the
//    chat message's flags at the click; every later step (Roll damage, Apply damage,
//    even on the GM's client) reads the frozen flag, never live targets.
//  - Targets resolve via fromUuid(TokenDocument.uuid) so an unlinked monster token hits
//    its own synthetic actor (not the shared prototype) and works cross-scene.
//  - Applying damage to a monster is a GM action (players don't own enemy tokens and the
//    system has no socket relay); "suffer your enemy's attack" writes the PC's own HP, so
//    its card is pressed by whoever can — the player, or the GM who authored it.

import {STONETOP_SCOPE} from "../actors/character/StonetopFlags.js";
import {weaponMetaFromNote} from "../data/weapon-from-note.js";
import {weaponMeta, isClashWeapon, isLetFlyWeapon, weaponTraitText, weaponArmorBits, grantedWeaponForMove, MOVE_GRANTED_WEAPONS, UNARMED_META, MELEE_RANGES, ALL_IN_THE_WRIST, withWristThrow} from "../data/weapons.js";
import {escHtml, joinNames} from "../utils/strings.js";
import {stonetopChatCard, rollFormulaChip, damageMark, damageBadge, damageKeywordsHtml, optionKey, whisperGm, cardNoticeHtml, canUserWriteCard} from "../utils/chat.js";
import {rollDamage, multiDieFaces, sign, damageRollFormula, damageConditionPills, conditionsRowHtml, classifyResult} from "../utils/roll-engine.js";
import {mitigateDamage, resolvePiercing, applyDamageToActor, damageRowActor, composeDamageFormula, seedBonus, damageSeedBonus, foeAttacks, fictionTagsIn, hardestAttackIndex} from "../utils/damage.js";
import {promptDamage} from "../dialogs/RollDialog.js";
// The fight's +N for several attackers (Book I p.414), offered to the damage rolls below. Every builder
// answers null with the Fight tab off or no fight on the map, so none of this changes a roll then.
import {incomingSeed, engagedFoeTargets, pcEngagement, seedForRoll, seedWithoutStriker, sheetSeed} from "../fight/damage-seed.js";
// Who a roll hits when nobody targeted anyone by hand: whoever the roller is fighting on the map.
import {rollTargets} from "../fight/fight-targets.js";
// A damage roll at somebody out of reach is a shot, kept on the roller's combatant; the hand targets it
// used are let go once it is (fight/fight-shots.js).
import {recordShots, releaseSpentTargets, shotOnRecordAt} from "../fight/fight-shots.js";
// A lone attacker's blow on a token standing for a group hits one member of it (fight/group-hits.js).
import {isLoneBlowOnGroup, applyMemberHit} from "../fight/group-hits.js";
import {halveDamage, spentOn} from "../fight/defend-spend.js";
// Playbook moves the fight turns on: Undaunted's +1 armor and +1d6, Big Damn Hero's locked eyes
// (fight/hero-moves.js).
import {undauntedNow, eyesLockedAgainst, ownDamageMode, blowOffers as heroOffers, muscleboundWeapon, berserkNow, defenderDisadvantage, recordHarmedBy, recordClash, foeAdvantage, defenderMoveKey} from "../fight/hero-moves.js";
import {ownsLearnedMoveNamed, ownsLearnedBookMoveNamed, ownedLearnedBookMove, isPlayerAuthoredMove} from "../actors/character/owns-move.js";
import {armorGateWords, barkskinMarks, wearsBarkskin, withBarkskinBase} from "../actors/character/move-armor.js";
import {format, localize} from "../utils/i18n.js";
import {foldModes} from "../utils/roll-mode.js";
import {bringDialogToFront} from "../utils/front-on-open.js";
import {isPrimaryGM, anyActiveGM} from "../utils/primary-gm.js";
import {resolveSync, queryAsker, chatModeIsPublic} from "../utils/foundry-compat.js";
import {inCardTurn} from "../utils/card-queue.js";
import {belongsToMessage, wirePickedOptionButton} from "../utils/picked-option-button.js";
import {settleReadinessOnAttack} from "./readiness-loss.js";
import {offerBattleJoyOnDamage} from "./battle-joy-offer.js";
import {revealOnAttack} from "../actors/character/fight-states.js";
import {playBlowFx, playMissFx, playHitReactions} from "./attack-fx.js";
import {hitReaction} from "./attack-fx-table.js";

const SCOPE = STONETOP_SCOPE;

/** Anything you could swing or loose at a foe — the widest weapon list a move can offer. */
const isAnyAttackWeapon = meta => isClashWeapon(meta) || isLetFlyWeapon(meta);

/**
 * The moves that deal a character's damage, keyed by their move-item name.
 *
 * The first two are the basic attacks. The rest are PLAYBOOK moves whose hit tiers also say
 * "deal your damage" and whose printed list carries a bullet that changes the number, so they run
 * the same three beats Clash already runs — pick a weapon, snapshot the targets, roll the damage
 * into a card the GM can apply — rather than each growing its own half of them.
 *
 *   filter    which carried weapons are offered for the weapon pick. The playbook moves read
 *             their trigger for it: "line up the perfect shot" is a shot, "get the drop on a
 *             nearby foe" is whatever you have in hand.
 *   playbook  the book the move comes out of. Its presence is what makes a same-named move a
 *             world wrote act as itself rather than as this flow — see attackMoveFor.
 *   unrolled  the move lets you skip the 2d6 and simply deal your damage ("an easy shot",
 *             Ambush's "you can deal your damage or opt to roll +DEX"). The block is the question
 *             asked before the roll, in the move's own words; see promptUnrolledDamage.
 *   counterOnMiss  the move's 6- says the enemy hits back, flatly and with nothing else in the
 *             tier to decide: Clash's "your maneuver fails and you suffer your enemy's attack".
 *             That fires itself the moment the dice land (maybeCounterOnMiss) rather than waiting
 *             on a button, because a stated consequence is not an offer. Only Clash has one — the
 *             other four print "the GM makes a move", which is nobody's button to press.
 *   counterOnPartial  the move's 7-9 says the enemy hits back whatever else the player picks:
 *             Clash's "you and your foe both suffer your attacks". Unlike the 6- this one DOES
 *             wait on the button, because the tier still deals the character's damage — so it
 *             rides the Confirm as the tier's own unconditional number (see buildTierActions).
 */
const ATTACK_MOVES = {
	"Clash":   { key: "clash",   filter: isClashWeapon, counterOnMiss: true, counterOnPartial: true },
	"Let Fly": {
		key: "let-fly", filter: isLetFlyWeapon,
		unrolled: {
			question: `Is this an <strong>easy shot</strong>, or is <strong>the shot tricky or are you under pressure</strong>?`,
			deal: "Easy shot (deal your damage, no roll)",
			roll: "Tricky, or under pressure (roll +DEX)",
		},
	},
	"Ambush": {
		key: "ambush", playbook: "The Fox", filter: isAnyAttackWeapon,
		unrolled: {
			question: `You <strong>got the drop on a nearby foe</strong>. Deal your damage, or opt to roll +DEX?`,
			deal: "Deal your damage (no roll)",
			roll: "Opt to roll +DEX",
		},
	},
	"Call the Shot": {
		key: "call-the-shot", playbook: "The Ranger", filter: isLetFlyWeapon,
		unrolled: {
			question: `You <strong>took your time and calmly lined up the perfect shot</strong>. Either deal your damage, or roll +DEX?`,
			deal: "Deal your damage (no roll)",
			roll: "Roll +DEX",
		},
	},
	"The Hammer and the Book": { key: "hammer-and-book", playbook: "The Judge", filter: isAnyAttackWeapon },
};

/**
 * The attack-move config for a rolled move item, or null for any other move.
 *
 * A playbook move is only ITSELF when it came from a playbook: a move a player wrote (the custom-move
 * flag, owns-move.js#isPlayerAuthoredMove) that happens to be called Ambush acts as the plain move
 * they wrote, which is the rule grantedWeaponAttackFor already applies to the granted-weapon path.
 * NOT moveType "other": a GM-dropped foreign Ambush lands as "other" too, and is still the book's.
 * The basic moves need no such guard — nothing but Clash is called Clash, and a world that renames
 * it has bigger plans.
 */
export function attackMoveFor(item) {
	const move = ATTACK_MOVES[item?.name] ?? null;
	if (move?.playbook && isPlayerAuthoredMove(item)) return null;
	return move;
}

/**
 * The attack a move-granted weapon IS, when the granting move's whole mechanical offer is
 * "this thing counts as a weapon" — the Lightbearer's Purifying Flames, whose holy light
 * "counts as a weapon (d10 damage, hand, close, area, 2 piercing)" and which lets them roll
 * +WIS to Clash. Such a move has no roll of its own, so using it is that attack with the
 * weapon already in hand; this returns what the roll needs:
 *
 *   { item, stat, weaponSlug }  the attack move to roll (an item ON this actor, since the
 *                               roll resolves it by id), the stat the grant rides on, and the
 *                               weapon that skips the weapon prompt;
 *   { readyWhen, unreadyNotice } the weapon's own precondition, straight off its row in
 *                               data/weapons.js — SAID by the caller when unmet, never enforced,
 *                               so a second granted weapon needs no new branch in the roll path.
 *
 * Null for every other move, and for a granting move whose attack move the actor doesn't own —
 * the caller then treats it as the description-only move it has always been. Matched on the
 * resolved ITEM, never a row's text: an un-owned playbook row carries no item at all, and a
 * player-authored move (the custom-move flag, not moveType "other", which a GM-dropped foreign
 * move also carries) that happens to share the name acts as itself, the same rule the guided-move
 * and stat-picker paths apply.
 */
export function grantedWeaponAttackFor(actor, item) {
	if (item?.type !== "move" || isPlayerAuthoredMove(item)) return null;
	const granted = grantedWeaponForMove(item.name);
	if (!granted?.viaMove || !ATTACK_MOVES[granted.viaMove]) return null;
	const attackItem = actor?.items?.find(i => i.type === "move" && i.name === granted.viaMove);
	if (!attackItem) return null;
	return {
		item: attackItem, stat: granted.whenStat, weaponSlug: granted.slug,
		readyWhen: granted.readyWhen ?? null, unreadyNotice: granted.unreadyNotice ?? null,
	};
}

function isFriendly(disposition) {
	return disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
}

// -- Ammo statuses ------------------------------------------------------------
// Ammo weapons (crossbow, composite bow) carry a resource track on their inventory
// item — the ○○ "low ammo" / "all out" boxes on the equipment tab, stored in
// flags.stonetop-pwd.inventory.resources[slug]. Let Fly's 7-9 "deplete your ammo"
// pick marks the next box; 0 = plenty, the last box = all out. We drive that SAME
// resource so the sheet tracker and the chat button stay in lockstep.
//
// ⚠ HOW MANY BOXES IS THE ITEM'S TO SAY, not this file's. The bows carry the printed pair, but
// javelins are a single throw ("◇ javelins … ○ all out"), a lantern has five hours of oil, and a
// Book II treasure can hold four uses of anything — and the track this marks is the same one the
// equipment tab draws. Assuming two here said "all out" on a four-use item with half of it still
// in hand, and wrote a 2 into a track the sheet then drew with two boxes still empty. So the max
// and the words both come off the item's own resource definition, carried on the gear record as
// `ammoMax` / `ammoLabels` (see StonetopCharacter#_gearSources) and threaded to the chat card.
/** The Ranger's volley, asked before a Let Fly with a bow (askBlotOutTheSun). */
const BLOT_OUT_THE_SUN = "Blot Out the Sun";
/** The Fox's 12+ on a +DEX Clash (battleDancing). */
const BATTLE_DANCER = "Battle Dancer";

const AMMO_MAX = 2;
const AMMO_LABELS = ["Plenty", "Low ammo", "All out"];

// The track a weapon record describes: its length, and the status the item prints against each
// box. The fallback is the ammo weapons' printed pair, which is what a record with no track of
// its own (the legacy bare-actor path, a test fixture) has always behaved as.
function ammoTrack(weapon) {
	const max = Math.max(1, Math.trunc(Number(weapon?.ammoMax)) || AMMO_MAX);
	return { max, labels: Array.isArray(weapon?.ammoLabels) ? weapon.ammoLabels : [] };
}

// What to CALL the state of a track with `index` boxes marked. The item's own word for that box
// wins — "running low" on the oil, "vial" on the twisting pine — since it is the word printed
// beside the box the player just marked. Unlabelled boxes fall back to the ammo wording, where
// only the last box is "all out"; nothing marked is always "plenty".
function ammoStatusLabel(index, { max, labels }) {
	if (index <= 0) return AMMO_LABELS[0];
	const printed = labels[index - 1];
	if (printed) return printed.charAt(0).toUpperCase() + printed.slice(1);
	return index >= max ? AMMO_LABELS[2] : AMMO_LABELS[1];
}

// A gear-choice weapon (the Heavy's and Marshal's crossbow) keeps its ○○ track in
// possessions.choiceUses under the composite `possession:choice` key, not in
// inventory.resources — so which store to read is a property of the weapon, carried on its
// record as `ammoStore` and threaded through to the chat card.
//
// A THIRD STORE, "move": a weapon a move grants whose ammo is that move's own resource track:
// All in the Wrist's throwing blades (○ a few left ○ out), kept under the move's NAME in
// MoveResources (`ammoMove` on the record). It counts boxes MARKED, the same way round as the
// equipment tab's ○○: nothing marked is a full hand, and a Let Fly 7-9 marks the next one. That is
// the SPENT-style counter, not the hold pools' "a ticked pip is held" (MoveResources#setUses).
function weaponAmmoIndex(actor, weapon) {
	const { max } = ammoTrack(weapon);
	const slug = weapon?.slug;
	if (weapon?.ammoStore === "move") {
		const used = actor.typedActor?.moveResources?.getMoveResources?.()?.[weapon.ammoMove];
		return Math.min(Math.max(0, Number(used) || 0), max);
	}
	// Through the possessions store's own reader, the way the write goes through its writer:
	// a gear-choice key contains a colon, and where those uses live is that class's business.
	if ((weapon?.ammoStore ?? "inventory") === "possessions") {
		const [possessionSlug, choiceSlug] = String(slug).split(":");
		const used = actor.typedActor?.subChoiceUses?.(possessionSlug, choiceSlug) ?? 0;
		return Math.min(Math.max(0, Number(used) || 0), max);
	}
	const resources = actor.getFlag(SCOPE, "inventory.resources") ?? {};
	return Math.min(Math.max(0, Number(resources[slug]) || 0), max);
}

function weaponAmmoLabel(actor, weapon) {
	return ammoStatusLabel(weaponAmmoIndex(actor, weapon), ammoTrack(weapon));
}

/**
 * The carried Let Fly weapons' ammo, for the fight ring's Let Fly button (fight/fight-ring.js): what a
 * player reaching for the bow should know before they roll.
 *
 * `weapons` names each one with a box marked. A weapon with no track, or with nothing marked, is left
 * out; the ring says nothing about plenty. `allOut` is asked of EVERY carried Let Fly weapon, those
 * left out included: a full shortbow beside an empty crossbow still has shots in it, and so does a
 * weapon with no track to run down.
 *
 * @returns {Promise<{weapons: {name: string, label: string, allOut: boolean}[], allOut: boolean}>}
 */
export async function letFlyAmmoStatuses(actor) {
	const carried = (await carriedAttackWeapons(actor, ATTACK_MOVES["Let Fly"])).filter(w => !w.unarmed);
	const weapons = [];
	let loaded = 0;
	for (const w of carried) {
		if (!w.meta?.ammo) { loaded += 1; continue; }
		const index = weaponAmmoIndex(actor, w);
		const allOut = index >= ammoTrack(w).max;
		if (!allOut) loaded += 1;
		// carriedAttackWeapons already put the status into words.
		if (index > 0) weapons.push({ name: w.meta.name, label: w.ammoLabel, allOut });
	}
	return { weapons, allOut: carried.length > 0 && loaded === 0 };
}

// Mark the next ammo status. The slug is a dot-free inventory slug, so a sub-key write is
// safe and leaves other weapons' resources untouched. Returns the new status.
async function advanceWeaponAmmo(actor, weapon) {
	const track = ammoTrack(weapon);
	const slug = weapon?.slug;
	const next = Math.min(weaponAmmoIndex(actor, weapon) + 1, track.max);
	if (weapon?.ammoStore === "move") {
		// The move's own track, through its store's writer (a sub-key, so no sibling move's track is
		// touched), attributed to the move for the ledger.
		await actor.typedActor?.moveResources?.setUses?.(weapon.ammoMove, next, { stonetopMove: weapon.ammoMove });
	} else if ((weapon?.ammoStore ?? "inventory") === "possessions") {
		// Through the possessions store's own writer rather than a dotted update path: a
		// gear-choice key contains a colon, and a whole-object write keeps it out of Foundry's
		// path expansion entirely (the same reason setChoiceUses is written that way).
		const [possessionSlug, choiceSlug] = String(slug).split(":");
		await actor.typedActor?.setSubChoiceUses?.(possessionSlug, choiceSlug, next);
	} else {
		await actor.update({ [`flags.${SCOPE}.inventory.resources.${slug}`]: next });
	}
	return { index: next, label: ammoStatusLabel(next, track), allOut: next >= track.max };
}

// -- Weapon enumeration -------------------------------------------------------

// What an actor with no StonetopCharacter attached can still answer: its checked inventory,
// shaped like a gear record. Keeps the flow working for a bare actor (and for tests that build
// one) without teaching it a second rule — a character that HAS one always uses that instead.
function legacyCarriedGear(actor) {
	const checked = actor.getFlag(SCOPE, "inventory.checked") ?? {};
	return Object.entries(checked)
		.filter(([, on]) => on)
		// `catalog` for the same reason the real gear source sets it: these ARE outfit slugs, so
		// the curated table is the whole answer to whether one is a weapon.
		.map(([slug]) => ({ slug, weaponSlug: slug, name: null, note: null, ammoStore: "inventory", catalog: true }));
}

// Exported for the tests; the flow reaches it only through maybeBeginAttack.
// The carried weapons that fit `move`,
// plus any weapon an owned move grants (the Lightbearer's holy light). A granted weapon
// isn't inventory, so it's appended rather than read off the checked flags; it's offered
// whenever its move is owned and learned, since whether the fiction supports it — wielding a holy
// light against a creature of darkness — is the table's call, not ours.
export async function carriedAttackWeapons(actor, move) {
	const out = [];
	// Every carried thing, whichever store its ◇ lives in — see StonetopCharacter#_gearSources.
	// Reading inventory.checked alone (as this did) meant the Heavy's and Marshal's Weapons of
	// War were never offered for Clash or Let Fly, because a gear choice marks itself carried in
	// possessions.choiceCarried; and arcana / treasure weapons were missed again below, for
	// having no WEAPON_META entry to find.
	const gear = (await actor.typedActor?.carriedWeaponGear?.()) ?? legacyCarriedGear(actor);
	// Weapons of War gives the steading's battleaxes and swords "x piercing" (data/weapons.js).
	const weaponsOfWar = !!actor.typedActor?.weaponsOfWarEarned?.();
	// All in the Wrist: "Any knife or dagger gets the thrown tag in your hands" (data/weapons.js).
	const wristThrow = ownsLearnedBookMoveNamed(actor, ALL_IN_THE_WRIST);
	for (const g of gear) {
		// A catalog or gear-choice weapon is in the curated table; anything picked up in play
		// states its own mechanics in its tag line instead.
		//
		// ⚠ AND THE TABLE IS THE LAST WORD ON A CATALOG ITEM. Falling through to the tag line for
		// one too meant every catalog row that merely names a range became a weapon: the torch
		// ("reach, area, dangerous") and the oil lamp are lit, not swung; the dog, the donkey, the
		// horse and the mule print the damage THEY deal; and a player carrying any of them was
		// asked which one they were attacking with. The book's equipment list is exactly what
		// WEAPON_META was curated from, so a row it doesn't name is not a weapon.
		const read = (g.weaponSlug ? weaponMeta(g.weaponSlug, { weaponsOfWar }) : null)
			?? (g.catalog ? null : weaponMetaFromNote(g.name, g.note, { ammo: !!g.ammo }));
		const meta = read && wristThrow ? withWristThrow(read) : read;
		if (!meta || !move.filter(meta)) continue;
		const weapon = {
			slug: g.slug, meta,
			ammoStore: g.ammoStore ?? "inventory",
			ammoMax: g.ammoMax ?? null,
			ammoLabels: g.ammoLabels ?? null,
		};
		out.push({ ...weapon, ammoLabel: meta.ammo ? weaponAmmoLabel(actor, weapon) : null });
	}
	for (const moveName of Object.keys(MOVE_GRANTED_WEAPONS)) {
		// Through the accessor, so the weapon carries the stat the move actually grants for
		// the roll rather than a second recording of it.
		const granted = grantedWeaponForMove(moveName);
		if (!move.filter(granted.meta)) continue;
		// LEARNED, and the book's move: an un-learned grant arms nobody, and a player's own move of
		// the name is theirs (the rule grantedWeaponAttackFor applies).
		const grantor = ownedLearnedBookMove(actor, moveName);
		if (!grantor) continue;
		const weapon = { slug: granted.slug, meta: granted.meta, ammoStore: granted.ammoStore ?? "inventory", grantedBy: moveName, whenStat: granted.whenStat };
		// A granted weapon with ammo counts it on its move's own track, whose length and words
		// are the move's to say, exactly as an inventory item's are (ammoTrack).
		if (weapon.ammoStore === "move") {
			const resource = grantor.system?.resource ?? null;
			Object.assign(weapon, { ammoMove: moveName, ammoMax: Number(resource?.max) || null, ammoLabels: Array.isArray(resource?.labels) ? resource.labels : null });
		}
		out.push({ ...weapon, ammoLabel: granted.meta.ammo ? weaponAmmoLabel(actor, weapon) : null });
	}
	return withUnarmedChoice(out);
}

/**
 * OFFER a move-granted weapon; never impose it. A granted weapon is owned rather than picked
 * up, so when it's the only thing that fits the move the single-candidate shortcut in
 * promptWeaponChoice would put a holy light in the hands of a Lightbearer who owns Purifying
 * Flames, has no melee weapon ticked, and meant to Clash with +STR — the d10 + 2 piercing +
 * area arriving with no prompt and no way back. The unarmed row goes in FIRST so it is what a
 * stat that doesn't imply the granted weapon defaults to; +WIS still pre-selects the light
 * through `preferSlug`. Carried weapons are left alone: one ticked weapon IS the player's
 * answer, and a prompt for it would only be in the way.
 *
 * Exported for the tests; the flow only reaches it through carriedAttackWeapons.
 */
export function withUnarmedChoice(candidates) {
	if (!candidates.length || !candidates.every(c => c.grantedBy)) return candidates;
	return [{ slug: "", meta: UNARMED_META, ammoLabel: null, ammoStore: "inventory", unarmed: true }, ...candidates];
}

// The flattened, storable weapon record baked into the chat card (no functions). The ammo track's
// shape rides along with the store it lives in: the card is what "deplete your ammo" is pressed
// on, and by then the gear record it came from is long gone.
function serializeWeapon({ slug, meta, ammoStore = "inventory", ammoMax = null, ammoLabels = null, ammoMove = null }) {
	return {
		slug, ammoStore, ammoMax, ammoLabels,
		// Only for a track kept on a move (weaponAmmoIndex), so every other card stays as it was.
		...(ammoMove ? { ammoMove } : {}),
		name: meta.name, range: meta.range, damageBonus: meta.damageBonus,
		piercing: meta.piercing, ignoresArmor: meta.ignoresArmor, area: meta.area,
		damageDie: meta.damageDie, tags: meta.tags, ammo: meta.ammo,
	};
}

// -- Prompts ------------------------------------------------------------------

// Ask which weapon is in hand. Returns { weapon } (possibly null — unarmed / no matching
// weapon) or "cancel". The unarmed row (see withUnarmedChoice) is a choice, not a weapon: picking
// it resolves to null, the same as having nothing that fits the move.
//
// EVERY reason not to ask lives here, so "when is the player asked?" is one function's answer
// rather than something a caller can also decide:
//   forceSlug  the weapon is ALREADY chosen — clicking Purifying Flames is choosing the holy
//              light — so there is nothing to ask. A slug that isn't on offer (a move removed
//              mid-click) falls through to the prompt rather than attacking with a weapon this
//              character doesn't have.
//   0 or 1 candidate  there is no choice to make.
// `preferSlug` does not skip the prompt; it pre-checks a candidate instead of the first, because
// the stat the player rolled can IMPLY the weapon (+WIS on Clash means the holy light).
function promptWeaponChoice(candidates, moveName, { preferSlug = null, forceSlug = null } = {}) {
	const chosen = (c) => ({ weapon: c?.unarmed ? null : (c ?? null) });
	const forced = forceSlug ? candidates.find(c => c.slug === forceSlug) : null;
	if (forced) return Promise.resolve(chosen(forced));
	if (candidates.length === 0) return Promise.resolve({ weapon: null });
	if (candidates.length === 1) return Promise.resolve(chosen(candidates[0]));

	const preferred = candidates.findIndex(c => c.slug === preferSlug);
	const checkedIndex = preferred >= 0 ? preferred : 0;
	const rows = candidates.map((c, i) => `<label class="stonetop-weapon-option">
		<input type="radio" name="weapon" value="${escHtml(c.slug)}"${i === checkedIndex ? " checked" : ""}>
		<span class="stonetop-weapon-name">${escHtml(c.meta.name)}${c.grantedBy ? ` <em>(${escHtml(c.grantedBy)})</em>` : ""}</span>
		<span class="stonetop-weapon-traits">${escHtml(weaponTraitText(c.meta))}${c.ammoLabel ? ` · <em>${escHtml(c.ammoLabel.toLowerCase())}</em>` : ""}</span>
	</label>`).join("");

	return new Promise(resolve => {
		new Dialog({
			title: `${moveName}: which weapon?`,
			content: `<form class="stonetop-weapon-choice"><div class="stonetop-weapon-options">${rows}</div></form>`,
			buttons: {
				choose: {
					label: "Use this weapon",
					callback: htmlEl => {
						const root = htmlEl?.[0] ?? htmlEl;
						const slug = root.querySelector('input[name="weapon"]:checked')?.value;
						const weapon = candidates.find(c => c.slug === slug) ?? candidates[0];
						resolve(chosen(weapon));
					},
				},
				cancel: { label: "Cancel", callback: () => resolve("cancel") },
			},
			default: "choose",
			close: () => resolve("cancel"),
			render: bringDialogToFront,
		}, { classes: ["dialog", "stonetop", "stonetop-weapon-choice-dialog"] }).render(true);
	});
}

// Several moves offer their damage BOTH ways: Let Fly's "easy shot", Ambush's "you can deal your
// damage or opt to roll +DEX", Call the Shot's "either deal your damage or roll +DEX". Ask which
// one this is. Returns "deal" | "roll" | "cancel".
//
// The question is the move's own trigger, split in two, and each half is asked in the book's words
// rather than paraphrased — which half you are in is the table's call (p.223: a deadeye Ranger just
// rolls damage; a Seeker who has never killed is under pressure), and a prompt that reworded the
// trigger would be quietly moving that line. Rolling is the default button: the roll is where the
// move's list is offered, so a mis-keyed Enter should not spend the half of the move that has
// nothing to pick.
function promptUnrolledDamage(moveName, { question, deal, roll }) {
	return promptAttackMode(moveName, {
		question,
		choices: [
			{ key: "deal", icon: "fa-crosshairs", label: deal },
			{ key: "roll", icon: "fa-dice-d6", label: roll },
		],
		fallback: "roll",
	});
}

/**
 * One question with two answers, in the chrome every attack-mode prompt wears.
	*
 * The two callers differ in the words, the icons and which button Enter takes; the dialog shape,
 * the classes and "closing is a cancel" are one contract between them. Written out twice it was
 * two edits every time that chrome changed, and it has changed once already
 * (`stonetop-letfly-mode-dialog` became `stonetop-attack-mode-dialog`).
 *
 * @param {string} moveName   the dialog's title.
 * @param {string} question   the HTML above the buttons.
 * @param {{key: string, icon: string, label: string}[]} choices  the answers, in reading order.
 *        The key is what the promise resolves to, so each caller reads back its own words.
 * @param {string} fallback   which key a mis-keyed Enter takes.
 * @returns {Promise<string>} the chosen key, or "cancel" for a window closed or dismissed.
 */
function promptAttackMode(moveName, { question, choices, fallback }) {
	return new Promise(resolve => {
		const buttons = {};
		for (const { key, icon, label } of choices) {
			buttons[key] = { icon: `<i class="fas ${icon}"></i>`, label, callback: () => resolve(key) };
		}
		new Dialog({
			title: moveName,
			content: `<form class="stonetop-attack-mode"><p>${question}</p></form>`,
			buttons,
			default: fallback,
			close: () => resolve("cancel"),
			render: bringDialogToFront,
		}, { classes: ["dialog", "stonetop", "stonetop-attack-mode-dialog"] }).render(true);
	});
}

// -- Targets ------------------------------------------------------------------

// Freeze the current user's targets into a plain, storable list. Runs on the attacking
// player's client at click time, where game.user.targets is theirs.
function snapshotTargets() {
	return Array.from(game.user?.targets ?? [])
		.map(t => ({
			uuid: t.document?.uuid ?? null,
			// The TOKEN's name: six crinwin share one actor name, and "Crinwin (4)" is the one that was hit.
			name: t.document?.name || t.name || t.actor?.name || "Target",
			actorId: t.actor?.id ?? null,
			disposition: t.document?.disposition ?? 0,
			hasActor: !!t.actor,
		}))
		.filter(t => t.uuid);
}

// -- Tier action controls (baked into the roll card) --------------------------
// ONE LIST, AND IT IS THE MOVE'S OWN. A move prints its options in its own text, and that list is
// made tickable exactly where it is printed, with the count the prose states above it and the cap
// the prose states enforced on it (utils/chat.js#pickableMoveDescription, wired in stonetop.js).
// All is Illuminated is what that looks like with nothing else on the card: the ladder, the boxes,
// the tally, the result. Every move here reads the same way, and a hit tier adds exactly one
// thing to it — a single Confirm button that rolls the character's damage.
//
// IT WAS TWO LISTS, AND TWO LISTS CANNOT COUNT. For a while each tier grew its own row of
// checkbox-SVG controls for the bullets that changed a number: Clash's two as radios, Ambush's
// "+1d4" and Call the Shot's "your call" as standalone boxes, The Hammer and the Book's two
// mechanical picks of four. That put the same choice on the card twice — the move's four boxes
// under its own "0/1 options selected", and then a subset of those same four again under the
// result — and the two counts could not see each other. Ticking "stun, hobble, or hinder them" up
// top satisfied the 0/1 and left the "your call" box below still free to take, which is two picks
// on a pick-1 with nothing to object. Read as one thing (which is how it reads, because both were
// skinned as the same checkbox-SVG) the second list looked like the first with its options
// dropped. Worse in the other direction: a player who recorded their pick by ticking the printed
// bullet got no +1d4 and no armor-ignoring, because only the lower copy was wired to anything.
//
// So the lower copy is gone, and what it used to carry is read off the printed list instead —
// see PICK_EFFECTS, which says what a bullet DOES, keyed by the bullet's own words. The cap, the
// tally, the release-on-overtick and the per-tier hiding all come free, because they are the ones
// every other move in the book already uses.

/**
 * The three effects a ticked bullet can carry that are not a number: they need a question asked,
 * a resource spent, or the damage roll called off entirely, so the Confirm looks them up by name.
 */
const YOUR_CALL = "your-call";
const DEPLETE   = "deplete";
const NO_HARM   = "no-harm";

/**
 * What each of a move's PRINTED BULLETS does when it is ticked — the whole of what the vanished
 * control row used to carry, hung back on the move's own list.
 *
 * KEYED BY THE BULLET, WORD FOR WORD, and compared through the same normaliser the card's other
 * text comparisons use (utils/chat.js#optionKey), so a typographic apostrophe or an entity cannot
 * split one option into two. Nothing here is a paraphrase and nothing is keyed by position: a
 * world that rewords "Deal +1d4 damage" gets a bullet that ticks and does nothing mechanical,
 * which is the move as that world now writes it, rather than a bullet that quietly applies an
 * effect its text no longer describes. The tests hold every key here against the shipped move's
 * own bullets, so a reword in the pack cannot leave a dead entry behind unnoticed.
 *
 * A bullet absent from a move's table is PURE FICTION — "slip away before they can react",
 * "suppress one of its unnatural powers", "hold steady and wait for a clear shot". It still ticks,
 * still counts against the tier's cap, and still records what the player chose; it just has no
 * number for the card to fold in. That is why the WHOLE list is offered rather than the mechanical
 * half of it: a count is only enforceable over the list the move actually printed.
 */
const PICK_EFFECTS = {
	clash: {
		"Strike hard and fast, for 1d6 extra damage, but suffer your enemy's attack":
			{ extraDice: "1d6", counter: true },
	},
	"let-fly": {
		// The bullet's own parenthesis is a gate: "don't pick this if your weapon lacks such
		// statuses". So a weapon with no ammo track never sees it (wireAttackAmmo hides the row),
		// and on one that has a track, ticking it grows a button that marks the next status.
		"Deal your damage, but deplete your ammo (mark the next status by your weapon; don't pick this if your weapon lacks such statuses)":
			{ addon: DEPLETE },
	},
	ambush: {
		"Deal +1d4 damage": { extraDice: "1d4" },
	},
	"call-the-shot": {
		// ONE bullet, not two halves. Ticking it asks which half, in the move's own two words —
		// see promptYourCall. Split into an ignore-armor option and a +1d4 option it would let a
		// 7-9 "pick 1" quietly take both.
		"Ignore armor or deal +1d4 damage (your call)": { addon: YOUR_CALL },
		// The one bullet that turns the Confirm OFF rather than adding to it. It used to need no
		// control at all, on the reasoning that it is the player not pressing the button — true
		// while the button was the only thing on offer, and false the moment the bullet became a
		// box in a counted list, where taking it and then pressing "Roll your damage" is the card
		// contradicting itself. wireAttackNoHarm relabels the button instead.
		"Do no harm; don't deal your damage after all": { addon: NO_HARM },
	},
	"hammer-and-book": {
		"Deal +1d6 damage": { extraDice: "1d6" },
		"Ignore the thing's armor or other defenses": { ignoresArmor: true },
	},
};

// Normalised once per move and cached: `optionKey` is not free, and this is read on every repaint
// of a Confirm's label as well as on the click that enacts it.
const _effectTables = new Map();
function effectTableFor(moveKey) {
	if (!_effectTables.has(moveKey)) {
		_effectTables.set(moveKey, new Map(
			Object.entries(PICK_EFFECTS[moveKey] ?? {}).map(([bullet, fx]) => [optionKey(bullet), fx])));
	}
	return _effectTables.get(moveKey);
}

/**
 * What a set of ticked bullets comes to, mechanically.
 *
 * Text in, plain object out, so the one place a printed option becomes a die or a flag can be
 * tested against the SHIPPED moves without a DOM — which is the test that would have caught the
 * two-list miscount, because it is the only one that asks what a tick actually DOES.
 *
 * @param {string} moveKey  The attack move's key, as MOVES names it.
 * @param {string[]} labels The text of every bullet currently ticked on the card.
 * @returns {{extraDice: string[], counter: boolean, ignoresArmor: boolean, addons: string[]}}
 */
export function pickedEffects(moveKey, labels) {
	const table = effectTableFor(moveKey);
	const out = { extraDice: [], counter: false, ignoresArmor: false, addons: [] };
	for (const label of labels ?? []) {
		const fx = table.get(optionKey(label));
		if (!fx) continue;
		if (fx.extraDice) out.extraDice.push(fx.extraDice);
		if (fx.counter) out.counter = true;
		if (fx.ignoresArmor) out.ignoresArmor = true;
		if (fx.addon) out.addons.push(fx.addon);
	}
	return out;
}

/**
 * The bullets ticked on THIS card, as text.
 *
 * Read off `.stonetop-picklist-check`, which is the move's own printed list made tickable — the
 * same boxes the tally counts, the cap releases and the message flag persists. A hidden list is
 * skipped: a card carries every tier's options so a GM's Shift Up/Down can reveal the right one,
 * and a tick sitting behind a tier this roll did not land on is not this roll's pick.
 */
function pickedOptionLabels(root) {
	return Array.from(root?.querySelectorAll?.(".stonetop-picklist-check:checked") ?? [])
		.filter(box => !box.closest("[hidden]"))
		.map(pickedOptionText);
}

// A bullet's own words: the LABEL, not the whole row. A ticked row can carry a button beneath it
// ("Deplete your ammo", wireAttackAmmo), and the row's text would then no longer be the bullet's,
// so it would miss its PICK_EFFECTS entry and quietly do nothing.
function pickedOptionText(box) {
	const item = box.closest(".stonetop-picklist-item");
	return (item?.querySelector("label") ?? item)?.textContent ?? "";
}

// What a Confirm that only rolls damage says. Named because five of the six tiers below use it.
const ROLL_DAMAGE = { label: "Roll your damage", icon: "fa-dice-d6" };

// The single button that enacts the tier: it rolls the PC die per target, folding in whatever the
// move's ticked bullets add. `counter` is the tier's OWN value — what the tier says whatever the
// player picks, like Clash's 7-9 suffering the attack, which the click fires once the damage is
// posted — and the ticked bullets stack on top.
//
// IT DOES ONE THING. It used to carry a `data-action` naming which, because a failure tier could
// hang a "Suffer your enemy's attack" here instead; that tier has no button at all now (see
// buildTierActions), so every one of these rolls damage and an attribute saying so said nothing.
// Its label is not a parameter either: every tier rolls damage, so every one of them says so, and
// wireAttackNoHarm repaints the pair that Call the Shot can silence.
function confirmBtn(counter = false) {
	return `<button type="button" class="stonetop-attack-btn stonetop-attack-confirm"
		data-counter="${counter ? 1 : 0}">
		<i class="fas ${ROLL_DAMAGE.icon}"></i> ${escHtml(ROLL_DAMAGE.label)}
	</button>`;
}

// ...and what it says instead while Call the Shot's "do no harm" is held. Same button, same
// place — a tier that has been told to deal no damage must not offer to roll it.
const NO_DAMAGE = { label: "Deal no damage", icon: "fa-ban" };

/**
 * One button per result tier on the roll card. Only the rolled tier's shows, so each names the
 * action it enacts — a bare "Confirm" is unclear on a card whose options are up in the move's own
 * text. Every tier here deals the character's damage, so every one of them says so.
 *
 * NO OPTIONS LIVE HERE. They are the move's printed bullets, ticked where they are printed; what
 * they do when ticked is PICK_EFFECTS above. The only number a button carries is the tier's own
 * unconditional one, which the move's own entry declares (`counterOnPartial`): Clash's 7-9 suffers
 * the enemy's attack whatever else the player picks.
 *
 * AND NO TIER OFFERS TO BE HIT. Clash's 6- is "your maneuver fails and you suffer your enemy's
 * attack" — no damage dealt, no pick to make, nothing a player could decide. It carried a "Suffer
 * your enemy's attack" button all the same, which made a flat consequence read as an offer and
 * left the blow sitting unstruck in the log whenever the table moved on without pressing it. The
 * miss fires its own counter-attack now (maybeCounterOnMiss), so the failure tier is back to
 * having no button at all, like the other four moves' misses.
 */
export function buildTierActions(move) {
	// The 10+ never carries a counter: Clash's strike-hard 1d6 and its counter-attack both ride
	// the tick (PICK_EFFECTS), so the button itself promises neither.
	//
	// Ambush, Call the Shot and The Hammer and the Book deal your damage on both hit tiers and
	// differ only in how many of the printed list you take, which the list itself counts. Their
	// 6- is "the GM makes a move" — nothing for the player to enact, so no button at all.
	//
	// Let Fly takes the same pair: its 10+ has no list, and its 7-9's four bullets are the
	// description's, one of which spends the quiver.
	const roll = confirmBtn();
	return { success: roll, partial: move.counterOnPartial ? confirmBtn(true) : roll };
}

/**
 * Battle Dancer (Fox): "When you roll +DEX to Clash, on a 12+ you deal your damage, avoid your enemy's
 * attack, and impress/embarrass/overawe your foes."
 *
 * THE 12+ REPLACES THE PICK (the user's ruling). It is not the 10+ with a bonus on top: the Fox takes
 * all three, so the pick-1 list goes, and "Strike hard and fast ... but suffer your enemy's attack"
 * cannot be ticked into a counter-attack the move just said they avoid.
 *
 * Two halves, because they are known at different times. Whether this Clash was rolled +DEX by someone
 * with Battle Dancer learned is known only before the dice, so it rides the card (`battleDancer`, from
 * `dancesAt`). Whether it came to 12 is read off the card's roll every time it is asked, so a GM's Shift
 * Up onto a 12 turns it on and a Shift Down off one turns it back off.
 */
function dancesAt(actor, move, stat) {
	return move?.key === "clash" && String(stat ?? "").toLowerCase() === "dex"
		&& ownsLearnedBookMoveNamed(actor, BATTLE_DANCER);
}

/** Is this Clash card a Battle Dancer 12+? Read live off the card's roll (see dancesAt). */
export function battleDancing(message, attack = message?.getFlag?.(SCOPE, "attack")) {
	return !!attack?.battleDancer && Number(message?.rolls?.[0]?.total) >= 12;
}

/** The notice that stands where the pick-1 list was, on a Battle Dancer 12+. */
const BATTLE_DANCER_NOTICE = "stonetop-battle-dancer-notice";

/**
 * Show a Battle Dancer 12+ on its card: the move's pick-1 list (and its tally) hidden and its boxes
 * locked, and in their place what the 12+ does instead. Hidden rather than removed, and the notice
 * taken back off when the card is no longer a 12+, because a GM's Shift can move it either way and the
 * card re-renders (the list's own visibility is repainted each render, stonetop.js#_paintPickCount).
 */
function wireBattleDancer(message, root, attack) {
	const dancing = battleDancing(message, attack);
	for (const list of dancing ? root.querySelectorAll?.(".stonetop-picklist") ?? [] : []) {
		list.hidden = true;
		const tally = list.previousElementSibling;
		if (tally?.classList?.contains("stonetop-picklist-count")) tally.hidden = true;
		for (const box of list.querySelectorAll(".stonetop-picklist-check")) box.disabled = true;
	}
	const existing = root.querySelector?.(`.${BATTLE_DANCER_NOTICE}`) ?? null;
	if (!dancing) { existing?.remove(); return; }
	if (existing) return;
	const actions = root.querySelector?.(".stonetop-roll-tier-actions");
	if (!actions?.parentNode) return;
	const holder = actions.ownerDocument.createElement("div");
	holder.innerHTML = cardNoticeHtml({
		className: BATTLE_DANCER_NOTICE,
		icon: "fa-wind",
		title: escHtml(localize("stonetop.fight.heroMoves.battleDancer.title")),
		lead: localize("stonetop.fight.heroMoves.battleDancer.lead"),
		items: ["deal", "avoid", "impress"].map(key => `<li>${escHtml(localize(`stonetop.fight.heroMoves.battleDancer.${key}`))}</li>`),
	});
	const notice = holder.firstElementChild;
	if (notice) actions.parentNode.insertBefore(notice, actions);
}

// -- Entry point (called from StonetopCharacter.onRoll) -----------------------

/**
 * If `item` is an attack move, run the pre-roll steps (Let Fly easy-shot choice,
 * weapon pick, target snapshot) and return the extra roll options to fold into the
 * 2d6 roll: { tierActions, messageFlags }. Returns:
 *   - null       → not an attack move; roll normally
 *   - "handled"  → a no-roll easy shot was posted; the caller must NOT roll
 *   - "cancel"   → the player cancelled a prompt; abort
 *   - { … }      → merge into the roll options
 *
 * `weaponSlug` names a weapon the caller has ALREADY chosen (clicking Purifying Flames is
 * choosing the holy light), which skips the weapon prompt.
 */
export async function maybeBeginAttack(actor, item, { stat = null, weaponSlug = null } = {}) {
	const move = attackMoveFor(item);
	if (!move) return null;

	let unrolled = false;
	if (move.unrolled) {
		const mode = await promptUnrolledDamage(item.name, move.unrolled);
		if (mode === "cancel") return "cancel";
		unrolled = mode === "deal";
	}

	// Rolling the stat a granted weapon rides on (+WIS to Clash → Purifying Flames)
	// pre-selects that weapon, so the d10 the move promises is what's in hand by default.
	const candidates = await carriedAttackWeapons(actor, move);
	const preferSlug = candidates.find(c => c.whenStat && c.whenStat === stat)?.slug ?? null;
	// Both "which weapon should be pre-checked" and "is there anything to ask at all" are the
	// prompt's own call — see promptWeaponChoice.
	const picked = await promptWeaponChoice(candidates, item.name, { preferSlug, forceSlug: weaponSlug });
	if (picked === "cancel") return "cancel";
	const weapon = picked.weapon ? serializeWeapon(picked.weapon) : null;

	// Who it hits: the foes targeted by hand, else whoever the character is fighting on the map, with
	// "Who does this hit?" when that is more than one (fight/fight-targets.js). Frozen here like any
	// hand target, so every later step reads the same list.
	// Blot Out the Sun, asked before the dice as the move says, and Berserker, which needs no asking.
	const loosed = await askBlotOutTheSun(actor, move, weapon);
	if (loosed === "cancel") return "cancel";
	const area = loosed.area || (move.key === "clash" && berserkMelee(actor, weapon));

	// A Heavy's Battle Joy sweeps what stands around the HEAVY; a volley sweeps what stands around the
	// foes it was loosed at, which is the other end of the shot (fight/fight-targets.js#bystanders).
	const targets = await rollTargets(actor, { handTargets: snapshotTargets(), area, areaAround: loosed.area ? "targets" : "roller" });
	if (targets === null) return "cancel";
	if (targets.length === 0 && !unrolled) {
		ui.notifications?.info("No foe targeted: you can still target one with T before rolling damage.");
	}

	if (unrolled) {
		// Dealing your damage without rolling means there is no card to adjust it from later, so
		// this is the only moment it can be adjusted — and backing out of the window has to abort
		// the attack rather than deal it unmodified, which is what "cancel" tells the caller.
		const damage = await askDamageAdjustment(actor, { moveKey: move.key, weapon, seed: seedForTargets(actor, targets), targets, rollMode: loosed.damageMode });
		if (!damage) return "cancel";
		// THE ARROWS COME OFF LAST, once nothing left can call the shot off. An easy shot has no card to
		// roll damage from later, so its damage window is the final question — and a quiver emptied before
		// a window the player then closed would be a volley that cost ammo and dealt nothing.
		await loosed.spend?.(actor, weapon);
		await rollAndPostDamage(actor, { move: item.name, weapon, targets, damage, fx: { moveKey: move.key } });
		return "handled";
	}

	// A rolled shot is loosed the moment the dice are: the card that follows carries the advantage the
	// ammo bought, and backing out of who it hits (above) was the last way back.
	await loosed.spend?.(actor, weapon);

	return {
		tierActions: buildTierActions(move),
		// `damageMode` rides the card because the ammo was spent HERE and the damage is rolled later, off
		// the Confirm button: an advantage bought before the roll has to still be there when it happens.
		// `battleDancer` is settled here because only here is the stat rolled known; whether the total
		// reached 12 is read off the card itself, so a GM's Shift Up/Down moves it (battleDancing).
		messageFlags: attackFlagEnvelope({ move: item.name, moveKey: move.key, attackerUuid: actor.uuid, weapon, targets, ...(loosed.damageMode ? { damageMode: loosed.damageMode } : {}), ...(dancesAt(actor, move, stat) ? { battleDancer: true } : {}) }),
	};
}

/** A bow, as Blot Out the Sun means it: not a sling, and not a crossbow. */
function isBow(weapon) {
	const name = String(weapon?.name ?? "");
	return weapon?.slug === "bow-arrows" || (/\bbow\b/i.test(name) && !/crossbow/i.test(name));
}

/**
 * Blot Out the Sun (Ranger): "When you Let Fly with a bow, you can deplete your ammunition (mark the
 * next ammo status after your weapon) BEFORE YOU ROLL. If you do, choose 1: gain advantage on your
 * damage roll; or add the area tag to your attack, rolling damage separately for each target."
 *
 * Asked here because "before you roll" is here, and because the ammo is spent whichever of the two they
 * take. Closing the window is not spending it: the volley simply is not loosed.
 *
 * @returns {Promise<"cancel"|{damageMode: string, area: boolean}>}
 */
async function askBlotOutTheSun(actor, move, weapon) {
	const none = { damageMode: "", area: false };
	if (move.key !== "let-fly" || !isBow(weapon) || !ownsLearnedMoveNamed(actor, BLOT_OUT_THE_SUN)) return none;
	const picked = await promptAttackMode(BLOT_OUT_THE_SUN, {
		question: localize("stonetop.fight.heroMoves.blotOut.question"),
		choices: [
			{ key: "advantage", icon: "fa-bullseye", label: localize("stonetop.fight.heroMoves.blotOut.advantage") },
			{ key: "area", icon: "fa-cloud-arrow-down", label: localize("stonetop.fight.heroMoves.blotOut.area") },
			{ key: "keep", icon: "fa-ban", label: localize("stonetop.fight.heroMoves.blotOut.keep") },
		],
		fallback: "keep",
	});
	if (picked === "cancel") return "cancel";
	if (picked === "keep") return none;
	// ASKED NOW, PAID LATER: the question shapes who the volley falls on, so it has to come before the
	// targets; the arrows come off once those are settled (see the caller), because a question backed out
	// of is a shot never loosed.
	const spend = async (archer, bow) => {
		const spent = await advanceWeaponAmmo(archer, bow);
		await ChatMessage.create({
			content: stonetopChatCard(BLOT_OUT_THE_SUN, `<div class="card-content"><p>${escHtml(format("stonetop.fight.heroMoves.blotOut.spent", {
				name: archer.name, weapon: bow?.name ?? "", status: spent.label,
			}))}</p></div>`, "stonetop-blot-out-card"),
			speaker: ChatMessage.getSpeaker({ actor: archer }),
		});
	};
	return picked === "advantage" ? { damageMode: "adv", area: false, spend } : { damageMode: "", area: true, spend };
}

// The flag envelope the roll carries to its ChatMessage, and the one way to read it back before
// that message exists to `getFlag` it off. A pair rather than two hand-written paths: the reader
// is in another function (maybeCounterOnMiss), and a walk spelled out there goes silently empty
// the day the key is renamed here.
const attackFlagEnvelope = attack => ({ [SCOPE]: { attack } });
const attackFlagsOf = extra => extra?.messageFlags?.[SCOPE]?.attack ?? null;

/**
 * The advantage a REMEMBERED FOE owes this attack roll, or null: Relentless on a Clash with someone who
 * survived the last one, But I Get Up Again against whoever knocked you down
 * (fight/hero-moves.js#foeAdvantage). Named, because the card says where an advantage came from.
 *
 * Read off the attack the roll is about to make, so it knows who is being attacked: the targets were
 * settled a moment ago by `maybeBeginAttack`, before any dice.
 */
export function attackFoeAdvantage(actor, attackExtra) {
	const attack = attackFlagsOf(attackExtra);
	if (!attack?.targets?.length) return null;
	return foeAdvantage(actor, attack.targets, { clash: attack.moveKey === "clash" });
}

/**
 * Write down the foes a Clash left standing, once the dice have landed (fight/hero-moves.js#recordClash).
 * Nemesis and Relentless both read it; a character with neither writes nothing.
 */
export async function recordClashedFoes(actor, attackExtra) {
	const attack = attackFlagsOf(attackExtra);
	if (attack?.moveKey !== "clash" || !attack.targets?.length) return false;
	return recordClash(actor, attack.targets);
}

// -- Damage rolling + the results card ----------------------------------------

// The PC's damage die, as the sheet shows it: a die typed into the Damage field wins,
// then the playbook's die raised by any marked move (Potential for Greatness' "increase
// your damage die to a d8"). `system.attributes.damage.value` only records what was
// written when the playbook was dropped or the field edited, so a mark-raised die would
// otherwise keep rolling at its old size. Asked of the actor's OWN StonetopCharacter
// (cached on the document, with its compendium repositories already warm) rather than a
// throwaway one, so a damage roll doesn't re-index the items pack.
// Exported for the fight ring (fight/fight-ring.js), whose Damage button rolls this same die.
export async function pcDamageDie(actor) {
	const stored = String(actor?.system?.attributes?.damage?.value ?? "").trim();
	if (actor?.type !== "character") return stored;
	// computedDamageDie, not buildSnapshot: the same answer, without building a whole sheet for one
	// string. This runs per damage ROLL — twice over on the counter-attack and multi-target paths —
	// and the snapshot it used to ask walks moves, inventory, arcana, possessions and post-death
	// lore to get there. `stored` remains the fallback for a character with no playbook resolved.
	return (await actor.typedActor?.computedDamageDie?.()) || stored;
}

// The damage formula for one attack: the PC die (or the weapon's own die), plus the
// weapon's +N damage, plus any extra dice (Clash 10+ strike-hard's +1d6). `fallback` is the die
// rolled when neither has one; "" answers "" there instead (characterBlow).
async function damageFormula(actor, weapon, extraDice, { fallback = "d6" } = {}) {
	const die   = weapon?.damageDie || await pcDamageDie(actor) || fallback;
	if (!die) return "";
	const bonus = weapon?.damageBonus ? sign(weapon.damageBonus) : "";
	return composeDamageFormula(`${die}${bonus}`, { extraDice });
}

// How this attack's damage is named — on the window that asks about it and on the card that
// reports it, which have to be the same words or the window reads as belonging to some other roll.
function damageLabel(move, weapon) {
	// `weapon?.name`, not `weapon`: an attack with nothing in hand that still ignores armor carries
	// a nameless weapon record (see rollAndPostDamage), and a bare "Call the Shot: " would read as
	// a title someone forgot to finish.
	return `${move}${weapon?.name ? `: ${weapon.name}` : ""}`;
}

/**
 * Ask what this attack's damage roll should be, and return everything rolling it needs:
 * `{ base, rollMode, bonus, extraDice }`, or null if the player backed out.
 *
 * Split out from the rolling itself because the caller has irreversible work to do in
 * between — latching the card resolved, marking the ammo spent — and a cancelled window has
 * to leave the Confirm button clickable, not a locked card with no damage on it. So the
 * question is asked FIRST, and nothing is committed until it has an answer.
 *
 * `base` travels with the answer so the die is derived once. Working it out means resolving
 * the playbook and its damage-raising marks (see pcDamageDie), and doing that a second time
 * just to compose the same string is work the roll can skip.
 *
 * WHAT THE PEOPLE BEING HIT BRING IS SETTLED HERE, for every caller. It used to be the caller's to
 * fold in, and only one of the four did: the attack card's Confirm, an easy shot and a strike back all
 * dropped Never Gonna Keep Me Down and Big Damn Hero's locked eyes on the floor. One window, one place
 * that reads the defenders.
 *
 * `commit` is the caller's own price for the blow, taken once the window is answered and BEFORE any
 * ticked line is paid for: a Parry & Riposte that cannot be afforded stops the strike back, and a
 * stopped blow must not have spent the player's Resolve on the way (see strikeBackAt). It is handed
 * the keys of the lines the window came back with ticked, so a parry can tell its Second Intent card
 * whether the +1d4 was the pick (fight/defend-spend.js#spendOnBlow).
 *
 * `parry` marks a strike back as the one a Parry & Riposte bought (fight/hero-moves.js#blowOffers).
 */
async function askDamageAdjustment(actor, { moveKey = "", weapon, extraDice = "", shiftKey = false, seed = null, formula = "", rollMode: noted = "", offers = null, defenders = null, attacker = "", targets = [], strikeBack = false, parry = false, attackAt = Date.now(), commit = null } = {}) {
	// A stat block's blow brings its own die and its own "w/disadvantage" (rollDamageAt); an attack
	// move works both out from the character.
	const base     = formula || await damageFormula(actor, weapon, extraDice);
	// A follower striking from the sheet (`attacker`) is not dealing the character's damage: no Dangerous,
	// and no nerves of the character's either.
	const moved    = noted || damageAdvantageFrom(actor, moveKey, weapon);
	const sharp    = attacker ? moved : ownDamageMode(actor, moved);
	// `defenders` is defenderModes' answer when the caller already had to work it out (rollDamageAt):
	// asking twice means a buildSnapshot per target twice over.
	const known    = defenders ?? await defenderModes(targets);
	// The roller's side has its say first, then the people being hit answer it: Dangerous cannot sharpen
	// a blow twice over, so an advantage it re-states is still one advantage for locked eyes to cancel.
	const rollMode = await incomingMode(actor, targets, sharp, { defenders: known });
	// The character's own moves that add to this blow (fight/hero-moves.js#blowOffers). A follower's blow
	// is not the character's, so it is offered none of them.
	const lines    = offers ?? [
		...(attacker ? [] : heroOffers(actor, { targets, weapon, strikeBack, parry, attackAt })),
		// ...and what the people being hit bring to it, which is theirs to untick rather than the roller's.
		...defenderLines(known.offered),
	];
	// `attacker` names a follower swinging from their character's sheet (rollFollowerDamageAt).
	const adjust   = await promptDamage({ attacker: attacker || actor?.name, formula: base, shiftKey, ...(rollMode ? { rollMode } : {}), seed, offers: lines });
	if (!adjust) return null;
	// What the ticked lines cost and what they add beyond dice: a Resolve off the track, a tag on the blow.
	const taken    = takenOffers(lines, adjust);
	if (commit && !await commit(taken.map(offer => offer.key))) return null;
	for (const offer of taken) await offer.spend?.(actor);
	const addTags  = taken.flatMap(offer => offer.tags ?? []);
	return { base, ...adjust, ...(addTags.length ? { addTags } : {}) };
}

/** Which of the offered lines the window came back with ticked (dialogs/RollDialog.js#withOffers). */
function takenOffers(offers, adjust) {
	const ticked = new Set((Array.isArray(adjust?.extraDice) ? adjust.extraDice : [])
		.map(entry => (entry && typeof entry === "object" ? entry.key : null)).filter(Boolean));
	return (offers ?? []).filter(offer => ticked.has(offer.key));
}

/**
 * A blow with NOTHING IN HAND, as a weapon record: fists, at hand.
 *
 * Every reader of a weapon's `range` treats a null weapon as unarmed and so as melee (berserkMelee
 * below, fight/hero-moves.js#muscleboundWeapon, both `weapon?.range ?? ["hand"]`) — but an EMPTY range
 * is not null, so the moment a bare-handed blow has to be written down as a record to carry a keyword
 * or an armor clause, writing it down as `range: []` silently unmakes it as a melee attack. A Heavy's
 * Musclebound fists lost their forceful and messy exactly there, and only when someone was targeted.
 */
const unarmedWeapon = () => ({ name: "", range: ["hand"] });

/**
 * `weapon` with the tags a ticked damage line bought laid on top of its own — Anger is a Gift's "strike
 * hard (+1d4 damage, forceful)". Shared by both cards: the targeted one prints the tag in each row's
 * fine print and the no-target one owes it a notice, and a copy per card is how the two stop agreeing
 * about what a blow just became. `unarmedWeapon` rather than a bare record, for the reason it gives.
 */
function withAddedTags(weapon, added) {
	const tags = Array.isArray(added) ? added : [];
	if (!tags.length) return weapon;
	const base = weapon ?? unarmedWeapon();
	return { ...base, tags: [...new Set([...(base.tags ?? []), ...tags])] };
}

/**
 * Berserker: "While in your Battle Joy, add the area tag to your melee attacks, lashing out at anyone
 * nearby (friend and foe alike)." True for a melee blow — a weapon with reach of hand, close or reach,
 * or nothing in hand at all — while the Joy is on.
 */
function berserkMelee(actor, weapon) {
	if (!berserkNow(actor)) return false;
	const range = weapon?.range ?? ["hand"];
	return range.some(r => MELEE_RANGES.has(r));
}

/**
 * What this blow rolls at once the people it is aimed at have had their say: locked eyes from the
 * attacker's side, and the moves a character's own skin carries — Never Gonna Keep Me Down at 5 HP or
 * less, Uncanny Reflexes unarmored and light, Battlefield Grace leading allies
 * (fight/hero-moves.js#defenderDisadvantage).
 *
 * EVERY TARGET MUST CARRY IT, because one roll is made per card and the mode is the card's: a blow at
 * two people cannot roll twice over for one of them. Advantage and disadvantage cancel (p.230).
 */
async function incomingMode(actor, targets, rollMode, { includeOffered = false, defenders = null } = {}) {
	const { imposed, offered } = defenders ?? await defenderModes(targets);
	// The offered ones are ticked boxes on the damage window; where there is no window to untick them on
	// (a counter-attack rolls straight off the card), they simply apply, as a ticked box would.
	const carried = imposed.length || (includeOffered && offered.length);
	// GATHERED AND FOLDED ONCE, not laid on one at a time. Big Damn Hero's locked eyes
	// (fight/hero-moves.js#eyesLockedAgainst) and the defender's own skin are two voices saying the
	// same "dis", and neither side stacks with itself: against an advantaged blow they cancel with it
	// and the roll is straight. Stepped in sequence, the second one landed on the straight roll the
	// first had just cancelled to and pushed the blow to disadvantage instead.
	return foldModes([
		...(eyesLockedAgainst(actor, targets).length ? ["dis"] : []),
		...(carried ? ["dis"] : []),
	], rollMode);
}

/**
 * What the people this blow is aimed at bring to its roll, ALL OR NOTHING: one roll is made per card,
 * so a rule only counts when every target carries it — a blow at two people cannot roll twice over for
 * one of them. Nothing for a row that no longer resolves, or for anyone who is not a character.
 *
 * @returns {Promise<{imposed: string[], offered: Array<{actor: Actor, move: string}>}>}
 */
async function defenderModes(targets) {
	const empty = { imposed: [], offered: [] };
	if (!targets?.length) return empty;
	const actors = resolveDamageActors(targets);
	if (!actors?.length || !actors.every(a => a?.type === "character")) return empty;
	const carried = await Promise.all(actors.map(defenderDisadvantage));
	const everyone = names => carried.every(one => one[names].length > 0);
	return {
		imposed: everyone("imposed") ? [...new Set(carried.flatMap(one => one.imposed))] : [],
		// A move only every target has: the name, and whose sheet it is on, for the window's words.
		offered: carried[0].offered
			.filter(move => carried.every(one => one.offered.includes(move)))
			.map(move => ({ actor: actors[0], move })),
	};
}

/**
 * The damage window's lines for the moves the people being hit bring: Uncanny Reflexes and Battlefield
 * Grace, each ticked, each naming the clause it rests on so the table can untick it
 * (fight/hero-moves.js#defenderDisadvantage). PURE: it is handed defenderModes' `offered`.
 */
function defenderLines(offered) {
	return (offered ?? []).map(({ actor, move }) => {
		const key = defenderMoveKey(move);
		if (!key) return null;
		return {
			key, mode: "dis", applied: true,
			label: format(`stonetop.fight.heroMoves.${key}.label`, { name: actor.name }),
			pill: format(`stonetop.fight.heroMoves.${key}.pill`, {}),
		};
	}).filter(Boolean);
}

/**
 * Defend's strike back at the one who struck, from a Parry & Riposte on the damage card: "strike back at
 * the attacker (deal your damage with disadvantage)". The attacker is the card's roller, as a target, so
 * Apply takes their armor off; with nobody to find, the plain damage card.
 *
 * `commit` takes the strike back's cost (defend-spend.js#spendOnBlow), called once every question is
 * answered and before anything is rolled, so backing out of the weapon or the damage window costs
 * nothing. With no damage die to strike with there is no strike back, but the cost is still taken: a
 * Parry & Riposte halves the blow either way. It is handed to the damage window rather than called
 * after it, because the window pays for its own ticked lines the moment it is answered — a Resolve off
 * Anger is a Gift's track, say — and a refused commit has to stop the blow before any of that.
 *
 * @param {Actor} actor         the defender
 * @param {string} attackerUuid the card's attacker (an actor's uuid, a token's actor for a monster, or a foe's token)
 * @param {string} label        the card's title
 * @param {object} [options]
 * @param {(ticked?: string[]) => Promise<boolean>} [options.commit]  false stops the strike back unrolled;
 *   handed the keys of the damage window's ticked lines (none when there was no die to strike with)
 * @returns {Promise<boolean>} whether a strike back was rolled
 */
export async function strikeBackAt(actor, attackerUuid, label, { commit = async () => true } = {}) {
	if (!actor) return false;
	// "Deal your damage": with the weapon in hand, its +N, die, piercing and tags and all.
	const blow = await characterBlow(actor, label);
	if (!blow) return false;
	if (!blow.formula) { await commit(); return false; }
	const doc = attackerUuid ? await fromUuid(attackerUuid).catch(() => null) : null;
	// A foe's blow names its token; an attack card names its roller's actor.
	const isToken = doc?.documentName === "Token";
	const attacker = isToken ? doc.actor : doc;
	const scene = globalThis.canvas?.scene ?? null;
	const token = (isToken ? doc : null) ?? attacker?.token
		?? (attacker?.getActiveTokens?.(false, true) ?? []).find(t => t?.parent?.id === scene?.id) ?? null;
	const targets = token ? [{ uuid: token.uuid, name: token.name ?? attacker.name, actorId: attacker?.id ?? null, disposition: token.disposition ?? 0, hasActor: true }] : [];
	const damage = await askDamageAdjustment(actor, { formula: blow.formula, rollMode: "dis", seed: null, weapon: blow.weapon, targets, strikeBack: true, parry: true, commit });
	if (!damage) return false;
	await rollAndPostDamage(actor, { move: blow.move, weapon: blow.weapon, targets, damage, fx: {} });
	return true;
}

/**
 * The fight's +N for damage about to hit `targets`, or null (fight/damage-seed.js#seedForRoll): the
 * pile-on against ONE target, since an attack that hurts several rolls damage separately against each
 * (p.414), or a group token's group-against-group bonus.
 */
function seedForTargets(actor, targets) {
	return seedForRoll({ attacker: actor, targets });
}

/**
 * Roll damage at whoever the roller is fighting, for the controls that roll damage outside an attack
 * move: a character's Damage die, a stat block's blows and its rolling moves, and the fight ring.
 *
 * WITH A TARGET, it is the attack flow's own damage card: a total per target, and one Apply that takes
 * each target's armor off with the blow's own piercing or "ignores armor". A monster's bite reaches a
 * character's HP through the same arithmetic a character's axe reaches a monster's, which is how a foe's
 * counter-attack has always arrived (postIncomingDamage).
 *
 * WITH NOBODY TO HIT (no hand target, not fighting anyone, or the Fight tab off), it is the plain damage
 * card the control always posted, tags, description and all.
 *
 * @param {Actor} actor
 * @param {object} options
 * @param {string} options.formula      the die, carrying any +N of its own
 * @param {string} options.label        the card's title: the blow's name, or "Damage"
 * @param {string} [options.keywords]   the blow's tags, printed beside each total
 * @param {string} [options.description] a monster move's text, on the plain card
 * @param {string} [options.rollMode]   the stat block's own advantage on this die
 * @param {object} [options.weapon]     utils/damage.js#attackWeapon, for the armor Apply takes off
 * @param {boolean} [options.seeded]    offer the fight's +N (off for a row whose formula has its own)
 * @param {boolean} [options.shiftKey]  skip the damage window
 * @param {{name: string, group: boolean}|null} [options.striker]  a follower off the map striking beside
 *   `actor`, who aims the blow (rollFollowerDamageAt): the windows name them, and the blow takes none of the
 *   actor's +N, damage moves or shot record
 * @returns {Promise<boolean>} whether damage was rolled
 */
export async function rollDamageAt(actor, { formula, label, keywords = "", description = "", rollMode = "", weapon = null, seeded = true, shiftKey = false, striker = null, strikeBack = false } = {}) {
	if (!actor || !formula) return false;
	const attacker = striker?.name ?? "";
	seeded = seeded && !striker;
	// Berserker: in their Battle Joy a Heavy's melee attacks gain the area tag, "lashing out at anyone
	// nearby (friend and foe alike)", so the question lists everyone within reach rather than the foes.
	const targets = await rollTargets(actor, { handTargets: snapshotTargets(), roller: attacker, area: !striker && berserkMelee(actor, weapon) });
	if (targets === null) return false;
	if (!targets.some(t => t.hasActor !== false && t.uuid)) {
		// Nobody to hit: the plain card, with the roller's own lines only — there is no target to bring any.
		const offers = striker ? [] : heroOffers(actor, { targets, weapon, strikeBack });
		// askDamageAdjustment, NOT rollDamagePrompted, for the half rollDamagePrompted does not do: a
		// ticked line has to be PAID FOR and may put a tag on the blow. Handed to the plain card it
		// took the offer's dice and nothing else, so a no-target Anger is a Gift rolled its +1d4 free
		// every time, forever, and the forceful the Resolve bought never reached the table.
		const damage = await askDamageAdjustment(actor, {
			formula, offers, shiftKey, attacker, strikeBack,
			rollMode: striker ? rollMode : ownDamageMode(actor, rollMode),
			seed: seeded ? sheetSeed({ actor }) : null,
		});
		if (!damage) return false;
		// The fiction the weapon's tags owe, as a Clash with nobody targeted prints it (rollAndPostDamage).
		// Worked out AFTER the window, because a tag a ticked line just bought owes its notice too.
		const notices = tagNoticesHtml(withAddedTags(striker ? weapon : muscleboundWeapon(actor, weapon), damage.addTags));
		const { base, addTags, ...adjust } = damage;
		const roll = await rollDamage(base, actor, {
			label, keywords, description, ...adjust,
			...(notices ? { notices } : {}),
		});
		// The Heavy spilling blood (combat/battle-joy-offer.js), and attacking ending a Fox's or Ranger's
		// being unseen (actors/character/fight-states.js). A follower's blow is theirs, not the character's.
		if (!striker) {
			askBattleJoy(actor, label, [roll?.total]);
			await revealOnAttack(actor, label);
		}
		return true;
	}

	// What the people being hit bring, worked out ONCE and handed on: it settles the roll mode AND fills
	// the window's ticked lines, and behind it is a buildSnapshot per target
	// (fight/hero-moves.js#defenderDisadvantage). The folding itself is the window's, for every caller.
	const defenders = await defenderModes(targets);
	const damage = await askDamageAdjustment(actor, {
		// No `offers` here: the window builds them from the blow itself, so it can add what the people
		// being hit bring as well as what the roller does (askDamageAdjustment).
		formula, rollMode, defenders, shiftKey, seed: seeded ? seedForTargets(actor, targets) : null, attacker, targets, strikeBack,
	});
	if (!damage) return false;
	await rollAndPostDamage(actor, {
		own: !striker,
		move: label,
		// The tags ride the weapon to each row's fine print; nothing is stored from them (see damageRowDetail).
		weapon: { ...(weapon ?? unarmedWeapon()), keywords },
		targets,
		damage,
		shots: !striker,
		groupBlow: !!striker?.group,
		// A stat block's weapon has no name: its "bite" is the label. A follower off the map has no
		// token to swing from, so its blow is heard and not drawn.
		fx: { blow: label, ...(striker ? { attacker: null } : {}) },
	});
	if (!striker) await revealOnAttack(actor, label);
	return true;
}

/**
 * Which weapon a character's own damage roll is dealt with, outside an attack move: asked the way Clash
 * asks (promptWeaponChoice: nothing to ask with one weapon or none), from anything they could swing or
 * loose. Returns the serialized weapon, null for none, or "cancel".
 *
 * @param {Actor} actor
 * @param {string} title  the window's title
 */
export async function chooseDamageWeapon(actor, title) {
	if (actor?.type !== "character") return null;
	const candidates = await carriedAttackWeapons(actor, { filter: isAnyAttackWeapon });
	const picked = await promptWeaponChoice(candidates, title);
	if (picked === "cancel") return "cancel";
	return picked.weapon ? serializeWeapon(picked.weapon) : null;
}

/**
 * A character's damage with the weapon in their hand, at whoever they are fighting: the sheet's Damage
 * cell and the fight ring's Damage and Strike back. The weapon's +N, its own die, piercing, "ignores
 * armor" and tags ride the roll exactly as they do on Clash (damageFormula, rollAndPostDamage).
 *
 * @param {Actor} actor
 * @param {object} [options]
 * @param {string} [options.label]     the card's title
 * @param {string} [options.rollMode]  "dis" for a strike back
 * @param {boolean} [options.seeded]   offer the fight's +N (off for a strike back: one defender's blow).
 *   A seeded blow is the character going on the offense, so dealing it holding Readiness asks whether
 *   they keep it (p.216, combat/readiness-loss.js); a strike back spends its own Readiness instead.
 * @param {boolean} [options.shiftKey] skip the damage window
 * @returns {Promise<boolean>} whether damage was rolled
 */
export async function rollCharacterDamageAt(actor, { label = "Damage", rollMode = "", seeded = true, shiftKey = false, strikeBack = false } = {}) {
	if (!actor) return false;
	const blow = await characterBlow(actor, label);
	if (!blow) return false;
	const rolled = await rollDamageAt(actor, { formula: blow.formula, label: blow.move, rollMode, weapon: blow.weapon, seeded, shiftKey, strikeBack });
	if (rolled && seeded) await settleReadinessOnAttack(actor, label);
	return rolled;
}

/**
 * "Deal your damage" outside an attack move, as far as the roll: the weapon in hand (chooseDamageWeapon),
 * its formula, and the card title naming it. Null when the player backed out of choosing. The formula is
 * "" when neither the weapon nor the character has a die: unlike Clash, nothing here invents a d6, and
 * the sheet and the ring draw no Damage button for a character without one.
 */
async function characterBlow(actor, label) {
	const weapon = await chooseDamageWeapon(actor, label);
	if (weapon === "cancel") return null;
	return { weapon, formula: await damageFormula(actor, weapon, "", { fallback: "" }), move: damageLabel(label, weapon) };
}

/**
 * A follower's damage from their card on the character's sheet (its Damage, a group's Damage, and the
 * Swarm and Group-vs-group rows), aimed like every other damage roll.
 *
 * A FOLLOWER WITH A TOKEN IN THE FIGHT rolls as that token: the roll its fight ring button makes
 * (rollDamageAt), so it hits whoever the follower is standing against, takes the fight's +N from where
 * the follower stands, and any shot it fires is on record as the follower's.
 *
 * A FOLLOWER OFF THE MAP fights beside their character, so the blow is aimed by the character's fight.
 * It is still not the character's blow: no +N (the fight counts the bodies on the map, and the follower
 * is not one of them), none of the character's own damage moves, and no shot recorded in the
 * character's name. A GROUP's blow says so on the card, or Apply would read the character's lone body
 * and drop one member of a horde where the group's blow belongs on its pool (fight/group-hits.js).
 * Nobody to hit is the plain card, as the sheet always posted.
 *
 * @param {Actor} character
 * @param {object} options
 * @param {Actor|null} [options.fighter]  the follower's own actor, when they have a token in the fight
 *   (fight/follower-fight.js#followerInFight)
 * @param {string} options.formula    the die, carrying any +N of its own
 * @param {string} options.label      the card's title: "Rhianna's crew attacks with their spears"
 * @param {string} [options.attacker] who the windows name: "Rhianna's crew"
 * @param {string} [options.keywords] the blow's tags, printed beside each total
 * @param {string} [options.rollMode] the follower's own advantage on this die
 * @param {object} [options.weapon]   utils/damage.js#attackWeapon, for the armor Apply takes off
 * @param {boolean} [options.seeded]  offer the fight's +N (off for a row whose formula has its own)
 * @param {boolean} [options.group]   a group with more than one standing (utils/crew.js#groupFollowerStanding)
 * @param {boolean} [options.shiftKey] skip the damage window
 * @returns {Promise<boolean>} whether damage was rolled
 */
export async function rollFollowerDamageAt(character, { fighter = null, formula, label, attacker = "", keywords = "", rollMode = "", weapon = null, seeded = true, group = false, shiftKey = false } = {}) {
	if (fighter) return rollDamageAt(fighter, { formula, label, keywords, rollMode, weapon, seeded, shiftKey });
	return rollDamageAt(character, { formula, label, keywords, rollMode, weapon, shiftKey, striker: { name: attacker, group } });
}

/**
 * Moves that sharpen ANOTHER move's damage roll, keyed by the attack they ride: the Fox's Cheap
 * Shot ("When you Ambush with a hand weapon, you have advantage on your damage roll"). Returns
 * "adv", or null when the owner, the move or the weapon isn't there.
 *
 * This OPENS the damage window on advantage; it does not impose it. The window is a picker the
 * player can move off, which is what "with a hand weapon" needs — whether a knife in the dark is
 * the weapon they actually ambushed with is theirs to say, and the range test below is only a
 * default good enough to be right nearly always. When the window is suppressed (a Shift-click, or
 * the client setting turned off), the mode still carries, so the move works for a table that never
 * sees it.
 */
const DAMAGE_ADVANTAGE = {
	ambush: { move: "Cheap Shot", weapon: w => !!w?.range?.includes("hand") },
};

// Exported for the tests; the flow reaches it only through askDamageAdjustment.
export function damageAdvantageFrom(actor, moveKey, weapon) {
	const rider = DAMAGE_ADVANTAGE[moveKey];
	if (!rider || !rider.weapon(weapon)) return null;
	// LEARNED, and the book's: an un-learned Cheap Shot sharpens nothing, and a player's own move of
	// that name is theirs, while one a GM dropped from another playbook is still Cheap Shot.
	return ownsLearnedBookMoveNamed(actor, rider.move) ? "adv" : null;
}

// Hover text for the "problematic wound" link in the messy reminder (Book I, Harm &
// Healing p.243): a wound isn't just lost HP — it's a lasting fictional consequence the
// victim now has to deal with, and messy attacks make these especially common.
const PROBLEMATIC_WOUND_TIP = "A wound with lasting fictional consequences, a severed hand, a blow to the head that leaves them staggering, not just lost HP. It's now true in the fiction and something the victim has to deal with. Especially common with messy attacks.";

// What each flavour tag actually costs the fiction, said at the moment the blow lands. A weapon's
// `+N damage` / piercing ride the numbers and the card's fine print already prints them; these
// only ever lived in the prose, which is why they are the ones a table forgets.
//
// ONE ENTRY PER NAME IN utils/damage.js#FICTION_DAMAGE_TAGS, which is what decides both WHICH
// tags get a note and the order they print in. That list is also what the option-damage reader
// matches on, so a move's printed bullet and a stat block's damage line grow the same notes.
//
// `label` is the tag AS THE BOOK PRINTS IT rather than a rephrasing, because connecting the note
// back to the word on the stat line is most of its job. That is also why `reload` keeps its
// un-adjectival name instead of becoming "Reloading".
const TAG_NOTES = {
	messy: {
		label: "Messy.", icon: "fa-burst",
		body: `This attack is especially destructive, ripping people and things apart. It should often
			use up resources, destroying a shield, weapon, or gear, or inflict a
			<span class="stonetop-problematic-wound" data-tooltip="${escHtml(PROBLEMATIC_WOUND_TIP)}">problematic wound</span>.`,
	},
	forceful: {
		label: "Forceful.", icon: "fa-hand-fist",
		body: `It can knock someone around, maybe even off their feet. Even if it does no damage, it
			should still shift the momentum or positioning of the fight: driving them back, breaking
			their stance, or setting up an ally.`,
	},
	grabby: {
		label: "Grabby.", icon: "fa-link",
		body: `It latches on. The target can be pinned, grappled, or dragged along, and tearing free
			is a problem of its own, often costing them whatever they meant to do next.`,
	},
	crude: {
		label: "Crude.", icon: "fa-hammer",
		body: `It is prone to break. A solid hit is nearly as likely to chip, bend, or ruin the weapon
			as it is to hurt what it struck.`,
	},
	reload: {
		label: "Reload.", icon: "fa-hourglass-half",
		body: `It takes time and effort to reset. There is no second shot this exchange unless
			something is spent to buy one.`,
	},
	dangerous: {
		label: "Dangerous.", icon: "fa-triangle-exclamation",
		body: `It causes trouble and collateral damage if you are not careful, and maybe if you are.
			Ask what else was standing in the way.`,
	},
};

/**
 * The fiction notes a blow's tags owe the table, as a block that rides the DAMAGE CARD ITSELF.
 *
 * These used to be a chat card apiece, posted under the damage. That worked while there were two
 * tags and they rarely met, but the Bear of Winter swings "(close, hand, reach, forceful, grabby,
 * messy, 1 piercing)" and the Stone Sentinel and five others do the same: one card per tag buries
 * the damage number under three follow-ups every time it attacks. It also put the reminder
 * somewhere other than the thing it modifies, which is the wrong place for it to be found at all
 * and a real cost to anyone reading the log at magnification.
 *
 * So it is a notice, in the shape utils/roll-engine.js#_woundReminderHtml already established for
 * a lasting injury: a bordered block inside the card, one line per consequence, adding no messages
 * to chat however many tags a weapon carries.
 *
 * Returns "" when nothing is tagged, which is the no-op every caller wants: a card with nothing to
 * add prints no empty block.
 *
 * @param {{name?: string, tags?: string[]}|null} weapon
 * @returns {string} HTML, or "" when the blow carries no fiction tag.
 */
export function tagNoticesHtml(weapon) {
	// Joined and scanned through the SAME reader the option-damage parser uses, so "(tags by
	// weapon, +forceful)" and "(hand, close, maybe forceful or messy)" are read here exactly as
	// they are read there, and the notes come back in FICTION_DAMAGE_TAGS order regardless of how
	// the book printed them (utils/damage.js#fictionTagsIn says why both of those matter).
	const tags = fictionTagsIn((weapon?.tags ?? []).join(", "));

	// The heading names the block, not the weapon: the card's fine print already says which weapon rolled
	// this, and every line below names its own tag, so repeating the weapon here would be the third
	// time one card said it.
	// A feather on the heading rather than the burst this system marks damage with: the burst is
	// already on the total above AND on the messy line right below, and a heading wearing its own
	// first item's glyph reads as a repeat. The feather is what the system puts on prose
	// elsewhere, which is exactly what this block is.
	return cardNoticeHtml({
		className: "stonetop-attack-tag-notice",
		icon: "fa-feather",
		title: "Beyond the damage",
		items: tags.map(tag => {
			// A tag with no note here is one added to FICTION_DAMAGE_TAGS and not to TAG_NOTES.
			// The suite catches that ("has a note written for every tag the readers recognise"),
			// but it must not be a THROW if one ever gets past: this runs inside the damage post,
			// downstream of lockAttackCard, so a TypeError would be a Confirm that spent the
			// player's click, disabled their card and never paid the damage. A missing reminder
			// is a missing reminder; a missing damage roll is the fight stopping.
			const note = TAG_NOTES[tag];
			if (!note) return "";
			return `<li class="stonetop-attack-tag-note stonetop-attack-${tag}">
				<i class="fas ${note.icon}"></i> <span><strong>${note.label}</strong> ${note.body}</span>
			</li>`;
		}).filter(Boolean),
	});
}

// Roll damage once per applyable target and post the results card. With no applyable
// targets, fall back to a single plain damage roll (no Apply button). A tagged weapon prints its
// fiction notes ON whichever of those two cards it got (tagNoticesHtml) rather than under it, so
// a blow that is messy, grabby AND forceful still costs chat exactly one message.
//
// THE FOE'S COUNTER-ATTACK IS NOT THIS FUNCTION'S BUSINESS any more. It used to take a `counter`
// flag and hang a "Suffer your enemy's attack" button off the card it posted — which meant a
// no-target Clash needed a whole extra branch here just to have somewhere to put that button.
// The tier fires the counter itself now, straight after this returns (resolveAttackTier), and it
// comes back through this same function as a damage card of its own (postIncomingDamage).
async function rollAndPostDamage(actor, { move, weapon, targets, damage, ignoresArmor = false, selfHarm = false, foeUuid = "", shots = true, groupBlow = false, own = true, spillsBlood = own, fx = null }) {
	// What the blow is swung WITH, for the animation (combat/attack-fx.js), taken before the lines
	// below lay armor and fiction tags over it: those change what Apply does, not what a spear is.
	const struckWith = weapon;

	// A tier control that ignores armor (Call the Shot's "your call", The Hammer and the Book)
	// records it ON THE WEAPON the card carries rather than as a second field beside it: the
	// weapon is the one thing Apply damage reads for armor (wireApplyDamage) and the one thing the
	// fine print under each target reads to say so, and a flag that only half of that consulted
	// would be a pick that works or doesn't depending on which line you look at.
	// `unarmedWeapon`, not a bare record: this runs BEFORE Musclebound reads the reach below, and a
	// bare-handed blow that ignores armor is still a bare-handed blow.
	weapon = ignoresArmor ? { ...(weapon ?? unarmedWeapon()), ignoresArmor: true } : weapon;

	// The character's OWN blow carries their own moves' fiction: Musclebound makes a hand-to-hand or
	// thrown attack forceful and messy, and a ticked line can add a tag of its own (Anger is a Gift's
	// "strike hard (+1d4 damage, forceful)"). Not a follower's blow, and not a stat block's.
	if (own && !selfHarm) {
		weapon = withAddedTags(muscleboundWeapon(actor, weapon), damage?.addTags);
	}

	// The window's answer, folded in once for every branch below. The single-target branch hands
	// the pieces to rollDamage instead, which composes them itself and paints the pills that say
	// what was added; the branches that build their own Rolls compose here and pass the same
	// pills to the results card, so all three report the adjustment identically.
	const { base, rollMode, bonus, extraDice, seed = null } = damage;
	// The weapon's OWN piercing, kept for Apply: the other attackers' merged in below counts only while
	// their +N does (seedPiercing), and the card's +N can be left off after the roll.
	const ownPiercing = weapon?.piercing ?? 0;
	weapon = withSeedTags(weapon, seed);
	const formula   = damageRollFormula(composeDamageFormula(base, { bonus, extraDice, seed }), rollMode);
	const applyable = (targets ?? []).filter(t => t.hasActor !== false && t.uuid);

	// Built once, for whichever branch below ends up posting: the fiction a tag owes is the same
	// fiction whether or not anyone was targeted, and a forceful blow that dealt nothing still owes
	// it. Both cards have the same slot for it (roll-engine.js#_rollCard's `noticesHtml`, and the
	// results card's own body), which is what lets the two paths say it identically.
	const notices = tagNoticesHtml(weapon);

	let results = [];
	if (applyable.length === 0) {
		const roll = await rollDamage(base, actor, { label: damageLabel(move, weapon), rollMode, bonus, extraDice, seed, notices });
		// The number the card shows, which never goes below 0 (a group's -N can take a d4 under it).
		results = [{ raw: Math.max(0, roll.total), formula: roll.formula, faces: multiDieFaces(roll) }];
	} else {
		// One damage roll per target — independent, so evaluate them concurrently; they're
		// aggregated into a single results card, and mapping by index preserves order.
		const rolls   = await Promise.all(applyable.map(() => new Roll(formula).evaluate()));
		results = applyable.map((t, i) => ({
			uuid: t.uuid, name: t.name, actorId: t.actorId, disposition: t.disposition,
			raw: rolls[i].total, formula: rolls[i].formula, faces: multiDieFaces(rolls[i]),
		}));
		await postDamageResultsCard(actor, { move, weapon, ownPiercing, results, damage, selfHarm, notices, foeUuid, groupBlow });
		// The blow on the map, as its card lands. `fx` is the caller saying this was a weapon's blow at
		// all: a move's own number (rollOptionDamage, rollMoveDamageAt) passes none and draws nothing.
		// Never awaited, and it cannot throw: everything before it is already spent.
		if (fx) {
			playBlowFx({
				attacker: "attacker" in fx ? fx.attacker : actor,
				weapon: struckWith, blow: fx.blow ?? "", moveKey: fx.moveKey ?? "", targets: applyable,
				// As maybeMissFx: a whispered roll drawn on everyone's map would tell the table what it kept.
				whispered: !chatModeIsPublic(),
			});
		}
		// A blow at somebody the roller is not standing against is a shot, and the fight keeps it; a
		// character's own hit is not a shot at anyone, and neither is a blow the card's speaker did not
		// strike (a follower off the map, rollFollowerDamageAt).
		if (!selfHarm && shots) {
			// Targets are let go only once a shot at them is on record: a blow in contact records none, and a
			// hand target is then still what aims the next roll (or the archer's only line to their mark).
			await recordShots(actor, applyable);
			const mine = ownTargetsIn(applyable);
			releaseSpentTargets({ used: mine.length > 0 && shotOnRecordAt(actor, mine) });
		}
	}

	// The Heavy spilling blood (combat/battle-joy-offer.js): their own blow, or their move's harm to
	// somebody else. Not the enemy's attack landing on them, and not a follower striking beside them.
	if (!selfHarm && spillsBlood) askBattleJoy(actor, move, results.map(r => r.raw));

	// The totals, for a caller that has to say on its own surface what the roll came to: the
	// button on a ticked option turns into the number it dealt (stonetop.js#_chatWireOptionDamage).
	// Every branch above fills this, the single-target one included, so a caller never has to know
	// which of the three it took.
	return results;
}

/**
 * The Battle Joy question (combat/battle-joy-offer.js), NOT WAITED ON. It is a window the Heavy's player
 * answers in their own time, and everything after a damage roll (a ticked option's button latching, a
 * Clash's counter-attack) would otherwise sit behind it.
 */
function askBattleJoy(actor, move, totals) {
	offerBattleJoyOnDamage(actor, move, totals).catch(err => console.error("Stonetop | offering Battle Joy failed", err));
}

/**
 * The blow with the other attackers' tags and piercing added, when the fight's pile-on was taken: "Apply
 * tags from all the attackers as they make sense" (Book I p.414). The six coedwig's 1 piercing rides on
 * the birdwraig's d8+3 (p.239). Only while the +N is on at the roll: a roller striking alone takes none
 * of it. Nothing when the seed brings none.
 *
 * @param {object|null} weapon
 * @param {object|null} seed  fight/damage-seed.js
 */
export function withSeedTags(weapon, seed) {
	if (!seed || seed.applied === false) return weapon;
	const tags = Array.isArray(seed.tags) ? seed.tags.filter(Boolean) : [];
	const piercing = Math.max(0, Math.trunc(Number(seed.piercing) || 0));
	if (!tags.length && !piercing) return weapon;
	const base = weapon ?? { name: "", range: [] };
	const own = Array.isArray(base.tags) ? base.tags : [];
	const merged = { ...base, tags: [...new Set([...own, ...tags])] };
	if (piercing > resolvePiercing(base.piercing)) merged.piercing = piercing;
	return merged;
}

/** Which of a roll's targets are this reader's own hand targets. */
function ownTargetsIn(targets) {
	const mine = new Set(Array.from(game.user?.targets ?? []).map(t => t.document?.uuid).filter(Boolean));
	return targets.filter(t => mine.has(t.uuid));
}

/**
 * Roll the damage a move's PRINTED OPTION owes, and post it on the shared damage card.
 *
 * Danu's Grasp's "They take 2d4 damage (ignores armor)" is a whole damage roll with no weapon and
 * no attack behind it: the move says the number itself. The five attack moves reach this card
 * through {@link rollAndPostDamage} after a weapon pick and a damage window; an option reaches it
 * with the number already stated, so nothing is asked and the button is one click.
 *
 * IT IS THE SAME CARD, deliberately. Per-target totals, the red burst, the formula chip, the
 * armor fine print and the one Apply button that subtracts HP and cannot subtract it twice are
 * all things a damage number needs whatever produced it, and a second card built alongside them
 * would be a second place for the armor math to go quietly wrong.
 *
 * THE DAMAGE WINDOW IS NOT ASKED. `promptDamage` exists for the bonuses the fiction switches on
 * and the sheet cannot know about (the Storm Markings' "+1 while you roil with anger", a spent
 * Fury's "+1d6"), and every one of those rides YOUR damage die. A move's printed 2d4 is the
 * move's own number, not yours, so there is nothing for those bonuses to attach to. See
 * dialogs/RollDialog.js#promptDamage, whose four surfaces this is deliberately not a fifth of.
 *
 * @param {Actor} actor  whoever is speaking the card the option was ticked on
 * @param {object} options
 * @param {string} options.move    the move's name, for the card's title
 * @param {ReturnType<typeof readOptionDamage>} options.damage  what the option's own words said
 */
export async function rollOptionDamage(actor, { move, damage }) {
	const { formula, self = false, ignoresArmor = false, piercing = 0, tags = [] } = damage ?? {};
	if (!actor || !formula) return null;

	// A NAMELESS WEAPON, carrying only what the option's words said about armor and fiction. The
	// card reads its armor fine print and Apply reads its piercing off exactly this record
	// (wireApplyDamage), and the card's fiction notes ride its tags, so an option that says
	// "1d10 damage, messy, ignores armor" behaves like a weapon that says the same three things.
	// The empty name is what keeps the card's title from reading "Danu's Grasp: " with nothing
	// after the colon (see damageLabel).
	const weapon = { name: "", range: [], piercing, ignoresArmor, tags };

	return rollAndPostDamage(actor, {
		move, weapon, selfHarm: self, ignoresArmor,
		// Still blood the character spilled, whosever number it is (combat/battle-joy-offer.js).
		spillsBlood: true,
		// NOT THE CHARACTER'S OWN BLOW, said out loud rather than left to the empty reach above to
		// imply. A move's printed 2d4 is the move's number, not a swing of theirs, so Musclebound has
		// nothing to make forceful and messy here — and saying so is what keeps that true the day the
		// record grows a reach.
		own: false,
		// WHOSE HP. An option that says "they take" is aimed at whatever the player has targeted,
		// the same snapshot every attack takes; one that says "take 2d4 damage" in a sentence
		// about your own heat being sucked away is aimed at the character who picked it. Nothing
		// is subtracted on the strength of that reading: the card names who it is pointing at and
		// waits for the deliberate second click on the button.
		targets: self ? [selfTarget(actor)] : snapshotTargets(),
		// The number is the move's, whole. No adv/dis, no bonus, no extra dice, so the card's
		// conditions row stays empty and its formula chip says exactly what the bullet says.
		damage: { base: formula, rollMode: "normal", bonus: 0, extraDice: "" },
	});
}

/**
 * A move's OWN damage at somebody the move itself names — the Judge's Castigate, whose 1d4 lands on
 * whoever they just Censured, wherever that person is standing.
 *
 * The option-damage card, and for the option-damage reasons: the number is the move's rather than the
 * character's, so no damage window is asked, no playbook line is offered and nothing sharpens it. What
 * it does not share is the aim — an option says "they take", meaning whoever is targeted, while this
 * move says WHO, and the person it says is rarely the one under the crosshair.
 *
 * @param {Actor} actor       the one whose move this is
 * @param {Actor|TokenDocument} target  who the move names
 * @param {object} p
 * @param {string} p.move     the card's title
 * @param {string} p.formula
 * @param {boolean} [p.ignoresArmor]
 * @param {string[]} [p.tags]
 */
export async function rollMoveDamageAt(actor, target, { move, formula, ignoresArmor = false, tags = [] }) {
	const hit = target?.documentName === "Token" ? target : (target?.actor ?? target);
	if (!actor || !formula || !hit?.uuid) return null;
	return rollAndPostDamage(actor, {
		move, ignoresArmor, own: false, spillsBlood: true,
		weapon: { name: "", range: [], piercing: 0, ignoresArmor, tags },
		targets: [{ uuid: hit.uuid, name: hit.name ?? "", actorId: hit.id ?? null, disposition: hit.disposition ?? 0, hasActor: true }],
		damage: { base: formula, rollMode: "normal", bonus: 0, extraDice: "" },
		shots: false,
	});
}

/**
 * The acting character as a target of their own option.
 *
 * The ACTOR uuid, not a token's: a self-harming option is picked on a card, which may well be
 * open with no token of that character on the current scene (or with several, on a scene the
 * player is not looking at). `wireApplyDamage` resolves either shape.
 *
 * Disposition 0 rather than friendly, because the "(friendly)" marker on a damage row is a
 * warning that you are about to hurt an ally by mistake, and this is the one damage row where
 * hurting the person named on it is the entire point.
 */
function selfTarget(actor) {
	return { uuid: actor.uuid, name: actor.name, actorId: actor.id, disposition: 0, hasActor: true };
}

// The fine print a bare number can't carry: which weapon rolled it, and whether armor
// will bite when the GM applies it. Sits under the target name in each damage block. The
// armor bits come from module/data/weapons.js, so the picker and the card can't drift.
//
// The weapon's OWN piercing: the other attackers' counts only while their +N is on, which can change
// after the roll (seedPiercing), so it is said with that condition attached rather than as the blow's.
function damageRowDetail(weapon, { ownPiercing = weapon?.piercing, seed = null } = {}) {
	if (!weapon) return "";
	// Filtered, because a weaponless attack that still ignores armor (Call the Shot bare-handed)
	// arrives with an empty name, and an unfiltered join would print a leading " · ".
	// The armor bits are tags, so they print the way the damage roll card prints its tags: bold,
	// with their meaning on hover. A stat block's blow brings its whole printed tag list instead
	// (rollDamageAt), which already says its piercing and whether it ignores armor.
	const own = { ...weapon, piercing: ownPiercing };
	const tags = own.keywords ? [damageKeywordsHtml(own.keywords)] : weaponArmorBits(own).map(damageKeywordsHtml);
	const bonus = seedBonus(seed);
	const theirs = bonus > 0 && !own.ignoresArmor ? Math.max(0, Math.trunc(Number(seed.piercing) || 0)) : 0;
	if (theirs > resolvePiercing(ownPiercing)) {
		tags.push(`${damageKeywordsHtml(`${theirs} piercing`)} ${escHtml(format("stonetop.fight.seed.piercingWhile", { bonus }))}`);
	}
	return [escHtml(weapon.name), ...tags].filter(Boolean).join(" · ");
}

/** The seed toggle's face: leave the +N (or a group's -N) off while it is on, add it back once it is off. */
function seedToggleLabel(seed) {
	const on = seed.applied !== false;
	const bonus = seedBonus(seed);
	const text = format(`stonetop.fight.seed.${on ? "leaveOff" : "addBack"}`, { bonus: bonus < 0 ? String(bonus) : `+${bonus}` });
	return `<i class="fas ${on ? "fa-minus" : "fa-plus"}"></i> ${escHtml(text)}`;
}

/**
 * How far a damage card's rolled totals are from what they should be now, given the seed: the +N
 * taken back out when it was rolled in and has since been left off, or added when it is the other way.
 */
export function seedAdjustment(seed) {
	if (!seed) return 0;
	const bonus = seedBonus(seed);
	return (seed.applied === false ? 0 : bonus) - (seed.rolled === false ? 0 : bonus);
}

/**
 * The other attackers' piercing a damage card carries, while their +N is on (withSeedTags rolled it in
 * only then): leaving the +N off afterwards takes their piercing off with it, and adding it back brings it.
 */
export function seedPiercing(seed) {
	if (damageSeedBonus(seed) <= 0) return 0;
	return Math.max(0, Math.trunc(Number(seed.piercing) || 0));
}

/**
 * A smaller group's -N as the bigger group's +N ARMOR (Book I p.416 "+1 bonus to damage and armor"), while
 * it is on: Apply adds this to the target's armor and back onto the roll, so piercing and "ignores armor"
 * reach it the way they reach any armor. 0 for any other seed.
 */
export function seedArmor(seed) {
	return Math.max(0, -damageSeedBonus(seed));
}

/**
 * The armor a damage row is taken against: the stored number, the one the Fight tab and the token show.
 * A character's is derived from what they carry, and actors/character/vitals-mirror.js keeps it current
 * whatever changed it and whether or not their sheet is open.
 *
 * `barkskin` hands over the world's Barkskin marks (see barkskinOnce), which every card shares.
 */
function wornArmor(actor, barkskin = barkskinOnce()) {
	const stored = actor?.system?.attributes?.armor ?? {};
	const worn = {
		armor: Number(stored.value) || 0,
		unpierceable: Number(stored.unpierceable) || 0,
		// The part a move grants on a clause only the fiction can answer (see conditionalArmorOf). On a
		// follower's NPC, a printed clause instead: Afon's "0 vs. iron" (data/follower-actor.js).
		conditional: Math.max(0, Number(stored.conditional) || 0),
		conditionalSource: String(stored.conditionalSource ?? ""),
	};
	// A character's stored armor already carries a Blessed's Barkskin (vitals-mirror.js). Anyone else
	// wearing it, a follower above all, has it read here, from the marks as they stand when the blow
	// lands: their NPC keeps only its card's numbers. A person may be marked by the name on their card,
	// so an NPC matches a name-only mark too (actors/character/move-armor.js#wearsBarkskin).
	if (!actor || actor.type === "character") return worn;
	return withBarkskinBase(worn, wearsBarkskin(barkskin(), actor, { byName: actor.type === "npc" }));
}

/**
 * The world's Barkskin marks (actors/character/move-armor.js#barkskinMarks), scanned on first ask and
 * kept for the WORLD, not the card: every damage card in the log re-renders on scroll, on update and
 * on another client's Apply, and each used to walk game.actors afresh. Kept until something that
 * could change a mark does (forgetBarkskinMarks, on any actor or move being made, changed or
 * deleted; stonetop.js), or the actor collection itself is a different one. Only characters lay
 * marks, so no row needs itself left out of them.
 */
let worldBarkskin = null;

/** Drop the kept Barkskin marks, so the next card to ask scans again (see barkskinOnce). */
export function forgetBarkskinMarks() {
	worldBarkskin = null;
}

function barkskinOnce() {
	return () => {
		const actors = globalThis.game?.actors ?? [];
		if (worldBarkskin?.actors !== actors) worldBarkskin = { actors, marks: barkskinMarks(actors) };
		return worldBarkskin.marks;
	};
}

/**
 * The armor on a damage row that rests on FICTION the sheet cannot check: Barkskin's "while touching
 * the earth", A Candle Against the Dark's "but go otherwise unarmed"
 * (actors/character/move-armor.js). Null when the row's target has none.
 *
 * It is applied by default — the clause is the ordinary case for whoever took the move — and the card
 * offers it back with one tick, which is the moment it matters and the moment the table knows.
 */
function conditionalArmorOf(actor, barkskin) {
	const worn = wornArmor(actor, barkskin);
	return worn.conditional > 0 ? { armor: worn.conditional, source: worn.conditionalSource } : null;
}

/** The rows whose conditional armor has been ticked off on this card. */
const armorLeftOff = damage => new Set(Array.isArray(damage?.armorOff) ? damage.armorOff : []);

function postDamageResultsCard(actor, { move, weapon, ownPiercing, results, damage, selfHarm = false, notices = "", foeUuid = "", groupBlow = false }) {
	// Several targets is the book's own rule now that the roller is asked who a blow hits
	// (fight/fight-targets.js), so the note says when it applies rather than calling it an abstraction.
	const multiWarn = results.length > 1 && !weapon?.area
		? `<p class="stonetop-attack-warn"><i class="fas fa-triangle-exclamation"></i> ${escHtml(format("stonetop.fight.targets.several", { move }))}</p>`
		: "";

	// Each target gets the shared roll-result block (big total + label + fine print) rather
	// than a one-line "name .......... 7" row, so the damage number reads at the same size
	// as a move roll's total — it's the one thing the table actually needs to see. The red
	// burst and red total say "damage" without re-reading the title. Each total carries its
	// own die-faces tooltip: the targets are rolled independently, so the shared formula
	// chip above can only speak for one of them.
	const detail = damageRowDetail(weapon, { ownPiercing, seed: damage?.seed });
	const rows = results.map(r => {
		const friendly = Boolean(r.uuid) && isFriendly(r.disposition);
		const label = r.uuid
			? `${escHtml(r.name)}${friendly ? " <em>(friendly)</em>" : ""}`
			: "Damage dealt";
		return `<li class="stonetop-damage-row stonetop-roll-result stonetop-roll-result--damage"${r.uuid ? ` data-uuid="${escHtml(r.uuid)}"` : ""}>
			${damageMark(r.raw, r.faces)}
			<div class="stonetop-roll-result-body">
				<span class="stonetop-roll-result-label stonetop-damage-target${friendly ? " is-friendly" : ""}">${label}</span>
				<span class="stonetop-roll-result-details">${detail}</span>
			</div>
		</li>`;
	}).join("");

	// Each target is rolled independently, so a single shared die-faces tooltip is only
	// meaningful when there's exactly one result; with several it would show the first
	// target's faces against every other target's total. Show the formula alone then.
	const chipFaces = results.length === 1 ? (results[0]?.faces ?? "") : "";
	const hasApplyable = results.some(r => r.uuid);

	// What the damage window added, said out loud. The formula chip above shows the arithmetic
	// but not its provenance: a "d10+2+1" cannot tell the table which of those numbers is the
	// weapon's and which is the one-off the player just declared. Same pills, same wording as a
	// single damage roll's card (roll-engine#damageConditionPills).
	const adjustHtml = conditionsRowHtml(damageConditionPills(damage ?? {}));

	// THE BUTTON NAMES ITS OUTCOME, and here that is two different outcomes. "Apply damage" is a
	// GM subtracting HP from the foes a player just struck; the same button on an option that
	// burns the person who picked it ("take 2d4 damage (ignores armor)") is that player taking
	// their own hit, and offering them a card that says "Apply damage" reads as work waiting on
	// somebody else. Same button, same wiring, same idempotency latch (see wireApplyDamage, which
	// lets the owner of every pending target press it).
	// THE FIGHT'S +N CAN BE LEFT OFF AFTER THE ROLL, beside Apply and pressed by the same person
	// (wireDamageSeed). The book's own example waives it when a foe went down before it could strike
	// (Book I p.415), and that is only known once the dice are down. `rolled` records whether the
	// totals below already include it (the roller may have unticked it in the damage window), so a
	// later toggle adjusts by the difference and never twice.
	// A group's seed too, from a stat block's damage row (rollDamageAt): negative when the other side
	// outnumbers it, which is their armor, and just as much the table's to leave off.
	const seed = seedBonus(damage?.seed) !== 0
		? { ...damage.seed, applied: damage.seed.applied !== false, rolled: damage.seed.applied !== false }
		: null;
	const seedToggle = hasApplyable && seed
		? `<button type="button" class="stonetop-attack-btn stonetop-damage-seed-toggle">${seedToggleLabel(seed)}</button>`
		: "";
	const body = `<div class="card-content">
		${rollFormulaChip(results[0]?.formula ?? "", chipFaces)}
		${multiWarn}
		<ul class="stonetop-damage-list">${rows}</ul>
		${notices}
		<div class="card-buttons stonetop-card-buttons stonetop-attack-actions">
			${hasApplyable ? `<button type="button" class="stonetop-attack-btn stonetop-apply-damage"><i class="fas fa-heart-crack"></i> ${selfHarm ? "Take this damage" : "Apply damage"}</button>` : ""}
			${seedToggle}
		</div>
	</div>${adjustHtml}`;

	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content: stonetopChatCard(`${move}: damage`, body, "stonetop-attack-damage-card", damageBadge()),
		flags: { [SCOPE]: { damage: {
			move, attackerUuid: actor.uuid,
			weapon: weapon ? { name: weapon.name, piercing: ownPiercing, ignoresArmor: weapon.ignoresArmor } : null,
			// `applied` is an ARRAY, not a uuid-keyed object: a token uuid ("Scene.x.Token.y")
			// used as a flag key would be dot-expanded into nested objects by setFlag, breaking
			// the idempotency lookup so a second click re-subtracts HP.
			results, applied: [], selfHarm,
			// On a blow a character takes, `attackerUuid` is the character: the foe who struck (a token's
			// uuid) is kept beside it, for a Parry & Riposte to strike back at (defend-spend.js#spendOnBlow).
			...(selfHarm && foeUuid ? { foeUuid } : {}),
			// A group follower off the map striking (rollFollowerDamageAt): the card's speaker is their
			// character, a lone body, so Apply is told the blow is a group's (fight/group-hits.js).
			...(groupBlow ? { groupBlow: true } : {}),
			// The fight's +N, with whether it was rolled INTO the results above: leaving it off (or
			// adding it back) adjusts each one at apply time (wireApplyDamage) and redraws the totals
			// on every client (wireDamageSeed). Only on a card that has one.
			...(seed ? { seed } : {}),
		} } },
	});
}

// -- Chat-card wiring (dispatched from stonetop.js renderChatMessageHTML) ------

// Resolve the actor behind an "Actor.<id>" (or token) uuid without awaiting when we can.
async function actorFromUuid(uuid) {
	if (!uuid) return null;
	const doc = await fromUuid(uuid);
	return doc?.actor ?? doc ?? null;
}

/**
 * Keep the Confirm honest about what it will do, while the move's own boxes are still being
 * ticked.
 *
 * Only one bullet in the book needs this — Call the Shot's "do no harm; don't deal your damage
 * after all". While it was outside the card's controls it needed nothing, because taking it WAS
 * the player not pressing the button. Inside the counted list it is a pick like any other, and a
 * tier that has been told to deal no damage must not go on offering to roll it: the button says
 * "Deal no damage" instead, and the click enacts exactly that.
 *
 * Bound to the LIST, not to each box, and once per list — a change event bubbles, so the label is
 * right however the ticks got there (a click, an over-limit release letting an earlier pick go, a
 * restore from the message flag). A message re-renders on every flag write, and where Foundry
 * patches the log in place rather than replacing the node a second binding would leave two
 * listeners repainting one label.
 */
function wireAttackNoHarm(root, moveKey) {
	const btns = Array.from(root.querySelectorAll(".stonetop-attack-confirm"));
	if (!btns.length) return;

	const paint = () => {
		const held = pickedEffects(moveKey, pickedOptionLabels(root)).addons.includes(NO_HARM);
		const { label, icon } = held ? NO_DAMAGE : ROLL_DAMAGE;
		for (const btn of btns) btn.innerHTML = `<i class="fas ${icon}"></i> ${escHtml(label)}`;
	};
	paint();

	for (const list of root.querySelectorAll(".stonetop-picklist")) {
		if (list.dataset.noHarmWired === "1") continue;
		list.dataset.noHarmWired = "1";
		list.addEventListener("change", paint);
	}
}

// The single Confirm button per tier on the roll card. The attacking PC's owner clicks it to
// enact the tier: it rolls the PC die per target, folding in whatever the move's ticked bullets
// add and an optional ammo depletion, and then fires the foe's counter-attack if the tier states
// one. Once-only per card via the attack.resolved flag; non-owners see it disabled.
// Every tier's button is wired (hidden ones included) so a GM Shift Up/Down reveals a control
// that's already live.
export function wireAttackConfirm(message, html) {
	const root = html?.[0] ?? html;
	const btns = root.querySelectorAll(".stonetop-attack-confirm");
	if (!btns.length) return;

	const attack = message.getFlag(SCOPE, "attack");
	if (!attack) return;

	// A resolved card is a read-only record of what was enacted, so the move's own boxes stop
	// taking ticks. NOTHING IS RESTORED HERE any more: the ticks are the printed list's, and they
	// already persist on the message (`pickChecked`, written by stonetop.js as each box changes),
	// so every client rebuilds them the same way whether the card is resolved or not. The old
	// control row had no such home and had to be re-selected by hand from the attack flag on each
	// re-render — one of the two records of a single choice that this card no longer keeps.
	if (attack.resolved) {
		for (const input of root.querySelectorAll(".stonetop-picklist-check")) input.disabled = true;
	}

	// Before the Confirm's label is painted: a weapon with no ammo track loses its deplete row
	// here, and a tick behind a hidden row is not a pick.
	wireAttackAmmo(message, root, attack);

	// A Battle Dancer 12+ takes the pick-1 list off the card and says what it does instead.
	wireBattleDancer(message, root, attack);

	// After the lock above, not before: the label has to read the ticks the card is frozen with.
	wireAttackNoHarm(root, attack.moveKey);

	// Confirming writes the `resolved` latch onto this message (lockAttackCard), so it needs
	// message ownership as well as the attacker's — the same pairing wireApplyDamage makes.
	actorFromUuid(attack.attackerUuid).then(actor => {
		for (const btn of btns) {
			if (!actor?.isOwner || message.getFlag(SCOPE, "attack")?.resolved) { btn.disabled = true; continue; }
			// Owning the attacker is not enough, and the two refusals are not the same refusal.
			// A player who owns the PC but not the GM-authored CARD gets a button that can never
			// work, so it says why — a silently greyed-out Confirm reads as a broken card. Same
			// affordance, same wording shape as wireApplyDamage.
			if (!message.isOwner) {
				btn.disabled = true;
				btn.title = "Ask the GM to confirm this attack";
				continue;
			}
			btn.addEventListener("click", ev => resolveAttackTier(message, actor, btn, root, ev?.shiftKey === true));
		}
	}).catch(err => console.error("Stonetop | could not wire the attack card's Confirm buttons", err));
}

// Enact one tier's Confirm. Disables the clicked button while it runs; only marks the whole
// card resolved (locking every tier's Confirm) once the action actually completes, so a
// cancelled damage prompt leaves the card clickable again. `shiftKey` is the Confirm click's
// own modifier, which skips the damage window for this one roll.
async function resolveAttackTier(message, actor, btn, root, shiftKey = false) {
	if (btn.disabled || message.getFlag(SCOPE, "attack")?.resolved) return;
	btn.disabled = true;
	const attack = message.getFlag(SCOPE, "attack");
	const frozen = attack.targets ?? [];

	// Whatever the move's OWN ticked bullets add, stacked on top of the tier's own
	// unconditional numbers (Clash's 7-9 suffers the enemy's attack whether or not anything is
	// ticked). One list, read where the player ticked it — see pickedOptionLabels and PICK_EFFECTS.
	//
	// A Battle Dancer 12+ has no pick to read: it deals the damage and avoids the attack, whatever a box
	// said before the list was taken off the card (see battleDancing).
	const dancing = battleDancing(message, attack);
	const fx = pickedEffects(attack.moveKey, dancing ? [] : pickedOptionLabels(root));

	const extraDice = fx.extraDice.filter(Boolean);
	const counter   = !dancing && (btn.dataset.counter === "1" || fx.counter);
	const deplete   = fx.addons.includes(DEPLETE);
	let ignoresArmor = fx.ignoresArmor;

	// "Do no harm; don't deal your damage after all" — Call the Shot's fourth bullet, and the one
	// pick that CALLS THE ROLL OFF. The button already says "Deal no damage" (wireAttackNoHarm),
	// so the click enacts that: the card latches resolved, and no damage window opens and no dice
	// are thrown (what was ticked is already on the card). Nothing else on the tier can survive it, which
	// is why it is answered before the dice and before the quiver.
	if (fx.addons.includes(NO_HARM)) {
		await lockAttackCard(message, root, { targets: frozen.length ? frozen : snapshotTargets() });
		return;
	}

	// Nobody to hit when the dice were thrown? Whoever the character is fighting NOW: a foe targeted
	// since (T, then Confirm), or one they have stepped into contact with, asked when that is more than
	// one (fight/fight-targets.js), exactly as the roll itself would have. This runs on the attacker's
	// client, so game.user.targets is theirs; the card records what was actually hit.
	const targets = frozen.length ? frozen : await rollTargets(actor, { handTargets: snapshotTargets() });
	if (targets === null) { btn.disabled = false; return; }

	// Call the Shot's first bullet is "Ignore armor or deal +1d4 damage (your call)", so ticking
	// it asks which — the move's own question, put to the only person entitled to answer it. Asked
	// before the damage window so the formula that window previews is the one being rolled.
	let yourCall = null;
	if (fx.addons.includes(YOUR_CALL)) {
		yourCall = await promptYourCall(attack.move);
		if (yourCall === "cancel") { btn.disabled = false; return; }
		if (yourCall === "armor") ignoresArmor = true;
		else extraDice.push("1d4");
	}

	// ASKED BEFORE ANYTHING IS COMMITTED. What follows latches the card resolved and can spend
	// the weapon's ammo, and neither undoes itself: a window cancelled after them would leave a
	// dead card, a depleted quiver and no damage rolled. So the question comes first, and a
	// cancel simply hands the Confirm button back.
	const damage = await askDamageAdjustment(actor,
		// `attackAt` is this card's own age: Nemesis rides the attacks AFTER the Clash that earned it,
		// never the damage of that Clash (fight/hero-moves.js#recordClash). `damageMode` is an advantage
		// already paid for in ammo before the roll (Blot Out the Sun).
		{ moveKey: attack.moveKey, weapon: attack.weapon, extraDice, shiftKey, seed: seedForTargets(actor, targets), targets, attackAt: Number(message?.timestamp) || Date.now(), rollMode: attack.damageMode ?? "" });
	if (!damage) { btn.disabled = false; return; }

	await lockAttackCard(message, root, { yourCall, targets });
	// The deplete row's own button is the usual way to pay it. A player who ticked it and went
	// straight to the dice has still picked it, so the Confirm pays it for them; one the button
	// already paid is not paid twice (depleteAmmoAndPost checks the card).
	if (deplete) await depleteAmmoAndPost(message, actor, attack, depleteRowIndex(root, attack.moveKey));
	await rollAndPostDamage(actor, {
		move: attack.move, weapon: attack.weapon, targets, damage, ignoresArmor,
		// The move is what says whether a spear was thrown or thrust (attack-fx-table.js#blowDelivery).
		fx: { moveKey: attack.moveKey },
	});

	// AFTER the damage, because that is the order the tier states it in: "your maneuver works,
	// mostly (deal your damage), but you suffer your enemy's attack". The 7-9 says it whatever
	// the player picked and the 10+ says it as strike-hard's price, so both arrive here as the
	// one flag; Clash's 6-, which deals no damage at all and so has no Confirm to reach this
	// from, fires the same counter-attack off the miss itself (maybeCounterOnMiss).
	if (counter) await sufferEnemyAttack(actor, { targets });
}

/**
 * Clash's miss, striking back on its own.
 *
 * "On a 6-, your maneuver fails and you suffer your enemy's attack" is the whole tier: no damage
 * dealt, no bullet to tick, nothing for a player to weigh. It used to be a button all the same,
 * and a button is an offer — one a table that had already moved on to the GM's move never went
 * back and pressed, leaving the blow unstruck in the log. So the miss fires it.
 *
 * FIRED FROM THE ROLL, not from the card, and that is what makes it safe to fire without a latch.
 * Every other suffering in this file hangs off a chat card that every client renders and any of
 * them might click; this runs once, inside the `onRoll` that threw the dice, on the one client
 * that threw them. There is no second copy of it anywhere to guard against.
 *
 * @param {Actor}  actor        the character who rolled
 * @param {Item}   item         the move they rolled it for
 * @param {Roll}   roll         what the dice came to
 * @param {object} [attackExtra] what maybeBeginAttack returned, for the targets it froze
 * @returns {Promise<boolean>} whether a counter-attack was fired
 */
export async function maybeCounterOnMiss(actor, item, roll, attackExtra = null) {
	if (!attackMoveFor(item)?.counterOnMiss) return false;
	if (!Number.isFinite(roll?.total)) return false;
	if (classifyResult(roll.total).key !== "failure") return false;

	// The targets frozen at the click, or — for a player who reached for T only once the dice had
	// landed — whatever they hold now. This runs on the attacker's own client, where
	// `game.user.targets` is theirs, which is the same latitude resolveAttackTier allows a hit.
	const frozen = attackFlagsOf(attackExtra)?.targets;
	await sufferEnemyAttack(actor, { targets: frozen?.length ? frozen : snapshotTargets() });
	return true;
}

/**
 * An attack's miss, drawn: on a 6- the arrow, the bolt or the thrown spear goes wide of the foe it
 * was loosed at (combat/attack-fx.js). Only something that FLIES is shown missing; a sword that
 * missed is a GM's move to describe, not an animation to guess at.
 *
 * Not Clash's: its 6- is the foe striking back (maybeCounterOnMiss), and that blow is drawn with
 * its own card. Only at the targets frozen at the roll, because a miss has no card to aim later.
 * Only when this client's chat is PUBLIC: a whispered roll drawn on everyone's map would tell the
 * table what the whisper kept from them.
 *
 * Fired from the roll, like the counter-attack above and for the same reason: once, on the client
 * that threw the dice, after Dice So Nice has settled them (roll-engine.js#rollStat waits), so the
 * arrow never gives the result away mid-tumble.
 *
 * @returns {boolean} whether a miss was drawn
 */
export function maybeMissFx(actor, item, roll, attackExtra = null) {
	const move = attackMoveFor(item);
	if (!move || move.counterOnMiss) return false;
	if (!Number.isFinite(roll?.total) || classifyResult(roll.total).key !== "failure") return false;
	const attack = attackFlagsOf(attackExtra);
	if (!attack?.targets?.length || !chatModeIsPublic()) return false;
	playMissFx({ attacker: actor, weapon: attack.weapon ?? null, moveKey: move.key, targets: attack.targets });
	return true;
}

// Call the Shot's "(your call)": which half of its one pick is being taken. Returns
// "armor" | "dice" | "cancel". Two buttons rather than a pair of boxes on the card, because the
// bullet is ONE of the tier's picks — offering it as two would let a 7-9 "pick 1" take both.
function promptYourCall(moveName) {
	return promptAttackMode(moveName, {
		question: "Ignore armor, or deal +1d4 damage? <strong>Your call.</strong>",
		choices: [
			// fa-ban, not fa-shield-slash: the slashed shield is a Font Awesome PRO glyph, and
			// Foundry ships the free set, so it would render as nothing at all.
			{ key: "armor", icon: "fa-ban", label: "Ignore their armor" },
			{ key: "dice", icon: "fa-dice-d6", label: "Deal +1d4 damage" },
		],
		fallback: "dice",
	});
}

// Lock the card: mark the attack resolved and disable every tier's Confirm plus the move's own
// option boxes. The setFlag re-render also re-applies this via wireAttackConfirm; we do it here too
// so there's no clickable window first. WHAT WAS TICKED IS NOT RECORDED HERE: the ticks live in the
// message's `pickChecked` flag like every other move's, and a second copy beside them would be the
// two records of a single choice that this card no longer keeps.
async function lockAttackCard(message, root, extra = {}) {
	await message.setFlag(SCOPE, "attack", { ...message.getFlag(SCOPE, "attack"), resolved: true, ...extra });
	root.querySelectorAll(".stonetop-attack-confirm, .stonetop-picklist-check").forEach(el => (el.disabled = true));
}

/**
 * Let Fly's "Deal your damage, but deplete your ammo (mark the next status by your weapon; don't
 * pick this if your weapon lacks such statuses)", doing what it says.
 *
 * NO STATUSES, NO ROW. The parenthesis rules the pick out for a weapon with no ammo track (a
 * thrown spear, a sling, a granted weapon), so the row is hidden on that card rather than offered
 * and then quietly spending nothing. Hidden, not removed: the tier's cap and the saved ticks are
 * keyed by each box's index, and a hidden row is already skipped by pickedOptionLabels and the tally.
 *
 * ON A WEAPON THAT HAS THEM, ticking the row grows a button that marks the next status, the way
 * a ticked Forage option grows its die (utils/picked-option-button.js, which owns the latch, the
 * show-on-tick and the once-only binding). Once pressed the row shows what it marked instead.
 */
const AMMO_FLAG = "ammoDepleted";

/**
 * Whether this card's ammo is already marked. A card paid before the latch had a flag of its own
 * carries it as `attack.ammoDepleted: true`, with no row and no status, and is paid all the same.
 */
function ammoPaid(message) {
	return Object.keys(message.getFlag(SCOPE, AMMO_FLAG) ?? {}).length > 0
		|| message.getFlag(SCOPE, "attack")?.ammoDepleted === true;
}

// The cards whose ammo is being marked on this client right now: the row's button and the Confirm can
// both reach depleteAmmoAndPost before either has written the latch.
const depleting = new Set();

function isDepleteRow(moveKey, text) {
	return pickedEffects(moveKey, [text]).addons.includes(DEPLETE);
}

// The data-index of the ticked, visible deplete row on this card, or null.
function depleteRowIndex(root, moveKey) {
	const box = Array.from(root?.querySelectorAll?.(".stonetop-picklist-check:checked") ?? [])
		.find(b => !b.closest("[hidden]") && isDepleteRow(moveKey, pickedOptionText(b)));
	return box?.dataset.index ?? null;
}

function wireAttackAmmo(message, root, attack) {
	if (!PICK_EFFECTS[attack.moveKey]) return;

	if (!attack.weapon?.ammo) {
		for (const item of root.querySelectorAll(".stonetop-picklist-item")) {
			if (!belongsToMessage(item, message)) continue;
			const box = item.querySelector(".stonetop-picklist-check");
			if (!box || !isDepleteRow(attack.moveKey, pickedOptionText(box))) continue;
			item.hidden = true;
			box.checked = false;
		}
		return;
	}

	wirePickedOptionButton(message, root, {
		flagKey:      AMMO_FLAG,
		wiredKey:     "ammoWired",
		buttonClass:  "stonetop-ammo-deplete",
		readoutClass: "stonetop-ammo-depleted",
		read:    text => (isDepleteRow(attack.moveKey, text) ? {} : null),
		icon:    () => "fas fa-arrow-down-short-wide",
		label:   () => " Deplete your ammo",
		readout: paid => ammoDepletedEl(paid),
		onPress: (btn, index) => onDepleteAmmo(message, attack, btn, index),
	});

	// An older card's latch says only that the ammo was marked, not on which row or to what.
	if (attack.ammoDepleted === true && !Object.keys(message.getFlag(SCOPE, AMMO_FLAG) ?? {}).length) {
		for (const btn of root.querySelectorAll(".stonetop-ammo-deplete")) {
			if (belongsToMessage(btn, message)) btn.replaceWith(ammoDepletedEl({}));
		}
	}

	// A marked row is a pick already paid for: its tick stays, so the Confirm counts what was spent.
	for (const readout of root.querySelectorAll(".stonetop-ammo-depleted")) {
		if (!belongsToMessage(readout, message)) continue;
		lockDepleteBox(readout.closest(".stonetop-picklist-item"));
	}
}

function lockDepleteBox(item) {
	const box = item?.querySelector(".stonetop-picklist-check");
	if (!box) return;
	box.checked = true;
	box.disabled = true;
}

/** What a paid deplete row shows from then on: the status the weapon is now on. */
function ammoDepletedEl({ label, allOut }) {
	const el = document.createElement("span");
	el.className = "stonetop-ammo-depleted";
	el.textContent = allOut ? "Ammo marked: all out" : label ? `Ammo marked: ${String(label).toLowerCase()}` : "Ammo marked";
	return el;
}

async function onDepleteAmmo(message, attack, btn, index) {
	btn.disabled = true;
	try {
		const pc = await actorFromUuid(attack.attackerUuid);
		// The same pairing the Confirm asks for: the character's ammo is theirs to mark, and the
		// once-only latch is written onto this card.
		if (!pc?.isOwner || !message.isOwner) {
			ui.notifications.warn(pc?.isOwner ? "Ask the GM to deplete this ammo." : "You need permission to mark this character's ammo.");
			btn.disabled = false;
			return;
		}
		// Its tick is locked first: once pressed, the row cannot be unticked for a different pick.
		const item = btn.closest(".stonetop-picklist-item");
		const status = await depleteAmmoAndPost(message, pc, attack, index);
		if (status) {
			btn.replaceWith(ammoDepletedEl(status));
			lockDepleteBox(item);
		} else {
			btn.disabled = false;
		}
	} catch (err) {
		console.error("Stonetop | Error depleting ammo:", err);
		btn.disabled = false;
	}
}

// Mark the chosen weapon's next ammo status (low ammo → all out) and announce it. Pressed from
// the deplete row's own button, or from the Confirm when the row was ticked and the button never
// was. Drives the SAME resource the equipment tab's ○○ boxes show, then refreshes the sheet.
// ONCE PER CARD, whichever of the two gets there first: the latch is the row's entry in the
// message's `ammoDepleted` flag, which is also what the row's readout is drawn from, and while one
// is marking, the other finds the card taken (`depleting`) rather than an unwritten latch.
// Returns the new status, or null when nothing was marked.
export async function depleteAmmoAndPost(message, pc, attack, index) {
	const slug = attack?.weapon?.ammo ? attack.weapon.slug : null;
	if (!slug || index == null) return null;
	if (depleting.has(message.id) || ammoPaid(message)) return null;
	depleting.add(message.id);
	let status;
	try {
		status = await advanceWeaponAmmo(pc, attack.weapon);
		await message.setFlag(SCOPE, AMMO_FLAG, { [index]: { label: status.label, allOut: status.allOut } });
	} finally {
		depleting.delete(message.id);
	}
	await ChatMessage.create({
		content: stonetopChatCard("Ammunition depleted",
			`<div class="card-content"><p><strong>${escHtml(pc.name)}</strong>'s ${escHtml(attack.weapon.name)} is now <strong>${escHtml(status.label.toLowerCase())}</strong>.${status.allOut ? " It's out of ammunition." : ""}</p></div>`,
			"stonetop-attack-ammo-card"),
		speaker: ChatMessage.getSpeaker({ actor: pc }),
	});
	pc.sheet?.render(false);
	return status;
}

/**
 * Whether THIS user may press Apply on every target still owing damage.
 *
 * Damage to a foe is a GM action and stays one: players do not own enemy tokens and the system
 * has no socket relay, so a player's click could not write that HP even if the button offered to.
 * What changed is that not every damage card is aimed at a foe. An option that reads "take 2d4
 * damage (ignores armor)" is aimed at the character who picked it, and its player owns that
 * actor: hiding the button from them would leave the one person who can act on the card looking
 * at no button at all, waiting on a GM who has nothing to do.
 *
 * EVERY pending target, not any. A card the player half-owns is a card where pressing the button
 * would silently skip the rows they cannot write, which reads as damage applied when it was not.
 *
 * `isOwner` is asked only down the non-GM path, and that is not an accident: a GM owns every
 * actor in the world, so the answer up there is always true and means nothing (see the project's
 * isowner-always-true-for-gm note). The GM's own right to press this comes from being the GM.
 */
function ownsEveryTarget(actors) {
	return !!actors?.length && actors.every(a => a.isOwner);
}

/**
 * The actor behind every damage row, or null if any one of them cannot be reached.
 *
 * ALL OR NOTHING, because both readers below are all-or-nothing questions: "may I press this for
 * every target" and "who owns every target". A row that resolves to nothing is a row nobody can
 * be said to own, so it disqualifies the card rather than being skipped.
 *
 * `strict: false` and a try because a uuid can outlive what it points at — a token deleted
 * mid-fight, a scene closed — and this runs inside a chat render pass, where a throw would take
 * the whole log's render down with it.
 */
function resolveDamageActors(results) {
	if (!results?.length) return null;
	const actors = [];
	for (const r of results) {
		let doc = null;
		try { doc = fromUuidSync(r.uuid, { strict: false }); } catch { return null; }
		const actor = damageRowActor(doc);
		if (!actor) return null;
		actors.push(actor);
	}
	return actors;
}

/**
 * Which ONE of the people looking at this card is the one whose click writes the HP.
 *
 * ⚠ THE `applied` LATCH DOES NOT SETTLE THIS. It is written AFTER the HP writes, which makes a
 * SECOND click harmless but not a SIMULTANEOUS one: two clients that press within one round trip
 * both read an empty latch and both subtract. That is exactly why the several-GMs case was gated
 * on `isPrimaryGM` from the start -- and a player pressing their own self-harm card is the same
 * case again, because the primary GM's copy of that card is live at the same moment.
 *
 * THE RULE: a card every one of whose pending targets is owned by a CONNECTED player belongs to
 * that player. Anything else -- a foe, or a player who has logged off -- belongs to the primary
 * GM, exactly as before. The lowest user id of the owners wins, so every client elects the same
 * one without anybody having to talk to anybody (a co-owned character has two of them).
 *
 * The one cost: a player who disconnects AFTER their card was drawn leaves the GM's button
 * deferring to somebody no longer there until that card next re-renders. A stuck button is worth
 * more than HP subtracted twice, and any write to the message redraws it.
 *
 * @returns {string|null} the elected player's user id, or null for "the primary GM's".
 */
function electedApplier(actors, message = null) {
	if (!actors?.length) return null;
	const owners = (game.users?.players ?? [])
		.filter(u => u.active && actors.every(a => a.testUserPermission?.(u, "OWNER")))
		// AND WHO CAN WRITE THE CARD. The latch that stops damage being taken twice lives on the
		// MESSAGE, so electing a player who cannot update it hands the button to somebody it will
		// refuse — while standing the GM's copy down at the same time, which leaves a card nobody
		// at the table can press. That is exactly the shape of the incoming attack a GM's "Which
		// attack?" pick posts: the GM authored it, so the GM is the one who can latch it.
		.filter(u => canUserWriteCard(message, u))
		.map(u => u.id)
		.sort();
	return owners[0] ?? null;
}

/**
 * Which one of the connected players owning every row presses a card relayed through the GM
 * (`applyGate`'s `relay`): the lowest user id, so every client picks the same one. Unlike
 * `electedApplier`, whether they can write the card does not matter: the GM's client writes it.
 *
 * @returns {string|null}
 */
function electedOwner(actors) {
	// Passing no message is what makes it so: `canUserWriteCard` answers its `whenUnknown` default
	// for a card it cannot see, so the election runs without the write filter rather than beside it.
	return electedApplier(actors);
}

/**
 * The actors a set of damage rows actually lands on. A row a defender took in the ward's place
 * (fight/defend-spend.js) writes the DEFENDER's HP, so it is the defender's owner who may press, not
 * the ward's. Both the local gate and the GM's relay must read the SAME rows: a player refused on
 * their own client and allowed through the query would take the damage twice over.
 */
function sufferingActors(damage, rows) {
	const { standIns } = spentOn(damage);
	return resolveDamageActors(rows.map(r => (standIns.has(r.uuid) ? { ...r, uuid: standIns.get(r.uuid).by } : r)));
}

// "Apply damage" on the results card. Writes each target's HP, mitigating by armor/piercing at
// apply time. Idempotent: an `applied` map keyed by token uuid means a second click only fills
// targets not yet done. The GM presses it for damage dealt to foes; a player presses it for damage
// to their own character (see ownsEveryTarget). On a card they wrote, exactly one of them has a live
// button at a time, which is `electedApplier`'s business and not the latch's. On a card the GM wrote,
// both do: the player's press is applied by the GM's client (APPLY_QUERY), in turn with the GM's own.
/**
 * Whether THIS client's press on a damage card counts, and if not, why: the one gate Apply and the
 * fight's "Leave off the +N" share, so the person who may apply the damage is the person who may
 * change what it is.
 *
 * @returns {{pending: object[], hide?: boolean, refused?: string}}
 */
function applyGate(message, damage) {
	const appliedUuids = new Set((Array.isArray(damage.applied) ? damage.applied : []).map(a => a.uuid));
	const pending = damage.results.filter(r => !appliedUuids.has(r.uuid));

	const owed = pending.length ? pending : damage.results;
	// ONE resolution pass for both questions below. Each row's uuid used to be looked up twice per
	// render, and chat re-renders on every flag write anywhere in the log.
	const owedActors = sufferingActors(damage, owed);
	const applier = electedApplier(owedActors, message);

	if (!game.user.isGM) {
		if (!ownsEveryTarget(owedActors)) return { pending, hide: true };
		// A card the GM authored (a monster's blow, a counter-attack): the latch that stops the same damage
		// being taken twice lives on the MESSAGE, which the player cannot write. So the press goes to the
		// GM's client (APPLY_QUERY), which applies it in line with the GM's own presses (applyInTurn).
		// With no GM there, nothing could record it: say so rather than write HP and lose the latch.
		if (!message.isOwner) {
			if (!game.users?.activeGM) return { pending, refused: "Ask the GM to apply this damage" };
			// A co-owned character: one of the owners, the same one on every screen.
			const owner = electedOwner(owedActors);
			if (owner && owner !== game.user.id) return { pending, refused: "Another player will take this damage" };
			return { pending, relay: true };
		}
		// A co-owned character: both players own every row, and both buttons would subtract.
		if (applier && applier !== game.user.id) return { pending, refused: "Another player will take this damage" };
	} else if (!isPrimaryGM()) {
		// With several GMs connected, only the primary GM's click enacts, so two GMs can't
		// both subtract HP before the applied-flag propagates.
		return { pending, refused: "Another GM will apply this damage" };
	} else if (applier) {
		// A card aimed at somebody's own character, with that somebody at the table: theirs to
		// press, and the GM's copy has to stand down or both clicks land (see electedApplier).
		return { pending, refused: `${game.users?.get?.(applier)?.name ?? "The owning player"} will take this damage` };
	}
	return { pending };
}

/**
 * `applyGate` for one render of one card, worked out at most once: Apply and the fight's toggle both
 * ask, and the gate resolves every row and every player's ownership.
 */
export function applyGateOnce(message) {
	let gate = null;
	return damage => (gate ??= applyGate(message, damage));
}

export function wireApplyDamage(message, html, gateFor = applyGateOnce(message)) {
	const root = html?.[0] ?? html;
	const btn = root.querySelector(".stonetop-apply-damage");
	if (!btn) return;

	const damage = message.getFlag(SCOPE, "damage");
	if (!damage) { btn.disabled = true; return; }

	const gate = gateFor(damage);
	const pending = gate.pending;
	if (gate.hide) { btn.style.display = "none"; return; }
	if (gate.refused) {
		btn.disabled = true;
		btn.title = gate.refused;
		return;
	}

	if (pending.length === 0) {
		btn.disabled = true;
		btn.innerHTML = `<i class="fas fa-check"></i> ${damage.selfHarm ? "Damage taken" : "Damage applied"}`;
		return;
	}

	btn.addEventListener("click", async () => {
		// One press at a time. The rows are applied one after another, and a second press that read the
		// card before the first wrote `applied` would take every row's HP twice.
		if (btn.disabled) return;
		btn.disabled = true;
		let landed = false;
		try {
			landed = gate.relay ? await askGMToApply(message) : await applyInTurn(message, damage);
		} catch (err) {
			console.error("Stonetop | applying damage failed", err);
		} finally {
			// A press that landed redraws the card with the button settled; one that landed nothing (every row
			// off the map, or without HP) can be pressed again.
			if (!landed) btn.disabled = false;
		}
	});
}

/** The User query a player's Apply goes through on a card the GM authored (`applyGate`'s `relay`). */
export const APPLY_QUERY = "stonetop.applyDamage";

/**
 * Apply a card's owed damage in the card's turn on this client (utils/card-queue.js), behind any apply or
 * Readiness spend already running for it, so the second apply reads the `applied` latch the first wrote
 * and takes nothing twice, and a spend pressed first is counted. On the GM's client this lines up the
 * GM's own press with a player's relayed one (`handleApplyQuery`, defend-spend.js#handleSpendQuery).
 */
function applyInTurn(message, damage) {
	return inCardTurn(message, () => applyOwedDamage(message, damage));
}

/** A player's press on a card the GM authored: the GM's client applies it. Whether any row landed. */
async function askGMToApply(message) {
	const gm = game.users?.activeGM;
	if (!gm) { ui.notifications?.warn("Ask the GM to apply this damage"); return false; }
	try {
		// Who asked rides in the data: v14 names the asker in the query's context, v13 does not.
		return !!(await gm.query(APPLY_QUERY, { messageId: message.id, userId: game.user?.id ?? null }, { timeout: 10000 }));
	} catch (err) {
		console.warn("Stonetop | the GM's client could not apply the damage", err);
		ui.notifications?.warn("The GM's client did not apply the damage. Ask the GM to press it.");
		return false;
	}
}

/**
 * The GM's side of `APPLY_QUERY`: apply a card for the player who pressed it, if that player owns every
 * row still owed. Only the primary GM's client answers, as only its own press counts (`applyGate`).
 *
 * WHO ASKED is foundry-compat.js#queryAsker's business: v13 names nobody in the context, so the id
 * in the data is read instead, and never taken for a GM's.
 *
 * @param {{messageId: string, userId?: string}} data
 * @param {{user?: object}} context
 * @returns {Promise<boolean>}  whether any row was applied
 */
export async function handleApplyQuery(data, context = {}, { messages = game.messages, users = game.users } = {}) {
	if (!game.user?.isGM || !isPrimaryGM()) return false;
	const user = queryAsker(data, context, users);
	const message = messages?.get?.(data?.messageId);
	const damage = message?.getFlag?.(SCOPE, "damage");
	if (!user || !damage?.results?.length) return false;
	const applied = new Set((damage.applied ?? []).map(a => a.uuid));
	const owed = damage.results.filter(r => !applied.has(r.uuid));
	if (!owed.length) return false;
	// The same rows the player's own gate read, stand-ins included: every one theirs to take.
	const actors = sufferingActors(damage, owed);
	if (!actors?.every(a => a.testUserPermission?.(user, "OWNER"))) return false;
	return applyInTurn(message, damage);
}

/**
 * Apply every row of a damage card not yet applied, and post what each took. Returns whether any row
 * was recorded as applied.
 */
async function applyOwedDamage(message, damage) {
	const current = message.getFlag(SCOPE, "damage") ?? damage;
	const nextApplied = Array.isArray(current.applied) ? [...current.applied] : [];
	const before = nextApplied.length;
	const doneUuids = new Set(nextApplied.map(a => a.uuid));
	// A press that waited its turn behind one that took everything (applyInTurn): nothing to write or say.
	if (!current.results.some(r => !doneUuids.has(r.uuid))) return false;
	// The other attackers' piercing counts only while their +N does (seedPiercing).
	const piercing = Math.max(resolvePiercing(current.weapon?.piercing), seedPiercing(current.seed));
	// The fight's +N as it stands now, against what was rolled (see seedAdjustment). A group's -N is the
	// bigger group's ARMOR (p.416), so it is taken back off the roll and added to armor instead,
	// where piercing and "ignores armor" can reach it (seedArmor).
	const adjustment = seedAdjustment(current.seed);
	const groupArmor = seedArmor(current.seed);
	// Who struck, to tell a lone attacker's blow on a group from a group's (fight/group-hits.js).
	const attacker = current.attackerUuid ? await fromUuid(current.attackerUuid).catch(() => null) : null;
	// And who struck for PAYBACK's purposes, which is not the same on a card a character took: there the
	// card's attacker IS that character, and the foe is `foeUuid` (as a parry's strike back reads it).
	const striker = current.selfHarm
		? (current.foeUuid ? await fromUuid(current.foeUuid).catch(() => null) : null)
		: attacker;
	// Defend's Readiness, spent on a blow from this card (fight/defend-spend.js): halved before armor,
	// or taken by a defender in the ward's place, against the defender's own armor.
	const { halved, standIns, ignored, knockedDown } = spentOn(current);
	const lines = [];
	// What each token does on the map once this press lands (combat/attack-fx.js#playHitReactions):
	// on whoever actually took the blow, which is the stand-in when a Defend put one in the way.
	const reactions = [];
	const barkskin = barkskinOnce();
	for (const r of current.results) {
		if (doneUuids.has(r.uuid)) continue;
		const td = await fromUuid(r.uuid);
		const standIn = standIns.get(r.uuid);
		const defender = standIn ? damageRowActor(await fromUuid(standIn.by).catch(() => null)) : null;
		const targetActor = defender ?? damageRowActor(td);
		const rowName = defender ? format("stonetop.fight.defend.rowFor", { defender: defender.name, ward: r.name }) : r.name;
		const struck = defender ? standIn.by : r.uuid;
		if (!targetActor) { lines.push(`<li><strong>${escHtml(r.name)}</strong>: no longer on the map</li>`); continue; }
		// A Mighty Rampart: "completely ignore the effects/damage of an attack that you suffer".
		if (ignored.has(r.uuid)) {
			reactions.push({ uuid: struck, reaction: hitReaction({ ignored: true }) });
			nextApplied.push({ uuid: r.uuid, effective: 0, ignored: true, ...(defender ? { by: standIn.by } : {}) });
			lines.push(`<li><strong>${escHtml(rowName)}</strong>: ${escHtml(format("stonetop.fight.defend.ignoredLine", {}))}</li>`);
			continue;
		}
		// Undaunted: "+1 armor" while outnumbered or facing a foe bigger than them.
		const undaunted = targetActor.type === "character" && !!undauntedNow(targetActor);
		const worn = wornArmor(targetActor, barkskin);
		// Barkskin and the Candle rest on fiction, and the card lets the table say the clause was not met
		// (wireConditionalArmor). Ticked off, that much armor comes back out of the total.
		const gatedOff = armorLeftOff(current).has(r.uuid) ? worn.conditional : 0;
		const armor = Math.max(0, worn.armor - gatedOff) + (undaunted ? 1 : 0) + groupArmor;
		const unpierceable = worn.unpierceable;
		const rolled = Math.max(0, r.raw + adjustment + groupArmor);
		// The card shows its total with a group's -N taken off (wireDamageSeed): said beside the number
		// Apply starts from, so the table can see where the difference went.
		const shown = Math.max(0, r.raw + adjustment);
		const back = groupArmor && shown !== rolled
			? ` <span class="stonetop-damage-mitigated">(${escHtml(format("stonetop.fight.seed.armorBack", { shown, rolled, armor: groupArmor }))})</span>`
			: "";
		// Halved by Readiness, by I Get Knocked Down, or by both — each is its own move with its own price,
		// and the book stops neither from meeting the same blow. Halving comes before armor (p.216).
		let raw = halved.has(r.uuid) ? halveDamage(rolled) : rolled;
		if (knockedDown.has(r.uuid)) raw = halveDamage(raw);
		const effective = mitigateDamage(raw, { armor, piercing, unpierceable, ignoresArmor: current.weapon?.ignoresArmor });
		// Through `mitigationDetail`, the one place the subtraction is put into words: this
		// used to restate `armor - piercing` inline, which stopped matching the moment
		// mitigateDamage learned about an unpierceable floor, and printed armor the
		// arithmetic had not applied.
		const detail = mitigationDetail({ armor, piercing, unpierceable, ignoresArmor: current.weapon?.ignoresArmor });
		const mitigated = effective !== raw ? ` <span class="stonetop-damage-mitigated">(${raw}${detail})</span>` : "";
		// ONE MEMBER OF A GROUP, for one attacker's blow: see fight/group-hits.js.
		if (!current.selfHarm && !current.groupBlow && isLoneBlowOnGroup(targetActor, attacker, td?.parent ?? null)) {
			const hit = await applyMemberHit(targetActor, effective);
			if (hit) {
				reactions.push({ uuid: struck, reaction: hitReaction({ raw, effective, lowered: !!hit.harmed }) });
				nextApplied.push({ uuid: r.uuid, effective, member: true, down: hit.down, before: hit.before, after: hit.after });
				const said = format(`stonetop.fight.groupHit.${hit.down ? "down" : hit.harmed ? "hurt" : "unhurt"}`, { after: hit.after, memberHp: hit.memberHp, hpMax: hit.hpMax });
				lines.push(`<li><strong>${escHtml(r.name)}</strong>: ${effective} damage${back}${mitigated}: ${escHtml(said)}</li>`);
				continue;
			}
		}
		const t = await applyDamageToActor(targetActor, effective);
		// A target actor with no hp attribute (e.g. a steading token) yields null. Skip it
		// without recording it as applied, so it can be retried if the actor is fixed —
		// rather than rendering "undefined → undefined HP" and marking it done forever.
		if (!t) { lines.push(`<li><strong>${escHtml(r.name)}</strong>: has no HP to damage</li>`); continue; }
		reactions.push({ uuid: struck, reaction: hitReaction({ raw, effective, lowered: t.newHp < t.oldHp }) });
		nextApplied.push({ uuid: r.uuid, effective, oldHp: t.oldHp, newHp: t.newHp, ...(defender ? { by: standIn.by } : {}) });
		// Payback: "a foe that has harmed you or one of your allies". Written on the character who took
		// it, by whoever applied it — the one client certain to be allowed to write anything here.
		//
		// NEVER AT THE COST OF THE DAMAGE. This is bookkeeping for a move most characters do not have,
		// and it runs after the HP is already written but before the latch: a throw here would lose the
		// `applied` entry and let the same blow be applied again.
		if (effective > 0 && striker) {
			await recordHarmedBy(targetActor, striker).catch(err => console.warn("Stonetop | could not record who struck", err));
		}
		const dead = t.newHp === 0 ? " <em>(0 HP)</em>" : "";
		const half = raw !== rolled ? ` <span class="stonetop-damage-mitigated">(${escHtml(format("stonetop.fight.defend.halvedFrom", { rolled }))})</span>` : "";
		const brave = undaunted ? ` <span class="stonetop-damage-mitigated">(${escHtml(format("stonetop.fight.heroMoves.undaunted.armorNote", {}))})</span>` : "";
		const gateWords = gatedOff ? armorGateWords(worn.conditionalSource) : null;
		const bare = gatedOff
			? ` <span class="stonetop-damage-mitigated">(${escHtml(format(`stonetop.fight.heroMoves.armorGate.${gateWords?.noteKey ?? "note"}`, { move: worn.conditionalSource, ...gateWords?.params, armor: gatedOff }))})</span>`
			: "";
		lines.push(`<li><strong>${escHtml(rowName)}</strong>: ${effective} damage${back}${half}${mitigated}${brave}${bare}: ${t.oldHp} &rarr; ${t.newHp} HP${dead}</li>`);
	}
	// Only the latch: a Readiness spend another client wrote meanwhile stays on the card.
	await message.setFlag(SCOPE, "damage.applied", nextApplied);
	await ChatMessage.create({
		content: stonetopChatCard(`${current.move}: damage applied`, `<div class="card-content"><ul class="stonetop-homestead-chat-list">${lines.join("")}</ul></div>`, "stonetop-attack-applied-card"),
		speaker: { alias: "Stonetop" },
	});
	// After the latch and the card: the HP is written and said, so this is only the map catching up.
	playHitReactions(reactions, { whispered: (message.whisper?.length ?? 0) > 0 });
	return nextApplied.length > before;
}

/**
 * The tick box for armor a move grants on a clause the sheet cannot check — Barkskin's "while touching
 * the earth", A Candle Against the Dark's "but go otherwise unarmed".
 *
 * TICKED, because the clause is the ordinary case for a character who took the move: a Blessed is
 * standing on the ground, a Lightbearer who lit a holy light is holding it. Untick it and that much
 * armor comes off this one blow (applyOwedDamage) — which is the whole reason the question is asked
 * HERE: the moment armor is about to matter is the moment the table knows whether she was in the water.
 *
 * Drawn per row from the actor and the flag on every client, like the +N toggle, and pressed by
 * whoever may press Apply. Once the damage is applied it is history, so the box is disabled.
 */
export function wireConditionalArmor(message, html, gateFor = applyGateOnce(message)) {
	const root = html?.[0] ?? html;
	const damage = message.getFlag(SCOPE, "damage");
	const actions = root?.querySelector?.(".stonetop-attack-actions");
	if (!damage?.results?.length || !actions) return;

	const off = armorLeftOff(damage);
	// WHOSE ARMOR THE ROW IS TAKEN AGAINST, read the same way applyOwedDamage reads it: a Defend that
	// put someone in the ward's place moves the whole armor calculation onto the STAND-IN. Drawn from
	// the ward instead, the box asked about skin the subtraction never touched — so unticking it was a
	// silent no-op, and a stand-in who really was Barkskin'd got no box at all.
	const { standIns } = spentOn(damage);
	const done = new Set((damage.applied ?? []).map(a => a.uuid));
	const gate = gateFor(damage);
	// Loop-invariant, so it is asked before the rows rather than once per row: a hidden gate draws
	// nothing at all, and every uuid resolution below would be thrown away.
	if (gate.hide) return;
	const several = damage.results.filter(r => r.uuid).length > 1;
	const barkskin = barkskinOnce();

	for (const row of damage.results) {
		if (!row.uuid || done.has(row.uuid)) continue;
		const standIn = standIns.get(row.uuid);
		const target = damageRowActor(resolveSync(standIn?.by ?? row.uuid));
		const gated = target ? conditionalArmorOf(target, barkskin) : null;
		// No key means a `conditionalSource` this build does not know (a world written by a later one),
		// which has no words to offer the armor back with (actors/character/move-armor.js#armorGateWords).
		const gateWords = gated ? armorGateWords(gated.source) : null;
		if (!gateWords) continue;

		const label = document.createElement("label");
		label.className = "stonetop-damage-armor-gate";
		const box = document.createElement("input");
		box.type = "checkbox";
		box.className = "stonetop-check";
		box.checked = !off.has(row.uuid);
		const words = format(`stonetop.fight.heroMoves.armorGate.${gateWords.key}`, { ...gateWords.params, armor: gated.armor });
		// Named whenever the box is not plainly about the one person the card is about — which a
		// stand-in's box never is, even on a card with a single row. The same words applyOwedDamage
		// labels that row with, so the question and the arithmetic name the same character.
		const whose = standIn ? format("stonetop.fight.defend.rowFor", { defender: target.name, ward: row.name }) : row.name;
		label.append(box, Object.assign(document.createElement("span"), {
			textContent: several || standIn ? `${whose}: ${words}` : words,
		}));
		actions.append(label);

		if (gate.refused || gate.relay || done.size) {
			box.disabled = true;
			box.title = gate.refused ?? (gate.relay ? "Ask the GM to change this" : format("stonetop.fight.seed.alreadyApplied", {}));
			continue;
		}
		box.addEventListener("change", async () => {
			box.disabled = true;
			const now = message.getFlag(SCOPE, "damage");
			const list = new Set(Array.isArray(now?.armorOff) ? now.armorOff : []);
			if (box.checked) list.delete(row.uuid);
			else list.add(row.uuid);
			await message.setFlag(SCOPE, "damage.armorOff", [...list]);
		});
	}
}


/**
 * "Leave off the +N" on a damage card carrying the fight's extra-attackers bonus.
 *
 * DRAWN FROM THE FLAG ON EVERY CLIENT. The totals, the pill and the button are painted from
 * `damage.seed` each render, so a toggle that writes the flag redraws the card the same way at every
 * seat, and nothing about the stored card content has to change.
 *
 * PRESSED BY WHOEVER MAY PRESS APPLY (`applyGate`), and only until damage has been applied: after that
 * the HP is written and the number on the card is history. A player whose press is relayed through the
 * GM (a card the GM wrote) may not: the toggle writes the card, and only its author's client can.
 */
export function wireDamageSeed(message, html, gateFor = applyGateOnce(message)) {
	const root = html?.[0] ?? html;
	const damage = message.getFlag(SCOPE, "damage");
	const seed = damage?.seed;
	if (seedBonus(seed) === 0) return;

	const adjustment = seedAdjustment(seed);
	for (const row of root.querySelectorAll(".stonetop-damage-row[data-uuid]")) {
		const result = damage.results?.find(r => r.uuid === row.dataset.uuid);
		const number = row.querySelector(".stonetop-roll-result-number");
		if (result && number) number.textContent = String(Math.max(0, result.raw + adjustment));
		row.classList.toggle("is-seed-left-off", adjustment !== 0);
	}
	const pill = root.querySelector(".stonetop-condition-numbers");
	if (pill) {
		pill.textContent = seed.applied === false ? seed.pillLeftOff : seed.pill;
		pill.classList.toggle("is-left-off", seed.applied === false);
	}

	const btn = root.querySelector(".stonetop-damage-seed-toggle");
	if (!btn) return;
	btn.innerHTML = seedToggleLabel(seed);
	const gate = gateFor(damage);
	if (gate.hide) { btn.style.display = "none"; return; }
	if (gate.refused) { btn.disabled = true; btn.title = gate.refused; return; }
	// A card the GM wrote: the player may have it applied (through the GM's client) but not rewrite it.
	if (gate.relay) { btn.disabled = true; btn.title = "Ask the GM to change this"; return; }
	if ((damage.applied ?? []).length) {
		btn.disabled = true;
		btn.title = format("stonetop.fight.seed.alreadyApplied", {});
		return;
	}

	btn.addEventListener("click", async () => {
		if (btn.disabled) return;
		btn.disabled = true;
		try {
			// In the card's turn, so a toggle pressed with Apply lands before it or not at all.
			await inCardTurn(message, async () => {
				const current = message.getFlag(SCOPE, "damage");
				if (!current?.seed || (current.applied ?? []).length) return;
				await message.setFlag(SCOPE, "damage.seed", { ...current.seed, applied: current.seed.applied === false });
			});
		} catch (err) {
			console.error("Stonetop | changing the fight's extra damage failed", err);
			btn.disabled = false;
		}
	});
}

// -- Suffering the enemy's attack ---------------------------------------------
//
// NOBODY PRESSES A BUTTON TO BE HIT. Clash's 7-9 and its 6- both say "you suffer your enemy's
// attack" flatly, and its 10+ says it as the price of strike-hard's +1d6; not one of the three is
// an offer. They used to post a "Suffer your enemy's attack" button that opened a dialog to
// confirm a number, which put two deliberate clicks between a stated consequence and the damage
// it states — and left a card in the log with an unstruck blow on it whenever the table moved on
// without pressing it. The counter-attack fires itself now, and lands on the SAME damage card
// every other damage roll in this file lands on: the red total, the formula chip, the armor fine
// print, and one "Take this damage" button that writes the HP once and cannot write it twice.
//
// THREE WAYS A FOE'S ATTACKS CAN READ, and each gets its own answer:
//   one attack           roll it and post the card — 108 of the shipped stat blocks
//   several              whisper the GM a card of buttons first, because which blow it made is
//                        their fiction call and the buttons ARE the stat block — 81 of them
//   none at all          whisper the GM a card asking for the number: the 22 spirits print
//                        "none", and a Clash rolled with nothing targeted has no block to read.
//
// A PRINTED ATTACK WITH NO DIE TAKES THE THIRD ROUTE, not the first, and it is a real foe rather
// than a hypothetical one: an attack that brought its own tag list is a whole printed attack even
// with no die on it (utils/damage.js#splitMonsterAttackProse), so the Thraulgwyn Raider's
// "hair-rope net (thrown, crude, grabby)" is one, and a line reading "by weapon (close, forceful)"
// is a foe whose ENTIRE damage is die-less. Rolling those as `formula || "0"` posted a damage card
// for 0 and called the consequence paid. What it costs is exactly the question the third card
// asks, so it is the card they get — carrying the attack, so the number the GM names still lands
// under that blow's name, its tags and its armor clause.
//
// WHAT IT COUNTS AS AN ATTACK is the damage line AND the foe's damage-rolling moves, because the
// book puts a second blow in either place (utils/damage.js#foeAttacks). That is what moved 17 of
// those stat blocks up a row.

/**
 * The foe hits back. Reads the targeted foe's printed damage line and takes one of the three
 * routes above; returns whatever was posted.
 *
 * THE FIRST TARGET, because Clash is a single-foe move — the card already warns when a player
 * points it at several, and the one that struck back is the one they closed with.
 */
export async function sufferEnemyAttack(pc, { targets } = {}) {
	if (!pc) return null;
	// The fight's +N when several foes are in contact with the character (Book I p.414): rolled into
	// the blow, named on its card, and left off from there if the table waives it.
	const engagement = pcEngagement(pc);
	const seed = incomingSeed({ pc, found: engagement });

	// NOTHING TARGETED, BUT A FIGHT ON THE MAP: "your enemy" is whoever is in contact with the
	// character. One stat block among them (a pair of crinwin) strikes as that foe; several different
	// ones put the choice to the GM, every foe's attacks on one card.
	let aimed = targets?.length ? targets : [];
	if (!aimed.length) {
		const engaged = engagedFoeTargets(pc, engagement);
		const distinct = [...new Map(engaged.map(t => [t.actorId ?? t.uuid, t])).values()];
		if (distinct.length === 1) aimed = distinct;
		else if (distinct.length > 1) return sufferFromSeveral(pc, distinct, seed);
	}

	const target = aimed[0] ?? null;
	// A caught `fromUuid`, because the foe may be an unlinked token on a scene nobody is looking
	// at, or one deleted mid-fight — and a throw here would swallow the counter-attack whole.
	const foe = target?.uuid
		? await fromUuid(target.uuid).then(td => td?.actor ?? null).catch(() => null)
		: null;

	// `damage.value` is PROSE ("rusty sword d8+2 (forceful) or crushing grip d8+2 …") — feeding it
	// to Roll crashes on its commas and words — so it is READ into its printed attacks, each with
	// its own die and its own armor clause (utils/damage.js#foeAttacks). `rollFormula` is the
	// fallback applied when the prose holds no die at all, and the foe's MOVES are read too: the
	// book routes a second attack through a move, and 19 stat blocks keep a whole blow there.
	const dmg = foe?.system?.attributes?.damage ?? {};
	const foeText = String(dmg.value || "").trim();
	const foeName = target?.name ?? foe?.name ?? "";
	// Which foe this is rides on each blow, so a hero who locked eyes with it (Big Damn Hero) gets its
	// damage at disadvantage whichever route the blow takes.
	const attacks = foeAttacks(foe).map(attack => ({ ...attack, foeUuid: target?.uuid ?? "" }));

	if (attacks.length > 1) {
		return askTheGm(postSufferChoiceCard({ pc, foeName, foeText, attacks, seed }), { foeName, waitingFor: "which attack it made" });
	}
	// `formula`, not the count: a printed attack can be an attack and still have no die (see above).
	const only = attacks[0] ?? null;
	if (only?.formula) return postIncomingDamage(pc, only, { foeName, seed });
	return askTheGm(postSufferAmountCard({ pc, foeName, foeText, attack: only, seed }), { foeName, waitingFor: "what it costs" });
}

/**
 * Several different foes in contact and nothing targeted: one "Which attack?" card holding every
 * attack each of them prints, each row naming whose it is. A foe that prints no attack still gets a
 * row, priced by the GM like any die-less blow.
 */
async function sufferFromSeveral(pc, foes, seed) {
	const attacks = [];
	const actors = await Promise.all(foes.map(foe => fromUuid(foe.uuid).then(td => td?.actor ?? null).catch(() => null)));
	for (const [i, foe] of foes.entries()) {
		const printed = foeAttacks(actors[i]);
		const rows = printed.length
			? printed
			: [{ label: "", formula: "", piercing: 0, ignoresArmor: false, rollMode: "normal", tags: [] }];
		for (const attack of rows) attacks.push({ ...attack, foeName: foe.name, foeUuid: foe.uuid });
	}
	const foeName = joinNames(foes.map(f => f.name));
	return askTheGm(postSufferChoiceCard({ pc, foeName, foeText: "", attacks, seed }), { foeName, waitingFor: "which attack struck" });
}

/**
 * A whispered ask, and a public word about it when there is nobody there to read it.
 *
 * `ChatMessage.getWhisperRecipients("GM")` lists every user with the role, connected or not, so a
 * whisper always sends — it just may reach no one. At a table with the GM away (or none logged in
 * at all: solo prep, a player trying the sheet out) the counter-attack then leaves NOTHING on the
 * player's screen. Their own move card said "you suffer your enemy's attack" and then the log went
 * quiet: the stated consequence silently swallowed, which is the very thing firing the counter
 * automatically was meant to stop.
 *
 * Only when no GM is here, and only one line. With a GM at the table the whisper is answered in
 * seconds and the public damage card follows, so a "waiting on the GM" note every time one of the
 * 81 multi-attack foes swings would be a message per counter-attack for no one's benefit.
 *
 * The blows themselves stay behind the whisper either way — the line says a choice is pending,
 * never what there is to choose from.
 */
async function askTheGm(posting, { foeName, waitingFor }) {
	const card = await posting;
	if (anyActiveGM()) return card;

	const who = escHtml(foeName || "The enemy");
	await ChatMessage.create({
		content: stonetopChatCard("Waiting on the GM", `<div class="card-content">
			<p><strong>${who}</strong> strikes back. It is for the GM to say ${escHtml(waitingFor)}, and no GM is here to answer.</p>
		</div>`, "stonetop-suffer-waiting-card"),
		speaker: { alias: "Stonetop" },
	});
	return card;
}

/**
 * Roll ONE of the foe's printed attacks at the character, and post it on the shared damage card.
 *
 * THE FOE'S ATTACK IS THE CARD'S WEAPON, which is not a pun. `rollAndPostDamage` reads a weapon
 * for exactly the three things a printed attack also carries — what it is called, what it pierces,
 * and whether it bypasses armor — and `wireApplyDamage` mitigates with them against the target's
 * armor at apply time. So "heat-drain d12+1 (reach, ignores armor)" reaches a character's HP
 * through the same arithmetic a character's own axe reaches a monster's, and the two cannot drift
 * apart. The tags ride along too, so an incoming messy or grabby blow prints the same fiction
 * notes on its damage card that an outgoing one does (tagNoticesHtml).
 *
 * `selfTarget` and `selfHarm` are the same pair a move option that burns whoever ticked it uses
 * (rollOptionDamage): the row names the character, and the button says "Take this damage" rather
 * than "Apply damage", which is work waiting on somebody else.
 *
 * THE DAMAGE WINDOW IS NOT ASKED, and could not be. It exists for the fiction-gated bonuses that
 * ride a CHARACTER's own damage die (see dialogs/RollDialog.js#promptDamage); a stat block's
 * printed d12+1 is the book's number, with nothing for them to attach to. `rollMode` carries the
 * stat line's own "w/advantage", which damageRollFormula applies to the die.
 */
async function postIncomingDamage(pc, attack, { foeName = "", seed = null } = {}) {
	// Big Damn Hero: a foe the character locked eyes with rolls this at disadvantage.
	const foe = attack?.foeUuid ? await fromUuid(attack.foeUuid).then(td => td?.actor ?? null).catch(() => null) : null;
	const pcToken = pcEngagement(pc)?.combatant?.token ?? null;
	// Locked eyes (Big Damn Hero) and the moves the character's own skin carries (Never Gonna Keep Me
	// Down, Uncanny Reflexes, Battlefield Grace) both reach a counter-attack, which is a blow like any other.
	// THE CHARACTER'S OWN SKIN COMES WITH THEM. Never Gonna Keep Me Down is about standing at 5 HP or
	// less, not about being in a fight the tab has worked out — so gating this on the engagement meant a
	// counter-attack on a scene with no fight, or with the Fight tab off entirely, skipped the move and
	// the blow landed whole. The token when there is one, because locked eyes is keyed by token uuid;
	// the actor otherwise, which defenderModes resolves just as well and which no locked eyes can match.
	const rollMode = await incomingMode(foe ?? pc, [pcToken ? { uuid: pcToken.uuid } : selfTarget(pc)],
		attack?.rollMode ?? "normal", { includeOffered: true });
	return rollAndPostDamage(pc, {
		// What the card's title and its follow-up both compose from: "Rime Lord's attack: damage",
		// then "…: damage applied". The ATTACK's own name goes in the weapon slot below, where it
		// prints as the row's fine print beside whatever armor clause it carries.
		move: foeName ? `${foeName}'s attack` : "The enemy's attack",
		weapon: {
			name: attack?.label ?? "",
			range: [],
			piercing: attack?.piercing ?? 0,
			ignoresArmor: attack?.ignoresArmor ?? false,
			tags: attack?.tags ?? [],
		},
		targets: [selfTarget(pc)],
		selfHarm: true,
		foeUuid: attack?.foeUuid ?? "",
		// The foe's token strikes the character's: the card's speaker is the one struck, so the blow on
		// the map is aimed the other way round from every other card's.
		fx: { attacker: attack?.foeUuid || null, blow: attack?.label ?? "" },
		damage: {
			base: attack?.formula || "0",
			rollMode,
			bonus: 0,
			extraDice: "",
			// The fight's +N for several foes on this character, when there is one, with the striker's own
			// tags taken back out. The card names it and offers to leave it off (wireDamageSeed): no window is
			// asked here, so that is where it goes.
			...(seed ? { seed: seedWithoutStriker(seed, attack?.foeUuid ?? "") } : {}),
		},
	});
}

/**
 * How the rolled number became the suggested one, said out loud — what lets a mitigated total
 * read as arithmetic rather than a number from nowhere. An attack that bypasses armor says so
 * instead of showing a subtraction that did not happen, and one that pierces shows the armor it
 * actually met.
 */
function mitigationDetail({ armor, piercing, ignoresArmor, unpierceable = 0 }) {
	const floor = Math.max(0, Math.min(Number(unpierceable) || 0, Number(armor) || 0));
	// Armor that shrugs off the bypass entirely (PROOF AGAINST HARM) still soaks, so a flat
	// "ignoring your armor" would contradict the number printed beside it.
	if (ignoresArmor) {
		if (!armor) return "";
		return floor ? ` − ${floor} armor (the rest ignored)` : ", ignoring your armor";
	}
	// Piercing that would cut below the floor is stopped by it; say so rather than printing
	// an armor number the arithmetic above did not actually use.
	if (floor && (Number(piercing) || 0) > 0 && (Number(armor) || 0) - piercing < floor) {
		return ` − ${floor} armor (piercing cannot reduce it)`;
	}
	const effective = Math.max(0, armor - piercing);
	if (!armor) return "";
	if (piercing) return ` − ${effective} armor (${armor} − ${piercing} piercing)`;
	return ` − ${armor} armor`;
}

// -- "Which attack?" — the GM's pick for a foe with more than one -------------

/**
 * Whether this card has already been answered. Index 0 is a real answer, so the test is against
 * null/undefined and never against falsiness — `!choice.chosen` would let the first attack on
 * every card be taken twice.
 */
function isChosen(choice) {
	return choice?.chosen !== null && choice?.chosen !== undefined;
}

/**
 * The "Which attack?" card's body: the foe's damage line printed whole, then one button per
 * attack it offers. Exported so the card can be rendered against the real stylesheet without
 * standing up a ChatMessage.
 */
export function sufferChoiceCardBody({ pcName, foeName, foeText, attacks, seed = null }) {
	// With several foes' blows on one card and several of them on the character, the book rolls "the
	// single highest damage die among them" (Book I p.239; p.414 "usually the best one"): that row is
	// marked, and the GM still picks.
	const hardest = seed && new Set(attacks.map(a => a.foeName ?? "")).size > 1 ? hardestAttackIndex(attacks) : -1;
	const rows = attacks.map((attack, index) => {
		// What the button must say to be worth pressing: the die it rolls, and the two clauses that
		// change what reaches the character. Everything else on the stat line is fiction and is
		// already printed whole, above, in the foe's own damage text.
		// A printed attack that rolls nothing — the Thraulgwyn Raider's grabby net — says so in
		// the die's place rather than leaving the column blank: an empty cell reads as a bug, and
		// "no damage die" is the actual answer, which the confirm dialog then asks the GM to name.
		const adv = attack.rollMode === "adv" ? "advantage" : attack.rollMode === "dis" ? "disadvantage" : "";
		// The armor clauses come from weapons.js, like the weapon picker's and the damage card's,
		// so the three cannot word the same blow differently - and so a blow that both pierces
		// and ignores armor says both, which a ternary between them could not.
		const notes = [adv, ...weaponArmorBits(attack)].filter(Boolean).join(", ");
		// The die is LAST so it lands hard right on every row, notes or no notes: a column of dice
		// that jogged left whenever a row carried "ignores armor" would be unreadable down a stack
		// of three, and comparing the dice is what the card is for.
		// Whose blow this is, when the card holds several foes' attacks (a character in contact with more
		// than one kind of foe, and nothing targeted).
		const whose = attack.foeName ? `<span class="stonetop-suffer-choice-foe">${escHtml(attack.foeName)}</span> ` : "";
		return `<li><button type="button" class="stonetop-attack-btn stonetop-suffer-choice" data-index="${index}">
			<span class="stonetop-suffer-choice-name">${whose}${escHtml(attack.label || "Attack")}${index === hardest ? ` <em class="stonetop-suffer-choice-best">${escHtml(format("stonetop.fight.seed.hardest", {}))}</em>` : ""}</span>
			<span class="stonetop-suffer-choice-meta">
				${notes ? `<span class="stonetop-suffer-choice-note">${escHtml(notes)}</span>` : ""}
				<span class="stonetop-suffer-choice-die">${escHtml(attack.formula || "no damage die")}</span>
			</span>
		</button></li>`;
	}).join("");

	return `<div class="card-content">
		<p><strong>${escHtml(foeName || "The enemy")}</strong> strikes <strong>${escHtml(pcName)}</strong>.</p>
		${foeText ? `<p class="stonetop-suffer-fiction">${escHtml(foeText)}</p>` : ""}
		${seed?.label ? `<p class="stonetop-suffer-seed">${escHtml(seed.label)}</p>` : ""}
		<ul class="stonetop-suffer-choices">${rows}</ul>
	</div>`;
}

/**
 * Ask the GM which of a foe's printed attacks it just made, as one button per attack.
 *
 * WHISPERED TO THE GMs, not posted to the table. The buttons ARE the stat block's damage line —
 * every die, every piercing value, which blow ignores armor — and that is the GM's to know. The
 * table learns the answer the moment it is chosen, because the damage card that follows is public
 * and names the attack that struck; the blows the foe did NOT make stay behind the whisper.
 *
 * IT POINTS AT NOTHING, which it used to have to. While the player pressed a "Suffer your enemy's
 * attack" button, this card carried that message's id so the pick could retire it from "waiting on
 * the GM" to "suffered". There is no such button now — the tier that states the counter-attack
 * fires it — so the pick has only its own latch to keep.
 */
async function postSufferChoiceCard({ pc, foeName, foeText, attacks, seed = null }) {
	const body = sufferChoiceCardBody({ pcName: pc.name, foeName, foeText, attacks, seed });
	return whisperGm(stonetopChatCard("Which attack?", body, "stonetop-suffer-choice-card"), {
		flags: { [SCOPE]: { sufferChoice: { pcUuid: pc.uuid, foeName, foeText, attacks, chosen: null, ...(seed ? { seed } : {}) } } },
	});
}

/**
 * Wire the "Which attack?" card. The GM picks; that pick rolls the attack and posts it as an
 * ordinary damage card, which the table then sees and somebody presses.
 *
 * `isPrimaryGM` keeps a second GM's copy of the card from posting the blow twice, the same guard
 * `wireApplyDamage` uses and for the same reason — the `chosen` latch is written before the card,
 * but two clients that click within one round trip both read it empty.
 *
 * WHO PRESSES WHAT FOLLOWS is `electedApplier`'s business, not this card's. The damage card is
 * authored on the GM's client, so the GM is the one who can latch it — which is what the
 * can-write-the-card filter over there exists to notice, rather than electing the player who owns
 * the character and leaving a card with two dead buttons on it.
 */
export function wireSufferChoice(message, html) {
	const root = html?.[0] ?? html;
	const buttons = root.querySelectorAll(".stonetop-suffer-choice");
	if (!buttons.length) return;

	const choice = message.getFlag(SCOPE, "sufferChoice");
	const settle = (label) => buttons.forEach(b => {
		b.disabled = true;
		if (label) b.title = label;
	});
	if (!choice) return settle("This card has lost the attack it was asking about");
	if (isChosen(choice)) {
		settle();
		buttons[choice.chosen]?.classList.add("stonetop-suffer-choice--taken");
		return;
	}
	if (!game.user.isGM) return settle("The GM chooses the enemy's attack");
	if (!isPrimaryGM()) return settle("Another GM will choose this attack");

	// Every button goes dead while one is being answered, and comes back if the pick could not be
	// enacted — the same "a refused action leaves the card clickable" rule the tier Confirms
	// follow (resolveAttackTier), so nothing is lost when a character has gone away.
	const reopen = () => buttons.forEach(b => { b.disabled = false; b.title = ""; });
	buttons.forEach(btn => btn.addEventListener("click", async () => {
		if (btn.disabled) return;
		settle();
		try {
			if (!await resolveSufferChoice(message, Number(btn.dataset.index))) reopen();
		} catch (err) {
			console.error("Stonetop | choosing the enemy's attack failed", err);
			reopen();
		}
	}));
}

/**
 * Enact one pick: roll that attack and post it as a damage card. Returns false when the pick could
 * not be recorded, which leaves the card askable again.
 *
 * LATCHED BEFORE THE CARD IS POSTED, never after. The HP itself is written by the deliberate press
 * on the card this posts, which carries its own `applied` latch — but a second click here within
 * one round trip would post a SECOND card, and a character can be hit twice by pressing two
 * buttons that should never have both existed. So the latch goes down first, and a failure to
 * store it posts nothing at all.
 *
 * Exported for tests: that ordering is the whole guard against one attack landing twice, and it
 * is not reachable through a rendered card.
 */
export async function resolveSufferChoice(message, index) {
	const choice = message.getFlag(SCOPE, "sufferChoice");
	const attack = choice?.attacks?.[index];
	if (!choice || !attack || isChosen(choice)) return false;

	const pc = await actorFromUuid(choice.pcUuid);
	if (!pc) { ui.notifications?.warn("That character is no longer available."); return false; }

	try {
		await message.setFlag(SCOPE, "sufferChoice", { ...choice, chosen: index });
	} catch (err) {
		console.error("Stonetop | could not record the chosen attack; nothing was dealt", err);
		ui.notifications?.warn("That attack could not be recorded, so nothing was dealt.");
		return false;
	}

	// The card offers every printed attack, and one of them may have no die — its row says "no
	// damage die" in the die's place. Picking it asks what it costs rather than rolling `0` and
	// calling the blow struck; the attack rides along, so the answer still lands under its name.
	// Whose blow it was: the attack's own foe on a card holding several foes' attacks, else the card's.
	const foeName = attack.foeName ?? choice.foeName;
	const seed = choice.seed ?? null;
	if (attack.formula) await postIncomingDamage(pc, attack, { foeName, seed });
	else await postSufferAmountCard({ pc, foeName, foeText: choice.foeText, attack, seed });
	return true;
}

// -- "Name the enemy's damage" — the GM's number for a foe with none ----------

/**
 * Ask the GM what a blow with no printed damage die costs.
 *
 * TWO FOES ARRIVE HERE AND THEY ARE NOT THE SAME FOE. The 22 shipped spirits print "none" on
 * their damage line, so there is genuinely nothing to roll and inventing a die for them would be
 * damage the book never gave; and a Clash rolled with nothing targeted has no stat block to read
 * at all. Either way the number is the GM's to name.
 *
 * WHISPERED, like the "Which attack?" card and for the same reason. Naming it used to be a field
 * in the dialog the PLAYER was shown, which handed the player a box they had no honest way to
 * fill: what the thing hits for is the GM's to know.
 *
 * WHAT THEY TYPE IS WHAT THE BLOW DEALS, not what the character ends up losing. It flows through
 * the ordinary damage card from there, so armor comes off it exactly as it comes off every other
 * blow in this file — said out loud under the field, so the number is typed knowing it.
 */
async function postSufferAmountCard({ pc, foeName, foeText, attack = null, seed = null }) {
	// The blow as its damage card will carry it (postIncomingDamage): the other foes' piercing rides it
	// while their +N is on, and Undaunted adds its armor at Apply.
	const incoming = seed ? seedWithoutStriker(seed, attack?.foeUuid ?? "") : null;
	const blow = { ...(attack ?? {}), piercing: Math.max(resolvePiercing(attack?.piercing ?? 0), seedPiercing(incoming)) };
	const armorLine = sufferArmorLine(pc.name, wornArmor(pc), blow, { undaunted: pc.type === "character" && !!undauntedNow(pc) });
	// A named blow arrives here when the stat block printed the attack but no die for it — the
	// raider's net. Saying which one is being priced is the difference between "name a number"
	// and "name a number for THIS", and the tags below it are why the number might not be 0.
	const struckWith = attack?.label ? ` with its <strong>${escHtml(attack.label)}</strong>` : "";
	const body = `<div class="card-content">
		<p><strong>${escHtml(foeName || "The enemy")}</strong> strikes <strong>${escHtml(pc.name)}</strong>${struckWith}.</p>
		${foeText ? `<p class="stonetop-suffer-fiction">${escHtml(foeText)}</p>` : ""}
		<p>No damage die is printed for this attack, so what it costs is yours to name.</p>
		${seed?.label ? `<p class="stonetop-suffer-seed">${escHtml(seed.label)}</p>` : ""}
		<label class="stonetop-suffer-field">Damage the blow deals
			<input type="number" class="stonetop-suffer-amount" value="0" min="0" step="1">
		</label>
		<p class="stonetop-suffer-detail">${escHtml(armorLine)}</p>
		<div class="card-buttons stonetop-card-buttons stonetop-attack-actions">
			<button type="button" class="stonetop-attack-btn stonetop-suffer-deal">
				<i class="fas fa-hand-fist"></i> Deal it
			</button>
		</div>
	</div>`;
	return whisperGm(stonetopChatCard("Name the enemy's damage", body, "stonetop-suffer-amount-card"), {
		flags: { [SCOPE]: { sufferAmount: { pcUuid: pc.uuid, foeName, attack, dealt: null, ...(seed ? { seed } : {}) } } },
	});
}

/**
 * What armor will do to the number the GM names, in the arithmetic Apply uses (mitigateDamage): the blow's
 * piercing and "ignores armor" included, so a blow that goes straight through never promises armor, and
 * Undaunted's +1 armor while it holds.
 *
 * @param {string} name
 * @param {{armor: number, unpierceable: number}} worn  wornArmor
 * @param {{piercing?: number, ignoresArmor?: boolean}|null} attack  with the other foes' piercing merged in
 * @param {object} [options]
 * @param {boolean} [options.undaunted]  fight/hero-moves.js#undauntedNow
 */
export function sufferArmorLine(name, { armor: worn = 0, unpierceable = 0 } = {}, attack = null, { undaunted = false } = {}) {
	const armor = worn + (undaunted ? 1 : 0);
	const brave = undaunted ? ` (${format("stonetop.fight.heroMoves.undaunted.armorNote", {})})` : "";
	if (!armor) return `${name} wears no armor, so all of it lands.`;
	const soaks = Math.max(0, armor - mitigateDamage(armor, { armor, piercing: resolvePiercing(attack?.piercing ?? 0), ignoresArmor: !!attack?.ignoresArmor, unpierceable }));
	if (!soaks) return `It ${attack?.ignoresArmor ? "ignores" : "pierces"} ${name}'s armor, so all of it lands.`;
	return soaks === armor
		? `${name}'s ${armor} armor${brave} comes off it when the damage is taken.`
		: `${soaks} of ${name}'s ${armor} armor${brave} comes off it when the damage is taken; the rest is ${attack?.ignoresArmor ? "ignored" : "pierced"}.`;
}

/**
 * Wire the "Name the enemy's damage" card: the GM types a number and presses once.
 *
 * Gated like the pick above — GMs only, and the primary one of them, because the `dealt` latch is
 * written before the card it posts and two clients clicking within a round trip both read it
 * empty.
 */
export function wireSufferAmount(message, html) {
	const root = html?.[0] ?? html;
	const btn = root.querySelector(".stonetop-suffer-deal");
	if (!btn) return;
	const input = root.querySelector(".stonetop-suffer-amount");

	const settle = (label) => {
		btn.disabled = true;
		if (input) input.disabled = true;
		if (label) btn.title = label;
	};

	const state = message.getFlag(SCOPE, "sufferAmount");
	if (!state) return settle("This card has lost the attack it was asking about");
	// Against null, never falsiness: 0 is a real answer here — a blow that turned out to cost
	// nothing — and `!state.dealt` would leave the card askable again after it was answered.
	if (isDealt(state)) {
		settle();
		btn.innerHTML = `<i class="fas fa-check"></i> Dealt ${state.dealt}`;
		return;
	}
	if (!game.user.isGM) return settle("The GM names this damage");
	if (!isPrimaryGM()) return settle("Another GM will name this damage");

	btn.addEventListener("click", async () => {
		if (btn.disabled) return;
		btn.disabled = true;
		try {
			if (!await dealSufferedAmount(message, input?.value)) btn.disabled = false;
		} catch (err) {
			console.error("Stonetop | naming the enemy's damage failed", err);
			btn.disabled = false;
		}
	});
}

/** Whether this card has already been answered. Against null, for the reason above. */
function isDealt(state) {
	return state?.dealt !== null && state?.dealt !== undefined;
}

/**
 * Enact the GM's number: latch it, then post it as a damage card. Returns false when it could not
 * be recorded, which hands the button back.
 *
 * A FLAT NUMBER IS A FORMULA `Roll` TAKES, which is what keeps this on the one damage path rather
 * than a second one that writes HP directly: the character's armor meets it there, the card shows
 * the arithmetic it used, and the "Take this damage" button latches it like any other blow.
 *
 * Exported for tests, like the pick above, for the same latch-before-the-card ordering.
 */
export async function dealSufferedAmount(message, amount) {
	const state = message.getFlag(SCOPE, "sufferAmount");
	if (!state || isDealt(state)) return false;

	const pc = await actorFromUuid(state.pcUuid);
	if (!pc) { ui.notifications?.warn("That character is no longer available."); return false; }
	const dealt = Math.max(0, Math.round(Number(amount) || 0));

	try {
		await message.setFlag(SCOPE, "sufferAmount", { ...state, dealt });
	} catch (err) {
		console.error("Stonetop | could not record the named damage; nothing was dealt", err);
		ui.notifications?.warn("That damage could not be recorded, so nothing was dealt.");
		return false;
	}

	// ON THE ATTACK THAT WAS PRICED, where there was one. A die-less printed attack still carries
	// everything but its number — the raider's net is thrown, crude and grabby — so the named
	// damage lands under that blow's name, mitigates against its armor clause, and prints its
	// fiction notes. With no attack behind it (a foe printing "none", or nothing targeted at all)
	// the number is all there is, and the blank below is what it rides.
	await postIncomingDamage(pc, {
		label: "", tags: [], piercing: 0, ignoresArmor: false, rollMode: "normal",
		...(state.attack ?? {}),
		// Last, so it beats the priced attack's own empty formula rather than being beaten by it.
		formula: String(dealt),
	}, { foeName: state.foeName, seed: state.seed ?? null });
	return true;
}
