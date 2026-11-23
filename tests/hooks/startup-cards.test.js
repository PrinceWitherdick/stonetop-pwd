import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";

// The welcome greeting and the "import your book art" reminder are latched once per world, but the
// latch is read on every GM client: two GMs whose `ready` lands together would both read it unset
// and both post. Only the primary GM posts them, the same gate remindDestinedOmenRoll uses.

// No art on disk, without browsing a server for it.
vi.mock("../../module/book2-art/reapply.js", async importOriginal => ({
	...(await importOriginal()),
	hasImportedBook2Art: async () => false,
}));

const { _postStartupWelcomeMessageOnce, _postBook2ArtReminderOnce } = await import("../../module/hooks/Ready.js");

const PRIMARY = { id: "gm1", isGM: true, active: true };
const SECOND = { id: "gm2", isGM: true, active: true };

let priorGame, priorChatMessage, stored, create;

function asUser(user) {
	global.game = {
		...priorGame,
		user,
		users: Object.assign([PRIMARY, SECOND], { activeGM: PRIMARY }),
		settings: {
			get: (scope, key) => (scope === SYSTEM_ID ? stored[key] : undefined),
			set: async (scope, key, value) => { stored[key] = value; return value; },
		},
	};
}

async function postBoth() {
	await _postStartupWelcomeMessageOnce();
	await _postBook2ArtReminderOnce();
}

beforeEach(() => {
	priorGame = global.game;
	priorChatMessage = global.ChatMessage;
	// Past the Welcome guide, which the art reminder waits for.
	stored = { gmWelcomeShown: true };
	create = vi.fn(async data => data);
	global.ChatMessage = { create, getWhisperRecipients: () => [PRIMARY, SECOND] };
});
afterEach(() => {
	global.game = priorGame;
	global.ChatMessage = priorChatMessage;
});

describe("the startup greeting and the book art reminder", () => {
	it("post on the primary GM's client, and latch", async () => {
		asUser(PRIMARY);
		await postBoth();
		expect(create).toHaveBeenCalledTimes(2);
		expect(stored.startupWelcomeShown).toBe(true);
		expect(stored.book2ArtReminderShown).toBe(true);
	});

	it("post neither on a second GM's client, and leave the latches for the primary", async () => {
		asUser(SECOND);
		await postBoth();
		expect(create).not.toHaveBeenCalled();
		expect(stored).not.toHaveProperty("startupWelcomeShown");
		expect(stored).not.toHaveProperty("book2ArtReminderShown");
	});

	// isPrimaryGM() alone is true with no GM connected; the isGM half is what keeps a player out.
	it("post neither on a player's client, even with no GM connected", async () => {
		asUser({ id: "p1", isGM: false, active: true });
		global.game.users = Object.assign([], { activeGM: null });
		await postBoth();
		expect(create).not.toHaveBeenCalled();
		expect(stored).not.toHaveProperty("startupWelcomeShown");
	});
});
