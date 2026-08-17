import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	isCropSlug, parentSlugOf, plannedCropRebuilds, plannedMonsterTokenRebuilds,
	splitSquaresBySource, artImageUrl,
} from "../../module/book2-art/rebuild-crops.js";
// The rect predicate the planner itself calls. rebuild-crops re-exported it under a second name
// until the three passes were folded into one runner; the alias had no caller left but this file,
// and a predicate reachable only from its tests is one a reader can change without changing
// anything.
import { isValidRect } from "../../module/book2-art/people-portraits.js";
import { ArtInventory } from "../../module/book2-art/browse.js";
import { BOOK2_ART_APPLY_MANIFEST } from "../../module/book2-art/manifest.js";

// Rebuilding a missing detail portrait out of the parent illustration already on disk, so a GM
// who imported before detail portraits existed does not have to find their PDFs again. These
// cover the pure planning half; the canvas/upload half needs a browser.

const ROOT = "stonetop-book-art";
const durable = (out) => `${ROOT}/${out}`;
const person = (slug, crop) => ({ slug, name: slug, out: `assets/people/${slug}.webp`, ...(crop ? { crop } : {}) });

// Everything that turns an art path into something a browser can fetch goes through this, because
// each caller can be handed either shape and getting it wrong is silent: the image simply never
// loads, and whatever was waiting on it does nothing at all.
describe("artImageUrl", () => {
	const route = globalThis.foundry?.utils?.getRoute;
	beforeEach(() => { globalThis.foundry.utils.getRoute = (p) => `/${p}`; });
	afterEach(() => { globalThis.foundry.utils.getRoute = route; });

	it("routes a data-relative path", () => {
		expect(artImageUrl(`${ROOT}/assets/people/x.webp`)).toBe(`/${ROOT}/assets/people/x.webp`);
	});

	it("strips leading slashes before routing, so the route is never doubled", () => {
		expect(artImageUrl(`/${ROOT}/assets/people/x.webp`)).toBe(`/${ROOT}/assets/people/x.webp`);
	});

	it("leaves an absolute URL alone", () => {
		// The Forge serves user files from its Assets Library, so every art path on a hosted world
		// is a full URL. Routing one yields "/https://…", which no browser can fetch.
		const forge = `https://assets.forge-vtt.com/abc123/${ROOT}/assets/maps/village.webp`;
		expect(artImageUrl(forge)).toBe(forge);
		expect(artImageUrl("data:image/webp;base64,AAAA")).toBe("data:image/webp;base64,AAAA");
		expect(artImageUrl("blob:https://example.com/1234")).toBe("blob:https://example.com/1234");
	});

	it("is empty for nothing, rather than routing an empty path", () => {
		for (const empty of ["", null, undefined]) expect(artImageUrl(empty)).toBe("");
	});
});

describe("crop slug parsing", () => {
	it("recognises a crop slug and recovers its parent", () => {
		expect(isCropSlug("b1-p042-x173-c665-098-757-840")).toBe(true);
		expect(parentSlugOf("b1-p042-x173-c665-098-757-840")).toBe("b1-p042-x173");
	});

	it("handles four-digit 1000 groups", () => {
		// per-mille of 1.0 is "1000", not "100" — a \d{3} pattern silently misses every rect
		// touching an edge, which is most of them
		const slug = "b1-p007-x32-c750-387-1000-1000";
		expect(isCropSlug(slug)).toBe(true);
		expect(parentSlugOf(slug)).toBe("b1-p007-x32");
	});

	it("leaves a whole-image slug alone", () => {
		expect(isCropSlug("b1-p156-x594")).toBe(false);
		expect(parentSlugOf("b1-p156-x594")).toBe("b1-p156-x594");
	});

	it("does not mistake other trailing digits for a crop", () => {
		expect(isCropSlug("b1-p007-x32")).toBe(false);
		expect(isCropSlug("b2-p154-x619")).toBe(false);
	});
});

