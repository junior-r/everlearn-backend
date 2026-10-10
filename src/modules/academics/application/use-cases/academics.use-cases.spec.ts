import { createAdminFakes } from '../../../../../test/support/admin.fakes.js';
import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  CreateInstitutionUseCase,
  DeleteInstitutionUseCase,
  ListInstitutionsUseCase,
  UpdateInstitutionUseCase,
} from '../../../institutions/application/use-cases/institution.use-cases.js';
import {
  InstitutionNotEmptyException,
  InstitutionNotFoundException,
  InstitutionSlugTakenException,
  InvalidTimezoneException,
} from '../../../institutions/domain/exceptions/institution.exceptions.js';
import {
  PensumNotFoundException,
  PensumVersionTakenException,
  SubjectCodeTakenException,
  SubjectInUseException,
  SubjectNotFoundException,
} from '../../domain/exceptions/academic.exceptions.js';
import {
  CreatePensumUseCase,
  DeletePensumUseCase,
  GetPensumUseCase,
  ListPensumsUseCase,
  PlaceSubjectInPensumUseCase,
  RemoveSubjectFromPensumUseCase,
  UpdatePensumUseCase,
} from './pensum.use-cases.js';
import {
  CreateSubjectUseCase,
  DeleteSubjectUseCase,
  ListSubjectsUseCase,
  UpdateSubjectUseCase,
} from './subject.use-cases.js';

const A = 'institution-a';
const B = 'institution-b';
const placement = { level: 1, weeklyHours: 4, credits: 3 };

describe('Institution use cases', () => {
  function setup() {
    const { institutions } = createAdminFakes();
    return {
      institutions,
      create: new CreateInstitutionUseCase(institutions),
      list: new ListInstitutionsUseCase(institutions),
      update: new UpdateInstitutionUseCase(institutions),
      remove: new DeleteInstitutionUseCase(institutions),
    };
  }

  it('creates an institution with a normalized slug and a default time zone', async () => {
    const { create } = setup();

    const created = await create.execute({ name: '  Colegio San José ', slug: ' San-Jose ' });

    expect(created).toMatchObject({
      name: 'Colegio San José',
      slug: 'san-jose',
      timezone: 'UTC',
      isActive: true,
    });
  });

  it('rejects a duplicate slug and an unknown time zone', async () => {
    const { create, institutions } = setup();
    await create.execute({ name: 'One', slug: 'one', timezone: 'America/Caracas' });

    await expect(create.execute({ name: 'Other', slug: 'one' })).rejects.toBeInstanceOf(
      InstitutionSlugTakenException,
    );
    await expect(
      create.execute({ name: 'Two', slug: 'two', timezone: 'Mars/Olympus' }),
    ).rejects.toBeInstanceOf(InvalidTimezoneException);
    expect(institutions.rows).toHaveLength(1);
  });

  it('shows a Platform Admin everything and a member only their own institutions', async () => {
    const { list, institutions } = setup();
    const mine = institutions.seed({ name: 'Mine' });
    institutions.seed({ name: 'Not mine' });
    const member: AuthenticatedUser = {
      userId: 'u',
      email: 'u@example.com',
      isPlatformAdmin: false,
      memberships: [{ id: 'm', institutionId: mine.id, role: Role.ADMIN }],
    };

    expect(await list.execute({ ...member, isPlatformAdmin: true })).toHaveLength(2);
    expect((await list.execute(member)).map((row) => row.name)).toEqual(['Mine']);
    expect(await list.execute({ ...member, memberships: [] })).toEqual([]);
  });

  it('updates only the given fields and can deactivate', async () => {
    const { update, institutions } = setup();
    const row = institutions.seed({ name: 'Old', timezone: 'UTC' });

    const updated = await update.execute(row.id, { isActive: false });

    expect(updated).toMatchObject({ name: 'Old', timezone: 'UTC', isActive: false });
    await expect(update.execute(row.id, { timezone: 'Nowhere/Land' })).rejects.toBeInstanceOf(
      InvalidTimezoneException,
    );
    await expect(update.execute('missing', { name: 'x' })).rejects.toBeInstanceOf(
      InstitutionNotFoundException,
    );
  });

  it('deletes an empty institution but never one that has members', async () => {
    const { remove, institutions } = setup();
    const empty = institutions.seed();
    const populated = institutions.seed();
    institutions.withMembers.add(populated.id);

    await remove.execute(empty.id);

    await expect(remove.execute(populated.id)).rejects.toBeInstanceOf(InstitutionNotEmptyException);
    await expect(remove.execute(empty.id)).rejects.toBeInstanceOf(InstitutionNotFoundException);
    expect(institutions.rows.map((row) => row.id)).toEqual([populated.id]);
  });
});

