import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Window } from "happy-dom";
import { PlaybookBuilderDialog } from "../../module/playbooks/PlaybookBuilderDialog.js";
import { normalizeBundle, normalizeMove, emptyBundle } from "../../module/playbooks/homebrew-bundle.js";
import { invalidatePlaybookCatalog } from "../../module/playbooks/playbook-catalog.js";
import { rosterHandlebars } from "../fakes/hbs.js";
import { readRepo } from "../fakes/css.js";

const SOURCE = readRepo("templates/dialogs/playbook-builder.hbs");

// An original test playbook touching every panel.
const TESTER = normalizeBundle({
	format: "stonetop-homebrew-playbook",
	version: 1,
	playbook: {
		name: "The Tester", published: true, summary: "Pokes at things.", complexity: "Low",
		description: "Every village needs someone who asks why.", notes: "Swap playbooks at level 3.",
		statsNote: "Assign these scores: +1, +1, +1, +0, +0, -1", hp: 18, damage: "d8", instinctLabel: "Drive",
		backgrounds: [{ label: "The Prober", description: "You test the ice.\n\n- carefully\n- twice", moves: ["Prod"], moveChoice: ["Frosty", "Poke"] }],
		instincts: [{ word: "Curiosity", description: "To find out." }, { word: "Caution", description: "" }],
		appearance: [["young", "old"], ["quiet", "loud"]],
		origin: [{ region: "Stonetop", names: ["Ade", "Bryn"] }, { region: "Gordin's Delve", names: [] }],
		possessions: { pickCount: 1, pickNote: "Pick 1", options: [{ label: "Tester's kit", description: "levers, a mallet", preselected: true }] },
		startingMovesNote: "You start with Prod and 1 of your choice.",
		moveChoices: [{ label: "Choose one", options: ["Prod", "Poke"] }],
		moveGroups: [{ label: "Poking", moves: ["Prod", "Poke"] }],
		lore: [{ title: "Belonging", description: "When you were young they... (choose 1 or 2)", options: [{ description: "... ignored you", max: 1 }, { description: "Who?", freeText: true }, { description: "lost", max: 2 }] }],
		introductions: { step3: "what you broke", step4: ["Who mended it?"], step6: ["Which of you laughed?", "Who cried?"] },
	},
	moves: [
		{ name: "Poke", description: "Gently.", level: 6, requires: "Requires level 6+ and Prod", requiresMoves: ["Prod"], repeatMax: 3 },
		{ name: "Prod", starting: true, description: "When you ***prod***, roll +INT:\n- it creaks", rollType: "int", results: { success: "It breaks.", partial: "It wobbles.", failure: "It bites." }, resource: { max: 3, title: "Doubt", labels: ["a", "b", "c"] } },
	],
}).bundle;

function renderInto(bundle, extra = {}) {
	const fake = {
		_bundle: structuredClone(bundle), _item: null, _issues: [], _activeTab: "playbook",
		_openMoves: new Set([0, 1]), appId: 7, ...extra,
	};
	const html = rosterHandlebars().compile(SOURCE)(PlaybookBuilderDialog.prototype.getData.call(fake));
	const window = new Window();
	window.document.body.innerHTML = html;
	// happy-dom quirk: options written back to back with `selected` on the third report the
	// SECOND as chosen (a browser picks the third). Re-assert the attribute so the test reads
	// what a browser would.
	for (const select of window.document.querySelectorAll("select")) {
		const chosen = [...select.options].findIndex(o => o.hasAttribute("selected"));
		if (chosen >= 0) select.selectedIndex = chosen;
	}
	fake.element = [window.document.body];
	return { fake, root: window.document.body };
}

beforeEach(() => {
	invalidatePlaybookCatalog();
	vi.stubGlobal("game", { items: Object.assign([], { get: () => null }), actors: [], user: { isGM: true } });
});
afterEach(() => { vi.unstubAllGlobals(); invalidatePlaybookCatalog(); });

describe("the Playbook Builder's form", () => {
	it("reads back exactly the playbook it was drawn from", () => {
		const { fake } = renderInto(TESTER);
		fake._bundle = emptyBundle();
		fake._bundle.moves = TESTER.moves.map(() => ({}));
		fake._bundle.playbook.backgrounds = TESTER.playbook.backgrounds.map(() => ({}));
		fake._bundle.playbook.possessions.options = TESTER.playbook.possessions.options.map(() => ({}));
		fake._bundle.playbook.lore = TESTER.playbook.lore.map(() => ({}));
		PlaybookBuilderDialog.prototype._readForm.call(fake);
		expect(normalizeBundle(fake._bundle).bundle).toEqual(TESTER);
	});

	it("an edit in a field lands at its path, and a track with no boxes is no track", () => {
		const { fake, root } = renderInto(TESTER);
		root.querySelector("[data-field='moves.1.name']").value = "Prod Harder";
		root.querySelector("[data-resource='1'] [name=resourceMax]").value = "0";
		root.querySelector("[data-lines='playbook.instincts']").value = "Boldness: To leap.";
		PlaybookBuilderDialog.prototype._readForm.call(fake);
		expect(fake._bundle.moves[1].name).toBe("Prod Harder");
		expect(fake._bundle.moves[1].resource).toBeNull();
		expect(fake._bundle.playbook.instincts).toEqual([{ word: "Boldness", description: "To leap." }]);
	});

	it("a save keeps what a miss holds, beside the 10+ and 7-9 boxes", () => {
		const fear = structuredClone(TESTER);
		fear.moves[1] = normalizeMove({
			...fear.moves[1], description: "When you ***prod***, roll +INT. On a 10+, hold 3 Fear. On a miss, hold 1 Fear.",
			resource: { max: 3, title: "Fear", labels: [] },
		});
		expect(fear.moves[1].resource.holdOnRoll).toEqual({ success: 3, failure: 1 });
		const { fake, root } = renderInto(fear);
		expect(root.querySelector("[data-resource='1'] [name=holdFailure]").value).toBe("1");
		PlaybookBuilderDialog.prototype._readForm.call(fake);
		expect(normalizeBundle(fake._bundle).bundle.moves[1].resource.holdOnRoll).toEqual({ success: 3, failure: 1 });
	});

	it("names a Drive playbook's panel Drives, and flags a background move from outside the playbook", () => {
		const data = PlaybookBuilderDialog.prototype.getData.call({ _bundle: TESTER, _item: null, _issues: [], _activeTab: "instincts", _openMoves: new Set(), appId: 1 });
		expect(data.active.title).toBe("Drives");
		expect(data.backgrounds[0].foreign).toBe("Frosty");
	});

	it("flags a stats note that doesn't hand out six scores, and an unusual HP", () => {
		const odd = structuredClone(TESTER);
		odd.playbook.statsNote = "Assign +2, +1, +1";
		odd.playbook.hp = 30;
		const data = PlaybookBuilderDialog.prototype.getData.call({ _bundle: odd, _item: null, _issues: [], _activeTab: "stats", _openMoves: new Set(), appId: 1 });
		expect(data.statFlag).toMatch(/exactly six scores/);
		expect(data.hpFlag).toMatch(/between 10 and 24/);
	});

	it("shows what an import reported, on the first panel", () => {
		const { root } = renderInto(TESTER, { _issues: [{ severity: "check", message: "Max HP 160 is more than 40" }] });
		expect(root.querySelector(".stonetop-pb-builder-report")?.textContent).toContain("Max HP 160");
	});
});
