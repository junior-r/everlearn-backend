# Onboarding: ID capture & OCR

## The Need

A Teacher or Student registered by their institution (`PENDING_ONBOARDING`) must prove their identity with a photo of an ID document before an Institution Admin activates them.

## The Goal

Read the identity fields from the photo, let the applicant correct them, and store the confirmed data in their `Profile`, without tying the code to one OCR vendor.

## The Reason

- **OCR behind a port (`OcrProvider`).** The use cases only know the interface. `HttpOcrProvider` sends the photo to our own `/ocr-server` (FastAPI + RapidOCR, see `ocr-server/README.md`), so ID photos never go to a third party. `MockOcrProvider` (fixed sample data) is used only when `OCR_SERVICE_URL` is not set, e.g. running the backend alone.
- **Synchronous request.** The upload waits for the OCR result. Simpler than a job queue while OCR takes about a second; the call times out after 30 s.
- **Format checked by file signature**, never by the client-supplied name or MIME type, which an attacker controls.
- **Photos stored privately** behind the `DocumentStorage` port. The local-disk adapter writes outside any served directory and returns an opaque key, not a URL.

## The Implementation

- **Endpoints (`/onboarding`, authenticated):** `GET application`, `POST document` (multipart `file` + `documentType`), `POST confirm`.
- **Status flow:** `PENDING_UPLOAD` → `PROCESSING` → `PENDING_CONFIRMATION` → `NEEDS_REVIEW` → `APPROVED` / `REJECTED`.
- **Confirm** writes, in one transaction: the application status, the `Profile` (document type, number, birth date) and the user's names.
- **OCR output is kept** on the application (`extracted*` columns) even when the applicant corrects it, so reviewers can compare.
- **An unreadable photo is not an error.** The OCR service answers with empty fields and confidence 0; the applicant sees a notice and types the data. Only an unreachable or failing service yields `OCR_PROCESSING_FAILED`.
- **Service call:** `POST {OCR_SERVICE_URL}/extract`, authenticated with `INTERNAL_SERVICE_SECRET` in `X-Internal-Secret`.
- **Swap the provider** in `onboarding.module.ts` (`OCR_PROVIDER`); swap storage with `DOCUMENT_STORAGE`.

## Known gaps

- Review, approval and the link to the institution are described in `institution-admin-pipeline.md`.
- Only the front of the document is captured (`idFrontUrl`); back and selfie are unused.
- Local disk storage is for development only. Replaced photos are not deleted.
