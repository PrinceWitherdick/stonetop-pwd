import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readRepo } from "../fakes/css.js";
import { isBlankDanger, withoutBlankDangers, clearBlankDangers } from "../../module/migration/blank-dangers.js";

// Until 43ca5442 the page sheet read each Dangers entry twice off its edit form, the second time
// blank, so every save wrote a blank entry after each real one. This takes them back out.

const wolves = { heading: "Wolves", body: "<p>Hungry</p>" };
const drakes = { heading: "Ice drakes", body: "<p>In warm months</p>" };
const blank = { heading: "", body: "" };

describe("isBlankDanger", () => {
	it("is what the bug wrote: no title, no body", () => {
		expect(isBlankDanger(blank)).toBe(true);
		expect(isBlankDanger({})).toBe(true);
	});
	it("counts empty markup and spaces as nothing", () => {
		expect(isBlankDanger({ heading: "  ", body: "<p></p>" })).toBe(true);
		expect(isBlankDanger({ heading: "", body: "<p>&nbsp;</p><p><br></p>" })).toBe(true);
	});
	it("keeps an entry with a title, or with anything in its body", () => {
		expect(isBlankDanger({ heading: "Wolves", body: "" })).toBe(false);
		expect(isBlankDanger({ heading: "", body: "<p>Hungry</p>" })).toBe(false);
		expect(isBlankDanger({ heading: "", body: `<p><img src="wolf.webp"></p>` })).toBe(false);
		expect(isBlankDanger({ heading: "", body: "<table><tr><td></td></tr></table>" })).toBe(false);
	});
});

describe("withoutBlankDangers", () => {
	it("takes the blanks out of a doubled list and keeps the order", () => {
		const sections = [
			{ kind: "prose", body: "<p>Overview</p>" },
			{ kind: "groups", heading: "Dangers", groups: [wolves, blank, drakes, blank] },
		];
		expect(withoutBlankDangers(sections)).toEqual([
			{ kind: "prose", body: "<p>Overview</p>" },
			{ kind: "groups", heading: "Dangers", groups: [wolves, drakes] },
		]);
	});
	it("says so when there is nothing to do", () => {
		expect(withoutBlankDangers([{ kind: "groups", groups: [wolves, drakes] }])).toBeNull();
		expect(withoutBlankDangers([{ kind: "prose", body: "" }, { kind: "qa", pairs: [{ prompt: "", answer: "" }] }])).toBeNull();
		expect(withoutBlankDangers(undefined)).toBeNull();
	});
});

// A live page as the sweep sees it: data on `system`, a clone on `system.toObject()`.
const livePage = (id, type, sections) => ({
	id, type, system: { sections, toObject: () => ({ sections: structuredClone(sections) }) },
});

describe("clearBlankDangers", () => {
	it("clears every page of a journal that has blanks, in one write", async () => {
		const entry = {
			pages: [
				livePage("a", "location", [{ kind: "groups", groups: [wolves, blank] }]),
				livePage("b", "chronicle", [{ kind: "groups", groups: [blank, drakes, blank] }]),
				livePage("c", "location", [{ kind: "groups", groups: [wolves] }]),
				livePage("d", "text", [{ kind: "groups", groups: [blank] }]),
			],
			updateEmbeddedDocuments: vi.fn(async () => []),
		};
		expect(await clearBlankDangers(entry)).toBe(2);
		expect(entry.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
		expect(entry.updateEmbeddedDocuments).toHaveBeenCalledWith("JournalEntryPage", [
			{ _id: "a", "system.sections": [{ kind: "groups", groups: [wolves] }] },
			{ _id: "b", "system.sections": [{ kind: "groups", groups: [drakes] }] },
		]);
	});
	it("writes nothing when there are no blanks", async () => {
		const entry = { pages: [livePage("c", "location", [{ kind: "groups", groups: [wolves] }])], updateEmbeddedDocuments: vi.fn() };
		expect(await clearBlankDangers(entry)).toBe(0);
		expect(entry.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

// The sweep never touches a page still as shipped, so it cannot cost a page its managed book
// updates. That holds only while no shipped Dangers list has a blank entry.
describe("the shipped pages", () => {
	const SRC = path.resolve(import.meta.dirname, "../../packs/src");
	const walk = dir => fs.readdirSync(dir, { withFileTypes: true })
		.flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".json") ? [path.join(dir, e.name)] : []);

	it("have Dangers lists and not one blank entry among them", () => {
		let entries = 0;
		const blanks = [];
		for (const file of walk(SRC)) {
			const doc = JSON.parse(fs.readFileSync(file, "utf8"));
			for (const page of doc.pages ?? []) {
				for (const section of page.system?.sections ?? []) {
					if (section.kind !== "groups") continue;
					for (const entry of section.groups ?? []) {
						entries += 1;
						if (isBlankDanger(entry)) blanks.push(`${path.relative(SRC, file)}: ${page.name}`);
					}
				}
			}
		}
		expect(entries).toBeGreaterThan(50);
		expect(blanks).toEqual([]);
	});
});

describe("the sweep's place in the load", () => {
	it("runs for the primary GM once per version, and cannot take the load down with it", () => {
		const READY = readRepo("module/hooks/Ready.js");
		const gated = READY.slice(READY.indexOf("if (isActingPrimaryGM()) {"));
		expect(gated).toContain(`bestEffort("blank Dangers entry cleanup", () => oncePerVersion("blankDangers", clearAllBlankDangers))`);
	});
});
