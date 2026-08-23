import { describe, it, expect } from "vitest";
import { readRepo as read } from "../fakes/css.js";

// The Import Book Art window's first page reports what this world ALREADY has.
//
// The wizard is built to be run more than once — a GM buys Book I months after Book II, downloads
// the free playbook later still, and comes back for their poster maps whenever they get the files
// off the shelf. Every page of it says "come back another time, nothing is lost". What it could
// not say, until now, was what a previous visit had actually landed: the window looked identical
// on a world holding all 545 pictures and on one where the run fell over at picture nine, so the
// only way to tell was to run it again and read the summary at the end.
//
// So the opening page asks the folder, and says. Everything here fails silently if it breaks: a
// report on the wrong page is a report nobody reads; a count off the wrong list is a wrong number
// wearing a confident green; zeroes painted before the walk answers say "you have imported
// nothing" at exactly the moment a GM would believe it.
//
// Reads the SHIPPED macro command, which is what a world executes, rather than any local copy of
// its source.

const COMMAND = JSON.parse(read("packs/src/stonetop-macros/import-book2-art.json")).command;

/** The rail panel body for one page, from its `panel(` call to the next one. */
function panel(key) {
	const at = COMMAND.indexOf(`panel("${key}",`);
	expect(at, `there is no "${key}" panel`).toBeGreaterThan(-1);
	const next = COMMAND.indexOf("+ panel(", at + 1);
	return COMMAND.slice(at, next > -1 ? next : at + 4000);
}

describe("what this world already has", () => {
	it("sits on the page the window opens on", () => {
		// The first entry of SETUP_SECTIONS is the panel `showPanel` opens on, and it is the only
		// page where this belongs: a GM deciding whether to dig a 300MB PDF out of their downloads
		// needs to know whether they already did that in March.
		expect(COMMAND).toContain(`{ key: "overview", title: "What this does"`);
		expect(panel("overview")).toContain("+ alreadyBlock");
	});

	it("names the same things the last page's recap names, off the same list", () => {
		// READY_ROWS is every book this manifest asks for, then the maps. Two lists would drift the
		// day a book moves between panels, and the two pages would then disagree about what this
		// window is even for.
		expect(COMMAND).toContain("const alreadyBlock = ");
		expect(COMMAND).toMatch(/const alreadyBlock = [\s\S]*?READY_ROWS\.map\(\(r, i\) =>/);
		expect(COMMAND).toContain(`<span class="stbook-ready-value" data-already="${"${i}"}"></span>`);
	});

	it("counts a book against the files that book would write, not its rows", () => {
		// `outsByBook` is built from the same walk the extraction's `wants` is (monsters and their
		// token squares, people and their portrait squares, steadings, treasures, pagemaps,
		// diagrams, location images), deduped per FILE. Several rows can name one file where the
		// book draws two creatures in a single picture, so a row count would quote a denominator
		// no complete import could ever reach — a world with every picture on disk reading "230 of
		// 246" is a bug report waiting to be filed against a folder that is perfectly fine.
		expect(COMMAND).toContain("const outsByBook = new Map();");
		expect(COMMAND).toContain("const outs = outsByBook.get(book) ?? new Set();");
		expect(COMMAND).toContain("for (const out of outs) if (files.has(keyOf(out))) have++;");
		// Said as a fraction only when it IS one. "245 of 245" invites a GM to hunt for the
		// difference between two numbers that are the same.
		expect(COMMAND).toContain("have >= total ? `all ${total} pictures` : `${have} of ${total} pictures`");
	});

	it("counts the poster maps by the Scene, because a Scene is what that step promises", () => {
		// A GM may point the maps page at an image already in their data, which builds a Scene
		// without writing a file of ours: counting files would report "none" on a world whose nav
		// bar is full of them. The file count survives as the fallback answer, and it means
		// something on its own — the picture landed and the Scene did not.
		expect(COMMAND).toContain("const built = MANIFEST.maps.filter((m) => posterMapScene(m)).length;");
		expect(COMMAND).toContain("const onDisk = MANIFEST.maps.filter((m) => files.has(keyOf(m.out))).length;");
		expect(COMMAND).toContain("onDisk ? `${onDisk} on disk, no scenes yet` : \"not imported yet\"");
	});

	it("recognises one of our Scenes however this package was named when it built it", () => {
		// module/book2-art/poster-map-catalog.js `isPosterMapScene` matches the flag then the name,
		// and reads the flag across every id this package has shipped under. The macro cannot
		// import it, so it asks the scope-blind version of the same question: any flag scope
		// carrying our key. Nothing here builds or renames anything, so a blind read costs at worst
		// a misreported row — where a scope-BOUND read costs a GM their Marshedge map going
		// unrecognised on a renamed install.
		expect(COMMAND).toContain("Object.values(sc.flags ?? {}).some((f) => f?.posterMap === map.slug) || sc.name === map.name");
	});

	it("shows no numbers until the folder has answered", () => {
		// The walk is seven directory listings, and on a hosted world each is a round trip. The page
		// opens immediately and fills in when the answer arrives, so the rows have to start hidden:
		// a row reading "not imported yet" beside every book is a claim, and it would be read as one.
		expect(COMMAND).toContain(`data-state="probing"`);
		expect(COMMAND).toContain('.stbook-already[data-state=\\"probing\\"] .stbook-already-rows{display:none}');
		// And a world with nothing imported keeps the sentence and drops the rows entirely.
		expect(COMMAND).toContain('.stbook-already[data-state=\\"none\\"] .stbook-already-rows{display:none}');
		expect(COMMAND).toContain('box.dataset.state = anything ? "some" : "none";');
	});

	it("says so when it cannot check, rather than reporting zeroes", () => {
		// The walk swallows a rejected browse per directory (that is "not there", which is honest),
		// so reaching the failure path means something else broke. A window that answered a broken
		// probe with four "not imported yet" rows would send a GM into a full re-import of art they
		// already have.
		expect(COMMAND).toContain('say.textContent = "This could not be checked, which changes nothing about the import below.";');
	});

	it("pays for the walk once, however the run gets to it", () => {
		// The dialog's report and the run's skip-what-is-already-there ask the same question. One
		// memoized promise, so a GM who reads the first page and then imports does not browse the
		// same seven directories twice — and the run cannot start a second walk while the dialog's
		// is still out.
		expect(COMMAND).toContain("const inventoryArt = () => (inventoryPromise ??= (async () => {");
		expect(COMMAND).toContain("if (artRun && CONFIG.SKIP_EXISTING) await inventoryArt();");
	});

	it("never makes the window wait on it", () => {
		// Not awaited, and its own failure is reported in the block it fills, so nothing can leave a
		// rejected promise loose in a render hook or hold the window shut on a slow host.
		expect(COMMAND).toMatch(/paintBadges\(root\);\n(?:\s*\/\/[^\n]*\n)*\s*paintAlready\(root\);/);
		expect(COMMAND).toContain("try { files = await inventoryArt(); }");
		expect(COMMAND).toContain('catch (e) { console.error("[Book II Art] inventory", e); }');
	});
});
