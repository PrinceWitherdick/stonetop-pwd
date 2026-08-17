import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { updatePlacedTokens } from "../../module/utils/placed-tokens.js";

// The shared per-scene sweep behind the three places that have to reach past `prototypeToken`:
// the nameplate backfill and the shoot-marker lift in hooks/Ready.js, and the crop re-point in
// utils/portrait-token-frame.js. Each of those wrote this by hand before, and they had already
// drifted on error handling.

const scene = (name, tokens) => ({ name, tokens, updateEmbeddedDocuments: vi.fn(async () => {}) });
const sent = (s) => s.updateEmbeddedDocuments.mock.calls[0]?.[1] ?? [];

const STALE = { id: "a", displayName: 0 };
const NAMED = { id: "b", displayName: 2 };

beforeEach(() => { globalThis.game = { scenes: [] }; });
afterEach(() => { delete globalThis.game; });

describe("updatePlacedTokens", () => {
	it("sends one batched request per affected scene, carrying each token's own id", async () => {
		const one = scene("Camp", [STALE, NAMED, { id: "c", displayName: 0 }]);
		globalThis.game.scenes = [one];

		const moved = await updatePlacedTokens(t => !t.displayName, () => ({ displayName: 2 }));

		expect(moved).toBe(2);
		expect(one.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
		expect(sent(one)).toEqual([{ _id: "a", displayName: 2 }, { _id: "c", displayName: 2 }]);
	});

	it("asks nothing of a scene with nothing to change", async () => {
		// The common case by far: every one of these sweeps is idempotent and runs on every load,
		// so after the first pass this is every scene in the world.
		const quiet = scene("Quiet", [NAMED]);
		globalThis.game.scenes = [quiet];

		expect(await updatePlacedTokens(t => !t.displayName, () => ({ displayName: 2 }))).toBe(0);
		expect(quiet.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("lets the patch decline a token the match let through", async () => {
		const one = scene("Camp", [{ id: "a", src: "old" }, { id: "b", src: "" }]);
		globalThis.game.scenes = [one];

		const moved = await updatePlacedTokens(() => true, t => (t.src ? { "texture.src": "new" } : null));

		expect(moved).toBe(1);
		expect(sent(one)).toEqual([{ _id: "a", "texture.src": "new" }]);
	});

	it("keeps going when one scene refuses the write, and doesn't count it", async () => {
		// Best-effort per scene: every caller has already saved the thing that matters (the
		// prototype, the frame, the actor) before reaching here, and all of them are idempotent —
		// so a scene this user may not write to must not take the scenes behind it down with it.
		const refuses = scene("Locked", [STALE]);
		refuses.updateEmbeddedDocuments = vi.fn(async () => { throw new Error("User lacks permission"); });
		const allows = scene("Camp", [STALE]);
		globalThis.game.scenes = [refuses, allows];
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const moved = await updatePlacedTokens(t => !t.displayName, () => ({ displayName: 2 }), { what: "name" });

		expect(moved).toBe(1);
		expect(allows.updateEmbeddedDocuments).toHaveBeenCalled();
		expect(warn.mock.calls[0][0]).toContain('could not name the placed tokens on "Locked"');
		warn.mockRestore();
	});

	it("survives a world with no scenes, and a scene with no tokens", async () => {
		expect(await updatePlacedTokens(() => true, () => ({ x: 1 }))).toBe(0);
		globalThis.game.scenes = [{ name: "Empty", updateEmbeddedDocuments: vi.fn() }];
		expect(await updatePlacedTokens(() => true, () => ({ x: 1 }))).toBe(0);
	});
});
