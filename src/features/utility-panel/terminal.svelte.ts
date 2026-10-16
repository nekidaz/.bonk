// Flow · Терминал (CT4–CT6): the user's own login shell in a PTY, drawn by xterm.js (the
// terminal emulator VS Code uses). Sessions live here, outside the component, so the shells
// and their scrollback survive closing the panel (⌘J) and switching tabs.
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { untrack } from 'svelte';
import { workspace } from '$entities/workspace';
import { t } from '$shared/i18n';
import { ptyClose, ptyOpen, ptyResize, ptyStageEnv, ptyWrite } from '$shared/ipc';

const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/** xterm colours from the app theme; the background stays the panel's own. */
function themeFrom(el: HTMLElement) {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim() || undefined;
  const accent = v('--accent');
  return {
    background: '#00000000',
    foreground: v('--text'),
    cursor: accent,
    cursorAccent: v('--canvas') ?? v('--surface'),
    // `#rrggbb` + 25% alpha; other formats keep xterm's default.
    selectionBackground: accent?.length === 7 ? `${accent}40` : undefined,
  };
}

/** One shell: its xterm screen and its PTY. The screen element moves between hosts. */
export class TerminalSession {
  readonly key = crypto.randomUUID();
  /** `zsh`, `bash`, `cmd`: known once the shell starts. */
  shell = $state('');
  /** The shell is running (false after `exit`; Enter starts it again). */
  alive = $state(false);
  readonly fit = new FitAddon();
  #term: XTerm | null = null;
  #pty = '';
  /** Text waiting for the shell's first output before it's pasted (a console hand-off). */
  #pending: string | null = null;
  #ready = false;

  /** Puts the screen into `host`; the first time also starts the shell. */
  mount(host: HTMLElement): void {
    let term = this.#term;
    if (!term) {
      term = new XTerm({
        allowTransparency: true,
        cursorBlink: true,
        fontFamily: getComputedStyle(host).getPropertyValue('--mono').trim() || 'monospace',
        fontSize: 12,
        macOptionIsMeta: true,
        scrollback: 5000,
      });
      term.loadAddon(this.fit);
      term.onData((data) => this.#input(data));
      term.onResize(({ cols, rows }) => {
        if (this.#pty) void ptyResize(this.#pty, cols, rows).catch(() => {});
      });
      term.open(host);
      this.#term = term;
      this.#start();
    } else if (term.element) {
      host.appendChild(term.element);
    }
    term.options.theme = themeFrom(host);
    this.refit(host);
    term.focus();
  }

  unmount(): void {
    this.#term?.element?.remove();
  }

  refit(host: HTMLElement): void {
    if (host.clientWidth && host.clientHeight) this.fit.fit();
  }

  clear(): void {
    this.#term?.clear();
  }

  /** Kills the shell and frees the screen. */
  dispose(): void {
    this.#stop(this.#pty);
    this.#term?.dispose();
    this.#term = null;
  }

  /**
   * CT6: puts a command from the console at the prompt, unsent; Enter runs it. Secrets go
   * through an owner-only file the subshell sources and deletes, so `$BONK_*` values stay
   * out of the typed text and the history.
   */
  async handOff(command: string, env: Record<string, string>): Promise<void> {
    let text = command;
    if (Object.keys(env).length) {
      try {
        const file = sq(await ptyStageEnv(env));
        text = `(. ${file}; rm -f ${file}; ${command})`;
      } catch (error) {
        this.#term?.write(`\r\n${String(error)}\r\n`);
        return;
      }
    }
    if (this.#ready) this.#paste(text);
    else this.#pending = text;
  }

  #paste(text: string): void {
    // ⌃U drops whatever was half-typed; paste() uses bracketed paste, so newlines don't run it.
    if (this.#pty) void ptyWrite(this.#pty, '\x15');
    this.#term?.paste(text);
    this.#term?.focus();
  }

  #input(data: string): void {
    if (this.#pty) void ptyWrite(this.#pty, data).catch(() => {});
    else if (data === '\r') this.#start();
  }

  #start(): void {
    const term = this.#term;
    if (!term) return;
    const id = crypto.randomUUID();
    this.#pty = id;
    this.#ready = false;
    this.alive = true;
    ptyOpen(id, workspace.path || null, term.cols, term.rows, (event) => {
      if (this.#pty !== id) return;
      if (event.type === 'data') {
        term.write(event.text);
        if (!this.#ready) {
          this.#ready = true;
          const pending = this.#pending;
          this.#pending = null;
          if (pending) this.#paste(pending);
        }
        return;
      }
      this.#stop(id);
      term.write(`\r\n\x1b[2m${t('util.terminal.exited')}\x1b[0m\r\n`);
    })
      .then((shell) => (this.shell = shell))
      .catch((error) => {
        this.#stop(id);
        const text = String(error);
        term.write(`${text.includes('__TAURI_INTERNALS__') ? t('util.terminal.desktop_only') : text}\r\n`);
      });
  }

  #stop(id: string): void {
    if (!id || this.#pty !== id) return;
    this.#pty = '';
    this.alive = false;
    void ptyClose(id).catch(() => {});
  }
}

/** The Terminal tab's sessions («+» adds one, the bin kills the active one). */
class Terminals {
  sessions = $state.raw<TerminalSession[]>([]);
  activeKey = $state('');
  active = $derived(this.sessions.find((s) => s.key === this.activeKey));
  /** Any shell running (the dot on the tab). */
  alive = $derived(this.sessions.some((s) => s.alive));

  add(): TerminalSession {
    const session = new TerminalSession();
    this.sessions = [...untrack(() => this.sessions), session];
    this.activeKey = session.key;
    return session;
  }

  /** Kills the active shell; its neighbour becomes active. */
  kill(): void {
    const list = untrack(() => this.sessions);
    const at = list.findIndex((s) => s.key === untrack(() => this.activeKey));
    if (at < 0) return;
    list[at].dispose();
    const next = list.filter((_, i) => i !== at);
    this.sessions = next;
    this.activeKey = next[Math.min(at, next.length - 1)]?.key ?? '';
  }

  clear(): void {
    untrack(() => this.active)?.clear();
  }

  handOff(command: string, env: Record<string, string>): Promise<void> {
    return (untrack(() => this.active) ?? this.add()).handOff(command, env);
  }
}

export const terminal = new Terminals();
