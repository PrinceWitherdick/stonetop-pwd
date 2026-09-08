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
	// The two questions, and nothing about the statements that ask them. An earlier version of
	// this file pinned each line whole, which turns a rename or a reformat that preserved the
	// behaviour perfectly into a red suite reporting a regression that does not exist — the cost
	// tests/book2-art/gm-playbook-source.test.js has already paid twice.
	it("asks the bare data-relative path, so a self-hosted world is unchanged", () => {
		expect(COMMAND).toContain("listOne(`${CONFIG.ROOT}/${dir}`)");
	});

	it("asks a second time with the host's observed prefix in front of the art ROOT", () => {
		// Not `${prefix}${dir}`. The retry is only worth making if it names the same folder the
		// first ask named: get the root out of it and it is a second useless question, which looks
		// exactly like a host with no art on it.
		expect(COMMAND).toContain("listOne(`${prefix}${CONFIG.ROOT}/${dir}`)");
	});

	it("keeps BOTH listings, so one stale bare file cannot hide the relocated folder", () => {
		// The trap in "retry only when the first ask found nothing": a world imported self-hosted
		// and later moved onto a host carries its old Data folder along, and one leftover file there
		// is enough to satisfy that test and suppress the ask that finds the other 545. The system
		// side unions the same two answers — see module/book2-art/browse.js `readDir`.
		expect(COMMAND).toContain("[...viaPrefix, ...bare]");
		expect(COMMAND).not.toContain("if (!files.length && prefix)");
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
		// decodeURIComponent throws on a malformed %-escape. Wrapped per file, not per listing —
		// and the fallback is wrapped too, since it re-runs the very call that may have thrown.
		expect(COMMAND).toContain("existingFiles.add(noteServed(decodeURIComponent(f)));");
		expect(COMMAND).toMatch(/catch \(_\) \{ try \{ existingFiles\.add\(noteServed\(f\)\); \} catch/);
	});

	it("treats a listing that is not an array as no listing at all", () => {
		// `?? []` only substitutes for null/undefined. A host answering `files` as anything else
		// reaches the spread in the loop and throws from a position no catch is standing at, which
		// kills the run before a single page is rendered.
		expect(COMMAND).toContain("Array.isArray(files) ? files : []");
	});

	it("normalizes the art ROOT's trailing slash too, not only the prefix's", () => {
		// art-root.js `book2ArtRoot` does exactly this and says why. Copying one half of that pair
		// and not the other is the drift the prefix comment above warns about, one setting over: a
		// root typed as "my-art/" keys everything "my-art//assets/..." while the system side reads
		// "my-art/assets/...", and nothing matches across the two.
		expect(COMMAND).toContain('"stonetop-book-art").replace(/\\/+$/, "")');
	});

	it("never publishes an EMPTY prefix over an origin this world already recorded", () => {
		// A bare data-relative path satisfies `endsWith(key)` with nothing in front, so the first
		// match rule could derive "" from one leftover file — and that setting is what the system
		// side asks its second browse with, so clearing it blinds the browse world-wide from the
		// next load on. First NON-empty wins, matching browse.js's ArtInventory.
		expect(COMMAND).toContain("if (candidate) { prefix = candidate; break; }");
		expect(COMMAND).toContain('!(prefix === "" && storedPrefix)');
	});
});
