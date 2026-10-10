import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Awarding the session's group XP.
//
// The award walks every player character with a separate write apiece, then posts a card and
// resets the Omen reminder, and only then closes the window. On a four-player table that leaves
// the Confirm button live and inviting for several round trips, and a second press in that gap
// used to award the whole session's XP a second time to everybody. Since XP is a running total
// that nothing reconciles afterwards, a double award is invisible until someone notices they
// levelled a session early.
//
// The guard is the same one LevelUpDialog carries over `applyLevelUp`, for the same reason.

const roster = { chars: [] };

vi.mock("../../module/utils/playbook-actors.js", async importOriginal => ({
	...(await importOriginal()),
	getPlayerCharacters: () => roster.chars,
}));
vi.mock("../../module/hooks/StonetopSingleton.js", () => ({
	resetOmenReminder: vi.fn(async () => {}),
}));
vi.mock("../../module/utils/chat.js", () => ({
	stonetopChatCard: (title, body) => `${title}${body}`,
}));
const stored = { lastEndOfSession: {} };
vi.mock("../../module/settings.js", () => ({
	getObjectSetting: key => stored[key] ?? {},
	setSetting: vi.fn(async (key, value) => { stored[key] = value; }),
}));
vi.mock("../../module/actors/character/deaths-door-actor.js", async importOriginal => ({
	...(await importOriginal()),
	isOutOfPlay: actor => !!actor?.dead,
}));
const asked = { answer: true, calls: 0 };
vi.mock("../../module/utils/ask-with-buttons.js", () => ({
	askWithButtons: async () => { asked.calls += 1; return asked.answer; },
}));
// The AppV1 chrome the dialog inherits is not what is under test; this is the shell it needs.
vi.mock("../../module/utils/stonetop-dialog.js", () => ({
	StonetopDialog: class {
		constructor(options = {}) { this.options = options; }
		activateListeners() {}
		async close() {}
		render() { return this; }
		// The real one, copied: the latch and the disable are the behaviour under test here, so
		// stubbing them out would leave these cases proving nothing. See utils/stonetop-dialog.js.
		async _guardBusy(ev, fn) {
			if (this._busy) return;
			this._busy = true;
			const control = ev?.currentTarget;
			if (control) control.disabled = true;
			try {
				return await fn();
			} catch (err) {
				if (control) control.disabled = false;
				throw err;
			} finally {
				this._busy = false;
			}
		}
	},
}));

const { EndOfSessionDialog } = await import("../../module/dialogs/EndOfSessionDialog.js");

/** Just enough jQuery for `html.find(sel).on(type, fn)`, collecting what gets wired. */
function fakeHtml() {
	const wired = [];
	const html = { find: (sel) => ({ on: (type, fn) => wired.push({ sel, type, fn }) }) };
	return { html, wired, handler: (sel) => wired.find(w => w.sel === sel)?.fn };
}

/**
 * A player character whose write takes a turn of the event loop to land.
 *
 * The delay is the point: an update that resolved synchronously would close the very window the
 * second click has to arrive in, and the test would pass against no guard at all.
 */
function pc(name, xp = 3) {
	const actor = {
		id: name,
		name,
		// A real Actor's UUID: adjustXp keys its per-character write queue on it, and a fake
		// without one would be serialised as "unidentifiable" instead of the way a PC is.
		uuid: `Actor.${name}`,
		system: { attributes: { xp: { value: xp }, level: { value: 1 } } },
		update: vi.fn(async (data) => {
			await new Promise(resolve => setTimeout(resolve, 0));
			actor.system.attributes.xp.value = data["system.attributes.xp.value"];
		}),
	};
	return actor;
}

const savedGame = globalThis.game;
const savedUi = globalThis.ui;

beforeEach(() => {
	roster.chars = [];
	stored.lastEndOfSession = {};
	asked.answer = true;
	asked.calls = 0;
	global.ChatMessage = { create: vi.fn() };
	globalThis.game = { ...savedGame, user: { id: "gm", isGM: true }, users: [] };
	globalThis.ui = { ...savedUi, notifications: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } };
});

afterEach(() => {
	globalThis.game = savedGame;
	globalThis.ui = savedUi;
});

/**
 * Open the dialog with `n` of the four group questions answered yes. Everyone on the roster is ticked
 * unless `asSeated`, which keeps the ticks the dialog chose for itself.
 */
