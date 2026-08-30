// A document that can be BUILT INTO, for the code that writes into the PDF viewer's frame.
//
// WHY IT IS NOT `tests/fakes/dom.js`. That one models a sheet already RENDERED by Handlebars: a
// tree of elements that receives delegated events, where the interesting question is what
// `closest` walks up to. This models the other half — a `document` that hands out new elements
// and takes them into a tree — because that is the only way the bookmarks tab exists
// (module/books/reader-bookmarks-tab.js builds every node it needs and inserts them into the
// viewer's own sidebar). Neither is a superset of the other, so they are two files rather than
// one with two shapes in it.
//
// The suite runs on the `node` environment with no DOM at all (vitest.config.js), and the whole
// point of testing this is that the tab is built against MARKUP WE DO NOT OWN: the ids and
// classes pdf.js's sidebar uses. `viewerDocument` below is that sidebar, spelled the way
// viewer.html spells it, so a test can assert the button really did land between Thumbnails and
// the Outline rather than merely that some function was called.
import { vi } from "vitest";

/** One element: the properties and the handful of methods the tab actually touches. */
export function frameEl(doc, tag) {
	const node = {
		tagName: String(tag).toUpperCase(),
		id: "", className: "", type: "", title: "", href: "", value: "", maxLength: 0,
		textContent: "", dataset: {}, children: [], parent: null, attrs: {}, handlers: {},
		focused: false, selected: false, disabled: false,
		get classes() { return node.className.split(/\s+/).filter(Boolean); },
		classList: {
			contains: name => node.classes.includes(name),
			add(name) { if (!node.classes.includes(name)) node.className = [...node.classes, name].join(" "); },
			remove(name) { node.className = node.classes.filter(c => c !== name).join(" "); },
			toggle(name, force) {
				const on = force ?? !node.classList.contains(name);
				if (on) node.classList.add(name); else node.classList.remove(name);
				return on;
			},
		},
		setAttribute(key, value) { node.attrs[key] = String(value); },
		getAttribute(key) { return node.attrs[key] ?? null; },
		append(...kids) {
			for (const kid of kids) { kid.parent = node; node.children.push(kid); }
		},
		/** A missing reference node appends, which is what a real `insertBefore(node, null)` does. */
		insertBefore(kid, ref) {
			const at = ref ? node.children.indexOf(ref) : -1;
			kid.parent = node;
			if (at < 0) node.children.push(kid);
			else node.children.splice(at, 0, kid);
		},
		replaceChildren(...kids) {
			for (const kid of node.children) kid.parent = null;
			node.children = [];
			node.append(...kids);
		},
		remove() {
			const at = node.parent?.children.indexOf(node) ?? -1;
			if (at >= 0) node.parent.children.splice(at, 1);
			node.parent = null;
		},
		addEventListener(type, fn) { (node.handlers[type] ??= []).push(fn); },
		focus() { node.focused = true; },
		select() { node.selected = true; },
		/**
		 * Fire one listener set and AWAIT it. A real dispatch does not wait; these handlers
		 * write a setting and then repaint, and a test that fired and polled would be testing
		 * the poll.
		 */
		async emit(type, extra = {}) {
			const ev = {
				type, target: node, defaultPrevented: false, propagationStopped: false, ...extra,
				preventDefault() { ev.defaultPrevented = true; },
				stopPropagation() { ev.propagationStopped = true; },
			};
			for (const fn of node.handlers[type] ?? []) await fn(ev);
			return ev;
		},
		click() { return node.emit("click"); },
		/** Every descendant, depth first, including this node. */
		tree(out = []) {
			out.push(node);
			for (const kid of node.children) kid.tree(out);
			return out;
		},
		/** The text a reader would see: this node's own, then its children's. */
		text() {
			return [node.textContent, ...node.children.map(kid => kid.text())].filter(Boolean).join(" ");
		},
		/**
		 * The first descendant matching `.class`, `#id` or a tag name.
		 *
		 * Only those three, because they are the only forms the tab uses -- and it uses one at
		 * all only because focusing an element has to happen after it is in the document, which
		 * means finding it again rather than holding it.
		 */
		querySelector(selector) {
			const sel = String(selector).trim();
			const match = sel.startsWith(".") ? el => el.classes.includes(sel.slice(1))
				: sel.startsWith("#") ? el => el.id === sel.slice(1)
				: el => el.tagName === sel.toUpperCase();
			return node.tree().slice(1).find(match) ?? null;
		},
		find(pred) { return node.tree().find(pred) ?? null; },
		findAll(pred) { return node.tree().filter(pred); },
		byClass(name) { return node.findAll(el => el.classes.includes(name)); },
	};
	node.doc = doc;
	return node;
}

/** The ids pdf.js's sidebar gives its four tabs, in the order viewer.html lists them. */
export const NATIVE_SIDEBAR_TABS = [
	["viewThumbnail", "thumbnailView"],
	["viewOutline", "outlineView"],
	["viewAttachments", "attachmentsView"],
	["viewLayers", "layersView"],
];

/**
 * The viewer's document, as far as the sidebar goes.
 *
 * `omit` drops one id from the build, which is how a test asks what happens on the day a future
 * pdf.js renames it: the tab has to answer null and leave the reader with a working book.
 */
export function viewerDocument({ omit = [] } = {}) {
	const doc = {
		head: null,
		createElement: tag => frameEl(doc, tag),
		getElementById: id => doc.root.find(el => el.id === id),
	};
	doc.root = frameEl(doc, "html");
	doc.head = frameEl(doc, "head");
	doc.root.append(doc.head);

	const has = id => !omit.includes(id);
	const add = (parent, tag, id, className = "") => {
		if (!has(id)) return null;
		const el = frameEl(doc, tag);
		el.id = id;
		el.className = className;
		parent.append(el);
		return el;
	};
	const container = frameEl(doc, "div");
	doc.root.append(container);
	const buttons = add(container, "div", "sidebarViewButtons");
	const content = add(container, "div", "sidebarContent");
	for (const [button, view] of NATIVE_SIDEBAR_TABS) {
		if (buttons) add(buttons, "button", button, button === "viewThumbnail" ? "toolbarButton toggled" : "toolbarButton");
		if (content) add(content, "div", view, view === "thumbnailView" ? "" : "hidden");
	}
	return doc;
}

/**
 * `PDFViewerApplication`, as far as the tab reaches into it: the sidebar it toggles, the bus it
 * listens on, the location it reads and the link service it navigates with.
 */
export function viewerApp({ page = 91, params = "#page=91&zoom=100,0,412", outline = null, pagesCount = 308 } = {}) {
	const listeners = {};
	return {
		page,
		pagesCount,
		pdfViewer: { _location: params === null ? null : { pageNumber: page, pdfOpenParams: params } },
		pdfSidebar: { isOpen: false, active: 1, open: vi.fn(function () { this.isOpen = true; }) },
		pdfLinkService: { setHash: vi.fn() },
		pdfDocument: outline,
		eventBus: {
			on: (type, fn) => { (listeners[type] ??= []).push(fn); },
			off: (type, fn) => { listeners[type] = (listeners[type] ?? []).filter(f => f !== fn); },
			dispatch: (type, payload) => { for (const fn of listeners[type] ?? []) fn(payload); },
			listenerCount: type => (listeners[type] ?? []).length,
		},
	};
}
