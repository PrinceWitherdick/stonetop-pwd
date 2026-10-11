import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomGmMove, postGmMove, shareGmMove, wireGmMoveShare } from "../../../module/gm-toolkit/random-gm-move.js";
import { BASIC_GM_MOVES, EXPLORATION_GM_MOVES, HOMEFRONT_GM_MOVES } from "../../../module/gm-toolkit/gm-moves.js";
import { escHtml } from "../../../module/utils/strings.js";

// The die beside each GM Moves heading: draw one move out of that section and whisper it to the
// GMs, with a "Share with Players" button that makes the card public.
//
// WHO IT REACHES is the part worth guarding. Nothing about a card that quietly went public would
// be visible from the GM's own screen — they would see it exactly as they do now, and only the
// players would know they had started seeing it.

const posted = [];

beforeEach(() => {
	posted.length = 0;
	globalThis.ChatMessage = {
		create: data => { posted.push(data); return Promise.resolve(data); },
		// A player in the list too, so a card that whispered to "everyone" would be caught.
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

// The draw and the post are two calls, not one: the sheet needs the answer up front to know
// which row to walk its light towards, and the card posts when the light lands.
describe("posting the drawn move", () => {
	it("is whispered to every GM, and to nobody else", async () => {
		await postGmMove("basic", BASIC_GM_MOVES[0]);
		expect(posted).toHaveLength(1);
		expect(posted[0].whisper).toEqual(["gm1", "gm2"]);
	});

	it("carries a Share with Players button", async () => {
		await postGmMove("basic", BASIC_GM_MOVES[0]);
		expect(posted[0].content).toContain('class="stonetop-gm-move-share"');
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

// The card's button: core's "Reveal to Everyone", on the card, for a GM.
describe("sharing a GM move card with the players", () => {
	afterEach(() => { delete globalThis.game; });

	function fakeMessage(whisper) {
		const updates = [];
		return { updates, whisper, update: data => { updates.push(data); return Promise.resolve(); } };
	}
	function cardHtml() {
		const actions = { removed: false, remove() { this.removed = true; } };
		const listeners = {};
		const btn = {
			disabled: false,
			closest: sel => sel === ".stonetop-gm-move-card-actions" ? actions : null,
			addEventListener: (type, fn) => { listeners[type] = fn; },
		};
		return { actions, btn, listeners, html: { querySelector: sel => sel === ".stonetop-gm-move-share" ? btn : null } };
	}

	it("empties the whisper list and clears blind, for a GM", async () => {
		globalThis.game = { user: { isGM: true } };
		const message = fakeMessage(["gm1"]);
		expect(await shareGmMove(message)).toBe(true);
		expect(message.updates).toEqual([{ whisper: [], blind: false }]);
	});

	it("does nothing for a player, or for a card already public", async () => {
		globalThis.game = { user: { isGM: false } };
		const whispered = fakeMessage(["gm1"]);
		expect(await shareGmMove(whispered)).toBe(false);
		globalThis.game = { user: { isGM: true } };
		const shared = fakeMessage([]);
		expect(await shareGmMove(shared)).toBe(false);
		expect([...whispered.updates, ...shared.updates]).toEqual([]);
	});

	it("wires the button for a GM on a whispered card, and the click shares it", async () => {
		globalThis.game = { user: { isGM: true } };
		const message = fakeMessage(["gm1"]);
		const { actions, btn, listeners, html } = cardHtml();
		wireGmMoveShare(message, html);
		expect(actions.removed).toBe(false);
		await listeners.click();
		expect(btn.disabled).toBe(true);
		expect(message.updates).toEqual([{ whisper: [], blind: false }]);
	});

	// A dropped socket or a hook that throws must not leave the button greyed out with nobody told.
	it("says so, and lets the GM try again, when the share is refused", async () => {
		globalThis.game = { user: { isGM: true } };
		const message = { whisper: ["gm1"], update: () => Promise.reject(new Error("socket dropped")) };
		const { btn, listeners, html } = cardHtml();
		const notify = vi.spyOn(ui.notifications, "error").mockImplementation(() => {});
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		wireGmMoveShare(message, html);
		await listeners.click();
		expect(btn.disabled).toBe(false);
		expect(notify).toHaveBeenCalledWith("stonetop.gmToolkit.moves.shareFailed");
		notify.mockRestore();
		log.mockRestore();
	});

	// A player only ever sees the card once it is shared, and by then the button has done its job.
	it("drops the button for a player, and for anyone once the card is public", () => {
		globalThis.game = { user: { isGM: false } };
		const forPlayer = cardHtml();
		wireGmMoveShare(fakeMessage([]), forPlayer.html);
		expect(forPlayer.actions.removed).toBe(true);
		expect(forPlayer.listeners.click).toBeUndefined();

		globalThis.game = { user: { isGM: true } };
		const shared = cardHtml();
		wireGmMoveShare(fakeMessage([]), shared.html);
		expect(shared.actions.removed).toBe(true);
	});
});
