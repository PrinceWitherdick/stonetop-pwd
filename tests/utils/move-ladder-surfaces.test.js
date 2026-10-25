import { describe, it, expect } from "vitest";
import Handlebars from "handlebars";
import { readRepo } from "../fakes/css.js";
import { moveBodyHtml } from "../../module/utils/move-tiers.js";

// The surfaces that show a move, and whether each lays its outcomes out as the tier ladder
// (utils/move-tiers.js). Two holes a 2026-10-02 audit found: the level-up and onboarding cards
// passed no stored results, so a move whose outcomes live only there (Borrow Power, Veil) showed
// none; and five roll paths handed the roll card a raw description, so it had no ladder to mark
// the rolled rung on.

/** The `moveBody` helper as stonetop.js registers it: a non-object second argument is "none". */
function hbs() {
	const hb = Handlebars.create();
	hb.registerHelper("moveBody", (description, moveResults) => moveBodyHtml(description,
		moveResults && typeof moveResults === "object" && !moveResults.hash ? moveResults : null));
	return hb;
}
const BORROW_POWER = JSON.parse(readRepo("packs/src/stonetop-items/playbook-moves/the-blessed/borrow-power.json")).system;

describe("the level-up and onboarding move cards", () => {
	it("hand every move card's stored results to the ladder", () => {
		for (const rel of ["templates/dialogs/level-up.hbs", "templates/dialogs/character-onboarding.hbs"]) {
			const src = readRepo(rel);
			expect(src, rel).not.toContain("{{{moveBody description}}}");
			expect((src.match(/\{\{\{moveBody description moveResults\}\}\}/g) ?? []).length, rel).toBeGreaterThan(1);
		}
		// The agreed and cross-playbook steps' card, one partial for both.
		expect(readRepo("templates/dialogs/partials/level-up-other-card.hbs")).toContain("{{{moveBody description moveResults}}}");
	});

	it("show Borrow Power's stored outcomes on a level-up card", () => {
		const src = readRepo("templates/dialogs/level-up.hbs");
		const start = src.indexOf("{{#each moves}}");
		const card = src.slice(start, src.indexOf("{{/each}}", start) + "{{/each}}".length);
		const html = hbs().compile(card)({ moves: [{ name: "Borrow Power", ...BORROW_POWER }] });
		expect(html).toContain('class="stonetop-move-tiers"');
		expect(html).toContain("You do it and can use the power again.");
	});

	it("carry the stored results into the cards' context", () => {
		const levelUp = readRepo("module/actors/character/dialogs/LevelUpDialog.js");
		// The move and locked cards, and the one mapper the agreed and foreign-move cards share.
		expect((levelUp.match(/moveResults:\s+m\.moveResults \?\? null/g) ?? []).length).toBe(3);
		const onboarding = readRepo("module/actors/character/dialogs/CharacterOnboardingDialog.js");
		expect((onboarding.match(/moveResults: doc\.system\?\.moveResults \?\? null/g) ?? []).length).toBe(2);
		// The foreign moves a cross-playbook pick offers are built here.
		expect(readRepo("module/actors/character/StonetopCharacter.js"))
			.toContain("description: def.description ?? \"\", moveResults: def.moveResults ?? null");
	});
});

describe("the roll paths that bypass StonetopItem.roll", () => {
	const SHEET = readRepo("module/actors/character/StonetopCharacterSheet.js");

	it("lay Know Things and Seek Insight about an arcanum or artifact out with their ladder", () => {
		expect(SHEET).toContain("moveDescription: withMovePickBonuses(moveCardBody(owned?.system?.description");
		expect(SHEET).toMatch(/moveDescription: withMovePickBonuses\(moveCardBody\(owned\?\.system\?\.description\s*\?\? `<p>When you <strong><em>study a situation/);
	});

	// Since rollStat lays every description out itself (move-tiers.js#rollCardBody), a roll path
	// handing over raw prose gets the ladder too: Improvise and a post-death action no longer wrap.
	it("leave the ladder to rollStat where nothing else needs the built body", () => {
		expect(readRepo("module/utils/roll-engine.js")).toMatch(/const moveDescription = rollCardBody\(options\.moveDescription/);
		expect(SHEET).not.toContain("improvised.moveDescription = moveCardBody(");
		expect(readRepo("module/actors/character/post-death-actions.js")).not.toContain("moveCardBody(");
	});

	// The roll card carries the ladder, so the move card posted ahead of a roll keeps only the
	// ticks; a mystery posted without a roll still lays out its text with the ladder.
	it("give a rolled arcanum mystery its ladder once, on the roll card", () => {
		expect(SHEET).toContain("guide.card ? { moveDescription: moveCardBody(guide.card, null) } : {}");
		expect(SHEET).toContain("moveChatCard(name, (withText ? moveBodyHtml(guide.card, null) : \"\") + picked)");
	});

	it("lay each Struggle as One roll out with its ladder", () => {
		expect(readRepo("module/struggle/struggle-store.js"))
			.toContain("return moveCardBody((await fetchMoveRef(STRUGGLE_MOVE)) ?? \"\", null)");
	});
});
