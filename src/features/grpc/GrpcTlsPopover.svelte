<script lang="ts">
  /**
   * S29/S30: the endpoint bar's connection popover — TLS vs plaintext, the
   * server's certificate, verification toggle, mTLS client cert and custom CA.
   * `open` is bound because GrpcEditor also opens it from the response pane's
   * unreachable state; outside-click and Escape close it from here.
   */
  import { t, uiLanguage } from '$shared/i18n';
  import { currentVarScope } from '$entities/environment';
  import { filePick, grpcTlsInspect } from '$shared/ipc';
  import { resolveVars, type Tab, type GrpcTls, type GrpcCertInfo } from '$shared/model';
  import { certExpiry, fileName } from './grpcEditor';
  import { Switch } from '$shared/ui/components';

  let {
    tab,
    plaintext,
    stripAuth,
    open = $bindable(),
    onPatch,
  }: {
    tab: Tab;
    /** Effective plaintext flag (explicit setting, else inferred from the endpoint). */
    plaintext: boolean;
    stripAuth: boolean;
    open: boolean;
    /** Merge a patch into the active tab's `grpc`. */
    onPatch: (patch: Record<string, unknown>) => void;
  } = $props();

  let cert = $state<{ loading: boolean; info?: GrpcCertInfo; error?: string }>({ loading: false });
  let trigger = $state<HTMLButtonElement | undefined>(undefined);
  const resolvedEndpoint = $derived(resolveVars(tab.grpc?.endpoint ?? '', currentVarScope()));
  const expiry = $derived(cert.info ? certExpiry(cert.info.notAfter, uiLanguage.current) : { days: 0, date: '' });

  function setPlaintext(value: boolean): void {
    if (value === plaintext) return;
    onPatch({ plaintext: value, connectionId: undefined, tree: undefined });
    if (!value) void loadCert();
  }
  function setTls(patch: Partial<GrpcTls>): void {
    const tls = { ...tab.grpc?.tls, ...patch };
    onPatch({ tls, connectionId: undefined, tree: undefined });
    void loadCert(tls);
  }
  async function loadCert(tls = tab.grpc?.tls): Promise<void> {
    const endpoint = resolvedEndpoint.trim();
    if (!endpoint || plaintext) return;
    cert = { loading: true };
    try {
      cert = { loading: false, info: await grpcTlsInspect(endpoint, tls) };
    } catch (e) {
      cert = { loading: false, error: String(e) };
    }
  }
  function toggle(): void {
    open = !open;
    if (open && !plaintext) void loadCert();
  }
  async function pickCa(): Promise<void> {
    const ca = await filePick();
    if (ca) setTls({ caCert: ca });
  }
  async function pickClientCert(): Promise<void> {
    const clientCert = await filePick();
    if (!clientCert) return;
    const clientKey = await filePick();
    if (clientKey) setTls({ clientCert, clientKey });
  }
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      open = false;
      trigger?.focus();
    }
  }
</script>

