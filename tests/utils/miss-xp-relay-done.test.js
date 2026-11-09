import { describe, expect, it } from "vitest";
import { missXpRelayDone } from "../../module/utils/roll-engine.js";
import { NO_ANSWER } from "../../module/utils/relay-landed.js";
import { MISS_XP_STATE_FLAG } from "../../module/utils/undo-xp-mark.js";

// A miss's XP is marked on the card's writer, the GM's client for a player's card. An answer that never came in
// time used to be read as "the GM did nothing", so the player's client marked it too, and a GM's turn that was
// only queued behind another write then landed a second mark (audit EDG-15, 2026-11-06).

const card = (state = undefined) => ({ id: "c", getFlag: (_scope, key) => (key === MISS_XP_STATE_FLAG ? state : undefined) });

describe("a miss's XP press relayed to the GM", () => {
	it("takes the GM's own answer as it is", async () => {
		expect(await missXpRelayDone(card(), true)).toBe(true);
		expect(await missXpRelayDone(card(), null)).toBeNull();
	});

	it("with no answer in time, waits on the card and marks nothing here once the GM's turn recorded it", async () => {
		const marked = card("marked");
		let asked = null;
		const landed = async (message, read) => { asked = message; return read(); };
		expect(await missXpRelayDone(marked, NO_ANSWER, { landed })).toBe(true);
		expect(asked).toBe(marked);
		// "none" is a decision too: the GM read the card as no miss after all.
		expect(await missXpRelayDone(card("none"), NO_ANSWER, { landed })).toBe(true);
	});

	it("leaves the mark to this client when the GM's turn never wrote the card", async () => {
		const landed = async (_message, read) => read();
		expect(await missXpRelayDone(card(), NO_ANSWER, { landed })).toBeNull();
	});
});
