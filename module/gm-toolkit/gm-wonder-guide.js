// What Book I says about the "I wonder..." list (p.33), plus the two later chapters that send a
// GM back to it (Sites p.381, p.418).
//
// The GM playbook prints this as four lines beside a column of ruled ones: "Keep a running list
// of open questions that either... you don't know how to answer yet, or... you want to answer via
// play. Update this list between each session." That is the whole instruction, and it is enough
// to keep the list but not enough to USE it, which is what the book's own page adds: when to
// write on it, when to read it, and what reading it is for. So the tab carries the fuller version,
// folded shut, the same way the Threats tab carries its prep reference.
//
// Same transcription rules as gm-moves.js: the book's wording, curly quotes
// normalized to ASCII, cross-references dropped where the sentence stands without them, nothing
// reworded for its own sake. Where a line gathers guidance the book gives in a different chapter,
// it says which page it came from.

/** @typedef {{ name: string, page: number, items: string[] }} GmWonderGuideSection */

/** The three things a GM does with the list, in the order the book introduces them. */
export const GM_WONDER_GUIDE = [
	{
		name: "What goes on it",
		page: 33,
		items: [
			"Open questions: things that you wonder about, but either you don't know how to answer yet, or you want to leave unanswered for now and see it get answered through play.",
			"A threat your notes imply, when the threat's nature isn't entirely clear yet.",
			"A connection between the setting and the PCs that you think might be true, but aren't sure about.",
			"A question a site raised that you couldn't answer while writing it up, or that turned out to be the wrong question (p.418).",
		],
	},
	{
		name: "Between sessions",
		page: 33,
		items: [
			"Update the questions. If a question has been answered, remove it. If a new question occurs to you, add it to the list.",
			"Refer to them as you prepare. Use the list to help identify the adventure's central opportunity or threat, or to help write the setup questions that you'll ask the characters.",
			"Read them again when you write up a site: the list is one of the places a site's own mysteries come from (p.381).",
		],
	},
	{
		name: "During the session",
		page: 33,
		items: [
			"Refer to this list when you need something interesting to say.",
			"Can you say something that answers one of these questions? Or that hints at the answer?",
			"Can you turn one of these questions back on the characters, and ask them to give you the answers?",
		],
	},
];
