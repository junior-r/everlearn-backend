# Onboarding: ID check at the desk & OCR

## The Need

Everyone an institution registers (`PENDING_ONBOARDING`), except Institution Admins, must have their identity checked against an ID document before their account is active.

## The Goal

People enrol in person, at the institution, during the enrolment season. Whoever registers them there checks the original document, photographs it, corrects what the OCR read, and the member is active at once, without tying the code to one OCR vendor.

## The Reason

- **Checked in person, not by the member.** The person at the desk sees the document and its holder, which a photo taken at home could not prove. So there is no later review queue: confirming at the desk is the approval.
- **Who checks whom is who registers whom.** The desk uses `canRegister` (`shared/domain/auth/registration.ts`), the same rule as registration: Staff and Principals check Students and Guardians, an Institution Admin every role below them, a Platform Admin inside an institution any role.
- **OCR behind a port (`OcrProvider`).** The use cases only know the interface. `HttpOcrProvider` sends the photo to our own `/ocr-server` (FastAPI + RapidOCR, see `ocr-server/README.md`), so ID photos never go to a third party. `MockOcrProvider` (fixed sample data) is used only when `OCR_SERVICE_URL` is not set, e.g. running the backend alone.
- **Synchronous request.** The upload waits for the OCR result. Simpler than a job queue while OCR takes about a second; the call times out after 30 s.
- **Format checked by file signature**, never by the client-supplied name or MIME type, which an attacker controls.
- **Photos stored privately** behind the `DocumentStorage` port. The local-disk adapter writes outside any served directory and returns an opaque key, not a URL.

## The Implementation

- **Endpoints** (`@Roles(ADMIN, STAFF, COORDINATOR)`, institution from `x-institution-id`): `POST /onboarding/members/:membershipId/document` (multipart `file` + `documentType`) and `POST /onboarding/members/:membershipId/confirm` (names, document type and number, birth date).
- **Status flow:** `PENDING_UPLOAD` → `PROCESSING` → `PENDING_CONFIRMATION` → `APPROVED`. The photo can be retaken until it is confirmed.
- **Confirm** writes, in one transaction: the check (approved, with who did it in `verifiedById` and when), the `Profile` (document type, number, birth date), the account's names as read from the ID, `ACTIVE` status, and every inactive membership of the person. Then the member is welcomed (`WELCOME`).
- **A person is checked once.** A member already active anywhere is `IDENTITY_ALREADY_VERIFIED`; someone pending in two institutions may be checked by either, which activates both roles.
- **Refusals:** a membership of another institution is `MEMBER_NOT_FOUND`; a role the desk may not register is `IDENTITY_CHECK_NOT_ALLOWED`; confirming before a photo was read is `NOTHING_TO_CONFIRM`.
- **OCR output is kept** on the check (`extracted*` columns) even when the desk corrects it.
- **An unreadable photo is not an error.** The OCR service answers with empty fields and confidence 0; the desk sees a notice and types the data. Only an unreachable or failing service yields `OCR_PROCESSING_FAILED`.
- **Service call:** `POST {OCR_SERVICE_URL}/extract`, authenticated with `INTERNAL_SERVICE_SECRET` in `X-Internal-Secret`.
- **Swap the provider** in `onboarding.module.ts` (`OCR_PROVIDER`); swap storage with `DOCUMENT_STORAGE`.

## Known gaps

- The stored photo is kept on record, but no screen shows it again.
- Only the front of the document is captured (`idFrontUrl`); back and selfie are unused.
- Local disk storage is for development only. Replaced photos are not deleted.
