# Groups, courses & enrollments

## The Need

Institutions organise teaching into classes: a set of students taking the same subjects with assigned teachers during a school term.

## The Goal

An Institution Admin can create a group, decide who teaches each of its subjects, and enrol students.

## The Reason

- **A group's subjects come from its pensum, not from manual entry.** A group has a pensum and a level; its courses are exactly the subjects that pensum places at that level. This keeps every group of a level on the same curriculum.
- **`Course` rows are created on first assignment.** The subject list is derived, so a row is only needed once a Teacher is attached. This avoids generating and syncing rows whenever a pensum changes.
- **Members are checked through a read-only port (`MemberDirectory`).** Academics needs to know a membership is an active Teacher or Student of the institution, but membership data belongs to identity.

## The Implementation

- **Endpoints (Institution Admin, `x-institution-id`):** `GET/POST /periods`; `GET/POST /groups`, `GET/DELETE /groups/:id`; `PUT /groups/:id/courses/:subjectId` (`teacherMembershipId`, or `null` to clear); `POST /groups/:id/students`; `DELETE /groups/:id/students/:membershipId`.
- **Rules:** the pensum and period must belong to the institution; a teacher must be an active Teacher and a student an active Student of it (pending members are refused); the subject must be at the group's level; enrolment stops at `capacity`; a group with students cannot be deleted.
- **Tenant isolation** is the same as the rest of academics: another institution's group looks "not found".

## Known gaps

- Periods can be created and listed, but not edited or deleted.
- Groups cannot be renamed or moved to another pensum or period.
- Unenrolling deletes the enrollment; `EnrollmentStatus` (`WITHDRAWN`, `COMPLETED`) is not used yet.
- A Teacher's availability is not checked when assigning them.
