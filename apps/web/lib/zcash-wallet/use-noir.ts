"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  waitForNoir,
  readNoir,
  supportedNoirVersion,
  noirErrorStatus,
  noirLocalhostUrl,
  type NoirStatus,
  type discoverNoir,
} from "./noir";
import type { WalletState } from "./client";
type Provider = NonNullable<ReturnType<typeof discoverNoir>>;
const modeKey = "zyro:testnet:active-mode";
function savedMode() {
  try {
    return localStorage.getItem(modeKey);
  } catch {
    return null;
  }
}
export function useNoir(options: {
  validate: (address: string) => Promise<unknown>;
  selected: () => boolean;
  account: (wallet: Provider | null, state: WalletState | null) => void;
}) {
  const [status, setStatus] = useState<NoirStatus>("searching"),
    [version, setVersion] = useState<string>(),
    [localhost, setLocalhost] = useState<string>();
  const callbacks = useRef(options);
  callbacks.current = options;
  const provider = useRef<Provider | null>(null),
    release = useRef<() => void>(() => {}),
    revision = useRef(0),
    controller = useRef<AbortController | null>(null),
    connecting = useRef(false);
  const read = useCallback(
    async (wallet: Provider, approval: boolean, generation: number) => {
      try {
        const next = await readNoir(wallet, approval, (address) =>
          callbacks.current.validate(address),
        );
        if (revision.current !== generation) return;
        if (!next) {
          setStatus("unauthorized");
          if (callbacks.current.selected())
            callbacks.current.account(null, null);
          return;
        }
        localStorage.setItem(modeKey, "noir");
        setStatus("connected");
        callbacks.current.account(wallet, next);
      } catch (error) {
        if (revision.current !== generation) return;
        setStatus(noirErrorStatus(error));
        if (callbacks.current.selected()) callbacks.current.account(null, null);
        if (approval) throw error;
      }
    },
    [],
  );
  const detect = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const generation = ++revision.current;
    if (callbacks.current.selected()) callbacks.current.account(null, null);
    setStatus("searching");
    setLocalhost(noirLocalhostUrl());
    release.current();
    release.current = () => {};
    const found = await waitForNoir(abort.signal);
    if (abort.signal.aborted || revision.current !== generation) return;
    provider.current = found;
    if (!found) {
      setStatus("unavailable");
      return;
    }
    setVersion(found.version);
    if (!supportedNoirVersion(found.version)) {
      setStatus("unsupported");
      return;
    }
    setStatus("installed");
    const changed = (payload?: unknown) => {
      if (!callbacks.current.selected() && savedMode() !== "noir") return;
      const nextGeneration = ++revision.current;
      callbacks.current.account(null, null);
      if (Array.isArray(payload) && !payload.length) {
        setStatus("locked");
        return;
      }
      if (payload === null) {
        setStatus("disconnected");
        return;
      }
      void read(found, false, nextGeneration);
    };
    found.zcash.on("accountsChanged", changed);
    found.zcash.on("chainChanged", changed);
    found.zcash.on("disconnect", changed);
    release.current = () => {
      found.zcash.removeListener("accountsChanged", changed);
      found.zcash.removeListener("chainChanged", changed);
      found.zcash.removeListener("disconnect", changed);
    };
    if (savedMode() === "noir") await read(found, false, generation);
    else {
      try {
        if (
          !(await found.zcash.getAccounts()) &&
          revision.current === generation
        )
          setStatus("unauthorized");
      } catch (error) {
        if (revision.current === generation) setStatus(noirErrorStatus(error));
      }
    }
  }, [read]);
  useEffect(() => {
    void detect();
    return () => {
      revision.current++;
      controller.current?.abort();
      release.current();
    };
  }, [detect]);
  const connect = async () => {
    if (connecting.current) return;
    connecting.current = true;
    try {
      let found = provider.current;
      if (!found) {
        await detect();
        found = provider.current;
      }
      if (!found) return;
      if (!supportedNoirVersion(found.version)) {
        setStatus("unsupported");
        return;
      }
      const generation = ++revision.current;
      setStatus("approval");
      await read(found, true, generation);
    } finally {
      connecting.current = false;
    }
  };
  const disconnect = async () => {
    ++revision.current;
    localStorage.removeItem(modeKey);
    callbacks.current.account(null, null);
    setStatus("disconnected");
    await provider.current?.zcash.disconnect();
  };
  return {
    status,
    version,
    localhost,
    connect,
    disconnect,
    retry: detect,
    embedded: () => {
      ++revision.current;
      localStorage.setItem(modeKey, "embedded");
    },
    dismiss: () => {
      ++revision.current;
      localStorage.removeItem(modeKey);
      setStatus(provider.current ? "installed" : "unavailable");
    },
  };
}
