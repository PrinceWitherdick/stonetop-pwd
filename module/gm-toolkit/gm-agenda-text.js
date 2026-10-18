// RUNNING THE GAME, as reference: the GM's agenda, principles, the Line and what not to do (Book I
// pp.168, 192-203), and the first adventure's prep (pp.251-273). Shown on the GM Toolkit's Core Loop
// tab under the two flowcharts, in the house shape gm-moves.js uses: a name and one line.
//
// Reference only. Nothing here rolls and nothing here is stored.
//
// TRANSCRIPTION RULES, as gm-moves.js: the `name` is the book's own heading or bullet, worded as the
// book prints it. The `line` is the book's words where a sentence of it stands alone (quotes and
// ellipses normalized to ASCII), and a close condensation of the book's paragraph where none does;
// either way it adds nothing the book does not say. The book text is CC BY-SA.
//
// The first adventure's per-result guidance (FIRST_ADVENTURE_HOOKS) is also what the Let Spring
// Burst Forth walkthrough shows under "What hook does it open?" (SpringBurstDialog.js), so the
// tab and the walkthrough read one table.

/** @typedef {{ name: string, line: string, page?: number }} GmRefEntry */

/** Your agenda (Book I p.168). "These are your goals when running Stonetop." */
export const GM_AGENDA = {
	page: 168,
	items: [
		{ name: "Portray a rich and mysterious world", line: "Alive and breathing, filled with detail and humanity and depth. Mundane concerns matter; fantastic elements are strange, scary and poorly understood." },
		{ name: "Punctuate the characters' lives with adventure", line: "Make their lives matter, but interrupt them with threats and opportunities that only the PCs can (or will) address." },
		{ name: "Play to find out what happens", line: "Once play begins, follow where the players lead, where the dice lead, and where the fiction leads." },
	],
	note: "Everything you say and do as the GM is meant to support these three goals, and no others. If something you're considering supports none of them, don't do it. Do something else.",
};

/** Your principles (Book I pp.192-199), in the book's order. */
export const GM_PRINCIPLES = [
	{ name: "Follow the rules", page: 192, line: "When a move is triggered, follow its procedures. Give the players the full benefits of their moves and rolls; don't fudge the results." },
	{ name: "Begin and end with the fiction", page: 193, line: "Fiction, then rules, then back to fiction. Always." },
	{ name: "Address the characters, not the players", page: 193, line: "Ask the characters what they do. Tell the characters what they see and hear." },
	{ name: "Ask questions and build on the answers", page: 194, line: "Ask questions all the time, all over the place, then reincorporate the answers into the fiction." },
	{ name: "Be a fan of the player characters", page: 195, line: "Keep the focus on them and root for them. You're the author of their adversity, but give them opportunities too." },
	{ name: "Embrace the fantastic and the mundane", page: 196, line: "Play up spirits, monsters and the Makers, but ground the game in human concerns: seasons, harvest, neighbors." },
	{ name: "Exploit the setting guide", page: 196, line: "Use it to inspire, but don't feel beholden to it. It's safer to change specific details than broad themes." },
	{ name: "Respect your prep", page: 197, line: "Decisions you've made in prep are fictional truth. Describe the world and make moves with them in mind." },
	{ name: "Give your characters life", page: 197, line: "Name your NPCs. Give them distinct personalities, wants, needs and quirks. Don't let PCs walk all over them." },
	{ name: "Think offscreen, too", page: 198, line: "What are your NPCs and monsters doing? What traces did they leave? Weave the answers into what you say." },
	{ name: "Bring it home", page: 198, line: "Make the village of Stonetop itself the foundation of your game, the beginning and end of the PCs' adventures." },
	{ name: "Let things breathe", page: 199, line: "Let stretches of time pass. Have weeks or months go by with a single statement." },
	{ name: "Let things burn", page: 199, line: "Protect no one and nothing. Threaten what they love, and if they fail to save it, follow through." },
];

/** The Line (Book I p.195): who is responsible for what, and the questions that blur it. */
export const GM_THE_LINE = {
	page: 195,
	items: [
		{ name: "The players", line: "In charge of their characters: what they do and say; what they feel and think; how they live; their past experiences." },
		{ name: "The GM", line: "In charge of the world: the environment, the NPCs, the dangers and the discoveries." },
		{ name: "Blurring the Line", line: "Some questions ask a player to make up the world. Address the character instead: ask about something they know, have heard, or have experienced." },
		{ name: "Not for everyone", line: "Some players find it takes them out of the game. Adjust the questions you ask, and how you ask them, to fit your and your players' preferences." },
	],
};

/** What not to do (Book I p.202), each with the book's "Instead". */
export const GM_DONTS = {
	page: 202,
	items: [
		{ name: "Don't plan a storyline or a plot", line: "Or their arcs, or dramatic moments, or how a task will go. Instead: prep situations, encounters, places to explore, and threats with actionable instincts." },
		{ name: "Don't tell them what to roll before they've told you what they're doing", line: "Instead: make your soft GM move and ask, \"What do you do?\" Then decide together which move, if any, they triggered." },
		{ name: "Don't make them roll \"just because\"", line: "No perception checks. Instead, make a soft move that hints at what's there (\"the crickets have all gone quiet\") and run the game from their response." },
		{ name: "Don't stop making GM moves, especially when they roll 10+", line: "The fiction churns along and bad guys keep doing bad things. Think how the foes respond, make a move, then ask \"What do you do?\"" },
	],
};

