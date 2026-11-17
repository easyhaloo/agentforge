import { Activity, ArrowDownUp, Boxes, BrainCircuit, CheckCircle2, Code2, GitBranch, GitCommitHorizontal, GitPullRequest, LayoutDashboard, LockKeyhole, PanelsTopLeft, Settings, ShieldCheck, Terminal, Workflow, Zap, Users } from "lucide-react";

export const groups = [
  { label: "WORKSPACE", items: [["Overview", LayoutDashboard], ["Projects", Boxes], ["Repositories", Code2], ["Changesets", GitCommitHorizontal], ["Workspaces", Terminal]] },
  { label: "COORDINATION", items: [["Trails", Workflow], ["Stacks", GitBranch], ["Review", GitPullRequest], ["Eval", CheckCircle2], ["Self-healing", Activity]] },
  { label: "INTELLIGENCE", items: [["Memory", BrainCircuit], ["CI / CD", Zap]] },
  { label: "DEVELOPER", items: [["UI Components", PanelsTopLeft]] },
  { label: "CONTROL PLANE", items: [["Organization", Users], ["Security", ShieldCheck], ["Governance", LockKeyhole], ["Cost & Usage", ArrowDownUp], ["Settings", Settings]] }
] as const;
export const descriptions: Record<string,string> = {
  Overview:"A live map of changes, verification and delivery across your engineering system.",
  Projects:"Organize repositories, teams and delivery boundaries.",
  Repositories:"Git-compatible repositories backed by a canonical object graph.",
  Changesets:"Reviewable, revisioned units of change — distinct from Git commits.",
  Workspaces:"Isolated environments for agents and human contributors.",
  Trails:"Cross-repository delivery goals with traceable evidence.",
  Stacks:"Compose dependent changesets into a navigable change graph.",
  Review:"Human decisions grounded in revision-specific evidence.",
  Eval:"Evaluate changes against quality, policy and product expectations.",
  "Self-healing":"Bounded repair loops that produce new revisions and re-run validation.",
  Memory:"Reusable engineering knowledge linked to sessions, code and decisions.",
  "CI / CD":"Pipelines, checks and release orchestration.",
  Organization:"Manage organization members, invitations, roles and access history.",
  Security:"Identity, secrets, supply-chain and runtime boundaries.",
  Governance:"Policies, approvals and organization-wide controls.",
  "Cost & Usage":"Understand agent, model and compute consumption.",
  Settings:"Configure your organization and developer experience.",
  "UI Components":"Explore the shared component system, interaction patterns and design tokens."
};