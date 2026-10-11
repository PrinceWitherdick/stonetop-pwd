import { describe, it, expect } from "vitest";
import {
	buildAggregateVM, buildTrackVM, defaultHiddenTracks, kindMenu, seasonGlyphClass, threadMenu,
} from "../../module/timeline/timeline-view.js";
import { periodLabel } from "../../module/seasons/current-season.js";

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
			entry({ id: "b", source: "levelup" }),
		] });
		const [typed, auto] = vm.periods[0].entries;
		expect(typed.isAuto).toBe(false);
		expect(auto.isAuto).toBe(true);
	});

	// Every row is STORED now: a milestone is the table's history with a first draft written by the
	// system, and a GM fixing a mis-credited kill or a wrong date edits it like anything typed.
	it("gives a milestone the same controls as a typed row", () => {
		const vm = buildTrackVM({ trackId: "pc", name: "Ellis", entries: [
			entry({ id: "a", source: "hand" }),
			entry({ id: "b", source: "levelup", key: "levelup:2" }),
		] }, { canEdit: true });
		const [typed, milestone] = vm.periods[0].entries;
		expect(typed.canEdit).toBe(true);
		expect(milestone.canEdit).toBe(true);
	});

	// The chip is the kind NAMED, not just drawn: an icon alone is a guess on a magnifier.
	it("names a milestone's kind in words beside its glyph", () => {
		const vm = buildTrackVM({ trackId: "pc", name: "Ellis", entries: [entry({ source: "kills", foes: ["Crinwin"] })] });
		const [card] = vm.periods[0].entries;
		expect(card.kind).toBe("kills");
		expect(card.kindIcon).toBe("fa-skull");
		expect(card.kindLabel).toBe("Kills");
	});

	it("files a kind it has never heard of as a typed row rather than failing", () => {
		const vm = buildTrackVM({ trackId: "pc", name: "Ellis", entries: [entry({ source: "from-the-future" })] });
		expect(vm.periods[0].entries[0].kind).toBe("hand");
		expect(vm.periods[0].entries[0].isAuto).toBe(false);
	});
});

describe("kills on the timeline", () => {
	const track = { trackId: "pc", name: "Ellis", entries: [
		entry({ id: "k1", source: "kills", title: "", foes: ["Crinwin", "Bandit Chief", "Crinwin", "Crinwin"] }),
		entry({ id: "k2", source: "kills", season: "summer", title: "The ford", foes: ["Wolf"] }),
		entry({ id: "h", source: "hand", season: "summer" }),
	] };

	// Counted by name in the order each first fell, so a horde reads as one line, not twelve.
	it("sums a season's kills up by name", () => {
		const [card] = buildTrackVM(track).periods[0].entries;
		expect(card.killSummary).toBe("Crinwin ×3, Bandit Chief");
	});

	it("titles an untitled kills row with its count, and keeps a title somebody wrote", () => {
		const vm = buildTrackVM(track);
		expect(vm.periods[0].entries[0].title).toBe("Slew 4");
		expect(vm.periods[1].entries.find(c => c.id === "k2").title).toBe("The ford");
	});

	// The running total is the character's, not this view's: hiding kills must not zero it.
	it("totals every kill on the thread, whatever the reader has hidden", () => {
		expect(buildTrackVM(track).killTotal).toBe(5);
		expect(buildTrackVM(track, { hidden: ["kills"] }).killTotal).toBe(5);
	});
});

describe("the reader's Filter menu", () => {
	const track = { trackId: "pc", name: "Ellis", entries: [
		entry({ id: "a", source: "kills", foes: ["Wolf"] }),
		entry({ id: "b", source: "levelup", season: "summer" }),
	] };

	// A season holding nothing but hidden rows leaves nothing behind: no empty block, no column.
	it("drops a season whose every row is hidden", () => {
		const vm = buildTrackVM(track, { hidden: ["kills"] });
		expect(vm.periods.map(p => p.key)).toEqual(["1:summer"]);
	});

	// Told apart from an empty thread, so the page can say "your filter is hiding this" and offer
	// the way back, rather than "nothing has been written".
	it("tells a fully filtered thread from an empty one", () => {
		const hidden = buildTrackVM(track, { hidden: ["kills", "levelup"] });
		expect(hidden.isEmpty).toBe(false);
		expect(hidden.allHidden).toBe(true);
		const empty = buildTrackVM({ trackId: "pc", name: "Ellis", entries: [] });
		expect(empty.isEmpty).toBe(true);
		expect(empty.allHidden).toBe(false);
	});

	it("filters the aggregate the same way", () => {
		const vm = buildAggregateVM([track], { hidden: ["kills", "levelup"] });
		expect(vm.isEmpty).toBe(false);
		expect(vm.allHidden).toBe(true);
		expect(vm.periods).toEqual([]);
	});

	// A Seasons Change prints in its season's heading, so it is no kind of card to hide.
	it("offers no line for the season's own row", () => {
		expect(kindMenu().map(k => k.source)).not.toContain("season");
		expect(kindMenu().map(k => k.source)).toContain("levelup");
	});
});

