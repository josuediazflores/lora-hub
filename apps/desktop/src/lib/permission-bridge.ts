// Module-level bridge between the tools handler (lib/tools.ts) and the
// React-rendered PermissionPrompt (App.tsx). The handler can't import App
// directly without circular deps, so App registers a request function here
// at mount and tools.ts calls it.

export type CommandApprovalRequest = {
  cmd: string;
  args: string[];
  cwd: string | null;
  /** The original error message from the Rust side ("'curl' is not in the
   * Standard preset allowlist; switch to Trusted") so the prompt can show
   * the exact reason. */
  reason: string;
};

export type CommandApprovalDecision = "once" | "session" | "denied";

export type CommandApprovalRequester = (
  req: CommandApprovalRequest,
) => Promise<CommandApprovalDecision>;

let requester: CommandApprovalRequester | null = null;

export function setCommandApprovalRequester(
  fn: CommandApprovalRequester | null,
): void {
  requester = fn;
}

export async function requestCommandApproval(
  req: CommandApprovalRequest,
): Promise<CommandApprovalDecision> {
  if (!requester) {
    // App not mounted yet (or this is a non-UI context like a unit test):
    // fall through to deny so we never silently auto-approve.
    return "denied";
  }
  return await requester(req);
}
