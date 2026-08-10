import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { parse } from 'csv-parse/sync';
import { PrismaClient } from '@prisma/client';
import { resolveDatasetRoot, buildDatasetBuildDir } from '../config-loader';
import { normalizeDedupeKey } from '../validation/normalizers';
import {
  AnalysisReport,
  ValidationReport,
  MediaManifest,
  ImportSummary,
} from '../types/artifacts';

// ---------------------------------------------------------------------------
// One-off orchestrator for the "1000 Từ Tiếng Anh Thông Dụng" dataset. It
// does NOT change the shared src/vocab-import/** framework — it stages the
// real source CSV/media into the folder layout that framework already
// expects (see docs/CLAUDE.md's vocab-import section), then shells out to
// the existing `vocab-import` CLI for every actual stage. See the approved
// plan: C:\Users\DUY TU\.claude\plans\task-import-to-n-b-purrfect-phoenix.md
// ---------------------------------------------------------------------------

const DATASET_ID = '1000-common-words';
const LIBRARY_NAME = '1000 Từ Tiếng Anh Thông Dụng';
const BACKEND_ROOT = path.resolve(__dirname, '..', '..', '..');
const SOURCE_ROOT = path.resolve(BACKEND_ROOT, '..', '1000_common_word');
const SOURCE_CSV = path.join(SOURCE_ROOT, 'FULL_1000_ENGLISH_WORDS_CLEAN.csv');
const SOURCE_AUDIO_DIR = path.join(SOURCE_ROOT, 'audio');
const SOURCE_IMG_DIR = path.join(SOURCE_ROOT, 'img');

const STAGE_DIR = path.join(resolveDatasetRoot(), DATASET_ID);
const STAGED_CSV = path.join(STAGE_DIR, 'source', 'words.csv');
const STAGED_AUDIO_DIR = path.join(STAGE_DIR, 'media', 'audio');
const STAGED_IMG_DIR = path.join(STAGE_DIR, 'media', 'img');

// Classified per the approved plan: every one of these 9 rows has its
// PartOfSpeech/Phonetics/VietnameseTranslation columns shifted by a source
// CSV bug (a two-word headword's second token leaked into the PartOfSpeech
// cell), AND the EnglishDefinition/VietnameseDefinition/ExampleSentence
// describe the FIRST WORD ALONE, not the compound implied by the merged
// Phonetics+Translation cell. Reconstructing the headword would pair a
// correct compound term with a definition that is factually wrong for it —
// worse than not importing the row. AMBIGUOUS_SKIP, not reconstructed.
const EXCLUDED_ROWS: { word: string; posCell: string; reason: string }[] = [
  { word: 'dining', posCell: 'room', reason: 'implied compound "dining room"; EnglishDefinition describes "dining" alone' },
  { word: 'living', posCell: 'room', reason: 'implied compound "living room"; EnglishDefinition describes "living" alone' },
  { word: 'frying', posCell: 'pan', reason: 'implied compound "frying pan"; EnglishDefinition describes "frying" alone' },
  { word: 'ice', posCell: 'cream', reason: 'implied compound "ice cream"; EnglishDefinition describes "ice" alone' },
  { word: 'credit', posCell: 'card', reason: 'implied compound "credit card"; EnglishDefinition describes "credit" alone' },
  { word: 'debit', posCell: 'card', reason: 'implied compound "debit card"; EnglishDefinition describes "debit" alone' },
  { word: 'sign', posCell: 'language', reason: 'implied compound "sign language"; EnglishDefinition describes "sign" alone' },
  { word: 'social', posCell: 'media', reason: 'implied compound "social media"; EnglishDefinition describes "social" alone' },
  { word: 'prime', posCell: 'minister', reason: 'implied compound "prime minister"; EnglishDefinition describes "prime" alone' },
  // Found during dry-run review (not a compound-headword split): IPA is
  // literally split mid-string across Phonetics="/ˌeɪ" and
  // VietnameseTranslation="tiː ˈem/ máy rút tiền tự động" (i.e. the intended
  // word is the banking machine, spelled "A-T-M" — Topic is "Mua sắm & Tiền
  // bạc" and the media files are atm.mp3/atm.png). But EnglishDefinition
  // ("a unit of pressure: the pressure that will support a column of
  // mercury...") is the definition of "atm" the PRESSURE UNIT, a completely
  // different word sense. Same failure mode as the 9 rows above — the
  // definition belongs to a different lexical item than the headword's own
  // IPA/translation/media imply — so AMBIGUOUS_SKIP, not reconstructed.
  { word: 'ATM', posCell: 'n', reason: 'EnglishDefinition is for "atm" the pressure unit, not the banking machine implied by IPA/Topic/media' },
];

