import { useEffect, useState } from "react";

export function useSettingsList<T>(read: () => Promise<T[]>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    read().then(
      (data) => { if (active) setItems(data); },
      () => { if (active) setItems(null); },
    ).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [read, attempt]);

  function refresh() {
    setLoading(true);
    setAttempt((n) => n + 1);
  }
  return { items, loading, refresh };
}
