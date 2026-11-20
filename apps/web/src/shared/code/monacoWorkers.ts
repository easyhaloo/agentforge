// @ts-expect-error Vite resolves Monaco's worker entrypoints with the ?worker query.
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
// @ts-expect-error Vite resolves Monaco's worker entrypoints with the ?worker query.
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
// @ts-expect-error Vite resolves Monaco's worker entrypoints with the ?worker query.
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
// @ts-expect-error Vite resolves Monaco's worker entrypoints with the ?worker query.
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
// @ts-expect-error Vite resolves Monaco's worker entrypoints with the ?worker query.
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

type MonacoWorkerEnvironment = {
  getWorker: (_workerId: string, label: string) => Worker;
};

let configured = false;

/** Install Vite's ESM worker constructors before Monaco is imported. */
export function configureMonacoWorkers(): void {
  if (configured) return;
  const scope = globalThis as typeof globalThis & { MonacoEnvironment?: MonacoWorkerEnvironment };
  scope.MonacoEnvironment = {
    getWorker(_workerId, label) {
      switch (label) {
        case "json": return new JsonWorker();
        case "css":
        case "scss":
        case "less": return new CssWorker();
        case "html":
        case "handlebars":
        case "razor": return new HtmlWorker();
        case "typescript":
        case "javascript": return new TypeScriptWorker();
        default: return new EditorWorker();
      }
    },
  };
  configured = true;
}
