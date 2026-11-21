// The background card's inner controls (a setup choice or text, a neighbor's trait or pick, a marked
// action, a move choice, the major arcanum) each pick their card's background as they are engaged.
// _applyBackgroundChange does nothing for the background already taken: a full apply clears the
// Initiates picks and rebuilds the steps, and a setup field's `input` event calls it on every
// keystroke. The major arcanum syncs the background radio the way every other inner control does.

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { loadPlaybookPackDocs } from "../../fakes/sourcePack.js";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";

const DIALOG_JS = fs.readFileSync(path.resolve(process.cwd(),
	"module/actors/character/dialogs/CharacterOnboardingDialog.js"), "utf8");
const PACK = new Map(loadPlaybookPackDocs().map(doc => [doc.system.slug, doc]));
const playbookDoc = slug => ({ ...structuredClone(PACK.get(slug)), uuid: `Compendium.test.${slug}` });

function blessedDialog() {
	const dialog = Object.create(CharacterOnboardingDialog.prototype);
	dialog._initializeState(playbookDoc("the-blessed"), null, null);
	dialog._applyBackgroundChange("initiate");
	return dialog;
}

describe("re-applying the background already taken", () => {
	it("keeps the Initiates picks, the steps and every other pick", () => {
		const dialog = blessedDialog();
		const [first, second] = dialog._getInitiatesData().options.map(o => o.slug);
		dialog._selections.initiates = [first, second];
		const steps = [...dialog._steps];
		const step = dialog._step;
		const before = structuredClone(dialog._selections);

		dialog._applyBackgroundChange("initiate");
		expect(dialog._selections).toEqual(before);
		expect(dialog._steps).toEqual(steps);
		expect(dialog._step).toBe(step);
	});

	it("switching to another background still clears them", () => {
		const dialog = blessedDialog();
		const [first] = dialog._getInitiatesData().options.map(o => o.slug);
		dialog._selections.initiates = [first];
		const other = dialog._backgrounds.find(b => b.slug !== "initiate").slug;
		dialog._applyBackgroundChange(other);
		expect(dialog._selections.backgroundSlug).toBe(other);
		expect(dialog._selections.initiates).toEqual([]);
	});
});

describe("the background card's inner controls", () => {
	const listeners = DIALOG_JS.slice(
		DIALOG_JS.indexOf("const _syncBackgroundSelection = (prevBackground, backgroundSlug) => {"),
		DIALOG_JS.indexOf("// ── Instinct ──", DIALOG_JS.indexOf("const _syncBackgroundSelection")),
	);

	it("is the section being scanned", () => {
		expect(listeners).toContain("[name='onboard-background-major-arcanum']");
		expect(listeners).toContain(".onboard-background-setup-text");
	});

	it("include the major arcanum in syncing the background radio and its picks", () => {
		const handler = listeners.slice(listeners.indexOf("[name='onboard-background-major-arcanum']\").on(\"change\""));
		expect(handler.slice(0, handler.indexOf("_refreshNextButton();")))
			.toContain("_syncBackgroundSelection(prevBackground, backgroundSlug);");
	});
});
