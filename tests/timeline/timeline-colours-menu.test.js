import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readRepo } from "../fakes/css.js";

// THE GM'S COLOURS MENU. What is pinned: each row opens on what its kind wears on THIS page, a
// pick and a Default move only that row, a pick that lands back on the shipped colour is no pick,
// Save writes only the kinds touched here, over the world's colours as they stand at Save, and
// Cancel throws the picks away.

const saved = { value: {} };
vi.mock("../../module/settings.js", () => ({
	getTimelineKindColours: () => ({ ...saved.value }),
	setTimelineKindColours: vi.fn(async colours => { saved.value = colours; }),
}));

const { TimelineColoursDraft } = await import("../../module/timeline/timeline-colours-menu.js");
const settings = await import("../../module/settings.js");
const { TIMELINE_COLOUR_KINDS, TIMELINE_KIND_PALETTE, kindColourSet } = await import("../../module/timeline/timeline-colours.js");

const realDocument = globalThis.document;
/** Put the page in one skin, by the classes applySheetContrast sets. */
function skin(...classes) {
	globalThis.document = { documentElement: { classList: { contains: c => classes.includes(c) } } };
}

function makeDraft(world = {}) {
	saved.value = { ...world };
	return new TimelineColoursDraft();
}

/** The Default button: its classes and attributes, as repaintRow sets them. Opens idle, as drawn. */
function fakeReset() {
	const classes = new Set(["stonetop-timeline-colours-reset", "is-idle"]);
	const attrs = new Map([["aria-hidden", "true"], ["tabindex", "-1"]]);
	return {
		classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c), on), contains: c => classes.has(c) },
		setAttribute: (k, v) => attrs.set(k, String(v)),
		removeAttribute: k => attrs.delete(k),
		getAttribute: k => attrs.get(k) ?? null,
		hidden: false,
		/** Out of use: invisible but in its cell, and out of the tab order and the accessibility tree. */
		get idle() {
			const states = [classes.has("is-idle"), attrs.get("aria-hidden") === "true", attrs.get("tabindex") === "-1"];
			if (states.every(Boolean)) return true;
			if (!states.some(Boolean)) return false;
			throw new Error(`half idle: ${JSON.stringify({ classes: [...classes], attrs: [...attrs] })}`);
		},
	};
}

/** A row as the template draws it, enough for `_repaintRow`. */
function fakeRow(kind) {
	const props = new Map();
	const reset = fakeReset();
	const note = { hidden: true };
	const pick = { value: "" };
	return {
		dataset: { kind },
		style: { setProperty: (k, v) => props.set(k, v) },
		querySelector: sel => ({
			".stonetop-timeline-colours-reset": reset,
			".stonetop-timeline-colours-note": note,
			".stonetop-timeline-colours-pick": pick,
		})[sel] ?? null,
		prop: k => props.get(k),
		reset, note, pick,
	};
}

beforeEach(() => {
	saved.value = {};
	settings.setTimelineKindColours.mockClear();
	globalThis.game = { ...(globalThis.game ?? {}), user: { isGM: true } };
	skin();
});

afterEach(() => {
	globalThis.document = realDocument;
});

describe("the rows", () => {
	it("open on the world's colours", () => {
		const draft = makeDraft({ wound: "#aa3300" });
		expect(draft._row("wound").value).toBe("#aa3300");
		expect(draft._row("wound").repainted).toBe(true);
	});

	it("open each untouched kind on its shipped colour, with no Default to press", () => {
		const row = makeDraft()._row("arcana");
		expect(row.value).toBe(TIMELINE_KIND_PALETTE.arcana.light);
		expect(row.colour).toBe(TIMELINE_KIND_PALETTE.arcana.light);
		expect(row.repainted).toBe(false);
		expect(row.nudged).toBe(false);
	});

	// No one colour reads on both high-contrast pages, so a note about ANY skin would be on every
	// row. It speaks for this page alone.
	it("say a pick was adjusted only when it was adjusted for this page", () => {
		const draft = makeDraft({ arcana: "#ffff66", wound: "#7c300a" });
		const pale = draft._row("arcana");
		expect(pale.nudged).toBe(true);
		expect(pale.colour).toBe(kindColourSet("#ffff66").light.hex);
		expect(kindColourSet("#7c300a").darkHigh.nudged).toBe(true);
		expect(draft._row("wound").nudged).toBe(false);
	});

	it("follow the page into another skin", () => {
		const draft = makeDraft();
		skin("stonetop-dark");
		expect(draft._row("site").colour).toBe(TIMELINE_KIND_PALETTE.site.dark);
	});

	it("come one per kind", () => {
		expect(makeDraft().rows().map(row => row.kind)).toEqual([...TIMELINE_COLOUR_KINDS]);
	});

	// Another GM's Save lands while this menu is open: a kind not touched here shows it.
	it("follow the world's colours for a kind not touched here", () => {
		const draft = makeDraft();
		saved.value = { wound: "#aa3300" };
		expect(draft._row("wound").value).toBe("#aa3300");
	});
});

