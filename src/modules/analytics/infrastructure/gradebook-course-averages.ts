import { Role } from '../../../shared/domain/auth/role.js';
import type { GetGradebookUseCase } from '../../evaluations/application/use-cases/evaluation.use-cases.js';
import type { AssignedCourse, CourseAverages } from '../domain/ports/analytics.ports.js';

/**
 * Reads averages through the gradebook of the evaluations module, so they
 * follow the one rule and only the course's Teacher can read them.
 */
export class GradebookCourseAverages implements CourseAverages {
  constructor(private readonly gradebook: GetGradebookUseCase) {}

  async averagesOf(institutionId: string, course: AssignedCourse): Promise<Array<number | null>> {
    const book = await this.gradebook.execute(
      { institutionId, memberships: [{ id: course.teacherMembershipId, institutionId, role: Role.TEACHER }] },
      { groupId: course.groupId, subjectId: course.subjectId },
    );
    return book.students.map((student) => student.average);
  }
}
