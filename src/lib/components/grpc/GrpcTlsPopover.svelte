<script lang="ts">
  /**
   * S29/S30: the endpoint bar's connection popover — TLS vs plaintext, the
   * server's certificate, verification toggle, mTLS client cert and custom CA.
   * `open` is bound because GrpcEditor also opens it from the response pane's
   * unreachable state; outside-click and Escape close it from here.
   */
  import { t } from '../../i18n';
  import { uiLanguage } from '../../stores/prefs';
  import { currentVarScope } from '../../stores';
  import { filePick, grpcTlsInspect } from '../../api';
  import { resolveVars } from '../../domain/vars';
  import { certExpiry, fileName } from '../../domain/grpcEditor';
  import type { Tab, GrpcTls, GrpcCertInfo } from '../../domain/types';

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
  const expiry = $derived(cert.info ? certExpiry(cert.info.notAfter, $uiLanguage) : { days: 0, date: '' });

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
    title={$t('grpc.conn.title')}
    onclick={toggle}
  >
    <span class="material-symbols-outlined">{plaintext ? 'lock_open_right' : 'lock'}</span>{plaintext ? 'Plaintext' : 'TLS'}
  </button>
  {#if open}
    <div class="bs-conn-pop" role="dialog" aria-label={$t('grpc.conn.title')}>
      <div class="cp-head"><span>{$t('grpc.conn.title')}</span><span>HTTP/2</span></div>
      <div class="cp-seg" role="radiogroup" aria-label={$t('grpc.conn.mode')}>
        <button type="button" role="radio" aria-checked={!plaintext} class:on={!plaintext} onclick={() => setPlaintext(false)}>TLS</button>
        <button type="button" role="radio" aria-checked={plaintext} class:on={plaintext} onclick={() => setPlaintext(true)}>Plaintext (h2c)</button>
      </div>
      {#if plaintext}
        <div class="cp-warn">
          <span class="material-symbols-outlined" aria-hidden="true">warning</span>
          <div><b>{$t('grpc.conn.plainWarn')}</b><p>{$t('grpc.conn.plainWarnText')}</p></div>
        </div>
        <div class="cp-facts">
          <div><span>{$t('grpc.conn.address')}</span><code>{resolvedEndpoint.trim() || '—'}</code></div>
          <div><span>{$t('grpc.conn.protocol')}</span><code>{$t('grpc.conn.h2c')}</code></div>
        </div>
        <div class="cp-row">
          <span id="bs-cp-auth">{$t('grpc.conn.stripAuth')}</span>
          <button class="mono-switch" type="button" role="switch" aria-checked={stripAuth} aria-labelledby="bs-cp-auth" onclick={() => onPatch({ keepAuthOnPlaintext: stripAuth })}></button>
        </div>
      {:else}
        <div class="cp-facts">
          {#if cert.loading}
            <div><span>{$t('grpc.conn.cert')}</span><code class="muted">{$t('grpc.conn.checking')}</code></div>
          {:else if cert.error}
            <div class="bad"><span>{$t('grpc.conn.cert')}</span><code title={cert.error}>{$t('grpc.conn.noConn')}</code></div>
          {:else if cert.info}
            <div class:bad={!cert.info.verified}>
              <span>{$t('grpc.conn.cert')}</span>
              <b class="verdict"><span class="material-symbols-outlined" aria-hidden="true">{cert.info.verified ? 'verified' : 'gpp_maybe'}</span>{cert.info.verified ? $t('grpc.conn.verified') : $t('grpc.conn.unverified')}</b>
            </div>
            {#if !cert.info.verified && cert.info.error}<p class="cp-why">{cert.info.error}</p>{/if}
            <div><span>{$t('grpc.conn.issuedTo')}</span><code>{cert.info.subject}</code></div>
            <div><span>{$t('grpc.conn.issuer')}</span><code class="ui">{cert.info.issuer}</code></div>
            <div class:bad={expiry.days < 0}><span>{$t('grpc.conn.validUntil')}</span><code>{expiry.date} · {expiry.days < 0 ? $t('grpc.conn.expired') : $t('grpc.conn.days', { n: expiry.days })}</code></div>
          {:else}
            <div><span>{$t('grpc.conn.cert')}</span><code class="muted">{$t('grpc.conn.enterAddress')}</code></div>
          {/if}
        </div>
        <div class="cp-row">
          <span id="bs-cp-verify">{$t('grpc.conn.verify')}</span>
          <button class="mono-switch" type="button" role="switch" aria-checked={!tab.grpc?.tls?.insecure} aria-labelledby="bs-cp-verify" onclick={() => setTls({ insecure: !tab.grpc?.tls?.insecure })}></button>
        </div>
        <div class="cp-row">
          <span>{$t('grpc.conn.clientCert')}</span>
          {#if tab.grpc?.tls?.clientCert}
            <code class="file" title={tab.grpc.tls.clientCert}>{fileName(tab.grpc.tls.clientCert)}</code>
            <button class="cp-x" type="button" aria-label={$t('grpc.conn.removeCert')} onclick={() => setTls({ clientCert: undefined, clientKey: undefined })}><span class="material-symbols-outlined">close</span></button>
          {:else}
            <span class="muted">{$t('grpc.conn.notSet')}</span>
            <button class="cp-link" type="button" title={$t('grpc.conn.pickCert')} onclick={pickClientCert}>{$t('grpc.conn.add')}</button>
          {/if}
        </div>
        <div class="cp-row">
          <span>{$t('grpc.conn.trustedCa')}</span>
          {#if tab.grpc?.tls?.caCert}
            <code class="file" title={tab.grpc.tls.caCert}>{fileName(tab.grpc.tls.caCert)}</code>
            <button class="cp-x" type="button" aria-label={$t('grpc.conn.restoreCa')} onclick={() => setTls({ caCert: undefined })}><span class="material-symbols-outlined">close</span></button>
          {:else}
            <button class="cp-link" type="button" title={$t('grpc.conn.addCa')} onclick={pickCa}>{$t('grpc.conn.system')}<span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
<svelte:window onpointerdown={() => (open = false)} onkeydown={onKeydown} />
