// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import Handlebars from "handlebars";
import { declarations, readCss, readRepo } from "../fakes/css.js";
import { buildAggregateVM, buildTrackVM, withGhostNow } from "../../module/timeline/timeline-view.js";
import { periodFacts } from "../../module/timeline/timeline-core.js";

// A SEASON'S "+ ADD" SLOT (user, 2026-10-10): a button at the foot of each season's cards, where an
// entry written into that season lands, and a GHOST of the clock's season when nothing is filed in
// it yet. Pinned here: who is offered a slot, what date it hands back, that the ghost appears only
// where it should, and that every shape draws it.

vi.mock("../../module/timeline/timeline-places.js", () => ({
	placeSuggestions: () => [],
	mergePlaceNames: (...lists) => lists.flat().filter(Boolean),
}));

const { TimelineEntryDialog } = await import("../../module/dialogs/TimelineEntryDialog.js");
const { TimelineWindow } = await import("../../module/dialogs/TimelineWindow.js");

function entry(over = {}) {
	return { id: "e1", year: 2, season: "summer", order: 0, title: "A thing", source: "hand", ...over };
}

const track = (trackId, entries = []) => ({ trackId, name: trackId === "st" ? "Stonetop" : "Ellis", entries });

describe("withGhostNow", () => {
	const summer2 = { ...periodFacts(entry()), entries: [] };

	it("adds the clock's season, empty and marked, when nothing is filed in it", () => {
		const out = withGhostNow([summer2], { season: "autumn", year: 2 });
		expect(out.map(p => p.key)).toEqual(["2:summer", "2:autumn"]);
		expect(out[1]).toMatchObject({ ghost: true, season: "autumn", year: 2, entries: [] });
	});

	it("sorts it among the periods by rank", () => {
		expect(withGhostNow([summer2], { season: "spring", year: 2 }).map(p => p.key)).toEqual(["2:spring", "2:summer"]);
	});

	it("adds nothing when the season is already drawn, or the clock has no season", () => {
		expect(withGhostNow([summer2], { season: "summer", year: 2 })).toEqual([summer2]);
		expect(withGhostNow([summer2], { season: "", year: 2 })).toEqual([summer2]);
		expect(withGhostNow([summer2], null)).toEqual([summer2]);
	});
});

describe("a single thread's add slots", () => {
	it("ends every season with a slot handing back its date, for a writer", () => {
		const vm = buildTrackVM(track("st", [entry(), entry({ id: "e2", season: "", yearOnly: true, year: -3 })]), { canEdit: true });
		const [yearOnly, summer] = vm.periods;
		expect(summer.add).toMatchObject({ key: "2:summer", season: "summer", year: 2, yearOnly: false, trackId: "" });
		expect(summer.add.label).toContain("Summer");
		expect(yearOnly.add).toMatchObject({ season: "", year: -3, yearOnly: true });
	});

	it("offers no slot and no ghost to a reader who cannot write", () => {
		const vm = buildTrackVM(track("st", [entry()]), { canEdit: false, ghostNow: { season: "winter", year: 2 } });
		expect(vm.periods.every(p => p.add === null)).toBe(true);
		expect(vm.periods.some(p => p.ghost)).toBe(false);
	});

	it("draws the clock's empty season as a ghost that takes a side and opens its year", () => {
		const vm = buildTrackVM(track("st", [entry()]), { canEdit: true, ghostNow: { season: "spring", year: 3 } });
		const ghost = vm.periods.at(-1);
		expect(ghost).toMatchObject({ key: "3:spring", ghost: true, entries: [], startsYear: true, above: false });
		expect(ghost.add).toMatchObject({ season: "spring", year: 3 });
	});

	it("hands a writer's empty thread the ghost instead of the invite", () => {
		const vm = buildTrackVM(track("st"), { canEdit: true, ghostNow: { season: "spring", year: 1 } });
		expect(vm.isEmpty).toBe(true);
		expect(vm.blank).toBe(false);
		expect(vm.periods.map(p => p.key)).toEqual(["1:spring"]);
		expect(buildTrackVM(track("st"), { canEdit: false, ghostNow: { season: "spring", year: 1 } }).blank).toBe(true);
	});

	it("draws no ghost on a thread the Filter menu has emptied", () => {
		const vm = buildTrackVM(track("st", [entry()]), { canEdit: true, hidden: ["hand"], ghostNow: { season: "spring", year: 3 } });
		expect(vm.allHidden).toBe(true);
		expect(vm.periods).toEqual([]);
	});

	it("gives an Age's bare year no slot", () => {
		const vm = buildTrackVM(track("st", [entry()]), { canEdit: true, ageYears: [-40] });
		expect(vm.periods.find(p => p.ageMark).add).toBeNull();
	});
});

