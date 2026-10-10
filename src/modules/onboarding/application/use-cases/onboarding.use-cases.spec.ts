import {
  createOnboardingFakes,
  INSTITUTION_ID,
  JPEG_BYTES,
  OTHER_INSTITUTION_ID,
  PNG_BYTES,
  SAMPLE_EXTRACTION,
  STUDENT_ENROLLMENT,
} from '../../../../../test/support/onboarding.fakes.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { MAX_DOCUMENT_IMAGE_BYTES } from '../../domain/document-image.js';
import {
  DocumentType,
  OnboardingStatus,
} from '../../domain/entities/onboarding-application.entity.js';
import {
  ApplicationAlreadySubmittedException,
  ApplicationNotAwaitingReviewException,
  ApplicationNotFoundException,
  DocumentImageTooLargeException,
  InvalidBirthDateException,
  NothingToConfirmException,
  OcrProcessingFailedException,
  OnboardingNotAvailableException,
  RejectionReasonRequiredException,
  UnsupportedDocumentImageException,
} from '../../domain/exceptions/onboarding.exceptions.js';
import { MockOcrProvider } from '../../infrastructure/ocr/mock-ocr.provider.js';
import { ConfirmOnboardingDataUseCase } from './confirm-onboarding-data.use-case.js';
import { GetOnboardingApplicationUseCase } from './get-onboarding-application.use-case.js';
import {
  GetApplicationDocumentUseCase,
  ListPendingReviewsUseCase,
  ReviewApplicationUseCase,
  ReviewDecision,
} from './review.use-cases.js';
import { SubmitIdentityDocumentUseCase } from './submit-identity-document.use-case.js';

const USER_ID = 'user-1';
const TODAY = new Date('2026-10-10T12:00:00.000Z');

const confirmation = {
  userId: USER_ID,
  firstName: ' María ',
  lastName: 'González',
  documentType: DocumentType.NATIONAL_ID,
  documentNumber: ' 87654321 ',
  birthDate: '2008-03-14',
};

/** A pending Student registered by the institution, as every onboarding applicant is. */
function setup() {
  const fakes = createOnboardingFakes();
  fakes.applications.enrollments.set(USER_ID, STUDENT_ENROLLMENT);
  return {
    ...fakes,
    submit: new SubmitIdentityDocumentUseCase(fakes.applications, fakes.storage, fakes.ocr),
    confirm: new ConfirmOnboardingDataUseCase(fakes.applications, () => TODAY),
    get: new GetOnboardingApplicationUseCase(fakes.applications),
    listPending: new ListPendingReviewsUseCase(fakes.applications),
    review: new ReviewApplicationUseCase(fakes.applications),
    getDocument: new GetApplicationDocumentUseCase(fakes.applications, fakes.storage),
  };
}

const jpegUpload = { userId: USER_ID, documentType: DocumentType.NATIONAL_ID, content: JPEG_BYTES };

