import {escHtml, stripHtmlToText, decodeEntities} from "./strings.js";
import {isReferenceList, pickLimitsFrom, pickTiersFrom} from "./move-picks.js";
import {MOVE_TIERS_CLASS, TIER_KEYS} from "./move-results.js";

// The tier ladder's own `<ul>`, recognised in an attribute string — see `firstOptionList`.
const _LADDER_CLASS_RE = new RegExp(`\\bclass="[^"]*\\b${MOVE_TIERS_CLASS}\\b`, "i");

/** Core stat paths (in a flattened update) mapped to their chat labels. */
export const STAT_CHAT_LABELS = {
	"system.stats.str.value": "STR",
	"system.stats.dex.value": "DEX",
	"system.stats.int.value": "INT",
	"system.stats.wis.value": "WIS",
	"system.stats.con.value": "CON",
	"system.stats.cha.value": "CHA",
};

/** Steading ("stonetop") stat paths (in a flattened update) mapped to their chat labels. */
export const STEADING_STAT_CHAT_LABELS = {
	"system.stats.fortunes.value": "Fortunes",
	"system.stats.defenses.value": "Defenses",
	"system.attributes.population.value": "Population",
	"system.attributes.prosperity.value": "Prosperity",
	"system.attributes.surplus.value": "Surplus",
};

/** Format a stat value for chat: numbers get a leading sign (+1, -1, 0); blanks show as a dash. */
function formatStatValue(value) {
	if (value === undefined || value === null || value === "") return "—";
	const num = Number(value);
	return Number.isFinite(num) ? (num >= 0 ? `+${num}` : `${num}`) : String(value);
}

/**
 * Wrap body markup in the bare Stonetop chat-card shell (section / cell), with no
 * title row. Centralizes the load-bearing pbta/stonetop class names so a CSS
 * rename only has to happen here.
 * @param {string} innerHtml       Body markup placed inside the cell.
 * @param {string} [sectionClass]  Extra class(es) for the <section>.
 */
/**
 * May this user act on this card in a way that rewrites it?
 *
 * TWO rights, not one, and the reason is a bug that only appears at one table in three: Burn
 * Brightly gated on `actor.isOwner` alone and then called `message.update()`, which throws when
 * the GM rolled on a player's behalf — the player owns the character but not the GM's message.
 * Every handler that changes a character AND restamps the card needs both, so they ask together.
 *
 * @param {object} message
 * @param {object} actor
 * @returns {boolean}
 */
export function canRewriteCard(message, actor) {
	if (!actor || actor.type !== "character" || !actor.isOwner) return false;
	return message.canUserModify?.(globalThis.game?.user, "update") ?? !!globalThis.game?.user?.isGM;
}

export function stonetopCardShell(innerHtml, sectionClass = "") {
	return `<section class="pbta-chat-card stonetop-roll-card${sectionClass ? ` ${sectionClass}` : ""}">
		<div class="cell cell--chat">
			${innerHtml}
		</div>
	</section>`;
}

/** The ` data-tooltip="2 4"` attribute (with leading space) for a die-faces hover
 *  readout, or "" when there are no faces to show. */
function _dieFacesTip(dieFaces) {
	return dieFaces ? ` data-tooltip="${escHtml(dieFaces)}"` : "";
}

/**
 * The roll-formula chip ("2d6+@stat") shown above a result, with the individual
 * die faces ("2 4") baked in as a hover tooltip when given. Every Stonetop roll
 * card (moves, damage, the oracle, weather, the seasonal rolls) emits its formula
 * through here, so the chip — and its faces readout — live in exactly one place.
 */
export function rollFormulaChip(formula, dieFaces = "") {
	return `<div class="stonetop-roll-formula"${_dieFacesTip(dieFaces)}>${formula}</div>`;
}

/**
 * The rolled-total badge for a `stonetop-roll-result` block, carrying the same
 * die-faces readout as the formula chip. Shared by the cards built on the
 * `stonetop-roll-result-*` markup (moves, Death's Door, journal tables).
 */
