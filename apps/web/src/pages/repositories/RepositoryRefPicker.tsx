import { useId, useState } from "react";
import { Check, ChevronDown, GitBranch, Search, Tag, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RepositoryPreviewRef, RepositoryPreviewRefs } from "../../shared/api/identity";
import { Button, Input, Popover, Tabs } from "../../shared/ui";
import "./RepositoryRefPicker.css";

type Props = {
  refs: Pick<RepositoryPreviewRefs, "items" | "default_branch">;
  selected?: RepositoryPreviewRef;
  onSelect: (ref: RepositoryPreviewRef) => void;
};

export function RepositoryRefPicker({ refs, selected, onSelect }: Props) {
  const { t } = useTranslation("repositories");
  const Icon = selected?.kind === "tag" ? Tag : GitBranch;

  return <div className="repo-ref-picker">
    <Popover ariaLabel={t("refPicker.title")} triggerClassName="af-button repo-ref-picker__trigger" trigger={<>
      <Icon size={16} aria-hidden="true"/>
      <span title={selected?.name}>{selected?.name ?? t("preview.refAriaLabel")}</span>
      <ChevronDown size={14} aria-hidden="true"/>
    </>}>
      {dismiss => <RefPickerPanel refs={refs} selected={selected} dismiss={dismiss} onSelect={onSelect}/>}
    </Popover>
  </div>;
}

function RefPickerPanel({ refs, selected, dismiss, onSelect }: Props & { dismiss: () => void }) {
  const { t } = useTranslation("repositories");
  const id = useId();
  const [kind, setKind] = useState<RepositoryPreviewRef["kind"]>(selected?.kind ?? "branch");
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const matches = refs.items.filter(ref => ref.kind === kind && ref.name.toLowerCase().includes(search));

  return <>
    <h3 className="repo-ref-picker__title">{t("refPicker.title")}</h3>
    <div className="repo-ref-picker__search">
      <Search size={16} aria-hidden="true"/>
      <Input type="search" aria-label={t("refPicker.search")} placeholder={t("refPicker.search")}
        value={query} onChange={event => setQuery(event.target.value)}/>
    </div>
    <Button variant="ghost" size="small" className="repo-ref-picker__close" aria-label={t("preview.close")} onClick={dismiss}>
      <X size={16} aria-hidden="true"/>
    </Button>
    <Tabs id={id} className="repo-ref-picker__tabs" ariaLabel={t("preview.refAriaLabel")} value={kind}
      onChange={value => setKind(value === "tag" ? "tag" : "branch")}
      items={[{ key: "branch", label: t("refPicker.branches") }, { key: "tag", label: t("refPicker.tags") }]}/>
    <div id={`${id}-panel`} className="repo-ref-picker__results" role="tabpanel" aria-labelledby={`${id}-tab-${kind}`}>
      {matches.length === 0 ? <p role="status">{t("refPicker.empty")}</p> : <ul>
        {matches.map(ref => <li key={ref.name}>
          <Button variant="ghost" size="small" aria-current={ref.name === selected?.name && ref.kind === selected.kind ? "true" : undefined}
            onClick={() => { dismiss(); onSelect(ref); }}>
            <span>{ref.name}</span>
            {ref.kind === "branch" && ref.name === refs.default_branch && <small>{t("refPicker.defaultBranch")}</small>}
            <Check className="repo-ref-picker__check" size={16} aria-hidden="true"/>
          </Button>
        </li>)}
      </ul>}
    </div>
  </>;
}
