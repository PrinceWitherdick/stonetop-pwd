import { CLASSIC_LAYOUT_KEYS, getSetting, setSetting } from "../settings.js";
import { stonetopChatCard } from "./chat.js";
import { joinNames } from "./strings.js";

// The two layouts, as stored in `worldSheetLayout` (and as the personal `sheetLayout`
// override's two non-"world" values). See the registration block in settings.js.
export const CLASSIC = "classic";
export const MODERN  = "modern";

/**
 * Answer this world's sheet layout once, on the first GM load after the two layouts shipped,
 * and tell an upgraded table what happened.
 *
 * A world created on this release has never seen the old sheets, so MODERN (the registered
 * default) is simply right and there is nothing to say. A world that already existed is the
 * case this exists for: its table knows where everything is, and having the sheets rearrange
 * themselves on the load after an update is not a feature. So it is stamped CLASSIC, keeping
 * exactly the layout it had, and its GMs are whispered the offer to try the new one.
 *
 * "Already existed" is read off `seedingComplete` - the same probe
 * _applyCoreSettingDefaultsForNewWorld uses for the same question - which carries ONE
 * ordering requirement: it is set by the gazetteer seed, so this must run BEFORE
 * runWorldSetup(), or a fresh world's own first load looks established to it. Its caller in
 * hooks/Ready.js keeps that order.
 *
 * The two flags are separate on purpose. The stamp latches immediately, so it can never run
 * twice and can never overwrite a choice the GM has since made; the notice latches only once
 * chat has actually taken it, because a load where chat is not up yet would otherwise cost an
 * upgraded table the only notice it gets that the modern layout exists.
 *
 * GM-only: both settings are world-scoped.
 */
export async function stampWorldLayoutBaseline() {
	if (!globalThis.game?.user?.isGM) return;
	if (getSetting("classicLayoutNoticeShown")) return;   // decided, and said so

	if (!getSetting("worldSheetLayoutChosen")) {
		if (getSetting("seedingComplete")) await setSetting("worldSheetLayout", CLASSIC);
		await setSetting("worldSheetLayoutChosen", true);
	}

	// Nothing to explain to a world that is already modern: a fresh one, or an upgraded one
	// whose GM switched from the settings window before this got a chance to speak. Latch, so
	// it does not speak up later either.
	if (getSetting("worldSheetLayout") !== CLASSIC) {
		await setSetting("classicLayoutNoticeShown", true);
		return;
	}

	if (await showLayoutCard(CLASSIC, { firstRun: true }) === false) return;   // chat not ready, retry next load
	await setSetting("classicLayoutNoticeShown", true);
}

/** The class every layout card's shell carries, and how a stray one is recognized. */
const CARD_CLASS = "stonetop-layout-offer-card";

/** The tracked card, or null if it was never posted / has since been deleted. */
function _trackedCard() {
	const id = getSetting("layoutCardId");
	return (id && globalThis.game?.messages?.get?.(id)) || null;
}

/**
 * Show the GMs where the table's sheets ARE, with a button to the other layout.
 *
 * ONE card per world, EDITED in place. Flipping back and forth used to post a card each time,
 * so a GM trying both layouts ended up with a column of near-identical cards, all but the last
 * describing a state the table had already left. Editing keeps the log to a single card that is
 * always true, and Foundry re-renders an updated message on every client, which re-runs the
 * button wiring for free (see _chatWireLayoutSwitch).
 *
 * Named for the layout in force rather than the one on offer, which is the other half of that
 * fix: built the other way round, pressing "go back to classic" answered with a card headed
 * exactly like the one already in the log, and with no sheet open a working button was
 * indistinguishable from a dead one.
 *
 * Whispered rather than public because only a GM can write a world setting: a player pressing
 * the button would get nothing but a permission error, and a card whose button does not work
 * for most of the people looking at it is worse than no card. Players who want the other layout
 * have their own row in Configure Settings, which the card names.
 *
 * @param {"classic"|"modern"} now  The layout the table is on as of this card.
 * @param {{firstRun?: boolean}} [opts]  firstRun is the upgraded world's opening card, which has
 *   to explain why nothing moved rather than announce a change (nothing changed).
 * @returns {Promise<boolean>}  false when chat could not take it (too early in the load).
 */
