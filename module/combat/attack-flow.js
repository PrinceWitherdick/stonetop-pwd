// Interactive attack flow for every move that deals a character's damage: the Clash (+STR) and
// Let Fly (+DEX) basic moves, and the playbook moves whose hit tiers say the same thing —
// Ambush, Call the Shot, The Hammer and the Book.
//
// The player targets one or more foes with Foundry's target key (T), clicks the move,
// picks a weapon (when they carry more than one that fits the move), and rolls. On a
// hit the roll card grows a "Roll damage" action that rolls the PC's damage die once
// per target; a follow-up card lists each target's damage with a GM-only "Apply damage"
// button. Clash additionally resolves "suffer your enemy's attack" — incoming damage to
// the PC — via a player-side button.
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
//    system has no socket relay); "suffer your enemy's attack" writes the PC's own HP and
//    stays a player action.

import {STONETOP_SCOPE} from "../actors/character/StonetopFlags.js";
import {weaponMeta, isClashWeapon, isLetFlyWeapon, weaponTraitText, weaponArmorBits, grantedWeaponForMove, MOVE_GRANTED_WEAPONS, UNARMED_META} from "../data/weapons.js";
import {escHtml} from "../utils/strings.js";
import {stonetopChatCard, rollFormulaChip, damageMark, damageBadge, optionKey} from "../utils/chat.js";
import {rollDamage, multiDieFaces, sign, damageRollFormula, damageConditionPills, conditionsRowHtml} from "../utils/roll-engine.js";
import {mitigateDamage, resolvePiercing, applyDamageToActor, dieFromDamage, composeDamageFormula} from "../utils/damage.js";
import {promptDamage} from "../dialogs/RollDialog.js";
import {bringDialogToFront} from "../utils/front-on-open.js";
import {isPrimaryGM} from "../utils/primary-gm.js";

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
 */
