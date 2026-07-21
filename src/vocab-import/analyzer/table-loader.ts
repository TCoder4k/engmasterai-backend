import * as path from 'path';
import { DatasetConfig, RawFileFormat } from '../types/dataset-config';
import { RawTable } from '../types/raw-table';
import { readCsv, CsvReadResult } from './readers/csv-reader';
import { readXlsx } from './readers/xlsx-reader';
import { readJson } from './readers/json-reader';

function detectFormat(filePath: string): RawFileFormat {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') return 'csv';
  if (ext === '.xlsx') return 'xlsx';
  if (ext === '.json') return 'json';
  throw new Error(`Cannot detect file format from extension: ${filePath}`);
}

export interface LoadedTable extends RawTable {
  format: RawFileFormat;
  hasBom?: boolean;
  delimiter?: string;
}

export async function loadRawTable(
  config: DatasetConfig,
): Promise<LoadedTable> {
  const filePath = config.files.table;
  const format = config.files.format ?? detectFormat(filePath);

  if (format === 'csv') {
    const result: CsvReadResult = readCsv(filePath);
    return { ...result, format };
  }
  if (format === 'xlsx') {
    const table = await readXlsx(filePath, config.files.sheet);
    return { ...table, format };
  }
  if (format === 'json') {
    const table = readJson(filePath);
    return { ...table, format };
  }

  throw new Error(`Unsupported file format: ${format}`);
}
