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
	askWithButtons: async spec => { asked.calls += 1; asked.spec = spec; return asked.answer; },
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

	// _guardBusy greys the button and puts it back only on a throw. Told not to award, the window
	// neither closed nor redrew, and the GM was left with a dead button.
	it("draws the window afresh when told not to award again, so its button is live", async () => {
		roster.chars = [pc("Torwyn", 3)];
		stored.lastEndOfSession = { at: Date.now() - 5 * 60000, xp: 2, ids: ["Torwyn"] };
		asked.answer = false;
		const { dialog, confirm } = opened(2);
		dialog.rendered = true;
		dialog.render = vi.fn();

		await confirm({ currentTarget: { disabled: false } });

		expect(dialog.render).toHaveBeenCalledWith(false);
	});

	it("draws the window afresh after a player's press, too", async () => {
		globalThis.game.user = { id: "p", isGM: false };
		const { dialog, confirm } = opened(0);
		dialog.rendered = true;
		dialog.render = vi.fn();

		await confirm({ currentTarget: { disabled: false } });

		expect(dialog.render).toHaveBeenCalledWith(false);
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

// A player's read-only copy (end-of-session-broadcast.js): the GM's ticks and the prompts, nothing to award.
describe("End of Session, a player's copy", () => {
	const mirrorHtml = async (context) => {
		const { renderRoster } = await import("../fakes/hbs.js");
		const { readRepo } = await import("../fakes/css.js");
		return renderRoster(readRepo("templates/dialogs/end-of-session.hbs"), context);
	};

	it("takes only the four questions from a message, each as a plain yes or no", () => {
		roster.chars = [pc("Torwyn")];
		const dialog = new EndOfSessionDialog({ mirror: { run: "r1", checks: { learnedWorld: true, defeatedThreat: "yes", bogus: true } } });
		expect(dialog.run).toBe("r1");
		expect(dialog.groupChecks).toEqual({
			learnedWorld: true, defeatedThreat: false, improvedStanding: false, improvedStonetop: false,
		});
		// No roster: whose XP it is is the GM's call.
		expect(dialog._roster).toEqual([]);
	});

	it("wires only its Close, so nothing on it ticks or awards", () => {
		const dialog = new EndOfSessionDialog({ mirror: { run: "r1", checks: {} } });
		const { html, wired } = fakeHtml();
		dialog.activateListeners(html);
		expect(wired.map(w => w.sel)).toEqual([".stonetop-eos-confirm-btn"]);
	});

	it("follows the GM's ticks", () => {
		const dialog = new EndOfSessionDialog({ mirror: { run: "r1", checks: {} } });
		dialog.showChecks({ improvedStonetop: true });
		expect(dialog.groupChecks.improvedStonetop).toBe(true);
	});

	it("gives each GM window its own run, and does not follow ticks itself", () => {
		const a = new EndOfSessionDialog();
		const b = new EndOfSessionDialog();
		expect(a.run).toBeTruthy();
		expect(a.run).not.toBe(b.run);
		a.showChecks({ learnedWorld: true });
		expect(a.groupChecks.learnedWorld).toBe(false);
	});

	it("draws the GM's ticks fixed, without the roster, and closes rather than awards", async () => {
		const html = await mirrorHtml({
			mirror: true, xpCount: 1, canAward: true, tally: "TALLY", awardLabel: "AWARD",
			questions: [{ key: "learnedWorld", label: "Q", checked: true }],
			pcs: [{ id: "a", name: "Here", checked: true, dead: false }],
		});
		expect(html).toContain("stonetop-eos-body--mirror");
		expect(html).toContain(`data-key="learnedWorld" checked disabled`);
		expect(html).toContain("stonetop.endOfSession.mirrorHint");
		expect(html).not.toContain(`data-pc="a"`);
		expect(html).not.toContain("AWARD");
		expect(html).toContain("stonetop.endOfSession.close");
	});

	it("leaves the GM's own window as it was", async () => {
		const html = await mirrorHtml({
			xpCount: 1, canAward: true, tally: "TALLY", awardLabel: "AWARD",
			questions: [{ key: "learnedWorld", label: "Q", checked: true }],
			pcs: [{ id: "a", name: "Here", checked: true, dead: false }],
		});
		expect(html).not.toContain("--mirror");
		expect(html).not.toContain("disabled");
		expect(html).toContain(`data-pc="a" checked`);
		expect(html).toContain("AWARD");
	});

	it("draws each character's own ticks and note on the GM's window, and the last wish kept", async () => {
		const html = await mirrorHtml({
			xpCount: 0, canAward: true, tally: "TALLY", awardLabel: "AWARD",
			questions: [],
			pcs: [{ id: "a", name: "Here", checked: true, dead: false, note: "More dragons", lastWish: "Less sewers",
				personal: [{ key: "instinct", label: "Instinct (+1)", checked: true }, { key: "relationship", label: "Relationship (+1)", checked: false }] }],
		});
		expect(html).toContain(`class="stonetop-eos-personal-check" data-pc="a" data-xp="instinct" checked`);
		expect(html).toContain(`data-pc="a" data-xp="relationship" >`);
		expect(html).toContain(`value="More dragons"`);
		expect(html).toContain("Less sewers");
		expect(html).toContain("AWARD");
	});
});

// A player's macro: the GM's window, as their read-only copy, never one of their own (its roster
// and Award would only refuse, and the GM's copy arriving after would take over its frame).
describe("End of Session opened by a player", () => {
	it("asks the GM for their window instead of opening one, and says so when none comes", async () => {
		const { _resetEndOfSessionBroadcast, EOS_ASK, EOS_ASK_WAIT_MS } = await import("../../module/dialogs/end-of-session-broadcast.js");
		vi.useFakeTimers();
		_resetEndOfSessionBroadcast();
		globalThis.game.user = { id: "p", isGM: false };
		globalThis.game.socket = { emit: vi.fn() };
		const render = vi.spyOn(EndOfSessionDialog.prototype, "render");

		expect(EndOfSessionDialog.open()).toBeNull();

		expect(render).not.toHaveBeenCalled();
		expect(globalThis.game.socket.emit).toHaveBeenCalledWith(expect.any(String), { action: EOS_ASK, userId: "p" });
		// Not at once: a GM who has the window open answers within a moment.
		expect(globalThis.ui.notifications.info).not.toHaveBeenCalled();
		vi.advanceTimersByTime(EOS_ASK_WAIT_MS);
		expect(globalThis.ui.notifications.info).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
		render.mockRestore();
	});
});

// Each player's own XP (Book I p.75): "point out how you demonstrated or struggled with your instinct. If you
// can, mark XP" and "say how your relationship ... has changed. If you can, mark XP". Then praise and a wish
// for future sessions: "The GM will take notes", kept on the character and shown next time.
describe("each character's own XP, and their praise and wish", () => {
	it("marks a character's instinct and relationship XP on top of the group's", async () => {
		const torwyn = pc("Torwyn", 3), bryn = pc("Bryn", 5);
		roster.chars = [torwyn, bryn];
		const { dialog, confirm } = opened(1);
		dialog._personal.Torwyn = { instinct: true, relationship: true };
		dialog._personal.Bryn = { instinct: false, relationship: true };

		await confirm({ currentTarget: { disabled: false } });

		expect(torwyn.update).toHaveBeenCalledTimes(1);
		expect(torwyn.system.attributes.xp.value).toBe(6);
		expect(bryn.system.attributes.xp.value).toBe(7);
		const card = ChatMessage.create.mock.calls[0][0].content;
		expect(card).toContain("<strong>Torwyn</strong> marked <strong>+3 XP</strong>");
		expect(card).toContain("<strong>Bryn</strong> marked <strong>+2 XP</strong>");
	});

	it("pays a character's own XP when the table answered no to every group question", async () => {
		const torwyn = pc("Torwyn", 3), bryn = pc("Bryn", 5);
		roster.chars = [torwyn, bryn];
		const { dialog, confirm } = opened(0);
		dialog._personal.Torwyn = { instinct: true, relationship: false };
		expect(dialog.getData()).toMatchObject({ canAward: true });

		await confirm({ currentTarget: { disabled: false } });

		expect(torwyn.system.attributes.xp.value).toBe(4);
		expect(bryn.update).not.toHaveBeenCalled();
	});

	it("pays no one's own XP who is not ticked as at the table", async () => {
		const torwyn = pc("Torwyn", 3);
		roster.chars = [torwyn];
		const { dialog, confirm } = opened(0);
		dialog._pcChecks.Torwyn = false;
		dialog._personal.Torwyn = { instinct: true, relationship: true };

		await confirm({ currentTarget: { disabled: false } });

		expect(torwyn.update).not.toHaveBeenCalled();
	});

	// Code review 10-22 (HC-9): told not to award again, the window still keeps what the GM noted, once.
	it("keeps the notes when told not to award again, and keeps them once on a second press", async () => {
		const torwyn = Object.assign(pc("Torwyn", 3), { flags: { "stonetop-pwd": {} } });
		roster.chars = [torwyn];
		stored.lastEndOfSession = { at: Date.now() - 5 * 60000, xp: 2, ids: ["Torwyn"] };
		asked.answer = false;
		const { dialog, confirm } = opened(1);
		dialog._notes.Torwyn = "More dragons";
		await confirm({ currentTarget: { disabled: false } });
		expect(torwyn.update).toHaveBeenCalledTimes(1);
		expect(torwyn.update.mock.calls[0][0]["flags.stonetop-pwd.sessionWishes"]).toEqual([{ at: expect.any(Number), text: "More dragons" }]);
		await confirm({ currentTarget: { disabled: false } });
		expect(torwyn.update).toHaveBeenCalledTimes(1);
	});

	it("asks about an earlier award of a character's own XP in words that fit it", async () => {
		roster.chars = [pc("Torwyn", 3)];
		stored.lastEndOfSession = { at: Date.now() - 5 * 60000, xp: 0, personal: true, ids: ["Torwyn"] };
		asked.answer = false;
		const { confirm } = opened(1);
		await confirm({ currentTarget: { disabled: false } });
		expect(asked.spec.content).toContain("some of it their own instinct or relationship XP");
		expect(asked.spec.content).not.toContain("+0 XP");
	});

	// Two GMs: the second is asked as soon as the first starts paying, not only once the first is done.
	it("stamps the award once, before paying, when everyone is paid, saying when it held their own XP", async () => {
		const { setSetting } = await import("../../module/settings.js");
		setSetting.mockClear();
		const torwyn = pc("Torwyn", 3);
		roster.chars = [torwyn];
		let stampedBeforePaying = null;
		torwyn.update.mockImplementationOnce(async data => {
			stampedBeforePaying = { ...stored.lastEndOfSession };
			torwyn.system.attributes.xp.value = data["system.attributes.xp.value"];
		});
		const { dialog, confirm } = opened(0);
		dialog._personal.Torwyn = { instinct: true };
		await confirm({ currentTarget: { disabled: false } });
		expect(stampedBeforePaying).toMatchObject({ xp: 0, personal: true, ids: ["Torwyn"] });
		expect(setSetting).toHaveBeenCalledTimes(1);
		expect(stored.lastEndOfSession).toMatchObject({ xp: 0, personal: true, ids: ["Torwyn"] });
	});

	it("keeps each praise and wish on its character, and shows the last one next time", async () => {
		const torwyn = Object.assign(pc("Torwyn", 3), {
			flags: { "stonetop-pwd": { sessionWishes: [{ at: 1, text: "Less sewers" }] } },
		});
		roster.chars = [torwyn];
		const { dialog, confirm } = opened(0);
		expect(dialog.getData().pcs[0]).toMatchObject({ lastWish: "Less sewers", note: "" });
		dialog._notes.Torwyn = "  More dragons, and Vahid's mother  ";

		await confirm({ currentTarget: { disabled: false } });

		expect(torwyn.update).toHaveBeenCalledWith({
			"flags.stonetop-pwd.sessionWishes": [{ at: 1, text: "Less sewers" }, { at: expect.any(Number), text: "More dragons, and Vahid's mother" }],
		});
	});
});