const ATTACK_MOVES = {
	"Clash":   { key: "clash",   filter: isClashWeapon },
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
// Ammo weapons (crossbow, composite bow) carry a max-2 resource track on their
// inventory item — the ○○ "low ammo" / "all out" boxes on the equipment tab, stored
// in flags.stonetop-pwd.inventory.resources[slug]. Let Fly's 7-9 "deplete your ammo"
// pick marks the next box; 0 = plenty, 1 = low ammo, 2 = all out. We drive that SAME
// resource so the sheet tracker and the chat button stay in lockstep.
const AMMO_MAX = 2;
const AMMO_LABELS = ["Plenty", "Low ammo", "All out"];

function weaponAmmoIndex(actor, slug) {
	const resources = actor.getFlag(SCOPE, "inventory.resources") ?? {};
	return Math.min(Math.max(0, Number(resources[slug]) || 0), AMMO_MAX);
}

function weaponAmmoLabel(actor, slug) {
	return AMMO_LABELS[weaponAmmoIndex(actor, slug)];
}

// Mark the next ammo status. `slug` is a dot-free inventory slug, so a sub-key write is
// safe and leaves other weapons' resources untouched. Returns the new status.
async function advanceWeaponAmmo(actor, slug) {
	const next = Math.min(weaponAmmoIndex(actor, slug) + 1, AMMO_MAX);
	await actor.update({ [`flags.${SCOPE}.inventory.resources.${slug}`]: next });
	return { index: next, label: AMMO_LABELS[next], allOut: next >= AMMO_MAX };
}

// -- Weapon enumeration -------------------------------------------------------

// The carried weapons (checked inventory slugs present in WEAPON_META) that fit `move`,
// plus any weapon an owned move grants (the Lightbearer's holy light). A granted weapon
// isn't inventory, so it's appended rather than read off the checked flags; it's offered
// whenever its move is owned, since whether the fiction supports it — wielding a holy
// light against a creature of darkness — is the table's call, not ours.
function carriedAttackWeapons(actor, move) {
	const checked = actor.getFlag(SCOPE, "inventory.checked") ?? {};
	const out = [];
	for (const [slug, on] of Object.entries(checked)) {
		if (!on) continue;
		const meta = weaponMeta(slug);
		if (meta && move.filter(meta)) out.push({ slug, meta, ammoLabel: meta.ammo ? weaponAmmoLabel(actor, slug) : null });
	}
	for (const moveName of Object.keys(MOVE_GRANTED_WEAPONS)) {
		// Through the accessor, so the weapon carries the stat the move actually grants for
		// the roll rather than a second recording of it.
		const granted = grantedWeaponForMove(moveName);
		if (!move.filter(granted.meta)) continue;
		if (!actor.items.some(i => i.type === "move" && i.name === moveName)) continue;
		out.push({ slug: granted.slug, meta: granted.meta, ammoLabel: null, grantedBy: moveName, whenStat: granted.whenStat });
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
	return [{ slug: "", meta: UNARMED_META, ammoLabel: null, unarmed: true }, ...candidates];
}

// The flattened, storable weapon record baked into the chat card (no functions).
function serializeWeapon({ slug, meta }) {
	return {
		slug, name: meta.name, range: meta.range, damageBonus: meta.damageBonus,
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
// thing to it — a single Confirm button whose data-action ("roll" | "suffer") tells the click
// handler what to enact.
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

// The single button that enacts the tier. `action` is "roll" (roll the PC die per target, folding
// in whatever the ticked bullets add) or "suffer" (self-write the PC's HP from the foe's
// counter-attack). `counter`/`extraDice` are the tier's OWN values — what the tier says whatever
// the player picks, like Clash's 7-9 suffering the attack — and the ticked bullets stack on top.
function confirmBtn(action, { counter = false, extraDice = "", label = "Confirm", icon = "fa-check" } = {}) {
	return `<button type="button" class="stonetop-attack-btn stonetop-attack-confirm" data-action="${escHtml(action)}"
		data-counter="${counter ? 1 : 0}"${extraDice ? ` data-extra-dice="${escHtml(extraDice)}"` : ""}>
		<i class="fas ${escHtml(icon)}"></i> ${escHtml(label)}
	</button>`;
}

// What a Confirm that only rolls damage says. Named because five of the six tiers below use it.
const ROLL_DAMAGE = { label: "Roll your damage", icon: "fa-dice-d6" };

// ...and what it says instead while Call the Shot's "do no harm" is held. Same button, same
// place — a tier that has been told to deal no damage must not offer to roll it.
const NO_DAMAGE = { label: "Deal no damage", icon: "fa-ban" };

// The "Suffer your enemy's attack" button on the damage results card (a Clash counter).
function sufferBtn(label = "Suffer your enemy's attack") {
	return `<button type="button" class="stonetop-attack-btn stonetop-attack-suffer">
		<i class="fas fa-shield-halved"></i> ${escHtml(label)}
	</button>`;
}

/**
 * One button per result tier on the roll card. Only the rolled tier's shows, so each names the
 * action it enacts — a bare "Confirm" is unclear on a card whose options are up in the move's own
 * text. Every hit tier here deals the character's damage, so five of the six say so.
 *
 * NO OPTIONS LIVE HERE. They are the move's printed bullets, ticked where they are printed; what
 * they do when ticked is PICK_EFFECTS above. The only numbers a button carries are the tier's own
 * unconditional ones: Clash's 7-9 suffers the enemy's attack whatever else happens, and its 6-
 * does nothing but that.
 */
export function buildTierActions(move) {
	if (move.key === "clash") {
		return {
			// The 10+'s "pick 1" is the description's two boxes; strike-hard's 1d6 and its
			// counter-attack ride the tick (PICK_EFFECTS), so the button itself promises neither.
			success: confirmBtn("roll", ROLL_DAMAGE),
			partial: confirmBtn("roll", { counter: true, ...ROLL_DAMAGE }),
			failure: confirmBtn("suffer", { label: "Suffer your enemy's attack", icon: "fa-shield-halved" }),
		};
	}

	// Ambush, Call the Shot and The Hammer and the Book deal your damage on both hit tiers and
	// differ only in how many of the printed list you take, which the list itself counts. Their
	// 6- is "the GM makes a move" — nothing for the player to enact, so no button at all.
	//
	// Let Fly falls through to the same pair: its 10+ has no list, and its 7-9's four bullets are
	// the description's, one of which spends the quiver.
	const tier = confirmBtn("roll", ROLL_DAMAGE);
	return { success: tier, partial: tier };
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
	const candidates = carriedAttackWeapons(actor, move);
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
		await rollAndPostDamage(actor, { move: item.name, weapon, targets, counter: false, damage });
		return "handled";
	}

	return {
		tierActions: buildTierActions(move),
		messageFlags: { [SCOPE]: { attack: { move: item.name, moveKey: move.key, attackerUuid: actor.uuid, weapon, targets } } },
	};
}

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

// Flavour tags whose fiction the table should be reminded of at damage time — a weapon's
// `+N damage` / piercing already ride the numbers, but `messy` and `forceful` only live in
// the fiction and are easy to forget. Each posts its own follow-up card after the damage,
// keyed by the tag in module/data/weapons.js. `body(name)` receives the ALREADY-escaped
// weapon name.
const TAG_REMINDERS = {
	messy: {
		title: "Messy attack",
		icon: "fa-burst",
		body: name => `<strong>${name} is messy.</strong> This attack is especially destructive, ripping
			people and things apart. It should often use up resources, destroying a shield, weapon, or
			gear, or inflict a
			<span class="stonetop-problematic-wound" data-tooltip="${escHtml(PROBLEMATIC_WOUND_TIP)}">problematic wound</span>.`,
	},
	forceful: {
		title: "Forceful attack",
		icon: "fa-hand-fist",
		body: name => `<strong>${name} is forceful.</strong> It can knock someone around, maybe even off
			their feet. Even if it does no damage, it should still shift the momentum or positioning of the
			fight: driving them back, breaking their stance, or setting up an ally.`,
	},
};

// Post a reminder card for each of the weapon's flavour tags we track. Called after the
// damage roll so the cards sit beneath it; a forceful attack that dealt no damage still
// gets its reminder.
function postTagReminders(actor, weapon) {
	const name = weapon?.name ? escHtml(weapon.name) : "This weapon";
	const posts = (weapon?.tags ?? []).map(tag => {
		const r = TAG_REMINDERS[tag];
		if (!r) return null;
		const body = `<div class="card-content"><p class="stonetop-attack-tag-note stonetop-attack-${tag}">
			<i class="fas ${r.icon}"></i> <span>${r.body(name)}</span>
		</p></div>`;
		return ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			content: stonetopChatCard(r.title, body, `stonetop-attack-tag-card stonetop-attack-${tag}-card`),
		});
	}).filter(Boolean);
	return Promise.all(posts);
}

// Roll damage once per applyable target and post the results card. With no applyable
// targets, fall back to a single plain damage roll (no Apply button). Tagged weapons
// (messy / forceful) add follow-up reminder cards either way.
async function rollAndPostDamage(actor, { move, weapon, targets, counter = false, damage, ignoresArmor = false }) {
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

	if (applyable.length === 0) {
		if (!counter) {
			await rollDamage(base, actor, { label: damageLabel(move, weapon), rollMode, bonus, extraDice });
		} else {
			// No foe targeted, but the tier (Clash 7-9 / strike-hard) still demands the PC
			// suffer the counter-attack. Roll the damage for the fiction and post a results
			// card that carries the Suffer button; with no target its foe die falls back to a
			// manual incoming-damage prompt. Without this branch the counter is silently lost.
			const roll = await new Roll(formula).evaluate();
			const results = [{ raw: roll.total, formula: roll.formula, faces: multiDieFaces(roll) }];
			await postDamageResultsCard(actor, { move, weapon, results, counter, damage });
		}
	} else {
		// One damage roll per target — independent, so evaluate them concurrently; they're
		// aggregated into a single results card, and mapping by index preserves order.
		const rolls   = await Promise.all(applyable.map(() => new Roll(formula).evaluate()));
		const results = applyable.map((t, i) => ({
			uuid: t.uuid, name: t.name, actorId: t.actorId, disposition: t.disposition,
			raw: rolls[i].total, formula: rolls[i].formula, faces: multiDieFaces(rolls[i]),
		}));
		await postDamageResultsCard(actor, { move, weapon, results, counter, damage });
	}

	await postTagReminders(actor, weapon);
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

function postDamageResultsCard(actor, { move, weapon, results, counter, damage }) {
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

	const body = `<div class="card-content">
		${rollFormulaChip(results[0]?.formula ?? "", chipFaces)}
		${multiWarn}
		<ul class="stonetop-damage-list">${rows}</ul>
		<div class="card-buttons stonetop-card-buttons stonetop-attack-actions">
			${hasApplyable ? `<button type="button" class="stonetop-attack-btn stonetop-apply-damage"><i class="fas fa-heart-crack"></i> Apply damage</button>` : ""}
			${counter ? sufferBtn() : ""}
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
			results, applied: [],
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
	const btns = Array.from(root.querySelectorAll('.stonetop-attack-confirm[data-action="roll"]'));
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
// enact the tier: "roll" rolls the PC die per target (folding in whatever the move's ticked
// bullets add and an optional ammo depletion), "suffer" self-writes the PC's HP from the foe's
// counter-attack. Once-only per card via the attack.resolved flag; non-owners see it disabled.
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
	// message ownership as well as the attacker's — see wireSufferAttack.
	actorFromUuid(attack.attackerUuid).then(actor => {
		for (const btn of btns) {
			if (!actor?.isOwner || message.getFlag(SCOPE, "attack")?.resolved) { btn.disabled = true; continue; }
			// Owning the attacker is not enough, and the two refusals are not the same refusal.
			// A player who owns the PC but not the GM-authored CARD gets a button that can never
			// work, so it says why — a silently greyed-out Confirm reads as a broken card. Same
			// affordance, same wording shape as wireSufferAttack.
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
// cancelled "suffer" or damage prompt leaves the card clickable again. `shiftKey` is the
// Confirm click's own modifier, which skips the damage window for this one roll.
async function resolveAttackTier(message, actor, btn, root, shiftKey = false) {
	if (btn.disabled || message.getFlag(SCOPE, "attack")?.resolved) return;
	btn.disabled = true;
	const attack = message.getFlag(SCOPE, "attack");

	// No foe targeted before the roll? Honor one targeted afterward (T, then Confirm). This runs
	// on the attacker's client, so game.user.targets is theirs; persist it so the card records
	// what was actually hit.
	const targets = attack.targets?.length ? attack.targets : snapshotTargets();

	if (btn.dataset.action === "suffer") {
		const ok = await executeSuffer(message, actor, { targets }, "attack");
		if (ok) await lockAttackCard(message, root, { targets });
		else btn.disabled = false;
		return;
	}

	// "roll": whatever the move's OWN ticked bullets add, stacked on top of the tier's own
	// unconditional numbers (Clash's 7-9 suffers the enemy's attack whether or not anything is
	// ticked). One list, read where the player ticked it — see pickedOptionLabels and PICK_EFFECTS.
	const fx = pickedEffects(attack.moveKey, pickedOptionLabels(root));

	const extraDice = [btn.dataset.extraDice ?? "", ...fx.extraDice].filter(Boolean);
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
		move: attack.move, weapon: attack.weapon, targets, counter, damage, ignoresArmor,
	});
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
	const status = await advanceWeaponAmmo(pc, slug);
	await message.setFlag(SCOPE, "attack", { ...message.getFlag(SCOPE, "attack"), ammoDepleted: true });
	await ChatMessage.create({
		content: stonetopChatCard("Ammunition depleted",
			`<div class="card-content"><p><strong>${escHtml(pc.name)}</strong>'s ${escHtml(attack.weapon.name)} is now <strong>${escHtml(status.label.toLowerCase())}</strong>.${status.allOut ? " It's out of ammunition." : ""}</p></div>`,
			"stonetop-attack-ammo-card"),
		speaker: ChatMessage.getSpeaker({ actor: pc }),
	});
	pc.sheet?.render(false);
}

