/**
 * How one roll mode meets another: ADVANTAGE AND DISADVANTAGE CANCEL (p.230), and neither stacks
 * with itself.
 *
 * One rule, one home. It is asked from every side of a fight — the roller's own moves (Dangerous
 * sharpening a blow), the people being hit (Uncanny Reflexes, Battlefield Grace, Big Damn Hero's
 * locked eyes), a grudge a character is owed, and every ticked line on the damage window — and a
 * copy per caller is how the four quietly stop agreeing.
 *
 * Pure: no Foundry global, no document.
 */

/**
 * `mode` once `added` has been laid on top of it.
 *
 * An empty `mode` is the roll's own default, which is straight — a blow nobody has said anything
 * about yet — so laying advantage on it gives advantage. Anything unrecognised reads the same way,
 * because "not a mode I know" and "no mode" are the same thing to this rule.
 *
 * @param {string} mode   "adv" | "dis" | "normal", or empty for the roll's own default
 * @param {string} added  what is being laid on; empty or "normal" changes nothing
 * @returns {string} the mode to roll at
 */
export function stepMode(mode, added) {
	if (!added || added === "normal") return mode;
	const from = mode === "adv" || mode === "dis" ? mode : "normal";
	if (from === added) return mode;
	return from === "normal" ? added : "normal";
}

/** One step better: what a move that sharpens a blow does to it. */
export const betterMode = mode => stepMode(mode, "adv");

/** One step worse: what a move that blunts a blow does to it. */
export const worseMode = mode => stepMode(mode, "dis");

/**
 * EVERY mode in play at once, folded into the one the roll is actually made at.
 *
 * stepMode is the PAIRWISE rule and cannot answer this on its own. Folding a list through it one
 * at a time loses the difference between a straight roll nobody has spoken about and a straight
 * roll REACHED BY CANCELLING, so the next "dis" lands on the latter as though it were the former
 * and pushes the blow past straight: locked eyes plus a Never Gonna Keep Me Down against an
 * advantaged blow rolled at disadvantage, when the rule the caller quotes says they cancel.
 *
 * Neither side stacks with itself, so this is a question about which sides SPOKE, not how loudly.
 *
 * @param {Iterable<string>} modes  what every source says; empty and "normal" entries say nothing
 * @param {string} [base]  the roll's own mode, counted as a source and returned when none change it
 * @returns {string} the mode to roll at
 */
export function foldModes(modes, base = "") {
	const all = [base, ...(modes ?? [])];
	const adv = all.some(m => m === "adv");
	const dis = all.some(m => m === "dis");
	if (adv && dis) return "normal";
	if (adv) return "adv";
	if (dis) return "dis";
	return base;
}

/**
 * Lay more sources on a roll's options, folded with EVERY source laid on them before.
 *
 * For a roll whose mode is built up in stages (the picker's answer, then a grudge, then a held
 * promise, then a debility), each in a method of its own. Folding each stage onto the mode the last
 * one left is the chaining foldModes exists to refuse: a Disadvantage picked in the window, a
 * grudge's advantage and a held Interfere are one of each side and a straight roll, but stepped
 * they come out at disadvantage. So the options carry what has been said so far, `modeBase` (the
 * roll's own mode, before any stage spoke) and `modeSources`, and every stage re-folds all of it.
 *
 * @param {object} options  a roll's options; `rollMode` is its own mode the first time
 * @param {Iterable<string>} modes  what this stage says; empty and "normal" entries say nothing
 * @returns {object} the options with `rollMode` folded from everything laid on them
 */
export function layModes(options, modes) {
	const modeBase = options?.modeBase ?? options?.rollMode ?? "";
	const modeSources = [...(options?.modeSources ?? []), ...[...(modes ?? [])].filter(m => m === "adv" || m === "dis")];
	return { ...options, modeBase, modeSources, rollMode: foldModes(modeSources, modeBase) };
}
