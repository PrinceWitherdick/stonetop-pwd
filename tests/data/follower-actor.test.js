import { describe, it, expect } from "vitest";
import {
	followerNpcActorData, followerNotesHtml, splitFollowerName, followerMarkerImg,
	followerActorFields, followerActorMoves, followerPortraitFrame, isFollowerMarkerImg, followerCardStamp,
	CARD_FIELD_PATHS, NEW_SHOOT_MARKER, LEGACY_SHOOT_MARKERS, FOLLOWER_DRAG_TYPE,
} from "../../module/data/follower-actor.js";

// The follower → NPC Actor mapping behind dragging a follower card onto the canvas
// (Book I, NPCs & Followers p.475: a follower is first an NPC).

const CREW = {
	name: "The Ragged Half-Dozen",
	typeLabel: "group follower",
	pronoun: "they",
	tags: ["group", "loyal", "loyal"],
	hp: { value: 14, max: 36 },
	armor: 1,
	armorSource: "leather",
	damage: "d8 (close)",
	damageRoll: "d8",
	instinct: "To question leadership",
	moves: ["Hold the line", "  ", "Scatter"],
	notes: "Hired in Marshedge.",
	cost: "Coin, payment, treasure",
	gear: [{ label: "rations", checked: true }, { label: "", checked: false }],
	isGroup: true,
};

