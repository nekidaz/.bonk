<!--
  HTTP request → Body tab → GraphQL: the Query editor (schema completion, lint, status chip) over the
  Variables editor; the schema explorer (Task 6) goes on the right. Mounted only while the GraphQL body
  is on screen, so its effect is the "body is visible" condition of the auto-introspection.
-->
<script lang="ts">
  import type { Extension } from '@codemirror/state';
  import { t } from '$shared/i18n';
  import { bodyPlaceholder, graphqlExtensions } from '$shared/editor';
  import { CodeEditor } from '$shared/editor/components';
  import type { Tab } from '$shared/model';
  import { tabs } from '$entities/tab';
  import { BodyCode } from '$entities/request/components';
  import { graphqlExplorerOpen, graphqlSchemas } from './graphqlSchemas.svelte';
  import GraphqlSchemaChip from './GraphqlSchemaChip.svelte';
  import GraphqlExplorer from './GraphqlExplorer.svelte';
  import type { ExplorerHit } from './graphqlExplorer';
  import { appendOperation, type RootKind } from './graphqlOperation';

  let { tab, varHighlight }: { tab: Tab; varHighlight?: Extension } = $props();

  // A string: the effect below re-runs only when the endpoint changes, not on every keystroke in the body.
  const endpoint = $derived(graphqlSchemas.keysOf(tab)?.cache);
  const entry = $derived(graphqlSchemas.entryFor(tab));
  const schema = $derived(entry?.status === 'ready' ? entry.schema : undefined);
  // Rebuilt only when the schema changes; CodeEditor reconfigures it in place (cursor and undo stay).
  const extensions = $derived(graphqlExtensions(schema, openInExplorer));

  // Auto-introspection: the endpoint has been still for 800 ms. `ensure` is a no-op once the endpoint
  // has any entry (loading, ready or error), so a failure is never retried from here.
  $effect(() => {
    if (!endpoint) return;
    const timer = setTimeout(() => graphqlSchemas.ensure(tab), 800);
    return () => clearTimeout(timer);
  });

  // Where the explorer should jump: set by Cmd/Ctrl+click in the Query editor.
  let target = $state.raw<ExplorerHit>();

  // cm6-graphql passes types as written (`[User!]!`); the explorer wants the bare name.
  function openInExplorer(field?: string, type?: string, parentType?: string): void {
    const bare = (s: string) => s.replace(/[[\]!]/g, '');
    if (parentType) target = { type: bare(parentType), field };
    else if (type) target = { type: bare(type) };
    graphqlExplorerOpen.current = true;
  }

  // Query and Variables change in one tabs write.
  function addToQuery(root: RootKind, field: string): void {
    if (!schema) return;
    const s = schema;
    tabs.updateById(tab.id, (t) => {
      const next = appendOperation(t.request.body ?? '', t.request.graphqlVariables ?? '', s, root, field);
      return { ...t, request: { ...t.request, body: next.query, graphqlVariables: next.variables } };
    });
  }

  function setQuery(value: string): void {
    tabs.updateById(tab.id, (t) => ({ ...t, request: { ...t.request, body: value } }));
  }

  function setVariables(value: string): void {
    tabs.updateById(tab.id, (t) => ({ ...t, request: { ...t.request, graphqlVariables: value } }));
  }
</script>

<div class="bs-graphql">
  <div class="bs-graphql-editors">
    <section class="bs-graphql-panel">
      <div class="bs-graphql-label">
        <span>{t('http.body.gql_query')}</span>
        <GraphqlSchemaChip {tab} />
      </div>
      <BodyCode>
        <CodeEditor
          value={tab.request.body ?? ''}
          onChange={setQuery}
          lang="graphql"
          placeholder={bodyPlaceholder(tab, t)}
          fill
          {varHighlight}
          {extensions}
          docId={`${tab.id}:graphql-query`}
          ariaLabel={t('http.body.gql_query_aria')}
        />
      </BodyCode>
    </section>
    <section class="bs-graphql-panel">
      <div class="bs-graphql-label"><span>{t('http.body.gql_vars')}</span></div>
      <BodyCode>
        <CodeEditor
          value={tab.request.graphqlVariables ?? ''}
          onChange={setVariables}
          lang="json"
          placeholder={'{\n  "id": "1"\n}'}
          fill
          {varHighlight}
          docId={`${tab.id}:graphql-variables`}
          ariaLabel={t('http.body.gql_vars_aria')}
        />
      </BodyCode>
    </section>
  </div>
  {#if graphqlExplorerOpen.current && schema}
    <GraphqlExplorer {schema} {target} onAdd={addToQuery} />
  {/if}
</div>

<style>
  .bs-graphql {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .bs-graphql-editors {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
  }
  .bs-graphql-panel {
    display: flex;
    flex: 1;
    min-height: 140px;
    flex-direction: column;
  }
  .bs-graphql-panel + .bs-graphql-panel {
    border-top: 1px solid var(--sepsoft);
  }
  .bs-graphql-label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 10px 16px 0;
    color: var(--t2);
    font-size: 12px;
    font-weight: 650;
  }
</style>
