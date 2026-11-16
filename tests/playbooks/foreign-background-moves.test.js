import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildLiveCharacter, ownedMoveNames, resetLiveIds } from "../fakes/LiveCharacter.js";
import { looseName as looseMoveName } from "../../module/utils/strings.js";
import { levelPickToggleFor } from "../../module/actors/character/level-pick-toggle.js";

// A homebrew background that gives ANOTHER playbook's moves (the Standout's "Frosty from the
// Heavy"), spelled as a PDF spells them. Played here on a Fox, so the moves are foreign to it.
const BORROWER = { slug: "borrower", label: "The Borrower", description: "", moves: ["Frosty", "Into The Lion’s Den"] };
// Another background giving one of the same moves, under the other apostrophe.
const LENDER = { slug: "lender", label: "The Lender", description: "", moves: ["Into The Lion's Den"] };

async function foxWith(background) {
	const made = buildLiveCharacter({ slug: "the-fox", name: "The Fox", flags: { "background.selected": background?.slug ?? "" } });
	const real = await made.char.playbook();
	vi.spyOn(made.char, "playbook").mockResolvedValue({ ...real, name: real.name, slug: real.slug, backgrounds: [...(real.backgrounds ?? []), BORROWER, LENDER] });
	return made;
}

beforeEach(() => resetLiveIds());
afterEach(() => vi.restoreAllMocks());

describe("a background that gives another playbook's moves", () => {
	it("grants them, found across the other playbooks, matched loosely, stamped as the background's", async () => {
		const { char, actor } = await foxWith(BORROWER);
		await char.ensureStartingMoves();
		const names = ownedMoveNames(actor);
		expect(names).toContain("Frosty");
		expect(names).toContain("Into the Lion's Den");
		const frosty = actor.items.find(i => i.name === "Frosty");
		expect(frosty.system.playbook).toBe("The Heavy");
		expect(frosty.flags["stonetop-pwd"].backgroundGrant).toBe("borrower");
	});

	it("grants them once, however often it is settled", async () => {
		const { char, actor } = await foxWith(BORROWER);
		await char.ensureStartingMoves();
		await char.ensureStartingMoves();
		expect(ownedMoveNames(actor).filter(n => n === "Frosty")).toHaveLength(1);
	});

	it("takes them back when the background changes", async () => {
		const { char, actor } = await foxWith(BORROWER);
		await char.ensureStartingMoves();
		const dropped = await char.backgroundMovesDropped({ slug: "borrower" }, { slug: "the-natural" });
		expect(dropped.map(i => i.name).sort()).toEqual(["Frosty", "Into the Lion's Den"]);
		expect(dropped.every(i => actor.items.includes(i))).toBe(true);
	});

	it("keeps a move the new background gives too, however its apostrophe is spelled", async () => {
		const { char } = await foxWith(BORROWER);
		await char.ensureStartingMoves();
		const dropped = await char.backgroundMovesDropped({ slug: "borrower" }, { slug: "lender" });
		expect(dropped.map(i => i.name)).toEqual(["Frosty"]);
	});

	it("is never offered as a level pick", async () => {
		const { char, actor } = await foxWith(BORROWER);
		await char.ensureStartingMoves();
		const frosty = actor.items.find(i => i.name === "Frosty");
		expect(levelPickToggleFor(actor.items, [frosty._id ?? frosty.id])).toBeNull();
	});

	it("matches names loosely, and only loosely", () => {
		expect(looseMoveName("Into The Lion’s Den")).toBe(looseMoveName("Into the Lion's Den"));
		expect(looseMoveName("Frosty")).not.toBe(looseMoveName("Frosty Glare"));
	});
});
