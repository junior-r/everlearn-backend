import { randomUUID } from 'node:crypto';
import type { ToolResult } from '../domain/assistant.js';
import type { LLMEvent, LLMMessage, LLMProvider, LLMRequest } from '../domain/ports/assistant.ports.js';

interface NamedId {
  name: string;
  id: string;
}

const MONTHS = [
  ['enero', 'january'],
  ['febrero', 'february'],
  ['marzo', 'march'],
  ['abril', 'april'],
  ['mayo', 'may'],
  ['junio', 'june'],
  ['julio', 'july'],
  ['agosto', 'august'],
  ['septiembre', 'setiembre', 'september'],
  ['octubre', 'october'],
  ['noviembre', 'november'],
  ['diciembre', 'december'],
];

const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const number = (value: number) => new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(value);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The names and ids the prompt lists, in the format of `idLine`. */
function listedIds(system: string): NamedId[] {
  return [...system.matchAll(/^- (.+) \[id: ([0-9a-f-]{36})\]$/gim)].map(([, label, id]) => ({
    // "Matemática (MAT)" and "Examen parcial, Matemática" are both named by their first part
    name: label.split(/ \(|, /)[0],
    id,
  }));
}

const mentioned = (question: string, names: NamedId[]) =>
  names.find(({ name }) => plain(question).includes(plain(name)));

/** The month a question is about as `YYYY-MM`; the month of `today` when it names none. */
function monthIn(question: string, today: string): string {
  const explicit = /\b(\d{4})-(0[1-9]|1[0-2])\b/.exec(question);
  if (explicit) {
    return explicit[0];
  }
  const text = plain(question);
  const index = MONTHS.findIndex((names) => names.some((name) => new RegExp(`\\b${name}\\b`).test(text)));
  const year = /\b(20\d{2})\b/.exec(question)?.[1] ?? today.slice(0, 4);
  return index >= 0 ? `${year}-${String(index + 1).padStart(2, '0')}` : today.slice(0, 7);
}

interface HoursData {
  subject: { name: string };
  month: string;
  teachers: Array<{ name: string; groups: string[]; scheduledHours: number; taughtHours: number }>;
  groupsWithoutTeacher: string[];
}

interface EvaluationData {
  title: string;
  weight: number;
  maxScore: number;
  dueAt: string | null;
  score: number | null;
  feedback: string | null;
}

interface CourseData {
  subject: string;
  averagePercent: number | null;
  gradedWeightPercent: number;
  evaluations?: EvaluationData[];
}

const standing = (course: CourseData) =>
  course.averagePercent === null
    ? 'todavía sin notas'
    : `promedio de ${number(course.averagePercent)}% (evaluado el ${number(course.gradedWeightPercent)}% de la materia)`;

function describeHours({ subject, month, teachers, groupsWithoutTeacher }: HoursData): string {
  const lines =
    teachers.length > 0
      ? [
          `Horas de clase de ${subject.name} en ${month}:`,
          ...teachers.map(
            (teacher) =>
              `- ${teacher.name} (${teacher.groups.join(', ')}): ${number(teacher.scheduledHours)} h programadas en el horario, ${number(teacher.taughtHours)} h de clases dictadas.`,
          ),
        ]
      : [`Ningún docente tiene asignada la materia ${subject.name}.`];
  if (groupsWithoutTeacher.length > 0) {
    lines.push(`Grupos sin docente asignado: ${groupsWithoutTeacher.join(', ')}.`);
  }
  return lines.join('\n');
}

function describeHistory({ courses }: { courses: CourseData[] }): string {
  if (courses.length === 0) {
    return 'Todavía no estás inscrito en ninguna materia.';
  }
  return [
    'Este es tu historial académico:',
    ...courses.map((course) => {
      const graded = (course.evaluations ?? []).filter((evaluation) => evaluation.score !== null);
      const scores = graded.map(
        (evaluation) => `${evaluation.title}: ${number(evaluation.score ?? 0)}/${number(evaluation.maxScore)}`,
      );
      return `- ${course.subject}: ${standing(course)}${scores.length > 0 ? `. ${scores.join('; ')}` : ''}.`;
    }),
  ].join('\n');
}

function describeEvaluation({ evaluation, course }: { evaluation: EvaluationData; course: CourseData }): string {
  const lines = [
    `${evaluation.title} (${course.subject}) vale el ${number(evaluation.weight)}% de la materia y se califica sobre ${number(evaluation.maxScore)}.`,
    evaluation.dueAt
      ? `Fecha de entrega: ${new Intl.DateTimeFormat('es', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(evaluation.dueAt))}.`
      : 'No tiene fecha de entrega.',
    evaluation.score === null
      ? 'Todavía no está calificada.'
      : `Tu nota: ${number(evaluation.score)}/${number(evaluation.maxScore)}.`,
  ];
  if (evaluation.feedback) {
    lines.push(`Comentario de tu docente: ${evaluation.feedback}`);
  }
  lines.push(`En la materia tienes ${standing(course)}.`);
  return lines.join('\n');
}

/** Writes the answer a model would give after reading one tool result. */
function describe(tool: string, content: string): string {
  const result = JSON.parse(content) as ToolResult;
  if (!result.ok) {
    return 'No encontré esa información entre los datos que puedo consultar.';
  }
  switch (tool) {
    case 'getTeacherHours':
      return describeHours(result.data as HoursData);
    case 'getAcademicHistory':
      return describeHistory(result.data as { courses: CourseData[] });
    case 'getEvaluationContext':
      return describeEvaluation(result.data as { evaluation: EvaluationData; course: CourseData });
    default:
      return 'Consulté los datos, pero no sé cómo resumirlos.';
  }
}

/**
 * Stands in for a language model while no provider is configured. It follows
 * the same protocol (asks for tools, then writes from their results) with
 * keyword rules instead of understanding, and always answers in Spanish.
 */
export class MockLLMProvider implements LLMProvider {
  /** `chunkDelayMs` paces the words so the stream looks like a model writing. */
  constructor(private readonly chunkDelayMs = 30) {}

  async *stream(request: LLMRequest): AsyncGenerator<LLMEvent> {
    const last = request.messages[request.messages.length - 1];
    if (last.role === 'tool') {
      yield* this.write(this.fromResults(request.messages));
      return;
    }
    const call = this.toolFor(last.content, request);
    if (typeof call === 'string') {
      yield* this.write(call);
    } else {
      yield { type: 'tool_call', call: { id: randomUUID(), ...call } };
    }
  }

  private fromResults(messages: LLMMessage[]): string {
    const results: string[] = [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== 'tool') {
        break;
      }
      results.unshift(describe(message.name, message.content));
    }
    return results.join('\n\n');
  }

  /** The tool a question calls for, or the text to answer with when none does. */
  private toolFor(question: string, { system, tools }: LLMRequest): { name: string; input: unknown } | string {
    const offered = new Set(tools.map((tool) => tool.name));
    const names = listedIds(system);
    const text = plain(question);
    if (offered.has('getTeacherHours') && /\bhoras?\b|\bhours?\b/.test(text)) {
      const subject = mentioned(question, names);
      const today = /Today is (\d{4}-\d{2}-\d{2})/.exec(system)?.[1] ?? new Date().toISOString().slice(0, 10);
      return subject
        ? { name: 'getTeacherHours', input: { subjectId: subject.id, month: monthIn(question, today) } }
        : names.length > 0
          ? `¿De qué materia quieres saber las horas? Puedo consultar: ${names.map(({ name }) => name).join(', ')}.`
          : 'Todavía no hay materias registradas en la institución.';
    }
    if (offered.has('getEvaluationContext')) {
      const evaluation = mentioned(question, names);
      if (evaluation) {
        return { name: 'getEvaluationContext', input: { evaluationId: evaluation.id } };
      }
    }
    if (offered.has('getAcademicHistory') && /nota|promedio|historial|calificacion|materia|grade|average/.test(text)) {
      return { name: 'getAcademicHistory', input: {} };
    }
    if (offered.has('getTeacherHours')) {
      return 'Hola, soy el asistente de Everlearn. Puedo decirte cuántas horas de clase tiene cada docente de una materia en un mes. Por ejemplo: «¿Cuántas horas de Matemática hubo en octubre?»';
    }
    if (offered.has('getAcademicHistory')) {
      return 'Hola, soy el asistente de Everlearn. Puedo consultar tus notas y promedios, o contarte los detalles de una evaluación. Por ejemplo: «¿Cómo van mis notas?»';
    }
    return 'Hola, soy el asistente de Everlearn. Por ahora no tengo acceso a tus datos en la plataforma, pero puedo ayudarte con dudas generales.';
  }

  private async *write(text: string): AsyncGenerator<LLMEvent> {
    for (const chunk of text.match(/\S+\s*/g) ?? []) {
      if (this.chunkDelayMs > 0) {
        await wait(this.chunkDelayMs);
      }
      yield { type: 'text', delta: chunk };
    }
  }
}