describe("crop rect validation", () => {
	it("accepts a well-formed rect", () => {
		expect(isValidRect([0, 0.1, 0.5, 1])).toBe(true);
	});

	it("rejects malformed, inverted, zero-area and out-of-range rects", () => {
		expect(isValidRect(null)).toBe(false);
		expect(isValidRect([0, 0, 1])).toBe(false);
		expect(isValidRect([0.5, 0, 0.2, 1])).toBe(false);   // x1 <= x0
		expect(isValidRect([0.2, 0.4, 0.2, 0.9])).toBe(false); // zero width
		expect(isValidRect([-0.1, 0, 0.5, 1])).toBe(false);
		expect(isValidRect([0, 0, 1.2, 1])).toBe(false);
		expect(isValidRect(["a", 0, 1, 1])).toBe(false);
	});
});

describe("plannedCropRebuilds", () => {
	it("plans a crop whose file is missing but whose parent is present", () => {
		const people = [person("p1-c100-100-900-900", [0.1, 0.1, 0.9, 0.9])];
		const present = new Set([durable("assets/people/p1.webp")]);
		const plan = plannedCropRebuilds(present, ROOT, people);
		expect(plan).toHaveLength(1);
		expect(plan[0].parentSrc).toBe(durable("assets/people/p1.webp"));
		expect(plan[0].dest).toBe(durable("assets/people/p1-c100-100-900-900.webp"));
		expect(plan[0].crop).toEqual([0.1, 0.1, 0.9, 0.9]);
	});

	it("skips a crop that is already on disk", () => {
		const people = [person("p1-c100-100-900-900", [0.1, 0.1, 0.9, 0.9])];
		const present = new Set([
			durable("assets/people/p1.webp"),
			durable("assets/people/p1-c100-100-900-900.webp"),
		]);
		expect(plannedCropRebuilds(present, ROOT, people)).toHaveLength(0);
	});

	it("skips a crop whose parent was never imported", () => {
		const people = [person("p1-c100-100-900-900", [0.1, 0.1, 0.9, 0.9])];
		expect(plannedCropRebuilds(new Set(), ROOT, people)).toHaveLength(0);
	});

	it("ignores whole-image portraits — there is nothing to cut", () => {
		const people = [person("p1")];
		expect(plannedCropRebuilds(new Set(), ROOT, people)).toHaveLength(0);
	});

	it("skips a row carrying a malformed rect rather than planning a bad cut", () => {
		const people = [person("p1-c100-100-900-900", [0.9, 0.1, 0.1, 0.9])];
		const present = new Set([durable("assets/people/p1.webp")]);
		expect(plannedCropRebuilds(present, ROOT, people)).toHaveLength(0);
	});

	it("still plans when the parent is no longer a person row itself", () => {
		// the common upgrade shape: the parent group illustration was superseded by its crops
		// and dropped from the manifest, but its FILE is still sitting in the art folder
		const people = [person("p1-c100-100-900-900", [0.1, 0.1, 0.9, 0.9])];
		const present = new Set([durable("assets/people/p1.webp")]);
		expect(plannedCropRebuilds(present, ROOT, people)).toHaveLength(1);
	});

	it("plans nothing when nothing has been imported at all", () => {
		expect(plannedCropRebuilds(new Set(), ROOT)).toHaveLength(0);
	});

	it("honours a non-default art root", () => {
		const people = [person("p1-c100-100-900-900", [0.1, 0.1, 0.9, 0.9])];
		const present = new Set(["my-art/assets/people/p1.webp"]);
		const plan = plannedCropRebuilds(present, "my-art", people);
		expect(plan[0].dest).toBe("my-art/assets/people/p1-c100-100-900-900.webp");
	});
});

