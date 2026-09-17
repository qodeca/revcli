/**
 * xezar's pi leader extension (#330 WP2).
 *
 * WHAT IT IS FOR. xezar's event controller can push a significant event to a leader running in
 * OpenCode, because `opencode serve` has an address. pi has none: its RPC is stdio-only and
 * spawn-only — no port, no socket, no attach mode (`pi --help` and `docs/rpc.md` on 0.85.1) — and
 * xezar never starts an agent process for a leader. So a pi that YOU started in YOUR terminal could
 * not be reached at all, and its events waited until you typed something. That is what this closes.
 *
 * It runs inside your pi, opens one Unix socket, and writes a small descriptor into the project's
 * own xezar directory saying where that socket is. xezar reads the descriptor when you attach, dials
 * the socket, and from then on speaks pi's OWN RPC vocabulary down it — `prompt`, `steer`,
 * `get_state`, `get_messages` — which this file translates into the pi extension API. xezar's side
 * therefore does not know or care that a socket is involved (`src/mcp/adapters/pi-link.ts`).
 *
 * WHAT IT DOES NOT DO, deliberately:
 *  - It sends nothing to xezar on its own. It answers commands and forwards pi's events. It never
 *    reads your files, your settings or your credentials, and it opens no network socket. The
 *    Unix socket lives inside a directory this extension creates with mode 0700, which is what
 *    keeps other accounts on the machine out — see `makePrivateSocketDir` for why the DIRECTORY
 *    and not the socket file is the guard.
 *  - It starts no turn of its own accord. A turn happens only when xezar hands over an event, which
 *    only happens for a project you attached, in a session you started.
 *  - It never edits, retries or invents. A command it does not understand is refused by name.
 *
 * INSTALL. Either point pi at it once:
 *     pi --extension /path/to/xezar/scripts/pi-leader-extension.ts
 * or copy it into `~/.pi/agent/extensions/` (global) or `<project>/.pi/extensions/` (project-local),
 * which also makes `/reload` work on it. Then, in the cockpit, attach the pi leader.
 *
 * WHY THE SOCKET IS OPENED IN `session_start` AND NOT IN THE FACTORY. pi documents it plainly
 * (`docs/extensions.md` § Long-lived resources and shutdown): a factory may run in an invocation
 * that never starts a session, so background resources belong to `session_start`, with an IDEMPOTENT
 * `session_shutdown` to close them. pi tears the runtime down and rebuilds it on `/new`, `/resume`,
 * `/fork`, `/clone` and `/reload` — not only on quit — so the socket path carries the session id and
 * the teardown is safe to run twice.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// The extension API types are pi's, resolved from the pi installation that loads this file. They are
// imported as types only, so this file needs no dependency of its own and no `package.json`.
type TextContent = { type: 'text'; text: string };
type AgentMessage = { role?: unknown; content?: unknown };
type SessionEntry = { type?: unknown; message?: AgentMessage };

interface ReadonlySessionManagerLike {
  getSessionId(): string;
  getCwd(): string;
  getBranch(fromId?: string): SessionEntry[];
}

interface ExtensionContextLike {
  cwd: string;
  sessionManager: ReadonlySessionManagerLike;
  isIdle(): boolean;
  hasPendingMessages(): boolean;
}

interface ExtensionApiLike {
  on(event: string, handler: (event: unknown, ctx: ExtensionContextLike) => unknown): void;
  sendUserMessage(content: string | TextContent[], options?: { deliverAs?: 'steer' | 'followUp' }): void;
}

/** Additive changes keep version 1; an incompatible one bumps it. Must match `pi-link.ts`. */
const SCHEMA_VERSION = 1;
const DESCRIPTOR_FILE = 'pi-leader.json';
const XEZAR_DATA_DIR = join('.local', 'xezar');
/** A Unix socket path is limited to ~104 bytes on macOS, so it never lives under the repository. */
const SOCKET_PREFIX = 'xez-pi-';
const SOCKET_FILE = 'leader.sock';

