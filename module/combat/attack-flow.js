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
import {weaponMeta, isClashWeapon, isLetFlyWeapon, weaponTraitText, weaponArmorBits, grantedWeaponForMove, MOVE_GRANTED_WEAPONS, UNARMED_META} from "../data/weapons.js";
import {escHtml} from "../utils/strings.js";
import {stonetopChatCard, rollFormulaChip, damageMark, damageBadge, optionKey, whisperGm, cardNoticeHtml, canUserWriteCard} from "../utils/chat.js";
import {rollDamage, multiDieFaces, sign, damageRollFormula, damageConditionPills, conditionsRowHtml, classifyResult} from "../utils/roll-engine.js";
import {mitigateDamage, resolvePiercing, applyDamageToActor, composeDamageFormula, foeAttacks, fictionTagsIn} from "../utils/damage.js";
import {promptDamage} from "../dialogs/RollDialog.js";
import {bringDialogToFront} from "../utils/front-on-open.js";
import {isPrimaryGM, anyActiveGM} from "../utils/primary-gm.js";

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
 * A playbook move is only ITSELF when it came from a playbook: a move a player wrote (moveType
 * "other") that happens to be called Ambush acts as the plain move they wrote, which is the rule
 * grantedWeaponAttackFor already applies to the granted-weapon path. The basic moves need no such
 * guard — nothing but Clash is called Clash, and a world that renames it has bigger plans.
 */
