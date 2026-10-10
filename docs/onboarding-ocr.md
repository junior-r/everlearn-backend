# Onboarding: ID capture & OCR

## The Need

A new account (`PENDING_ONBOARDING`) must prove its identity with a photo of an ID document before an institution activates it.

## The Goal

Read the identity fields from the photo, let the applicant correct them, and store the confirmed data in their `Profile`, without tying the code to one OCR vendor.

## The Reason

- **OCR behind a port (`OcrProvider`).** The use cases only know the interface. `MockOcrProvider` (2 s delay, fixed sample data) stands in until a provider is chosen, so no API key is needed yet.
- **Synchronous request.** The upload waits for the OCR result. Simpler than a job queue while OCR takes seconds; revisit if a real provider is slower.
- **Format checked by file signature**, never by the client-supplied name or MIME type, which an attacker controls.
- **Photos stored privately** behind the `DocumentStorage` port. The local-disk adapter writes outside any served directory and returns an opaque key, not a URL.

## The Implementation

- **Endpoints (`/onboarding`, authenticated):** `GET application`, `POST document` (multipart `file` + `documentType`), `POST confirm`.
- **Status flow:** `PENDING_UPLOAD` → `PROCESSING` → `PENDING_CONFIRMATION` → `NEEDS_REVIEW` → `APPROVED` / `REJECTED`.
- **Confirm** writes, in one transaction: the application status, the `Profile` (document type, number, birth date) and the user's names.
- **OCR output is kept** on the application (`extracted*` columns) even when the applicant corrects it, so reviewers can compare.
- **Swap the provider** in `onboarding.module.ts` (`OCR_PROVIDER`); swap storage with `DOCUMENT_STORAGE`.

## Known gaps

- No review endpoints yet: nothing moves an application to `APPROVED` or the user to `ACTIVE`.
- `institutionId` and `requestedRole` are not collected; both are nullable until that step exists.
- Only the front of the document is captured (`idFrontUrl`); back and selfie are unused.
- Local disk storage is for development only. Replaced photos are not deleted.
