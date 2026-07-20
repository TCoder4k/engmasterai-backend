import * as fs from 'fs';
import { RawTable } from '../../types/raw-table';

export function readJson(filePath: string): RawTable {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a top-level JSON array of row objects`);
  }

  const headerSet = new Set<string>();
  const rows: Record<string, string>[] = parsed.map((item) => {
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(item ?? {})) {
      headerSet.add(key);
      record[key] = value === null || value === undefined ? '' : String(value);
    }
    return record;
  });

  return { headers: Array.from(headerSet), rows };
}
