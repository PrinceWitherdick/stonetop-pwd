import { describe, it, expect } from "vitest";
import { bindJourneyControls, bindJourneySiteRemoval, bindJourneyUndo, journeyPick } from "../../module/dialogs/journey-controls.js";

// The wiring shared by the two surfaces that draw a journey map: the walkthrough's route step and
// the "See the whole map" popout. It is shared precisely so that "click this mark" cannot come to
// mean two different things depending on which window you did it in, which is what these cover.
//
// There is no jsdom in this project, so the DOM is a stand-in for the handful of calls the binder
// makes. The markup itself is pinned against the real partials by expedition-journey.test.js.

/** One element, with the query and listener surface the binder touches. */
function el(props = {}) {
	const handlers = {};
	return {
		...props,
		addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); },
		listenerCount: type => (handlers[type] ?? []).length,
		fire: (type, ev = {}) => { for (const fn of handlers[type] ?? []) fn(ev); },
	};
}

/** A root holding one of each control the partial can render. */
function root(present = {}) {
	const parts = {
		// THE TWO THAT NO LONGER EXIST, kept here on purpose: the partial does not draw them, and
		// what these prove is that the binder does not go looking for them either.
		setStart: el(),
		clear: el(),
		toScene: el(),
		placeSite: el(),
	};
	const byClass = {
		".stonetop-journey-start-btn": present.setStart === false ? null : parts.setStart,
		".stonetop-journey-clear": parts.clear,
		".stonetop-journey-to-scene": present.toScene === false ? null : parts.toScene,
		".stonetop-journey-place-site": present.placeSite === false ? null : parts.placeSite,
	};
	return Object.assign(parts, {
		querySelector: sel => byClass[sel] ?? null,
		querySelectorAll: () => [],
	});
}

describe("what a click on a mark means", () => {
	/** Every arm, recorded. */
	function ran(data) {
		const seen = { picked: null, tiered: null, sited: null };
		journeyPick(data, {
			showTier: tier => { seen.tiered = tier; },
			markSite: uuid => { seen.sited = uuid; },
			markPlace: (slug) => { seen.picked = slug; },
		});
		return seen;
	}

	// Handed on rather than answered here: whether a place is the destination or a stop on a way
	// being drawn is the planner's call, and it is tested there (_chooseJourneyPlace).
	it("hands the place a hotspot names to the planner", () => {
		expect(ran({ slug: "marshedge" }).picked).toBe("marshedge");
	});

	// The "Steplands & Marshedge" arrow names no single place: it renders `data-slug=""` and only
	// moves out a tier. Both surfaces have always read it that way.
	it("moves out a tier for an arrow that names no place", () => {
		const seen = ran({ slug: "", tier: "worlds-end" });
		expect(seen.tiered).toBe("worlds-end");
		expect(seen.picked).toBeNull();
	});

	// A SITE IS A PLACE ON THE WAY (user, 2026-08-24), and no longer a link to a journal. Tapping
	// one used to open its write-up, which made the GM's own barrow the one mark on this map that
	// could not be part of the journey drawn across it. It goes to the planner now, exactly as a
	// lettered place does — but through its own arm, because a site has no slug the travel table
	// knows and the planner has to look its spot up rather than solve for it.
	it("hands a site to the planner as a place on the way, not as a write-up to open", () => {
		const seen = ran({ siteUuid: "JournalEntry.a.JournalEntryPage.b" });
		expect(seen.sited).toBe("JournalEntry.a.JournalEntryPage.b");
		expect(seen.picked).toBeNull();
		expect(seen.tiered).toBeNull();
	});

	// The modifier is half of what a click on either kind of place said, so it travels with both.
	it("carries the shift key through for a site, as it does for a place", () => {
		const seen = { slug: null, site: null };
		journeyPick({ siteUuid: "x" }, {
			showTier: () => {},
			markSite: (uuid, ev) => { seen.site = !!ev?.shiftKey; },
		}, { shiftKey: true });
		expect(seen.site).toBe(true);
	});

	it("does nothing at all for a mark that names nothing", () => {
		expect(ran({})).toEqual({ picked: null, tiered: null, sited: null });
	});

	// The popout hands this the whole dataset of whatever matched its control selector, which can
	// include a mark this surface has no handler for.
	it("stays quiet when the handler for a mark was not supplied", () => {
		expect(() => journeyPick({ siteUuid: "x" }, { showTier: () => {} })).not.toThrow();
	});
});

