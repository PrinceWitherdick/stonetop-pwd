import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readRepo } from "../fakes/css.js";
import { isActingPrimaryGM, isPrimaryGM } from "../../module/utils/primary-gm.js";

// onReady's world sweeps write shared world documents and stamp world-scope once-per-version
// gates. isPrimaryGM() is true for EVERY client when no GM is connected (so a lone client still
// acts), which on its own handed the whole sweep list to a player alone in the world: each world
// write failed, and the token-link repair could put the GM's question in front of that player.
// So both of onReady's primary-GM blocks gate on isActingPrimaryGM(), which pairs it with isGM.

let priorGame;
beforeEach(() => { priorGame = global.game; });
afterEach(() => { global.game = priorGame; });

describe("isPrimaryGM with no GM connected", () => {
	it("is true for a player, which is why it cannot gate a GM's writes alone", () => {
		const player = { id: "p1", isGM: false, active: true };
		global.game = { ...priorGame, user: player, users: Object.assign([player], { activeGM: null }) };
		expect(isPrimaryGM()).toBe(true);
		expect(isActingPrimaryGM()).toBe(false);
	});

	it("leaves isActingPrimaryGM true for the primary GM", () => {
		const gm = { id: "g1", isGM: true, active: true };
		global.game = { ...priorGame, user: gm, users: Object.assign([gm], { activeGM: gm }) };
		expect(isActingPrimaryGM()).toBe(true);
	});
});

describe("onReady's primary-GM blocks", () => {
	const READY = readRepo("module/hooks/Ready.js");
	const body = READY.slice(READY.indexOf("export async function onReady() {"), READY.indexOf("async function _applyCoreSettingDefaultsForNewWorld"));
	const GATE = "if (isActingPrimaryGM()) {";

	/** The `if` block (onReady-level, one tab in) that contains `needle`, or null. */
	function gateAround(needle) {
		const at = body.indexOf(needle);
		const open = body.lastIndexOf(GATE, at);
		if (at < 0 || open < 0) return null;
		// The block closes on the first onReady-level `}` after it opens.
		const close = body.indexOf("\n\t}\n", open);
		return close > at ? body.slice(open, close) : null;
	}

	it("never gates on isPrimaryGM() alone", () => {
		expect(body).not.toMatch(/if \(isPrimaryGM\(\)\)/);
	});

	it("runs the world sweeps, the token-link question included, only for a connected GM", () => {
		for (const sweep of [
			`oncePerVersion("moveRefresh", refreshHeldMoves)`,
			"_repairCharacterTokenLinks",
			"_migrateTokenNameplates",
			"_migrateNpcPlaceholderPortraits",
			"_migrateTokenImagesToPortraits",
			"_migrateShootMarker",
			"markPosterMapScenes",
		]) expect(gateAround(sweep), sweep).not.toBeNull();
	});

	it("adopts settlement portraits and stamps their world-scope gate only for a connected GM", () => {
		const block = gateAround("adoptSettlementPortraits(");
		expect(block).not.toBeNull();
		expect(block).toContain(`oncePerVersion("settlementLegacyMaps"`);
	});
});