export function rollResultNumber(total, dieFaces = "") {
	return `<span class="stonetop-roll-result-number"${_dieFacesTip(dieFaces)}>${total}</span>`;
}

/**
 * The rolled total of a DAMAGE roll: a red burst paired with the number in one cell, so
 * the figure reads as damage without re-reading the card title. Shared by every damage
 * surface — the plain damage-roll card ({@link rollDamage}) and the per-target results
 * card of the attack flow — so the two never drift apart.
 */
export function damageMark(total, dieFaces = "") {
	return `<span class="stonetop-damage-mark"><i class="fas fa-burst" aria-hidden="true"></i>${rollResultNumber(total, dieFaces)}</span>`;
}

/**
 * Body markup for a "Seasons Change"-style 2d6 result card: a formula chip plus the
 * shared roll-result block — the total (with its die-faces tooltip), the tier label,
 * and the result line — coloured down the left edge by tier, exactly like a move roll
 * card. Shared by the steading/Spring Burst Seasons Change roll and the Expedition
 * Requisition roll so the two cards stay in lockstep.
 * @param {number} total    The 2d6 (+Fortunes) total.
 * @param {string} tier     Result tier key (success/partial/failure) — colours the block.
 * @param {string} label    Tier label shown beside the total (e.g. "10+").
 * @param {string} line     Result line markup (raw HTML) shown below the label.
 * @param {string} formula  Roll formula text for the chip.
 * @param {string} [dieFaces] Individual die faces ("3 5") for the total/chip hover tooltip.
 * @param {string} [resultLegend] Visible 10+/7-9/6- legend markup to show below the result.
 */
export function springRollCardBody(total, tier, label, line, formula, dieFaces = "", resultLegend = "") {
	return `<div class="card-content">
		${rollFormulaChip(formula, dieFaces)}
		<div class="stonetop-roll-result ${tier}">
			${rollResultNumber(total, dieFaces)}
			<div class="stonetop-roll-result-body">
				<span class="stonetop-roll-result-label">${label}</span>
				<span class="stonetop-roll-result-details">${line}</span>
			</div>
		</div>
	</div>${resultLegend ? `<div class="stonetop-roll-card-results">${resultLegend}</div>` : ""}`;
}

/**
 * A pill for a roll card's title row that names the KIND of roll — e.g. a "Damage"
 * badge so a damage-roll card (which has no 2d6 hit tier) reads distinctly from a
 * move roll at a glance. `kind` becomes the colour modifier class. Shared by the
 * generic roll card (roll-engine `_rollCard`) and the interactive attack results
 * card so the two stay in lockstep.
 * @param {string} label  Badge text (e.g. "Damage").
 * @param {string} icon   Font Awesome class (e.g. "fa-heart-crack").
 * @param {string} kind   Colour-modifier slug (e.g. "damage").
 */
export function rollKindBadge(label, icon, kind = "damage") {
	return `<span class="stonetop-roll-card-badge stonetop-roll-card-badge--${escHtml(kind)}"><i class="fas ${escHtml(icon)}"></i> ${escHtml(label)}</span>`;
}

/** The "Damage" title badge — the one indicator shared by every damage-roll card. */
export const damageBadge = () => rollKindBadge("Damage", "fa-heart-crack", "damage");

/**
 * The card shell with a title row. Most cards want this; use {@link stonetopCardShell}
 * directly when the message's speaker alias already names the card.
 * @param {string|string[]} title  Card header text (escaped here). An array renders its
 *                                  parts on separate lines — the first bold, the rest in
 *                                  normal weight — e.g. a journal roll table's page /
 *                                  section / table breadcrumb.
 * @param {string} innerHtml   Body markup placed inside the cell, after the title.
 * @param {string} [sectionClass]  Extra class(es) for the <section>.
 * @param {string} [titleBadge]    Raw badge markup (e.g. {@link damageBadge}) placed at the title row's right edge.
 */
