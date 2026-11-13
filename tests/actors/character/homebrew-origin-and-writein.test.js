// A homebrew playbook's question for each place of origin and a place the player names themselves,
// and a write-in mark ("Something else: ___ (discuss with the GM)") that keeps what was written.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";
import { markEntries } from "../../../module/actors/character/pfg-marks.js";

let priorSettings;
beforeEach(() => { priorSettings = game.settings; game.settings ??= { get: () => undefined }; });
afterEach(() => { game.settings = priorSettings; });

const ORIGINS = [
	{ region: "Stonetop", names: [], question: "What do you love about it?", writeIn: false },
	{ region: "Barrier Pass", names: [], question: "", writeIn: false },
	{ region: "Somewhere else", names: [], question: "", writeIn: true },
];

function foxFrom(origin) {
	const built = buildLiveCharacter({ slug: "the-fox", name: "The Fox" });
	const repo = built.char._playbookRepo;
	built.char._playbookRepo = { findBySlug: async slug => ({ ...(await repo.findBySlug(slug)), origin }) };
	return built;
}
const originOf = async char => (await char.buildSnapshot()).playbook.origin;

describe("places of origin a homebrew playbook asks about", () => {
	it("shows the playbook's own question and the answer, not the book's word on the place", async () => {
		const { char } = foxFrom(ORIGINS);
		await char.origin.select("Stonetop", { answer: "The mill pond at dawn." });
		const picked = (await originOf(char)).selectedOption;
		expect(picked).toMatchObject({ region: "Stonetop", question: "What do you love about it?", answer: "The mill pond at dawn.", description: "" });
	});

	it("a place with no question keeps the book's word on it", async () => {
		const { char } = foxFrom(ORIGINS);
		await char.origin.select("Barrier Pass");
		expect((await originOf(char)).selectedOption.description).toMatch(/.+/);
	});

	it("a write-in place shows the place the player named", async () => {
		const { char } = foxFrom(ORIGINS);
		await char.origin.select("Somewhere else", { place: "  the salt flats " });
		expect((await originOf(char)).selectedOption).toMatchObject({ writeIn: true, place: "the salt flats" });
		// Picking another place keeps what was written, and only the chosen place shows it.
		await char.origin.select("Stonetop");
		expect((await originOf(char)).options.find(o => o.writeIn).place).toBe("");
		expect(char.origin.place).toBe("the salt flats");
	});
});

describe("a write-in mark keeps what the player wrote", () => {
	it("on the option's first mark, and through every later write of the marks", async () => {
		expect(markEntries([{ stat: "", level: 2, text: "Whistling" }])).toEqual([{ stat: "", level: 2, text: "Whistling" }]);
		const { char, actor } = buildLiveCharacter({ slug: "the-fox", name: "The Fox" });
		await actor.update(char.moveResources.markUpdate("Knack", "something-else", [{ stat: "", level: 1 }]));
		await char.setMarkText("Knack", "something-else", "  Whistling to birds ");
		expect(char.moveResources.getMarks().Knack["something-else"]).toEqual([{ stat: "", level: 1, text: "Whistling to birds" }]);
		await char.setMarkText("Knack", "something-else", "");
		expect(char.moveResources.getMarks().Knack["something-else"]).toEqual([{ stat: "", level: 1 }]);
	});

	it("writes nothing for a mark that isn't ticked", async () => {
		const { char } = buildLiveCharacter({ slug: "the-fox", name: "The Fox" });
		await char.setMarkText("Knack", "something-else", "Whistling");
		expect(char.moveResources.getMarks().Knack).toBeUndefined();
	});
});
