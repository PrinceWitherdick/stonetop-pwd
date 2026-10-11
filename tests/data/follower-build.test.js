import { describe, it, expect } from "vitest";
import {
	deriveHp, deriveArmor, deriveDamageDie, formatDamage,
	normalizeTags, parseFollowerArmor, buildCustomFollower, monsterFollowerTags, followerFromMonster,
	followerFromNpc,
	monsterGroupDefaults, orderFollowersBonus, readinessCap,
	READINESS_SHIELD_BONUS, READINESS_SHIELD_WALL_BONUS,
	applyTagEdits, editTagLayer, editTagList,
} from "../../module/data/follower-build.js";

// The rules content + derivations behind the Create-a-Follower walkthrough and
// the monster→follower conversion (Book I, NPCs & Followers, pp.474–479).

describe("deriveHp", () => {
	it("uses the chosen resilience base", () => {
		expect(deriveHp({ base: "weak",  mods: [] })).toBe(3);
		expect(deriveHp({ base: "able",  mods: [] })).toBe(6);
		expect(deriveHp({ base: "tough", mods: [] })).toBe(9);
	});

	it("adds all checked modifiers", () => {
		// Able-bodied + large + fates smile = 6 + 4 + 2
		expect(deriveHp({ base: "able", mods: ["large", "fates"] })).toBe(12);
	});

	it("never drops below 1 HP even when tiny", () => {
		// Weak (3) - tiny (2) = 1
		expect(deriveHp({ base: "weak", mods: ["tiny"] })).toBe(1);
	});

	it("defaults to 1 for an unknown base with no mods", () => {
		expect(deriveHp({ base: "???", mods: [] })).toBe(1);
	});
});

describe("deriveArmor", () => {
	it("uses the chosen protection base", () => {
		expect(deriveArmor({ base: "cloth", mods: [] })).toBe(0);
		expect(deriveArmor({ base: "steel", mods: [] })).toBe(3);
		expect(deriveArmor({ base: "magical", mods: [] })).toBe(4);
	});

	it("stacks the +1 modifiers", () => {
		// Leathers (1) + shield (1) + skilled (1) = 3
		expect(deriveArmor({ base: "leather", mods: ["shield", "skilled"] })).toBe(3);
	});

	it("floors at 0", () => {
		expect(deriveArmor({ base: "cloth", mods: [] })).toBe(0);
	});
});

describe("deriveDamageDie / formatDamage", () => {
	it("maps danger to a die", () => {
		expect(deriveDamageDie("weak")).toBe("d4");
		expect(deriveDamageDie("defends")).toBe("d6");
		expect(deriveDamageDie("veteran")).toBe("d8");
	});

	it("joins die + form", () => {
		expect(formatDamage("d6", "hand")).toBe("d6 (hand)");
		expect(formatDamage("d8", "")).toBe("d8");
		expect(formatDamage("d6", "(near, low ammo)")).toBe("d6 (near, low ammo)");
	});
});

