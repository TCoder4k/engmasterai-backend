import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { CliModule } from './cli.module';
import { loadDatasetConfig, buildDatasetBuildDir } from './config-loader';
import { DatasetAnalyzerService } from './analyzer/dataset-analyzer.service';
import { ImportValidatorService } from './validation/import-validator.service';
import { MapperRegistry } from './mappers/mapper.registry';
import { MediaResolverService } from './media/media-resolver.service';
import { MediaUploaderService } from './media/media-uploader.service';
import { ImportEngineService } from './engine/import-engine.service';
import { DeckBuilderService } from './engine/deck-builder.service';
import { loadRawTable } from './analyzer/table-loader';
import {
  AnalysisReport,
  ValidationReport,
  MediaManifest,
  ImportSummary,
} from './types/artifacts';
import { ImportWord } from './types/import-word';
import { MappingIssue } from './mappers/mapper.interface';

interface CliArgs {
  dataset: string;
  stage?: string;
  mode: 'skip' | 'upsert';
  dryRun: boolean;
  allowPartial: boolean;
  forceOverwrite: boolean;
  limit?: number;
}

interface MappedArtifact {
  words: ImportWord[];
  issues: MappingIssue[];
}

const STAGE_ORDER = ['analyze', 'map', 'validate', 'media', 'import'] as const;
type Stage = (typeof STAGE_ORDER)[number];

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {
    mode: 'skip',
    dryRun: false,
    allowPartial: false,
    forceOverwrite: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dataset') args.dataset = argv[++i];
    else if (arg === '--stage') args.stage = argv[++i];
    else if (arg === '--mode') args.mode = argv[++i] as 'skip' | 'upsert';
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--allow-partial') args.allowPartial = true;
    else if (arg === '--force-overwrite') args.forceOverwrite = true;
    else if (arg === '--limit') args.limit = Number(argv[++i]);
  }

  if (!args.dataset) {
    throw new Error('Missing required --dataset <id> argument');
  }

  return args as CliArgs;
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Expected artifact not found: ${filePath} — run the prior stage first`,
    );
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function renderAnalysisMarkdown(report: AnalysisReport): string {
  const lines: string[] = [];
  lines.push(`# Analysis report — ${report.datasetId}`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt} (run ${report.runId})`);
  lines.push('');
  lines.push('## File');
  lines.push(`- Format: ${report.file.format}`);
  lines.push(`- Path: ${report.file.path}`);
  lines.push(`- BOM: ${report.file.hasBom}`);
  if (report.file.delimiter)
    lines.push(`- Delimiter: ${JSON.stringify(report.file.delimiter)}`);
  lines.push(`- Rows: ${report.file.rowCount}`);
  lines.push('');
  lines.push('## Columns');
  for (const col of report.columns) {
    lines.push(
      `- **${col.column}** — fill ${(col.fillRate * 100).toFixed(1)}%, distinct ${col.distinctCount}, ` +
        `length ${col.minLength}-${col.maxLength}` +
        (col.guessedRole ? `, guessed role: ${col.guessedRole}` : ''),
    );
  }
  lines.push('');
  lines.push(`## Duplicate headwords: ${report.duplicateHeadwords.length}`);
  for (const dup of report.duplicateHeadwords.slice(0, 20)) {
    lines.push(`- ${dup.value} (${dup.count}x)`);
  }
  lines.push('');
  lines.push('## Media');
  for (const m of report.media) {
    const total = m.totalFiles || 1;
    lines.push(
      `- ${m.kind}: exact ${m.matchedByExact} (${((m.matchedByExact / total) * 100).toFixed(1)}%), ` +
        `prefix-glob ${m.matchedByPrefixGlob} (${((m.matchedByPrefixGlob / total) * 100).toFixed(1)}%), ` +
        `unmatched ${m.unmatched} (${((m.unmatched / total) * 100).toFixed(1)}%)`,
    );
  }
  return lines.join('\n') + '\n';
}

