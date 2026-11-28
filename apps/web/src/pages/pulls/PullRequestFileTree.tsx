import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileMinus, FilePenLine, FilePlus, FileSymlink } from "lucide-react";
import { getDiffFileId, getDiffFilePath } from "../repositories/RepositoryDiffViewer";
import type { RepositoryDiffFile } from "../repositories/repositoryDiff";

const statusIcons = { added: FilePlus, deleted: FileMinus, modified: FilePenLine, renamed: FileSymlink };

type FileEntry = { file: RepositoryDiffFile; path: string; name: string };
type Directory = { directories: Map<string, Directory>; files: FileEntry[] };
type TreeSelection = { selectedPath?: string; onSelect: (path: string) => void };

function createDirectory(): Directory {
  return { directories: new Map(), files: [] };
}

function buildTree(files: RepositoryDiffFile[]): Directory {
  const root = createDirectory();
  files.forEach(file => {
    const path = getDiffFilePath(file);
    const segments = path.split("/");
    const name = segments.pop() ?? path;
    let directory = root;
    for (const segment of segments) {
      let child = directory.directories.get(segment);
      if (!child) {
        child = createDirectory();
        directory.directories.set(segment, child);
      }
      directory = child;
    }
    directory.files.push({ file, path, name });
  });
  return root;
}

function FileTreeDirectory({ directory, selectedPath, onSelect }: TreeSelection & { directory: Directory }) {
  const { t } = useTranslation("pulls");
  return <ul>
    {[...directory.directories].map(([name, child]) => <li key={`dir:${name}`}>
      <details open>
        <summary title={name}>{name}</summary>
        <FileTreeDirectory directory={child} selectedPath={selectedPath} onSelect={onSelect}/>
      </details>
    </li>)}
    {directory.files.map(({ file, path, name }) => {
      const Icon = statusIcons[file.status];
      return <li key={`file:${path}`}>
        <a href={`#${encodeURIComponent(getDiffFileId(path))}`} title={path} aria-current={selectedPath === path ? "location" : undefined}
          onClick={event => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onSelect(path);
          }}>
          <Icon size={16} className={`pull-file-status--${file.status}`} role="img" aria-label={t(`pulls:files.status.${file.status}`)}/>
          <span className="pull-file-tree-name">{name}</span>
          <span className="pull-file-tree-stats">
            <span className="pull-file-additions">{t("pulls:files.additions", { count: file.additions })}</span>{" "}
            <span className="pull-file-deletions">{t("pulls:files.deletions", { count: file.deletions })}</span>
          </span>
        </a>
      </li>;
    })}
  </ul>;
}

export function PullRequestFileTree({ files, ...selection }: TreeSelection & { files: RepositoryDiffFile[] }) {
  const { t } = useTranslation("pulls");
  const root = useMemo(() => buildTree(files), [files]);
  return <nav className="pull-file-tree" aria-label={t("pulls:files.fileTree")}>
    <FileTreeDirectory directory={root} {...selection}/>
  </nav>;
}
