import request from 'supertest';
import { JPEG_BYTES } from './support/onboarding.fakes.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const confirmation = {
  firstName: 'María',
  lastName: 'González',
  documentType: 'NATIONAL_ID',
  documentNumber: '87654321',
  birthDate: '2008-03-14',
};

describe('Onboarding HTTP flow', () => {
  let ctx: TestApp;
  let accessToken: string;
  let userId: string;

  const authed = (method: 'get' | 'post', path: string, token = accessToken) =>
    request(ctx.app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);

  const upload = (content: Uint8Array = JPEG_BYTES, documentType = 'NATIONAL_ID') =>
    authed('post', '/onboarding/document')
      .field('documentType', documentType)
      // A misleading name and type on purpose: the server must look at the bytes
      .attach('file', Buffer.from(content), { filename: 'id.exe', contentType: 'text/plain' });

  async function register(email: string) {
    const response = await request(ctx.app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'correct-password', firstName: 'Ada', lastName: 'Lovelace' })
      .expect(201);
    return response.body as { accessToken: string; user: { id: string } };
  }

  beforeEach(async () => {
    ctx = await createTestApp();
    const session = await register('ada@example.com');
    accessToken = session.accessToken;
    userId = session.user.id;
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('requires authentication on every onboarding route', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).get('/onboarding/application').expect(401);
    await request(server).post('/onboarding/document').expect(401);
    await request(server).post('/onboarding/confirm').send(confirmation).expect(401);
  });

  it('reports no application before the applicant starts', async () => {
    await authed('get', '/onboarding/application').expect(200, { application: null });
  });

  it('uploads the ID, returns the OCR data, then confirms it into the profile', async () => {
    const uploaded = await upload().expect(200);

    expect(uploaded.body.application).toMatchObject({
      status: 'PENDING_CONFIRMATION',
      documentType: 'NATIONAL_ID',
      extracted: { firstName: 'María Fernanda', documentNumber: '12345678', birthDate: '2008-03-14' },
    });
    expect(ctx.storage.stored[0]).toMatchObject({ ownerId: userId, image: { format: 'jpeg' } });

    const confirmed = await authed('post', '/onboarding/confirm').send(confirmation).expect(200);

    expect(confirmed.body.application.status).toBe('NEEDS_REVIEW');
    expect(ctx.applications.profiles.get(userId)).toEqual(confirmation);
    const current = await authed('get', '/onboarding/application').expect(200);
    expect(current.body.application.status).toBe('NEEDS_REVIEW');
  });

  it('rejects uploads that are not images, are missing, or have an unknown document type', async () => {
    const notAnImage = await upload(new TextEncoder().encode('MZ this is not an image'));
    expect(notAnImage.status).toBe(400);
    expect(notAnImage.body.code).toBe('UNSUPPORTED_DOCUMENT_IMAGE');

    const missing = await authed('post', '/onboarding/document').field('documentType', 'PASSPORT');
    expect(missing.status).toBe(400);

    await upload(JPEG_BYTES, 'DRIVING_LICENCE').expect(400);
    expect(ctx.storage.stored).toHaveLength(0);
  });

  it('rejects an upload over the size limit before it reaches the use case', async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    oversized.set(JPEG_BYTES);

    await upload(oversized).expect(413);
    expect(ctx.ocr.calls).toHaveLength(0);
  });

  it('validates the confirmation and reports domain errors with stable codes', async () => {
    const early = await authed('post', '/onboarding/confirm').send(confirmation);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('NOTHING_TO_CONFIRM');

    await upload().expect(200);
    await authed('post', '/onboarding/confirm')
      .send({ ...confirmation, birthDate: '14/03/2008' })
      .expect(400);
    await authed('post', '/onboarding/confirm')
      .send({ ...confirmation, status: 'APPROVED' })
      .expect(400);
    const impossible = await authed('post', '/onboarding/confirm').send({
      ...confirmation,
      birthDate: '2008-02-30',
    });
    expect(impossible.body.code).toBe('INVALID_BIRTH_DATE');

    await authed('post', '/onboarding/confirm').send(confirmation).expect(200);
    const again = await upload();
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('APPLICATION_ALREADY_SUBMITTED');
  });

  it("never lets one applicant see or confirm another's application", async () => {
    await upload().expect(200);
    const other = await register('grace@example.com');

    await authed('get', '/onboarding/application', other.accessToken).expect(200, {
      application: null,
    });
    await authed('post', '/onboarding/confirm', other.accessToken).send(confirmation).expect(409);
    expect(ctx.applications.profiles.size).toBe(0);
  });

  it('surfaces an OCR outage as 503 and lets the applicant retry', async () => {
    ctx.ocr.failWith = new Error('provider down');
    const failed = await upload();
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe('OCR_PROCESSING_FAILED');

    ctx.ocr.failWith = null;
    await upload().expect(200);
  });
});
