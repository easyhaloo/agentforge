import { useRef, useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Input, Modal, Select, TextArea } from "../../shared/ui";

type Props = { open: boolean; onClose: () => void; onCreate: (title: string) => void };

const projectOptions = [
  { label: "agentforge-core", value: "agentforge-core" },
  { label: "web-platform", value: "web-platform" },
  { label: "event-service", value: "event-service" },
];

export function CreateChangesetDialog({ open, onClose, onCreate }: Props) {
  const { t } = useTranslation("changesets");
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("agentforge-core");
  const [description, setDescription] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const create = () => {
    const value = title.trim();
    if (!value) {
      titleInputRef.current?.focus();
      return;
    }
    onCreate(value);
    setTitle("");
    setProject("agentforge-core");
    setDescription("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create();
  };

  return <Modal
    open={open}
    title={t("create.title")}
    onCancel={onClose}
    onOk={create}
    okText={t("create.okButton")}
    width={560}
  >
    <div className="eyebrow">{t("create.newResourceEyebrow")}</div>
    <Form onSubmit={submit}>
      <Input
        ref={titleInputRef}
        label={t("create.titleLabel")}
        required
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={t("create.titlePlaceholder")}
      />
      <Select
        label={t("create.projectLabel")}
        options={projectOptions}
        value={project}
        onChange={(event) => setProject(event.target.value)}
      />
      <TextArea
        label={t("create.descriptionLabel")}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder={t("create.descriptionPlaceholder")}
        rows={3}
      />
    </Form>
    <p className="mock-note"><Sparkles size={13} /> {t("create.mockNote")}</p>
  </Modal>;
}