/**
 * A private `0700` directory to put the socket in, or `undefined` if we cannot have one.
 *
 * THE DIRECTORY IS THE GUARD, AND IT HAS TO BE. An earlier version of this file put the socket
 * straight into `os.tmpdir()` and claimed in a comment that only this user could reach it. That was
 * false, and a QA on #358 measured it: with no `TMPDIR` set, Linux's `os.tmpdir()` is `/tmp`, mode
 * `1777`, and the socket landed there as `0755`. Any other local account could then read the whole
 * leader conversation with `get_messages` and write `prompt`/`steer` into a pi that has bash and
 * edit tools. macOS hid it, because it gives each user a `0700` `/var/folders/…/T` — so the bug was
 * invisible on the machine this was written on and live on the ordinary Linux box.
 *
 * A mode on the socket FILE is not the fix: Linux enforces permissions on a Unix socket, macOS and
 * the BSDs do not, so only the containing directory is portable. `/tmp` being sticky (`1777`) is
 * what makes creating our own directory there safe — another user cannot remove or rename it.
 *
 * Three things are therefore deliberate:
 *  - the directory is created NON-recursively, so an existing path is an error we handle rather
 *    than something we silently adopt;
 *  - anything already at the path is removed first, so a leftover from a crashed pi (or a planted
 *    symlink) cannot be inherited;
 *  - the result is VERIFIED with `lstat` before it is used — the mode is checked, and a symlink is
 *    refused, because `mkdir -p` over a symlink-to-directory succeeds and `chmod` would follow it.
 */
function makePrivateSocketDir(sessionId: string): { dir: string; socket: string } | undefined {
  const dir = join(tmpdir(), `${SOCKET_PREFIX}${sessionId}`);
  try {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { mode: 0o700 });
    // mkdir's mode is masked by the process umask, so ask for it again explicitly.
    chmodSync(dir, 0o700);
    const stat = lstatSync(dir);
    if (!stat.isDirectory()) return undefined;
    if ((stat.mode & 0o077) !== 0) return undefined;
    return { dir, socket: join(dir, SOCKET_FILE) };
  } catch {
    // No private directory, no socket. Failing closed here costs push delivery and nothing else:
    // the events stay in xezar's journal and the leader still reads them with `leader_events`.
    return undefined;
  }
}

export default function xezarLeaderExtension(pi: ExtensionApiLike): void {
  let server: Server | undefined;
  let descriptorPath: string | undefined;
  let socketPath: string | undefined;
  let socketDir: string | undefined;
  const clients = new Set<Socket>();

  /**
   * pi's `on` has no unsubscribe, so these are registered ONCE for the whole life of the extension
   * and broadcast to whatever sockets are open at the time. Registering them per connection would
   * add four handlers to the person's pi on every attach and never take them away — a slow leak
   * inside somebody else's editor, which is not a thing to ship.
   *
   * Only these four. The adapter needs the busy boundary and the user message that marks a real
   * reaction; forwarding more would put session content on a socket for no reason.
   */
  for (const type of ['agent_start', 'agent_settled', 'message_start', 'message_end'] as const) {
    pi.on(type, (event: unknown) => {
      if (clients.size === 0) return;
      const message = (event as { message?: AgentMessage } | undefined)?.message;
      const frame = `${JSON.stringify(message === undefined ? { type } : { type, message })}\n`;
      for (const client of clients) {
        if (client.destroyed) continue;
        try {
          client.write(frame);
        } catch {
          /* A peer that went away is not worth surfacing into someone's coding session. */
        }
      }
    });
  }

  /** Idempotent, and it must stay that way: pi calls it on quit AND on every session replacement. */
  const teardown = (): void => {
    for (const client of clients) client.destroy();
    clients.clear();
    server?.close();
    server = undefined;
    if (descriptorPath !== undefined) {
      try {
        rmSync(descriptorPath, { force: true });
      } catch {
        /* Leaving a stale file behind is not worth failing a shutdown over; xezar detects it. */
      }
    }
    // The whole private directory, not just the socket inside it.
    if (socketDir !== undefined) {
      try {
        rmSync(socketDir, { recursive: true, force: true });
      } catch {
        /* Same: a leftover empty 0700 directory harms nothing. */
      }
    }
    descriptorPath = undefined;
    socketPath = undefined;
    socketDir = undefined;
  };

  pi.on('session_start', async (_event: unknown, ctx: ExtensionContextLike) => {
    // A replacement session fires `session_shutdown` first, but run teardown anyway: it is cheap,
    // it is idempotent, and a half-open server here would fail the bind below.
    teardown();

    const dataDir = findProjectDataDir(ctx.cwd);
    if (dataDir === undefined) return; // Not a xezar project. Do nothing at all, quietly.

    const sessionId = safeSessionId(ctx);
    const place = makePrivateSocketDir(sessionId);
    if (place === undefined) return; // Could not get a private directory: open nothing at all.
    socketDir = place.dir;
    socketPath = place.socket;

    const next = createServer((socket) => serve(socket, pi, ctx, clients));
    next.on('error', () => {
      // A leader that cannot listen must not take pi down with it. xezar keeps the rows and the
      // person reads them with `leader_events`, exactly as before this extension existed.
      teardown();
    });

    await new Promise<void>((done) => {
      next.once('listening', () => done());
      next.once('error', () => done());
      next.listen(socketPath);
    });
    if (!next.listening) {
      teardown();
      return;
    }
    server = next;

    // Written only once the socket really listens, so the file never names nothing — the same
    // ordering rule xezar's own connection file follows.
    descriptorPath = join(dataDir, DESCRIPTOR_FILE);
    writeDescriptor(descriptorPath, { socket: socketPath, sessionId });
  });

  pi.on('session_shutdown', () => teardown());
}

