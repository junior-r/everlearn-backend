export const Role = {
  ADMIN: 'ADMIN',
  COORDINATOR: 'COORDINATOR',
  TEACHER: 'TEACHER',
  STAFF: 'STAFF',
  STUDENT: 'STUDENT',
  GUARDIAN: 'GUARDIAN',
} as const;

export type Role = (typeof Role)[keyof typeof Role];