<div class="bs-grpc-security-wrap" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
  <button
    bind:this={trigger}
    class="bs-grpc-security"
    class:secure={!plaintext}
    class:open
    type="button"
    aria-haspopup="dialog"
    aria-expanded={open}
    title={t('grpc.conn.title')}
    aria-label={plaintext ? 'Plaintext' : 'TLS'}
    onclick={toggle}
  >
    <span class="material-symbols-outlined" aria-hidden="true">{plaintext ? 'lock_open_right' : 'lock'}</span><span
      class="lbl">{plaintext ? 'Plaintext' : 'TLS'}</span
    >
  </button>
  {#if open}
    <div class="bs-conn-pop" role="dialog" aria-label={t('grpc.conn.title')}>
      <div class="cp-head"><span>{t('grpc.conn.title')}</span><span>HTTP/2</span></div>
      <div class="cp-seg" role="radiogroup" aria-label={t('grpc.conn.mode')}>
        <button
          type="button"
          role="radio"
          aria-checked={!plaintext}
          class:on={!plaintext}
          onclick={() => setPlaintext(false)}>TLS</button
        >
        <button
          type="button"
          role="radio"
          aria-checked={plaintext}
          class:on={plaintext}
          onclick={() => setPlaintext(true)}>Plaintext (h2c)</button
        >
      </div>
      {#if plaintext}
        <div class="cp-warn">
          <span class="material-symbols-outlined" aria-hidden="true">warning</span>
          <div>
            <b>{t('grpc.conn.plainWarn')}</b>
            <p>{t('grpc.conn.plainWarnText')}</p>
          </div>
        </div>
        <div class="cp-facts">
          <div><span>{t('grpc.conn.address')}</span><code>{resolvedEndpoint.trim() || '—'}</code></div>
          <div><span>{t('grpc.conn.protocol')}</span><code>{t('grpc.conn.h2c')}</code></div>
        </div>
        <div class="cp-row">
          <span id="bs-cp-auth">{t('grpc.conn.stripAuth')}</span>
          <Switch
            checked={stripAuth}
            aria-labelledby="bs-cp-auth"
            onclick={() => onPatch({ keepAuthOnPlaintext: stripAuth })}
          />
        </div>
      {:else}
        <div class="cp-facts">
          {#if cert.loading}
            <div><span>{t('grpc.conn.cert')}</span><code class="muted">{t('grpc.conn.checking')}</code></div>
          {:else if cert.error}
            <div class="bad">
              <span>{t('grpc.conn.cert')}</span><code title={cert.error}>{t('grpc.conn.noConn')}</code>
            </div>
          {:else if cert.info}
            <div class:bad={!cert.info.verified}>
              <span>{t('grpc.conn.cert')}</span>
              <b class="verdict"
                ><span class="material-symbols-outlined" aria-hidden="true"
                  >{cert.info.verified ? 'verified' : 'gpp_maybe'}</span
                >{cert.info.verified ? t('grpc.conn.verified') : t('grpc.conn.unverified')}</b
              >
            </div>
            {#if !cert.info.verified && cert.info.error}<p class="cp-why">{cert.info.error}</p>{/if}
            <div><span>{t('grpc.conn.issuedTo')}</span><code>{cert.info.subject}</code></div>
            <div><span>{t('grpc.conn.issuer')}</span><code class="ui">{cert.info.issuer}</code></div>
            <div class:bad={expiry.days < 0}>
              <span>{t('grpc.conn.validUntil')}</span><code
                >{expiry.date} · {expiry.days < 0
                  ? t('grpc.conn.expired')
                  : t('grpc.conn.days', { n: expiry.days })}</code
              >
            </div>
          {:else}
            <div><span>{t('grpc.conn.cert')}</span><code class="muted">{t('grpc.conn.enterAddress')}</code></div>
          {/if}
        </div>
        <div class="cp-row">
          <span id="bs-cp-verify">{t('grpc.conn.verify')}</span>
          <Switch
            checked={!tab.grpc?.tls?.insecure}
            aria-labelledby="bs-cp-verify"
            onclick={() => setTls({ insecure: !tab.grpc?.tls?.insecure })}
          />
        </div>
        <div class="cp-row">
          <span>{t('grpc.conn.clientCert')}</span>
          {#if tab.grpc?.tls?.clientCert}
            <code class="file" title={tab.grpc.tls.clientCert}>{fileName(tab.grpc.tls.clientCert)}</code>
            <button
              class="cp-x"
              type="button"
              aria-label={t('grpc.conn.removeCert')}
              onclick={() => setTls({ clientCert: undefined, clientKey: undefined })}
              ><span class="material-symbols-outlined">close</span></button
            >
          {:else}
            <span class="muted">{t('grpc.conn.notSet')}</span>
            <button class="cp-link" type="button" title={t('grpc.conn.pickCert')} onclick={pickClientCert}
              >{t('grpc.conn.add')}</button
            >
          {/if}
        </div>
        <div class="cp-row">
          <span>{t('grpc.conn.trustedCa')}</span>
          {#if tab.grpc?.tls?.caCert}
            <code class="file" title={tab.grpc.tls.caCert}>{fileName(tab.grpc.tls.caCert)}</code>
            <button
              class="cp-x"
              type="button"
              aria-label={t('grpc.conn.restoreCa')}
              onclick={() => setTls({ caCert: undefined })}><span class="material-symbols-outlined">close</span></button
            >
          {:else}
            <button class="cp-link" type="button" title={t('grpc.conn.addCa')} onclick={pickCa}
              >{t('grpc.conn.system')}<span class="material-symbols-outlined" aria-hidden="true">chevron_right</span
              ></button
            >
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
<svelte:window onpointerdown={() => (open = false)} onkeydown={onKeydown} />

<style>
  :global(.bs .bs-grpc-field) .bs-grpc-security:hover {
    background: color-mix(in srgb, currentColor 20%, transparent);
  }

  :global(.bs .bs-grpc-field) .bs-grpc-security.open {
    background: color-mix(in srgb, currentColor 20%, transparent);
  }

  :global(.bs .bs-grpc-field) .bs-grpc-security:focus-visible {
    background: color-mix(in srgb, currentColor 20%, transparent);
  }

  /* Belongs to grpc.css, but the cascade needs it before `:root .bs .bs-work-menu .bs-work-item .meta span` (same elements, same specificity), so it lives here. */
  :global(.bs) .bs-conn-pop .cp-head :global(span:first-child) {
    font-weight: 500;
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  /* Clear states without decorative gradients or floating shadows. */
  .bs-grpc-security-wrap {
    position: relative;
    align-self: stretch;
    flex: 0 0 44px;
  }

  :global(.bs) button.bs-grpc-security {
    width: 44px;
    height: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--orange);
    background: transparent;
    border-right: 1px solid var(--sepsoft);
    border-radius: 7px 0 0 7px;
  }

  :global(:where(.bs)) button.bs-grpc-security:hover {
    background: var(--hover);
  }

  :global(:where(.bs)) button.bs-grpc-security:focus-visible {
    background: var(--hover);
  }

  :global(:where(.bs)) button.bs-grpc-security.secure {
    color: var(--green);
  }

  .bs-grpc-security {
    color: var(--color-text-secondary);
  }

  :global(.bs .bs-grpc-field) .bs-grpc-security-wrap {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    margin-left: -2px;
  }

  /* S29/S30: a tinted pill — green TLS, amber PLAINTEXT. width:auto undoes the legacy 44px icon button. */
  :global(.bs .bs-grpc-field) .bs-grpc-security {
    width: auto;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 20px;
    padding: 0 7px;
    border: 0;
    border-radius: 999px;
    outline: 0;
    background: var(--color-success-soft);
    color: var(--color-success);
    font: 600 9px var(--font-code);
    letter-spacing: 0.6px;
    text-transform: uppercase;
  }

  :global(.bs .bs-grpc-field) .bs-grpc-security :global(.material-symbols-outlined) {
    font-size: 11px;
  }

  @media (max-width: 760px) {
    :global(.bs .bs-grpc-field) .bs-grpc-security :global(.lbl) {
      display: none;
    }
  }

  /* S29/S30: connection popover — TLS / plaintext, certificate, mTLS, CA. */
  :global(.bs) .bs-conn-pop {
    position: absolute;
    z-index: 80;
    top: calc(100% + 3px);
    left: -30px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 380px;
    padding: 14px;
    border: 1px solid var(--color-border);
    border-radius: 22px;
    background: var(--color-raised);
    box-shadow: 0 16px 40px var(--color-shadow, rgba(0, 0, 0, 0.14));
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
    text-transform: none;
    letter-spacing: 0;
  }

  :global(.bs) .bs-conn-pop .cp-head {
    display: flex;
    justify-content: space-between;
    height: 13px;
    color: var(--color-text-muted);
    font: var(--font-size-micro)/13px var(--font-code);
  }

  :global(.bs) .bs-conn-pop .cp-seg {
    display: flex;
    gap: 2px;
    height: 30px;
    padding: 3px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
  }

  :global(.bs) .bs-conn-pop .cp-seg :global(button) {
    flex: 1;
    height: 24px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
  }

  :global(.bs) .bs-conn-pop .cp-seg :global(button.on) {
    background: var(--color-raised);
    color: var(--color-text);
    font-weight: 600;
  }

  :global(.bs) .bs-conn-pop .cp-facts {
    display: flex;
    flex-direction: column;
    padding: 4px 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-field);
  }

  :global(.bs) .bs-conn-pop .cp-facts > :global(div) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 33px;
    padding: 9px 2px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-body);
  }

  :global(.bs) .bs-conn-pop .cp-facts > :global(div + div) {
    border-top: 1px solid var(--color-border-subtle);
  }

  :global(.bs) .bs-conn-pop .cp-facts :global(code) {
    min-width: 0;
    overflow: hidden;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.bs) .bs-conn-pop .cp-facts :global(code.ui) {
    font-family: var(--font-ui);
  }

  :global(.bs) .bs-conn-pop .cp-facts :global(code.muted) {
    color: var(--color-text-muted);
    font-family: var(--font-ui);
  }

  :global(.bs) .bs-conn-pop .cp-facts .verdict {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-success);
    font-weight: 600;
  }

  :global(.bs) .bs-conn-pop .cp-facts .verdict :global(.material-symbols-outlined) {
    font-size: 14px;
  }

  :global(.bs) .bs-conn-pop .cp-facts :global(.bad :is(.verdict, code)) {
    color: var(--color-danger);
  }

  :global(.bs) .bs-conn-pop .cp-why {
    margin: 0;
    padding: 0 2px 9px;
    color: var(--color-danger);
    font: var(--font-size-caption)/1.4 var(--font-code);
  }

  :global(.bs) .bs-conn-pop .cp-warn {
    display: flex;
    gap: 10px;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
  }

  :global(.bs) .bs-conn-pop .cp-warn > :global(.material-symbols-outlined) {
    font-size: 16px;
    color: var(--color-warning);
  }

  :global(.bs) .bs-conn-pop .cp-warn :global(b) {
    color: var(--color-warning);
    font-weight: 600;
  }

  :global(.bs) .bs-conn-pop .cp-warn :global(p) {
    margin: 4px 0 0;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  :global(.bs) .bs-conn-pop .cp-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 33px;
    padding: 9px 4px;
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-conn-pop .cp-row + .cp-row {
    border-top: 1px solid var(--color-border-subtle);
  }

  :global(.bs) .bs-conn-pop .cp-row > :global(span:first-child) {
    flex: 1;
    min-width: 0;
  }

  :global(.bs) .bs-conn-pop .cp-row :global(.muted) {
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-conn-pop .cp-row :global(code.file) {
    max-width: 140px;
    overflow: hidden;
    color: var(--color-text);
    font: var(--font-size-caption) var(--font-code);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.bs) .bs-conn-pop .cp-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    color: var(--color-text);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-conn-pop .cp-link:hover {
    background: var(--color-hover);
  }

  :global(.bs) .bs-conn-pop .cp-link :global(.material-symbols-outlined) {
    font-size: 14px;
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-conn-pop .cp-x {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-conn-pop .cp-x:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }

  :global(.bs) .bs-conn-pop .cp-x :global(.material-symbols-outlined) {
    font-size: 14px;
  }
</style>
