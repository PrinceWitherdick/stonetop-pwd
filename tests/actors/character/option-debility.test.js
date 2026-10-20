// The Heavy's Mighty Thews (Heavy re-audit, 2026-10-18): "you do it (OH YEAH!) but pick 1: ... It takes a
// toll (mark a debility)". The option was tickable on the posted card but marked nothing. Ticked, it now
// opens Unfettered's debility window (will-and-restraint.js#pickDebilityToMark) and marks the one picked;
// closing the window marks nothing, and unticking never un-marks.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";

const seams = vi.hoisted(() => ({ pick: vi.fn() }));
vi.mock("../../../module/actors/steading/steading-debilities.js", async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, openDebilityPicker: (...args) => seams.pick(...args) };
});

import { optionMarksDebility, wireOptionDebility, OPTION_DEBILITY_FLAG } from "../../../module/actors/character/option-debility.js";
import { moveChatCard } from "../../../module/utils/chat.js";
import { moveCardBody } from "../../../module/utils/move-tiers.js";

const SCOPE = "stonetop-pwd";
const THEWS_JSON = path.resolve("packs/src/stonetop-items/playbook-moves/the-heavy/mighty-thews.json");
const THEWS = JSON.parse(fs.readFileSync(THEWS_JSON, "utf8")).system;

/** A chat message whose flags live in a plain object, dotted keys and all, as Foundry's do. */
function card(flagsSeed = {}) {
	const flags = { [SCOPE]: { ...flagsSeed } };
	const walk = (key, make) => {
		const parts = key.split(".");
		let at = flags[SCOPE];
		for (const p of parts.slice(0, -1)) at = make ? (at[p] ??= {}) : at?.[p];
		return [at, parts.at(-1)];
	};
	return {
		id: "m1",
		speaker: { actor: "heavy" },
		getFlag: (scope, key) => { const [at, leaf] = walk(key, false); return scope === SCOPE ? at?.[leaf] : undefined; },
		setFlag: vi.fn(async (_scope, key, value) => { const [at, leaf] = walk(key, true); at[leaf] = value; }),
		unsetFlag: vi.fn(async (_scope, key) => { const [at, leaf] = walk(key, false); if (at) delete at[leaf]; }),
		canUserModify: () => true,
	};
}

function heavy(marked = []) {
	const markDebility = vi.fn(async () => true);
	return {
		id: "heavy", type: "character", name: "Brakka", isOwner: true,
		typedActor: {
			markDebility,
			debilityMarkChoices: ["weakened", "dazed"].map(key => ({ key, name: key[0].toUpperCase() + key.slice(1), description: "", marked: marked.includes(key) })),
		},
	};
}

let win;
let saved;
beforeEach(() => {
	win = new Window();
	saved = { document: globalThis.document, ChatMessage: globalThis.ChatMessage, actors: global.game.actors };
	globalThis.document = win.document;
	globalThis.ChatMessage = { create: vi.fn(), getSpeaker: vi.fn(() => ({ alias: "Brakka" })) };
	seams.pick = vi.fn();
});
afterEach(() => {
	globalThis.document = saved.document;
	globalThis.ChatMessage = saved.ChatMessage;
	global.game.actors = saved.actors;
});

/** Mighty Thews posted from the Moves tab, wired, with `actor` speaking. */
function posted(actor, message = card()) {
	global.game.actors = { get: id => (id === actor.id ? actor : null) };
	const root = win.document.createElement("div");
	root.innerHTML = moveChatCard("Mighty Thews", moveCardBody(THEWS.description, THEWS.moveResults));
	wireOptionDebility(message, root);
	const boxes = [...root.querySelectorAll(".stonetop-picklist-check")];
	const tick = (i, on = true) => { boxes[i].checked = on; boxes[i].dispatchEvent(new win.Event("change")); };
	return { root, message, boxes, tick };
}

