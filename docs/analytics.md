# Dashboards (analytics)

## The Need

When someone signs in they should see where things stand, not an empty page: a Platform Admin the platform, an Institution Admin their institution, a Teacher their own courses.

## The Goal

Three read-only endpoints, one per role, that return the figures a dashboard shows, quickly and without opening access to anything the role could not already see.

## The Reason

- **A module of its own, with no tables.** The figures cut across identity, academics, classroom and evaluations; putting each count in "its" module would spread one screen over five. `analytics` only reads.
- **The database counts.** Every figure is a `count` or a `groupBy`; no rows are loaded to be counted in Node.
- **Cached where it is shared, not where it is personal.** The platform and institution figures are the same for everyone who may see them and are counted over whole tables, so they are kept in Redis for `ANALYTICS_CACHE_SECONDS` (30). A Teacher's figures are theirs alone and bounded by their own courses, so they are always fresh. Without Redis everything is simply counted each time.
- **One attendance rule, in one place.** "Late counts as attended, excused absences are left out, below 70% is at risk" lives in `attendance/domain/attendance-standing.ts` and is used by the institution's attendance rate, the Teacher's dashboard and the AI assistant's tool.
- **Averages come from the gradebook.** The Teacher's grade distribution reads each course through `GetGradebookUseCase`, so the average rule stays in one place and the gradebook's own check (only the course's Teacher) applies again.
- **"Active" means a period running today.** A group or course counts as active when today falls inside its academic period, rather than relying on a flag someone must remember to set.

## The Implementation

- **`GET /analytics/platform`** (`@PlatformAdminOnly`): `activeInstitutions`, `inactiveInstitutions`, `totalUsers`, `usersByStatus`, `pendingReviews` (applications in `NEEDS_REVIEW`, every institution), `largestInstitutions` (top 5 active, by active members).
- **`GET /analytics/institution`** (`@Roles(ADMIN, COORDINATOR)`, institution from `x-institution-id`): `activeStudents`, `teachers`, `activeGroups`, `pendingReviews`, `attendance` (records by mark) and `attendanceRate` (percent, `null` without records).
- **`GET /analytics/academic`** (`@Roles(ADMIN, COORDINATOR)`): the teaching right now, for whoever oversees it: `groups` of running periods (students, subjects, subjects without a Teacher, weekly hours in the timetable), every `pensum` (subjects, active groups) and each Teacher's load (`courses`, `weeklyHours`). Cached like the institution's figures. A Principal may also read `GET /analytics/institution`.
- **`GET /analytics/academic/groups/:groupId`** (`@Roles(ADMIN, COORDINATOR)`): one group for whoever oversees the teaching: its subjects with their Teacher and weekly hours, and its weekly timetable. Least privilege: it returns the number of Students and no roster, name or email. The Institution Admin's `GET /groups/:id` (which carries Students' emails) and `GET /groups/:groupId/schedule` stay `ADMIN` only. A group of another institution is `GROUP_NOT_FOUND`. Not cached: it is one bounded query.
- **`GET /analytics/teacher`** (`@Roles(TEACHER)`): `activeCourses`, `draftEvaluations`, `studentsAtRisk` (below 70% in the Teacher's own classes, lowest first, with their group), `gradeDistribution` (five bands of the 0 to 100 scale) and `gradedAverages`. Only the memberships the caller holds as Teacher in that institution are used.
- **Layers:** `domain/dashboards.ts` (shapes, `gradeDistribution`, `today`), `domain/ports` (`DashboardQueries`, `DashboardCache`, `CourseAverages`), `application/use-cases/dashboard.use-cases.ts`, `infrastructure/` (`PrismaDashboardQueries`, `RedisDashboardCache`, `GradebookCourseAverages`), `presentation/analytics.controller.ts`.
- **Index:** `OnboardingApplication(status)` was added for the platform-wide count of pending reviews (migration `20261011190000_pending_reviews_index`). The other counts use indexes that already existed (`Membership(institutionId, role)`, `Group(institutionId)`, `Course(teacherId)`, `AttendanceRecord(enrollmentId)`).
- **Config:** `ANALYTICS_CACHE_SECONDS` (30; 0 disables the cache).

## Known gaps

- A cached figure can be up to 30 seconds old; nothing invalidates it when a member is registered or attendance is taken.
- The institution's attendance count joins records to their institution through session, course and group; it has not been measured on a large table. Locally the platform query takes about 20 ms uncached.
- The Teacher's distribution opens one gradebook per course. That is fine for a handful of courses and would need a single query for dozens.
- Staff, Students and Guardians have no endpoint here. A Principal reads; they cannot change groups, pensums or timetables, nor list every group (`GET /groups`): they reach a group from the overview. The Student's page is built from `GET /evaluations/progress`.
- Running periods are decided on the UTC date.
