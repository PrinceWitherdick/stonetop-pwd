import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The NPC window's sizing contract, which is three separate decisions that only make sense
// together — and which regress SILENTLY, because a window that resizes itself still works,
// it just moves under the cursor:
//
//  1. `height: "auto"` so it OPENS fitted to its content.
//  2. That "auto" is then RETIRED, on the first render, by writing the measured height into
//     `options.height`. Without this the window never stops re-measuring: "auto" is a standing
//     instruction core re-reads on every `setPosition`, and core's own `_onChangeTab` is
//     nothing but `this.setPosition()` — so the frame grew and shrank as the reader moved
//     between a two-line Details tab and a full relationships board, and jumped again on the
//     next re-render. Refusing to refit from THIS file was never enough; the refit was being
//     made one class up.
//  3. A manual drag then sizes it the ordinary way, and withSheetSizeMemory reopens it there.
//
// Wiring a full AppV1 sheet under node is not worth it for this, so these read the source.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(HERE, "../../..", rel), "utf8");

const SHEET = read("module/actors/npc/StonetopNpcSheet.js");
const CSS = read("styles/stonetop.css").replace(/\/\*[\s\S]*?\*\//g, "");
// Comments explain at length why there is no per-tab refit, and name the thing they are
// explaining — so strip them before asserting on what the code does.
const CODE = SHEET.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
// The once-per-sheet latch itself lives in the shared sizing module, because the monster sheet
// opens on a measurement the same way. Read it too, so the guard is still asserted somewhere.
const SIZING = read("module/utils/sheet-size.js")
	.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the NPC sheet's window height", () => {
	it("opens fitted to its content", () => {
		expect(CODE).toMatch(/height:\s*"auto"/);
	});

	it("turns that opening measurement into a fixed height", () => {
		// The whole fix in one line: after the first render `options.height` is a NUMBER, so
		// core stops blanking the frame and re-measuring the content on every setPosition.
		expect(CODE).toMatch(/_adoptOpeningHeight\(\)\s*\{/);
		expect(CODE).toMatch(/this\.options\.height\s*=\s*height/);
		// Once, not per render — otherwise every re-render re-fits to the active tab, which is
		// the same jump arriving a beat later. The sheet hands its flag to the shared guard…
		expect(CODE).toMatch(/sizeOnceOnOpen\(this, "_openingHeightAdopted"/);
		// …which is the thing that only lets it through once, and never while minimized.
		expect(SIZING).toMatch(/if \(app\[flag\][\s\S]{0,80}\) return;/);
		expect(SIZING).toMatch(/app\._minimized/);
		// And never over a remembered size: restoreSheetSize already made the window definite.
		expect(CODE).toMatch(/_restoredSheetSize\.height\) this\._openingHeightAdopted = true;/);
	});

	it("does not refit for anything the reader does once it is open", () => {
		// Every regression shape this sheet has actually shipped: a tab-strip click handler
		// that re-measures, and the relationships board handing back a refit when a card note
		// opens. Both are now the tab's scrollport's job.
		expect(CODE).not.toMatch(/sheet-tabs[\s\S]{0,240}setPosition/);
		expect(CODE).not.toMatch(/onResize/);
		// One setPosition in the file, and it is the opening measurement.
		expect(CODE.match(/setPosition/g) ?? []).toHaveLength(1);
	});

	it("has no max-height to fight the user's chosen size", () => {
		// A cap on the frame would clamp a drag as well as the opening height. The NPC frame
		// carried one (700px) until it was found to be both redundant — core clamps to the
		// viewport — and the only one on any sheet.
		expect(CSS).not.toMatch(/\.window-app\.stonetop\.sheet\.actor\.npc\s*\{[^}]*max-height/);
	});

	it("keeps a tab that outgrows the frame scrollable, since the frame no longer grows for it", () => {
		// This is what makes "never refit" safe: nothing is cut off, it scrolls in place.
		expect(CSS).toMatch(
			/\.stonetop-npc-sheet \.sheet-body > \.tab\.active:not\(\.notes\)\s*\{[^}]*overflow-y:\s*auto/);
	});
});
