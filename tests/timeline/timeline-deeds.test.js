import { describe, it, expect } from "vitest";
import {
	arcanaTrackSlugs, creationMilestones, detectArcanaTracks, detectMilestones, snapshotFrom, splitForgotten,
	touchesWatched,
} from "../../module/timeline/timeline-milestones.js";
import { arcanumUnlockedUnder, consequenceBoxLabel, consequenceBoxRange } from "../../module/actors/character/CharacterArcana.js";
import { threatMilestoneKey } from "../../module/threats/threat-view.js";
import { TIMELINE_SOURCES, TIMELINE_CARD_SOURCES } from "../../module/timeline/timeline-core.js";
import { KIND_META } from "../../module/timeline/timeline-view.js";

// The things the system already kept that now reach the timeline (user, 2026-10-10): a Would-Be Hero's
// cross-off, a destiny fulfilled, the Judge's brands and oaths, what a character past the Last Door
// takes on, an arcanum's track, and Stonetop's improvements, disasters and threats.

const SCOPE = "stonetop-pwd";

/** A snapshot built the way the watcher builds one, from a flag bag. */
function snap(flags = {}, level = 2) {
	return snapshotFrom({ system: { attributes: { level: { value: level }, wounds: [] } }, flags });
}

const keys = list => list.map(m => m.key ?? `forget:${m.forget}`);

describe("the new kinds", () => {
	it("are sources the system records, each a card with a chip", () => {
		for (const kind of ["deed", "treasure", "improvement", "disaster", "threat"]) {
			expect(TIMELINE_SOURCES, kind).toContain(kind);
			expect(TIMELINE_CARD_SOURCES, kind).toContain(kind);
			expect(KIND_META[kind]?.icon, kind).toMatch(/^fa-/);
		}
	});
});

describe("touchesWatched", () => {
	const flatten = (obj, prefix = "") => Object.entries(obj).reduce((acc, [k, v]) => {
		const path = prefix ? `${prefix}.${k}` : k;
		if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(acc, flatten(v, path));
		else acc[path] = v;
		return acc;
	}, {});

	it("notices each flag a deed or a post-death pick is read off", () => {
		for (const flag of ["wbhBecameHero", "background", "condemned", "oaths", "postDeathLore"]) {
			expect(touchesWatched({ [`flags.${SCOPE}.${flag}`]: true }, SCOPE, flatten), flag).toBe(true);
		}
	});
});

describe("deeds", () => {
	it("records a Would-Be Hero crossing off 'Would-be', and takes it back when it is written back in", () => {
		expect(keys(detectMilestones(snap(), snap({ wbhBecameHero: true })))).toEqual(["deed:hero"]);
		expect(keys(detectMilestones(snap({ wbhBecameHero: true }), snap({ wbhBecameHero: false })))).toEqual(["forget:deed:hero"]);
	});

	it("records a destiny fulfilled once its box is ticked", () => {
		const off = snap({ background: { setupResources: { "destiny-fulfilled": 0 } } });
		const on = snap({ background: { setupResources: { "destiny-fulfilled": 1 } } });
		expect(keys(detectMilestones(off, on))).toEqual(["deed:destiny"]);
		expect(keys(detectMilestones(on, off))).toEqual(["forget:deed:destiny"]);
	});

	it("records a brand laid, with its reason, and nothing when it is lifted", () => {
		const branded = snap({ condemned: [{ id: "b1", name: "Osric", note: "Burned the granary" }] });
		const [row] = detectMilestones(snap(), branded);
		expect(row).toMatchObject({ source: "deed", key: "condemn:b1", data: { name: "Osric" }, body: "Burned the granary" });
		expect(detectMilestones(branded, snap({ condemned: [] }))).toEqual([]);
	});

	it("records an oath witnessed, broken, and un-broken by a mistaken tick", () => {
		const sworn = snap({ oaths: [{ id: "o1", name: "Wren", note: "Keep the ford", broken: false }] });
		const broken = snap({ oaths: [{ id: "o1", name: "Wren", note: "Keep the ford", broken: true }] });
		expect(keys(detectMilestones(snap(), sworn))).toEqual(["oath:o1"]);
		expect(keys(detectMilestones(sworn, broken))).toEqual(["oath:o1:broken"]);
		expect(keys(detectMilestones(broken, sworn))).toEqual(["forget:oath:o1:broken"]);
	});

	// "The oath held in a string" must not read as broken (oaths.js#coerceBroken).
	it("reads a stored 'false' as kept", () => {
		const sworn = snap({ oaths: [{ id: "o1", name: "Wren", broken: false }] });
		expect(detectMilestones(sworn, snap({ oaths: [{ id: "o1", name: "Wren", broken: "false" }] }))).toEqual([]);
	});

	// The sheet's rule (oath-broken.js): a stored 1 or " true " is broken there, so it is here too.
	it("reads an oath broken by the same rule the sheet does", () => {
		const sworn = snap({ oaths: [{ id: "o1", name: "Wren", broken: false }] });
		for (const broken of [1, " true ", "TRUE"]) {
			expect(keys(detectMilestones(sworn, snap({ oaths: [{ id: "o1", name: "Wren", broken }] }))), String(broken)).toEqual(["oath:o1:broken"]);
		}
	});

	it("are all quiet while a character is being made", () => {
		expect(creationMilestones(detectMilestones(snap(), snap({ wbhBecameHero: true })))).toEqual([]);
	});
});

