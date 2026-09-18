# Connecting Xezar to OpenCode so push notifications work

This project's agent tasks are coordinated by Xezar, the local cockpit. It runs on port 4321 (`http://127.0.0.1:4321`). Agents reach it through the `xezar` MCP server registered in `opencode.json` (OpenCode) and `.pi/mcp.json` (pi). One client owns the project's leader connection at a time.

## How OpenCode connects as leader

Unlike Claude Code, Codex and pi (which attach via `leader_events` with `action: attach` and a new `operationId`), **OpenCode is attached by a person** in the cockpit UI at **Settings → MCP connection**.

Being attached (leader state `attached`) is not the same as push delivery working. Pushed events need two more things: the opencode **serve address** and the session id.

## Making push notifications work

1. Open the project's **Connection status** panel (Settings → MCP connection).
2. Fill **Server address** with the HTTP endpoint the opencode serve session listens on (for example `http://127.0.0.1:4096`).
3. Fill **Session id** with the opencode session id for this session (`ses_...`).
4. Click **Attach leader**.
5. Confirm with `leader_events` `action: status` — it should report the session attached, and push availability should no longer be blocked.

The panel itself suggests the fix: "Let the attached OpenCode session call a xezar tool once (for example `leader_events`), so its MCP connection opens; it then receives every event it has not acknowledged."

## If push is unavailable

`leader_events status` reports a `pushUnavailable` code of `client-needs-address` with the message "An OpenCode leader is attached by a person, with its opencode serve address." This means the serve address + session id are not registered yet. The session is still attached; delivery just falls back to polling.

While push is unavailable, poll with `leader_events` `action: read` to see outstanding events, and acknowledge them with `leader_events` `action: ack` and the cursor from the read/push. Acknowledging is cumulative and idempotent: the ack cursor moves the acknowledged position, and you only ack events you have already taken into account.

## Verifying delivery

- Attachment is not delivery. Delivery is verified only by a real pushed event or an attached-session replay check (`leader_events` `action: read` with no cursor).
- After the cockpit restarts, attachment is lost. Re-establish it: make a tool call, check `leader_events` `action: status`, attach again (new `operationId`), then read outstanding events. Page with `nextCursor` while `hasMore` is true; a reported gap requires reconciling the current task state before acknowledging the `resumeCursor`.

## Useful session commands

- `leader_events status` — whether this session is attached, the delivery cursors, and what blocks delivery.
- `leader_events read` — the outstanding events and the current state of the tasks they name (the fallback when push is unavailable; page with `nextCursor` while `hasMore`).
- `leader_events ack <cursor>` — record that every event up to that cursor has been accounted for.
- `leader_events attach` / `stop` — only for Claude Code, Codex and pi; OpenCode attaches through Settings → MCP connection instead.

## Gotchas

- A transport receipt is not an acknowledgement. Only `leader_events ack` moves the acknowledged position.
- Events are retained at least 14 days and at most the newest 10000; older ones are reported as an explicit gap, never as silence.
- `task.stalled` is advisory only: no transcript activity for 5 minutes, or ≥80% of a finite step timeout used. It does not prove a deadlock and does not stop the task. Read the task before steering or cancelling.
