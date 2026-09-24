import { describe, expect, it } from "vitest";
import {
	MOVE, ROW_KIND, STRUGGLE_STATUS, newStruggleRecord, readStruggleRoll, struggleBoard,
} from "../../module/struggle/struggle-rules.js";
import { struggleWindowView } from "../../module/struggle/struggle-view.js";
import { followerKey, newSetupDraft, setupView } from "../../module/struggle/struggle-setup.js";

/**
 * Both struggle templates, rendered for real (tests/setup.js#renderTemplate) over the views the
 * pure modules build, so what is asserted is the markup that ships.
 */

const WINDOW = "systems/stonetop-pwd/templates/dialogs/struggle-as-one.hbs";
const SETUP = "systems/stonetop-pwd/templates/dialogs/struggle-setup.hbs";

const pc = (actorId, extra = {}) => ({ kind: ROW_KIND.PC, actorId, name: actorId, ...extra });

function windowHtml(rows, { status = STRUGGLE_STATUS.ROLLING, totals = {}, reader, ...extra } = {}) {
	const struggle = { ...newStruggleRecord({ id: "s1", rows, danger: "The mire", ...extra }), status };
	const records = {};
	for (const row of struggle.rows) {
		records[row.actorId] ??= { id: "s1", rolls: {} };
		if (row.key in totals) records[row.actorId].rolls[row.key] = { total: totals[row.key], stat: "str" };
	}
	const board = struggleBoard(struggle, id => readStruggleRoll(records[id], "s1"));
	return renderTemplate(WINDOW, struggleWindowView(struggle, board, reader, { statValues: { pc_vahid: { str: 1, con: 0 } } }));
}

/** One card's markup, cut at its own `</li>`. */
function card(html, key) {
	const chunk = html.split("<li ").slice(1).find(c => c.includes(`data-row-key="${key}"`)) ?? "";
	return chunk.slice(0, chunk.indexOf("</li>"));
}

const gm = { isGM: true, drives: new Set(), mine: new Set() };
const vahid = { isGM: false, drives: new Set(["pc_vahid"]), mine: new Set(["pc_vahid"]) };

describe("the struggle window's template", () => {
	it("gives the reader's own unrolled row a stat list and a Roll button, and nobody else's", async () => {
		const html = await windowHtml([pc("vahid", { stats: ["str", "con"] }), pc("rhianna")], { reader: vahid });
		expect(card(html, "pc_vahid")).toContain('data-struggle-action="roll"');
		expect(card(html, "pc_vahid")).toContain('<option value="con"');
		expect(card(html, "pc_rhianna")).not.toContain("data-struggle-action");
		expect(card(html, "pc_rhianna")).toContain("Waiting to roll");
	});

	it("keeps a result off another player's screen until the GM shares it", async () => {
		const html = await windowHtml([pc("vahid"), pc("rhianna")], { reader: vahid, totals: { pc_vahid: 8, pc_rhianna: 12 } });
		expect(card(html, "pc_vahid")).toContain("8: pulls their weight");
		expect(card(html, "pc_rhianna")).not.toContain("12");
		expect(html).not.toContain('data-struggle-action="share"');
	});

	it("gives the GM Share once everyone has rolled, and Call it off until then", async () => {
		const html = await windowHtml([pc("vahid"), pc("rhianna")], { reader: gm, totals: { pc_vahid: 8, pc_rhianna: 12 } });
		expect(html).toContain('data-struggle-action="share"');
		expect(html).toContain('data-struggle-action="cancel"');
		expect(html).not.toContain('data-struggle-action="end"');
	});

	it("gives a shared 10+ the list of people to get out, and the GM End and the spots question", async () => {
		const html = await windowHtml([pc("vahid"), pc("rhianna"), pc("caradoc")], {
			reader: { isGM: true, drives: new Set(["pc_rhianna"]), mine: new Set() },
			status: STRUGGLE_STATUS.REVEALED, totals: { pc_vahid: 4, pc_rhianna: 11, pc_caradoc: 5 },
		});
		expect(card(html, "pc_rhianna")).toContain('data-struggle-action="rescue"');
		expect(card(html, "pc_rhianna")).toContain('<option value="pc_vahid"');
		expect(html).toContain('name="struggleSpots"');
		expect(html).toContain('data-struggle-action="end"');
		expect(html).toContain("vahid &amp; caradoc are still in a spot, and each mark XP.");
	});

	it("shows a Judge's Bundle of Sticks pick to their player", async () => {
		const html = await windowHtml([pc("vahid", { owns: [MOVE.BUNDLE_OF_STICKS] }), pc("rhianna")], { reader: vahid });
		expect(card(html, "pc_vahid")).toContain('data-struggle-field="bundle"');
	});
});

describe("the setup's template", () => {
	const crew = { fkey: followerKey("rhianna", "crew", ""), ftype: "crew", slug: "", name: "Crew", img: "", tags: ["stealthy"], exceptional: false, isGroup: true, party: true };
	const roster = [
		{ actorId: "rhianna", name: "Rhianna", img: "", owns: [MOVE.TRAILBLAZER], load: "normal", overloaded: false, followers: [crew] },
		{ actorId: "vahid", name: "Vahid", img: "", owns: [MOVE.STONE_COLD], load: "heavy", overloaded: false, followers: [] },
	];

	it("draws a card per character, with the stats, the mode, outside Aid and the moves they know", async () => {
		const html = await renderTemplate(SETUP, setupView(roster, newSetupDraft(roster)));
		expect(html).toContain('data-pc="vahid" data-field="stat" value="wis"');
		expect(html).toContain('data-pc="vahid" data-field="tick" value="Stone Cold"');
		expect(html).not.toContain('data-pc="rhianna" data-field="tick"');
		expect(html).toContain('data-follower="rhianna:crew:" data-field="bonus"');
		expect(html).toContain('name="journey"');
		expect(html).toContain("Heavy load");
	});

	it("names the asker, and turns Cancel into the answer to their ask", async () => {
		const html = await renderTemplate(SETUP, setupView(roster, newSetupDraft(roster), { askerName: "Vahid" }));
		expect(html).toContain("Vahid's player asks for a Struggle as One.");
		expect(html).toContain("Don't call it");
	});

	it("keeps Call for rolls off while a struggle is under way, and says why", async () => {
		const html = await renderTemplate(SETUP, setupView(roster, newSetupDraft(roster), { live: true }));
		expect(html).toMatch(/data-setup-action="call" disabled data-tooltip="A Struggle as One is already under way/);
	});
});
