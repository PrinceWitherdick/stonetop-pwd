// Builds the shared view-model for a threat card, used by all three renderers:
// the page sheet (view mode), the steading Threats tab, and the on-canvas overlay.
// Centralizing it keeps the book-faithful card identical everywhere and gives every
// host the same data-* hooks (data-portent-index / data-doom) to wire interactivity.
import { threatType, threatProximity, THREAT_TYPE_IDS } from "./threat-types.js";
import { setPortentDone, setDoomDone } from "./threat-store.js";
import { hasText, stringList, buildDoomRows, buildImpending, buildCustomPlayerMoves, cardEnricher, asCardHtml } from "../journal/card-vm.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { format, localize } from "../utils/i18n.js";
import { confirmOutcome } from "../utils/ask-with-buttons.js";
import { escHtml } from "../utils/strings.js";

/**
 * View-model for one threat page. Async because prose fields are enriched. Pass
 * `{ forOwner }` to force the owner/editable affordances (defaults to page.isOwner).
 */
export async function buildThreatCardVM(page, { forOwner } = {}) {
	const sys = page.system ?? {};
	const type = threatType(sys.type);
	const proximity = threatProximity(sys.proximity);
	// Enrich prose (resolve @UUID links, inline rolls) without revealing GM secret blocks.
	const enrich = cardEnricher();

	const doomRows = buildDoomRows(sys);
	const impending = buildImpending(sys);

	const stakes = stringList(sys.stakes);
	const gmMoves = stringList(sys.gmMoves);
	// "Things Below" write-ups (Book II): themes/aspects flavor a Thing; cleansing lists a
	// corrupted site's Make-a-Plan requirements. Empty on an ordinary threat.
	const themes = stringList(sys.themes);
	const aspects = stringList(sys.aspects);
	const cleansing = stringList(sys.cleansing);
	const nested = (Array.isArray(sys.nested) ? sys.nested : [])
		.filter(n => hasText(n?.name))
		.map(n => {
			// A lesser threat written up "in parentheses" (Book I p.289: "(rabble; to covet)"). The
			// editor lets its type stay blank, and `threatType` would quietly answer Villain for that,
			// so only a real type id is named; the parenthetical carries whichever halves exist.
			const type = THREAT_TYPE_IDS.includes(n.type) ? threatType(n.type).label : "";
			const instinct = String(n.instinct ?? "");
			const note = [type, instinct.trim()].filter(Boolean).join("; ");
			return { name: String(n.name), type, instinct, note };
		});

	const customPlayerMoves = await buildCustomPlayerMoves(sys, enrich);

	return {
		id: page.id,
		uuid: page.uuid,
		name: page.name,
		type,
		accent: type.accent,
		instinct: String(sys.instinct ?? ""),
		hasInstinct: hasText(sys.instinct),
		themes,
		hasThemes: themes.length > 0,
		aspects,
		hasAspects: aspects.length > 0,
		cleansing,
		hasCleansing: cleansing.length > 0,
		proximity,
		// Rich text from the editor passes through unchanged; a plain-text seed (a Things Below
		// write-up) keeps its paragraph breaks.
		description: await enrich(asCardHtml(sys.description)),
		hasDescription: hasText(sys.description),
		doomRows,
		impendingDoom: impending,
		hasDoomTrack: doomRows.length > 0 || impending.hasText,
		stakes,
		hasStakes: stakes.length > 0,
		gmMoves,
		hasGmMoves: gmMoves.length > 0,
		customPlayerMoves,
		hasCustomMoves: customPlayerMoves.length > 0,
		nested,
		hasNested: nested.length > 0,
		// Crossed off the tracker (Book I p.299): drawn greyed, and kept off the active board.
		resolved: !!sys.resolved,
		isOwner: forOwner ?? page.isOwner,
	};
}

// ── Shared card interactivity ───────────────────────────────────────────────────
// The card view is identical across the page sheet, the steading Threats tab, and the
// on-canvas overlay, so the interactions its data-* hooks expose (ticking the doom track,
// dragging the card to a scene) are wired once here. Hosts differ only in how a card
// element maps back to its page — passed in as `resolvePage` — and in what they do after.

/**
 * Wire the doom-track checkboxes onto a delegated `root`: ticking a grim portent or the
 * impending-doom box writes straight to the page. `resolvePage(checkbox)` returns the
 * page (or a promise of it) the ticked control belongs to.
 */
export function wireThreatDoomChange(root, resolvePage) {
	root.addEventListener("change", async ev => {
		const chk = ev.target.closest?.(".threat-portent__check");
		if (!chk || chk.disabled) return;
		ev.stopPropagation();
		const page = await resolvePage(chk);
		if (!page) return;
		const doom = chk.dataset.doom === "true";
		const index = Number(chk.dataset.portentIndex);
		const wrote = doom ? await setDoomDone(page, chk.checked) : await setPortentDone(page, index, chk.checked);
		// Only a tick that changed the page: a stale checkbox (another GM's window got there
		// first) must not ask, or write a row the page does not bear out.
		if (wrote) await threatOnTimeline(page, { doom, index, done: chk.checked });
	});
}

/**
 * Wire a card's "Give to players" buttons on a delegated `root` (card-player-moves.hbs): a threat's
 * or hazard's custom player move, opened in the custom-move editor filled in with it, which saves it
 * as a world move the players can drag onto their sheets. Book I p.294 (a threat's player-facing
 * moves) and p.388 (a hazard's: "When the PCs encounter the hazard and the move becomes relevant,
 * share it with the players").
 *
 * The CUSTOM MOVE flow rather than a love letter: a love letter is one roll put to one player, once
 * (Book I p.568), while these moves are triggered whenever the fiction says so, by whoever meets
 * them, which is what a move on the sheet is. The editor also lets the GM add the roll and the
 * 10+/7-9/6- text so it rolls like any other move. Loaded on the click, so the card hosts do not
 * pull the editor in to draw a card.
 */
