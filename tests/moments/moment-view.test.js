import { describe, it, expect } from "vitest";
import { momentView, MOMENT_KINDS, MOMENT_TEXT_MAX } from "../../module/moments/moment-view.js";

// What a table moment shows (module/moments/moment-view.js). Every word comes from en.json or the
// payload, and a payload off the socket is capped, since anyone signed in can send one.

describe("momentView", () => {
	it.each([
		["fight", "fa-swords", true, false, 3200, "A fight breaks out"],
		["setOut", "fa-person-hiking", false, false, 3600, "The expedition sets out"],
		["home", "fa-house-chimney", false, false, 3600, "Home again"],
		["arrive", "fa-signs-post", false, true, 3400, "The party arrives"],
	])("shows a %s moment with its icon, veil, size, hold and fallback title", (kind, icon, veil, small, hold, title) => {
		expect(momentView({ kind })).toEqual({ kind, icon, veil, small, title, sub: "", holdMs: hold });
		expect(MOMENT_KINDS[kind].holdMs).toBe(hold);
	});

	it("knows exactly the four kinds", () => {
		expect(Object.keys(MOMENT_KINDS).sort()).toEqual(["arrive", "fight", "home", "setOut"]);
	});

	it("is null for an unknown kind, an inherited name or no payload", () => {
		expect(momentView({ kind: "parade" })).toBeNull();
		expect(momentView({ kind: "toString" })).toBeNull();
		expect(momentView({})).toBeNull();
		expect(momentView(null)).toBeNull();
	});

	it("uses the payload's title and sub, trimmed", () => {
		const view = momentView({ kind: "setOut", title: "  To the Crossroads ", sub: " Spring, year 3 " });
		expect(view.title).toBe("To the Crossroads");
		expect(view.sub).toBe("Spring, year 3");
	});

	it("falls back to the kind's own title for an empty or non-string title", () => {
		expect(momentView({ kind: "home", title: "   " }).title).toBe("Home again");
		expect(momentView({ kind: "home", title: 42 }).title).toBe("Home again");
		expect(momentView({ kind: "home", sub: { x: 1 } }).sub).toBe("");
	});

	it("cuts a long title and sub to the cap", () => {
		const long = "x".repeat(200);
		const view = momentView({ kind: "fight", title: long, sub: long });
		expect(view.title.length).toBe(MOMENT_TEXT_MAX);
		expect(view.sub.length).toBe(MOMENT_TEXT_MAX);
		expect(view.title.endsWith("…")).toBe(true);
		expect(momentView({ kind: "fight", title: "y".repeat(MOMENT_TEXT_MAX) }).title).toBe("y".repeat(MOMENT_TEXT_MAX));
	});
});
