// Draws a table moment (moment-view.js) on this client: a full-width band on <body>, above the
// windows, that plays once and removes itself. It takes no clicks and no focus, so it never
// interrupts the person at the keyboard. Guarded by tests/moments/moment-overlay.test.js.
import { prefersReducedMotion } from "../utils/reduced-motion.js";
import { warn } from "../utils/logger.js";

/** The band's element id. One at a time. */
export const MOMENT_ID = "stonetop-moment";

/** The entrance and the fade around a moment's hold, in seconds, as the stylesheet's keyframes run them. */
export const MOMENT_ENTER_S = 0.35;
export const MOMENT_EXIT_S = 0.4;

/**
 * How long the empty band waits in the page before its words go in and it shows. A live region
 * inserted with its text already in it is not read out by every screen reader; one that is in the
 * page first and then filled is. A real player at this table reads by ear.
 */
export const MOMENT_VOICE_DELAY_MS = 100;

/** Past the end of its life, when a band whose `animationend` never came (a hidden tab) is taken down anyway. */
const STRANDED_MS = 500;

/** @type {{el: HTMLElement, timers: number[]}|null} The band up now. */
let current = null;
/** The one moment waiting behind it. A newer arrival replaces it: a backlog would replay stale news. */
let waiting = null;

/** A moment's whole life with motion, in ms: entrance, hold, fade. */
export function momentLifeMs(view) {
	return Math.round((MOMENT_ENTER_S + MOMENT_EXIT_S) * 1000) + view.holdMs;
}

/** The band with its words still out (they go in once it is in the page). */
function build(view) {
	const root = document.createElement("div");
	root.id = MOMENT_ID;
	root.className = `stonetop-moment stonetop-moment--${view.kind}`;
	if (view.small) root.classList.add("stonetop-moment--small");
	root.setAttribute("role", "status");
	root.setAttribute("aria-live", "polite");
	if (view.veil) {
		const veil = document.createElement("div");
		veil.className = "stonetop-moment-veil";
		veil.setAttribute("aria-hidden", "true");
		root.append(veil);
	}
	const band = document.createElement("div");
	band.className = "stonetop-moment-band";
	const icon = document.createElement("i");
	icon.className = `fas ${view.icon} stonetop-moment-icon`;
	icon.setAttribute("aria-hidden", "true");
	const words = document.createElement("div");
	words.className = "stonetop-moment-words";
	band.append(icon, words);
	root.append(band);
	return { root, words };
}

/** Put the words in: as text, never markup, since a title can be anything a GM typed. */
function fill(words, view) {
	const title = document.createElement("div");
	title.className = "stonetop-moment-title";
	title.textContent = view.title;
	words.append(title);
	if (!view.sub) return;
	const sub = document.createElement("div");
	sub.className = "stonetop-moment-sub";
	sub.textContent = view.sub;
	words.append(sub);
}

function finish(el) {
	if (current?.el !== el) return;
	for (const timer of current.timers) clearTimeout(timer);
	el.remove();
	current = null;
	const next = waiting;
	waiting = null;
	if (next) playMoment(next);
}

function start(view) {
	const { root, words } = build(view);
	const life = momentLifeMs(view);
	// When the fade starts, which keyframe percentages cannot say for a hold that varies by kind.
	root.style.setProperty("--stonetop-moment-out-at", `${(life - MOMENT_EXIT_S * 1000) / 1000}s`);
	document.body.append(root);
	current = { el: root, timers: [] };
	current.timers.push(setTimeout(() => {
		try {
			fill(words, view);
			// Asked on show, not on arrival: a reader can switch Reduce Motion on between two moments.
			if (prefersReducedMotion()) {
				root.classList.add("is-still");
				current?.timers.push(setTimeout(() => finish(root), view.holdMs));
				return;
			}
			// A reflow first, so the class lands as a change and the animation starts from its first frame.
			void root.offsetWidth;
			root.classList.add("is-playing");
			root.addEventListener("animationend", ev => {
				if (ev.target === root && ev.animationName === "stonetop-moment-out") finish(root);
			});
			current?.timers.push(setTimeout(() => finish(root), life + STRANDED_MS));
		} catch (err) {
			warn("A table moment could not be shown.", err);
			finish(root);
		}
	}, MOMENT_VOICE_DELAY_MS));
}

/**
 * Show a moment on this screen, or queue it behind the one showing. Never throws.
 *
 * @param {ReturnType<import("./moment-view.js").momentView>} view
 * @returns {boolean} Whether it was shown or queued.
 */
export function playMoment(view) {
	try {
		if (!view || !globalThis.document?.body) return false;
		if (current) {
			waiting = view;
			return true;
		}
		start(view);
		return true;
	} catch (err) {
		warn("A table moment could not be shown.", err);
		return false;
	}
}

/** Test seam: take any band down and forget the queue. */
export function _resetMoments() {
	for (const timer of current?.timers ?? []) clearTimeout(timer);
	current?.el.remove();
	current = null;
	waiting = null;
}
