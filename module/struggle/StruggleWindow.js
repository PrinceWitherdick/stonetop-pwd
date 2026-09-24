import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { registerRestorableWindow } from "../utils/window-restore.js";
import { statApproaches } from "../utils/stat-approaches.js";
import { askWithButtons } from "../camp/camp-ask.js";
import { SYSTEM_ID } from "../system-id.js";
import { ROW_KIND, STAT_KEYS, STRUGGLE_FLAG, STRUGGLE_MESSAGE_FLAG, STRUGGLE_ROLL_FLAG, STRUGGLE_STATUS, isLive } from "./struggle-rules.js";
import { struggleWindowView } from "./struggle-view.js";
import {
	boardFor, bumpRow, cancelStruggle, currentStruggle, endStruggle, leaveOut, readerFor, rescue, revealStruggle,
	isStruggleHost, rollRow, setBundleAlly, setSpots, takesPart, touchesFlag, undoRescue,
} from "./struggle-store.js";

const TEMPLATE  = "systems/stonetop-pwd/templates/dialogs/struggle-as-one.hbs";
const ID_PREFIX = "stonetop-struggle";
const SCROLLER  = ".stonetop-guide-main";
/** The kind a struggle window is saved under by utils/window-restore.js, at the head of its key. */
const RESTORE_KIND = "struggle";
/** A burst of rolls lands one update per character within a second; the window redraws once for it. */
const RENDER_DEBOUNCE_MS = 80;

/** The window id for a struggle: one window per struggle, on each client. */
export function struggleWindowId(struggleId) {
	return StonetopDialog.perDocumentOptions(ID_PREFIX, struggleId).id;
}

/** Open a struggle's window, or bring the one already open to the front. */
export function openStruggleWindow(struggleId) {
	return openOrFocus(struggleWindowId(struggleId), () => {
		const app = new StruggleWindow({ struggleId });
		app.render(true);
		return app;
	});
}

/** Whether this client should have a struggle's window up: the struggle is still being played, and this client is in it. */
function struggleWindowWanted(struggleId) {
	const struggle = currentStruggle();
	return !!struggle && struggle.id === struggleId && isLive(struggle) && takesPart(struggle);
}

/** Defy Danger's six printed approaches, read once: the stat picker says what each stat MEANS here. */
let approachesCache = null;
async function defyDangerApproaches() {
	if (approachesCache) return approachesCache;
	try {
		const { fetchMoveRef } = await import("../utils/move-refs.js");
		approachesCache = statApproaches(await fetchMoveRef("Defy Danger"));
	} catch {
		approachesCache = {};
	}
	return approachesCache;
}

/**
 * STRUGGLE AS ONE, SHARED: one window per struggle, open on the GM's client and on every client that
 * rolls in it, redrawn from the documents whenever anybody rolls, gets someone out, or the GM moves it on.
 *
 * Like the Make Camp window it keeps no state of its own. Every control writes straight to a document
 * (the rescuer's character, or the GM Toolkit), and the update that write causes, here and on every
 * other client, is what redraws it.
 *
 * It stays up after the struggle ends, showing how it went, until its reader closes it. A struggle
 * called off closes it at once, since there is nothing left in it to read.
 */
