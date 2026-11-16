import { describe, it, expect, afterEach } from "vitest";
import { loveLetterRecipientOptions } from "../../../module/actors/character/love-letters.js";

// "For which character?" names the player beside each character, so a GM writing to "Alex's
// character" finds them without remembering every name at the table.
describe("the love letter's recipient dropdown", () => {
	const saved = { actors: global.game.actors, users: global.game.users };
	afterEach(() => { global.game.actors = saved.actors; global.game.users = saved.users; });

	it("lists every character, each with its player, and keeps the id as the value", () => {
		const pim = {
			id: "pim", name: "Pim", type: "character", system: { playbook: { name: "The Lightbearer" } },
			testUserPermission: (u, level) => level === "OWNER" && u.id === "u1",
		};
		const orla = { id: "orla", name: "Orla", type: "character", system: { playbook: { name: "The Ranger" } }, testUserPermission: () => false };
		const bryn = { id: "bryn", name: "Bryn", type: "npc", system: { occupation: "smith" } };
		global.game.actors = [pim, orla, bryn];
		global.game.users = [{ id: "u1", name: "Alex", isGM: false, character: { id: "pim" } }];
		expect(loveLetterRecipientOptions("orla")).toEqual([
			{ id: "pim", name: "Pim (Alex)", selected: false },
			{ id: "orla", name: "Orla (The Ranger)", selected: true },
		]);
	});
});
