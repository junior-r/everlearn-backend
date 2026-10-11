import { Role } from '../../../../shared/domain/auth/role.js';
import {
  Audience,
  membershipIdsOf,
  type AssistantActor,
  type ToolDefinition,
  type ToolResult,
} from '../../domain/assistant.js';
import type {
  AcademicRecords,
  StudentCourseRecord,
  StudentEvaluation,
  TeachingRecords,
} from '../../domain/ports/assistant.ports.js';
import { monthRange, parseMonth, teacherHours } from '../../domain/teacher-hours.js';

/**
 * Something the model may ask for. `run` receives input written by the model,
 * so it validates it and decides access from the actor alone, never from the input.
 */
export interface AssistantTool {
  readonly audience: Audience;
  readonly definition: ToolDefinition;
  run(actor: AssistantActor, input: unknown): Promise<ToolResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refuse = (error: string): ToolResult => ({ ok: false, error });

function textField(input: unknown, field: string): string | undefined {
  const value = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[field] : undefined;
  return typeof value === 'string' ? value.trim() : undefined;
}

export class TeacherHoursTool implements AssistantTool {
  readonly audience = Audience.ADMIN;
  readonly definition: ToolDefinition = {
    name: 'getTeacherHours',
    description:
      'Class hours of each Teacher of one subject in one month: the hours their timetable schedules and the hours of classes actually held. Use the subject ids listed in the context.',
    parameters: {
      type: 'object',
      properties: {
        subjectId: { type: 'string', format: 'uuid', description: 'Id of the subject' },
        month: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'Month as YYYY-MM' },
      },
      required: ['subjectId', 'month'],
      additionalProperties: false,
    },
  };

  constructor(private readonly teaching: TeachingRecords) {}

  async run(actor: AssistantActor, input: unknown): Promise<ToolResult> {
    const subjectId = textField(input, 'subjectId');
    const month = parseMonth(textField(input, 'month') ?? '');
    if (!subjectId || !UUID.test(subjectId)) {
      return refuse('subjectId must be the id of a subject');
    }
    if (!month) {
      return refuse('month must be written as YYYY-MM');
    }
    const found = await this.teaching.findTeaching(actor.institutionId, subjectId, monthRange(month));
    if (!found) {
      return refuse('Subject not found');
    }
    return {
      ok: true,
      data: {
        subject: found.subject,
        month: textField(input, 'month'),
        teachers: teacherHours(found.courses, month),
        groupsWithoutTeacher: found.courses.filter((course) => !course.teacher).map((course) => course.groupName),
      },
    };
  }
}

const evaluationView = ({ grade, ...evaluation }: StudentEvaluation) => ({
  ...evaluation,
  score: grade?.score ?? null,
  feedback: grade?.feedback ?? null,
  gradedAt: grade?.gradedAt ?? null,
});

const courseView = (course: StudentCourseRecord) => ({
  subject: course.subject.name,
  group: course.groupName,
  teacher: course.teacher ? `${course.teacher.firstName} ${course.teacher.lastName}` : null,
  averagePercent: course.average,
  gradedWeightPercent: course.gradedWeight,
});

export class AcademicHistoryTool implements AssistantTool {
  readonly audience = Audience.STUDENT;
  readonly definition: ToolDefinition = {
    name: 'getAcademicHistory',
    description:
      "The current Student's courses with their published evaluations, the grades received and the average of each course, as a percentage. Only the Student's own history can be read.",
    parameters: {
      type: 'object',
      properties: {
        studentId: { type: 'string', format: 'uuid', description: "The current Student's id, given in the context" },
      },
      additionalProperties: false,
    },
  };

  constructor(private readonly records: AcademicRecords) {}

  async run(actor: AssistantActor, input: unknown): Promise<ToolResult> {
    const own = membershipIdsOf(actor, Role.STUDENT);
    const asked = textField(input, 'studentId');
    // Whatever the model writes, a Student reads nobody's history but their own
    if (asked && !own.includes(asked)) {
      return refuse('Student not found');
    }
    const courses = await this.records.coursesOf(actor.institutionId, asked ? [asked] : own);
    return {
      ok: true,
      data: {
        courses: courses.map((course) => ({
          ...courseView(course),
          evaluations: course.evaluations.map(evaluationView),
        })),
      },
    };
  }
}

export class EvaluationContextTool implements AssistantTool {
  readonly audience = Audience.STUDENT;
  readonly definition: ToolDefinition = {
    name: 'getEvaluationContext',
    description:
      "Details of one published evaluation of the current Student's courses: what it is worth, when it is due, the grade and feedback received, and where the Student stands in that course.",
    parameters: {
      type: 'object',
      properties: {
        evaluationId: { type: 'string', format: 'uuid', description: 'Id of the evaluation, from the context' },
      },
      required: ['evaluationId'],
      additionalProperties: false,
    },
  };

  constructor(private readonly records: AcademicRecords) {}

  async run(actor: AssistantActor, input: unknown): Promise<ToolResult> {
    const evaluationId = textField(input, 'evaluationId');
    if (!evaluationId || !UUID.test(evaluationId)) {
      return refuse('evaluationId must be the id of an evaluation');
    }
    const courses = await this.records.coursesOf(actor.institutionId, membershipIdsOf(actor, Role.STUDENT));
    for (const course of courses) {
      const evaluation = course.evaluations.find((candidate) => candidate.id === evaluationId);
      if (evaluation) {
        return { ok: true, data: { evaluation: evaluationView(evaluation), course: courseView(course) } };
      }
    }
    // Drafts and other Students' courses look the same as an id that does not exist
    return refuse('Evaluation not found');
  }
}
