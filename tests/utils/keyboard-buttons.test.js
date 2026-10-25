// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { pressesRoleButton, wireKeyboardButtons } from "../../module/utils/keyboard-buttons.js";

function setup(html) {
	const root = document.createElement("div");
	root.innerHTML = html;
	document.body.append(root);
	wireKeyboardButtons(root);
	return root;
}

const press = (el, key, extra = {}) => {
	const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
	el.dispatchEvent(ev);
	return ev;
};

describe("wireKeyboardButtons", () => {
	it("presses a role=button on Enter and Space, and stops the default", () => {
		const root = setup(`<span role="button" tabindex="0"><i class="icon"></i> Level up</span>`);
		const button = root.querySelector("[role='button']");
		const click = vi.fn();
		button.addEventListener("click", click);
		expect(press(button, "Enter").defaultPrevented).toBe(true);
		expect(press(button.querySelector("i"), " ").defaultPrevented).toBe(true);
		expect(click).toHaveBeenCalledTimes(2);
	});

	it("leaves other keys, held keys, modifiers, disabled buttons and typing alone", () => {
		const root = setup(`<span role="button" tabindex="0"><input type="text"></span><span role="button" aria-disabled="true"></span>`);
		const [button, disabled] = root.querySelectorAll("[role='button']");
		const click = vi.fn();
		button.addEventListener("click", click);
		disabled.addEventListener("click", click);
		press(button, "a");
		press(button, "Enter", { repeat: true });
		press(button, "Enter", { ctrlKey: true });
		press(button.querySelector("input"), " ");
		press(disabled, "Enter");
		expect(click).not.toHaveBeenCalled();
	});

	it("does not press native buttons (the browser already does), and wires a root only once", () => {
		const root = setup(`<button role="button">Go</button><span role="button"></span>`);
		expect(pressesRoleButton({ key: "Enter", target: root.querySelector("button") })).toBeNull();
		const heading = document.createElement("div");
		heading.setAttribute("role", "button");
		heading.innerHTML = "<button>Search</button>";
		root.append(heading);
		expect(pressesRoleButton({ key: "Enter", target: heading.querySelector("button") })).toBeNull();
		expect(pressesRoleButton({ key: "Enter", target: heading })).toBe(heading);
		wireKeyboardButtons(root);
		const span = root.querySelector("span");
		const click = vi.fn();
		span.addEventListener("click", click);
		press(span, "Enter");
		expect(click).toHaveBeenCalledTimes(1);
	});
});
