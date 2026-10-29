// A HAZARD'S HARM, from its card: the GM's "Roll damage" and "Certain death" (Book I, Dangers p.383).
//
// "Damage from hazards": the die is the worst outcome for a normal person, the effects ride it (ignores
// armor, piercing, messy, forceful, +2), and the roll takes advantage when the hazard catches them
// off-guard or disadvantage when they took precautions. That roll lands on the SHARED damage card
// (combat/attack-flow.js#rollHazardDamage), so Apply, armor, piercing and a Defend work as they do for
// any blow.
//
// "Certain death": a hazard that "would definitely, absolutely kill a normal person ... shouldn't deal
// damage to the PCs--it should immediately reduce them to 0 HP and trigger the Death's Door move." So
// there is no roll: whoever it catches loses exactly the HP they have, through the same HP writer the
// damage card's Apply uses (utils/damage.js#applyDamageToActor). Hitting 0 is what marks a character
// dying and opens Death's Door (hooks/DeathsDoorPrompt.js), exactly as lethal damage does.
//
// WHO IT CATCHES: the GM's targeted tokens, as every damage roll is aimed; with none targeted, a pick of
// the player characters and the tokens on the scene, nobody ticked, because who the hazard catches is
// the GM's call. Wired on every host of the hazard card through the per-kind table
// (journal/gm-prep-page.js, `wireCard`): the hazard page sheet, the GM Toolkit's prep tab and the
// on-canvas board. GM only: the hazard is GM prep, and so is the decision that it struck.

import { applyDamageToActor, damageRowActor } from "../utils/damage.js";
import { format, localize } from "../utils/i18n.js";
import { escHtml } from "../utils/strings.js";
import { postListCard } from "../utils/chat.js";
import { rollHazardDamage, selfTarget, snapshotTargets, disembodiedSufferer } from "../combat/attack-flow.js";
import { hazardDamageRoll } from "./hazard-view.js";

const KEY = "stonetop.hazards.damage";

/**
 * A hazard target in the shape the damage card reads (attack-flow.js#snapshotTargets): the row a self-harming
 * option aims at its character (attack-flow.js#selfTarget), laid on the token when there is one. Disposition 0,
 * never friendly: the "(friendly)" warning on a damage row is about hurting an ally by mistake, and a hazard is
 * on nobody's side.
 */
function asTarget(actor, token = null) {
	return token ? { ...selfTarget(actor), uuid: token.uuid, name: token.name || actor.name || "" } : selfTarget(actor);
}

/** Does this actor have hit points a hazard could take? */
const hasHp = actor => actor?.system?.attributes?.hp !== undefined && actor?.system?.attributes?.hp !== null;

/**
 * Who a hazard could catch, as picker rows: each token on the scene whose actor has HP, then every
 * player character with no token there (aimed at their actor, as a self-harming option is).
 *
 * @param {object} p
 * @param {Actor[]} [p.characters]  the player characters in play
 * @param {TokenDocument[]} [p.tokens]  the tokens on the scene
 * @returns {Array<{id: string, name: string, actor: Actor, target: object}>}
 */
export function hazardCandidates({ characters = [], tokens = [] } = {}) {
	const rows = [];
	const onScene = new Set();
	for (const token of tokens) {
		const actor = token?.actor;
		if (!token?.uuid || !hasHp(actor)) continue;
		const name = token.name || actor.name || "";
		rows.push({ id: token.uuid, name, actor, target: asTarget(actor, token) });
		if (actor.id) onScene.add(actor.id);
	}
	for (const actor of characters) {
		if (!actor?.uuid || onScene.has(actor.id) || !hasHp(actor)) continue;
		rows.push({ id: actor.uuid, name: actor.name, actor, target: asTarget(actor) });
	}
	return rows;
}

/**
 * A picker row's name: a Ghost's says Disembodied may spare them (Book I p.148; audit XS-4). A label only, so the
 * GM picking sees it; nothing is taken off the hazard's harm. Exported for the tests.
 */
export function candidateLabel(name, actor) {
	return disembodiedSufferer(actor) ? format(`${KEY}.pickGhost`, { name }) : name;
}

/**
 * The defaults behind the card's two buttons, the people picker loaded at click time: it is large, and
 * only a GM who presses one ever needs it. (The damage flow is not: the system loads it at startup for
 * every damage card, and the targets here are its rows.) Anything the caller passes wins, which is how
 * the tests drive it.
 */
async function withDefaults(deps = {}) {
	const [people, pcs] = await Promise.all([
		"pick" in deps ? null : import("../dialogs/RelationshipLinkDialog.js"),
		"characters" in deps ? null : import("../utils/characters-in-play.js"),
	]);
	return {
		handTargets: () => snapshotTargets(),
		rollHazardDamage,
		pick: question => people.pickPersonOnMap(question),
		characters: () => pcs.charactersInPlay(),
		tokens: () => Array.from(globalThis.canvas?.scene?.tokens ?? []),
		resolve: uuid => Promise.resolve(globalThis.fromUuid?.(uuid)).catch(() => null),
		apply: applyDamageToActor,
		// The shared list card (utils/chat.js#postListCard), spoken by the hazard and worn as an applied card.
		post: (title, rowsHtml, options) => postListCard(null, title, rowsHtml, options),
		notify: message => globalThis.ui?.notifications?.info?.(message),
		...deps,
	};
}

/**
 * Who this press catches: the GM's targets, else whoever the GM ticks. Resolves to targets (empty when
 * there is nobody at all to offer), or null when the GM backed out of the pick.
 */
