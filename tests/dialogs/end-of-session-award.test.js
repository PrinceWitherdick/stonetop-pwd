import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../../module/utils/playbook-actors.js", () => ({
	getPlayerCharacters: () => roster.chars,
}));
vi.mock("../../module/hooks/StonetopSingleton.js", () => ({
	resetOmenReminder: vi.fn(async () => {}),
}));
vi.mock("../../module/utils/chat.js", () => ({
	stonetopChatCard: (title, body) => `${title}${body}`,
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

beforeEach(() => {
	roster.chars = [];
	global.ChatMessage = { create: vi.fn() };
});

/** Open the dialog with `n` of the four group questions answered yes. */
function opened(n) {
	const dialog = new EndOfSessionDialog();
	const { html, handler } = fakeHtml();
	dialog.activateListeners(html);
	Object.keys(dialog._groupChecks).slice(0, n).forEach(key => { dialog._groupChecks[key] = true; });
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
});