describe("picking and putting back", () => {
	it("keeps a pick, and repaints only its row", () => {
		const draft = makeDraft();
		const row = fakeRow("wound");
		draft.pick("wound", "#aa3300");
		draft.repaintRow(row);
		expect(draft._chosen("wound")).toBe("#aa3300");
		expect(row.reset.idle).toBe(false);
		// Never `hidden`, which would take its grid cell and move the picker (hidden-hides.test.js).
		expect(row.reset.hidden).toBe(false);
		expect(row.prop("--tl-kind")).toBe(kindColourSet("#aa3300").light.hex);
	});

	// Kept, it would be walked into the three other skins and replace their own tuned colours.
	it("treats a pick landing on this skin's shipped colour as the default", () => {
		const draft = makeDraft({ levelup: "#123456" });
		draft.pick("levelup", TIMELINE_KIND_PALETTE.levelup.light.toUpperCase());
		expect(draft._chosen("levelup")).toBeNull();
	});

	it("puts a kind back to default, picker and all", () => {
		const draft = makeDraft({ wound: "#aa3300" });
		const row = fakeRow("wound");
		draft.repaintRow(row);
		expect(row.reset.idle, "the world's colour has a Default to press").toBe(false);
		draft.reset("wound");
		draft.repaintRow(row, { syncPicker: true });
		expect(draft._chosen("wound")).toBeNull();
		expect(row.reset.idle).toBe(true);
		expect(row.reset.hidden).toBe(false);
		expect(row.pick.value).toBe(TIMELINE_KIND_PALETTE.wound.light);
	});
});

describe("the Default button's first paint", () => {
	// The template draws the idle state repaintRow keeps: the class that keeps its cell, and the
	// two attributes that keep it out of the tab order and the accessibility tree, all three on
	// the same condition. Never `hidden`, which would take the cell and move the picker.
	it("is drawn idle exactly as setResetIdle leaves it", () => {
		const button = readRepo("templates/dialogs/timeline.hbs").match(/<button type="button" class="stonetop-timeline-colours-reset[^>]*>/)?.[0];
		expect(button, "the Default button is gone from timeline.hbs").toBeTruthy();
		expect(button).toContain('class="stonetop-timeline-colours-reset{{#unless repainted}} is-idle{{/unless}}"');
		expect(button).toContain('{{#unless repainted}} aria-hidden="true" tabindex="-1"{{/unless}}');
		expect(button).not.toMatch(/\shidden(?=[\s{>])/);
	});
});

describe("saving", () => {
	it("writes the kinds touched here over the world's colours as they stand now", async () => {
		const draft = makeDraft({ wound: "#aa3300", arcana: "#550088" });
		draft.pick("site", "#004466");
		draft.reset("wound");
		// Changed elsewhere while the window was open: must survive this Save.
		saved.value = { ...saved.value, follower: "#880044" };
		await draft.save();
		expect(settings.setTimelineKindColours).toHaveBeenCalledWith({ arcana: "#550088", site: "#004466", follower: "#880044" });
	});

	it("writes nothing when nothing was touched", async () => {
		const draft = makeDraft({ wound: "#aa3300" });
		await draft.save();
		expect(settings.setTimelineKindColours).not.toHaveBeenCalled();
	});

	it("starts the next round clean once saved", async () => {
		const draft = makeDraft();
		draft.pick("wound", "#aa3300");
		await draft.save();
		expect(draft.dirty).toBe(false);
	});

	it("keeps every pick when the write fails, for another Save", async () => {
		const draft = makeDraft();
		draft.pick("wound", "#aa3300");
		settings.setTimelineKindColours.mockRejectedValueOnce(new Error("socket"));
		await expect(draft.save()).rejects.toThrow("socket");
		expect(draft.dirty).toBe(true);
		expect(draft._row("wound").value).toBe("#aa3300");
	});

	it("keeps a pick made while the write was on its way", async () => {
		const draft = makeDraft();
		draft.pick("wound", "#aa3300");
		let land;
		settings.setTimelineKindColours.mockImplementationOnce(colours => new Promise(resolve => {
			land = () => { saved.value = colours; resolve(); };
		}));
		const saving = draft.save();
		draft.pick("site", "#004466");
		land();
		await saving;
		expect(draft._row("site").value).toBe("#004466");
		expect(draft.dirty).toBe(true);
		expect(Object.keys(draft._picks)).toEqual(["site"]);
	});

	it("writes nothing for a player who somehow got the menu open", async () => {
		const draft = makeDraft();
		draft.pick("wound", "#aa3300");
		globalThis.game.user = { isGM: false };
		await draft.save();
		expect(settings.setTimelineKindColours).not.toHaveBeenCalled();
	});
});

describe("cancelling", () => {
	it("throws every pick away and writes nothing", async () => {
		const draft = makeDraft({ wound: "#aa3300" });
		draft.pick("site", "#004466");
		draft.reset("wound");
		draft.discard();
		expect(draft._row("wound").value).toBe("#aa3300");
		expect(draft._row("site").repainted).toBe(false);
		await draft.save();
		expect(settings.setTimelineKindColours).not.toHaveBeenCalled();
	});
});
