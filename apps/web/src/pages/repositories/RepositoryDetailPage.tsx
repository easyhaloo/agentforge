import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Code2, GitPullRequest, PlayCircle, Package, BookOpen, Settings, Users, AlertCircle } from "lucide-react";
import type { OrganizationSummary } from "../../shared/api/identity";
import { Button } from "../../shared/ui";

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
  return (
    <div className="code-tab-content">
      <div className="code-tab-layout">
        <aside className="file-tree">
          <h3>Files</h3>
          <div className="file-tree-content">
            {/* File tree will be implemented next */}
            <p>File tree placeholder</p>
          </div>
        </aside>
        <main className="file-viewer">
          <div className="file-header">
            <span>Select a file to view</span>
          </div>
          <div className="file-content">
            {/* File content will be displayed here */}
          </div>
        </main>
      </div>
    </div>
  );
}
