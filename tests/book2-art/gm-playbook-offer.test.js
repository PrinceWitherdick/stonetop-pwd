import { describe, it, expect, vi } from "vitest";
import { countGmPlaybookGains, pageChain } from "../../module/book2-art/reapply.js";
import { BOOK2_ART_APPLY_MANIFEST } from "../../module/book2-art/manifest.js";
import { clearArtBrowseCache, DURABLE_ART_DIRS } from "../../module/book2-art/browse.js";
import { readRepo } from "../fakes/css.js";

// The GM playbook became a third source for the importer AFTER worlds had already imported, and
// it is the one addition a GM cannot discover on their own: nothing looks broken to them. Their
// Setting Overview pages carry a map — just not the sharpest one in print — and the two
// flowcharts sit on a sheet tab whose placeholder they may never scroll to. So there is a
// one-time whispered offer (hooks/Ready.js `_offerGmPlaybookArtOnce`), and this is the detector
// that decides which worlds hear it.
//
// Getting the audience wrong is the whole risk. Speak to a world that never imported and it is
// the second card that load asking for PDFs; speak to one that already has the playbook art and
// it is a lie; stay silent on a world that would gain and the feature may as well not exist.

const ROOT = "stonetop-book-art";
// Through the shared reader, so this file carries no `fs`/`path`/`fileURLToPath` of its own and
// no `../..` depth that has to match where it happens to sit.
const READY_JS = readRepo("module/hooks/Ready.js");
const SETTINGS_JS = readRepo("module/settings.js");

const { settingOverviewMaps = [], gmDiagrams = [], monsters = [] } = BOOK2_ART_APPLY_MANIFEST;
const CHAINS = settingOverviewMaps.map(pageChain);
/** The head of every map chain: the GM playbook's copy, which only its PDF produces. */
const BEST_MAPS = CHAINS.map(c => c[0]);
/** The next link down: what a world that imported the rulebooks but not the playbook has. */
const LESSER_MAPS = CHAINS.map(c => c[1]);
const DIAGRAMS = gmDiagrams.map(d => d.out);

/** Stand up a world whose durable art folder holds exactly `onDisk`. */
function withArtOnDisk(onDisk, { throws = false } = {}) {
	const files = new Set(onDisk.map(o => `${ROOT}/${o}`));
	global.FilePicker = {
		browse: vi.fn(async (source, p) => {
			if (throws) throw new Error("browse failed");
			for (const dir of DURABLE_ART_DIRS) {
				if (p.endsWith(`/${dir}`)) return { files: [...files].filter(f => f.startsWith(`${ROOT}/${dir}/`)) };
			}
			return { files: [] };
		}),
	};
	clearArtBrowseCache();
	global.game = {
		user: { isGM: true },
		settings: { get: (ns, key) => (key === "book2ArtRoot" ? ROOT : undefined), set: async () => {} },
	};
	global.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
}

