import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readRepo } from "../fakes/css.js";
import { flashHighlight, spinHighlight, FLASH_CLASS, FLASH_MS, SPIN_CLASS, SPIN_MIN_STEPS } from "../../module/utils/flash-highlight.js";

// The module's own text, comments stripped — this file discusses the very line it forbids
// removing, so the prose has to come out or the guard passes on its own rationale.
const SRC = readRepo("module/utils/flash-highlight.js").replace(/\/\/[^\n]*/g, "");

// The suite runs on `environment: "node"` with no jsdom, so these run against a five-line stand-in
// for an element. That covers everything this module actually does — it adds a class, drops it on
// a timer, and puts out anything else lit in the same scope — and the one thing it cannot cover
// (the reflow read that makes a restart restart) is asserted on the source instead.

/** An element, as far as this module is concerned: a class list and a layout property. */
function fakeEl(classes = []) {
	const set = new Set(classes);
	return {
		classList: {
			add:      c => set.add(c),
			remove:   c => set.delete(c),
			contains: c => set.has(c),
		},
		get offsetWidth() { return 10; },
		// Not null, so `isVisible` reads a stand-in as on the page — which is what a test of the
		// walk needs. The one test that wants a hidden row nulls this itself.
		offsetParent: {},
		lit: () => set.has(FLASH_CLASS),
		passing: () => set.has(SPIN_CLASS),
	};
}

/** A list of them, long enough that the step floor does not swallow the arithmetic. */
const fakeRows = (n = 13) => Array.from({ length: n }, () => fakeEl());

/** Which index is wearing the walking light, or -1. */
const lightAt = rows => rows.findIndex(r => r.passing());

/** Run the clock until the walk lands, without knowing how long that takes. */
async function settle(spin) {
	await vi.runAllTimersAsync();
	return spin.done;
}

