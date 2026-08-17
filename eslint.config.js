import js from "@eslint/js";
import globals from "globals";
import promise from "eslint-plugin-promise";

/**
 * Lint config for a no-build Foundry system.
 *
 * The rule that earns its keep here is `promise/catch-or-return`. A Foundry sheet is a wall of
 * async click handlers writing to documents, and a dropped rejection is invisible: the write
 * fails, the DOM keeps the optimistic state, and the player is told the change landed. That
 * class of bug is what this config exists to catch.
 *
 * `no-floating-promises` would be the sharper tool, but it is type-aware — it needs
 * typescript-eslint and a tsconfig, which this project deliberately doesn't have. `catch-or-return`
 * gets the common case (a bare `.then()` chain with no `.catch`) without adding a build step.
 * Bare `await`s inside an async function are NOT covered by either rule; those were found by hand.
 */

/** Foundry's globals. Not exhaustive — extended as `no-undef` finds more. */
const foundryGlobals = {
	game: "readonly",
	ui: "readonly",
	canvas: "readonly",
	CONFIG: "readonly",
	CONST: "readonly",
	Hooks: "readonly",
	foundry: "readonly",
	Actor: "readonly",
	Actors: "readonly",
	ActorSheet: "readonly",
	Item: "readonly",
	Items: "readonly",
	ItemSheet: "readonly",
	Application: "readonly",
	FormApplication: "readonly",
	DocumentSheet: "readonly",
	Dialog: "readonly",
	ChatMessage: "readonly",
	Roll: "readonly",
	Macro: "readonly",
	Folder: "readonly",
	JournalEntry: "readonly",
	JournalEntryPage: "readonly",
	JournalPageSheet: "readonly",
	JournalTextPageSheet: "readonly",
	Scene: "readonly",
	Token: "readonly",
	TokenDocument: "readonly",
	RollTable: "readonly",
	ActiveEffect: "readonly",
	Setting: "readonly",
	User: "readonly",
	Users: "readonly",
	Combat: "readonly",
	Combatant: "readonly",
	NoteDocument: "readonly",
	TextEditor: "readonly",
	FilePicker: "readonly",
	ImageHelper: "readonly",
	AudioHelper: "readonly",
	KeyboardManager: "readonly",
	SortingHelpers: "readonly",
	CompendiumCollection: "readonly",
	DocumentSheetConfig: "readonly",
	Handlebars: "readonly",
	ProseMirror: "readonly",
	fromUuid: "readonly",
	fromUuidSync: "readonly",
	getDocumentClass: "readonly",
	renderTemplate: "readonly",
	loadTemplates: "readonly",
	saveDataToFile: "readonly",
	readTextFromFile: "readonly",
	srcExists: "readonly",
	duplicate: "readonly",
	mergeObject: "readonly",
	expandObject: "readonly",
	flattenObject: "readonly",
	deepClone: "readonly",
	isEmpty: "readonly",
	randomID: "readonly",
	setProperty: "readonly",
	getProperty: "readonly",
	hasProperty: "readonly",
	debounce: "readonly",
	PIXI: "readonly",
};