describe("orderFollowersBonus", () => {
	it("adds +0 when no tag applies", () => {
		expect(orderFollowersBonus({ helps: 0 })).toEqual({ bonus: 0, rollMode: "normal" });
	});

	it("adds +1 when at least one tag applies", () => {
		expect(orderFollowersBonus({ helps: 1 })).toEqual({ bonus: 1, rollMode: "normal" });
		// Multiple applicable tags still only grant +1.
		expect(orderFollowersBonus({ helps: 3 }).bonus).toBe(1);
	});

	it("adds +2 only when exceptional AND another tag applies", () => {
		expect(orderFollowersBonus({ helps: 1, exceptional: true }).bonus).toBe(2);
	});

	it("keeps an exceptional follower at +0 when nothing else applies", () => {
		// Book edge case (p.462): exceptional alone, no applicable tag → +0.
		expect(orderFollowersBonus({ helps: 0, exceptional: true }).bonus).toBe(0);
	});

	it("rolls with disadvantage when a tag gets in the way", () => {
		expect(orderFollowersBonus({ helps: 1, hinders: 1 })).toEqual({ bonus: 1, rollMode: "dis" });
		// Disadvantage can coexist with the +2 bonus.
		expect(orderFollowersBonus({ helps: 1, hinders: 1, exceptional: true })).toEqual({ bonus: 2, rollMode: "dis" });
	});

	it("honors the outside advantage and disadvantage toggles", () => {
		expect(orderFollowersBonus({ helps: 1, advantage: true }).rollMode).toBe("adv");
		// Interfere (p.329) hands out disadvantage on the next roll even when nothing
		// about the follower is in the way.
		expect(orderFollowersBonus({ helps: 1, disadvantage: true }).rollMode).toBe("dis");
		expect(orderFollowersBonus({ helps: 0, disadvantage: true })).toEqual({ bonus: 0, rollMode: "dis" });
	});

	it("cancels advantage against disadvantage rather than letting either win (p.230)", () => {
		// Stentorian on a follower whose mischievous tag is in the way: straight 2d6+1.
		expect(orderFollowersBonus({ helps: 1, hinders: 1, advantage: true })).toEqual({ bonus: 1, rollMode: "normal" });
		expect(orderFollowersBonus({ helps: 1, advantage: true, disadvantage: true }).rollMode).toBe("normal");
		// Neither side stacks, so extra hindering tags don't out-vote one advantage.
		expect(orderFollowersBonus({ helps: 1, hinders: 3, advantage: true }).rollMode).toBe("normal");
		// The bonus is untouched by the cancellation.
		expect(orderFollowersBonus({ helps: 1, hinders: 1, advantage: true, exceptional: true }).bonus).toBe(2);
	});

	it("counts an applicable move toward the bonus the same as a tag", () => {
		// The dialog folds move picks into `helps`, since p.462 reads "at least one
		// appropriate tag or move".
		expect(orderFollowersBonus({ helps: 1, exceptional: false }).bonus).toBe(1);
		// ...and a move alone can't impose disadvantage, so hinders stays 0 there.
		expect(orderFollowersBonus({ helps: 1 }).rollMode).toBe("normal");
	});

	it("defaults to a clean +0/normal with no arguments", () => {
		expect(orderFollowersBonus()).toEqual({ bonus: 0, rollMode: "normal" });
	});
});

describe("parseFollowerArmor", () => {
	it("passes clean numbers through, floored at 0 and truncated", () => {
		expect(parseFollowerArmor(2)).toBe(2);
		expect(parseFollowerArmor(0)).toBe(0);
		expect(parseFollowerArmor(-3)).toBe(0);
		expect(parseFollowerArmor(2.9)).toBe(2);
	});

	it("extracts the leading number from book-format conditional armor", () => {
		// "Armor 2 (0 vs. iron)" → 2 (the conditional remainder isn't modeled).
		expect(parseFollowerArmor("2 (0 vs. iron)")).toBe(2);
		expect(parseFollowerArmor("3")).toBe(3);
	});

	it("returns 0 for placeholders and non-numeric junk", () => {
		expect(parseFollowerArmor("—")).toBe(0);
		expect(parseFollowerArmor("")).toBe(0);
		expect(parseFollowerArmor(null)).toBe(0);
		expect(parseFollowerArmor(undefined)).toBe(0);
		expect(parseFollowerArmor(NaN)).toBe(0);
	});
});

describe("normalizeTags", () => {
	it("splits comma strings, trims, and drops blanks", () => {
		expect(normalizeTags("archer, observant ,, eager")).toEqual(["archer", "observant", "eager"]);
	});

	it("de-dupes case-insensitively, first spelling wins", () => {
		expect(normalizeTags(["Archer", "archer", "ARCHER"])).toEqual(["Archer"]);
	});
});

