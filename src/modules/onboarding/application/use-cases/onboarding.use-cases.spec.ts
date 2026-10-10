import {
  createOnboardingFakes,
  JPEG_BYTES,
  PNG_BYTES,
  SAMPLE_EXTRACTION,
} from '../../../../../test/support/onboarding.fakes.js';
import { MAX_DOCUMENT_IMAGE_BYTES } from '../../domain/document-image.js';
import {
  DocumentType,
  OnboardingStatus,
} from '../../domain/entities/onboarding-application.entity.js';
import {
  ApplicationAlreadySubmittedException,
  DocumentImageTooLargeException,
  InvalidBirthDateException,
  NothingToConfirmException,
  OcrProcessingFailedException,
  UnsupportedDocumentImageException,
} from '../../domain/exceptions/onboarding.exceptions.js';
import { MockOcrProvider } from '../../infrastructure/ocr/mock-ocr.provider.js';
import { ConfirmOnboardingDataUseCase } from './confirm-onboarding-data.use-case.js';
import { GetOnboardingApplicationUseCase } from './get-onboarding-application.use-case.js';
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

function setup() {
  const fakes = createOnboardingFakes();
  return {
    ...fakes,
    submit: new SubmitIdentityDocumentUseCase(fakes.applications, fakes.storage, fakes.ocr),
    confirm: new ConfirmOnboardingDataUseCase(fakes.applications, () => TODAY),
    get: new GetOnboardingApplicationUseCase(fakes.applications),
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

  it('starts a fresh application after a rejection', async () => {
    const { submit, applications } = setup();
    const rejected = applications.seed({ userId: USER_ID, status: OnboardingStatus.REJECTED });

    const view = await submit.execute(jpegUpload);

    expect(view.id).not.toBe(rejected.id);
    expect(applications.rows).toHaveLength(2);
    expect(applications.rows[0].status).toBe(OnboardingStatus.REJECTED);
  });

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

    expect(view.status).toBe(OnboardingStatus.NEEDS_REVIEW);
    expect(applications.profiles.get(USER_ID)).toEqual({
      firstName: 'María',
      lastName: 'González',
      documentType: DocumentType.NATIONAL_ID,
      documentNumber: '87654321',
      birthDate: '2008-03-14',
    });
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