describe("followerNpcActorData", () => {
	it("builds an npc with the card's stats in the optional stat block", () => {
		const data = followerNpcActorData(CREW);
		expect(data.type).toBe("npc");
		expect(data.name).toBe("The Ragged Half-Dozen");
		expect(data.system.hasStats).toBe(true);
		expect(data.system.attributes.hp).toEqual({ value: 14, max: 36 });
		expect(data.system.attributes.armor).toEqual({ value: 1, source: "leather", conditional: 0, conditionalSource: "" });
		expect(data.system.attributes.damage).toEqual({ value: "d8 (close)", rollFormula: "d8" });
		expect(data.system.instinct).toBe("To question leadership");
		expect(data.system.pronouns).toBe("they");
		expect(data.system.occupation).toBe("group follower");
	});

	it("de-duplicates the tag list into the NPC's comma-separated tags", () => {
		expect(followerNpcActorData(CREW).system.tags).toBe("group, loyal");
	});

	it("carries the follower's moves across as npcMove items, dropping blank lines", () => {
		expect(followerNpcActorData(CREW).items).toEqual([
			{ name: "Hold the line", type: "npcMove" },
			{ name: "Scatter", type: "npcMove" },
		]);
	});

	it("leaves a group follower's token unlinked so each member tracks its own HP", () => {
		expect(followerNpcActorData(CREW).prototypeToken.actorLink).toBe(false);
		expect(followerNpcActorData({ ...CREW, isGroup: false }).prototypeToken.actorLink).toBe(true);
	});

	it("marks the token friendly and names it on hover", () => {
		const token = followerNpcActorData(CREW).prototypeToken;
		expect(token.disposition).toBe(1);
		expect(token.displayName).toBe(30);
		expect(token.name).toBe("The Ragged Half-Dozen");
	});

	it("gives a portrait-less follower their card's own mark, not Foundry's mystery man", () => {
		const data = followerNpcActorData({ ...CREW, img: "", portraitIcon: "fas fa-users" });
		expect(data.img).toBe("systems/stonetop-pwd/assets/icons/bestiary/human-group.svg");
		expect(data.prototypeToken.texture).toEqual({ src: data.img });
	});

	it("treats a stock Foundry placeholder as no portrait at all", () => {
		const data = followerNpcActorData({ ...CREW, img: "icons/svg/mystery-man.svg", portraitIcon: "fas fa-paw" });
		expect(data.img).toBe("systems/stonetop-pwd/assets/icons/bestiary/natural-beast.svg");
	});

	it("dresses the token in the follower's portrait when the card has one", () => {
		const data = followerNpcActorData({ ...CREW, img: "worlds/art/hafr.webp" });
		expect(data.img).toBe("worlds/art/hafr.webp");
		expect(data.prototypeToken.texture).toEqual({ src: "worlds/art/hafr.webp" });
	});

	// The stamp is what lets a LATER edit on the card tell a field this actor still holds AS GIVEN
	// from one somebody has since changed on the NPC itself.
	it("remembers everything the card dictated, so a later edit can tell what is still ours", () => {
		const stamp = followerNpcActorData({ ...CREW, img: "worlds/art/hafr.webp" })
			.flags["stonetop-pwd"].followerCard;
		expect(stamp.fields.name).toBe("The Ragged Half-Dozen");
		expect(stamp.fields.img).toBe("worlds/art/hafr.webp");
		expect(stamp.fields.instinct).toBe("To question leadership");
		expect(stamp.moves).toEqual(["Hold the line", "Scatter"]);
		// The stand-in disc is stamped too — it is just as much what the card gave it.
		expect(followerNpcActorData({ ...CREW, img: "", portraitIcon: "fas fa-users" })
			.flags["stonetop-pwd"].followerCard.fields.img)
			.toBe("systems/stonetop-pwd/assets/icons/bestiary/human-group.svg");
	});

	// The table is what keeps creation and the reconciling sweep from drifting; a field with no
	// path is a field the sweep would silently never write.
	it("gives every card-authored field a place on the actor", () => {
		const fields = Object.keys(followerActorFields(CREW));
		expect(fields.every(key => !!CARD_FIELD_PATHS[key])).toBe(true);
		// And no path may be a stamp key with a dot in it — Foundry would expand it on write.
		expect(Object.keys(CARD_FIELD_PATHS).some(key => key.includes("."))).toBe(false);
	});

	it("falls back to a generic name and full HP when the card gives neither", () => {
		const data = followerNpcActorData({ hp: { max: 6 } });
		expect(data.name).toBe("Follower");
		expect(data.prototypeToken.name).toBe("Follower");
		expect(data.system.attributes.hp).toEqual({ value: 6, max: 6 });
	});

	it("clamps current HP to the max and floors it at zero", () => {
		expect(followerNpcActorData({ hp: { value: 99, max: 6 } }).system.attributes.hp.value).toBe(6);
		expect(followerNpcActorData({ hp: { value: -4, max: 6 } }).system.attributes.hp.value).toBe(0);
	});

	it("reads a book-format armor string down to its number", () => {
		expect(followerNpcActorData({ armor: "2 (0 vs. iron)" }).system.attributes.armor.value).toBe(2);
		expect(followerNpcActorData({ armor: "—" }).system.attributes.armor.value).toBe(0);
	});

	// Afon's "Armor 2 (0 vs. iron)" (Book I p.145) is a clause the sheet cannot check, so it rides to
	// the NPC the way Barkskin rides on a character: all 2 armor by default, with the 2 iron takes away
	// kept apart for the damage card to offer back with a ticked "Not iron" box.
	it("keeps what a printed clause takes away, and what takes it, beside the armor", () => {
		expect(followerNpcActorData({ armor: "2 (0 vs. iron)" }).system.attributes.armor)
			.toMatchObject({ value: 2, conditional: 2, conditionalSource: "vs. iron" });
		// A clause about where armor comes from is not a condition, and a hand-typed number has none.
		expect(followerNpcActorData({ armor: "1 (shield)" }).system.attributes.armor)
			.toMatchObject({ value: 1, conditional: 0, conditionalSource: "" });
		expect(followerNpcActorData({ armor: 2 }).system.attributes.armor)
			.toMatchObject({ value: 2, conditional: 0, conditionalSource: "" });
	});

	it("records where it came from and files it in the given folder", () => {
		const origin = { characterUuid: "Actor.abc", ftype: "crew", slug: "" };
		const data = followerNpcActorData(CREW, { folder: "folder1", origin });
		expect(data.folder).toBe("folder1");
		expect(data.flags["stonetop-pwd"].followerOrigin).toEqual(origin);
	});
});

