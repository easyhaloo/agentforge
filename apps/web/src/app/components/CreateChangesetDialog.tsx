import { useRef, useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { Form, Input, Modal, Select, TextArea } from "../../shared/ui";

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
    title="Create changeset"
    onCancel={onClose}
    onOk={create}
    okText="Create resource"
    width={560}
  >
    <div className="eyebrow">NEW RESOURCE</div>
    <Form onSubmit={submit}>
      <Input
        ref={titleInputRef}
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
  </Modal>;
}
