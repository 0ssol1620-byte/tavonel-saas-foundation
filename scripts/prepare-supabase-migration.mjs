import { readFile, writeFile } from "node:fs/promises";

const [projectId, migrationPath, outputPath] = process.argv.slice(2);

if (!projectId || !migrationPath || !outputPath) {
  throw new Error("Usage: node prepare-supabase-migration.mjs <project-id> <sql-path> <output-path>");
}

const query = await readFile(migrationPath, "utf8");
await writeFile(
  outputPath,
  JSON.stringify(
    {
      project_id: projectId,
      name: "tavonel_tenant_foundation_0001",
      query,
    },
    null,
    2,
  ),
);
