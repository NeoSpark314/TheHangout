import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const IMPORT_REWRITERS = [
  {
    pattern: /(\bfrom\s*["'])([^"']+)(["'])/g,
    getPrefix(match) {
      return match[1];
    },
    getSpecifier(match) {
      return match[2];
    },
    getSuffix(match) {
      return match[3];
    }
  },
  {
    pattern: /(\bimport\s*\(\s*["'])([^"']+)(["']\s*\))/g,
    getPrefix(match) {
      return match[1];
    },
    getSpecifier(match) {
      return match[2];
    },
    getSuffix(match) {
      return match[3];
    }
  },
  {
    pattern: /(\bimport\s*["'])([^"']+)(["'])/g,
    getPrefix(match) {
      return match[1];
    },
    getSpecifier(match) {
      return match[2];
    },
    getSuffix(match) {
      return match[3];
    }
  }
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(options.root);
  const manifestPath = path.resolve(rootDir, options.manifest);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

  const plannedMoves = await expandMoves(rootDir, manifest.moves);
  validateMoves(plannedMoves);

  const moveMap = new Map(
    plannedMoves.map((move) => [normalizePath(path.resolve(rootDir, move.from)), normalizePath(path.resolve(rootDir, move.to))])
  );

  if (!options.apply && !options.rewriteOnly) {
    printPlan(plannedMoves, moveMap, rootDir, true);
    return;
  }

  if (options.apply) {
    await applyMoves(rootDir, plannedMoves);
  }
  const rewriteSummary = await rewriteImports(rootDir, moveMap);
  if (options.apply) {
    await removeEmptyDirectories(rootDir, plannedMoves);
  }
  printPlan(plannedMoves, moveMap, rootDir, false, rewriteSummary, options.rewriteOnly);
}