export class StruggleWindow extends StonetopDialog {
	constructor({ struggleId } = {}, options = {}) {
		super(StonetopDialog.perDocumentOptions(ID_PREFIX, struggleId, options));
		this._struggleId = struggleId;
		this._hooks = null;
		this._renderTimer = null;
		this._writes = Promise.resolve();
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			title:     "Struggle as One",
			template:  TEMPLATE,
			width:     860,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-camp-window", "stonetop-struggle-window"],
		});
	}

	get _autoHeight() { return true; }

	/** What utils/window-restore.js saves this window under, and reopens it from after a reload. */
	get restoreKey() {
		return `${RESTORE_KIND}:${this._struggleId}`;
	}

	async getData() {
		const struggle = currentStruggle();
		if (!struggle || struggle.id !== this._struggleId) {
			return { title: "Struggle as One", gone: true, goneText: "This struggle is over.", rows: [] };
		}
		const board = boardFor(struggle);
		const reader = readerFor(struggle);
		const statValues = {};
		const rollerNames = {};
		for (const row of struggle.rows) {
			const actor = game.actors?.get(row.actorId);
			rollerNames[row.actorId] = actor?.name ?? "";
			if (row.kind === ROW_KIND.PC && reader.drives.has(row.key)) {
				statValues[row.key] = Object.fromEntries(STAT_KEYS.map(s => [s, Number(actor?.system?.stats?.[s]?.value) || 0]));
			}
		}
		const approaches = await defyDangerApproaches();
		return struggleWindowView(struggle, board, reader, { statValues, approaches, rollerNames });
	}

	/**
	 * Redraw, and put the reader back where they were: the scroll and the keyboard. Every roll anywhere
	 * in the party redraws the window, which would otherwise throw a reader halfway down it back to the
	 * banner (see CampWindow#_render, which this follows).
	 */
	async _render(force, options) {
		if (!this.rendered && !struggleWindowWanted(this._struggleId)) return;
		const doc = globalThis.document;
		const before = this.element?.[0];
		const scrolled = before?.querySelector?.(SCROLLER)?.scrollTop ?? 0;
		const focusKey = before && doc?.activeElement && before.contains(doc.activeElement)
			? doc.activeElement.dataset?.struggleFocus ?? null
			: null;
		await super._render(force, options);
		const after = this.element?.[0];
		const column = after?.querySelector?.(SCROLLER);
		if (column && scrolled) column.scrollTop = scrolled;
		if (focusKey) after?.querySelector?.(`[data-struggle-focus="${focusKey}"]`)?.focus?.({ preventScroll: true });
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._watch();
		const root = html?.[0] ?? html;
		root?.addEventListener?.("click", ev => this._onClick(ev));
		root?.addEventListener?.("change", ev => this._onChange(ev));
	}

	async close(options = {}) {
		this._unwatch();
		return super.close(options);
	}

	/** Run one write after the last, so each reads the struggle as the one before left it. */
	_queue(noun, task) {
		const run = this._writes.then(task);
		this._writes = run.catch(err => this.reportWriteFailure(noun, err));
		return this._writes;
	}

	_rowControl(key, selector) {
		return this.element?.[0]?.querySelector?.(`[data-row-key="${key}"]${selector}`) ?? null;
	}

	_onClick(ev) {
		const control = ev.target?.closest?.("[data-struggle-action]");
		if (!control || control.disabled) return undefined;
		ev.preventDefault();
		const { struggleAction: action, rowKey } = control.dataset;
		switch (action) {
			case "roll": {
				const stat = control.dataset.stat || this._rowControl(rowKey, ".stonetop-struggle-stat")?.value || "";
				control.disabled = true;
				return this._queue("roll", async () => {
					const result = await rollRow(rowKey, { stat });
					if (!result.ok) {
						control.disabled = false;
						this.renderIfOpen();
					}
				});
			}
			case "rescue": {
				const targets = control.dataset.targets
					? control.dataset.targets.split(" ").filter(Boolean)
					: [this._rowControl(rowKey, ".stonetop-struggle-target")?.value].filter(Boolean);
				return this._queue("rescue", () => rescue(rowKey, targets));
			}
			case "undo-rescue":
				return this._queue("rescue", () => undoRescue(rowKey));
			case "bump":
				return this._queue("roll", () => bumpRow(rowKey, control.dataset.by));
			case "leave-out":
				return this._queue("struggle", () => leaveOut(rowKey));
			case "share":
				control.disabled = true;
				return this._queue("struggle", () => revealStruggle());
			case "end":
				control.disabled = true;
				return this._queue("struggle", () => endStruggle());
			case "cancel":
				return this._callOff();
			default:
				return undefined;
		}
	}

	_onChange(ev) {
		const field = ev.target?.closest?.("[data-struggle-field]");
		if (!field) return undefined;
		switch (field.dataset.struggleField) {
			case "bundle":
				return this._queue("choice", () => setBundleAlly(field.dataset.rowKey, field.value));
			case "spots":
				return field.checked ? this._queue("struggle", () => setSpots(field.value)) : undefined;
			default:
				return undefined;
		}
	}

	async _callOff() {
		const callOff = await askWithButtons({
			title: "Call off the struggle?",
			content: "<p>Nobody marks XP for it, and nobody gets anyone out. Rolls already made stay in the chat log, still between each player and the GM.</p>",
			buttons: [
				{ key: "off", icon: "fa-ban", label: "Call it off", value: true },
				{ key: "keep", label: "Keep it going", value: false },
			],
			defaultKey: "keep",
		});
		if (callOff) await this._queue("struggle", () => cancelStruggle());
	}

	/**
	 * Watch what the struggle is made of while the window is open: the toolkit's record, every
	 * participant's own record (and anything else about them, since a stat or a debility shows in
	 * their row), a GM's Shift Up or Down on one of its roll cards, and who is online, since that moves
	 * who drives whose row.
	 */
	_watch() {
		if (this._hooks) return;
		const onActor = (actor, changes) => {
			if (isStruggleHost(actor)) {
				if (touchesFlag(changes, STRUGGLE_FLAG)) this._scheduleRender();
				return;
			}
			if (actor?.type !== "character") return;
			const inIt = currentStruggle()?.rows.some(r => r.actorId === actor.id);
			if (inIt || touchesFlag(changes, STRUGGLE_ROLL_FLAG)) this._scheduleRender();
		};
		const onMessage = message => {
			if (message?.getFlag?.(SYSTEM_ID, STRUGGLE_MESSAGE_FLAG)?.id === this._struggleId) this._scheduleRender();
		};
		this._hooks = [
			["updateActor",       Hooks.on("updateActor", onActor)],
			["updateChatMessage", Hooks.on("updateChatMessage", onMessage)],
			["createChatMessage", Hooks.on("createChatMessage", onMessage)],
			["userConnected",     Hooks.on("userConnected", () => this._scheduleRender())],
		];
	}

	_unwatch() {
		for (const [hook, id] of this._hooks ?? []) Hooks.off(hook, id);
		this._hooks = null;
		clearTimeout(this._renderTimer);
		this._renderTimer = null;
	}

	/** Redraw soon, or close: the struggle was called off, replaced, or this client is no longer in it. */
	_scheduleRender() {
		clearTimeout(this._renderTimer);
		this._renderTimer = setTimeout(() => {
			this._renderTimer = null;
			if (!this.rendered) return;
			const struggle = currentStruggle();
			if (!struggle || struggle.id !== this._struggleId || struggle.status === STRUGGLE_STATUS.CANCELLED) {
				if (struggle?.status === STRUGGLE_STATUS.CANCELLED && struggle.id === this._struggleId && !game.user?.isGM) {
					ui.notifications?.info?.("The GM called off the Struggle as One.");
				}
				this.close();
				return;
			}
			if (isLive(struggle) && !takesPart(struggle)) {
				this.close();
				return;
			}
			this.render(false);
		}, RENDER_DEBOUNCE_MS);
	}
}

/**
 * The struggle window a reload brings back, from the key it was saved under (StruggleWindow#restoreKey),
 * or null when it should stay shut: the struggle is over, or this client is not in it.
 */
export function reopenStruggleWindow(key) {
	const [kind, struggleId] = String(key ?? "").split(":");
	if (kind !== RESTORE_KIND || !struggleId) return null;
	if (!struggleWindowWanted(struggleId)) return null;
	return openOrFocus(struggleWindowId(struggleId), () => new StruggleWindow({ struggleId }));
}

/** Registered once, at module scope in stonetop.js. */
export function registerStruggleWindowRestore() {
	registerRestorableWindow(StruggleWindow, RESTORE_KIND, reopenStruggleWindow);
}
