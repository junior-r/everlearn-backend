import { randomUUID } from 'node:crypto';
import { idLine } from '../application/assistant-prompt.js';
import type { ToolCall, ToolDefinition } from '../domain/assistant.js';
import type { LLMEvent, LLMMessage } from '../domain/ports/assistant.ports.js';
import { MockLLMProvider } from './mock-llm.provider.js';

const MATH = randomUUID();
const EXAM = randomUUID();
const tool = (name: string): ToolDefinition => ({ name, description: '', parameters: {} });
const ADMIN_TOOLS = [tool('getTeacherHours')];
const STUDENT_TOOLS = [tool('getAcademicHistory'), tool('getEvaluationContext')];
const ADMIN_PROMPT = ['Today is 2026-10-11.', idLine('Matemática (MAT)', MATH)].join('\n');
const STUDENT_PROMPT = ['Today is 2026-10-11.', idLine('Examen parcial, Matemática', EXAM)].join('\n');

const provider = new MockLLMProvider(0);

async function turn(system: string, tools: ToolDefinition[], messages: LLMMessage[]) {
  const events: LLMEvent[] = [];
  for await (const event of provider.stream({ system, tools, messages })) {
    events.push(event);
  }
  const calls = events.flatMap((event) => (event.type === 'tool_call' ? [event.call] : []));
  const text = events.map((event) => (event.type === 'text' ? event.delta : '')).join('');
  return { events, calls, text };
}

const ask = (system: string, tools: ToolDefinition[], question: string) =>
  turn(system, tools, [{ role: 'user', content: question }]);

/** The turn after a tool answered `data`. */
function after(name: string, result: unknown) {
  const call: ToolCall = { id: 'call-1', name, input: {} };
  return turn('', [], [
    { role: 'user', content: 'pregunta' },
    { role: 'assistant', content: '', toolCalls: [call] },
    { role: 'tool', toolCallId: call.id, name, content: JSON.stringify(result) },
  ]);
}

describe('MockLLMProvider choosing a tool', () => {
  it('asks for the hours of the subject and month a question names', async () => {
    const named = await ask(ADMIN_PROMPT, ADMIN_TOOLS, '¿Cuántas horas de matematica hubo en noviembre de 2025?');
    const current = await ask(ADMIN_PROMPT, ADMIN_TOOLS, 'Horas de Matemática');
    const iso = await ask(ADMIN_PROMPT, ADMIN_TOOLS, 'Hours of Matemática in 2026-03');

    expect(named.calls).toEqual([
      { id: expect.any(String), name: 'getTeacherHours', input: { subjectId: MATH, month: '2025-11' } },
    ]);
    expect(current.calls[0].input).toEqual({ subjectId: MATH, month: '2026-10' });
    expect(iso.calls[0].input).toEqual({ subjectId: MATH, month: '2026-03' });
  });

  it('asks which subject when the question names none', async () => {
    const { calls, text } = await ask(ADMIN_PROMPT, ADMIN_TOOLS, '¿Cuántas horas tienen los docentes?');

    expect(calls).toEqual([]);
    expect(text).toContain('Puedo consultar: Matemática.');
  });

  it('asks for the evaluation a Student names, or for their history', async () => {
    const evaluation = await ask(STUDENT_PROMPT, STUDENT_TOOLS, '¿Cuándo es el examen parcial?');
    const history = await ask(STUDENT_PROMPT, STUDENT_TOOLS, '¿Cómo van mis notas?');

    expect(evaluation.calls[0]).toMatchObject({ name: 'getEvaluationContext', input: { evaluationId: EXAM } });
    expect(history.calls[0]).toMatchObject({ name: 'getAcademicHistory', input: {} });
  });

  it('never asks for a tool it was not offered', async () => {
    const student = await ask(ADMIN_PROMPT, STUDENT_TOOLS, 'Horas de Matemática en octubre');
    const nobody = await ask(STUDENT_PROMPT, [], '¿Cómo van mis notas?');

    expect(student.calls.every((call) => call.name !== 'getTeacherHours')).toBe(true);
    expect(nobody.calls).toEqual([]);
    expect(nobody.text).toContain('no tengo acceso a tus datos');
  });

  it('introduces itself by what it can do for the role, a few words at a time', async () => {
    const admin = await ask(ADMIN_PROMPT, ADMIN_TOOLS, 'Hola');
    const student = await ask(STUDENT_PROMPT, STUDENT_TOOLS, 'Hola');

    expect(admin.text).toContain('cuántas horas de clase tiene cada docente');
    expect(student.text).toContain('tus notas y promedios');
    expect(admin.events.length).toBeGreaterThan(10);
  });
});

describe('MockLLMProvider writing from a result', () => {
  it('lists the hours of each Teacher', async () => {
    const { text } = await after('getTeacherHours', {
      ok: true,
      data: {
        subject: { name: 'Matemática' },
        month: '2026-10',
        teachers: [{ name: 'Alan Turing', groups: ['1ro A', '1ro B'], scheduledHours: 18, taughtHours: 2.75 }],
        groupsWithoutTeacher: ['2do A'],
      },
    });

    expect(text).toBe(
      [
        'Horas de clase de Matemática en 2026-10:',
        '- Alan Turing (1ro A, 1ro B): 18 h programadas en el horario, 2,75 h de clases dictadas.',
        'Grupos sin docente asignado: 2do A.',
      ].join('\n'),
    );
  });

  it("summarises a Student's history and one evaluation", async () => {
    const evaluation = { title: 'Examen parcial', weight: 60, maxScore: 20, dueAt: '2026-11-10T12:00:00.000Z', score: 15.5, feedback: 'Bien' };
    const course = { subject: 'Matemática', averagePercent: 77.5, gradedWeightPercent: 60 };

    const history = await after('getAcademicHistory', {
      ok: true,
      data: {
        courses: [
          { ...course, evaluations: [evaluation] },
          { subject: 'Historia', averagePercent: null, gradedWeightPercent: 0, evaluations: [] },
        ],
      },
    });
    const context = await after('getEvaluationContext', { ok: true, data: { evaluation, course } });

    expect(history.text).toContain('- Matemática: promedio de 77,5% (evaluado el 60% de la materia). Examen parcial: 15,5/20.');
    expect(history.text).toContain('- Historia: todavía sin notas.');
    expect(context.text).toContain('vale el 60% de la materia');
    expect(context.text).toContain('Fecha de entrega: 10 de noviembre de 2026.');
    expect(context.text).toContain('Tu nota: 15,5/20.');
    expect(context.text).toContain('Comentario de tu docente: Bien');
  });

  it('says so when the tool found nothing', async () => {
    const { text } = await after('getEvaluationContext', { ok: false, error: 'Evaluation not found' });

    expect(text).toBe('No encontré esa información entre los datos que puedo consultar.');
  });
});