describe("followerCardStamp", () => {
	it("carries every key it governs, including an img the fields left out", () => {
		// The stamp is stored as a flag OBJECT, and Foundry MERGES one of those: a key absent from
		// a later write cannot displace the one already stored, since dropping a subkey takes an
		// explicit `-=`. `img` is the one field followerActorFields omits rather than blanks, so a
		// stamp allowed to omit it too would strand the old path there for good — _stampEq would
		// then disagree on every single pass, and the sweep would re-write the stamp, and re-fire
		// the NPC's change ledger, on every render of the character sheet.
		const fields = followerActorFields({ name: "Enfys" });
		delete fields.img;

		expect(followerCardStamp(fields, [])).toEqual({ fields: { ...fields, img: "" }, moves: [] });
	});

	it("keeps a portrait the card did choose, and the moves alongside it", () => {
		const stamp = followerCardStamp({ name: "Enfys", img: "worlds/art/enfys.webp" }, ["Stand fast"]);
		expect(stamp.fields.img).toBe("worlds/art/enfys.webp");
		expect(stamp.moves).toEqual(["Stand fast"]);
	});

	it("is what a freshly built Actor is stamped with, so creation and the sweep agree", () => {
		const data = followerNpcActorData(CREW);
		expect(data.flags["stonetop-pwd"].followerCard)
			.toEqual(followerCardStamp(followerActorFields(CREW), followerActorMoves(CREW)));
	});
});

describe("followerNotesHtml", () => {
	it("keeps the cost, the gear and the card's own notes", () => {
		const html = followerNotesHtml(CREW);
		expect(html).toBe("<p><strong>Cost:</strong> Coin, payment, treasure</p>"
			+ "<p><strong>Gear:</strong> rations</p>"
			+ "<p>Hired in Marshedge.</p>");
	});

	it("lists only the gear they've actually ticked", () => {
		const html = followerNotesHtml({ gear: [
			{ label: "shield", checked: true },
			{ label: "warhorse", checked: false },
		] });
		expect(html).toBe("<p><strong>Gear:</strong> shield</p>");
	});

	it("strips the rulebook's markup out of a crew's inventory labels", () => {
		const html = followerNotesHtml({ gear: [
			{ label: "<strong>Hatchet</strong>, iron (<em>hand, thrown</em>)", checked: true },
		] });
		expect(html).toBe("<p><strong>Gear:</strong> Hatchet, iron (hand, thrown)</p>");
	});

	it("is empty when the card carries none of the three", () => {
		expect(followerNotesHtml({})).toBe("");
	});

	it("escapes what it writes", () => {
		expect(followerNotesHtml({ notes: "<script>x</script>" }))
			.toBe("<p>&lt;script&gt;x&lt;/script&gt;</p>");
	});
});

describe("followerMarkerImg", () => {
	const mark = t => `systems/stonetop-pwd/assets/icons/bestiary/${t}.svg`;

	it("gives an initiate of Danu the new shoot", () => {
		expect(followerMarkerImg("fas fa-seedling")).toBe(NEW_SHOOT_MARKER);
		expect(NEW_SHOOT_MARKER).toBe("systems/stonetop-pwd/assets/icons/followers/new-shoot.svg");
	});

	// The art moved off sprout.svg, and that file is gone. An actor stamped before the move
	// still names it, so the old path has to stay recognisable under every id this package
	// has shipped under (hooks/Ready.js lifts them onto the current file).
	it("still recognises the path the marker used to live at", () => {
		expect(LEGACY_SHOOT_MARKERS).toContain("systems/stonetop-pwd/assets/icons/followers/sprout.svg");
		expect(LEGACY_SHOOT_MARKERS).toContain("systems/stonetop_pwd/assets/icons/followers/sprout.svg");
		expect(LEGACY_SHOOT_MARKERS).not.toContain(NEW_SHOOT_MARKER);
	});

	it("maps the taxonomy's own glyphs straight back to their marks", () => {
		expect(followerMarkerImg("fas fa-paw")).toBe(mark("natural-beast"));
		expect(followerMarkerImg("fas fa-users")).toBe(mark("human-group"));
		expect(followerMarkerImg("fas fa-user")).toBe(mark("human-individual"));
		expect(followerMarkerImg("fas fa-ghost")).toBe(mark("spirit"));
	});

	it("reads the animals the follower cards use but the taxonomy doesn't", () => {
		expect(followerMarkerImg("fas fa-dog")).toBe(mark("natural-beast"));
		expect(followerMarkerImg("fas fa-wheat-awn")).toBe(mark("natural-beast"));
	});

	it("sends the generic monster glyph to the unknown-origin mark", () => {
		expect(followerMarkerImg("fas fa-dragon")).toBe(mark("unknown-origin"));
	});

	it("stands an unrecognised or missing glyph in as a person", () => {
		expect(followerMarkerImg("fas fa-flux-capacitor")).toBe(mark("human-individual"));
		expect(followerMarkerImg("")).toBe(mark("human-individual"));
		expect(followerMarkerImg(undefined)).toBe(mark("human-individual"));
	});

	it("is not fooled by Font Awesome's style and utility classes", () => {
		expect(followerMarkerImg("fa-solid fa-fw fa-paw")).toBe(mark("natural-beast"));
	});
});

