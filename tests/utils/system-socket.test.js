import { describe, it, expect, vi, afterEach } from "vitest";
import { SYSTEM_SOCKET, emitSystemMessage, onSystemMessage, sentByGM } from "../../module/utils/system-socket.js";

// The system's one socket channel (module/utils/system-socket.js): every broadcast stamps its
// sender, and each listener hears only its own actions.

afterEach(() => { delete game.user; delete game.users; delete game.socket; });

describe("the system socket", () => {
	it("stamps the action and the sender on what it sends", () => {
		game.user = { id: "gm" };
		game.socket = { emit: vi.fn() };
		emitSystemMessage("ping", { n: 1 });
		expect(game.socket.emit).toHaveBeenCalledWith(SYSTEM_SOCKET, { n: 1, action: "ping", userId: "gm" });
	});

	it("hands a listener only the actions it asked for", () => {
		let listener;
		game.socket = { on: (channel, fn) => { if (channel === SYSTEM_SOCKET) listener = fn; } };
		const heard = [];
		onSystemMessage(["a", "b"], p => heard.push(p.action));
		listener({ action: "a" });
		listener({ action: "c" });
		listener(null);
		listener({ action: "b" });
		expect(heard).toEqual(["a", "b"]);
	});

	it("knows a GM's message from a player's or a stranger's", () => {
		game.users = { get: id => ({ gm: { isGM: true }, player: { isGM: false } }[id] ?? null) };
		expect(sentByGM({ userId: "gm" })).toBe(true);
		expect(sentByGM({ userId: "player" })).toBe(false);
		expect(sentByGM({ userId: "stranger" })).toBe(false);
		expect(sentByGM(null)).toBe(false);
	});
});