describe("binding the controls around a map", () => {
	it("wires the site button only when the surface offered a handler", () => {
		const withHandler = root();
		bindJourneyControls(withHandler, { showTier: () => {}, placeSite: () => {} });
		expect(withHandler.placeSite.listenerCount("click")).toBe(1);

		const without = root();
		bindJourneyControls(without, { showTier: () => {} });
		expect(without.placeSite.listenerCount("click")).toBe(0);
	});

	// The partial builds the button GM-only and only with a map on screen, so both surfaces have
	// to survive it being absent rather than assuming their own template drew it.
	it("survives a partial that rendered no site button", () => {
		const bare = root({ placeSite: false });
		expect(() => bindJourneyControls(bare, { showTier: () => {}, placeSite: () => {} }))
			.not.toThrow();
	});

	it("presses through to the surface that owns the picture", () => {
		let pressed = 0;
		const r = root();
		bindJourneyControls(r, { showTier: () => {}, placeSite: () => { pressed++; } });
		r.placeSite.fire("click");
		expect(pressed).toBe(1);
	});

	// NEITHER END OF THE JOURNEY IS WIRED HERE ANY MORE (user, 2026-08-24). There was a
	// "Setting out from Stonetop" button whose press armed the next click, and an × that un-picked
	// the destination; both went with the row they sat in, and both acts are gestures on the
	// picture now (ExpeditionDialog `_chooseJourneyPlace` and `_undoJourneyMark`). A binder that
	// went on reaching for them would be the thing keeping dead markup alive.
	it("wires neither end of the journey, whatever the markup still offers", () => {
		const r = root();
		bindJourneyControls(r, { showTier: () => {} });
		expect(r.setStart.listenerCount("click")).toBe(0);
		expect(r.clear.listenerCount("click")).toBe(0);
	});

	// The scene button rides the map-tab row beside the site button now, but it is found by class
	// anywhere under the root it is handed — so moving it in the partial moved no JS, and this is
	// what says so.
	it("presses the scene button through wherever the partial put it", () => {
		let drawn = 0;
		const r = root();
		bindJourneyControls(r, { showTier: () => {}, toScene: () => { drawn++; } });
		r.toScene.fire("click");
		expect(drawn).toBe(1);
	});
});

// THE RIGHT-CLICK LADDER OVER THE DESTINATION LIST, which is what keeps a world with no book art
// on disk able to un-set a trip at all: the picture is the only other place this gesture lives, and
// there is no picture there.
describe("taking the trip back from the list", () => {
	/** A root that answers `closest` the way a real one would for one clicked node. */
	function listRoot() {
		const r = el({ contains: () => true });
		r.click = target => {
			const seen = { prevented: 0, stopped: 0 };
			r.fire("contextmenu", {
				target,
				preventDefault: () => { seen.prevented++; },
				stopPropagation: () => { seen.stopped++; },
			});
			return seen;
		};
		return r;
	}
	const row = () => ({ closest: sel => (sel === ".stonetop-journey-row" ? row() : null) });
	const notARow = { closest: () => null };

	it("takes the trip back a step on a right-click over a row", () => {
		let undone = 0;
		const r = listRoot();
		bindJourneyUndo(r, () => { undone++; });

		const seen = r.click(row());
		expect(undone).toBe(1);
		// Swallowed, so the browser's own menu does not open over the list on the way past.
		expect(seen.prevented).toBe(1);
		expect(seen.stopped).toBe(1);
	});

	// A right-click means "take one thing back", and it is asked over something that IS the trip.
	// Over the readout, the hint or the fold headings it would be the browser's own menu going
	// missing for nothing.
	it("leaves a right-click anywhere else alone", () => {
		let undone = 0;
		const r = listRoot();
		bindJourneyUndo(r, () => { undone++; });

		const seen = r.click(notARow);
		expect(undone).toBe(0);
		expect(seen.prevented).toBe(0);
	});

	it("binds nothing at all when no handler was supplied", () => {
		const r = listRoot();
		bindJourneyUndo(r, null);
		expect(r.listenerCount("contextmenu")).toBe(0);
	});
});

describe("lifting a pin off the map", () => {
	/** A root that answers `closest` the way a real one would for one clicked node. */
	function canvas(pin = null) {
		const r = el({ contains: () => true });
		r.click = (target) => {
			const seen = { prevented: 0, stopped: 0 };
			r.fire("contextmenu", {
				target,
				preventDefault: () => { seen.prevented++; },
				stopPropagation: () => { seen.stopped++; },
			});
			return seen;
		};
		r.pin = pin;
		return r;
	}

	const sitePin = uuid => ({
		dataset: { siteUuid: uuid },
		closest: sel => (sel === ".stonetop-journey-site" ? sitePin(uuid) : null),
	});

	it("takes a right-click on a site pin, and eats the browser menu", () => {
		const removed = [];
		const r = canvas();
		bindJourneySiteRemoval(r, uuid => removed.push(uuid));
		const seen = r.click(sitePin("JournalEntry.a.JournalEntryPage.b"));
		expect(removed).toEqual(["JournalEntry.a.JournalEntryPage.b"]);
		expect(seen.prevented).toBe(1);
		expect(seen.stopped).toBe(1);
	});

	// A right-click on the map itself, or on one of the book's own pins. Both belong to whatever
	// else is listening; the map's own context menu is not this handler's to take.
	it("leaves every other right-click alone", () => {
		const removed = [];
		const r = canvas();
		bindJourneySiteRemoval(r, uuid => removed.push(uuid));
		const seen = r.click({ closest: () => null });
		expect(removed).toEqual([]);
		expect(seen.prevented).toBe(0);
	});

	it("binds nothing without a root or without a handler", () => {
		expect(() => bindJourneySiteRemoval(null, () => {})).not.toThrow();
		const r = canvas();
		bindJourneySiteRemoval(r, null);
		expect(r.listenerCount("contextmenu")).toBe(0);
	});
});
