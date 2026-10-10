import {steadingSystemValue} from "../actors/steading/steading-system-value.js";
import {escHtml} from "./strings.js";

// Is this actor the steading? TWO ARMS, and both are load-bearing: the subtype is what a
// steading minted by this system carries, and `system.customType` is what one made before the
// subtype existed still carries. Exported because the short one-armed spelling kept being
// written by hand at each new call site, and a world on the legacy shape then reads as having no
// steading at all -- silently, since every one of those call sites has a sensible empty answer.
export function isSteadingActor(actor) {
	return actor?.type === "stonetop" || actor?.system?.customType === "stonetop";
}

export function getStonetopSteadingActor() {
	return game.actors?.find(isSteadingActor) ?? null;
}

// Like getStonetopSteadingActor, but warns (and returns null) when no steading exists
// yet — the one home for the "not found" wording, shared by the jump-to-steading
// shortcut, the Seasons Change hotbar macro (see hooks/Ready.js) and the GM Toolkit's
// prep tabs.
//
// `because` appends what the caller was about to do, for the places where "no steading"
// is not the whole answer — GM prep is filed in a journal the steading points at, so a
// GM told only "no steading was found" is left to guess what that has to do with writing
// up a threat. The SENTENCE still lives here, so it can only be worded once.
export function getStonetopSteadingActorOrWarn({ because = "" } = {}) {
	const steading = getStonetopSteadingActor();
	if (!steading) {
		ui.notifications?.warn?.(
			`No Stonetop steading was found in this world yet${because ? `, so ${because}` : ""}.`);
	}
	return steading;
}

// Open the shared Stonetop steading actor's sheet (focused), or warn if none exists
// yet. Backs the "Stonetop" header shortcut on the session-zero dialogs (Welcome,
// Introductions) — mirrors the steading button on the character sheet header.
export function openStonetopSteading() {
	getStonetopSteadingActorOrWarn()?.sheet.render(true, { focus: true });
}

// The one "Stonetop" steading-shortcut descriptor — label (the steading's name, or
// "Stonetop" when unset), marker icon, unset-state class, and the open-or-warn click.
// Shared by every place that offers the jump: the Welcome/Introductions
// _getHeaderButtons overrides (which push this object) and addStonetopSteadingButton
// (which builds an <a> from its fields for stock Dialogs that can't override).
export function stonetopSteadingHeaderButton() {
	const steading = getStonetopSteadingActor();
	return {
		label:   steading?.name || "Stonetop",
		class:   "stonetop-open-steading" + (steading ? "" : " stonetop-open-steading--unset"),
		icon:    "fas fa-map-marker-alt",
		onclick: openStonetopSteading,
	};
}

// Inject the "Stonetop" button into a stock Dialog's window header (which can't override
// _getHeaderButtons), mirroring the steading button on the character sheet header. Pass
// the render-callback `html` (the dialog content); we walk up to the header and slot the
// button before Close. Built from the shared descriptor; idempotent per render.
export function addStonetopSteadingButton(html) {
	const content = html?.jquery ? html[0] : (html?.[0] ?? html);
	const header  = content?.closest?.(".window-app, .app")?.querySelector?.(".window-header");
	if (!header || header.querySelector(".stonetop-open-steading")) return;

	const { label, class: cls, icon, onclick } = stonetopSteadingHeaderButton();
	const btn = document.createElement("a");
	btn.className = "header-button control " + cls;
	btn.innerHTML = `<i class="${icon}"></i> ${escHtml(label)}`;
	btn.addEventListener("click", ev => { ev.preventDefault(); onclick(); });

	header.insertBefore(btn, header.querySelector(".header-button.close, a.close"));
}

/**
 * The "4+Prosperity" a character's numbers are built on when the steading's Prosperity can't be
 * read (no steading, or a blank value): Prosperity is "+0 by default" (Book I p.88), so 4. ONE
 * number for the small-item allotment, the uses in a ◆ of supplies, Recover's HP and a crew's
 * supplies, which each used to guess their own (9, 6, 4 and 5). Applied at the source,
 * StonetopCharacter#getSmallItemLimit / #getUsesPerSupply, so no reader keeps a fallback of its own.
 */
export const FALLBACK_FOUR_PLUS_PROSPERITY = 4;

/**
 * The Prosperity a character's gear works from: the steading's own, 1 lower while it is marked
 * Lacking ("Treat Prosperity as if it's 1 lower than it is", Book I p.66 and p.513). The one reader
 * for the four things Prosperity sets on the character side: the small-item allotment, the uses in
 * a ◆ of supplies, Recover's 4+Prosperity HP and "x piercing". Null when there is no steading or
 * its Prosperity can't be read: StonetopCharacter#getSmallItemLimit answers that with
 * FALLBACK_FOUR_PLUS_PROSPERITY for every reader that needs a number, and the "x piercing" captions
 * keep the literal x.
 *
 * @param {Actor|null} steading
 * @returns {number|null}
 */
export function effectiveProsperity(steading) {
	if (!steading) return null;
	const raw = steadingSystemValue(steading, "attributes.prosperity.value", { nullIsMissing: true });
	if (raw === undefined || raw === null || raw === "") return null;
	const prosperity = Number(raw);
	if (!Number.isFinite(prosperity)) return null;
	const lacking = !!steadingSystemValue(steading, "attributes.debilities.options.lacking.value", { nullIsMissing: true });
	return prosperity - (lacking ? 1 : 0);
}

// The world steading's Prosperity as gear sees it (effectiveProsperity: Lacking counts). Its one
// reader is "x piercing" at damage time (damage.js#resolvePiercing), which has to agree with the
// sheet's "1 piercing" caption, and that caption is built through effectiveProsperity too.
export function getStonetopProsperity() {
	return effectiveProsperity(getStonetopSteadingActor());
}
