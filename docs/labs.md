# Labs

## The Need

Students learn by trying things: dropping an object on Mars, plotting a function, filling in a verb. Teachers need those tools in class and as activities for their groups, and the platform must decide which institutions get which labs.

## The Goal

A catalogue of labs in three categories (physics, maths, language) that Teachers and Students open from the app; Teachers give lab activities to their groups and see what each Student handed in; language activities are scored by the backend. The Platform Admin decides which labs each institution may use, and its Institution Admin which of those stay on.

## The Reason

- **Two decisions per lab, one rule.** `InstitutionLab` holds `granted` (Platform Admin) and `enabled` (Institution Admin). A lab is available only when both are true (`isLabAvailable` in `domain/lab-catalog.ts`); a lab never granted has no row. Withdrawing a grant keeps the institution's switch, so granting it again restores what they had chosen.
- **Anything not available is "not found".** An unknown lab, one not granted and one switched off answer `LAB_NOT_FOUND`, like another institution's rows.
- **The catalogue is code, not data.** Each lab needs its own screen in the frontend, so a lab exists only when both are deployed (`LAB_CATALOG`). Rows for a key no longer in the catalogue are ignored.
- **Simulations run in the browser.** Physics and maths labs are deterministic computations with nothing to protect; the backend only knows their keys. Language labs have answers to keep from Students, so they are marked here.
- **The exercise bank is code too.** `BUILT_IN_EXERCISES` (Spanish, fixed ids) is written to `LanguageExercise` on every start (`BuiltInExercisesBootstrap`): new ones added, changed ones rewritten, removed ones archived. Activities keep pointing at the same ids.
- **One attempt, then the answers.** A Student hands an activity in once (`LAB_ATTEMPT_ALREADY_SUBMITTED`), and only then sees the accepted answers. Practice with the bank returns verdicts only.
- **Accents are a lesson, not a point.** Case, spaces and closing punctuation never make an answer wrong; a right word with wrong accents is `ACCENTS`, which scores no point but is shown as such. `ñ` stays a letter of its own.
- **Other modules ask through a port.** `AVAILABLE_LABS` (`shared/domain/labs`) answers which labs an institution may use; the classroom puts them in the Teacher's room token so the video-server lets them share only those (see `classroom.md`).

## The Implementation

- **Platform Admin** (`@PlatformAdminOnly`): `GET /institutions/:id/labs` (the catalogue with `granted` and `enabled`), `PUT /institutions/:id/labs/:labKey` `{ granted }` (204).
- **Institution Admin** (`@Roles(ADMIN)`): `GET /labs/settings` (granted labs with `enabled`), `PUT /labs/:labKey/enabled` `{ enabled }` (204).
- **Members** (`TEACHER`, `STUDENT`): `GET /labs` (available labs, catalogue order); `GET /labs/:labKey/practice` (bank questions without answers); `POST /labs/:labKey/practice` `{ answers: [{ exerciseId, answer }] }` (verdicts, nothing stored).
- **Teacher exercises** (`TEACHER`): `GET /labs/:labKey/exercises` (`{ builtIn, own }` with answers), `POST /labs/:labKey/exercises` `{ prompt, answers, hint? }`, `PATCH|DELETE /lab-exercises/:id` (own only; delete archives, so activities keep it). A completion's prompt has exactly one `___`; a definition's has none; 1 to 5 accepted answers.
- **Activities** (Teacher assigned to the course, or `NOT_COURSE_TEACHER`): `POST|GET /groups/:groupId/courses/:subjectId/lab-assignments` (`{ labKey, title, instructions?, dueAt?, exerciseIds? }`; a language activity holds 1–20 exercises of its lab, from the bank or the Teacher's own; any other lab none); `GET /lab-assignments/:id/results` (every enrolled Student with their attempt and `late`); `DELETE /lab-assignments/:id`. Creating one tells each Student (`LAB_ASSIGNED`, with a `dedupeKey`).
- **Student activities** (`STUDENT`, enrolled in the group, lab available, else `LAB_ASSIGNMENT_NOT_FOUND`): `GET /lab-assignments/mine` (soonest due first, with own attempt), `GET /lab-assignments/:id` (`questions` without answers, `attempt`, `solutions` once handed in), `POST /lab-assignments/:id/attempt` `{ answers?, note? }`. A late hand-in is accepted and flagged.
- **Layers:** `domain/` (catalogue, exercise marking, activity rules, ports), `application/use-cases/` (access, exercises, activities), `infrastructure/` (three Prisma repositories, the bank bootstrap), `presentation/` (three controllers, DTOs). `LabsModule` is global only to export `AVAILABLE_LABS`.
- **Schema:** `InstitutionLab`, `LanguageExercise`, `LabAssignment`, `LabAssignmentExercise`, `LabAttempt`; `NotificationType.LAB_ASSIGNED`.

## Known gaps

- Activities are not linked to the gradebook; a score is not a grade.
- A simulation activity is "done" when handed in, with the Student's note; nothing checks what they did in the lab.
- Teachers' exercises are their own: they cannot share them with colleagues.
- Two simultaneous hand-ins by one Student are resolved by the database's unique key, which answers the second with 409.