describe("countGmPlaybookGains", () => {
	// The premise. If the head of a chain were reachable from any other PDF, the offer would fire
	// for GMs who cannot act on it.
	it("has a chain per map page whose best link is the playbook's own file", () => {
		expect(CHAINS.length).toBeGreaterThan(0);
		for (const c of CHAINS) {
			expect(c.length).toBeGreaterThanOrEqual(2);
			expect(c[0]).toMatch(/^assets\/maps\/gm-/);
		}
	});

	// The audience this exists for: imported before the playbook was wired in.
	it("counts every map page still showing a lesser copy, and both diagrams", async () => {
		withArtOnDisk([...LESSER_MAPS, ...monsters.slice(0, 5).map(m => m.out)]);
		expect(await countGmPlaybookGains()).toEqual({ maps: CHAINS.length, diagrams: DIAGRAMS.length });
	});

	it("says nothing once the playbook has been imported", async () => {
		withArtOnDisk([...BEST_MAPS, ...DIAGRAMS, ...monsters.slice(0, 5).map(m => m.out)]);
		expect(await countGmPlaybookGains()).toBeNull();
	});

	// A world that imported nothing gets "Import Your Book Art" instead, and the playbook is a
	// field on the very dialog that card's button opens. Two cards on one load asking a GM to go
	// and find PDFs is how a nudge turns into noise.
	it("stays silent in a world that has imported nothing at all", async () => {
		withArtOnDisk([]);
		expect(await countGmPlaybookGains()).toBeNull();
	});

	// A page with NO link on disk is a failed/partial import, which countMissingDurableArt owns.
	// "Your maps could be sharper" to a GM whose maps are missing entirely is nonsense.
	it("does not count a map page that has no map on it at all", async () => {
		// Diagrams present, no link of any map chain on disk. Nothing to say: the pages are not
		// behind, they are empty, and that is the partial-import offer's business.
		withArtOnDisk([...DIAGRAMS, ...monsters.slice(0, 5).map(m => m.out)]);
		expect(await countGmPlaybookGains()).toBeNull();
	});

	// Half-and-half is the state a GM lands in if they run the import and cancel, or supply the
	// playbook to a later run. Each half has to be counted on its own or the card overclaims.
	it("counts the two halves independently", async () => {
		withArtOnDisk([...BEST_MAPS, ...monsters.slice(0, 5).map(m => m.out)]);
		expect(await countGmPlaybookGains()).toEqual({ maps: 0, diagrams: DIAGRAMS.length });

		withArtOnDisk([...LESSER_MAPS, ...DIAGRAMS]);
		expect(await countGmPlaybookGains()).toEqual({ maps: CHAINS.length, diagrams: 0 });
	});

	it("counts one page at a time rather than all-or-nothing", async () => {
		// The first page upgraded, the rest not: a GM who ran the import against a playbook that
		// failed on a page should still be told about the pages that are behind.
		withArtOnDisk([BEST_MAPS[0], ...LESSER_MAPS.slice(1), ...DIAGRAMS]);
		expect(await countGmPlaybookGains()).toEqual({ maps: CHAINS.length - 1, diagrams: 0 });
	});

	// Best-effort, like its two sibling detectors: a folder we could not read is not a reason to
	// tell a GM anything.
	it("says nothing when the browse fails", async () => {
		withArtOnDisk(LESSER_MAPS, { throws: true });
		expect(await countGmPlaybookGains()).toBeNull();
	});
});

describe("the upgrade offer", () => {
	// Every one of these is the difference between the card arriving and the feature being
	// invisible to every world that already imported.
	it("is wired into the ready sequence, once per world", () => {
		expect(READY_JS).toContain("_offerGmPlaybookArtOnce()");
		expect(READY_JS).toContain('setting: "gmPlaybookArtOffered"');
		expect(SETTINGS_JS).toContain('game.settings.register(SYSTEM_ID, "gmPlaybookArtOffered"');
	});

	// The whisper itself lives in offerDurableArtOnce, which all three art offers reach through
	// `card:`. What is pinned here is that this offer goes through it (a hand-rolled
	// ChatMessage.create beside it would post to the table) and that the shared helper still
	// whispers rather than broadcasting.
	it("whispers to the GMs rather than posting to the table", () => {
		const fn = READY_JS.slice(READY_JS.indexOf("function _offerGmPlaybookArtOnce"));
		const body = fn.slice(0, fn.indexOf("\n}\n"));
		expect(body).toContain("card: _buildGmPlaybookArtContent");
		expect(body).not.toContain("ChatMessage.create");
		expect(readRepo("module/book2-art/offer-once.js"))
			.toContain('ChatMessage.getWhisperRecipients("GM")');
	});

	// The card's button reuses the class the two existing art cards use, which stonetop.js already
	// delegates to the macro launcher. A new class here would render a button that does nothing.
	it("reuses the wired Import Book Art button", () => {
		const card = READY_JS.slice(READY_JS.indexOf("function _buildGmPlaybookArtContent"));
		expect(card).toContain('class="stonetop-import-art-open"');
	});

	// Written against what THIS world would gain: a GM who already has the diagrams should not be
	// told about a tab they have been using, and one whose maps are current not about maps.
	it("describes only the half that is actually missing", () => {
		const card = READY_JS.slice(READY_JS.indexOf("function _buildGmPlaybookArtContent"));
		const body = card.slice(0, card.indexOf("\n}\n"));
		expect(body).toContain("if (maps)");
		expect(body).toContain("if (diagrams)");
	});

	// It asks the GM to go and find a PDF for art that already looks fine, so it yields to the two
	// offers that are about gaps.
	it("comes after the rebuild and partial-import offers", () => {
		const order = ["_offerBookArtRebuildOnce()", "_offerPartialArtImportOnce()", "_offerGmPlaybookArtOnce()"]
			.map(name => READY_JS.indexOf(name));
		expect(order[0]).toBeLessThan(order[1]);
		expect(order[1]).toBeLessThan(order[2]);
	});
});