// Reading a marker back off an actor: what tells a follower's NPC still wearing the stand-in we
// gave it from one somebody has since chosen art for.
describe("isFollowerMarkerImg", () => {
	it("knows every mark followerMarkerImg can hand out", () => {
		expect(isFollowerMarkerImg(followerMarkerImg("fas fa-paw"))).toBe(true);
		expect(isFollowerMarkerImg(followerMarkerImg("fas fa-seedling"))).toBe(true);
		expect(isFollowerMarkerImg(followerMarkerImg(""))).toBe(true);
	});

	// isDefaultImg answers for the mystery man and the "human, individual" mark and stops there;
	// a converted beast's disc is just as much a placeholder and only this can say so.
	it("covers the discs isDefaultImg cannot, under every id and a stray leading slash", () => {
		expect(isFollowerMarkerImg("/systems/stonetop-pwd/assets/icons/bestiary/undead.svg")).toBe(true);
		expect(isFollowerMarkerImg("systems/stonetop_pwd/assets/icons/bestiary/fae.svg")).toBe(true);
		expect(isFollowerMarkerImg("systems/stonetop_pwd/assets/icons/followers/sprout.svg")).toBe(true);
	});

	it("never mistakes art somebody chose for one of ours", () => {
		expect(isFollowerMarkerImg("worlds/art/hafr.webp")).toBe(false);
		expect(isFollowerMarkerImg("systems/stonetop-pwd/assets/icons/bestiary/not-a-type.svg")).toBe(false);
		expect(isFollowerMarkerImg("")).toBe(false);
		expect(isFollowerMarkerImg(undefined)).toBe(false);
	});
});

describe("followerPortraitFrame", () => {
	const rect = { src: "worlds/art/hafr.webp", rect: [0.1, 0.1, 0.5, 0.5] };

	it("rides along with a portrait the follower actually chose", () => {
		expect(followerPortraitFrame({ img: "worlds/art/hafr.webp", portraitFrame: rect })).toEqual(rect);
	});

	it("is dropped where the picture fell back to a stand-in mark", () => {
		// A rect measured against a picture this actor no longer wears is dead weight.
		expect(followerPortraitFrame({ img: "", portraitFrame: rect })).toBeNull();
		expect(followerPortraitFrame({ img: "icons/svg/mystery-man.svg", portraitFrame: rect })).toBeNull();
		expect(followerPortraitFrame({ img: "worlds/art/hafr.webp" })).toBeNull();
	});
});

describe("splitFollowerName", () => {
	it("lifts an initiate's epithet off their name", () => {
		expect(splitFollowerName("Enfys, your acolyte, beloved by birds"))
			.toEqual({ name: "Enfys", traits: "your acolyte, beloved by birds" });
	});

	it("leaves a plain name whole", () => {
		expect(splitFollowerName("Bess the Verifier")).toEqual({ name: "Bess the Verifier", traits: "" });
	});

	it("keeps a name that opens with a comma rather than yielding an empty one", () => {
		expect(splitFollowerName(", the nameless one"))
			.toEqual({ name: ", the nameless one", traits: "" });
	});

	it("handles a blank name", () => {
		expect(splitFollowerName(undefined)).toEqual({ name: "", traits: "" });
	});
});

describe("the epithet an Actor gets built with", () => {
	it("names the actor and its token for the person, not the whole heading", () => {
		const data = followerNpcActorData({ ...CREW, name: "Enfys, your acolyte, beloved by birds" });
		expect(data.name).toBe("Enfys");
		expect(data.prototypeToken.name).toBe("Enfys");
		expect(data.system.traits).toBe("your acolyte, beloved by birds");
		// The type line still reads as their lot in life, untouched by the split.
		expect(data.system.occupation).toBe("group follower");
	});

	it("leaves traits empty for a follower whose name carries no epithet", () => {
		expect(followerNpcActorData(CREW).system.traits).toBe("");
	});
});

describe("FOLLOWER_DRAG_TYPE", () => {
	it("is the payload type the canvas drop hook claims", () => {
		expect(FOLLOWER_DRAG_TYPE).toBe("StonetopFollower");
	});
});
