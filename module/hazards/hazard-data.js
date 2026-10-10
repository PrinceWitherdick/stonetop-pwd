// The "Dangers > Hazards" worksheet data (Book I, Dangers, pp. 381-389): the
// damage-from-hazards table (worst plausible outcome for a normal person sets the
// die), the "if... effect" picks that decorate that damage, and the four prompt
// categories the book suggests when writing a hazard's GM moves. This is the single
// source of truth for the guided creator, the card view-model, and the page model,
// the analogue of THREAT_TYPES for threats.

/** Card/pin accent for hazards, a muted moss distinct from the eight threat hues. */
export const HAZARD_ACCENT = "#5c6b4a";

/** Worst outcome for a normal person → damage die (Book I p. 383). The empty id is
 *  "no damage roll at all": hazards that hinder, restrain, or complicate instead. */
export const HAZARD_DAMAGE_DICE = [
	{ id: "",    label: "It doesn't deal damage; it hinders, restrains, or complicates instead" },
	{ id: "d4",  label: "Bruises & scrapes, pain, light burns" },
	{ id: "d6",  label: "Nasty flesh wounds, bruises, burns" },
	{ id: "d8",  label: "Broken bones, bad burns, debilitating pain" },
	{ id: "d10", label: "Death or dismemberment" },
];

/** The "if... effect" picks (Book I p. 383). Each contributes damage tags and/or a
 *  flat bonus; `value` is the short form shown on the pick's right edge. */
export const HAZARD_DAMAGE_EFFECTS = [
	{ id: "ignoresArmor", label: "Armor can't protect against it",   tags: ["ignores armor"],       bonus: 0, value: "ignores armor" },
	{ id: "pierce1",      label: "It slices through leather/hide",   tags: ["1 piercing", "messy"], bonus: 0, value: "1 piercing, messy" },
	{ id: "pierce3",      label: "It can tear metal apart",          tags: ["3 piercing", "messy"], bonus: 0, value: "3 piercing, messy" },
	{ id: "forceful",     label: "It knocks them down or around",    tags: ["forceful"],            bonus: 0, value: "forceful" },
	{ id: "big",          label: "It's big/vicious/scary",           tags: [],                      bonus: 2, value: "+2 damage" },
];

/** Situational guidance that rides the damage roll rather than the write-up (p. 383). */
export const HAZARD_DAMAGE_ADVICE =
	"Roll the damage with disadvantage if the PCs knew about the hazard and took precautions; " +
	"roll with advantage if it catches them completely off-guard.";

/** The four things a hazard's GM moves should cover, in order — foreshadow, harm,
 *  escalate, thwart (Book I p. 386) — used as placeholder prompts in the moves step. */
export const HAZARD_MOVE_PROMPTS = [
	"How its presence is foreshadowed or revealed",
	"How it harms or hinders",
	"How it escalates or gets worse",
	"How it might thwart attempts to overcome it",
];

const _EFFECT_BY_ID = new Map(HAZARD_DAMAGE_EFFECTS.map(e => [e.id, e]));

/** Resolve the tag list + flat bonus a set of effect ids contributes. */
export function resolveDamageEffects(effectIds = []) {
	const tags = [];
	let bonus = 0;
	for (const id of effectIds) {
		const eff = _EFFECT_BY_ID.get(id);
		if (!eff) continue;
		for (const t of eff.tags) if (!tags.includes(t)) tags.push(t);
		bonus += eff.bonus;
	}
	return { tags, bonus };
}

const _PIERCING = /^(\d+)\s+piercing$/i;

/**
 * At most ONE "N piercing" tag, the largest, in the place the first one stood.
 *
 * p. 383 is "choose all that apply", so a hazard that tears metal apart may also be ticked as
 * slicing through leather/hide. Piercing is a single number, though, and a line reading
 * "1 piercing, messy, 3 piercing" says nothing a reader can use: the larger value already covers
 * the smaller. Applies to free-form extras too, so "2 piercing" typed beside a pick is folded in.
 */
export function onePiercingTag(tags = []) {
	const values = tags.map(t => _PIERCING.exec(String(t).trim())).filter(Boolean).map(m => Number(m[1]));
	if (values.length < 2) return [...tags];
	const keep = `${Math.max(...values)} piercing`;
	let placed = false;
	const out = [];
	for (const t of tags) {
		if (!_PIERCING.test(String(t).trim())) { out.push(t); continue; }
		if (!placed) { out.push(keep); placed = true; }
	}
	return out;
}

/**
 * The hazard's damage line as the book writes it, e.g. "1d10+2 (ignores armor,
 * forceful)". Certain death replaces the roll entirely (p. 383: straight to 0 HP
 * and Death's Door); no die and no certain death means no damage line at all.
 */
export function formatHazardDamage({ die = "", bonus = 0, tags = [], certainDeath = false } = {}) {
	if (certainDeath) return "certain death (no damage roll; straight to Death's Door)";
	if (!die) return "";
	const b = Number(bonus) || 0;
	const formula = `1${die}${b > 0 ? `+${b}` : b < 0 ? `${b}` : ""}`;
	const clean = onePiercingTag(tags.map(t => String(t).trim()).filter(Boolean));
	return clean.length ? `${formula} (${clean.join(", ")})` : formula;
}