/** A scope that hands back whichever of its children are currently lit. */
function fakeScope(children) {
	return { querySelectorAll: () => children.filter(c => c.lit()) };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("flashHighlight", () => {
	it("lights the element and puts it out again on its own", () => {
		const el = fakeEl();
		flashHighlight(el);

		expect(el.lit()).toBe(true);
		// Still lit right up to the deadline: the fade is CSS, so an early class removal would
		// cut the animation off part-way rather than shortening it.
		vi.advanceTimersByTime(FLASH_MS - 1);
		expect(el.lit()).toBe(true);
		vi.advanceTimersByTime(1);
		expect(el.lit()).toBe(false);
	});

	// The randomizer's whole job is being clicked again, and the second click usually lands well
	// inside the five seconds. The first click's timer must not then put the SECOND flash out
	// early — which is what happens if the timers are not tracked per element.
	it("restarts a flash that is already burning, on its own full clock", () => {
		const el = fakeEl();
		flashHighlight(el);
		vi.advanceTimersByTime(FLASH_MS - 100);
		flashHighlight(el);

		// The first click's timer would have fired here.
		vi.advanceTimersByTime(200);
		expect(el.lit(), "the superseded timer put the new flash out").toBe(true);
		vi.advanceTimersByTime(FLASH_MS);
		expect(el.lit()).toBe(false);
	});

	// Two rows fading on two different clocks is two answers to "what did that just give me?".
	it("puts out anything else lit in the same scope", () => {
		const first  = fakeEl();
		const second = fakeEl();
		const scope  = fakeScope([first, second]);

		flashHighlight(first, { scope });
		vi.advanceTimersByTime(1000);
		flashHighlight(second, { scope });

		expect(first.lit()).toBe(false);
		expect(second.lit()).toBe(true);
	});

	// A caller should not have to check whether the row it wants is on screen — the thing that
	// mattered (the chat whisper, the roll) has already happened by the time this is called.
	it("shrugs at a missing element", () => {
		expect(() => flashHighlight(null)).not.toThrow();
		expect(() => flashHighlight(undefined, { scope: fakeScope([]) })).not.toThrow();
		expect(() => flashHighlight({})).not.toThrow();
	});

	it("takes a caller's own class and duration", () => {
		const el = fakeEl();
		flashHighlight(el, { className: "hot", duration: 200 });
		expect(el.classList.contains("hot")).toBe(true);
		vi.advanceTimersByTime(200);
		expect(el.classList.contains("hot")).toBe(false);
	});

	// Both class writes land in one task, so without a layout read between them the browser
	// coalesces them into no change at all and the restart above is a no-op ON SCREEN — the class
	// is right, the animation simply carries on from where it was. Nothing throws and no test that
	// looks only at the class list can see it, so it is pinned here on the source.
	it("forces a reflow between putting the class out and putting it back", () => {
		expect(SRC).toMatch(/void el\.offsetWidth/);
		expect(SRC.indexOf("void el.offsetWidth"))
			.toBeLessThan(SRC.indexOf("el.classList.add(className)"));
	});
});

describe("spinHighlight", () => {
	it("lights one row at a time and lands on the target", async () => {
		const rows = fakeRows();
		const spin = spinHighlight(rows, 4);

		// The first step is taken on the call, not on a timer: a die that does nothing for 40ms
		// reads as a click that missed.
		expect(lightAt(rows)).toBe(0);
		expect(rows.filter(r => r.passing())).toHaveLength(1);

		expect(await settle(spin)).toBe(true);
		// Landed BARE — the caller's flash goes on in the same task, so the walk hands the row
		// over with nothing on it rather than leaving two washes to fight.
		expect(rows.some(r => r.passing())).toBe(false);
		expect(rows.some(r => r.lit())).toBe(false);
	});

	it("passes over every entry on the way, wrapping at the end of the list", async () => {
		const rows = fakeRows(7);
		const seen = new Set();
		const spin = spinHighlight(rows, 2);

		seen.add(lightAt(rows));
		// Step the clock in small slices, recording where the light is each time.
		for (let ms = 0; ms < 6000; ms += 10) {
			await vi.advanceTimersByTimeAsync(10);
			const at = lightAt(rows);
			if (at >= 0) seen.add(at);
		}
		await spin.done;
		// A seven-entry list with a floor of twelve steps is at least two laps: every row is
		// crossed, which is the point of the effect — the moves the die did NOT give are read too.
		expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});

	// Short lists are the ones at risk: seven entries and no floor would be a walk over before the
	// eye found it.
	it("never takes fewer than the floor of steps, even to a near target", async () => {
		const rows = fakeRows(7);
		let steps = 0;
		for (const row of rows) {
			const add = row.classList.add;
			row.classList.add = c => { if (c === SPIN_CLASS) steps += 1; add(c); };
		}
		await settle(spinHighlight(rows, 1));
		expect(steps).toBeGreaterThanOrEqual(SPIN_MIN_STEPS);
	});

	// Standing still is not a spin: drawing the row the light already sits on still walks a lap.
	it("walks a full lap when it starts where it is going", async () => {
		const rows = fakeRows(13);
		let steps = 0;
		for (const row of rows) {
			const add = row.classList.add;
			row.classList.add = c => { if (c === SPIN_CLASS) steps += 1; add(c); };
		}
		await settle(spinHighlight(rows, 3, { from: 3 }));
		expect(steps).toBeGreaterThanOrEqual(13);
	});

	it("slows down as it goes", async () => {
		const rows = fakeRows();
		const gaps = [];
		let last = 0, elapsed = 0;
		for (const row of rows) {
			const add = row.classList.add;
			row.classList.add = c => { if (c === SPIN_CLASS) { gaps.push(elapsed - last); last = elapsed; } add(c); };
		}
		const spin = spinHighlight(rows, 6);
		for (let i = 0; i < 400; i += 1) { await vi.advanceTimersByTimeAsync(10); elapsed += 10; }
		await spin.done;

		// Compared in halves rather than pair by pair: the interval is eased, so consecutive early
		// steps can round to the same 10ms slice.
		const half = Math.floor(gaps.length / 2);
		const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
		expect(mean(gaps.slice(half))).toBeGreaterThan(mean(gaps.slice(1, half)));
	});

	// A second click supersedes the first. The walk it interrupted must stop where it stands AND
	// say so, because that is the caller's cue to post no chat card: one landing, one card.
	it("stops dead when cancelled, and says it did not land", async () => {
		const rows = fakeRows();
		const spin = spinHighlight(rows, 8);
		await vi.advanceTimersByTimeAsync(100);

		spin.cancel();
		expect(rows.some(r => r.passing())).toBe(false);
		expect(await spin.done).toBe(false);

		// And it stays stopped — a timer that survived the cancel would light rows under the walk
		// that replaced it.
		await vi.advanceTimersByTimeAsync(5000);
		expect(rows.some(r => r.passing())).toBe(false);
	});

	it("cancels harmlessly after it has already landed", async () => {
		const rows = fakeRows();
		const spin = spinHighlight(rows, 2);
		expect(await settle(spin)).toBe(true);
		spin.cancel();
		expect(await spin.done).toBe(true);
	});

	// The previous draw is put out as the new walk sets off, rather than left fading under a light
	// that is on its way to replacing it.
	it("douses the last draw across the scope before it starts", async () => {
		const rows = fakeRows();
		const scope = fakeScope(rows);
		flashHighlight(rows[11], { scope });
		expect(rows[11].lit()).toBe(true);

		await settle(spinHighlight(rows, 1, { scope }));
		expect(rows[11].lit()).toBe(false);
	});

	// Every one of these lands at once with `done` already resolved, so a caller that awaits the
	// walk before doing the real work is never held up by an animation nobody can watch.
	describe("skips the walk when there is nothing to watch", () => {
		const landsAtOnce = async spin => {
			let resolved = false;
			spin.done.then(v => { resolved = v; });
			await Promise.resolve();
			return resolved;
		};

		it("for a list of one, and for a target that is not in it", async () => {
			expect(await landsAtOnce(spinHighlight([fakeEl()], 0))).toBe(true);
			expect(await landsAtOnce(spinHighlight(fakeRows(), 99))).toBe(true);
			expect(await landsAtOnce(spinHighlight(null, 0))).toBe(true);
		});

		// A folded section is `display: none`, which nulls offsetParent. Walking a light down a
		// list nobody can see would do nothing but delay the whisper the click was for.
		it("for a row inside a folded section", async () => {
			const rows = fakeRows();
			for (const row of rows) row.offsetParent = null;
			expect(await landsAtOnce(spinHighlight(rows, 4))).toBe(true);
			expect(rows.some(r => r.passing())).toBe(false);
		});

		it("for a user who has asked for less motion", async () => {
			globalThis.matchMedia = q => ({ matches: q === "(prefers-reduced-motion: reduce)" });
			try {
				const rows = fakeRows();
				expect(await landsAtOnce(spinHighlight(rows, 4))).toBe(true);
				expect(rows.some(r => r.passing())).toBe(false);
			} finally {
				delete globalThis.matchMedia;
			}
		});
	});
});
