// The Fight tab: Foundry's Combat tab, without initiative, showing who is fighting whom.
//
// Stonetop has no turn order ("Players shouldn't get bored waiting for 'their turn'", Book I p.417),
// so this keeps core's encounter record and throws away everything built on turns. What is left is
// core's own plumbing, which is worth keeping: a token HUD toggle and a multi-select still add
// combatants, hovering a row still lights its token, clicking still pans to it, the tab still pops out.
//
// A FACTORY OVER THE BASE CLASS, so tests can hand in a stand-in and the class body never names a
// core global at import time. fight-boot.js makes the real one at init, when the setting is on.
//
// WHAT IS REPLACED:
//  • The header and tracker PARTS, and the two context preparers that feed them. Core's own
//    preparers are where initiative, rounds and turn controls are built; overriding both means none
//    of that code runs. There is no footer part: it only ever held Begin, Next Turn and End.
//  • The combatant context menu (no initiative entries), and the encounter menu (gone).
//
// WHAT MUST STAY, because core's own listeners look for it: rows are `.combatant[data-combatant-id]`
// with `data-action="activateCombatant"`, inside an element with class `combat-tracker`.
//
// ⚠ NO `stonetop` CLASS ON THE ROOT. The sidebar tab is core chrome and follows core's theme;
// utils/window-theme.js pins any ApplicationV2 carrying a `stonetop` class to the light theme, which
// here would repaint the whole sidebar. The fight's cards carry their own paper and ink instead.
//
// DRAG A FIGHTER ONTO ONE ON THE OTHER SIDE. A foe goes onto a hero and a hero onto a foe alike;
// either way the row picked up is the token that moves, up against the one it was dropped on
// (send-against.js). A reader may pick up anyone in the fight, players included, other players'
// characters too; only a hidden fighter is the GM's alone. Native drag and drop, delegated from the frame
// so it survives every redraw, and carrying only our own data types: dropped on the map or a sheet,
// the row is nothing anybody else reads.
//
// THE POP-OUT IS THE FIGHT WINDOW. Core pops a sidebar tab out by making a second instance of this
// class inside a frame (`isPopout`), and fight-window.js opens that when a fight starts. The same
// rule holds for it: core's pop-out look, no `stonetop` class. What differs is only where it opens,
// that it resizes, and that it remembers both.

import { snapshotFight, combatantBodies, combatantSide, COUNT_FLAG, SIDE_FLAG } from "./fight-state.js";
import { FIGHT_OVER, fightWindowPosition, noteFightWindowClosed, openFightWindow, rememberFightWindowPosition } from "./fight-window.js";
import { fightTrackerView } from "./fight-view.js";
import { canReadFoeVitals, combatantVitals, fightVitalsKey, followerRoster } from "./fight-vitals.js";
import { canSplit, mergeCandidates, mergeIntoGroup, splitGroup } from "./group-scale.js";
import { otherSide, fightsAsGroup } from "./fight-sides.js";
import { mayMove } from "./send-against.js";
import { clearShots, hasShots } from "./fight-shots.js";
import { SYSTEM_ID } from "../system-id.js";
import { contextMenuEntry } from "../utils/foundry-compat.js";
import { bookPageCites } from "../gm-toolkit/book-ref.js";
import { followBookCite } from "../books/rulebook-icons.js";
import { format, localize } from "../utils/i18n.js";
import { escHtml } from "../utils/strings.js";
import { themedDialogClasses } from "../utils/window-theme.js";
import { confirmOutcome } from "../utils/ask-with-buttons.js";

// Plain literals, not built from SYSTEM_ID: the precache check in tests finds template paths by
// searching the source for them.
const HEADER_TEMPLATE = "systems/stonetop-pwd/templates/sidebar/fight-header.hbs";
const TRACKER_TEMPLATE = "systems/stonetop-pwd/templates/sidebar/fight-tracker.hbs";

/** The prefix every fighter-row drag type is built on. */
const FIGHTER_DRAG_TYPE = "application/x-stonetop-fighter";
/**
 * The drag data type a fighter's row carries: its combatant id, under the row's OWN side. A dragover
 * may read the TYPES on a drag but never their values, so the side has to be part of the type for a
 * row to tell, while the drag is still in the air, whether the drag is one it takes -- and a row only
 * ever takes the other side's, so both handlers ask for exactly one type: otherSide's.
 */
