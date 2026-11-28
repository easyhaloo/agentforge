import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Code2, GitPullRequest, PlayCircle, Package, BookOpen, Settings, Users, AlertCircle, GitMerge, GitBranch, Clock, MessageSquare, CheckCircle2, XCircle, Loader, Timer, StopCircle, Plus, User, Tag, Bell, Webhook, Shield, Scale, Cloud, Key, Bot, FileText, Lock, Boxes, Star, GitFork, Eye } from "lucide-react";
import type { OrganizationSummary, RepositoryPreviewBlob } from "../../shared/api/identity";
import { repositoryPreviewAPI } from "../../shared/api/identity";
import { organizationHandle, repositoryPath } from "../../shared/routing";
import { Button, SearchInput, Select, DataTable, Tabs } from "../../shared/ui";
import type { DataTableColumn } from "../../shared/ui";
import { RepositoryFileTree } from "./RepositoryFileTree";
import { RepositorySourceViewer } from "./RepositorySourceViewer";
import { RepositoryReadme } from "./RepositoryReadme";
import "./RepositoryDetailPage.css";

interface RepositoryDetailPageProps {
  organization: OrganizationSummary;
  repositorySlug: string;
}

type TabType = "code" | "pulls" | "actions" | "packages" | "wiki" | "settings" | "members";

export function RepositoryDetailPage({ organization, repositorySlug }: RepositoryDetailPageProps) {
  const { t } = useTranslation("repositories");
  const [activeTab, setActiveTab] = useState<TabType>("code");

  // Check if user is repository owner
  const isOwner = organization.role === "owner";

  const tabs: Array<{ id: TabType; label: string; icon: React.ReactNode }> = [
    { id: "code", label: "Code", icon: <Code2 size={16} /> },
    { id: "pulls", label: "Pull Requests", icon: <GitPullRequest size={16} /> },
    { id: "actions", label: "Actions", icon: <PlayCircle size={16} /> },
    { id: "packages", label: "Packages", icon: <Package size={16} /> },
    { id: "wiki", label: "Wiki", icon: <BookOpen size={16} /> },
    ...(isOwner ? [{ id: "settings" as const, label: "Settings", icon: <Settings size={16} /> }] : []),
    { id: "members", label: "Members", icon: <Users size={16} /> },
  ];

  const statistics = [
    { label: t("catalog.stars"), count: 128, Icon: Star },
    { label: t("catalog.forkCount"), count: 24, Icon: GitFork },
    { label: t("catalog.watchers"), count: 12, Icon: Eye },
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
            {statistics.map(({ label, count, Icon }) => (
              <span key={label} role="img" aria-label={`${label}: ${count}`}>
                <Icon size={14} aria-hidden="true" />
                {count}
              </span>
            ))}
          </div>
        </div>
        <div className="repository-actions">
          <Link className="af-button af-button--secondary af-button--small" to={repositoryPath(organizationHandle(organization), `${organization.slug}/${repositorySlug}`, "issues")}>
            <AlertCircle size={16} aria-hidden="true"/>{t("sections.issues")}
          </Link>
          <Button variant="secondary" size="small">Watch</Button>
          <Button variant="secondary" size="small">Fork</Button>
          <Button variant="secondary" size="small">Star</Button>
        </div>
      </header>

      {/* Tab Navigation */}
      <Tabs
        className="repository-tabs"
        ariaLabel="Repository sections"
        value={activeTab}
        onChange={(key) => setActiveTab(key as TabType)}
        items={tabs.map((tab) => ({
          key: tab.id,
          label: <>{tab.icon}<span>{tab.label}</span></>,
        }))}
      />

      {/* Tab Content */}
      <div className="repository-content">
        {activeTab === "code" && <CodeTabContent organization={organization} repositorySlug={repositorySlug} />}
        {activeTab === "pulls" && <PullRequestsTabContent />}
        {activeTab === "actions" && <ActionsTabContent />}
        {activeTab === "packages" && <PackagesTabContent />}
        {activeTab === "wiki" && <WikiTabContent />}
        {activeTab === "settings" && <SettingsTabContent />}
        {activeTab === "members" && <MembersTabContent organization={organization} />}
      </div>
    </div>
  );
}

interface CodeTabContentProps {
  organization: OrganizationSummary;
  repositorySlug: string;
}

