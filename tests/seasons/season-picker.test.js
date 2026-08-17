import { describe, it, expect, vi } from "vitest";
import { readRepo as read, readCss, declarations } from "../fakes/css.js";
import {
	MAX_CAMPAIGN_YEAR, clampYear, seasonPickerHtml, wireSeasonPicker, openSeasonPicker,
} from "../../module/seasons/season-picker.js";
import { SEASON_IDS, seasonLabel } from "../../module/seasons/seasons-change-reminders.js";
import { yearLabel } from "../../module/seasons/seasons-chronicle.js";

// The season-and-year picker — the one dialog behind BOTH "Seasons Change" (the move) and
// "Set the Current Season" (the header's clock). The year half is what these mostly guard: it
// used to be a `<select>` of 1..N built from a flag that only advances when a Winter is
// completed through this system, so a table that adopted the sheet mid-campaign was offered
// the First Year and nothing else, and could not file the season they were actually in.

const CSS      = readCss();
const SHEET_JS = read("module/actors/steading/StonetopSteadingSheet.js");

// The sheet's two `openSeasonPicker({…})` calls — the correct-the-clock one first, then the
// move's — scanned once here rather than by each assertion that wants them: the pattern
// backtracks across a two-thousand-line file.
const PICKER_CALLS = SHEET_JS.match(/openSeasonPicker\(\{[\s\S]*?\n\t*\}\);/g) ?? [];

// ── A stand-in for the rendered picker ────────────────────────────────────────────────
// The suite runs on `environment: "node"` with no jsdom, so the elements the wiring drives
// are stand-ins. They are SCANNED OUT OF THE REAL MARKUP rather than hand-built beside it:
// `wireYearField` and `wireSeasonPicker` find everything they touch by class, so a test that
// modelled the elements by hand would keep passing through a class renamed on one side only —
// which is the single way this wiring can break without a symptom anywhere else.
//
// Flat on purpose. Every selector either helper uses is a simple one (a class, sometimes with
// an attribute), so nesting would buy nothing; assertions about what a card CONTAINS are made
// against the markup string itself, further down.

/** Does this stand-in match a simple `.class.class[attr="value"]` selector? */
function matches(node, selector) {
	for (const [, cls] of selector.matchAll(/\.([\w-]+)/g)) if (!node.classList.has(cls)) return false;
	for (const [, name, want] of selector.matchAll(/\[([\w-]+)="([^"]*)"\]/g)) {
		if (node.attrs[name] !== want) return false;
	}
	return true;
}