// "Apply damage" on the results card — GM-only. Writes each target's HP, mitigating by
// armor/piercing at apply time. Idempotent: an `applied` map keyed by token uuid means a
// second click (or a second GM) only fills targets not yet done.
export function wireApplyDamage(message, html) {
	const root = html?.[0] ?? html;
	const btn = root.querySelector(".stonetop-apply-damage");
	if (!btn) return;

	if (!game.user.isGM) { btn.style.display = "none"; return; }
	// With several GMs connected, only the primary GM's click enacts, so two GMs can't
	// both subtract HP before the applied-flag propagates.
	if (!isPrimaryGM()) {
		btn.disabled = true;
		btn.title = "Another GM will apply this damage";
		return;
	}

	const damage = message.getFlag(SCOPE, "damage");
	if (!damage) { btn.disabled = true; return; }

	const appliedUuids = new Set((Array.isArray(damage.applied) ? damage.applied : []).map(a => a.uuid));
	const pending = damage.results.filter(r => !appliedUuids.has(r.uuid));
	if (pending.length === 0) {
		btn.disabled = true;
		btn.innerHTML = '<i class="fas fa-check"></i> Damage applied';
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
			const targetActor = td?.actor ?? null;
			if (!targetActor) { lines.push(`<li><strong>${escHtml(r.name)}</strong>: no longer on the map</li>`); continue; }
			const armor = Number(targetActor.system?.attributes?.armor?.value) || 0;
			const effective = mitigateDamage(r.raw, { armor, piercing, ignoresArmor: current.weapon?.ignoresArmor });
			const t = await applyDamageToActor(targetActor, effective);
			// A target actor with no hp attribute (e.g. a steading token) yields null. Skip it
			// without recording it as applied, so it can be retried if the actor is fixed —
			// rather than rendering "undefined → undefined HP" and marking it done forever.
			if (!t) { lines.push(`<li><strong>${escHtml(r.name)}</strong>: has no HP to damage</li>`); continue; }
			nextApplied.push({ uuid: r.uuid, effective, oldHp: t.oldHp, newHp: t.newHp });
			const dead = t.newHp === 0 ? " <em>(0 HP)</em>" : "";
			const mit = effective !== r.raw ? ` <span class="stonetop-damage-mitigated">(${r.raw}${armor ? ` − ${Math.max(0, armor - piercing)} armor` : ""})</span>` : "";
			lines.push(`<li><strong>${escHtml(r.name)}</strong>: ${effective} damage${mit}: ${t.oldHp} &rarr; ${t.newHp} HP${dead}</li>`);
		}
		await message.setFlag(SCOPE, "damage", { ...current, applied: nextApplied });
		await ChatMessage.create({
			content: stonetopChatCard(`${current.move}: damage applied`, `<div class="card-content"><ul class="stonetop-homestead-chat-list">${lines.join("")}</ul></div>`, "stonetop-attack-applied-card"),
			speaker: { alias: "Stonetop" },
		});
	});
}

