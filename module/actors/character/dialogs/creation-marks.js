// The marks a move asks for when it is taken at character creation: "Each time you take this move,
// pick 1", once per copy. Veteran Crew is the one the book spells out (Book I p.125, the Scion: "You
// start with the Veteran Crew move... Go mark it now"), and a Veteran Crew taken as the free pick asks
// the same. Onboarding's crew step asks them (CharacterOnboardingDialog#_creationMarkData), as the
// level-up mark step asks a copy taken later, and the apply stores them as the move's 1st-level marks
// (StonetopCharacter#setCreationMarks), so a re-run replaces them.
//
// Keyed by move name, the options as the move's markOptions ship them (veteran-crew.json; a test pins
// the two together): the playbook the dialog is built from carries no move data, and resuming it has
// to tell a missing pick synchronously (CharacterOnboardingDialog.hasIncompleteQuestions).

export const VETERAN_CREW_MOVE = "Veteran Crew";

export const CREATION_MARK_MOVES = {
	[VETERAN_CREW_MOVE]: [
		{ slug: "tags",        label: "Select 2 new tags for your Crew",          marks: 1, crewTags: 2 },
		{ slug: "crew-damage", label: "Increase their damage die from d6 to d8", marks: 1 },
		{ slug: "crew-hp",     label: "Increase their max HP by 2 each",          marks: 1 },
	],
};

/**
 * The moves above this creation gives, and how many copies: the background's (the Scion's Veteran
 * Crew) and each free pick of it. A copy taken at a level-up is not one: its pick was the level-up's.
 * @param {Set<string>} backgroundMoves  the names of the moves the background gives
 * @param {string[]} pickNames           the names of the free picks
 * @returns {{move: string, copies: number, fromBackground: boolean}[]}
 */
export function creationMarkCopies(backgroundMoves, pickNames) {
	const out = [];
	for (const move of Object.keys(CREATION_MARK_MOVES)) {
		const fromBackground = !!backgroundMoves?.has(move);
		const copies = (fromBackground ? 1 : 0) + (pickNames ?? []).filter(n => n === move).length;
		if (copies) out.push({ move, copies, fromBackground });
	}
	return out;
}

/**
 * The extra crew tags a set of creation picks allows: Veteran Crew's "Select 2 new tags", 2 for each
 * copy that picked it.
 * @param {Record<string, string[]>} picksByMove  move name -> the slug picked for each copy
 * @returns {number}
 */
export function creationMarkCrewTags(picksByMove) {
	let n = 0;
	for (const [move, picks] of Object.entries(picksByMove ?? {})) {
		const options = CREATION_MARK_MOVES[move] ?? [];
		for (const slug of (picks ?? [])) n += options.find(o => o.slug === slug)?.crewTags ?? 0;
	}
	return n;
}

/**
 * Whether every copy has a pick, each one of the move's options, and no option is picked past its
 * boxes (Veteran Crew's damage die has one).
 * @param {string} move
 * @param {string[]} picks   the slug picked for each copy, in order
 * @param {number} copies    how many copies ask for a pick
 * @returns {boolean}
 */
export function creationMarksComplete(move, picks, copies) {
	const options = CREATION_MARK_MOVES[move] ?? [];
	const held = (picks ?? []).slice(0, copies);
	if (held.length < copies) return false;
	return held.every((slug, i) => {
		const opt = options.find(o => o.slug === slug);
		if (!opt) return false;
		return held.slice(0, i + 1).filter(s => s === slug).length <= (opt.marks ?? 1);
	});
}

/**
 * The radio options for one copy's pick: the one picked selected, and an option whose boxes the
 * other copies' picks have filled disabled.
 * @param {string} move
 * @param {string[]} picks
 * @param {number} copy      this copy's index in `picks`
 * @param {number} copies
 * @returns {{slug: string, label: string, selected: boolean, disabled: boolean}[]}
 */
export function creationMarkRadios(move, picks, copy, copies) {
	const held = (picks ?? []).slice(0, copies);
	return (CREATION_MARK_MOVES[move] ?? []).map(opt => {
		const selected = held[copy] === opt.slug;
		const others = held.filter((s, i) => i !== copy && s === opt.slug).length;
		return { slug: opt.slug, label: opt.label, selected, disabled: !selected && others >= (opt.marks ?? 1) };
	});
}
