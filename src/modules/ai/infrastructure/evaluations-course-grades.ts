import { Role } from '../../../shared/domain/auth/role.js';
import type { GetGradebookUseCase } from '../../evaluations/application/use-cases/evaluation.use-cases.js';
import type { CourseGrades, CourseStanding } from '../domain/ports/assistant.ports.js';

/**
 * Reads a course's standings through the gradebook of the evaluations module:
 * it refuses anyone but the Teacher assigned to the course, and the averages
 * are the ones the Teacher sees in "Libro de notas".
 */
export class EvaluationsCourseGrades implements CourseGrades {
  constructor(private readonly gradebook: GetGradebookUseCase) {}

  async standingOf(
    institutionId: string,
    teacherMembershipId: string,
    course: { groupId: string; subjectId: string },
  ): Promise<CourseStanding> {
    const book = await this.gradebook.execute(
      { institutionId, memberships: [{ id: teacherMembershipId, institutionId, role: Role.TEACHER }] },
      course,
    );
    return {
      publishedEvaluations: book.evaluations.filter((evaluation) => evaluation.isPublished).length,
      students: book.students.map(({ firstName, lastName, average, gradedWeight }) => ({
        firstName,
        lastName,
        average,
        gradedWeight,
      })),
    };
  }
}
