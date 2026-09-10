import { describe, it, expect } from "vitest";
import { buildAggregateVM, buildTrackVM, periodLabel, seasonGlyphClass } from "../../module/timeline/timeline-view.js";

// The shape a template is handed. One view model serves the tab, the aggregate window and the
// journal page, so what is pinned here is that the three cannot disagree about which season a card
// is filed under or what that season is called.

function entry(over = {}) {
	return { id: "e1", year: 1, season: "spring", order: 0, title: "A thing", ...over };
}

describe("seasonGlyphClass", () => {
	// The clock says autumn; the icons and the stylesheet say fall. Two places in the system already
	// carry this swap and this is the third.
	it("maps autumn onto the fall art the stylesheet actually has", () => {
		expect(seasonGlyphClass("autumn")).toBe("stonetop-season--fall");
	});

	it("passes the other three straight through", () => {
		expect(seasonGlyphClass("spring")).toBe("stonetop-season--spring");
		expect(seasonGlyphClass("summer")).toBe("stonetop-season--summer");
		expect(seasonGlyphClass("winter")).toBe("stonetop-season--winter");
	});

	it("gives an undated block no glyph at all", () => {
		expect(seasonGlyphClass("")).toBe("");
		expect(seasonGlyphClass("harvest")).toBe("");
	});
});

describe("periodLabel", () => {
	it("names a period the way the Seasons Change journal names its pages", () => {
		expect(periodLabel({ season: "autumn", year: 2 })).toBe("Autumn, Year Two");
	});

	it("names the block for entries that predate the record", () => {
		expect(periodLabel({ season: "", year: 0 })).toBe("Before the record");
	});
});

describe("buildTrackVM", () => {
	it("builds one block per period, oldest first", () => {
		const vm = buildTrackVM({ trackId: "pc", name: "Ellis", entries: [
			entry({ id: "b", year: 2, season: "spring" }),
			entry({ id: "a", year: 1, season: "winter" }),
		] });
		expect(vm.periods.map(p => p.label)).toEqual(["Winter, Year One", "Spring, Year Two"]);
		expect(vm.count).toBe(2);
	});

	it("reports an empty track, so the tab can show its invitation", () => {
		expect(buildTrackVM({ trackId: "pc", name: "Ellis", entries: [] })).toMatchObject({ isEmpty: true, count: 0 });
	});

	// A reader must always be able to tell the record from the bookkeeping.
	it("marks a row the system wrote for itself as auto", () => {
		const vm = buildTrackVM({ trackId: "s", name: "Stonetop", entries: [
			entry({ id: "a", source: "hand" }),
			entry({ id: "b", source: "season" }),
		] });
		const [typed, auto] = vm.periods[0].entries;
		expect(typed.isAuto).toBe(false);
		expect(auto.isAuto).toBe(true);
	});

	// A derived row is a view of ANOTHER record: there is nothing here to edit, and controls that
	// did nothing would be worse than no controls. Refused in the model rather than in the template
	// so the three hosts do not each have to remember.
	it("gives a derived ledger row no controls, however writable the track is", () => {
		const vm = buildTrackVM({ trackId: "pc", name: "Ellis", entries: [
			entry({ id: "a", source: "hand" }),
			entry({ id: "ledger:x", source: "ledger" }),
		] }, { canEdit: true });
		const [typed, derived] = vm.periods[0].entries;
		expect(typed.canEdit).toBe(true);
		expect(derived.canEdit).toBe(false);
	});

	// The Seasons Change row IS stored, so a GM can rewrite or delete it like any other entry, even
	// though it renders as quietly as a derived one.
	it("leaves a season row editable, unlike a derived one", () => {
		const vm = buildTrackVM({ trackId: "s", name: "Stonetop", entries: [
			entry({ id: "a", source: "season" }),
		] }, { canEdit: true });
		expect(vm.periods[0].entries[0]).toMatchObject({ isAuto: true, canEdit: true });
	});

	it("carries the body through raw, for the host to enrich", () => {
		const vm = buildTrackVM({ trackId: "s", name: "Stonetop", entries: [entry({ body: "<p>@UUID[Actor.x]{Ellis}</p>" })] });
		expect(vm.periods[0].entries[0].body).toBe("<p>@UUID[Actor.x]{Ellis}</p>");
	});
});

describe("buildAggregateVM", () => {
	const tracks = [
		{ trackId: "steading", name: "Stonetop", entries: [entry({ id: "s1", year: 1, season: "spring", title: "The thaw" })] },
		{ trackId: "pc-ellis", name: "Ellis", entries: [entry({ id: "e1", year: 2, season: "summer", title: "The barrow" })] },
	];

	// A row of the aggregate is one season across every thread. Without the union, two tracks that
	// never shared a season would render as two separate ladders.
	it("takes the union of every track's periods, oldest first", () => {
		const vm = buildAggregateVM(tracks);
		expect(vm.periods.map(p => p.label)).toEqual(["Spring, Year One", "Summer, Year Two"]);
	});

	it("gives every period a lane per track, so the columns stay level", () => {
		const vm = buildAggregateVM(tracks);
		for (const period of vm.periods) {
			expect(period.lanes.map(l => l.trackId)).toEqual(["steading", "pc-ellis"]);
		}
	});

	it("marks the lanes with nothing in that season as empty rather than dropping them", () => {
		const vm = buildAggregateVM(tracks);
		const spring = vm.periods[0];
		expect(spring.lanes[0]).toMatchObject({ trackId: "steading", isEmpty: false });
		expect(spring.lanes[1]).toMatchObject({ trackId: "pc-ellis", isEmpty: true });
	});

	// An empty column under a character's name is how a reader sees there is a thread to write in.
	it("keeps a track with no entries at all as a lane", () => {
		const vm = buildAggregateVM([...tracks, { trackId: "pc-kefta", name: "Kefta", entries: [] }]);
		expect(vm.tracks.map(t => t.trackId)).toContain("pc-kefta");
		expect(vm.periods[0].lanes.map(l => l.trackId)).toContain("pc-kefta");
	});

	it("asks per track whether this reader may edit it", () => {
		const vm = buildAggregateVM(tracks, { canEdit: (id) => id === "pc-ellis" });
		const summer = vm.periods[1];
		expect(summer.lanes.find(l => l.trackId === "pc-ellis").entries[0].canEdit).toBe(true);
		const spring = vm.periods[0];
		expect(spring.lanes.find(l => l.trackId === "steading").entries[0].canEdit).toBe(false);
	});

	it("reports empty for a world where nothing has been written yet", () => {
		expect(buildAggregateVM([{ trackId: "s", name: "Stonetop", entries: [] }])).toMatchObject({ isEmpty: true });
	});
});
