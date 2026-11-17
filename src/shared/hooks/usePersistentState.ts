import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

type StorageReader = Pick<Storage, "getItem">;

export function readPersistentValue<T>(
  key: string,
  initialValue: T,
  storage?: StorageReader,
): T {
  try {
    const source = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    const stored = source?.getItem(key);
    return stored === null || stored === undefined ? initialValue : (JSON.parse(stored) as T);
  } catch {
    return initialValue;
  }
}

export function usePersistentState<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(() => ({
    key,
    value: readPersistentValue(key, initialValue),
  }));

  let value = state.value;
  if (state.key !== key) {
    value = readPersistentValue(key, initialValue);
    setState({ key, value });
  }

  const setValue: Dispatch<SetStateAction<T>> = (nextValue) => {
    setState((current) => {
      const currentValue = current.key === key
        ? current.value
        : readPersistentValue(key, initialValue);
      return {
        key,
        value: typeof nextValue === "function"
          ? (nextValue as (previous: T) => T)(currentValue)
          : nextValue,
      };
    });
  };

  useEffect(() => {
    if (state.key !== key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state.value));
    } catch {
      // Keep the prototype usable when storage is unavailable or full.
    }
  }, [key, state]);
  
  return [value, setValue];
}
