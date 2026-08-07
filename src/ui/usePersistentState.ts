import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

const STORAGE_PREFIX = "findraw.preferences.v1.";

export function usePersistentState<T>(
  key: string,
  defaultValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;

    try {
      const storedValue = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
      return storedValue === null ? defaultValue : JSON.parse(storedValue) as T;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
    } catch {
      // Preferences remain usable for this session when storage is unavailable.
    }
  }, [key, value]);

  return [value, setValue];
}