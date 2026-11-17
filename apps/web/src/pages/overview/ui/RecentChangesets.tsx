import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Code2 } from "lucide-react";
import { Button, Empty, Input, Select } from "../../../shared/ui";
import { recentChangesetSeeds } from "../data/overviewData";
import type { CreatedChangeset, OverviewChangesetRow } from "../model/types";

type Props = {
  created: CreatedChangeset[];
  onNavigate: (page: string) => void;
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

export function RecentChangesets({ created, onNavigate, onNotify, onSelect, selectedId }: Props) {
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
        <Button variant="ghost" size="small" onClick={() => onNavigate("Changesets")}>
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
        <table>
          <thead>
            <tr><th>IDENTIFIER</th><th>NAME</th><th>PROJECT</th><th>STATUS</th><th>UPDATED</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} onClick={() => onSelect(row.id)} className={selectedId === row.id ? "selected-row" : ""}>
                <td><span className="mono">{row.id}</span></td>
                <td><b>{row.title}</b></td>
                <td><span className="repo-tag"><Code2 size={12} />{row.project}</span></td>
                <td><span className={`status ${statusClass(row.status)}`}><i />{row.status}</span></td>
                <td className="muted-text">{row.updated}</td>
                <td>
                  <Button variant="ghost" size="small" className="more" type="button" aria-label={`More actions for ${row.id}`} onClick={(event) => {
                    event.stopPropagation();
                    onNotify("More actions are available in the full product.");
                  }}>···</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty title="No matching changesets" description="Try another search term or reset the status filter." />}
      </div>
    </section>
  );
}
