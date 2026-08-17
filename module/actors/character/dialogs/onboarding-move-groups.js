import { deepFreeze } from "../../../utils/localized-once.js";

// Per-playbook groupings for the onboarding "Starting Moves" filter chips. Each
// playbook gets three chips, each a single word that defines a cluster of that
// playbook's moves (derived from a survey of every playbook's move list). A move
// may belong to more than one group. Moves left out — chiefly the generic
// advancement moves (Improved Stat, Superior Stat) and a few outliers — match no
// chip and are reachable only via the text search.
//
// The character sheet's Moves tab splits its playbook section by these same three
// groups (partitionMovesByGroup below), so a name added here shows up in both the
// onboarding chips and the sheet headings — that is the point of the one table.
//
// Names must match the move item names exactly (raw doc.name, before display
// normalization). Keyed by playbook display name (Item.system.playbook).
//
// FROZEN, and exported frozen. The reverse index below is built once and kept for the life of the
// process while `moveGroupsForPlaybook` still reads this table live, so a write here after first
// render would leave the two permanently disagreeing — a move showing on its onboarding chip and
// landing in the sheet's "Other" bucket, with nothing failing. Anything wanting a fourth group or
// a homebrew playbook belongs in this literal, where both readers see it.

export const ONBOARDING_MOVE_GROUPS = deepFreeze({
	"The Blessed": [
		{ key: "spirits", label: "Spirits", moves: ["Big Magic", "Borrow Power", "Call the Spirits", "Danu's Grasp", "Rites of the Land", "Shared Souls", "Spirit Tongue", "Voice of the Earth Mother"] },
		{ key: "nature", label: "Nature", moves: ["Barkskin", "Into the Lion's Den", "Lightning Rod", "Nature's Wrath", "Trackless Step", "Wild Soul"] },
		{ key: "wards", label: "Wards", moves: ["Amulets & Talismans", "Healer's Arts", "Potent Workings", "Suck the Poison Out", "Veil", "Wards & Bindings"] },
	],
	"The Fox": [
		{ key: "stealth", label: "Stealth", moves: ["Burgle", "Catlike", "Eye on the Door", "Free Running", "Light Fingers", "Slippery", "Danger Sense", "Perceptive"] },
		{ key: "combat", label: "Combat", moves: ["All in the Wrist", "Ambush", "Battle Dancer", "Cheap Shot", "Parry & Riposte", "Second Intent", "Skill at Arms"] },
		{ key: "charm", label: "Charm", moves: ["Irresistible", "Pants on Fire", "Rapier Wit", "Silver Tongued", "Under Your Skin"] },
	],
	"The Heavy": [
		{ key: "offense", label: "Offense", moves: ["Battle Joy", "Berserker", "Bringer of Ruin", "Dangerous", "Mighty Thews", "Musclebound", "Nemesis", "Payback", "Relentless", "Terror on the Field", "Intimidating", "Formidable"] },
		{ key: "defense", label: "Defense", moves: ["Armored", "Guardian", "Steadfast Guardian", "Uncanny Reflexes"] },
		{ key: "grit", label: "Grit", moves: ["Hard to Kill", "Unstoppable", "Unfettered", "Frosty", "Stone Cold", "Seasoned Warrior", "Carved Out of Wood", "Cut from Granite"] },
	],
	"The Judge": [
		{ key: "justice", label: "Justice", moves: ["Censure", "Condemn", "Proclamation", "Castigate", "Armistice", "Binding Arbitration", "Bear Witness", "Truth or Consequences", "For the Greater Good"] },
		{ key: "defense", label: "Defense", moves: ["Armored", "A Mighty Rampart", "Aegis of Faith", "Bulwark", "Mirrorshield", "The Tower Eternal", "A Bundle of Sticks Unbroken"] },
		{ key: "lore", label: "Lore", moves: ["Knowledge is Power", "Well-Read", "Chronicler of Stonetop", "Vision Unclouded", "Hound of Aratis"] },
	],
	"The Lightbearer": [
		{ key: "faith", label: "Faith", moves: ["Invoke the Sun God", "Empowered Invocations", "Burn Twice as Bright", "Glorious Servant", "Piety", "Wielder of the White Flame"] },
		{ key: "flame", label: "Flame", moves: ["Consecrated Flame", "Lamplighter", "Light, More Light", "Hungry Flames", "Purifying Flames", "A Candle Against the Dark", "Luminous Shield", "Fire Within", "Keep the Home-Fires Burning"] },
		{ key: "insight", label: "Insight", moves: ["All is Illuminated", "And Behold a Pale Horse", "Helior's Unblinking Eye", "Guiding Light", "Radiant Countenance", "Rise Like the Sun", "Spring's First Thaw"] },
	],
	"The Marshal": [
		{ key: "command", label: "Command", moves: ["Crew", "Veteran Crew", "Front Line Leader", "Heroes to the Last", "Sir, Permission to Die, Sir", "Shake It Off", "We Happy Few", "Stentorian", "Noble Mien"] },
		{ key: "combat", label: "Combat", moves: ["Armored", "Battlefield Grace", "Focus Fire", "Set-Up Strike", "Shield Wall", "Peace Through Strength", "Prepare a Welcome", "Speak Softly", "Arts of War"] },
		{ key: "tactics", label: "Tactics", moves: ["Logistics", "Read the Land", "Take the Measure", "Like an Open Book"] },
	],
	"The Ranger": [
		{ key: "wilds", label: "Wilds", moves: ["A Safe Place", "Home on the Range", "Mental Map", "On the Hoof", "Pathfinder", "Survivalist", "Trailblazer", "Stalker", "Naturalist", "Expert Tracker", "Worldly", "Walk It Off", "Warden of the Wild", "Sniff Out Corruption"] },
		{ key: "combat", label: "Combat", moves: ["Big Game Hunter", "Blot Out the Sun", "Call the Shot", "Giant Slayer", "Predator", "Constant Vigilance"] },
		{ key: "beast", label: "Beast", moves: ["Alpha", "Animal Companion", "Beast of Legend", "Magnificent Specimen", "Pack Horse", "Wild Speech"] },
	],
	"The Seeker": [
		{ key: "arcana", label: "Arcana", moves: ["Arcane Adept", "Conduit of Power", "Improvise", "Initiate of the Secret Arts", "Mind Over Magic", "Overchannel", "Everything Bleeds", "Everything Burns", "Work With What You've Got", "Safety First", "Proof Against Detection"] },
		{ key: "lore", label: "Lore", moves: ["Cryptologist", "Logbook", "Never at a Loss", "Polyglot", "Quick Study", "Well Versed", "Magpie"] },
		{ key: "insight", label: "Insight", moves: ["Attuned", "Deep Insight", "Countermeasures", "Sage Advice", "Let's Make a Deal"] },
	],
	"The Would-Be Hero": [
		{ key: "combat", label: "Combat", moves: ["Big Damn Hero", "Better Part of Valor", "Something to Remember Me By", "Undaunted", "Underestimated", "Anger is a Gift"] },
		{ key: "heart", label: "Heart", moves: ["In Over Your Head", "Inquiring Minds", "Speak Truth to Power", "Tough Love", "Up With People", "Voice of Experience"] },
		{ key: "grit", label: "Grit", moves: ["A Force to Be Reckoned With", "But I Get Up Again", "I Get Knocked Down", "Iron Will", "Never Gonna Keep Me Down", "Resourceful"] },
	],
});

