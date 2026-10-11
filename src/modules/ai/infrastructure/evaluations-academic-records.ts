import { Role } from '../../../shared/domain/auth/role.js';
import type { GetMyProgressUseCase } from '../../evaluations/application/use-cases/evaluation.use-cases.js';
import type { AcademicRecords, StudentCourseRecord } from '../domain/ports/assistant.ports.js';

/**
 * Reads a Student's studies through the evaluations module, so the assistant
 * sees exactly what the "Mis notas" page shows and averages follow one rule.
 */
export class EvaluationsAcademicRecords implements AcademicRecords {
  constructor(private readonly progress: GetMyProgressUseCase) {}

  coursesOf(institutionId: string, studentMembershipIds: string[]): Promise<StudentCourseRecord[]> {
    return this.progress.execute({
      institutionId,
      memberships: studentMembershipIds.map((id) => ({ id, institutionId, role: Role.STUDENT })),
    });
  }
}