// A creature's token square: cut straight out of its illustration, with no slug arithmetic and no
// composition, because a monster row has no `crop` to narrow the coordinate space by. This is the
// whole upgrade path for a GM who imported before tokens existed.
describe("plannedMonsterTokenRebuilds", () => {
	const monster = (slug, token) => ({
		slug, name: slug, out: `assets/bestiary/${slug}.webp`,
		...(token ? { token, tokenOut: `assets/bestiary/${slug}-t100-100-900-900.webp` } : {}),
	});
	const RECT = [0.1, 0.1, 0.9, 0.9];

	it("plans a token whose file is missing but whose illustration is present", () => {
		const present = new Set([durable("assets/bestiary/crinwin.webp")]);
		const plan = plannedMonsterTokenRebuilds(present, ROOT, [monster("crinwin", RECT)]);
		expect(plan).toHaveLength(1);
		expect(plan[0].parentSrc).toBe(durable("assets/bestiary/crinwin.webp"));
		expect(plan[0].dest).toBe(durable("assets/bestiary/crinwin-t100-100-900-900.webp"));
		expect(plan[0].crop).toEqual(RECT);
		// `out` is the DESTINATION for the runner, which derives its upload directory from it —
		// assets/bestiary here, not the assets/people the people passes write to.
		expect(plan[0].out).toBe("assets/bestiary/crinwin-t100-100-900-900.webp");
	});

	it("skips a token that is already on disk", () => {
		const present = new Set([
			durable("assets/bestiary/crinwin.webp"),
			durable("assets/bestiary/crinwin-t100-100-900-900.webp"),
		]);
		expect(plannedMonsterTokenRebuilds(present, ROOT, [monster("crinwin", RECT)])).toHaveLength(0);
	});

	it("skips a token whose illustration was never imported", () => {
		// The ordinary state of a world that has not run the import at all. Planning it anyway
		// would fail once per creature against a file no browse ever reported.
		expect(plannedMonsterTokenRebuilds(new Set(), ROOT, [monster("crinwin", RECT)])).toHaveLength(0);
	});

	it("ignores a creature with no token framed — there is nothing to cut", () => {
		const present = new Set([durable("assets/bestiary/crinwin.webp")]);
		expect(plannedMonsterTokenRebuilds(present, ROOT, [monster("crinwin")])).toHaveLength(0);
	});

	it("skips a row carrying a malformed rect rather than planning a bad cut", () => {
		const present = new Set([durable("assets/bestiary/crinwin.webp")]);
		const bad = plannedMonsterTokenRebuilds(present, ROOT, [monster("crinwin", [0.9, 0.1, 0.1, 0.9])]);
		expect(bad).toHaveLength(0);
	});

	it("plans a token per creature when two share one illustration", () => {
		// The row's `out` is named for the ACTOR, so two creatures drawn in one picture already
		// hold two files and each frames its own square. Nothing here has to know they are the
		// same drawing.
		const present = new Set([
			durable("assets/bestiary/adventurer.webp"),
			durable("assets/bestiary/assassin.webp"),
		]);
		const plan = plannedMonsterTokenRebuilds(present, ROOT,
			[monster("adventurer", RECT), monster("assassin", RECT)]);
		expect(plan.map((p) => p.dest)).toEqual([
			durable("assets/bestiary/adventurer-t100-100-900-900.webp"),
			durable("assets/bestiary/assassin-t100-100-900-900.webp"),
		]);
	});

	it("plans nothing when nothing has been imported at all", () => {
		expect(plannedMonsterTokenRebuilds(new Set(), ROOT)).toHaveLength(0);
	});

	it("honours a non-default art root", () => {
		const present = new Set(["my-art/assets/bestiary/crinwin.webp"]);
		const plan = plannedMonsterTokenRebuilds(present, "my-art", [monster("crinwin", RECT)]);
		expect(plan[0].dest).toBe("my-art/assets/bestiary/crinwin-t100-100-900-900.webp");
	});

	it("plans a SHARED token file once, not once per creature pointing at it", () => {
		// Two creatures drawn in one picture who framed the same square are pointed at one file by
		// gen-pack-macro's duplicate-art collapse, because the extraction is identical. A plan is a
		// list of files to write: planning it twice would decode, encode and upload the same pixels
		// twice, and would make the rebuild offer print a number one higher than it delivers.
		const shared = "assets/bestiary/lithic-servant-t100-100-900-900.webp";
		const rows = [
			{ slug: "lithic-servant", name: "Lithic Servant", out: "assets/bestiary/lithic-servant.webp", token: RECT, tokenOut: shared },
			{ slug: "stone-sentinel", name: "Stone Sentinel", out: "assets/bestiary/lithic-servant.webp", token: RECT, tokenOut: shared },
		];
		const present = new Set([durable("assets/bestiary/lithic-servant.webp")]);
		const plan = plannedMonsterTokenRebuilds(present, ROOT, rows);
		expect(plan).toHaveLength(1);
		expect(plan[0].dest).toBe(durable(shared));
	});

	it("still plans both when peers share an illustration but framed DIFFERENT squares", () => {
		// The far commoner case, and the reason dedup is by destination rather than by source: two
		// creatures in one drawing usually want two different squares, and those are two files.
		const rows = [
			{ slug: "adventurer", name: "Adventurer", out: "assets/bestiary/adventurer.webp", token: RECT, tokenOut: "assets/bestiary/adventurer-t100-100-900-900.webp" },
			{ slug: "assassin", name: "Assassin", out: "assets/bestiary/adventurer.webp", token: [0.2, 0.2, 0.8, 0.8], tokenOut: "assets/bestiary/adventurer-t200-200-800-800.webp" },
		];
		const present = new Set([durable("assets/bestiary/adventurer.webp")]);
		expect(plannedMonsterTokenRebuilds(present, ROOT, rows)).toHaveLength(2);
	});

	it("reports zero when every token is already cut, which is what keeps the compendium pass off", () => {
		// runBookArtRebuild pays for the expensive compendium re-point ONLY when a run creates
		// creature squares. A plan that is empty because the work is already done must therefore
		// read as zero, or every people-only rebuild would drag the compendium along with it.
		const present = new Set([
			durable("assets/bestiary/crinwin.webp"),
			durable("assets/bestiary/crinwin-t100-100-900-900.webp"),
		]);
		expect(plannedMonsterTokenRebuilds(present, ROOT, [monster("crinwin", RECT)])).toHaveLength(0);
	});
});

