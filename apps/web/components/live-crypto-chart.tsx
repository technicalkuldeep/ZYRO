"use client";
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  AreaSeries,
  CandlestickSeries,
  ColorType,
  type UTCTimestamp,
  type CandlestickData,
  type IChartApi,
} from "lightweight-charts";
import { api } from "./data";
type Tick = {
  price: number;
  time: number;
  receivedAt: number;
  sequence?: number;
  bars?: Record<
    number,
    { time: number; open: number; high: number; low: number; close: number }
  >;
};
type Snapshot = {
  serverTime: number;
  generation: number;
  assets: { pair: string; status: string; tick?: Tick }[];
};
const format = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
export const priceText = (v?: number) =>
  v == null || !Number.isFinite(v) ? "—" : format.format(v);
export function LiveCryptoChart({
  pair,
  reference,
  onStatus,
}: {
  pair: string;
  reference?: number;
  onStatus?: (status: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    chartRef = useRef<IChartApi | null>(null);
  const [mode, setMode] = useState("area"),
    [interval, setIntervalValue] = useState(60),
    [retry, setRetry] = useState(0);
  const [display, setDisplay] = useState<{
    status: string;
    price?: number;
    at?: number;
    error?: string;
    direction?: string;
  }>({ status: "Connecting" });
  const statusCallback = useRef(onStatus);
  statusCallback.current = onStatus;
  useEffect(() => {
    if (!host.current) return;
    let disposed = false,
      frame = 0,
      lastMessage = 0,
      generation = -1,
      latest: Tick | undefined,
      current: CandlestickData<UTCTimestamp> | undefined;
    let ready = false,
      syncing = false,
      lastVisual = 0,
      pendingStatus = "Connecting",
      queued: Tick[] = [];
    const metrics = {
      messages: 0,
      frames: 0,
      maxReceiveToChartMs: 0,
      totalReceiveToChartMs: 0,
      historyLoads: 0,
      gaps: 0,
    };
    const chart = createChart(host.current, {
      autoSize: true,
      height: 400,
      layout: {
        background: { type: ColorType.Solid, color: "#0b0f0e" },
        textColor: "#a5b4ab",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#17201c" },
        horzLines: { color: "#17201c" },
      },
      rightPriceScale: { borderColor: "#2a3731" },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#2a3731",
        rightOffset: 6,
      },
      crosshair: {
        vertLine: { color: "#79dfc1" },
        horzLine: { color: "#79dfc1" },
      },
    });
    chartRef.current = chart;
    const series =
      mode === "candles"
        ? chart.addSeries(CandlestickSeries, {
            upColor: "#79dfc1",
            downColor: "#f19c9c",
            borderVisible: false,
            wickUpColor: "#79dfc1",
            wickDownColor: "#f19c9c",
          })
        : chart.addSeries(AreaSeries, {
            lineColor: "#b5f477",
            topColor: "#b5f47725",
            bottomColor: "#b5f47700",
            lineWidth: 2,
            priceLineVisible: true,
          });
    if (reference)
      series.createPriceLine({
        price: reference,
        color: "#e1c783",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Official reference",
      });
    function apply(t: Tick) {
      const time = (Math.floor(t.time / 1000 / interval) *
        interval) as UTCTimestamp;
      if (current && time < Number(current.time)) return;
      const reported = t.bars?.[interval];
      if (!current || time > Number(current.time))
        current = {
          time,
          open: reported?.time === time ? reported.open : t.price,
          high: reported?.time === time ? reported.high : t.price,
          low: reported?.time === time ? reported.low : t.price,
          close: t.price,
        };
      else
        current = {
          ...current,
          high: Math.max(
            current.high,
            t.price,
            reported?.time === time ? reported.high : t.price,
          ),
          low: Math.min(
            current.low,
            t.price,
            reported?.time === time ? reported.low : t.price,
          ),
          close: t.price,
        };
      if (mode === "candles") series.update(current);
      else series.update({ time, value: current.close });
      // Lightweight Charts owns its bounded viewport; prune only on REST reconciliation, never per ticker.
      const latency = Date.now() - t.receivedAt;
      metrics.frames++;
      metrics.maxReceiveToChartMs = Math.max(
        metrics.maxReceiveToChartMs,
        latency,
      );
      metrics.totalReceiveToChartMs += latency;
      host.current?.setAttribute("data-metrics", JSON.stringify(metrics));
    }
    async function history() {
      if (syncing || disposed) return;
      syncing = true;
      ready = false;
      try {
        const data = await api<{
          candles: {
            time: number;
            open: number;
            high: number;
            low: number;
            close: number;
          }[];
        }>(`/account/prices/${pair}`);
        if (disposed) return;
        const grouped = new Map<number, CandlestickData<UTCTimestamp>>();
        for (const c of data.candles) {
          const time = Math.floor(c.time / interval) * interval,
            prev = grouped.get(time);
          grouped.set(
            time,
            prev
              ? {
                  ...prev,
                  high: Math.max(prev.high, c.high),
                  low: Math.min(prev.low, c.low),
                  close: c.close,
                }
              : {
                  time: time as UTCTimestamp,
                  open: c.open,
                  high: c.high,
                  low: c.low,
                  close: c.close,
                },
          );
        }
        const candles = [...grouped.values()]
          .sort((a, b) => Number(a.time) - Number(b.time))
          .slice(-300);
        if (!candles.length) throw Error("Historical candles unavailable");
        // Require contiguous 1m evidence; the current 5m interval can still be in progress.
        if (interval === 300)
          for (const c of candles) {
            const members = data.candles.filter(
              (v) => v.time >= Number(c.time) && v.time < Number(c.time) + 300,
            );
            const completedEnd = Math.min(
              Number(c.time) + 300,
              Math.floor(Date.now() / 60000) * 60,
            );
            const expected = (completedEnd - Number(c.time)) / 60;
            if (
              members.length !== expected ||
              members.some((v, i) => v.time !== Number(c.time) + i * 60)
            )
              grouped.delete(Number(c.time));
          }
        const valid = candles.filter((c) => grouped.has(Number(c.time)));
        if (!valid.length) throw Error("No complete chart intervals");
        if (mode === "candles") series.setData(valid);
        else
          series.setData(valid.map((c) => ({ time: c.time, value: c.close })));
        current = valid.at(-1);
        ready = true;
        metrics.historyLoads++;
        if (metrics.historyLoads === 1) chart.timeScale().fitContent();
        for (const tick of queued) apply(tick);
        queued = [];
        if (latest) apply(latest);
      } catch (e) {
        if (!disposed) {
          setDisplay((d) => ({
            ...d,
            error: (e as Error).message,
            status: "Data unavailable",
          }));
          statusCallback.current?.("Data unavailable");
        }
      } finally {
        syncing = false;
      }
    }
    setDisplay({ status: "Connecting" });
    statusCallback.current?.("Connecting");
    void history();
    const stream = new EventSource("/api/account/live-prices");
    stream.onmessage = (e) => {
      const snap = JSON.parse(e.data) as Snapshot,
        asset = snap.assets.find((a) => a.pair === pair);
      lastMessage = Date.now();
      metrics.messages++;
      pendingStatus = asset?.status || "Data unavailable";
      if (generation !== snap.generation) {
        if (generation >= 0) {
          metrics.gaps++;
          void history();
        }
        generation = snap.generation;
      }
      if (
        asset?.tick &&
        (!latest ||
          (asset.tick.sequence ?? asset.tick.time) >
            (latest.sequence ?? latest.time))
      ) {
        latest = asset.tick;
        if (!ready) {
          queued.push(latest);
          queued = queued.slice(-500);
        }
      }
      if (!frame) frame = requestAnimationFrame(render);
    };
    function render() {
      frame = 0;
      if (disposed) return;
      if (latest && ready && (latest.sequence ?? latest.time) !== lastVisual) {
        apply(latest);
        lastVisual = latest.sequence ?? latest.time;
      }
      setDisplay((previous) => ({
        status: ready ? pendingStatus : "Data unavailable",
        error: ready ? undefined : previous.error,
        price: latest?.price,
        at: latest?.time,
        direction:
          latest && previous.price
            ? latest.price > previous.price
              ? "up"
              : latest.price < previous.price
                ? "down"
                : previous.direction
            : undefined,
      }));
      statusCallback.current?.(ready ? pendingStatus : "Data unavailable");
    }
    stream.onerror = () => {
      pendingStatus = "Reconnecting";
      setDisplay((d) => ({ ...d, status: pendingStatus }));
      statusCallback.current?.(pendingStatus);
    };
    const health = window.setInterval(() => {
      if (
        Date.now() - lastMessage > 5000 ||
        (latest && Date.now() - latest.time > 15000)
      ) {
        setDisplay((d) => ({ ...d, status: "Delayed" }));
        statusCallback.current?.("Delayed");
      }
    }, 1000);
    const reconcile = window.setInterval(() => void history(), 60000);
    return () => {
      disposed = true;
      stream.close();
      cancelAnimationFrame(frame);
      clearInterval(health);
      clearInterval(reconcile);
      chart.remove();
      chartRef.current = null;
    };
  }, [pair, mode, interval, reference, retry]);
  return (
    <section className="live-chart">
      <div className="live-price-head">
        <div>
          <span
            className={`feed-status ${display.status === "Live" ? "is-live" : ""}`}
          >
            ● Coinbase Exchange · {display.status}
          </span>
          <strong className={`live-price ${display.direction || ""}`}>
            {priceText(display.price)}
          </strong>
          <small>
            Last verified tick:{" "}
            {display.at
              ? new Date(display.at)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 23) + " UTC"
              : "Awaiting provider"}
          </small>
        </div>
        <div className="chart-controls">
          <label>
            Interval
            <select
              aria-label="Candle interval"
              value={interval}
              onChange={(e) => setIntervalValue(Number(e.target.value))}
            >
              <option value={60}>1 minute</option>
              <option value={300}>5 minutes</option>
            </select>
          </label>
          <label>
            Chart
            <select
              aria-label="Chart type"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="area">Area</option>
              <option value="candles">Candles</option>
            </select>
          </label>
          <button
            onClick={() => chartRef.current?.timeScale().scrollToRealTime()}
          >
            Go to Live
          </button>
        </div>
      </div>
      {reference && (
        <p className="reference-note">
          Official reference {priceText(reference)} ·{" "}
          {display.price
            ? `${display.price > reference ? "UP" : display.price < reference ? "DOWN" : "EQUAL"} ${priceText(Math.abs(display.price - reference))}`
            : "Awaiting tick"}{" "}
          · Provisional movement only
        </p>
      )}
      <div
        ref={host}
        className="chart-canvas"
        aria-label={`${pair} real-time financial chart`}
      />
      {display.error && (
        <p role="alert">
          {display.error}{" "}
          <button onClick={() => setRetry((n) => n + 1)}>Retry chart</button>
        </p>
      )}
      <footer>
        Charting by{" "}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView Lightweight Charts™
        </a>{" "}
        · Copyright (с) 2025 TradingView, Inc. · Prices reported by Coinbase; no
        simulated ticks.
      </footer>
    </section>
  );
}