function renderValidationMarkdown(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push(`# Validation report — ${report.datasetId}`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt} (run ${report.runId})`);
  lines.push(`Total words mapped: ${report.totalWords}`);
  lines.push('');
  lines.push(`## Errors: ${report.errors.length}`);
  for (const e of report.errors.slice(0, 200)) {
    lines.push(`- row ${e.row}${e.text ? ` (${e.text})` : ''}: ${e.message}`);
  }
  lines.push('');
  lines.push(`## Warnings: ${report.warnings.length}`);
  for (const w of report.warnings.slice(0, 200)) {
    lines.push(`- row ${w.row}${w.text ? ` (${w.text})` : ''}: ${w.message}`);
  }
  lines.push('');
  lines.push(`## In-file duplicates: ${report.inFileDuplicates.length}`);
  for (const d of report.inFileDuplicates) {
    lines.push(`- ${d.text} (rows ${d.rows.join(', ')})`);
  }
  lines.push('');
  lines.push(`## Already in database: ${report.dbDuplicates.length}`);
  for (const d of report.dbDuplicates.slice(0, 50)) {
    lines.push(`- ${d.text} (id ${d.existingId})`);
  }
  return lines.join('\n') + '\n';
}

function shouldRun(stage: Stage, requested: string | undefined): boolean {
  if (!requested)
    return stage === 'analyze' || stage === 'map' || stage === 'validate';
  return requested === stage;
}

