import { askWithButtons } from "../../utils/ask-with-buttons.js";
import { stockSourceChoiceLabel } from "./stock-cost.js";

/**
 * Which purse pays, asked with a button per purse (affirmatives first) and one to leave it
 * unpaid. Resolves to the chosen purse, or null for "not now" and for a closed window.
 *
 * Asked exactly when the sheet's "Spend from" picker asks it (stock-cost.js#mustAskStockSource).
 * Shared by the chat card's Spend button (stonetop.js#_chatWireSpendStock) and a carer's answer
 * to a Healer's Arts ask (healers-arts.js#handleHealersArtsQuery), so the two read alike.
 */
export async function askStockSource(payable, amount, moveName) {
	const key = await askWithButtons({
		title: moveName ? `${moveName}: Spend ${amount} Stock` : `Spend ${amount} Stock`,
		content: `<p>Pay the ${amount} Stock out of which purse?</p>`,
		buttons: [
			...payable.map(s => ({
				key:   s.key,
				label: s.vessel ? stockSourceChoiceLabel(s, amount) : `Spend ${amount} ${stockSourceChoiceLabel(s, amount)}`,
				icon:  s.vessel ? "fa-droplet" : "fa-mortar-pestle",
				value: s.key,
			})),
			{ key: "unpaid", label: "Leave it unpaid", icon: "fa-xmark", value: null },
		],
	});
	return payable.find(s => s.key === key) ?? null;
}
