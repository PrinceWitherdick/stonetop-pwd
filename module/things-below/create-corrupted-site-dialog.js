import { StepperDialog } from "../dialogs/StepperDialog.js";
import { escHtml } from "../utils/strings.js";
import {
	THEMES, SITE_FEATURES, SITE_CAUSES, SITE_SEVERITIES,
	CLEANSING_REQUIREMENTS, CLEANSING_BINDINGS,
	seedSiteDoomTrack, siteDangerMoves, rollOnTable, rollDistinct, themeLabels, themeCheckboxes,
} from "../data/things-below-tables.js";
import { THREAT_PROXIMITIES } from "../threats/threat-types.js";

// ── CreateCorruptedSiteDialog ────────────────────────────────────────────────
// A walkthrough for "Corrupted sites" (Book II, The Things Below, pp. 422-423): where the
// site is (feature), the themes of the Thing tainting it, the cause and severity of the
// corruption, and a plan for cleansing it. A corrupted site is written up as a THREAT
// (a MacGuffin) with an impending doom + grim portents that reflect it getting worse — the
// severity seeds that doom track. Resolves a threat SEED via promise(); the content picker
// turns it into a draggable card. Mirrors CreateHazardDialog / CreateThingDialog.

const SITE_TYPE = "macguffin";

const _STEPS = [
	{
		key:   "feature",
		title: "Where is the site?",
		icon:  "fa-mountain-sun",
		body:  `<p>A <strong>corrupted site</strong> is a place where the Things Below have taken hold. If it isn't already established, combine the terrain it's in with a <strong>feature</strong>.</p>`,
	},
	{
		key:   "themes",
		title: "Themes of the taint",
		icon:  "fa-fire",
		body:  `<p>Pick or roll the <strong>themes</strong> to identify the nature of the Thing corrupting the place (or, if the Thing is already established, apply its themes).</p>`,
	},
	{
		key:   "cause",
		title: "Cause of corruption",
		icon:  "fa-skull-crossbones",
		body:  `<p>How did the corruption take root? Some causes were an intentional, misguided, or accidental act: if so, decide who did it and why (or roll the Die of Fate).</p>`,
	},
	{
		key:   "severity",
		title: "Severity",
		icon:  "fa-hourglass-half",
		body:  `<p>How bad is it? Severity climbs a ladder from a merely shunned place to a wound in the world: it seeds the site's <strong>impending doom</strong> and grim portents (it getting worse).</p>`,
	},
	{
		key:   "cleansing",
		title: "Cleansing it",
		icon:  "fa-hand-sparkles",
		body:  `<p><em>Optional.</em> The Things Below are loath to relinquish their power, but a site can be cleansed. Note what the PCs' plan would require, and what might bind the evil.</p>`,
	},
	{
		key:     "review",
		title:   "Review",
		icon:    "fa-clipboard-check",
		isFinal: true,
		body:    `<p>Look it over. Its card goes to the homebrew Threats journal; drag it onto the GM Toolkit's Threats tab to make it a live threat.</p>`,
	},
];

