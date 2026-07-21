import ExcelJS from 'exceljs';
import { RawTable } from '../../types/raw-table';

export async function readXlsx(
  filePath: string,
  sheetName?: string,
): Promise<RawTable> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = sheetName
    ? workbook.getWorksheet(sheetName)
    : workbook.worksheets[0];
  if (!sheet) {
    throw new Error(
      sheetName
        ? `Sheet "${sheetName}" not found in ${filePath}`
        : `${filePath} has no worksheets`,
    );
  }

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? '').trim();
  });

  const rows: Record<string, string>[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    if (row.cellCount === 0) continue;

    const record: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const cell = row.getCell(index + 1);
      const value = cellToString(cell.value);
      record[header] = value;
      if (value.length > 0) hasValue = true;
    });

    if (hasValue) rows.push(record);
  }

  return { headers: headers.filter(Boolean), rows };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in (value as { text?: unknown })) {
    return String((value as { text: unknown }).text ?? '');
  }
  if (
    typeof value === 'object' &&
    'result' in (value as { result?: unknown })
  ) {
    return String((value as { result: unknown }).result ?? '');
  }
  return String(value).trim();
}