/**
 * The first adventure's prep, step by step (Book I pp.255-273): what to have written down before the
 * second session starts.
 */
export const FIRST_ADVENTURE_PREP = {
	page: 251,
	goals: [
		"Paint a picture of daily life",
		"Explore relationships",
		"Identify what's important to them",
		"Push them into the field",
		"Establish details, but leave blanks",
		"Play up both the mundane and the mysterious",
		"Draw them back home",
	],
	steps: [
		{ name: "Identify the central threat or opportunity", page: 255, line: "The Seasons Change roll at the end of introductions (and the gain they picked) tells you which. See below." },
		{ name: "Write up your threat(s)", page: 260, line: "Try for an impending doom, and make the first grim portent the hook. Give related threats at least a type and an instinct." },
		{ name: "Refine your hook", page: 261, line: "What exactly happens, when, where, who's involved, who reports it? Make it actionable, involve all of the PCs, and communicate urgency." },
		{ name: "Setup questions", page: 262, line: "Loaded questions that establish key details, highlight relevant setting elements, foreshadow, and make things personal. Ask each character; oldest events first." },
		{ name: "Set the scene", page: 268, line: "Work back from the hook: what time of day, where in the village. Jot down a sentence or two of scene, the questions you'll ask, and the homefront moves you'll make." },
		{ name: "Drop the hook", page: 270, line: "Write down the moves you'll make to introduce the threat or opportunity, how they'll manifest, and any questions." },
		{ name: "Reactions", page: 270, line: "Note the NPCs likely to be there, the moves you'll make through them, and your questions. Lean heavily on the homefront moves." },
		{ name: "If they ignore the hook", page: 272, line: "Don't force them. Jot down a few moves that show the consequences of inaction, leaning on the threat's grim portents." },
	],
	// The opening scene's moves (p.268): "work off this list". The Homefront GM moves, as the book
	// lists them there.
	sceneMoves: [
		"Introduce someone interesting",
		"Reveal simmering tensions",
		"Present a want or need",
		"Show how others really feel",
		"Draw out their feelings",
		"Change a relationship",
		"Oppose their wishes",
		"Remind them of their obligations",
		"Start a conflict or crisis",
		"Play them against each other",
	],
	sceneCaution: "Avoid serious conflicts or dramatic reveals: you're establishing daily life (including daily drama), not setting things on fire. Not yet.",
};

/**
 * Turning the first Seasons Change into the hook (Book I pp.255-259), by result and by the gain they
 * picked. `gain` is the key spring-burst-data.js#SEASONAL_GAINS gives the same gain, so the
 * walkthrough can mark the rows for what was ticked.
 */
export const FIRST_ADVENTURE_HOOKS = [
	{
		key: "success", tier: "10+", name: "An opportunity", page: 255,
		line: "External, so as to get the PCs out of the steading, but nearby, within a few days of Stonetop, so they can get there and back with a modest amount of rations.",
		gains: [
			{ gain: "news", name: "Interesting news", line: "Pick a steading improvement and one of its requirements, or another goal from introductions. What would put it in reach, and how could the PCs learn of it?" },
			{ gain: "insight", name: "Valuable insight", line: "Pick a threat from introductions (or ask what the roller is most worried about). Why hasn't it been dealt with? What would let them act on it, and how is that revealed?" },
			{ gain: "trade", name: "Trade opportunity", line: "Something from the Special Items list that would benefit the town, something of symbolic value, a minor arcanum, or an exotic mundane item. Who offers it, what do they want, and why Stonetop?" },
		],
	},
	{
		key: "partial", tier: "7-9", name: "A threat and a gain", page: 257,
		line: "The threat is the focus; the gain shapes how it shows itself. Make it external, nearby, Stonetop's problem (no one else will deal with it), and urgent. Why has it become a problem now?",
		gains: [
			{ gain: "news", name: "Interesting news", line: "Tie a goal or a step towards an improvement to the threat: they learn of the threat by pursuing the opportunity, or the opportunity comes of the threat." },
			{ gain: "insight", name: "Valuable insight", line: "The threat makes itself known or gets worse, in a way that reveals something useful about how to address it or what's causing it." },
			{ gain: "bounty", name: "Unexpected bounty", line: "Reveal the threat in the course of collecting the bounty: pick one (trade, game, valuables found in the Wood) that puts villagers in its path." },
			{ gain: "trade", name: "Trade opportunity", line: "A neighbor affected by the threat, or who meets it on the way, makes the offer; link the two, or have them report it. Or: a neighbor provides a Value 3 Special Item for something that puts villagers in the threat's path." },
			{ gain: "tor", name: "Tor's blessing", line: "Use the fine weather as an excuse to put villagers in the path of the threat." },
			{ gain: "population", name: "Population boom", line: "Tie the threat to a new arrival, or to one or more youths who recently came of age." },
		],
	},
	{
		key: "failure", tier: "6-", name: "Threats abound", page: 258,
		line: "Start bad and get worse. Pick one main threat (from introductions if you can) and keep the rest simmering. Make it external, nearby, Stonetop's problem and urgent. It should be pretty bad already, likely triggering Meet With Disaster.",
		gains: [],
	},
];