export function stonetopChatCard(title, innerHtml, sectionClass = "", titleBadge = "") {
	const titleHtml = Array.isArray(title)
		? title.map((t, i) => i === 0 ? escHtml(t) : `<span class="stonetop-chat-title-sub">${escHtml(t)}</span>`).join("<br>")
		: escHtml(title);
	return stonetopCardShell(
		`<div class="chat-title row flexrow"><h2 class="cell__title">${titleHtml}</h2>${titleBadge}</div>${innerHtml}`,
		sectionClass,
	);
}

/**
 * Post a card whose body is the shared "card-content → homestead list" shape: a
 * <ul> of pre-built <li> rows under the stonetop chat-card shell, spoken by the
 * actor. Centralizes the list wrapper + speaker boilerplate so the move/stat/
 * armor notes don't each re-type it (the markup the comment on {@link stonetopCardShell}
 * promises lives in one place).
 * @param {Actor}  actor
 * @param {string} title     Card header text (escaped by the shell).
 * @param {string} rowsHtml  Pre-built, already-escaped <li>…</li> rows.
 */
export function postListCard(actor, title, rowsHtml) {
	if (!globalThis.ChatMessage || !rowsHtml) return;
	const content = stonetopChatCard(title,
		`<div class="card-content"><ul class="stonetop-homestead-chat-list">${rowsHtml}</ul></div>`,
		"stonetop-homestead-chat-card");
	ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor }) });
}

/**
 * Whisper a card to the GMs, in the one shape every such card uses: no speaker actor, the
 * system's own name in the alias, and the recipient list resolved at post time.
 *
 * Stated once because four callers post one - the book-art offer, the layout card, the
 * FXMaster nudge and the Book 2 art reminder - and every one of them is a whisper that a
 * player must never see. A copy that dropped the `whisper` array would not fail loudly; it
 * would just post GM housekeeping into the table's chat log.
 *
 * @param {string} content  Pre-built card HTML.
 * @returns {Promise<ChatMessage|null>} The created message, or null if chat is not up yet.
 */
export async function whisperGm(content) {
	if (!globalThis.ChatMessage?.create) return null;
	return (await ChatMessage.create({
		content,
		whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
		speaker: { alias: "Stonetop" },
	})) ?? null;
}

/**
 * Post a guided-move summary card to chat.
 * @param {Actor} actor
 * @param {string} title   Move name shown in the card header.
 * @param {{label: string, value: string}[]} rows  Non-empty rows to display.
 */
export function postMoveToChat(actor, title, rows) {
	if (!rows.length) return;
	postListCard(actor, title,
		rows.map(r => `<li><strong>${escHtml(r.label)}:</strong> ${escHtml(r.value)}</li>`).join(""));
}

/**
 * A move's printed options list: the FIRST `<ul>` in its description, and its items.
 *
 * The first, matching how an arcanum's back is read (data/arcana-moves `_picksFrom`) — a move's
 * options are the list it leads with, and a second list is a note about them. A nested list is
 * refused rather than half-handled: the non-greedy match closes on the inner `</ul>`, so acting
 * on it would cut the outer list in half.
 *
 * Every shipped move that both rolls and prints a `<ul>` prints an OPTIONS list ("pick 1",
 * "spend Nerve 1-for-1 to", "ask one question from the list") — none of them restates its own
 * 10+/7-9/6- outcomes there, which is what makes it safe to treat the list as a choice.
 *
 * @returns {{index: number, length: number, inner: string, items: string[]}|null}
 */
