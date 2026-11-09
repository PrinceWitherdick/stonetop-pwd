import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirmOutcome, askWithButtons } from "../../module/utils/ask-with-buttons.js";
import { fakeForm, stubAsk, stubConfirm } from "../fakes/confirm.js";

// The house rule for a window that confirms a write: the buttons NAME the outcome ("Remove the
// move" / "Keep it"), never Yes/No, affirmative first. Core's Dialog.confirm hard-wires Yes/No, so
// every confirm goes through this helper instead.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("confirmOutcome", () => {
	it("puts the named answers on the buttons, the affirmative first", async () => {
		const asked = stubConfirm(true);
		await confirmOutcome({ title: "Remove move", content: "<p>x</p>", yes: { label: "Remove the move" }, no: { label: "Keep it" } });
		const config = asked.mock.calls[0][0];
		expect(config.buttons.map(b => b.label)).toEqual(["Remove the move", "Keep it"]);
		expect(config.window.title).toBe("Remove move");
		expect(config.classes).toEqual(expect.arrayContaining(["stonetop", "stonetop-ask"]));
	});

	it("lands Enter on the safe answer unless told otherwise", async () => {
		const asked = stubConfirm(true);
		await confirmOutcome({ title: "t", content: "", yes: { label: "Go" }, no: { label: "Stay" } });
		expect(asked.mock.calls[0][0].buttons.find(b => b.default).action).toBe("no");
		await confirmOutcome({ title: "t", content: "", yes: { label: "Go" }, no: { label: "Stay" }, defaultYes: true });
		expect(asked.mock.calls[1][0].buttons.find(b => b.default).action).toBe("yes");
	});

	it("answers true, false, or null for a closed window", async () => {
		const ask = () => confirmOutcome({ title: "t", content: "", yes: { label: "Go" }, no: { label: "Stay" } });
		stubConfirm(true);  expect(await ask()).toBe(true);
		stubConfirm(false); expect(await ask()).toBe(false);
		stubConfirm(null);  expect(await ask()).toBeNull();
	});

	it("puts a button's own class on the answer it belongs to, and on no other", async () => {
		const asked = stubConfirm(false);
		await confirmOutcome({ title: "t", content: "", yes: { label: "Drop it", className: "stonetop-dialog-btn--danger" }, no: { label: "Keep it" } });
		const [yes, no] = asked.mock.calls[0][0].buttons;
		expect(yes.class).toBe("stonetop-dialog-btn--danger");
		expect(no).not.toHaveProperty("class");
	});

	// Content handed in as an element keeps only its markup, so a form whose boxes answer each other
	// (Bath of Healing Light's cap on picks) is wired once the window is on screen.
	it("hands a render callback the window's element, and passes none when not asked", async () => {
		const asked = stubConfirm(null);
		const render = vi.fn();
		await askWithButtons({ title: "t", content: "", render, buttons: [{ key: "a", label: "A", value: 1 }] });
		const element = { id: "window" };
		asked.mock.calls[0][0].render({}, { element });
		expect(render).toHaveBeenCalledWith(element);
		await askWithButtons({ title: "t", content: "", buttons: [{ key: "a", label: "A", value: 1 }] });
		expect(asked.mock.calls[1][0]).not.toHaveProperty("render");
	});

	// A "discard your work?" question has no stay button (its X is that), so Enter must not land on
	// Discard: core would make the first button Enter's and focus it, so the window takes the focus.
	it("with defaultKey false, puts Enter on no button and focuses the window instead", async () => {
		const asked = stubConfirm(null);
		const render = vi.fn();
		await askWithButtons({ title: "t", content: "", defaultKey: false, render, buttons: [{ key: "discard", label: "Discard", value: true }] });
		const config = asked.mock.calls[0][0];
		expect(config.buttons.some(b => b.default)).toBe(false);
		const button = { removeAttribute: vi.fn() };
		const element = { querySelectorAll: () => [button], setAttribute: vi.fn(), focus: vi.fn() };
		config.render({}, { element });
		expect(button.removeAttribute).toHaveBeenCalledWith("autofocus");
		expect(element.setAttribute).toHaveBeenCalledWith("tabindex", "-1");
		expect(element.focus).toHaveBeenCalled();
		expect(render).toHaveBeenCalledWith(element);
	});

	it("keeps a caller's own window class", async () => {
		const asked = stubConfirm(false);
		await askWithButtons({ title: "t", content: "", classes: ["stonetop-camp-ask"], buttons: [{ key: "a", label: "A", value: 1 }] });
		expect(asked.mock.calls[0][0].classes).toEqual(expect.arrayContaining(["stonetop-camp-ask", "stonetop-ask"]));
	});
});

// A tick box or a text field in the window: the pressed button reads it, while the form exists.
describe("an answer read off the window's form", () => {
	const buttons = [
		{ key: "go", label: "Go", value: form => ({ also: !!form?.elements.namedItem("also")?.checked }) },
		{ key: "stay", label: "Stay", value: null },
	];

	it("hands the pressed button the form, and answers with what it read", async () => {
		stubAsk("go", fakeForm({ also: { checked: true } }));
		expect(await askWithButtons({ title: "t", content: "", buttons })).toEqual({ also: true });
		stubAsk("go", fakeForm({ also: { checked: false } }));
		expect(await askWithButtons({ title: "t", content: "", buttons })).toEqual({ also: false });
	});

	it("answers a plain button's value, and null for a closed window", async () => {
		stubAsk("stay");
		expect(await askWithButtons({ title: "t", content: "", buttons })).toBeNull();
		stubAsk(null);
		expect(await askWithButtons({ title: "t", content: "", buttons })).toBeNull();
	});

	// A function-valued button is only ever answered through its callback: its key alone is not an answer.
	it("never mistakes the reading button's bare key for its answer", async () => {
		const wait = vi.fn(async () => "go");
		globalThis.foundry.applications.api.DialogV2 = { wait };
		expect(await askWithButtons({ title: "t", content: "", buttons })).toBeNull();
	});

	it("passes a button's own class and the window's position through", async () => {
		const asked = stubAsk(null);
		await askWithButtons({
			title: "t", content: "", position: { width: 460 },
			buttons: [{ key: "drop", label: "Drop it", value: true, className: "stonetop-dialog-btn--danger" }],
		});
		const config = asked.mock.calls[0][0];
		expect(config.position).toEqual({ width: 460 });
		expect(config.buttons[0].class).toBe("stonetop-dialog-btn--danger");
	});
});

// The guard: a bare Yes/No confirm anywhere in the system is the thing this helper replaced.
describe("no bare Yes/No confirms", () => {
	it("leaves no Dialog.confirm call in the system's code", () => {
		const hits = [];
		const walk = dir => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (entry.name.endsWith(".js")) {
					const code = fs.readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
					if (/\bDialog\.confirm\s*\(/.test(code)) hits.push(path.relative(root, full));
				}
			}
		};
		walk(path.join(root, "module"));
		expect(hits).toEqual([]);
	});
});