export const fighterDragType = side => `${FIGHTER_DRAG_TYPE}+${side}`;
const DROP_CLASS = "is-drop-target";
const DRAG_CLASS = "is-dragging";

/**
 * Whether a combatant's headcount is the GM's to set here, rather than read off a group monster or a
 * group follower's roster (fight-sides.js#bodiesFor).
 */
function headcountIsOurs(combatant) {
	const actor = combatant?.actor;
	if (followerRoster(combatant)) return false;
	return !fightsAsGroup({ type: actor?.type, fightAsGroup: actor?.system?.fightAsGroup, organization: actor?.system?.organization });
}

/**
 * @param {typeof foundry.applications.sidebar.tabs.CombatTracker} Base
 */
export function createFightTrackerClass(Base) {
	return class FightTracker extends Base {
		static DEFAULT_OPTIONS = {
			// The pop-out is titled "Combat" (stonetop.fight.window) while the sidebar tab reads "Fight": the
			// window stands where core's combat tracker would, and the table calls it that. Kept on purpose.
			window: { title: "stonetop.fight.window" },
			actions: {
				startFight: FightTracker.#onStartFight,
				addToFight: FightTracker.#onAddToFight,
				lineUpFight: FightTracker.#onLineUp,
				endFight: FightTracker.#onEndFight,
				stopRounds: FightTracker.#onStopRounds,
				openFightWindow: FightTracker.#onOpenWindow,
			},
		};

		static PARTS = {
			header: { template: HEADER_TEMPLATE },
			tracker: { template: TRACKER_TEMPLATE, scrollable: [""] },
		};

		/** The "What the book says" folds this reader has open, kept across redraws. */
		_openRules = new Set();

		/** The engagements this tab last drew, so the watcher can skip a redraw that changes nothing. */
		fightSignature = null;

		/** Everyone's HP and armor as this tab last drew them, for the same skip. */
		fightVitals = null;

		/**
		 * @inheritDoc: the pop-out opens where the reader left it (else beside the sidebar) and resizes.
		 *
		 * Core builds the pop-out's options from the tab's own, so it would inherit the tab's `active`
		 * class had the Fight tab been the open one when the interface was built. Core always builds on
		 * Chat, but a module that opens the sidebar elsewhere would hand it over, and core's
		 * `.combat-sidebar.active` rule gives that height 0: the window shrinks to its title bar
		 * (measured offline, 52px). Dropped here, on the pop-out only.
		 */
		_initializeApplicationOptions(options) {
			const initialized = super._initializeApplicationOptions(options);
			if (!initialized.window?.frame) return initialized;
			initialized.window.resizable = true;
			initialized.window.icon ||= "fa-solid fa-swords";
			initialized.classes = initialized.classes.filter(name => name !== "active");
			initialized.position = { ...initialized.position, ...fightWindowPosition() };
			return initialized;
		}

		/** @override */
		async _preFirstRender(context, options) {
			// The row and rules partials are registered by the init-time preload, and the sidebar can
			// draw before those fetches land.
			try { await globalThis.game?.stonetop?.templatesReady; }
			catch (err) { console.error("Stonetop | Fight tab: template preload failed", err); }
			return super._preFirstRender(context, options);
		}

		/** @override: the header, with no initiative, rounds or turn controls. */
		async _prepareCombatContext(context, _options) {
			const combat = this.viewed;
			const combats = this.combats;
			const index = combats.indexOf(combat);
			const user = globalThis.game?.user;
			Object.assign(context, {
				user: context.user ?? user,
				isGM: !!user?.isGM,
				combat,
				hasCombat: !!combat,
				cycle: combats.length > 1 ? {
					text: format("stonetop.fight.cycle.count", { index: index + 1, count: combats.length }),
					previousId: combats[index - 1]?.id ?? "",
					nextId: combats[index + 1]?.id ?? "",
				} : null,
				isPopout: !!this.isPopout,
				roundsStarted: (combat?.round ?? 0) > 0,
			});
		}

		/** @override: one card per engagement, in place of the turn list. */
		async _prepareTrackerContext(context, _options) {
			const combat = this.viewed;
			const user = globalThis.game?.user;
			context.isGM = !!user?.isGM;
			context.fight = null;
			if (!combat) return;
			const scene = combat.scene ?? globalThis.canvas?.scene ?? null;
			const snapshot = snapshotFight(combat, { scene });
			if (!snapshot) return;
			// Each row awaits core's thumbnail, which decodes video token art the first time it sees it.
			// One at a time, the tab cannot paint until the last of them has finished.
			const inFight = [...snapshot.combatants.values(), ...snapshot.elsewhere];
			const rows = new Map(await Promise.all(inFight.map(async c => [c.id, await this._fightRow(c)])));
			context.fight = fightTrackerView({
				snapshot, rows, isGM: !!user?.isGM, format, cites: bookPageCites, openRules: this._openRules,
			});
			this.fightSignature = snapshot.result.signature;
			this.fightVitals = fightVitalsKey(combat);
		}

		/** What one combatant's row needs beyond the engagements. */
		async _fightRow(combatant) {
			const user = globalThis.game?.user;
			const onCanvas = !!combatant.sceneId && combatant.sceneId === globalThis.canvas?.scene?.id;
			const bodies = combatantBodies(combatant);
			return {
				name: combatant.name ?? "",
				img: await this._getCombatantThumbnail(combatant),
				hidden: !!combatant.hidden,
				defeated: !!combatant.isDefeated,
				vitals: combatantVitals(combatant),
				seesFoeVitals: canReadFoeVitals(combatant, user),
				side: combatantSide(combatant),
				canPing: onCanvas && !!user?.hasPermission?.("PING_CANVAS"),
				// Anyone in the fight may be sent at someone, a hidden one only by a GM (send-against.js#mayMove).
				canSend: mayMove(combatant),
				onCanvas,
				group: bodies.group,
				standing: bodies.standing,
				size: bodies.size,
			};
		}

		/** @inheritDoc */
		_attachFrameListeners() {
			super._attachFrameListeners();
			// Book citations open the GM's copy of the book at that page.
			this.element.addEventListener("click", event => {
				if (followBookCite(event.target)) event.preventDefault();
			});
			// A fold's open state, remembered so a token moving does not snap it shut. `toggle` does not
			// bubble, hence the capture.
			this.element.addEventListener("toggle", event => {
				const key = event.target?.dataset?.rulesKey;
				if (!key) return;
				if (event.target.open) this._openRules.add(key);
				else this._openRules.delete(key);
			}, true);
			this.element.addEventListener("dragstart", event => this._onFightDragStart(event));
			this.element.addEventListener("dragend", event => this._onFightDragEnd(event));
			this.element.addEventListener("dragover", event => this._onFightDragOver(event));
			this.element.addEventListener("dragleave", event => this._onFightDragLeave(event));
			this.element.addEventListener("drop", event => this._onFightDrop(event));
		}

		/** A GM picks up a fighter's row. */
		_onFightDragStart(event) {
			const row = event.target?.closest?.("[data-fight-drag]");
			const id = row?.dataset?.combatantId;
			const side = row?.dataset?.fightDrag;
			if (!id || !side || !event.dataTransfer) return;
			event.dataTransfer.setData(fighterDragType(side), id);
			event.dataTransfer.effectAllowed = "move";
			row.classList.add(DRAG_CLASS);
		}

		_onFightDragEnd(event) {
			event.target?.closest?.("[data-fight-drag]")?.classList.remove(DRAG_CLASS);
			// The drop may have landed in the other copy of the tab (window or sidebar); clear this one.
			for (const lit of this.element?.querySelectorAll?.(`.${DROP_CLASS}`) ?? []) lit.classList.remove(DROP_CLASS);
		}

		/**
		 * A row under a fighter dragged from the other side says it will take them. Only the types are
		 * readable mid-drag, and the one this row takes is the other side's, so its presence is the answer.
		 */
		_onFightDragOver(event) {
			const row = event.target?.closest?.("[data-fight-drop]");
			const side = row?.dataset?.fightDrop;
			if (!side || ![...(event.dataTransfer?.types ?? [])].includes(fighterDragType(otherSide(side)))) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
			row.classList.add(DROP_CLASS);
		}

		_onFightDragLeave(event) {
			const row = event.target?.closest?.("[data-fight-drop]");
			if (row && !row.contains(event.relatedTarget)) row.classList.remove(DROP_CLASS);
		}

		/** A fighter dropped on one from the other side: move their token up against that one's. */
		_onFightDrop(event) {
			const row = event.target?.closest?.("[data-fight-drop]");
			const side = row?.dataset?.fightDrop;
			const moverId = side ? event.dataTransfer?.getData?.(fighterDragType(otherSide(side))) : "";
			if (!moverId) return;
			event.preventDefault();
			row.classList.remove(DROP_CLASS);
			return globalThis.game?.stonetop?.fight?.sendAgainst?.(this.viewed, moverId, row.dataset.combatantId);
		}

		/**
		 * @inheritDoc: the Fight window never grows past the foot of the screen.
		 *
		 * Left to itself, core fits a pop-out to its content, and when that is taller than the room
		 * below the window it slides the window UP to make space, until the frame is the screen's
		 * whole height. Here the frame is held to the room below where it stands (the stylesheet
		 * reads `--stonetop-fight-top`), so its top edge stays put and the list of fighters scrolls
		 * inside it, under the header's buttons.
		 *
		 * Only while the window fits its content. A window the reader has sized (_fightSized) is marked
		 * `data-stonetop-fight-sized`, which lifts that hold: core keeps the height it clamps to as the
		 * window's own, so the hold would shrink a sized window dragged low for good. Set before core reads
		 * the frame's style.
		 */
		_updatePosition(position) {
			if (this.isPopout && this.element) {
				const top = Number(position?.top);
				if (Number.isFinite(top)) this.element.style.setProperty("--stonetop-fight-top", `${Math.max(0, Math.round(top))}px`);
				this.element.toggleAttribute("data-stonetop-fight-sized", this._fightSized());
			}
			return super._updatePosition(position);
		}

		/**
		 * Whether the reader has given the Fight window a height: core writes it into the options when they
		 * start dragging it to a size, and a saved one opens there. The one test for it. The position's own
		 * height says nothing: restoring a window from minimized hands it back in numbers.
		 */
		_fightSized() {
			return Number.isFinite(this.options.position?.height);
		}

		/**
		 * @inheritDoc: a window still fitting its content goes on fitting it once it is restored. Core
		 * restores it at the height it had when it was minimized, in numbers, which would pin it there: new
		 * fighters would scroll rather than grow it.
		 */
		async maximize() {
			await super.maximize();
			if (this.isPopout && !this.minimized && !this._fightSized()) this.setPosition({ height: "auto" });
		}

		/**
		 * @inheritDoc: a moved or resized Fight window opens there next time. A minimized one says nothing about that.
		 * The height is kept only once the reader has given the window one (_fightSized).
		 */
		_onPosition(position) {
			super._onPosition(position);
			if (!this.isPopout || this.minimized) return;
			rememberFightWindowPosition(this._fightSized() ? this.position : { ...this.position, height: "auto" });
		}

		/** @inheritDoc: the reader closing the Fight window keeps it shut for this fight; the fight ending does not. */
		_onClose(options) {
			super._onClose(options);
			if (this.isPopout && !options?.[FIGHT_OVER]) noteFightWindowClosed();
		}

		/** @override: GM tools for one combatant; nothing about initiative. */
		_getEntryContextOptions() {
			const combatantOf = target => this.viewed?.combatants?.get(target?.dataset?.combatantId) ?? null;
			const gm = () => !!globalThis.game?.user?.isGM;
			return [
				contextMenuEntry({
					label: "stonetop.fight.menu.switchSide",
					icon: "fa-solid fa-right-left",
					visible: target => gm() && !!combatantOf(target),
					run: target => this._switchSide(combatantOf(target)),
				}),
				contextMenuEntry({
					label: "stonetop.fight.menu.headcount",
					icon: "fa-solid fa-people-group",
					visible: target => gm() && headcountIsOurs(combatantOf(target)),
					run: target => this._askHeadcount(combatantOf(target)),
				}),
				// A shot on record (fight-shots.js) stays until the shooter closes with somebody or shoots
				// elsewhere; the GM can end it sooner, when the archer has turned to something else.
				contextMenuEntry({
					label: "stonetop.fight.menu.stopShooting",
					icon: "fa-solid fa-bow-arrow",
					visible: target => gm() && hasShots(combatantOf(target)),
					run: target => clearShots(combatantOf(target)),
				}),
				contextMenuEntry({
					label: "stonetop.fight.scale.menuMerge",
					icon: "fa-solid fa-object-group",
					visible: target => gm() && mergeCandidates(this.viewed, combatantOf(target)).length >= 2,
					run: target => mergeIntoGroup(this.viewed, combatantOf(target)),
				}),
				contextMenuEntry({
					label: "stonetop.fight.scale.menuSplit",
					icon: "fa-solid fa-object-ungroup",
					visible: target => gm() && canSplit(combatantOf(target)),
					run: target => splitGroup(this.viewed, combatantOf(target)),
				}),
				contextMenuEntry({
					label: "stonetop.fight.menu.openSheet",
					icon: "fa-solid fa-user",
					visible: target => !!combatantOf(target)?.actor?.testUserPermission?.(globalThis.game?.user, "OBSERVER"),
					run: target => combatantOf(target)?.actor?.sheet?.render(true),
				}),
				contextMenuEntry({
					label: "stonetop.fight.menu.remove",
					icon: "fa-solid fa-trash",
					visible: target => gm() && !!combatantOf(target),
					run: target => combatantOf(target)?.delete(),
				}),
			];
		}

		/** @override: the encounter menu held initiative and turn tools only. */
		_getCombatContextOptions() {
			return [];
		}

		/** Move a combatant to the other side. */
		async _switchSide(combatant) {
			const side = combatantSide(combatant);
			if (!combatant || !side) return;
			await combatant.update({ [`flags.${SYSTEM_ID}.${SIDE_FLAG}`]: otherSide(side) });
		}

		/** Ask the GM how many people one token stands for (a crew, a warband). */
		async _askHeadcount(combatant) {
			const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
			if (!combatant || !DialogV2) return;
			const current = Math.max(1, Math.trunc(Number(combatant.flags?.[SYSTEM_ID]?.[COUNT_FLAG]) || 1));
			// A bare <div> as the content (DialogV2 wraps its own form around it), the house shape
			// from dialogs/content-picker.js#promptForText.
			const content = document.createElement("div");
			content.innerHTML = `<div class="stonetop-fight-headcount">
				<label class="stonetop-fight-headcount-field">
					<span>${escHtml(localize("stonetop.fight.headcount.label"))}</span>
					<input type="number" name="stonetopHeadcount" min="1" step="1" value="${current}">
				</label>
				<p class="stonetop-fight-headcount-hint">${escHtml(localize("stonetop.fight.headcount.hint"))}</p>
			</div>`;
			const count = await DialogV2.prompt({
				classes: themedDialogClasses(),
				window: { title: format("stonetop.fight.headcount.title", { name: combatant.name ?? "" }) },
				content,
				render: (_event, dialog) => {
					const field = (dialog?.element ?? dialog)?.querySelector?.("input[name='stonetopHeadcount']");
					field?.focus?.();
					field?.select?.();
				},
				ok: {
					label: localize("stonetop.fight.headcount.confirm"),
					callback: (_event, button) => Number(button.form.elements.namedItem("stonetopHeadcount")?.value),
				},
				rejectClose: false,
			}).catch(() => null);
			if (count == null || !Number.isFinite(count)) return;
			await combatant.update({ [`flags.${SYSTEM_ID}.${COUNT_FLAG}`]: Math.max(1, Math.trunc(count)) });
		}

		// ── Header actions ──────────────────────────────────────────────────────

		static #onStartFight() {
			return globalThis.game?.stonetop?.fight?.openStart?.();
		}

		static #onAddToFight() {
			return globalThis.game?.stonetop?.fight?.openStart?.({ combat: this.viewed });
		}

		static #onLineUp() {
			return globalThis.game?.stonetop?.fight?.lineUp?.(this.viewed);
		}

		static #onOpenWindow() {
			return openFightWindow({ byHand: true });
		}

		static async #onStopRounds() {
			const combat = this.viewed;
			if (!combat || !globalThis.game?.user?.isGM) return;
			await combat.update({ round: 0, turn: null });
		}

		static async #onEndFight() {
			const combat = this.viewed;
			if (!combat || !globalThis.game?.user?.isGM) return;
			const content = document.createElement("div");
			content.innerHTML = `<p>${escHtml(localize("stonetop.fight.end.body"))}</p>`;
			// Buttons that name what they do, the affirmative first (on the left). Enter keeps
			// fighting, as it did under core's confirm.
			const confirmed = await confirmOutcome({
				title: localize("stonetop.fight.end.title"),
				content,
				yes: { label: localize("stonetop.fight.end.confirm"), icon: "fa-flag" },
				no: { label: localize("stonetop.fight.end.cancel") },
			});
			if (confirmed) await combat.delete();
		}
	};
}

