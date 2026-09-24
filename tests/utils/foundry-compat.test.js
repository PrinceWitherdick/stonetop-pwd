import { describe, it, expect, vi, afterEach } from "vitest";
import { chatModeIsPublic, deletionEntry, getDragEventData, hasVideoExtension, imagePopout, imagePopoutTitle, setAppOption } from "../../module/utils/foundry-compat.js";

describe("deletionEntry", () => {
	afterEach(() => {
		// Restore the operator class that tests/setup.js installs, and clear the version stub.
		globalThis.foundry = { ...(globalThis.foundry ?? {}), data: { operators: { ForcedDeletion: class ForcedDeletion {} } } };
		delete globalThis.game;
	});

	it("uses a fresh ForcedDeletion INSTANCE on v14+ (key path unchanged)", () => {
		globalThis.game = { release: { generation: 14 } };
		const ForcedDeletion = foundry.data.operators.ForcedDeletion;
		const [key, val] = deletionEntry("flags.stonetop.checks.c1");
		expect(key).toBe("flags.stonetop.checks.c1");
		// Core removes a key only when the value is `instanceof ForcedDeletion` — the
		// class itself would NOT match, so we must hand back a `new` instance.
		expect(val).toBeInstanceOf(ForcedDeletion);
		// A nested key path is left intact for the instance form.
		const [key2, val2] = deletionEntry("flags.stonetop.arcana.minorDraw");
		expect(key2).toBe("flags.stonetop.arcana.minorDraw");
		expect(val2).toBeInstanceOf(ForcedDeletion);
	});

	it("uses the `-=leaf`/null form on v13 even though the operator class exists", () => {
		// v13 exposes ForcedDeletion but doesn't apply a nested one via update() — the key
		// would silently survive. Gate on the running generation, not the class's presence.
		globalThis.game = { release: { generation: 13 } };
		expect(foundry.data.operators.ForcedDeletion).toBeTypeOf("function");
		expect(deletionEntry("flags.stonetop.checks.c1")).toEqual(["flags.stonetop.checks.-=c1", null]);
		expect(deletionEntry("flags.stonetop.customFollowers.abc123")).toEqual(["flags.stonetop.customFollowers.-=abc123", null]);
	});

	it("falls back to the legacy `-=leaf`/null form on v12 (no sentinel)", () => {
		globalThis.game = { release: { generation: 12 } };
		foundry.data.operators = undefined;
		expect(deletionEntry("flags.stonetop.checks.c1")).toEqual(["flags.stonetop.checks.-=c1", null]);
		expect(deletionEntry("flags.stonetop.arcana.minorDraw")).toEqual(["flags.stonetop.arcana.-=minorDraw", null]);
	});
});

describe("getDragEventData", () => {
	afterEach(() => {
		delete globalThis.TextEditor;
		globalThis.foundry = { ...(globalThis.foundry ?? {}), data: { operators: { ForcedDeletion: class ForcedDeletion {} } } };
	});

	it("prefers the V13 namespaced TextEditor implementation", () => {
		const ev = {};
		const ns = vi.fn(() => ({ type: "Actor", uuid: "x" }));
		globalThis.foundry = { ...(globalThis.foundry ?? {}), applications: { ux: { TextEditor: { implementation: { getDragEventData: ns } } } } };
		globalThis.TextEditor = { getDragEventData: vi.fn(() => ({ type: "global" })) };

		expect(getDragEventData(ev)).toEqual({ type: "Actor", uuid: "x" });
		expect(ns).toHaveBeenCalledWith(ev);
		expect(globalThis.TextEditor.getDragEventData).not.toHaveBeenCalled();
	});

	it("falls back to the bare global when the namespaced impl is absent (v12)", () => {
		globalThis.foundry = { ...(globalThis.foundry ?? {}), applications: undefined };
		globalThis.TextEditor = { getDragEventData: vi.fn(() => ({ type: "global" })) };

		expect(getDragEventData({})).toEqual({ type: "global" });
	});
});

describe("hasVideoExtension", () => {
	afterEach(() => { delete globalThis.VideoHelper; });

	it("asks core's VideoHelper when one is reachable", () => {
		globalThis.VideoHelper = { hasVideoExtension: vi.fn(() => true) };
		expect(hasVideoExtension("wren.webp")).toBe(true);
		expect(globalThis.VideoHelper.hasVideoExtension).toHaveBeenCalledWith("wren.webp");
	});

	it("falls back to core's own extension list with no helper in reach", () => {
		expect(hasVideoExtension("wren.webm")).toBe(true);
		expect(hasVideoExtension("wren.mp4?v=2")).toBe(true);
		expect(hasVideoExtension("wren.webp")).toBe(false);
		expect(hasVideoExtension(null)).toBe(false);
	});
});