export function firstOptionList(html) {
	const re = /<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi;
	let ul;
	while ((ul = re.exec(html ?? "")) !== null) {
		// The result ladder (utils/move-tiers.js) is a `<ul>` too, and it is appended AFTER the
		// move's own text — so on a move that prints no options of its own it would be the first
		// list found here, and its 10+ / 7-9 / 6- rows would come back as the move's choices and
		// be handed a checkbox each. Skipped by class rather than by position: the ladder is
		// never a choice, wherever in the body it lands. Matched inside `class` and on whole-word
		// boundaries, so neither a longer class that merely starts the same way nor a `data-`
		// value that happens to carry the text takes a real option list out of the running.
		if (_LADDER_CLASS_RE.test(ul[1])) continue;
		if (/<ul\b/i.test(ul[2])) return null;
		const items = [...ul[2].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m => m[1]);
		return items.length ? { index: ul.index, length: ul[0].length, inner: ul[2], items } : null;
	}
	return null;
}

/**
 * Turn a move's printed options list into the shared tickable checklist — the same markup and
 * the same `pickChecked` message flag a roll card's pick list uses (see roll-engine's
 * pickListsHtml and _chatWireRollCardPicks), so a tick persists and every viewer sees it.
 *
 * One rule for every move: its printed option list is tickable wherever that list is shown. A
 * move that never rolls gets this on the card its name-click posts (which is why 24 hand-written
 * copies of those same lists once sat in a dialog nobody could open); a move that rolls gets it
 * on the description its result card carries (StonetopItem#roll).
 *
 * IN PLACE, rather than lifted out into the card's own checklist below the result: a move's list
 * is usually followed by more of its text, and cutting it out of the middle leaves the sentence
 * that introduces it — "on a 10+, pick 2; on a 7-9, pick 1:" — pointing at whatever came after.
 *
 * The lists that are NOT tickable are the ones that were never a choice: a resource's SPEND MENU
 * ("You can spend Readiness 1-for-1 to:"), and a list a move ADDS to another move ("When you
 * Seek Insight, add the following to the list of questions you can ask:"). See `isReferenceList`
 * for both shapes, and for why that is a narrower test than "the count could not be read".
 *
 * The move's OWN text is the list, and its own text says HOW MANY of it you may take — so the
 * lead-in above the list is read for a cap (utils/move-picks.js) and stamped on the `<ul>` as
 * `data-pick-max`, or `data-pick-max-<tier>` where the move gives a count per result tier. The
 * wiring in stonetop.js enforces it: ticking past the cap releases the earliest tick, which for
 * a "pick 1" is exactly the radio behaviour that reading the move would lead you to expect.
 * A move whose count cannot be read confidently is stamped with nothing and ticks freely.
 *
 * Nothing is retyped from the move — not the options, not the count — so nothing can drift.
 *
 * @param {string} description  Raw move HTML.
 * @returns {string} The same HTML with its first option list made tickable, or unchanged.
 */
/**
 * ONE tickable pick-list row.
 *
 * Two surfaces emit these — a move's printed list made tickable here, and a roll card's pick
 * pools in roll-engine.js — and five selectors in stonetop.js plus `paintPickTally` and
 * `releaseOverLimit` key off these exact class names. Two emitters had to stay byte-identical
 * forever with nothing enforcing it, so there is one.
 *
 * `inner` is inserted RAW: the move's own list markup carries its ◇/○/□ glyphs and emphasis.
 * A caller holding plain text escapes it itself (roll-engine passes escHtml'd options).
 *
 * @param {string} inner  the row's label markup, already escaped if it needed to be
 * @param {number} index  positional index the tally and cap wiring reads back
 */
export function pickListItem(inner, index) {
	return `<li class="stonetop-picklist-item"><label>`
		+ `<input type="checkbox" class="stonetop-check stonetop-picklist-check" data-index="${index}">`
		+ `<span>${inner}</span></label></li>`;
}