describe("which options mark a debility", () => {
	it("is an option ending in \"(mark a debility)\"", () => {
		expect(optionMarksDebility("It takes a toll (mark a debility)")).toBe(true);
		expect(optionMarksDebility("  It takes a toll\n(mark a debility).  ")).toBe(true);
	});

	it("is not one that spares the debility, one with it mid-sentence, or one that clears one", () => {
		expect(optionMarksDebility("You adapt to the new form quickly (else, mark a debility)")).toBe(false);
		expect(optionMarksDebility("The land is barren or picked clean, hunger sets in (mark a debility), or you stumble into danger.")).toBe(false);
		expect(optionMarksDebility("Clear a debility")).toBe(false);
		expect(optionMarksDebility("The effort taxes you; mark a debility")).toBe(false);
	});

	it("is Mighty Thews' toll alone among every shipped list item (its move, and the reference journal's copy)", () => {
		const hits = [];
		const walk = dir => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) { walk(full); continue; }
				if (!entry.name.endsWith(".json")) continue;
				for (const [, li] of fs.readFileSync(full, "utf8").matchAll(/<li>(.*?)<\/li>/g)) {
					if (optionMarksDebility(li.replace(/<[^>]+>/g, ""))) hits.push(`${path.basename(full)}: ${li}`);
				}
			}
		};
		walk(path.resolve("packs/src"));
		expect(hits.sort()).toEqual([
			"mighty-thews.json: It takes a toll (mark a debility)",
			"playbook-moves.json: It takes a toll (mark a debility)",
		]);
	});
});

describe("Mighty Thews' toll, ticked on its card", () => {
	it("opens the debility window over the unmarked debilities, and marks the one picked", async () => {
		const actor = heavy(["dazed"]);
		const { message, tick } = posted(actor);
		tick(2);
		expect(seams.pick).toHaveBeenCalledTimes(1);
		const spec = seams.pick.mock.calls[0][0];
		expect(spec.title).toBe("Mighty Thews");
		expect(spec.marked.map(d => d.id)).toEqual(["weakened"]);
		await spec.onApply(spec.marked[0]);
		expect(actor.typedActor.markDebility).toHaveBeenCalledWith("weakened", { moveName: "Mighty Thews" });
		expect(message.getFlag(SCOPE, OPTION_DEBILITY_FLAG)).toEqual({ 2: { key: "weakened", name: "Weakened" } });
		expect(globalThis.ChatMessage.create.mock.calls[0][0].content).toContain("Brakka marks Weakened.");
	});

	it("marks nothing when the window is closed, and opens it again on the next tick", () => {
		const actor = heavy();
		const { message, tick } = posted(actor);
		tick(2);
		tick(2, false);
		tick(2);
		expect(seams.pick).toHaveBeenCalledTimes(2);
		expect(actor.typedActor.markDebility).not.toHaveBeenCalled();
		expect(message.setFlag).not.toHaveBeenCalled();
	});

	it("never un-marks on an untick, and never marks twice", async () => {
		const actor = heavy();
		const { message, tick, boxes } = posted(actor);
		tick(2);
		const spec = seams.pick.mock.calls[0][0];
		await spec.onApply(spec.marked[0]);
		tick(2, false);
		tick(2);
		expect(seams.pick).toHaveBeenCalledTimes(1);
		// A second window left open from before the mark cannot mark again either.
		await spec.onApply(spec.marked[1]);
		expect(actor.typedActor.markDebility).toHaveBeenCalledTimes(1);
		expect(message.unsetFlag).not.toHaveBeenCalled();
		// Rendered again, the option says what it marked.
		const again = posted(actor, message);
		expect(again.root.querySelector(".stonetop-option-debility-marked")?.textContent).toBe("Marked Weakened.");
		expect(boxes[2].dataset.optionDebilityWired).toBe("1");
	});

	it("asks nothing for the other options, or for someone who cannot write the character", () => {
		const { tick } = posted(heavy());
		tick(0);
		tick(1);
		expect(seams.pick).not.toHaveBeenCalled();
		const observer = { ...heavy(), isOwner: false };
		posted(observer).tick(2);
		expect(seams.pick).not.toHaveBeenCalled();
	});
});