export async function showLayoutCard(now, { firstRun = false } = {}) {
	if (!globalThis.ChatMessage?.create) return false;
	const content = now === MODERN ? _onModernContent()
	              : firstRun      ? _firstRunClassicContent()
	                              : _backOnClassicContent();

	const tracked = _trackedCard();
	if (tracked) {
		await tracked.update({ content });
		await _retireStrayCards(tracked.id);
		return true;
	}

	const msg = await ChatMessage.create({
		content,
		whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
		speaker: { alias: "Stonetop" },
	});
	if (!msg) return false;
	await setSetting("layoutCardId", msg.id);
	await _retireStrayCards(msg.id);
	return true;
}

/**
 * Delete every OTHER layout card in the log.
 *
 * Only ever our own notice cards, matched on the shell class nothing else emits — never
 * anything anyone wrote. They are worth removing rather than leaving: their buttons are live
 * (the handler binds by class, not by message), so a stale card is a working control sitting
 * under a description of a layout the table is no longer on.
 *
 * Also the migration path for a world that collected a few of these before the card became
 * editable: the next flip sweeps them.
 */
async function _retireStrayCards(keepId) {
	if (!globalThis.game?.user?.isGM) return;
	const stray = (globalThis.game?.messages?.filter?.(
		m => m.id !== keepId && typeof m.content === "string" && m.content.includes(CARD_CLASS)) ?? []);
	if (stray.length) await ChatMessage.deleteDocuments(stray.map(m => m.id));
}

/**
 * Move the whole table to `mode`, say so, and offer the way back.
 *
 * TWO signals, because with no sheet open the write itself is invisible and the first build of
 * this looked exactly like a dead button:
 *  - a toast, which lands wherever the GM happens to be looking; and
 *  - the card itself rewriting under the cursor, headline and button both, to name the layout
 *    now in force and offer the other one.
 * The card the GM pressed is stale the moment it is pressed (it offers what they now have), so
 * it is edited rather than left standing. That is also what keeps either direction from being a
 * one-way door: the single card in the log always offers the layout the table is not on.
 *
 * BOTH of the overrides that contradict the new mode are dropped back to their defaults: the
 * presser's own `sheetLayout` master override to "follow the world", and any per-sheet Classic
 * Layout box the table had unticked back on (_reinstateClassicSheets). Without that, a GM who had
 * pinned themselves to one layout would press a button labelled "switch the sheets" and watch
 * nothing happen to their own, which reads as a broken button rather than as a setting doing its
 * job.
 *
 * @param {"classic"|"modern"} mode
 * @returns {Promise<boolean>}  false if this user was not allowed to make the change.
 */
export async function setWorldSheetLayout(mode) {
	if (!globalThis.game?.user?.isGM) {
		globalThis.ui?.notifications?.warn?.("Only a GM can change the layout for the whole table.");
		return false;
	}
	await setSetting("worldSheetLayout", mode);
	const mine = getSetting("sheetLayout");
	if (mine !== "world" && mine !== mode) await setSetting("sheetLayout", "world");
	const reticked = mode === CLASSIC ? await _reinstateClassicSheets() : [];
	globalThis.ui?.notifications?.info?.(
		`Stonetop sheets are now using the ${mode} layout. Open a character, steading, or NPC sheet to see it.`
		+ (reticked.length ? ` The Classic Layout ${reticked.length > 1 ? "boxes" : "box"} for `
			+ `${joinNames(reticked)} had been unticked, which would have kept `
			+ `${reticked.length > 1 ? "those sheets" : "that sheet"} modern, so `
			+ `${reticked.length > 1 ? "they have" : "it has"} been ticked back on.` : ""));
	await showLayoutCard(mode);
	return true;
}

/** The per-sheet boxes as Configure Settings names them, for the toast to read back. */
const _SHEET_LABELS = { character: "Character Sheets", steading: "Steading Sheets", npc: "NPC Sheets" };

