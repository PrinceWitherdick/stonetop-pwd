import { describe, it, expect } from "vitest";
import {
	artEmbed,
	bestiaryDescriptionWithArt,
	codexFieldWithArt,
	locationSectionsWithArt,
	mapFigureEmbed,
	textPageWithManagedMap,
	matchWorldPage,
} from "../../module/book2-art/world-journal-art.js";

// Pure helpers that decide how Book II art is embedded into journal pages, shared by the
// runtime re-apply (reapply.js) and mirrored inline by the import macro. These are the
// idempotency + matching guarantees the two callers rely on.

const SRC = "stonetop-book-art/assets/locations/the-flats-1.webp";
const SRC2 = "stonetop-book-art/assets/locations/the-flats-2.webp";

describe("artEmbed", () => {
	it("produces the canonical stonetop-journal-art markup", () => {
		expect(artEmbed(SRC, "The Flats")).toBe(
			`<p><img class="stonetop-journal-art" src="${SRC}" alt="The Flats"></p>`
		);
	});

	it("escapes the alt text", () => {
		expect(artEmbed(SRC, `A & B "x" <y>`)).toContain(`alt="A &amp; B &quot;x&quot; &lt;y>"`);
	});
});

describe("bestiaryDescriptionWithArt", () => {
	it("prepends the embed to the existing prose", () => {
		const out = bestiaryDescriptionWithArt("<p>prose</p>", SRC, "Crinwin");
		expect(out).toBe(`<p><img class="stonetop-journal-art" src="${SRC}" alt="Crinwin"></p><p>prose</p>`);
	});

	it("returns null when the src is already embedded (idempotent)", () => {
		const once = bestiaryDescriptionWithArt("<p>prose</p>", SRC, "Crinwin");
		expect(bestiaryDescriptionWithArt(once, SRC, "Crinwin")).toBeNull();
	});

	// "Already on the page" has to mean the same thing in both halves of this function. A page
	// can NAME the path without carrying the picture — a GM's note, a link href, an HTML comment
	// — and reading that as "already embedded" would block the art from ever being added, while
	// the retired half of the same call would correctly see no image there.
	it("adds the art to a page that only mentions the path in prose", () => {
		const mentions = `<p>art lives at ${SRC} if you want it</p>`;
		expect(bestiaryDescriptionWithArt(mentions, SRC, "Crinwin"))
			.toBe(`<p><img class="stonetop-journal-art" src="${SRC}" alt="Crinwin"></p>${mentions}`);
	});

	it("adds the art to a page that links the path without showing it", () => {
		const linked = `<p><a href="${SRC}">the picture</a></p>`;
		expect(bestiaryDescriptionWithArt(linked, SRC, "Crinwin")).toContain("<img");
	});

	it("treats a null/undefined description as empty", () => {
		expect(bestiaryDescriptionWithArt(null, SRC, "Crinwin")).toBe(
			`<p><img class="stonetop-journal-art" src="${SRC}" alt="Crinwin"></p>`
		);
		expect(bestiaryDescriptionWithArt(undefined, SRC, "Crinwin")).toContain(SRC);
	});

	// Retired art. Two creatures the book draws in ONE picture now share the one file, so the
	// page a prior manifest gave the other filename has to lose that embed — otherwise the
	// same illustration ends up on it twice, which is the bug this whole pass exists to undo.
	describe("retired art", () => {
		it("strips the retired embed and places the shared one", () => {
			const stale = bestiaryDescriptionWithArt("<p>prose</p>", SRC2, "Assassin");
			const out = bestiaryDescriptionWithArt(stale, SRC, "Assassin", [SRC2]);
			expect(out).toBe(`<p><img class="stonetop-journal-art" src="${SRC}" alt="Assassin"></p><p>prose</p>`);
		});

		it("strips the retired embed even when the shared art is already there", () => {
			const both = `<p><img class="stonetop-journal-art" src="${SRC}" alt="A"></p>`
				+ `<p><img class="stonetop-journal-art" src="${SRC2}" alt="A"></p><p>prose</p>`;
			expect(bestiaryDescriptionWithArt(both, SRC, "A", [SRC2]))
				.toBe(`<p><img class="stonetop-journal-art" src="${SRC}" alt="A"></p><p>prose</p>`);
		});

		it("stays null once there is nothing left to retire", () => {
			// The every-load self-heal runs this on every page; a non-null return is a write.
			const done = bestiaryDescriptionWithArt("<p>prose</p>", SRC, "A");
			expect(bestiaryDescriptionWithArt(done, SRC, "A", [SRC2])).toBeNull();
		});

		it("never retires the src it is placing", () => {
			// The shared file IS both rows' art; retiring it would strip the picture each load.
			const done = bestiaryDescriptionWithArt("<p>prose</p>", SRC, "A");
			expect(bestiaryDescriptionWithArt(done, SRC, "A", [SRC])).toBeNull();
		});

		it("matches on the quoted src, so one path is never a prefix of another", () => {
			const longer = `${SRC}`.replace(".webp", "-young.webp");
			const kept = bestiaryDescriptionWithArt("<p>prose</p>", longer, "Young");
			expect(bestiaryDescriptionWithArt(kept, longer, "Young", [SRC])).toBeNull();
		});
	});

	// A null src means "this row's picture is not on disk": there is nothing to place, but an
	// embed a previous import left behind now renders as a broken image and has to come off.
	describe("strip-only (the art is gone from disk)", () => {
		it("removes the embed and places nothing", () => {
			const embedded = bestiaryDescriptionWithArt("<p>prose</p>", SRC, "Antiquarian");
			expect(bestiaryDescriptionWithArt(embedded, null, "Antiquarian", [SRC])).toBe("<p>prose</p>");
		});

		it("returns null when the page never had it", () => {
			// The every-load self-heal runs this over every page; a non-null return is a write.
			expect(bestiaryDescriptionWithArt("<p>prose</p>", null, "Antiquarian", [SRC])).toBeNull();
		});

		it("never inserts the name it was handed", () => {
			// The caller still passes a name; strip-only must not turn it into an embed with no src.
			const out = bestiaryDescriptionWithArt(`<p>x</p>`, null, "Antiquarian", [SRC]);
			expect(out).toBeNull();
			const embedded = bestiaryDescriptionWithArt("<p>x</p>", SRC, "Antiquarian");
			expect(bestiaryDescriptionWithArt(embedded, null, "Antiquarian", [SRC])).not.toContain("<img");
		});

		it("leaves art that is not this row's alone", () => {
			const other = bestiaryDescriptionWithArt("<p>prose</p>", SRC2, "Someone else");
			expect(bestiaryDescriptionWithArt(other, null, "Antiquarian", [SRC])).toBeNull();
		});

		it("strips several gone paths at once", () => {
			let body = bestiaryDescriptionWithArt("<p>prose</p>", SRC, "A");
			body = bestiaryDescriptionWithArt(body, SRC2, "A");
			expect(bestiaryDescriptionWithArt(body, null, "A", [SRC, SRC2])).toBe("<p>prose</p>");
		});
	});
});

