import { JPEG_BYTES } from '../../../../../test/support/onboarding.fakes.js';
import { DocumentType } from '../../domain/entities/onboarding-application.entity.js';
import { OcrProcessingFailedException } from '../../domain/exceptions/onboarding.exceptions.js';
import { HttpOcrProvider } from './http-ocr.provider.js';

const image = { content: JPEG_BYTES, format: 'jpeg' as const };

function providerAnswering(answer: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    calls.push({ url: input, init: init ?? {} });
    return answer();
  });
  const provider = new HttpOcrProvider({
    baseUrl: 'http://ocr.test',
    internalSecret: 'shared-secret',
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { provider, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('HttpOcrProvider', () => {
  it('posts the photo with the internal secret and maps the answer', async () => {
    const { provider, calls } = providerAnswering(() =>
      json({
        first_name: 'María Fernanda',
        last_name: 'González Pérez',
        document_number: 'V-12345678',
        birth_date: '2008-03-14',
        confidence: 0.87,
        engine: 'tesseract',
      }),
    );

    const extracted = await provider.extract(image, DocumentType.NATIONAL_ID);

    expect(extracted).toMatchObject({
      firstName: 'María Fernanda',
      lastName: 'González Pérez',
      documentNumber: 'V-12345678',
      birthDate: '2008-03-14',
      confidence: 0.87,
      provider: 'tesseract',
    });
    expect(extracted.extractedAt).toBeInstanceOf(Date);
    expect(calls[0].url).toBe('http://ocr.test/extract');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['X-Internal-Secret']).toBe('shared-secret');
    const file = (calls[0].init.body as FormData).get('file') as File;
    expect(file.type).toBe('image/jpeg');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(JPEG_BYTES);
  });

  it('turns an unreadable photo into empty fields for the applicant to fill in', async () => {
    const { provider } = providerAnswering(() =>
      json({
        first_name: null,
        last_name: null,
        document_number: null,
        birth_date: null,
        confidence: 0,
        engine: 'tesseract',
      }),
    );

    await expect(provider.extract(image, DocumentType.PASSPORT)).resolves.toMatchObject({
      firstName: '',
      lastName: '',
      documentNumber: '',
      birthDate: null,
      confidence: 0,
    });
  });

  it('drops values of the wrong shape instead of passing them on', async () => {
    const { provider } = providerAnswering(() =>
      json({ first_name: 42, last_name: ['x'], document_number: {}, birth_date: '14/03/2008', confidence: 'high' }),
    );

    await expect(provider.extract(image, DocumentType.OTHER)).resolves.toMatchObject({
      firstName: '',
      lastName: '',
      documentNumber: '',
      birthDate: null,
      confidence: 0,
      provider: 'ocr-server',
    });
  });

  it.each([
    ['the service is unreachable', () => Promise.reject(new TypeError('fetch failed'))],
    ['the request times out', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
    ['the service rejects the secret', () => json({ detail: 'Unauthorized' }, 401)],
    ['the service fails', () => json({ detail: 'boom' }, 500)],
    ['the body is not JSON', () => new Response('<html>', { status: 200 })],
  ])('reports a reading failure when %s, without leaking the cause', async (_label, answer) => {
    const { provider } = providerAnswering(answer);

    const error = await provider.extract(image, DocumentType.NATIONAL_ID).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OcrProcessingFailedException);
    expect((error as Error).message).not.toMatch(/fetch|401|boom|html/i);
  });
});
