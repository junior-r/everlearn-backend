import { randomUUID } from 'node:crypto';
import type {
  AvailabilityRepository,
  SchedulableCourse,
  SchedulableGroup,
  ScheduleLock,
  ScheduleRepository,
} from '../../src/modules/scheduling/domain/ports/scheduling.ports.js';
import {
  ScheduleBusyException,
  type ScheduledSlot,
  type TimeRange,
} from '../../src/modules/scheduling/domain/schedule.js';
import type { InMemoryGroupRepository, InMemoryMemberDirectory } from './group.fakes.js';

export class InMemoryAvailabilityRepository implements AvailabilityRepository {
  readonly windows = new Map<string, TimeRange[]>();

  list(teacherMembershipId: string, periodId: string): Promise<TimeRange[]> {
    return Promise.resolve(this.windows.get(`${teacherMembershipId}:${periodId}`) ?? []);
  }

  replace(teacherMembershipId: string, periodId: string, windows: TimeRange[]): Promise<void> {
    this.windows.set(`${teacherMembershipId}:${periodId}`, windows);
    return Promise.resolve();
  }
}

interface StoredSlot extends TimeRange {
  id: string;
  groupId: string;
  subjectId: string;
  room: string | null;
}

const courseKey = (groupId: string, subjectId: string) => `${groupId}:${subjectId}`;

/** Reads groups, courses and teachers from the academics fakes, as the real one reads their tables. */
export class InMemoryScheduleRepository implements ScheduleRepository {
  readonly slots: StoredSlot[] = [];

  constructor(
    private readonly groups: InMemoryGroupRepository,
    private readonly directory: InMemoryMemberDirectory,
  ) {}

  private toSlot(slot: StoredSlot): ScheduledSlot {
    const group = this.groups.rows.find((row) => row.id === slot.groupId);
    const teacherId = this.groups.teacherOf(slot.groupId, slot.subjectId);
    const teacher = teacherId ? this.directory.describe(teacherId) : null;
    return {
      id: slot.id,
      dayOfWeek: slot.dayOfWeek,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      room: slot.room,
      groupId: slot.groupId,
      groupName: group?.name ?? '',
      subject: { id: slot.subjectId, code: '', name: '' },
      teacher: teacher && {
        membershipId: teacher.membershipId,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
      },
    };
  }

  findGroup(institutionId: string, groupId: string): Promise<SchedulableGroup | null> {
    const group = this.groups.rows.find(
      (row) => row.id === groupId && row.institutionId === institutionId,
    );
    return Promise.resolve(group ? { id: group.id, periodId: group.periodId } : null);
  }

  findCourse(groupId: string, subjectId: string): Promise<SchedulableCourse | null> {
    const teacherId = this.groups.teacherOf(groupId, subjectId);
    return Promise.resolve(
      teacherId ? { courseId: courseKey(groupId, subjectId), teacherMembershipId: teacherId } : null,
    );
  }

  listGroupSlots(groupId: string): Promise<ScheduledSlot[]> {
    return Promise.resolve(
      this.slots.filter((slot) => slot.groupId === groupId).map((slot) => this.toSlot(slot)),
    );
  }

  listTeacherSlots(teacherMembershipId: string, periodId: string): Promise<ScheduledSlot[]> {
    return Promise.resolve(
      this.slots
        .filter((slot) => {
          const group = this.groups.rows.find((row) => row.id === slot.groupId);
          return (
            group?.periodId === periodId &&
            this.groups.teacherOf(slot.groupId, slot.subjectId) === teacherMembershipId
          );
        })
        .map((slot) => this.toSlot(slot)),
    );
  }

  create(courseId: string, range: TimeRange, room: string | null): Promise<void> {
    const [groupId, subjectId] = courseId.split(':');
    this.slots.push({ id: randomUUID(), groupId, subjectId, room, ...range });
    this.groups.scheduled.add(courseId);
    return Promise.resolve();
  }

  delete(groupId: string, slotId: string): Promise<boolean> {
    const index = this.slots.findIndex((slot) => slot.id === slotId && slot.groupId === groupId);
    if (index < 0) {
      return Promise.resolve(false);
    }
    const [removed] = this.slots.splice(index, 1);
    const key = courseKey(removed.groupId, removed.subjectId);
    if (!this.slots.some((slot) => courseKey(slot.groupId, slot.subjectId) === key)) {
      this.groups.scheduled.delete(key);
    }
    return Promise.resolve(true);
  }
}

/** A real lock within one process: a second caller on a held key is refused, as with Redis. */
export class InMemoryScheduleLock implements ScheduleLock {
  private readonly held = new Set<string>();
  readonly acquired: string[][] = [];

  async runExclusive<T>(keys: string[], work: () => Promise<T>): Promise<T> {
    if (keys.some((key) => this.held.has(key))) {
      throw new ScheduleBusyException();
    }
    keys.forEach((key) => this.held.add(key));
    this.acquired.push([...keys].sort());
    try {
      return await work();
    } finally {
      keys.forEach((key) => this.held.delete(key));
    }
  }
}
