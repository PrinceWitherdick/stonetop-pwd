import { describe, it, expect } from "vitest";
import { bindJourneyControls, bindJourneySiteRemoval, journeyPick } from "../../module/dialogs/journey-controls.js";

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
		origin: el({ value: "stonetop" }),
		clear: el(),
		toScene: el(),
		placeSite: el(),
	};
	const byClass = {
		".stonetop-journey-origin": parts.origin,
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
		const seen = { picked: null, tiered: null, opened: null };
		journeyPick(data, {
			showTier: tier => { seen.tiered = tier; },
			openSite: uuid => { seen.opened = uuid; },
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

	// A site is the GM's own prep rather than a charted destination, so it opens rather than
	// setting where the party is bound. It carries neither of the other two attributes, so the
	// order below costs nothing today and says which reading wins if one ever carries both.
	it("opens a site's write-up rather than making it the destination", () => {
		const seen = ran({ siteUuid: "JournalEntry.a.JournalEntryPage.b" });
		expect(seen.opened).toBe("JournalEntry.a.JournalEntryPage.b");
		expect(seen.picked).toBeNull();
		expect(seen.tiered).toBeNull();
	});

	it("does nothing at all for a mark that names nothing", () => {
		expect(ran({})).toEqual({ picked: null, tiered: null, opened: null });
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
		bindJourneyControls(withHandler, { pick: () => {}, showTier: () => {}, placeSite: () => {} });
		expect(withHandler.placeSite.listenerCount("click")).toBe(1);

		const without = root();
		bindJourneyControls(without, { pick: () => {}, showTier: () => {} });
		expect(without.placeSite.listenerCount("click")).toBe(0);
	});

	// The partial builds the button GM-only and only with a map on screen, so both surfaces have
	// to survive it being absent rather than assuming their own template drew it.
	it("survives a partial that rendered no site button", () => {
		const bare = root({ placeSite: false });
		expect(() => bindJourneyControls(bare, { pick: () => {}, showTier: () => {}, placeSite: () => {} }))
			.not.toThrow();
	});

	it("presses through to the surface that owns the picture", () => {
		let pressed = 0;
		const r = root();
		bindJourneyControls(r, { pick: () => {}, showTier: () => {}, placeSite: () => { pressed++; } });
		r.placeSite.fire("click");
		expect(pressed).toBe(1);
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