describe("buildCustomFollower", () => {
	it("normalizes a walkthrough result into the stored shape", () => {
		const f = buildCustomFollower({
			name: "  Andras ", pronoun: "he", typeLabel: "apprentice hunter",
			tags: ["archer", "observant", "eager", "rookie"],
			hp: 6, armor: 0, damage: "d6 (near, low ammo)",
			instinct: "to try to impress Rhianna", cost: "recognition",
			moves: "Moon over Blodwen\nMake a rookie mistake",
			gear: ["Bow & iron arrows", { label: "", checked: false }],
		});
		expect(f.name).toBe("Andras");
		expect(f.typeLabel).toBe("apprentice hunter");
		expect(f.tags).toEqual(["archer", "observant", "eager", "rookie"]);
		expect(f.hpMax).toBe(6);
		expect(f.hpCurrent).toBe(6); // defaults to full
		expect(f.armor).toBe(0);
		expect(f.damage).toBe("d6 (near, low ammo)");
		expect(f.cost).toBe("recognition");
		expect(f.loyalty).toBe(0);
		// Blank gear rows are dropped; strings become {label, checked}.
		expect(f.gear).toEqual([{ label: "Bow & iron arrows", checked: false }]);
	});

	it("defaults the type label and portrait, and clamps a given hpCurrent to max", () => {
		const f = buildCustomFollower({ name: "X", hp: 6, hpCurrent: 99 });
		expect(f.typeLabel).toBe("follower");
		expect(f.portraitIcon).toBe("fas fa-user");
		expect(f.hpCurrent).toBe(6);
	});

	it("keeps the leading number from book-format conditional armor (not 0)", () => {
		const f = buildCustomFollower({ name: "X", hp: 6, armor: "2 (0 vs. iron)" });
		expect(f.armor).toBe(2);
	});

	it("honors a starting loyalty (e.g. summoned spirits), flooring at 0", () => {
		expect(buildCustomFollower({ name: "X", loyalty: 3 }).loyalty).toBe(3);
		expect(buildCustomFollower({ name: "X", loyalty: -2 }).loyalty).toBe(0);
		expect(buildCustomFollower({ name: "X" }).loyalty).toBe(0);
	});

	it("defaults to a single (non-group) follower", () => {
		const f = buildCustomFollower({ name: "Solo", hp: 6 });
		expect(f.isGroup).toBe(false);
		expect(f.size).toBe(0);
	});

	it("stores a group with its size, and defaults the group label + icon", () => {
		const f = buildCustomFollower({ name: "The Posse", hp: 6, isGroup: true, size: 5 });
		expect(f.isGroup).toBe(true);
		expect(f.size).toBe(5);
		expect(f.typeLabel).toBe("group follower");
		expect(f.portraitIcon).toBe("fas fa-users");
	});

	it("floors a group at 2 members even if a smaller size is given", () => {
		expect(buildCustomFollower({ name: "G", hp: 6, isGroup: true, size: 1 }).size).toBe(2);
		expect(buildCustomFollower({ name: "G", hp: 6, isGroup: true, size: 0 }).size).toBe(2);
		expect(buildCustomFollower({ name: "G", hp: 6, isGroup: true }).size).toBe(2);
	});

	// The card shows `img` when set and falls back to portraitIcon when it isn't, so
	// "no portrait" has to be the empty string rather than undefined.
	it("stores a chosen portrait, and leaves it empty when there is none", () => {
		expect(buildCustomFollower({ name: "X", img: " art/people/hark.webp " }).img).toBe("art/people/hark.webp");
		expect(buildCustomFollower({ name: "X" }).img).toBe("");
	});
});

describe("monsterFollowerTags", () => {
	it("drops the organization and size, keeping flavor tags", () => {
		const tags = monsterFollowerTags({
			organization: "group", size: "", tags: "group, organized, cautious",
		});
		expect(tags).toEqual(["organized", "cautious"]);
	});

	it("drops a size tag too", () => {
		const tags = monsterFollowerTags({
			organization: "solitary", size: "large", tags: "solitary, large, fierce, cunning",
		});
		expect(tags).toEqual(["fierce", "cunning"]);
	});
});

