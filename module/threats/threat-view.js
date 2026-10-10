// Builds the shared view-model for a threat card, used by all three renderers:
// the page sheet (view mode), the steading Threats tab, and the on-canvas overlay.
// Centralizing it keeps the book-faithful card identical everywhere and gives every
// host the same data-* hooks (data-portent-index / data-doom) to wire interactivity.
import { threatType, threatProximity, THREAT_TYPE_IDS } from "./threat-types.js";
import { setPortentDone, setDoomDone } from "./threat-store.js";
import { hasText, stringList, buildDoomRows, buildImpending, buildCustomPlayerMoves, cardEnricher, asCardHtml } from "../journal/card-vm.js";

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
		if (chk.dataset.doom === "true") await setDoomDone(page, chk.checked);
		else await setPortentDone(page, Number(chk.dataset.portentIndex), chk.checked);
	});
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
