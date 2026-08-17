import { applyGearTermTooltips } from "../utils/gear-term-tooltips.js";
import { ensureMonsterRefIndex, enrichBestiaryElement } from "../utils/bestiary-cross-refs.js";
import { applyLocationTooltips, applyTooltipsThenRestrict } from "../locations/location-tooltips.js";
import { getHoverDescriptionSetting } from "../settings.js";
import { markQuestionBullets } from "../utils/question-bullets.js";
import { markValueTooltips } from "../utils/value-tooltips.js";
import { markDebilityTooltips } from "../utils/debility-tooltips.js";
import { installDragSmoothing } from "../utils/drag-smoothing.js";

// Apply gear-term tooltips only to the containers we know hold gear-tag <em>
// elements. Applying to html[0] wholesale reaches into PBTA system partials
// and other structural elements we shouldn't touch.
const GEAR_TAG_SELECTORS = ".stonetop-inv-note, .stonetop-item-description";

// Read-mode prose containers on the monster sheet that hold
// damage/quality/instinct/move text worth cross-linking and tagging.
const BESTIARY_PROSE_SELECTORS = [
	".stonetop-monster-prose",            // concept, damage value, instinct value
	".stonetop-monster-readonly-text",    // qualities, dangers, nests, notes
	".stonetop-monster-move-description",  // monster move bodies
	".stonetop-monster-line",             // hooks / origins lines
	".stonetop-discovery-body",           // discovery sub-section prose
].join(", ");

export function onRenderActorSheet(sheet, html) {
	const root = html[0];
	root?.closest(".app")?.classList.add("stonetop");
	// Promote the window to its own compositor layer while its header is being
	// dragged, so Foundry's left/top drag re-composites a cached texture instead
	// of repainting the whole (large, parchment-backed) sheet each frame.
	installDragSmoothing(sheet);
	markQuestionBullets(root);
	// Hover tooltips on "Value N" trade-tier mentions in item/move/loot prose — across
	// every actor type (character inventory & moves, the steading, the monster's loot).
	// Self-gated by the hoverDescriptionsValues setting; the literal "Value N" pattern is
	// specific enough (capital V + a digit) to run on the whole sheet root safely.
	markValueTooltips(root);

	const type = sheet?.actor?.type;
	// Embolden + explain character debilities (Weakened/Dazed/Miserable) wherever
	// "debility" appears in move/prose text. Skip the steading sheet (actor type
	// "stonetop") — its own debilities (diminished/lacking/malcontent) are a
	// different thing, and its "Debilities" section title shouldn't be tagged.
	if (type !== "stonetop") markDebilityTooltips(root);

	if (type === "monster") {
		_enrichBestiarySheet(sheet, root);
		// Baked @UUID cross-links in the stat block's prose (e.g. a Fae's "Fae nature"
		// → The Fae lore entry) render as content-links via enrichHTML; give them the
		// same entry-summary hover the journal sheets show. Independent of the creature/
		// gear hover settings — it's the cross-link tooltip, which carries its own
		// `hoverDescriptionsJournalLinks` toggle (applied inside applyLocationTooltips).
		applyLocationTooltips(root);
		return;
	}

	if (type === "npc") {
		// The NPC sheet's Connections/Stat Block/Threat fields hold @UUID cross-links
		// (to other actors, threats, lore); give them the same entry-summary hover, then
		// de-link the ones this user can't open — the same treatment journal prose gets
		// (see the journal render hook in stonetop.js). Without it a player reading an NPC
		// sees a hidden Threat or bestiary entry as a red "broken" link, which both looks
		// wrong and advertises that something hidden is behind the name. Ordering rationale
		// lives in applyTooltipsThenRestrict.
		applyTooltipsThenRestrict(root);
		return;
	}

	if (!getHoverDescriptionSetting("hoverDescriptionsGearTags")) return;
	root.querySelectorAll(GEAR_TAG_SELECTORS).forEach(el => applyGearTermTooltips(el));
}

async function _enrichBestiarySheet(sheet, root) {
	if (!root) return;
	const monsterRefs = getHoverDescriptionSetting("hoverDescriptionsMonsterRefs");
	const gearTags    = getHoverDescriptionSetting("hoverDescriptionsGearTags");
	if (!monsterRefs && !gearTags) return;

	// Delegated on the freshly rendered root so it also catches links injected
	// after the (awaited) index build below.
	if (monsterRefs) root.addEventListener("click", _onCreatureRefClick);

	if (monsterRefs) await ensureMonsterRefIndex();
	if (!root.isConnected) return; // sheet re-rendered while we awaited — stale root

	const selfName = sheet.actor?.name ?? "";
	for (const el of root.querySelectorAll(BESTIARY_PROSE_SELECTORS)) {
		enrichBestiaryElement(el, { selfName, monsterRefs, gearTags });
	}
}

async function _onCreatureRefClick(ev) {
	const link = ev.target.closest(".stonetop-monster-ref");
	if (!link) return;
	ev.preventDefault();
	ev.stopPropagation();
	const doc = link.dataset.uuid ? await fromUuid(link.dataset.uuid).catch(() => null) : null;
	doc?.sheet?.render(true);
}