describe("past the Last Door", () => {
	const worn = (counts = {}, task = "") => snap({
		deathsDoor: "revenant", postDeathInsert: { slug: "revenant", ...(task ? { task } : {}) },
		postDeathLore: { counts },
	});

	it("records each story option newly marked, for the caller to name", () => {
		const found = detectMilestones(worn({}), worn({ "terrible-purpose:vengeance": 1, "consequences:breakdown": 1 }));
		expect(found.map(m => m.postDeath)).toEqual([
			{ insert: "revenant", section: "terrible-purpose", option: "vengeance" },
			{ insert: "revenant", section: "consequences", option: "breakdown" },
		]);
		expect(keys(found)).toEqual(["postdeath:revenant:terrible-purpose:vengeance", "postdeath:revenant:consequences:breakdown"]);
	});

	it("never records a track spent and refilled, like Favor", () => {
		expect(detectMilestones(worn({}), worn({ "favor:favor": 3 }))).toEqual([]);
	});

	it("records the master's task done, with the task as its body", () => {
		const [row] = detectMilestones(worn({}, "Bring me the bell of Gordin's Delve"), worn({}));
		expect(row).toMatchObject({ source: "death", titleKey: "stonetop.timeline.milestone.masterTaskDone", body: "Bring me the bell of Gordin's Delve" });
	});

	it("writes nothing for the picks a NEW insert arrives with", () => {
		const before = snap({ deathsDoor: "dead" });
		expect(detectMilestones(before, worn({ "terrible-purpose:vengeance": 1 })).filter(m => m.postDeath)).toEqual([]);
	});
});

describe("an arcanum's track", () => {
	// A card with two ○ to unlock and a back whose Consequences hold two □.
	const card = {
		slug: "codex",
		front: { title: "A heavy codex", unlock: { description: "<p>○○</p>", requirements: [] } },
		back: { description: "<p>□ Learn its name.</p><h3>Consequences</h3><ul><li>□ <strong>Lose 1 max HP</strong>.</li><li>□ Your hair goes white.</li></ul>" },
	};
	const own = (boxes = {}) => snap({ arcana: { owned: ["codex"], identified: ["codex"], boxes } });
	const reads = {
		unlocked: (unlock, boxes) => arcanumUnlockedUnder(card, unlock, boxes),
		consequences: consequenceBoxRange(card.back.description),
		consequenceLabel: i => consequenceBoxLabel(card.back.description, i),
	};

	it("asks after only the owned cards whose marks moved", () => {
		expect(arcanaTrackSlugs(own(), own({ "codex:unlock:0": true }))).toEqual(["codex"]);
		const lead = snap({ arcana: { owned: [], boxes: {} } });
		expect(arcanaTrackSlugs(lead, snap({ arcana: { owned: [], boxes: { "codex:unlock:0": true } } }))).toEqual([]);
	});

	it("records its secrets unlocked when the last mark lands, and unwrites them when one comes off", () => {
		const one = own({ "codex:unlock:0": true });
		const both = own({ "codex:unlock:0": true, "codex:unlock:1": true });
		expect(keys(detectArcanaTracks("codex", one, both, reads))).toEqual(["arcana:codex:unlocked"]);
		expect(keys(detectArcanaTracks("codex", both, one, reads))).toEqual(["forget:arcana:codex:unlocked"]);
	});

	it("records a Consequence marked, saying what it cost", () => {
		const found = detectArcanaTracks("codex", own(), own({ "codex:back:1": true }), reads);
		expect(found).toEqual([expect.objectContaining({ key: "arcana:codex:consequence:1", body: "Lose 1 max HP." })]);
	});

	it("ignores a box outside the Consequences", () => {
		expect(detectArcanaTracks("codex", own(), own({ "codex:back:0": true }), reads)).toEqual([]);
	});
});

describe("splitForgotten", () => {
	it("parts the rows to write from the keys to take back off", () => {
		expect(splitForgotten([{ key: "a", source: "deed" }, { forget: "b" }])).toEqual({ write: [{ key: "a", source: "deed" }], forget: ["b"] });
	});
});

describe("consequenceBoxLabel", () => {
	it("reads the words after a box, to the next box or the end of its item", () => {
		const back = "<ul><li>□ First <em>thing</em></li><li>□ Second □ Third</li></ul>";
		expect(consequenceBoxLabel(back, 0)).toBe("First thing");
		expect(consequenceBoxLabel(back, 1)).toBe("Second");
		expect(consequenceBoxLabel(back, 2)).toBe("Third");
		expect(consequenceBoxLabel(back, 3)).toBe("");
	});
});

describe("Stonetop's rows", () => {
	it("key a threat's doom and each portent apart", () => {
		expect(threatMilestoneKey("p1", { doom: true })).toBe("threat:p1:doom");
		expect(threatMilestoneKey("p1", { index: 2 })).toBe("threat:p1:portent:2");
	});
});
