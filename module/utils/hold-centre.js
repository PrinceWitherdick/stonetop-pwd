// Nothing to put back: the window had not been placed yet.
const NO_CENTRE = () => {};

/**
 * Keep a window standing over the same point while a redraw changes its size.
 *
 * A step wizard changes size from step to step. Left alone, the new size grows down and right from
 * the old top-left corner, so a tall step walks off the bottom of the screen; and letting Foundry
 * centre it in the viewport instead reads as the window jumping. Held here, the new size spreads
 * evenly around the centre the old one had, so the window grows and shrinks in place.
 *
 * Call it BEFORE the redraw, while `app.position` still describes the window as it stood, and call
 * what it returns AFTER the new size is set (a `setPosition({ height: "auto" })` fit, say): it reads
 * the width and height back at that point, so it centres the size the window has just taken. Both
 * halves run synchronously around the render, so no frame is drawn in between.
 *
 * Nothing is held for a window that has never been placed, the first render, where some of the four
 * are still null. What comes back then does nothing, so a window opening for the first time is
 * centred by Foundry like any other.
 *
 * A function rather than a StonetopDialog method because StepperDialog, which needs it too, is a
 * plain Application. Each caller keeps its own say over WHEN to hold (a step wizard only across a
 * step change, say); this is only the how.
 *
 * @param {{position?: {left?: number, top?: number, width?: number, height?: number}, setPosition: Function}} app
 * @returns {() => void} re-centres `app` on the held centre, at whatever size it has by then
 */
export function holdCentre(app) {
	const p = app.position;
	if (![p?.left, p?.top, p?.width, p?.height].every(Number.isFinite)) return NO_CENTRE;
	const x = p.left + p.width / 2;
	const y = p.top + p.height / 2;
	return () => {
		app.setPosition({
			left: x - app.position.width / 2,
			top:  y - app.position.height / 2,
		});
	};
}
