// Every artifact is stamped so a stage can refuse to consume an artifact
// generated for a different dataset/run (see the approved plan §12).
export interface ArtifactStamp {
  runId: string;
  datasetId: string;
  generatedAt: string;
  frameworkVersion: string;
}

export interface ColumnStat {
  column: string;
  fillRate: number;
  distinctCount: number;
  minLength: number;
  maxLength: number;
  topValues: { value: string; count: number }[];
  // Suggestion only, never auto-applied to the mapping config (approved
  // plan §5 / critique #8) — an admin (or whoever writes the config) reads
  // this, the config remains the explicit source of truth.
  guessedRole?: 'ipa' | 'url' | 'partOfSpeech' | 'vietnamese' | 'example';
}

export interface AnalysisReport extends ArtifactStamp {
  file: {
    format: string;
    path: string;
    hasBom: boolean;
    delimiter?: string;
    rowCount: number;
    headers: string[];
  };
  columns: ColumnStat[];
  duplicateHeadwords: { value: string; count: number }[];
  media: {
    kind: 'audio' | 'image';
    root: string;
    totalFiles: number;
    matchedByExact: number;
    matchedByPrefixGlob: number;
    unmatched: number;
  }[];
}

export interface ValidationIssue {
  row: number;
  text?: string;
  field?: string;
  message: string;
}

export interface ValidationReport extends ArtifactStamp {
  totalWords: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  inFileDuplicates: { text: string; rows: number[] }[];
  dbDuplicates: { text: string; existingId: string }[];
}

export type MediaEntryStatus = 'pending' | 'uploaded' | 'missing' | 'failed';

export interface MediaManifestEntry {
  textKey: string;
  kind: 'audio' | 'image';
  localPath?: string;
  remoteUrl?: string;
  publicId: string;
  status: MediaEntryStatus;
  secureUrl?: string;
  error?: string;
}

export interface MediaManifest extends ArtifactStamp {
  entries: MediaManifestEntry[];
}

export interface ImportSummary extends ArtifactStamp {
  dryRun: boolean;
  created: number;
  updated: number;
  skipped: number;
  skippedProtected: number;
  failed: { text: string; row: number; error: string }[];
  decksCreated: number;
  decksReused: number;
  attached: number;
  mediaUploaded: number;
  mediaFailed: number;
  unattachedNoDeckKey: string[];
  durationMs: number;
}
