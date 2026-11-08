// Level Up audit 2026-11-06 (L17): every printed "(Requires ...)" line of the nine playbooks' moves
// (Book I pp.104-139), and every "replaces", pinned to the move data. A move absent from this table
// prints no requirement. Background moves (Bark an Order, Friends Far and Wide, Commune with Aratis,
// Omens of Fate) and the playbook-locked Dangerous and Potential for Greatness are pinned too.
//
// Trailblazer prints "(Requires level 6+; replaces Home on the Range)" (p.131); the user ruled the
// "replaces" a misprint, so it REQUIRES Home on the Range and both apply.

import { describe, it, expect } from "vitest";
import { loadPlaybookMoveDocs } from "../fakes/sourcePack.js";

const DOCS = loadPlaybookMoveDocs();

// [playbook, move, book's line, the data that line means]
const L6 = { level: 6 };
const BOOK = [
	["The Blessed", "Borrow Power", "(Requires Spirit Tongue)", { moves: ["Spirit Tongue"] }],
	["The Blessed", "Call the Spirits", "(Requires Spirit Tongue)", { moves: ["Spirit Tongue"] }],
	["The Blessed", "Nature's Wrath", "(Requires level 6+ and Danu's Grasp)", { level: 6, moves: ["Danu's Grasp"] }],
	["The Blessed", "Potent Workings", "(Requires level 6+ and Amulets & Talismans)", { level: 6, moves: ["Amulets & Talismans"] }],
	["The Blessed", "Shared Souls", "(Requires level 6+ and Into the Lion's Den)", { level: 6, moves: ["Into the Lion's Den"] }],
	["The Blessed", "Suck the Poison Out", "(Requires level 6+ and Healer's Arts)", { level: 6, moves: ["Healer's Arts"] }],
	["The Blessed", "Superior Stat", "(Requires level 6+)", L6],
	["The Blessed", "Voice of the Earth Mother", "(Requires level 6+ and Spirit Tongue)", { level: 6, moves: ["Spirit Tongue"] }],
	["The Blessed", "Wild Soul", "(Requires level 2+ and the Blessed)", { level: 2, playbook: "The Blessed" }],

	["The Fox", "Battle Dancer", "(Requires level 6+ and Skill at Arms)", { level: 6, moves: ["Skill at Arms"] }],
	["The Fox", "Cheap Shot", "(Requires level 6+ and Ambush)", { level: 6, moves: ["Ambush"] }],
	["The Fox", "Dabbler", "(Requires level 2+ and the Fox)", { level: 2, playbook: "The Fox" }],
	["The Fox", "Eye on the Door", "(Requires level 6+)", L6],
	["The Fox", "Friends Far and Wide", "(the Prodigal Returned's move)", { playbook: "The Fox", background: "the-prodigal-returned" }],
	["The Fox", "Pants on Fire", "(Requires level 6+)", L6],
	["The Fox", "Parry & Riposte", "(Requires Skill at Arms)", { moves: ["Skill at Arms"] }],
	["The Fox", "Second Intent", "(Requires level 6+, Parry & Riposte, and Ambush)", { level: 6, moves: ["Parry & Riposte", "Ambush"] }],
	["The Fox", "Slippery", "(Requires level 6+)", L6],
	["The Fox", "Superior Stat", "(Requires level 6+)", L6],

	["The Heavy", "Bark an Order", "(the Sheriff's move)", { playbook: "The Heavy", background: "sheriff" }],
	["The Heavy", "Berserker", "(Requires Battle Joy)", { moves: ["Battle Joy"] }],
	["The Heavy", "Bringer of Ruin", "(Requires level 6+)", L6],
	["The Heavy", "Cut from Granite", "(Requires level 6+ and Carved Out of Wood)", { level: 6, moves: ["Carved Out of Wood"] }],
	["The Heavy", "Dangerous", "(no one but the Heavy, p.528)", { playbook: "The Heavy" }],
	["The Heavy", "Mighty Thews", "(Requires level 6+ and Musclebound)", { level: 6, moves: ["Musclebound"] }],
	["The Heavy", "Musclebound", "(Requires Strength +2 or higher)", { stats: { str: 2 } }],
	["The Heavy", "Nemesis", "(Requires level 6+ and Relentless)", { level: 6, moves: ["Relentless"] }],
	["The Heavy", "Seasoned Warrior", "(Requires level 2+ and the Heavy)", { level: 2, playbook: "The Heavy" }],
	["The Heavy", "Steadfast Guardian", "(Requires level 6+ and Guardian)", { level: 6, moves: ["Guardian"] }],
	["The Heavy", "Stone Cold", "(Requires level 6+ and Frosty)", { level: 6, moves: ["Frosty"] }],
	["The Heavy", "Superior Stat", "(Requires level 6+)", L6],
	["The Heavy", "Unstoppable", "(Requires Hard to Kill)", { moves: ["Hard to Kill"] }],

	["The Judge", "A Bundle of Sticks Unbroken", "(Requires Many Hands Make Light Work)", { moves: ["Many Hands Make Light Work"] }],
	["The Judge", "A Mighty Rampart", "(Requires level 6+; replaces Bulwark)", { level: 6, moves: ["Bulwark"] }, "Bulwark"],
	["The Judge", "Armistice", "(Requires level 6+ and Bear Witness)", { level: 6, moves: ["Bear Witness"] }],
	["The Judge", "Binding Arbitration", "(Requires Truth or Consequences)", { moves: ["Truth or Consequences"] }],
	["The Judge", "Castigate", "(Requires level 2+, Censure)", { level: 2, moves: ["Censure"] }],
	["The Judge", "Commune with Aratis", "(the Prophet's move)", { playbook: "The Judge", background: "prophet" }],
	["The Judge", "Condemn", "(Requires level 6+ and Censure)", { level: 6, moves: ["Censure"] }],
	["The Judge", "Like a Dog with a Bone", "(Requires Hound of Aratis)", { moves: ["Hound of Aratis"] }],
	["The Judge", "Mirrorshield", "(Requires level 6+ and Aegis of Faith)", { level: 6, moves: ["Aegis of Faith"] }],
	["The Judge", "Proclamation", "(Requires level 6+ and Condemn)", { level: 6, moves: ["Condemn"] }],
	["The Judge", "Superior Stat", "(Requires level 6+)", L6],
	["The Judge", "The Tower Eternal", "(Requires level 6+)", L6],

	["The Lightbearer", "Burn Twice as Bright", "(Requires level 6+ and Invoke the Sun God)", { level: 6, moves: ["Invoke the Sun God"] }],
	["The Lightbearer", "Empowered Invocations", "(Requires level 6+ and Invoke the Sun God)", { level: 6, moves: ["Invoke the Sun God"] }],
	["The Lightbearer", "Glorious Servant", "(Requires level 6+ and Invoke the Sun God)", { level: 6, moves: ["Invoke the Sun God"] }],
	["The Lightbearer", "Hungry Flames", "(Requires level 6+ and Purifying Flames)", { level: 6, moves: ["Purifying Flames"] }],
	["The Lightbearer", "Light, More Light", "(Requires level 6+ and Consecrated Flame)", { level: 6, moves: ["Consecrated Flame"] }],
	["The Lightbearer", "Luminous Shield", "(Requires A Candle Against the Dark)", { moves: ["A Candle Against the Dark"] }],
	["The Lightbearer", "Superior Stat", "(Requires level 6+)", L6],
	["The Lightbearer", "Wielder of the White Flame", "(Requires level 6+ and Invoke the Sun God)", { level: 6, moves: ["Invoke the Sun God"] }],

	["The Marshal", "Arts of War", "(Requires level 2+, the Marshal)", { level: 2, playbook: "The Marshal" }],
	["The Marshal", "Battlefield Grace", "(Requires level 6+ and Front Line Leader)", { level: 6, moves: ["Front Line Leader"] }],
	["The Marshal", "Focus Fire", "(Requires level 6+, Stentorian)", { level: 6, moves: ["Stentorian"] }],
	["The Marshal", "Heroes to the Last", "(Requires level 6+ and Veteran Crew)", { level: 6, moves: ["Veteran Crew"] }],
	["The Marshal", "Like an Open Book", "(Requires level 6+ and Take the Measure)", { level: 6, moves: ["Take the Measure"] }],
	["The Marshal", "Noble Mien", "(Requires level 6+)", L6],
	["The Marshal", "Peace Through Strength", "(Requires level 6+ and Speak Softly)", { level: 6, moves: ["Speak Softly"] }],
	["The Marshal", "Prepare a Welcome", "(Requires Read the Land)", { moves: ["Read the Land"] }],
	["The Marshal", "Superior Stat", "(Requires level 6+)", L6],
	["The Marshal", "Veteran Crew", "(Requires Crew)", { moves: ["Crew"] }],

	["The Ranger", "Alpha", "(Requires level 6+, and Wild Speech or Spirit Tongue)", { level: 6, anyMoves: ["Wild Speech", "Spirit Tongue"] }],
	["The Ranger", "Beast of Legend", "(Requires level 6+ and Magnificent Specimen)", { level: 6, moves: ["Magnificent Specimen"] }],
	["The Ranger", "Constant Vigilance", "(Requires level 6+)", L6],
	["The Ranger", "Giant Slayer", "(Requires level 6+ and Big Game Hunter)", { level: 6, moves: ["Big Game Hunter"] }],
	["The Ranger", "Magnificent Specimen", "(Requires Animal Companion)", { moves: ["Animal Companion"] }],
	["The Ranger", "Superior Stat", "(Requires level 6+)", L6],
	["The Ranger", "Trailblazer", "(Requires level 6+; replaces Home on the Range): ruled a misprint", { level: 6, moves: ["Home on the Range"] }],
	["The Ranger", "Walk It Off", "(Requires level 6+)", L6],
	["The Ranger", "Worldly", "(Requires level 2+ and the Ranger)", { level: 2, playbook: "The Ranger" }],

	["The Seeker", "Arcane Adept", "(Requires level 6+)", L6],
	["The Seeker", "Cryptologist", "(Requires Polyglot)", { moves: ["Polyglot"] }],
	["The Seeker", "Deep Insight", "(Requires level 6+ and Attuned)", { level: 6, moves: ["Attuned"] }],
	["The Seeker", "Improvise", "(Requires level 6+ and Quick Study)", { level: 6, moves: ["Quick Study"] }],
	["The Seeker", "Initiate of the Secret Arts", "(Requires level 2+ and the Seeker)", { level: 2, playbook: "The Seeker" }],
	["The Seeker", "Mind Over Magic", "(Requires level 6+)", L6],
	["The Seeker", "Overchannel", "(Requires level 6+ and Conduit of Power)", { level: 6, moves: ["Conduit of Power"] }],
	["The Seeker", "Proof Against Detection", "(Requires level 6+ and Safety First)", { level: 6, moves: ["Safety First"] }],
	["The Seeker", "Superior Stat", "(Requires level 6+)", L6],

	["The Would-Be Hero", "A Force to Be Reckoned With", "(Requires level 6+; replaces Underestimated)", L6, "Underestimated"],
	["The Would-Be Hero", "Big Damn Hero", "(Requires level 6+; replaces In Over Your Head)", L6, "In Over Your Head"],
	["The Would-Be Hero", "But I Get Up Again", "(Requires I Get Knocked Down)", { moves: ["I Get Knocked Down"] }],
	["The Would-Be Hero", "Omens of Fate", "(the Destined's move)", { playbook: "The Would-Be Hero", background: "destined" }],
	["The Would-Be Hero", "Potential for Greatness", "(Requires the Would-be Hero)", { playbook: "The Would-Be Hero" }],
	["The Would-Be Hero", "Speak Truth to Power", "(Requires Anger is a Gift)", { moves: ["Anger is a Gift"] }],
	["The Would-Be Hero", "Superior Stat", "(Requires all 6 marks in Potential for Greatness)", { marks: { move: "Potential for Greatness", count: 6 } }],
	["The Would-Be Hero", "Undaunted", "(Requires level 6+; replaces Better Part of Valor)", L6, "Better Part of Valor"],
	["The Would-Be Hero", "Versatile", "(Requires level 2+, the Would-be Hero)", { level: 2, playbook: "The Would-Be Hero" }],
	["The Would-Be Hero", "Voice of Experience", "(Requires level 6+; replaces Inquiring Minds)", L6, "Inquiring Minds"],
];

