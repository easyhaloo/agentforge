import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown, Code2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CURRENT_ORGANIZATION_HANDLE, orgPath } from "../../../shared/routing";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { Button, DataTable, Empty, Input, Select } from "../../../shared/ui";
import { recentChangesetSeeds } from "../data/overviewData";
import type { CreatedChangeset, OverviewChangesetRow } from "../model/types";

type Props = {
  created: CreatedChangeset[];
  onNotify: (message: string) => void;
  onSelect: (changesetId: string) => void;
  selectedId: string;
};

function statusClass(status: string): string {
  if (status === "Merged") return "success";
  if (status === "Evaluating") return "info";
  if (status === "Draft") return "muted";
  if (status === "Changes requested") return "danger";
  return "warning";
}

export function RecentChangesets({ created, onNotify, onSelect, selectedId }: Props) {
  const { t } = useTranslation("overview");
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  // The filter holds the status the API reports, so the row data and the filter never
  // depend on the language the labels are shown in.
  const [filter, setFilter] = useState("");

  const statusLabels = useMemo<Record<string, string>>(() => ({
    "Ready for review": t("recentChangesets.statuses.readyForReview"),
    "Evaluating": t("recentChangesets.statuses.evaluating"),
    "Changes requested": t("recentChangesets.statuses.changesRequested"),
    "Merged": t("recentChangesets.statuses.merged"),
    "Draft": t("recentChangesets.statuses.draft"),
  }), [t]);

  const statusFilters = [
    { value: "", label: t("recentChangesets.statuses.all") },
    { value: "Ready for review", label: statusLabels["Ready for review"] },
    { value: "Evaluating", label: statusLabels["Evaluating"] },
    { value: "Changes requested", label: statusLabels["Changes requested"] },
    { value: "Merged", label: statusLabels["Merged"] },
    { value: "Draft", label: statusLabels["Draft"] },
  ];

  const rows = useMemo<OverviewChangesetRow[]>(() => [
    ...created.map(({ id, title }) => ({
      id,
      title,
      project: "agentforge-demo",
      status: "Draft",
      // A changeset that was just created has no timestamp yet.
      updatedAt: "",
    })),
    ...recentChangesetSeeds,
  ].filter((row) =>
    (filter === "" || row.status === filter) &&
    [row.id, row.title, row.project, row.status, statusLabels[row.status] ?? ""]
      .join(" ").toLowerCase().includes(query.toLowerCase())
  ), [created, filter, query, statusLabels]);

  return (
    <section className="card table-panel">
      <div className="panel-head table-title">
        <div>
          <h3>{t("recentChangesets.title")}</h3>
          <p>{t("recentChangesets.description")}</p>
        </div>
        <Button variant="ghost" size="small" onClick={() => navigate(orgPath(CURRENT_ORGANIZATION_HANDLE, "changesets"))}>
          {t("recentChangesets.viewAll")} <ArrowRight size={14} />
        </Button>
      </div>
      <div className="table-tools">
        <div className="inline-search">
          <Input
            aria-label={t("recentChangesets.searchAriaLabel")}
            placeholder={t("recentChangesets.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Select
          aria-label={t("recentChangesets.filterAriaLabel")}
          placeholder={t("recentChangesets.allStatuses")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          options={statusFilters}
        />
        <Button size="small" onClick={() => { setQuery(""); setFilter(""); }}>
          {t("recentChangesets.moreFilters")} <ChevronDown size={13} />
        </Button>
      </div>
      <div className="table-wrap">
        <DataTable
          className="recent-changesets-table"
          columns={[
            { key: "id", title: t("recentChangesets.columns.identifier"), render: (_, row) => <span className="mono">{row.id}</span> },
            { key: "title", title: t("recentChangesets.columns.name"), render: (_, row) => <b>{row.title}</b> },
            { key: "project", title: t("recentChangesets.columns.project"), render: (_, row) => <span className="repo-tag"><Code2 size={12}/>{row.project}</span> },
            { key: "status", title: t("recentChangesets.columns.status"), render: (_, row) => <span className={`status ${statusClass(row.status)}`}><i/>{statusLabels[row.status] ?? row.status}</span> },
            { key: "updatedAt", title: t("recentChangesets.columns.updated"), render: (_, row) => <span className="muted-text">{row.updatedAt ? formatRelativeTime(row.updatedAt) : t("recentChangesets.justNow")}</span> },
            { key: "actions", title: "", render: (_, row) => <Button variant="ghost" size="small" className="more" type="button" aria-label={t("recentChangesets.moreActionsAriaLabel", { id: row.id })} onClick={(event) => { event.stopPropagation(); onNotify(t("recentChangesets.moreActionsNotice")); }}>···</Button> },
          ]}
          data={rows}
          rowKey="id"
          showColumnVisibility={false}
          onRowClick={(row) => onSelect(row.id)}
          rowClassName={(row) => selectedId === row.id ? "selected-row" : ""}
          emptyText={<Empty title={t("recentChangesets.empty.title")} description={t("recentChangesets.empty.description")}/>}
        />
      </div>
    </section>
  );
}