// The chips (key + label only) to show for a playbook, or [] when none are defined.
export function moveGroupsForPlaybook(playbookName) {
	return (ONBOARDING_MOVE_GROUPS[playbookName] ?? []).map(g => ({ key: g.key, label: g.label }));
}

// Reverse index of the table above: playbook -> move name -> the group keys listing it, in
// table order. Built on first use and kept, which is only sound because the table is FROZEN —
// `moveGroupsForPlaybook` above still reads it live, so a table that could be written to would
// leave the chips (live) and the Moves tab's headings (indexed) permanently disagreeing about
// where a move belongs, and nothing would fail. The freeze makes that a loud write instead.
//
// Worth having because `partitionMovesByGroup` is called per MOVE while the table is searched per
// GROUP: the sheet's Moves tab partitions a playbook's moves on every character-sheet render, and
// a linear `groups.find(g => g.moves.includes(name))` is a scan of ~22 names per move. Microseconds
// either way at this size — the reason to keep it is that the answer is fixed, not that the scan
// was slow. (`moveGroupKeys` below is dialog-open only; it rides along.)
const _groupKeyIndex = new Map();
function groupKeyIndexFor(playbookName) {
	let index = _groupKeyIndex.get(playbookName);
	if (index) return index;
	index = new Map();
	for (const group of ONBOARDING_MOVE_GROUPS[playbookName] ?? []) {
		// Once per GROUP, not once per occurrence: a name listed twice within one group's `moves`
		// is a table typo, and pushing its key twice would send `["combat", "combat"]` out to a
		// `groupsAttr` and to anything that counts the result.
		for (const name of new Set(group.moves)) {
			if (index.has(name)) index.get(name).push(group.key);
			else index.set(name, [group.key]);
		}
	}
	// Frozen for the same reason the table is: this is handed out (copied) to callers, but the
	// arrays inside are the ones `partitionMovesByGroup` reads straight.
	for (const keys of index.values()) Object.freeze(keys);
	_groupKeyIndex.set(playbookName, index);
	return index;
}

