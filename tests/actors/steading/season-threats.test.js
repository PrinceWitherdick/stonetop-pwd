import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { Window } from "happy-dom";
import {
	seasonThreatRows, nextPortents, seasonThreatsStepHtml, seasonThreatsStepFor, wireSeasonThreats, openThreatBoard,
} from "../../../module/actors/steading/season-threats.js";
import {
	TRADE_OPPORTUNITY_SOURCES, tradeOpportunityLinksHtml, openTradeOpportunities, wireTradeOpportunityLinks,
} from "../../../module/actors/steading/seasonal-gains.js";

// Seasons Change and its threats (Book I p.520): "On a 7-9 in spring or autumn, or a 6- in summer, either
// introduce a new threat to the steading or have an existing threat advance towards impending doom";
// "threats abound" on a 6- in spring, autumn, or winter. And the trade opportunity gain's neighbours (p.519).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SHEET_JS = fs.readFileSync(path.join(ROOT, "module/actors/steading/StonetopSteadingSheet.js"), "utf8");

const threat = (id, name, portents, { doom = false, resolved = false } = {}) => ({
	id, name, system: { grimPortents: portents.map(([text, done]) => ({ text, done })), impendingDoom: { text: "", done: doom }, resolved },
});

describe("which results call for a threat", () => {
	it("spring and autumn on a 7-9 and a 6-; summer and winter on a 6- only", () => {
		expect(seasonThreatRows("spring").map(r => r[0])).toEqual(["7–9", "6−"]);
		expect(seasonThreatRows("autumn").map(r => r[0])).toEqual(["7–9", "6−"]);
		expect(seasonThreatRows("summer")).toEqual([["6−", expect.stringMatching(/makes itself known/)]]);
		expect(seasonThreatRows("winter")).toEqual([["6−", expect.stringMatching(/Threats abound/)]]);
	});
});

describe("each threat's next grim portent", () => {
	it("is the first one not yet come to pass, skipping a threat that is done or resolved", () => {
		const pages = [
			threat("a", "Crinwin", [["They raid the fields", true], ["They take a child", false]]),
			threat("b", "Hagr", [["Tracks by the Stream", true]]),
			threat("c", "Doomed", [["x", false]], { doom: true }),
			threat("d", "Settled", [["y", false]], { resolved: true }),
		];
		expect(nextPortents(pages)).toEqual([{ pageId: "a", name: "Crinwin", index: 1, text: "They take a child" }]);
	});

	it("draws a button per portent, and says so when there are none", () => {
		const html = seasonThreatsStepHtml("spring", nextPortents([threat("a", "Crinwin", [["They raid", false]])]));
		expect(html).toContain(`data-action="advance-portent" data-page-id="a" data-index="0"`);
		expect(html).toContain(`data-action="open-threat-board"`);
		expect(seasonThreatsStepHtml("summer", [], { threatCount: 0 })).toContain("No threats are written up yet");
	});

	it("marks the portent through the threat store when the GM presses it, and nothing before", async () => {
		const page = threat("a", "Crinwin", [["They raid", false]]);
		const doc = new Window().document;
		const root = doc.body.appendChild(doc.createElement("div"));
		root.innerHTML = seasonThreatsStepHtml("autumn", nextPortents([page]));
		const setDone = vi.fn(async () => true);
		const openBoard = vi.fn();
		wireSeasonThreats(root, { id: "st" }, { listPages: () => [page], setDone, openBoard, notify: { info: vi.fn(), warn: vi.fn() } });
		expect(setDone).not.toHaveBeenCalled();
		root.querySelector("[data-action='advance-portent']").click();
		await vi.waitFor(() => expect(setDone).toHaveBeenCalledWith(page, 0, true));
		await vi.waitFor(() => expect(root.textContent).toContain("Come to pass."));
		root.querySelector("[data-action='open-threat-board']").click();
		expect(openBoard).toHaveBeenCalled();
	});

	it("opens the GM Toolkit on its Threats tab", () => {
		const tabs = { active: "moves" };
		const sheet = { rendered: false, _tabs: [tabs], render: vi.fn() };
		expect(openThreatBoard({ toolkit: { sheet } })).toBe(true);
		expect(tabs.active).toBe("threats");
		expect(sheet.render).toHaveBeenCalledWith(true);
		const warn = vi.fn();
		expect(openThreatBoard({ toolkit: null, notify: { warn } })).toBe(false);
		expect(warn).toHaveBeenCalled();
	});

	it("is a step of the GM's Seasons Change window, wired on render", () => {
		expect(SHEET_JS).toContain(`const seasonThreats = game.user?.isGM ? await import("./season-threats.js") : null;`);
		expect(SHEET_JS).toContain(`seasonThreats ? step("threats", "Threats", "fa-skull", seasonThreats.seasonThreatsStepFor(this.actor, seasonId)) : null`);
		expect(SHEET_JS).toContain("seasonThreats?.wireSeasonThreats(root, this.actor);");
		const html = seasonThreatsStepFor({ id: "st" }, "spring", { listPages: () => [threat("a", "Crinwin", [["They raid", false]])] });
		expect(html).toContain(`data-page-id="a"`);
	});
});

describe("the trade opportunity gain's neighbours (p.519)", () => {
	const journalFiles = () => ["stonetop-locations/settlements", "stonetop-locations/regions", "stonetop-lore/factions"]
		.flatMap(dir => fs.readdirSync(path.join(ROOT, "packs/src", dir)).map(f => path.join(ROOT, "packs/src", dir, f)));

	it("links only entries that print a Trade Opportunities list", () => {
		const byId = new Map(journalFiles().map(file => {
			const json = JSON.parse(fs.readFileSync(file, "utf8"));
			return [json._id, JSON.stringify(json)];
		}));
		for (const source of TRADE_OPPORTUNITY_SOURCES) {
			expect(byId.get(source.journalId), source.name).toMatch(/trade opportunities/i);
		}
	});

	it("sits under the trade opportunity gain in the Seasons Change window", () => {
		expect(SHEET_JS).toContain(`\${g.key === "trade" ? tradeOpportunityLinksHtml() : ""}`);
		expect(SHEET_JS).toContain("wireTradeOpportunityLinks(root);");
		expect(tradeOpportunityLinksHtml()).toContain(`data-journal-id="HesP5wBhjA0l9Ffk"`);
	});

	it("opens the compendium entry when the world has no copy", async () => {
		const sheet = { render: vi.fn() };
		const resolve = vi.fn(async () => ({ sheet }));
		const savedGame = globalThis.game;
		globalThis.game = { ...savedGame, journal: [] };
		try {
			const doc = new Window().document;
			const root = doc.body.appendChild(doc.createElement("div"));
			root.innerHTML = tradeOpportunityLinksHtml();
			wireTradeOpportunityLinks(root, { resolve });
			root.querySelector(`[data-journal-id="uXlyry9CpXUz4ooR"]`).click();
			await vi.waitFor(() => expect(sheet.render).toHaveBeenCalledWith(true));
			expect(resolve.mock.calls[0][0]).toMatch(/JournalEntry\.uXlyry9CpXUz4ooR$/);
			expect(await openTradeOpportunities("missing", { resolve: async () => null })).toBe(false);
		} finally {
			globalThis.game = savedGame;
		}
	});
});
