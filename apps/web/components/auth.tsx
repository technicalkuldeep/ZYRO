"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./data";
export type Player = {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  admin: boolean;
  createdAt: string;
};
export type Balance = {
  available: number;
  committed: number;
  played: number;
  wins: number;
  net: number;
  streak: number;
  grants: number;
};
type Auth = {
  user: Player | null;
  account?: Balance;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};
const Context = createContext<Auth>({
  user: null,
  loading: true,
  error: "",
  refresh: async () => {},
});
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<Omit<Auth, "refresh">>({
    user: null,
    loading: true,
    error: "",
  });
  async function refresh() {
    try {
      const data = await api<{ user: Player | null; account?: Balance }>(
        "/auth/me",
      );
      setValue({ ...data, loading: false, error: "" });
    } catch (e) {
      setValue({ user: null, loading: false, error: (e as Error).message });
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <Context.Provider value={{ ...value, refresh }}>
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
export const points = (n?: number | null) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
export function Avatar({
  user,
}: {
  user?: { name: string; avatar?: string } | null;
}) {
  // Initials avoid third-party image requests and remain stable when offline.
  return (
    <span className="avatar" aria-label={user?.name || "Player"}>
      {user?.name.slice(0, 1).toUpperCase() || "Z"}
    </span>
  );
}