describe('SubmitIdentityDocumentUseCase', () => {
  it('stores the photo, runs OCR and returns the extracted data for confirmation', async () => {
    const { submit, applications, storage, ocr } = setup();

    const view = await submit.execute(jpegUpload);

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
    expect(storage.stored[0]).toMatchObject({ ownerId: USER_ID, image: { format: 'jpeg' } });
    expect(ocr.calls[0].documentType).toBe(DocumentType.NATIONAL_ID);
    expect(applications.rows[0].documentKey).toBe(storage.stored[0].key);
    // PROCESSING is persisted before the slow OCR call, so a crash mid-way is visible
    expect(applications.savedStatuses).toEqual([
      OnboardingStatus.PROCESSING,
      OnboardingStatus.PENDING_CONFIRMATION,
    ]);
  });

  it('ties the application to the institution and role the member was registered for', async () => {
    const { submit, applications } = setup();

    await submit.execute(jpegUpload);

    expect(applications.rows[0]).toMatchObject({
      institutionId: INSTITUTION_ID,
      requestedRole: Role.STUDENT,
    });
  });

  it('refuses someone no institution registered, before storing or reading anything', async () => {
    const { submit, storage, ocr, applications } = setup();

    await expect(submit.execute({ ...jpegUpload, userId: 'stranger' })).rejects.toBeInstanceOf(
      OnboardingNotAvailableException,
    );
    expect(storage.stored).toHaveLength(0);
    expect(ocr.calls).toHaveLength(0);
    expect(applications.rows).toHaveLength(0);
  });

  it('never exposes the storage key or OCR provider to the applicant', async () => {
    const { submit } = setup();

    const view = await submit.execute(jpegUpload);

    expect(JSON.stringify(view)).not.toContain('onboarding/');
    expect(JSON.stringify(view)).not.toContain('fake');
  });

  it('detects the format from the bytes', async () => {
    const { submit, storage } = setup();

    await submit.execute({ ...jpegUpload, content: PNG_BYTES });

    expect(storage.stored[0].image.format).toBe('png');
  });

  it.each([
    ['no file', undefined],
    ['an empty file', new Uint8Array()],
    ['a file that is not an image', new TextEncoder().encode('<script>alert(1)</script>')],
    ['a PDF', Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d])],
  ])('rejects %s without storing anything', async (_label, content) => {
    const { submit, storage, applications } = setup();

    await expect(submit.execute({ ...jpegUpload, content })).rejects.toBeInstanceOf(
      UnsupportedDocumentImageException,
    );
    expect(storage.stored).toHaveLength(0);
    expect(applications.rows).toHaveLength(0);
  });

  it('rejects an image over the size limit', async () => {
    const { submit } = setup();
    const oversized = new Uint8Array(MAX_DOCUMENT_IMAGE_BYTES + 1);
    oversized.set(JPEG_BYTES);

    await expect(submit.execute({ ...jpegUpload, content: oversized })).rejects.toBeInstanceOf(
      DocumentImageTooLargeException,
    );
  });

  it('lets the applicant retake the photo before confirming, reusing the same application', async () => {
    const { submit, applications, storage } = setup();
    await submit.execute(jpegUpload);

    const view = await submit.execute({ ...jpegUpload, documentType: DocumentType.PASSPORT });

    expect(applications.rows).toHaveLength(1);
    expect(storage.stored).toHaveLength(2);
    expect(view.documentType).toBe(DocumentType.PASSPORT);
    expect(applications.rows[0].documentKey).toBe(storage.stored[1].key);
  });

  it('returns to the upload step when the OCR fails', async () => {
    const { submit, applications, ocr } = setup();
    ocr.failWith = new Error('provider timeout');

    await expect(submit.execute(jpegUpload)).rejects.toBeInstanceOf(OcrProcessingFailedException);

    expect(applications.rows[0].status).toBe(OnboardingStatus.PENDING_UPLOAD);
    expect(applications.rows[0].extracted).toBeNull();
  });

  it.each([OnboardingStatus.NEEDS_REVIEW, OnboardingStatus.APPROVED])(
    'refuses a new document once the application is %s, and stores nothing',
    async (status) => {
      const { submit, applications, storage } = setup();
      applications.seed({ userId: USER_ID, status });

      await expect(submit.execute(jpegUpload)).rejects.toBeInstanceOf(
        ApplicationAlreadySubmittedException,
      );
      expect(storage.stored).toHaveLength(0);
    },
  );

  it("keeps each applicant's application separate", async () => {
    const { submit, get } = setup();
    await submit.execute(jpegUpload);

    await expect(get.execute('someone-else')).resolves.toBeNull();
  });
});

