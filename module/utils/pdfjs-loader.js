// Foundry's own copy of pdf.js, loaded once, for reading a PDF the user picks (the Playbook
// Builder's "Read from a PDF…"). The same route and worker the Import Book Art macro uses (that
// macro keeps its own copy of these lines because it is a self-contained compendium command).
//
// Foundry v13 and v14 both serve pdf.js 4.0.379 at /scripts/pdfjs/build/. Nothing is fetched from
// anywhere else, and the PDF itself never leaves the browser.

let _pdfjs = null;

/** @returns {Promise<object>} the pdf.js module, with its worker set */
export function loadPdfjs() {
	_pdfjs ??= (async () => {
		const route = path => foundry.utils.getRoute(path);
		const m = await import(route("/scripts/pdfjs/build/pdf.mjs"));
		m.GlobalWorkerOptions.workerSrc = route("/scripts/pdfjs/build/pdf.worker.mjs");
		return m;
	})().catch(err => {
		_pdfjs = null; // a failed load may be tried again
		throw err;
	});
	return _pdfjs;
}
