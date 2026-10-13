import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// End of Session shown to the table: the GM's window drives a read-only copy on each player's
// screen. See module/dialogs/end-of-session-broadcast.js.

const opened = [];
// When a copy's draw finishes: resolved, unless a case holds it open to land a message mid-draw.
let drawGate = Promise.resolve();
vi.mock("../../module/dialogs/EndOfSessionDialog.js", () => ({
	EndOfSessionDialog: class {
		constructor({ mirror }) {
			this.run = mirror.run;
			this.checks = mirror.checks;
			this.rendered = false;
			this.closed = false;
			opened.push(this);
		}
		// As core's: `render` returns before the draw is done, and a close mid-draw does nothing.
		render() { this._drawing = drawGate.then(() => { this.rendered = true; }); return this; }
		settled() { return this._drawing ?? Promise.resolve(); }
		showChecks(checks) { this.checks = checks; }
		async close() {
			if (!this.rendered) return;
			this.closed = true;
			this.rendered = false;
			// The real dialog reports its own close; done here so the dismissal path is covered.
			const { mirrorClosed } = await import("../../module/dialogs/end-of-session-broadcast.js");
			mirrorClosed(this);
		}
	},
}));

import {
	EOS_SOCKET, EOS_SHOW, EOS_CLOSE, EOS_ASK,
	sendEndOfSession, sendEndOfSessionClosed, registerEndOfSessionBroadcast, requestEndOfSession, _resetEndOfSessionBroadcast, EOS_ASK_WAIT_MS,
} from "../../module/dialogs/end-of-session-broadcast.js";

