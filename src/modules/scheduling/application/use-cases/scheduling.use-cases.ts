import { Role } from '../../../../shared/domain/auth/role.js';
import {
  GroupNotFoundException,
  PeriodNotFoundException,
  TeacherNotFoundException,
} from '../../../academics/domain/entities/group.entities.js';
import type {
  MemberDirectory,
  PeriodRepository,
} from '../../../academics/domain/ports/group.repositories.js';
import {
  groupLock,
  teacherLock,
  type AvailabilityRepository,
  type SchedulableGroup,
  type ScheduleLock,
  type ScheduleRepository,
} from '../../domain/ports/scheduling.ports.js';
import {
  assertValidRange,
  AvailabilityConflictsWithScheduleException,
  CourseHasNoTeacherException,
  findPlacementConflict,
  isWithinAvailability,
  normalizeWindows,
  ScheduleSlotNotFoundException,
  type ScheduledSlot,
  type TimeRange,
} from '../../domain/schedule.js';

/** Confirms the teacher and period both belong to the acting institution. */
async function requireTeacherAndPeriod(
  members: MemberDirectory,
  periods: PeriodRepository,
  institutionId: string,
  teacherMembershipId: string,
  periodId: string,
): Promise<void> {
  const member = await members.findActiveMember(institutionId, teacherMembershipId);
  if (member?.role !== Role.TEACHER) {
    throw new TeacherNotFoundException();
  }
  if (!(await periods.findById(institutionId, periodId))) {
    throw new PeriodNotFoundException();
  }
}

export class GetTeacherAvailabilityUseCase {
  constructor(
    private readonly availability: AvailabilityRepository,
    private readonly members: MemberDirectory,
    private readonly periods: PeriodRepository,
  ) {}

  async execute(institutionId: string, teacherMembershipId: string, periodId: string): Promise<TimeRange[]> {
    await requireTeacherAndPeriod(this.members, this.periods, institutionId, teacherMembershipId, periodId);
    return this.availability.list(teacherMembershipId, periodId);
  }
}

export class SetTeacherAvailabilityUseCase {
  constructor(
    private readonly availability: AvailabilityRepository,
    private readonly schedule: ScheduleRepository,
    private readonly members: MemberDirectory,
    private readonly periods: PeriodRepository,
    private readonly lock: ScheduleLock,
  ) {}

  /**
   * Replaces when a teacher can teach during a period. Refused if it would
   * leave a class they already have outside their availability.
   */
  async execute(
    institutionId: string,
    teacherMembershipId: string,
    periodId: string,
    windows: TimeRange[],
  ): Promise<TimeRange[]> {
    const normalized = normalizeWindows(windows);
    await requireTeacherAndPeriod(this.members, this.periods, institutionId, teacherMembershipId, periodId);
    return this.lock.runExclusive([teacherLock(teacherMembershipId)], async () => {
      const classes = await this.schedule.listTeacherSlots(teacherMembershipId, periodId);
      if (!classes.every((slot) => isWithinAvailability(normalized, slot))) {
        throw new AvailabilityConflictsWithScheduleException();
      }
      await this.availability.replace(teacherMembershipId, periodId, normalized);
      return normalized;
    });
  }
}

async function requireGroup(
  schedule: ScheduleRepository,
  institutionId: string,
  groupId: string,
): Promise<SchedulableGroup> {
  const group = await schedule.findGroup(institutionId, groupId);
  if (!group) {
    throw new GroupNotFoundException();
  }
  return group;
}

export class GetGroupScheduleUseCase {
  constructor(private readonly schedule: ScheduleRepository) {}

  async execute(institutionId: string, groupId: string): Promise<ScheduledSlot[]> {
    await requireGroup(this.schedule, institutionId, groupId);
    return this.schedule.listGroupSlots(groupId);
  }
}

export interface ScheduleCourseInput extends TimeRange {
  institutionId: string;
  groupId: string;
  subjectId: string;
  room?: string | null;
}

export class ScheduleCourseUseCase {
  constructor(
    private readonly schedule: ScheduleRepository,
    private readonly availability: AvailabilityRepository,
    private readonly lock: ScheduleLock,
  ) {}

  /**
   * Adds a weekly class for one subject of a group. The slot must not overlap
   * another class of the group or of the teacher, and must fall inside the
   * teacher's availability. Resolves to the group's updated schedule.
   */
  async execute(input: ScheduleCourseInput): Promise<ScheduledSlot[]> {
    const range: TimeRange = {
      dayOfWeek: input.dayOfWeek,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
    };
    assertValidRange(range);
    const group = await requireGroup(this.schedule, input.institutionId, input.groupId);
    const course = await this.schedule.findCourse(group.id, input.subjectId);
    const teacherId = course?.teacherMembershipId;
    if (!course || !teacherId) {
      throw new CourseHasNoTeacherException();
    }
    // Checked and saved under both locks, so a simultaneous booking cannot slip between the two
    return this.lock.runExclusive([teacherLock(teacherId), groupLock(group.id)], async () => {
      const [availability, teacherSlots, groupSlots] = await Promise.all([
        this.availability.list(teacherId, group.periodId),
        this.schedule.listTeacherSlots(teacherId, group.periodId),
        this.schedule.listGroupSlots(group.id),
      ]);
      const conflict = findPlacementConflict(range, { availability, teacherSlots, groupSlots });
      if (conflict) {
        throw conflict;
      }
      await this.schedule.create(course.courseId, range, input.room?.trim() || null);
      return this.schedule.listGroupSlots(group.id);
    });
  }
}

export class RemoveScheduleSlotUseCase {
  constructor(private readonly schedule: ScheduleRepository) {}

  async execute(institutionId: string, groupId: string, slotId: string): Promise<ScheduledSlot[]> {
    await requireGroup(this.schedule, institutionId, groupId);
    if (!(await this.schedule.delete(groupId, slotId))) {
      throw new ScheduleSlotNotFoundException();
    }
    return this.schedule.listGroupSlots(groupId);
  }
}