describe("codexFieldWithArt", () => {
	// The two illustrations that share the Crinwin codex page (entry Ttz6Fnr2M0HNfIre):
	// two separate ACTORS, one page, which is why its art stacks today.
	const CRIN = "stonetop-book-art/assets/bestiary/crinwin.webp";
	const BROOD = "stonetop-book-art/assets/bestiary/crinwin-broodfather.webp";
	const PROSE = "<p>Trust not thine ears</p>";
	const NESTS = "<p>They nest in the high branches.</p>";
	const curation = (slots) => ({ managed: [CRIN, BROOD], slots });
	const img = (src, name) => `<p><img class="stonetop-journal-art" src="${src}" alt="${name}"></p>`;

	it("puts a banner slot at position 0 of description, where lead-art lifts it", () => {
		const out = codexFieldWithArt(PROSE, "description",
			curation([{ slot: "banner", images: [{ src: CRIN, name: "Crinwin" }] }]));
		expect(out).toBe(img(CRIN, "Crinwin") + PROSE);
		expect(out.startsWith("<p><img")).toBe(true);
	});

	it("appends a description slot after the prose, and a nests slot after the nests prose", () => {
		expect(codexFieldWithArt(PROSE, "description",
			curation([{ slot: "description", images: [{ src: CRIN, name: "Crinwin" }] }])))
			.toBe(PROSE + img(CRIN, "Crinwin"));
		expect(codexFieldWithArt(NESTS, "nests",
			curation([{ slot: "nests", images: [{ src: BROOD, name: "Crinwin Broodfather" }] }])))
			.toBe(NESTS + img(BROOD, "Crinwin Broodfather"));
	});

	it("strips a managed src that no slot claims — this is what 'hide' means", () => {
		const stacked = img(BROOD, "Crinwin Broodfather") + img(CRIN, "Crinwin") + PROSE;
		const out = codexFieldWithArt(stacked, "description",
			curation([{ slot: "banner", images: [{ src: CRIN, name: "Crinwin" }] }]));
		expect(out).toBe(img(CRIN, "Crinwin") + PROSE);
		expect(out).not.toContain(BROOD);
	});

	it("returns null when the field already matches (no-op contract)", () => {
		const slots = [{ slot: "banner", images: [{ src: CRIN, name: "Crinwin" }] }];
		const once = codexFieldWithArt(PROSE, "description", curation(slots));
		expect(codexFieldWithArt(once, "description", curation(slots))).toBeNull();
	});

	it("recognises and strips a ProseMirror-normalised <img> (attrs reordered, class dropped)", () => {
		// What a GM's re-save leaves behind: no class, attributes in another order. A
		// wrapper-shaped regex stops seeing this and duplicates the art; we key on src.
		const normalised = `<p><img alt="Crinwin Broodfather" src="${BROOD}" width="400"></p>${PROSE}`;
		const out = codexFieldWithArt(normalised, "description",
			curation([{ slot: "banner", images: [{ src: CRIN, name: "Crinwin" }] }]));
		expect(out).toBe(img(CRIN, "Crinwin") + PROSE);
		expect(out).not.toContain(BROOD);
	});

	it("strips everything when slots is empty", () => {
		const stacked = img(CRIN, "Crinwin") + PROSE;
		expect(codexFieldWithArt(stacked, "description", curation([]))).toBe(PROSE);
	});

	it("relocates one image between fields and normalises the legacy reversed order", () => {
		// Today the monster loop prepends per row, so the page carries the broodfather
		// FIRST — the reverse of manifest order. Curating re-lands both in row order.
		const legacy = img(BROOD, "Crinwin Broodfather") + img(CRIN, "Crinwin") + PROSE;
		const slots = [
			{ slot: "banner", images: [{ src: CRIN, name: "Crinwin" }] },
			{ slot: "nests", images: [{ src: BROOD, name: "Crinwin Broodfather" }] },
		];
		expect(codexFieldWithArt(legacy, "description", curation(slots))).toBe(img(CRIN, "Crinwin") + PROSE);
		expect(codexFieldWithArt(NESTS, "nests", curation(slots))).toBe(NESTS + img(BROOD, "Crinwin Broodfather"));
	});

	it("only inserts the images the caller passed, so an absent file is never embedded", () => {
		// reapply filters slots to what is on disk; managed stays complete so a missing
		// file can still be stripped from a page that already carries it.
		const out = codexFieldWithArt(img(BROOD, "Crinwin Broodfather") + PROSE, "description",
			{ managed: [CRIN, BROOD], slots: [{ slot: "banner", images: [] }] });
		expect(out).toBe(PROSE);
	});

	it("ignores a field it does not host art for", () => {
		expect(codexFieldWithArt("<p>notes</p>", "notes",
			curation([{ slot: "banner", images: [{ src: CRIN, name: "Crinwin" }] }]))).toBeNull();
	});
});