describe("followerFromMonster", () => {
	const wolf = {
		name: "Wolf",
		uuid: "Actor.abc123",
		system: {
			organization: "group",
			size: "",
			creatureType: "natural-beast",
			tags: "group, organized, cautious",
			attributes: {
				hp: { value: 4, max: 6 },
				armor: { value: 0 },
				damage: { value: "bite d8 (hand, grabby)", rollFormula: "d8" },
				instinct: { value: "to bring down the weakest prey" },
			},
		},
		items: [
			{ type: "monsterMove", name: "Follow prey for miles on end" },
			{ type: "monsterMove", name: "Surround, flank, and harry" },
		],
	};

	it("keeps the monster's stats as-is (p.475)", () => {
		const f = followerFromMonster(
			{ name: wolf.name, system: wolf.system, moves: wolf.items.map(i => i.name), uuid: wolf.uuid },
			{ tags: [], cost: "", pronoun: "it" },
		);
		expect(f.name).toBe("Wolf");
		expect(f.hpMax).toBe(6);
		expect(f.hpCurrent).toBe(4); // current HP carried over
		expect(f.armor).toBe(0);
		expect(f.damage).toBe("bite d8 (hand, grabby)");
		expect(f.instinct).toBe("to bring down the weakest prey");
		expect(f.pronoun).toBe("it");
		expect(f.portraitIcon).toBe("fas fa-paw"); // a beast keeps the paw
		expect(f.sourceUuid).toBe("Actor.abc123");
		expect(f.loyalty).toBe(0); // gains a Loyalty track at 0
	});

	it("uses the monster's creature-type glyph, not the generic paw (e.g. an Adept is human)", () => {
		const f = followerFromMonster(
			{ name: "Rime Adept", system: { creatureType: "human-individual", attributes: { hp: { max: 6 } } }, moves: [] },
			{},
		);
		expect(f.portraitIcon).toBe("fas fa-user");
	});

	it("falls back to a generic monster glyph when no creature type is set", () => {
		const f = followerFromMonster(
			{ name: "Mystery", system: { attributes: { hp: { max: 6 } } }, moves: [] },
			{},
		);
		expect(f.portraitIcon).toBe("fas fa-dragon");
	});

	it("carries the monster's art onto the card, but not a stock placeholder", () => {
		const withArt = followerFromMonster(
			{ name: wolf.name, system: wolf.system, moves: [], img: "art/bestiary/wolf.webp" },
			{},
		);
		expect(withArt.img).toBe("art/bestiary/wolf.webp");
		// mystery-man would only replace the paw glyph with a silhouette, so it resolves to
		// "" and the glyph keeps the slot.
		const placeholder = followerFromMonster(
			{ name: wolf.name, system: wolf.system, moves: [], img: "icons/svg/mystery-man.svg" },
			{},
		);
		expect(placeholder.img).toBe("");
		expect(followerFromMonster({ name: wolf.name, system: wolf.system, moves: [] }, {}).img).toBe("");
	});

	it("keeps flavor tags and appends the player's added tags", () => {
		const f = followerFromMonster(
			{ name: wolf.name, system: wolf.system, moves: [] },
			{ tags: ["keen-nosed"], cost: "training", pronoun: "" },
		);
		expect(f.tags).toEqual(["organized", "cautious", "keen-nosed"]);
		expect(f.cost).toBe("training");
	});

	it("keeps a monster's leading armor when its value is a conditional string", () => {
		const f = followerFromMonster(
			{ name: "Iron Golem", system: { attributes: { armor: { value: "2 (0 vs. iron)" }, hp: { max: 12 } } }, moves: [] },
			{},
		);
		expect(f.armor).toBe(2);
	});

	it("carries the monster moves as newline-joined text", () => {
		const f = followerFromMonster(
			{ name: wolf.name, system: wolf.system, moves: wolf.items.map(i => i.name) },
			{},
		);
		expect(f.moves).toBe("Follow prey for miles on end\nSurround, flank, and harry");
	});

	it("becomes a group follower when the dialog passes isGroup + size", () => {
		const f = followerFromMonster(
			{ name: wolf.name, system: wolf.system, moves: [] },
			{ isGroup: true, size: 4 },
		);
		expect(f.isGroup).toBe(true);
		expect(f.size).toBe(4);
	});

	it("stays a single follower when the dialog leaves isGroup off", () => {
		const f = followerFromMonster(
			{ name: wolf.name, system: wolf.system, moves: [] },
			{},
		);
		expect(f.isGroup).toBe(false);
		expect(f.size).toBe(0);
	});
});