// Carries forward any entry already 'uploaded' in a prior run so a resumed
// media stage never re-uploads a file it already finished (approved plan
// §8/§11) — resolution itself is cheap and deterministic, so it's always
// redone fresh; only upload outcomes need to survive across runs.
function mergeManifest(fresh: MediaManifest, buildDir: string): MediaManifest {
  const manifestPath = path.join(buildDir, 'media-manifest.json');
  if (!fs.existsSync(manifestPath)) return fresh;

  const previous = readJson<MediaManifest>(manifestPath);
  const previousByKey = new Map(
    previous.entries.map((e) => [`${e.kind}:${e.textKey}`, e]),
  );

  for (const entry of fresh.entries) {
    const prior = previousByKey.get(`${entry.kind}:${entry.textKey}`);
    if (prior?.status === 'uploaded') {
      entry.status = 'uploaded';
      entry.secureUrl = prior.secureUrl;
    }
  }

  return fresh;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadDatasetConfig(args.dataset);
  const buildDir = buildDatasetBuildDir(args.dataset);
  const runId = randomUUID();

  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    let mapped: MappedArtifact | undefined;

    if (shouldRun('analyze', args.stage)) {
      const analyzer = app.get(DatasetAnalyzerService);
      const report = await analyzer.analyze(config, runId);
      writeJson(path.join(buildDir, 'analysis.json'), report);
      fs.writeFileSync(
        path.join(buildDir, 'analysis.md'),
        renderAnalysisMarkdown(report),
      );
      console.log(
        `[analyze] ${report.file.rowCount} rows, ${report.columns.length} columns → ${path.join(buildDir, 'analysis.md')}`,
      );
    }

    if (shouldRun('map', args.stage)) {
      const registry = app.get(MapperRegistry);
      const table = await loadRawTable(config);
      const mapper = registry.get(config.mapper);
      const result = mapper.map(table, config);
      mapped = result;
      writeJson(path.join(buildDir, 'mapped.json'), {
        runId,
        datasetId: config.id,
        words: result.words,
        issues: result.issues,
      });
      console.log(
        `[map] ${result.words.length} words mapped, ${result.issues.length} mapping issue(s)`,
      );
    }

    if (shouldRun('validate', args.stage)) {
      if (!mapped) {
        mapped = readJson<MappedArtifact>(path.join(buildDir, 'mapped.json'));
      }
      const validator = app.get(ImportValidatorService);
      const report = await validator.validate(
        mapped.words,
        mapped.issues,
        config,
        runId,
      );
      writeJson(path.join(buildDir, 'validation.json'), report);
      fs.writeFileSync(
        path.join(buildDir, 'validation.md'),
        renderValidationMarkdown(report),
      );
      console.log(
        `[validate] ${report.errors.length} error(s), ${report.warnings.length} warning(s) → ${path.join(buildDir, 'validation.md')}`,
      );
      if (report.errors.length > 0 && !args.allowPartial) {
        console.log(
          'Import blocked: fix the errors above (or pass --allow-partial) before running the media/import stages.',
        );
        process.exitCode = 1;
      }
    }

    if (args.stage === 'media') {
      if (!mapped) {
        mapped = readJson<MappedArtifact>(path.join(buildDir, 'mapped.json'));
      }
      const words = args.limit
        ? mapped.words.slice(0, args.limit)
        : mapped.words;

      const resolver = app.get(MediaResolverService);
      const manifest = mergeManifest(
        resolver.resolve(words, config, runId),
        buildDir,
      );

      const persist = () =>
        writeJson(path.join(buildDir, 'media-manifest.json'), manifest);
      persist();

      if (args.dryRun) {
        // Dry-run never uploads (approved plan §3's fix) — the manifest is
        // resolved so the preview shows what would upload / what's missing,
        // but every non-preexisting entry stays 'pending'.
        const pending = manifest.entries.filter(
          (e) => e.status === 'pending',
        ).length;
        const missing = manifest.entries.filter(
          (e) => e.status === 'missing',
        ).length;
        console.log(
          `[media] (dry-run) ${pending} would upload, ${missing} missing (no local file or remote URL)`,
        );
      } else {
        const uploader = app.get(MediaUploaderService);
        await uploader.upload(manifest, persist);
        const uploaded = manifest.entries.filter(
          (e) => e.status === 'uploaded',
        ).length;
        const failed = manifest.entries.filter(
          (e) => e.status === 'failed',
        ).length;
        const missing = manifest.entries.filter(
          (e) => e.status === 'missing',
        ).length;
        console.log(
          `[media] ${uploaded} uploaded, ${failed} failed, ${missing} missing`,
        );
      }
    }

    if (args.stage === 'import') {
      const validationPath = path.join(buildDir, 'validation.json');
      if (fs.existsSync(validationPath)) {
        const validation = readJson<ValidationReport>(validationPath);
        if (validation.errors.length > 0 && !args.allowPartial) {
          console.log(
            `Import blocked: validation.json has ${validation.errors.length} error(s). Fix them (or pass --allow-partial) and re-run validate.`,
          );
          process.exitCode = 1;
          return;
        }
      } else {
        console.log(
          'Warning: no validation.json found — proceeding without a validation gate.',
        );
      }

      if (!mapped) {
        mapped = readJson<MappedArtifact>(path.join(buildDir, 'mapped.json'));
      }
      const words = args.limit
        ? mapped.words.slice(0, args.limit)
        : mapped.words;

      const manifestPath = path.join(buildDir, 'media-manifest.json');
      const manifest = fs.existsSync(manifestPath)
        ? readJson<MediaManifest>(manifestPath)
        : undefined;

      const startedAt = Date.now();
      const engine = app.get(ImportEngineService);
      const engineResult = await engine.import(words, manifest, {
        mode: args.mode,
        dryRun: args.dryRun,
        forceOverwrite: args.forceOverwrite,
        importSource: config.importSource,
      });

      const deckBuilder = app.get(DeckBuilderService);
      const deckResult = await deckBuilder.build(
        words,
        engineResult.wordIdByNormalizedText,
        config,
        args.dryRun,
      );

      const summary: ImportSummary = {
        runId,
        datasetId: config.id,
        generatedAt: new Date().toISOString(),
        frameworkVersion: '1.0.0',
        dryRun: args.dryRun,
        created: engineResult.created,
        updated: engineResult.updated,
        skipped: engineResult.skipped,
        skippedProtected: engineResult.skippedProtected,
        failed: engineResult.failed,
        decksCreated: deckResult.decksCreated,
        decksReused: deckResult.decksReused,
        attached: deckResult.attached,
        mediaUploaded: manifest
          ? manifest.entries.filter((e) => e.status === 'uploaded').length
          : 0,
        mediaFailed: manifest
          ? manifest.entries.filter((e) => e.status === 'failed').length
          : 0,
        unattachedNoDeckKey: deckResult.unattachedNoDeckKey,
        durationMs: Date.now() - startedAt,
      };

      writeJson(path.join(buildDir, 'import-summary.json'), summary);
      console.log(
        `[import]${args.dryRun ? ' (dry-run)' : ''} created ${summary.created}, updated ${summary.updated}, ` +
          `skipped ${summary.skipped}, skippedProtected ${summary.skippedProtected}, failed ${summary.failed.length}, ` +
          `decks +${summary.decksCreated}/${summary.decksReused}, attached ${summary.attached}`,
      );
      if (summary.failed.length > 0) {
        for (const f of summary.failed)
          console.log(`  failed: row ${f.row} (${f.text}): ${f.error}`);
      }
    }
  } catch (err) {
    console.error(`vocab-import failed: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main();
