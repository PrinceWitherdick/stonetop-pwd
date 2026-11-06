import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../module/utils/ask-with-buttons.js", () => ({ confirmOutcome: vi.fn(async () => true) }));

import { confirmOutcome } from "../../module/utils/ask-with-buttons.js";
import {
	onPreDeleteItem, onUpdateItem, flushCardEditRepaints, HELD_DELETE_CONFIRMED, CARD_EDIT_REPAINT_MS, shiftHolderBackMarks,
} from "../../module/hooks/arcana-card-edits.js";
import { seekerHomebrewMinors } from "../../module/actors/character/dialogs/CharacterOnboardingDialog.js";
import { SYSTEM_ID } from "../../module/system-id.js";

const SLUG = "arc-heldheldheldheld";
const realGame = globalThis.game;

const card = (flags = {}, extra = {}) => ({
	id: "I1", name: "Sidebar Name", type: "move", system: { moveType: "arcanum" }, parent: null, pack: null,
	flags: { stonetop: { slug: SLUG, front: { title: "The Weeping Lens" }, ...flags } },
	delete: vi.fn(async () => {}),
	...extra,
});
const holder = (name, arcana, extra = {}) => ({
	name, type: "character", isOwner: true, flags: { [SYSTEM_ID]: { arcana } },
	update: vi.fn(async () => {}), apps: {}, ...extra,
});

beforeEach(() => {
	confirmOutcome.mockClear();
	confirmOutcome.mockResolvedValue(true);
});
afterEach(() => { globalThis.game = realGame; });

const settle = () => new Promise(r => setTimeout(r, 0));

describe("HB-6: deleting a held world arcanum", () => {
	it("asks first, naming the holders, then stores the card's title on each and deletes it", async () => {
		const item = card();
		const a = holder("Aldric", { owned: [SLUG] });
		const b = holder("Brina", { owned: [SLUG] }, { isOwner: false });
		globalThis.game = { ...realGame, user: { id: "u1", isGM: true }, actors: [a, b], items: { get: () => item } };

		expect(onPreDeleteItem(item, {}, "u1")).toBe(false);
		await settle();
		const [{ content }] = confirmOutcome.mock.calls[0];
		expect(content).toContain("Aldric &amp; Brina");
		expect(content).toContain("The Weeping Lens");
		expect(a.update).toHaveBeenCalledWith({ [`flags.${SYSTEM_ID}.arcana.titles.${SLUG}`]: "The Weeping Lens" }, { render: false });
		// A holder this client can't write is skipped, not thrown on.
		expect(b.update).not.toHaveBeenCalled();
		expect(item.delete).toHaveBeenCalledWith({ [HELD_DELETE_CONFIRMED]: true });
	});

	it("keeps the card when the GM says no", async () => {
		confirmOutcome.mockResolvedValue(false);
		const item = card();
		const a = holder("Aldric", { owned: [SLUG] });
		globalThis.game = { ...realGame, user: { id: "u1" }, actors: [a], items: { get: () => item } };
		expect(onPreDeleteItem(item, {}, "u1")).toBe(false);
		await settle();
		expect(a.update).not.toHaveBeenCalled();
		expect(item.delete).not.toHaveBeenCalled();
	});

	it("lets through a card nobody holds, a confirmed delete, and anything else", () => {
		globalThis.game = { ...realGame, user: { id: "u1" }, actors: [holder("Cael", { owned: ["other"] })] };
		expect(onPreDeleteItem(card(), {}, "u1")).toBe(true);
		globalThis.game.actors = [holder("Aldric", { owned: [SLUG] })];
		expect(onPreDeleteItem(card(), { [HELD_DELETE_CONFIRMED]: true }, "u1")).toBe(true);
		expect(onPreDeleteItem(card({}, { parent: { type: "character" } }), {}, "u1")).toBe(true);
		expect(onPreDeleteItem({ type: "move", system: { moveType: "inventory" }, flags: {} }, {}, "u1")).toBe(true);
		expect(confirmOutcome).not.toHaveBeenCalled();
	});
});

describe("HB-15: an edited world card repaints its holders' open sheets", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("once per burst, and only the sheets that hold it", () => {
		const open   = { rendered: true, render: vi.fn() };
		const closed = { rendered: false, render: vi.fn() };
		const other  = { rendered: true, render: vi.fn() };
		globalThis.game = { ...realGame, actors: [
			holder("Aldric", { owned: [SLUG] }, { apps: { 1: open, 2: closed } }),
			holder("Cael", { owned: ["other"] }, { apps: { 3: other } }),
		] };
		onUpdateItem(card());
		onUpdateItem(card());
		onUpdateItem(card());
		expect(open.render).not.toHaveBeenCalled();
		vi.advanceTimersByTime(CARD_EDIT_REPAINT_MS);
		expect(open.render).toHaveBeenCalledTimes(1);
		expect(closed.render).not.toHaveBeenCalled();
		expect(other.render).not.toHaveBeenCalled();
		// Nothing pending: a stray flush is a no-op.
		flushCardEditRepaints();
		expect(open.render).toHaveBeenCalledTimes(1);
	});

	it("ignores items that aren't world arcana", () => {
		const open = { rendered: true, render: vi.fn() };
		globalThis.game = { ...realGame, actors: [holder("Aldric", { owned: [SLUG] }, { apps: { 1: open } })] };
		onUpdateItem(card({}, { parent: { type: "character" } }));
		onUpdateItem({ type: "move", system: { moveType: "inventory" }, flags: { stonetop: { slug: SLUG } } });
		vi.advanceTimersByTime(CARD_EDIT_REPAINT_MS);
		expect(open.render).not.toHaveBeenCalled();
	});
});

