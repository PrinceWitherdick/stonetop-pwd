import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every `icons/…` path in `packs/src` is one Foundry actually ships.
 *
 * Compendium documents point their artwork at two places: our own `systems/stonetop-pwd/assets/…`
 * files, and Foundry's bundled `icons/…` library. The second kind is the dangerous one, because
 * nothing in this repository can see it. The path is a bare string, the file lives in the Foundry
 * install, and a wrong one fails the way a wrong image path always fails in a browser: a blank
 * frame, no error, no log line.
 *
 * It had already happened five times over. The bestiary's move icons were assigned by keyword
 * from tooling that lives outside this repo, and five of the names it produced do not exist in
 * the core library at all: `playing-cards-grab`, `flame-burning-creature-orange`,
 * `wing-membrane-blue`, `cave-entrance-dark`, `tentacles-octopus-purple`. Between them they were
 * on 90 monster moves across 65 stat blocks, every one rendering an empty box. `isDefaultImg` in
 * module/utils/strings.js cannot rescue them either: it recognises the paths core uses as
 * PLACEHOLDERS, and a 404 is not one of those, so the thumbnail fallback never fires.
 *
 * AN ALLOWLIST, not a lookup. Resolving these against a Foundry install would only work on a
 * machine that has one, which CI does not; committing an index of the ~6000 core icon paths
 * would go stale silently. The list below is short because the bestiary reuses a small vocabulary
 * deliberately, and adding to it is exactly the moment to check the file exists.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "packs/src");

/**
 * The core icons this system uses, each verified present in a Foundry v13 install.
 *
 * Adding a path here: confirm it against `<foundry install>/public/icons` FIRST. The whole point
 * of the list is that it is the moment someone looks.
 */
const CORE_ICONS = new Set([
	"icons/creatures/abilities/mouth-teeth-rows-red.webp",
	"icons/creatures/abilities/wings-birdlike-blue.webp",
	"icons/creatures/claws/claw-curved-jagged-gray.webp",
	"icons/creatures/tentacles/tentacles-octopus-black-pink.webp",
	"icons/magic/acid/dissolve-bone-white.webp",
	"icons/magic/death/skull-energy-light-purple.webp",
	"icons/magic/fire/flame-burning-yellow-orange.webp",
	"icons/magic/lightning/bolt-strike-blue.webp",
	"icons/magic/nature/leaf-glow-green.webp",
	"icons/magic/water/snowflake-ice-blue.webp",
	"icons/skills/melee/strike-hammer-destructive-orange.webp",
	"icons/skills/movement/figure-running-gray.webp",
	"icons/skills/ranged/target-bullseye-arrow-blue.webp",
	"icons/skills/social/diplomacy-handshake.webp",
	"icons/skills/wounds/injury-hand-blood-red.webp",
	"icons/svg/burrow.svg",
	"icons/svg/net.svg",
	"icons/svg/shield.svg",
	"icons/svg/sword.svg",
	"icons/svg/terror.svg",
]);

/** The five names that were wrong, kept by name so they cannot quietly return. */
const KNOWN_BAD = [
	"icons/sundries/gaming/playing-cards-grab.webp",
	"icons/magic/fire/flame-burning-creature-orange.webp",
	"icons/creatures/abilities/wing-membrane-blue.webp",
	"icons/environment/wilderness/cave-entrance-dark.webp",
	"icons/creatures/tentacles/tentacles-octopus-purple.webp",
];

/**
 * Every `img` in every source doc, embedded items included, with the file it came from.
 *
 * `img` FIELDS ONLY, on purpose. `stonetop-macros/import-book2-art.json` carries a generated
 * script body that names `icons/svg/mystery-man.svg` and `icons/svg/item-bag.svg` inside escaped
 * JSON strings, but it names them to RECOGNISE them: they are the core placeholders the importer
 * checks against before it overwrites an image. They are comparisons, not artwork, and a scan
 * that swept raw text instead of fields would have to special-case them.
 */
function imagePaths() {
	const found = [];
	const unreadable = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) { walk(full); continue; }
			if (!entry.name.endsWith(".json")) continue;
			const where = path.relative(ROOT, full).replace(/\\/g, "/");
			let doc;
			// A file that will not parse is REPORTED, never skipped. Swallowing the error is
			// how a scan like this lies: the file drops out of the walk, every assertion below
			// still passes, and the checks read as green over a document nothing looked at.
			// Caught while testing this very test, where a stray UTF-8 BOM made one stat block
			// invisible and the deliberately-broken icon path in it went unnoticed.
			try { doc = JSON.parse(fs.readFileSync(full, "utf8")); } catch (err) {
				unreadable.push(`${where}: ${err.message}`);
				continue;
			}
			const visit = (node) => {
				if (!node || typeof node !== "object") return;
				if (Array.isArray(node)) { node.forEach(visit); return; }
				if (typeof node.img === "string") found.push({ img: node.img, where });
				for (const value of Object.values(node)) if (value && typeof value === "object") visit(value);
			};
			visit(doc);
		}
	};
	walk(SRC);
	return { found, unreadable };
}

describe("compendium artwork paths", () => {
	const { found: all, unreadable } = imagePaths();

	it("could read every source document", () => {
		expect(unreadable).toEqual([]);
	});

	it("finds images to check", () => {
		expect(all.length).toBeGreaterThan(100);
	});

	it("uses only core icons known to exist", () => {
		const bad = all
			.filter(e => e.img.startsWith("icons/") && !CORE_ICONS.has(e.img))
			.map(e => `${e.img}  <- ${e.where}`);
		expect([...new Set(bad)]).toEqual([]);
	});

	it("has not resurrected any of the five paths that never existed", () => {
		for (const missing of KNOWN_BAD) {
			expect(all.filter(e => e.img === missing).map(e => e.where)).toEqual([]);
		}
	});

	it("points its own artwork at this system's real files, case-exactly", () => {
		// Same NTFS-versus-Forge trap as the manifest test: a wrong-case path opens fine on the
		// maintainer's machine and 404s on a hosted Linux server.
		const prefix = "systems/stonetop-pwd/";
		const ours = all.filter(e => e.img.startsWith(prefix));

		const broken = [];
		for (const entry of ours) {
			const rel = entry.img.slice(prefix.length).split("?")[0];
			// Book art is imported by the GM into directories this repo deliberately does not
			// contain, so those references are absent BY DESIGN and are checked by
			// tests/book2-art/art-not-tracked.test.js instead.
			if (/^assets\/(bestiary|locations|maps|treasures|people|steading|diagrams)\//.test(rel)) continue;

			const parts = rel.split("/").filter(Boolean);
			let dir = ROOT, ok = true;
			for (const part of parts) {
				let entries;
				try { entries = fs.readdirSync(dir); } catch { ok = false; break; }
				if (!entries.includes(part)) { ok = false; break; }
				dir = path.join(dir, part);
			}
			if (!ok) broken.push(`${entry.img}  <- ${entry.where}`);
		}
		expect([...new Set(broken)]).toEqual([]);
	});
});
