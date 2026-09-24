import Handlebars from "handlebars";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readRepo as read } from "../fakes/css.js";

// Three pieces of Book I's expedition chapter the walkthrough had dropped, and what each is for at
// the table:
//
//  • THE WAY AHEAD (p.303, p.322-323). Chart a Course makes "a narrative to-do list" that the GM
//    works through on the road, ticking each challenge off once the party has dealt with it. The
//    list stood only on step 2, so mid-journey it was a Back-click away. Running the journey now
//    shows it, with a tick.
//  • OTHER PREPARATIONS (p.309-311). A Pull Together and a follower's task are ROLLED ON RETURN,
//    and the book says to note them "so that you don't forget them later". The advice sits at the
//    foot of the Requisition step, with a note field, and Going home reads the note back.
//  • SUPPLIES (p.304). One line on Outfit: a use a day each, or four to a use with a mess kit.

vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");
const { chartPicked, chartGroupOf } = await import("../../module/dialogs/expedition-data.js");

const HBS = read("templates/dialogs/expedition.hbs");
const STEPS = Object.create(ExpeditionDialog.prototype)._steps;
const stepOf = key => STEPS.find(s => s.key === key);

let store;

function dialog(trip = {}) {
	store.expeditionAnswers = { currentId: "trip-1", list: [{ id: "trip-1", title: "", createdAt: 0, ...trip }] };
	const d = Object.create(ExpeditionDialog.prototype);
	d._rolls = {};
	d.render = () => {};
	return d;
}

const saved = () => store.expeditionAnswers.list[0];

/** The template with only what these blocks read; the rest of the page stays empty. */
function render(context) {
	const hb = Handlebars.create();
	hb.registerPartial("stonetop.guide-toc", "");
	hb.registerPartial("stonetop.expedition-journey", "");
	hb.registerPartial("stonetop.expedition-load", "");
	hb.registerPartial("stonetop.section-heading", read("templates/actor/partials/section-heading.hbs"));
	hb.registerHelper("localize", s => s);
	hb.registerHelper("eq", (a, b) => a === b);
	hb.registerHelper("and", (...a) => a.slice(0, -1).every(Boolean));
	hb.registerHelper("boldMissText", s => s);
	return hb.compile(HBS)(context);
}

beforeEach(() => {
	store = { expeditionAnswers: {} };
	global.game = {
		i18n: global.game.i18n,
		user: { isGM: true },
		settings: {
			settings: new Map([["stonetop-pwd.expeditionAnswers", { scope: "world" }]]),
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
	globalThis.foundry.utils.setProperty = (obj, path, value) => {
		const keys = path.split(".");
		const last = keys.pop();
		let at = obj;
		for (const key of keys) at = (at[key] ??= {});
		at[last] = value;
		return true;
	};
});

describe("the way ahead, on Running the journey", () => {
	const charted = () => dialog({ chart: { picked: [
		{ id: "a", group: chartGroupOf("watchOut"), key: "watchOut", answer: "the crinwin" },
		{ id: "b", group: chartGroupOf("perilous"), key: "perilous", answer: "the Steplands" },
		{ id: "c", group: "challenges", key: null, text: "The ford is up", answer: "" },
	] } });

	it("is on the step", () => {
		expect(stepOf("running").chartTodo).toBe(true);
	});

	it("prints each line as it was told, grouped as it was charted", () => {
		const todo = charted()._chartTodo();
		expect(todo.hasRows).toBe(true);
		const lines = todo.groups.flatMap(g => g.entries);
		// A blank takes the answer into the sentence; a line without one has it after.
		const watch = lines.find(e => e.id === "a");
		expect(watch.line).toContain("the crinwin");
		expect(watch.line).not.toContain("___");
		expect(watch.said).toBe("");
		expect(lines.find(e => e.id === "b").said).toBe("the Steplands");
		expect(lines.find(e => e.id === "c").line).toBe("The ford is up");
	});

	it("escapes a line the GM wrote", () => {
		const todo = dialog({ chart: { picked: [{ id: "x", group: "challenges", text: "<b>mud</b>" }] } })._chartTodo();
		expect(todo.groups[0].entries[0].line).toBe("&lt;b&gt;mud&lt;/b&gt;");
	});

	it("ticks a line off and keeps it ticked", async () => {
		const d = charted();
		await d._markChartDone("b", true);
		expect(chartPicked(saved().chart).find(e => e.id === "b").done).toBe(true);
		expect(d._chartTodo().groups.flatMap(g => g.entries).find(e => e.id === "b").done).toBe(true);
		await d._markChartDone("b", false);
		expect(chartPicked(saved().chart).find(e => e.id === "b").done).toBe(false);
	});

	it("draws a box per line, checked for the ones dealt with", () => {
		const d = charted();
		d._log().list[0].chart.picked[1].done = true;
		const html = render({ step: stepOf("running"), chartTodo: d._chartTodo() });
		expect(html.match(/stonetop-exp-todo-check/g)).toHaveLength(3);
		const done = html.slice(html.indexOf(`data-chart-id="b"`) - 60, html.indexOf(`data-chart-id="b"`) + 300);
		expect(done).toContain("is-done");
		expect(done).toContain("checked");
	});

	it("says so when nothing was charted", () => {
		const html = render({ step: stepOf("running"), chartTodo: dialog()._chartTodo() });
		expect(html).toContain("Nothing was charted for this trip");
	});
});

describe("other preparations, and what waits on the return", () => {
	it("sits at the foot of Requisition, with a note field kept in the old prep field", () => {
		const step = stepOf("requisition");
		expect(step.endAside.label).toBe("Other preparations");
		expect(step.endAside.body).toContain("rolled when they come home");
		expect(step.qa).toMatchObject({ kind: "single", key: "prep" });
	});

	it("keeps the Requisition roll directly under its own sentence", () => {
		const html = render({ step: stepOf("requisition"), endAside: stepOf("requisition").endAside, showRoll: true, showTiers: true, tiers: [] });
		expect(html.indexOf("stonetop-spring-roll-wrap")).toBeLessThan(html.indexOf("Other preparations"));
	});

	it("saves the note on the trip, and Going home reads it back", async () => {
		const d = dialog();
		const qa = d._qaContext(stepOf("requisition").qa);
		await d._saveField(qa.path, "Pull Together on the granary roof.\nOwain watches Ergben.");
		expect(saved().prep).toBe("Pull Together on the granary roof.\nOwain watches Ergben.");

		const html = render({ step: stepOf("home"), homeProjects: { text: saved().prep } });
		expect(html).toContain("Waiting on their return");
		expect(html).toContain("Owain watches Ergben.");
	});

	it("still reminds the GM when nothing was noted", () => {
		expect(stepOf("home").projects).toBe(true);
		const html = render({ step: stepOf("home"), homeProjects: { text: "" } });
		expect(html).toContain("Nothing was noted under Other preparations");
	});
});

describe("supplies, on Outfit", () => {
	it("gives the book's arithmetic", () => {
		const body = stepOf("outfit").body;
		expect(body).toContain("1 use of supplies a day");
		expect(body).toContain("mess kit");
		expect(body).toContain("at least 1 Surplus of supplies");
	});
});
