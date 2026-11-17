"use client";
import { useCallback, useEffect, useState } from "react";
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api" + path, {
    credentials: "same-origin",
    headers: body
      ? { "Content-Type": "application/json", "X-Zyro-Client": "web" }
      : undefined,
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(()=>{throw new Error('The API is unavailable. Check that the backend is running, then try again.');});
  if (!response.ok)
    throw new Error(
      data.issues
        ?.map((i: any) => `${i.path.join(".")}: ${i.message}`)
        .join("; ") ||
        data.error ||
        "Request failed",
    );
  return data;
}
export function useData<T = any>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      const value = await api<T>(path);
      setData(value);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    setData(undefined);
    setError('');
    void reload();
  }, [reload]);
  return { data, error, reload };
}
export function DataState({
  error,
  retry,
}: {
  error?: string;
  retry: () => void;
}) {
  return error ? (
    <div className="notice error" role="alert">
      {error}
      <button className="button secondary" onClick={retry}>
        Try again
      </button>
    </div>
  ) : (
    <div className="skeleton" aria-label="Loading content" />
  );
}
export function zec(units: number) {
  return (
    (units / 100000000).toLocaleString("en-US", { maximumFractionDigits: 8 }) +
    " TAZ"
  );
}
export function date(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
