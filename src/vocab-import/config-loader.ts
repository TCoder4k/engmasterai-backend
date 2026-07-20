import * as fs from 'fs';
import * as path from 'path';
import { DatasetConfig } from './types/dataset-config';

// The one place VOCAB_DATASET_ROOT is read (approved plan §2's fix for the
// original hardcoded ../../../dataset/... assumption). Config files store
// paths relative to this root so they work regardless of where the two
// sibling repos are checked out.
export function resolveDatasetRoot(): string {
  const configured = process.env.VOCAB_DATASET_ROOT;
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, '..', '..', '..', 'dataset');
}

function resolveConfigPaths(config: DatasetConfig, datasetRoot: string): DatasetConfig {
  const resolved: DatasetConfig = {
    ...config,
    files: { ...config.files, table: path.resolve(datasetRoot, config.files.table) },
  };

  if (config.media) {
    resolved.media = {};
    if (config.media.audio) {
      resolved.media.audio = {
        ...config.media.audio,
        root: path.resolve(datasetRoot, config.media.audio.root),
      };
    }
    if (config.media.image) {
      resolved.media.image = {
        ...config.media.image,
        root: path.resolve(datasetRoot, config.media.image.root),
      };
    }
  }

  return resolved;
}

export function loadDatasetConfig(datasetId: string): DatasetConfig {
  const configPath = path.join(__dirname, 'datasets', `${datasetId}.config.json`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`No dataset config found for "${datasetId}" (expected ${configPath})`);
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  let parsed: DatasetConfig;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Could not parse dataset config ${configPath}: ${(err as Error).message}`);
  }

  validateConfigShape(parsed, configPath);

  const datasetRoot = resolveDatasetRoot();
  return resolveConfigPaths(parsed, datasetRoot);
}

function validateConfigShape(config: Partial<DatasetConfig>, configPath: string): void {
  const problems: string[] = [];

  if (!config.id) problems.push('missing "id"');
  if (!config.mapper) problems.push('missing "mapper"');
  if (!config.importSource) problems.push('missing "importSource"');
  if (!config.files?.table) problems.push('missing "files.table"');
  if (!config.library?.name) problems.push('missing "library.name"');
  if (!config.library?.description) problems.push('missing "library.description" (schema-required)');
  if (!config.deckFrom) problems.push('missing "deckFrom"');
  if (!config.columns?.text) problems.push('missing "columns.text"');
  if (!config.columns?.meanings || config.columns.meanings.length === 0) {
    problems.push('missing "columns.meanings" (at least one required)');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid dataset config ${configPath}:\n  - ${problems.join('\n  - ')}`);
  }
}

export function buildDatasetBuildDir(datasetId: string): string {
  const datasetRoot = resolveDatasetRoot();
  return path.join(datasetRoot, datasetId, 'build');
}
