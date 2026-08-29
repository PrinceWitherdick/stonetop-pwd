import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	collectSeasonalReminders,
	remindersForActor,
	seasonsReminderCard,
	SEASONAL_REMINDERS,
} from "../../module/seasons/seasons-change-reminders.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

// ── The registry against the books it quotes ────────────────────────────────────
// The card is only worth posting if it is COMPLETE: an upkeep it forgets is one the table
// forgets, because the card's presence is exactly what stops anyone checking by hand. The
// registry was hand-written, and it had drifted — it carried all four of the Blessed's seasonal
// rules and neither of the Seeker's, so a Seeker's logbook went unreset and their laboratory
// unrolled for as many seasons as a campaign ran.
//
// So the shipped compendium sources are the authority here, not this list. Every playbook move
// and every special possession whose printed text names a seasonal TRIGGER has to be registered
// or deliberately excused, and a new playbook that ships one fails this until someone decides
// which it is.
describe("every seasonal rule the books print is registered", () => {
	const PLAYBOOKS = "packs/src/stonetop-items/playbooks";
	const MOVES     = "packs/src/stonetop-items/playbook-moves";

	// Deliberately narrow, because it is looking for a trigger rather than for the word: a
	// possession that merely mentions winter in its flavour is not swept in, and neither is a
	// Value tier that prices "a season of unskilled labor".
	const SEASONAL = /(each|every|once per)\s+(season|spring|summer|autumn|winter)|when\s+the\s+seasons\s+change/i;
	// The pack files store their prose as HTML, and the Logbook's trigger is wrapped mid-phrase
	// ("When <strong><em>the Seasons Change</em></strong>"), so the tags come out before the
	// match is attempted or the one entry this test was written for slips straight past it.
	const plain = html => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

	function docsUnder(rel) {
		const out = [];
		const walk = dir => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (entry.name.endsWith(".json")) out.push(full);
			}
		};
		walk(path.resolve(REPO, rel));
		return out.map(f => JSON.parse(fs.readFileSync(f, "utf8")));
	}

	// `specialPossessions` is the whole picker (its note, its count, what comes preselected);
	// the possessions themselves are its `options`.
	const possessions = () => docsUnder(PLAYBOOKS).flatMap(p => p?.flags?.stonetop?.specialPossessions?.options ?? []);

	// Named sets rather than inline skips, so an exception has to be written down as one.
	// Both are empty today: Holy relics is not excused here because it has no seasonal line to
	// match in the first place — see the note on SEASONAL_REMINDERS for why that matters.
	const EXCUSED_MOVES = new Set();
	const EXCUSED_POSSESSIONS = new Set();

	it("registers every playbook move whose printed text names a season", () => {
		const seasonal = docsUnder(MOVES)
			.filter(m => SEASONAL.test(plain(m?.system?.description)))
			.map(m => m.name);
		// The scan finding nothing would pass the assertion below while proving nothing, which is
		// the failure mode of every test that greps a tree.
		expect(seasonal).toContain("Logbook");
		const registered = new Set(SEASONAL_REMINDERS.filter(r => r.kind === "move").map(r => r.name));
		expect(seasonal.filter(n => !registered.has(n) && !EXCUSED_MOVES.has(n))).toEqual([]);
	});

	it("registers every special possession whose printed text names a season", () => {
		const seasonal = possessions()
			.filter(p => SEASONAL.test(plain(p?.description)))
			.map(p => p.slug);
		expect(seasonal).toContain("laboratory");
		const registered = new Set(SEASONAL_REMINDERS.filter(r => r.kind === "possession").map(r => r.slug));
		expect(seasonal.filter(s => !registered.has(s) && !EXCUSED_POSSESSIONS.has(s))).toEqual([]);
	});

	// The other direction. An entry matching nothing shipped is a rule the card would announce
	// that no character could ever carry — which is how the invented Holy relics refresh went
	// out to tables for as long as it did.
	it("registers nothing the compendium does not ship", () => {
		const moveNames = new Set(docsUnder(MOVES).map(m => m.name));
		const slugs = new Set(possessions().map(p => p.slug));
		for (const r of SEASONAL_REMINDERS) {
			if (r.kind === "move") expect([...moveNames], r.name).toContain(r.name);
			else expect([...slugs], r.slug).toContain(r.slug);
		}
	});
});
