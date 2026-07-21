import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { DatasetConfig } from '../types/dataset-config';
import { AnalysisReport, ColumnStat } from '../types/artifacts';
import { loadRawTable } from './table-loader';
import { slugify } from '../media/slug';
import { matchLocalFile } from '../media/media-matcher';
import { getDeckKey } from '../mappers/deck-key';
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from '../media/media-extensions';
import { FRAMEWORK_VERSION } from '../version';

const IPA_PATTERN = /^\/.*\/$/;
const URL_PATTERN = /^https?:\/\//i;
const POS_PATTERN = /^[a-z]{1,6}\.$/i;
const VIETNAMESE_DIACRITIC_PATTERN =
  /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;

@Injectable()
export class DatasetAnalyzerService {
  async analyze(config: DatasetConfig, runId: string): Promise<AnalysisReport> {
    const table = await loadRawTable(config);
    const { headers, rows } = table;

    const columns: ColumnStat[] = headers.map((header) =>
      this.computeColumnStat(header, rows),
    );

    const headwordColumn = config.columns?.text;
    const duplicateHeadwords = headwordColumn
      ? this.findDuplicateHeadwords(rows, headwordColumn)
      : [];

    const media: AnalysisReport['media'] = [];
    if (config.media?.audio && headwordColumn) {
      media.push(
        this.computeMediaStats(
          'audio',
          config.media.audio,
          rows,
          headwordColumn,
          config.deckFrom,
          AUDIO_EXTENSIONS,
        ),
      );
    }
    if (config.media?.image && headwordColumn) {
      media.push(
        this.computeMediaStats(
          'image',
          config.media.image,
          rows,
          headwordColumn,
          config.deckFrom,
          IMAGE_EXTENSIONS,
        ),
      );
    }

    return {
      runId,
      datasetId: config.id,
      generatedAt: new Date().toISOString(),
      frameworkVersion: FRAMEWORK_VERSION,
      file: {
        format: table.format,
        path: config.files.table,
        hasBom: table.hasBom ?? false,
        delimiter: table.delimiter,
        rowCount: rows.length,
        headers,
      },
      columns,
      duplicateHeadwords,
      media,
    };
  }

  private computeColumnStat(
    header: string,
    rows: Record<string, string>[],
  ): ColumnStat {
    const values = rows.map((r) => (r[header] ?? '').trim());
    const nonEmpty = values.filter((v) => v.length > 0);
    const distinct = new Map<string, number>();
    for (const v of nonEmpty) {
      distinct.set(v, (distinct.get(v) ?? 0) + 1);
    }
    const topValues = Array.from(distinct.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([value, count]) => ({ value, count }));

    const lengths = nonEmpty.map((v) => v.length);

    return {
      column: header,
      fillRate: rows.length === 0 ? 0 : nonEmpty.length / rows.length,
      distinctCount: distinct.size,
      minLength: lengths.length ? Math.min(...lengths) : 0,
      maxLength: lengths.length ? Math.max(...lengths) : 0,
      topValues,
      guessedRole: this.guessRole(header, nonEmpty),
    };
  }

  private guessRole(
    header: string,
    values: string[],
  ): ColumnStat['guessedRole'] {
    if (values.length === 0) return undefined;
    const sample = values.slice(0, 50);

    if (sample.every((v) => IPA_PATTERN.test(v))) return 'ipa';
    if (sample.every((v) => URL_PATTERN.test(v))) return 'url';
    if (sample.every((v) => POS_PATTERN.test(v))) return 'partOfSpeech';
    if (
      sample.filter((v) => VIETNAMESE_DIACRITIC_PATTERN.test(v)).length /
        sample.length >
      0.5
    ) {
      return 'vietnamese';
    }
    const avgLength =
      sample.reduce((sum, v) => sum + v.length, 0) / sample.length;
    if (avgLength > 25 && sample.some((v) => /[.!?]$/.test(v)))
      return 'example';

    return undefined;
  }

  private findDuplicateHeadwords(
    rows: Record<string, string>[],
    headwordColumn: string,
  ): { value: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const normalized = (row[headwordColumn] ?? '').trim().toLowerCase();
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([value, count]) => ({ value, count }));
  }

  private computeMediaStats(
    kind: 'audio' | 'image',
    source: NonNullable<DatasetConfig['media']>['audio'],
    rows: Record<string, string>[],
    headwordColumn: string,
    deckFrom: DatasetConfig['deckFrom'],
    extensions: string[],
  ): AnalysisReport['media'][number] {
    if (!source) {
      return {
        kind,
        root: '',
        totalFiles: 0,
        matchedByExact: 0,
        matchedByPrefixGlob: 0,
        unmatched: 0,
      };
    }

    let matchedByExact = 0;
    let matchedByPrefixGlob = 0;
    let unmatched = 0;

    for (const row of rows) {
      const text = row[headwordColumn];
      const deckKey = getDeckKey(row, deckFrom);
      if (!text) continue;

      const slug = slugify(text, source.slug);
      const dir = path.join(source.root, deckKey);
      const result = matchLocalFile(dir, slug, extensions);

      if (result.matchType === 'exact') matchedByExact++;
      else if (result.matchType === 'prefixGlob') matchedByPrefixGlob++;
      else unmatched++;
    }

    return {
      kind,
      root: source.root,
      totalFiles: rows.length,
      matchedByExact,
      matchedByPrefixGlob,
      unmatched,
    };
  }
}
