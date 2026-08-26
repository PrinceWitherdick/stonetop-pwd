// A DOM stand-in, for the delegated listeners on the GM Toolkit's authored-list tabs.
//
// The suite runs on the `node` environment with no DOM at all (vitest.config.js), and these tabs'
// listeners are DELEGATED: every one reaches its row by walking up from `ev.target` with `closest`.
// That walk is the thing worth testing, so rather than calling the handlers with a hand-built row,
// this models just enough of an element for it.
//
// WHY IT IS HERE and not in each test file. Two tabs grew their own copy of this, and the second
// was a strict superset of the first — attribute-value and `:focus` selectors, `classList.toggle`,
// `setAttribute`, `contains`, `querySelectorAll`, `select()` and a drop helper. So the older tab
// was being tested against the weaker of two models of the same thing, and a third delegated tab
// would have produced a third. `tests/fakes/css.js` says in its own header that this drift is why
// `tests/fakes/` exists.
//
// `emit` AWAITS each listener, which a real dispatch does not. Deliberate: the handlers are async
// and the assertions are about what they wrote, so a test that fired and polled would be testing
// the poll.
import { vi } from "vitest";

/**
 * Match `.class`, `[data-x]`, `[data-x='v']` and `:focus`, in any combination, comma-separated.
 *
 * Every selector form the toolkit's tabs actually use. An unknown form matches nothing rather than
 * throwing, which is the behaviour a real `matches` has for a selector that fits no node.
 */
export function matchesSelector(node, selector) {
	return selector.split(",").map(s => s.trim()).some(part => {
		const bits = part.match(/\.[\w-]+|\[[^\]]+\]|:focus/g) ?? [];
		if (!bits.length) return false;
		return bits.every(bit => {
			if (bit === ":focus") return !!node.focused;
			if (bit.startsWith(".")) return node.classes.includes(bit.slice(1));
			const [, key, val] = bit.match(/\[([\w-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/) ?? [];
			const prop = key.replace(/^data-/, "").replace(/-(\w)/g, (_, c) => c.toUpperCase());
			const have = node.dataset[prop];
			return val === undefined ? have !== undefined : have === val;
		});
	});
}

/** One element: a parent chain, a class list, a dataset, a value, and the handlers on it. */
export function fakeEl({ cls = [], dataset = {}, value = "", parent = null } = {}) {
	const node = {
		classes: cls, dataset, value, children: [], parent,
		focused: false, selected: false, attrs: {}, handlers: {},
		matches: sel => matchesSelector(node, sel),
		closest(sel) {
			for (let cur = node; cur; cur = cur.parent) if (cur.matches?.(sel)) return cur;
			return null;
		},
		classList: {
			toggle(name, force) {
				const at = node.classes.indexOf(name);
				const on = force ?? at < 0;
				if (on && at < 0) node.classes.push(name);
				if (!on && at >= 0) node.classes.splice(at, 1);
				return on;
			},
		},
		setAttribute(k, v) { node.attrs[k] = v; },
		/**
		 * Descendants matching a selector, the same walk `fakeRoot` does.
		 *
		 * On the element and not only on the root because a real element has them, and the
		 * toolkit's bundle tabs now search WITHIN their own panel rather than across the whole
		 * sheet: both tabs print the same class names, so a flush handed the root would find the
		 * other tab's focused box and write its value into its own list.
		 */
		querySelector: sel => walk(node.children, sel)[0] ?? null,
		querySelectorAll: sel => walk(node.children, sel),
		addEventListener: (type, fn) => { (node.handlers[type] ??= []).push(fn); },
		contains: other => { for (let c = other; c; c = c.parent) if (c === node) return true; return false; },
		/**
		 * Fire a dragover the way the drop-zone helper's own listener would see it.
		 *
		 * Worth modelling because `dropEffect` is not decoration: the browser intersects it with
		 * the source's `effectAllowed`, and an incompatible pair resolves to "none" — no `drop`
		 * event at all, no error, the row snapping back.
		 */
		async dragoverEvent(dataTransfer, target = node) {
			const ev = {
				target, dataTransfer, defaultPrevented: false,
				preventDefault() { ev.defaultPrevented = true; },
				stopPropagation() {},
			};
			for (const fn of node.handlers.dragover ?? []) await fn(ev);
			return ev;
		},
		/** Fire a drop on this element the way the drop-zone helper's own listener would see it. */
		async dropEvent(dataTransfer, target = node) {
			const ev = {
				target, dataTransfer, defaultPrevented: false,
				preventDefault() { ev.defaultPrevented = true; },
				stopPropagation() {},
			};
			for (const fn of node.handlers.drop ?? []) await fn(ev);
			return ev;
		},
		focus() { node.focused = true; },
		blur() { node.focused = false; },
		select() { node.selected = true; },
	};
	parent?.children.push(node);
	return node;
}

/** Every descendant matching `sel`, depth first. */
export function walk(nodes, sel, out = []) {
	for (const node of nodes) {
		if (node.matches(sel)) out.push(node);
		walk(node.children, sel, out);
	}
	return out;
}

/**
 * The rendered sheet root the tab's listeners are delegated onto.
 *
 * `panelClasses` builds the one child a drop zone needs to find (`.tab.encounters`), so the zone's
 * listeners land somewhere a drop can reach them. Omit it for a tab with no drop zone.
 */
export function fakeRoot({ panelClasses = null } = {}) {
	const handlers = {};
	const root = {
		classes: [], dataset: {}, children: [], parent: null,
		matches: () => false,
		closest: () => null,
		addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); },
		querySelector: sel => walk(root.children, sel)[0] ?? null,
		querySelectorAll: sel => walk(root.children, sel),
		async emit(type, target, extra = {}) {
			const ev = {
				target, defaultPrevented: false, propagationStopped: false, ...extra,
				preventDefault() { ev.defaultPrevented = true; },
				stopPropagation() { ev.propagationStopped = true; },
			};
			for (const fn of handlers[type] ?? []) await fn(ev);
			return ev;
		},
	};
	if (panelClasses) root.panel = fakeEl({ cls: panelClasses, parent: root });
	return root;
}

/**
 * One of the toolkit's list mixins over a stand-in actor whose `update` WRITES THROUGH, so a chain
 * of mutations reads what the one before it left — the property the serialization guard is about.
 *
 * `updates` records every call as `[data, options]`, so a test can ask what was sent and whether it
 * asked for a render.
 *
 * `editing` stands in for the `withSectionEditing` mixin the real sheet composes underneath. A
 * boolean sets every section; an object keyed by section name sets them apart (the wonder tab has
 * two pencils). Defaults to ON, so every test about what a button WRITES says only that; the tests
 * about what the pencil GATES pass it explicitly.
 */
export function makeListHost(mixin, path, rows = [], { editing = true } = {}) {
	const key = path.replace(/^system\./, "");
	const actor = { id: "toolkit1", system: { [key]: structuredClone(rows) } };
	const updates = [];
	actor.update = vi.fn(async (data, options = {}) => {
		updates.push([data, options]);
		actor.system[key] = structuredClone(data[path]);
		return actor;
	});
	const Base = class {
		get actor() { return actor; }
		isSectionEditable(section) {
			return typeof editing === "boolean" ? editing : !!editing[section];
		}
	};
	const host = new (mixin(Base))();
	return { host, actor, updates };
}
