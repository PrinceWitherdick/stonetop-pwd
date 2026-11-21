import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Table moments carried to the table (module/moments/moment-broadcast.js): GM-only at both ends,
// silenced at both ends by the world's Table moments switch.

const played = [];
vi.mock("../../module/moments/moment-overlay.js", () => ({ playMoment: view => { played.push(view); return !!view; } }));

import {
	sendMoment, registerMomentBroadcast, _resetMomentBroadcast, MOMENT_SOCKET, MOMENT_PLAY,
} from "../../module/moments/moment-broadcast.js";

let handler;
let momentsOn;

function asUser(isGM) {
	game.user = { isGM, id: isGM ? "gm" : "player" };
	game.socket = { emit: vi.fn(), on: (channel, fn) => { if (channel === MOMENT_SOCKET) handler = fn; } };
	registerMomentBroadcast();
}

beforeEach(() => {
	played.length = 0;
	handler = null;
	momentsOn = true;
	_resetMomentBroadcast();
	game.users = { get: id => ({ gm: { isGM: true }, player: { isGM: false } }[id] ?? null) };
	game.settings = { get: (_ns, key) => (key === "tableMoments" ? momentsOn : undefined) };
});

afterEach(() => { delete game.user; delete game.users; delete game.socket; delete game.settings; });

describe("sendMoment", () => {
	it("from a GM, emits on the system channel and plays here", () => {
		asUser(true);
		expect(sendMoment({ kind: "setOut", title: "To the Crossroads" })).toBe(true);
		expect(game.socket.emit).toHaveBeenCalledWith(MOMENT_SOCKET, {
			action: MOMENT_PLAY, kind: "setOut", title: "To the Crossroads", sub: "", userId: "gm",
		});
		expect(played.map(v => v.title)).toEqual(["To the Crossroads"]);
	});

	it("from a player, sends and plays nothing", () => {
		asUser(false);
		expect(sendMoment({ kind: "fight" })).toBe(false);
		expect(game.socket.emit).not.toHaveBeenCalled();
		expect(played).toEqual([]);
	});

	it("with Table moments off, sends and plays nothing", () => {
		asUser(true);
		momentsOn = false;
		expect(sendMoment({ kind: "fight" })).toBe(false);
		expect(game.socket.emit).not.toHaveBeenCalled();
		expect(played).toEqual([]);
	});

	it("sends nothing for an unknown kind", () => {
		asUser(true);
		expect(sendMoment({ kind: "parade" })).toBe(false);
		expect(game.socket.emit).not.toHaveBeenCalled();
	});
});

describe("the receiving end", () => {
	it("plays a GM's moment", () => {
		asUser(false);
		handler({ action: MOMENT_PLAY, kind: "home", title: "", sub: "", userId: "gm" });
		expect(played.map(v => v.kind)).toEqual(["home"]);
	});

	it("ignores a moment sent by a player, or by nobody it knows", () => {
		asUser(false);
		handler({ action: MOMENT_PLAY, kind: "fight", userId: "player" });
		handler({ action: MOMENT_PLAY, kind: "fight", userId: "stranger" });
		expect(played).toEqual([]);
	});

	it("ignores the channel's other messages", () => {
		asUser(false);
		handler({ action: "eosShow", run: "r", userId: "gm" });
		handler(null);
		expect(played).toEqual([]);
	});

	it("plays nothing with Table moments off", () => {
		asUser(false);
		momentsOn = false;
		handler({ action: MOMENT_PLAY, kind: "fight", userId: "gm" });
		expect(played).toEqual([]);
	});

	it("listens once however often it is registered", () => {
		const on = vi.fn();
		game.user = { isGM: false, id: "player" };
		game.socket = { emit: vi.fn(), on };
		registerMomentBroadcast();
		registerMomentBroadcast();
		expect(on).toHaveBeenCalledTimes(1);
	});
});
