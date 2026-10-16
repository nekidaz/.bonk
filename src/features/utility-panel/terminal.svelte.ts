// Flow · Терминал (CT4–CT6): the user's own login shell in a PTY, drawn by xterm.js (the
// terminal emulator VS Code uses). One session for the app: it lives here, outside the
// component, so the shell and its scrollback survive closing the panel (⌘J) and switching tabs.
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

class Terminal {
  /** A shell is running (false before the first open and after it exits). */
  alive = $state(false);
  #term: XTerm | null = null;
  #fit = new FitAddon();
  #id = '';
  /** Text waiting for the shell's first output before it's pasted (a console hand-off). */
  #pending: string | null = null;
  #ready = false;

  /** Shows the terminal in `host`, creating it and the shell on first use; returns the detach. */
  attach(host: HTMLElement): () => void {
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
      term.loadAddon(this.#fit);
      term.onData((data) => this.#input(data));
      term.onResize(({ cols, rows }) => {
        if (this.#id) void ptyResize(this.#id, cols, rows).catch(() => {});
      });
      term.open(host);
      this.#term = term;
    } else if (term.element) {
      host.appendChild(term.element);
    }
    term.options.theme = themeFrom(host);
    const resize = new ResizeObserver(() => {
      if (host.clientWidth && host.clientHeight) this.#fit.fit();
    });
    resize.observe(host);
    this.#fit.fit();
    if (!untrack(() => this.alive)) this.#start();
    term.focus();
    return () => resize.disconnect();
  }

  clear(): void {
    this.#term?.clear();
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
    if (this.#id) void ptyWrite(this.#id, '\x15');
    this.#term?.paste(text);
    this.#term?.focus();
  }

  #input(data: string): void {
    if (this.#id) {
      void ptyWrite(this.#id, data).catch(() => {});
    } else if (data === '\r') {
      this.#start();
    }
  }

  #start(): void {
    const term = this.#term;
    if (!term) return;
    const id = crypto.randomUUID();
    this.#id = id;
    this.#ready = false;
    this.alive = true;
    ptyOpen(id, workspace.path || null, term.cols, term.rows, (event) => {
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
    }).catch((error) => {
      this.#stop(id);
      const text = String(error);
      term.write(`${text.includes('__TAURI_INTERNALS__') ? t('util.terminal.desktop_only') : text}\r\n`);
    });
  }

  #stop(id: string): void {
    if (this.#id !== id) return;
    this.#id = '';
    this.alive = false;
    void ptyClose(id).catch(() => {});
  }
}

export const terminal = new Terminal();
