import { describe, expect, it } from "vitest";
import {
	collectSeasonalReminders,
	remindersForActor,
	seasonsReminderCard,
} from "../../module/seasons/seasons-change-reminders.js";

// A minimal stand-in for a character actor: `move` names become embedded move
// Items, and `possessions` become the selected special-possession slugs (the
// flags.stonetop-pwd.possessions.selected array the production flag reads).
function fakeCharacter({ name = "Test PC", moves = [], possessions = [], type = "character" } = {}) {
	return {
		name,
		type,
		items: moves.map(name => ({ type: "move", name })),
		getFlag: (scope, key) =>
			scope === "stonetop-pwd" && key === "possessions.selected" ? possessions : undefined,
	};
}

const names = list => list.map(r => r.label ?? r.name);

describe("remindersForActor", () => {
	it("matches a seasonal playbook move by name", () => {
		const actor = fakeCharacter({ moves: ["Rites of the Land", "Consecrated Ground"] });
		expect(names(remindersForActor(actor))).toEqual(["Rites of the Land"]);
	});

	it("matches seasonal possessions by selected slug", () => {
		const actor = fakeCharacter({ possessions: ["collected-offerings", "goat-herd", "apiary"] });
		expect(names(remindersForActor(actor)).sort()).toEqual(["Collected offerings", "Goat herd"]);
	});

	// Holy relics has NO seasonal rule in the book: not in Book I, not in Book II's Helior
	// entry, not on the Lightbearer playbook. Its uses are a one-way pool. It was listed here
	// with an invented "Restore 1 use this season" (and an effect belonging to Piety), so the
	// public card taught the table two rules that do not exist. This is what keeps it out.
	it("does not invent a seasonal refresh for Holy relics", () => {
		const actor = fakeCharacter({ possessions: ["holy-relics"] });
		expect(remindersForActor(actor)).toEqual([]);
	});

	// "Each SPRING, d4 uses of bendis root": the one entry that is not every-season.
	it("matches the spring-only Herb garden in spring, and not otherwise", () => {
		const actor = fakeCharacter({ possessions: ["herb-garden"] });
		expect(names(remindersForActor(actor, "spring"))).toEqual(["Herb garden"]);
		expect(remindersForActor(actor, "autumn")).toEqual([]);
	});

	// A caller that names no season is asking "what does this PC carry?", not "what fires
	// now", so the season-limited entries are all in.
	it("lists season-limited upkeep when no season is given", () => {
		const actor = fakeCharacter({ possessions: ["herb-garden"] });
		expect(names(remindersForActor(actor))).toEqual(["Herb garden"]);
	});

	it("keeps the every-season entries in a season the garden misses", () => {
		const actor = fakeCharacter({ possessions: ["goat-herd", "herb-garden"] });
		expect(names(remindersForActor(actor, "winter"))).toEqual(["Goat herd"]);
	});

	it("combines a move and a possession on the same character", () => {
		const actor = fakeCharacter({ moves: ["Rites of the Land"], possessions: ["goat-herd"] });
		expect(names(remindersForActor(actor)).sort()).toEqual(["Goat herd", "Rites of the Land"]);
	});

	it("returns nothing for a character with no seasonal upkeep", () => {
		const actor = fakeCharacter({ moves: ["Consecrated Ground"], possessions: ["apiary"] });
		expect(remindersForActor(actor)).toEqual([]);
	});

	it("ignores non-character actors", () => {
		const actor = fakeCharacter({ moves: ["Rites of the Land"], type: "stonetop" });
		expect(remindersForActor(actor)).toEqual([]);
	});

	it("tolerates a character with no selected-possessions flag", () => {
		const actor = { type: "character", items: [], getFlag: () => undefined };
		expect(remindersForActor(actor)).toEqual([]);
	});
});

describe("collectSeasonalReminders", () => {
	it("tags each matched reminder with its owning character", () => {
		const reminders = collectSeasonalReminders([
			fakeCharacter({ name: "Brother Hale", moves: ["Rites of the Land"], possessions: ["collected-offerings"] }),
			fakeCharacter({ name: "Mira", possessions: ["goat-herd"] }),
		]);
		expect(reminders).toEqual([
			expect.objectContaining({ character: "Brother Hale", name: "Rites of the Land" }),
			expect.objectContaining({ character: "Brother Hale", name: "Collected offerings" }),
			expect.objectContaining({ character: "Mira", name: "Goat herd" }),
		]);
	});

	it("skips characters with no seasonal upkeep", () => {
		const reminders = collectSeasonalReminders([
			fakeCharacter({ name: "Eaglewise", moves: ["Consecrated Ground"], possessions: ["apiary"] }),
		]);
		expect(reminders).toEqual([]);
	});
});

describe("seasonsReminderCard", () => {
	it("renders the season hero and one item per reminder", () => {
		const html = seasonsReminderCard("autumn", collectSeasonalReminders([
			fakeCharacter({ name: "Brother Hale", possessions: ["collected-offerings"] }),
		]));
		expect(html).toContain("The Seasons Change");
		expect(html).toContain("Autumn");
		expect(html).toContain("fall_icon.svg"); // autumn maps to the "fall" art
		expect(html).toContain("Brother Hale");
		expect(html).toContain("Collected offerings");
		expect(html).toContain("Restore 1 use this season");
	});
});
