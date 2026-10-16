<script lang="ts">
  /** Pre-request | Post-response segments (SC1); a dot marks a stage with a script, red when it failed (SC6). */
  import { t } from '$shared/i18n';
  import type { ScriptStage } from '$shared/model';
  import { Segmented } from '$shared/ui/components';

  let {
    stage,
    onStage,
    has,
    failed,
  }: {
    stage: ScriptStage;
    onStage: (s: ScriptStage) => void;
    has: Record<ScriptStage, boolean>;
    failed?: ScriptStage;
  } = $props();

  const STAGES: { id: ScriptStage; label: string; icon: string }[] = [
    { id: 'pre', label: 'script.pre.name', icon: 'play_circle' },
    { id: 'post', label: 'script.post.name', icon: 'fact_check' },
  ];
</script>

<Segmented class="bs-script-stages" role="tablist" aria-label={t('script.stages')}>
  {#each STAGES as s (s.id)}
    <button
      type="button"
      role="tab"
      class:on={stage === s.id}
      aria-selected={stage === s.id}
      onclick={() => onStage(s.id)}
    >
      <span class="material-symbols-outlined" aria-hidden="true">{s.icon}</span>{t(
        s.label,
      )}{#if has[s.id] || failed === s.id}<span
          class="dot"
          class:bad={failed === s.id}
          title={failed === s.id ? t('script.failed') : t('script.has')}
        ></span>{/if}
    </button>
  {/each}
</Segmented>

<style>
  :global(.bs-script-stages) button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  :global(.bs-script-stages) .material-symbols-outlined {
    font-size: 14px;
    color: var(--t3);
  }
  :global(.bs-script-stages) button.on .material-symbols-outlined {
    color: var(--text);
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--t3);
  }
  .dot.bad {
    background: var(--color-danger);
  }
</style>