export function pickableMoveDescription(description) {
	const html = String(description ?? "");
	if (!html || html.includes("stonetop-picklist")) return html;
	const list = firstOptionList(html);
	if (!list) return html;

	const lead = stripHtmlToText(html.slice(0, list.index));
	// SOME LISTS WERE NEVER A CHOICE. Defend's is what the Readiness you are now holding buys,
	// one point at a time, for the rest of the fight — the same line twice if you like, and the
	// roll never asked you to choose between them. Situational Awareness' three questions are
	// not picked here at all: they are added, permanently, to Seek Insight's list and chosen
	// from there. A checkbox on either is an offer the move does not make, so both print as
	// prose and take the spiral bullets every other prose list on these surfaces already wears.
	if (isReferenceList(lead)) return html;

	// The prose UNDER the bullets, which both questions below need: Formidable, Burgle and Trade &
	// Barter all state their 6- in a paragraph beneath their list, so a reader that stopped at the
	// lead-in had nothing to say about the tier a player most needs held to its count.
	const below = stripHtmlToText(html.slice(list.index + list.length));
	// HOW MANY each tier may take. `below` fills in only the tiers the lead-in left silent, and only
	// where it names them — see pickLimitsFrom, which explains why it may not simply be concatenated.
	const limits = pickLimitsFrom(lead, below);
	// WHICH tiers reach this list, beside how many each may take. A roll card carries every tier's
	// options and shows the one it landed on, and a tier that never sends the reader here at all
	// (Helior's Unblinking Eye's "the GM makes a move", Clash's 7-9, Forage's barren land) had no
	// way to say so: it stamped no count, which read as "uncapped", and a miss printed the move's
	// three options under a "0 options selected" as though the player still had a choice to make.
	// Read from the WHOLE move, lead-in and the prose below the bullets both.
	const tiers = pickTiersFrom(`${lead} ${below}`);
	// (pickListItem is exported below — one emitter for the two surfaces that print these.)
	const limitAttrs = typeof limits === "number"
		? ` data-pick-max="${limits}"`
		: Object.entries(limits ?? {}).map(([tier, n]) => ` data-pick-max-${tier}="${n}"`).join("");
	// Stamped only when a tier was actually read. An empty answer is "nothing is known", and the
	// reader (utils/pick-tally.js#tierOffersPicks) must go on showing the list for it.
	const tierAttr = tiers.length ? ` data-pick-tiers="${tiers.join(" ")}"` : "";

	// The item's own markup, raw: it carries the move's ◇/○/□ glyphs and emphasis, and the
	// description it came from is rendered raw by moveChatCard for exactly that reason.
	const items = list.items.map((inner, i) => pickListItem(inner, i)).join("");
	return html.slice(0, list.index)
		+ `<ul class="stonetop-picklist"${limitAttrs}${tierAttr}>${items}</ul>`
		+ html.slice(list.index + list.length);
}

/**
 * One printed option, reduced to the words that identify it.
 *
 * Two spellings of one option compare equal: a bullet authored in a book carries a typographic
 * apostrophe, the same bullet read back out of rendered HTML carries a numeric entity, and a
 * bullet retyped in a lookup table carries a plain one. Down to letters and digits, because none
 * of what separates "enemy's attack" from "enemy&#x27;s attack" is the option.
 *
 * ONE NORMALISER, because more than one surface now matches an option by its text: this module
 * asks it of a move's printed list, and combat/attack-flow.js#PICK_EFFECTS asks it to find out
 * what a ticked bullet DOES. A miss is silent — it turns a match into a mismatch, and the tick
 * that should have added a die adds nothing — so the two must be the same reduction, not two
 * reductions that happen to agree today.
 *
 * Through `decodeEntities` and not a decoder written here: strings.js says in its own header that
 * there used to be two and neither was a superset of the other, so text routed through the wrong
 * one came out with raw entities still in it.
 */
export function optionKey(text) {
	return decodeEntities(stripHtmlToText(text))
		.replace(/[^a-z0-9]+/gi, " ")
		.trim()
		.toLowerCase();
}