let handler;
// The receiver queues each message and lazily imports the window, so let both settle.
const deliver = async (payload) => { handler(payload); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
const show = (run, checks = {}) => ({ action: EOS_SHOW, run, checks, userId: "gm" });
const closed = run => ({ action: EOS_CLOSE, run, userId: "gm" });

function asUser(isGM) {
	game.user = { isGM, id: isGM ? "gm" : "player" };
	game.socket = { emit: vi.fn(), on: (_channel, fn) => { handler = fn; } };
	registerEndOfSessionBroadcast();
}

beforeEach(() => {
	opened.length = 0;
	drawGate = Promise.resolve();
	_resetEndOfSessionBroadcast();
	game.users = { get: (id) => ({ gm: { isGM: true }, player: { isGM: false } }[id] ?? null) };
});

afterEach(() => { delete game.user; delete game.users; delete game.socket; });

describe("the GM's window", () => {
	it("tells the table what it shows, on the system's channel", () => {
		asUser(true);
		expect(sendEndOfSession({ run: "r1" }, { learnedWorld: true })).toBe(true);
		expect(game.socket.emit).toHaveBeenCalledWith(EOS_SOCKET, {
			action: EOS_SHOW, run: "r1", checks: { learnedWorld: true }, userId: "gm",
		});
	});

	it("tells the table when it closes", () => {
		asUser(true);
		sendEndOfSessionClosed({ run: "r1" });
		expect(game.socket.emit).toHaveBeenCalledWith(EOS_SOCKET, { action: EOS_CLOSE, run: "r1", userId: "gm" });
	});

	// A player's client opening the window by hand drives nobody's screen.
	it("sends nothing from a player's client", () => {
		asUser(false);
		game.socket.emit.mockClear();
		expect(sendEndOfSession({ run: "r1" }, {})).toBe(false);
		expect(sendEndOfSessionClosed({ run: "r1" })).toBe(false);
		expect(game.socket.emit).not.toHaveBeenCalled();
	});

	it("answers a late player with where it stands", async () => {
		asUser(true);
		const win = { run: "r1", rendered: true, groupChecks: { defeatedThreat: true } };
		sendEndOfSession(win, win.groupChecks);
		game.socket.emit.mockClear();
		await deliver({ action: EOS_ASK, userId: "player" });
		expect(game.socket.emit).toHaveBeenCalledWith(EOS_SOCKET, expect.objectContaining({
			action: EOS_SHOW, run: "r1", checks: { defeatedThreat: true },
		}));
	});

	it("does not answer once it has closed", async () => {
		asUser(true);
		const win = { run: "r1", rendered: true, groupChecks: {} };
		sendEndOfSession(win, {});
		sendEndOfSessionClosed(win);
		game.socket.emit.mockClear();
		await deliver({ action: EOS_ASK, userId: "player" });
		expect(game.socket.emit).not.toHaveBeenCalled();
	});
});

describe("a player's copy", () => {
	it("asks at ready whether a GM already has the window open", () => {
		asUser(false);
		expect(game.socket.emit).toHaveBeenCalledWith(EOS_SOCKET, { action: EOS_ASK, userId: "player" });
	});

	it("opens on the GM's first draw and follows each tick in the same window", async () => {
		asUser(false);
		await deliver(show("r1"));
		await deliver(show("r1", { learnedWorld: true }));
		expect(opened).toHaveLength(1);
		expect(opened[0].rendered).toBe(true);
		expect(opened[0].checks).toEqual({ learnedWorld: true });
	});

	// Two ticks in quick succession must not each open a window while the first is loading.
	it("opens one window for messages that arrive together", async () => {
		asUser(false);
		handler(show("r1"));
		handler(show("r1", { learnedWorld: true }));
		await deliver(show("r1", { learnedWorld: true, defeatedThreat: true }));
		expect(opened).toHaveLength(1);
		expect(opened[0].checks).toEqual({ learnedWorld: true, defeatedThreat: true });
	});

	it("closes when the GM's window does", async () => {
		asUser(false);
		await deliver(show("r1"));
		await deliver(closed("r1"));
		expect(opened[0].closed).toBe(true);
	});

	// The player's own Close is final for that run, but a fresh window from the GM opens again.
	it("stays closed after the player closes it, until the GM opens a new one", async () => {
		asUser(false);
		await deliver(show("r1"));
		await opened[0].close();
		await deliver(show("r1", { learnedWorld: true }));
		expect(opened).toHaveLength(1);
		await deliver(show("r2"));
		expect(opened).toHaveLength(2);
		expect(opened[1].run).toBe("r2");
	});

	// The GM reloaded with the window up: its close never came, and the new run replaces the old copy.
	it("replaces a copy left over from an earlier run", async () => {
		asUser(false);
		await deliver(show("r1"));
		await deliver(show("r2"));
		expect(opened[0].closed).toBe(true);
		expect(opened[1].rendered).toBe(true);
	});

	// The GM closed (or awarded) before the player's copy had finished drawing: it still closes.
	it("closes a copy the GM closed while it was still drawing", async () => {
		asUser(false);
		let draw;
		drawGate = new Promise(resolve => { draw = resolve; });
		handler(show("r1"));
		await deliver(closed("r1"));
		expect(opened[0].closed).toBe(false);
		draw();
		for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
		expect(opened[0].closed).toBe(true);
	});

	it("ignores a close for some other run", async () => {
		asUser(false);
		await deliver(show("r2"));
		await deliver(closed("r1"));
		expect(opened[0].closed).toBe(false);
	});

	it("ignores a message that did not come from a GM", async () => {
		asUser(false);
		await deliver({ ...show("r1"), userId: "player" });
		await deliver({ action: EOS_SHOW, run: "r1", checks: {} });
		expect(opened).toHaveLength(0);
	});

	// The GM has the real window; a co-GM gets no second one fighting it.
	it("never opens on a GM's client", async () => {
		asUser(true);
		await deliver(show("r1"));
		expect(opened).toHaveLength(0);
	});

	// The channel is shared with the rulebook broadcast.
	it("ignores anything that is not its message", async () => {
		asUser(false);
		await deliver({ action: "showBook", book: 1, page: 9, userId: "gm" });
		await deliver(undefined);
		await deliver({ action: EOS_SHOW, run: 7, userId: "gm" });
		expect(opened).toHaveLength(0);
	});
});

// A player who runs the macro: the GM's copy, never a window of their own.
describe("a player asking for End of Session", () => {
	const asks = () => game.socket.emit.mock.calls.filter(([, p]) => p.action === EOS_ASK).length;

	it("brings the copy already up forward, and asks nobody", async () => {
		asUser(false);
		await deliver(show("r1"));
		opened[0].bringToTop = vi.fn();
		expect(requestEndOfSession()).toBe(opened[0]);
		expect(opened[0].bringToTop).toHaveBeenCalled();
		expect(asks()).toBe(1); // only the one at ready
	});

	it("restores a minimized copy before bringing it forward", async () => {
		asUser(false);
		await deliver(show("r1"));
		Object.assign(opened[0], { minimized: true, maximize: vi.fn(), bringToTop: vi.fn() });
		requestEndOfSession();
		expect(opened[0].maximize).toHaveBeenCalled();
	});

	// The player closed their copy by mistake: asking again is taking that close back.
	it("asks the GM again, and takes back a copy they closed themselves", async () => {
		asUser(false);
		await deliver(show("r1"));
		await opened[0].close();
		expect(requestEndOfSession()).toBeNull();
		expect(asks()).toBe(2);
		await deliver(show("r1"));
		expect(opened).toHaveLength(2);
		expect(opened[1].rendered).toBe(true);
	});

	// A GM with the window open answers within a moment; a notice saying it is theirs to open would
	// then sit over the copy that just arrived.
	it("tells the player only when no copy arrives in time", async () => {
		// Real time still runs, for the window drawing as the copy arrives.
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			asUser(false);
			const answered = vi.fn();
			requestEndOfSession({ onNoAnswer: answered });
			await deliver(show("r1"));
			vi.advanceTimersByTime(EOS_ASK_WAIT_MS);
			expect(answered).not.toHaveBeenCalled();

			_resetEndOfSessionBroadcast();
			const unanswered = vi.fn();
			requestEndOfSession({ onNoAnswer: unanswered });
			vi.advanceTimersByTime(EOS_ASK_WAIT_MS - 1);
			expect(unanswered).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1);
			expect(unanswered).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("asks nothing from a GM's client", () => {
		asUser(true);
		expect(requestEndOfSession()).toBeNull();
		expect(asks()).toBe(0);
	});
});
