import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DURABLE_ART_DIRS } from "../../module/book2-art/browse.js";

/**
 * NO PDF-DERIVED ART IN THIS REPOSITORY, and no way for it to arrive by accident.
 *
 * The system ships with none of the book's illustrations. A GM runs Import Book Art against
 * their own legally-owned PDFs and the extracted images land in DURABLE_ART_DIRS. Those
 * directories are the maintainer's exposure: this checkout sits inside Foundry's own
 * `Data/systems/`, so the importer can write into the working tree of a PUBLIC repository. A
 * leak there is not a bug that gets fixed in the next release; it is a copyright violation
 * published under the maintainer's name, and git remembers it after the file is deleted.
 *
 * THREE COPIES OF ONE LIST, which is the whole reason this test exists. `DURABLE_ART_DIRS`
 * says where the importer writes; `.gitignore` stops those paths being committed;
 * `release.yml` holds the third as its `ART_DIRS` and checks it TWICE, once against the
 * checkout and once against the zip built from it. Nothing connected the three, and they
 * drifted exactly as you would expect: for most of this system's life the importer wrote
 * seven directories while the other two lists named the three it wrote when they were first
 * typed. The four unguarded ones (treasures, people, steading, diagrams) were one
 * `git add -A` from public.
 *
 * The copy in `release.yml` deliberately stays hardcoded rather than reading this array at
 * release time: it is the last gate before an irreversible upload and it should not depend on
 * a module path resolving or a parse succeeding. This test is what keeps the copies honest,
 * and it runs inside `npm test`, which `release.yml` itself runs before either guard.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** `git ls-files` under one path. Untracked files are invisible to it, which is the point. */
function tracked(rel) {
	const out = execFileSync("git", ["ls-files", "--", rel], { cwd: ROOT, encoding: "utf8" });
	return out.split("\n").filter(Boolean);
}

/**
 * DURABLE_ART_DIRS is written art-root-relative, because the importer's root is a SETTING and
 * normally points outside the system directory entirely. The repo-relative question this test
 * asks is only meaningful for the in-system layout, which is the one that leaks.
 */
const artDirs = DURABLE_ART_DIRS.map(d => d.replace(/^\/+|\/+$/g, ""));

describe("private art cannot reach this repository", () => {
	it("names the seven directories the importer writes", () => {
		// A canary on the array itself. Something has to fail when an eighth directory is
		// added, or the two lists below get widened by a person who remembered, or not at all.
		expect(artDirs).toEqual([
			"assets/bestiary", "assets/locations", "assets/maps",
			"assets/treasures", "assets/people", "assets/steading", "assets/diagrams",
		]);
	});

	it.each(artDirs)("%s is gitignored", (dir) => {
		const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
		const lines = gitignore.split("\n").map(l => l.trim());

		// The exact literal line, not a pattern match. Writing a .gitignore parser here would
		// mean this test could agree with itself about a rule git reads differently.
		//
		// The trailing slash and the lack of a leading one both matter. `assets/people/` is
		// root-anchored (it contains a slash) and directory-only. A bare `people/` would match
		// at ANY depth and would silently swallow `assets/icons/people`, which is our own
		// drawn iconography and has to stay tracked.
		expect(lines).toContain(`${dir}/`);
	});

	it.each(artDirs)("%s has nothing tracked in it", (dir) => {
		expect(tracked(dir)).toEqual([]);
	});

	it("release.yml's ART_DIRS names every one of them", () => {
		// The workflow keeps ONE copy, as a job-level env var, so its two guards cannot end up
		// checking different lists. This asserts that copy; the test below asserts both guards
		// still read it.
		const yml = fs.readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
		const block = yml.slice(yml.indexOf("ART_DIRS:"), yml.indexOf("\njobs:"));
		expect(block, "no ART_DIRS ahead of jobs: in release.yml").not.toBe("");
		for (const dir of artDirs) expect(block).toContain(dir);
	});

	it.each([
		"Verify the checkout before it is zipped",
		"Verify the zip that will ship",
	])("release.yml's %s step still reads that list", (name) => {
		// Two gates, because a clean tree is only EVIDENCE about the artifact. The zip is
		// assembled by a hand-maintained include list, and it is what a user receives.
		//
		// Naming the steps rather than pattern-matching the file: renaming one of them should
		// fail here and make whoever renamed it look at both gates, which is exactly what
		// happened when the second one was added.
		const yml = fs.readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
		const from = yml.indexOf(`- name: ${name}`);
		expect(from, `no step named "${name}" in release.yml`).toBeGreaterThan(-1);

		// To the next step at the same indent, so this cannot pass on a later step's mention.
		const next = yml.indexOf("\n      - ", from);
		const step = yml.slice(from, next === -1 ? undefined : next);

		// COMMENTS STRIPPED, because every one of these steps explains itself and the word
		// ART_DIRS appears in that explanation. Matching the whole step body passed happily
		// against a guard whose loop had been rewritten to a single hardcoded directory: the
		// prose still said ART_DIRS, so the test still agreed. Only executable lines count.
		const code = step
			.split("\n")
			.filter(l => !/^\s*(#|\/\/)/.test(l))
			.join("\n");
		expect(code, `${name} no longer reads $ART_DIRS in any executable line`)
			.toContain("ART_DIRS");
	});

	/**
	 * The backstop for everything the three lists do not think of.
	 *
	 * Every list above is a list of KNOWN destinations. This one inverts the question and asks
	 * what raster images are tracked at all, so art landing somewhere nobody predicted (a new
	 * importer destination, a file dragged into assets/ by hand, a stray screenshot) fails
	 * here rather than shipping. Our own artwork is SVG or lives in the two icon/graphic
	 * directories, so the allowlist is small and stays small.
	 */
	it("tracks no raster image outside the directories that hold our own art", () => {
		// Deliberately the exact set in use, not a roomier one that would be easier to keep
		// green. Widening this list should be a decision someone makes on purpose, with the
		// question "is this ours to publish?" in front of them.
		const ALLOWED = ["assets/graphics/", "assets/icons/", ".github/screenshots/"];
		const rasters = tracked(".").filter(f => /\.(webp|png|jpe?g|gif|avif|bmp|tiff?)$/i.test(f));

		// A real floor, so the assertion cannot pass by matching nothing at all.
		expect(rasters.length).toBeGreaterThan(30);
		expect(rasters.filter(f => !ALLOWED.some(a => f.startsWith(a)))).toEqual([]);
	});
});
