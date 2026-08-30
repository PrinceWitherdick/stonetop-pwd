import { describe, it, expect } from "vitest";
import { findArcanumMove, markArcanumMoveNames, parseArcanumMoves } from "../../module/data/arcana-moves.js";
import { loadArcanaPackDocs } from "../fakes/sourcePack.js";

const DOCS = loadArcanaPackDocs();
const backOf = slug => DOCS.find(d => d.flags?.stonetop?.slug === slug)?.flags?.stonetop?.back?.description ?? "";

describe("parseArcanumMoves", () => {
	it("reads every mystery the Azure Hand prints, in card order", () => {
		const moves = parseArcanumMoves(backOf("azure-hand"));
		expect(moves.map(m => m.name)).toEqual(["BATTERY", "EYE OF THE STORM", "RESONANCE"]);
	});

	it("keeps a trailing charge track out of the name", () => {
		const moves = parseArcanumMoves(backOf("storm-markings"));
		// The card prints "□ STORM'S FURY ○○○○" — the circles are the move's Fury track.
		expect(moves[0].name).toBe("STORM'S FURY");
		expect(parseArcanumMoves(backOf("azure-hand"))[0].name).toBe("BATTERY");
	});

	it("indexes each move's learned box the way the marker pass does", () => {
		// _injectMarkers numbers □ across the whole back side in document order, so the three
		// Azure Hand mysteries are boxes 0-2 and the Consequences below them carry on from 3.
		expect(parseArcanumMoves(backOf("azure-hand")).map(m => m.boxIndex)).toEqual([0, 1, 2]);
	});

	it("leaves boxIndex null for a move the card prints with no box", () => {
		const [move] = parseArcanumMoves(backOf("staff-of-the-lidless-orb"));
		expect(move.name).toBe("POWER OF THE LIDLESS ORB");
		expect(move.boxIndex).toBeNull();
	});

	it("finds the stat a move rolls, including the book's flat 'roll +nothing'", () => {
		const azure = parseArcanumMoves(backOf("azure-hand"));
		expect(azure.find(m => m.name === "EYE OF THE STORM").roll).toBe("con");
		expect(azure.find(m => m.name === "RESONANCE").roll).toBe("int");
		// BATTERY is pure text — storing the energy is not a roll.
		expect(azure.find(m => m.name === "BATTERY").roll).toBeNull();
		expect(parseArcanumMoves(backOf("demonhide-cloak"))[0].roll).toBe("nothing");
	});

	it("lifts the move's own option list as its picks", () => {
		const eye = parseArcanumMoves(backOf("azure-hand")).find(m => m.name === "EYE OF THE STORM");
		expect(eye.picks).toHaveLength(3);
		expect(eye.picks[0]).toMatch(/^You suffer no consequence/);
		expect(eye.picksLabel).toMatch(/choose 1:$/i);
	});

	it("names the list from the clause that introduces it", () => {
		const visage = parseArcanumMoves(backOf("demonhide-cloak")).find(m => m.name === "UNHOLY VISAGE");
		expect(visage.picksLabel).toBe("Spend Guise, 1-for-1 to:");
	});

	it("gives each move the prose that follows its name", () => {
		const [battery] = parseArcanumMoves(backOf("azure-hand"));
		expect(battery.description).toMatch(/gather elemental power about the Azure Hand/);
		// …and stops at the next move.
		expect(battery.description).not.toMatch(/EYE OF THE STORM/);
	});

	it("drops the separator a card prints between a name and its text", () => {
		const will = parseArcanumMoves(backOf("norubas-ice-sphere")).find(m => m.name === "A MIGHTY WILL");
		// Printed as "□ A MIGHTY WILL — When you mindwalk, hold +1 Power."
		expect(will.description).toBe("<p>When you mindwalk, hold +1 Power.</p>");
	});

	it("ignores bold runs in the section that are not move names", () => {
		// The Ring of Daagon's Moves section prints a follower's stat block ("Servant of
		// Daagon", "Tags:", "No. Appearing:") alongside its one move.
		expect(parseArcanumMoves(backOf("ring-of-daagon")).map(m => m.name)).toEqual(["CALL UP THE DEEP ONES"]);
	});

	it("is empty for a card with no Moves section", () => {
		expect(parseArcanumMoves(backOf("gold-ring"))).toEqual([]);
		expect(parseArcanumMoves("")).toEqual([]);
		expect(parseArcanumMoves(null)).toEqual([]);
	});

	it("gives colliding names distinct slugs", () => {
		const html = "<h3>Moves</h3><p><strong>□ ECHO</strong><br>One.</p><p><strong>□ ECHO</strong><br>Two.</p>";
		expect(parseArcanumMoves(html).map(m => m.slug)).toEqual(["echo", "echo-2"]);
	});

	it("stops at the section after Moves", () => {
		const azure = parseArcanumMoves(backOf("azure-hand"));
		// The Consequences list below is not a move, and RESONANCE's text does not swallow it.
		expect(azure).toHaveLength(3);
		expect(azure[2].description).not.toMatch(/Consequences/);
	});

	it("finds a shipped move on every card the book gives mysteries to", () => {
		const withMoves = DOCS.filter(d => /<h3>Moves<\/h3>/.test(d.flags?.stonetop?.back?.description ?? ""));
		expect(withMoves.length).toBeGreaterThan(10);
		for (const doc of withMoves) {
			const moves = parseArcanumMoves(doc.flags.stonetop.back.description);
			expect(moves.length, doc.flags.stonetop.slug).toBeGreaterThan(0);
			for (const move of moves) {
				expect(move.name, doc.flags.stonetop.slug).toMatch(/^[A-Z]/);
				expect(move.slug, doc.flags.stonetop.slug).toBeTruthy();
				expect(move.description, `${doc.flags.stonetop.slug}/${move.slug}`).toMatch(/\S/);
			}
		}
	});
});