async function hazardTargets(page, kind, d) {
	// Every hand target, as a hazard target: same token, but on nobody's side (asTarget).
	const hand = (d.handTargets() ?? []).filter(t => t?.uuid).map(t => ({ ...t, disposition: 0 }));
	if (hand.length) return hand;
	const candidates = hazardCandidates({ characters: d.characters(), tokens: d.tokens() });
	if (!candidates.length) return [];
	const death = kind === "death";
	const ids = await d.pick({
		options: candidates.map(({ id, name, actor }) => ({ id, name: candidateLabel(name, actor), actor })),
		title: format(`${KEY}.pickTitle`, { name: page.name }),
		hint: localize(`${KEY}.pickHint`),
		buttonLabel: localize(`${KEY}.${death ? "pickDeath" : "pickRoll"}`),
		formatLabel: () => localize(`${KEY}.${death ? "pickDeath" : "pickRoll"}`),
		formatManyLabel: count => format(`${KEY}.${death ? "pickDeathMany" : "pickRollMany"}`, { count }),
		icon: death ? "fa-skull" : "fa-dice-d20",
		multiple: true,
		selected: [],
	});
	if (!Array.isArray(ids)) return null;
	return candidates.filter(c => ids.includes(c.id)).map(c => c.target);
}

/**
 * "Roll damage" on a hazard card: its line, at whoever it catches, onto the shared damage card.
 *
 * @param {JournalEntryPage} page  the hazard page
 * @param {{shiftKey?: boolean}} [options]
 * @param {object} [deps]  see withDefaults
 * @returns {Promise<object[]|null>}  the rolled totals, or null when nothing was rolled
 */
export async function rollHazardFromCard(page, { shiftKey = false } = {}, deps = {}) {
	const roll = hazardDamageRoll(page?.system ?? {});
	if (!roll) return null;
	const d = await withDefaults(deps);
	const targets = await hazardTargets(page, "roll", d);
	if (targets === null) return null;
	// Nobody to offer at all still rolls: the card then shows the number alone, with no Apply.
	return d.rollHazardDamage({ name: page.name, ...roll }, { targets, shiftKey });
}

/**
 * "Certain death" (Book I p.383): whoever it catches goes straight to 0 HP. No roll and no armor: the
 * HP they have is the damage, written through applyDamageToActor, so the drop to 0 runs every hook a
 * killing blow runs (dying, the announcement, Death's Door opening for its owner, Unstoppable and We
 * Happy Few asking first). A chat card says who it took and from what.
 *
 * @param {JournalEntryPage} page  the hazard page
 * @param {object} [deps]  see withDefaults
 * @returns {Promise<string[]|null>}  the card's lines, or null when nothing was done
 */
export async function hazardCertainDeath(page, deps = {}) {
	if (!page?.system?.certainDeath) return null;
	const d = await withDefaults(deps);
	const targets = await hazardTargets(page, "death", d);
	if (targets === null) return null;
	if (!targets.length) {
		d.notify(format(`${KEY}.noOne`, { name: page.name }));
		return null;
	}
	const lines = [];
	for (const target of targets) {
		const actor = damageRowActor(await d.resolve(target.uuid));
		const name = target.name || actor?.name || "";
		const hp = Number(actor?.system?.attributes?.hp?.value);
		if (!actor || !Number.isFinite(hp)) { lines.push(format(`${KEY}.noHp`, { name })); continue; }
		if (hp <= 0) { lines.push(format(`${KEY}.alreadyDown`, { name })); continue; }
		const hit = await d.apply(actor, hp, { stonetopMove: page.name });
		if (!hit) { lines.push(format(`${KEY}.noHp`, { name })); continue; }
		lines.push(format(`${KEY}.deathLine`, { name, from: hit.oldHp }));
	}
	await d.post(format(`${KEY}.deathTitle`, { name: page.name }), lines.map(line => `<li>${escHtml(line)}</li>`).join(""), {
		speaker: { alias: page.name }, sectionClass: "stonetop-attack-applied-card",
	});
	return lines;
}

/** The hazard pages (by uuid) whose Roll damage or Certain death is under way on this client. */
const hazardPressesInFlight = new Set();

/**
 * The card's two buttons, delegated on `root` (a page sheet, the GM Toolkit's prep tab, the canvas
 * board): finds nothing where no hazard card is drawn, as every kind's `wireCard` must.
 *
 * @param {HTMLElement} root
 * @param {(el: HTMLElement) => any} resolvePage  the page (or a promise of it) for a clicked button
 * @param {object} [deps]  see withDefaults
 */
export function wireHazardDamage(root, resolvePage, deps = {}) {
	root?.addEventListener?.("click", async ev => {
		const btn = ev.target?.closest?.(".hazard-damage-roll, .hazard-certain-death");
		if (!btn) return;
		ev.preventDefault();
		ev.stopPropagation();
		if (!globalThis.game?.user?.isGM || btn.disabled) return;
		// One press at a time: a second while the picker or the damage window is open would roll twice. The
		// button goes down before anything is awaited, and the page is held in flight by its card, because the
		// host redraws (a fresh, live button) while the picker is open.
		const key = btn.closest?.(".threat-card")?.dataset?.pageUuid ?? "";
		if (key && hazardPressesInFlight.has(key)) return;
		btn.disabled = true;
		if (key) hazardPressesInFlight.add(key);
		try {
			const page = await resolvePage(btn);
			if (!page) return;
			if (btn.classList.contains("hazard-certain-death")) await hazardCertainDeath(page, deps);
			else await rollHazardFromCard(page, { shiftKey: !!ev.shiftKey }, deps);
		} catch (err) {
			console.error("Stonetop | hazard damage failed", err);
		} finally {
			btn.disabled = false;
			if (key) hazardPressesInFlight.delete(key);
		}
	});
}
