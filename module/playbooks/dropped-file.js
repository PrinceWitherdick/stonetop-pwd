/**
 * What a drag carries, for the Playbook Builder and the Items sidebar: "pdf", "json" or null. With
 * `peek` (a dragover, where the browser hides the files' names) any file counts, so the drop is
 * allowed. PURE, and kept out of the builder so the sidebar can ask without loading the window.
 */
export function droppedFileKind(dataTransfer, { peek = false } = {}) {
	if (!dataTransfer || ![...(dataTransfer.types ?? [])].includes("Files")) return null;
	if (peek) return "file";
	const file = dataTransfer.files?.[0];
	if (!file) return null;
	if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") return "pdf";
	if (/\.json$/i.test(file.name) || file.type === "application/json") return "json";
	return null;
}
