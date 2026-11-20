// The background card's inner controls (a setup choice or text, a neighbor's trait or pick, a marked
// action, a move choice, the major arcanum) each pick their card's background as they are engaged.
// They switch it only when it is another background: _applyBackgroundChange clears the Initiates
// picks and rebuilds the steps, so re-running it for the background already taken (a setup field's
// `input` event, on every keystroke) threw those picks away for nothing. The major arcanum now
// syncs the background radio the way every other inner control does.

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
	// Why the inner controls guard: the one thing a same-background apply changes is to drop the
	// Initiates picks. Everything else it does comes out the same, so skipping it loses nothing.
	it("would only clear the Initiates picks; the steps and reconciled picks come out the same", () => {
		const dialog = blessedDialog();
		const [first, second] = dialog._getInitiatesData().options.map(o => o.slug);
		dialog._selections.initiates = [first, second];
		const steps = [...dialog._steps];
		const step = dialog._step;
		const { initiates, ...rest } = structuredClone(dialog._selections);
		expect(initiates).toEqual([first, second]);

		dialog._applyBackgroundChange("initiate");
		expect(dialog._selections.initiates).toEqual([]);
		const { initiates: _cleared, ...after } = structuredClone(dialog._selections);
		expect(after).toEqual(rest);
		expect(dialog._steps).toEqual(steps);
		expect(dialog._step).toBe(step);
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

	it("switch the background only when it is another one", () => {
		const calls = listeners.match(/^.*this\._applyBackgroundChange\(backgroundSlug\);$/gm) ?? [];
		expect(calls.length).toBeGreaterThanOrEqual(9);
		for (const line of calls) {
			expect(line.trim()).toBe("if (prevBackground !== backgroundSlug) this._applyBackgroundChange(backgroundSlug);");
		}
	});

	it("include the major arcanum in syncing the background radio and its picks", () => {
		const handler = listeners.slice(listeners.indexOf("[name='onboard-background-major-arcanum']\").on(\"change\""));
		expect(handler.slice(0, handler.indexOf("_refreshNextButton();")))
			.toContain("_syncBackgroundSelection(prevBackground, backgroundSlug);");
	});
});
