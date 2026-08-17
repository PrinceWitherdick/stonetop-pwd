import { SYSTEM_ID } from "../system-id.js";
/**
 * Opt-in Stonetop skin for *core* Foundry windows we don't own.
 *
 * Our own sheets and modals are styled directly, but core windows like
 * "User Configuration" are plain Foundry applications (ApplicationV2 in v13+).
 * Rather than restyle every `.application` globally — which would also reskin
 * every other module's dialogs and constantly fight core updates — we tag a
 * curated allowlist of core windows with a single marker class and scope ALL
 * theming to it (`.stonetop-themed` in stonetop.css). Nothing untagged is
 * touched, so the blast radius is exactly this list.
 *
 * To theme another core window: open it, read its class name from the console
 * (`ui.activeWindow.constructor.name`, or inspect the id-derived class on its
 * root element), and add that name to THEMED_WINDOWS. The render hook Foundry
 * fires is `render<ClassName>` — e.g. `UserConfig` → `renderUserConfig` — and
 * is stable across v12 (jQuery) and v13+ (native element); tagWindow handles
 * both element shapes.
 */

// ApplicationV2 (or v12 AppV1) class names whose windows get the Stonetop skin.
// Each entry `N` registers a `renderN` hook. Keep this tight — every window
// here is one we've actually eyeballed themed.
const THEMED_WINDOWS = [
	"UserConfig", // right-click a player in the sidebar → "User Configuration"
];

const MARKER_CLASS = "stonetop-themed";

/** Tag a freshly-rendered core window's root element so the scoped CSS applies. */
function tagWindow(_app, element) {
	// v13+ passes the root HTMLElement; v12 passes jQuery. Normalize to a node.
	const root = element?.jquery ? element[0] : element;
	// classList.add is idempotent, so re-renders are harmless.
	root?.classList?.add(MARKER_CLASS);
}

/** Register render hooks for every allowlisted core window. Call once, in init. */
export function registerStonetopWindowTheme() {
	for (const className of THEMED_WINDOWS) Hooks.on(`render${className}`, tagWindow);
}

/* ── Forced light theme for Stonetop windows ───────────────────────────────
 *
 * Our look is a parchment sheet with dark ink; it has no dark variant. In a
 * dark-mode world Foundry sets `theme-dark` on `<body>`, which hands every
 * window a dark set of theme variables — form fields, native controls, focus
 * rings, scrollbars, fieldset borders.
 *
 * Core already exempts the V1 framework: ApplicationV1's constructor pushes
 * `themed theme-light` onto every instance (appv1/api/application-v1.mjs), and
 * nearly every Stonetop sheet and dialog is still AppV1, so they are already
 * immune. ApplicationV2 has no such exemption, which is why our V2 surfaces —
 * the content-picker prompt, the Import Book Art macro's DialogV2s, and the
 * core windows tagged above — come out half dark: our skin pins the parchment
 * and the slate buttons, but everything it does NOT pin stays dark.
 *
 * The fix uses core's own mechanism rather than fighting it. `.themed
 * .theme-light` re-declares exactly the same variable set `body.theme-dark`
 * does (26 names, verified identical), and beats it on specificity (0,2,x vs
 * 0,1,x), so putting those two classes on the window root gives it the same
 * variables it would have in a light world. This is how core keeps a light
 * chat log inside a dark interface — a supported, per-window opt-out, not an
 * override war.
 *
 * Scope is the whole window, but only OUR windows: native Foundry and other
 * modules keep whatever theme the world asked for.
 */

const LIGHT_CLASSES = ["themed", "theme-light"];

/**
 * True when a window root is one of ours — either a Stonetop application or a core
 * window tagWindow has skinned. `stonetop-pwd` is excluded: that is the package id,
 * and a class by that name would mean "a window belonging to this system", which
 * core and other modules may well apply to windows we do not own.
 */
function isStonetopWindow(root) {
	return Array.from(root.classList).some(c =>
		(c === "stonetop" || c.startsWith("stonetop-")) && c !== SYSTEM_ID);
}

/**
 * Pin a freshly-rendered Stonetop window to the light theme.
 *
 * Registered on `renderApplicationV2`, which ApplicationV2 fires for every V2
 * window in the world (its hook dispatch walks the class inheritance chain up to
 * ApplicationV2 itself). That firing order also matters here: the chain runs
 * most-derived first, so `renderUserConfig` — and with it tagWindow's marker
 * class — has already run by the time this sees the element.
 *
 * The hook runs after the frame is built but within the same task as the insert,
 * so the swap lands before the browser paints; there is no flash of dark. Both
 * classes are needed: core's rule is `.themed.theme-light`, so `theme-light`
 * alone selects nothing.
 */
function forceLightTheme(_app, element) {
	// v13+ passes the root HTMLElement; v12 passes jQuery. Normalize to a node.
	const root = element?.jquery ? element[0] : element;
	if (!root?.classList || !isStonetopWindow(root)) return;
	root.classList.remove("theme-dark");
	root.classList.add(...LIGHT_CLASSES);
}

/** Force the light theme on every Stonetop ApplicationV2 window. Call once, in init. */
export function registerStonetopLightTheme() {
	Hooks.on("renderApplicationV2", forceLightTheme);
}
