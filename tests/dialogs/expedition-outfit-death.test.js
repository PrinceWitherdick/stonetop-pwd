import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Who the Outfit step offers, once death is on the table.
//
// The party-load readout is the panel a GM opens to see what everyone is carrying before a trip.
// Two things are true about a character who has been through the Last Door and they pull in
// opposite directions:
//
//  • THE DEAD PACK NOTHING. Someone who stepped through and stayed there cannot outfit, cannot
//    carry, cannot be asked where their gear came from. Leaving them on the pick line offers the
//    GM a party member they can tick onto a trip, which is the one thing this panel must not do.
//
//  • WHOEVER CAME BACK IS STILL GOING. A Revenant, a Ghost or a Thrall outfits like anyone else
//    and their load gates their moves the same way, so they keep their row — wearing the black
//    their sheet and their chat cards already wear, because "other" is worth saying on the list
//    of who is setting out.

vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

vi.mock("../../module/utils/world.js", () => ({
	getStonetopSteadingActor:       () => null,
	getStonetopSteadingActorOrWarn: () => null,
	isSteadingActor: a => a?.type === "stonetop" || a?.system?.customType === "stonetop",
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");

const ROOT    = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PARTIAL = fs.readFileSync(path.join(ROOT, "templates/dialogs/partials/expedition-load.hbs"), "utf8");
const CSS     = fs.readFileSync(path.join(ROOT, "styles/stonetop.css"), "utf8");

const SCOPE = "stonetop-pwd";

/**
 * A PC on the roster. `death` is the deathsDoor flag and `insert` the post-death insert slug —
 * the same two flags the sheet and the chat drip read, written where they really live so the
 * readout has to resolve them the way production does.
 */
function pc(id, name, { death = null, insert = null } = {}) {
	const flags = { [SCOPE]: {} };
	if (death)  flags[SCOPE].deathsDoor = death;
	if (insert) flags[SCOPE].postDeathInsert = { slug: insert };
	return {
		id, name, img: "", type: "character",
		system: { playbook: { slug: "blessed", name: "The Blessed" } },
		flags,
		// No typed actor: the row falls back to an empty load, which is all this suite reads.
		typedActor: null,
	};
}

/** A dialog on the Outfit step with `actors` as the world roster and nobody toggled out. */
function dialog(actors, partyOut = {}) {
	global.game = {
		i18n: global.game.i18n,
		user: { isGM: true },
		actors: { contents: actors },
	};
	const d = Object.create(ExpeditionDialog.prototype);
	d._currentExpedition = () => ({ partyOut });
	return d;
}

beforeEach(() => {
	global.Hooks = { once: () => {}, on: () => 1, off: () => {} };
});

describe("the Outfit step and the dead", () => {
	it("drops a character who stepped through the Last Door from the rows AND the pick line", async () => {
		const readout = await dialog([
			pc("a", "Vahid"),
			pc("b", "Pim", { death: "dead" }),
		])._buildLoadReadout();

		expect(readout.chips.map(c => c.name)).toEqual(["Vahid"]);
		expect(readout.rows.map(r => r.name)).toEqual(["Vahid"]);
	});

	it("keeps everyone a brush with death can still be walked back from", async () => {
		// Dying, awaiting a fate, or unconscious: all three are mid-conversation, and none of
		// them is a reason to take somebody off the trip they are already packed for.
		const readout = await dialog([
			pc("a", "Vahid", { death: "dying" }),
			pc("b", "Pim",   { death: "fate-pending" }),
			pc("c", "Fen",   { death: "out-of-action" }),
		])._buildLoadReadout();

		expect(readout.chips.map(c => c.name)).toEqual(["Vahid", "Pim", "Fen"]);
		expect(readout.chips.every(c => !c.undeadKind)).toBe(true);
	});

	it("keeps whoever came back, and says which of the three they are", async () => {
		const readout = await dialog([
			pc("a", "Vahid", { insert: "ghost" }),
			pc("b", "Pim",   { insert: "thrall", death: "out-of-action" }),
			pc("c", "Fen"),
		])._buildLoadReadout();

		expect(readout.chips.map(c => c.undeadKind)).toEqual(["ghost", "thrall", null]);
		expect(readout.rows.map(r => r.undead?.kind ?? null)).toEqual(["ghost", "thrall", null]);
		// The label is the tag the row prints. With no snapshot to name the insert, the slug
		// capitalised is what the GM reads.
		expect(readout.rows[0].undead.label).toBe("Ghost");
	});

	it("prefers the insert's own name off the snapshot, so a renamed insert reads as itself", () => {
		const d   = dialog([]);
		const row = d._pcRow(pc("a", "Vahid"), { postDeathInsert: { activeInsert: { name: "Revenant (Iron)" } } },
			null, false, 0, { light: 2, normal: 4, heavy: 6 }, "revenant");
		expect(row.undead).toEqual({ kind: "revenant", label: "Revenant (Iron)" });
	});

	it("marks no follower as undead — nothing brings a follower back", () => {
		const row = dialog([])._loadRow("light", "The Crew", 1, { light: 2, normal: 4, heavy: 6 },
			{ isFollower: true, folTag: "crew" });
		expect(row.undead).toBe(null);
	});
});

describe("the black a returned character sets out on", () => {
	/** Every rule in the stylesheet whose selector mentions `sel`. */
	const rules = sel => (CSS.match(/^[^\n]*\{[\s\S]*?\}/gm) ?? []).filter(r => r.split("{")[0].includes(sel));

	it("puts the row's kind on the row and the chip's on the chip", () => {
		expect(PARTIAL).toContain("{{#if undead}} is-undead is-undead--{{undead.kind}}{{/if}}");
		expect(PARTIAL).toContain("{{#if undeadKind}} is-undead is-undead--{{undeadKind}}{{/if}}");
		expect(PARTIAL).toContain('<span class="stonetop-exp-load-undead">{{undead.label}}</span>');
	});

	it("darkens the row by repainting it, not by laying a film over it", () => {
		const base = rules(".stonetop-exp-load-row.is-undead")
			.find(r => r.split("{")[0].trim().endsWith(".is-undead"));
		expect(base, "the undead row rule is gone").toBeTruthy();
		// A near-black paper of its own, and the palette tokens the row's furniture reads turned
		// over with it — an `opacity` or a translucent black over the row is the film.
		expect(base).toMatch(/background:[\s\S]*hsl\(0 0% 12%\)/);
		expect(base).not.toMatch(/opacity\s*:/);
		for (const token of ["--st-text-muted", "--st-red-text", "--st-green-text", "--st-gold-text"]) {
			expect(base, `${token} still reads as ink on parchment`).toContain(token);
		}
	});

	it("sits after the load bands, which it ties with", () => {
		// `.row.is-undead` and `.row.lvl-over` are both (0,3,0) inside the dialog scope, so the
		// black only beats the overloaded wash by being later in the file.
		expect(CSS.indexOf(".stonetop-exp-load-row.is-undead {"))
			.toBeGreaterThan(CSS.indexOf(".stonetop-exp-load-row.lvl-over "));
	});

	it("keeps the overloaded warning readable on the black instead of painting over it", () => {
		const over = rules(".stonetop-exp-load-row.is-undead.lvl-over");
		expect(over.join("\n")).toContain("--st-load-row-wash: var(--st-red-bg)");
	});

	it("uses the same three inks as the sheet and the chat cards", () => {
		// The hues are the shared ones (see "the sheet of someone who came back"); a fourth
		// blue-for-a-Revenant invented here is how the three surfaces drift apart.
		for (const [kind, ink] of [["revenant", "hsl(210 40% 55%)"], ["thrall", "hsl(96 30% 52%)"], ["ghost", "hsl(283 34% 58%)"]]) {
			const row  = rules(`.stonetop-exp-load-row.is-undead--${kind}`).join("\n");
			const chip = rules(`.stonetop-exp-load-chip.is-undead--${kind}`).join("\n");
			expect(row, kind).toContain(`--st-past-death-ink: ${ink}`);
			expect(chip, `the ${kind} chip`).toContain(`--st-past-death-ink: ${ink}`);
		}
	});

	it("leaves the face to the load band, which is what the column is scanned for", () => {
		// The disc is the fourth place a row says the band (edge, pips, pill, face). Painting it
		// in the insert's ink put a Thrall's green at the head of an overloaded red row.
		expect(rules(".is-undead .stonetop-exp-load-ava")).toEqual([]);
	});
});
