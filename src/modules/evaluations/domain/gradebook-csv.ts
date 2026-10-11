/** The words a gradebook file needs, in the language it is exported in. */
export interface CsvLabels {
  lastName: string;
  firstName: string;
  average: string;
  gradedWeight: string;
  /** Explains a column of scores: its weight in the course and its maximum score. */
  evaluation(title: string, weight: string, maxScore: string): string;
}

export interface CsvFormat {
  /** Between cells. Spreadsheets set to a language that writes decimals with a comma expect `;`. */
  separator: ',' | ';';
  decimal: '.' | ',';
  labels: CsvLabels;
}

/** What goes into the file: the published evaluations as columns, the enrolled Students as rows. */
export interface GradebookSheet {
  evaluations: Array<{ id: string; title: string; weight: number; maxScore: number }>;
  students: Array<{
    firstName: string;
    lastName: string;
    average: number | null;
    gradedWeight: number;
    scores: Map<string, number>;
  }>;
}

// A cell starting with one of these is run as a formula by spreadsheets
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One cell of text. Text a member typed (a name, a title) that a spreadsheet
 * would take for a formula is defused with a leading apostrophe; cells with a
 * separator, a quote or a line break are quoted.
 */
function textCell(value: string, separator: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return safe.includes(separator) || /["\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** A number with at most two decimals and the decimal mark of the format; empty for none. */
function numberCell(value: number | null | undefined, decimal: string): string {
  return value === null || value === undefined ? '' : String(Math.round(value * 100) / 100).replace('.', decimal);
}

/**
 * The gradebook as a CSV file: a header and one line per Student, with CRLF
 * line ends and a byte order mark so spreadsheets read the accents right.
 */
export function gradebookCsv(sheet: GradebookSheet, { separator, decimal, labels }: CsvFormat): string {
  const number = (value: number | null | undefined) => numberCell(value, decimal);
  const header = [
    labels.lastName,
    labels.firstName,
    ...sheet.evaluations.map((evaluation) =>
      labels.evaluation(evaluation.title, number(evaluation.weight), number(evaluation.maxScore)),
    ),
    labels.average,
    labels.gradedWeight,
  ].map((cell) => textCell(cell, separator));
  const rows = sheet.students.map((student) => [
    textCell(student.lastName, separator),
    textCell(student.firstName, separator),
    ...sheet.evaluations.map((evaluation) => number(student.scores.get(evaluation.id))),
    number(student.average),
    number(student.gradedWeight),
  ]);
  return `﻿${[header, ...rows].map((cells) => cells.join(separator)).join('\r\n')}\r\n`;
}