describe("the aggregate's add slots", () => {
	const tracks = [track("st", [entry()]), track("pc")];

	it("puts a slot in each writable thread's cell, empty cells included, naming the thread", () => {
		const vm = buildAggregateVM(tracks, { canEdit: id => id === "pc" });
		const [st, pc] = vm.periods[0].lanes;
		expect(st.add).toBeNull();
		expect(pc.isEmpty).toBe(true);
		expect(pc.add).toMatchObject({ key: "2:summer", season: "summer", year: 2, trackId: "pc" });
		expect(pc.add.label).toContain("Ellis");
		// The period itself carries none: on the board the lanes hold the cards.
		expect(vm.periods[0].add).toBeNull();
	});

	it("adds the ghost when some thread is writable, and marks its writable cells' slots", () => {
		const vm = buildAggregateVM(tracks, { canEdit: id => id === "pc", ghostNow: { season: "winter", year: 2 } });
		const ghost = vm.periods.at(-1);
		expect(ghost).toMatchObject({ key: "2:winter", ghost: true });
		expect(ghost.lanes.map(l => l.add?.ghost ?? null)).toEqual([null, true]);
		expect(ghost.lanes[1].add).toMatchObject({ season: "winter", trackId: "pc" });
		expect(buildAggregateVM(tracks, { canEdit: () => false, ghostNow: { season: "winter", year: 2 } })
			.periods.some(p => p.ghost)).toBe(false);
	});
});

describe("the entry dialog opened from a slot", () => {
	it("opens a new entry on 'some time that year' when the slot is a year-only block", () => {
		const dialog = new TimelineEntryDialog({ season: "", year: -3, yearOnly: true, nowYear: 4 });
		expect(dialog._yearOnly).toBe(true);
		expect(dialog._year).toBe(-3);
		// "Years ago" counts from the clock, not from the season pressed.
		expect(dialog._nowYear).toBe(4);
	});

	it("never opens a seasoned slot as year-only, and an edit reads its own entry", () => {
		expect(new TimelineEntryDialog({ season: "summer", year: 2, yearOnly: true })._yearOnly).toBe(false);
		expect(new TimelineEntryDialog({ entry: entry({ season: "" }), yearOnly: true })._yearOnly).toBe(false);
	});
});

describe("the window's slot handler", () => {
	function press(html, { trackId = "st" } = {}) {
		const win = Object.create(TimelineWindow.prototype);
		win._trackId = trackId;
		win._writeNewEntry = vi.fn();
		document.body.innerHTML = html;
		win._onAddHere(document.querySelector(".stonetop-timeline-add"));
		return win._writeNewEntry.mock.calls[0];
	}

	it("writes on the lane's thread, on the slot's season, with no chooser", () => {
		const call = press(`<div data-track-id="pc"><button class="stonetop-timeline-add" data-season="autumn" data-year="0" data-year-only="false"></button></div>`, { trackId: "" });
		expect(call).toEqual(["pc", { season: "autumn", year: 0, yearOnly: false }]);
	});

	it("falls back to the window's own thread, and the undated block to the clock's year", () => {
		const call = press(`<button class="stonetop-timeline-add" data-season="" data-year="" data-year-only="false"></button>`);
		expect(call[0]).toBe("st");
		expect(call[1].season).toBe("");
		expect(call[1].year).toBeUndefined();
	});
});

