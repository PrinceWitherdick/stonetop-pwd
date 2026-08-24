import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The Outfit step's party-load readout, on two counts the GM meets it by:
//
//  1. THE FACES. Anyone setting out wears their own portrait beside their load. It used to sit
//     inside a band-coloured ring, which at 26px read as the graphic and left the face as its
//     filling — on the one panel whose job is telling people apart at a glance. The ring is
//     gone, and the face enlarges on hover through the shared avatar preview instead.
//
//  2. "LIVE FROM SHEETS", which is what the block's own heading promises. It used to mean only
//     "re-read whenever the walkthrough happens to render", so a GM who ticked gear onto a PC's
//     sheet with this window open saw nothing move until they toggled someone out of the party
//     and back in. Now the sheets are watched, and the block redraws itself in place.

// The route step browses the art folder on render; nothing here renders a map, but the module
// is imported. Same fake as the sibling expedition suites.
vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

vi.mock("../../module/utils/world.js", () => ({
	getStonetopSteadingActor:       () => null,
	getStonetopSteadingActorOrWarn: () => null,
	isSteadingActor: a => a?.type === "stonetop" || a?.system?.customType === "stonetop",
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");

// …/tests/dialogs/this-file → the repo root.
const ROOT     = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PARTIAL  = fs.readFileSync(path.join(ROOT, "templates/dialogs/partials/expedition-load.hbs"), "utf8");
const DIALOG   = fs.readFileSync(path.join(ROOT, "templates/dialogs/expedition.hbs"), "utf8");
const CSS      = fs.readFileSync(path.join(ROOT, "styles/stonetop.css"), "utf8");
const SOURCE   = fs.readFileSync(path.join(ROOT, "module/dialogs/ExpeditionDialog.js"), "utf8");

/** The index of the Outfit step in the walkthrough, found by key rather than pinned. */
const OUTFIT = ExpeditionDialog.prototype._steps.findIndex(s => s.key === "outfit");

/**
 * A dialog instance without the Application constructor, the trick the sibling expedition
 * suites use: everything under test is the readout's own markup and lifecycle.
 */
function dialog(step = OUTFIT) {
	const d = Object.create(ExpeditionDialog.prototype);
	d._step  = step;
	d._rolls = {};
	d.render = vi.fn();
	return d;
}

let hooks;

beforeEach(() => {
	hooks = { on: [], off: [] };
	global.Hooks = {
		once: () => {},
		on: (name, fn) => { hooks.on.push({ name, fn }); return hooks.on.length; },
		off: (name, id) => hooks.off.push({ name, id }),
	};
	global.game = { i18n: global.game.i18n, user: { isGM: true } };
});

afterEach(() => { vi.useRealTimers(); });

describe("the party-load readout's faces", () => {
	it("wraps each portrait in a measurable clipping box the hover preview can anchor to", () => {
		// `stonetop-portrait-box` is what avatar-preview.js measures instead of the image, so a
		// hand-framed portrait (an oversized image pushed off its own origin) raises its card
		// beside the face rather than a long way from it.
		expect(PARTIAL).toContain("stonetop-exp-load-ava stonetop-portrait-box");
	});

	it("gives the thumbnail the caption data the shared preview reads", () => {
		// `data-name` is the card's title and `data-subtitle` its quieter second line; without
		// the first the preview opens captionless.
		expect(PARTIAL).toContain('data-name="{{name}}"');
		expect(PARTIAL).toContain('data-subtitle="{{previewSub}}"');
	});

	it("wires the shared preview from the dialog root, and takes it down on close", () => {
		expect(SOURCE).toContain('wireAvatarPreview(html[0], ".stonetop-exp-load-ava-img")');
		// Portaled to <body>, so a preview open as the window goes outlives its row.
		expect(SOURCE).toMatch(/async close\([^)]*\)\s*\{[\s\S]*?removeAvatarPreview\(\)/);
	});

	it("draws no band-coloured ring around a face", () => {
		// The band is already said three times on the same row (the left edge, the pips, the
		// pill). A `border-color` on the photo disc is the ring coming back.
		const photoRules = CSS.match(/^[^\n]*\.stonetop-exp-load-ava--photo[^\n]*\{[\s\S]*?\}/gm) ?? [];
		expect(photoRules.length, "the photo-disc rule is gone").toBeGreaterThan(0);
		for (const rule of photoRules) {
			expect(rule, `a ring is back on:\n${rule}`).not.toMatch(/border-color\s*:/);
			// The lookahead sits INSIDE the colon's whitespace on purpose: written as
			// `border\s*:\s*(?!none)` the greedy `\s*` backtracks to zero and the test passes on
			// `border: none` for the wrong reason, then keeps passing on `border: 2px solid`.
			expect(rule, `a border is back on:\n${rule}`).not.toMatch(/border\s*:(?!\s*none)/);
		}
		// And the fill underneath it: the plain-disc rules set the band colour as a background,
		// which a portrait with transparency would let through as the same ring by another route.
		expect(photoRules.join("\n")).toMatch(/background\s*:\s*none/);
	});

	it("captions a PC with their playbook and a follower with their tag", () => {
		const d = dialog();
		const limits = { light: 2, normal: 4, heavy: 6 };
		expect(d._loadRow("light", "Vahid", 1, limits, { sub: "The Blessed" }).previewSub).toBe("The Blessed");
		expect(d._loadRow("light", "Rook", 1, limits, { isFollower: true, folTag: "crew" }).previewSub).toBe("crew");
		expect(d._loadRow("light", "Nobody", 1, limits).previewSub).toBe("");
	});
});

// Heavy and overloaded are the two states that actually cost a PC something, so they are both
// red, and step apart by weight rather than by hue. Heavy used to be the gold caution accent,
// which put an amber beside a red and read as a colour scheme rather than as a ladder.
describe("the loaded bands", () => {
	/** Every declaration the stylesheet makes for one band's part of the readout. */
	const bandRules = band => {
		const rules = CSS.match(/^[^\n]*\{[\s\S]*?\}/gm) ?? [];
		return rules.filter(r => r.includes(`lvl-${band}`) && r.includes("exp-load"));
	};

	it("paints nothing about a heavy load gold", () => {
		const heavy = bandRules("heavy").join("\n") + CSS.match(/\.stonetop-exp-load-pill\.heavy[^\n]*/)[0];
		expect(heavy).not.toMatch(/gold/);
		// The second gold the avatar and pips used to share, which was never a token.
		expect(heavy).not.toMatch(/c29a1f/i);
		expect(heavy).not.toMatch(/201\s*,\s*162\s*,\s*39/);
	});

	it("gives heavy the border red and overloaded the ink red, everywhere both are painted", () => {
		// Same pair on the row edge, the face and the pips, so one PC's row never says two
		// different things about them.
		for (const [band, token] of [["heavy", "--st-red-border"], ["over", "--st-red-text"]]) {
			// `--photo` rules are excluded: they turn the band fill OFF behind a portrait
			// (`background: none`) rather than painting the band.
			const painted = bandRules(band).filter(r => /background|border-left-color/.test(r))
				.filter(r => !r.includes("--photo"));
			expect(painted.length, band).toBeGreaterThan(2);
			for (const r of painted) {
				// The overloaded row's own wash is the one exception: --st-red-bg at half
				// strength is the row TINT, not the band colour, and the edge on that same rule
				// is checked below.
				const declarations = r.includes("color-mix")
					? r.match(/border-left-color:[^;]*/g) ?? []
					: [r];
				expect(declarations.length, `${band}:\n${r}`).toBeGreaterThan(0);
				for (const d of declarations) expect(d, `${band}:\n${r}`).toContain(token);
			}
		}
	});

	it("keeps the pips in step with the row", () => {
		const pips = CSS.match(/\.lvl-(heavy|over) \.stonetop-exp-load-pip\.on[^\n]*/g) ?? [];
		expect(pips).toHaveLength(2);
		expect(pips.find(p => p.includes("lvl-heavy"))).toContain("--st-red-border");
		expect(pips.find(p => p.includes("lvl-over"))).toContain("--st-red-text");
	});

	// Two red pills of the same weight, two rows apart, would be one state said twice.
	it("outlines the heavy pill and fills the overloaded one", () => {
		const pill = which => CSS.match(new RegExp(`\\.stonetop-exp-load-pill\\.${which}[^\\n]*`))[0];
		expect(pill("heavy")).toContain("background: none");
		expect(pill("over")).toContain("background: var(--st-red-bg)");
	});
});

describe("the readout keeps itself live from the sheets", () => {
	it("watches the documents a party's load is read out of", () => {
		dialog()._wireLoadWatch();
		// Actors carry the ◇ reserve, the custom followers and the crew's gear; Items are the
		// checked inventory and the load-gated moves.
		expect(hooks.on.map(h => h.name).sort())
			.toEqual(["createItem", "deleteItem", "updateActor", "updateItem"]);
	});

	it("ignores the documents that carry no load at all", () => {
		vi.useFakeTimers();
		const d = dialog();
		d._refreshLoadReadout = vi.fn(() => Promise.resolve());
		d._wireLoadWatch();
		const fire = (name, doc) => hooks.on.filter(h => h.name === name).forEach(h => h.fn(doc));

		// A world in play writes to actors constantly; a monster taking a hit is not party load.
		fire("updateActor", { type: "npc" });
		fire("updateItem", { parent: { type: "npc" } });
		fire("updateItem", { parent: null });
		vi.runAllTimers();
		expect(d._refreshLoadReadout).not.toHaveBeenCalled();

		// A PC's own item, and the steading whose flags hold the crew's gear, both count.
		fire("updateItem", { parent: { type: "character" } });
		fire("updateActor", { type: "stonetop" });
		vi.runAllTimers();
		expect(d._refreshLoadReadout).toHaveBeenCalledTimes(1);
	});

	it("watches nothing off the Outfit step, or for a player", () => {
		dialog(0)._wireLoadWatch();
		expect(hooks.on).toEqual([]);

		global.game.user.isGM = false;
		dialog()._wireLoadWatch();
		expect(hooks.on).toEqual([]);
	});

	it("releases the previous watch before registering a new one, so renders don't stack", () => {
		const d = dialog();
		d._wireLoadWatch();
		d._wireLoadWatch();
		expect(hooks.on).toHaveLength(8);
		expect(hooks.off.map(h => h.name).sort())
			.toEqual(["createItem", "deleteItem", "updateActor", "updateItem"]);
	});

	it("collapses a burst of sheet writes into one redraw", async () => {
		vi.useFakeTimers();
		const d = dialog();
		d._refreshLoadReadout = vi.fn(() => Promise.resolve());
		// Ticking one box lands as several documents updating in a row.
		d._loadChanged();
		d._loadChanged();
		d._loadChanged();
		expect(d._refreshLoadReadout).not.toHaveBeenCalled();
		await vi.runAllTimersAsync();
		expect(d._refreshLoadReadout).toHaveBeenCalledTimes(1);
	});

	it("drops a pending redraw with the watch, so a closed window never redraws", async () => {
		vi.useFakeTimers();
		const d = dialog();
		d._refreshLoadReadout = vi.fn(() => Promise.resolve());
		d._loadChanged();
		d._dropLoadWatch();
		await vi.runAllTimersAsync();
		expect(d._refreshLoadReadout).not.toHaveBeenCalled();
	});
});

describe("redrawing the readout", () => {
	/** The one block the refresh replaces, as a stand-in with the two properties it reads. */
	function host() {
		return { innerHTML: "", isConnected: true };
	}

	/** A dialog whose element answers with `node` for the readout's own selector. */
	function mounted(node) {
		const d = dialog();
		d.rendered = true;
		d.element = [{ querySelector: sel => (sel === ".stonetop-exp-load" ? node : null) }];
		d._buildLoadReadout = vi.fn(() => Promise.resolve({
			chips: [{ id: "a1", name: "Vahid", on: true }],
			hasRows: true,
			rows: [{
				levelClass: "lvl-light", pillClass: "light", levelLabel: "light",
				img: "portrait.webp", imgStyle: "", initial: "V",
				name: "Vahid", sub: "The Blessed", previewSub: "The Blessed",
				marks: 1, cap: 6, bands: [], overflow: 0, gated: [],
			}],
			summary: { overloaded: 0, heavy: 0, cantSneak: 0, anyOver: false, anyHeavy: false, anySneak: false },
		}));
		return d;
	}

	it("swaps the block's own markup in place, without re-rendering the walkthrough", async () => {
		// A render here would rebuild the route step's map panel (a folder browse and an image
		// measure) and take the caret out of whatever field the GM was mid-sentence in.
		const node = host();
		const d = mounted(node);

		await d._refreshLoadReadout();

		expect(d.render).not.toHaveBeenCalled();
		expect(node.innerHTML).toContain("Vahid");
		expect(node.innerHTML).toContain('data-subtitle="The Blessed"');
		expect(node.innerHTML).toContain("stonetop-exp-load-chip");
	});

	it("does nothing when the block has gone from under it", async () => {
		const d = mounted(null);
		await d._refreshLoadReadout();
		expect(d._buildLoadReadout).not.toHaveBeenCalled();
	});

	it("does not write into a block detached while the build was running", async () => {
		const node = host();
		const d = mounted(node);
		d._buildLoadReadout = vi.fn(async () => { node.isConnected = false; return { chips: [], hasRows: false, rows: [] }; });

		await d._refreshLoadReadout();

		expect(node.innerHTML).toBe("");
	});
});

describe("the readout's controls survive a redraw", () => {
	it("delegates the party chips from the dialog root rather than binding each one", () => {
		// The refresh above replaces every chip, so a per-chip binding would be thrown away with
		// the chip that carried it and the toggles would go dead after the first sheet change.
		expect(SOURCE).toContain('html.on("click", ".stonetop-exp-load-chip"');
		expect(SOURCE).not.toContain('html.find(".stonetop-exp-load-chip")');
	});

	it("keeps the block a partial the dialog and the refresh both render", () => {
		// One source for the markup: the template invokes it, and `_refreshLoadReadout` renders
		// the same file directly. A second copy would drift the moment either changed.
		expect(DIALOG).toContain('{{> "stonetop.expedition-load" loadReadout=loadReadout}}');
		expect(SOURCE).toContain("templates/dialogs/partials/expedition-load.hbs");
	});
});
