import { NotificationType, type NotificationRequest } from '../../../shared/domain/notifications/notifier.js';
import { AttendanceStatus, type RollCall } from '../domain/classroom.js';

export interface MarkedStudent {
  enrollmentId: string;
  membershipId: string;
  firstName: string;
  lastName: string;
  status: AttendanceStatus;
}

/**
 * The notices for the Guardians of the Students marked absent or late in a
 * class, however the mark was taken. The key carries the mark, so the same
 * one is announced once and a different one for the same class is news.
 */
export function absenceNotices(
  sessionId: string,
  course: RollCall['course'],
  date: Date,
  students: MarkedStudent[],
): NotificationRequest[] {
  return students
    .filter(({ status }) => status === AttendanceStatus.ABSENT || status === AttendanceStatus.LATE)
    .map((student) => ({
      recipient: { guardiansOf: student.membershipId },
      institutionId: course.institutionId,
      type: NotificationType.WARD_ATTENDANCE,
      data: {
        studentId: student.membershipId,
        studentName: `${student.firstName} ${student.lastName}`,
        subjectName: course.subjectName,
        groupName: course.groupName,
        status: student.status,
        date: date.toISOString(),
      },
      dedupeKey: `attendance:${sessionId}:${student.enrollmentId}:${student.status}`,
    }));
}