export class CreateCorruptedSiteDialog extends StepperDialog {
	constructor(options = {}) {
		super(options);
		this._name = "";
		this._terrain = "";
		this._featureText = "";
		this._proximity = "nearby";
		this._themeIds = new Set();
		this._causeText = "";
		this._causeIntent = ""; // "", "intentional", "misguided", "accidental"
		this._severityKey = "";
		this._cleansingReqs = new Set();
		this._cleansingBinds = new Set();
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-create-corrupted-site",
			template:  "systems/stonetop-pwd/templates/dialogs/create-corrupted-site.hbs",
			width:     580,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-create-thing-dialog"],
		});
	}

	get title() { return "Create a Corrupted Site"; }
	get _steps() { return _STEPS; }
	get _autoHeight() { return true; }

	_severity() { return SITE_SEVERITIES.find(s => s.key === this._severityKey) ?? null; }

	getData() {
		const nav  = this._stepNav();
		const step = nav.step;
		const ctx  = { ...nav };

		if (step.key === "feature") {
			ctx.name = this._name;
			ctx.terrain = this._terrain;
			ctx.featureText = this._featureText;
			ctx.features = SITE_FEATURES.map((f, i) => ({ text: f.text, selected: f.text === this._featureText, index: i }));
			ctx.proximities = THREAT_PROXIMITIES.map(p => ({ id: p.id, label: p.label, selected: p.id === this._proximity }));
		}
		if (step.key === "themes") {
			ctx.themes = themeCheckboxes(this._themeIds);
			ctx.themeCount = this._themeIds.size;
		}
		if (step.key === "cause") {
			ctx.causes = SITE_CAUSES.map(c => ({ text: c.text, fateful: !!c.fateful, selected: c.text === this._causeText }));
			const chosen = SITE_CAUSES.find(c => c.text === this._causeText);
			ctx.isFateful = !!chosen?.fateful;
			ctx.intents = [
				{ id: "",            label: "(unspecified)" },
				{ id: "intentional", label: "Intentional" },
				{ id: "misguided",   label: "Misguided" },
				{ id: "accidental",  label: "Accidental" },
			].map(o => ({ ...o, selected: o.id === this._causeIntent }));
		}
		if (step.key === "severity") {
			ctx.severities = SITE_SEVERITIES.map(s => ({ key: s.key, text: s.text, detail: s.detail, selected: s.key === this._severityKey }));
			const chosen = this._severity();
			if (chosen) {
				const doom = seedSiteDoomTrack(chosen.key);
				ctx.doomPreview = {
					portents: doom.grimPortents.map(p => p.text),
					impending: doom.impendingDoom.text,
				};
			}
		}
		if (step.key === "cleansing") {
			ctx.requirements = CLEANSING_REQUIREMENTS.map(r => ({ text: r, checked: this._cleansingReqs.has(r) }));
			ctx.bindings = CLEANSING_BINDINGS.map(b => ({ text: b, checked: this._cleansingBinds.has(b) }));
		}
		if (step.isFinal) ctx.preview = this._previewCard();
		return ctx;
	}

	_previewCard() {
		const sev = this._severity();
		const doom = sev ? seedSiteDoomTrack(sev.key) : { grimPortents: [], impendingDoom: { text: "" } };
		return {
			name:      this._name.trim() || "Unnamed site",
			themes:    themeLabels(this._themeIds),
			feature:   this._featureText,
			cause:     this._causeText,
			severity:  sev?.text ?? "",
			portents:  doom.grimPortents.map(p => p.text),
			impending: doom.impendingDoom.text,
			cleansing: [...this._cleansingReqs, ...[...this._cleansingBinds].map(b => `Bind it with: ${b}`)],
			gmMoves:   sev ? siteDangerMoves(sev.level) : [],
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._bindStepNav(html);

		html.find(".stonetop-tb-create").on("click", () => this._finish());

		html.find("[data-field='name']").on("change", ev => { this._name = ev.currentTarget.value; });
		html.find("[data-field='terrain']").on("change", ev => { this._terrain = ev.currentTarget.value; });
		html.find(".stonetop-tb-proximity").on("change", ev => { this._proximity = ev.currentTarget.value; });

		html.find(".stonetop-tb-feature").on("change", ev => { this._featureText = ev.currentTarget.value; });
		html.find(".stonetop-tb-roll-feature").on("click", () => { this._featureText = rollOnTable(SITE_FEATURES)?.text ?? ""; this.render(false); });

		html.find(".stonetop-tb-theme").on("change", ev => this._toggleInSet(this._themeIds, Number(ev.currentTarget.value), ev.currentTarget.checked));
		html.find(".stonetop-tb-roll-themes").on("click", () => { this._addIds(this._themeIds, rollDistinct(THEMES, 2, Math.random, this._themeIds)); this.render(false); });

		html.find(".stonetop-tb-cause").on("change", ev => { this._causeText = ev.currentTarget.value; this.render(false); });
		html.find(".stonetop-tb-roll-cause").on("click", () => { this._causeText = rollOnTable(SITE_CAUSES)?.text ?? ""; this.render(false); });
		html.find(".stonetop-tb-intent").on("change", ev => { this._causeIntent = ev.currentTarget.value; });

		html.find(".stonetop-tb-severity").on("change", ev => { this._severityKey = ev.currentTarget.value; this.render(false); });
		html.find(".stonetop-tb-roll-severity").on("click", () => { this._severityKey = rollOnTable(SITE_SEVERITIES)?.key ?? ""; this.render(false); });

		html.find(".stonetop-tb-req").on("change", ev => this._toggleInSet(this._cleansingReqs, ev.currentTarget.value, ev.currentTarget.checked));
		html.find(".stonetop-tb-bind").on("change", ev => this._toggleInSet(this._cleansingBinds, ev.currentTarget.value, ev.currentTarget.checked));
	}

	_onBeforeStepChange() {
		const root = this.element?.[0];
		if (!root) return;
		const name = root.querySelector("[data-field='name']");
		if (name) this._name = name.value;
		const terrain = root.querySelector("[data-field='terrain']");
		if (terrain) this._terrain = terrain.value;
	}

	// Build the threat seed for a MacGuffin: prose from feature/cause/severity, the seeded
	// doom track, the cleansing plan, and the severity's cumulative danger GM moves.
	_seed() {
		const sev = this._severity();
		const doom = sev ? seedSiteDoomTrack(sev.key) : { grimPortents: [], impendingDoom: { text: "", done: false } };

		const descParts = [];
		const facts = [];
		if (this._terrain.trim()) facts.push(`<li><strong>Terrain:</strong> ${escHtml(this._terrain.trim())}</li>`);
		if (this._featureText.trim()) facts.push(`<li><strong>Feature:</strong> ${escHtml(this._featureText.trim())}</li>`);
		if (this._causeText.trim()) {
			// The intent (Die of Fate) only applies to a fateful cause; ignore a stale pick
			// left over from a since-changed cause.
			const chosen = SITE_CAUSES.find(c => c.text === this._causeText);
			const intent = chosen?.fateful && this._causeIntent ? ` (${escHtml(this._causeIntent)})` : "";
			facts.push(`<li><strong>Cause:</strong> ${escHtml(this._causeText.trim())}${intent}</li>`);
		}
		if (sev) facts.push(`<li><strong>Severity:</strong> ${escHtml(sev.text)}, ${escHtml(sev.detail)}</li>`);
		if (facts.length) descParts.push(`<ul>${facts.join("")}</ul>`);

		const cleansing = [
			...this._cleansingReqs,
			...[...this._cleansingBinds].map(b => `Bind it with: ${b}`),
		];

		return {
			name: this._name.trim() || "Corrupted Site",
			type: SITE_TYPE,
			proximity: this._proximity,
			instinct: "",
			themes: themeLabels(this._themeIds),
			gmMoves: sev ? siteDangerMoves(sev.level) : [],
			cleansing,
			grimPortents: doom.grimPortents,
			impendingDoom: doom.impendingDoom,
			description: descParts.join(""),
		};
	}

	_finish() {
		this._onBeforeStepChange();
		this._resolveWith(this._seed());
	}
}
