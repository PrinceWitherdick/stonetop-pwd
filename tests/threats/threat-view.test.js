import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildThreatCardVM } from "../../module/threats/threat-view.js";
import { setPortentDone, setDoomDone } from "../../module/threats/threat-store.js";

/** A threat page whose updates land a few ms later, the way a server round trip does. */
function fakePage(system) {
	const page = {
		id: "p1", uuid: "JournalEntry.e1.JournalEntryPage.p1", name: "Sajra", isOwner: true,
		system: structuredClone(system),
		writes: [],
		async update(change) {
			page.writes.push(structuredClone(change));
			await new Promise(r => setTimeout(r, 5));
			for (const [path, value] of Object.entries(change)) {
				const keys = path.split(".").slice(1);
				let o = page.system;
				for (const k of keys.slice(0, -1)) o = o[k];
				o[keys.at(-1)] = structuredClone(value);
			}
		},
	};
	return page;
}

describe("threat card: lesser threats in parentheses (Book I p.289)", () => {
	it("names no type for a lesser threat whose type was left blank", async () => {
		const vm = await buildThreatCardVM(fakePage({
			type: "villain", proximity: "nearby",
			nested: [
				{ name: "the crinwin", type: "", instinct: "to covet" },
				{ name: "Wynfor", type: "", instinct: "" },
				{ name: "the nests", type: "rabble", instinct: "to covet" },
			],
		}));
		const [blank, bare, typed] = vm.nested;
		expect(blank.type).toBe("");
		expect(blank.note).toBe("to covet");
		expect(bare.note).toBe("");
		expect(typed.note).toBe("Rabble; to covet");
		expect(vm.nested.some(n => n.note.includes("Villain"))).toBe(false);
	});

	it("draws the parenthetical from that note, and none at all when it is empty", () => {
		const hbs = readFileSync(new URL("../../templates/journal/partials/threat-card.hbs", import.meta.url), "utf8");
		expect(hbs).toContain("{{name}}{{#if note}} <em>({{note}})</em>{{/if}}");
		expect(hbs).not.toContain("({{type}}");
	});
});

describe("threat doom track: ticks do not race each other", () => {
	it("keeps both of two portents ticked inside one round trip", async () => {
		const page = fakePage({ grimPortents: [
			{ text: "More children go missing", done: false },
			{ text: "Some children return", done: false },
			{ text: "Children recruit followers", done: false },
		], impendingDoom: { text: "Subjugates the town", done: false } });
		await Promise.all([setPortentDone(page, 0, true), setPortentDone(page, 1, true)]);
		expect(page.system.grimPortents.map(p => p.done)).toEqual([true, true, false]);
	});

	it("orders the impending doom behind a pending portent tick on the same page", async () => {
		const page = fakePage({ grimPortents: [{ text: "a", done: false }], impendingDoom: { text: "b", done: false } });
		await Promise.all([setPortentDone(page, 0, true), setDoomDone(page, true)]);
		expect(page.system.grimPortents[0].done).toBe(true);
		expect(page.system.impendingDoom.done).toBe(true);
		expect(page.writes.map(w => Object.keys(w)[0])).toEqual(["system.grimPortents", "system.impendingDoom.done"]);
	});

	it("ignores an index off the end of the track", async () => {
		const page = fakePage({ grimPortents: [{ text: "a", done: false }], impendingDoom: { text: "", done: false } });
		await setPortentDone(page, 3, true);
		await setPortentDone(page, -1, true);
		expect(page.writes).toEqual([]);
	});
});