describe("followerFromNpc", () => {
	const statted = {
		name: "Elios",
		uuid: "Actor.elios1",
		system: {
			hasStats: true,
			pronouns: "he/him",
			instinct: "to complain but get the job done",
			tags: "ex-mercenary, humorless",
			attributes: {
				hp: { value: 5, max: 6 },
				armor: { value: 1 },
				damage: { value: "sword d6 (hand)", rollFormula: "d6" },
			},
		},
	};

	it("seeds stats + tags + instinct + pronoun from a statted NPC and links back via sourceUuid", () => {
		const f = followerFromNpc(statted, { cost: "recognition", moves: ["Bark an order"] });
		expect(f.name).toBe("Elios");
		expect(f.hpMax).toBe(6);
		expect(f.hpCurrent).toBe(5);       // current HP carried over
		expect(f.armor).toBe(1);
		expect(f.damage).toBe("sword d6 (hand)");
		expect(f.tags).toEqual(["ex-mercenary", "humorless"]);
		expect(f.instinct).toBe("to complain but get the job done");
		expect(f.pronoun).toBe("he/him"); // defaulted from the NPC's pronouns
		expect(f.cost).toBe("recognition");
		expect(f.moves).toBe("Bark an order");
		expect(f.sourceUuid).toBe("Actor.elios1");
		expect(f.loyalty).toBe(0);         // gains a fresh Loyalty track
	});

	it("appends the player's added tags after the NPC's own", () => {
		const f = followerFromNpc(statted, { tags: ["eager"] });
		expect(f.tags).toEqual(["ex-mercenary", "humorless", "eager"]);
	});

	// A villager recruited off the steading's roster usually already wears a People of
	// Stonetop portrait, and the follower card should show the same face unasked.
	it("carries the NPC's portrait, but not a stock placeholder", () => {
		expect(followerFromNpc({ ...statted, img: "art/people/elios.webp" }, {}).img).toBe("art/people/elios.webp");
		expect(followerFromNpc({ ...statted, img: "icons/svg/mystery-man.svg" }, {}).img).toBe("");
		expect(followerFromNpc(statted, {}).img).toBe("");
	});

	// The square the roster already framed that face to rides along (wave 3 audit FOL-10): it was
	// handed to buildCustomFollower and dropped there, so a recruited face came out freshly cropped.
	it("carries the portrait's frame with the portrait, and no frame without one", () => {
		const frame = { src: "art/people/elios.webp", rect: { x: 0.1, y: 0.05, w: 0.5, h: 0.5 } };
		const flags = { "stonetop-pwd": { portraitFrame: frame } };
		expect(followerFromNpc({ ...statted, img: "art/people/elios.webp", flags }, {}).portraitFrame).toEqual(frame);
		expect(followerFromNpc({ ...statted, flags }, {})).not.toHaveProperty("portraitFrame");
		const wolf = { name: "Wolf", system: { attributes: { hp: { max: 6 } } }, img: "art/beasts/wolf.webp", flags };
		expect(followerFromMonster(wolf, {}).portraitFrame).toEqual(frame);
	});

	it("falls back to the able-bodied baseline (6 HP, 0 armor, no tags) for an unstatted NPC", () => {
		const f = followerFromNpc(
			{ name: "Andras", uuid: "Actor.andras1", system: { hasStats: false, pronouns: "he/him", instinct: "to impress Rhianna", tags: "ignored-when-unstatted" } },
			{},
		);
		expect(f.hpMax).toBe(6);
		expect(f.hpCurrent).toBe(6);
		expect(f.armor).toBe(0);
		expect(f.damage).toBe("");
		expect(f.tags).toEqual([]); // an NPC's tags are game-stats; skipped when it has none
		expect(f.instinct).toBe("to impress Rhianna");
		expect(f.sourceUuid).toBe("Actor.andras1");
	});

	it("lets the dialog override HP / armor / damage", () => {
		const f = followerFromNpc(statted, { hp: 9, armor: 2, damage: "d8" });
		expect(f.hpMax).toBe(9);
		expect(f.hpCurrent).toBe(5); // raising max doesn't heal; keeps the NPC's current HP
		expect(f.armor).toBe(2);
		expect(f.damage).toBe("d8");
	});

	it("fills current HP to max when the NPC has no current value", () => {
		const f = followerFromNpc(
			{ name: "Golem", uuid: "Actor.g", system: { hasStats: true, attributes: { hp: { max: 12 } } } },
			{},
		);
		expect(f.hpMax).toBe(12);
		expect(f.hpCurrent).toBe(12);
	});

	it("becomes a group follower when isGroup + size are passed", () => {
		const f = followerFromNpc(statted, { isGroup: true, size: 4 });
		expect(f.isGroup).toBe(true);
		expect(f.size).toBe(4);
	});
});