describe("locationSectionsWithArt", () => {
	const baseSections = () => [
		{ kind: "prose", heading: "At a Glance", body: "<p>glance</p>" },
		{ kind: "prose", heading: "The Place", body: "<p>place prose</p>" },
	];

	it("inserts the art into the target section body and preserves other fields", () => {
		const sections = baseSections();
		const out = locationSectionsWithArt(sections, 1, [SRC], "The Flats");
		expect(out).not.toBeNull();
		expect(out[1].body).toBe(
			`<p><img class="stonetop-journal-art" src="${SRC}" alt="The Flats"></p><p>place prose</p>`
		);
		expect(out[1].kind).toBe("prose");
		expect(out[1].heading).toBe("The Place");
		// untouched section left as-is
		expect(out[0].body).toBe("<p>glance</p>");
	});

	it("does not mutate the input array or section objects", () => {
		const sections = baseSections();
		const snapshot = JSON.stringify(sections);
		locationSectionsWithArt(sections, 1, [SRC], "The Flats");
		expect(JSON.stringify(sections)).toBe(snapshot);
	});

	it("returns null when every src is already present (idempotent)", () => {
		const sections = baseSections();
		const once = locationSectionsWithArt(sections, 1, [SRC], "The Flats");
		expect(locationSectionsWithArt(once, 1, [SRC], "The Flats")).toBeNull();
	});

	it("appends a late src after the last existing embed, keeping book order", () => {
		const sections = baseSections();
		const first = locationSectionsWithArt(sections, 1, [SRC], "The Flats");
		const second = locationSectionsWithArt(first, 1, [SRC, SRC2], "The Flats");
		expect(second).not.toBeNull();
		const body = second[1].body;
		// order: SRC embed, then SRC2 embed, then the prose
		expect(body.indexOf(SRC)).toBeLessThan(body.indexOf(SRC2));
		expect(body.indexOf(SRC2)).toBeLessThan(body.indexOf("<p>place prose</p>"));
	});

	it("falls back to the first section (top) when the target index is gone", () => {
		// The manifest's target section was deleted, so index 9 no longer exists: the
		// art lands at the top of the page rather than being silently dropped.
		const out = locationSectionsWithArt(baseSections(), 9, [SRC], "x");
		expect(out).not.toBeNull();
		expect(out[0].body).toBe(`${artEmbed(SRC, "x")}<p>glance</p>`);
		expect(out[1].body).toBe("<p>place prose</p>"); // other sections untouched
	});

	it("synthesises a top prose section when the page has no sections at all", () => {
		for (const empty of [[], null, undefined]) {
			const out = locationSectionsWithArt(empty, 0, [SRC], "The Flats");
			expect(out).not.toBeNull();
			expect(out).toHaveLength(1);
			expect(out[0]).toMatchObject({ kind: "prose", heading: "", group: "glance", danger: false, pairs: [], groups: [] });
			expect(out[0].body).toBe(artEmbed(SRC, "The Flats"));
		}
	});

	it("is idempotent after the synthesised fallback (no second copy on re-apply)", () => {
		const once = locationSectionsWithArt([], 0, [SRC], "The Flats");
		expect(locationSectionsWithArt(once, 0, [SRC], "The Flats")).toBeNull();
	});

	it("relocates art to the manifest's target section (manifest is authoritative)", () => {
		// The illustration sits in section 1, but the manifest now assigns it to section 0:
		// authoritative placement MOVES it (strips it from 1, inserts at 0) rather than
		// leaving it where it was. This is what makes the picker's re-section actually apply.
		const moved = [
			{ kind: "prose", heading: "At a Glance", body: "<p>glance</p>" },
			{ kind: "prose", heading: "The Place", body: `<p>place</p>${artEmbed(SRC, "x")}` },
		];
		const out = locationSectionsWithArt(moved, 0, [SRC], "x");
		expect(out).not.toBeNull();
		expect(out[0].body).toBe(`${artEmbed(SRC, "x")}<p>glance</p>`); // moved to target
		expect(out[1].body).toBe("<p>place</p>");                       // stripped from where it was
	});

	it("relocates only its own row's images out of a pile, leaving the others put", () => {
		// The Forge Lords case: three images were all piled at section 0; the manifest now
		// assigns img2 + img3 to section 2. Applying the section-2 row moves only those two,
		// leaving img1 at section 0 (its own row is a separate no-op call).
		const SRC3 = "stonetop-book-art/assets/locations/the-flats-3.webp";
		const piled = [
			{ kind: "prose", heading: "Overview", body: `<p>o</p>${artEmbed(SRC, "x")}${artEmbed(SRC2, "x")}${artEmbed(SRC3, "x")}` },
			{ kind: "prose", heading: "A", body: "<p>a</p>" },
			{ kind: "prose", heading: "Sites", body: "<p>sites</p>" },
		];
		const out = locationSectionsWithArt(piled, 2, [SRC2, SRC3], "x");
		expect(out).not.toBeNull();
		expect(out[0].body).toBe(`<p>o</p>${artEmbed(SRC, "x")}`);                        // img1 stays
		expect(out[2].body).toBe(`${artEmbed(SRC2, "x")}${artEmbed(SRC3, "x")}<p>sites</p>`); // img2+3 land here, in order
		expect(out[1].body).toBe("<p>a</p>");                                              // untouched
	});

	it("treats a ProseMirror-normalized embed as already present (no duplicate on re-apply)", () => {
		// After a GM opens a location page and saves, ProseMirror re-serializes each <img>
		// (attribute order changed, our class sometimes dropped). Detection keys on the src,
		// not the exact wrapper, so the re-apply must NOT insert a second copy of the image.
		for (const normalizedImg of [
			`<img src="${SRC}" class="stonetop-journal-art" alt="x">`, // class after src
			`<img src="${SRC}" alt="x">`,                              // class dropped entirely
		]) {
			const sections = [
				{ kind: "prose", heading: "Overview", body: "<p>o</p>" },
				{ kind: "prose", heading: "Sites", body: `<p>${normalizedImg}</p><p>sites</p>` },
			];
			expect(locationSectionsWithArt(sections, 1, [SRC], "x")).toBeNull();
		}
	});

	it("relocates a normalized embed, stripping the old copy so no duplicate survives", () => {
		// The art was placed in section 1, then a GM edit normalized its markup (src before
		// class). The manifest assigns it to section 0: it must MOVE there, leaving no stray
		// copy and no empty paragraph where it was.
		const normalized = [
			{ kind: "prose", heading: "At a Glance", body: "<p>glance</p>" },
			{ kind: "prose", heading: "The Place", body: `<p>place</p><p><img src="${SRC}" class="stonetop-journal-art" alt="x"></p>` },
		];
		const out = locationSectionsWithArt(normalized, 0, [SRC], "x");
		expect(out).not.toBeNull();
		expect(out[0].body).toBe(`${artEmbed(SRC, "x")}<p>glance</p>`); // canonical embed at the target
		expect(out[1].body).toBe("<p>place</p>");                       // normalized copy stripped, no empty <p>
		// exactly one occurrence of the src remains across the whole page
		const escaped = SRC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const occurrences = out.map(s => s.body).join("").match(new RegExp(`src="${escaped}"`, "g")) ?? [];
		expect(occurrences).toHaveLength(1);
	});

	it("is a no-op once every image already sits in its assigned section", () => {
		const placed = [
			{ kind: "prose", heading: "Overview", body: "<p>o</p>" },
			{ kind: "prose", heading: "Sites", body: `${artEmbed(SRC, "x")}<p>sites</p>` },
		];
		expect(locationSectionsWithArt(placed, 1, [SRC], "x")).toBeNull();
	});

	it("skips a falsy section hole when falling back rather than throwing", () => {
		// A malformed page (a null where a section should be) must degrade gracefully:
		// place at the first REAL section, never dereference the hole.
		const out = locationSectionsWithArt([null, { kind: "prose", heading: "The Place", body: "<p>place</p>" }], 0, [SRC], "x");
		expect(out).not.toBeNull();
		expect(out[0]).toBeNull();                                    // hole preserved untouched
		expect(out[1].body).toBe(`${artEmbed(SRC, "x")}<p>place</p>`); // art at the first real section
	});

	it("defaults to section 0 when no index is given", () => {
		const out = locationSectionsWithArt(baseSections(), undefined, [SRC], "x");
		expect(out[0].body).toContain(SRC);
	});

	// `retired`: art a prior manifest embedded that we no longer name (the Forge Lords
	// duplicate-extraction case). It must be stripped from already-imported worlds and never
	// re-placed, while the still-wanted image is kept.
	it("strips a retired src from the target section and keeps the wanted one", () => {
		// The world page carries BOTH the wanted image and the retired duplicate in section 1.
		const dup = [
			{ kind: "prose", heading: "At a Glance", body: "<p>glance</p>" },
			{ kind: "prose", heading: "The Place", body: `${artEmbed(SRC, "x")}${artEmbed(SRC2, "x")}<p>place</p>` },
		];
		const out = locationSectionsWithArt(dup, 1, [SRC], "x", [SRC2]);
		expect(out).not.toBeNull();
		expect(out[1].body).toContain(SRC);       // wanted image kept
		expect(out[1].body).not.toContain(SRC2);  // retired duplicate gone
	});

	it("strips a retired src no matter which section it lingers in", () => {
		const dup = [
			{ kind: "prose", heading: "At a Glance", body: `<p>glance</p>${artEmbed(SRC2, "x")}` },
			{ kind: "prose", heading: "The Place", body: `${artEmbed(SRC, "x")}<p>place</p>` },
		];
		const out = locationSectionsWithArt(dup, 1, [SRC], "x", [SRC2]);
		expect(out).not.toBeNull();
		expect(out[0].body).not.toContain(SRC2); // retired stripped from section 0 too
		expect(out[1].body).toContain(SRC);
	});

	it("is a no-op once the retired src is already gone", () => {
		const clean = [
			{ kind: "prose", heading: "At a Glance", body: "<p>glance</p>" },
			{ kind: "prose", heading: "The Place", body: `${artEmbed(SRC, "x")}<p>place</p>` },
		];
		expect(locationSectionsWithArt(clean, 1, [SRC], "x", [SRC2])).toBeNull();
	});

	it("never re-inserts a retired src, and a still-wanted path is not treated as retired", () => {
		// A retired src passed that is ALSO wanted stays (a path reused for a kept image is safe).
		const sections = baseSections();
		const out = locationSectionsWithArt(sections, 1, [SRC], "x", [SRC]);
		expect(out).not.toBeNull();
		expect(out[1].body).toContain(SRC); // kept because it is wanted, not stripped as retired
	});
});

