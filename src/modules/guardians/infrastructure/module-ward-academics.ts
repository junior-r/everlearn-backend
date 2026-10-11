import { Role } from '../../../shared/domain/auth/role.js';
import type {
  GetMyProgressUseCase,
  ListDueEvaluationsUseCase,
} from '../../evaluations/application/use-cases/evaluation.use-cases.js';
import type { GetGroupScheduleUseCase } from '../../scheduling/application/use-cases/scheduling.use-cases.js';
import type {
  CourseStanding,
  ScheduledClass,
  UpcomingEvaluation,
  WardAcademics,
} from '../domain/ports/guardian.ports.js';

const fullName = (person: { firstName: string; lastName: string } | null) =>
  person ? `${person.firstName} ${person.lastName}` : null;

/**
 * Reads a Student's studies through the use cases the Student's own screens
 * use (scheduling and evaluations), acting as that Student. Nothing is
 * computed again here, so a Guardian and their ward always see the same thing.
 */
export class ModuleWardAcademics implements WardAcademics {
  constructor(
    private readonly groupSchedule: GetGroupScheduleUseCase,
    private readonly progress: GetMyProgressUseCase,
    private readonly dueEvaluations: ListDueEvaluationsUseCase,
  ) {}

  private asStudent(institutionId: string, studentMembershipId: string) {
    return { institutionId, memberships: [{ id: studentMembershipId, institutionId, role: Role.STUDENT }] };
  }

  async scheduleOf(institutionId: string, groupIds: string[]): Promise<ScheduledClass[]> {
    const slots = (await Promise.all(groupIds.map((groupId) => this.groupSchedule.execute(institutionId, groupId)))).flat();
    return slots.map((slot) => ({
      dayOfWeek: slot.dayOfWeek,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      groupName: slot.groupName,
      subjectName: slot.subject.name,
      teacherName: fullName(slot.teacher),
      room: slot.room,
    }));
  }

  async coursesOf(institutionId: string, studentMembershipId: string): Promise<CourseStanding[]> {
    const courses = await this.progress.execute(this.asStudent(institutionId, studentMembershipId));
    return courses.map((course) => ({
      groupName: course.groupName,
      subjectName: course.subject.name,
      subjectCode: course.subject.code,
      teacherName: fullName(course.teacher),
      average: course.average,
      gradedWeight: course.gradedWeight,
      gradedEvaluations: course.evaluations.filter((evaluation) => evaluation.grade !== null).length,
      publishedEvaluations: course.evaluations.length,
    }));
  }

  async upcomingOf(
    institutionId: string,
    studentMembershipId: string,
    from: Date,
    to: Date,
  ): Promise<UpcomingEvaluation[]> {
    const due = await this.dueEvaluations.execute(this.asStudent(institutionId, studentMembershipId), from, to);
    return due.map((entry) => ({
      id: entry.id,
      title: entry.title,
      type: entry.type,
      dueAt: entry.dueAt,
      subjectName: entry.subject.name,
      groupName: entry.groupName,
    }));
  }
}
