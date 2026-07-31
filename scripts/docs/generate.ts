#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const checking = process.argv.includes("--check");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function source(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    read(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function nodeName(node: ts.Node | undefined): string | undefined {
  if (
    node !== undefined &&
    (ts.isIdentifier(node) ||
      ts.isStringLiteral(node) ||
      ts.isNumericLiteral(node))
  ) {
    return node.text;
  }
  return undefined;
}

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression)) {
    return unwrap(expression.expression);
  }
  return expression;
}

function variableInitializer(
  file: ts.SourceFile,
  variableName: string,
): ts.Expression {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        nodeName(declaration.name) === variableName &&
        declaration.initializer !== undefined
      ) {
        return unwrap(declaration.initializer);
      }
    }
  }
  throw new Error(`Cannot find variable ${variableName} in ${file.fileName}`);
}

function stringArray(file: ts.SourceFile, variableName: string): string[] {
  const initializer = variableInitializer(file, variableName);
  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error(`${variableName} is not an array in ${file.fileName}`);
  }
  return initializer.elements.map((element) => {
    const value = unwrap(element as ts.Expression);
    if (!ts.isStringLiteral(value)) {
      throw new Error(`${variableName} contains a non-string value`);
    }
    return value.text;
  });
}

function numberExpression(expression: ts.Expression): number {
  const value = unwrap(expression);
  if (ts.isNumericLiteral(value)) {
    return Number(value.text);
  }
  if (ts.isBinaryExpression(value)) {
    const left = numberExpression(value.left);
    const right = numberExpression(value.right);
    switch (value.operatorToken.kind) {
      case ts.SyntaxKind.AsteriskToken:
        return left * right;
      case ts.SyntaxKind.PlusToken:
        return left + right;
      default:
        break;
    }
  }
  throw new Error(`Unsupported numeric expression: ${value.getText()}`);
}

function numberVariable(file: ts.SourceFile, variableName: string): number {
  return numberExpression(variableInitializer(file, variableName));
}

function typeAlias(
  file: ts.SourceFile,
  aliasName: string,
): ts.TypeAliasDeclaration {
  const declaration = file.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === aliasName,
  );
  if (declaration === undefined) {
    throw new Error(`Cannot find type ${aliasName} in ${file.fileName}`);
  }
  return declaration;
}

function stringLiteralTypes(node: ts.Node): string[] {
  const values: string[] = [];
  function visit(current: ts.Node): void {
    if (
      ts.isLiteralTypeNode(current) &&
      ts.isStringLiteral(current.literal)
    ) {
      values.push(current.literal.text);
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return values;
}

function aliasStrings(file: ts.SourceFile, aliasName: string): string[] {
  return [...new Set(stringLiteralTypes(typeAlias(file, aliasName).type))];
}

function aliasPropertyStrings(
  file: ts.SourceFile,
  aliasName: string,
  propertyName: string,
): string[] {
  const values: string[] = [];
  function visit(current: ts.Node): void {
    if (
      ts.isPropertySignature(current) &&
      nodeName(current.name) === propertyName &&
      current.type !== undefined
    ) {
      values.push(...stringLiteralTypes(current.type));
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(typeAlias(file, aliasName).type);
  return [...new Set(values)];
}

function property(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression {
  const assignment = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && nodeName(candidate.name) === name,
  );
  if (assignment === undefined) {
    throw new Error(`Missing ${name} in ${object.getText()}`);
  }
  return unwrap(assignment.initializer);
}

function migrations(file: ts.SourceFile): Array<{
  version: number;
  description: string;
}> {
  const initializer = variableInitializer(file, "migrations");
  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error("migrations is not an array");
  }
  return initializer.elements
    .map((element) => {
      const object = unwrap(element as ts.Expression);
      if (!ts.isObjectLiteralExpression(object)) {
        throw new Error("migration is not an object");
      }
      const description = property(object, "description");
      if (!ts.isStringLiteral(description)) {
        throw new Error("migration description is not a string");
      }
      return {
        version: numberExpression(property(object, "version")),
        description: description.text,
      };
    })
    .sort((left, right) => left.version - right.version);
}

function cliUsage(file: ts.SourceFile): string {
  const declaration = file.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "usage",
  );
  if (declaration === undefined) {
    throw new Error("Cannot find CLI usage function");
  }
  let result: string | undefined;
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "write" &&
      node.arguments.length === 1
    ) {
      const argument = node.arguments[0];
      if (
        argument !== undefined &&
        (ts.isNoSubstitutionTemplateLiteral(argument) ||
          ts.isStringLiteral(argument))
      ) {
        result = argument.text;
      }
    }
    if (result === undefined) {
      ts.forEachChild(node, visit);
    }
  }
  visit(declaration);
  if (result === undefined) {
    throw new Error("Cannot extract CLI usage text");
  }
  return result.trimEnd();
}

