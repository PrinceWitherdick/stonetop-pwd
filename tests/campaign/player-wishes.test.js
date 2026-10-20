import { describe, expect, it } from "vitest";
import { WISHES_SHOWN, playerWishesView } from "../../module/campaign/player-wishes.js";

// The players' End of Session wishes (Book I p.75), gathered for the GM: "outstanding wishes" at the start of a
// session (p.581) and "player wishes yet to be granted" among the hanging threads before the game ends (p.591).

const SCOPE = "stonetop-pwd";
const pc = (id, wishes, extra = {}) => ({ id, name: id, type: "character", flags: { [SCOPE]: { sessionWishes: wishes, ...extra } } });

describe("everyone's wishes", () => {
	it("lists each character in play who said something, newest first", () => {
		const view = playerWishesView([
			pc("Blodwen", [{ at: 1, text: "Tell Caradoc how I feel" }, { at: 2, text: "Resolve Nia's spiders" }]),
			pc("Vahid", []),
			pc("Eira", [{ at: 3, text: "One more ride" }], { deathsDoor: "dead" }),
			{ id: "npc", type: "npc" },
		], { when: at => `#${at}` });
		expect(view).toEqual([{
			id: "Blodwen", name: "Blodwen", img: "",
			wishes: [{ text: "Resolve Nia's spiders", when: "#2" }, { text: "Tell Caradoc how I feel", when: "#1" }],
		}]);
	});

	it("shows only the latest few", () => {
		const many = Array.from({ length: WISHES_SHOWN + 3 }, (_, i) => ({ at: i, text: `wish ${i}` }));
		const [row] = playerWishesView([pc("Caradoc", many)], { when: () => "" });
		expect(row.wishes).toHaveLength(WISHES_SHOWN);
		expect(row.wishes[0].text).toBe(`wish ${WISHES_SHOWN + 2}`);
	});
});
