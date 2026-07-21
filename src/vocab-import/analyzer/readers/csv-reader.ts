import * as fs from 'fs';
import { parse } from 'csv-parse/sync';
import { RawTable } from '../../types/raw-table';

const DELIMITER_CANDIDATES = [',', ';', '\t', '|'];

// Sniffs the delimiter by counting occurrences on the header line only —
// good enough for the well-formed exports this framework targets, and never
// silently guessed past this file: the analyzer reports whatever was
// detected so a bad guess is visible before mapping runs.
function sniffDelimiter(headerLine: string): string {
  let best = ',';
  let bestCount = -1;
  for (const candidate of DELIMITER_CANDIDATES) {
    const count = headerLine.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

export interface CsvReadResult extends RawTable {
  hasBom: boolean;
  delimiter: string;
}

export function readCsv(filePath: string): CsvReadResult {
  const buffer = fs.readFileSync(filePath);
  const hasBom =
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf;

  const text = buffer.toString('utf-8');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = sniffDelimiter(firstLine.replace(/^﻿/, ''));

  const rows: Record<string, string>[] = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    delimiter,
  });

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  return { headers, rows, hasBom, delimiter };
}
