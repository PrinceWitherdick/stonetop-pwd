// @vitest-environment happy-dom
// Onboarding's three hover popups (word tooltip, arcana preview, FAQ popup) live on <body>. They are
// taken down by reference, not by a class lookup: the character sheet keeps its own hidden
// `.stonetop-word-tooltip` panel there (the move cross-reference tooltip), and the first one in the
// document was the sheet's, so leaving a word took the sheet's panel down and left onboarding's up.

import { describe, it, expect, afterEach } from "vitest";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";

/** A dialog stub with just the members the popups touch. */
function makeDialog() {
	return Object.create(CharacterOnboardingDialog.prototype);
}

function bodyPanel(className) {
	const el = document.createElement("div");
	el.className = className;
	el.hidden = true;
	document.body.appendChild(el);
	return el;
}

function anchor() {
	const el = document.createElement("div");
	document.body.appendChild(el);
	return el;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("onboarding's popups", () => {
	it("take down their own word tooltip, not the character sheet's panel of the same class", () => {
		const sheetPanel = bodyPanel("stonetop-word-tooltip");
		const d = makeDialog();
		d._showWordTooltip(anchor(), "Outfit", "<p>When you outfit…</p>");
		expect(document.querySelectorAll(".stonetop-word-tooltip")).toHaveLength(2);

		d._removeTooltip();
		expect(sheetPanel.isConnected).toBe(true);
		expect(document.querySelectorAll(".stonetop-word-tooltip")).toHaveLength(1);
	});

	it("replace their own word tooltip on the next hover, leaving the sheet's panel", () => {
		const sheetPanel = bodyPanel("stonetop-word-tooltip");
		const d = makeDialog();
		d._showWordTooltip(anchor(), "Outfit", "<p>a</p>");
		d._showWordTooltip(anchor(), "Defend", "<p>b</p>");
		expect(sheetPanel.isConnected).toBe(true);
		expect(document.querySelectorAll(".stonetop-word-tooltip")).toHaveLength(2);
	});

	it("take down their own arcana preview, not another one on <body>", () => {
		const other = bodyPanel("stonetop-arcana-preview-popup");
		const d = makeDialog();
		const card = anchor();
		card.innerHTML = `<div class="stonetop-onboarding-arcana-preview"><p>The Ouroboros</p></div>`;
		d._showArcanaPreview(card);
		expect(document.querySelectorAll(".stonetop-arcana-preview-popup")).toHaveLength(2);

		d._removeArcanaPreview();
		expect(other.isConnected).toBe(true);
		expect(document.querySelectorAll(".stonetop-arcana-preview-popup")).toHaveLength(1);
	});

	it("take down their own FAQ popup, not another one on <body>", () => {
		const other = bodyPanel("stonetop-onboarding-faq-popup");
		const d = makeDialog();
		d._currentFaq = [{ html: "<p>Q?</p><p>A.</p>" }];
		d._showFaqPopup(anchor());
		expect(document.querySelectorAll(".stonetop-onboarding-faq-popup")).toHaveLength(2);

		d._removeFaqPopup();
		expect(other.isConnected).toBe(true);
		expect(document.querySelectorAll(".stonetop-onboarding-faq-popup")).toHaveLength(1);
	});

	it("are a no-op to take down when none is showing", () => {
		const d = makeDialog();
		expect(() => { d._removeTooltip(); d._removeArcanaPreview(); d._removeFaqPopup(); }).not.toThrow();
	});
});