/** One element out of the markup: its classes, its attributes, and somewhere to hang listeners. */
function nodeFrom(tag, attrText) {
	const attrs = Object.fromEntries([...attrText.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
	const listeners = new Map();
	return {
		tagName:   tag.toUpperCase(),
		attrs,
		classList: new Set((attrs.class ?? "").split(/\s+/).filter(Boolean)),
		// `data-season` → `dataset.season`, as the browser exposes it.
		dataset: Object.fromEntries(Object.entries(attrs)
			.filter(([k]) => k.startsWith("data-"))
			.map(([k, v]) => [k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()), v])),
		textContent: "",
		getAttribute: name => attrs[name] ?? null,
		// A real input coerces whatever it is handed to a string; the wiring assigns numbers.
		_value: attrs.value ?? "",
		get value() { return this._value; },
		set value(v) { this._value = String(v); },
		addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
		dispatchEvent(event) {
			for (const fn of listeners.get(event.type) ?? []) fn(event);
			return !event.defaultPrevented;
		},
		click() { this.dispatchEvent({ type: "click" }); },
	};
}

/** A cancellable event, for the one handler that cancels. */
function fakeEvent(type, props = {}) {
	return { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
}

/** Render the real picker markup, scan it into stand-ins, and wire it as the dialog does. */
function mount({ prompt = "Which season?", startYear = 1, latestYear = startYear, selected = null, note = "", altAction = null } = {}) {
	const html  = seasonPickerHtml({ prompt, startYear, selected, note, altAction });
	const nodes = [...html.matchAll(/<([a-z]+)\b([^>]*)>/g)].map(([, tag, attrText]) => nodeFrom(tag, attrText));
	const root  = {
		querySelector:    sel => nodes.find(n => matches(n, sel)) ?? null,
		querySelectorAll: sel => nodes.filter(n => matches(n, sel)),
	};
	const picked = [];
	const alted  = [];
	wireSeasonPicker(root, {
		startYear,
		latestYear,
		onPick: (season, year) => picked.push({ season, year }),
		onAlt:  year => alted.push(year),
	});
	return {
		html,
		root,
		picked,
		alted,
		alt:   root.querySelector(".stonetop-season-alt-btn"),
		input: root.querySelector(".stonetop-season-year-input"),
		name:  root.querySelector(".stonetop-season-year-name"),
		hint:  root.querySelector(".stonetop-season-year-hint"),
		card:  id  => root.querySelector(`.stonetop-season-card[data-season="${id}"]`),
		step:  dir => root.querySelector(`.stonetop-season-year-step[data-step="${dir}"]`),
		/** Type into the field as a user does: set the value, then fire the event the browser would. */
		type:  function (value) { this.input.value = value; this.input.dispatchEvent(fakeEvent("input")); },
		/** Leave the field — blur or Enter — which is when the value itself is tidied. */
		commit: function () { this.input.dispatchEvent(fakeEvent("change")); },
	};
}

describe("clampYear", () => {
	it("keeps a whole year in range", () => {
		expect(clampYear(7)).toBe(7);
		expect(clampYear("12")).toBe(12);
		expect(clampYear(3.9)).toBe(3);
	});

	// Out of range is an ATTEMPT at a year — snap it to the nearest end rather than throwing
	// away what was reached for.
	it("snaps out-of-range years to the nearest end", () => {
		expect(clampYear(0, 5)).toBe(1);
		expect(clampYear(-4, 5)).toBe(1);
		expect(clampYear(99999, 5)).toBe(MAX_CAMPAIGN_YEAR);
	});

	// Unreadable is a different case: the field is empty or holds junk, and there is nothing to
	// preserve. That is what the fallback is for.
	it("falls back when the field says nothing at all", () => {
		for (const nothing of ["", "   ", "abc", null, undefined, NaN]) {
			expect(clampYear(nothing, 6), String(nothing)).toBe(6);
		}
		// ...and a fallback that is itself unusable still lands on a real year.
		expect(clampYear("", 0)).toBe(1);
		expect(clampYear("", undefined)).toBe(1);
	});
});

describe("the season picker's year field", () => {
	it("opens on the year it was given, named in full", () => {
		const ui = mount({ startYear: 4 });
		expect(ui.input.value).toBe("4");
		expect(ui.name.textContent).toBe(yearLabel(4));
		expect(yearLabel(4)).toBe("Year Four");
	});

	// The whole point: any year, not a list of them. A table in their ninth year types 9.
	it("takes a year typed straight in, however far past the campaign's latest", () => {
		const ui = mount({ startYear: 1, latestYear: 1 });
		ui.type("9");
		ui.card("autumn").click();
		expect(ui.picked).toEqual([{ season: "autumn", year: 9 }]);
	});

	it("steps a year at a time in both directions", () => {
		const ui = mount({ startYear: 4 });
		ui.step("1").click();
		ui.step("1").click();
		expect(ui.input.value).toBe("6");
		expect(ui.name.textContent).toBe(yearLabel(6));
		ui.step("-1").click();
		expect(ui.input.value).toBe("5");
	});

	it("does not step below the first year or past the ceiling", () => {
		const low = mount({ startYear: 1 });
		low.step("-1").click();
		expect(low.input.value).toBe("1");

		const high = mount({ startYear: MAX_CAMPAIGN_YEAR });
		high.step("1").click();
		expect(high.input.value).toBe(String(MAX_CAMPAIGN_YEAR));
	});

	// Clamping on every keystroke would snatch a "1" on its way to "12" back to 1 as it was
	// typed. Typing is left alone; the value is only tidied when editing STOPS.
	it("leaves a half-typed year alone until editing stops", () => {
		const ui = mount({ startYear: 5 });
		ui.type("");
		expect(ui.input.value).toBe("");
		// The label tells the truth in the meantime: an empty field commits the fallback.
		expect(ui.name.textContent).toBe(yearLabel(5));
		ui.card("spring").click();
		expect(ui.picked).toEqual([{ season: "spring", year: 5 }]);

		ui.type("0");
		expect(ui.input.value).toBe("0");
		ui.commit();
		expect(ui.input.value).toBe("1");
	});

	// The field takes a numeral because a numeral is what you can type; the chip is what the
	// rest of the system — the header's clock, the Chronicle's page titles — actually shows.
	it("names the year in the chip as the header and the Chronicle name it", () => {
		const ui = mount({ startYear: 1 });
		ui.type("2");
		expect(ui.name.textContent).toBe("Year Two");
		ui.type("21");
		expect(ui.name.textContent).toBe("Year 21");
	});

	// Typing past the high-water mark is allowed — it is the mid-campaign case the field exists
	// for — but a Chronicle page is about to be minted for a year nothing has been recorded in,
	// which is worth saying out loud in case it was a slipped keystroke.
	it("says so, quietly, once the year runs past the campaign's latest", () => {
		const ui = mount({ startYear: 3, latestYear: 3 });
		expect(ui.hint.textContent).toBe("");
		ui.type("4");
		expect(ui.hint.textContent).toContain(yearLabel(3));
		ui.type("3");
		expect(ui.hint.textContent).toBe("");
	});

	// Dialog's content sits inside a <form> and this picker declares no buttons, so an
	// un-prevented Enter submits that form and takes the window with it — discarding the pick
	// instead of making it.
	it("swallows Enter, which would otherwise close the window unpicked", () => {
		const ui    = mount({ startYear: 1 });
		const enter = fakeEvent("keydown", { key: "Enter" });
		ui.input.dispatchEvent(enter);
		expect(enter.defaultPrevented).toBe(true);
		// ...and only Enter — every other key has to reach the field.
		const seven = fakeEvent("keydown", { key: "7" });
		ui.input.dispatchEvent(seven);
		expect(seven.defaultPrevented).toBe(false);
	});

	// The field is the only ceiling there is, so it has to declare one: a fat-fingered "20255"
	// would otherwise mint a Chronicle page two hundred centuries out.
	it("bounds the input itself, not just the code behind it", () => {
		const { html } = mount();
		expect(html).toContain(`min="1"`);
		expect(html).toContain(`max="${MAX_CAMPAIGN_YEAR}"`);
		expect(html).toContain(`type="number"`);
	});
});

describe("the season picker's cards", () => {
	it("offers every season there is, and commits the one clicked", () => {
		const ui = mount({ startYear: 2 });
		expect(ui.root.querySelectorAll(".stonetop-season-card")).toHaveLength(SEASON_IDS.length);
		for (const id of SEASON_IDS) expect(ui.html, id).toContain(`>${seasonLabel(id)}</span>`);
		ui.card("winter").click();
		expect(ui.picked).toEqual([{ season: "winter", year: 2 }]);
	});

	// The cards are the dialog's only commit, so they have to be reachable by keyboard — and
	// `type="button"` keeps them from submitting the form Dialog wraps its content in.
	it("makes each card a real button rather than a clickable div", () => {
		const ui = mount();
		for (const el of ui.root.querySelectorAll(".stonetop-season-card")) {
			expect(el.tagName).toBe("BUTTON");
			expect(el.getAttribute("type")).toBe("button");
		}
	});

	// The four season inks are the steading header clock's alone. This picker wore them once,
	// on the labels AND on the marked card's ring, and they came back off: a colour means
	// something because one thing wears it, and four coloured names beside the header's one
	// coloured name is what turns that one into decoration. Guarded here rather than left to
	// the eye, because the cards are the obvious place for the colour to creep back to.
	it("names its seasons in plain ink, colour being the header clock's alone", () => {
		const ui = mount({ selected: "autumn" });
		for (const id of SEASON_IDS) {
			expect(ui.card(id).classList.has(`stonetop-season-card--${id}`), id).toBe(false);
		}
		for (const sel of [".stonetop-season-picker .stonetop-season-label",
			".stonetop-season-picker .stonetop-season-card",
			".stonetop-season-picker .stonetop-season-card.is-selected"]) {
			expect(declarations(CSS, sel), sel).not.toMatch(/--stonetop-season-\w+-ink/);
		}
	});

	// The mark on the current season is made of WEIGHT, not colour — the card's own hairline
	// pulled up to muted text and doubled by an inset ring — so it still has to be a visible
	// step up from the border every other card wears.
	it("marks the current season without a colour", () => {
		const marked = declarations(CSS, ".stonetop-season-picker .stonetop-season-card.is-selected");
		expect(marked).toContain("--st-text-muted");
		const ui = mount({ selected: "autumn" });
		expect(ui.card("autumn").classList.has("is-selected")).toBe(true);
		expect(ui.card("spring").classList.has("is-selected")).toBe(false);
	});

	// The icon is decorative — the label directly below names the season in text — so a filled
	// alt would have a screen reader say "Spring" twice for one card.
	it("leaves the season glyph out of the accessible name", () => {
		const ui = mount();
		const icons = ui.root.querySelectorAll(".stonetop-season-icon");
		expect(icons).toHaveLength(SEASON_IDS.length);
		for (const img of icons) expect(img.getAttribute("alt")).toBe("");
	});

	it("marks the season already on the clock, and only that one", () => {
		const ui = mount({ selected: "summer" });
		const marked = ui.root.querySelectorAll(".stonetop-season-card.is-selected");
		expect(marked).toHaveLength(1);
		expect(marked[0].dataset.season).toBe("summer");
		expect(marked[0].getAttribute("aria-current")).toBe("true");
		// The move's picker passes nothing, because it asks which season is BEGINNING.
		expect(mount().root.querySelectorAll(".is-selected")).toHaveLength(0);
	});

	// Core's `.app button` gives every button a fixed height, a full-width box and a shadow.
	// A card is a card, so each of those has to be stripped BY NAME.
	it("strips the button chrome core hands it", () => {
		const card = declarations(CSS, ".stonetop-season-picker .stonetop-season-card");
		expect(card).toBeTruthy();
		for (const prop of ["height", "box-shadow", "margin"]) {
			expect(card, prop).toMatch(new RegExp(`${prop}:\\s*(auto|none|0)`));
		}
		// ...and having become buttons, they owe the keyboard a focus mark of their own: the
		// hover wash alone is a background change on a card that already has a background.
		expect(declarations(CSS, ".stonetop-season-picker .stonetop-season-card:focus-visible"))
			.toMatch(/outline:\s*2px/);
	});
});

describe("the door to the other picker", () => {
	const DOOR = { ask: "Only correcting what the sheet says?", label: "Set the season without making the move." };

	// The two windows ask nearly the same question and are told apart by intent alone, so the
	// one you land in owes you the other. Only the move's picker carries it — that is the one
	// the steading header opens, so it is the one a GM can arrive at by mistake.
	it("appears only where a picker asks for it", () => {
		expect(mount().alt).toBeNull();
		const withDoor = mount({ altAction: DOOR });
		expect(withDoor.alt).not.toBeNull();
		expect(withDoor.html).toContain(DOOR.ask);
	});

	// It hands over the year the field is CURRENTLY showing, not the one it opened on: a GM
	// who has already dialled a year in must not type it twice to change which question they
	// are answering.
	it("carries the year the field is showing over to the window it opens", () => {
		const ui = mount({ startYear: 3, altAction: DOOR });
		ui.type("7");
		ui.alt.click();
		expect(ui.alted).toEqual([7]);
		// ...and it is a way OUT, not a pick: nothing is committed on the way through.
		expect(ui.picked).toEqual([]);
	});

	it("is a button, so the keyboard can reach it and the form cannot submit it", () => {
		const ui = mount({ altAction: DOOR });
		expect(ui.alt.tagName).toBe("BUTTON");
		expect(ui.alt.getAttribute("type")).toBe("button");
	});

	// Core's `.app button` would make this a full-width block with a box and a shadow. It sits
	// mid-sentence, so all of that comes off and it goes back to inline — `inline`, not
	// `inline-flex`, or it stops wrapping with the words around it.
	it("reads as a link in the sentence rather than a button", () => {
		const btn = declarations(CSS, ".stonetop-season-picker .stonetop-season-alt-btn");
		expect(btn).toBeTruthy();
		expect(btn).toMatch(/display:\s*inline\s*;/);
		expect(btn).toMatch(/text-decoration:\s*underline/);
		for (const prop of ["width", "height", "border", "background", "box-shadow"]) {
			expect(btn, prop).toMatch(new RegExp(`${prop}:\\s*(auto|none|0)`));
		}
	});
});

describe("the season picker's window", () => {
	/** Open the picker against a stub Dialog and hand back what it was constructed with. */
	function opened(options = {}) {
		const built = [];
		vi.stubGlobal("Dialog", class {
			constructor(data, opts) { built.push({ data, opts }); }
			render() {}
			close() {}
		});
		try {
			openSeasonPicker({ title: "T", prompt: "P", selectedYear: 1, onPick: () => {}, ...options });
			return built.at(-1);
		} finally {
			vi.unstubAllGlobals();
		}
	}

	it("wears the classes its styling is written against", () => {
		expect(opened().opts.classes).toEqual(["dialog", "stonetop", "stonetop-season-picker-dialog"]);
	});

	// A card click IS the commit, and it closes the window on its way out — so there is no
	// footer, and nothing that could commit a season without one having been chosen.
	it("declares no buttons at all", () => {
		expect(opened().data.buttons).toEqual({});
	});

	it("opens on the year it was handed, clamped", () => {
		expect(opened({ selectedYear: 6 }).data.content).toContain(`value="6"`);
		expect(opened({ selectedYear: 0 }).data.content).toContain(`value="1"`);
	});

	// Both callers open it FROM the steading sheet, where an ad-hoc `new Dialog()` can land
	// behind the sheet that spawned it and read as a click that did nothing. The steading jump
	// is the opposite case — it is only offered where the sheet may not be what you came from.
	it("comes to the front, and offers the steading jump only where it helps", () => {
		const source = read("module/seasons/season-picker.js");
		expect(source).toContain("bringDialogToFront(html);");
		expect(source).toContain("if (headerShortcut) addStonetopSteadingButton(html);");
	});
});

describe("what the steading sheet asks for", () => {
	// The move files its season into the chosen year's Chronicle page; the setter only corrects
	// the header. Both open on the campaign's current year, and neither may hand the picker a
	// ceiling — `latestYear` is the hint's yardstick, nothing more.
	it("hands the picker a starting year and a high-water mark, not a list", () => {
		expect(SHEET_JS).not.toContain("years:");
		expect(PICKER_CALLS).toHaveLength(2);
		for (const call of PICKER_CALLS) {
			expect(call).toMatch(/selectedYear:\s*\w/);
			expect(call).toMatch(/latestYear:\s*\w/);
		}
	});

	// Setting the clock ahead has to carry `seasonsCurrentYear` with it, or the move's picker
	// would still open a year behind. Both halves of the clock are candidates for the
	// high-water mark because they move independently — the year runs ahead of the stamp for
	// the whole of a completed Winter.
	it("measures the high-water mark against both halves of the clock", () => {
		const setter = SHEET_JS.slice(
			SHEET_JS.indexOf("async _onSetCurrentSeason("),
			SHEET_JS.indexOf("async _onSeasonsChange()"));
		expect(setter).toContain("latestYear: Math.max(this._seasonsCurrentYear(), stamped?.year ?? 1)");
	});

	// Only the correct-the-clock picker marks a card: it opens on whatever the steading's clock
	// already says. The move's picker asks which season is BEGINNING — four equal candidates,
	// nothing marked — so a mark there would be answering its own question.
	it("marks a card on the correct-the-clock picker alone", () => {
		const [setter, move] = PICKER_CALLS;
		expect(setter).toMatch(/selected:\s*stamped/);
		expect(move).not.toContain("selected:");
	});

	// The door goes one way. Putting one on the correction window too would let a GM bounce
	// between two windows asking the same question, and the correction is already the end of
	// the road — it writes the flag and closes.
	it("puts the door on the move's picker alone, and only for a GM", () => {
		const [setter, move] = PICKER_CALLS;
		expect(move).toContain("altAction: game.user?.isGM ?");
		expect(move).toContain("onRun: (year) => this._onSetCurrentSeason(year),");
		expect(setter).not.toContain("altAction");
	});
});
