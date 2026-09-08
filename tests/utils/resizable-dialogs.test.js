import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { enableAutoHeightVerticalResize } from "../../module/utils/resizable-dialogs.js";

// A stand-in for core's V1 Application: records every position it is handed so a test can
// see what survived the patch, and exposes the jQuery-ish `element` the patch marks.
class FakeApp {
	constructor(classes) {
		this.options = { classes, height: "auto", resizable: true };
		this.position = { width: 640, height: "auto" };
		this.received = [];
		this.classList = [];
		// `nodeType: 1` because the patch checks that there IS still a frame to position: core opens
		// `setPosition` with `getComputedStyle(this.element[0])` and does not check for itself.
		this.element = [{
			nodeType: 1,
			classList: { add: (c) => { if (!this.classList.includes(c)) this.classList.push(c); } },
		}];
	}

	/** What core leaves behind when an application is closed. */
	closed() { this.element = null; return this; }
}

// Draggable's resize drag: a bare { width, height } with no left/top. Every internal
// reflow carries left/top, which is exactly what the patch keys off.
const drag = (width, height) => ({ width, height });

const original = globalThis.Application;

beforeAll(() => {
	globalThis.Application = class {
		setPosition(position) { this.received.push(position); return position; }
	};
	Object.setPrototypeOf(FakeApp.prototype, globalThis.Application.prototype);
	enableAutoHeightVerticalResize();
});

afterAll(() => { globalThis.Application = original; });

describe("enableAutoHeightVerticalResize", () => {
	// THE FAULT THIS CATCHES. Core's `setPosition` opens with `getComputedStyle(this.element[0])`
	// and never asks whether there is still an element; on a closed application `_element` is null,
	// so that reads `undefined` and throws "parameter 1 is not of type 'Element'".
	//
	// It is reachable by ordinary use. The window-frame `Draggable` binds its mousemove to the
	// WINDOW and calls `setPosition` on every one of them until the mouseup that unbinds it, so
	// anything that closes the application mid-gesture -- Escape, a sheet closing under the
	// pointer, another client deleting the document being looked at -- leaves that listener firing
	// at an app whose frame has gone, and every mouse movement throws until the button comes up.
	it("has nothing to position once the window has been closed, rather than throwing", () => {
		const app = new FakeApp(["stonetop", "stonetop-relmap-app"]).closed();
		expect(() => app.setPosition({ left: 10, top: 20 })).not.toThrow();
		// And core is never reached, which is where the throw would have come from.
		expect(app.received).toEqual([]);
	});

	it("adopts the dragged height, so core stops refitting an auto-height window to content", () => {
		const app = new FakeApp(["stonetop", "stonetop-people-gallery"]);
		app.setPosition(drag(640, 800));
		expect(app.options.height).toBe(800);
		// The position itself is passed through untouched — only options.height changed.
		expect(app.received.at(-1)).toEqual({ width: 640, height: 800 });
	});

	it("marks the frame so the stylesheet can lift a max-height cap that would clamp the drag", () => {
		const app = new FakeApp(["stonetop", "stonetop-people-gallery"]);
		expect(app.classList).toEqual([]);
		app.setPosition(drag(640, 800));
		expect(app.classList).toEqual(["stonetop-height-resized"]);
		// Re-asserted every call, but never duplicated.
		app.setPosition({ width: 640, height: "auto" });
		expect(app.classList).toEqual(["stonetop-height-resized"]);
	});

	it("drops later auto-refit requests so a hand-picked height survives a re-render", () => {
		const app = new FakeApp(["stonetop"]);
		app.setPosition(drag(500, 700));
		app.setPosition({ height: "auto" });
		expect(app.received.at(-1)).toEqual({});
	});

	it("does not mistake an internal reflow for a manual resize", () => {
		const app = new FakeApp(["stonetop"]);
		app.setPosition({ left: 10, top: 20, width: 500, height: 700 });
		expect(app.options.height).toBe("auto");
		expect(app.classList).toEqual([]);
	});

	it("leaves a foreign window on core's exact behaviour", () => {
		const app = new FakeApp(["sheet", "actor"]);
		app.setPosition(drag(500, 700));
		expect(app.options.height).toBe("auto");
		expect(app.classList).toEqual([]);
		expect(app.received.at(-1)).toEqual({ width: 500, height: 700 });
	});
});
