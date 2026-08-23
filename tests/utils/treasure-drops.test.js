import { describe, it, expect } from "vitest";
import { headName, liftLength, rawEndOfNorm, treasureItemData } from "../../module/utils/treasure-drops.js";
import { TREASURE_CATALOG } from "../../module/data/treasure-catalog.js";

// The journal enhancer rebuilds each treasure line as a drag-cell: the name is lifted
// out of the book's prose into a header, the rest becomes the cell body. The lift is
// index arithmetic against a NORMALIZED match, so these guard the mapping back onto
// the real text — an off-by-one there silently eats or duplicates the rulebook's words.
// (The DOM assembly itself is verified in the browser; this suite runs in node.)

/** What decorate() slices out of a line: everything up to the end of the origin. */
const lift = (line, origin) => line.slice(0, liftLength(line, origin));

describe("rawEndOfNorm", () => {
	it("maps a normalized prefix back onto the raw text", () => {
		expect(lift("Brass sphere, magical, Value 2 A heavy lump", "Brass sphere")).toBe("Brass sphere");
	});

	it("keeps the book's casing and inner punctuation", () => {
		const line = "A 1-inch cube of dark ice (magical, Value 1)";
		expect(lift(line, "A 1-inch cube of dark ice")).toBe("A 1-inch cube of dark ice");
	});

	it("stops at the origin, not at the collapsed space that follows it", () => {
		// norm() collapses ", " to one space, so a naive length-based slice overshoots.
		const line = "Barrel of anthracite immobile, dangerous, Value 3 Lumps of stone";
		expect(lift(line, "Barrel of anthracite")).toBe("Barrel of anthracite");
	});

	it("handles a line that is nothing but the origin", () => {
		expect(lift("Brightberry", "Brightberry")).toBe("Brightberry");
	});

	it("never splits inside a word", () => {
		// "A map" must not match into "A maple"; the caller matched the origin already,
		// but the slice must still land on the word boundary it was told about.
		expect(lift("A map of the barrows", "A map")).toBe("A map");
	});

	it("returns 0 when asked for nothing", () => {
		expect(rawEndOfNorm("Brass sphere", 0)).toBe(0);
	});
});

describe("liftLength", () => {
	it("keeps punctuation the origin closes on, which norm() would have trimmed", () => {
		// Otherwise the header reads 'A pot of “gold' and the description opens on '”'.
		expect(lift("A pot of “gold” buried under the hearth", "A pot of “gold”")).toBe("A pot of “gold”");
	});

	it("keeps a trailing parenthetical the origin owns", () => {
		const origin = "A ring of petrified wood, set with a shining diamond (?)";
		expect(lift(origin + " magical, Value 3", origin)).toBe(origin);
	});

	it("does not swallow the separator between a name and its prose", () => {
		// The origin ends on a letter, so there is no trailing run to re-consume — the
		// ", " must stay behind for the description, not get bolded into the header.
		expect(lift("Brass sphere, magical, Value 2 A heavy lump", "Brass sphere")).toBe("Brass sphere");
	});

	// The re-consume matches the origin's trailing punctuation by IDENTITY, not by count.
	// Counting lets an origin closing on one mark eat a different one out of the line —
	// which is the exact failure the "don't swallow the separator" rule above exists to stop.
	it("does not re-consume punctuation the origin does not actually own", () => {
		expect(lift("A map, fragile", "A map.")).toBe("A map");
		expect(lift("Crystal knife; hand, crude", "Crystal knife?")).toBe("Crystal knife");
	});

	it("takes back only as far as the origin and the line agree", () => {
		// Origin owns `(?)`; the line gives `(?` then diverges. Stop at the divergence
		// rather than counting three characters and dragging the "," in.
		expect(lift("A ring (?, magical", "A ring (?)")).toBe("A ring (?");
	});
});

describe("headName", () => {
	it("keeps a short name whole", () => {
		expect(headName("Brass sphere")).toBe("Brass sphere");
	});

	it("keeps a long-but-nameable phrase whole rather than cutting it", () => {
		const phrase = "A bronze blade from a metal construct’s limb, remade into a brutal axe";
		expect(headName(phrase)).toBe(phrase);
	});

	it("gives no header to an entry the book only describes at length", () => {
		const paragraph = "A coat of scale armor for someone 20 feet tall. The scales are strange, "
			+ "organic, semi-translucent and iridescent around the edges. Thick, twisting vines grow "
			+ "from the armor where a body should be; nothing else grows nearby.";
		expect(headName(paragraph)).toBeNull();
	});

	it("never returns a truncated fragment — a header is the whole origin or nothing", () => {
		for (const entry of TREASURE_CATALOG) {
			const head = headName(entry.origin);
			if (head !== null) expect(head).toBe(entry.origin);
		}
	});
});

