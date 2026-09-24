import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { oathbreakerAgainst, foeAdvantage, HERO_MOVES } from "../../module/fight/hero-moves.js";
import { BINDING_ARBITRATION, OATHS_FLAG } from "../../module/actors/character/oaths.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// Binding Arbitration: "If they have broken their word, you gain advantage on all rolls against them
// until they admit their wrongdoing." The oath's broken tick is the whole condition, so an attack at an
// oathbreaker is simply at advantage, named on the card.

function judge(oaths, moves = [BINDING_ARBITRATION]) {
	const flags = { [SYSTEM_ID]: { [OATHS_FLAG]: oaths } };
	return {
		id: "hafgan", name: "Hafgan", type: "character",
		items: moves.map(name => ({ type: "move", name, flags: {} })),
		flags,
		getFlag: (scope, key) => flags[scope]?.[key],
	};
}

let saved;
beforeEach(() => {
	saved = globalThis.fromUuidSync;
	// A token for Brennan whose world actor is "Brennan the Claw", and one for a stranger.
	const brennan = { documentName: "Actor", id: "brennanActor", uuid: "Actor.brennanActor", name: "Brennan the Claw" };
	const docs = new Map([
		["Scene.s.Token.tb", { documentName: "Token", uuid: "Scene.s.Token.tb", name: "Brennan", actor: brennan, actorLink: true }],
		["Scene.s.Token.tx", { documentName: "Token", uuid: "Scene.s.Token.tx", name: "Stranger", actor: { documentName: "Actor", id: "x", uuid: "Actor.x", name: "Stranger" }, actorLink: true }],
	]);
	globalThis.fromUuidSync = uuid => docs.get(uuid) ?? null;
});
afterEach(() => { globalThis.fromUuidSync = saved; });

const brennanToken = { uuid: "Scene.s.Token.tb", name: "Brennan", actorId: "brennanActor" };
const stranger = { uuid: "Scene.s.Token.tx", name: "Stranger", actorId: "x" };

describe("an oathbreaker", () => {
	it("gives the Judge advantage against someone whose oath is ticked broken, matched by their actor", () => {
		const hafgan = judge([{ id: "o1", name: "Brennan the Claw", uuid: "Actor.brennanActor", broken: true }]);
		expect(oathbreakerAgainst(hafgan, [brennanToken])).toBe(BINDING_ARBITRATION);
		expect(foeAdvantage(hafgan, [brennanToken])).toBe(BINDING_ARBITRATION);
	});

	it("matches a name-only row by name", () => {
		const hafgan = judge([{ id: "o1", name: "brennan", broken: true }]);
		expect(oathbreakerAgainst(hafgan, [brennanToken])).toBe(BINDING_ARBITRATION);
	});

	it("gives nothing for an oath kept, or once the breach is admitted and the tick is lifted", () => {
		expect(oathbreakerAgainst(judge([{ id: "o1", name: "Brennan", broken: false }]), [brennanToken])).toBeNull();
		expect(oathbreakerAgainst(judge([]), [brennanToken])).toBeNull();
	});

	it("needs every target to be an oathbreaker, and the move switched on", () => {
		const oaths = [{ id: "o1", name: "Brennan", broken: true }];
		expect(oathbreakerAgainst(judge(oaths), [brennanToken, stranger])).toBeNull();
		expect(oathbreakerAgainst(judge(oaths, []), [brennanToken])).toBeNull();
		expect(oathbreakerAgainst(judge(oaths), [])).toBeNull();
	});

	it("gives way to a grudge the move itself names first (Relentless on a Clash)", () => {
		const hafgan = judge([{ id: "o1", name: "Brennan", broken: true }], [BINDING_ARBITRATION, HERO_MOVES.RELENTLESS]);
		hafgan.flags[SYSTEM_ID].clashedWith = [{ key: "Actor.brennanActor", name: "Brennan", since: 0 }];
		expect(foeAdvantage(hafgan, [brennanToken], { clash: true })).toBe(HERO_MOVES.RELENTLESS);
	});
});
