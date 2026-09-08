# Directives Claude Code

## Commandes fréquentes
- Build : `npm run build` (ou `pnpm build`)
- Dev : `npm run dev`
- Tests : `npm test`
- Lint/Typecheck : `npm run typecheck` && `npm run lint`

## Directives d'exécution
- Privilégier les modifications chirurgicales de fichiers via les outils de diff plutôt que des remplacements complets.
- Nettoyer ou tronquer les sorties de logs longues avant analyse.
- Suivre les conventions TypeScript strictes du dépôt.
- Proposer un plan d'action en 2-3 puces avant d'appliquer des changements multi-fichiers.

# Directives du Projet

## Knowledge Graph Navigation
- Ce projet utilise Graphify pour la cartographie des dépendances et du contexte.
- Ne charge pas et ne lis pas l'ensemble des dossiers à l'aveugle.
- Consulte d'abord le graphe / l'index de connaissances Graphify pour naviguer uniquement vers les fichiers et fonctions nécessaires à la tâche demandée.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
