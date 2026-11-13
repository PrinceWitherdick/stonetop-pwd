import { CharacterLore } from "./CharacterLore.js";
import { StonetopFlags } from "./StonetopFlags.js";
import { buildLoreSection } from "./CharacterPostDeath.js";
import {
	insertTabKey, insertListSlug, insertOpening, listAllowance, listRequirement, optionCount, picksMade, pickedLabels,
	insertFormGear, flagOverPicks,
} from "./homebrew-inserts.js";

/**
 * A character's side of a homebrew playbook's INSERTS (homebrew-inserts.js has the rules): the
 * picks made on each insert's lists, whether they wear its form, and the view the insert's sheet
 * tab draws.
 *
 * Stored apart from the playbook's own lore (`insertLore`, not `lore`), so the Details tab's lists
 * and an insert's never share a key, and a change of playbook's lore clean-up never reaches these.
 */
export class CharacterHomebrewInserts {
	constructor(actor) {
		this._actor = actor;
		this._lore = new CharacterLore(new StonetopFlags(actor, "insertLore"));
		this._form = new StonetopFlags(actor, "insertForm");
	}

	get counts() { return this._lore.counts; }
	get texts() { return this._lore.texts; }

	/** Is the character wearing the form of the insert `key`? */
	wearing(key) {
		return this._form.getFlag(key) === true;
	}

	/** One option's count. Never refused: a list over its count is flagged on the sheet instead. */
	async setCount(listSlug, optionSlug, count) {
		await this._lore.setCount(listSlug, optionSlug, Math.max(0, Math.trunc(Number(count) || 0)));
	}

	async setText(listSlug, optionSlug, value) {
		await this._lore.setText(listSlug, optionSlug, String(value ?? ""));
	}

	async setWearing(key, on) {
		await this._form.setFlag(key, !!on);
	}

	/** The playbook's inserts, or none. */
	static insertsOf(playbookData) {
		return Array.isArray(playbookData?.inserts) ? playbookData.inserts : [];
	}

	/**
	 * The gear every worn form gives, as `{slug, name, note, armor}` records for the character's
	 * gear sources (StonetopCharacter#_gearSources). Synchronous: read from the playbook and flags.
	 */
	formGear(playbookData, items) {
		const counts = this.counts;
		return CharacterHomebrewInserts.insertsOf(playbookData).flatMap(ins => insertFormGear(ins, {
			counts, open: insertOpening(ins, items).open, wearing: this.wearing(ins.key),
		}));
	}

	/**
	 * What each OPEN insert's tab draws, in the order the playbook lists them.
	 *
	 * @param {object} playbookData
	 * @param {object} o
	 * @param {Iterable} o.items        the character's items
	 * @param {Array}  o.categories     the moves section's categories (an insert's are keyed `hb-insert:<key>`)
	 * @param {boolean} o.editMode      the sheet's edit mode: every option shown to tick
	 */
	buildView(playbookData, { items, categories = [], editMode = false } = {}) {
		const counts = this.counts;
		const texts = this.texts;
		const views = [];
		for (const ins of CharacterHomebrewInserts.insertsOf(playbookData)) {
			const { open, copies } = insertOpening(ins, items);
			if (!open) continue;
			const pickLists = (ins.lists ?? []).filter(l => l.kind !== "moves");
			let short = 0;

			// The lists to tick, through the shared lore partial.
			const loreData = pickLists.map(list => {
				const allowance = listAllowance(list, copies, items);
				const made = picksMade(ins, list, counts, texts);
				const need = listRequirement(list, allowance);
				if (made < need) short += need - made;
				const line = `<p class="stonetop-hb-insert-allowance">Picked ${made} of ${allowance}.</p>`;
				return { slug: insertListSlug(ins, list), title: list.title, description: `${list.description ?? ""}${line}`, options: list.options ?? [], _meta: { allowance, made, title: list.title } };
			});
			const optionBySlug = new Map(loreData.flatMap(e => e.options.map(o => [`${e.slug}:${o.slug}`, o])));
			const state = {
				getCount: (l, o) => optionCount(counts, l, optionBySlug.get(`${l}:${o}`) ?? { slug: o }),
				getText: (l, o) => String(texts[`${l}:${o}`] ?? ""),
			};
			const lore = buildLoreSection(loreData, state);
			lore.entries.forEach((entry, i) => flagOverPicks(entry, loreData[i]._meta));

			// The insert's moves: its moves lists, then those outside any list (always held, or loose).
			const cat = categories.find(c => c.key === `hb-insert:${ins.key}`);
			const listOf = new Map(Object.entries(cat?.insertLists ?? {}));
			const catMoves = cat?.moves ?? [];
			const moveGroups = [];
			for (const list of (ins.lists ?? []).filter(l => l.kind === "moves")) {
				const moves = catMoves.filter(m => listOf.get(m.name) === list.key);
				if (!moves.length) continue;
				const allowance = listAllowance(list, copies, items);
				const taken = moves.reduce((n, m) => n + (m.owned ? Math.max(1, m.ownedIds?.length ?? 1) : 0), 0);
				const need = listRequirement(list, allowance);
				if (taken < need) short += need - taken;
				const note = taken > allowance
					? `${taken} taken, and this list allows ${allowance}. Fine if the table agreed; otherwise untick one.`
					: `Pick ${allowance}. ${taken ? `${taken} taken.` : "None taken yet."}`;
				// A list with a pick still owed is ticked straight away, as its pick lists are: a character who
				// has just taken the opening move (Otherkin) takes their monster move here, no pencil first.
				const owed = taken < allowance;
				moveGroups.push({ key: list.key, title: list.title, note, over: taken > allowance,
					moves: owed ? moves.map(m => ({ ...m, pickable: true })) : moves, collapseId: `hbInsert:${ins.key}:${list.key}` });
			}
			const loose = catMoves.filter(m => !listOf.get(m.name));
			if (loose.length) moveGroups.unshift({ key: "", title: `${ins.name} moves`, note: null, over: false, moves: loose, collapseId: `hbInsert:${ins.key}` });

			const wearing = !!ins.form?.enabled && this.wearing(ins.key);
			// While worn: what the character is now, from the lists that aren't gear (traits, instinct, bane).
			const banner = wearing
				? pickLists.map(list => ({ title: list.title, picked: pickedLabels(ins, list, counts, texts).join(", ") })).filter(b => b.picked)
				: [];
			views.push({
				key: ins.key,
				tabKey: insertTabKey(ins.key),
				name: ins.name,
				description: ins.description ?? "",
				form: ins.form?.enabled ? { wearing, on: ins.form.on || "Transform", off: ins.form.off || "Revert" } : null,
				banner,
				lore,
				// A list with picks still to make is shown to tick, edit mode or not: a character who has just
				// taken the opening move finds it ready.
				editing: !!editMode || short > 0,
				moveGroups,
				attention: short > 0,
				attentionLabel: short > 0 ? `${short} ${short === 1 ? "pick" : "picks"} still to make` : "",
			});
		}
		return views;
	}
}
