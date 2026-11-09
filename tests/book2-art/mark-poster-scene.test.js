import { describe, it, expect, afterEach } from "vitest";
import { stubAsk } from "../fakes/confirm.js";
import {
	askScenePosterMap, posterMapFlagUpdate, scenePosterMapMenuEntries, setScenePosterMap,
} from "../../module/book2-art/mark-poster-scene.js";
import { posterMapSlugOf, usablePosterScene } from "../../module/book2-art/poster-map-catalog.js";

// Marking a GM's own Scene as one of the poster maps (user report, 2026-11-04: a hand-made map
// Scene could not take the expedition route). The stamp is the `posterMap` flag the Import Book
// Art macro writes on the Scenes it builds.

/** A Scene stand-in whose `update` applies dotted paths and the `-=` deletion key. */
function fakeScene(id, flags = {}, name = id) {
	const doc = {
		id, name, width: 6000, height: 4714, flags,
		update: async changes => {
			for (const [path, value] of Object.entries(changes ?? {})) {
				const parts = path.split(".");
				const key = parts.pop();
				let node = doc;
				for (const part of parts) node = (node[part] ??= {});
				if (key.startsWith("-=")) delete node[key.slice(2)];
				else node[key] = value;
			}
		},
	};
	return doc;
}

const noPins = { scenes: [] };

describe("marking a scene as a poster map", () => {
	it("stamps the map, and the scene then reads as that map", async () => {
		const own = fakeScene("own");
		await setScenePosterMap(own, "vicinity", { scenes: [own] });
		expect(own.flags["stonetop-pwd"].posterMap).toBe("vicinity");
		expect(posterMapSlugOf(own)).toBe("vicinity");
		expect(usablePosterScene("vicinity", [own])).toBe(own);
	});

	it("takes a stamp left under an old package id off on the way past", () => {
		const own = fakeScene("own", { stonetop: { posterMap: "worlds-end" } });
		const update = posterMapFlagUpdate(own, "vicinity");
		expect(update["flags.stonetop-pwd.posterMap"]).toBe("vicinity");
		expect(Object.keys(update).some(k => k.startsWith("flags.stonetop.") && k.includes("posterMap"))).toBe(true);
	});

	it("keeps one scene per map: the other scene holding the stamp gives it up", async () => {
		const old = fakeScene("old", { "stonetop-pwd": { posterMap: "vicinity" } });
		const own = fakeScene("own");
		await setScenePosterMap(own, "vicinity", { scenes: [old, own] });
		expect(old.flags["stonetop-pwd"].posterMap).toBeUndefined();
		expect(own.flags["stonetop-pwd"].posterMap).toBe("vicinity");
	});

	it("unmarks with null", async () => {
		const own = fakeScene("own", { "stonetop-pwd": { posterMap: "vicinity" } });
		await setScenePosterMap(own, null, noPins);
		expect(own.flags["stonetop-pwd"].posterMap).toBeUndefined();
		expect(posterMapSlugOf(own)).toBeNull();
	});

	it("ignores a slug that is no map of ours", async () => {
		const own = fakeScene("own");
		await setScenePosterMap(own, "atlantis", noPins);
		expect(own.flags["stonetop-pwd"]?.posterMap).toBeUndefined();
	});
});

describe("the Scenes sidebar entry", () => {
	let prev;
	afterEach(() => {
		globalThis.foundry.applications.api.DialogV2 = prev;
		delete game.scenes;
	});

	it("offers every poster map and a way back off, and stamps the one picked", async () => {
		prev = globalThis.foundry?.applications?.api?.DialogV2;
		const own = fakeScene("own");
		game.scenes = [own];
		global.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
		const asked = stubAsk("worlds-end");
		await askScenePosterMap(own);
		const keys = asked.mock.calls[0][0].buttons.map(b => b.action);
		expect(keys).toEqual(["stonetop-village", "vicinity", "worlds-end", "marshedge", "gordins-delve", "none"]);
		expect(own.flags["stonetop-pwd"].posterMap).toBe("worlds-end");
	});

	it("is shown to the GM only", () => {
		const own = fakeScene("own");
		game.scenes = { get: id => (id === "own" ? own : null) };
		const [entry] = scenePosterMapMenuEntries();
		const row = { dataset: { entryId: "own" } };
		const wasUser = game.user;
		game.user = { isGM: true };
		expect(entry.visible(row)).toBe(true);
		game.user = { isGM: false };
		expect(entry.visible(row)).toBe(false);
		game.user = wasUser;
	});
});
