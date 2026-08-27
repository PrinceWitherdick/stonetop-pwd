import {escHtml} from "./strings.js";

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
 * Canonical HTML for a move chat card. `name` is escaped here because it can be a
 * player-authored custom-move name (untrusted) — never pre-escape it at the call site.
 * `description` is rendered raw: it is either trusted module HTML or a custom move's
 * description, which is already escaped at storage (formatCustomMoveDescription). Shared
 * by the character model and the sheet so the two never desync the card markup/escaping.
 */
export function moveChatCard(name, description) {
	return `<div class="stonetop-chat-move"><h3 class="stonetop-chat-move-name">${escHtml(name)}</h3><div class="stonetop-chat-move-description">${description}</div></div>`;
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
