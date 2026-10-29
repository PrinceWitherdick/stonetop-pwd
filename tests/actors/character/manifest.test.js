// A Ghost's manifestation as a record (module/actors/character/manifest.js): audit GH-6, the user's ruling of
// 2026-10-27. It ends with a drop to 0 HP or a Tethered dispersal, in that same write.

import { beforeAll, describe, it, expect } from "vitest";

// Foundry's own setter, which the shared fakes leave out: dotted path into a nested object.
beforeAll(() => {
	globalThis.foundry.utils.setProperty ??= (object, key, value) => {
		const parts = key.split(".");
		let node = object;
		for (const part of parts.slice(0, -1)) node = node[part] ??= {};
		node[parts.at(-1)] = value;
		return true;
	};
});
import {
	manifestedPicks, manifestsHarmfulTouch, onPreUpdateActorManifest, MANIFEST_ENDED_OPTION,
} from "../../../module/actors/character/manifest.js";

const SCOPE = "stonetop-pwd";
const TOUCH = "Your touch (or ghostly weapons) can harm the living (ignores armor)";
const ghost = (insert = {}) => ({ type: "character", flags: { [SCOPE]: { postDeathInsert: { slug: "ghost", ...insert } } } });

describe("what a Ghost is manifest with", () => {
	it("reads the picks on a worn Ghost only", () => {
		expect(manifestedPicks(ghost({ manifest: [TOUCH] }))).toEqual([TOUCH]);
		expect(manifestsHarmfulTouch(ghost({ manifest: [TOUCH] }))).toBe(true);
		expect(manifestsHarmfulTouch(ghost({ manifest: ["You appear solid and whole, much as you did in life"] }))).toBe(false);
		// A record left behind on an insert taken away is stale.
		const removed = { type: "character", flags: { [SCOPE]: { postDeathInsert: { slug: null, manifest: [TOUCH] } } } };
		expect(manifestedPicks(removed)).toEqual([]);
	});
});

describe("the write that ends a manifestation", () => {
	const ended = changes => changes.flags?.[SCOPE]?.postDeathInsert && "-=manifest" in changes.flags[SCOPE].postDeathInsert;

	it("ends it with a drop to 0 HP, and with a dispersal that names out of the action", () => {
		const drop = { system: { attributes: { hp: { value: 0 } } } };
		onPreUpdateActorManifest(ghost({ manifest: [TOUCH] }), drop);
		expect(ended(drop)).toBe(true);

		const dispersal = { flags: { [SCOPE]: { deathsDoor: "out-of-action" } } };
		onPreUpdateActorManifest(ghost({ manifest: [TOUCH] }), dispersal);
		expect(ended(dispersal)).toBe(true);
	});

	it("leaves it be on a blow they survive, and writes nothing for a Ghost not manifest", () => {
		const hit = { system: { attributes: { hp: { value: 3 } } } };
		onPreUpdateActorManifest(ghost({ manifest: [TOUCH] }), hit);
		expect(ended(hit)).toBeFalsy();

		const drop = { system: { attributes: { hp: { value: 0 } } } };
		onPreUpdateActorManifest(ghost(), drop);
		expect(drop.flags).toBeUndefined();
	});

	// XS-5: We Happy Few's Keep 1 HP card reads this to say the manifestation stays ended.
	it("says on the options when the write ended one, and only then", () => {
		const options = {};
		onPreUpdateActorManifest(ghost({ manifest: [TOUCH] }), { system: { attributes: { hp: { value: 0 } } } }, options);
		expect(options[MANIFEST_ENDED_OPTION]).toBe(true);

		const survived = {};
		onPreUpdateActorManifest(ghost({ manifest: [TOUCH] }), { system: { attributes: { hp: { value: 3 } } } }, survived);
		onPreUpdateActorManifest(ghost(), { system: { attributes: { hp: { value: 0 } } } }, survived);
		expect(survived).toEqual({});
	});

	// The extra options' 1d4s can be what drops them: the manifestation that write records never lands.
	it("drops a manifestation recorded by the very write that takes them to 0", () => {
		const changes = { system: { attributes: { hp: { value: 0 } } }, flags: { [SCOPE]: { postDeathInsert: { manifest: [TOUCH] } } } };
		onPreUpdateActorManifest(ghost(), changes);
		expect(changes.flags[SCOPE].postDeathInsert).toEqual({});
	});
});
