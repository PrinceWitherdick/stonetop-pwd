// The two GM playbook flowcharts, as TEXT.
//
// The pictures are the publisher's artwork and ship nowhere: a GM imports them from their own
// copy of the free GM playbook and until then the Core Loop tab draws a labelled gap (see
// gm-diagrams.js). What the pictures SAY, though, is rules text like any other list on this sheet,
// and Book I prints the same procedure in prose at p.169. So the tab carries the text always, and
// the artwork above it when a world has it.
//
// That ordering is deliberate: the diagram is a nicer thing to look at, but the text is the thing
// that can be READ on a 300px-tall figure, and a GM who has not run the import should not meet a
// tab that is only an apology.
//
// Steps, not paragraphs. The flowcharts are a numbered loop and a campaign cycle, and flattening
// either into prose would lose the one thing a chart is for: what follows what.

/** @typedef {{ name: string, page?: number, items: string[], note?: string }} GmLoopStep */

/**
 * The core loop, Book I p.169. One exchange at the table, start to finish.
 *
 * Step 4's branches are the game's whole GM-facing procedure ("if they roll a 6-, make a hard GM
 * move"), which is why they are spelled out here rather than summarized: this is the list a GM
 * checks when they are not sure whether they owe the table a move.
 */
export const GM_CORE_LOOP = [
	{
		name: "Establish the situation",
		items: [
			"Frame the action",
			"Describe the environment",
			"Give details and specifics",
			"Ask questions, ask for input",
			"Portray NPCs and monsters",
			"Answer questions, clarify",
		],
	},
	{
		name: "Make a soft GM move",
		items: ["Provoke action, and/or", "Increase tension"],
	},
	{
		name: "Ask \"What do you do?\"",
		items: [],
	},
	{
		name: "Resolve their actions",
		items: [
			"If they trigger a player move, do what the move says.",
			"If they roll a 6- or they ignore trouble, make a hard GM move (establish badness).",
			"Otherwise, say what happens.",
		],
	},
	{
		name: "Repeat",
		items: [
			"Is the situation clear and compelling? Can the PCs act? Back to step 3.",
			"Is the situation clear, but escalating before the PCs act? Back to step 2.",
			"Is the situation clear, but needs a nudge? Back to step 2.",
			"Is the situation unclear? Does it need recapping or updating? Back to step 1.",
			"Is the current scene or situation over? Wrap up, look for the next one. Back to step 1.",
		],
	},
];

/**
 * The flow of play across a campaign, the second flowchart. Each stage names the Book I chapter
 * that runs it, which is what makes the chart useful as an index as well as a map: a GM who knows
 * they are heading into downtime has the page number in front of them.
 */
export const GM_FLOW_OF_PLAY = [
	{
		name: "First adventure",
		page: 251,
		items: ["Setup questions", "Set the scene (at home)", "Drop your hook", "See how folks react"],
	},
	{
		name: "Expedition",
		page: 301,
		items: ["Preparations", "Legs of travel and points of interest", "Challenges, surprises, resolution"],
		note: "Where the PCs head out in response to the hook.",
	},
	{
		name: "Aftermath",
		page: 490,
		items: ["Determine what's happened", "Play out the return", "See what follows", "Transition to downtime"],
	},
	{
		name: "Crisis",
		page: 499,
		items: ["Trouble erupts at home", "Play it out, see what happens", "Quite possibly Meet With Disaster"],
		note: "Where the PCs stay home, or where a hard GM move lands while they are away.",
	},
	{
		name: "Downtime",
		page: 496,
		items: ["Zoom out, deal with logistics", "Establish goals and intentions", "Play out situations as needed", "Show the passing of time"],
	},
	{
		name: "Seasons Change",
		page: 516,
		items: ["Zoom out, deal with logistics", "Establish goals and intentions", "Play out situations as needed", "Show the passing of time"],
		note: "And out of it: an opportunity or a threat, or quiet for now.",
	},
];
