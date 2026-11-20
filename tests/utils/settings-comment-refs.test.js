import { describe, it, expect } from "vitest";
import { readRepo } from "../fakes/css.js";

// settings.js documents each setting by pointing at the code that reads or writes it
// ("see hooks/Ready.js _ensurePlayerActorCreationGrant"). When that code moves, the pointer is
// the one thing nothing else checks, and two were left naming functions that no longer existed
// anywhere. So every `hooks/<file>.js <identifier>` pointer must name something that file defines.
const SETTINGS = readRepo("module/settings.js");

describe("settings.js's pointers into hooks/", () => {
	const refs = [...SETTINGS.matchAll(/hooks\/([\w-]+\.js)(?:\s|\/\/)+(\w+)/g)]
		.map(([, file, name]) => ({ file, name }))
		// Identifiers only: "hooks/Ready.js reopens any that were still open" is prose.
		.filter(({ name }) => /[A-Z_]/.test(name));

	it("finds the pointers it is meant to check", () => {
		expect(refs.length).toBeGreaterThan(5);
		expect(refs).toContainEqual({ file: "PlaceOfInterestDrop.js", name: "revealLandmarkNotesOnce" });
		expect(refs).toContainEqual({ file: "Ready.js", name: "_assignGmToolkitToGm" });
	});

	it("names only what the file it points at defines", () => {
		for (const { file, name } of refs) {
			expect(readRepo(`module/hooks/${file}`), `hooks/${file} ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
		}
	});
});
