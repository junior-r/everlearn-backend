import { gradebookCsv, type CsvFormat, type GradebookSheet } from './gradebook-csv.js';

const labels: CsvFormat['labels'] = {
  lastName: 'Apellidos',
  firstName: 'Nombres',
  average: 'Promedio (%)',
  gradedWeight: 'Evaluado (%)',
  evaluation: (title, weight, maxScore) => `${title} (${weight}%, sobre ${maxScore})`,
};
const spanish: CsvFormat = { separator: ';', decimal: ',', labels };
const english: CsvFormat = { separator: ',', decimal: '.', labels };

const sheet: GradebookSheet = {
  evaluations: [
    { id: 'exam', title: 'Examen parcial', weight: 60, maxScore: 20 },
    { id: 'quiz', title: 'Prueba corta', weight: 12.5, maxScore: 10 },
  ],
  students: [
    {
      firstName: 'Grace',
      lastName: 'Hopper',
      average: 77.5,
      gradedWeight: 60,
      scores: new Map([['exam', 15.5]]),
    },
    { firstName: 'Linus', lastName: 'Pauling', average: null, gradedWeight: 0, scores: new Map() },
  ],
};

const lines = (csv: string) => csv.replace('﻿', '').split('\r\n');

describe('gradebookCsv', () => {
  it('writes a header and a line per Student, with empty cells where there is no score', () => {
    expect(lines(gradebookCsv(sheet, spanish))).toEqual([
      // A comma is no separator here, so these headings need no quotes
      'Apellidos;Nombres;Examen parcial (60%, sobre 20);Prueba corta (12,5%, sobre 10);Promedio (%);Evaluado (%)',
      'Hopper;Grace;15,5;;77,5;60',
      'Pauling;Linus;;;;0',
      '',
    ]);
  });

  it('follows the format asked for: separator and decimal mark', () => {
    const [header, grace] = lines(gradebookCsv(sheet, english));

    expect(header).toBe(
      'Apellidos,Nombres,"Examen parcial (60%, sobre 20)","Prueba corta (12.5%, sobre 10)",Promedio (%),Evaluado (%)',
    );
    expect(grace).toBe('Hopper,Grace,15.5,,77.5,60');
  });

  it('starts with a byte order mark and ends every line with CRLF, as spreadsheets expect', () => {
    const csv = gradebookCsv(sheet, spanish);

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });

  it('quotes names with separators, quotes and line breaks', () => {
    const csv = gradebookCsv(
      {
        evaluations: [],
        students: [
          { firstName: 'Ana; María', lastName: 'De "la" Cruz', average: null, gradedWeight: 0, scores: new Map() },
          { firstName: 'Dos\nlíneas', lastName: 'Pérez', average: null, gradedWeight: 0, scores: new Map() },
        ],
      },
      spanish,
    );

    expect(csv).toContain('"De ""la"" Cruz";"Ana; María";;0\r\n');
    expect(csv).toContain('Pérez;"Dos\nlíneas";;0\r\n');
  });

  it('defuses text a spreadsheet would run as a formula', () => {
    const csv = gradebookCsv(
      {
        evaluations: [{ id: 'e', title: '=HYPERLINK("http://evil.example","Examen")', weight: 10, maxScore: 20 }],
        students: [
          { firstName: '+SUM(1;1)', lastName: '@cmd', average: null, gradedWeight: 0, scores: new Map() },
          { firstName: '-2+3', lastName: "O'Brien", average: -0, gradedWeight: 0, scores: new Map() },
        ],
      },
      spanish,
    );
    const [header, first, second] = lines(csv);

    expect(header).toContain(`"'=HYPERLINK(""http://evil.example"",""Examen"") (10%, sobre 20)"`);
    expect(first.startsWith(`'@cmd;"'+SUM(1;1)"`)).toBe(true);
    expect(second.startsWith(`O'Brien;'-2+3`)).toBe(true);
  });

  it('writes numbers with at most two decimals', () => {
    const csv = gradebookCsv(
      {
        evaluations: [{ id: 'e', title: 'E', weight: 33.333, maxScore: 20 }],
        students: [{ firstName: 'A', lastName: 'B', average: 66.6666, gradedWeight: 33.333, scores: new Map([['e', 13.333]]) }],
      },
      english,
    );

    expect(lines(csv)[1]).toBe('B,A,13.33,66.67,33.33');
  });

  it('is only a header for a course without Students', () => {
    expect(lines(gradebookCsv({ evaluations: [], students: [] }, english))).toEqual([
      'Apellidos,Nombres,Promedio (%),Evaluado (%)',
      '',
    ]);
  });
});
