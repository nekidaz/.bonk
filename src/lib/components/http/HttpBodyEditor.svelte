<script lang="ts">
  import { filePick } from '../../api';
  import { bodyEditorHtml, lineNumbers, syncJsonScroll, formatMarkup } from '../../domain/highlight';
  import {
    currentBodyMode,
    currentRawFormat,
  } from '../../domain/httpBody';
  import { bodyParamRows, emptyBodyParam, fileName } from '../../domain/httpHeaders';
  import {
    bodyPlaceholder,
    jsonErrorMessage,
    maybeInsertCommaBeforeJsonValue,
    parseJsonForBeautify,
  } from '../../domain/jsonEditor';
  import { updateActiveTab } from '../../stores';
  import type { BodyMode, BodyParamKind, RawBodyFormat, Tab } from '../../domain/types';

  let { tab }: { tab: Tab } = $props();

  let bodyError = $state('');

  const bodyModes: { key: BodyMode; label: string }[] = [
    { key: 'none', label: 'none' },
    { key: 'form-data', label: 'form-data' },
    { key: 'urlencoded', label: 'x-www-form-urlencoded' },
    { key: 'raw', label: 'raw' },
    { key: 'binary', label: 'binary' },
    { key: 'graphql', label: 'GraphQL' },
  ];
  const rawFormats: RawBodyFormat[] = ['JSON', 'Text', 'JavaScript', 'HTML', 'XML'];

  const activeHttpBodyLines = $derived(lineNumbers(tab.request.body));
  const activeHttpBodyHtml = $derived(bodyEditorHtml(tab));

  function setBody(value: string): void {
    bodyError = '';
    updateActiveTab((t) => ({ ...t, request: { ...t.request, body: value } }));
  }

  function setBodyMode(mode: BodyMode): void {
    bodyError = '';
    updateActiveTab((t) => {
      const nextRequest = { ...t.request, bodyMode: mode };
      if (mode === 'raw' && !nextRequest.rawBodyFormat) nextRequest.rawBodyFormat = 'JSON';
      return { ...t, request: nextRequest };
    });
  }

  function setRawFormat(format: RawBodyFormat): void {
    bodyError = '';
    updateActiveTab((t) => ({ ...t, request: { ...t.request, bodyMode: 'raw', rawBodyFormat: format } }));
  }

  function setBodyParam(i: number, field: 'key' | 'value' | 'description' | 'filePath', value: string): void {
    updateActiveTab((t) => {
      const rows = [...(t.request.bodyParams ?? [])];
      while (i >= rows.length) rows.push(emptyBodyParam());
      rows[i] = { ...emptyBodyParam(), ...rows[i], [field]: value };
      return { ...t, request: { ...t.request, bodyParams: rows } };
    });
  }

  function setBodyParamKind(i: number, kind: BodyParamKind): void {
    updateActiveTab((t) => {
      const rows = [...(t.request.bodyParams ?? [])];
      while (i >= rows.length) rows.push(emptyBodyParam());
      rows[i] = {
        ...emptyBodyParam(),
        ...rows[i],
        kind,
        filePath: kind === 'file' ? rows[i]?.filePath : undefined,
      };
      return { ...t, request: { ...t.request, bodyParams: rows } };
    });
  }

  async function pickBodyFile(i: number): Promise<void> {
    const path = await filePick();
    if (!path) return;
    updateActiveTab((t) => {
      const rows = [...(t.request.bodyParams ?? [])];
      while (i >= rows.length) rows.push(emptyBodyParam());
      rows[i] = { ...emptyBodyParam(), ...rows[i], kind: 'file', value: fileName(path), filePath: path };
      return { ...t, request: { ...t.request, bodyParams: rows } };
    });
  }

  function toggleBodyParam(i: number): void {
    updateActiveTab((t) => {
      const rows = [...(t.request.bodyParams ?? [])];
      if (rows[i]) rows[i] = { ...rows[i], enabled: !rows[i].enabled };
      return { ...t, request: { ...t.request, bodyParams: rows } };
    });
  }

  function beautifyBody(): void {
    const body = tab.request.body ?? '';
    const format = currentRawFormat(tab);
    try {
      if (format === 'JSON') setBody(JSON.stringify(parseJsonForBeautify(body), null, 2));
      else if (format === 'HTML' || format === 'XML') setBody(formatMarkup(body));
      else setBody(body);
      bodyError = '';
    } catch (e) {
      bodyError = format === 'JSON' ? jsonErrorMessage(body, e) : `${format} body is not valid.`;
    }
  }

  function setTextareaValue(textarea: HTMLTextAreaElement, value: string, start: number, end = start): void {
    setBody(value);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, end);
      syncJsonScroll({ currentTarget: textarea } as unknown as Event);
    });
  }

  function insertTextareaText(textarea: HTMLTextAreaElement, text: string, cursorOffset = text.length): void {
    const value = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
    setTextareaValue(textarea, next, start + cursorOffset);
  }

  function handleJsonBodyKeydown(e: KeyboardEvent): void {
    if (currentRawFormat(tab) !== 'JSON' && e.key !== 'Tab') return;
    const textarea = e.currentTarget as HTMLTextAreaElement;
    const value = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (e.key === 'Tab') {
      e.preventDefault();
      insertTextareaText(textarea, '  ');
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const before = value.slice(0, start);
      const after = value.slice(end);
      const currentLine = before.slice(before.lastIndexOf('\n') + 1);
      const indent = currentLine.match(/^\s*/)?.[0] ?? '';
      const trimmed = currentLine.trimEnd();
      const deeper = /[{\[]$/.test(trimmed) ? `${indent}  ` : indent;
      if (/^[}\]]/.test(after.trimStart()) && deeper !== indent) {
        const insert = `\n${deeper}\n${indent}`;
        setTextareaValue(textarea, `${before}${insert}${after}`, before.length + deeper.length + 1);
      } else {
        insertTextareaText(textarea, `\n${deeper}`);
      }
      return;
    }

    const pairs: Record<string, string> = { '{': '}', '[': ']', '"': '"' };
    if (pairs[e.key]) {
      if (e.key === '"' && value[start] === '"' && start === end) {
        e.preventDefault();
        textarea.setSelectionRange(start + 1, start + 1);
        return;
      }
      e.preventDefault();
      let nextValue = value;
      let nextStart = start;
      let nextEnd = end;
      if (e.key === '"') {
        const comma = maybeInsertCommaBeforeJsonValue(nextValue, nextStart);
        nextValue = comma.value;
        nextStart = comma.cursor;
        nextEnd = nextEnd + (comma.cursor - start);
      }
      const selected = nextValue.slice(nextStart, nextEnd);
      const pair = `${e.key}${selected}${pairs[e.key]}`;
      setTextareaValue(
        textarea,
        `${nextValue.slice(0, nextStart)}${pair}${nextValue.slice(nextEnd)}`,
        selected ? nextStart + pair.length : nextStart + 1,
        selected ? nextStart + pair.length : nextStart + 1,
      );
      return;
    }

    if ((e.key === '}' || e.key === ']') && value[start] === e.key && start === end) {
      e.preventDefault();
      textarea.setSelectionRange(start + 1, start + 1);
      return;
    }

    if (e.key === 'Backspace' && start === end && start > 0) {
      const left = value[start - 1];
      const right = value[start];
      if ((left === '{' && right === '}') || (left === '[' && right === ']') || (left === '"' && right === '"')) {
        e.preventDefault();
        setTextareaValue(textarea, `${value.slice(0, start - 1)}${value.slice(start + 1)}`, start - 1);
      }
    }
  }