/** One connection, JSONL both ways: xezar's commands in, pi's answers and events out. */
function serve(socket: Socket, pi: ExtensionApiLike, ctx: ExtensionContextLike, clients: Set<Socket>): void {
  clients.add(socket);
  socket.setNoDelay(true);
  socket.setEncoding('utf8');

  const write = (frame: Record<string, unknown>): void => {
    if (socket.destroyed) return;
    try {
      socket.write(`${JSON.stringify(frame)}\n`);
    } catch {
      /* A peer that went away is not an error worth surfacing into someone's coding session. */
    }
  };

  // pi's events reach this socket through the one set of handlers registered in the factory, which
  // broadcasts to `clients`. Nothing is subscribed per connection, on purpose — see there.
  let buffer = '';
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    // A peer that never sends a newline must not grow this without bound.
    if (buffer.length > 1_000_000) {
      socket.destroy();
      return;
    }
    let nl: number;
    // Split on `\n` only and strip a trailing `\r` — pi's own framing rule (`docs/rpc.md`).
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let command: Record<string, unknown>;
      try {
        command = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      handle(command, pi, ctx, write);
    }
  });

  const done = (): void => {
    clients.delete(socket);
  };
  socket.on('close', done);
  socket.on('error', done);
}

/**
 * One command. The vocabulary is pi's RPC, so xezar's adapter is unchanged by this file existing.
 *
 * `success` means ACCEPTED, never "the turn went well" — pi's own rule, and the one xezar's adapter
 * is written against.
 */