function opened(n, { asSeated = false } = {}) {
	const dialog = new EndOfSessionDialog();
	const { html, handler } = fakeHtml();
	dialog.activateListeners(html);
	Object.keys(dialog._groupChecks).slice(0, n).forEach(key => { dialog._groupChecks[key] = true; });
	if (!asSeated) for (const id of Object.keys(dialog._pcChecks)) dialog._pcChecks[id] = true;
	return { dialog, confirm: handler(".stonetop-eos-confirm-btn") };
}

describe("End of Session group XP", () => {
	it("awards each player character once per confirmed session", async () => {
		const torwyn = pc("Torwyn", 3);
		roster.chars = [torwyn, pc("Bryn", 5)];
		const { confirm } = opened(2);

		await confirm({ currentTarget: { disabled: false } });

		expect(torwyn.update).toHaveBeenCalledTimes(1);
		expect(torwyn.system.attributes.xp.value).toBe(5);
	});

	it("ignores a second press while the first award is still writing", async () => {
		const torwyn = pc("Torwyn", 3);
		const bryn   = pc("Bryn", 5);
		roster.chars = [torwyn, bryn];
		const { confirm } = opened(2);
		const button = { disabled: false };

		// Deliberately not awaited in turn: this is the impatient double-click, both presses
		// landing before the first walk of the roster has finished.
		await Promise.all([confirm({ currentTarget: button }), confirm({ currentTarget: button })]);

		expect(torwyn.update).toHaveBeenCalledTimes(1);
		expect(bryn.update).toHaveBeenCalledTimes(1);
		expect(torwyn.system.attributes.xp.value).toBe(5);
		expect(bryn.system.attributes.xp.value).toBe(7);
	});

	it("disables the button on the press it accepted, so the GM can see it took", async () => {
		roster.chars = [pc("Torwyn")];
		const { confirm } = opened(1);
		const button = { disabled: false };

		await confirm({ currentTarget: button });

		expect(button.disabled).toBe(true);
	});

	it("writes nothing when the table answered no to everything", async () => {
		const torwyn = pc("Torwyn", 3);
		roster.chars = [torwyn];
		const { confirm } = opened(0);

		await confirm({ currentTarget: { disabled: false } });

		expect(torwyn.update).not.toHaveBeenCalled();
		expect(global.ChatMessage.create).not.toHaveBeenCalled();
	});

	// Never Gonna Keep Me Down: "Once per session, when you are at Death's Door, don't roll." A new
	// session gives the use back, whatever the table answered.
	it("clears a spent Never Gonna Keep Me Down circle", async () => {
		const held = { "Never Gonna Keep Me Down": 1 };
		const wynfor = pc("Wynfor", 3);
		wynfor.typedActor = { moveResources: {
			getMoveResources: () => held,
			setUses: vi.fn(async (name, value) => { held[name] = value; }),
		} };
		roster.chars = [wynfor, pc("Bryn", 5)];
		const { confirm } = opened(0);

		await confirm({ currentTarget: { disabled: false } });

		expect(held["Never Gonna Keep Me Down"]).toBe(0);
	});
});