// "Suffer your enemy's attack" — a player-side self-write of the PC's HP. Present on the
// damage results card as a Clash counter (10+ strike-hard, 7-9); the 6- miss suffers via the
// roll card's failure Confirm instead. Both paths run executeSuffer.
export function wireSufferAttack(message, html) {
	const root = html?.[0] ?? html;
	const btn = root.querySelector(".stonetop-attack-suffer");
	if (!btn) return;

	const damage = message.getFlag(SCOPE, "damage");
	const attack = message.getFlag(SCOPE, "attack");
	const flagKey = damage ? "damage" : attack ? "attack" : null;
	const ctx = damage
		? { attackerUuid: damage.attackerUuid, targets: damage.results }
		: attack
			? { attackerUuid: attack.attackerUuid, targets: attack.targets }
			: null;
	if (!ctx) { btn.disabled = true; return; }

	actorFromUuid(ctx.attackerUuid).then(pc => {
		if (!pc?.isOwner) { btn.disabled = true; return; }
		// Owning the PC is not enough: suffering writes a `suffered` latch onto this MESSAGE, and
		// a player can't update a card the GM authored. Say so rather than letting the click fail
		// half-way. Mirrors the multi-GM affordance in wireApplyDamage.
		if (!message.isOwner) {
			btn.disabled = true;
			btn.title = "Ask the GM to apply this attack's damage";
			return;
		}
		if (message.getFlag(SCOPE, flagKey)?.suffered) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-check"></i> Suffered the attack'; return; }
		btn.addEventListener("click", async () => {
			if (btn.disabled) return;
			btn.disabled = true;
			// A throw here used to escape the handler, so the button stayed disabled with no
			// explanation and the rejection went unhandled. Re-enable on failure like a
			// cancelled prompt does — executeSuffer latches before it writes HP, so a retry
			// can't double-apply.
			try {
				const ok = await executeSuffer(message, pc, ctx, flagKey);
				if (ok) btn.innerHTML = '<i class="fas fa-check"></i> Suffered the attack';
				else btn.disabled = false;
			} catch (err) {
				console.error("Stonetop | suffering the attack failed", err);
				btn.disabled = false;
			}
		});
	}).catch(err => console.error("Stonetop | could not wire the Suffer button", err));
}