</script>

<div class="bs-http-body">
  <div class="bs-body-toolbar">
    <div class="bs-body-mode-group" role="radiogroup" aria-label="Body type">
      {#each bodyModes as mode (mode.key)}
        <button
          class:on={currentBodyMode(tab) === mode.key}
          role="radio"
          aria-checked={currentBodyMode(tab) === mode.key}
          type="button"
          onclick={() => setBodyMode(mode.key)}
        >
          <span class="dot"></span>
          {mode.label}
        </button>
      {/each}
    </div>
    <div class="bs-body-actions">
      {#if currentBodyMode(tab) === 'raw'}
        <button class="schema" type="button" title="Schema support is not implemented yet">
          <span class="material-symbols-outlined" style="font-size:16px">tune</span>
          Schema
        </button>
        <select value={currentRawFormat(tab)} onchange={(e) => setRawFormat(e.currentTarget.value as RawBodyFormat)}>
          {#each rawFormats as format (format)}
            <option value={format}>{format}</option>
          {/each}
        </select>
        <button class="beautify" type="button" onclick={beautifyBody}>Beautify</button>
      {/if}
    </div>
  </div>

  {#if bodyError}<div class="bs-body-error">{bodyError}</div>{/if}

  {#if currentBodyMode(tab) === 'none'}
    <div class="bs-body-empty">
      <span class="material-symbols-outlined" style="font-size:34px">hide_source</span>
      <div>No request body will be sent.</div>
    </div>
  {:else if currentBodyMode(tab) === 'form-data' || currentBodyMode(tab) === 'urlencoded'}
    <div class="bs-body-kv" class:formdata={currentBodyMode(tab) === 'form-data'}>
      <div class="bs-body-kv-row h">
        <div class="c on"></div>
        <div class="c key">Key</div>
        {#if currentBodyMode(tab) === 'form-data'}<div class="c type">Type</div>{/if}
        <div class="c val">Value</div>
        <div class="c desc">Description</div>
      </div>
      {#each bodyParamRows(tab) as row, i (i)}
        <div class="bs-body-kv-row">
          <div class="c on">
            <input type="checkbox" checked={row.enabled} onchange={() => toggleBodyParam(i)} aria-label="Enable body parameter" />
          </div>
          <div class="c key"><input placeholder="Key" value={row.key} oninput={(e) => setBodyParam(i, 'key', e.currentTarget.value)} /></div>
          {#if currentBodyMode(tab) === 'form-data'}
            <div class="c type">
              <select value={row.kind ?? 'text'} onchange={(e) => setBodyParamKind(i, e.currentTarget.value as BodyParamKind)} aria-label="Body parameter type">
                <option value="text">Text</option>
                <option value="file">File</option>
              </select>
            </div>
          {/if}
          <div class="c val">
            {#if currentBodyMode(tab) === 'form-data' && (row.kind ?? 'text') === 'file'}
              <button class="bs-file-picker" type="button" onclick={() => pickBodyFile(i)}>
                <span class="material-symbols-outlined" style="font-size:15px">attach_file</span>
                <span>{fileName(row.filePath ?? row.value)}</span>
              </button>
            {:else}
              <input placeholder="Value" value={row.value} oninput={(e) => setBodyParam(i, 'value', e.currentTarget.value)} />
            {/if}
          </div>
          <div class="c desc"><input placeholder="Description" value={row.description} oninput={(e) => setBodyParam(i, 'description', e.currentTarget.value)} /></div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="bs-json-editor bs-http-body-editor" class:invalid={!!bodyError}>
      <div class="bs-json-gutter" aria-hidden="true">
        {#each activeHttpBodyLines as n}
          <div>{n}</div>
        {/each}
      </div>
      {#if !(tab.request.body ?? '').trim()}<div class="bs-json-placeholder">{bodyPlaceholder(tab)}</div>{/if}
      <pre class="bs-json-highlight" aria-hidden="true">{@html activeHttpBodyHtml}</pre>
      <textarea
        spellcheck="false"
        aria-label="Request body"
        value={tab.request.body ?? ''}
        oninput={(e) => setBody(e.currentTarget.value)}
        onkeydown={handleJsonBodyKeydown}
        onscroll={syncJsonScroll}
      ></textarea>
    </div>
  {/if}
</div>
