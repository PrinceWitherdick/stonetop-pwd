import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { PortraitFrameDialog } from "../../module/utils/PortraitFrameDialog.js";
import { actorFrameHandle, followerFrameHandle } from "../../module/utils/portrait-frame-handles.js";

// The rail's "this is not Tokenizer" note.
//
// Two tools sit a few pixels apart on a sheet header and do different jobs: this dialog chooses
// the SQUARE of a portrait the sheets show, Tokenizer makes the pog that goes on the MAP. The note
// says so, and it appears only when both are genuinely on offer — otherwise it introduces a tool
// the reader has not got and cannot act on.

// getData routes its paths through Foundry's own helper, which the shared setup has no need of.
globalThis.foundry.utils.getRoute = (path) => `/${path}`;

afterEach(() => { delete globalThis.game.modules; });

/** A `game.modules` registry answering the way Foundry's does. */
function installTokenizer({ active = true, api = { launch: vi.fn() } } = {}) {
	globalThis.game.modules = { get: (id) => (id === "vtta-tokenizer" ? { active, api } : undefined) };
}

const ACTOR = { id: "abc", name: "Bryn", img: "worlds/w/bryn.webp", isOwner: true, flags: {} };

/** The dialog as every caller builds it: a handle, and the picture to frame. */
const dialogFor = (handle) =>
	new PortraitFrameDialog({ handle, img: handle?.img ?? "" });

describe("the frame dialog's Tokenizer note", () => {
	it("is shown when Tokenizer is installed and an actor is being framed", () => {
		installTokenizer();
		expect(dialogFor(actorFrameHandle(ACTOR)).getData().showTokenizerNote).toBe(true);
	});

	it("is hidden when Tokenizer is not installed", () => {
		// The whole point of the note is to tell two available things apart. With one of them
		// absent it is a paragraph about a button the reader cannot see.
		globalThis.game.modules = { get: () => undefined };
		expect(dialogFor(actorFrameHandle(ACTOR)).getData().showTokenizerNote).toBe(false);
	});

	it("is hidden when the module is installed but disabled", () => {
		installTokenizer({ active: false });
		expect(dialogFor(actorFrameHandle(ACTOR)).getData().showTokenizerNote).toBe(false);
	});

	it("is hidden for a follower card, which has no token in its story at all", () => {
		// A follower is a flag rather than a document: Tokenizer has nothing to tokenize, so the
		// contrast the note draws would raise a question instead of answering one. Same gate the
		// tokenize pip uses, so the note and the button cannot come to disagree.
		installTokenizer();
		const follower = followerFrameHandle(
			{ ...ACTOR, flags: { "stonetop-pwd": { "crew.details": { img: "worlds/w/crew.webp" } } } },
			"crew.details", { editable: true });
		// Asserted, so this cannot pass merely because the handle came back null.
		expect(follower, "no follower handle to frame with").toBeTruthy();
		expect(follower.actor).toBeUndefined();
		expect(dialogFor(follower).getData().showTokenizerNote).toBe(false);
	});

	it("still answers the stage paths it has always answered", () => {
		// The note rides along in the same payload; a thrown getData is a dialog that opens empty.
		installTokenizer();
		const data = dialogFor(actorFrameHandle(ACTOR)).getData();
		expect(data.stageSrc).toContain("bryn.webp");
		expect(data.fallbackSrc).toContain("bryn.webp");
	});
});

// The arrow keys nudge the square only from inside the dialog (_bindKeys listens on the dialog root).
// The stage's pointerdown cancels the press's default, which also cancels the focus a click gives, so
// a press on the picture then an arrow did nothing until the stage was tabbed to. The press now hands
// the stage the keyboard itself.
describe("the frame dialog's arrow keys", () => {
	function staged() {
		const window = new Window();
		const document = window.document;
		const root = document.createElement("div");
		root.innerHTML = `<div class="stonetop-frame-stage" tabindex="0" data-keyboard-focus="true"></div>`;
		document.body.append(root);
		const dialog = dialogFor(actorFrameHandle(ACTOR));
		dialog._root = root;
		dialog._stageEl = root.querySelector(".stonetop-frame-stage");
		dialog._stageEl.setPointerCapture = vi.fn();
		dialog._stage = { w: 400, h: 400 };
		dialog._rect = [0.25, 0.25, 0.5, 0.5];
		dialog._paint = vi.fn();
		dialog._bindPointer();
		dialog._bindKeys();
		return { dialog, root, stage: dialog._stageEl, window, document };
	}

	it("a press on the picture gives it the keyboard, and an arrow then moves the square", () => {
		const { dialog, stage, window, document } = staged();
		const { PointerEvent, KeyboardEvent } = window;
		stage.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 150, clientY: 150, bubbles: true, cancelable: true }));
		stage.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true }));
		expect(document.activeElement).toBe(stage);
		const before = dialog._rect[0];
		// Foundry's keybindings listen on the window: the arrow that moves the square must not pan the scene.
		const foundry = vi.fn();
		window.addEventListener("keydown", foundry);
		document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
		expect(dialog._rect[0]).toBeGreaterThan(before);
		expect(foundry).not.toHaveBeenCalled();
		// A key the square doesn't use (Escape) still reaches it.
		document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		expect(foundry).toHaveBeenCalledTimes(1);
	});

	it("marks both editors' stage data-keyboard-focus, which Foundry's keybindings stand down for", () => {
		for (const file of ["templates/dialogs/portrait-frame.hbs", "templates/dialogs/playbook-emblem-cut.hbs"]) {
			expect(readFileSync(file, "utf8"), file).toMatch(/class="stonetop-frame-stage"[^>]*data-keyboard-focus="true"/);
		}
	});

	it("leaves an arrow to a focused field alone", () => {
		const { dialog, root, window, document } = staged();
		const { KeyboardEvent } = window;
		const field = document.createElement("input");
		root.append(field);
		const before = [...dialog._rect];
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
		expect(dialog._rect).toEqual(before);
	});
});
