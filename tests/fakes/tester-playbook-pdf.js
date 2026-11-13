import { buildPageRuns, H, BOX, TICK, BOXES, B, BI, I, PIPS } from "./pdf-page-builder.js";

// "The Tester": an original playbook (no published text), laid out on the community template's
// grid. Page 1 is the front (four ~176pt columns), page 2 the moves (the stats and moves heading
// lines run across two columns, as the template's do), page 3 the stock inventory sheet beside an
// insert. Lines are wrapped to the column, about 50 characters, as a real page is.
//
// `insert` picks page 3:
//   "plain"       the stock inventory sheet beside a "Tester's Toolbox" headed like a section (10pt),
//                 which the reader can't be sure is an insert;
//   "titled"      the same insert set as the template sets one: a 12pt title with its flavour run on,
//                 9pt parts with their counts, a ticked always-held move, options pre-ticked and one
//                 with smaller boxes of its own; and page 2's TOOLED UP names it and opens it;
//   "boilerplate" only the stock pages (Inventory, Followers, the Player's Agenda): no insert;
//   "none"        no page 3 at all.
// `frontInstinct: false` leaves page 1's Instinct section out, so only the insert has one.
export function tester({ drive = false, hp = ["HP (max 16)"], insert = "plain", frontInstinct = true } = {}) {
	const step = n => ({ t: String(n), f: "heading" });
	const titled = insert === "titled";
	return buildPageRuns([
		{ columns: [
			{ x: 27, lines: [
				H("Belonging"),
				["When you were young they … (choose 1 or 2)"],
				BOX("… ignored you"),
				BOX("… doted on you"),
				BOX(),
				{ gap: 20 },
				["Tell us, where do you go to think?"],
			] },
			{ x: 203, lines: [
				H("Introductions"),
				["Wait here for everyone else."],
				{ tokens: [step(3), " On your third turn, tell us what you broke."], indent: 3 },
				{ tokens: [step(4), " On your next turn, answer one of these."], indent: 3 },
				BOX("Who mended it?"),
				BOX("Who blamed you for it?"),
				{ tokens: [step(5), " Go around again."], indent: 3 },
				{ tokens: [step(6), " On your next turn, ask your fellow PCs"], indent: 3 },
				{ tokens: ["one of these."], indent: 18 },
				BOX("Which of you laughed?"),
				{ tokens: [step(7), " Go around again."], indent: 3 },
			] },
			{ x: 423, lines: [
				{ heading: true, size: 24, tokens: [{ t: "The Tester", f: "heading" }] },
				[I("Every village needs someone who asks why.")],
				{ gap: 10 },
				H("Background", "(Choose 1)"),
				BOX(B("THE PROBER")),
				["You test the ice before anyone walks on it."],
				["Gain the Prod move, in addition to your other"],
				["moves."],
				{ gap: 10 },
				BOX(B("THE BORROWER")),
				["You learned from others. You get one of the"],
				["following moves: Frosty from the Heavy, or Poke."],
			] },
			{ x: 599, lines: [
				...(frontInstinct ? [
					H(drive ? "Drive" : "Instinct", "(Choose 1)"),
					BOX(B("CURIOSITY")),
					["To find out."],
					BOX(B("CAUTION")),
					["To look twice."],
					BOX(),
					{ gap: 10 },
				] : []),
				H("Appearance"),
				["Choose 1 on each line, or make something up:"],
				[...BOX("young "), ...BOX("old")],
				[...BOX("quiet "), ...BOX("loud "), ...BOX("hoarse")],
				{ gap: 10 },
				H("Place of origin and name"),
				BOX(B("Stonetop"), ": Ade, Bryn, Cai,"),
				{ tokens: ["Dafydd, or Efa"], indent: 13 },
				BOX(B("Gordin's Delve"), ": Pick a name from any list"),
			] },
		] },
		{ columns: [
			{ x: 27, lines: [
				H("Stats", "Assign these scores: +1, +1, +1, +0, +0, -1. Debilities: roll with disadvantage."),
				["StrengthStrength DexterityDexterity"],
				["weakened dazed"],
				["d8"],
				[`DamageDamage ${hp.join("")} ArmorArmor`],
				{ gap: 10 },
				H("Moves", "You start with Prod and 1 of your choice."),
				TICK(B("PROD"), " Doubt ", PIPS(3)),
				["When you ", BI("prod something"), ", roll +INT: on a 10+,"],
				["it breaks; on a 7-9, it wobbles; on a 6-, it bites."],
				{ gap: 10 },
				BOXES(3, B("IMPROVED STAT")),
				["Each time you take this move, increase one of"],
				["your stats by 1."],
				{ gap: 10 },
				BOX(B("POKE")),
				["Gently, ", I("close"), "."],
				{ gap: 10 },
				BOX(B("PROD AND POKE")),
				["(Requires level 6+ and Prod)"],
				["Both at once. Spend Doubt to:"],
				{ tokens: ["Ask a question"], indent: 13 },
				{ tokens: ["Take a step back"], indent: 13 },
				...(titled ? [
					{ gap: 10 },
					BOXES(3, B("TOOLED UP")),
					["Fill out the Tester's Toolbox insert. Each time"],
					["you take this move, choose a new trick."],
				] : []),
			] },
			{ x: 423, lines: [
				H("Special possessions", "(Pick 1, in addition to any background items)"),
				BOX(B("Tester's kit"), ": levers, ", { t: "u", f: "ding" }, "a mallet"),
				BOX(B("Notebook"), " (", PIPS(3), " uses): pages"),
				BOX("Weapons (Choose 1)"),
				{ tokens: BOX("Spear, iron (close)"), indent: 14 },
				{ tokens: BOX("Sling (near)"), indent: 14 },
				BOX("(discuss with GM)"),
			] },
		] },
		...(insert === "none" ? [] : [{ columns: [
			{ x: 27, lines: [H("Inventory for", "", 12), ["When you Outfit, mark a number of boxes."], ["Mess kit"], ["Bedroll"], ["Blanket"]] },
			{ x: 259, lines: [H("Small items"), ["Fit in a pocket."], ["Knife"], ["Sling"], ["Tinderbox"]] },
			...(insert === "boilerplate" ? BOILERPLATE : titled ? TITLED_TOOLBOX : PLAIN_TOOLBOX),
		] }]),
	]);
}

