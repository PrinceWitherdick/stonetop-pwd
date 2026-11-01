import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { getHoverDescriptionSetting } from "../../../settings.js";
import { applyGearTermTooltips } from "../../../utils/gear-term-tooltips.js";
import { wrapStonetopGlyphsInEl } from "../../../utils/glyphs.js";
import { wireTabSearch } from "../../../utils/tab-search.js";
import { mountScrollerFrost } from "../../../utils/scroll-frost.js";
import { LOAD_LEVEL_LIMITS, deriveLoadLevel, loadBandLabels, poolCountFromClick, poolAtLimitKey } from "../../../utils/load.js";
import { attrValue } from "../../../utils/strings.js";

/** The window's id, one per character (perDocumentOptions). */
export const OUTFIT_ID_PREFIX = "stonetop-outfit-dialog";

export class OutfitMoveDialog extends StonetopDialog {
	constructor(character, outfitSnapshot, onDone, options = {}) {
		// One window PER CHARACTER: a GM outfitting two PCs at once used to get the second one's
		// rows painted into the first one's frame (see StonetopDialog.perDocumentOptions), and the
		// confirm then wrote to whichever character the frame was last filled for.
		super(StonetopDialog.perDocumentOptions(OUTFIT_ID_PREFIX, character?._actor?.id, options));
		this._character      = character;
		// Journal treasures render under their own heading on the sheet, but for Outfit
		// they're just carried gear: fold them back into the column they weigh against, so
		// they can be marked here and still count toward load / the small allowance.
		this._regularItems   = [
			...outfitSnapshot.regularSegments.flatMap(seg => seg.items),
			...(outfitSnapshot.treasureRegular ?? []),
		];
		// The standard small items (catalog rows flagged smallGrid) draw as the sheet draws them,
		// a two-column grid under the list; _smallItems is both halves, for everything that counts.
		this._smallListItems = [
			...outfitSnapshot.smallItems,
			...(outfitSnapshot.treasureSmall ?? []),
		];
		this._smallGridItems = outfitSnapshot.smallGridItems ?? [];
		this._smallItems     = [...this._smallListItems, ...this._smallGridItems];
		// The sheet now groups every arcanum under Arcana, split across the columns by
		// weight; this dialog has always had its own Arcana section, so feed it both halves
		// rather than letting the ◇ ones drift back into the regular list and disagree with
		// the sheet. They're excluded from _regularItems above, so load isn't double-counted.
		this._arcanaItems    = [
			...(outfitSnapshot.arcanaRegular ?? []),
			...(outfitSnapshot.arcanaSmall ?? []),
		];
		// Special-possession gear ("Any of your special possessions") under its own heading in
		// each column, as the sheet draws it inside the possession cards. Kept apart from the two
		// lists above only for that heading: it weighs and counts exactly like them. Each row's
		// slug is the key its mark lives under, which applyOutfit routes to the right store.
		this._possessionRegular = outfitSnapshot.possessionRegular ?? [];
		this._possessionSmall   = outfitSnapshot.possessionSmall ?? [];
		// 4+Prosperity, or 4+0 when it can't be read (StonetopCharacter#getSmallItemLimit); the limit
		// line is printed only when it was read.
		this._smallItemLimit  = outfitSnapshot.smallItemLimit;
		this._prosperityKnown = !!outfitSnapshot.prosperityKnown;
		// A move's loadBonus raises each load cap (Pack Horse by one); the snapshot carries
		// the limits in effect so the thresholds and the regular ◇ ceiling here match the
		// sheet, plus the name of whatever granted the bonus for the note below the bar.
		this._loadLimits     = outfitSnapshot.loadLimits ?? LOAD_LEVEL_LIMITS;
		this._loadBonus      = outfitSnapshot.loadBonus ?? 0;
		this._loadBonusFrom  = outfitSnapshot.loadBonusFrom ?? "";
		// The band captions ("3", "4-6", "7-9") ride along on the snapshot, computed there
		// from these same limits; take that copy rather than deriving a second one, so the
		// badges here and the sheet's load lines cannot drift apart.
		this._loadBands      = outfitSnapshot.loadBands ?? loadBandLabels(this._loadLimits);
		this._checked = {};
		for (const item of [...this._regularItems, ...this._smallItems, ...this._arcanaItems,
			...this._possessionRegular, ...this._possessionSmall]) {
			this._checked[item.slug] = item.checked;
		}
		// "Undefined" ◇/□ marks the player reserves without assigning to an item.
		// Seeded from the last Outfit so reopening shows the current state.
		this._undefinedRegular = outfitSnapshot.regularPool?.current ?? 0;
		this._undefinedSmall   = outfitSnapshot.smallPool?.current ?? 0;
		this._onDone = onDone;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: "stonetop-outfit-dialog",
			template: "systems/stonetop-pwd/templates/dialogs/outfit-move.hbs",
			title: game.i18n.localize("stonetop.specialMoves.outfit.title"),
			// Big enough that both item lists show whole without scrolling. Foundry clamps
			// the height to the viewport, so a shorter screen opens it to the bottom edge.
			width: 850,
			height: 1200,
			resizable: true,
			classes: ["stonetop", "stonetop-outfit-dialog"],
			// Every mark re-renders the window, and each list scrolls on its own: without these a
			// tick halfway down threw the list back to its top. The body, the fallback scroller
			// around them, is the draw's root, which core's restore never finds (it searches inside
			// the fresh draw), so it is kept by _keptScrollSelector instead.
			scrollY: [".stonetop-outfit-regular-section", ".stonetop-outfit-small-section"],
		});
	}

	get _keptScrollSelector() { return ".stonetop-outfit-move-body"; }

	// The box just ticked keeps the keyboard through the redraw: an item by its slug, an undefined
	// box by its track and place.
	_focusSelector(el) {
		const slug = el.dataset?.slug;
		if (el.classList?.contains("stonetop-outfit-item-check") && slug) return `.stonetop-outfit-item-check[data-slug="${attrValue(slug)}"]`;
		const index = el.dataset?.index;
		for (const cls of ["stonetop-regular-pool-btn", "stonetop-small-pool-display"]) {
			if (el.classList?.contains(cls) && index != null) return `.${cls}[data-index="${attrValue(index)}"]`;
		}
		return null;
	}

	getData() {
		const smallRow = item => ({
			slug:    item.slug,
			name:    item.name,
			note:    item.note,
			checked: this._checked[item.slug] ?? false,
		});
		// A regular row carries its weight too.
		const regularRow = item => ({ ...smallRow(item), weight: item.weight });
		const regularItems = this._regularItems.map(regularRow);
		const smallItems = this._smallListItems.map(smallRow);
		const smallGridItems = this._smallGridItems.map(smallRow);

		const arcanaItems = this._arcanaItems.map(item => ({
			slug:    item.slug,
			name:    item.name,
			note:    item.note,
			weight:  item.weight,
			// A ◇0 arcanum has never been markable: the gear tab renders it as a static row,
			// and it is deliberately exempt from both load and the 4+Prosperity allowance. So
			// it gets no checkbox here either — one would tick, persist, and change no number
			// on either screen, which reads as a mark the player can't account for.
			inert:   !((item.weight ?? 0) > 0),
			checked: this._checked[item.slug] ?? false,
		}));

		const possessionRegular = this._possessionRegular.map(regularRow);
		const possessionSmall = this._possessionSmall.map(smallRow);

		const smallItemLimit = this._smallItemLimit;
		const pools = this._resolvePools();

		return {
			regularItems,
			smallItems,
			smallGridItems,
			arcanaItems,
			hasArcana:         arcanaItems.length > 0,
			possessionRegular,
			possessionSmall,
			hasPossessionRegular: possessionRegular.length > 0,
			hasPossessionSmall:   possessionSmall.length > 0,
			totalMarks:        pools.totalMarks,
			loadLevel:         pools.loadLevel,
			loadLevelNone:     pools.loadLevel === null,
			loadLevelLight:    pools.loadLevel === "light",
			loadLevelNormal:   pools.loadLevel === "normal",
			// Overloaded still lights the heavy band, as on the sheet, and says so beside the count.
			loadLevelHeavy:    pools.loadLevel === "heavy" || pools.loadLevel === "overloaded",
			loadLevelOverloaded: pools.loadLevel === "overloaded",
			// The undefined reserves as the Inventory tab's tracks: the full heavy load and the
			// full 4+Prosperity allowance as boxes, so none vanish as items are marked, with the
			// room the marked items leave as the cap a click is held to.
			regularPool:             { current: pools.undefinedRegular, max: this._loadLimits.heavy },
			regularPoolCap:          pools.undefinedRegularMax,
			smallPool:               { current: pools.undefinedSmall, max: this._smallItemLimit },
			smallPoolCap:            pools.undefinedSmallMax,
			totalSmallMarks:   pools.totalSmallMarks,
			smallItemLimit,
			hasSmallItemLimit: this._prosperityKnown,
			loadBonus:         this._loadBonus,
			loadBonusFrom:     this._loadBonusFrom,
			// The two objects themselves, under the names the gear tab's own load lines read
			// them by (`loadLimits` / `loadBands`), so the same value is spelled the same way on
			// both screens instead of being flattened into six keys here and three there.
			loadLimits:        this._loadLimits,
			loadBands:         this._loadBands,
		};
	}

	// Clamp the undefined ◇/□ pools to what the checked items leave room for, and
	// derive the load level from the total marks. Pure: returns the clamped values
	// without mutating the stored reserves, so un-checking an item that had narrowed
	// the room restores the marks rather than destroying them on the next render.
	// getData renders from these; _applyOutfit persists them.
	_resolvePools() {
		const checkedRegularWeight = this._computeTotalWeight();
		const undefinedRegularMax  = Math.max(0, this._loadLimits.heavy - checkedRegularWeight);
		const undefinedRegular     = Math.min(this._undefinedRegular, undefinedRegularMax);

		const checkedSmallCount = [...this._smallItems, ...this._possessionSmall].filter(i => this._checked[i.slug]).length;
		const undefinedSmallMax = Math.max(0, this._smallItemLimit - checkedSmallCount);
		const undefinedSmall    = Math.min(this._undefinedSmall, undefinedSmallMax);

		const totalMarks = checkedRegularWeight + undefinedRegular;
		return {
			undefinedRegular,
			undefinedRegularMax,
			undefinedSmall,
			undefinedSmallMax,
			totalMarks,
			totalSmallMarks:     checkedSmallCount + undefinedSmall,
			loadLevel:           this._loadLevelFor(totalMarks),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);

		// Gear-term hover descriptions (e.g. "near", "forceful", "x piercing") on
		// item notes — the dialog isn't an actor sheet, so onRenderActorSheet's
		// hook never reaches it; apply them here instead.
		if (getHoverDescriptionSetting("hoverDescriptionsGearTags")) {
			html[0].querySelectorAll(".stonetop-outfit-item-note").forEach(el => applyGearTermTooltips(el));
		}

		// Skin any raw ○/◇/□ glyphs in the item notes to the same SVG marks the
		// sheets use; the tree-walker skips the template's already-classed glyph
		// spans (load badges, undefined-pool marks), so it only touches note text.
		wrapStonetopGlyphsInEl(html[0]);

		// Each list gets its own filter, as the Inventory tab's two columns do, matched on the
		// row's name and note. Every mark re-renders the window, so the terms are held on the
		// dialog and put back, rather than dropped on the first click.
		const searchTerms = (this._searchTerms ??= {});
		for (const section of [".stonetop-outfit-regular-section", ".stonetop-outfit-small-section"]) {
			// The frosted seam at the list's top edge, as under the character sheet's header.
			mountScrollerFrost(html[0].querySelector(section));
			wireTabSearch(html[0].querySelector(section), {
				itemSel: ".stonetop-outfit-item",
				textFor: row => [".stonetop-outfit-item-name", ".stonetop-outfit-item-note"]
					.map(sel => row.querySelector(sel)?.textContent ?? "").join(" "),
				memory: searchTerms, key: section,
			});
		}

		html.find(".stonetop-outfit-item-check").on("change", ev => {
			this._checked[ev.currentTarget.dataset.slug] = ev.currentTarget.checked;
			this.render(false);
		});

		// The undefined tracks behave as on the Inventory tab (_onInventoryPoolEdit): clicking a
		// box sets the reserve to it, clicking a filled one clears back to it, and a click past
		// the room the marked items leave fills to that room, warning only when it was full.
		html.find(".stonetop-regular-pool-btn, .stonetop-small-pool-display").on("change", ev => {
			const el = ev.currentTarget;
			this._setPoolFromClick(el.classList.contains("stonetop-small-pool-display"), Number(el.dataset.index), el.checked);
			this.render(false);
		});

		html.find(".stonetop-outfit-confirm-btn").on("click", async () => {
			await this._applyOutfit();
			this.close();
		});
	}

	// A click on box `index` of an undefined track, which `checked` says it now is.
	_setPoolFromClick(isSmall, index, checked) {
		const pools  = this._resolvePools();
		const cap    = isSmall ? pools.undefinedSmallMax : pools.undefinedRegularMax;
		const before = isSmall ? pools.undefinedSmall : pools.undefinedRegular;
		const { count, atLimit } = poolCountFromClick({ index, checked, cap, before });
		if (atLimit) ui.notifications.warn(game.i18n.localize(poolAtLimitKey(isSmall)));
		if (isSmall) this._undefinedSmall = count;
		else this._undefinedRegular = count;
	}

	async _applyOutfit() {
		// Load is derived from the marks on the sheet, so Outfit only records the
		// checked items and the two undefined reserves.
		const { undefinedRegular, undefinedSmall } = this._resolvePools();
		await this._character.applyOutfit(this._checked, undefinedRegular, undefinedSmall);
		if (this._onDone) this._onDone();
	}

	_computeTotalWeight() {
		return [...this._regularItems, ...this._arcanaItems, ...this._possessionRegular]
			.filter(i => this._checked[i.slug])
			.reduce((sum, i) => sum + (i.weight ?? 0), 0);
	}

	// "overloaded" is kept, not folded into heavy: the sheet calls 10 ◇ or more overloaded (Book I
	// p.327, "If they want to carry 10 ◇ or more..."), and the window that sets the load has to say
	// the same before the player confirms it. getData lights the heavy band for it too.
	_loadLevelFor(weight) {
		return deriveLoadLevel(weight, this._loadLimits);
	}
}