// "For each yes, everyone marks XP" (Book I p.232): everyone at the table, not every character the
// world holds. The dialog ticks the characters of logged-in players, leaves the dead unticked, and
// pays only who is ticked.
describe("who marks the session's XP", () => {
	it("ticks the characters of logged-in players, and not the absent or the dead", () => {
		const here = pc("Here"), away = pc("Away"), dead = Object.assign(pc("Gone"), { dead: true });
		roster.chars = [here, away, dead];
		game.users = [
			{ id: "p1", active: true, isGM: false, character: here },
			{ id: "p2", active: false, isGM: false, character: away },
			{ id: "p3", active: true, isGM: false, character: dead },
		];
		const { dialog } = opened(1, { asSeated: true });
		expect(dialog._pcChecks).toEqual({ Here: true, Away: false, Gone: false });
		expect(dialog.getData().pcs.find(p => p.id === "Gone")).toMatchObject({ dead: true, checked: false });
	});

	it("goes by the assigned character first, so sharing every sheet does not tick an absent player's", () => {
		// Every player OWNS every character (a table that shares its sheets); the assignment says who plays whom.
		const owned = actor => Object.assign(actor, { testUserPermission: () => true });
		const here = owned(pc("Here")), away = owned(pc("Away")), loose = owned(pc("Loose"));
		roster.chars = [here, away, loose];
		game.users = [
			{ id: "p1", active: true, isGM: false, character: here },
			{ id: "p2", active: false, isGM: false, character: away },
		];
		expect(opened(1, { asSeated: true }).dialog._pcChecks).toEqual({ Here: true, Away: false, Loose: false });
		// A logged-in player with no character assigned plays what they own.
		game.users.push({ id: "p3", active: true, isGM: false, character: null });
		expect(opened(1, { asSeated: true }).dialog._pcChecks).toEqual({ Here: true, Away: true, Loose: true });
	});

	it("pays only who is ticked, and the card names who was left out", async () => {
		const here = pc("Here", 3), away = pc("Away", 3);
		roster.chars = [here, away];
		game.users = [{ id: "p1", active: true, isGM: false, character: here }];
		const { confirm } = opened(2, { asSeated: true });

		await confirm({ currentTarget: { disabled: false } });

		expect(here.system.attributes.xp.value).toBe(5);
		expect(away.update).not.toHaveBeenCalled();
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("Not at the table, not paid: <strong>Away</strong>");
	});

	it("is the GM's to award: a player's press writes nothing", async () => {
		const torwyn = pc("Torwyn");
		roster.chars = [torwyn];
		game.user = { id: "p1", isGM: false };
		const { confirm } = opened(2);

		await confirm({ currentTarget: { disabled: false } });

		expect(torwyn.update).not.toHaveBeenCalled();
		expect(ui.notifications.warn).toHaveBeenCalled();
	});

	it("pays the rest when one character's write fails, and says who was not paid", async () => {
		const broken = pc("Broken"), fine = pc("Fine", 3);
		broken.update = vi.fn(async () => { throw new Error("no permission"); });
		roster.chars = [broken, fine];
		const { confirm } = opened(1);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		await confirm({ currentTarget: { disabled: false } });

		error.mockRestore();
		expect(fine.system.attributes.xp.value).toBe(4);
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("the XP could not be written: <strong>Broken</strong>");
		expect(stored.lastEndOfSession).toMatchObject({ xp: 1, ids: ["Fine"] });
	});

	// A second GM, or the same GM reopening the window, used to award the whole session again.
	it("asks before awarding again soon after an award, and writes nothing when told not to", async () => {
		const torwyn = pc("Torwyn", 3);
		roster.chars = [torwyn];
		stored.lastEndOfSession = { at: Date.now() - 5 * 60000, xp: 2, ids: ["Torwyn"] };
		asked.answer = false;
		const { confirm } = opened(2);

		await confirm({ currentTarget: { disabled: false } });

		expect(asked.calls).toBe(1);
		expect(torwyn.update).not.toHaveBeenCalled();
	});

	it("draws a tick box per character, the dead marked so, with every word from languages/en.json", async () => {
		const { renderRoster } = await import("../fakes/hbs.js");
		const { readRepo } = await import("../fakes/css.js");
		const html = renderRoster(readRepo("templates/dialogs/end-of-session.hbs"), {
			questions: [], xpCount: 0,
			pcs: [{ id: "a", name: "Here", checked: true, dead: false }, { id: "b", name: "Gone", checked: false, dead: true }],
		});
		expect(html).toContain(`data-pc="a" checked`);
		expect(html).not.toContain(`data-pc="b" checked`);
		expect(html).toContain("Gone <em>(stonetop.endOfSession.dead)</em>");
		expect(html).not.toMatch(/Did we learn|Point out how/);
	});

	it("does not ask about an award from an earlier session, and stamps this one", async () => {
		const torwyn = pc("Torwyn", 3);
		roster.chars = [torwyn];
		stored.lastEndOfSession = { at: Date.now() - 7 * 24 * 3600000, xp: 2, ids: ["Torwyn"] };
		const { confirm } = opened(3);

		await confirm({ currentTarget: { disabled: false } });

		expect(asked.calls).toBe(0);
		expect(torwyn.system.attributes.xp.value).toBe(6);
		expect(stored.lastEndOfSession).toMatchObject({ xp: 3, ids: ["Torwyn"] });
		expect(Date.now() - stored.lastEndOfSession.at).toBeLessThan(60000);
	});
});
