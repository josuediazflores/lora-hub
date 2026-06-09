import { useState } from "react";
import { Send, Copy, Check, MessageSquare, Mail, Clipboard } from "lucide-react";
import { StripeCard } from "./StripeCard";
import { safeHref } from "../../lib/safe-url";

export type OutreachMessage = {
  name: string;
  contact?: string | null;
  uri: string;
  body: string;
};

export type OutreachDraftsData = {
  channel: "sms" | "email" | "clipboard";
  messages: OutreachMessage[];
};

const CHANNEL_LABEL: Record<OutreachDraftsData["channel"], string> = {
  sms: "sms",
  email: "email",
  clipboard: "clipboard",
};

const CHANNEL_ICON: Record<
  OutreachDraftsData["channel"],
  typeof MessageSquare
> = {
  sms: MessageSquare,
  email: Mail,
  clipboard: Clipboard,
};

export function OutreachDraftsCard({ data }: { data: OutreachDraftsData }) {
  const messages = data.messages ?? [];
  const Icon = CHANNEL_ICON[data.channel] ?? MessageSquare;

  return (
    <StripeCard
      title={`Outreach drafts — ${messages.length} ${messages.length === 1 ? "message" : "messages"}`}
      eyebrow={`lora-hub · outreach · ${CHANNEL_LABEL[data.channel] ?? "draft"}`}
      footer={
        <span className="inline-flex items-center gap-1.5">
          <Icon size={11} strokeWidth={2.2} />
          {data.channel === "clipboard"
            ? "click Copy to grab the message text"
            : "click Send → to open your composer with the body prefilled"}
        </span>
      }
    >
      {messages.length === 0 ? (
        <div className="px-4 py-6 text-center text-[13px] text-app-text-muted">
          No drafts yet.
        </div>
      ) : (
        <ul className="divide-y divide-app-border/70">
          {messages.map((m, i) => (
            <li key={i}>
              <DraftRow message={m} channel={data.channel} />
            </li>
          ))}
        </ul>
      )}
    </StripeCard>
  );
}

function DraftRow({
  message,
  channel,
}: {
  message: OutreachMessage;
  channel: OutreachDraftsData["channel"];
}) {
  const [copied, setCopied] = useState(false);
  const [showBody, setShowBody] = useState(false);

  async function copyBody() {
    try {
      await navigator.clipboard.writeText(message.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  const contactDisplay =
    message.contact && message.contact.trim().length > 0
      ? message.contact
      : channel === "clipboard"
        ? "(clipboard)"
        : "(no contact set)";

  return (
    <div className="px-4 py-2.5">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
        <div className="text-[13px] text-app-text">{message.name}</div>
        <button
          type="button"
          onClick={() => setShowBody((v) => !v)}
          className="min-w-0 truncate text-left font-mono text-[11px] text-app-text-muted hover:text-app-text"
          title={showBody ? "Hide body" : "Show body"}
        >
          {contactDisplay}
        </button>
        {channel === "clipboard" || !message.uri ? (
          <button
            type="button"
            onClick={copyBody}
            className="inline-flex items-center gap-1.5 rounded-md border border-app-border px-2.5 py-1 text-[12px] text-app-text-muted transition-colors hover:bg-app-surface-hover hover:text-app-text"
          >
            {copied ? (
              <>
                <Check size={12} strokeWidth={2.2} />
                Copied
              </>
            ) : (
              <>
                <Copy size={12} strokeWidth={2.2} />
                Copy
              </>
            )}
          </button>
        ) : safeHref(message.uri) ? (
          <a
            href={safeHref(message.uri)}
            className="inline-flex items-center gap-1.5 rounded-md bg-app-text px-2.5 py-1 text-[12px] font-medium text-app-surface transition-opacity hover:opacity-90"
          >
            <Send size={11} strokeWidth={2.2} />
            Send
          </a>
        ) : null}
      </div>
      {showBody ? (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-app-border bg-app-surface-hover px-2 py-1.5 font-mono text-[11px] text-app-text-muted">
          {message.body}
        </pre>
      ) : null}
    </div>
  );
}