describe('ConfirmOnboardingDataUseCase', () => {
  it('saves the confirmed, trimmed identity to the profile and sends the application to review', async () => {
    const { submit, confirm, applications } = setup();
    await submit.execute(jpegUpload);

    const view = await confirm.execute(confirmation);

    const confirmed = {
      firstName: 'María',
      lastName: 'González',
      documentType: DocumentType.NATIONAL_ID,
      documentNumber: '87654321',
      birthDate: '2008-03-14',
    };
    expect(view.status).toBe(OnboardingStatus.NEEDS_REVIEW);
    expect(applications.profiles.get(USER_ID)).toEqual(confirmed);
    expect(applications.rows[0].confirmed).toEqual(confirmed);
  });

  it('keeps what the OCR originally read, even when the applicant corrects it', async () => {
    const { submit, confirm, applications } = setup();
    await submit.execute(jpegUpload);

    await confirm.execute(confirmation);

    expect(applications.rows[0].extracted?.documentNumber).toBe(SAMPLE_EXTRACTION.documentNumber);
  });

  it('refuses to confirm before a document was processed', async () => {
    const { confirm, applications } = setup();

    await expect(confirm.execute(confirmation)).rejects.toBeInstanceOf(NothingToConfirmException);

    applications.seed({ userId: USER_ID });
    await expect(confirm.execute(confirmation)).rejects.toBeInstanceOf(NothingToConfirmException);
    expect(applications.profiles.size).toBe(0);
  });

  it('refuses to confirm twice', async () => {
    const { submit, confirm } = setup();
    await submit.execute(jpegUpload);
    await confirm.execute(confirmation);

    await expect(
      confirm.execute({ ...confirmation, documentNumber: 'changed' }),
    ).rejects.toBeInstanceOf(ApplicationAlreadySubmittedException);
  });

  it.each([
    ['a date that does not exist', '2008-02-30'],
    ['a malformed date', '14/03/2008'],
    ['today', '2026-10-10'],
    ['a future date', '2030-01-01'],
    ['an implausibly old date', '1850-01-01'],
  ])('rejects %s as a birth date and leaves the application open', async (_label, birthDate) => {
    const { submit, confirm, applications } = setup();
    await submit.execute(jpegUpload);

    await expect(confirm.execute({ ...confirmation, birthDate })).rejects.toBeInstanceOf(
      InvalidBirthDateException,
    );
    expect(applications.rows[0].status).toBe(OnboardingStatus.PENDING_CONFIRMATION);
    expect(applications.profiles.size).toBe(0);
  });
});

