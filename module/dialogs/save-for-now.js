// "Save for now" and the close-guard, shared by the walkthroughs that build a page from `this._sel` and
// can keep a half-made one to finish later: Create a Hazard and Create a Site.
//
// The subclass supplies `_saveCopy` ({ noun, keptAt }), `_captureLiveFields()` (the focused-but-unblurred
// inputs read back into `this._sel`) and `_finish()` (writes the page), and may set `_quietSave` when its
// caller says what happened itself. `_page` is set when editing a page that already exists.

/**
 * @param {typeof import("./StepperDialog.js").StepperDialog} Base
 */
export const SaveForNow = Base => class extends Base {
	/** @returns {{ noun: string, keptAt: string }} e.g. { noun: "hazard", keptAt: "on the GM Toolkit's Threats & Dangers tab" } */
	get _saveCopy() {
		throw new Error(`${this.constructor.name} must define _saveCopy`);
	}

	// What the close-guard compares (utils/close-guard.js): every answer, rows included.
	_workState() {
		this._captureLiveFields();
		return this._sel;
	}

	_discardCopy() {
		const { noun, keptAt } = this._saveCopy;
		return this._page
			? { title: "Discard your changes?", body: `Your changes to this ${noun} haven't been saved. Closing the window now loses them.` }
			: { title: `Discard this ${noun}?`, body: `This ${noun} hasn't been saved. Closing the window now loses what you've written. Save for now keeps it ${keptAt}, to finish later.` };
	}

	// Save what's there, from any step, and close: a new one lands where `keptAt` says (its pencil reopens
	// this walkthrough, filled in), an edit is written to its page.
	async _saveForNow() {
		const creating = !this._page;
		await this._finish();
		if (!creating || this._quietSave) return;
		const { noun, keptAt } = this._saveCopy;
		globalThis.ui?.notifications?.info?.(`${noun[0].toUpperCase()}${noun.slice(1)} saved. Carry on any time with the pencil on its card, ${keptAt}.`);
	}
};