// The square pass is planned against files the crop pass is only ASSUMED to have written, which
// is what keeps the announced total from growing halfway through the run. This is where that
// assumption gets settled.
describe("splitSquaresBySource", () => {
	const square = (slug, parentSrc) => ({ slug, parentSrc, dest: durable(`assets/people/${slug}-q0.webp`) });
	const detail = durable("assets/people/p1-c100-100-900-900.webp");
	const whole  = durable("assets/people/p2.webp");

	it("keeps every square when the crop pass wrote everything", () => {
		const squares = [square("a", detail), square("b", whole)];
		const { cuttable, orphaned } = splitSquaresBySource(squares, []);
		expect(cuttable).toHaveLength(2);
		expect(orphaned).toHaveLength(0);
	});

	it("holds back only the square whose source never arrived", () => {
		// One bad parent must cost one failure, not two: the square cut from a detail that could
		// not be written would fail again over the same file, and the console would name a path
		// no browse ever reported as present.
		const squares = [square("a", detail), square("b", whole)];
		const skips = [{ slug: "p1-c100-100-900-900", dest: detail, reason: "could not load" }];
		const { cuttable, orphaned } = splitSquaresBySource(squares, skips);
		expect(cuttable.map((s) => s.slug)).toEqual(["b"]);
		expect(orphaned.map((s) => s.slug)).toEqual(["a"]);
	});

	it("ignores a skip that carries no dest, rather than holding back everything", () => {
		// A skip record from an older shape, or one raised before the item was identified.
		const squares = [square("a", detail)];
		const { cuttable, orphaned } = splitSquaresBySource(squares, [{ slug: "?", reason: "boom" }]);
		expect(cuttable).toHaveLength(1);
		expect(orphaned).toHaveLength(0);
	});

	it("handles empty and missing inputs", () => {
		expect(splitSquaresBySource([], [])).toEqual({ cuttable: [], orphaned: [] });
		expect(splitSquaresBySource(null, null)).toEqual({ cuttable: [], orphaned: [] });
	});
});

