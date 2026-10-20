import { describe, it, expect } from "vitest";
import {
	FRONT_MOVE_PREFIX, findArcanumFrontMove, isArcanumFrontMoveSlug, markArcanumFrontMoves, parseArcanumFrontMoves,
} from "../../module/data/arcana-moves.js";
import { injectGlyphCheckboxes } from "../../module/utils/glyphs.js";
import { loadArcanaPackDocs } from "../fakes/sourcePack.js";

// Mind Over Magic: "When you roll to study or use an arcanum, you can roll +INT instead of the stat
// you'd normally roll." The rolls printed on a card's FRONT (and in its unlock text) are handles on
// the arcana tab, like a mystery's name on the back.

const CARDS = loadArcanaPackDocs().map(d => d.flags.stonetop);
const card = slug => CARDS.find(c => c.slug === slug);

// Every rolling stretch of a card's front, as buildSnapshot wraps them.
function stretches(front) {
	return [
		[front.description, FRONT_MOVE_PREFIX.front],
		[front.unlock?.description, FRONT_MOVE_PREFIX.unlock],
		...(front.unlock?.requirements ?? []).filter(r => r.type === "option").map(r => [r.description, `${FRONT_MOVE_PREFIX.req}:${r.slug}`]),
	];
}

function frontMoves(slug) {
	const front = card(slug).front;
	return stretches(front).flatMap(([html, prefix]) =>
		parseArcanumFrontMoves(html, { prefix, fallbackName: front.title }).map(m => ({ ...m, handleText: String(html).slice(m.handle.start, m.handle.end) })));
}

