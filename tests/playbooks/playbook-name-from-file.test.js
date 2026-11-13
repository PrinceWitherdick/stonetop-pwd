import { describe, it, expect } from "vitest";
import { playbookNameFromFileName } from "../../module/playbooks/playbook-text.js";

// A PDF with no text to read still has a file name: the builder starts the playbook from it.
describe("a playbook's name from its file name", () => {
	it.each([
		["Stonetop_Abhorsen v_3.pdf", "Abhorsen"],
		["lexchxn - The Familiar Face - v1.0.0.pdf", "The Familiar Face"],
		["Stranger Stonetop Playbook.pdf", "Stranger"],
		["The Standout v3.pdf", "The Standout"],
		["my_homebrew.pdf", "My homebrew"],
		["Stonetop Playbook.pdf", ""],
	])("%s is %s", (file, name) => {
		expect(playbookNameFromFileName(file)).toBe(name);
	});
});