describe("readinessCap", () => {
	it("is 3 without a shield", () => {
		expect(readinessCap(false)).toBe(3);
	});

	it("adds the shield bonus (+1) with a shield", () => {
		expect(readinessCap(true)).toBe(3 + READINESS_SHIELD_BONUS);
		expect(readinessCap(true)).toBe(4);
	});

	it("uses Shield Wall's +2 shield bonus so 5 is recordable", () => {
		expect(readinessCap(true, READINESS_SHIELD_WALL_BONUS)).toBe(5);
	});

	it("gives no bonus without a shield even under Shield Wall", () => {
		expect(readinessCap(false, READINESS_SHIELD_WALL_BONUS)).toBe(3);
	});
});

describe("monsterGroupDefaults", () => {
	it("makes a horde a group, defaulting to 6 when no count is set", () => {
		expect(monsterGroupDefaults({ organization: "horde" })).toEqual({ isGroup: true, size: 6 });
	});

	it("makes a group a group, defaulting to 3 when no count is set", () => {
		expect(monsterGroupDefaults({ organization: "group" })).toEqual({ isGroup: true, size: 3 });
	});

	it("uses the monster's count when it names one", () => {
		expect(monsterGroupDefaults({ organization: "horde", count: 12 })).toEqual({ isGroup: true, size: 12 });
		expect(monsterGroupDefaults({ organization: "group", count: 5 })).toEqual({ isGroup: true, size: 5 });
	});

	it("leaves solitary / group-less monsters as single followers", () => {
		expect(monsterGroupDefaults({ organization: "solitary" })).toEqual({ isGroup: false, size: 0 });
		expect(monsterGroupDefaults({})).toEqual({ isGroup: false, size: 0 });
	});
});

// Updating followers (p.480): any follower's tags may be added to, removed or revised.
describe("hand-edited follower tags", () => {
	it("applyTagEdits drops derived tags and appends added ones, without case", () => {
		const tags = applyTagEdits(
			[{ label: "fierce", tooltip: "t" }, "loyal", { label: "Hardy" }],
			{ extraTags: ["scarred", "LOYAL"], droppedTags: ["hardy"] },
		);
		expect(tags).toEqual([
			{ label: "fierce", tooltip: "t" },
			{ label: "loyal" },
			{ label: "scarred", added: true },
		]);
	});

	it("applyTagEdits with no layer keeps every tag", () => {
		expect(applyTagEdits(["a", "b"])).toEqual([{ label: "a" }, { label: "b" }]);
		expect(applyTagEdits(undefined, { extraTags: ["x"] })).toEqual([{ label: "x", added: true }]);
	});

	it("editTagLayer adds and drops, and each undoes the other", () => {
		let layer = editTagLayer({}, "add", "brave, cunning");
		expect(layer).toEqual({ extraTags: ["brave", "cunning"], droppedTags: [] });
		layer = editTagLayer(layer, "remove", "Brave");
		expect(layer).toEqual({ extraTags: ["cunning"], droppedTags: [] });
		layer = editTagLayer(layer, "remove", "fierce");
		expect(layer).toEqual({ extraTags: ["cunning"], droppedTags: ["fierce"] });
		layer = editTagLayer(layer, "add", "Fierce");
		expect(layer).toEqual({ extraTags: ["cunning"], droppedTags: [] });
	});

	it("editTagList edits a custom follower's own list", () => {
		expect(editTagList(["spirit", "tiny"], "add", "sly, Tiny")).toEqual(["spirit", "tiny", "sly"]);
		expect(editTagList(["spirit", "tiny"], "remove", "TINY")).toEqual(["spirit"]);
		expect(editTagList(undefined, "add", "")).toEqual([]);
	});
});