// The requirement without its freeform note (display text, never checked) and empty lists.
function requirementOf(doc) {
	const req = { ...(doc.system?.requirement ?? {}) };
	delete req.note;
	for (const key of Object.keys(req)) if (Array.isArray(req[key]) && !req[key].length) delete req[key];
	return req;
}

describe("every printed requirement and replacement matches the move data", () => {
	it.each(BOOK)("%s: %s %s", (playbook, name, _line, requirement, replaces = null) => {
		const doc = DOCS.find(d => d.system?.playbook === playbook && d.name === name);
		expect(doc, `${playbook} has ${name}`).toBeTruthy();
		expect(requirementOf(doc)).toEqual(requirement);
		expect(doc.system.replaces ?? null).toBe(replaces);
	});

	it("no other move carries a requirement or replaces anything", () => {
		const listed = new Set(BOOK.map(([pb, name]) => `${pb}/${name}`));
		const extra = DOCS
			.filter(d => !listed.has(`${d.system?.playbook}/${d.name}`))
			.filter(d => Object.keys(requirementOf(d)).length || d.system?.replaces)
			.map(d => `${d.system.playbook}/${d.name}`);
		expect(extra).toEqual([]);
	});
});

// "SUPERIOR STAT (Requires level 6+) Increase one of your stats by +1 (to a max of +3)", one box,
// on each playbook's moves page; the Marshal (p.126), Ranger (p.131) and Seeker (p.134) pinned
// here, as the other six are in their own playbook tests.
describe("Superior Stat: level 6+, one box, to a max of +3", () => {
	it.each(["The Marshal", "The Ranger", "The Seeker"])("%s", playbook => {
		const doc = DOCS.find(d => d.system?.playbook === playbook && d.name === "Superior Stat");
		expect(doc.system.requirement).toEqual({ level: 6 });
		expect(doc.system.cap).toBe(3);
		expect(doc.system.repeatMax ?? 1).toBe(1);
	});
});