describe("a Seasons Change on the aggregate", () => {
	const tracks = [
		{ trackId: "steading", trackKind: "steading", name: "Stonetop", entries: [
			entry({ id: "s1", source: "season", title: "Spring", body: "<p>Surplus: +1</p>" }),
			entry({ id: "s2", title: "The thaw" }),
		] },
		{ trackId: "pc-ellis", trackKind: "character", name: "Ellis", entries: [entry({ id: "e1" })] },
	];

	// The heading spans the board, and the season's news is whose it is: Stonetop's.
	it("goes in the season's heading, carrying its thread, and out of the lane", () => {
		const vm = buildAggregateVM(tracks, { canEdit: id => id === "steading" });
		const [spring] = vm.periods;
		expect(spring.seasonNotes).toEqual([
			{ id: "s1", trackId: "steading", title: "", body: "<p>Surplus: +1</p>", canEdit: true },
		]);
		expect(spring.lanes[0].entries.map(e => e.id)).toEqual(["s2"]);
	});

	it("is hidden with its thread", () => {
		const vm = buildAggregateVM(tracks, { hiddenTracks: ["steading"] });
		expect(vm.periods[0].seasonNotes).toEqual([]);
	});

	it("is not hidden by an old Seasons Change tick in the reader's filter", () => {
		const vm = buildAggregateVM(tracks, { hidden: ["season"] });
		expect(vm.periods[0].seasonNotes.map(n => n.id)).toEqual(["s1"]);
	});
});

describe("hiding threads off the aggregate", () => {
	const tracks = [
		{ trackId: "steading", trackKind: "steading", name: "Stonetop", entries: [entry({ id: "s1", title: "The thaw" })] },
		{ trackId: "pc-ellis", trackKind: "character", name: "Ellis", entries: [entry({ id: "e1", year: 2, season: "summer" })] },
		{ trackId: "pc-kefta", trackKind: "character", name: "Kefta", entries: [] },
	];

	// Dropped whole: no head, no lane in any season, in either shape of the board.
	it("drops a hidden thread's head and lanes", () => {
		const vm = buildAggregateVM(tracks, { hiddenTracks: ["pc-kefta"] });
		expect(vm.tracks.map(t => t.trackId)).toEqual(["steading", "pc-ellis"]);
		for (const period of vm.periods) expect(period.lanes.map(l => l.trackId)).toEqual(["steading", "pc-ellis"]);
		expect(vm.swimlanes.map(s => s.trackId)).toEqual(["steading", "pc-ellis"]);
	});

	// A season only the hidden thread wrote in goes with it, as a hidden kind's season does.
	it("drops a season only the hidden thread had anything in", () => {
		const vm = buildAggregateVM(tracks, { hiddenTracks: ["pc-ellis"] });
		expect(vm.periods.map(p => p.key)).toEqual(["1:spring"]);
	});

	// Hiding every thread that wrote anything reads as filtered, with the way back, not as unwritten.
	it("reads as filtered, not empty, when every written thread is hidden", () => {
		const vm = buildAggregateVM(tracks, { hiddenTracks: ["steading", "pc-ellis"] });
		expect(vm.isEmpty).toBe(false);
		expect(vm.allHidden).toBe(true);
	});

	// User, 2026-10-03: a player's full timeline opens on their own story; the rest is a tick away.
	it("hides every thread but a player's own characters' by default", () => {
		expect(defaultHiddenTracks(tracks, t => t.trackId === "pc-ellis")).toEqual(["steading", "pc-kefta"]);
	});

	// A player may own the steading too; it is the town's thread, not theirs.
	it("never counts Stonetop's thread as a player's own", () => {
		expect(defaultHiddenTracks(tracks, t => t.trackId !== "pc-kefta")).toEqual(["steading", "pc-kefta"]);
	});

	// A board of nothing but a filter reads as broken.
	it("hides nothing from a reader with no character of their own", () => {
		expect(defaultHiddenTracks(tracks, () => false)).toEqual([]);
		expect(defaultHiddenTracks(tracks, t => t.trackKind === "steading")).toEqual([]);
	});

	it("offers every thread in the board's order, marked shown or hidden", () => {
		expect(threadMenu(tracks, ["pc-ellis"])).toEqual([
			{ trackId: "steading", icon: "fa-house-chimney", label: "Stonetop", shown: true },
			{ trackId: "pc-ellis", icon: "fa-user", label: "Ellis", shown: false },
			{ trackId: "pc-kefta", icon: "fa-user", label: "Kefta", shown: true },
		]);
	});
});

