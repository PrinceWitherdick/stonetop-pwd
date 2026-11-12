import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { introDataFor, step4Questions, step6Questions, INTRO_PLAYBOOK_DATA } from "../../module/dialogs/introductions-data.js";
import { moveGroupsForPlaybook, moveGroupKeys, partitionMovesByGroup } from "../../module/actors/character/dialogs/onboarding-move-groups.js";
import { invalidatePlaybookCatalog } from "../../module/playbooks/playbook-catalog.js";

// A homebrew playbook's own Introductions questions and move groups, read where the book's are.
function tester(flags = {}) {
	return {
		id: "hb1", type: "playbook", name: "The Tester", system: { slug: "homebrew-the-tester" },
		flags: { stonetop: { homebrew: { v: 1, published: true }, ...flags } },
	};
}
function useWorld(...items) {
	invalidatePlaybookCatalog();
	vi.stubGlobal("game", { items: Object.assign(items, { get: id => items.find(i => i.id === id) ?? null }) });
}

beforeEach(() => useWorld(tester({
	introductions: { step3: "tell us what you broke & why <b>", step4: ["Who mended it?"], step6: [] },
	moveGroups: [{ key: "poking", label: "Poking", moves: ["Prod", "Poke"] }, { key: "waiting", label: "Waiting", moves: ["Wait"] }],
})));
afterEach(() => { vi.unstubAllGlobals(); invalidatePlaybookCatalog(); });

describe("Introductions read a homebrew playbook's own questions", () => {
	it("the book's playbooks are unchanged", () => {
		expect(introDataFor("the-fox")).toBe(INTRO_PLAYBOOK_DATA["the-fox"]);
	});

	it("escapes the GM's text, since the book's entries are HTML and drawn raw", () => {
		expect(introDataFor("homebrew-the-tester").step3).toBe("tell us what you broke &amp; why &lt;b&gt;");
		expect(step4Questions("homebrew-the-tester")).toEqual(["Who mended it?"]);
	});

	it("an empty step answers null, which skips that round, as an unknown playbook does", () => {
		expect(step6Questions("homebrew-the-tester")).toBeNull();
		expect(introDataFor("homebrew-nobody")).toBeNull();
	});
});

describe("move groups read a homebrew playbook's own", () => {
	it("chips, keys and the Moves tab's headings", () => {
		expect(moveGroupsForPlaybook("The Tester")).toEqual([{ key: "poking", label: "Poking" }, { key: "waiting", label: "Waiting" }]);
		expect(moveGroupKeys("The Tester", "Poke")).toEqual(["poking"]);
		const parts = partitionMovesByGroup("The Tester", [{ name: "Prod" }, { name: "Wait" }, { name: "Stray" }]);
		expect(parts.map(p => [p.key, p.moves.map(m => m.name)])).toEqual([["poking", ["Prod"]], ["waiting", ["Wait"]], ["ungrouped", ["Stray"]]]);
	});

	it("are read fresh, so an edit to the playbook shows without a reload", () => {
		expect(moveGroupKeys("The Tester", "Wait")).toEqual(["waiting"]);
		useWorld(tester({ moveGroups: [{ key: "idle", label: "Idle", moves: ["Wait"] }] }));
		expect(moveGroupKeys("The Tester", "Wait")).toEqual(["idle"]);
	});

	it("a playbook with none gets the flat list, and the book's are untouched", () => {
		useWorld(tester());
		expect(partitionMovesByGroup("The Tester", [{ name: "Prod" }])).toEqual([]);
		expect(moveGroupsForPlaybook("The Fox").map(g => g.key)).toEqual(["stealth", "combat", "charm"]);
	});
});
