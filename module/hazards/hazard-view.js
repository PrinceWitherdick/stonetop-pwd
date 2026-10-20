// Builds the shared view-model for a hazard card, used by all three renderers: the
// page sheet (view mode), the steading tab's Hazards section, and the on-canvas
// overlay. The hazard card deliberately reuses the threat card's markup conventions
// (.threat-card wrapper, .threat-portent__check doom boxes), so threat-view's shared
// wiring (doom toggles, drag-to-pin) works on hazard cards without a parallel set of
// handlers.
import { HAZARD_ACCENT, resolveDamageEffects, formatHazardDamage, hazardFormula, cleanHazardTags } from "./hazard-data.js";
import { hasText, stringList, buildDoomRows, buildImpending, buildCustomPlayerMoves, cardEnricher, asCardHtml } from "../journal/card-vm.js";
import { IGNORES_ARMOR_RE, PIERCING_RE } from "../utils/damage.js";

/** The stored worksheet picks plus any free-form extras, as one die, bonus and tag list. */
function hazardDamageParts(sys = {}) {
	const { tags, bonus } = resolveDamageEffects(sys.damageEffects ?? []);
	const extra = String(sys.damageExtra ?? "").split(",").map(t => t.trim()).filter(Boolean);
	return { die: sys.damageDie ?? "", bonus, tags: [...tags, ...extra.filter(t => !tags.includes(t))] };
}

/** The hazard's book-style damage line ("1d10+2 (ignores armor, forceful)"), derived
 *  from the stored worksheet picks plus any free-form extras. */
export function hazardDamageLine(sys = {}) {
	return formatHazardDamage({ ...hazardDamageParts(sys), certainDeath: !!sys.certainDeath });
}

/**
 * What the hazard's damage line ROLLS, for the shared damage card (combat/attack-flow.js#rollHazardDamage),
 * or null when it rolls nothing: no die, or certain death, which p.383 says "shouldn't deal damage" at all.
 *
 * The p.383 effects mapped onto what Apply reads: "ignores armor" bypasses armor outright, "N piercing"
 * takes N off it (one piercing only, the larger: cleanHazardTags), and "+2 damage" is already in the
 * formula. Everything else (messy, forceful, a free-form "area") stays a tag, which the card prints in
 * each row's fine print and turns into its fiction notes. Advantage and disadvantage are not stored:
 * they are asked at the roll.
 *
 * @returns {{formula: string, ignoresArmor: boolean, piercing: number, tags: string[]}|null}
 */
export function hazardDamageRoll(sys = {}) {
	if (sys.certainDeath) return null;
	const { die, bonus, tags } = hazardDamageParts(sys);
	const formula = hazardFormula(die, bonus);
	if (!formula) return null;
	const clean = cleanHazardTags(tags);
	const piercing = Math.max(0, ...clean.map(t => Number(PIERCING_RE.exec(t)?.[1]) || 0));
	return { formula, ignoresArmor: clean.some(t => IGNORES_ARMOR_RE.test(t)), piercing, tags: clean };
}

/**
 * View-model for one hazard page. Async because prose fields are enriched. Pass
 * `{ forOwner }` to force the owner/editable affordances (defaults to page.isOwner).
 */
export async function buildHazardCardVM(page, { forOwner } = {}) {
	const sys = page.system ?? {};
	// Enrich prose (resolve @UUID links, inline rolls) without revealing GM secret blocks.
	const enrich = cardEnricher();

	const doomRows = buildDoomRows(sys);
	const impending = buildImpending(sys);
	const gmMoves = stringList(sys.gmMoves);
	const customPlayerMoves = await buildCustomPlayerMoves(sys, enrich);

	const damage = hazardDamageLine(sys);
	// The GM's damage controls (hazards/hazard-damage.js): roll the line onto the damage card, or, for
	// certain death, take whoever it catches straight to 0 HP. GM prep, and GM hands only.
	const isGM = !!globalThis.game?.user?.isGM;

	return {
		id: page.id,
		uuid: page.uuid,
		name: page.name,
		accent: HAZARD_ACCENT,
		damage,
		hasDamage: hasText(damage),
		certainDeath: !!sys.certainDeath,
		canRollDamage: isGM && !!hazardDamageRoll(sys),
		canCertainDeath: isGM && !!sys.certainDeath,
		instinct: String(sys.instinct ?? ""),
		hasInstinct: hasText(sys.instinct),
		// Written in the wizard's textarea; a hazard saved before that text was stored as
		// paragraphs is drawn with its line breaks all the same.
		description: await enrich(asCardHtml(sys.description)),
		hasDescription: hasText(sys.description),
		advanceTrigger: String(sys.advanceTrigger ?? ""),
		hasAdvanceTrigger: hasText(sys.advanceTrigger),
		doomRows,
		impendingDoom: impending,
		hasDoomTrack: doomRows.length > 0 || impending.hasText,
		gmMoves,
		hasGmMoves: gmMoves.length > 0,
		customPlayerMoves,
		hasCustomMoves: customPlayerMoves.length > 0,
		isOwner: forOwner ?? page.isOwner,
	};
}
