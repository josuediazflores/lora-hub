import { useMemo, useState } from "react";
import { Logo } from "./Logo";
import type { StoreBase } from "../lib/store";

export const FIRST_RUN_KEY = "lora-hub:first-run-complete:v1";

type Step = "welcome" | "pick" | "downloading";

type CuratedPick = {
  base_id: string;
  blurb: string;
  ramHint: string;
  recommended?: boolean;
};

const CURATED: CuratedPick[] = [
  {
    base_id: "gemma-4-e2b-it-4bit",
    blurb: "Fast on any Apple Silicon Mac. Good for chat, drafting, light coding.",
    ramHint: "8 GB RAM",
  },
  {
    base_id: "gemma-4-e4b-it-4bit",
    blurb: "Balanced quality and size. Best default if you have the disk for it.",
    ramHint: "16 GB RAM",
    recommended: true,
  },
  {
    base_id: "gemma-4-26b-a4b-it-4bit",
    blurb: "Most capable. MoE — only ~4B active params per token, but large on disk.",
    ramHint: "32 GB RAM",
  },
];

export type DownloadProgress = {
  desc: string;
  n: number;
  total: number;
  percent: number;
};

export function FirstRunWizard({
  bases,
  onLoadBase,
  onComplete,
  onSkip,
}: {
  bases: StoreBase[];
  /** Drives the actual download. Resolves with `ok: true` on success and the
   * loaded base, `ok: false` with `message` on error so the wizard can recover. */
  onLoadBase: (
    base: StoreBase,
    onProgress: (p: DownloadProgress) => void,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Marks first_run_complete and dismisses the wizard. */
  onComplete: () => void;
  /** Lets users bail to the regular UI without picking a model — useful when
   * they want to drag-and-drop their own weights or already have a base cached. */
  onSkip: () => void;
}) {
  const [step, setStep] = useState<Step>("welcome");
  const [picked, setPicked] = useState<string | null>(
    CURATED.find((c) => c.recommended)?.base_id ?? CURATED[0].base_id,
  );
  const [progress, setProgress] = useState<DownloadProgress>({
    desc: "preparing",
    n: 0,
    total: 0,
    percent: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const cards = useMemo(() => {
    return CURATED.map((pick) => {
      const base = bases.find((b) => b.base_id === pick.base_id);
      return base ? { pick, base } : null;
    }).filter((x): x is { pick: CuratedPick; base: StoreBase } => x !== null);
  }, [bases]);

  async function startDownload(base: StoreBase) {
    setError(null);
    setProgress({ desc: "preparing", n: 0, total: 0, percent: 0 });
    setStep("downloading");
    const res = await onLoadBase(base, (p) => setProgress(p));
    if (res.ok) {
      onComplete();
    } else {
      setError(res.message);
      // Keep them on the downloading step with the error visible so they can
      // retry the same base or go back to the picker.
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-app-bg px-6">
      <div className="w-full max-w-[640px]">
        <StepDots current={step} />

        {step === "welcome" && (
          <WelcomeStep
            onContinue={() => setStep("pick")}
            onSkip={onSkip}
          />
        )}

        {step === "pick" && (
          <PickStep
            cards={cards}
            picked={picked}
            onPick={setPicked}
            onBack={() => setStep("welcome")}
            onContinue={() => {
              const choice = cards.find((c) => c.pick.base_id === picked);
              if (choice) startDownload(choice.base);
            }}
            onSkip={onSkip}
          />
        )}

        {step === "downloading" && (
          <DownloadingStep
            base={cards.find((c) => c.pick.base_id === picked)?.base ?? null}
            progress={progress}
            error={error}
            onRetry={() => {
              const choice = cards.find((c) => c.pick.base_id === picked);
              if (choice) startDownload(choice.base);
            }}
            onBack={() => {
              setError(null);
              setStep("pick");
            }}
          />
        )}
      </div>
    </div>
  );
}

function StepDots({ current }: { current: Step }) {
  const order: Step[] = ["welcome", "pick", "downloading"];
  return (
    <div className="mb-8 flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-app-text-faint">
      {order.map((s, i) => {
        const active = order.indexOf(current) >= i;
        return (
          <span key={s} className="flex items-center gap-2">
            <span
              className={
                "inline-block h-1.5 w-6 rounded-full " +
                (active ? "bg-app-accent" : "bg-app-border")
              }
            />
            {i < order.length - 1 && <span className="text-app-text-faint">·</span>}
          </span>
        );
      })}
    </div>
  );
}

function WelcomeStep({
  onContinue,
  onSkip,
}: {
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="text-center">
      <div className="mb-6 flex justify-center">
        <Logo />
      </div>
      <h1 className="m-0 font-serif text-[34px] font-medium tracking-[-0.01em] text-app-text">
        Welcome to LoRA Hub
      </h1>
      <p className="mx-auto mt-4 max-w-[480px] text-[14px] leading-[1.6] text-app-text-muted">
        A local AI desktop with a built-in storefront for LoRA adapters. The
        model runs on your Mac — your prompts, your conversations, and your
        files never leave the device.
      </p>
      <p className="mx-auto mt-3 max-w-[480px] text-[13px] leading-[1.55] text-app-text-faint">
        Next we'll pick a base model and download it. You can change it later
        from the Models view.
      </p>
      <div className="mt-8 flex items-center justify-center gap-3">
        <button
          onClick={onContinue}
          className="rounded-md bg-app-accent px-5 py-2 text-[13px] font-medium text-app-bg hover:opacity-90"
        >
          Get started
        </button>
        <button
          onClick={onSkip}
          className="rounded-md border border-app-border px-4 py-2 text-[12px] text-app-text-muted hover:border-app-border-strong hover:text-app-text"
        >
          I'll set it up later
        </button>
      </div>
    </div>
  );
}

function PickStep({
  cards,
  picked,
  onPick,
  onBack,
  onContinue,
  onSkip,
}: {
  cards: { pick: CuratedPick; base: StoreBase }[];
  picked: string | null;
  onPick: (id: string) => void;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <h2 className="m-0 text-center font-serif text-[26px] font-medium text-app-text">
        Pick a base model
      </h2>
      <p className="mx-auto mt-2 mb-6 max-w-[460px] text-center text-[13px] leading-[1.55] text-app-text-muted">
        Adapters in the storefront target one of these. We'll download from
        Hugging Face on the next step.
      </p>

      <div className="space-y-2.5">
        {cards.map(({ pick, base }) => {
          const active = picked === pick.base_id;
          return (
            <button
              key={pick.base_id}
              onClick={() => onPick(pick.base_id)}
              className={
                "flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition " +
                (active
                  ? "border-app-accent bg-app-surface-hover"
                  : "border-app-border bg-app-surface hover:border-app-border-strong hover:bg-app-surface-hover")
              }
            >
              <span
                aria-hidden="true"
                className={
                  "mt-1 inline-block h-3 w-3 shrink-0 rounded-full border " +
                  (active
                    ? "border-app-accent bg-app-accent"
                    : "border-app-border-strong bg-transparent")
                }
              />
              <div className="flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-[16px] text-app-text">
                      {base.name}
                    </span>
                    {pick.recommended && (
                      <span className="rounded-sm border border-app-accent px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-app-accent">
                        recommended
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-app-text-faint">
                    {formatGb(base.size_bytes)} · {pick.ramHint}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] leading-[1.5] text-app-text-muted">
                  {pick.blurb}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-[12px] text-app-text-muted hover:text-app-text"
        >
          ← back
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={onSkip}
            className="rounded-md border border-app-border px-4 py-2 text-[12px] text-app-text-muted hover:border-app-border-strong hover:text-app-text"
          >
            Skip
          </button>
          <button
            onClick={onContinue}
            disabled={!picked}
            className="rounded-md bg-app-accent px-5 py-2 text-[13px] font-medium text-app-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download &amp; continue
          </button>
        </div>
      </div>
    </div>
  );
}

function DownloadingStep({
  base,
  progress,
  error,
  onRetry,
  onBack,
}: {
  base: StoreBase | null;
  progress: DownloadProgress;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  const pct = Math.max(0, Math.min(100, progress.percent || 0));
  return (
    <div className="text-center">
      <h2 className="m-0 font-serif text-[26px] font-medium text-app-text">
        {error ? "Download failed" : "Downloading…"}
      </h2>
      <p className="mx-auto mt-2 mb-6 max-w-[460px] text-[13px] leading-[1.55] text-app-text-muted">
        {base?.name ?? "Base model"} from Hugging Face. The first run is the
        slow one — subsequent launches reuse the cache.
      </p>

      <div className="mx-auto max-w-[480px]">
        <div className="h-2 overflow-hidden rounded-full bg-app-surface">
          <div
            className="h-full bg-app-accent transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-app-text-faint">
          <span>{progress.desc || (error ? "error" : "starting")}</span>
          <span>
            {progress.total > 0
              ? `${progress.n}/${progress.total} files · ${pct}%`
              : `${pct}%`}
          </span>
        </div>
      </div>

      {error && (
        <div className="mx-auto mt-5 max-w-[480px] rounded-md border border-app-accent/40 bg-app-surface px-3 py-2 text-left text-[12px] text-app-accent">
          {error}
        </div>
      )}

      <div className="mt-7 flex items-center justify-center gap-3">
        {error ? (
          <>
            <button
              onClick={onBack}
              className="rounded-md border border-app-border px-4 py-2 text-[12px] text-app-text-muted hover:border-app-border-strong hover:text-app-text"
            >
              ← pick a different model
            </button>
            <button
              onClick={onRetry}
              className="rounded-md bg-app-accent px-5 py-2 text-[13px] font-medium text-app-bg hover:opacity-90"
            >
              Retry
            </button>
          </>
        ) : (
          <button
            onClick={onBack}
            className="rounded-md border border-app-border px-4 py-2 text-[12px] text-app-text-muted hover:border-app-border-strong hover:text-app-text"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function formatGb(bytes: number): string {
  if (!bytes) return "—";
  const gb = bytes / 1_000_000_000;
  return gb >= 10 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`;
}
