import Handlebars from "handlebars";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { declarations, readCss, readRepo as read } from "../fakes/css.js";

// The Run an Expedition polish pass (2026-11-20):
//
//  • Next is the slate primary: it is the step's one forward action until Done takes over.
//  • Running the journey opens with its set-out stamp, since setting out is the first thing that
//    happens there; Going home keeps its stamp at the foot, after the homecoming.
//  • The left rail ticks each step the current trip has already settled.
//  • Four hairlines and washes stranded as literal black now read the ink channel, so the dark
//    pages can turn them; the window's own buttons leave core's `transition: all`; the drawn
//    fate row keeps its wash under the Reduce Motion setting; and the load disc's initial reads
//    its band's whole family on the dark and high-contrast pages.
//
// And phase 4's two table cues: Running the journey's "Start a fight" (GM, Fight tab on), and the
// set-out and homecoming moments a fresh stamp sends, named only for a trip the players were shown.

vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

const writer = vi.hoisted(() => ({
	stampSetOut:   vi.fn(async () => true),
	clearSetOut:   vi.fn(async () => true),
	clearTripHome: vi.fn(async () => true),
	recordTrip:    vi.fn(async () => true),
}));
vi.mock("../../module/timeline/timeline-expedition-record.js", async importOriginal => ({
	...(await importOriginal()),
	...writer,
}));
const sent = vi.hoisted(() => []);
vi.mock("../../module/moments/moment-broadcast.js", () => ({ sendMoment: payload => { sent.push(payload); return true; } }));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");
const { sharedRoutePayload } = await import("../../module/utils/shared-route.js");

const HBS = read("templates/dialogs/expedition.hbs");
const TOC = read("templates/dialogs/partials/guide-toc.hbs");
const CSS = readCss();

let store;

function dialog(trips) {
	store.expeditionAnswers = { currentId: trips[0]?.id ?? null, list: trips };
	const d = Object.create(ExpeditionDialog.prototype);
	d._rolls = {};
	d._step = 0;
	d.render = () => {};
	return d;
}

/** The template with only what these blocks read; the rest of the page stays empty. */
function render(context) {
	const hb = Handlebars.create();
	hb.registerPartial("stonetop.guide-toc", TOC);
	hb.registerPartial("stonetop.expedition-journey", "");
	hb.registerPartial("stonetop.expedition-load", "");
	hb.registerPartial("stonetop.section-heading", read("templates/actor/partials/section-heading.hbs"));
	hb.registerHelper("localize", s => s);
	hb.registerHelper("eq", (a, b) => a === b);
	hb.registerHelper("and", (...a) => a.slice(0, -1).every(Boolean));
	return hb.compile(HBS)(context);
}

const SETTLED = {
	id: "trip-1", title: "The Long Walk", createdAt: 0,
	chart: { picked: [{ id: "r1", group: "requirements", key: "bring", answer: "warm clothes" }] },
	journey: { origin: "stonetop", destination: "marshedge" },
	requisitioned: [{ name: "A wagon" }],
	setOut: { season: "summer", year: 1 },
	timelineRecorded: { season: "autumn", year: 1 },
};