describe("findArcanumMove", () => {
	it("resolves a move by its parsed slug", () => {
		expect(findArcanumMove(backOf("azure-hand"), "eye-of-the-storm").name).toBe("EYE OF THE STORM");
	});

	it("answers null for a slug the card does not print", () => {
		expect(findArcanumMove(backOf("azure-hand"), "no-such-move")).toBeNull();
	});
});

describe("markArcanumMoveNames", () => {
	const marked = markArcanumMoveNames(backOf("azure-hand"), "azure-hand");

	it("wraps each move name in a handle carrying its card and move slugs", () => {
		expect(marked).toContain('<span class="stonetop-arcanum-move-name" data-arcanum-slug="azure-hand"'
			+ ' data-move-slug="eye-of-the-storm" role="button" tabindex="0">EYE OF THE STORM</span>');
	});

	it("leaves the learned box and the charge track outside the handle", () => {
		// The □ still has to reach the marker pass as a bare glyph, and the ○ track after
		// BATTERY is the move's own resource, not part of what you click.
		expect(marked).toContain("<strong>□ <span class=\"stonetop-arcanum-move-name\"");
		expect(markArcanumMoveNames(backOf("storm-markings"), "storm-markings"))
			.toContain("STORM'S FURY</span> ○○○○</strong>");
	});

	it("changes no glyph counts, so the marker pass still indexes the same boxes", () => {
		const glyphs = html => (html.match(/[□○◇]/g) ?? []).join("");
		for (const doc of DOCS) {
			const back = doc.flags?.stonetop?.back?.description ?? "";
			expect(glyphs(markArcanumMoveNames(back, doc.flags.stonetop.slug)), doc.flags.stonetop.slug)
				.toBe(glyphs(back));
		}
	});

	it("touches nothing outside the Moves section", () => {
		const back = backOf("azure-hand");
		const tail = back.slice(back.indexOf("<h3>Consequences</h3>"));
		expect(marked).toContain(tail);
	});

	it("returns the description unchanged when the card prints no moves", () => {
		const back = backOf("gold-ring");
		expect(markArcanumMoveNames(back, "gold-ring")).toBe(back);
	});
});
