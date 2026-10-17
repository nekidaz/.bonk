<!--
  The GraphQL schema explorer right of the Query/Variables editors (spec «Обозреватель схемы»): search,
  root types and all types, one type's fields / values / interfaces / members, breadcrumbs back, and
  «Add to query» on root fields. Read-only; `target` (Cmd/Ctrl+click in the editor) opens a type/field.
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import {
    getNamedType,
    isAbstractType,
    isEnumType,
    isInputObjectType,
    isInterfaceType,
    isObjectType,
    isUnionType,
    type GraphQLField,
    type GraphQLInputField,
    type GraphQLNamedType,
    type GraphQLSchema,
    type GraphQLType,
  } from 'graphql';
  import { t } from '$shared/i18n';
  import { IconButton, TextInput } from '$shared/ui/components';
  import type { RootKind } from './graphqlOperation';
  import { rootKindOf, searchSchema, userTypes, type ExplorerHit } from './graphqlExplorer';

  let {
    schema,
    target,
    onAdd,
  }: { schema: GraphQLSchema; target?: ExplorerHit; onAdd: (root: RootKind, field: string) => void } = $props();

  // Navigation stack, like a []ExplorerHit slice that is replaced, never appended in place. Empty = home screen.
  let stack = $state.raw<ExplorerHit[]>([]);
  let query = $state('');
  let body = $state<HTMLElement | null>(null);

  const hits = $derived(searchSchema(schema, query));
  const current = $derived(stack.at(-1));
  // Undefined also when a refreshed schema no longer has the type: the home screen shows then.
  const named = $derived(current ? schema.getType(current.type) : undefined);
  const root = $derived(named ? rootKindOf(schema, named.name) : null);
  const fields = $derived.by((): (GraphQLField<unknown, unknown> | GraphQLInputField)[] =>
    isObjectType(named) || isInterfaceType(named) || isInputObjectType(named) ? Object.values(named.getFields()) : [],
  );
  const interfaces = $derived(isObjectType(named) || isInterfaceType(named) ? named.getInterfaces() : []);
  const members = $derived(isAbstractType(named) ? schema.getPossibleTypes(named) : []);
  const roots = $derived(
    [schema.getQueryType(), schema.getMutationType(), schema.getSubscriptionType()].filter((x) => x != null),
  );

  // Every Cmd/Ctrl+click makes a new `target` object, so a repeat click on the same field re-runs this too.
  $effect(() => {
    if (target) untrack(() => go(target));
  });

  async function go(hit: ExplorerHit): Promise<void> {
    stack = [...stack, hit];
    query = '';
    await tick();
    const row = hit.field ? body?.querySelector(`[data-field="${CSS.escape(hit.field)}"]`) : null;
    if (row) row.scrollIntoView({ block: 'center' });
    else if (body) body.scrollTop = 0;
  }

  function openType(type: GraphQLType): void {
    void go({ type: getNamedType(type).name });
  }

  function crumb(i: number): void {
    stack = stack.slice(0, i);
    query = '';
  }

  function kind(x: GraphQLNamedType): string {
    if (isObjectType(x)) return 'object';
    if (isInputObjectType(x)) return 'input';
    if (isEnumType(x)) return 'enum';
    if (isInterfaceType(x)) return 'interface';
    if (isUnionType(x)) return 'union';
    return 'scalar';
  }

  const deprecated = (reason?: string | null) =>
    reason == null ? undefined : t('http.body.gql_explorer_deprecated', { reason });
</script>