// Roll the foe's counter-attack, confirm the number, and self-write the PC's HP. The incoming
// number is the clashed foe's stat-block damage die minus the PC's armor, shown in a confirm
// dialog so the table can adjust for the fiction. Once-only via `flagKey`'s `suffered` marker
// ("attack" on the roll card, "damage" on the results card). Returns true when applied, false
// if already suffered or the player cancelled the prompt.
// Exported for tests: the latch-before-damage ordering below is the whole guard against a
// player taking the same attack twice, and it is not reachable through the wired button
// without standing up a chat card and a Dialog.
export async function executeSuffer(message, pc, ctx, flagKey) {
	if (message.getFlag(SCOPE, flagKey)?.suffered) return false;
	const foe = ctx.targets?.[0] ? await fromUuid(ctx.targets[0].uuid).then(td => td?.actor).catch(() => null) : null;
	// The rollable die is `damage.rollFormula`; `damage.value` is PROSE ("rusty sword d8+2
	// (forceful) or crushing grip d8+2 …") — feeding it to Roll crashes on its commas/words. Use
	// rollFormula, else pull the first dice expression out of the prose, else leave it manual.
	const dmg = foe?.system?.attributes?.damage ?? {};
	const foeText = String(dmg.value || "").trim();
	let foeDie = String(dmg.rollFormula || "").trim()
		|| (dieFromDamage(foeText) || "").replace(/\s+/g, "");
	let rolled = 0;
	if (foeDie) {
		try { rolled = (await new Roll(foeDie).evaluate()).total; }
		catch (err) { console.warn(`Stonetop | Foe damage die "${foeDie}" is not rollable:`, err); foeDie = ""; }
	}
	const armor = Number(pc.system?.attributes?.armor?.value) || 0;
	const suggested = Math.max(0, rolled - armor);

	const amount = await promptIncomingDamage({ pcName: pc.name, foeName: ctx.targets?.[0]?.name, foeDie, foeText, rolled, armor, suggested });
	if (amount === null) return false;

	// Latch BEFORE the HP write, never after.
	//
	// The button is gated on the PC's ownership, but this flag lives on the chat MESSAGE — which
	// a player does NOT own when the GM rolled the attack for them. Applying damage first meant
	// the HP write landed, the latch then threw on permission, and the card came back on the next
	// render still unlatched, so the same attack could be suffered a second time. Writing the
	// latch first makes the failure mode safe: nothing is deducted unless the "already suffered"
	// marker actually stored.
	try {
		await message.setFlag(SCOPE, flagKey, { ...message.getFlag(SCOPE, flagKey), suffered: true });
	} catch (err) {
		console.error("Stonetop | could not mark the attack suffered; damage NOT applied", err);
		ui.notifications?.warn(
			"You can't update this attack card, so the damage was not applied. Ask the GM to apply it.");
		return false;
	}

	const t = await applyDamageToActor(pc, amount);
	await ChatMessage.create({
		content: stonetopChatCard("Suffered the enemy's attack", `<div class="card-content"><p><strong>${escHtml(pc.name)}</strong> takes <strong>${amount}</strong> damage: ${t?.oldHp} &rarr; ${t?.newHp} HP.</p></div>`, "stonetop-attack-suffer-card"),
		speaker: ChatMessage.getSpeaker({ actor: pc }),
	});
	return true;
}

