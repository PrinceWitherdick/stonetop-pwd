import { describe, it, expect } from "vitest";
import { readRepo as read } from "../fakes/css.js";

// The importer's "what is already on disk" inventory, on a host that keeps user files somewhere
// other than the data path.
//
// The system side of this question lives in module/book2-art/browse.js (see its `readDir`, and
// tests/book2-art/browse.test.js). The macro cannot import that module — it is deliberately
// self-contained, so it imports on a world whose system never started — so it carries its own
// copy of the same walk, and therefore its own copy of the same trap: a `data` browse of the bare
// path answers about a folder that is empty or absent by RESOLVING with no files rather than by
// rejecting, and "no files" is indistinguishable from "nothing was ever imported".
//
// Three separate things go wrong when that happens, none of them loudly:
//   • SKIP_EXISTING never skips, so every re-run re-extracts and re-uploads all 545 pictures;
//   • a row from a book NOT supplied this run drops out of `available`, so its art stops being
//     wired to documents by a run that was only ever asked to add one more book;
//   • the Setting Overview's `prefer` chain loses its fallback to a map already on disk.
//
// Reads the SHIPPED macro command, because that is what a world executes.

const COMMAND = JSON.parse(read("packs/src/stonetop-macros/import-book2-art.json")).command;

describe("the importer's on-disk inventory", () => {
	it("asks the bare data-relative path first, so a self-hosted world is unchanged", () => {
		expect(COMMAND).toContain("let files = await listOne(`${CONFIG.ROOT}/${dir}`);");
	});

	it("asks again with the host's observed prefix when the first ask finds nothing", () => {
		expect(COMMAND).toContain("if (!files.length && prefix) files = await listOne(`${prefix}${CONFIG.ROOT}/${dir}`);");
	});

	it("takes that prefix from what a previous run OBSERVED, never from an assumption", () => {
		// The same world setting the re-apply pass publishes and the gallery reads.
		expect(COMMAND).toContain(`game.settings.get("stonetop-pwd", "book2ArtPrefix")`);
		// And no host is hard-coded. A hostname may be NAMED in a comment — one is, to record the
		// shape this was written against — but the moment one appears in code, this stops being a
		// mechanism that works on any host and becomes a special case for one of them.
		const inCode = COMMAND.split("\n").filter(
			(l) => /forge-vtt\.com|amazonaws\.com/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l),
		);
		expect(inCode, `\n${inCode.join("\n")}\n`).toEqual([]);
	});

	it("normalizes the trailing slash, exactly as the system side does", () => {
		// art-root.js `book2ArtPrefix` does this and says why: a prefix has to end in a separator
		// to BE one, or it welds onto the root (".../uidstonetop-book-art/..."). Every writer today
		// ends in "/", so nothing is broken right now — but this is a SECOND copy of one walk in a
		// file that cannot import the first, and the whole cost of that arrangement is paid the day
		// the two disagree about the shape of one setting.
		expect(COMMAND).toContain('prefix = !stored || stored.endsWith("/") ? stored : `${stored}/`;');
	});

	it("survives a world whose system settings never registered", () => {
		// The macro's whole point is that it works on a broken world. Reading an unregistered
		// setting throws, so the guard has to be there or the inventory takes the run down.
		expect(COMMAND).toContain(`game.settings.settings?.has?.("stonetop-pwd.book2ArtPrefix")`);
	});

	it("keeps a rejected browse meaning 'not there', which is the honest answer", () => {
		expect(COMMAND).toContain("catch (_) { return []; } // directory doesn't exist yet -> nothing to skip");
	});

	it("loses one unreadable filename rather than the directory it sits in", () => {
		// decodeURIComponent throws on a malformed %-escape. Wrapped per file, not per listing.
		expect(COMMAND).toContain("for (const f of files) { try { existingFiles.add(noteServed(decodeURIComponent(f))); } catch (_) { existingFiles.add(noteServed(f)); } }");
	});
});
