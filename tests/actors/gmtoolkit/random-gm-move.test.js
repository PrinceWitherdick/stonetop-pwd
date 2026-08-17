import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomGmMove, postGmMove } from "../../../module/gm-toolkit/random-gm-move.js";
import { BASIC_GM_MOVES, EXPLORATION_GM_MOVES, HOMEFRONT_GM_MOVES } from "../../../module/gm-toolkit/gm-moves.js";
import { escHtml } from "../../../module/utils/strings.js";

// The die beside each GM Moves heading: draw one move out of that section and whisper it to
// the GMs.
//
// The whisper is the part worth guarding. A GM move works because it arrives as fiction, so a
// card that went to the whole table would hand the players the move before the GM has made it.
// Nothing about that failure is visible from the GM's own screen: they would see their card
// exactly as they do now, and only the players would know.

const posted = [];

beforeEach(() => {
	posted.length = 0;
	globalThis.ChatMessage = {
		create: data => { posted.push(data); return Promise.resolve(data); },
		// Two GMs and a player, so "GM only" has something to actually exclude.
		getWhisperRecipients: role => role === "GM" ? [{ id: "gm1" }, { id: "gm2" }] : [{ id: "player1" }],
		getSpeaker: () => ({ alias: "GM Toolkit" }),
	};
});

afterEach(() => { delete globalThis.ChatMessage; });

describe("drawing a GM move at random", () => {
	it("draws out of the section it was asked for", () => {
		// rng 0 takes the first of a list, 0.999 the last, so the two ends pin which list was read.
		expect(randomGmMove("basic", { rng: () => 0 })).toBe(BASIC_GM_MOVES[0]);
		expect(randomGmMove("basic", { rng: () => 0.999 })).toBe(BASIC_GM_MOVES.at(-1));
		expect(randomGmMove("exploration", { rng: () => 0 })).toBe(EXPLORATION_GM_MOVES[0]);
		expect(randomGmMove("exploration", { rng: () => 0.999 })).toBe(EXPLORATION_GM_MOVES.at(-1));
		expect(randomGmMove("homefront", { rng: () => 0 })).toBe(HOMEFRONT_GM_MOVES[0]);
		expect(randomGmMove("homefront", { rng: () => 0.999 })).toBe(HOMEFRONT_GM_MOVES.at(-1));
	});

	// Math.random() never returns 1, but a stubbed rng in a test or a future seeded generator
	// can, and `moves[moves.length]` is undefined rather than an error: the card would post with
	// an empty name and no gloss.
	it("clamps an rng that returns 1 instead of indexing past the end", () => {
		expect(randomGmMove("basic", { rng: () => 1 })).toBe(BASIC_GM_MOVES.at(-1));
	});

	it("answers null for a section key that does not exist", () => {
		expect(randomGmMove("nonesuch", { rng: () => 0 })).toBeNull();
	});

	// One in seven on the shortest list, which is often enough to read as a broken button
	// rather than as luck.
	it("does not hand back the move it just drew", () => {
		const first = randomGmMove("exploration", { rng: () => 0 });
		const again = randomGmMove("exploration", { rng: () => 0, exclude: first.name });
		expect(again).not.toBe(first);
		expect(again).toBe(EXPLORATION_GM_MOVES[1]);
	});

	// The exclusion narrows the pool, so an rng at the top of its range still has to land on a
	// real move rather than one place past the shortened list.
	it("still clamps once a move has been excluded", () => {
		const last = EXPLORATION_GM_MOVES.at(-1);
		expect(randomGmMove("exploration", { rng: () => 1, exclude: last.name })).toBe(EXPLORATION_GM_MOVES.at(-2));
	});
});

// The draw and the whisper are two calls, not one: the sheet needs the answer up front to know
// which row to walk its light towards, and the card posts when the light lands.
describe("whispering the drawn move", () => {
	it("goes to the GMs and to nobody else", async () => {
		await postGmMove("basic", BASIC_GM_MOVES[0]);
		expect(posted).toHaveLength(1);
		expect(posted[0].whisper).toEqual(["gm1", "gm2"]);
	});

	// Through escHtml on both sides: this gloss carries an apostrophe, and the raw string is
	// NOT what should reach the card. The next test pins what the escaping actually produces.
	it("carries the move's name and its gloss", async () => {
		const move = await postGmMove("homefront", HOMEFRONT_GM_MOVES[0]);
		expect(move).toBe(HOMEFRONT_GM_MOVES[0]);
		expect(posted[0].content).toContain(escHtml(HOMEFRONT_GM_MOVES[0].name));
		expect(posted[0].content).toContain(escHtml(HOMEFRONT_GM_MOVES[0].gloss));
	});

	// moveChatCard renders its description RAW, because its usual caller passes text that was
	// escaped at storage. These glosses are plain prose out of module source, and one of them
	// is quoted speech.
	it("escapes a gloss that carries quote marks", async () => {
		const quoted = BASIC_GM_MOVES.find(m => m.gloss.includes('"'));
		expect(quoted, "no quoted gloss left to test the escaping with").toBeTruthy();
		await postGmMove("basic", quoted);
		expect(posted[0].content).toContain("&quot;If you do that");
	});

	// The section's NAME, on its own. The frame gets one line: a prompt ("Make a GM move") only
	// restates what the card is, and the section's note ("On an expedition, or inside a site")
	// is a rule about when to reach for the list, not something a GM reads a drawn move for.
	it("heads the card with the section's name, and nothing under it", async () => {
		await postGmMove("exploration", EXPLORATION_GM_MOVES[0]);
		expect(posted[0].content).toContain("Exploration");
		expect(posted[0].content).not.toContain("Make a GM move");
		expect(posted[0].content).not.toContain("On an expedition, or inside a site");
		// The sub-line span is what a two-part title renders; a one-line title must not emit it.
		expect(posted[0].content).not.toContain("stonetop-chat-title-sub");
	});

	it("passes the speaker through, and posts nothing without a move or a section", async () => {
		await postGmMove("basic", BASIC_GM_MOVES[0], { speaker: { alias: "GM Toolkit" } });
		expect(posted[0].speaker).toEqual({ alias: "GM Toolkit" });

		expect(await postGmMove("nonesuch", BASIC_GM_MOVES[0])).toBeNull();
		expect(await postGmMove("basic", null)).toBeNull();
		expect(posted).toHaveLength(1);
	});

	// Chat is not up during early world setup, and the sheet can be rendered by a test harness
	// that never installs it. Neither should throw.
	it("no-ops when chat is not available", async () => {
		delete globalThis.ChatMessage;
		expect(await postGmMove("basic", BASIC_GM_MOVES[0])).toBeNull();
	});
});