describe("HB-11: drafts", () => {
	it("are stored as drafts with the GM notes, and the browser skips them", async () => {
		const { buildArcanumItemData } = await import("../../module/item/createArcanum.js");
		const data = buildArcanumItemData({ slug: "arc-d", draft: true, gmNotes: "<p>n</p>" });
		expect(data.flags.stonetop.draft).toBe(true);
		expect(data.flags.stonetop.gmNotes).toBe("<p>n</p>");
		expect(buildArcanumItemData({ slug: "arc-e" }).flags.stonetop).not.toHaveProperty("draft");

		const { ArcanaSource } = await import("../../module/dialogs/catalog/ArcanaSource.js");
		const done  = card({ slug: "arc-done" });
		const draft = card({ slug: "arc-draft", draft: true });
		globalThis.game = { ...realGame, items: [done, draft] };
		expect(new ArcanaSource()._worldDocs()).toEqual([done]);
	});
});

describe("HB-16 / A19: homebrew minors in the Seeker's draw", () => {
	const minor = (slug, flags = {}, extra = {}) => ({ type: "move", system: { moveType: "arcanum" }, parent: null, flags: { stonetop: { slug, ...flags } }, ...extra });
	const items = [
		minor("arc-minor-one"),
		minor("arc-draft", { draft: true }),
		minor("arc-major", { major: true }),
		minor("mindgem"),
		minor(""),
		{ type: "move", system: { moveType: "inventory" }, flags: { stonetop: { slug: "rope" } } },
	];

	it("adds only finished homebrew minors, and only with the switch on", () => {
		expect(seekerHomebrewMinors({ items, enabled: true }).map(i => i.flags.stonetop.slug)).toEqual(["arc-minor-one"]);
		expect(seekerHomebrewMinors({ items, enabled: false })).toEqual([]);
	});

	it("reads the world switch, default off", () => {
		globalThis.game = { ...realGame, items, settings: { get: () => false } };
		expect(seekerHomebrewMinors()).toEqual([]);
		globalThis.game.settings.get = (scope, key) => scope === SYSTEM_ID && key === "arcanaSeekerDrawsHomebrew";
		expect(seekerHomebrewMinors()).toHaveLength(1);
	});
});

describe("Add mystery / Add consequence move holders' back marks with their boxes", () => {
	const flagged = (name, boxes, extra = {}) => holder(name, { owned: [SLUG], boxes }, {
		getFlag(scope, path) { return path.split(".").reduce((o, k) => o?.[k], this.flags[scope]); },
		...extra,
	});

	it("a mystery set before the Consequences moves each mark from its box on, one along", async () => {
		const { insertMystery } = await import("../../module/item/arcanum-edit.js");
		const back = "<h3>Moves</h3><p><strong>□ ONE</strong></p><h3>Consequences</h3><ul><li>□ first</li><li>□□ second</li></ul>";
		const placed = insertMystery(back, "TWO");
		expect(placed).toMatchObject({ at: 1, by: 1 });
		const a = flagged("Aldric", { [`${SLUG}:back:0`]: true, [`${SLUG}:back:1`]: true, "other:back:2": true });
		const b = flagged("Brina", { [`${SLUG}:back:1`]: true }, { isOwner: false });
		globalThis.game = { ...realGame, user: { id: "u1", isGM: true }, actors: [a, b] };
		expect(await shiftHolderBackMarks(card(), placed.at, placed.by)).toBe(true);
		const [data, options] = a.update.mock.calls[0];
		expect(data[`flags.${SYSTEM_ID}.arcana.boxes`]).toMatchObject({
			// The old box 1 (the first Consequence) is now box 2; the new mystery's box 1 is clear.
			[`${SLUG}:back:0`]: true, [`${SLUG}:back:1`]: false, [`${SLUG}:back:2`]: true,
			"other:back:2": true,
		});
		expect(options).toEqual({ stonetopLedger: true });
		expect(b.update).not.toHaveBeenCalled();
	});

	it("writes nothing when no mark sits at or past the new box", async () => {
		const { insertConsequence } = await import("../../module/item/arcanum-edit.js");
		const placed = insertConsequence("<h3>Consequences</h3><ul><li>□ first</li></ul>", 2);
		expect(placed).toMatchObject({ at: 1, by: 2 });
		const a = flagged("Aldric", { [`${SLUG}:back:0`]: true });
		globalThis.game = { ...realGame, user: { id: "u1", isGM: true }, actors: [a] };
		expect(await shiftHolderBackMarks(card(), placed.at, placed.by)).toBe(false);
		expect(a.update).not.toHaveBeenCalled();
	});
});