function CodeTabContent({ organization, repositorySlug }: CodeTabContentProps) {
  const [selectedFile, setSelectedFile] = useState<{ path: string; size?: number } | null>(null);
  const [fileContent, setFileContent] = useState<RepositoryPreviewBlob | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const repository = `${organization.slug}/${repositorySlug}`;

  const selectFile = async (path: string, size?: number) => {
    setSelectedFile({ path, size });
    setLoadingFile(true);
    try {
      const blob = await repositoryPreviewAPI.blob(organization.id, repository, path, "");
      setFileContent(blob);
    } catch (err) {
      console.error("Failed to load file:", err);
      setFileContent(null);
    } finally {
      setLoadingFile(false);
    }
  };

  return (
    <div className="code-tab-content">
      <div className="repo-file-layout">
        <RepositoryFileTree organizationID={organization.id} repository={repository} refName=""
          selectedFile={selectedFile?.path} onSelectFile={selectFile}/>
        <main className="file-viewer">
          {selectedFile ? (
            <>
              <div className="file-header">
                <div>
                  <strong>{selectedFile.path.split("/").at(-1)}</strong>
                  <span className="file-metadata">
                    {" • "}{selectedFile.path}
                    {selectedFile.size !== undefined && ` • ${formatBytes(selectedFile.size)}`}
                  </span>
                </div>
              </div>
              <div className="file-content">
                {loadingFile ? (
                  <p>Loading file content...</p>
                ) : fileContent ? (
                  <RepositorySourceViewer path={fileContent.path} content={fileContent.content} />
                ) : (
                  <p>Failed to load file content</p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="file-header">
                <span>Select a file to view</span>
              </div>
              <div className="file-content">
                <p>Select a file from the tree to view its contents</p>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PackageData {
  id: string;
  name: string;
  version: string;
  description: string;
  publishDate: string;
  downloadCount: number;
  installCommand: string;
  repository: string;
}

function PackagesTabContent() {
  const [selectedPackage, setSelectedPackage] = useState<string>("agentforge-web");

  const packages: PackageData[] = [
    {
      id: "agentforge-web",
      name: "agentforge-web",
      version: "1.2.3",
      description: "Web interface for AgentForge platform with React and TypeScript support",
      publishDate: "2024-01-15",
      downloadCount: 15420,
      installCommand: "npm install agentforge-web",
      repository: "https://github.com/agentforge/agentforge-web",
    },
    {
      id: "agentforge-cli",
      name: "agentforge-cli",
      version: "2.0.1",
      description: "Command-line interface for managing AgentForge agents and workflows",
      publishDate: "2024-01-20",
      downloadCount: 8932,
      installCommand: "npm install -g agentforge-cli",
      repository: "https://github.com/agentforge/agentforge-cli",
    },
    {
      id: "agentforge-api",
      name: "agentforge-api",
      version: "3.1.0",
      description: "Core API client library for interacting with AgentForge backend services",
      publishDate: "2024-01-22",
      downloadCount: 12764,
      installCommand: "npm install agentforge-api",
      repository: "https://github.com/agentforge/agentforge-api",
    },
  ];

  const currentPackage = packages.find((pkg) => pkg.id === selectedPackage);

  return (
    <div className="packages-tab-content">
      <div className="packages-tab-layout">
        <aside className="package-list">
          <h3>Packages</h3>
          <div className="package-list-content">
            {packages.map((pkg) => (
              <div
                key={pkg.id}
                className={`package-list-item ${selectedPackage === pkg.id ? "active" : ""}`}
                onClick={() => setSelectedPackage(pkg.id)}
              >
                <div className="package-list-item-icon">
                  <Package size={16} />
                </div>
                <div className="package-list-item-info">
                  <div className="package-list-item-name">{pkg.name}</div>
                  <div className="package-list-item-version">v{pkg.version}</div>
                </div>
              </div>
            ))}
          </div>
        </aside>
        <main className="package-details">
          {currentPackage ? (
            <>
              <div className="package-header">
                <div className="package-header-title">
                  <Package size={24} />
                  <h2>{currentPackage.name}</h2>
                  <span className="package-version-badge">v{currentPackage.version}</span>
                </div>
                <p className="package-description">{currentPackage.description}</p>
              </div>

              <div className="package-info-grid">
                <div className="package-info-card">
                  <h4>Version</h4>
                  <p>{currentPackage.version}</p>
                </div>
                <div className="package-info-card">
                  <h4>Published</h4>
                  <p>{new Date(currentPackage.publishDate).toLocaleDateString()}</p>
                </div>
                <div className="package-info-card">
                  <h4>Downloads</h4>
                  <p>{currentPackage.downloadCount.toLocaleString()}</p>
                </div>
              </div>

              <div className="package-install-section">
                <h3>Installation</h3>
                <div className="package-install-command">
                  <code>{currentPackage.installCommand}</code>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => navigator.clipboard.writeText(currentPackage.installCommand)}
                  >
                    Copy
                  </Button>
                </div>
              </div>

              <div className="package-repository-section">
                <h3>Repository</h3>
                <a href={currentPackage.repository} target="_blank" rel="noopener noreferrer" className="package-repository-link">
                  {currentPackage.repository}
                </a>
              </div>
            </>
          ) : (
            <p>Select a package to view details</p>
          )}
        </main>
      </div>
    </div>
  );
}

interface WikiPage {
  id: string;
  title: string;
  content: string;
}

const mockWikiPages: WikiPage[] = [
  {
    id: "home",
    title: "Home",
    content: `# Welcome to AgentForge Wiki

AgentForge is a comprehensive platform for building, deploying, and managing AI agents at scale.

## Quick Links

- [Getting Started](getting-started) - Learn how to set up your first agent
- [Architecture](architecture) - Understand the system design
- [API Reference](api-reference) - Explore the API documentation

## Overview

AgentForge provides a unified interface for:

- **Agent Development**: Build intelligent agents using our SDK
- **Pipeline Management**: Orchestrate complex workflows
- **Monitoring**: Track agent performance in real-time
- **Collaboration**: Work with your team seamlessly

## Features

- Multi-model support (GPT-4, Claude, Gemini)
- Built-in code execution sandbox
- Real-time collaboration tools
- Enterprise-grade security
- Comprehensive analytics

> **Note**: This wiki is continuously updated with the latest features and best practices.`,
  },
  {
    id: "getting-started",
    title: "Getting Started",
    content: `# Getting Started with AgentForge

This guide will help you get up and running with AgentForge in minutes.

## Prerequisites

Before you begin, ensure you have:

- Node.js 18+ or Go 1.21+
- Docker and Docker Compose
- Git
- API keys for your chosen LLM provider

## Installation

\`\`\`bash
# Clone the repository
git clone https://github.com/agentforge/agentforge.git
cd agentforge

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
\`\`\`

## Configuration

Edit your \`.env\` file with your API keys:

\`\`\`
OPENAI_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
DATABASE_URL=postgresql://localhost:5432/agentforge
\`\`\`

## Running the Application

\`\`\`bash
# Start the backend
make backend-dev

# In another terminal, start the frontend
make frontend-dev
\`\`\`

Visit **http://localhost:3000** to access the application.

## Creating Your First Agent

1. Navigate to the Agents page
2. Click "Create Agent"
3. Choose a template or start from scratch
4. Configure your agent's behavior
5. Deploy and test

## Next Steps

- Read the [Architecture](architecture) guide
- Explore the [API Reference](api-reference)
- Check out example agents in the repository`,
  },
  {
    id: "architecture",
    title: "Architecture",
    content: `# AgentForge Architecture

This document describes the high-level architecture of AgentForge.

## System Components

### Frontend Layer

The web interface is built with:

- **React** for UI components
- **TypeScript** for type safety
- **Vite** for fast development builds
- **TanStack Query** for data fetching

### Backend Services

\`\`\`
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   API GW    │────▶│   Services   │────▶│  Database   │
└─────────────┘     └──────────────┘     └─────────────┘
      │                     │                     │
      │                     │                     │
      ▼                     ▼                     ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Auth      │     │   Executor   │     │   Cache     │
└─────────────┘     └──────────────┘     └─────────────┘
\`\`\`

### Core Services

1. **API Gateway**: Routes requests and handles authentication
2. **Agent Service**: Manages agent lifecycle and execution
3. **Pipeline Service**: Orchestrates multi-step workflows
4. **Executor Service**: Runs code in sandboxed environments
5. **Storage Service**: Handles file and artifact management

## Data Flow

1. User submits request via web UI
2. API Gateway authenticates and routes request
3. Service layer processes business logic
4. Executor runs agent code in sandbox
5. Results are persisted and returned to user

## Security Model

- **Authentication**: JWT tokens with refresh mechanism
- **Authorization**: Role-based access control (RBAC)
- **Isolation**: Docker-based sandboxing for code execution
- **Encryption**: TLS for transport, AES-256 for data at rest

## Scalability

- Horizontal scaling of service instances
- Message queue for async processing
- Distributed caching with Redis
- Database read replicas for query optimization`,
  },
  {
    id: "api-reference",
    title: "API Reference",
    content: `# API Reference

Complete reference for the AgentForge REST API.

## Authentication

All API requests require authentication using Bearer tokens:

\`\`\`bash
curl -H "Authorization: Bearer YOUR_TOKEN" \\
  https://api.agentforge.dev/v1/agents
\`\`\`

## Agents

### List Agents

\`\`\`http
GET /v1/agents
\`\`\`

**Query Parameters:**

- \`page\` (integer): Page number for pagination
- \`limit\` (integer): Number of results per page
- \`status\` (string): Filter by status (\`active\`, \`paused\`, \`archived\`)

**Response:**

\`\`\`json
{
  "agents": [
    {
      "id": "agent_123",
      "name": "Customer Support Bot",
      "status": "active",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45
  }
}
\`\`\`

### Create Agent

\`\`\`http
POST /v1/agents
\`\`\`

**Request Body:**

\`\`\`json
{
  "name": "My Agent",
  "model": "gpt-4",
  "system_prompt": "You are a helpful assistant",
  "temperature": 0.7
}
\`\`\`

### Execute Agent

\`\`\`http
POST /v1/agents/{agent_id}/execute
\`\`\`

**Request Body:**

\`\`\`json
{
  "input": "Hello, how are you?",
  "context": {}
}
\`\`\`

## Error Codes

- \`400\`: Bad Request - Invalid parameters
- \`401\`: Unauthorized - Missing or invalid token
- \`403\`: Forbidden - Insufficient permissions
- \`404\`: Not Found - Resource does not exist
- \`429\`: Too Many Requests - Rate limit exceeded
- \`500\`: Internal Server Error`,
  },
  {
    id: "contributing",
    title: "Contributing",
    content: `# Contributing to AgentForge

Thank you for your interest in contributing! This guide will help you get started.

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please read and follow our Code of Conduct.

## Development Setup

1. Fork the repository
2. Clone your fork locally
3. Create a new branch for your feature
4. Make your changes
5. Run tests and linting
6. Submit a pull request

## Coding Standards

### TypeScript/JavaScript

- Use TypeScript for all new code
- Follow the existing code style
- Run \`npm run lint\` before committing
- Write tests for new features

### Go

- Follow Go conventions and idioms
- Run \`gofmt\` on all code
- Add unit tests for business logic
- Document exported functions

## Commit Messages

Use conventional commit format:

\`\`\`
feat: add new agent execution mode
fix: resolve memory leak in executor
docs: update API documentation
test: add integration tests for pipelines
\`\`\`

## Pull Request Process

1. Update documentation for any user-facing changes
2. Add tests for new functionality
3. Ensure all tests pass
4. Request review from maintainers
5. Address review feedback
6. Squash commits before merge

## Testing

\`\`\`bash
# Run all tests
make test

# Run specific test suite
npm test -- agents

# Run with coverage
make test-coverage
\`\`\`

## Getting Help

- Join our Discord server
- Open a discussion on GitHub
- Check existing issues and pull requests`,
  },
  {
    id: "faq",
    title: "FAQ",
    content: `# Frequently Asked Questions

## General

### What is AgentForge?

AgentForge is a platform for building, deploying, and managing AI agents at scale. It provides tools for agent development, pipeline orchestration, and real-time monitoring.

### What LLM providers are supported?

We currently support:

- OpenAI (GPT-3.5, GPT-4, GPT-4 Turbo)
- Anthropic (Claude 2, Claude 3)
- Google (Gemini Pro)
- Open-source models via Ollama

### Is AgentForge open source?

Yes! AgentForge is open source under the MIT license. You can self-host or use our managed cloud service.

## Technical

### How do I configure agent memory?

Agent memory is configured in the agent settings:

\`\`\`json
{
  "memory": {
    "type": "vector",
    "max_tokens": 4000,
    "similarity_threshold": 0.7
  }
}
\`\`\`

### Can agents access external APIs?

Yes, agents can make HTTP requests to external APIs. Configure allowed domains in your environment settings for security.

### How are agents isolated?

Agents run in Docker containers with resource limits (CPU, memory, network). Each execution is isolated and cleaned up after completion.

### What database is used?

AgentForge uses PostgreSQL for structured data and Redis for caching. Vector embeddings are stored in Qdrant or Pinecone.

## Deployment

### Can I deploy on-premises?

Yes, AgentForge can be deployed on-premises using Docker Compose or Kubernetes.

### What are the system requirements?

**Minimum:**
- 4 CPU cores
- 8 GB RAM
- 50 GB storage

**Recommended:**
- 8+ CPU cores
- 16+ GB RAM
- 100+ GB SSD storage

### How do I scale AgentForge?

Use Kubernetes for automatic scaling based on load. Configure horizontal pod autoscaling for service replicas.

## Troubleshooting

### Agent execution is slow

Check:
1. LLM provider API rate limits
2. Database connection pool size
3. Container resource limits
4. Network latency

### Database connection errors

Verify:
- Database URL is correct
- Network connectivity
- Firewall rules
- Connection pool settings`,
  },
];

function WikiTabContent() {
  const [selectedPage, setSelectedPage] = useState<string>("home");

  const currentPage = mockWikiPages.find((page) => page.id === selectedPage) || mockWikiPages[0];

  return (
    <div className="wiki-tab-content">
      <div className="wiki-tab-layout">
        <aside className="wiki-sidebar">
          <h3>Wiki Pages</h3>
          <nav className="wiki-nav">
            {mockWikiPages.map((page) => (
              <Button
                key={page.id}
                onClick={() => setSelectedPage(page.id)}
                className={`wiki-nav-item ${selectedPage === page.id ? "active" : ""}`}
              >
                <BookOpen size={14} />
                <span>{page.title}</span>
              </Button>
            ))}
          </nav>
        </aside>
        <main className="wiki-content">
          <div className="wiki-header">
            <h2>{currentPage.title}</h2>
          </div>
          <div className="wiki-body">
            <RepositoryReadme content={currentPage.content} sourcePath={`wiki/${currentPage.id}.md`} />
          </div>
        </main>
      </div>
    </div>
  );
}

interface PullRequest {
  id: string;
  number: number;
  title: string;
  status: "open" | "closed" | "merged";
  author: string;
  authorAvatar?: string;
  sourceBranch: string;
  targetBranch: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  labels: string[];
  reviewStatus?: "approved" | "changes-requested" | "pending";
  checksStatus?: "passing" | "failing" | "pending";
}

type PRSubTab = "repository" | "related";
type PRStatusFilter = "all" | "open" | "closed" | "merged";
type PRSortOption = "newest" | "oldest" | "most-commented" | "recently-updated";

function PullRequestsTabContent() {
  const [activeSubTab, setActiveSubTab] = useState<PRSubTab>("repository");
  const [statusFilter, setStatusFilter] = useState<PRStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<PRSortOption>("newest");

  const mockPullRequests: PullRequest[] = [
    {
      id: "pr-1",
      number: 142,
      title: "Add support for multi-agent coordination workflows",
      status: "open",
      author: "alice-dev",
      sourceBranch: "feature/multi-agent",
      targetBranch: "main",
      createdAt: "2024-01-20T10:30:00Z",
      updatedAt: "2024-01-22T14:20:00Z",
      commentCount: 8,
      labels: ["enhancement", "agents"],
      reviewStatus: "approved",
      checksStatus: "passing",
    },
    {
      id: "pr-2",
      number: 138,
      title: "Fix memory leak in agent task executor",
      status: "merged",
      author: "bob-eng",
      sourceBranch: "fix/memory-leak",
      targetBranch: "main",
      createdAt: "2024-01-18T09:15:00Z",
      updatedAt: "2024-01-19T16:45:00Z",
      commentCount: 5,
      labels: ["bug", "performance"],
      reviewStatus: "approved",
      checksStatus: "passing",
    },
    {
      id: "pr-3",
      number: 135,
      title: "Implement streaming response support for LLM agents",
      status: "open",
      author: "charlie-ai",
      sourceBranch: "feature/streaming",
      targetBranch: "main",
      createdAt: "2024-01-15T11:20:00Z",
      updatedAt: "2024-01-21T10:30:00Z",
      commentCount: 12,
      labels: ["enhancement", "llm"],
      reviewStatus: "changes-requested",
      checksStatus: "failing",
    },
    {
      id: "pr-4",
      number: 131,
      title: "Update dependencies to latest versions",
      status: "closed",
      author: "alice-dev",
      sourceBranch: "chore/deps-update",
      targetBranch: "main",
      createdAt: "2024-01-12T08:00:00Z",
      updatedAt: "2024-01-13T09:30:00Z",
      commentCount: 3,
      labels: ["dependencies"],
      reviewStatus: "pending",
      checksStatus: "passing",
    },
    {
      id: "pr-5",
      number: 128,
      title: "Add authentication middleware for API endpoints",
      status: "merged",
      author: "bob-eng",
      sourceBranch: "feature/auth-middleware",
      targetBranch: "main",
      createdAt: "2024-01-10T14:30:00Z",
      updatedAt: "2024-01-11T16:20:00Z",
      commentCount: 15,
      labels: ["security", "enhancement"],
      reviewStatus: "approved",
      checksStatus: "passing",
    },
  ];

  const filteredPRs = mockPullRequests
    .filter((pr) => {
      if (statusFilter !== "all" && pr.status !== statusFilter) return false;
      if (authorFilter !== "all" && pr.author !== authorFilter) return false;
      if (labelFilter !== "all" && !pr.labels.includes(labelFilter)) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          pr.title.toLowerCase().includes(query) ||
          pr.number.toString().includes(query) ||
          pr.author.toLowerCase().includes(query)
        );
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "newest":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "most-commented":
          return b.commentCount - a.commentCount;
        case "recently-updated":
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        default:
          return 0;
      }
    });

  const uniqueAuthors = Array.from(new Set(mockPullRequests.map((pr) => pr.author)));
  const uniqueLabels = Array.from(new Set(mockPullRequests.flatMap((pr) => pr.labels)));

  const statusCounts = {
    all: mockPullRequests.length,
    open: mockPullRequests.filter((pr) => pr.status === "open").length,
    closed: mockPullRequests.filter((pr) => pr.status === "closed").length,
    merged: mockPullRequests.filter((pr) => pr.status === "merged").length,
  };

  return (
    <div className="pulls-tab-content">
      <div className="pulls-sub-tabs">
        <Button
          className={`pulls-sub-tab ${activeSubTab === "repository" ? "active" : ""}`}
          onClick={() => setActiveSubTab("repository")}
        >
          This Repository
        </Button>
        <Button
          className={`pulls-sub-tab ${activeSubTab === "related" ? "active" : ""}`}
          onClick={() => setActiveSubTab("related")}
        >
          Related
        </Button>
      </div>

      <div className="pulls-tab-layout">
        <aside className="pulls-filters">
          <h3>Filters</h3>

          <div className="filter-group">
            <h4>Status</h4>
            <div className="filter-options">
              <Button
                className={`filter-option ${statusFilter === "all" ? "active" : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                All ({statusCounts.all})
              </Button>
              <Button
                className={`filter-option ${statusFilter === "open" ? "active" : ""}`}
                onClick={() => setStatusFilter("open")}
              >
                Open ({statusCounts.open})
              </Button>
              <Button
                className={`filter-option ${statusFilter === "merged" ? "active" : ""}`}
                onClick={() => setStatusFilter("merged")}
              >
                Merged ({statusCounts.merged})
              </Button>
              <Button
                className={`filter-option ${statusFilter === "closed" ? "active" : ""}`}
                onClick={() => setStatusFilter("closed")}
              >
                Closed ({statusCounts.closed})
              </Button>
            </div>
          </div>

          <div className="filter-group">
            <h4>Author</h4>
            <Select
              aria-label="Filter pull requests by author"
              value={authorFilter}
              onChange={(event) => setAuthorFilter(event.target.value)}
              options={[
                { label: "All authors", value: "all" },
                ...uniqueAuthors.map((author) => ({ label: author, value: author })),
              ]}
            />
          </div>

          <div className="filter-group">
            <h4>Labels</h4>
            <Select
              aria-label="Filter pull requests by label"
              value={labelFilter}
              onChange={(event) => setLabelFilter(event.target.value)}
              options={[
                { label: "All labels", value: "all" },
                ...uniqueLabels.map((label) => ({ label, value: label })),
              ]}
            />
          </div>

          <div className="filter-group">
            <h4>Sort by</h4>
            <Select
              aria-label="Sort pull requests by"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as PRSortOption)}
              options={[
                { label: "Newest", value: "newest" },
                { label: "Oldest", value: "oldest" },
                { label: "Most commented", value: "most-commented" },
                { label: "Recently updated", value: "recently-updated" },
              ]}
            />
          </div>
        </aside>

        <main className="pulls-list-container">
          <div className="pulls-search-bar">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              onSearch={setSearchQuery}
              placeholder="Search pull requests by title, number, or author..."
              className="pulls-search"
            />
          </div>

          <div className="pulls-list">
            {filteredPRs.length === 0 ? (
              <div className="pulls-empty">
                <GitPullRequest size={48} />
                <p>No pull requests found</p>
              </div>
            ) : (
              filteredPRs.map((pr) => (
                <PullRequestItem key={pr.id} pr={pr} />
              ))
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

interface PullRequestItemProps {
  pr: PullRequest;
}

function PullRequestItem({ pr }: PullRequestItemProps) {
  const getStatusIcon = () => {
    switch (pr.status) {
      case "open":
        return <GitPullRequest size={16} className="pr-status-icon open" />;
      case "merged":
        return <GitMerge size={16} className="pr-status-icon merged" />;
      case "closed":
        return <XCircle size={16} className="pr-status-icon closed" />;
    }
  };

  const getChecksIcon = () => {
    if (!pr.checksStatus) return null;
    switch (pr.checksStatus) {
      case "passing":
        return <CheckCircle2 size={14} className="checks-icon passing" />;
      case "failing":
        return <XCircle size={14} className="checks-icon failing" />;
      case "pending":
        return <Clock size={14} className="checks-icon pending" />;
    }
  };

  const formatTimestamp = (date: string) => {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays < 30) return `${diffDays} days ago`;
    return then.toLocaleDateString();
  };

  return (
    <div className="pr-item">
      <div className="pr-item-status">{getStatusIcon()}</div>
      <div className="pr-item-content">
        <div className="pr-item-header">
          <h3 className="pr-item-title">{pr.title}</h3>
          <div className="pr-item-labels">
            {pr.labels.map((label) => (
              <span key={label} className="pr-label">
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="pr-item-meta">
          <span className="pr-number">#{pr.number}</span>
          <span className="pr-author">opened by {pr.author}</span>
          <span className="pr-timestamp">{formatTimestamp(pr.createdAt)}</span>
          <span className="pr-branch">
            <GitBranch size={12} />
            {pr.sourceBranch} → {pr.targetBranch}
          </span>
        </div>
        <div className="pr-item-stats">
          {pr.commentCount > 0 && (
            <span className="pr-stat">
              <MessageSquare size={14} />
              {pr.commentCount}
            </span>
          )}
          {getChecksIcon()}
          {pr.reviewStatus && (
            <span className={`pr-review-status ${pr.reviewStatus}`}>
              {pr.reviewStatus === "approved" && "✓ Approved"}
              {pr.reviewStatus === "changes-requested" && "⚠ Changes requested"}
              {pr.reviewStatus === "pending" && "⏱ Review pending"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

type WorkflowRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";

interface WorkflowData {
  id: string;
  name: string;
  status: "active" | "disabled";
  runsCount: number;
}

interface WorkflowRunData {
  id: string;
  workflowName: string;
  status: WorkflowRunStatus;
  branch: string;
  commitMessage: string;
  commitSha: string;
  actor: string;
  startTime: string;
  duration?: string;
}

function ActionsTabContent() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>("all");

  const workflows: WorkflowData[] = [
    { id: "ci", name: "CI", status: "active", runsCount: 156 },
    { id: "deploy", name: "Deploy to Production", status: "active", runsCount: 89 },
    { id: "tests", name: "Run Tests", status: "active", runsCount: 234 },
    { id: "lint", name: "Lint and Format", status: "active", runsCount: 312 },
    { id: "security", name: "Security Scan", status: "disabled", runsCount: 45 },
  ];

  const workflowRuns: WorkflowRunData[] = [
    {
      id: "run-1",
      workflowName: "CI",
      status: "succeeded",
      branch: "main",
      commitMessage: "feat: implement Actions tab with workflow management",
      commitSha: "a3f5d2c",
      actor: "alice",
      startTime: "2024-01-25T10:30:00Z",
      duration: "2m 34s",
    },
    {
      id: "run-2",
      workflowName: "Deploy to Production",
      status: "running",
      branch: "main",
      commitMessage: "fix: resolve authentication issue in API endpoints",
      commitSha: "b7e9f1a",
      actor: "bob",
      startTime: "2024-01-25T10:25:00Z",
    },
    {
      id: "run-3",
      workflowName: "Run Tests",
      status: "failed",
      branch: "feature/new-ui",
      commitMessage: "chore: update dependencies to latest versions",
      commitSha: "c2d4e8b",
      actor: "charlie",
      startTime: "2024-01-25T10:20:00Z",
      duration: "1m 12s",
    },
    {
      id: "run-4",
      workflowName: "Lint and Format",
      status: "succeeded",
      branch: "main",
      commitMessage: "docs: update README with new setup instructions",
      commitSha: "d9a1c3f",
      actor: "alice",
      startTime: "2024-01-25T10:15:00Z",
      duration: "45s",
    },
    {
      id: "run-5",
      workflowName: "CI",
      status: "cancelled",
      branch: "feature/experimental",
      commitMessage: "refactor: restructure project layout for better organization",
      commitSha: "e5b7d2a",
      actor: "david",
      startTime: "2024-01-25T10:10:00Z",
      duration: "30s",
    },
    {
      id: "run-6",
      workflowName: "Security Scan",
      status: "queued",
      branch: "main",
      commitMessage: "security: upgrade vulnerable packages",
      commitSha: "f3c9e1b",
      actor: "bob",
      startTime: "2024-01-25T10:05:00Z",
    },
    {
      id: "run-7",
      workflowName: "Deploy to Production",
      status: "succeeded",
      branch: "main",
      commitMessage: "feat: add new analytics dashboard",
      commitSha: "g8d2a5c",
      actor: "alice",
      startTime: "2024-01-25T09:50:00Z",
      duration: "5m 23s",
    },
    {
      id: "run-8",
      workflowName: "Run Tests",
      status: "timed_out",
      branch: "feature/performance",
      commitMessage: "perf: optimize database queries for better performance",
      commitSha: "h1e4b9d",
      actor: "charlie",
      startTime: "2024-01-25T09:30:00Z",
      duration: "10m 0s",
    },
  ];

  const filteredRuns = selectedWorkflow === "all"
    ? workflowRuns
    : workflowRuns.filter((run) => run.workflowName === workflows.find((w) => w.id === selectedWorkflow)?.name);

  return (
    <div className="actions-tab-content">
      <div className="actions-tab-layout">
        <aside className="workflow-list">
          <div className="workflow-list-header">
            <h3>Workflows</h3>
            <Button variant="primary" size="small">
              <Plus size={14} />
              New
            </Button>
          </div>
          <div className="workflow-list-content">
            <div
              className={`workflow-list-item ${selectedWorkflow === "all" ? "active" : ""}`}
              onClick={() => setSelectedWorkflow("all")}
            >
              <div className="workflow-list-item-icon">
                <PlayCircle size={16} />
              </div>
              <div className="workflow-list-item-info">
                <div className="workflow-list-item-name">All workflows</div>
                <div className="workflow-list-item-count">{workflowRuns.length} runs</div>
              </div>
            </div>
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                className={`workflow-list-item ${selectedWorkflow === workflow.id ? "active" : ""}`}
                onClick={() => setSelectedWorkflow(workflow.id)}
              >
                <div className="workflow-list-item-icon">
                  <PlayCircle size={16} />
                </div>
                <div className="workflow-list-item-info">
                  <div className="workflow-list-item-name">
                    {workflow.name}
                    {workflow.status === "disabled" && <span className="workflow-disabled-badge">Disabled</span>}
                  </div>
                  <div className="workflow-list-item-count">{workflow.runsCount} runs</div>
                </div>
              </div>
            ))}
          </div>
        </aside>
        <main className="workflow-runs">
          <div className="workflow-runs-header">
            <h2>Workflow runs</h2>
          </div>
          <div className="workflow-runs-list">
            {filteredRuns.map((run) => (
              <div key={run.id} className="workflow-run-item">
                <div className="workflow-run-status">
                  <WorkflowRunStatusIcon status={run.status} />
                </div>
                <div className="workflow-run-details">
                  <div className="workflow-run-header">
                    <span className="workflow-run-name">{run.workflowName}</span>
                    <span className="workflow-run-id">#{run.id}</span>
                  </div>
                  <div className="workflow-run-commit">
                    <strong>{run.commitMessage}</strong>
                  </div>
                  <div className="workflow-run-meta">
                    <span className="workflow-run-branch">
                      <GitBranch size={12} />
                      {run.branch}
                    </span>
                    <span className="workflow-run-sha">{run.commitSha}</span>
                    <span className="workflow-run-actor">by {run.actor}</span>
                    <span className="workflow-run-time">{formatTimeAgo(run.startTime)}</span>
                    {run.duration && <span className="workflow-run-duration">{run.duration}</span>}
                  </div>
                </div>
                <div className="workflow-run-actions">
                  <Button variant="secondary" size="small">View</Button>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

function WorkflowRunStatusIcon({ status }: { status: WorkflowRunStatus }) {
  switch (status) {
    case "queued":
      return <Clock size={16} className="status-icon status-queued" />;
    case "running":
      return <Loader size={16} className="status-icon status-running" />;
    case "succeeded":
      return <CheckCircle2 size={16} className="status-icon status-succeeded" />;
    case "failed":
      return <XCircle size={16} className="status-icon status-failed" />;
    case "cancelled":
      return <StopCircle size={16} className="status-icon status-cancelled" />;
    case "timed_out":
      return <Timer size={16} className="status-icon status-timed-out" />;
    default:
      return <Clock size={16} className="status-icon" />;
  }
}

function formatTimeAgo(isoTime: string): string {
  const date = new Date(isoTime);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

type SettingsSection = "general" | "access" | "branches" | "tags" | "notifications" | "webhooks" | "moderation" | "rulesets" | "actions" | "environments" | "secrets" | "copilot" | "pages" | "security";

interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  icon: React.ReactNode;
}

function SettingsTabContent() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  const settingsNavItems: SettingsNavItem[] = [
    { id: "general", label: "General", icon: <Settings size={16} /> },
    { id: "access", label: "Access", icon: <Users size={16} /> },
    { id: "branches", label: "Branches", icon: <GitBranch size={16} /> },
    { id: "tags", label: "Tags", icon: <Tag size={16} /> },
    { id: "notifications", label: "Notifications", icon: <Bell size={16} /> },
    { id: "webhooks", label: "Webhooks", icon: <Webhook size={16} /> },
    { id: "moderation", label: "Moderation", icon: <Shield size={16} /> },
    { id: "rulesets", label: "Rulesets", icon: <Scale size={16} /> },
    { id: "actions", label: "Actions", icon: <PlayCircle size={16} /> },
    { id: "environments", label: "Environments", icon: <Cloud size={16} /> },
    { id: "secrets", label: "Secrets", icon: <Key size={16} /> },
    { id: "copilot", label: "Copilot", icon: <Bot size={16} /> },
    { id: "pages", label: "Pages", icon: <FileText size={16} /> },
    { id: "security", label: "Security", icon: <Lock size={16} /> },
  ];

  return (
    <div className="settings-tab-content">
      <div className="settings-tab-layout">
        <aside className="settings-sidebar">
          <h3>Repository Settings</h3>
          <nav className="settings-nav">
            {settingsNavItems.map((item) => (
              <Button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`settings-nav-item ${activeSection === item.id ? "active" : ""}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Button>
            ))}
          </nav>
        </aside>
        <main className="settings-content">
          {activeSection === "general" && <GeneralSettingsPage />}
          {activeSection === "access" && <AccessSettingsPage />}
          {activeSection === "branches" && <BranchesSettingsPage />}
          {activeSection === "tags" && <TagsSettingsPage />}
          {activeSection === "notifications" && <NotificationsSettingsPage />}
          {activeSection === "webhooks" && <WebhooksSettingsPage />}
          {activeSection === "moderation" && <ModerationSettingsPage />}
          {activeSection === "rulesets" && <RulesetsSettingsPage />}
          {activeSection === "actions" && <ActionsSettingsPage />}
          {activeSection === "environments" && <EnvironmentsSettingsPage />}
          {activeSection === "secrets" && <SecretsSettingsPage />}
          {activeSection === "copilot" && <CopilotSettingsPage />}
          {activeSection === "pages" && <PagesSettingsPage />}
          {activeSection === "security" && <SecuritySettingsPage />}
        </main>
      </div>
    </div>
  );
}

function GeneralSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">General</h1>
        <p className="settings-page-description">Manage repository settings including name, description, and visibility</p>
      </header>
      <div className="settings-section">
        <div className="settings-field-readonly">
          <label className="settings-field-readonly-label">Repository Name</label>
          <div className="settings-field-readonly-value">agentforge-api</div>
          <p className="settings-field-description">The name of this repository</p>
        </div>
        <div className="settings-field-readonly">
          <label className="settings-field-readonly-label">Description</label>
          <div className="settings-field-readonly-value">AgentForge API Server - Core backend services for the AgentForge platform</div>
        </div>
        <div className="settings-field-readonly">
          <label className="settings-field-readonly-label">Visibility</label>
          <div className="settings-field-readonly-value">Public</div>
          <p className="settings-field-description">This repository is visible to everyone</p>
        </div>
      </div>
    </div>
  );
}

function AccessSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">Access</h1>
        <p className="settings-page-description">Manage who has access to this repository</p>
      </header>
      <div className="settings-placeholder">Access management coming soon</div>
    </div>
  );
}

function BranchesSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">Branches</h1>
        <p className="settings-page-description">Manage branch protection rules and default branch</p>
      </header>
      <div className="settings-section">
        <h3>Default Branch</h3>
        <div className="settings-field-readonly">
          <label className="settings-field-readonly-label">Default Branch</label>
          <div className="settings-field-readonly-value">main</div>
          <p className="settings-field-description">The default branch for pull requests and code commits</p>
        </div>
      </div>
      <div className="settings-section">
        <h3>Branch Protection Rules</h3>
        <div className="settings-placeholder">No branch protection rules configured</div>
      </div>
    </div>
  );
}

function TagsSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">Tags</h1>
        <p className="settings-page-description">Manage tag protection rules</p>
      </header>
      <div className="settings-placeholder">Tag management coming soon</div>
    </div>
  );
}

function NotificationsSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">Notifications</h1>
        <p className="settings-page-description">Configure notification settings for this repository</p>
      </header>
      <div className="settings-placeholder">Notification settings coming soon</div>
    </div>
  );
}

function WebhooksSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">Webhooks</h1>
        <p className="settings-page-description">Configure webhooks to receive HTTP POST notifications for repository events</p>
      </header>
      <div className="settings-placeholder">No webhooks configured</div>
    </div>
  );
}

function ModerationSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">Moderation</h1>
        <p className="settings-page-description">Manage moderation settings for issues and discussions</p>
      </header>
      <div className="settings-placeholder">Moderation settings coming soon</div>
    </div>
  );
}

function RulesetsSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">Rulesets</h1>
        <p className="settings-page-description">Create rulesets to control how people can interact with your repository</p>
      </header>
      <div className="settings-placeholder">No rulesets configured</div>
    </div>
  );
}

function ActionsSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">Actions</h1>
        <p className="settings-page-description">Configure GitHub Actions permissions and settings</p>
      </header>
      <div className="settings-section">
        <h3>Actions Permissions</h3>
        <div className="settings-field-readonly">
          <label className="settings-field-readonly-label">Actions Permissions</label>
          <div className="settings-field-readonly-value">Allow all actions and reusable workflows</div>
          <p className="settings-field-description">All actions and reusable workflows can be used in this repository</p>
        </div>
      </div>
      <div className="settings-section">
        <h3>Workflow Permissions</h3>
        <div className="settings-field-readonly">
          <label className="settings-field-readonly-label">Default Workflow Permissions</label>
          <div className="settings-field-readonly-value">Read repository contents and packages permissions</div>
        </div>
      </div>
    </div>
  );
}

function EnvironmentsSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">Environments</h1>
        <p className="settings-page-description">Configure deployment environments for this repository</p>
      </header>
      <div className="settings-placeholder">No environments configured</div>
    </div>
  );
}

function SecretsSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">Secrets and Variables</h1>
        <p className="settings-page-description">Manage secrets and variables for Actions workflows</p>
      </header>
      <div className="settings-section">
        <h3>Repository Secrets</h3>
        <div className="settings-placeholder">No secrets configured</div>
      </div>
      <div className="settings-section">
        <h3>Repository Variables</h3>
        <div className="settings-placeholder">No variables configured</div>
      </div>
    </div>
  );
}

function CopilotSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">Copilot</h1>
        <p className="settings-page-description">Configure GitHub Copilot settings for this repository</p>
      </header>
      <div className="settings-placeholder">Copilot settings coming soon</div>
    </div>
  );
}

function PagesSettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">Pages</h1>
        <p className="settings-page-description">Configure GitHub Pages for this repository</p>
      </header>
      <div className="settings-placeholder">GitHub Pages is not enabled for this repository</div>
    </div>
  );
}

function SecuritySettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">Security</h1>
        <p className="settings-page-description">Manage security settings and vulnerability alerts</p>
      </header>
      <div className="settings-section">
        <h3>Vulnerability Alerts</h3>
        <div className="settings-field-readonly">
          <label className="settings-field-readonly-label">Dependabot Alerts</label>
          <div className="settings-field-readonly-value">Enabled</div>
          <p className="settings-field-description">Receive alerts for vulnerable dependencies</p>
        </div>
      </div>
      <div className="settings-section">
        <h3>Code Scanning</h3>
        <div className="settings-placeholder">Code scanning is not enabled</div>
      </div>
    </div>
  );
}