export function attackMoveFor(item) {
	const move = ATTACK_MOVES[item?.name] ?? null;
	if (move?.playbook && item?.system?.moveType === "other") return null;
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
 * player-authored move (moveType "other") that happens to share the name acts as itself, the
 * same rule the guided-move and stat-picker paths apply.
 */
export function grantedWeaponAttackFor(actor, item) {
	if (item?.type !== "move" || item.system?.moveType === "other") return null;
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
function weaponAmmoIndex(actor, weapon) {
	const { max } = ammoTrack(weapon);
	const slug = weapon?.slug;
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

// Mark the next ammo status. The slug is a dot-free inventory slug, so a sub-key write is
// safe and leaves other weapons' resources untouched. Returns the new status.
async function advanceWeaponAmmo(actor, weapon) {
	const track = ammoTrack(weapon);
	const slug = weapon?.slug;
	const next = Math.min(weaponAmmoIndex(actor, weapon) + 1, track.max);
	if ((weapon?.ammoStore ?? "inventory") === "possessions") {
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
// whenever its move is owned, since whether the fiction supports it — wielding a holy
// light against a creature of darkness — is the table's call, not ours.
export async function carriedAttackWeapons(actor, move) {
	const out = [];
	// Every carried thing, whichever store its ◇ lives in — see StonetopCharacter#_gearSources.
	// Reading inventory.checked alone (as this did) meant the Heavy's and Marshal's Weapons of
	// War were never offered for Clash or Let Fly, because a gear choice marks itself carried in
	// possessions.choiceCarried; and arcana / treasure weapons were missed again below, for
	// having no WEAPON_META entry to find.
	const gear = (await actor.typedActor?.carriedWeaponGear?.()) ?? legacyCarriedGear(actor);
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
		const meta = (g.weaponSlug ? weaponMeta(g.weaponSlug) : null)
			?? (g.catalog ? null : weaponMetaFromNote(g.name, g.note, { ammo: !!g.ammo }));
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
		if (!actor.items.some(i => i.type === "move" && i.name === moveName)) continue;
		out.push({ slug: granted.slug, meta: granted.meta, ammoLabel: null, ammoStore: "inventory", grantedBy: moveName, whenStat: granted.whenStat });
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
function serializeWeapon({ slug, meta, ammoStore = "inventory", ammoMax = null, ammoLabels = null }) {
	return {
		slug, ammoStore, ammoMax, ammoLabels,
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
			name: t.actor?.name ?? t.document?.name ?? t.name ?? "Target",
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
		// The bullet's own parenthesis carries the gate the old control used to enforce by hiding
		// itself ("don't pick this if your weapon lacks such statuses"). A quiver with no statuses
		// to mark spends nothing when this is ticked — see depleteAmmoAndPost, where the weapon is
		// asked rather than the card.
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
		.map(box => box.closest(".stonetop-picklist-item")?.textContent ?? "");
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

	const targets = snapshotTargets();
	if (targets.length === 0 && !unrolled) {
		ui.notifications?.info("No foe targeted: you can still target one with T before rolling damage.");
	}

	if (unrolled) {
		// Dealing your damage without rolling means there is no card to adjust it from later, so
		// this is the only moment it can be adjusted — and backing out of the window has to abort
		// the attack rather than deal it unmodified, which is what "cancel" tells the caller.
		const damage = await askDamageAdjustment(actor, { move: item.name, moveKey: move.key, weapon });
		if (!damage) return "cancel";
		await rollAndPostDamage(actor, { move: item.name, weapon, targets, damage });
		return "handled";
	}

	return {
		tierActions: buildTierActions(move),
		messageFlags: attackFlagEnvelope({ move: item.name, moveKey: move.key, attackerUuid: actor.uuid, weapon, targets }),
	};
}

// The flag envelope the roll carries to its ChatMessage, and the one way to read it back before
// that message exists to `getFlag` it off. A pair rather than two hand-written paths: the reader
// is in another function (maybeCounterOnMiss), and a walk spelled out there goes silently empty
// the day the key is renamed here.
const attackFlagEnvelope = attack => ({ [SCOPE]: { attack } });
const attackFlagsOf = extra => extra?.messageFlags?.[SCOPE]?.attack ?? null;

// -- Damage rolling + the results card ----------------------------------------

// The PC's damage die, as the sheet shows it: a die typed into the Damage field wins,
// then the playbook's die raised by any marked move (Potential for Greatness' "increase
// your damage die to a d8"). `system.attributes.damage.value` only records what was
// written when the playbook was dropped or the field edited, so a mark-raised die would
// otherwise keep rolling at its old size. Asked of the actor's OWN StonetopCharacter
// (cached on the document, with its compendium repositories already warm) rather than a
// throwaway one, so a damage roll doesn't re-index the items pack.
async function pcDamageDie(actor) {
	const stored = String(actor?.system?.attributes?.damage?.value ?? "").trim();
	if (actor?.type !== "character") return stored;
	// computedDamageDie, not buildSnapshot: the same answer, without building a whole sheet for one
	// string. This runs per damage ROLL — twice over on the counter-attack and multi-target paths —
	// and the snapshot it used to ask walks moves, inventory, arcana, possessions and post-death
	// lore to get there. `stored` remains the fallback for a character with no playbook resolved.
	return (await actor.typedActor?.computedDamageDie?.()) || stored;
}

// The damage formula for one attack: the PC die (or the weapon's own die), plus the
// weapon's +N damage, plus any extra dice (Clash 10+ strike-hard's +1d6).
async function damageFormula(actor, weapon, extraDice) {
	const die   = weapon?.damageDie || await pcDamageDie(actor) || "d6";
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
 */
async function askDamageAdjustment(actor, { move, moveKey = "", weapon, extraDice = "", shiftKey = false } = {}) {
	const base     = await damageFormula(actor, weapon, extraDice);
	const rollMode = damageAdvantageFrom(actor, moveKey, weapon);
	const adjust   = await promptDamage({ title: damageLabel(move, weapon), formula: base, shiftKey, ...(rollMode ? { rollMode } : {}) });
	return adjust ? { base, ...adjust } : null;
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

function damageAdvantageFrom(actor, moveKey, weapon) {
	const rider = DAMAGE_ADVANTAGE[moveKey];
	if (!rider || !rider.weapon(weapon)) return null;
	const owned = actor?.items?.some?.(i => i.type === "move" && i.name === rider.move && i.system?.moveType !== "other");
	return owned ? "adv" : null;
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
async function rollAndPostDamage(actor, { move, weapon, targets, damage, ignoresArmor = false, selfHarm = false }) {
	// A tier control that ignores armor (Call the Shot's "your call", The Hammer and the Book)
	// records it ON THE WEAPON the card carries rather than as a second field beside it: the
	// weapon is the one thing Apply damage reads for armor (wireApplyDamage) and the one thing the
	// fine print under each target reads to say so, and a flag that only half of that consulted
	// would be a pick that works or doesn't depending on which line you look at.
	weapon = ignoresArmor ? { ...(weapon ?? { name: "", range: [] }), ignoresArmor: true } : weapon;

	// The window's answer, folded in once for every branch below. The single-target branch hands
	// the pieces to rollDamage instead, which composes them itself and paints the pills that say
	// what was added; the branches that build their own Rolls compose here and pass the same
	// pills to the results card, so all three report the adjustment identically.
	const { base, rollMode, bonus, extraDice } = damage;
	const formula   = damageRollFormula(composeDamageFormula(base, { bonus, extraDice }), rollMode);
	const applyable = (targets ?? []).filter(t => t.hasActor !== false && t.uuid);

	// Built once, for whichever branch below ends up posting: the fiction a tag owes is the same
	// fiction whether or not anyone was targeted, and a forceful blow that dealt nothing still owes
	// it. Both cards have the same slot for it (roll-engine.js#_rollCard's `noticesHtml`, and the
	// results card's own body), which is what lets the two paths say it identically.
	const notices = tagNoticesHtml(weapon);

	let results = [];
	if (applyable.length === 0) {
		const roll = await rollDamage(base, actor, { label: damageLabel(move, weapon), rollMode, bonus, extraDice, notices });
		results = [{ raw: roll.total, formula: roll.formula, faces: multiDieFaces(roll) }];
	} else {
		// One damage roll per target — independent, so evaluate them concurrently; they're
		// aggregated into a single results card, and mapping by index preserves order.
		const rolls   = await Promise.all(applyable.map(() => new Roll(formula).evaluate()));
		results = applyable.map((t, i) => ({
			uuid: t.uuid, name: t.name, actorId: t.actorId, disposition: t.disposition,
			raw: rolls[i].total, formula: rolls[i].formula, faces: multiDieFaces(rolls[i]),
		}));
		await postDamageResultsCard(actor, { move, weapon, results, damage, selfHarm, notices });
	}

	// The totals, for a caller that has to say on its own surface what the roll came to: the
	// button on a ticked option turns into the number it dealt (stonetop.js#_chatWireOptionDamage).
	// Every branch above fills this, the single-target one included, so a caller never has to know
	// which of the three it took.
	return results;
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
function damageRowDetail(weapon) {
	if (!weapon) return "";
	// Filtered, because a weaponless attack that still ignores armor (Call the Shot bare-handed)
	// arrives with an empty name, and an unfiltered join would print a leading " · ".
	return [escHtml(weapon.name), ...weaponArmorBits(weapon)].filter(Boolean).join(" · ");
}

function postDamageResultsCard(actor, { move, weapon, results, damage, selfHarm = false, notices = "" }) {
	const multiWarn = results.length > 1 && !weapon?.area
		? `<p class="stonetop-attack-warn"><i class="fas fa-triangle-exclamation"></i> ${escHtml(move)} is a single-foe move: applying to multiple targets is a GM abstraction.</p>`
		: "";

	// Each target gets the shared roll-result block (big total + label + fine print) rather
	// than a one-line "name .......... 7" row, so the damage number reads at the same size
	// as a move roll's total — it's the one thing the table actually needs to see. The red
	// burst and red total say "damage" without re-reading the title. Each total carries its
	// own die-faces tooltip: the targets are rolled independently, so the shared formula
	// chip above can only speak for one of them.
	const detail = damageRowDetail(weapon);
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
	const body = `<div class="card-content">
		${rollFormulaChip(results[0]?.formula ?? "", chipFaces)}
		${multiWarn}
		<ul class="stonetop-damage-list">${rows}</ul>
		${notices}
		<div class="card-buttons stonetop-card-buttons stonetop-attack-actions">
			${hasApplyable ? `<button type="button" class="stonetop-attack-btn stonetop-apply-damage"><i class="fas fa-heart-crack"></i> ${selfHarm ? "Take this damage" : "Apply damage"}</button>` : ""}
		</div>
	</div>${adjustHtml}`;

	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content: stonetopChatCard(`${move}: damage`, body, "stonetop-attack-damage-card", damageBadge()),
		flags: { [SCOPE]: { damage: {
			move, attackerUuid: actor.uuid,
			weapon: weapon ? { name: weapon.name, piercing: weapon.piercing, ignoresArmor: weapon.ignoresArmor } : null,
			// `applied` is an ARRAY, not a uuid-keyed object: a token uuid ("Scene.x.Token.y")
			// used as a flag key would be dot-expanded into nested objects by setFlag, breaking
			// the idempotency lookup so a second click re-subtracts HP.
			results, applied: [], selfHarm,
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

	// No foe targeted before the roll? Honor one targeted afterward (T, then Confirm). This runs
	// on the attacker's client, so game.user.targets is theirs; persist it so the card records
	// what was actually hit.
	const targets = attack.targets?.length ? attack.targets : snapshotTargets();

	// Whatever the move's OWN ticked bullets add, stacked on top of the tier's own
	// unconditional numbers (Clash's 7-9 suffers the enemy's attack whether or not anything is
	// ticked). One list, read where the player ticked it — see pickedOptionLabels and PICK_EFFECTS.
	const fx = pickedEffects(attack.moveKey, pickedOptionLabels(root));

	const extraDice = fx.extraDice.filter(Boolean);
	const counter   = btn.dataset.counter === "1" || fx.counter;
	const deplete   = fx.addons.includes(DEPLETE);
	let ignoresArmor = fx.ignoresArmor;

	// "Do no harm; don't deal your damage after all" — Call the Shot's fourth bullet, and the one
	// pick that CALLS THE ROLL OFF. The button already says "Deal no damage" (wireAttackNoHarm),
	// so the click enacts that: the card latches resolved, and no damage window opens and no dice
	// are thrown (what was ticked is already on the card). Nothing else on the tier can survive it, which
	// is why it is answered before the dice and before the quiver.
	if (fx.addons.includes(NO_HARM)) {
		await lockAttackCard(message, root, { targets });
		return;
	}

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
		{ move: attack.move, moveKey: attack.moveKey, weapon: attack.weapon, extraDice, shiftKey });
	if (!damage) { btn.disabled = false; return; }

	await lockAttackCard(message, root, { yourCall, targets });
	if (deplete) await depleteAmmoAndPost(message, actor, attack);
	await rollAndPostDamage(actor, {
		move: attack.move, weapon: attack.weapon, targets, damage, ignoresArmor,
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

// Mark the chosen weapon's next ammo status (low ammo → all out) and announce it — folded
// into the Let Fly 7-9 Confirm when its "deplete your ammo" bullet is ticked. Drives the SAME
// inventory resource the equipment tab's ○○ boxes show, then refreshes the sheet.
//
// THE WEAPON IS ASKED HERE, not on the card. That bullet used to be hidden outright when the
// chosen weapon had no ammo statuses, which was the card enforcing a clause the move states in
// the bullet's own parenthesis ("don't pick this if your weapon lacks such statuses"). Now that
// the bullet is one of the move's four printed picks it is always shown — a list that hides an
// option cannot be the list the prose counts — and a sword that has no statuses to mark simply
// spends nothing. The pick still stands as the fiction it names: the shot went wide of the quiver.
async function depleteAmmoAndPost(message, pc, attack) {
	const slug = attack?.weapon?.ammo ? attack.weapon.slug : null;
	if (!slug || message.getFlag(SCOPE, "attack")?.ammoDepleted) return;
	const status = await advanceWeaponAmmo(pc, attack.weapon);
	await message.setFlag(SCOPE, "attack", { ...message.getFlag(SCOPE, "attack"), ammoDepleted: true });
	await ChatMessage.create({
		content: stonetopChatCard("Ammunition depleted",
			`<div class="card-content"><p><strong>${escHtml(pc.name)}</strong>'s ${escHtml(attack.weapon.name)} is now <strong>${escHtml(status.label.toLowerCase())}</strong>.${status.allOut ? " It's out of ammunition." : ""}</p></div>`,
			"stonetop-attack-ammo-card"),
		speaker: ChatMessage.getSpeaker({ actor: pc }),
	});
	pc.sheet?.render(false);
}

/**
 * The actor a damage row is aimed at, off the uuid the card froze at roll time.
 *
 * TWO SHAPES, because the two things that produce this card point at different documents. An
 * attack targets TOKENS (an unlinked monster has to hit its own synthetic actor, not the shared
 * prototype it was stamped from), while a move option that burns the person who picked it points
 * at the CHARACTER, who may have no token on the scene anyone is currently looking at. A reader
 * that only unwrapped a token document answered null for the second and left the button on a card
 * it could never enact.
 */
function damageRowActor(doc) {
	return doc?.documentName === "Actor" ? doc : (doc?.actor ?? null);
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

// "Apply damage" on the results card. Writes each target's HP, mitigating by armor/piercing at
// apply time. Idempotent: an `applied` map keyed by token uuid means a second click only fills
// targets not yet done. The GM presses it for damage dealt to foes; a player presses it for an
// option that damages their own character (see ownsEveryTarget). Exactly one of them has a live
// button at a time, which is `electedApplier`'s business and not the latch's.
export function wireApplyDamage(message, html) {
	const root = html?.[0] ?? html;
	const btn = root.querySelector(".stonetop-apply-damage");
	if (!btn) return;

	const damage = message.getFlag(SCOPE, "damage");
	if (!damage) { btn.disabled = true; return; }

	const appliedUuids = new Set((Array.isArray(damage.applied) ? damage.applied : []).map(a => a.uuid));
	const pending = damage.results.filter(r => !appliedUuids.has(r.uuid));

	const owed = pending.length ? pending : damage.results;
	// ONE resolution pass for both questions below. Each row's uuid used to be looked up twice per
	// render, and chat re-renders on every flag write anywhere in the log.
	const owedActors = resolveDamageActors(owed);
	const applier = electedApplier(owedActors, message);

	if (!game.user.isGM) {
		if (!ownsEveryTarget(owedActors)) { btn.style.display = "none"; return; }
		// The latch that stops the same damage being taken twice lives on the MESSAGE, and a player
		// does not own a card the GM authored. Say so rather than letting the click write HP and
		// then fail to record that it did (the same affordance the Suffer button wears).
		if (!message.isOwner) {
			btn.disabled = true;
			btn.title = "Ask the GM to apply this damage";
			return;
		}
		// A co-owned character: both players own every row, and both buttons would subtract.
		if (applier && applier !== game.user.id) {
			btn.disabled = true;
			btn.title = "Another player will take this damage";
			return;
		}
	} else if (!isPrimaryGM()) {
		// With several GMs connected, only the primary GM's click enacts, so two GMs can't
		// both subtract HP before the applied-flag propagates.
		btn.disabled = true;
		btn.title = "Another GM will apply this damage";
		return;
	} else if (applier) {
		// A card aimed at somebody's own character, with that somebody at the table: theirs to
		// press, and the GM's copy has to stand down or both clicks land (see electedApplier).
		btn.disabled = true;
		btn.title = `${game.users?.get?.(applier)?.name ?? "The owning player"} will take this damage`;
		return;
	}

	if (pending.length === 0) {
		btn.disabled = true;
		btn.innerHTML = `<i class="fas fa-check"></i> ${damage.selfHarm ? "Damage taken" : "Damage applied"}`;
		return;
	}

	btn.addEventListener("click", async () => {
		const current = message.getFlag(SCOPE, "damage") ?? damage;
		const nextApplied = Array.isArray(current.applied) ? [...current.applied] : [];
		const doneUuids = new Set(nextApplied.map(a => a.uuid));
		const piercing = resolvePiercing(current.weapon?.piercing);
		const lines = [];
		for (const r of current.results) {
			if (doneUuids.has(r.uuid)) continue;
			const td = await fromUuid(r.uuid);
			const targetActor = damageRowActor(td);
			if (!targetActor) { lines.push(`<li><strong>${escHtml(r.name)}</strong>: no longer on the map</li>`); continue; }
			const armor = Number(targetActor.system?.attributes?.armor?.value) || 0;
			const unpierceable = Number(targetActor.system?.attributes?.armor?.unpierceable) || 0;
			const effective = mitigateDamage(r.raw, { armor, piercing, unpierceable, ignoresArmor: current.weapon?.ignoresArmor });
			const t = await applyDamageToActor(targetActor, effective);
			// A target actor with no hp attribute (e.g. a steading token) yields null. Skip it
			// without recording it as applied, so it can be retried if the actor is fixed —
			// rather than rendering "undefined → undefined HP" and marking it done forever.
			if (!t) { lines.push(`<li><strong>${escHtml(r.name)}</strong>: has no HP to damage</li>`); continue; }
			nextApplied.push({ uuid: r.uuid, effective, oldHp: t.oldHp, newHp: t.newHp });
			const dead = t.newHp === 0 ? " <em>(0 HP)</em>" : "";
			// Through `mitigationDetail`, the one place the subtraction is put into words: this
			// used to restate `armor - piercing` inline, which stopped matching the moment
			// mitigateDamage learned about an unpierceable floor, and printed armor the
			// arithmetic had not applied.
			const detail = mitigationDetail({ armor, piercing, unpierceable, ignoresArmor: current.weapon?.ignoresArmor });
			const mit = effective !== r.raw ? ` <span class="stonetop-damage-mitigated">(${r.raw}${detail})</span>` : "";
			lines.push(`<li><strong>${escHtml(r.name)}</strong>: ${effective} damage${mit}: ${t.oldHp} &rarr; ${t.newHp} HP${dead}</li>`);
		}
		await message.setFlag(SCOPE, "damage", { ...current, applied: nextApplied });
		await ChatMessage.create({
			content: stonetopChatCard(`${current.move}: damage applied`, `<div class="card-content"><ul class="stonetop-homestead-chat-list">${lines.join("")}</ul></div>`, "stonetop-attack-applied-card"),
			speaker: { alias: "Stonetop" },
		});
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
	const target = targets?.[0] ?? null;
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
	const attacks = foeAttacks(foe);

	if (attacks.length > 1) {
		return askTheGm(postSufferChoiceCard({ pc, foeName, foeText, attacks }), { foeName, waitingFor: "which attack it made" });
	}
	// `formula`, not the count: a printed attack can be an attack and still have no die (see above).
	const only = attacks[0] ?? null;
	if (only?.formula) return postIncomingDamage(pc, only, { foeName });
	return askTheGm(postSufferAmountCard({ pc, foeName, foeText, attack: only }), { foeName, waitingFor: "what it costs" });
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
async function postIncomingDamage(pc, attack, { foeName = "" } = {}) {
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
		damage: {
			base: attack?.formula || "0",
			rollMode: attack?.rollMode ?? "normal",
			bonus: 0,
			extraDice: "",
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
export function sufferChoiceCardBody({ pcName, foeName, foeText, attacks }) {
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
		return `<li><button type="button" class="stonetop-attack-btn stonetop-suffer-choice" data-index="${index}">
			<span class="stonetop-suffer-choice-name">${escHtml(attack.label || "Attack")}</span>
			<span class="stonetop-suffer-choice-meta">
				${notes ? `<span class="stonetop-suffer-choice-note">${escHtml(notes)}</span>` : ""}
				<span class="stonetop-suffer-choice-die">${escHtml(attack.formula || "no damage die")}</span>
			</span>
		</button></li>`;
	}).join("");

	return `<div class="card-content">
		<p><strong>${escHtml(foeName || "The enemy")}</strong> strikes <strong>${escHtml(pcName)}</strong>.</p>
		${foeText ? `<p class="stonetop-suffer-fiction">${escHtml(foeText)}</p>` : ""}
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
async function postSufferChoiceCard({ pc, foeName, foeText, attacks }) {
	const body = sufferChoiceCardBody({ pcName: pc.name, foeName, foeText, attacks });
	return whisperGm(stonetopChatCard("Which attack?", body, "stonetop-suffer-choice-card"), {
		flags: { [SCOPE]: { sufferChoice: { pcUuid: pc.uuid, foeName, foeText, attacks, chosen: null } } },
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
	if (attack.formula) await postIncomingDamage(pc, attack, { foeName: choice.foeName });
	else await postSufferAmountCard({ pc, foeName: choice.foeName, foeText: choice.foeText, attack });
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
async function postSufferAmountCard({ pc, foeName, foeText, attack = null }) {
	const armor = Number(pc.system?.attributes?.armor?.value) || 0;
	// A named blow arrives here when the stat block printed the attack but no die for it — the
	// raider's net. Saying which one is being priced is the difference between "name a number"
	// and "name a number for THIS", and the tags below it are why the number might not be 0.
	const struckWith = attack?.label ? ` with its <strong>${escHtml(attack.label)}</strong>` : "";
	const body = `<div class="card-content">
		<p><strong>${escHtml(foeName || "The enemy")}</strong> strikes <strong>${escHtml(pc.name)}</strong>${struckWith}.</p>
		${foeText ? `<p class="stonetop-suffer-fiction">${escHtml(foeText)}</p>` : ""}
		<p>No damage die is printed for this attack, so what it costs is yours to name.</p>
		<label class="stonetop-suffer-field">Damage the blow deals
			<input type="number" class="stonetop-suffer-amount" value="0" min="0" step="1">
		</label>
		<p class="stonetop-suffer-detail">${armor
			? `${escHtml(pc.name)}'s ${armor} armor comes off it when the damage is taken.`
			: `${escHtml(pc.name)} wears no armor, so all of it lands.`}</p>
		<div class="card-buttons stonetop-card-buttons stonetop-attack-actions">
			<button type="button" class="stonetop-attack-btn stonetop-suffer-deal">
				<i class="fas fa-hand-fist"></i> Deal it
			</button>
		</div>
	</div>`;
	return whisperGm(stonetopChatCard("Name the enemy's damage", body, "stonetop-suffer-amount-card"), {
		flags: { [SCOPE]: { sufferAmount: { pcUuid: pc.uuid, foeName, attack, dealt: null } } },
	});
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
	}, { foeName: state.foeName });
	return true;
}