const PLAIN_TOOLBOX = [
	{ x: 423, lines: [
		H("Tester's Toolbox", "The tools inside you."),
		BOX(B("TINKER")),
		["When you tinker, you may roll +INT."],
		{ gap: 10 },
		BOX(B("MEND")),
		["Fix one thing."],
	] },
];

// A box (or a ticked box) set smaller, as a nested option's is.
const SMALL = (tick = false) => [{ t: tick ? "n4" : "n", f: "ding", size: 6 }, { t: " ", f: "ding", size: 6 }];

const TITLED_TOOLBOX = [
	{ x: 423, lines: [
		{ heading: true, size: 12, tokens: [{ t: "Tester's Toolbox", f: "heading" }, { t: " The tools inside you, waiting for", size: 8 }] },
		["a reason to come out and be used."],
		{ gap: 10 },
		TICK(B("UNFOLD")),
		["When you unfold, roll +CON: on a 10+, you take"],
		["your gadgets out; on a 7-9, they rattle. Revert"],
		["when the job is done."],
		{ gap: 10 },
		H("Gadgets", "pick 2", 9),
		BOX("Spring Fist: d6+1 (close, forceful)"),
		BOX("Tin Plate: Armor 1"),
		TICK("Humming"),
		BOX("Lenses (pick 1)"),
		{ tokens: [...SMALL(), "brass ", ...SMALL(), "glass ", ...SMALL()], indent: 10 },
		BOX(),
		{ gap: 10 },
		H("Instinct", "pick 1, follow it to fold back up", 9),
		BOX("To tinker"),
		BOX("To hoard bolts"),
	] },
	// Below the title's line, as the template sets it: the title runs across into this column.
	{ x: 599, y: 90, lines: [
		H("Tricks", "pick 1", 9),
		BOX(B("EXTRA GEAR")),
		["Choose 1 additional gadget from the Tester's"],
		["Toolbox insert."],
		{ gap: 10 },
		BOX(B("WHIRR")),
		["It whirrs. Mark XP."],
		{ gap: 10 },
		BOX(B("CLANK")),
		["It clanks, and everyone looks."],
	] },
];

// Only the stock pages beside the inventory: Followers, and the Player's Agenda and its neighbours.
const BOILERPLATE = [
	{ x: 423, lines: [
		H("Followers", "", 12),
		["Name"], ["Tags"], ["Max. HP Armor"], ["Damage"], ["Instinct"], ["Moves"],
	] },
	{ x: 599, lines: [
		H("Player's Agenda"),
		["Portray a compelling character"],
		["Engage with the fictional world"],
		H("Player's Principles"),
		["Begin and end with the fiction"],
		["Connect with the other PCs"],
		H("When in doubt..."),
		["Visualize the situation"],
		H("Hold and spend"),
		["When a move says hold, note it."],
	] },
];
