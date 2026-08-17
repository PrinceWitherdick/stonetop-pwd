import { describe, it, expect, vi, beforeEach } from "vitest";
import { offerDurableArtOnce } from "../../module/book2-art/offer-once.js";

// The once-per-world offer about art already on disk. Its latch is world-scoped but is written
// LAST, after findWork and offer have both awaited — so the "asked already?" check alone does
// not make it once-per-world when two GMs are connected. Both pass it, and the world gets two
// identical cards. The primary-GM gate belongs in here rather than at each call site: WorldSetup's
// caller had one and both of Ready.js's did not.

let elected = "gm-1";

vi.mock("../../module/utils/primary-gm.js", () => ({
	isPrimaryGM: () => globalThis.game?.user?.id === elected,
}));

const settings = new Map();

vi.mock("../../module/settings.js", () => ({
	getSetting: (key) => settings.get(key),
	setSetting: async (key, value) => { settings.set(key, value); },
}));

function connect({ isGM = true, id = "gm-1" } = {}) {
	globalThis.game = { user: { isGM, id } };
}

function spec(over = {}) {
	return {
		setting: "partialArtImportOffered",
		findWork: vi.fn().mockResolvedValue({ missing: 12 }),
		offer: vi.fn().mockResolvedValue(true),
		...over,
	};
}

beforeEach(() => {
	settings.clear();
	elected = "gm-1";
	connect();
});

describe("offerDurableArtOnce", () => {
	it("asks, then latches", async () => {
		const s = spec();
		await offerDurableArtOnce(s);

		expect(s.offer).toHaveBeenCalledWith({ missing: 12 });
		expect(settings.get("partialArtImportOffered")).toBe(true);
	});

	it("never asks twice", async () => {
		const s = spec();
		await offerDurableArtOnce(s);
		await offerDurableArtOnce(s);

		expect(s.offer).toHaveBeenCalledTimes(1);
	});

	// Only ONE GM asks. The second connected GM would otherwise whisper the same card, because
	// the latch is not written until after the awaits above.
	it("stays quiet for a second connected GM", async () => {
		connect({ id: "gm-2" });
		const s = spec();

		await offerDurableArtOnce(s);

		expect(s.findWork).not.toHaveBeenCalled();
		expect(s.offer).not.toHaveBeenCalled();
		expect(settings.has("partialArtImportOffered")).toBe(false);
	});

	// isPrimaryGM() alone is true when NO GM is connected, so the gate is paired with isGM.
	it("stays quiet for a lone player", async () => {
		connect({ isGM: false, id: "gm-1" });
		const s = spec();

		await offerDurableArtOnce(s);

		expect(s.offer).not.toHaveBeenCalled();
	});

	it("leaves the latch unset when there is nothing to offer, so a later import still gets asked", async () => {
		const s = spec({ findWork: vi.fn().mockResolvedValue(null) });
		await offerDurableArtOnce(s);

		expect(s.offer).not.toHaveBeenCalled();
		expect(settings.has("partialArtImportOffered")).toBe(false);
	});

	// Chat not being ready is not an answer either.
	it("leaves the latch unset when the offer could not be presented", async () => {
		const s = spec({ offer: vi.fn().mockResolvedValue(false) });
		await offerDurableArtOnce(s);

		expect(settings.has("partialArtImportOffered")).toBe(false);
	});
});