const CSV_HEADER = [
  'Word',
  'Phonetics',
  'PartOfSpeech',
  'VietnameseTranslation',
  'EnglishDefinition',
  'VietnameseDefinition',
  'ExampleSentence',
  'ExampleTranslation',
  'AudioFileLink',
  'ImageFileLink',
  'Topic',
];

const AUDIO_EXT_CANDIDATES = ['.mp3', '.mp4', '.ogg', '.wav', '.webm'];
const IMAGE_EXT_CANDIDATES = ['.jpg', '.jpeg', '.png', '.webp'];

// Found during dry-run review, not in the original plan: 57 rows (9 of
// which are the excluded compound-headword rows above) have their
// Phonetics/VietnameseTranslation columns shifted — the real IPA got
// concatenated onto the front of VietnameseTranslation (e.g.
// VietnameseTranslation="/beɪʒ/ màu be" for "beige"), while Phonetics holds
// a bare POS-looking token ("adj") instead of real IPA. Cross-checked
// against EnglishDefinition/Example for a sample (beige, downstairs,
// travel, graduate, study, chat, purchase) — those fields correctly
// describe the row's own word in every case, so ONLY these three columns
// are affected, and the split is 100% mechanical (57/57 rows matched this
// exact `/…/ ` prefix pattern, zero rows had any other malformed
// Phonetics). This is un-merging a column that was never mapped to two
// fields correctly, not rewriting content.
//
// What is NOT reconstructed: which POS is correct. The corrupted
// PartOfSpeech cell for these rows is always "n," or "v," (44/4 rows
// dataset-wide) — checking "graduate" (PartOfSpeech="n,", Phonetics="v",
// EnglishDefinition="a person who...", i.e. a noun-style definition) shows
// neither column is reliably the true POS across all 48 kept rows, so
// guessing between them would be fabrication. posAliases intentionally
// drops "n,"/"v," (see the dataset config) so these 48 words import with a
// correct headword, IPA and Vietnamese translation but partOfSpeech: null
// — same treatment as the already-approved "n/adj" ambiguous rows.
const IPA_TRANSLATION_SHIFT_PATTERN = /^(\/[^/]+\/)\s+(.*)$/;

interface SourceRow {
  Word: string;
  Phonetics: string;
  PartOfSpeech: string;
  VietnameseTranslation: string;
  EnglishDefinition: string;
  VietnameseDefinition: string;
  ExampleSentence: string;
  ExampleTranslation: string;
  AudioFileLink: string;
  ImageFileLink: string;
  Topic: string;
}

interface StagingReport {
  csvTopicRows: number;
  excluded: { row: number; word: string; posCell: string; reason: string }[];
  validRows: number;
  uniqueWords: number;
  duplicateOccurrences: number;
  ipaTranslationShiftFixed: number;
  unmappedPosRows: { row: number; word: string; posCell: string }[];
  topics: { name: string; normalizedFrom?: string; rowCount: number }[];
  examples: { blankable: number; notBlankable: number; noExample: number };
  audio: { matched: number; missing: string[] };
  image: { matchedPlain: number; matchedPlaceholderRenamed: number; missing: string[] };
  orphanedByExclusion: { word: string; hasAudio: boolean; hasImage: boolean }[];
}

