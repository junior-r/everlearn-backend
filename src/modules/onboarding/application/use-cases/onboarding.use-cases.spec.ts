import { RecordingNotifier } from '../../../../../test/support/communication.fakes.js';
import {
  createOnboardingFakes,
  INSTITUTION_ID,
  JPEG_BYTES,
  OTHER_INSTITUTION_ID,
  PNG_BYTES,
  SAMPLE_EXTRACTION,
} from '../../../../../test/support/onboarding.fakes.js';
import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { MAX_DOCUMENT_IMAGE_BYTES } from '../../domain/document-image.js';
import {
  DocumentType,
  OnboardingStatus,
} from '../../domain/entities/onboarding-application.entity.js';
import {
  ApplicantNotFoundException,
  DocumentImageTooLargeException,
  IdentityAlreadyVerifiedException,
  IdentityCheckNotAllowedException,
  InvalidBirthDateException,
  NothingToConfirmException,
  OcrProcessingFailedException,
  UnsupportedDocumentImageException,
} from '../../domain/exceptions/onboarding.exceptions.js';
import { MockOcrProvider } from '../../infrastructure/ocr/mock-ocr.provider.js';
import { CaptureIdentityDocumentUseCase, ConfirmIdentityUseCase } from './identity-check.use-cases.js';

const TODAY = new Date('2026-10-10T12:00:00.000Z');

const memberOf = (role: Role, institutionId = INSTITUTION_ID): AuthenticatedUser => ({
  userId: `${role.toLowerCase()}-user`,
  email: `${role.toLowerCase()}@example.com`,
  isPlatformAdmin: false,
  mustChangePassword: false,
  memberships: [{ id: `${role.toLowerCase()}-membership`, institutionId, role }],
});
const staff = memberOf(Role.STAFF);

/** A Student registered by the institution and still waiting for their ID check, with Staff at the desk. */
function setup() {
  const fakes = createOnboardingFakes();
  const student = fakes.applications.addApplicant();
  const notifier = new RecordingNotifier();
  const desk = { actor: staff, institutionId: INSTITUTION_ID, membershipId: student.membershipId };
  return {
    ...fakes,
    notifier,
    student,
    desk,
    upload: { ...desk, documentType: DocumentType.NATIONAL_ID, content: JPEG_BYTES },
    confirmation: {
      ...desk,
      verifierMembershipId: 'staff-membership',
      firstName: ' María ',
      lastName: 'González',
      documentType: DocumentType.NATIONAL_ID,
      documentNumber: ' 87654321 ',
      birthDate: '2008-03-14',
    },
    capture: new CaptureIdentityDocumentUseCase(fakes.applications, fakes.storage, fakes.ocr),
    confirm: new ConfirmIdentityUseCase(fakes.applications, notifier, () => TODAY),
  };
}