{#snippet typeLink(type: GraphQLType)}
  <button type="button" class="gx-type" onclick={() => openType(type)}>{String(type)}</button>
{/snippet}

{#snippet typeList(title: string, list: readonly GraphQLNamedType[])}
  {#if list.length}
    <h3 class="gx-h">{title}</h3>
    <ul class="gx-list">
      {#each list as x (x.name)}
        <li>{@render typeLink(x)}</li>
      {/each}
    </ul>
  {/if}
{/snippet}

<aside class="gx" aria-label={t('http.body.gql_explorer_aria')}>
  <div class="gx-top">
    <TextInput
      class="gx-search"
      type="search"
      bind:value={query}
      placeholder={t('http.body.gql_explorer_search')}
      aria-label={t('http.body.gql_explorer_search')}
    />
    {#if stack.length && !query}
      <nav class="gx-crumbs" aria-label={t('http.body.gql_explorer_path')}>
        <IconButton
          type="button"
          class="gx-back"
          title={t('http.body.gql_explorer_back')}
          aria-label={t('http.body.gql_explorer_back')}
          onclick={() => crumb(stack.length - 1)}
        >
          <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
        </IconButton>
        <button type="button" class="gx-crumb" onclick={() => crumb(0)}>{t('http.body.gql_schema_explorer')}</button>
        {#each stack as hit, i (i)}
          <span class="gx-sep" aria-hidden="true">/</span>
          <button
            type="button"
            class="gx-crumb"
            aria-current={i === stack.length - 1 ? 'page' : undefined}
            onclick={() => crumb(i + 1)}>{hit.type}</button
          >
        {/each}
      </nav>
    {/if}
  </div>

  <div class="gx-body" bind:this={body}>
    {#if query}
      {#if hits.length}
        <ul class="gx-list">
          {#each hits as hit (`${hit.type}.${hit.field ?? ''}`)}
            <li>
              <button type="button" class="gx-type" onclick={() => go(hit)}
                >{hit.field ? `${hit.type}.${hit.field}` : hit.type}</button
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="gx-empty">{t('http.body.gql_explorer_no_hits')}</p>
      {/if}
    {:else if named}
      <div class="gx-title">
        <span class="gx-name">{named.name}</span>
        <span class="gx-kind">{kind(named)}</span>
      </div>
      {#if named.description}<p class="gx-desc">{named.description}</p>{/if}

      {#if fields.length}
        <h3 class="gx-h">{t('http.body.gql_explorer_fields')}</h3>
        <ul class="gx-list">
          {#each fields as f (f.name)}
            {@const args = 'args' in f ? f.args : []}
            <li class={['gx-field', { hl: f.name === current?.field }]} data-field={f.name}>
              <div class="gx-row">
                <span class="gx-sig"
                  ><span
                    class={['gx-fname', { dep: f.deprecationReason != null }]}
                    title={deprecated(f.deprecationReason)}>{f.name}</span
                  >{#if args.length}({#each args as a, i (a.name)}{i ? ', ' : ''}{a.name}: {@render typeLink(
                        a.type,
                      )}{/each}){/if}: {@render typeLink(f.type)}</span
                >
                {#if root}
                  <IconButton
                    type="button"
                    class="gx-add"
                    title={t('http.body.gql_explorer_add')}
                    aria-label={t('http.body.gql_explorer_add')}
                    onclick={() => root && onAdd(root, f.name)}
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">add</span>
                  </IconButton>
                {/if}
              </div>
              {#if f.description}<p class="gx-desc">{f.description}</p>{/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if isEnumType(named)}
        <h3 class="gx-h">{t('http.body.gql_explorer_values')}</h3>
        <ul class="gx-list">
          {#each named.getValues() as v (v.name)}
            <li class="gx-field">
              <span class={['gx-fname', { dep: v.deprecationReason != null }]} title={deprecated(v.deprecationReason)}
                >{v.name}</span
              >
              {#if v.description}<p class="gx-desc">{v.description}</p>{/if}
            </li>
          {/each}
        </ul>
      {/if}

      {@render typeList(t('http.body.gql_explorer_interfaces'), interfaces)}
      {@render typeList(t('http.body.gql_explorer_members'), members)}
    {:else}
      {@render typeList(t('http.body.gql_explorer_roots'), roots)}
      {@render typeList(t('http.body.gql_explorer_all'), userTypes(schema))}
    {/if}
  </div>
</aside>

<style>
  .gx {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 300px;
    min-height: 0;
    border-left: 1px solid var(--sepsoft);
  }
  .gx-top {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px 6px;
  }
  .gx :global(.gx-search) {
    height: 28px;
    padding: 0 8px;
    font-size: 12px;
  }
  .gx-crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 4px;
    font-size: 12px;
  }
  .gx :global(.gx-back),
  .gx :global(.gx-add) {
    flex: none;
    width: 22px;
    height: 22px;
  }
  .gx-crumb {
    color: var(--t2);
  }
  .gx-crumb:hover,
  .gx-crumb[aria-current='page'] {
    color: var(--text);
  }
  .gx-sep {
    color: var(--t3);
  }
  .gx-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 12px 12px;
    font-size: 12px;
  }
  .gx-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding-top: 4px;
  }
  .gx-name {
    color: var(--text);
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .gx-kind {
    color: var(--t3);
  }
  .gx-h {
    margin: 12px 0 4px;
    color: var(--t2);
    font-size: 11px;
    font-weight: 650;
  }
  .gx-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .gx-list > li {
    padding: 3px 0;
  }
  .gx-field {
    border-radius: 4px;
  }
  .gx-field.hl {
    background: var(--color-selected);
  }
  .gx-row {
    display: flex;
    align-items: flex-start;
    gap: 4px;
  }
  .gx-sig {
    flex: 1;
    min-width: 0;
    padding-top: 2px;
    font-family: var(--mono);
    overflow-wrap: anywhere;
  }
  .gx-fname {
    color: var(--text);
  }
  .gx-fname.dep {
    text-decoration: line-through;
    color: var(--t3);
  }
  .gx-type {
    color: var(--t2);
    font-family: var(--mono);
    text-align: left;
    overflow-wrap: anywhere;
  }
  .gx-type:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .gx-desc,
  .gx-empty {
    margin: 2px 0 0;
    color: var(--t3);
    white-space: pre-wrap;
  }
</style>