describe("against the real shipped manifest", () => {
	const { people = [] } = BOOK2_ART_APPLY_MANIFEST;
	const crops = people.filter((p) => isCropSlug(p.slug));

	it("ships a crop rect for every detail portrait", () => {
		// rebuild-crops is the only consumer of `crop` in the shipped projection; if
		// gen-pack-macro ever stops emitting it, every rebuild silently plans nothing
		expect(crops.length).toBeGreaterThan(0);
		for (const c of crops) expect(isValidRect(c.crop)).toBe(true);
	});

	it("never carries a crop on a whole-image portrait", () => {
		for (const p of people.filter((x) => !isCropSlug(x.slug))) expect(p.crop).toBeUndefined();
	});

	it("rebuilds every detail from the whole-illustration set an older release shipped", () => {
		// the upgrade path this feature exists for: holding only the parents, a GM can recover
		// all of the details in one pass
		const parents = new Set(crops.map((c) => durable(`assets/people/${parentSlugOf(c.slug)}.webp`)));
		const plan = plannedCropRebuilds(parents, ROOT);
		expect(plan).toHaveLength(crops.length);
	});
});

// A plan carries both spellings of its source and they are not interchangeable: `parentKey` is
// the identity (what the browse was asked about, what a skip list is compared on) and `parentSrc`
// is what the runner actually fetches. Identical off a hosted setup; on The Forge the fetchable
// one is an Assets Library URL, and a run that fetched the identity would fail every single cut.
describe("a parent served from a host prefix", () => {
	const FORGE = "https://assets.forge-vtt.com/abc123/";

	function inventory(outs) {
		const inv = new ArtInventory(ROOT);
		for (const out of outs) inv.add(`${FORGE}${durable(out)}`);
		return inv;
	}

	it("fetches the parent from the host, but keeps the identity for comparison", () => {
		const people = [person("p1-c100-100-900-900", [0.1, 0.1, 0.9, 0.9])];
		const plan = plannedCropRebuilds(inventory(["assets/people/p1.webp"]), ROOT, people);
		expect(plan).toHaveLength(1);
		expect(plan[0].parentSrc).toBe(`${FORGE}${durable("assets/people/p1.webp")}`);
		expect(plan[0].parentKey).toBe(durable("assets/people/p1.webp"));
		// The DESTINATION stays canonical: it is an upload target, and a host maps that itself.
		expect(plan[0].dest).toBe(durable("assets/people/p1-c100-100-900-900.webp"));
	});

	it("still skips a detail the host already holds", () => {
		const people = [person("p1-c100-100-900-900", [0.1, 0.1, 0.9, 0.9])];
		const inv = inventory(["assets/people/p1.webp", "assets/people/p1-c100-100-900-900.webp"]);
		expect(plannedCropRebuilds(inv, ROOT, people)).toHaveLength(0);
	});

	it("holds back a square whose source never arrived, matching on the identity", () => {
		// The trap this guards: comparing a skip's canonical `dest` against a hosted `parentSrc`
		// matches nothing, so every orphan would go through and fail a second time over one file.
		const detailKey = durable("assets/people/p1-c100-100-900-900.webp");
		const squares = [{
			slug: "p1-c100-100-900-900", dest: durable("assets/people/p1-c100-100-900-900-q0.webp"),
			parentKey: detailKey, parentSrc: `${FORGE}${detailKey}`,
		}];
		const skips = [{ slug: "p1-c100-100-900-900", dest: detailKey, reason: "could not load" }];
		const { cuttable, orphaned } = splitSquaresBySource(squares, skips);
		expect(cuttable).toHaveLength(0);
		expect(orphaned).toHaveLength(1);
	});
});
