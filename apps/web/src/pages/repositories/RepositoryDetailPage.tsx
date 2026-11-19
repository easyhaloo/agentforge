import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Code2, GitPullRequest, PlayCircle, Package, BookOpen, Settings, Users, AlertCircle, ChevronRight, ChevronDown, File, Folder } from "lucide-react";
import type { OrganizationSummary } from "../../shared/api/identity";
import { Button } from "../../shared/ui";
import "./RepositoryDetailPage.css";

interface RepositoryDetailPageProps {
  organization: OrganizationSummary;
  repositorySlug: string;
}

type TabType = "code" | "issues" | "pulls" | "actions" | "packages" | "wiki" | "settings" | "members";

export function RepositoryDetailPage({ organization, repositorySlug }: RepositoryDetailPageProps) {
  const { t } = useTranslation("repositories");
  const [activeTab, setActiveTab] = useState<TabType>("code");

  const tabs: Array<{ id: TabType; label: string; icon: React.ReactNode }> = [
    { id: "code", label: "Code", icon: <Code2 size={16} /> },
    { id: "issues", label: "Issues", icon: <AlertCircle size={16} /> },
    { id: "pulls", label: "Pull Requests", icon: <GitPullRequest size={16} /> },
    { id: "actions", label: "Actions", icon: <PlayCircle size={16} /> },
    { id: "packages", label: "Packages", icon: <Package size={16} /> },
    { id: "wiki", label: "Wiki", icon: <BookOpen size={16} /> },
    { id: "settings", label: "Settings", icon: <Settings size={16} /> },
    { id: "members", label: "Members", icon: <Users size={16} /> },
  ];

  return (
    <div className="repository-detail-page">
      {/* Repository Header */}
      <header className="repository-header">
        <div className="repository-header-content">
          <div className="repository-title">
            <h1>
              {organization.slug} / <strong>{repositorySlug}</strong>
            </h1>
            <span className="badge">Public</span>
          </div>
          <p className="repository-description">
            AgentForge API Server - Core backend services for the AgentForge platform
          </p>
          <div className="repository-meta">
            <span>⭐ 128</span>
            <span>🔀 24</span>
            <span>👁️ 12</span>
          </div>
        </div>
        <div className="repository-actions">
          <Button variant="secondary" size="sm">Watch</Button>
          <Button variant="secondary" size="sm">Fork</Button>
          <Button variant="secondary" size="sm">Star</Button>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="repository-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`repository-tab ${activeTab === tab.id ? "active" : ""}`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Tab Content */}
      <div className="repository-content">
        {activeTab === "code" && <CodeTabContent />}
        {activeTab === "issues" && <div>Issues content</div>}
        {activeTab === "pulls" && <div>Pull Requests content</div>}
        {activeTab === "actions" && <div>Actions content</div>}
        {activeTab === "packages" && <div>Packages content</div>}
        {activeTab === "wiki" && <div>Wiki content</div>}
        {activeTab === "settings" && <div>Settings content</div>}
        {activeTab === "members" && <div>Members content</div>}
      </div>
    </div>
  );
}

function CodeTabContent() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["src", "docs"]));

  // Mock file tree data - will be replaced with API call
  const fileTree = {
    name: "root",
    type: "folder" as const,
    children: [
      {
        name: "src",
        type: "folder" as const,
        children: [
          { name: "main.ts", type: "file" as const },
          { name: "app.ts", type: "file" as const },
          {
            name: "utils",
            type: "folder" as const,
            children: [
              { name: "helpers.ts", type: "file" as const },
              { name: "validators.ts", type: "file" as const },
            ],
          },
        ],
      },
      {
        name: "docs",
        type: "folder" as const,
        children: [
          { name: "README.md", type: "file" as const },
          { name: "CONTRIBUTING.md", type: "file" as const },
        ],
      },
      { name: "package.json", type: "file" as const },
      { name: "tsconfig.json", type: "file" as const },
    ],
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <div className="code-tab-content">
      <div className="code-tab-layout">
        <aside className="file-tree">
          <h3>Files</h3>
          <div className="file-tree-content">
            <FileTreeNode
              node={fileTree}
              path=""
              selectedFile={selectedFile}
              expandedFolders={expandedFolders}
              onSelectFile={setSelectedFile}
              onToggleFolder={toggleFolder}
            />
          </div>
        </aside>
        <main className="file-viewer">
          <div className="file-header">
            <span>{selectedFile || "Select a file to view"}</span>
          </div>
          <div className="file-content">
            {selectedFile ? (
              <pre>
                <code>// File content for {selectedFile} will be loaded here</code>
              </pre>
            ) : (
              <p>Select a file from the tree to view its contents</p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

interface FileTreeNode {
  name: string;
  type: "file" | "folder";
  children?: FileTreeNode[];
}

interface FileTreeNodeProps {
  node: FileTreeNode;
  path: string;
  selectedFile: string | null;
  expandedFolders: Set<string>;
  onSelectFile: (file: string) => void;
  onToggleFolder: (path: string) => void;
  level?: number;
}

function FileTreeNode({
  node,
  path,
  selectedFile,
  expandedFolders,
  onSelectFile,
  onToggleFolder,
  level = 0,
}: FileTreeNodeProps) {
  const currentPath = path ? `${path}/${node.name}` : node.name;
  const isExpanded = expandedFolders.has(currentPath);
  const isSelected = selectedFile === currentPath;

  if (node.type === "folder") {
    return (
      <div>
        <div
          className={`file-tree-item folder ${isSelected ? "active" : ""}`}
          onClick={() => onToggleFolder(currentPath)}
          style={{ paddingLeft: `${level * 12}px` }}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Folder size={14} />
          <span>{node.name}</span>
        </div>
        {isExpanded && node.children && (
          <div className="file-tree-children">
            {node.children.map((child) => (
              <FileTreeNode
                key={child.name}
                node={child}
                path={currentPath}
                selectedFile={selectedFile}
                expandedFolders={expandedFolders}
                onSelectFile={onSelectFile}
                onToggleFolder={onToggleFolder}
                level={level + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`file-tree-item ${isSelected ? "active" : ""}`}
      onClick={() => onSelectFile(currentPath)}
      style={{ paddingLeft: `${level * 12 + 16}px` }}
    >
      <File size={14} />
      <span>{node.name}</span>
    </div>
  );
}