beforeEach(() => {
	sent.length = 0;
	store = { expeditionAnswers: {} };
	global.game = {
		i18n: global.game.i18n,
		user: { isGM: true },
		actors: { contents: [] },
		settings: {
			settings: new Map([["stonetop-pwd.expeditionAnswers", { scope: "world" }]]),
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
});

describe("the walkthrough's Next", () => {
	it("is the slate primary", () => {
		expect(HBS).toMatch(/<button type="button" class="stonetop-spring-next stonetop-guide-btn--primary">/);
	});
});

describe("where the trip's stamp is drawn", () => {
	const page = tripStamp => render({
		step: { body: "<p>THE-BODY</p>" },
		tripStamp: { buttons: [], note: "THE-STAMP", ...tripStamp },
		steps: [],
	});

	it("opens Running the journey, above the step's prose", () => {
		const html = page(dialog([SETTLED])._tripStampContext("setOut"));
		expect(html.match(/stonetop-exp-timeline"/g)).toHaveLength(1);
		expect(html.indexOf("stonetop-exp-timeline\"")).toBeLessThan(html.indexOf("THE-BODY"));
	});

	it("closes Going home, below it", () => {
		const html = page(dialog([SETTLED])._tripStampContext("home"));
		expect(html.match(/stonetop-exp-timeline"/g)).toHaveLength(1);
		expect(html.indexOf("stonetop-exp-timeline\"")).toBeGreaterThan(html.indexOf("THE-BODY"));
	});

	it("is written once, so the two places cannot drift", () => {
		expect(HBS.match(/class="stonetop-exp-timeline"/g)).toHaveLength(1);
		expect(HBS.match(/\{\{> stonetopTripStamp\}\}/g)).toHaveLength(2);
	});
});

describe("the rail's done ticks", () => {
	const doneKeys = d => {
		const steps = d._steps;
		return d._railTicks(d._stepNav().steps).filter(s => s.isDone).map(s => steps[s.index].key);
	};

	it("tick the five steps a settled trip has done", () => {
		expect(doneKeys(dialog([SETTLED]))).toEqual(["chart", "journey", "requisition", "running", "home"]);
	});

	it("are drawn from getData, so the nav's other callers never read the log for them", () => {
		expect(read("module/dialogs/ExpeditionDialog.js")).toMatch(/steps:\s+this\._railTicks\(nav\.steps, route\)/);
	});

	it("tick nothing on a trip just begun, nor before any trip", () => {
		expect(doneKeys(dialog([{ id: "trip-1", title: "", createdAt: 0 }]))).toEqual([]);
		expect(doneKeys(dialog([]))).toEqual([]);
	});

	it("draw a tick and say it aloud, only where an entry is done", () => {
		const hb = Handlebars.create();
		hb.registerHelper("localize", s => s);
		const html = hb.compile(TOC)({ steps: [
			{ index: 0, title: "Chart a Course", icon: "fa-map", isDone: true },
			{ index: 1, title: "The route", icon: "fa-route" },
		] });
		expect(html.match(/stonetop-guide-toc-done"/g)).toHaveLength(1);
		expect(html).toMatch(/<i class="fas fa-check stonetop-guide-toc-done" aria-hidden="true"><\/i><span class="stonetop-guide-toc-done-label">/);
	});
});

describe("the stylesheet", () => {
	it("draws the four stranded hairlines and washes on the ink channel", () => {
		for (const sel of [
			".stonetop-expedition-dialog .stonetop-exp-asset.is-elsewhere .stonetop-exp-asset-btn",
			".stonetop-journey .stonetop-journey-place-site",
			".stonetop-journey .stonetop-journey-nomap",
			".stonetop-journey .stonetop-journey-grouphead",
		]) {
			const body = declarations(CSS, sel);
			expect(body, sel).toBeTruthy();
			expect(body, sel).not.toMatch(/rgba\(\s*0\s*,\s*0\s*,\s*0/);
			expect(body, sel).toContain("var(--st-ink-rgb)");
		}
	});

	it("takes every button in the window and the map windows off core's transition on all properties", () => {
		// Scoped to the window roots, so a new button is covered without being listed. `:where()`
		// keeps it at a bare `button`'s weight: core's rule is layered and loses anyway, and a
		// class-named transition of ours still wins over this one.
		expect(declarations(CSS, ":where(.stonetop-expedition-dialog, .stonetop-journey) button"))
			.toMatch(/transition:\s*background-color 0\.15s, border-color 0\.15s, color 0\.15s/);
		for (const tpl of ["expedition-journey.hbs", "../travel-map.hbs", "../shared-route.hbs"]) {
			expect(read(`templates/dialogs/partials/${tpl}`), tpl).toMatch(/class="[^"]*\bstonetop-journey\b/);
		}
	});

	it("keeps the drawn fate row's wash with motion off, whichever way the reader asked", () => {
		const body = declarations(CSS, ":root.stonetop-less-motion .stonetop-spring-body ul.stonetop-exp-fatetable li.stonetop-flash");
		expect(body).toMatch(/animation:\s*none/);
		expect(body).toMatch(/background-color:\s*var\(--st-warm-hover-bg\)/);
	});

	it("letters the load disc in its band's own family on the dark and high-contrast pages, never on a portrait", () => {
		const disc = ".stonetop-exp-load-ava:not(.stonetop-exp-load-ava--photo)";
		const dark = band => `:where(:root.stonetop-dark) .stonetop-expedition-dialog ${band}${disc}`;
		const hc = band => `:root.stonetop-high-contrast .stonetop-expedition-dialog ${band}${disc}`;
		expect(declarations(CSS, dark(""))).toMatch(/color:\s*var\(--st-btn-primary-text\)/);
		expect(declarations(CSS, dark(".stonetop-exp-load-row.lvl-light "))).toMatch(/color:\s*var\(--st-green-text\)/);
		expect(declarations(CSS, dark(".stonetop-exp-load-row.lvl-heavy "))).toMatch(/color:\s*var\(--st-red-text\)/);
		expect(declarations(CSS, dark(".stonetop-exp-load-row.lvl-over "))).toMatch(/color:\s*var\(--st-page\)/);
		expect(declarations(CSS, hc(".stonetop-exp-load-row.lvl-light "))).toMatch(/color:\s*var\(--st-green-text\)/);
		expect(declarations(CSS, hc(".stonetop-exp-load-row.lvl-heavy "))).toMatch(/color:\s*var\(--st-red-text\)/);
	});
});

describe("the step fade", () => {
	it("is on for this walkthrough (StepperDialog#_stepMotion; tests/dialogs/stepper-step-motion.test.js)", () => {
		expect(Object.create(ExpeditionDialog.prototype)._stepMotion).toBe(true);
	});
});

describe("Start a fight on Running the journey", () => {
	const running = () => ExpeditionDialog.prototype._steps.findIndex(s => s.key === "running");
	const fightOf = async ({ isGM = true, fightTab = true } = {}) => {
		const d = dialog([SETTLED]);
		d._step = running();
		game.user = { isGM };
		game.actors = Object.assign([], { contents: [] });
		store.fightTab = fightTab;
		return (await d.getData()).fight;
	};

	it("is offered to a GM with the Fight tab on, and to nobody else", async () => {
		expect(await fightOf()).toBe(true);
		expect(await fightOf({ isGM: false })).toBe(false);
		expect(await fightOf({ fightTab: false })).toBe(false);
	});

	it("draws one button that names the window it opens", () => {
		const html = render({ step: { body: "" }, steps: [], fight: true });
		expect(html.match(/class="stonetop-exp-fight-btn stonetop-spring-roll-btn"/g)).toHaveLength(1);
		expect(html).toContain('<i class="fas fa-swords" aria-hidden="true"></i> stonetop.expedition.fight.start');
		expect(render({ step: { body: "" }, steps: [], fight: false })).not.toContain("stonetop-exp-fight-btn");
	});

	it("opens Start a fight once, with the characters ticked", () => {
		const openStart = vi.fn();
		game.stonetop = { fight: { openStart } };
		dialog([SETTLED])._startRoadFight();
		expect(openStart).toHaveBeenCalledOnce();
		expect(openStart).toHaveBeenCalledWith({ preselectPcs: true });
		expect(read("module/dialogs/ExpeditionDialog.js")).toContain('html.find(".stonetop-exp-fight-btn").on("click", () => this._startRoadFight());');
	});
});

describe("the moments a stamp sends", () => {
	const fresh = () => ({ ...SETTLED, setOut: undefined, timelineRecorded: undefined });
	const stamped = (trip, kind) => {
		const d = dialog([trip]);
		// The writer is mocked, so the stamp it would have written is put on the trip here.
		writer.stampSetOut.mockImplementationOnce(async () => { trip.setOut = { season: "summer", year: 1 }; return true; });
		writer.recordTrip.mockImplementationOnce(async () => { trip.timelineRecorded = { season: "autumn", year: 1 }; return true; });
		return d._tripStamp(kind, "stamp");
	};

	it("sends one setting-out moment and one homecoming, dated, with no name for a trip never shown", async () => {
		const trip = fresh();
		await stamped(trip, "setOut");
		await stamped(trip, "home");
		expect(sent.map(p => p.kind)).toEqual(["setOut", "home"]);
		expect(sent.every(p => p.title === "")).toBe(true);
		expect(sent[0].sub).toMatch(/summer/i);
		expect(sent[1].sub).toMatch(/autumn/i);
	});

	it("names the trip once the players have been shown its route", async () => {
		const trip = fresh();
		store.sharedRoute = sharedRoutePayload({ trip, tier: "vicinity", id: "share-1", now: 1 });
		await stamped(trip, "setOut");
		expect(sent[0].title).toBe("The Long Walk");
	});

	it("sends nothing on a redo, a clear, or a stamp that wrote nothing", async () => {
		const d = dialog([SETTLED]);
		await d._tripStamp("setOut", "redo");
		await d._tripStamp("home", "redo");
		await d._tripStamp("setOut", "clear");
		await d._tripStamp("home", "clear");
		writer.stampSetOut.mockImplementationOnce(async () => false);
		await d._tripStamp("setOut", "stamp");
		expect(sent).toEqual([]);
	});
});