describe("mapFigureEmbed", () => {
	const MAP = "stonetop-book-art/assets/maps/map-vicinity.webp";

	it("produces the captioned figure markup with the stonetop-map class", () => {
		expect(mapFigureEmbed(MAP, "The Vicinity")).toBe(
			`<figure class="stonetop-map"><img src="${MAP}" alt="The Vicinity"></figure>`
		);
	});

	it("escapes the alt text", () => {
		expect(mapFigureEmbed(MAP, `A & B "x" <y>`)).toContain(`alt="A &amp; B &quot;x&quot; &lt;y>"`);
	});
});

describe("textPageWithManagedMap", () => {
	const ROOT = "stonetop-book-art";
	const NEW = `${ROOT}/assets/maps/book2-vicinity.webp`;   // the printed Book II page crop
	const OLD = `${ROOT}/assets/maps/map-vicinity.webp`;     // the poster map it supersedes
	const figure = (src, alt) => `<figure class="stonetop-map"><img src="${src}" alt="${alt}"></figure>`;

	// With no replaceSrcs this is the plain "prepend, never stack" primitive.
	it("prepends the map figure to the top of the page content", () => {
		expect(textPageWithManagedMap("<p>setting prose</p>", NEW, "The Vicinity", [])).toBe(
			`${figure(NEW, "The Vicinity")}<p>setting prose</p>`
		);
	});

	it("treats a null/undefined content as empty", () => {
		expect(textPageWithManagedMap(null, NEW, "The Vicinity", [])).toBe(figure(NEW, "The Vicinity"));
		expect(textPageWithManagedMap(undefined, NEW, "The Vicinity", [])).toContain(NEW);
	});

	it("defaults replaceSrcs to empty", () => {
		expect(textPageWithManagedMap("<p>prose</p>", NEW, "The Vicinity")).toBe(
			`${figure(NEW, "The Vicinity")}<p>prose</p>`
		);
	});

	it("returns null when this exact map src is already embedded (idempotent)", () => {
		const once = textPageWithManagedMap("<p>prose</p>", NEW, "The Vicinity", [OLD]);
		expect(textPageWithManagedMap(once, NEW, "The Vicinity", [OLD])).toBeNull();
	});

	// The whole point of replaceSrcs: a world that imported the poster map under an earlier
	// release must still receive the labelled Book II map. Without it the old figure trips the
	// "never stack a second map" rule below and the upgrade is skipped forever.
	it("replaces a map we previously wrote, in place, keeping the prose", () => {
		const out = textPageWithManagedMap(`${figure(OLD, "The Vicinity")}<p>prose</p>`, NEW, "The Vicinity", [OLD]);
		expect(out).toContain(NEW);
		expect(out).not.toContain(OLD);
		expect(out).toContain("<p>prose</p>");
		expect(out.match(/class="stonetop-map"/g)).toHaveLength(1); // exactly one map, not stacked
	});

	it("still replaces ours after ProseMirror has rewritten the markup", () => {
		// A GM who opens + saves the page gets the figure normalised: attributes reordered,
		// our class dropped, sometimes unwrapped to a bare paragraph. Keyed on src, so it holds.
		for (const mangled of [
			`<figure><img alt="The Vicinity" src="${OLD}" width="900"></figure><p>prose</p>`,
			`<p><img src="${OLD}"></p><p>prose</p>`,
			`<img src="${OLD}"><p>prose</p>`,
		]) {
			const out = textPageWithManagedMap(mangled, NEW, "The Vicinity", [OLD]);
			expect(out).toContain(NEW);
			expect(out).not.toContain(OLD);
			expect(out).toContain("<p>prose</p>");
		}
	});

	it("preserves a map figure we do NOT own, and does not embed over it", () => {
		// the GM contract is unchanged for everything except the exact files we put there
		const mine = `${figure("worlds/mine/my-map.png", "mine")}<p>prose</p>`;
		expect(textPageWithManagedMap(mine, NEW, "The Vicinity", [OLD])).toBeNull();
	});

	it("leaves a second, unrelated map figure alone while replacing ours", () => {
		const both = `${figure(OLD, "The Vicinity")}<p>prose</p>`;
		const out = textPageWithManagedMap(both, NEW, "The Vicinity", [OLD, `${ROOT}/assets/maps/map-worlds-end.webp`]);
		expect(out).toContain(NEW);
		expect(out).toContain("<p>prose</p>");
	});

	it("embeds normally when a replaces entry matches nothing", () => {
		const out = textPageWithManagedMap("<p>prose</p>", NEW, "The Vicinity", [OLD]);
		expect(out).toBe(`${figure(NEW, "The Vicinity")}<p>prose</p>`);
	});

	// A page can end up holding BOTH: a pass that threw between the compendium write and the
	// world write, a GM who pasted the old map back, a world re-seeded from a page that already
	// had the crop. An "already ours" fast path ahead of the strip returns null here — on the one
	// page that most needs work — and because it fires on every future pass too, the two stay
	// stacked forever. The no-op has to be decided by the rebuild, not by a substring check.
	it("strips the superseded map from a page that carries BOTH it and ours", () => {
		const both = `${figure(NEW, "The Vicinity")}${figure(OLD, "The Vicinity")}<p>prose</p>`;
		const out = textPageWithManagedMap(both, NEW, "The Vicinity", [OLD]);
		expect(out).not.toBeNull();
		expect(out).toContain(NEW);
		expect(out).not.toContain(OLD);
		expect(out).toContain("<p>prose</p>");
		expect(out.match(/class="stonetop-map"/g)).toHaveLength(1);
	});

	it("settles: the both-maps repair is itself idempotent", () => {
		const both = `${figure(NEW, "The Vicinity")}${figure(OLD, "The Vicinity")}<p>prose</p>`;
		const once = textPageWithManagedMap(both, NEW, "The Vicinity", [OLD]);
		expect(textPageWithManagedMap(once, NEW, "The Vicinity", [OLD])).toBeNull();
	});

	// The GM's own map still wins, but ours must not be left stacked underneath it.
	it("strips our superseded map even when a map we don't own is present", () => {
		const mixed = `${figure("worlds/mine/my-map.png", "mine")}${figure(OLD, "The Vicinity")}<p>prose</p>`;
		const out = textPageWithManagedMap(mixed, NEW, "The Vicinity", [OLD]);
		expect(out).not.toBeNull();
		expect(out).not.toContain(OLD);
		expect(out).not.toContain(NEW);          // theirs is there: we don't embed over it
		expect(out).toContain("my-map.png");
	});

	it("never strips itself when its own out path is listed in replaces", () => {
		const out = textPageWithManagedMap("<p>prose</p>", NEW, "The Vicinity", [NEW, OLD]);
		expect(out).toContain(NEW);
	});
});

describe("matchWorldPage", () => {
	const pages = [
		{ id: "aaa", name: "Alpha", type: "location", system: {} },
		{ id: "bbb", name: "Beta", type: "bestiary", system: {} },
	];

	it("matches by id first", () => {
		expect(matchWorldPage(pages, "bbb", "WRONG", "location")).toBe(pages[1]);
	});

	it("falls back to name + type when the id does not match", () => {
		expect(matchWorldPage(pages, "no-such-id", "Alpha", "location")).toBe(pages[0]);
	});

	it("requires both name AND type to match on the fallback", () => {
		expect(matchWorldPage(pages, "no-such-id", "Alpha", "bestiary")).toBeNull();
	});

	it("returns null when nothing matches", () => {
		expect(matchWorldPage(pages, "zzz", "Gamma", "location")).toBeNull();
	});

	it("accepts a Foundry-style collection exposing .contents", () => {
		const collection = { contents: pages };
		expect(matchWorldPage(collection, "aaa")).toBe(pages[0]);
	});

	it("tolerates null/undefined page lists", () => {
		expect(matchWorldPage(null, "aaa")).toBeNull();
		expect(matchWorldPage(undefined, "aaa")).toBeNull();
	});
});