interface RepositoryMember {
  id: string;
  username: string;
  email: string;
  role: "Owner" | "Member" | "External Collaborator";
  avatar: string;
  lastActive: string;
  type: "organization" | "external" | "pending";
}

interface MembersTabContentProps {
  organization: OrganizationSummary;
}

function MembersTabContent({ organization }: MembersTabContentProps) {
  const [selectedFilter, setSelectedFilter] = useState<"all" | "organization" | "external" | "pending">("all");

  const isAdmin = organization.role === "owner" || organization.role === "admin";

  if (!isAdmin) {
    return (
      <div className="members-tab-content">
        <div className="members-access-denied">
          <Shield size={48} />
          <h3>Access Restricted</h3>
          <p>Only repository administrators can view the members list.</p>
        </div>
      </div>
    );
  }

  const mockMembers: RepositoryMember[] = [
    {
      id: "1",
      username: "alice-smith",
      email: "alice@agentforge.dev",
      role: "Owner",
      avatar: "AS",
      lastActive: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      type: "organization",
    },
    {
      id: "2",
      username: "bob-jones",
      email: "bob@agentforge.dev",
      role: "Member",
      avatar: "BJ",
      lastActive: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      type: "organization",
    },
    {
      id: "3",
      username: "carol-white",
      email: "carol@agentforge.dev",
      role: "Member",
      avatar: "CW",
      lastActive: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      type: "organization",
    },
    {
      id: "4",
      username: "david-brown",
      email: "david@external.com",
      role: "External Collaborator",
      avatar: "DB",
      lastActive: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      type: "external",
    },
    {
      id: "5",
      username: "eve-davis",
      email: "eve@external.com",
      role: "External Collaborator",
      avatar: "ED",
      lastActive: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      type: "external",
    },
    {
      id: "6",
      username: "frank-miller",
      email: "frank@agentforge.dev",
      role: "Member",
      avatar: "FM",
      lastActive: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
      type: "organization",
    },
  ];

  const filteredMembers = mockMembers.filter((member) => {
    if (selectedFilter === "all") return true;
    if (selectedFilter === "organization") return member.type === "organization";
    if (selectedFilter === "external") return member.type === "external";
    if (selectedFilter === "pending") return member.type === "pending";
    return true;
  });

  const columns: DataTableColumn<RepositoryMember>[] = [
    {
      key: "username",
      title: "Member",
      render: (_, member) => (
        <div className="member-cell">
          <div className="member-avatar">{member.avatar}</div>
          <div className="member-info">
            <div className="member-name">{member.username}</div>
            <div className="member-email">{member.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      title: "Role",
      render: (_, member) => (
        <span className={`member-role-badge member-role-${member.role.toLowerCase().replace(" ", "-")}`}>
          {member.role}
        </span>
      ),
    },
    {
      key: "lastActive",
      title: "Last Active",
      render: (_, member) => {
        const date = new Date(member.lastActive);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return "Today";
        if (diffDays === 1) return "Yesterday";
        if (diffDays < 7) return `${diffDays} days ago`;
        return date.toLocaleDateString();
      },
    },
  ];

  const orgMembersCount = mockMembers.filter(m => m.type === "organization").length;
  const externalCount = mockMembers.filter(m => m.type === "external").length;
  const pendingCount = mockMembers.filter(m => m.type === "pending").length;

  return (
    <div className="members-tab-content">
      <div className="members-tab-layout">
        <aside className="members-sidebar">
          <h3>Filters</h3>
          <nav className="members-filter-nav">
            <Button
              onClick={() => setSelectedFilter("all")}
              className={`members-filter-item ${selectedFilter === "all" ? "active" : ""}`}
            >
              <Users size={14} />
              <span>All Members</span>
              <span className="members-filter-count">{mockMembers.length}</span>
            </Button>
            <Button
              onClick={() => setSelectedFilter("organization")}
              className={`members-filter-item ${selectedFilter === "organization" ? "active" : ""}`}
            >
              <User size={14} />
              <span>Organization Members</span>
              <span className="members-filter-count">{orgMembersCount}</span>
            </Button>
            <Button
              onClick={() => setSelectedFilter("external")}
              className={`members-filter-item ${selectedFilter === "external" ? "active" : ""}`}
            >
              <Bot size={14} />
              <span>External Collaborators</span>
              <span className="members-filter-count">{externalCount}</span>
            </Button>
            <Button
              onClick={() => setSelectedFilter("pending")}
              className={`members-filter-item ${selectedFilter === "pending" ? "active" : ""}`}
            >
              <Clock size={14} />
              <span>Pending Invitations</span>
              <span className="members-filter-count">{pendingCount}</span>
            </Button>
          </nav>
        </aside>
        <main className="members-list">
          <div className="members-header">
            <h2>Repository Members</h2>
            <Button variant="primary" size="small">
              <Plus size={16} />
              Invite Member
            </Button>
          </div>
          <DataTable
            columns={columns}
            data={filteredMembers}
            rowKey="id"
            emptyText="No members found"
            showColumnVisibility={false}
          />
        </main>
      </div>
    </div>
  );
}

