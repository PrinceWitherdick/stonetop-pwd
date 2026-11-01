// ── One button on a post-death roll card's tier row ────────────────────────
// Its own file, free of heavy imports, so bodysnatcher.js (read by the roll options table) can draw its
// "Forced out" button with the same markup as post-death-actions.js's buttons.

import { escHtml } from "../../utils/strings.js";

/** One button on a roll card's tier row. `key` is its latch on the message: one press per key, per card. */
export function cardButton(className, { key, label, icon, data = {} }) {
	const attrs = Object.entries({ key, ...data })
		.map(([name, value]) => ` data-${name}="${escHtml(String(value))}"`).join("");
	return `<button type="button" class="stonetop-pd-card-btn ${className}"${attrs}><i class="fas ${icon}"></i> ${escHtml(label)}</button>`;
}
