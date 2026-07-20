import { DatasetConfig } from '../types/dataset-config';
import { ImportWord } from '../types/import-word';
import { RawTable } from '../types/raw-table';

export interface MappingIssue {
  row: number;
  text?: string;
  message: string;
}

export interface MapResult {
  words: ImportWord[];
  // Raw values that could not be resolved through the config's alias maps
  // (e.g. a "type" cell with no matching posAliases entry). Surfaced to the
  // validator as errors naming the raw value + row (approved plan §7) —
  // format conversion problems are visible immediately rather than silently
  // dropped.
  issues: MappingIssue[];
}

export interface DatasetMapper {
  readonly id: string;
  map(table: RawTable, config: DatasetConfig): MapResult;
}