function handle(
  command: Record<string, unknown>,
  pi: ExtensionApiLike,
  ctx: ExtensionContextLike,
  write: (frame: Record<string, unknown>) => void,
): void {
  const id = typeof command.id === 'string' ? command.id : undefined;
  const type = typeof command.type === 'string' ? command.type : '';
  const reply = (frame: Record<string, unknown>): void => write({ type: 'response', ...(id === undefined ? {} : { id }), command: type, ...frame });
  const text = typeof command.message === 'string' ? command.message : '';

  try {
    if (type === 'get_state') {
      reply({
        success: true,
        data: {
          isStreaming: !ctx.isIdle(),
          // The extension API answers "are any queued" as a boolean, not a count (pi has no
          // `pendingMessageCount` for extensions). A truthful lower bound: xezar only ever asks
          // whether it is above zero, and this never claims a number it does not know.
          pendingMessageCount: ctx.hasPendingMessages() ? 1 : 0,
          sessionId: safeSessionId(ctx),
        },
      });
      return;
    }
    if (type === 'get_messages') {
      reply({ success: true, data: { messages: conversation(ctx) } });
      return;
    }
    if (type === 'prompt') {
      // Real pi refuses a plain `prompt` during a turn and says so in this exact wording; xezar's
      // adapter matches on it and falls back to `steer`. Answering the same way keeps the two
      // transports interchangeable. `sendUserMessage` cannot report this itself — while streaming
      // it fails into pi's extension-error channel rather than throwing here — so it is checked.
      if (!ctx.isIdle()) {
        reply({
          success: false,
          error: { message: "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message." },
        });
        return;
      }
      pi.sendUserMessage(text);
      reply({ success: true });
      return;
    }
    if (type === 'steer') {
      pi.sendUserMessage(text, { deliverAs: 'steer' });
      reply({ success: true });
      return;
    }
    reply({ success: false, error: { message: `the xezar leader extension does not implement ${type || '(no type)'}` } });
  } catch (err) {
    reply({ success: false, error: { message: err instanceof Error ? err.message : String(err) } });
  }
}

/**
 * The conversation as it stands, oldest first, in `get_messages` shape.
 *
 * `getBranch()` and not `getEntries()`: entries are the raw append-only file, so after a `/fork` it
 * still carries messages from branches the person walked away from. Not `buildContextEntries()`
 * either: that drops pre-compaction messages, and xezar reads this to find out what it has ALREADY
 * told pi — a dropped marker would make it hand the same event over twice.
 */
function conversation(ctx: ExtensionContextLike): { role: string; content: TextContent[] }[] {
  let entries: SessionEntry[];
  try {
    entries = ctx.sessionManager.getBranch();
  } catch {
    return [];
  }
  const out: { role: string; content: TextContent[] }[] = [];
  for (const entry of entries) {
    if (entry?.type !== 'message') continue;
    const message = entry.message;
    const role = typeof message?.role === 'string' ? message.role : undefined;
    if (role === undefined) continue;
    out.push({ role, content: textOf(message?.content) });
  }
  return out;
}

/** `UserMessage.content` is `string | (TextContent | ImageContent)[]`. Both are real; handle both. */
function textOf(content: unknown): TextContent[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  const parts: TextContent[] = [];
  for (const part of content) {
    const text = (part as { type?: unknown; text?: unknown } | null)?.text;
    if ((part as { type?: unknown } | null)?.type === 'text' && typeof text === 'string') parts.push({ type: 'text', text });
  }
  return parts;
}

function safeSessionId(ctx: ExtensionContextLike): string {
  let id: string;
  try {
    id = ctx.sessionManager.getSessionId();
  } catch {
    return `pid-${process.pid}`;
  }
  // Never let a session id become a path of its own.
  const clean = id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return clean.length > 0 ? clean : `pid-${process.pid}`;
}

/**
 * Walk up from pi's working directory for a xezar project's `.local/xezar`. Discovery, not
 * configuration: the person tells this extension nothing, and a directory that is not a xezar
 * project simply gets no leader socket.
 */
function findProjectDataDir(cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (let depth = 0; depth < 40; depth += 1) {
    const candidate = join(dir, XEZAR_DATA_DIR);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/** Atomic (tmp + rename) at 0600, like every other descriptor xezar writes. */
function writeDescriptor(path: string, input: { socket: string; sessionId: string }): void {
  const descriptor = {
    schemaVersion: SCHEMA_VERSION,
    session: { pid: process.pid, startedAt: new Date().toISOString(), sessionId: input.sessionId },
    endpoint: { socket: input.socket },
  };
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(descriptor, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* Nothing further to do: without a descriptor xezar simply reports no pi leader. */
    }
  }
}

/** Exported for xezar's own tests; pi only ever uses the default export. */
export const __internals = { conversation, textOf, handle, findProjectDataDir, writeDescriptor, readDescriptor, makePrivateSocketDir, safeSessionId, serve };

function readDescriptor(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}
