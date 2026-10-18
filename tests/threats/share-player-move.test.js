import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildCustomPlayerMoves } from "../../module/journal/card-vm.js";
import { sharedMoveSeed, wireGmPrepCard, wireSharePlayerMoves } from "../../module/threats/threat-view.js";
import { CustomMoveDialog } from "../../module/actors/character/dialogs/CustomMoveDialog.js";

// A threat's or hazard's custom player move, handed to the players (Book I p.294, p.388: "When the
// PCs encounter the hazard and the move becomes relevant, share it with the players"). The GM's
// "Give to players" button opens the custom-move editor filled in with the move; saving makes a
// world move the players can drag onto their sheets, through the same saver as Create Item > Move.

const plain = async html => html;

beforeEach(() => {
	global.game = { i18n: global.game.i18n, user: { isGM: true } };
	global.Handlebars ??= { helpers: {} };
	global.Handlebars.helpers.statLabel ??= k => k.toUpperCase();
});
afterEach(() => vi.restoreAllMocks());

describe("the player moves on a card", () => {
	it("keep their place in the stored list, blank rows and all, so a button finds its move", async () => {
		const moves = await buildCustomPlayerMoves({ customPlayerMoves: [
			{ label: "", text: "" },
			{ label: "Breathe the stench", text: "<p>Roll +CON.</p>" },
		] }, plain);
		expect(moves).toHaveLength(1);
		expect(moves[0]).toMatchObject({ label: "Breathe the stench", index: 1, canShare: true });
	});

	it("offer the button to a GM only", async () => {
		global.game.user.isGM = false;
		const [move] = await buildCustomPlayerMoves({ customPlayerMoves: [{ label: "A", text: "x" }] }, plain);
		expect(move.canShare).toBe(false);
	});

	it("draw the button only where it may be pressed", async () => {
		const tpl = "systems/stonetop-pwd/templates/journal/partials/card-player-moves.hbs";
		const gm = await renderTemplate(tpl, { hasCustomMoves: true, customPlayerMoves: [{ label: "A", text: "x", index: 3, canShare: true }] });
		expect(gm).toContain('class="threat-player-move__share" data-move-index="3"');
		const player = await renderTemplate(tpl, { hasCustomMoves: true, customPlayerMoves: [{ label: "A", text: "x", index: 3, canShare: false }] });
		expect(player).not.toContain("threat-player-move__share");
	});
});

describe("Give to players", () => {
	function click(root, index) {
		const btn = { dataset: { moveIndex: String(index) } };
		return root.handler({
			target: { closest: sel => (sel === ".threat-player-move__share" ? btn : null) },
			preventDefault() {}, stopPropagation() {},
		});
	}

	it("opens the custom-move editor filled in with the move, saving to a world move", async () => {
		const opened = [];
		vi.spyOn(CustomMoveDialog.prototype, "render").mockImplementation(function () { opened.push(this); return this; });
		const page = { name: "The Maw", system: { customPlayerMoves: [
			{ label: "Stench", text: "<p>When you breathe in the horrible stench of the Maw, roll +CON.</p>" },
		] } };
		const root = { addEventListener: (type, fn) => { root.handler = fn; } };
		wireSharePlayerMoves(root, () => page);
		await click(root, 0);
		expect(opened).toHaveLength(1);
		const dialog = opened[0];
		expect(dialog._saver.world).toBe(true);
		const data = dialog.getData();
		expect(data.isEdit).toBe(false);
		expect(data.name).toBe("Stench");
		expect(data.description).toContain("When you breathe in the horrible stench of the Maw, roll +CON.");
	});

	it("does nothing for a player, or for a move that is not there", async () => {
		const render = vi.spyOn(CustomMoveDialog.prototype, "render").mockImplementation(function () { return this; });
		const page = { name: "X", system: { customPlayerMoves: [] } };
		const root = { addEventListener: (type, fn) => { root.handler = fn; } };
		wireSharePlayerMoves(root, () => page);
		await click(root, 0);
		global.game.user.isGM = false;
		await click(root, 0);
		expect(render).not.toHaveBeenCalled();
	});

	it("names an unlabelled move after its threat", () => {
		expect(sharedMoveSeed({ label: "", text: "x" }, "Sajra").name).toBe("Sajra: player move");
	});
});

describe("a GM-prep card's wiring, one call per host", () => {
	it("wires the doom track, the sharing and the kind's own controls, all with the host's resolver", () => {
		const types = [];
		const root = { addEventListener: type => types.push(type) };
		const resolve = () => null;
		const extras = vi.fn();
		wireGmPrepCard(root, resolve, extras);
		expect(types).toEqual(["change", "click"]);
		expect(extras).toHaveBeenCalledWith(root, resolve);
		expect(() => wireGmPrepCard(root, resolve)).not.toThrow();
	});
});
