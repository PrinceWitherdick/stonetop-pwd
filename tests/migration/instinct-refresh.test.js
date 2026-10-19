import { describe, it, expect, vi } from "vitest";
import { instinctRefresh, refreshInstincts, INSTINCT_SUPERSEDED } from "../../module/migration/instinct-refresh.js";
import { composeInstinct } from "../../module/utils/strings.js";
import { loadPlaybookDefs } from "../fakes/sourcePack.js";

// A chosen instinct is stored as its whole composed text, so the Blessed's Delight and Reverence,
// corrected to Book I's wording, are rewritten on characters still holding the old text.

const SCOPE = "stonetop-pwd";
const OLD_DELIGHT = composeInstinct("Delight", "To find beauty, in even the ugliest things.");
const NEW_DELIGHT = composeInstinct("Delight", "To find beauty, in even the most ugly thing.");
const OLD_REVERENCE = composeInstinct("Reverence", "To honor the spirits and give them their due.");
const NEW_REVERENCE = composeInstinct("Reverence", "To demand sacrifice to the spirits and Danu.");

describe("instinctRefresh", () => {
	it("rewrites the two old Blessed instincts to the book's text", () => {
		expect(instinctRefresh(OLD_DELIGHT)).toBe(NEW_DELIGHT);
		expect(instinctRefresh(OLD_REVERENCE)).toBe(NEW_REVERENCE);
	});

	it("leaves the current text, another instinct, one the player wrote, and nothing at all", () => {
		expect(instinctRefresh(NEW_DELIGHT)).toBeNull();
		expect(instinctRefresh(composeInstinct("Nurture", "To help others grow, learn, or improve."))).toBeNull();
		expect(instinctRefresh("Delight: beauty in the ugliest things")).toBeNull();
		expect(instinctRefresh("")).toBeNull();
		expect(instinctRefresh(undefined)).toBeNull();
	});

	it("rewrites only to text the playbook offers now, never from it", () => {
		const offered = new Set(loadPlaybookDefs().byName.get("The Blessed").instincts.map(i => composeInstinct(i.word, i.description)));
		for (const [word, was, now] of INSTINCT_SUPERSEDED) {
			expect(offered.has(composeInstinct(word, now))).toBe(true);
			expect(offered.has(composeInstinct(word, was))).toBe(false);
		}
	});
});

describe("refreshInstincts", () => {
	const pc = (selected) => {
		const flags = { instinct: { selected } };
		return {
			type: "character",
			name: "Bran",
			flags: { [SCOPE]: flags },
			getFlag: (scope, key) => (scope === SCOPE ? key.split(".").reduce((o, k) => o?.[k], flags) : undefined),
			update: vi.fn(async () => {}),
		};
	};

	it("writes each character holding an old instinct, quietly, and no one else", async () => {
		const old = pc(OLD_REVERENCE);
		const current = pc(NEW_DELIGHT);
		expect(await refreshInstincts({ actors: [old, current, { type: "npc" }] })).toBe(1);
		expect(old.update).toHaveBeenCalledWith({ [`flags.${SCOPE}.instinct.selected`]: NEW_REVERENCE }, { stonetopLedger: true });
		expect(current.update).not.toHaveBeenCalled();
	});
});
