import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repaintOpenSteadingRosters } from "../../../module/actors/steading/steading-people.js";

// The steading roster renders LIVE off the linked actors — an NPC's occupation/traits/notes
// on Residents & Neighbors, a character's portrait and playbook on Players. Foundry only
// auto-re-renders a sheet when its OWN document changes, so without this hook a picture
// swapped on a character sheet stayed stale on an open steading until an F5.

let steadings;

/** A steading stub with one open sheet, listing the given rows. */
function makeSteading(people, { open = true } = {}) {
	const render = vi.fn();
	return {
		id: "steading-1",
		type: "stonetop",
		apps: open ? { app1: { render } } : {},
		flags: { "stonetop-pwd": { steading: { ...people } } },
		render,
	};
}

beforeEach(() => {
	steadings = [];
	global.game.actors = { get contents() { return steadings; } };
});

afterEach(() => { delete global.game.actors; });

describe("repaintOpenSteadingRosters", () => {
	it("repaints an open steading when a listed character's portrait changes", () => {
		const steading = makeSteading({ players: [{ id: "pc1", uuid: "Actor.pc1", name: "Tavi", img: "old.webp" }] });
		steadings.push(steading);

		repaintOpenSteadingRosters({ type: "character", id: "pc1", uuid: "Actor.pc1", name: "Tavi" });

		expect(steading.render).toHaveBeenCalledWith(false);
	});

	// A player row added before the drag handler stamped an id carries only a name, and
	// that is exactly how the sheet resolves its live actor for those rows.
	it("matches an older id-less player row by name", () => {
		const steading = makeSteading({ players: [{ name: "Tavi" }] });
		steadings.push(steading);

		repaintOpenSteadingRosters({ type: "character", id: "pc1", uuid: "Actor.pc1", name: "  TAVI " });

		expect(steading.render).toHaveBeenCalledWith(false);
	});

	// Serves deleteActor as well: the deleted actor is already out of game.actors (these
	// fakes never hold it), but the ROW still points at it, so the match still lands and the
	// roster repaints to its cached fallback instead of showing a person who no longer exists.
	it("repaints when a listed actor is deleted out from under the row", () => {
		const steading = makeSteading({ residents: [{ id: "npc1", uuid: "Actor.npc1", name: "Marek" }] });
		steadings.push(steading);

		repaintOpenSteadingRosters({ type: "npc", id: "npc1", uuid: "Actor.npc1", name: "Marek" });

		expect(steading.render).toHaveBeenCalledWith(false);
	});

	it("still repaints for a listed resident or neighbor NPC", () => {
		const residentsOnly = makeSteading({ residents: [{ id: "npc1", uuid: "Actor.npc1", name: "Marek" }] });
		const neighborsOnly = makeSteading({ neighbors: [{ id: "npc2", uuid: "Actor.npc2", name: "Fenrick" }] });
		steadings.push(residentsOnly, neighborsOnly);

		repaintOpenSteadingRosters({ type: "npc", id: "npc2", uuid: "Actor.npc2", name: "Fenrick" });

		expect(neighborsOnly.render).toHaveBeenCalledWith(false);
		expect(residentsOnly.render).not.toHaveBeenCalled();
	});

	// An NPC sharing a name with a resident is still a different person: NPC rows resolve
	// strictly by uuid/id on the sheet, so the repaint must not widen that to names.
	it("does not match an NPC row by name alone", () => {
		const steading = makeSteading({ residents: [{ name: "Marek" }] });
		steadings.push(steading);

		repaintOpenSteadingRosters({ type: "npc", id: "npc9", uuid: "Actor.npc9", name: "Marek" });

		expect(steading.render).not.toHaveBeenCalled();
	});

	it("leaves a steading alone when the actor is on none of its lists", () => {
		const steading = makeSteading({ players: [{ id: "pc1", name: "Tavi" }], residents: [{ id: "npc1", name: "Marek" }] });
		steadings.push(steading);

		repaintOpenSteadingRosters({ type: "character", id: "pc7", uuid: "Actor.pc7", name: "Someone Else" });

		expect(steading.render).not.toHaveBeenCalled();
	});

	// A character's Players row and an NPC's Residents row are separate lists; a character
	// must not repaint on a resident match (nor the reverse).
	it("does not cross the character and NPC lists", () => {
		const steading = makeSteading({ residents: [{ id: "pc1", uuid: "Actor.pc1", name: "Tavi" }] });
		steadings.push(steading);

		repaintOpenSteadingRosters({ type: "character", id: "pc1", uuid: "Actor.pc1", name: "Tavi" });

		expect(steading.render).not.toHaveBeenCalled();
	});

	it("ignores actor types the roster never lists, and steadings with no open sheet", () => {
		const closed = makeSteading({ players: [{ id: "pc1", name: "Tavi" }] }, { open: false });
		const open = makeSteading({ players: [{ id: "pc1", name: "Tavi" }] });
		steadings.push(closed, open);

		repaintOpenSteadingRosters({ type: "monster", id: "pc1", uuid: "Actor.pc1", name: "Tavi" });
		expect(open.render).not.toHaveBeenCalled();

		repaintOpenSteadingRosters({ type: "character", id: "pc1", uuid: "Actor.pc1", name: "Tavi" });
		expect(closed.render).not.toHaveBeenCalled();
		expect(open.render).toHaveBeenCalledWith(false);
	});
});

// Another settlement's Residents table reads its NPCs live too (StonetopSettlementSheet), so an
// open settlement sheet listing the NPC repaints. Its rows match by uuid alone: a settlement row's
// `id` is the row's own, and an NPC whose id happened to equal it is not that resident.
describe("repaintOpenSteadingRosters on a settlement", () => {
	const settlement = (residents, render = vi.fn()) => ({
		id: "set1", type: "settlement", apps: { app1: { render } }, system: { residents }, render,
	});

	it("repaints an open settlement sheet listing the NPC", () => {
		const marshedge = settlement([{ id: "row1", uuid: "Actor.npc1", name: "Brennan" }]);
		steadings.push(marshedge);
		repaintOpenSteadingRosters({ type: "npc", id: "npc1", uuid: "Actor.npc1", name: "Brennan" });
		expect(marshedge.render).toHaveBeenCalledWith(false);
	});

	it("leaves it alone for an NPC it does not list, even one whose id is a row's", () => {
		const marshedge = settlement([{ id: "npc2", uuid: "Actor.npc1", name: "Brennan" }]);
		steadings.push(marshedge);
		repaintOpenSteadingRosters({ type: "npc", id: "npc2", uuid: "Actor.npc2", name: "Ailen" });
		expect(marshedge.render).not.toHaveBeenCalled();
	});
});
