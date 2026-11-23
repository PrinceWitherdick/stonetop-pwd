// Playbook wording corrected against Book I in the round-3 playbook audit (2026-11-22). Each case pins the
// book's words where our copy had drifted from them, so a later edit or regeneration cannot quietly put
// the slip back. Short phrases only: the book's text is not copied into the repo.

import { describe, it, expect } from "vitest";
import { loadPlaybookPackDocs } from "../fakes/sourcePack.js";

const DOCS = loadPlaybookPackDocs();
const playbook = slug => DOCS.find(doc => doc.system.slug === slug).flags.stonetop;

describe("playbook wording matches Book I", () => {
	// p.144, the Crew insert's inventory: "+1 Readiness on a 7+ to Defend".
	it("gives the Marshal's crew shield its Readiness on a 7+", () => {
		const shield = playbook("the-marshal").crew.inventory.find(row => row.label.includes("Shield"));
		expect(shield.label).toContain("+1 Readiness on a 7+ to Defend");
	});

	// p.137, Driven: "You always have the option of Burning Brightly".
	it("words the Would-Be Hero's Driven background as the book does", () => {
		const driven = playbook("the-would-be-hero").backgrounds.find(bg => bg.slug === "driven");
		expect(driven.description).toContain("You always have the option of Burning Brightly;");
		expect(driven.description).not.toContain("option to Burn Brightly");
	});
});
