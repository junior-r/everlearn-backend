import { Role } from '../../../../shared/domain/auth/role.js';
import {
  Audience,
  membershipIdsOf,
  type AssistantActor,
  type ToolDefinition,
  type ToolResult,
} from '../../domain/assistant.js';
import { attendanceRisk, ATTENDANCE_RISK_BELOW } from '../../../attendance/domain/attendance-standing.js';
import { classAverage } from '../../domain/class-standing.js';
import type {
  AcademicRecords,
  CourseGrades,
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

export class CourseAveragesTool implements AssistantTool {
  readonly audience = Audience.TEACHER;
  readonly definition: ToolDefinition = {
    name: 'getCourseAverages',
    description:
      "Where the Students of one of the current Teacher's courses stand: each Student's average as a percentage, how much of the course is graded, and the class average. Only courses the Teacher is assigned to can be read.",
    parameters: {
      type: 'object',
      properties: {
        courseId: { type: 'string', format: 'uuid', description: 'Id of the course, from the context' },
      },
      required: ['courseId'],
      additionalProperties: false,
    },
  };

  constructor(
    private readonly teaching: TeachingRecords,
    private readonly grades: CourseGrades,
  ) {}

  async run(actor: AssistantActor, input: unknown): Promise<ToolResult> {
    const courseId = textField(input, 'courseId');
    if (!courseId || !UUID.test(courseId)) {
      return refuse('courseId must be the id of a course');
    }
    // The course must be among those assigned to the Teacher; any other id looks like one that does not exist
    const own = await this.teaching.coursesTaughtBy(actor.institutionId, membershipIdsOf(actor, Role.TEACHER));
    const course = own.find((candidate) => candidate.courseId === courseId);
    if (!course) {
      return refuse('Course not found');
    }
    const standing = await this.grades.standingOf(actor.institutionId, course.teacherMembershipId, {
      groupId: course.groupId,
      subjectId: course.subject.id,
    });
    return {
      ok: true,
      data: {
        subject: course.subject.name,
        group: course.groupName,
        publishedEvaluations: standing.publishedEvaluations,
        classAveragePercent: classAverage(standing.students.map((student) => student.average)),
        students: standing.students.map((student) => ({
          name: `${student.firstName} ${student.lastName}`,
          averagePercent: student.average,
          gradedWeightPercent: student.gradedWeight,
        })),
      },
    };
  }
}

export class GroupAttendanceRiskTool implements AssistantTool {
  readonly audience = Audience.TEACHER;
  readonly definition: ToolDefinition = {
    name: 'getGroupAttendanceRisk',
    description:
      "The Students of one of the current Teacher's groups who attended less than 70% of the classes of the Teacher's own courses there. Arriving late counts as attending; excused absences are left out. Only groups the Teacher teaches can be read.",
    parameters: {
      type: 'object',
      properties: {
        groupId: { type: 'string', format: 'uuid', description: 'Id of the group, from the context' },
      },
      required: ['groupId'],
      additionalProperties: false,
    },
  };

  constructor(private readonly teaching: TeachingRecords) {}

  async run(actor: AssistantActor, input: unknown): Promise<ToolResult> {
    const groupId = textField(input, 'groupId');
    if (!groupId || !UUID.test(groupId)) {
      return refuse('groupId must be the id of a group');
    }
    const attendance = await this.teaching.attendanceIn(
      actor.institutionId,
      groupId,
      membershipIdsOf(actor, Role.TEACHER),
    );
    if (!attendance) {
      return refuse('Group not found');
    }
    return {
      ok: true,
      data: {
        group: attendance.groupName,
        thresholdPercent: ATTENDANCE_RISK_BELOW * 100,
        classesHeld: attendance.classesHeld,
        studentsInGroup: attendance.students.length,
        ...attendanceRisk(attendance.students),
      },
    };
  }
}
