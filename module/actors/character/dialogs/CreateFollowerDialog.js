import { StepperDialog } from "../../../dialogs/StepperDialog.js";
import {
	FOLLOWER_HP_BASE, FOLLOWER_HP_MODS,
	FOLLOWER_ARMOR_BASE, FOLLOWER_ARMOR_MODS,
	FOLLOWER_DAMAGE_OPTIONS, FOLLOWER_DAMAGE_TAG_GROUPS, FOLLOWER_TAG_GROUPS,
	FOLLOWER_INSTINCT_EXAMPLES, FOLLOWER_COST_EXAMPLES,
	deriveHp, deriveArmor, deriveDamageDie, formatDamage,
	normalizeTags, buildCustomFollower,
} from "../../../data/follower-build.js";

// ── CreateFollowerDialog ─────────────────────────────────────────────────────
// A walkthrough for "Creating followers" (Book I, NPCs & Followers, pp.474–479).
// It follows the chapter's own nine steps — create them as an NPC, give tags,
// calculate HP / armor / damage, write an instinct, (optional) moves, a cost, and
// equip them — then hands the built follower back to the caller to store on the
// character (see StonetopCharacterSheet._applyCustomFollower).
// Mirrors the Expedition/Death's-Door dialogs (shared `.stonetop-spring-*` styles),
// including Expedition's jump-to-step rail: nine steps is too many to reach only via
// Back/Next, so `_STEPS` doubles as the rail's table of contents (each entry's title and
// icon label its row). The template opts in by wrapping its content in
// `.stonetop-guide-split` and rendering the shared `stonetop.guide-toc` partial.

const _STEPS = [
	{
		key:   "concept",
		title: "Create them as an NPC",
		icon:  "fa-user-pen",
		body:  `<p>Every follower is first an <strong>NPC</strong>. Give them a <strong>name</strong>, picture who they are, and jot down their lot in life and a few <strong>impressions</strong>: the touchstones you'll use to portray them.</p>
				<p>You can flesh this out later; a name and a sense of them is plenty to start.</p>`,
	},
	{
		key:   "tags",
		title: "Give them tags",
		icon:  "fa-tags",
		body:  `<p>Tags guide how they act and what a player rolls when they <em>Order Followers</em>. Give a mix that's <strong>useful</strong>, <strong>problematic</strong>, and <strong>mixed blessings</strong>: tags that apply <em>some</em> of the time, not all of it.</p>
				<p>Click to add, or type your own (the <code>___-wise</code> tags want a topic).</p>`,
	},
	{
		key:   "hp",
		title: "Calculate hit points",
		icon:  "fa-heart",
		body:  `<p>How resilient are they? Pick one, then add anything else that applies.</p>`,
	},
	{
		key:   "armor",
		title: "Calculate armor",
		icon:  "fa-shield-halved",
		body:  `<p>What protects them? Pick one, then add anything else that applies. (You can also Outfit them with armor later.)</p>`,
	},
	{
		key:   "damage",
		title: "Calculate damage",
		icon:  "fa-burst",
		body:  `<p>How dangerous are they? Pick one. <strong>Range and other tags come from their gear</strong>: click to add the ones that fit, or type your own.</p>`,
	},
	{
		key:   "instinct",
		title: "Write their instinct",
		icon:  "fa-compass",
		body:  `<p>A follower's instinct should <strong>cause trouble for the PC who leads them</strong>. Write it as &ldquo;to [do something].&rdquo; Pick a starting point or write your own.</p>`,
	},
	{
		key:   "moves",
		title: "Write their moves (optional)",
		icon:  "fa-bolt",
		body:  `<p><em>Optional.</em> Moves capture abilities a tag doesn't cover, or common behaviors (good or bad). They're mostly for you, but the player sees them and they can affect an <em>Order Followers</em> roll. One per line; skip this if you like.</p>`,
	},
	{
		key:   "cost",
		title: "Write their cost",
		icon:  "fa-hand-holding-heart",
		body:  `<p>A follower's <strong>cost</strong> is what keeps them following the PC's lead. When the PC pays it, the follower holds <strong>+1 Loyalty</strong> (max 3) via <em>Strengthen Your Bond</em>. Pick one or make something up.</p>`,
	},
	{
		key:     "equip",
		title:   "Equip them",
		icon:    "fa-sack",
		isFinal: true,
		body:    `<p>Finally, give them their gear: a weapon, some supplies, whatever they show up with. Then review and create the follower.</p>`,
	},
];