function parseArgs(args) {
  const options = {
    apply: false,
    rewriteOnly: false,
    manifest: 'scripts/architecture-migration.manifest.json',
    root: process.cwd()
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--apply') {
      options.apply = true;
      continue;
    }
    if (value === '--rewrite-only') {
      options.rewriteOnly = true;
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

async function expandMoves(rootDir, moves) {
  const expanded = [];

  for (const move of moves) {
    if (move.type === 'file') {
      expanded.push({ from: move.from, to: move.to });
      continue;
    }

    if (move.type === 'directory') {
      const sourceDir = path.resolve(rootDir, move.from);
      const targetDir = path.resolve(rootDir, move.to);
      let files = await collectFilesIfPresent(sourceDir);
      let treatAsMoved = false;

      if (files.length === 0) {
        files = await collectFilesIfPresent(targetDir);
        treatAsMoved = files.length > 0;
      }

      if (files.length === 0) {
        throw new Error(`Directory move source is empty or missing: ${move.from}`);
      }

      for (const filePath of files) {
        const relativePath = treatAsMoved
          ? path.relative(targetDir, filePath)
          : path.relative(sourceDir, filePath);
        expanded.push({
          from: treatAsMoved
            ? normalizeRelativePath(rootDir, path.join(sourceDir, relativePath))
            : normalizeRelativePath(rootDir, filePath),
          to: treatAsMoved
            ? normalizeRelativePath(rootDir, filePath)
            : normalizeRelativePath(rootDir, path.join(targetDir, relativePath))
        });
      }
      continue;
    }

    throw new Error(`Unsupported move type: ${move.type}`);
  }

  return expanded;
}

function validateMoves(moves) {
  const sourceSet = new Set();
  const targetSet = new Set();

  for (const move of moves) {
    const from = normalizePath(move.from);
    const to = normalizePath(move.to);

    if (from === to) {
      throw new Error(`Refusing no-op move: ${move.from}`);
    }
    if (sourceSet.has(from)) {
      throw new Error(`Duplicate source path in manifest: ${move.from}`);
    }
    if (targetSet.has(to)) {
      throw new Error(`Duplicate target path in manifest: ${move.to}`);
    }

    sourceSet.add(from);
    targetSet.add(to);
  }
}

async function applyMoves(rootDir, moves) {
  for (const move of moves) {
    const sourcePath = path.resolve(rootDir, move.from);
    const targetPath = path.resolve(rootDir, move.to);

    await assertExists(sourcePath, move.from);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.rename(sourcePath, targetPath);
  }
}

async function rewriteImports(rootDir, moveMap) {
  const reverseMoveMap = new Map(
    [...moveMap.entries()].map(([fromPath, toPath]) => [toPath, fromPath])
  );
  const originalMovePaths = new Set(moveMap.keys());
  const candidateFiles = await collectRewriteTargets(rootDir);
  let changedFiles = 0;
  let changedSpecifiers = 0;

  for (const filePath of candidateFiles) {
    const currentContent = await fs.readFile(filePath, 'utf8');
    const nextContent = rewriteImportSpecifiers(
      currentContent,
      filePath,
      moveMap,
      reverseMoveMap,
      originalMovePaths
    );

    if (nextContent !== currentContent) {
      changedFiles += 1;
      changedSpecifiers += countDiffSpecifiers(currentContent, nextContent);
      await fs.writeFile(filePath, nextContent, 'utf8');
    }
  }

  return { changedFiles, changedSpecifiers };
}

function rewriteImportSpecifiers(content, filePath, moveMap, reverseMoveMap, originalMovePaths) {
  let nextContent = content;

  for (const rewriter of IMPORT_REWRITERS) {
    nextContent = nextContent.replace(rewriter.pattern, (...args) => {
      const match = args;
      const prefix = rewriter.getPrefix(match);
      const originalSpecifier = rewriter.getSpecifier(match);
      const suffix = rewriter.getSuffix(match);
      const updatedSpecifier = rewriteSpecifier(
        filePath,
        originalSpecifier,
        moveMap,
        reverseMoveMap,
        originalMovePaths
      );

      if (!updatedSpecifier || updatedSpecifier === originalSpecifier) {
        return `${prefix}${originalSpecifier}${suffix}`;
      }

      return `${prefix}${updatedSpecifier}${suffix}`;
    });
  }

  return nextContent;
}

function rewriteSpecifier(filePath, specifier, moveMap, reverseMoveMap, originalMovePaths) {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const currentFilePath = normalizePath(filePath);
  const originalImporterPath = reverseMoveMap.get(currentFilePath) || currentFilePath;
  const resolution = resolveOriginalSpecifier(
    path.dirname(originalImporterPath),
    specifier,
    originalMovePaths
  );
  if (!resolution) {
    return null;
  }

  const currentTargetPath = moveMap.get(normalizePath(resolution.resolvedPath)) || normalizePath(resolution.resolvedPath);

  const outputTarget = resolution.mode === 'index' && !specifier.endsWith('/index')
    ? path.dirname(currentTargetPath)
    : currentTargetPath;

  const wantsExtension = hasExplicitExtension(specifier);
  let nextSpecifier = normalizeSpecifier(path.relative(path.dirname(filePath), outputTarget));

  if (!wantsExtension && CODE_EXTENSIONS.includes(path.extname(outputTarget))) {
    nextSpecifier = stripCodeExtension(nextSpecifier);
  }

  if (!wantsExtension && resolution.mode === 'index' && nextSpecifier.endsWith('/index')) {
    nextSpecifier = nextSpecifier.slice(0, -('/index'.length)) || '.';
  }

  return nextSpecifier;
}

function resolveOriginalSpecifier(baseDir, specifier, originalMovePaths) {
  const rawTarget = path.resolve(baseDir, specifier);
  const directCandidates = buildDirectCandidates(rawTarget);

  for (const candidate of directCandidates) {
    if (pathExistsInOriginalGraph(candidate, originalMovePaths)) {
      return { resolvedPath: candidate, mode: 'direct' };
    }
  }

  const indexCandidates = CODE_EXTENSIONS.map((extension) => path.join(rawTarget, `index${extension}`));
  for (const candidate of indexCandidates) {
    if (pathExistsInOriginalGraph(candidate, originalMovePaths)) {
      return { resolvedPath: candidate, mode: 'index' };
    }
  }

  return null;
}

function buildDirectCandidates(rawTarget) {
  const candidates = new Set([
    rawTarget,
    ...CODE_EXTENSIONS.map((extension) => `${rawTarget}${extension}`)
  ]);

  const extension = path.extname(rawTarget);
  const basenameWithoutExtension = extension ? rawTarget.slice(0, -extension.length) : rawTarget;

  if (extension === '.js') {
    candidates.add(`${basenameWithoutExtension}.ts`);
    candidates.add(`${basenameWithoutExtension}.tsx`);
  } else if (extension === '.mjs') {
    candidates.add(`${basenameWithoutExtension}.mts`);
    candidates.add(`${basenameWithoutExtension}.ts`);
  } else if (extension === '.cjs') {
    candidates.add(`${basenameWithoutExtension}.cts`);
    candidates.add(`${basenameWithoutExtension}.ts`);
  }

  return [...candidates];
}

async function collectRewriteTargets(rootDir) {
  const rootEntries = await fs.readdir(rootDir, { withFileTypes: true });
  const targets = [];

  for (const entry of rootEntries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'playwright-report') {
      continue;
    }

    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nestedFiles = await collectFiles(fullPath);
      for (const filePath of nestedFiles) {
        if (isRewriteTarget(filePath)) {
          targets.push(filePath);
        }
      }
      continue;
    }

    if (entry.isFile() && isRewriteTarget(fullPath)) {
      targets.push(fullPath);
    }
  }

  return targets;
}

