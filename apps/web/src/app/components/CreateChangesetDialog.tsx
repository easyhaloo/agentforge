import { useRef, useState, type FormEvent } from "react";
import { Plus, Sparkles } from "lucide-react";
import { Button, Form, Input, Modal, Select, TextArea } from "../../shared/ui";

type Props = { open: boolean; onClose: () => void; onCreate: (title: string) => void };

const projectOptions = [
  { label: "agentforge-core", value: "agentforge-core" },
  { label: "web-platform", value: "web-platform" },
  { label: "event-service", value: "event-service" },
];

export function CreateChangesetDialog({ open, onClose, onCreate }: Props) {
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("agentforge-core");
  const [description, setDescription] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    onCreate(value);
    setTitle("");
    setProject("agentforge-core");
    setDescription("");
  };

  return <>
    <Modal
      open={open}
      title="Create changeset"
      onCancel={onClose}
      onOk={() => formRef.current?.requestSubmit()}
      okText="Create resource"
      width={560}
    >
      <div className="eyebrow">NEW RESOURCE</div>
      <Form ref={formRef} onSubmit={submit}>
        <Input
          label="Title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Describe the change or goal"
        />
        <Select
          label="Project"
          options={projectOptions}
          value={project}
          onChange={(event) => setProject(event.target.value)}
        />
        <TextArea
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What should this change accomplish?"
          rows={3}
        />
      </Form>
      <p className="mock-note"><Sparkles size={13} /> This creates a local demo record only. No Git or backend operation is performed.</p>
    </Modal>
  </>;
}