/**
 * Tick the table's per-sheet Classic Layout boxes back on.
 *
 * The same rule as the `sheetLayout` drop above, one level down, and a sharper failure. Effective
 * classic is `<master> AND <this sheet's box>` (isClassicLayout), so a box left unticked pins that
 * one sheet MODERN however the table's master is set - and with all three unticked, every button
 * this card has ever shown does nothing the presser can see. "Try the modern layout" changes
 * nothing because their sheets were already modern; "go back to the classic layout" changes
 * nothing because their own boxes hold them there. The world setting really did flip both times,
 * which is exactly what makes it read as a dead card rather than as a setting of their own.
 *
 * Only the CLASSIC direction needs this: a modern master is modern everywhere whatever the
 * children say, so on the way to modern there is nothing for them to contradict, and leaving them
 * alone keeps a deliberate per-sheet preference intact for as long as it can mean anything.
 *
 * @returns {Promise<string[]>}  The sheets whose box had to be re-ticked, for the toast to name.
 */
async function _reinstateClassicSheets() {
	const fixed = [];
	for (const [sheet, key] of Object.entries(CLASSIC_LAYOUT_KEYS)) {
		if (getSetting(key)) continue;
		await setSetting(key, true);
		fixed.push(_SHEET_LABELS[sheet]);
	}
	return fixed;
}

/** The footer every one of these cards carries: where a player goes to disagree. */
const _FOOTER = `<div class="row row--border stonetop-layout-offer__footer">
		Anyone who prefers the other look can pick it for themselves under <strong>Configure Settings</strong>, <strong>Sheet Layout (Just for Me)</strong>.
	</div>`;

/** The card's button. `data-layout` is the layout it switches TO. */
const _button = (to, icon, label) =>
	`<div class="row stonetop-layout-offer__actions">
		<button type="button" class="stonetop-layout-switch" data-layout="${to}">
			<i class="fas ${icon}"></i> ${label}
		</button>
	</div>`;

const _TRY_MODERN = _button("modern",  "fa-wand-magic-sparkles", "Try the Modern Layout");
const _GO_CLASSIC = _button("classic", "fa-rotate-left",         "Go Back to the Classic Layout");

// The upgraded world's opening card. It announces no change, because none happened: the point
// is to explain why everything is where it was, and that there is something new to look at.
function _firstRunClassicContent() {
	return stonetopChatCard(
		"A New Look for the Sheets",
		`<div class="stonetop-roll-card-description">
			<p>This world is on the <strong>classic</strong> sheet layout, the one it has always had, so nothing has moved.</p>
			<p>There is now a <strong>modern</strong> one as well: the tabs become an icon strip down the outside of the window, which hands the sheet its full width back, and the stats and vitals block moves to the top of the Moves tab instead of sitting above everything. Same sheets, same information, more room.</p>
			<p>Nothing is lost by looking. The button below switches every character, steading, and NPC sheet at the table, and you can switch straight back.</p>
		</div>
		${_TRY_MODERN}
		${_FOOTER}`,
		"stonetop-layout-offer-card");
}

function _onModernContent() {
	return stonetopChatCard(
		"Now on the Modern Layout",
		`<div class="stonetop-roll-card-description">
			<p>Every character, steading, and NPC sheet at the table has moved to the <strong>modern</strong> layout: icon tabs down the outside of the window, with the stats and vitals block at the top of the Moves tab. Open a sheet to have a look.</p>
			<p>Prefer the old one? The button below puts everything back exactly where it was.</p>
		</div>
		${_GO_CLASSIC}
		${_FOOTER}`,
		"stonetop-layout-offer-card");
}

// Deliberately NOT the opening card again. That is what made pressing "go back" read as a dead
// button: the answer was a card headed identically to the one already in the log.
function _backOnClassicContent() {
	return stonetopChatCard(
		"Back on the Classic Layout",
		`<div class="stonetop-roll-card-description">
			<p>Every sheet at the table is back where it was: tab names across the top, with the stats and vitals block pinned above them.</p>
			<p>The modern layout is still there whenever you want another look.</p>
		</div>
		${_TRY_MODERN}
		${_FOOTER}`,
		"stonetop-layout-offer-card");
}