describe("years and sides", () => {
	const track = { trackId: "pc", name: "Ellis", entries: [
		entry({ id: "u", season: "" }),
		entry({ id: "a", season: "summer", year: 1 }),
		entry({ id: "b", season: "winter", year: 1 }),
		entry({ id: "c", season: "spring", year: 2 }),
	] };

	// A year heading opens at the first dated season and wherever the year moves on. The undated
	// block sits before every year and opens none.
	it("opens a year where the year moves on, and never on the undated block", () => {
		const periods = buildTrackVM(track).periods;
		expect(periods.map(p => [p.key, p.startsYear])).toEqual([
			["undated", false], ["1:summer", true], ["1:winter", false], ["2:spring", true],
		]);
	});

	// Across the page, seasons alternate above and below the line so neighbours never crowd.
	it("alternates the sides a season's cards hang on", () => {
		expect(buildTrackVM(track).periods.map(p => p.above)).toEqual([true, false, true, false]);
	});

	it("marks year starts on the aggregate too", () => {
		const vm = buildAggregateVM([track]);
		expect(vm.periods.filter(p => p.startsYear).map(p => p.key)).toEqual(["1:summer", "2:spring"]);
	});
});

describe("the aggregate laid across the page", () => {
	const tracks = [
		{ trackId: "s", name: "Stonetop", entries: [entry({ id: "a" })] },
		{ trackId: "pc", name: "Ellis", entries: [entry({ id: "b", season: "summer" })] },
	];

	// Handlebars cannot index one table by the other, so the board is transposed here: a row per
	// thread, a cell per season, in the periods' order.
	it("transposes the board into one swimlane per thread", () => {
		const vm = buildAggregateVM(tracks);
		expect(vm.swimlanes.map(l => l.trackId)).toEqual(["s", "pc"]);
		expect(vm.swimlanes[0].cells.map(c => c.entries.map(e => e.id))).toEqual([["a"], []]);
		expect(vm.swimlanes[1].cells.map(c => c.entries.map(e => e.id))).toEqual([[], ["b"]]);
	});

	// The SAME objects in both shapes, so enriching the board down enriches it across.
	it("shares its cells with the board read down", () => {
		const vm = buildAggregateVM(tracks);
		expect(vm.swimlanes[1].cells[1]).toBe(vm.periods[1].lanes[1]);
	});

	// Each cell carries whether its season opens a year, so the swimlanes draw the year's rule
	// before it without indexing the periods from inside the cells.
	it("marks each cell with whether its season opens a year", () => {
		const vm = buildAggregateVM(tracks);
		for (const lane of vm.swimlanes) {
			expect(lane.cells.map(c => c.opensYear)).toEqual(vm.periods.map(p => p.startsYear));
		}
	});

	// User, 2026-10-03: what a Seasons Change recorded prints INSIDE its season's heading, not as a
	// card under it that only said the season's name again. It is still a stored row, so the GM can
	// rewrite or remove it from there.
	it("prints a season's own row in its heading, not as a card", () => {
		const vm = buildTrackVM({ trackId: "s", name: "Stonetop", entries: [
			entry({ id: "a", source: "season", title: "Spring", body: "<p>Surplus: +1</p>" }),
			entry({ id: "b", source: "hand" }),
		] }, { canEdit: true });
		const [spring] = vm.periods;
		expect(spring.entries.map(e => e.id)).toEqual(["b"]);
		expect(spring.seasonNotes).toEqual([
			{ id: "a", trackId: "s", title: "", body: "<p>Surplus: +1</p>", canEdit: true },
		]);
	});

	it("keeps a season row's title only where a GM changed it from the season's name", () => {
		const vm = buildTrackVM({ trackId: "s", name: "Stonetop", entries: [
			entry({ id: "a", source: "season", title: "The hungry spring", body: "" }),
		] });
		expect(vm.periods[0].seasonNotes[0].title).toBe("The hungry spring");
	});

	it("opens a season for its own row alone, and none for one with nothing to say", () => {
		const said = buildTrackVM({ trackId: "s", name: "Stonetop", entries: [
			entry({ id: "a", source: "season", title: "Spring", body: "<p>Gains</p>" }),
		] });
		expect(said.periods).toHaveLength(1);
		const blank = buildTrackVM({ trackId: "s", name: "Stonetop", entries: [
			entry({ id: "a", source: "season", title: "Spring", body: "" }),
		] });
		expect(blank.periods).toHaveLength(0);
		// A writer still gets the heading's Edit, to write in it.
		const writable = buildTrackVM({ trackId: "s", name: "Stonetop", entries: [
			entry({ id: "a", source: "season", title: "Spring", body: "" }),
		] }, { canEdit: true });
		expect(writable.periods[0].seasonNotes).toHaveLength(1);
	});

	// A season's shortfall is a second, keyed note; the season's own summary leads whichever was
	// written first (a winter's stores run out before its summary is recorded).
	it("prints a season's summary before its shortfall note", () => {
		const vm = buildTrackVM({ trackId: "s", name: "Stonetop", entries: [
			entry({ id: "short", source: "season", key: "shortfall:1:spring", title: "Winter's shortfall", body: "<p>Ran out.</p>", order: 0 }),
			entry({ id: "sum", source: "season", title: "Spring", body: "<p>Gains</p>", order: 1 }),
		] });
		expect(vm.periods[0].seasonNotes.map(n => n.id)).toEqual(["sum", "short"]);
	});

	// The test macro keys the summaries it seeds ("test:season:<p>"): keyed is not shortfall.
	it("tells a shortfall by its key's prefix, not by having a key", () => {
		const vm = buildTrackVM({ trackId: "s", name: "Stonetop", entries: [
			entry({ id: "short", source: "season", key: "shortfall:1:spring", title: "Winter's shortfall", body: "<p>Ran out.</p>", order: 0 }),
			entry({ id: "sum", source: "season", key: "test:season:0", title: "Spring", body: "<p>Gains</p>", order: 1 }),
		] });
		expect(vm.periods[0].seasonNotes.map(n => n.id)).toEqual(["sum", "short"]);
	});

	// It has no Filter line any more, so a reader who hid "Seasons Change" before it moved must not
	// lose it with no way back.
	it("never filters a season's own row", () => {
		const vm = buildTrackVM({ trackId: "s", name: "Stonetop", entries: [
			entry({ id: "a", source: "season", body: "<p>Gains</p>" }),
		] }, { hidden: ["season"] });
		expect(vm.periods[0].seasonNotes.map(n => n.id)).toEqual(["a"]);
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

	// User, 2026-10-04: a player's name heads their thread with their playbook under it. The window
	// reads it off the actor; the steading has none, so its head stays one line.
	it("carries each thread's playbook to its head, empty where there is none", () => {
		const vm = buildAggregateVM([tracks[0], { ...tracks[1], playbook: "The Seeker" }]);
		expect(vm.tracks.map(t => t.playbook)).toEqual(["", "The Seeker"]);
		expect(vm.swimlanes[1].playbook).toBe("The Seeker");
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

// User, 2026-10-10: a character's thread reads the seasons turning between the things they did,
// from Stonetop's own season notes, over the seasons that thread spans and no further.
describe("Stonetop's season notes on a character's thread", () => {
	const steadingEntries = [
		entry({ id: "y1sp", year: 1, season: "spring", source: "season", title: "Spring", body: "<p>Gains Y1</p>" }),
		entry({ id: "y2sp", year: 2, season: "spring", source: "season", title: "Spring", body: "<p>Gains Y2</p>" }),
		entry({ id: "y2su", year: 2, season: "summer", source: "season", title: "Summer", body: "<p>Gains summer</p>" }),
		entry({ id: "y2au", year: 2, season: "autumn", source: "season", title: "Autumn", body: "<p>Gains autumn</p>" }),
		entry({ id: "card", year: 2, season: "summer", source: "hand", title: "Stonetop's own card" }),
	];
	const steading = { trackId: "steading", entries: steadingEntries, canEdit: false };
	const pc = (rows) => ({ trackId: "pc1", name: "Aster", entries: rows });

	it("prints them only over the seasons the character's thread spans", () => {
		const vm = buildTrackVM(pc([
			entry({ id: "a", year: 2, season: "spring" }),
			entry({ id: "b", year: 2, season: "autumn" }),
		]), { steading });
		expect(vm.periods.map(p => p.key)).toEqual(["2:spring", "2:summer", "2:autumn"]);
		expect(vm.periods.flatMap(p => p.seasonNotes.map(n => n.id))).toEqual(["y2sp", "y2su", "y2au"]);
	});

	it("never brings Stonetop's cards across, only its season notes", () => {
		const vm = buildTrackVM(pc([
			entry({ id: "a", year: 2, season: "spring" }),
			entry({ id: "b", year: 2, season: "autumn" }),
		]), { steading });
		expect(vm.periods.flatMap(p => p.entries.map(e => e.id))).toEqual(["a", "b"]);
	});

	it("names Stonetop's thread on each note, so its Edit writes there", () => {
		const vm = buildTrackVM(pc([entry({ id: "a", year: 2, season: "spring" })]),
			{ canEdit: true, steading: { ...steading, canEdit: true } });
		expect(vm.periods[0].seasonNotes[0]).toMatchObject({ id: "y2sp", trackId: "steading", canEdit: true });
	});

	it("prints none on a thread with nothing of its own", () => {
		const vm = buildTrackVM(pc([]), { steading });
		expect(vm.periods).toEqual([]);
		expect(vm.blank).toBe(true);
	});
});