describe("the catalog against the cell builder", () => {
	it("lifts every origin back out of its own text exactly", () => {
		// The origin is by definition the line's prefix, so lifting it out of itself must
		// round-trip for all 176 entries — including the ’ and … the book is full of.
		for (const entry of TREASURE_CATALOG) {
			expect(lift(entry.origin, entry.origin)).toBe(entry.origin);
		}
	});

	it("still names most treasures, and only falls back for a minority", () => {
		// Guards the NAME_MAX choice: if a re-extraction of the catalog shifted origins
		// long, cells would quietly lose their headers en masse.
		const named = TREASURE_CATALOG.filter(e => headName(e.origin) !== null).length;
		expect(named / TREASURE_CATALOG.length).toBeGreaterThan(0.7);
	});
});

describe("treasureItemData", () => {
	it("drags the item's FULL name, not the shortened cell header", () => {
		const entry = TREASURE_CATALOG.find(e => e.origin.length > 80);
		expect(headName(entry.origin)).toBeNull();          // header-less cell...
		expect(treasureItemData(entry).name).toBe(entry.name);  // ...still drags the real item
	});
});

// The book prints a write-up beside a notable treasure — what it looks like, the custom move it
// grants, the questions it adds — and for years the drop carried only the tags. It rides in
// `system.artifactLore` rather than `system.description` for two reasons, and both are load
// bearing: that is the field the gear row actually prints, and it is the one the p.430 identify
// ladder conceals, so a treasure the GM lands unidentified can't hand over its move with the
// picture. See module/actors/character/artifact-identify.js.
describe("a treasure's write-up", () => {
	const DAGGER = TREASURE_CATALOG.find(e => e.name === "An old bronze dagger");

	it("rides onto the item as artifactLore", () => {
		const data = treasureItemData(DAGGER);
		expect(data.system.artifactLore).toBe(DAGGER.writeup);
		expect(data.system.artifactLore).toContain("Tinged green, but sharp and sturdy.");
	});

	it("carries the WHOLE entry — the move, its questions and the GM's note, not just the flavour", () => {
		const lore = treasureItemData(DAGGER).system.artifactLore;
		expect(lore).toContain("When you Seek Insight about someone while carrying the dagger");
		expect(lore).toContain('<li class="question-bullet">What of mine do they most want?</li>');
		expect(lore).toContain("treat it as a threat (a MacGuffin; Instinct to cause paranoia)");
	});

	it("leaves the field off a treasure the book prints no prose for", () => {
		// 82 of the 168 are a name and its tags and nothing else. An empty artifactLore would
		// still satisfy `{{#if artifact.lore}}`-free markup badly; absent is the resting state.
		const bare = TREASURE_CATALOG.find(e => e.name === "A gold mobius strip on a chain");
		expect(bare.writeup).toBeUndefined();
		expect(treasureItemData(bare).system.artifactLore).toBeUndefined();
	});

	it("never lands the treasure pre-hidden", () => {
		// Whether a find starts unidentified is the DROP's call (addDroppedInventoryItem reads
		// the world's `hideArtifact` setting), not the catalog's. A state baked in here would
		// conceal every treasure in every world, including the GM's own sidebar copies.
		expect(treasureItemData(DAGGER).system.identifyState).toBeUndefined();
	});

	it("is renderable as-is by a template that does not enrich", () => {
		// inv-artifact.hbs prints `{{{artifact.lore}}}` raw, and `.stonetop-inv-artifact-lore`
		// is `white-space: pre-wrap`. So: no `@UUID[…]` links (they'd show as bracket noise)
		// and no newlines between tags (they'd render as blank lines down the gear column).
		for (const entry of TREASURE_CATALOG) {
			if (!entry.writeup) continue;
			expect(entry.writeup, entry.slug).not.toContain("@UUID[");
			expect(entry.writeup, entry.slug).not.toContain("\n");
			expect(entry.writeup, entry.slug).toMatch(/^<p>|^<ul>/);
		}
	});

	it("closes every tag it opens", () => {
		for (const entry of TREASURE_CATALOG) {
			if (!entry.writeup) continue;
			for (const tag of ["p", "ul", "li"]) {
				const open  = entry.writeup.match(new RegExp(`<${tag}[ >]`, "g"))?.length ?? 0;
				const close = entry.writeup.match(new RegExp(`</${tag}>`, "g"))?.length ?? 0;
				expect(close, `${entry.slug} <${tag}>`).toBe(open);
			}
			// A bullet only ever inside a list.
			expect(entry.writeup, entry.slug).not.toMatch(/<\/ul>\s*<li/);
		}
	});

	it("covers the treasures the book actually writes up", () => {
		// A floor, not an exact count: the guard is against a re-extraction quietly losing the
		// prose again (the 2019 pass shipped 0 of these), not against the book gaining an entry.
		const withProse = TREASURE_CATALOG.filter(e => e.writeup).length;
		expect(withProse).toBeGreaterThanOrEqual(86);
	});
});

