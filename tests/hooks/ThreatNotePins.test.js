import { describe, it, expect, vi, beforeEach } from "vitest";

// A GM-prep pin is textured in ONE place (the preCreate seam) and, since sites stopped wearing a
// threat’s torn note, brought up to date in one more (the refit sweep). What is under test is that
// the two agree about what each kind looks like, and that neither touches a pin that is not ours.

// Only the page RESOLVER is stubbed. The pin table in the same module is the thing under test
// here, so it stays real: a mock of it would agree with itself no matter what the kinds declare.
const h = vi.hoisted(() => ({ pages: new Map() }));
vi.mock("../../module/journal/gm-prep-page.js", async (importOriginal) => ({
	...(await importOriginal()),
	gmPrepPageById: (entryId, pageId) => h.pages.get(entryId + ":" + pageId) ?? null,
}));

const { SITE_PIN_ICON_SUFFIX, THREAT_PIN_ICON_SUFFIX, gmPrepPinTexture, onPreCreateThreatNote, refitGmPrepPins } =
	await import("../../module/hooks/ThreatNotePins.js");
const { SYSTEM_ID } = await import("../../module/system-id.js");
const { asColor } = await import("../fakes/color.js");

const SITE_ICON = "systems/" + SYSTEM_ID + "/" + SITE_PIN_ICON_SUFFIX;
const THREAT_ICON = "systems/" + SYSTEM_ID + "/" + THREAT_PIN_ICON_SUFFIX;
const INK = "#1b1009";

/** File a page under an entry/page id pair, the way a Note links to one. */
function filePage(entryId, pageId, page) {
	h.pages.set(entryId + ":" + pageId, page);
	return { entryId, pageId };
}

/** A pending Note document, with core’s updateSource recording what we stamped on it. */
function pendingNote() {
	const note = { updated: null, updateSource(change) { this.updated = change; } };
	return note;
}

describe("GM-prep map pins", () => {
	beforeEach(() => {
		h.pages.clear();
		globalThis.CONST = { TEXT_ANCHOR_POINTS: { BOTTOM: 1 } };
	});

	it("draws a dropped site as the Sites tab’s own mound, inked so it reads on cream book art", () => {
		const link = filePage("sites-entry", "p1", { name: "The Barrow", type: "site" });
		const note = pendingNote();

		onPreCreateThreatNote(note, link);

		expect(note.updated.texture.src).toBe(SITE_ICON);
		// The tab glyph is authored white for a CSS mask; untinted it would be invisible on a map.
		expect(note.updated.texture.tint).toBe(INK);
		expect(note.updated.text).toBe("The Barrow");
	});

	it("leaves a threat pin wearing the torn note", () => {
		const link = filePage("threats-entry", "p2", { name: "The Lichen", type: "threat" });
		const note = pendingNote();

		onPreCreateThreatNote(note, link);

		expect(note.updated.texture.src).toBe(THREAT_ICON);
		expect(note.updated.texture.tint).toBe("#ffffff");
	});

	it("ignores a note that links to no prep page at all", () => {
		const note = pendingNote();

		onPreCreateThreatNote(note, { entryId: "someone-elses", pageId: "p3" });

		expect(note.updated).toBeNull();
	});

	it("re-draws a site pinned before sites had their own glyph, and leaves everything else alone", async () => {
		const site = filePage("sites-entry", "p1", { name: "The Barrow", type: "site" });
		const threat = filePage("threats-entry", "p2", { name: "The Lichen", type: "threat" });
		const scene = {
			notes: [
				{ id: "old-site", ...site, texture: { src: THREAT_ICON, tint: "#ffffff" } },
				{ id: "threat", ...threat, texture: { src: THREAT_ICON, tint: "#ffffff" } },
				// The GM pointed this one at art of their own. A pass that runs every load and
				// stomps that decision would stomp it forever.
				{ id: "hand-picked", ...site, texture: { src: "icons/svg/door-closed.svg", tint: "#ffffff" } },
				{ id: "theirs", entryId: "someone-elses", pageId: "p9", texture: { src: THREAT_ICON } },
			],
			updateEmbeddedDocuments: vi.fn(async () => {}),
		};

		const written = await refitGmPrepPins({ scenes: [scene], isGM: true });

		expect(written).toBe(1);
		expect(scene.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
		const [type, updates] = scene.updateEmbeddedDocuments.mock.calls[0];
		expect(type).toBe("Note");
		expect(updates).toEqual([{ _id: "old-site", texture: gmPrepPinTexture("site") }]);
	});

	it("writes nothing on a world whose pins already agree", async () => {
		const site = filePage("sites-entry", "p1", { name: "The Barrow", type: "site" });
		const scene = {
			notes: [{ id: "site", ...site, texture: { src: SITE_ICON, tint: INK } }],
			updateEmbeddedDocuments: vi.fn(async () => {}),
		};

		expect(await refitGmPrepPins({ scenes: [scene], isGM: true })).toBe(0);
		expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("writes nothing when a live pin hands its tint back as a Color", async () => {
		// The shape the test above CANNOT catch, and the one every real world is in. A stored tint
		// is a string; the tint read off a Note document is a `Color`, because that is what
		// ColorField#initialize returns. Compared with ===, no pin ever agrees, so this pass
		// rewrites every prep pin on every scene on every load for every GM — which is the exact
		// opposite of the "silent once they agree" contract that makes it safe to run at boot.
		const site = filePage("sites-entry", "p1", { name: "The Barrow", type: "site" });
		const scene = {
			notes: [{ id: "site", ...site, texture: { src: SITE_ICON, tint: asColor(INK) } }],
			updateEmbeddedDocuments: vi.fn(async () => {}),
		};

		expect(await refitGmPrepPins({ scenes: [scene], isGM: true })).toBe(0);
		expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("still re-draws a pin whose Color is genuinely the wrong one", async () => {
		// The other half of the same seam: reading a Color must not become "agree with anything".
		const site = filePage("sites-entry", "p1", { name: "The Barrow", type: "site" });
		const scene = {
			notes: [{ id: "site", ...site, texture: { src: SITE_ICON, tint: asColor("#ffffff") } }],
			updateEmbeddedDocuments: vi.fn(async () => {}),
		};

		expect(await refitGmPrepPins({ scenes: [scene], isGM: true })).toBe(1);
		expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith("Note", [
			{ _id: "site", texture: gmPrepPinTexture("site") },
		]);
	});

	it("does nothing for a player, who cannot write another table’s scenes anyway", async () => {
		const site = filePage("sites-entry", "p1", { name: "The Barrow", type: "site" });
		const scene = {
			notes: [{ id: "old-site", ...site, texture: { src: THREAT_ICON, tint: "#ffffff" } }],
			updateEmbeddedDocuments: vi.fn(async () => {}),
		};

		expect(await refitGmPrepPins({ scenes: [scene], isGM: false })).toBe(0);
		expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});
});