/**
 * Which result tiers already have the move's options on the card as ticked boxes -- read back out
 * of the description the card is about to render, rather than declared beside it.
 *
 * THE RESULT BLOCK MUST NOT SAY THE LIST AGAIN. A tier's outcome text is composed from
 * `system.moveResults` and spells its options out in prose ("...and pick 1: Avoid, prevent, or
 * counter your enemy's attack / Strike hard and fast..."). With the same options sitting as boxes
 * a few lines above, that is one choice printed twice on one card, once unclickable. A tier
 * answered here prints its lead-in alone ("...and pick 1.") and lets the boxes be the list -- the
 * rule roll-engine.js already applies to a move that declares `system.pickOptions`, reaching the
 * moves that state their options in their own prose instead.
 *
 * A predecessor asked this of a tier's CONTROLS, back when a card could restate a move's list as
 * pick radios under the result (combat/attack-flow.js, which no longer does). Asking it of the
 * description instead is both narrower and truer: there is one list now, this is where it is, and
 * the answer comes from the very markup being rendered rather than from a second producer whose
 * words had to be compared against the move's.
 *
 * TIER BY TIER, off the stamp `pickableMoveDescription` already writes: Clash's two bullets belong
 * to its 10+ and its 7-9 names no pick at all, so a 7-9 whose own text HAS options to state must
 * go on stating them. An unstamped list is one nothing could read a tier off, and it shows on
 * every tier -- so it answers for every tier.
 *
 * @param {string} description  The card's description HTML, after pickableMoveDescription.
 * @returns {string[]} Tier keys in ladder order; empty when the description carries no boxes.
 */
const _PICKLIST_OPEN_RE = /<ul class="stonetop-picklist"([^>]*)>/i;

export function descriptionPickTiers(description) {
	const open = _PICKLIST_OPEN_RE.exec(String(description ?? ""));
	if (!open) return [];
	const stamped = /data-pick-tiers="([^"]*)"/i.exec(open[1])?.[1];
	if (!stamped) return [...TIER_KEYS];
	const named = new Set(stamped.split(/\s+/).filter(Boolean));
	return TIER_KEYS.filter(tier => named.has(tier));
}

/**
 * Canonical HTML for a move chat card. `name` is escaped here because it can be a
 * player-authored custom-move name (untrusted) — never pre-escape it at the call site.
 * `description` is rendered raw: it is either trusted module HTML or a custom move's
 * description, which is already escaped at storage (formatCustomMoveDescription). Shared
 * by the character model and the sheet so the two never desync the card markup/escaping.
 *
 * `pickable` is opt-in, and only a caller posting a move's PRINTED TEXT passes it: the Moves
 * tab's name-click here, and the basic/expedition sidebar's through `_postMoveCard`, which ticks
 * and lays out the tier ladder together (utils/move-tiers.js#moveCardBody) because the two have
 * to happen in that order. Every other caller here is a receipt ("Readiness lost", "Follower
 * Down"), where a checkbox would be an offer to change something that has already happened.
 */
export function moveChatCard(name, description, { pickable = false, actions = "" } = {}) {
	const body = pickable ? pickableMoveDescription(description) : description;
	// `actions` goes INSIDE the card, not after it: a button concatenated onto the end would be
	// a bare div in the message with no card around it, and the action-row styling is scoped to
	// the card that rendered it.
	return `<div class="stonetop-chat-move"><h3 class="stonetop-chat-move-name">${escHtml(name)}</h3>`
		+ `<div class="stonetop-chat-move-description">${body}</div>${actions}</div>`;
}

/**
 * Post a card to chat announcing one or more core-stat changes.
 * @param {Actor} actor
 * @param {{label: string, oldValue: *, newValue: *}[]} changes
 */
export function postStatChangesToChat(actor, changes) {
	if (!changes?.length) return;
	const rows = changes.map(c =>
		`<li><strong>${escHtml(c.label)}:</strong> ${escHtml(formatStatValue(c.oldValue))} &rarr; ${escHtml(formatStatValue(c.newValue))}</li>`
	).join("");
	const title = changes.length > 1 ? "Stats changed" : "Stat changed";
	postListCard(actor, title, rows);
}