describe("parseArcanumFrontMoves on the shipped cards", () => {
	// [slug, [stat, handle text] per move, in card order]
	const EXPECTED = [
		["azure-hand",               [["con", "brandish the Azure Hand at a source of elemental energy"]]],
		["red-scepter",              [["cha", "wield the Scepter and incite an individual to violent action"]]],
		["storm-markings",           [["wis", "try to control your temper"]]],
		["staff-of-the-lidless-orb", [["con", "grip the staff, close your eyes, and see through the Lidless Orb"]]],
		["hungering-maw-of-hlad",    [["con", "victim struggles"]]],
		["rune-laden-scales",        [["con", "wear the Rune-laden Scales and stand fast against a magical attack"]]],
		["blackwood-fetishes",       [["con", "anoint a figurine with your own blood and then sleep in its presence"]]],
		["ineffable-words",          [["con", "enter an ecstatic delirium and allow the Ineffable Words to pour forth"],
		                              ["wis", "spend weeks in ascetic contemplation of the incommunicable words within you"]]],
		["hectumel-codex",           [["int", "cast a spell learned from the Hec'tumel Codex"]]],
		["mindgem",                  [["int", "consult the Mindgem about the Makers, their arts, or their history"]]],
		["norubas-ice-sphere",       [["int", "gaze deeply into the Ice Sphere and ponder a situation, puzzle, or mystery"]]],
		["whispering-rocks",         [["int", "spend a few hours staring into the stones and listening to their whispers"]]],
		["cracked-flute",            [["cha", "roll +CHA"]]],
		["crumbling-arch",           [["wis", "roll +WIS"]]],
		["makerglass-chime",         [["con", "rolling +CON"]]],
		["metal-puzzle-box",         [["int", "roll +INT"]]],
		["clear-natural-pool",       [["int", "roll +INT"]]],
	];

	it.each(EXPECTED)("%s: finds each roll and its trigger", (slug, expected) => {
		expect(frontMoves(slug).map(m => [m.roll, m.handleText])).toEqual(expected);
	});

	it("finds no other front rolls on any shipped card", () => {
		const listed = new Set(EXPECTED.map(([slug]) => slug));
		const others = CARDS.filter(c => !listed.has(c.slug) && frontMoves(c.slug).length).map(c => c.slug);
		expect(others).toEqual([]);
	});

	it("skips a roll inside a list item: the Azure Hand's 'rolling +INT to Let Fly' is an option, not a move", () => {
		expect(frontMoves("azure-hand")).toHaveLength(1);
	});

	it("names a move by its SHOUTED head, else its trigger, else the card", () => {
		expect(frontMoves("hectumel-codex")[0].name).toBe("CAST A CODEX SPELL");
		expect(frontMoves("red-scepter")[0].name).toBe("INFLAME");
		expect(frontMoves("storm-markings")[0].name).toBe("Try to control your temper");
		expect(frontMoves("cracked-flute")[0].name).toBe("A cracked flute");
	});

	it("gives a move its text through its 6- and no further", () => {
		const [mindgem] = frontMoves("mindgem");
		expect(mindgem.description).toMatch(/On a 6-/);
		// The tasks that assemble its body follow the 6- and are not the move's.
		expect(mindgem.description).not.toMatch(/□/);
		expect(mindgem.picks).toHaveLength(3);
		const [codex] = frontMoves("hectumel-codex");
		expect(codex.picks).toHaveLength(2);
		expect(codex.description).not.toMatch(/Call the Pale Lizard\./);
		const [azure] = frontMoves("azure-hand");
		expect(azure.description).toMatch(/instead of marking XP, mark 1/);
	});

	it("is a front move: no learned box, and its own slug space", () => {
		const [move] = frontMoves("azure-hand");
		expect(move).toMatchObject({ slug: "~front:0", boxIndex: null, front: true });
		expect(isArcanumFrontMoveSlug(move.slug)).toBe(true);
		expect(isArcanumFrontMoveSlug("eye-of-the-storm")).toBe(false);
		expect(frontMoves("crumbling-arch")[0].slug).toBe("~req:gaze-and-roll:0");
		expect(frontMoves("cracked-flute")[0].slug).toBe("~unlock:0");
	});

	it("findArcanumFrontMove resolves every handle back to its move", () => {
		for (const c of CARDS) {
			for (const m of frontMoves(c.slug)) {
				expect(findArcanumFrontMove(c.front, m.slug)?.name).toBe(m.name);
			}
		}
		expect(findArcanumFrontMove(card("azure-hand").front, "~front:5")).toBeNull();
		expect(findArcanumFrontMove(card("azure-hand").front, "eye-of-the-storm")).toBeNull();
	});
});

describe("markArcanumFrontMoves leaves every box where it was", () => {
	const boxes = html => injectGlyphCheckboxes(html, /[□○◇]+/g, { slug: "s", context: "c", cssClass: "x", isChecked: () => false }).html
		.match(/data-index="\d+"/g) ?? [];

	it.each(CARDS.map(c => [c.slug, c]))("%s: same glyphs, same indices, on every stretch of the front", (_slug, c) => {
		for (const [html, prefix] of stretches(c.front)) {
			if (!html) continue;
			const wrapped = markArcanumFrontMoves(html, c.slug, { prefix, fallbackName: c.front.title });
			expect(wrapped.match(/[□○◇]/g) ?? []).toEqual(html.match(/[□○◇]/g) ?? []);
			expect(boxes(wrapped)).toEqual(boxes(html));
			// Only the handle was added: strip it and the text is the card's.
			expect(wrapped.replace(/<span class="stonetop-arcanum-move-name"[^>]*>([^<]*)<\/span>/g, "$1")).toBe(html);
		}
	});

	it("wraps the trigger in the tab's move-name handle", () => {
		const front = card("azure-hand").front;
		const wrapped = markArcanumFrontMoves(front.description, "azure-hand", { prefix: FRONT_MOVE_PREFIX.front });
		expect(wrapped).toContain('<strong><em><span class="stonetop-arcanum-move-name" data-arcanum-slug="azure-hand" data-move-slug="~front:0" role="button" tabindex="0">brandish the Azure Hand at a source of elemental energy</span></em></strong>');
	});
});