// The book's illustration for a treasure lives in the GM's durable art folder. Which files
// exist — and where — is published to the world-scoped `treasureArt` index (slug -> path)
// by the Import Book Art macro / book2-art/reapply.js, because the drop payload is built
// synchronously in dragstart and a player can't browse the filesystem to check.
describe("treasure art", () => {
	const RED = TREASURE_CATALOG.find(e => e.name === "The Red Pennant");
	const RED_OUT = "assets/treasures/the-fae-the-red-pennant.webp";

	/** Stub just enough of game.settings for the guarded lookup. */
	const withSettings = (values, fn) => {
		const prev = globalThis.game;
		globalThis.game = values === null ? undefined : {
			settings: {
				settings: new Map(Object.keys(values).map(k => [`stonetop-pwd.${k}`, {}])),
				get: (ns, key) => values[key],
			},
		};
		try { return fn(); } finally { globalThis.game = prev; }
	};

	it("every catalog entry has a slug, and they are unique", () => {
		// The slug is the art file's name AND the treasure's identity in the manifest, so a
		// collision would silently make two treasures share one illustration.
		expect(TREASURE_CATALOG.every(e => typeof e.slug === "string" && e.slug.length > 0)).toBe(true);
		expect(new Set(TREASURE_CATALOG.map(e => e.slug)).size).toBe(TREASURE_CATALOG.length);
	});

	it("the slug is section-qualified, so same-named treasures stay distinct", () => {
		expect(RED.slug).toBe("the-fae-the-red-pennant");
	});

	it("points the item at the imported illustration", () => {
		const data = withSettings({ treasureArt: { [RED.slug]: RED_OUT }, book2ArtRoot: "stonetop-book-art" },
			() => treasureItemData(RED));
		expect(data.img).toBe("stonetop-book-art/assets/treasures/the-fae-the-red-pennant.webp");
	});

	it("resolves the path the INDEX carries, not one re-derived from the slug", () => {
		// The index publishes the manifest's own `out` path, so a row whose art moves (a
		// subfolder, a different extension) still points at the file the GM-side pass
		// actually found on disk.
		const data = withSettings({ treasureArt: { [RED.slug]: "assets/treasures/extra/renamed.png" } },
			() => treasureItemData(RED));
		expect(data.img).toBe("stonetop-book-art/assets/treasures/extra/renamed.png");
	});

	it("honours a custom art folder, trailing slash and all", () => {
		// A double slash wouldn't match what FilePicker.browse reports, so the root is
		// normalized on the way in.
		const data = withSettings({ treasureArt: { [RED.slug]: RED_OUT }, book2ArtRoot: "my art/" },
			() => treasureItemData(RED));
		expect(data.img).toBe("my art/assets/treasures/the-fae-the-red-pennant.webp");
	});

	it("carries no img when this world hasn't imported that treasure's art", () => {
		// Never point at a file that isn't there, and never invent one: an un-illustrated
		// treasure drags in with no img, so Foundry gives it its default document icon.
		const data = withSettings({ treasureArt: { "ustrina-brass-sphere": "assets/treasures/ustrina-brass-sphere.webp" }, book2ArtRoot: "stonetop-book-art" },
			() => treasureItemData(RED));
		expect(data.img).toBeUndefined();
	});

	it("works outside Foundry entirely (no game global)", () => {
		expect(withSettings(null, () => treasureItemData(RED)).img).toBeUndefined();
	});

	it("survives a world whose system never registered the index", () => {
		const prev = globalThis.game;
		globalThis.game = { settings: { settings: new Map(), get: () => { throw new Error("not registered"); } } };
		try {
			expect(treasureItemData(RED).img).toBeUndefined();
		} finally { globalThis.game = prev; }
	});
});

// Only the handful of Book II treasures the book actually illustrates carry art; the rest
// are text-only table rows and MUST drag in with no img at all, so Foundry gives them its
// default icon. We never fabricate a picture (that was the old load-class-icon fallback).
describe("treasure item art", () => {
	it("carries no img outside a world that has imported the illustration", () => {
		// treasureArtSrc reads a world-scoped setting absent in the unit-test environment, so
		// every entry resolves to no art here — and none may fall back to an invented icon.
		for (const entry of TREASURE_CATALOG) {
			expect(treasureItemData(entry).img).toBeUndefined();
		}
	});
});
