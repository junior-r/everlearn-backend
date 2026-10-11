import { randomUUID } from 'node:crypto';
import type { IdKind } from '../application/assistant-prompt.js';
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

/** The names and ids of one kind the prompt lists, in the format of `idLine`. */
function listedIds(system: string, kind: IdKind): NamedId[] {
  return [...system.matchAll(/^- (.+) \[(\w+): ([0-9a-f-]{36})\]$/gim)]
    .filter(([, , listedKind]) => listedKind === kind)
    .map(([, label, , id]) => ({ name: label, id }));
}

/** "Matemática (MAT)", "Examen parcial, Matemática" and "Matemática, 1ro A" are also named by their first part. */
const shortName = (label: string) => label.split(/ \(|, /)[0];

/** The listed thing a question names, by its whole label or by its short name. */
function mentioned(question: string, names: NamedId[]): NamedId | undefined {
  const text = plain(question);
  return (
    names.find(({ name }) => text.includes(plain(name))) ??
    names.find(({ name }) => shortName(name) !== '' && text.includes(plain(shortName(name))))
  );
}

/** The one a question names, the only one there is, or the question to ask back. */
function chosen(question: string, names: NamedId[], askWhich: string, none: string): NamedId | string {
  const named = mentioned(question, names) ?? (names.length === 1 ? names[0] : undefined);
  if (named) {
    return named;
  }
  return names.length > 0 ? `${askWhich} ${names.map(({ name }) => name).join('; ')}.` : none;
}

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

interface AveragesData {
  subject: string;
  group: string;
  publishedEvaluations: number;
  classAveragePercent: number | null;
  students: Array<{ name: string; averagePercent: number | null; gradedWeightPercent: number }>;
}

interface AttendanceData {
  group: string;
  thresholdPercent: number;
  classesHeld: number;
  studentsInGroup: number;
  atRisk: Array<{ name: string; attendedClasses: number; countedClasses: number; attendancePercent: number }>;
  studentsWithoutRecords: number;
}

function describeAverages(data: AveragesData): string {
  const course = `${data.subject}, grupo ${data.group}`;
  if (data.students.length === 0) {
    return `${course}: todavía no hay estudiantes inscritos.`;
  }
  if (data.classAveragePercent === null) {
    return `${course}: todavía no hay notas registradas (${data.publishedEvaluations} evaluaciones publicadas).`;
  }
  return [
    `Promedios de ${course} (promedio del grupo: ${number(data.classAveragePercent)}%):`,
    ...data.students.map((student) =>
      student.averagePercent === null
        ? `- ${student.name}: sin notas.`
        : `- ${student.name}: ${number(student.averagePercent)}% (evaluado el ${number(student.gradedWeightPercent)}% de la materia).`,
    ),
  ].join('\n');
}

function describeAttendance(data: AttendanceData): string {
  const lines =
    data.atRisk.length > 0
      ? [
          `Estudiantes del grupo ${data.group} con menos del ${number(data.thresholdPercent)}% de asistencia en tus clases:`,
          ...data.atRisk.map(
            (student) =>
              `- ${student.name}: ${number(student.attendancePercent)}% (${student.attendedClasses} de ${student.countedClasses} clases).`,
          ),
        ]
      : [
          `Ningún estudiante del grupo ${data.group} está por debajo del ${number(data.thresholdPercent)}% de asistencia en tus clases.`,
        ];
  lines.push(`Clases dictadas: ${data.classesHeld}. Estudiantes inscritos: ${data.studentsInGroup}.`);
  if (data.studentsWithoutRecords > 0) {
    lines.push(`Estudiantes sin asistencia registrada todavía: ${data.studentsWithoutRecords}.`);
  }
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
    case 'getCourseAverages':
      return describeAverages(result.data as AveragesData);
    case 'getGroupAttendanceRisk':
      return describeAttendance(result.data as AttendanceData);
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
      yield* this.write(this.fromResults(request.messages), request.signal);
      return;
    }
    const call = this.toolFor(last.content, request);
    if (typeof call === 'string') {
      yield* this.write(call, request.signal);
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
    const text = plain(question);
    if (offered.has('getTeacherHours') && /\bhoras?\b|\bhours?\b/.test(text)) {
      const subjects = listedIds(system, 'subjectId');
      const subject = mentioned(question, subjects);
      const today = /Today is (\d{4}-\d{2}-\d{2})/.exec(system)?.[1] ?? new Date().toISOString().slice(0, 10);
      return subject
        ? { name: 'getTeacherHours', input: { subjectId: subject.id, month: monthIn(question, today) } }
        : subjects.length > 0
          ? `¿De qué materia quieres saber las horas? Puedo consultar: ${subjects.map(({ name }) => shortName(name)).join(', ')}.`
          : 'Todavía no hay materias registradas en la institución.';
    }
    if (offered.has('getGroupAttendanceRisk') && /asistencia|ausen|falta|riesgo|attendance/.test(text)) {
      const group = chosen(
        question,
        listedIds(system, 'groupId'),
        '¿De qué grupo quieres revisar la asistencia? Tus grupos:',
        'Todavía no tienes grupos asignados.',
      );
      return typeof group === 'string' ? group : { name: 'getGroupAttendanceRisk', input: { groupId: group.id } };
    }
    if (offered.has('getCourseAverages') && /promedio|nota|rendimiento|average|grade/.test(text)) {
      const course = chosen(
        question,
        listedIds(system, 'courseId'),
        '¿De qué materia quieres ver los promedios? Tus materias:',
        'Todavía no tienes materias asignadas.',
      );
      return typeof course === 'string' ? course : { name: 'getCourseAverages', input: { courseId: course.id } };
    }
    if (offered.has('getEvaluationContext')) {
      const evaluation = mentioned(question, listedIds(system, 'evaluationId'));
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
    if (offered.has('getCourseAverages')) {
      return 'Hola, soy el asistente de Everlearn. Puedo decirte los promedios de tus estudiantes en una materia y quiénes están en riesgo por inasistencia en un grupo. Por ejemplo: «¿Cómo van los promedios de Matemática?»';
    }
    if (offered.has('getAcademicHistory')) {
      return 'Hola, soy el asistente de Everlearn. Puedo consultar tus notas y promedios, o contarte los detalles de una evaluación. Por ejemplo: «¿Cómo van mis notas?»';
    }
    return 'Hola, soy el asistente de Everlearn. Por ahora no tengo acceso a tus datos en la plataforma, pero puedo ayudarte con dudas generales.';
  }

  private async *write(text: string, signal?: AbortSignal): AsyncGenerator<LLMEvent> {
    for (const chunk of text.match(/\S+\s*/g) ?? []) {
      if (signal?.aborted) {
        return;
      }
      if (this.chunkDelayMs > 0) {
        await wait(this.chunkDelayMs);
      }
      yield { type: 'text', delta: chunk };
    }
  }
}
