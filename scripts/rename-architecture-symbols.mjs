import fs from 'node:fs/promises';
import path from 'node:path';

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'playwright-report']);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(options.root);
  const manifestPath = path.resolve(rootDir, options.manifest);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const renames = [...manifest.renames].sort((left, right) => right.from.length - left.from.length);

  const targets = await collectTargets(rootDir);
  let changedFiles = 0;

  for (const filePath of targets) {
    const original = await fs.readFile(filePath, 'utf8');
    const updated = applyRenames(original, renames);
    if (updated === original) {
      continue;
    }
    changedFiles += 1;
    if (options.apply) {
      await fs.writeFile(filePath, updated, 'utf8');
    }
  }

  const mode = options.apply ? 'apply' : 'dry-run';
  console.log(`[${mode}] Checked ${targets.length} files.`);
  console.log(`[${mode}] ${changedFiles} files ${options.apply ? 'updated' : 'would change'}.`);
}

function parseArgs(args) {
  const options = {
    apply: false,
    manifest: 'scripts/architecture-symbol-renames.manifest.json',
    root: process.cwd()
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--apply') {
      options.apply = true;
      continue;
    }
    if (value === '--manifest') {
      options.manifest = args[index + 1];
      index += 1;
      continue;
    }
    if (value === '--root') {
      options.root = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  return options;
}

function applyRenames(content, renames) {
  let next = content;

  for (const rename of renames) {
    const pattern = new RegExp(`\\b${escapeRegExp(rename.from)}\\b`, 'g');
    next = next.replace(pattern, rename.to);
  }

  return next;
}

async function collectTargets(rootDir) {
  const targets = [];
  await walkDirectory(rootDir, targets);
  return targets;
}

async function walkDirectory(directoryPath, targets) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(fullPath, targets);
      continue;
    }

    if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
      targets.push(fullPath);
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