describe("setAppOption", () => {
	it("swaps in a fresh frozen copy for an ApplicationV2's frozen options", () => {
		const app = { options: Object.freeze({ src: "old.webp", window: { title: "Wren" } }) };

		setAppOption(app, "src", "new.webp");

		expect(app.options.src).toBe("new.webp");
		// The rest of the configuration survives the swap, and the copy stays frozen.
		expect(app.options.window.title).toBe("Wren");
		expect(Object.isFrozen(app.options)).toBe(true);
	});

	it("writes an AppV1 window's mutable options in place", () => {
		const options = { src: "old.webp" };
		const app = { options };

		setAppOption(app, "src", "new.webp");

		expect(app.options).toBe(options);
		expect(options.src).toBe("new.webp");
	});

	it("no-ops on an app with no options yet", () => {
		expect(() => setAppOption({}, "src", "new.webp")).not.toThrow();
		expect(() => setAppOption(null, "src", "new.webp")).not.toThrow();
	});
});

describe("imagePopout", () => {
	afterEach(() => { delete globalThis.ImagePopout; });

	/** Capture what the constructor was handed, the way core's own signature receives it. */
	function stubPopout() {
		const seen = [];
		globalThis.ImagePopout = class { constructor(...args) { seen.push(args); } };
		return seen;
	}

	it("passes the path as options.src, not as the first positional argument", () => {
		// The positional form still opens the window; it just logs "An ImagePopout image path
		// must be assigned to options.src." on every single open, and goes away in v15.
		const seen = stubPopout();
		imagePopout({ src: "worlds/mine/bryn.webp", title: "Bryn" });
		expect(seen).toHaveLength(1);
		expect(seen[0][0]).toEqual({ src: "worlds/mine/bryn.webp", window: { title: "Bryn" } });
		// One argument: a second would land in core's `_options`, which is only read on the
		// deprecated string path.
		expect(seen[0]).toHaveLength(1);
	});

	it("nests the title under `window`, where v13 reads it", () => {
		const seen = stubPopout();
		imagePopout({ src: "a.webp", title: "Tobin" });
		expect(seen[0][0].window).toEqual({ title: "Tobin" });
		expect(seen[0][0].title, "a top-level title re-triggers the deprecation").toBeUndefined();
	});

	it("omits the window entirely when there is no title to give it", () => {
		const seen = stubPopout();
		imagePopout({ src: "a.webp" });
		expect(seen[0][0]).toEqual({ src: "a.webp" });
	});

	it("never sends a size, which core overwrites from the image before first render", () => {
		const seen = stubPopout();
		imagePopout({ src: "a.webp", title: "T", width: 560, height: 620 });
		expect(seen[0][0]).not.toHaveProperty("position");
		expect(seen[0][0]).not.toHaveProperty("width");
		expect(seen[0][0]).not.toHaveProperty("height");
	});

	it("returns null rather than throwing when the global is absent", () => {
		expect(imagePopout({ src: "a.webp" })).toBeNull();
		expect(imagePopout()).toBeNull();
	});
});

describe("imagePopoutTitle", () => {
	it("reads the v13 location, and still finds a legacy top-level title", () => {
		expect(imagePopoutTitle({ options: { window: { title: "Wren" } } })).toBe("Wren");
		expect(imagePopoutTitle({ options: { title: "Wren" } })).toBe("Wren");
		expect(imagePopoutTitle({ options: {} })).toBe("");
		expect(imagePopoutTitle(null)).toBe("");
	});
});

describe("chatModeIsPublic", () => {
	const realGame = globalThis.game;
	afterEach(() => { globalThis.game = realGame; });
	const core = (generation, settings) => {
		globalThis.game = { release: { generation }, settings: { get: (scope, key) => (scope === "core" ? settings[key] : undefined) } };
	};

	it("reads v14's messageMode, never the deprecated rollMode", () => {
		core(14, { messageMode: "public", rollMode: "gmroll" });
		expect(chatModeIsPublic()).toBe(true);
		core(14, { messageMode: "gm", rollMode: "publicroll" });
		expect(chatModeIsPublic()).toBe(false);
	});

	it("reads v13's rollMode", () => {
		core(13, { rollMode: "publicroll" });
		expect(chatModeIsPublic()).toBe(true);
		core(13, { rollMode: "blindroll" });
		expect(chatModeIsPublic()).toBe(false);
	});

	it("counts a setting it cannot read as not public", () => {
		globalThis.game = { release: { generation: 14 }, settings: { get: () => { throw new Error("not registered"); } } };
		expect(chatModeIsPublic()).toBe(false);
		globalThis.game = undefined;
		expect(chatModeIsPublic()).toBe(false);
	});
});
