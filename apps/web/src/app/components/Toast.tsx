import { CheckCircle2 } from "lucide-react";

export function Toast({ message }: { message: string }) {
  return message ? <div className="toast"><CheckCircle2 size={16}/>{message}</div> : null;
}
