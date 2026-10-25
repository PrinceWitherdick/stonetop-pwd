import { afterEach, describe, expect, it } from "vitest";
import { primaryGM, isPrimaryGM, anyActiveGM } from "../../module/utils/primary-gm.js";

// The three questions about "which GM" all answer from primaryGM(): Foundry's activeGM, else the
// first connected GM, else nobody.

const prevGame = globalThis.game;
afterEach(() => { globalThis.game = prevGame; });

function setUsers(list, { activeGM = null, me = list[0] } = {}) {
	const users = [...list];
	users.activeGM = activeGM;
	globalThis.game = { users, user: me };
}

const gm1    = { id: "gm1", isGM: true, active: true };
const gm2    = { id: "gm2", isGM: true, active: true };
const away   = { id: "away", isGM: true, active: false };
const player = { id: "p", isGM: false, active: true };

describe("primaryGM", () => {
	it("is Foundry's activeGM when there is one", () => {
		setUsers([gm1, gm2], { activeGM: gm2, me: gm1 });
		expect(primaryGM()).toBe(gm2);
		expect(isPrimaryGM()).toBe(false);
	});

	it("falls back to the first connected GM, skipping one who is away", () => {
		setUsers([away, player, gm1, gm2], { me: gm1 });
		expect(primaryGM()).toBe(gm1);
		expect(isPrimaryGM()).toBe(true);
	});

	it("is null with no GM connected, when a lone client still counts as primary", () => {
		setUsers([away, player], { me: player });
		expect(primaryGM()).toBeNull();
		expect(isPrimaryGM()).toBe(true);
		expect(anyActiveGM()).toBe(false);
	});
});