export default [
	{
		ignores: [
			"node_modules/**",
			"packs/**",
			// Generated from the Book II art pipeline; header says "Do NOT edit by hand".
			"module/book2-art/manifest.js",
		],
	},

	js.configs.recommended,

	// System code: browser + Foundry.
	{
		files: ["module/**/*.js", "stonetop.js"],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: "module",
			globals: { ...globals.browser, ...foundryGlobals },
		},
		plugins: { promise },
		rules: {
			// The reason this config exists. A `.then()` chain with no `.catch` silently
			// swallows a failed document write.
			"promise/catch-or-return": ["error", { allowFinally: true }],
			"promise/no-nesting": "warn",
			"promise/no-return-wrap": "error",
			"promise/param-names": "error",
			// `for (const x of y) await f(x)` over documents is usually a batch waiting to happen,
			// but it is sometimes deliberately serial. Warn, don't block.
			"no-await-in-loop": "off",
			// `error`, not `warn`: CI runs a bare `eslint .`, so a warning here exits 0 and the
			// dead import it is describing lands anyway. The deliberately advisory rules above
			// (`promise/no-nesting`, `prefer-const`) stay warnings on purpose; this one is the
			// class that was actually being cleaned up by hand.
			"no-unused-vars": ["error", {
				argsIgnorePattern: "^_",
				varsIgnorePattern: "^_",
				caughtErrorsIgnorePattern: "^_",
				// `const { takenBy, ...rest } = row` is how this codebase DROPS a key. The
				// binding is unused on purpose — that is the whole mechanism.
				ignoreRestSiblings: true,
			}],
			"no-empty": ["error", { allowEmptyCatch: false }],
			"no-console": "off",
			eqeqeq: ["error", "smart"],
			"no-var": "error",
			"prefer-const": "warn",
			// Sheet code parses `data-` attributes constantly; a missing radix on a value that
			// can start with "0" is a silent wrong answer.
			radix: "error",
			// The package id namespaces every flag, setting and pack this system stores in a
			// world, and it had been retyped as a literal 269 times. Import SYSTEM_ID (or the
			// STONETOP_SCOPE alias) from module/system-id.js instead, so a rename is one edit.
			//
			// Matches the EXACT string only, so asset paths ("systems/stonetop-pwd/templates/…")
			// and pack ids ("stonetop-pwd.stonetop-items") are untouched: the former follow the
			// install directory and are also spelled out in .hbs partials that no JS constant can
			// reach, and the latter have named constants of their own in system-id.js.
			"no-restricted-syntax": ["error", {
				selector: 'Literal[value="stonetop-pwd"]',
				message: "Import SYSTEM_ID from module/system-id.js instead of retyping the package id.",
			}, {
				// The other half of the rule above. Swapping the literal for the constant is only
				// half a fix: `{ SYSTEM_ID: {...} }` is a property named "SYSTEM_ID", not the
				// package id, so the flag is written where nothing reads it and the failure is
				// SILENT — `getFlag` just returns undefined forever. It cost five flag writes when
				// the ids were first centralised (chronicle keys, portrait frames, the Burn
				// Brightly and logbook once-only latches). Brackets make it a computed key.
				//
				// Shorthand `{ SYSTEM_ID }` is excluded: there the name IS the intent.
				selector: 'Property[computed=false][shorthand=false][key.name=/^(SYSTEM_ID|ITEM_FLAG_SCOPE|LEDGER_SCOPE)$/]',
				message: "Bracket it: { [SYSTEM_ID]: … }. Unbracketed, this writes a flag under the literal key \"SYSTEM_ID\".",
			}],
		},
	},

	// The one file allowed to spell the package id out: it is where SYSTEM_ID is defined.
	{
		files: ["module/system-id.js"],
		rules: { "no-restricted-syntax": "off" },
	},

	// Tests: same globals plus vitest's (vitest.config.js sets `globals: true`).
	{
		files: ["tests/**/*.js"],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: "module",
			globals: {
				...globals.browser,
				...globals.node,
				...foundryGlobals,
				describe: "readonly",
				it: "readonly",
				test: "readonly",
				expect: "readonly",
				vi: "readonly",
				beforeEach: "readonly",
				afterEach: "readonly",
				beforeAll: "readonly",
				afterAll: "readonly",
			},
		},
		rules: {
			"no-unused-vars": ["error", {
				argsIgnorePattern: "^_",
				varsIgnorePattern: "^_",
				// Tests use `const { a, ...rest } = x` to assert on "everything but a".
				ignoreRestSiblings: true,
			}],
			// A test that asserts something throws often has nothing to do in the catch.
			"no-empty": ["error", { allowEmptyCatch: true }],
		},
	},

	// Build/pack scripts run under Node.
	{
		files: ["scripts/**/*.js", "scripts/**/*.mjs", "*.config.js"],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: "module",
			globals: { ...globals.node },
		},
		rules: {
			"no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
		},
	},

	// `scripts/local/` are not Node scripts — they are pasted into a Foundry Script macro and
	// run inside the client, so they see the browser and Foundry globals, not `process`.
	{
		files: ["scripts/local/**/*.js"],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: "script",
			globals: { ...globals.browser, ...foundryGlobals },
		},
	},

	// Node script whose `page.evaluate` callbacks are serialized and run inside Chromium, so
	// their bodies legitimately reference browser globals this file never defines.
	{
		files: ["scripts/trace-icon-svg.js"],
		languageOptions: { globals: { ...globals.node, ...globals.browser } },
	},
];