export function wireSharePlayerMoves(root, resolvePage) {
	root.addEventListener("click", async ev => {
		const btn = ev.target.closest?.(".threat-player-move__share");
		if (!btn || !globalThis.game?.user?.isGM) return;
		ev.preventDefault();
		ev.stopPropagation();
		const page = await resolvePage(btn);
		const move = page?.system?.customPlayerMoves?.[Number(btn.dataset.moveIndex)];
		if (!move) return;
		const { CustomMoveDialog, worldMoveSaver } = await import("../actors/character/dialogs/CustomMoveDialog.js");
		new CustomMoveDialog(worldMoveSaver(), { seed: sharedMoveSeed(move, page.name) }).render(true);
	});
}

/**
 * What the editor opens filled in with: the move's label as its name (or "<threat>: player move"
 * for one the GM never named), and its text as the description, which the editor reads back to
 * plain text (custom-move-text.js#customMoveDescriptionToPlainText).
 */
export function sharedMoveSeed(move, ownerName = "") {
	const name = String(move?.label ?? "").trim() || (ownerName ? `${ownerName}: player move` : "");
	return { name, system: { description: String(move?.text ?? "") } };
}

/**
 * Everything a GM-prep card (threat, hazard, site) does wherever it is drawn, on a delegated `root`, in ONE
 * call per host: its doom track (wireThreatDoomChange), its "Give to players" buttons (wireSharePlayerMoves),
 * and the controls only its kind carries, `wireExtras(root, resolvePage)`: one kind's `wireCard` on a page
 * sheet, every kind's (journal/gm-prep-page.js#wireGmPrepCardExtras) on a host that draws them all. Each is
 * guarded on its own markup, so a card without the control is untouched.
 *
 * @param {HTMLElement} root
 * @param {(el:HTMLElement) => any} resolvePage  the page (or a promise of it) for a ticked or clicked element
 * @param {(root:HTMLElement, resolvePage:Function) => void} [wireExtras]
 */
export function wireGmPrepCard(root, resolvePage, wireExtras = null) {
	wireThreatDoomChange(root, resolvePage);
	wireSharePlayerMoves(root, resolvePage);
	wireExtras?.(root, resolvePage);
}

/** The timeline row a threat's doom (or one portent) coming to pass is kept under. */
export function threatMilestoneKey(pageId, { doom = false, index = 0 } = {}) {
	return doom ? `threat:${pageId}:doom` : `threat:${pageId}:portent:${index}`;
}

/**
 * A threat's doom or grim portent come to pass, onto Stonetop's timeline: ASKED FIRST (user,
 * 2026-10-10). A threat is GM prep, and every player can read Stonetop's timeline, so the GM says
 * whether the table knows before anything is written there. Untick it and the row comes off again,
 * unasked. Threats only: a hazard's track is the same markup, and not the steading's story.
 */
async function threatOnTimeline(page, { doom = false, index = 0, done = false } = {}) {
	if (page?.type !== "threat" || !globalThis.game?.user?.isGM) return;
	try {
		const { forgetMilestones, recordMilestones } = await import("../timeline/timeline-record.js");
		const steading = getStonetopSteadingActor();
		if (!steading) return;
		const key = threatMilestoneKey(page.id, { doom, index });
		if (!done) {
			await forgetMilestones(steading, key);
			return;
		}
		const ask = "stonetop.timeline.threatAsk";
		const yes = await confirmOutcome({
			title:   localize(`${ask}.title`),
			content: format(`${ask}.body`, { name: escHtml(page.name), what: localize(`${ask}.${doom ? "doom" : "portent"}`) }),
			yes:     { label: localize(`${ask}.yes`), icon: "fa-check" },
			no:      { label: localize(`${ask}.no`), icon: "fa-eye-slash" },
		});
		if (!yes) return;
		const text = String((doom ? page.system?.impendingDoom?.text : page.system?.grimPortents?.[index]?.text) ?? "").trim();
		await recordMilestones(steading, [{
			source: "threat",
			key,
			title:  format(`stonetop.timeline.milestone.${doom ? "doomCame" : "portentCame"}`, { name: page.name }),
			...(text ? { body: `<p>${escHtml(text)}</p>` } : {}),
		}]);
	} catch (err) {
		console.error("Stonetop | could not put the threat on the timeline", err);
	}
}

/**
 * Wire "drag a threat card onto a scene to drop a linked pin" on a delegated `root`. The
 * WHOLE card is the drag handle (no grip element), so the selector matches the draggable
 * card; hosts pass their own scoped `selector` and an optional `fallbackUuid` (the page's
 * own uuid, used when the card markup doesn't carry data-page-uuid). Centralized here so
 * every host (page sheet, steading tab, overlay) shares one selector and can't diverge.
 * @param {HTMLElement} root
 * @param {{ selector?: string, fallbackUuid?: string|null }} [opts]
 */
export function wireThreatCardDrag(root, { selector = ".threat-card[draggable='true']", fallbackUuid = null } = {}) {
	root.addEventListener("dragstart", ev => {
		const card = ev.target.closest?.(selector);
		if (!card) return;
		const uuid = card.dataset.pageUuid || fallbackUuid;
		if (!uuid) return;
		ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "JournalEntryPage", uuid }));
		ev.dataTransfer.effectAllowed = "copy";
	});
}
