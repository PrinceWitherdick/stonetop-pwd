import { describe, it, expect } from "vitest";
import { PostDeathInsertSnapshotBuilder } from "../../module/model/PostDeathInsertSnapshot.js";
import { LoreOptionSnapshotBuilder, LoreEntrySnapshotBuilder, LoreSection } from "../../module/model/PlaybookSnapshot.js";
import { InstinctSection, InstinctOptionSnapshotBuilder } from "../../module/model/PlaybookSnapshot.js";

// -- Fixtures -----------------------------------------------------------------

const INSTINCT_SECTION = new InstinctSection(
	"denial",
	[
		new InstinctOptionSnapshotBuilder().withWord("Denial").withDescription("To refuse to accept that you are dead.").withValue("denial").withSelected(true).build(),
		new InstinctOptionSnapshotBuilder().withWord("Obsession").withDescription("To pursue your Terrible Purpose no matter what.").withValue("obsession").withSelected(false).build(),
	]
);

const CONSEQUENCE_OPTION_BREAKDOWN = new LoreOptionSnapshotBuilder()
	.withSlug("breakdown")
	.withDescription("<p>You lash out...</p>")
	.withMax(1)
	.withCount(1)
	.withRequires(null)
	.build();

const CONSEQUENCE_OPTION_UNSTABLE = new LoreOptionSnapshotBuilder()
	.withSlug("unstable")
	.withDescription("<p>You are prone...</p>")
	.withMax(1)
	.withCount(0)
	.withRequires("breakdown")
	.build();

const CONSEQUENCES_ENTRY = new LoreEntrySnapshotBuilder()
	.withSlug("consequences")
	.withTitle("Consequences")
	.withDescription("<p>Choose 1...</p>")
	.withOptions([CONSEQUENCE_OPTION_BREAKDOWN, CONSEQUENCE_OPTION_UNSTABLE])
	.build();

const LORE_SECTION = new LoreSection([CONSEQUENCES_ENTRY]);

const buildSnapshot = () =>
	new PostDeathInsertSnapshotBuilder()
		.withSlug("revenant")
		.withName("Revenant")
		.withImg("icons/svg/skull.svg")
		.withDescription("<p>When you die...</p>")
		.withInstinct(INSTINCT_SECTION)
		.withMoves([])
		.withLore(LORE_SECTION)
		.build();

// -- Tests --------------------------------------------------------------------

describe("PostDeathInsertSnapshot", () => {
	it("stores slug, name, img, description", () => {
		const snap = buildSnapshot();
		expect(snap.slug).toBe("revenant");
		expect(snap.name).toBe("Revenant");
		expect(snap.img).toBe("icons/svg/skull.svg");
		expect(snap.description).toBe("<p>When you die...</p>");
	});

	it("stores instinct section", () => {
		expect(buildSnapshot().instinct).toBe(INSTINCT_SECTION);
	});

	it("stores moves array", () => {
		expect(buildSnapshot().moves).toEqual([]);
	});

	it("stores lore section", () => {
		expect(buildSnapshot().lore).toBe(LORE_SECTION);
	});
});

describe("LoreOptionSnapshot.requires", () => {
	it("stores requires when set", () => {
		expect(CONSEQUENCE_OPTION_UNSTABLE.requires).toBe("breakdown");
	});

	it("defaults requires to null when not set", () => {
		expect(CONSEQUENCE_OPTION_BREAKDOWN.requires).toBeNull();
	});

	it("defaults requires to null when builder omits withRequires", () => {
		const opt = new LoreOptionSnapshotBuilder()
			.withSlug("quarry")
			.withDescription("<p>The Pale Hunter...</p>")
			.withMax(1)
			.withCount(0)
			.build();
		expect(opt.requires).toBeNull();
	});
});

// What a player writes into one of these is a proper noun, and the sheet sets it in the display
// face rather than in the italic hand the prose answers take.
describe("LoreOptionSnapshot.isName", () => {
	const textOption = (slug) => new LoreOptionSnapshotBuilder()
		.withSlug(slug).withDescription("<p>Name it.</p>").withType("text").withTextValue("Cthuhlu").build();

	it("is true for the Thrall's master", () => {
		expect(textOption("master-name").isName).toBe(true);
	});

	it("is true for a bare 'name' option", () => {
		expect(textOption("name").isName).toBe(true);
	});

	// The word has to END the slug: "name-your-price" asks for a thing, not for a name.
	it("is false when the slug merely contains the word", () => {
		expect(textOption("name-your-price").isName).toBe(false);
		expect(textOption("nickname").isName).toBe(false);
	});

	// The arcana's "learn-name" unlock requirement is a BOX, not a written answer — nothing to set
	// in any face, and the readonly row it renders as has no value to carry the class.
	it("is false for a checkbox option however it is named", () => {
		const box = new LoreOptionSnapshotBuilder()
			.withSlug("learn-name").withDescription("<p>Learn its true name.</p>").withMax(1).withCount(1).build();
		expect(box.isName).toBe(false);
	});
});
