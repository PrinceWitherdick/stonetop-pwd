/**
 * Repaint a sheet once `work` settles, and surface a failed write instead of dropping it.
 *
 * Written as `await write; this.render(false)`, a rejection skips the repaint, so the sheet keeps
 * showing the state the player was told they were in (the box they just ticked, the row they
 * just added) with nothing on screen to say otherwise. The render runs on the failure path too:
 * falling back to what actually stored is what makes the optimistic DOM honest again.
 *
 * Resolves to what `work` resolved to, or undefined when it failed. Windows built on
 * StonetopDialog use its `reportWriteFailure` instead, which names the thing in its own words.
 * tests/actors/character/render-after-writes.test.js pins the contract.
 *
 * @param {Application} app  the sheet to repaint
 * @param {Promise|*} work   the write
 * @param {string} [what]    names the window in the console line
 */
export function renderAfterWrite(app, work, what = "sheet") {
	return Promise.resolve(work)
		.catch(err => {
			console.error(`Stonetop | ${what} write failed`, err);
			ui.notifications?.error("That change could not be saved. The sheet has been refreshed.");
		})
		.finally(() => app.render(false));
}