function setupAcademics() {
  const { subjects, pensums } = createAdminFakes();
  return {
    subjects,
    pensums,
    listSubjects: new ListSubjectsUseCase(subjects),
    createSubject: new CreateSubjectUseCase(subjects),
    updateSubject: new UpdateSubjectUseCase(subjects),
    deleteSubject: new DeleteSubjectUseCase(subjects),
    listPensums: new ListPensumsUseCase(pensums),
    getPensum: new GetPensumUseCase(pensums),
    createPensum: new CreatePensumUseCase(pensums),
    updatePensum: new UpdatePensumUseCase(pensums),
    deletePensum: new DeletePensumUseCase(pensums),
    place: new PlaceSubjectInPensumUseCase(pensums, subjects),
    unplace: new RemoveSubjectFromPensumUseCase(pensums),
  };
}

describe('Subject use cases', () => {
  it('creates a subject with an upper-case code and an empty description stored as null', async () => {
    const { createSubject } = setupAcademics();

    const subject = await createSubject.execute(A, { code: ' mat-101 ', name: ' Matemática I ', description: '  ' });

    expect(subject).toMatchObject({ institutionId: A, code: 'MAT-101', name: 'Matemática I', description: null });
  });

  it('rejects a duplicate code within an institution, ignoring case, but allows it in another', async () => {
    const { createSubject } = setupAcademics();
    await createSubject.execute(A, { code: 'MAT-101', name: 'Matemática I' });

    await expect(createSubject.execute(A, { code: 'mat-101', name: 'Copy' })).rejects.toBeInstanceOf(
      SubjectCodeTakenException,
    );
    await expect(createSubject.execute(B, { code: 'MAT-101', name: 'Other school' })).resolves.toBeDefined();
  });

  it("never lists, updates or deletes another institution's subject", async () => {
    const { createSubject, listSubjects, updateSubject, deleteSubject, subjects } = setupAcademics();
    const theirs = await createSubject.execute(B, { code: 'BIO-1', name: 'Biología' });

    expect(await listSubjects.execute(A)).toEqual([]);
    await expect(updateSubject.execute(A, theirs.id, { name: 'Hijacked' })).rejects.toBeInstanceOf(
      SubjectNotFoundException,
    );
    await expect(deleteSubject.execute(A, theirs.id)).rejects.toBeInstanceOf(SubjectNotFoundException);
    expect(subjects.rows[0].name).toBe('Biología');
  });

  it('updates only the given fields and can clear the description', async () => {
    const { createSubject, updateSubject } = setupAcademics();
    const subject = await createSubject.execute(A, { code: 'FIS-1', name: 'Física', description: 'Mecánica' });

    const renamed = await updateSubject.execute(A, subject.id, { name: 'Física I' });
    expect(renamed).toMatchObject({ code: 'FIS-1', name: 'Física I', description: 'Mecánica' });

    const cleared = await updateSubject.execute(A, subject.id, { description: '' });
    expect(cleared.description).toBeNull();
  });

  it('refuses to delete a subject that a pensum uses', async () => {
    const { createSubject, createPensum, place, deleteSubject, unplace } = setupAcademics();
    const subject = await createSubject.execute(A, { code: 'QUI-1', name: 'Química' });
    const pensum = await createPensum.execute(A, { code: 'BACH', name: 'Bachillerato' });
    await place.execute(A, pensum.id, subject.id, placement);

    await expect(deleteSubject.execute(A, subject.id)).rejects.toBeInstanceOf(SubjectInUseException);

    await unplace.execute(A, pensum.id, subject.id);
    await expect(deleteSubject.execute(A, subject.id)).resolves.toBeUndefined();
  });
});