describe("a season above the line", () => {
	const CSS = readCss();
	// The slot is the list's last item, so stacking outward puts it at the far end, where the entry
	// it writes will appear (user, 2026-10-10).
	it("stacks its cards outward from the line, the add slot at the top", () => {
		expect(declarations(CSS, ".stonetop-timeline-hperiod--above .stonetop-timeline-hcards")).toMatch(/flex-direction:\s*column-reverse/);
		expect(declarations(CSS, ".stonetop-timeline-hperiod--below .stonetop-timeline-hcards") ?? "").not.toMatch(/column-reverse/);
	});

	it("turns the move arrows over, since earlier is down there", () => {
		for (const glyph of ["fa-chevron-up", "fa-chevron-down"]) {
			expect(declarations(CSS, `.stonetop-timeline-hperiod--above .stonetop-timeline-card-actions button > i.${glyph}`)).toMatch(/rotate\(180deg\)/);
		}
	});
});

describe("every shape draws the slot", () => {
	const hbs = Handlebars.create();
	hbs.registerHelper("localize", key => key);
	hbs.registerPartial("stonetop.timeline-add-slot", readRepo("templates/dialogs/partials/timeline-add-slot.hbs"));
	hbs.registerPartial("stonetop.timeline-card", "<li class=\"card\"></li>");
	hbs.registerPartial("stonetop.timeline-period-head", "");
	hbs.registerPartial("stonetop.timeline-lane-head", "");
	hbs.registerPartial("stonetop.timeline-period", readRepo("templates/dialogs/partials/timeline-period.hbs"));
	hbs.registerPartial("stonetop.timeline-hperiod", readRepo("templates/dialogs/partials/timeline-hperiod.hbs"));
	const window = hbs.compile(readRepo("templates/dialogs/timeline.hbs"));
	const page = hbs.compile(readRepo("templates/journal/timeline-page.hbs"));

	const single = (canEdit) => buildTrackVM(track("st", [entry()]), { canEdit, ghostNow: { season: "autumn", year: 2 } });
	const board = () => buildAggregateVM([track("st", [entry()]), track("pc")], { canEdit: () => true, ghostNow: { season: "autumn", year: 2 } });

	const draw = (vm, { singleTrack, horizontal }) => {
		document.body.innerHTML = window({ single: singleTrack, horizontal, timeline: vm, canEdit: true });
		return document.body;
	};

	for (const horizontal of [true, false]) {
		it(`single thread, ${horizontal ? "across" : "down"}: a slot last in each list, and the ghost`, () => {
			const root = draw(single(true), { singleTrack: true, horizontal });
			const lists = [...root.querySelectorAll(".stonetop-timeline-cards")];
			expect(lists).toHaveLength(2);
			for (const list of lists) expect(list.lastElementChild.classList.contains("stonetop-timeline-add-slot")).toBe(true);
			expect(root.querySelector(horizontal ? ".stonetop-timeline-hperiod--ghost" : ".stonetop-timeline-period--ghost")).not.toBeNull();
			const button = root.querySelector(".stonetop-timeline-add");
			expect(button.dataset).toMatchObject({ season: "summer", year: "2", yearOnly: "false", timelineFocus: "add-2:summer" });
		});

		it(`aggregate, ${horizontal ? "swimlanes" : "board"}: a slot in every writable cell`, () => {
			const root = draw(board(), { singleTrack: false, horizontal });
			// Two threads by two seasons (summer, and autumn's ghost).
			expect(root.querySelectorAll(".stonetop-timeline-lane .stonetop-timeline-add")).toHaveLength(4);
			expect(root.querySelector(".stonetop-timeline-lane .stonetop-timeline-add-slot--ghost")).not.toBeNull();
			expect(root.querySelector('[data-track-id="pc"] .stonetop-timeline-add').dataset.timelineFocus).toBe("add-2:summer-pc");
		});
	}

	it("draws no slot on the read-only journal page", () => {
		document.body.innerHTML = page({ stonetop: { timeline: buildTrackVM(track("st", [entry()])) } });
		expect(document.querySelector(".stonetop-timeline-card, .card")).not.toBeNull();
		expect(document.querySelector(".stonetop-timeline-add")).toBeNull();
	});
});
