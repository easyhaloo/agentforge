import { useNotification } from "../shared/ui";

/** The success toast every page uses for completed and demo actions. */
export function useNotify() {
  const { notify } = useNotification();
  return (message: string) => {
    notify({ status: "success", message, duration: 2600 });
  };
}
