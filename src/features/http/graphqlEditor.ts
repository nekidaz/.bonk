/**
 * GraphQL editor pieces on top of cm6-graphql: completion, go-to-definition and schema state come from the
 * library; the linter is ours (graphqlLint.ts) so `{{var}}` placeholders are never underlined.
 * We use none of cm6-graphql's all-in-one `graphql()` or its own `lint`.
 */
import { linter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { completion, getSchema, graphqlLanguageSupport, jump, schemaStateField, stateExtensions } from 'cm6-graphql';
import type { GraphQLSchema } from 'graphql';
import { graphqlProblems } from './graphqlLint';

// One instance: the schema-driven extensions are rebuilt on a schema change, the language need not be.
const language = graphqlLanguageSupport();

export function graphqlExtensions(
  schema: GraphQLSchema | undefined,
  onShowInDocs: (field?: string, type?: string, parentType?: string) => void,
): Extension {
  return [
    language,
    completion,
    jump,
    stateExtensions(schema, { onShowInDocs }),
    linter(
      (view) =>
        graphqlProblems(view.state.doc.toString(), getSchema(view.state) || undefined).map((p) => ({
          ...p,
          severity: 'error' as const,
        })),
      {
        delay: 400,
        // Re-lint when the schema is swapped, not only on edits.
        needsRefresh: (u) => u.startState.field(schemaStateField, false) !== u.state.field(schemaStateField, false),
      },
    ),
  ];
}
