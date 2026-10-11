# Evaluations, grades and averages

## The Need

Teachers must set the evaluations of each subject they teach, grade their Students in them, and both must see where a Student stands.

## The Goal

A Teacher manages the evaluations of their own courses and enters scores; a Student sees their published evaluations, grades and current average; both see what is due and when.

## The Reason

- **Weights are percent of the course and may add up to at most 100.** Drafts count too, so publishing can never push a course over the limit.
- **The average is a percentage (0–100), not a point scale.** Each evaluation has its own `maxScore` and institutions grade on different scales; a percentage is comparable across all of them. A scale per institution can be mapped on top later.
- **Only graded evaluations count.** The average is what the Student earned out of what has been graded so far, so it is meaningful from the first grade. `gradedWeight` says how much of the course that covers.
- **Drafts are private to the Teacher.** Students see, and are graded in, published evaluations only.
- **Sums are done in hundredths.** Weights and scores have two decimals (`Decimal(5,2)`, `Decimal(6,2)`); adding them as integers avoids `0.1 + 0.2` errors at the 100% boundary.
- **The Teacher is checked in the use case, not by the role alone.** `@Roles(TEACHER)` only says the caller teaches something; every use case also requires them to be the Teacher assigned to that course.

## The Implementation

- **Rules** live in `domain/evaluation.ts` as pure functions: `totalWeight`, `fitsWeight`, `standingOf`.
  - `average = Σ(score / maxScore × weight) / Σ(weight)` over published evaluations with a score, as a percentage rounded to two decimals; `null` while nothing is graded.
- **Teacher endpoints** (institution from `x-institution-id`, role `TEACHER`, assigned to the course or `NOT_COURSE_TEACHER`):
  - `GET /groups/:groupId/courses/:subjectId/gradebook`: every evaluation (drafts included), `totalWeight`, and each enrolled Student with `grades`, `average`, `gradedWeight`.
  - `POST /groups/:groupId/courses/:subjectId/evaluations`: creates a draft `{ title, type, weight, maxScore, dueAt? }`.
  - `PATCH /evaluations/:id`: changes what is sent; `dueAt: null` removes the date. `maxScore` cannot change once grades exist (`EVALUATION_HAS_GRADES`).
  - `POST /evaluations/:id/publish`.
  - `DELETE /evaluations/:id`: removes a draft. A published evaluation stays (`EVALUATION_ALREADY_PUBLISHED`, 409): Students have seen it and may hold grades in it.
  - `PUT /evaluations/:id/grades`: `{ grades: [{ enrollmentId, score, feedback? }] }`, all or nothing. `score: null` removes a grade. Requires a published evaluation (`EVALUATION_NOT_PUBLISHED`), a Student enrolled in the group (`STUDENT_NOT_ENROLLED`) and `0 ≤ score ≤ maxScore` (`SCORE_OUT_OF_RANGE`).
  - `GET /groups/:groupId/courses/:subjectId/gradebook/export?lang=es|en`: the gradebook as a CSV file (enrolled Students, their score in each published evaluation, average and graded weight). Spanish files use `;` and decimal commas, English ones `,` and points; both start with a byte order mark. Feedback and drafts are left out. Cells a spreadsheet would run as a formula are defused (`domain/gradebook-csv.ts`).
- **Publishing notifies** the enrolled Students once (see `notifications-and-messaging.md`).
- **Student endpoint:** `GET /evaluations/progress` (role `STUDENT`): each course of the groups they are enrolled in, with its Teacher, published evaluations, own grade in each, `average` and `gradedWeight`.
- **Calendar:** `GET /evaluations/calendar?from&to` (`TEACHER`, `STUDENT`): evaluations with a due date from `from` (default: now) and before `to`, soonest first. A Teacher gets the ones they set, drafts included; a Student the published ones of their courses. Each entry says which through `role`.
- **Other errors:** `EVALUATION_WEIGHT_EXCEEDED` (409), `COURSE_NOT_FOUND` / `EVALUATION_NOT_FOUND` (404, also for another institution's rows), `INVALID_EVALUATION` (400).
- **No schema change:** `Evaluation` and `Grade` already existed.

## Known gaps

- Two simultaneous creations in one course could together exceed 100%; the check and the insert are not atomic.
- A published evaluation cannot be deleted or unpublished.
- A Student who withdraws keeps their grades in the database but leaves the gradebook.
- Guardians, Principals and Institution Admins have no view of grades yet.
- No grade history: a changed score overwrites the previous one.
