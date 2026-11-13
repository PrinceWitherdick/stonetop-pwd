// A lore option's fill-in blank ("Something else: ___", "…adopted by ___") is a box IN the line.
// As the full-width block of the write-in textarea it shares a class with, it dropped to a second
// line and the row's tick, centred on the row, sat 16.5px off its words (measured live, 2026-11-12,
// the Stranger's Monster Compendium); inline, the tick sits on the words as a plain row's does.
import { describe, it, expect } from "vitest";
import { readCss, ownRule, declared } from "../fakes/css.js";

describe("a fill-in blank in an option to tick", () => {
	const body = ownRule(readCss(), ".stonetop-lore-option-text.stonetop-lore-fill");

	it("has a rule of its own", () => {
		expect(body).not.toBeNull();
	});

	it("is an inline box, not a full-width block", () => {
		expect(declared(body, "display")).toBe("inline-block");
		expect(declared(body, "width")).not.toBe("100%");
	});

	it("drops the textarea's two-line floor", () => {
		expect(declared(body, "min-height")).toBe("0");
	});
});
