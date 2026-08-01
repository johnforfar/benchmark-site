import { useState } from "react";
import { BenchChampions } from "./BenchChampions";
import { BenchLeaderboard } from "./BenchLeaderboard";
import { BenchHistory } from "./BenchHistory";
import { HarnessMatrix } from "./HarnessMatrix";
import { HarnessComparisonGraph } from "./HarnessComparisonGraph";
import { HarnessSupportMatrix } from "./HarnessSupportMatrix";
import machines from "../data/machines.json";

// Public viewer. Same components as the on-device app, reading the published
// dataset instead of local disk — so the charts here are the charts owners see
// on their own machines, not a separate implementation that could drift.
//
// The "Benchmark" tab from the on-device app is deliberately absent: it owns
// the run controls, and a run started here would measure cloud hardware.

const TABS = ["Leaderboard", "History", "Harnesses", "Hardware"] as const;
type Tab = (typeof TABS)[number];

export function Bench() {
  const [tab, setTab] = useState<Tab>("Leaderboard");

  return (
    <div className="min-h-screen bg-[#0b0b0f] text-white/90">
      <header className="border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-[1200px] mx-auto flex items-center gap-3 flex-wrap">
          <div>
            <h1 className="text-sm font-bold tracking-tight">O1-BETA benchmark results</h1>
            <p className="text-[11px] text-white/45 mt-1">
              Measured on identical hardware · contributed by machine owners · reviewed before merge
            </p>
          </div>
          <span className="ml-auto text-[10px] px-2 py-1 rounded-full border border-white/15 bg-white/[0.04] text-white/60">
            Viewer · results only
          </span>
        </div>
      </header>

      <nav className="px-6 pt-4 border-b border-white/[0.06]">
        <div className="max-w-[1200px] mx-auto flex gap-1 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm rounded-t-lg transition-colors ${
                tab === t
                  ? "bg-white/[0.07] text-white border-b-2 border-emerald-400"
                  : "text-white/50 hover:text-white/80"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-[1200px] mx-auto px-6 py-6">
        {/* Stated once, prominently: the two ways these numbers get misread. */}
        <div className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.03] border-l-2 border-l-amber-400/70 px-4 py-3 text-[12.5px] text-white/60 leading-relaxed">
          Results are grouped by model, quantisation and engine and never averaged
          across them — a <code className="text-white/80">llama-cpp-vulkan</code> number is not
          comparable to a <code className="text-white/80">vllm-xpu</code> one. Power limits dominate
          too: the same machine at 28 W measures roughly half the throughput it does at 65 W.
          Records are reviewed before merge but are <strong className="text-white/80">not
          cryptographically signed</strong>.
        </div>

        {tab === "Leaderboard" && (
          <>
            <BenchChampions />
            <BenchLeaderboard />
          </>
        )}
        {tab === "History" && <BenchHistory />}
        {tab === "Harnesses" && (
          <>
            <HarnessComparisonGraph />
            <HarnessMatrix />
            <HarnessSupportMatrix />
          </>
        )}
        {tab === "Hardware" && <Hardware />}
      </main>
    </div>
  );
}

function Hardware() {
  const rows = machines as any[];
  return (
    <div>
      <p className="text-[12.5px] text-white/50 mb-4 max-w-[70ch]">
        A fingerprint identifies a <em>hardware state</em>, not a machine — it changes when the
        kernel or firmware does, because results are not comparable across those changes either.
        One physical machine therefore appears more than once.
      </p>
      <div className="rounded-xl border border-white/[0.08] overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-white/[0.04] text-white/50 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2">Fingerprint</th>
              <th className="text-left px-3 py-2">CPU</th>
              <th className="text-right px-3 py-2">RAM</th>
              <th className="text-right px-3 py-2">Disk</th>
              <th className="text-right px-3 py-2">PL1/PL2</th>
              <th className="text-right px-3 py-2">Kernel</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.fingerprint} className="border-t border-white/[0.05]">
                <td className="px-3 py-2 font-mono text-[12px] text-white/70">{m.fingerprint}</td>
                <td className="px-3 py-2 text-white/70">{m.cpu_model ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.ram_gb ?? "—"} GB</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.storage_gb ?? "—"} GB</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {m.power?.pl1_w ?? "?"}/{m.power?.pl2_w ?? "?"} W
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-white/60">
                  {m.kernel_version ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
