<script lang="ts">
  import { tabs } from '../stores';
  import { GIT_ENABLED } from '../git';
</script>

<div class="bs-status">
  {#if GIT_ENABLED}<div class="it"><span class="material-symbols-outlined" style="font-size:14px">commit</span>Connect Git</div>{/if}
  <div class="it"><span class="material-symbols-outlined" style="font-size:14px">terminal</span>Console</div>
  <div class="it"><span class="material-symbols-outlined" style="font-size:14px">terminal</span>Terminal</div>
  <div class="it"><span class="material-symbols-outlined" style="font-size:14px;color:var(--t3)">do_not_disturb_on</span>0</div>
  <div class="it"><span class="material-symbols-outlined" style="font-size:14px;color:var(--t3)">warning</span>0</div>
  <div class="bs-spacer"></div>
  <div class="it">{$tabs.length} tab{$tabs.length === 1 ? '' : 's'}</div>
  <div class="it">Vault</div>
  <div class="it">Tools</div>
</div>