// The free-text fields the generic [data-field] change handler is allowed to
// persist onto `_sel`. Anything else (a typo or future data-field) is ignored,
// so a stray attribute can't quietly write a junk key that buildCustomFollower
// would silently drop.
const _TEXT_FIELDS = new Set([
	"name", "pronoun", "typeLabel", "notes", "instinct", "moves", "cost",
]);

export class CreateFollowerDialog extends StepperDialog {
	constructor(actor, onApply, options = {}) {
		super(options);
		this._actor   = actor;
		this._onApply = onApply;
		// Steading resident/neighbor names offered as suggestions on the concept step,
		// so "recruit a villager as a follower" is a guided flow (NPCs & Followers p.474).
		this._residentNames = Array.isArray(options.residentNames) ? options.residentNames : [];
		// Working selection. Stats are stored as picks and derived live so the
		// totals stay honest as the player toggles options.
		this._sel = {
			name: "", pronoun: "", typeLabel: "", notes: "",
			tags: [],
			hpBase: "able",  hpMods: [],
			armorBase: "cloth", armorMods: [],
			damageKey: "defends", damageTags: [],
			instinct: "", moves: "", cost: "",
			gear: [],
			isGroup: false, groupSize: 3,
		};
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-create-follower",
			title:     "Create a Follower",
			template:  "systems/stonetop-pwd/templates/dialogs/create-follower.hbs",
			// Wide enough that the 168px jump-to-step rail sits BESIDE the old content
			// width rather than eating into it — the tag steps lay out ~50 chips, which
			// reflow badly in a narrower column.
			width:     728,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-create-follower-dialog"],
		});
	}

	get _steps() { return _STEPS; }
	get _autoHeight() { return true; }

	// ── Derived stats ──────────────────────────────────────────────────────────
	get _hp()        { return deriveHp({ base: this._sel.hpBase, mods: this._sel.hpMods }); }
	get _armor()     { return deriveArmor({ base: this._sel.armorBase, mods: this._sel.armorMods }); }
	get _damageDie() { return deriveDamageDie(this._sel.damageKey); }
	// The parenthetical (range + gear tags), assembled from the chosen chips/custom
	// entries in document order, e.g. ["near","low ammo"] → "near, low ammo".
	get _damageForm() { return this._sel.damageTags.join(", "); }
	get _damage()    { return formatDamage(this._damageDie, this._damageForm); }

	getData() {
		const nav  = this._stepNav();
		const step = nav.step;
		const sel  = this._sel;
		const ctx  = {
			...nav,
			sel,
		};

		if (step.key === "concept") {
			ctx.residentNames = this._residentNames;
		}
		if (step.key === "tags") {
			ctx.chosenTags = sel.tags;
			ctx.tagGroups  = FOLLOWER_TAG_GROUPS.map(g => ({
				label: g.label,
				tags:  g.tags.map(t => ({ value: t, selected: sel.tags.includes(t) })),
			}));
		}
		if (step.key === "hp") {
			ctx.hpBase  = FOLLOWER_HP_BASE.map(o => ({ ...o, selected: sel.hpBase === o.key, signed: _signed(o.hp) }));
			ctx.hpMods  = FOLLOWER_HP_MODS.map(o => ({ ...o, checked: sel.hpMods.includes(o.key), signed: _signed(o.hp) }));
			ctx.hpTotal = this._hp;
			ctx.isGroup = sel.isGroup;
			ctx.groupSize = sel.groupSize;
		}
		if (step.key === "armor") {
			ctx.armorBase  = FOLLOWER_ARMOR_BASE.map(o => ({ ...o, selected: sel.armorBase === o.key }));
			ctx.armorMods  = FOLLOWER_ARMOR_MODS.map(o => ({ ...o, checked: sel.armorMods.includes(o.key), signed: _signed(o.armor) }));
			ctx.armorTotal = this._armor;
		}
		if (step.key === "damage") {
			ctx.damageOptions = FOLLOWER_DAMAGE_OPTIONS.map(o => ({ ...o, selected: sel.damageKey === o.key }));
			// Reuse the tags-step chip UI (chosenTags + tagGroups) for range & gear tags,
			// so the same markup/CSS/handlers apply; _toggleTag routes to damageTags here.
			ctx.chosenTags = sel.damageTags;
			ctx.tagGroups  = FOLLOWER_DAMAGE_TAG_GROUPS.map(g => ({
				label: g.label,
				tags:  g.tags.map(t => ({ value: t, selected: sel.damageTags.some(x => x.toLowerCase() === t.toLowerCase()) })),
			}));
			ctx.damagePreview = this._damage;
		}
		if (step.key === "instinct") {
			ctx.instinctExamples = FOLLOWER_INSTINCT_EXAMPLES.map(t => ({ value: t, selected: sel.instinct === t }));
		}
		if (step.key === "cost") {
			ctx.costExamples = FOLLOWER_COST_EXAMPLES.map(t => ({ value: t, selected: sel.cost === t }));
		}
		if (step.isFinal) ctx.preview = this._previewCard();
		return ctx;
	}

	// A compact summary of the follower-to-be, shown on the final step.
	_previewCard() {
		const sel = this._sel;
		return {
			name:     sel.name.trim() || "Unnamed follower",
			pronoun:  sel.pronoun.trim(),
			typeLabel: sel.typeLabel.trim() || "follower",
			tags:     sel.tags,
			hp:       this._hp,
			armor:    this._armor,
			damage:   this._damage || "—",
			instinct: sel.instinct.trim(),
			cost:     sel.cost.trim(),
			moves:    sel.moves.split("\n").map(s => s.trim()).filter(Boolean),
			gear:     sel.gear.map(g => g.label).filter(Boolean),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._bindStepNav(html);

		// Navigation
		html.find(".stonetop-cf-create").on("click", () => this._finish());

		// Text fields → persist on blur (no re-render, so focus survives typing).
		html.find("[data-field]").on("change", ev => {
			const el = ev.currentTarget;
			if (el.type === "radio" || el.type === "checkbox") return;
			if (!_TEXT_FIELDS.has(el.dataset.field)) return;
			this._sel[el.dataset.field] = el.value;
		});

		// HP / armor base radios → re-render to update the live total.
		html.find(".stonetop-cf-hp-base").on("change", ev => { this._sel.hpBase = ev.currentTarget.value; this.render(false); });
		html.find(".stonetop-cf-hp-mod").on("change", () => { this._sel.hpMods = this._checked(html, ".stonetop-cf-hp-mod"); this.render(false); });
		html.find(".stonetop-cf-armor-base").on("change", ev => { this._sel.armorBase = ev.currentTarget.value; this.render(false); });
		html.find(".stonetop-cf-armor-mod").on("change", () => { this._sel.armorMods = this._checked(html, ".stonetop-cf-armor-mod"); this.render(false); });
		html.find(".stonetop-cf-damage").on("change", ev => { this._sel.damageKey = ev.currentTarget.value; this.render(false); });

		// Group toggle + size (HP step). Re-render on toggle so the size field appears.
		html.find(".stonetop-cf-group-toggle").on("change", ev => { this._sel.isGroup = ev.currentTarget.checked; this.render(false); });
		html.find(".stonetop-cf-group-size").on("change", ev => { this._sel.groupSize = Math.max(2, parseInt(ev.currentTarget.value, 10) || 2); });

		// Tag chips (toggle) + add free-text tag(s).
		html.find(".stonetop-cf-tag").on("click", ev => this._toggleTag(ev.currentTarget.dataset.tag));
		html.find(".stonetop-cf-chosen-tag").on("click", ev => this._toggleTag(ev.currentTarget.dataset.tag));
		html.find(".stonetop-cf-tag-add").on("click", () => this._addTagFromInput(html));
		html.find(".stonetop-cf-tag-input").on("keydown", ev => {
			if (ev.key === "Enter") { ev.preventDefault(); this._addTagFromInput(html); }
		});

		// Instinct / cost example chips fill the matching field.
		html.find(".stonetop-cf-instinct-ex").on("click", ev => { this._sel.instinct = ev.currentTarget.dataset.value; this.render(false); });
		html.find(".stonetop-cf-cost-ex").on("click", ev => { this._sel.cost = ev.currentTarget.dataset.value; this.render(false); });

		// Gear rows (final step)
		html.find(".stonetop-cf-gear-label").on("change", ev => {
			const i = Number(ev.currentTarget.dataset.index);
			if (this._sel.gear[i]) this._sel.gear[i].label = ev.currentTarget.value;
		});
		html.find(".stonetop-cf-gear-remove").on("click", ev => {
			this._sel.gear.splice(Number(ev.currentTarget.dataset.index), 1);
			this.render(false);
		});
		html.find(".stonetop-cf-gear-add").on("click", () => { this._sel.gear.push({ label: "" }); this.render(false); });
	}

	_checked(html, selector) {
		return html.find(`${selector}:checked`).toArray().map(el => el.value);
	}

	// The tag list the chip UI edits on the current step: the follower's own tags on
	// the "tags" step, its range/gear tags on the "damage" step. Both steps share the
	// same chip markup, CSS, and handlers; the active step decides which array they hit.
	_activeTagKey() { return this._steps[this._step]?.key === "damage" ? "damageTags" : "tags"; }

	_toggleTag(tag) {
		const t = String(tag ?? "").trim();
		if (!t) return;
		const list = this._sel[this._activeTagKey()];
		const i = list.findIndex(x => x.toLowerCase() === t.toLowerCase());
		if (i >= 0) list.splice(i, 1);
		else list.push(t);
		this.render(false);
	}

	_addTagFromInput(html) {
		const input = html.find(".stonetop-cf-tag-input")[0];
		if (!input) return;
		const key = this._activeTagKey();
		const added = normalizeTags(input.value);
		this._sel[key] = normalizeTags([...this._sel[key], ...added]);
		input.value = "";
		this.render(false);
	}

	// Capture any focused-but-unblurred field before leaving the step.
	_onBeforeStepChange() {
		this._captureLiveFields();
	}

	// Pull current values out of any [data-field] inputs that haven't fired change
	// yet (e.g. the player clicks Next without blurring). Belt-and-suspenders so a
	// just-typed name/instinct/cost isn't lost on navigation.
	_captureLiveFields() {
		const root = this.element?.[0];
		if (!root) return;
		root.querySelectorAll("[data-field]").forEach(el => {
			if (el.type === "radio" || el.type === "checkbox") return;
			if (!_TEXT_FIELDS.has(el.dataset.field)) return;
			this._sel[el.dataset.field] = el.value;
		});
		root.querySelectorAll(".stonetop-cf-gear-label").forEach(el => {
			const i = Number(el.dataset.index);
			if (this._sel.gear[i]) this._sel.gear[i].label = el.value;
		});
		const sizeEl = root.querySelector(".stonetop-cf-group-size");
		if (sizeEl) this._sel.groupSize = Math.max(2, parseInt(sizeEl.value, 10) || 2);
	}

	async _finish() {
		this._captureLiveFields();
		const sel = this._sel;
		const data = buildCustomFollower({
			name:      sel.name,
			pronoun:   sel.pronoun,
			typeLabel: sel.typeLabel,
			tags:      sel.tags,
			hp:        this._hp,
			armor:     this._armor,
			damage:    this._damage,
			instinct:  sel.instinct,
			moves:     sel.moves,
			cost:      sel.cost,
			notes:     sel.notes,
			gear:      sel.gear,
			isGroup:   sel.isGroup,
			size:      sel.isGroup ? sel.groupSize : 0,
		});
		await this._onApply?.(data);
		ui.notifications?.info?.(`${data.name || "Follower"} added to your followers.`);
		this.close();
	}
}

// Signed display for a modifier value (e.g. 4 → "+4", -2 → "−2", 0 → "+0").
// Display-only signed number for the HP/armor mod pills. Deliberately NOT
// roll-engine's sign(): this uses the typographic minus (U+2212) for the pills,
// whereas sign() must stay ASCII "-" because it feeds into Roll formula strings.
function _signed(n) {
	const v = Number(n) || 0;
	return v < 0 ? `−${Math.abs(v)}` : `+${v}`;
}
