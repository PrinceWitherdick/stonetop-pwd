// The book's own words for the GM's side of followers, held in one place for the "They balk" card
// (follower-balk.js) and the End of Session window's follower review (dialogs/EndOfSessionDialog.js). Transcribed from Book I, not paraphrased (tests/gm-toolkit/follower-text.test.js
// quotes the source): the reasons a follower resists an order and what the player can do about it (p.466),
// and the between-session review (p.480, "Updating followers").

/** "They might resist orders if..." (p.466), plus fear from the same page, as the GM's reasons to pick from. */
export const BALK_REASONS = Object.freeze([
	Object.freeze({ key: "scared", text: "They might freeze up when surprised, or flee from a terrifying foe, or panic in the face of supernatural horror." }),
	Object.freeze({ key: "overwhelmed", text: "They're angry, miserable, shocked, or otherwise overwhelmed." }),
	Object.freeze({ key: "unreasonable", text: "The order is unreasonable, foolish, degrading, distasteful, etc." }),
	Object.freeze({ key: "against", text: "The order goes against the follower's instinct, tags, cost, or other traits." }),
]);

/** What the player can do once the GM reveals it (p.466). */
export const BALK_RULE = "The player can then choose to spend the follower's Loyalty (if they hold any) to have them \"do something they don't want to do.\" Or the PC can Persuade the follower, or use a different move to convince them. Or they could let it drop and do something else.";

/** "Between sessions, review any followers that the PCs have. For each one, if..." (p.480). */
export const REVIEW_LEAD = "Between sessions, review any followers that the PCs have. For each one, if...";
export const REVIEW_ITEMS = Object.freeze([
	"... their instinct and/or cost no longer ring true, then revise them.",
	"... any of their tags or moves no longer ring true, then delete them or revise them, whichever makes more sense.",
	"... they've shown a new aptitude, skill or behavior, consider adding it as a tag or move.",
	"... they've become more resilient, or less so (due to personal growth, injury, illness, etc.), then adjust their max HP accordingly.",
	"... they've become considerably more or less dangerous, then adjust their damage die.",
	"... they've become a source of ongoing, active trouble for one of the PCs or the village at large, write them up as a threat (page 277) in addition to or instead of being a follower.",
	"... it's a group follower, did anyone leave the group, or join it? Update the group's roster to reflect this.",
	"... they no longer look to the PC for leadership, or would no longer take orders from them, then they're not a follower anymore.",
	"... they shift their loyalty from one PC to another (or their current leader passes off responsibility for them to another PC), then tell the players, and maybe demonstrate it via a scene in the next session. Tell the players to update their notes accordingly.",
]);