describe('CaptureIdentityDocumentUseCase', () => {
  it('stores the photo, runs OCR and returns the extracted data for the desk to check', async () => {
    const { capture, upload, applications, storage, ocr, student } = setup();

    const view = await capture.execute(upload);

    expect(view.status).toBe(OnboardingStatus.PENDING_CONFIRMATION);
    expect(view.documentType).toBe(DocumentType.NATIONAL_ID);
    expect(view.extracted).toEqual({
      firstName: 'María Fernanda',
      lastName: 'González Pérez',
      documentNumber: '12345678',
      birthDate: '2008-03-14',
      confidence: 0.93,
    });
    expect(storage.stored).toHaveLength(1);
    expect(storage.stored[0]).toMatchObject({ ownerId: student.userId, image: { format: 'jpeg' } });
    expect(ocr.calls[0].documentType).toBe(DocumentType.NATIONAL_ID);
    expect(applications.rows[0].documentKey).toBe(storage.stored[0].key);
    // PROCESSING is persisted before the slow OCR call, so a crash mid-way is visible
    expect(applications.savedStatuses).toEqual([
      OnboardingStatus.PROCESSING,
      OnboardingStatus.PENDING_CONFIRMATION,
    ]);
  });

  it('ties the check to the institution at the desk and the role the member holds there', async () => {
    const { capture, upload, applications } = setup();

    await capture.execute(upload);

    expect(applications.rows[0]).toMatchObject({ institutionId: INSTITUTION_ID, requestedRole: Role.STUDENT });
  });

  it('never exposes the storage key or OCR provider', async () => {
    const { capture, upload } = setup();

    const view = await capture.execute(upload);

    expect(JSON.stringify(view)).not.toContain('onboarding/');
    expect(JSON.stringify(view)).not.toContain('fake');
  });

  it('detects the format from the bytes', async () => {
    const { capture, upload, storage } = setup();

    await capture.execute({ ...upload, content: PNG_BYTES });

    expect(storage.stored[0].image.format).toBe('png');
  });

  it.each([
    ['no file', undefined],
    ['an empty file', new Uint8Array()],
    ['a file that is not an image', new TextEncoder().encode('<script>alert(1)</script>')],
    ['a PDF', Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d])],
  ])('rejects %s without storing anything', async (_label, content) => {
    const { capture, upload, storage, applications } = setup();

    await expect(capture.execute({ ...upload, content })).rejects.toBeInstanceOf(
      UnsupportedDocumentImageException,
    );
    expect(storage.stored).toHaveLength(0);
    expect(applications.rows).toHaveLength(0);
  });

  it('rejects an image over the size limit', async () => {
    const { capture, upload } = setup();
    const oversized = new Uint8Array(MAX_DOCUMENT_IMAGE_BYTES + 1);
    oversized.set(JPEG_BYTES);

    await expect(capture.execute({ ...upload, content: oversized })).rejects.toBeInstanceOf(
      DocumentImageTooLargeException,
    );
  });

  it('lets the desk retake the photo before confirming, reusing the same check', async () => {
    const { capture, upload, applications, storage } = setup();
    await capture.execute(upload);

    const view = await capture.execute({ ...upload, documentType: DocumentType.PASSPORT });

    expect(applications.rows).toHaveLength(1);
    expect(storage.stored).toHaveLength(2);
    expect(view.documentType).toBe(DocumentType.PASSPORT);
    expect(applications.rows[0].documentKey).toBe(storage.stored[1].key);
  });

  it('returns to the photo step when the OCR fails', async () => {
    const { capture, upload, applications, ocr } = setup();
    ocr.failWith = new Error('provider timeout');

    await expect(capture.execute(upload)).rejects.toBeInstanceOf(OcrProcessingFailedException);

    expect(applications.rows[0].status).toBe(OnboardingStatus.PENDING_UPLOAD);
    expect(applications.rows[0].extracted).toBeNull();
  });

  it("reports another institution's member, or a missing one, as not found, storing nothing", async () => {
    const { capture, upload, applications, storage, ocr } = setup();
    const elsewhere = applications.addApplicant({ institutionId: OTHER_INSTITUTION_ID });

    await expect(capture.execute({ ...upload, membershipId: elsewhere.membershipId })).rejects.toBeInstanceOf(
      ApplicantNotFoundException,
    );
    await expect(capture.execute({ ...upload, membershipId: 'missing' })).rejects.toBeInstanceOf(
      ApplicantNotFoundException,
    );
    expect(storage.stored).toHaveLength(0);
    expect(ocr.calls).toHaveLength(0);
  });

  it('refuses a member who was already verified, in this institution or another', async () => {
    const { capture, upload, applications, storage } = setup();
    const verified = applications.addApplicant({ isVerified: true });

    await expect(capture.execute({ ...upload, membershipId: verified.membershipId })).rejects.toBeInstanceOf(
      IdentityAlreadyVerifiedException,
    );
    expect(storage.stored).toHaveLength(0);
  });
});

describe('who may check whose ID', () => {
  it.each([
    ['Staff', memberOf(Role.STAFF)],
    ['a Principal', memberOf(Role.COORDINATOR)],
    ['an Institution Admin', memberOf(Role.ADMIN)],
  ])('lets %s check a Student or a Guardian', async (_label, actor) => {
    const { capture, upload, applications } = setup();
    const guardian = applications.addApplicant({ role: Role.GUARDIAN });

    await expect(capture.execute({ ...upload, actor })).resolves.toBeDefined();
    await expect(capture.execute({ ...upload, actor, membershipId: guardian.membershipId })).resolves.toBeDefined();
  });

  it.each([Role.TEACHER, Role.STAFF, Role.COORDINATOR])(
    'keeps the ID of a %s for an Institution Admin, as only they register that role',
    async (role) => {
      const { capture, upload, applications } = setup();
      const member = applications.addApplicant({ role });

      await expect(capture.execute({ ...upload, membershipId: member.membershipId })).rejects.toBeInstanceOf(
        IdentityCheckNotAllowedException,
      );
      await expect(
        capture.execute({ ...upload, actor: memberOf(Role.COORDINATOR), membershipId: member.membershipId }),
      ).rejects.toBeInstanceOf(IdentityCheckNotAllowedException);
      await expect(
        capture.execute({ ...upload, actor: memberOf(Role.ADMIN), membershipId: member.membershipId }),
      ).resolves.toBeDefined();
    },
  );

  it.each([Role.TEACHER, Role.STUDENT, Role.GUARDIAN])('lets a %s check nobody', async (role) => {
    const { capture, upload, storage } = setup();

    await expect(capture.execute({ ...upload, actor: memberOf(role) })).rejects.toBeInstanceOf(
      IdentityCheckNotAllowedException,
    );
    expect(storage.stored).toHaveLength(0);
  });

  it('judges the desk by its role in the institution being acted on, not elsewhere', async () => {
    const { capture, upload } = setup();

    await expect(
      capture.execute({ ...upload, actor: memberOf(Role.ADMIN, OTHER_INSTITUTION_ID) }),
    ).rejects.toBeInstanceOf(IdentityCheckNotAllowedException);
  });
});