describe('Pensum use cases', () => {
  it('creates version 1 by default and allows a new version of the same code', async () => {
    const { createPensum } = setupAcademics();

    const first = await createPensum.execute(A, { code: 'bach', name: 'Bachillerato' });
    const second = await createPensum.execute(A, { code: 'BACH', name: 'Bachillerato 2027', version: 2 });

    expect(first).toMatchObject({ code: 'BACH', version: 1, isActive: true, subjects: [] });
    expect(second.version).toBe(2);
    await expect(
      createPensum.execute(A, { code: 'BACH', name: 'Duplicate', version: 2 }),
    ).rejects.toBeInstanceOf(PensumVersionTakenException);
  });

  it('places a subject, then updates its placement instead of duplicating it', async () => {
    const { createSubject, createPensum, place } = setupAcademics();
    const subject = await createSubject.execute(A, { code: 'MAT-1', name: 'Matemática' });
    const pensum = await createPensum.execute(A, { code: 'BACH', name: 'Bachillerato' });

    await place.execute(A, pensum.id, subject.id, placement);
    const updated = await place.execute(A, pensum.id, subject.id, { level: 2, weeklyHours: 6, credits: null });

    expect(updated.subjects).toEqual([
      { subjectId: subject.id, code: 'MAT-1', name: 'Matemática', level: 2, weeklyHours: 6, credits: null },
    ]);
  });

  it("never mixes tenants: another institution's subject or pensum cannot be combined", async () => {
    const { createSubject, createPensum, place, pensums } = setupAcademics();
    const mySubject = await createSubject.execute(A, { code: 'MAT-1', name: 'Matemática' });
    const myPensum = await createPensum.execute(A, { code: 'BACH', name: 'Bachillerato' });
    const theirSubject = await createSubject.execute(B, { code: 'MAT-1', name: 'Theirs' });
    const theirPensum = await createPensum.execute(B, { code: 'BACH', name: 'Theirs' });

    await expect(place.execute(A, myPensum.id, theirSubject.id, placement)).rejects.toBeInstanceOf(
      SubjectNotFoundException,
    );
    await expect(place.execute(A, theirPensum.id, mySubject.id, placement)).rejects.toBeInstanceOf(
      PensumNotFoundException,
    );
    expect(pensums.rows.every((row) => row.subjects.length === 0)).toBe(true);
  });

  it("never reads, updates or deletes another institution's pensum", async () => {
    const { createPensum, listPensums, getPensum, updatePensum, deletePensum, unplace } = setupAcademics();
    const theirs = await createPensum.execute(B, { code: 'BACH', name: 'Theirs' });

    expect(await listPensums.execute(A)).toEqual([]);
    for (const attempt of [
      () => getPensum.execute(A, theirs.id),
      () => updatePensum.execute(A, theirs.id, { isActive: false }),
      () => deletePensum.execute(A, theirs.id),
      () => unplace.execute(A, theirs.id, 'any-subject'),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(PensumNotFoundException);
    }
    expect((await getPensum.execute(B, theirs.id)).isActive).toBe(true);
  });

  it('reports removing a subject that is not in the pensum', async () => {
    const { createPensum, unplace } = setupAcademics();
    const pensum = await createPensum.execute(A, { code: 'BACH', name: 'Bachillerato' });

    await expect(unplace.execute(A, pensum.id, 'not-placed')).rejects.toBeInstanceOf(
      SubjectNotFoundException,
    );
  });
});