describe('review pipeline', () => {
  async function submitted() {
    const context = setup();
    await context.submit.execute(jpegUpload);
    const { id } = await context.confirm.execute(confirmation);
    return { ...context, applicationId: id };
  }

  const approve = (applicationId: string, institutionId = INSTITUTION_ID) => ({
    applicationId,
    institutionId,
    reviewerMembershipId: 'admin-membership',
    decision: ReviewDecision.APPROVE,
  });

  it('lists submitted applications with the registered account, the OCR reading and the confirmed data', async () => {
    const { listPending, applicationId } = await submitted();

    const pending = await listPending.execute(INSTITUTION_ID);

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      id: applicationId,
      status: OnboardingStatus.NEEDS_REVIEW,
      requestedRole: Role.STUDENT,
      applicant: { userId: USER_ID, firstName: 'Registered', lastName: 'Name' },
      extracted: { firstName: 'María Fernanda', documentNumber: '12345678' },
      confirmed: { firstName: 'María', documentNumber: '87654321' },
    });
  });

  it('lists only applications awaiting review, and only for the acting institution', async () => {
    const { listPending, applications } = await submitted();
    applications.seed({ userId: 'not-submitted', status: OnboardingStatus.PENDING_CONFIRMATION });
    applications.seed({
      userId: 'elsewhere',
      status: OnboardingStatus.NEEDS_REVIEW,
      institutionId: OTHER_INSTITUTION_ID,
    });

    expect(await listPending.execute(INSTITUTION_ID)).toHaveLength(1);
    expect((await listPending.execute(OTHER_INSTITUTION_ID))[0].applicant.userId).toBe('elsewhere');
  });

  it('approves: records the reviewer and triggers activation of the member', async () => {
    const { review, applications, applicationId, listPending } = await submitted();
    const activated: string[] = [];
    applications.onApproved = (application) => activated.push(application.userId);

    const view = await review.execute(approve(applicationId));

    expect(view.status).toBe(OnboardingStatus.APPROVED);
    expect(applications.reviews).toEqual([
      { applicationId, status: OnboardingStatus.APPROVED, reviewerMembershipId: 'admin-membership' },
    ]);
    expect(activated).toEqual([USER_ID]);
    expect(await listPending.execute(INSTITUTION_ID)).toEqual([]);
  });

  it('rejects with a reason the applicant can see, without activating anyone', async () => {
    const { review, applications, applicationId, get } = await submitted();
    const activated: string[] = [];
    applications.onApproved = (application) => activated.push(application.userId);

    await review.execute({
      ...approve(applicationId),
      decision: ReviewDecision.REJECT,
      reason: '  La foto está borrosa  ',
    });

    expect(await get.execute(USER_ID)).toMatchObject({
      status: OnboardingStatus.REJECTED,
      rejectionReason: 'La foto está borrosa',
    });
    expect(activated).toEqual([]);
  });

  it.each([undefined, '', '   '])('requires a reason to reject (given %j)', async (reason) => {
    const { review, applications, applicationId } = await submitted();

    await expect(
      review.execute({ ...approve(applicationId), decision: ReviewDecision.REJECT, reason }),
    ).rejects.toBeInstanceOf(RejectionReasonRequiredException);
    expect(applications.rows[0].status).toBe(OnboardingStatus.NEEDS_REVIEW);
  });

  it('lets a rejected applicant try again with a new application for the same enrollment', async () => {
    const { review, submit, applications, applicationId } = await submitted();
    await review.execute({
      ...approve(applicationId),
      decision: ReviewDecision.REJECT,
      reason: 'Documento ilegible',
    });
    // The enrollment must come from the rejected application, not a fresh lookup
    applications.enrollments.clear();

    const retry = await submit.execute(jpegUpload);

    expect(retry.id).not.toBe(applicationId);
    expect(retry.rejectionReason).toBeNull();
    expect(applications.rows).toHaveLength(2);
    expect(applications.rows[0].status).toBe(OnboardingStatus.REJECTED);
    expect(applications.rows[1]).toMatchObject({
      institutionId: INSTITUTION_ID,
      requestedRole: Role.STUDENT,
    });
  });

  it("hides another institution's application from review and from the photo endpoint", async () => {
    const { review, getDocument, applications, applicationId } = await submitted();

    await expect(review.execute(approve(applicationId, OTHER_INSTITUTION_ID))).rejects.toBeInstanceOf(
      ApplicationNotFoundException,
    );
    await expect(getDocument.execute(applicationId, OTHER_INSTITUTION_ID)).rejects.toBeInstanceOf(
      ApplicationNotFoundException,
    );
    expect(applications.rows[0].status).toBe(OnboardingStatus.NEEDS_REVIEW);
    expect(applications.reviews).toEqual([]);
  });

  it('cannot review the same application twice, or one that was never submitted', async () => {
    const { review, applications, applicationId } = await submitted();
    await review.execute(approve(applicationId));
    const draft = applications.seed({ userId: 'draft', status: OnboardingStatus.PENDING_CONFIRMATION });

    await expect(
      review.execute({ ...approve(applicationId), decision: ReviewDecision.REJECT, reason: 'late' }),
    ).rejects.toBeInstanceOf(ApplicationNotAwaitingReviewException);
    await expect(review.execute(approve(draft.id))).rejects.toBeInstanceOf(
      ApplicationNotAwaitingReviewException,
    );
    await expect(review.execute(approve('missing'))).rejects.toBeInstanceOf(
      ApplicationNotFoundException,
    );
  });

  it("returns the stored ID photo to the institution's reviewer", async () => {
    const { getDocument, applicationId } = await submitted();

    const image = await getDocument.execute(applicationId, INSTITUTION_ID);

    expect(image.format).toBe('jpeg');
    expect(image.content).toEqual(JPEG_BYTES);
  });

  it('reports a missing photo as not found', async () => {
    const { getDocument, applications } = setup();
    const noPhoto = applications.seed({ userId: 'x', status: OnboardingStatus.NEEDS_REVIEW });

    await expect(getDocument.execute(noPhoto.id, INSTITUTION_ID)).rejects.toBeInstanceOf(
      ApplicationNotFoundException,
    );
  });
});

describe('GetOnboardingApplicationUseCase', () => {
  it('returns null before the applicant starts and the application afterwards', async () => {
    const { submit, get } = setup();

    await expect(get.execute(USER_ID)).resolves.toBeNull();
    await submit.execute(jpegUpload);

    await expect(get.execute(USER_ID)).resolves.toMatchObject({
      status: OnboardingStatus.PENDING_CONFIRMATION,
    });
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