describe('ConfirmIdentityUseCase', () => {
  async function captured() {
    const context = setup();
    await context.capture.execute(context.upload);
    return context;
  }

  it('saves the checked, trimmed identity and activates the member at once', async () => {
    const { confirm, confirmation, applications, student } = await captured();
    const verified: string[] = [];
    applications.onVerified = (application) => verified.push(application.userId);

    const view = await confirm.execute(confirmation);

    const identity = {
      firstName: 'María',
      lastName: 'González',
      documentType: DocumentType.NATIONAL_ID,
      documentNumber: '87654321',
      birthDate: '2008-03-14',
    };
    expect(view.status).toBe(OnboardingStatus.APPROVED);
    expect(applications.profiles.get(student.userId)).toEqual(identity);
    expect(applications.rows[0].confirmed).toEqual(identity);
    expect(verified).toEqual([student.userId]);
  });

  it('records who checked the ID', async () => {
    const { confirm, confirmation, applications } = await captured();

    await confirm.execute(confirmation);

    expect(applications.checks).toEqual([
      { applicationId: applications.rows[0].id, verifierMembershipId: 'staff-membership' },
    ]);
  });

  it('keeps what the OCR originally read, even when the desk corrects it', async () => {
    const { confirm, confirmation, applications } = await captured();

    await confirm.execute(confirmation);

    expect(applications.rows[0].extracted?.documentNumber).toBe(SAMPLE_EXTRACTION.documentNumber);
  });

  it('welcomes the member, in the institution that checked them', async () => {
    const { confirm, confirmation, notifier, student } = await captured();

    await confirm.execute(confirmation);

    expect(notifier.requests).toEqual([
      { recipient: { userId: student.userId }, institutionId: INSTITUTION_ID, type: 'WELCOME', data: {} },
    ]);
  });

  it('refuses to confirm before a photo was read', async () => {
    const { confirm, confirmation, applications, student } = setup();

    await expect(confirm.execute(confirmation)).rejects.toBeInstanceOf(NothingToConfirmException);

    applications.seed({ userId: student.userId });
    await expect(confirm.execute(confirmation)).rejects.toBeInstanceOf(NothingToConfirmException);
    expect(applications.profiles.size).toBe(0);
  });

  it('refuses a member verified in the meantime, and welcomes nobody', async () => {
    const { confirm, confirmation, applications, notifier, student } = await captured();
    applications.addApplicant({ ...student, isVerified: true });

    await expect(confirm.execute(confirmation)).rejects.toBeInstanceOf(IdentityAlreadyVerifiedException);
    expect(applications.rows[0].status).toBe(OnboardingStatus.PENDING_CONFIRMATION);
    expect(notifier.requests).toEqual([]);
  });

  it('refuses a desk that may not check this member', async () => {
    const { confirm, confirmation, applications } = await captured();

    await expect(confirm.execute({ ...confirmation, actor: memberOf(Role.TEACHER) })).rejects.toBeInstanceOf(
      IdentityCheckNotAllowedException,
    );
    expect(applications.profiles.size).toBe(0);
  });

  it('only confirms the check opened in the same institution', async () => {
    const { confirm, confirmation, applications, student } = await captured();
    // The same person, registered and still pending in a second institution
    applications.addApplicant({ ...student, membershipId: 'other-membership', institutionId: OTHER_INSTITUTION_ID });

    await expect(
      confirm.execute({
        ...confirmation,
        actor: memberOf(Role.STAFF, OTHER_INSTITUTION_ID),
        institutionId: OTHER_INSTITUTION_ID,
        membershipId: 'other-membership',
      }),
    ).rejects.toBeInstanceOf(NothingToConfirmException);
  });

  it.each([
    ['a date that does not exist', '2008-02-30'],
    ['a malformed date', '14/03/2008'],
    ['today', '2026-10-10'],
    ['a future date', '2030-01-01'],
    ['an implausibly old date', '1850-01-01'],
  ])('rejects %s as a birth date and leaves the check open', async (_label, birthDate) => {
    const { confirm, confirmation, applications } = await captured();

    await expect(confirm.execute({ ...confirmation, birthDate })).rejects.toBeInstanceOf(
      InvalidBirthDateException,
    );
    expect(applications.rows[0].status).toBe(OnboardingStatus.PENDING_CONFIRMATION);
    expect(applications.profiles.size).toBe(0);
  });
});

describe('MockOcrProvider', () => {
  it('waits for the configured delay before returning sample data', async () => {
    vi.useFakeTimers();
    const provider = new MockOcrProvider(2000);
    let settled = false;

    const pending = provider
      .extract({ content: JPEG_BYTES, format: 'jpeg' }, DocumentType.NATIONAL_ID)
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toMatchObject({
      firstName: 'María Fernanda',
      documentNumber: '12345678',
      birthDate: '2008-03-14',
      provider: 'mock',
    });
    vi.useRealTimers();
  });
});
