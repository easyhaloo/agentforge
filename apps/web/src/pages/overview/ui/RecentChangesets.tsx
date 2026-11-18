import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown, Code2 } from "lucide-react";
import { CURRENT_ORGANIZATION_HANDLE, orgPath } from "../../../shared/routing";
import { Button, DataTable, Empty, Input, Select } from "../../../shared/ui";
import { recentChangesetSeeds } from "../data/overviewData";
import type { CreatedChangeset, OverviewChangesetRow } from "../model/types";

type Props = {
  created: CreatedChangeset[];
  onNotify: (message: string) => void;
  onSelect: (changesetId: string) => void;
  selectedId: string;
};

const statuses = ["All", "Ready for review", "Evaluating", "Changes requested", "Merged", "Draft"];

function statusClass(status: string): string {
  if (status === "Merged") return "success";
  if (status === "Evaluating") return "info";
  if (status === "Draft") return "muted";
  if (status === "Changes requested") return "danger";
  return "warning";
}

export function RecentChangesets({ created, onNotify, onSelect, selectedId }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const rows = useMemo<OverviewChangesetRow[]>(() => [
    ...created.map(({ id, title }) => ({
      id,
      title,
      project: "agentforge-demo",
      status: "Draft",
      updated: "Just now",
    })),
    ...recentChangesetSeeds,
  ].filter((row) =>
    (filter === "All" || row.status === filter) &&
    [row.id, row.title, row.project, row.status].join(" ").toLowerCase().includes(query.toLowerCase())
  ), [created, filter, query]);

  return (
    <section className="card table-panel">
      <div className="panel-head table-title">
        <div>
          <h3>Recent changesets</h3>
          <p>Track the latest work moving through verification.</p>
        </div>
        <Button variant="ghost" size="small" onClick={() => navigate(orgPath(CURRENT_ORGANIZATION_HANDLE, "changesets"))}>
          View all <ArrowRight size={14} />
        </Button>
      </div>
      <div className="table-tools">
        <div className="inline-search">
          <Input
            aria-label="Search overview changesets"
            placeholder="Search overview..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Select
          aria-label="Filter changesets by status"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          options={statuses.map((status) => ({ label: status === "All" ? "All statuses" : status, value: status }))}
        />
        <Button size="small" onClick={() => { setQuery(""); setFilter("All"); }}>
          More filters <ChevronDown size={13} />
        </Button>
      </div>
      <div className="table-wrap">
        <DataTable
          className="recent-changesets-table"
          columns={[
            { key: "id", title: "IDENTIFIER", render: (_, row) => <span className="mono">{row.id}</span> },
            { key: "title", title: "NAME", render: (_, row) => <b>{row.title}</b> },
            { key: "project", title: "PROJECT", render: (_, row) => <span className="repo-tag"><Code2 size={12}/>{row.project}</span> },
            { key: "status", title: "STATUS", render: (_, row) => <span className={`status ${statusClass(row.status)}`}><i/>{row.status}</span> },
            { key: "updated", title: "UPDATED", render: (_, row) => <span className="muted-text">{row.updated}</span> },
            { key: "actions", title: "", render: (_, row) => <Button variant="ghost" size="small" className="more" type="button" aria-label={`More actions for ${row.id}`} onClick={(event) => { event.stopPropagation(); onNotify("More actions are available in the full product."); }}>···</Button> },
          ]}
          data={rows}
          rowKey="id"
          showColumnVisibility={false}
          onRowClick={(row) => onSelect(row.id)}
          rowClassName={(row) => selectedId === row.id ? "selected-row" : ""}
          emptyText={<Empty title="No matching changesets" description="Try another search term or reset the status filter."/>}
        />
      </div>
    </section>
  );
}
