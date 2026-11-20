import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

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