// Confirm the incoming-damage number for "suffer your enemy's attack". Returns the number
// to apply, or null on cancel.
function promptIncomingDamage({ pcName, foeName, foeDie, foeText, rolled, armor, suggested }) {
	return new Promise(resolve => {
		new Dialog({
			title: "Suffer your enemy's attack",
			content: `<form class="stonetop-suffer-attack">
				<p><strong>${escHtml(foeName || "The enemy")}</strong> attacks <strong>${escHtml(pcName)}</strong>.</p>
				${foeText ? `<p class="stonetop-suffer-fiction">${escHtml(foeText)}</p>` : ""}
				<p class="stonetop-suffer-detail">${foeDie ? `Rolled ${rolled} (${escHtml(foeDie)})` : "No stat-block damage found: enter the damage"}${armor ? ` − ${armor} armor` : ""}.</p>
				<label class="stonetop-suffer-field">Damage to take
					<input type="number" name="amount" value="${suggested}" min="0" step="1">
				</label>
			</form>`,
			buttons: {
				apply: {
					label: "Take the damage",
					callback: htmlEl => {
						const root = htmlEl?.[0] ?? htmlEl;
						resolve(Math.max(0, Math.round(Number(root.querySelector('input[name="amount"]')?.value) || 0)));
					},
				},
				cancel: { label: "Cancel", callback: () => resolve(null) },
			},
			default: "apply",
			close: () => resolve(null),
			render: bringDialogToFront,
		}, { classes: ["dialog", "stonetop", "stonetop-suffer-attack-dialog"] }).render(true);
	});
}