async function collectFiles(directoryPath) {
  const files = [];
  let directoryEntries;

  try {
    directoryEntries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Missing directory: ${directoryPath}`);
  }

  for (const entry of directoryEntries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nestedFiles = await collectFiles(fullPath);
      files.push(...nestedFiles);
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function collectFilesIfPresent(directoryPath) {
  try {
    return await collectFiles(directoryPath);
  } catch {
    return [];
  }
}

async function removeEmptyDirectories(rootDir, moves) {
  const candidateDirectories = new Set();

  for (const move of moves) {
    let currentDir = path.resolve(rootDir, path.dirname(move.from));
    while (normalizePath(currentDir).startsWith(normalizePath(path.resolve(rootDir, 'src')))) {
      candidateDirectories.add(currentDir);
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }
  }

  const sortedDirectories = [...candidateDirectories].sort((left, right) => right.length - left.length);
  for (const directoryPath of sortedDirectories) {
    try {
      const entries = await fs.readdir(directoryPath);
      if (entries.length === 0) {
        await fs.rmdir(directoryPath);
      }
    } catch {
      // Ignore directories that are already gone or not empty.
    }
  }
}

function printPlan(moves, moveMap, rootDir, isDryRun, rewriteSummary = null, isRewriteOnly = false) {
  const header = isDryRun ? '[dry-run]' : (isRewriteOnly ? '[rewrite-only]' : '[apply]');
  console.log(`${header} Planned file moves: ${moves.length}`);

  for (const move of moves) {
    console.log(`- ${move.from} -> ${move.to}`);
  }

  if (isDryRun) {
    console.log(`[dry-run] No files were changed. Run with --apply to execute.`);
    return;
  }

  if (rewriteSummary) {
    console.log(`${header} Rewrote imports in ${rewriteSummary.changedFiles} files.`);
    console.log(`${header} Updated approximately ${rewriteSummary.changedSpecifiers} import specifiers.`);
  }

  console.log(`${header} Migration complete for ${moveMap.size} mapped files under ${rootDir}.`);
}

async function assertExists(filePath, displayPath) {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      throw new Error(`Expected file but found non-file: ${displayPath}`);
    }
  } catch {
    throw new Error(`Missing source file: ${displayPath}`);
  }
}

function normalizePath(value) {
  return path.normalize(value).replace(/\\/g, '/');
}

function normalizeRelativePath(rootDir, absolutePath) {
  return normalizePath(path.relative(rootDir, absolutePath));
}

function normalizeSpecifier(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized === '') {
    return '.';
  }
  if (normalized.startsWith('.')) {
    return normalized;
  }
  return `./${normalized}`;
}

function stripCodeExtension(specifier) {
  for (const extension of CODE_EXTENSIONS) {
    if (specifier.endsWith(extension)) {
      return specifier.slice(0, -extension.length);
    }
  }
  return specifier;
}

function hasExplicitExtension(specifier) {
  return CODE_EXTENSIONS.includes(path.extname(specifier));
}

function isRewriteTarget(filePath) {
  const extension = path.extname(filePath);
  return CODE_EXTENSIONS.includes(extension);
}

function fileExistsSync(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function pathExistsInOriginalGraph(candidatePath, originalMovePaths) {
  const normalizedCandidate = normalizePath(candidatePath);
  if (originalMovePaths.has(normalizedCandidate)) {
    return true;
  }
  return fileExistsSync(candidatePath);
}

function countDiffSpecifiers(currentContent, nextContent) {
  if (currentContent === nextContent) {
    return 0;
  }
  return 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
