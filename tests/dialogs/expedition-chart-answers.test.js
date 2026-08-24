import Handlebars from "handlebars";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readRepo as read, readCss, declarations } from "../fakes/css.js";

// Chart a Course: what this trip presented, and what was said about it.
//
// The step used to print the book's twelve requirements and challenges with a tick beside each,
// and later gave every one of them a field as well — which answered "what did you actually tell
// them" and left twelve rows of mostly-empty boxes standing on the one step a GM reads back
// mid-journey as a to-do list. Twelve rows is what the GM called an eyesore, and they were right:
// a menu is not a record.
//
// So the menu moved behind an add button under each heading, and the step now shows only the
// lines that were presented, each drawn the way the GM Toolkit draws an open question: the
// question spiral, the line, and the answer under it. Those rules are SHARED with that tab
// rather than copied — the assertions at the foot are what holds that true.

vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

// The add flow opens a dialog, so the picker is swapped at the module boundary rather than on the
// instance: the dialog imports it by name, and what the tests want to see is the MENU it is
// handed. `pickerImpl` is read at call time, so each test sets its own.
let pickerImpl = () => Promise.resolve(null);
vi.mock("../../module/dialogs/content-picker.js", async (importOriginal) => ({
	...(await importOriginal()),
	pickOrWriteOption: (...args) => pickerImpl(...args),
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");
const { CHART_GROUPS, chartPicked, chartGroupOf, chartEntryText } =
	await import("../../module/dialogs/expedition-data.js");

const HBS = read("templates/dialogs/expedition.hbs");
const CSS = readCss();

const CHART = Object.create(ExpeditionDialog.prototype)._steps.findIndex(s => s.key === "chart");

let store;

/** A dialog instance without the Application constructor, as the sibling suites build one. */
function dialog(chart = null) {
	const trip = { id: "trip-1", title: "", createdAt: 0 };
	if (chart) trip.chart = chart;
	store.expeditionAnswers = { currentId: trip.id, list: [trip] };

	const d = Object.create(ExpeditionDialog.prototype);
	d._step  = CHART;
	d._rolls = {};
	d.render = () => {};
	return d;
}

/** A trip already presenting these authored lines, in order. */
const presenting = (...keys) => dialog({
	picked: keys.map((key, i) => ({ id: `row-${i}`, group: chartGroupOf(key), key, answer: "" })),
});

/** The chart step's groups, as the template receives them. */
function groups(d) {
	return d._qaContext(d._steps[CHART].qa).groups;
}

/** The trip as it now stands in the setting. */
const saved = () => store.expeditionAnswers.list[0];

/** The step as it renders. */
function render(d) {
	const hb = Handlebars.create();
	hb.registerPartial("stonetop.guide-toc", "");
	hb.registerPartial("stonetop.expedition-journey", "");
	hb.registerPartial("stonetop.expedition-load", "");
	hb.registerPartial("stonetop.section-heading", read("templates/actor/partials/section-heading.hbs"));
	hb.registerHelper("localize", s => s);
	hb.registerHelper("eq", (a, b) => a === b);
	hb.registerHelper("and", (...a) => a.slice(0, -1).every(Boolean));
	hb.registerHelper("boldMissText", s => s);
	const step = d._steps[CHART];
	return hb.compile(HBS)({ step, qa: d._qaContext(step.qa) });
}

/** The rendered <li> for one row, by the id it was stored under. */
function row(html, id) {
	const at = html.indexOf(`data-chart-id="${id}"`);
	expect(at, `no row for ${id}`).toBeGreaterThan(-1);
	return html.slice(html.lastIndexOf("<li", at), html.indexOf("</li>", at) + 5);
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
	// The log writer sets dotted paths on a trip; tests/setup.js fakes getProperty but not this.
	globalThis.foundry.utils.setProperty = (obj, path, value) => {
		const keys = path.split(".");
		const last = keys.pop();
		let at = obj;
		for (const key of keys) at = (at[key] ??= {});
		at[last] = value;
		return true;
	};
});

describe("the step shows what was presented, not the book's menu", () => {
	it("starts empty, with a heading and an add button per group", () => {
		const built = groups(dialog());
		expect(built.map(g => g.key)).toEqual(["requirements", "challenges"]);
		expect(built.map(g => g.label)).toEqual(["Requirements", "Challenges"]);
		expect(built.map(g => g.addLabel)).toEqual(["Add a requirement", "Add a challenge"]);
		expect(built.every(g => g.entries.length === 0)).toBe(true);
	});

	it("renders no rows at all for a trip that has charted nothing", () => {
		const html = render(dialog());
		expect(html).not.toContain("data-chart-id");
		// ...and none of the twelve is printed on the page.
		for (const it of CHART_GROUPS.flatMap(g => g.items)) {
			expect(html, it.key).not.toContain(it.text);
		}
	});

	it("draws an add button per group, naming the group it adds to", () => {
		const html = render(dialog());
		for (const group of CHART_GROUPS) {
			expect(html).toContain(`data-chart-group="${group.key}"`);
			expect(html).toContain(group.addLabel);
		}
	});

	it("files each presented line under its own group", () => {
		const built = groups(presenting("guide", "lost", "perilous"));
		expect(built[0].entries.map(e => e.text)).toEqual([chartEntryText({ key: "guide" })]);
		expect(built[1].entries.length).toBe(2);
	});

	it("prints the line and a box to answer it, and nothing to tick", () => {
		const li = row(render(presenting("watchOut")), "row-0");
		expect(li).toContain("Watch out for ___");
		expect(li).toContain("stonetop-exp-chart-answer");
		expect(li).not.toContain("checkbox");
	});
});

describe("adding, answering and removing", () => {
	it("adds the picked line to the group it was added under", async () => {
		const d = dialog();
		await d._mutateChart(list => [...list,
			{ id: "x", group: "challenges", key: "lost", text: "", answer: "" }]);
		expect(chartPicked(saved().chart)).toEqual([
			{ id: "x", group: "challenges", key: "lost", text: "", answer: "", fromRoute: false },
		]);
	});

	it("adds a line the GM wrote in their own words", async () => {
		const d = dialog();
		await d._mutateChart(list => [...list,
			{ id: "own", group: "challenges", key: null, text: "The ford is watched", answer: "" }]);
		const [entry] = chartPicked(saved().chart);
		expect(entry.key).toBe(null);
		expect(chartEntryText(entry)).toBe("The ford is watched");
	});

	it("writes an answer against the row it belongs to, and only that one", async () => {
		const d = presenting("watchOut", "lost");
		await d._saveChartAnswer("row-0", "the wolves of the Ettenmark");
		const picked = chartPicked(saved().chart);
		expect(picked[0].answer).toBe("the wolves of the Ettenmark");
		expect(picked[1].answer).toBe("");
	});

	it("takes a line back off the list", async () => {
		const d = presenting("watchOut", "lost");
		await d._removeChartRow("row-0");
		expect(chartPicked(saved().chart).map(e => e.key)).toEqual(["lost"]);
	});

	it("shows back what was written, escaped", () => {
		const d = dialog({ picked: [
			{ id: "a", group: "challenges", key: "watchOut", answer: '"<wolves>"' },
		] });
		const li = row(render(d), "a");
		expect(li).not.toContain("<wolves>");
		expect(li).toContain("&lt;");
	});
});

describe("the menu behind the add button", () => {
	it("offers every line of that group and nothing from the other", () => {
		for (const group of CHART_GROUPS) {
			expect(group.items.length).toBeGreaterThan(0);
			for (const it of group.items) expect(chartGroupOf(it.key)).toBe(group.key);
		}
	});

	// The list is what was said, and saying "you risk getting lost" twice is not a thing that
	// happens. A group whose every authored line is already on the list still opens, on the
	// write-your-own row: the book's twelve are examples, not the set.
	it("leaves out what this trip has already presented", async () => {
		const seen = [];
		pickerImpl = opts => { seen.push(opts); return Promise.resolve(null); };
		await presenting("lost", "perilous")._addChartRow("challenges");

		expect(seen.length).toBe(1);
		expect(seen[0].title).toBe("Add a challenge");
		const offered = seen[0].options.map(o => o.id);
		expect(offered).not.toContain("lost");
		expect(offered).not.toContain("perilous");
		expect(offered).toContain("watchOut");
		// The line as it will read on the list, unescaped: these are the book's own words.
		expect(seen[0].options.find(o => o.id === "watchOut").html).toBe("Watch out for ___");
	});

	it("adds nothing when the picker is dismissed", async () => {
		pickerImpl = () => Promise.resolve(null);
		const d = dialog();
		await d._addChartRow("requirements");
		expect(saved().chart).toBeUndefined();
	});

	it("puts the picked line on the list, and a written one verbatim", async () => {
		pickerImpl = () => Promise.resolve({ key: "guide" });
		const d = dialog();
		await d._addChartRow("requirements");
		pickerImpl = () => Promise.resolve({ text: "Bring the Judge's writ" });
		await d._addChartRow("requirements");

		const picked = chartPicked(saved().chart);
		expect(picked.map(e => e.key)).toEqual(["guide", null]);
		expect(picked.every(e => e.group === "requirements")).toBe(true);
		expect(chartEntryText(picked[1])).toBe("Bring the Judge's writ");
	});

	it("ignores a group nothing on the step names", async () => {
		pickerImpl = () => { throw new Error("the picker should never open"); };
		const d = dialog();
		await d._addChartRow("nonsense");
		expect(saved().chart).toBeUndefined();
	});
});

describe("how a charted line is drawn", () => {
	// The GM Toolkit's open questions, in that tab's own rules. A hand-matched copy of a look
	// this particular drifts the first time either side is touched, which is the lesson the two
	// rollable tables one dialog over already taught.
	it("wears the toolkit's ruled row, spiral and answer box", () => {
		const li = row(render(presenting("lost")), "row-0");
		expect(li).toContain('class="stonetop-gm-wonder-item"');
		expect(li).toContain('class="stonetop-gm-wonder-head"');
		expect(li).toContain("stonetop-gm-wonder-question--fixed");
		expect(li).toContain("stonetop-gm-wonder-answer");
		expect(HBS).toContain('<ul class="stonetop-gm-wonder-list">');
	});

	it("hangs the question spiral off the row, in the same gutter as the toolkit's", () => {
		// The spiral is a ::before on the head, drawn from the gutter variable — and the
		// expedition's group is the second host of the block that declares it, so a row here
		// hangs its glyph exactly where a row on the toolkit does.
		const vars = declarations(CSS, ".stonetop-exp-chartgroup");
		expect(vars).toContain("--stonetop-wonder-gutter:");
		expect(vars).toContain("--stonetop-wonder-answer-step:");
		expect(declarations(CSS, ".stonetop-gm-wonder-head::before")).toContain("question-spiral.svg");
	});

	it("shares the spans' geometry with the settled question, differing only in ink", () => {
		const both = declarations(CSS, ".stonetop-gm-wonder-question--fixed");
		expect(both).toContain("flex: 1 1 auto;");
		expect(both).toContain("padding: 1px 4px;");
		// Full strength: this is the live list a GM reads on the road, not a filed one.
		expect(both).toContain("color: var(--st-text);");
		expect(declarations(CSS, ".stonetop-gm-wonder-question--settled"))
			.toContain("color: var(--st-text-secondary);");
	});

	it("wears the toolkit's own add button under each list", () => {
		expect(HBS).toContain("stonetop-gm-wonder-add-btn stonetop-exp-chart-add");
		expect(declarations(CSS, ".stonetop-exp-chartgroup > .stonetop-gm-wonder-add-btn"))
			.toContain("align-self: flex-start;");
	});
});