// The group keys a given move belongs to, within its playbook (0, 1, or more). Copied on the way
// out: the index's arrays are shared and frozen, and a caller that pushed into one would be
// writing into every later answer for that move.
export function moveGroupKeys(playbookName, moveName) {
	return [...(groupKeyIndexFor(playbookName).get(moveName) ?? [])];
}

// The trailing bucket for the moves no chip claims. Labelled "Other" rather than
// "Other Moves" because the Moves tab already ends in a section by that name (the
// custom / foreign-playbook moves), and the two are not the same thing: these are
// this playbook's own moves, they just sit outside its three clusters.
export const UNGROUPED_MOVE_KEY   = "ungrouped";
export const UNGROUPED_MOVE_LABEL = "Other";

/**
 * Split a playbook's moves into its three groups plus the leftover bucket, for the
 * sheet's Moves tab. Order within each group is the order the moves arrive in, so
 * whatever sorting the caller applied (owned first, then alphabetical) survives.
 *
 * A move lands in the FIRST group that lists it and never in a second, even though
 * the table above permits overlap: each rendered card carries live controls (the
 * learn checkbox, the resource track, mark pickers, a drag handle), and a move drawn
 * twice would hand one move two sets of them, writing over each other.
 *
 * @param {string|null} playbookName  display name, as in Item.system.playbook
 * @param {Array<{name: string}>} moves
 * @returns {Array<{key: string, label: string, moves: object[]}>} groups with at
 *   least one move, in table order; [] when the playbook defines no groups (an
 *   unrecognized or homebrew playbook), which tells the caller to render one flat list.
 */
export function partitionMovesByGroup(playbookName, moves) {
	const groups = ONBOARDING_MOVE_GROUPS[playbookName];
	if (!groups?.length) return [];
	const buckets = new Map(groups.map(g => [g.key, { key: g.key, label: g.label, moves: [] }]));
	buckets.set(UNGROUPED_MOVE_KEY, { key: UNGROUPED_MOVE_KEY, label: UNGROUPED_MOVE_LABEL, moves: [] });
	// The index lists a move's groups in table order, so `[0]` IS the first group that claims it —
	// the same answer the linear `find` gave, at one lookup per move instead of a scan.
	const index = groupKeyIndexFor(playbookName);
	for (const move of moves ?? []) {
		const key = index.get(move.name)?.[0];
		buckets.get(key ?? UNGROUPED_MOVE_KEY).moves.push(move);
	}
	return [...buckets.values()].filter(b => b.moves.length);
}
