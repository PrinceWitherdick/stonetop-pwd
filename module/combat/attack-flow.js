// Interactive attack flow for the Clash (+STR) and Let Fly (+DEX) basic moves.
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
import {stonetopChatCard, rollFormulaChip, damageMark, damageBadge} from "../utils/chat.js";
import {rollDamage, multiDieFaces, sign} from "../utils/roll-engine.js";
import {mitigateDamage, resolvePiercing, applyDamageToActor, dieFromDamage} from "../utils/damage.js";
import {bringDialogToFront} from "../utils/front-on-open.js";
import {isPrimaryGM} from "../utils/primary-gm.js";

const SCOPE = STONETOP_SCOPE;

// The two attacking basic moves, keyed by their move-item name. `filter` decides which
// carried weapons are offered for the weapon pick; `letFly` marks the ranged move that
// gets the no-roll "easy shot" path.
const ATTACK_MOVES = {
	"Clash":   { key: "clash",   filter: isClashWeapon,  letFly: false },
	"Let Fly": { key: "let-fly", filter: isLetFlyWeapon, letFly: true  },
};

/** The attack-move config for a rolled move item, or null for any other move. */
export function attackMoveFor(item) {
	return ATTACK_MOVES[item?.name] ?? null;
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

// Let Fly's default use is a no-roll "easy shot". Returns "easy" | "pressure" | "cancel".
function promptLetFlyMode() {
	return new Promise(resolve => {
		new Dialog({
			title: "Let Fly",
			content: `<form class="stonetop-letfly-mode"><p>Is this a calm, easy shot, or are you under pressure?</p></form>`,
			buttons: {
				easy:     { icon: '<i class="fas fa-crosshairs"></i>', label: "Easy shot (deal damage, no roll)", callback: () => resolve("easy") },
				pressure: { icon: '<i class="fas fa-dice-d6"></i>',    label: "Under pressure (roll +DEX)",       callback: () => resolve("pressure") },
			},
			default: "pressure",
			close: () => resolve("cancel"),
			render: bringDialogToFront,
		}, { classes: ["dialog", "stonetop", "stonetop-letfly-mode-dialog"] }).render(true);
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
// Each hit tier presents its outcome as (optionally) a row of checkbox-SVG option controls
// followed by a single Confirm button. Clash's 10+ is a mutually-exclusive "pick 1" (radio,
// pre-selected); Let Fly's 7-9 offers an optional deplete-ammo add-on (checkbox); every
// other tier is a lone Confirm. The Confirm's data-action ("roll" | "suffer") tells the
// click handler what to enact, and a selected pick radio overrides the button's own
// counter / extra-dice.

// A mutually-exclusive pick (radio, checkbox-SVG skinned) for a "pick 1" tier.
function pickRow(group, value, label, { extraDice = "", counter = false, checked = false } = {}) {
	return `<label class="stonetop-attack-pick-row">
		<input type="radio" class="stonetop-attack-pick-check" name="${escHtml(group)}" value="${escHtml(value)}"
			data-counter="${counter ? 1 : 0}"${extraDice ? ` data-extra-dice="${escHtml(extraDice)}"` : ""}${checked ? " checked" : ""}>
		<span class="stonetop-attack-pick-label">${escHtml(label)}</span>
	</label>`;
}

// An optional, independent add-on (checkbox) — Let Fly's "deplete your ammo".
function addonRow(kind, label) {
	return `<label class="stonetop-attack-pick-row">
		<input type="checkbox" class="stonetop-attack-pick-check" data-addon="${escHtml(kind)}">
		<span class="stonetop-attack-pick-label">${escHtml(label)}</span>
	</label>`;
}

// The single button that enacts the tier. `action` is "roll" (roll the PC die per target,
// folding in any selected pick / add-on) or "suffer" (self-write the PC's HP from the foe's
// counter-attack). `counter`/`extraDice` are the tier's base values, used when no pick radio
// overrides them.
function confirmBtn(action, { counter = false, extraDice = "", label = "Confirm", icon = "fa-check" } = {}) {
	return `<button type="button" class="stonetop-attack-btn stonetop-attack-confirm" data-action="${escHtml(action)}"
		data-counter="${counter ? 1 : 0}"${extraDice ? ` data-extra-dice="${escHtml(extraDice)}"` : ""}>
		<i class="fas ${escHtml(icon)}"></i> ${escHtml(label)}
	</button>`;
}

// The "Suffer your enemy's attack" button on the damage results card (a Clash counter).
function sufferBtn(label = "Suffer your enemy's attack") {
	return `<button type="button" class="stonetop-attack-btn stonetop-attack-suffer">
		<i class="fas fa-shield-halved"></i> ${escHtml(label)}
	</button>`;
}

// Controls per result tier for the roll card. Only the rolled tier's button shows, so each
// button names the action it enacts (a bare "Confirm" is unclear on a tier with no pick to
// confirm). The exception is Clash's 10+: there the two radios ARE the choice, so its button
// stays "Confirm" (confirm your pick). Clash's 7-9 rolls damage and suffers the attack; its 6-
// only suffers. Let Fly rolls damage on 10+/7-9 and does nothing automatic on 6-; its 7-9 grows
// an optional "deplete your ammo" checkbox only when the chosen weapon has ammo statuses.
function buildTierActions(move, weapon) {
	if (move.key === "clash") {
		return {
			success:
				pickRow("clash-pick", "avoid", "Deal damage, avoid their attack", { checked: true })
				+ pickRow("clash-pick", "strike-hard", "Strike hard (+1d6, suffer their attack)", { extraDice: "1d6", counter: true })
				+ confirmBtn("roll"),
			partial: confirmBtn("roll", { counter: true, label: "Roll your damage", icon: "fa-dice-d6" }),
			failure: confirmBtn("suffer", { label: "Suffer your enemy's attack", icon: "fa-shield-halved" }),
		};
	}
	return {
		success: confirmBtn("roll", { label: "Roll your damage", icon: "fa-dice-d6" }),
		partial: (weapon?.ammo ? addonRow("deplete", "Deplete your ammo (mark next status)") : "")
			+ confirmBtn("roll", { label: "Roll your damage", icon: "fa-dice-d6" }),
	};
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

	let easyShot = false;
	if (move.letFly) {
		const mode = await promptLetFlyMode();
		if (mode === "cancel") return "cancel";
		easyShot = mode === "easy";
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
	if (targets.length === 0 && !easyShot) {
		ui.notifications?.info("No foe targeted: you can still target one with T before rolling damage.");
	}

	if (easyShot) {
		await rollAndPostDamage(actor, { move: item.name, weapon, targets, pick: "base", counter: false });
		return "handled";
	}

	return {
		tierActions: buildTierActions(move, weapon),
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
	const extra = extraDice ? `+${extraDice}` : "";
	return `${die}${bonus}${extra}`;
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
async function rollAndPostDamage(actor, { move, weapon, targets, extraDice = "", counter = false }) {
	const formula   = await damageFormula(actor, weapon, extraDice);
	const applyable = (targets ?? []).filter(t => t.hasActor !== false && t.uuid);

	if (applyable.length === 0) {
		if (!counter) {
			await rollDamage(formula, actor, { label: `${move}${weapon ? `: ${weapon.name}` : ""}` });
		} else {
			// No foe targeted, but the tier (Clash 7-9 / strike-hard) still demands the PC
			// suffer the counter-attack. Roll the damage for the fiction and post a results
			// card that carries the Suffer button; with no target its foe die falls back to a
			// manual incoming-damage prompt. Without this branch the counter is silently lost.
			const roll = await new Roll(formula).evaluate();
			const results = [{ raw: roll.total, formula: roll.formula, faces: multiDieFaces(roll) }];
			await postDamageResultsCard(actor, { move, weapon, results, counter });
		}
	} else {
		// One damage roll per target — independent, so evaluate them concurrently; they're
		// aggregated into a single results card, and mapping by index preserves order.
		const rolls   = await Promise.all(applyable.map(() => new Roll(formula).evaluate()));
		const results = applyable.map((t, i) => ({
			uuid: t.uuid, name: t.name, actorId: t.actorId, disposition: t.disposition,
			raw: rolls[i].total, formula: rolls[i].formula, faces: multiDieFaces(rolls[i]),
		}));
		await postDamageResultsCard(actor, { move, weapon, results, counter });
	}

	await postTagReminders(actor, weapon);
}

// The fine print a bare number can't carry: which weapon rolled it, and whether armor
// will bite when the GM applies it. Sits under the target name in each damage block. The
// armor bits come from module/data/weapons.js, so the picker and the card can't drift.
function damageRowDetail(weapon) {
	if (!weapon) return "";
	return [escHtml(weapon.name), ...weaponArmorBits(weapon)].join(" · ");
}

function postDamageResultsCard(actor, { move, weapon, results, counter }) {
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

	const body = `<div class="card-content">
		${rollFormulaChip(results[0]?.formula ?? "", chipFaces)}
		${multiWarn}
		<ul class="stonetop-damage-list">${rows}</ul>
		<div class="card-buttons stonetop-card-buttons stonetop-attack-actions">
			${hasApplyable ? `<button type="button" class="stonetop-attack-btn stonetop-apply-damage"><i class="fas fa-heart-crack"></i> Apply damage</button>` : ""}
			${counter ? sufferBtn() : ""}
		</div>
	</div>`;

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

// The single Confirm button per tier on the roll card. The attacking PC's owner clicks it to
// enact the tier: "roll" rolls the PC die per target (folding in a selected pick's extra dice
// / counter and an optional ammo depletion), "suffer" self-writes the PC's HP from the foe's
// counter-attack. Once-only per card via the attack.resolved flag; non-owners see it disabled.
// Every tier's button is wired (hidden ones included) so a GM Shift Up/Down reveals a control
// that's already live.
export function wireAttackConfirm(message, html) {
	const root = html?.[0] ?? html;
	const btns = root.querySelectorAll(".stonetop-attack-confirm");
	if (!btns.length) return;

	const attack = message.getFlag(SCOPE, "attack");
	if (!attack) return;

	// A resolved card is a read-only record of what was enacted: lock every pick / add-on input
	// and restore the choice actually used. The flavor bakes `checked` on the default pick, so
	// each re-render (setFlag triggers one) would otherwise snap the selection back to the default
	// and leave the inputs clickable.
	if (attack.resolved) {
		for (const input of root.querySelectorAll(".stonetop-attack-pick-check")) {
			input.disabled = true;
			if (input.type === "radio" && attack.pick != null) input.checked = input.value === attack.pick;
			else if (input.dataset.addon === "deplete") input.checked = !!attack.ammoDepleted;
		}
	}

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
			btn.addEventListener("click", () => resolveAttackTier(message, actor, btn, root));
		}
	}).catch(err => console.error("Stonetop | could not wire the attack card's Confirm buttons", err));
}

// Enact one tier's Confirm. Disables the clicked button while it runs; only marks the whole
// card resolved (locking every tier's Confirm) once the action actually completes, so a
// cancelled "suffer" prompt leaves the card clickable again.
async function resolveAttackTier(message, actor, btn, root) {
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

	// "roll": a selected pick radio overrides the Confirm's own counter / extra-dice.
	const tier = btn.closest(".stonetop-roll-tier-action");
	const pick = tier?.querySelector('input[type="radio"].stonetop-attack-pick-check:checked');
	const extraDice = pick?.dataset.extraDice ?? btn.dataset.extraDice ?? "";
	const counter   = (pick ? pick.dataset.counter : btn.dataset.counter) === "1";
	const deplete   = !!tier?.querySelector('input[data-addon="deplete"]:checked');

	await lockAttackCard(message, root, { pick: pick?.value ?? null, targets });
	if (deplete) await depleteAmmoAndPost(message, actor, attack);
	await rollAndPostDamage(actor, {
		move: attack.move, weapon: attack.weapon, targets, extraDice, counter,
	});
}

// Lock the card: mark the attack resolved (recording the enacted pick, so a re-render can restore
// it) and disable every tier's Confirm plus its pick / add-on inputs. The setFlag re-render also
// re-applies this via wireAttackConfirm; we do it here too so there's no clickable window first.
async function lockAttackCard(message, root, extra = {}) {
	await message.setFlag(SCOPE, "attack", { ...message.getFlag(SCOPE, "attack"), resolved: true, ...extra });
	root.querySelectorAll(".stonetop-attack-confirm, .stonetop-attack-pick-check").forEach(el => (el.disabled = true));
}

// Mark the chosen weapon's next ammo status (low ammo → all out) and announce it — folded
// into the Let Fly 7-9 Confirm when its "deplete your ammo" add-on is ticked. Drives the SAME
// inventory resource the equipment tab's ○○ boxes show, then refreshes the sheet.
async function depleteAmmoAndPost(message, pc, attack) {
	const slug = attack?.weapon?.slug;
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