interface PackageManifest {
  readonly name: string;
  readonly path: string;
  readonly bin: string;
  readonly scripts: string;
  readonly workspaceDependencies: string;
}

function workspaceDirectories(): string[] {
  const patterns = read("pnpm-workspace.yaml")
    .split("\n")
    .map((line) => line.match(/^\s*-\s*["']([^"']+)["']\s*$/)?.[1])
    .filter((pattern): pattern is string => pattern !== undefined);
  return patterns.map((pattern) => {
    if (!pattern.endsWith("/*") || pattern.slice(0, -2).includes("*")) {
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    }
    return pattern.slice(0, -2);
  });
}

function manifests(): PackageManifest[] {
  const result: PackageManifest[] = [];
  for (const category of workspaceDirectories()) {
    const categoryPath = join(root, category);
    for (const entry of readdirSync(categoryPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifestPath = join(categoryPath, entry.name, "package.json");
      if (!existsSync(manifestPath)) {
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        name: string;
        bin?: string | Record<string, string>;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      const bins =
        typeof manifest.bin === "string"
          ? [manifest.bin]
          : Object.keys(manifest.bin ?? {});
      result.push({
        name: manifest.name,
        path: `${category}/${entry.name}`,
        bin: bins.join(", ") || "—",
        scripts: Object.keys(manifest.scripts ?? {}).sort().join(", ") || "—",
        workspaceDependencies:
          Object.entries(manifest.dependencies ?? {})
            .filter(([, version]) => version.startsWith("workspace:"))
            .map(([name]) => name)
            .sort()
            .join(", ") || "—",
      });
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function typescriptFiles(directory: string): string[] {
  const absolute = join(root, directory);
  const files: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...typescriptFiles(relative(root, child)));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      files.push(relative(root, child));
    }
  }
  return files;
}

function environmentVariables(): Array<{ name: string; sources: string[] }> {
  const occurrences = new Map<string, Set<string>>();
  for (const directory of workspaceDirectories()) {
    for (const path of typescriptFiles(directory)) {
      for (const match of read(path).matchAll(/\bPANDAMATE_[A-Z0-9_]+\b/g)) {
        const sources = occurrences.get(match[0]) ?? new Set<string>();
        sources.add(path);
        occurrences.set(match[0], sources);
      }
    }
  }
  return [...occurrences]
    .map(([name, sources]) => ({ name, sources: [...sources].sort() }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function generatedHeader(sourcePaths: readonly string[]): string {
  return `<!-- GENERATED FILE. DO NOT EDIT. Run \`pnpm docs:generate\`. -->

Sources: ${sourcePaths.map((path) => `\`${path}\``).join(", ")}.
`;
}

function list(values: readonly string[]): string {
  return values.map((value) => `- \`${value}\``).join("\n");
}

const protocolFile = source("packages/protocol/src/index.ts");
const domainFile = source("packages/domain/src/index.ts");
const tuiProtocolFile = source("spikes/tui/src/control-protocol.ts");
const tuiFile = source("spikes/tui/src/index.ts");
const migrationList = migrations(source("packages/storage/src/index.ts"));
const rootManifest = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};

const outputs = new Map<string, string>([
  [
    "docs/generated/cli.md",
    `# Generated CLI reference

${generatedHeader(["apps/cli/src/main.ts"])}
This is the exact usage surface printed by the current CLI implementation.

\`\`\`text
${cliUsage(source("apps/cli/src/main.ts"))}
\`\`\`
`,
  ],
  [
    "docs/generated/protocol.md",
    `# Generated protocol and domain reference

${generatedHeader([
      "packages/protocol/src/index.ts",
      "packages/domain/src/index.ts",
      "spikes/tui/src/control-protocol.ts",
      "spikes/tui/src/index.ts",
    ])}
## Daemon IPC

- Protocol version: \`${numberVariable(protocolFile, "protocolVersion")}\`
- Maximum frame size: \`${numberVariable(protocolFile, "maximumFrameBytes")}\` bytes

### Request types

${list(aliasPropertyStrings(protocolFile, "Request", "type"))}

## Domain vocabularies

| Vocabulary | Values |
|---|---|
${[
      ["Project kinds", stringArray(domainFile, "projectKinds")],
      ["FirstMate profiles", stringArray(domainFile, "firstMateProfiles")],
      ["Desired states", stringArray(domainFile, "desiredStates")],
      ["Actual states", stringArray(domainFile, "actualStates")],
      ["Message priorities", stringArray(domainFile, "messagePriorities")],
      ["Message statuses", stringArray(domainFile, "messageStatuses")],
    ]
      .map(
        ([name, values]) =>
          `| ${name} | ${(values as string[]).map((value) => `\`${value}\``).join(", ")} |`,
      )
      .join("\n")}

## TUI control protocol

### Actions

${list(aliasStrings(tuiProtocolFile, "TuiAction"))}

### Internal screen states

${list(aliasStrings(tuiFile, "Screen"))}
`,
  ],
  [
    "docs/generated/storage.md",
    `# Generated storage reference

${generatedHeader(["packages/storage/src/index.ts"])}
Current schema migration: \`${migrationList.at(-1)?.version ?? 0}\`.

| Version | Purpose |
|---:|---|
${migrationList
      .map(
        (migration) =>
          `| ${migration.version} | ${markdownCell(migration.description)} |`,
      )
      .join("\n")}
`,
  ],
  [
    "docs/generated/workspace.md",
    `# Generated workspace reference

${generatedHeader([
      "package.json",
      "pnpm-workspace.yaml",
      "apps/*/package.json",
      "packages/*/package.json",
      "spikes/*/package.json",
      "fixtures/*/package.json",
    ])}
## Root commands

| Command | Implementation |
|---|---|
${Object.entries(rootManifest.scripts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([name, command]) =>
          `| \`pnpm ${name}\` | \`${markdownCell(command)}\` |`,
      )
      .join("\n")}

## Workspace packages

| Path | Package | Binaries | Scripts | Workspace dependencies |
|---|---|---|---|---|
${manifests()
      .map(
        (manifest) =>
          `| \`${manifest.path}\` | \`${manifest.name}\` | ${markdownCell(manifest.bin)} | ${markdownCell(manifest.scripts)} | ${markdownCell(manifest.workspaceDependencies)} |`,
      )
      .join("\n")}

## Runtime environment variables

This inventory includes production and spike sources, but excludes test-only use.

| Variable | Referenced by |
|---|---|
${environmentVariables()
      .map(
        ({ name, sources }) =>
          `| \`${name}\` | ${sources.map((path) => `\`${path}\``).join("<br>")} |`,
      )
      .join("\n")}
`,
  ],
]);

const stale: string[] = [];
for (const [path, content] of outputs) {
  const expected = `${content.trimEnd()}\n`;
  const absolute = join(root, path);
  if (checking) {
    if (!existsSync(absolute) || readFileSync(absolute, "utf8") !== expected) {
      stale.push(path);
    }
    continue;
  }
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp`;
  writeFileSync(temporary, expected);
  renameSync(temporary, absolute);
  process.stdout.write(`generated ${path}\n`);
}

if (stale.length > 0) {
  process.stderr.write(
    `Generated documentation is stale:\n${stale
      .map((path) => `  - ${path}`)
      .join("\n")}\nRun pnpm docs:generate and commit the result.\n`,
  );
  process.exitCode = 1;
} else if (checking) {
  process.stdout.write("Generated documentation is current.\n");
}
