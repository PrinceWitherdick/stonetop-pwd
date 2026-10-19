import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach } from "vitest";

// The receipt itself (adjustXp, the card, its Undo) is roll-engine.js's and tested there; here it is
// only asked for, with what.
const markXpReceipt = vi.fn(async () => ({ content: "<receipt>", flags: { xpMarked: 1 } }));
vi.mock("../../../module/utils/roll-engine.js", () => ({ markXpReceipt: (...args) => markXpReceipt(...args) }));

const {
	isRaisedByWolves, markWildWaysXp, resetWildWays, wildWaysState, WILD_WAYS_FLAG,
} = await import("../../../module/actors/character/wild-ways.js");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Raised by Wolves (Blessed re-audit, the user's ruling of 2026-10-18): "Once per session, when your
// wild ways offend or alienate you from someone, mark XP." A button under the background, once per
// session like Never Gonna Keep Me Down's circle, given back at End of Session.
function blessed({ background = "raised-by-wolves", playbook = "The Blessed", marked = false } = {}) {
	const flags = { "stonetop-pwd": { background: { selected: background }, ...(marked ? { [WILD_WAYS_FLAG]: true } : {}) } };
	const actor = {
		name: "Wren", type: "character", flags,
		system: { playbook: { name: playbook } },
		getFlag: (scope, key) => flags[scope]?.[key],
		update: vi.fn(async data => {
			for (const [k, v] of Object.entries(data)) {
				const key = k.replace("flags.stonetop-pwd.", "");
				flags["stonetop-pwd"][key] = v;
			}
		}),
	};
	return actor;
}

beforeEach(() => markXpReceipt.mockClear());

describe("Raised by Wolves' wild ways", () => {
	it("is offered only to a Blessed who took Raised by Wolves", () => {
		expect(isRaisedByWolves(blessed())).toBe(true);
		expect(wildWaysState(blessed())).toEqual({ marked: false });
		expect(wildWaysState(blessed({ background: "vessel" }))).toBeNull();
		// A slug is only its playbook's name for the background.
		expect(wildWaysState(blessed({ playbook: "The Ranger" }))).toBeNull();
		expect(wildWaysState({ type: "npc" })).toBeNull();
	});

	it("marks 1 XP with its receipt, and fills the session's circle before the XP", async () => {
		const actor = blessed();
		const create = vi.fn(async () => {});
		let circleAtXp = null;
		markXpReceipt.mockImplementationOnce(async () => {
			circleAtXp = actor.getFlag("stonetop-pwd", WILD_WAYS_FLAG);
			return { content: "<receipt>", flags: { xpMarked: 1 } };
		});
		expect(await markWildWaysXp(actor, { create })).toBe(true);
		expect(circleAtXp).toBe(true);
		expect(markXpReceipt).toHaveBeenCalledWith(actor, expect.objectContaining({
			amount: 1, move: "Raised by Wolves", description: "Wren's wild ways gave offence: marks XP.",
		}));
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ content: "<receipt>", flags: { "stonetop-pwd": { xpMarked: 1 } } }));
		expect(wildWaysState(actor)).toEqual({ marked: true });
	});

	it("marks nothing a second time in the same session", async () => {
		const actor = blessed({ marked: true });
		const create = vi.fn();
		expect(await markWildWaysXp(actor, { create })).toBe(false);
		expect(markXpReceipt).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});

	it("marks nothing for anyone not Raised by Wolves", async () => {
		expect(await markWildWaysXp(blessed({ background: "vessel" }), { create: vi.fn() })).toBe(false);
		expect(markXpReceipt).not.toHaveBeenCalled();
	});

	it("gives the circle back when the XP could not be marked", async () => {
		const actor = blessed();
		markXpReceipt.mockRejectedValueOnce(new Error("offline"));
		await expect(markWildWaysXp(actor, { create: vi.fn() })).rejects.toThrow("offline");
		expect(wildWaysState(actor)).toEqual({ marked: false });
	});

	it("End of Session clears the circle on those who marked it, and writes nothing for the rest", async () => {
		const marked = blessed({ marked: true });
		const clear = blessed();
		expect(await resetWildWays([marked, clear, { name: "no sheet" }])).toBe(1);
		expect(marked.update).toHaveBeenCalledWith({ [`flags.stonetop-pwd.${WILD_WAYS_FLAG}`]: false }, { stonetopMove: "End of Session" });
		expect(clear.update).not.toHaveBeenCalled();
		expect(wildWaysState(marked)).toEqual({ marked: false });
	});

	it("End of Session's apply resets it, and the Details tab draws the button under the background", () => {
		const eos = fs.readFileSync(path.resolve(REPO, "module/dialogs/EndOfSessionDialog.js"), "utf8");
		expect(eos).toMatch(/await resetWildWays\(this\._roster\.map\(row => row\.actor\)\)/);
		const hbs = fs.readFileSync(path.resolve(REPO, "templates/actor/partials/tab-details.hbs"), "utf8");
		expect(hbs).toContain("stonetop-wild-ways-xp");
		expect(hbs).toContain("My wild ways gave offence: mark XP");
	});
});