function csvField(value: string): string {
  const v = value ?? '';
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function writeCsv(filePath: string, header: string[], rows: SourceRow[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((col) => csvField((row as any)[col])).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\r\n') + '\r\n', 'utf-8');
}

function resolveAudioSource(word: string): string | null {
  for (const ext of AUDIO_EXT_CANDIDATES) {
    const p = path.join(SOURCE_AUDIO_DIR, `${word}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveImageSource(
  word: string,
): { filePath: string; kind: 'plain' | 'placeholder' } | null {
  for (const ext of IMAGE_EXT_CANDIDATES) {
    const plain = path.join(SOURCE_IMG_DIR, `${word}${ext}`);
    if (fs.existsSync(plain)) return { filePath: plain, kind: 'plain' };
  }
  for (const ext of IMAGE_EXT_CANDIDATES) {
    const placeholder = path.join(SOURCE_IMG_DIR, `${word}_placeholder${ext}`);
    if (fs.existsSync(placeholder)) return { filePath: placeholder, kind: 'placeholder' };
  }
  return null;
}

function copyFile(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// Idempotent: safe to re-run. Reads the real source dataset, never writes to
// it. Produces a cleaned CSV + per-topic media folders under
// dataset/1000-common-words/, and a report of exactly what it did.
function prepareStaging(): StagingReport {
  if (!fs.existsSync(SOURCE_CSV)) {
    throw new Error(`Source CSV not found at ${SOURCE_CSV}`);
  }

  const buffer = fs.readFileSync(SOURCE_CSV);
  const rawRows: SourceRow[] = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    delimiter: ',',
  });

  const csvTopicRows = rawRows.length;
  const excluded: StagingReport['excluded'] = [];
  const kept: { rowNumber: number; row: SourceRow }[] = [];
  // Must mirror datasets/1000-common-words.config.json's posAliases exactly.
  const posAliases = new Set(['n', 'v', 'adj', 'adv']);
  const unmappedPosRows: StagingReport['unmappedPosRows'] = [];
  let ipaTranslationShiftFixed = 0;

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const word = (row.Word ?? '').trim();
    const posCell = (row.PartOfSpeech ?? '').trim();

    const exclusion = EXCLUDED_ROWS.find(
      (e) => e.word === word && e.posCell === posCell,
    );
    if (exclusion) {
      excluded.push({ row: rowNumber, word, posCell, reason: exclusion.reason });
      return;
    }

    if (posCell && !posAliases.has(posCell)) {
      unmappedPosRows.push({ row: rowNumber, word, posCell });
    }

    kept.push({ rowNumber, row });
  });

  if (excluded.length !== EXCLUDED_ROWS.length) {
    throw new Error(
      `Expected exactly ${EXCLUDED_ROWS.length} excluded malformed rows, found ${excluded.length}. ` +
        `The source CSV may have changed — re-verify the exclusion list before proceeding.`,
    );
  }

  // Normalize: strip a stray leading ": " from Topic, and turn the literal
  // "No example" sentinel into a real empty value (a formatting
  // normalization, not fabricated content — see the approved plan).
  const topicNormalizations = new Map<string, string>();
  const cleanedRows: SourceRow[] = [];
  const seenTextKeys = new Set<string>();
  const topicRowCounts = new Map<string, number>();
  let blankable = 0;
  let notBlankable = 0;
  let noExample = 0;

  const audioMissing: string[] = [];
  const imageMissing: string[] = [];
  let imageMatchedPlain = 0;
  let imageMatchedPlaceholder = 0;

  for (let { row } of kept) {
    const word = row.Word.trim();

    const shiftMatch = IPA_TRANSLATION_SHIFT_PATTERN.exec(row.VietnameseTranslation.trim());
    if (shiftMatch) {
      row = { ...row, Phonetics: shiftMatch[1], VietnameseTranslation: shiftMatch[2].trim() };
      ipaTranslationShiftFixed++;
    }

    const originalTopic = row.Topic.trim();
    const normalizedTopic = originalTopic.replace(/^:\s*/, '').trim();
    if (normalizedTopic !== originalTopic) {
      topicNormalizations.set(originalTopic, normalizedTopic);
    }

    let exampleSentence = row.ExampleSentence.trim();
    let exampleTranslation = row.ExampleTranslation.trim();
    if (exampleSentence.toLowerCase() === 'no example') {
      exampleSentence = '';
      exampleTranslation = '';
    }

    if (!exampleSentence) {
      noExample++;
    } else if (exampleSentence.toLowerCase().includes(word.toLowerCase())) {
      blankable++;
    } else {
      notBlankable++;
    }

    topicRowCounts.set(normalizedTopic, (topicRowCounts.get(normalizedTopic) ?? 0) + 1);

    cleanedRows.push({
      ...row,
      Topic: normalizedTopic,
      ExampleSentence: exampleSentence,
      ExampleTranslation: exampleTranslation,
    });

    // Media: only the FIRST occurrence of a normalized word text is staged —
    // this matches both the import engine's dedupe-by-text (first row wins
    // the word's own content) and the media resolver's own per-text dedupe
    // (it also only ever looks up the first occurrence's deckKey), so this
    // is not a simplification, it's staging exactly what the real pipeline
    // will actually look for.
    const key = normalizeDedupeKey(word);
    if (!seenTextKeys.has(key)) {
      seenTextKeys.add(key);

      const audioSrc = resolveAudioSource(word);
      if (audioSrc) {
        copyFile(audioSrc, path.join(STAGED_AUDIO_DIR, normalizedTopic, `${word}.mp3`));
      } else {
        audioMissing.push(word);
      }

      const imageSrc = resolveImageSource(word);
      if (imageSrc) {
        copyFile(imageSrc.filePath, path.join(STAGED_IMG_DIR, normalizedTopic, `${word}.jpg`));
        if (imageSrc.kind === 'plain') imageMatchedPlain++;
        else imageMatchedPlaceholder++;
      } else {
        imageMissing.push(word);
      }
    }
  }

  writeCsv(STAGED_CSV, CSV_HEADER, cleanedRows);

  const orphanedByExclusion = EXCLUDED_ROWS.map((e) => ({
    word: e.word,
    hasAudio: resolveAudioSource(e.word) !== null,
    hasImage: resolveImageSource(e.word) !== null,
  }));

  const validRows = cleanedRows.length;
  const uniqueWords = seenTextKeys.size;
  const duplicateOccurrences = validRows - uniqueWords;

  // Sanity assertions — fail loudly rather than silently drift from the
  // numbers verified during planning.
  const expected = { validRows: 1009, uniqueWords: 937, duplicateOccurrences: 72 };
  const mismatches: string[] = [];
  if (validRows !== expected.validRows)
    mismatches.push(`validRows: expected ${expected.validRows}, got ${validRows}`);
  if (uniqueWords !== expected.uniqueWords)
    mismatches.push(`uniqueWords: expected ${expected.uniqueWords}, got ${uniqueWords}`);
  if (duplicateOccurrences !== expected.duplicateOccurrences)
    mismatches.push(
      `duplicateOccurrences: expected ${expected.duplicateOccurrences}, got ${duplicateOccurrences}`,
    );
  if (mismatches.length > 0) {
    throw new Error(
      `Staging produced unexpected counts versus the verified plan — stopping rather than proceeding silently:\n  - ${mismatches.join('\n  - ')}`,
    );
  }

  return {
    csvTopicRows,
    excluded,
    validRows,
    uniqueWords,
    duplicateOccurrences,
    ipaTranslationShiftFixed,
    unmappedPosRows,
    topics: [...topicRowCounts.entries()].map(([name, rowCount]) => {
      const normalizedFromEntry = [...topicNormalizations.entries()].find(
        ([, to]) => to === name,
      );
      return { name, normalizedFrom: normalizedFromEntry?.[0], rowCount };
    }),
    examples: { blankable, notBlankable, noExample },
    audio: { matched: uniqueWords - audioMissing.length, missing: audioMissing },
    image: {
      matchedPlain: imageMatchedPlain,
      matchedPlaceholderRenamed: imageMatchedPlaceholder,
      missing: imageMissing,
    },
    orphanedByExclusion,
  };
}

function printStagingReport(r: StagingReport): void {
  console.log('\n================ STAGING REPORT ================');
  console.log(`CSV topic rows:                 ${r.csvTopicRows}`);
  console.log(`Excluded (malformed, AMBIGUOUS_SKIP): ${r.excluded.length}`);
  for (const e of r.excluded) {
    console.log(`  - row ${e.row}: Word="${e.word}", PartOfSpeech-cell="${e.posCell}" — ${e.reason} — NOT imported`);
  }
  console.log(`Valid rows carried into mapping: ${r.validRows}`);
  console.log(`Cross-topic duplicate occurrences: ${r.duplicateOccurrences}`);
  console.log(`Unique vocabulary headwords:     ${r.uniqueWords}`);
  console.log(`\nIPA/VietnameseTranslation column-shift fixed (mechanical un-merge): ${r.ipaTranslationShiftFixed} rows`);
  console.log(`\nResidual unmapped PartOfSpeech: ${r.unmappedPosRows.length}`);
  for (const u of r.unmappedPosRows) {
    console.log(`  - row ${u.row}: Word="${u.word}", PartOfSpeech="${u.posCell}" (left null, not guessed)`);
  }
  console.log(`\nTopics normalized (stray leading ": " stripped):`);
  for (const t of r.topics) {
    if (t.normalizedFrom) console.log(`  - "${t.normalizedFrom}" → "${t.name}"`);
  }
  console.log(`\nTopics → decks (word-row count per topic):`);
  for (const t of r.topics) {
    console.log(`  - ${t.name}: ${t.rowCount}`);
  }
  console.log(`\nExamples: blankable=${r.examples.blankable}, notBlankable=${r.examples.notBlankable}, noExample=${r.examples.noExample}`);
  console.log(`\nAudio staged: matched=${r.audio.matched}/${r.uniqueWords}, missing=${r.audio.missing.length}${r.audio.missing.length ? ' (' + r.audio.missing.join(', ') + ')' : ''}`);
  console.log(
    `Image staged: exact=${r.image.matchedPlain}, placeholder-renamed=${r.image.matchedPlaceholderRenamed}, missing=${r.image.missing.length}${r.image.missing.length ? ' (' + r.image.missing.join(', ') + ')' : ''}`,
  );
  console.log(`\nMedia orphaned by the 9 excluded rows (real files, word never imported):`);
  for (const o of r.orphanedByExclusion) {
    console.log(`  - ${o.word}: audio=${o.hasAudio}, image=${o.hasImage}`);
  }
  console.log('==================================================\n');
}

function runCli(args: string[]): void {
  const cmd = `npm run vocab-import -- --dataset ${DATASET_ID} ${args.join(' ')}`;
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: BACKEND_ROOT, stdio: 'inherit' });
}

function readJson<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function printFrameworkArtifacts(dryRun: boolean): void {
  const buildDir = buildDatasetBuildDir(DATASET_ID);
  const analysis = readJson<AnalysisReport>(path.join(buildDir, 'analysis.json'));
  const validation = readJson<ValidationReport>(path.join(buildDir, 'validation.json'));
  const manifest = readJson<MediaManifest>(path.join(buildDir, 'media-manifest.json'));
  const summary = readJson<ImportSummary>(path.join(buildDir, 'import-summary.json'));

  console.log('\n============ FRAMEWORK ARTIFACTS SUMMARY ============');
  if (analysis) {
    console.log(`analyze: ${analysis.file.rowCount} rows read, ${analysis.columns.length} columns`);
  }
  if (validation) {
    console.log(`validate: ${validation.errors.length} error(s), ${validation.warnings.length} warning(s)`);
    console.log(`  in-file duplicates reported: ${validation.inFileDuplicates.length}`);
    console.log(`  already-in-DB duplicates: ${validation.dbDuplicates.length}`);
  }
  if (manifest) {
    const byKind = (kind: 'audio' | 'image') => manifest.entries.filter((e) => e.kind === kind);
    for (const kind of ['audio', 'image'] as const) {
      const entries = byKind(kind);
      const matched = entries.filter((e) => e.status === 'pending' || e.status === 'uploaded').length;
      const missing = entries.filter((e) => e.status === 'missing').length;
      console.log(`media (${kind}): ${entries.length} entries — matched(local)=${matched}, missing=${missing}`);
    }
  }
  if (summary) {
    console.log(
      `import${dryRun ? ' (dry-run)' : ''}: created=${summary.created}, updated=${summary.updated}, skipped=${summary.skipped}, skippedProtected=${summary.skippedProtected}, failed=${summary.failed.length}`,
    );
    console.log(`  decks: +${summary.decksCreated} created / ${summary.decksReused} reused, attached=${summary.attached}`);
    if (summary.unattachedNoDeckKey.length > 0) {
      console.log(`  WARNING unattachedNoDeckKey: ${summary.unattachedNoDeckKey.length}`);
    }
    if (summary.failed.length > 0) {
      for (const f of summary.failed) console.log(`  failed: row ${f.row} (${f.text}): ${f.error}`);
    }
  }
  console.log('=======================================================\n');
}

async function autoPublishQualifyingDecks(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const library = await prisma.vocabLibrary.findFirst({ where: { name: LIBRARY_NAME } });
    if (!library) {
      console.log(`No library named "${LIBRARY_NAME}" found — skipping publish.`);
      return;
    }
    const decks = await prisma.vocabDeck.findMany({
      where: { libraryId: library.id, isPublished: false },
      include: { _count: { select: { deckWords: true } } },
    });
    let published = 0;
    for (const deck of decks) {
      if (deck._count.deckWords > 0) {
        await prisma.vocabDeck.update({ where: { id: deck.id }, data: { isPublished: true } });
        published++;
      }
    }
    console.log(`Auto-published ${published}/${decks.length} newly-unpublished deck(s) with ≥1 word.`);
  } finally {
    await prisma.$disconnect();
  }
}

type Mode = 'dry-run' | 'write' | 'upload-media';

function parseMode(argv: string[]): Mode {
  if (argv.includes('--write')) return 'write';
  if (argv.includes('--upload-media')) return 'upload-media';
  return 'dry-run';
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  console.log(`Mode: ${mode}`);

  const report = prepareStaging();
  printStagingReport(report);

  runCli(['--stage', 'analyze']);
  runCli(['--stage', 'map']);
  runCli(['--stage', 'validate', '--allow-partial']);

  if (mode === 'dry-run') {
    runCli(['--stage', 'media', '--dry-run']);
    runCli(['--stage', 'import', '--dry-run', '--allow-partial']);
    printFrameworkArtifacts(true);
    console.log('DRY RUN complete. No DB writes, no media uploads. Review the report above before running --write.');
    return;
  }

  if (mode === 'write') {
    runCli(['--stage', 'import', '--mode', 'skip', '--allow-partial']);
    printFrameworkArtifacts(false);
    await autoPublishQualifyingDecks();
    return;
  }

  if (mode === 'upload-media') {
    runCli(['--stage', 'media']); // real Cloudinary upload — only reached with --upload-media
    runCli(['--stage', 'import', '--mode', 'upsert', '--allow-partial']);
    printFrameworkArtifacts(false);
    await autoPublishQualifyingDecks();
    return;
  }
}

main().catch((err) => {
  console.error(`run-1000-common-words failed: ${(err as Error).message}`);
  process.exitCode = 1;
});
