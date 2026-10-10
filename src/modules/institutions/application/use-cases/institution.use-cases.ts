import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';
import { assertValidTimezone, type Institution } from '../../domain/entities/institution.entity.js';
import {
  InstitutionNotEmptyException,
  InstitutionNotFoundException,
} from '../../domain/exceptions/institution.exceptions.js';
import type {
  InstitutionChanges,
  InstitutionRepository,
  NewInstitution,
} from '../../domain/ports/institution.repository.js';

const DEFAULT_TIMEZONE = 'UTC';

export class CreateInstitutionUseCase {
  constructor(private readonly institutions: InstitutionRepository) {}

  // async so that a validation failure is a rejected promise, like every other failure
  async execute(input: { name: string; slug: string; timezone?: string }): Promise<Institution> {
    const institution: NewInstitution = {
      name: input.name.trim(),
      slug: input.slug.trim().toLowerCase(),
      timezone: input.timezone ?? DEFAULT_TIMEZONE,
    };
    assertValidTimezone(institution.timezone);
    return this.institutions.create(institution);
  }
}

export class ListInstitutionsUseCase {
  constructor(private readonly institutions: InstitutionRepository) {}

  /** Platform Admins see every institution; everyone else only those they are an active member of. */
  execute(actor: AuthenticatedUser): Promise<Institution[]> {
    if (actor.isPlatformAdmin) {
      return this.institutions.list();
    }
    const ids = [...new Set(actor.memberships.map((membership) => membership.institutionId))];
    return this.institutions.findByIds(ids);
  }
}

export class UpdateInstitutionUseCase {
  constructor(private readonly institutions: InstitutionRepository) {}

  async execute(id: string, changes: InstitutionChanges): Promise<Institution> {
    if (changes.timezone !== undefined) {
      assertValidTimezone(changes.timezone);
    }
    const updated = await this.institutions.update(id, {
      ...changes,
      name: changes.name?.trim(),
    });
    if (!updated) {
      throw new InstitutionNotFoundException();
    }
    return updated;
  }
}

export class DeleteInstitutionUseCase {
  constructor(private readonly institutions: InstitutionRepository) {}

  /** Deleting would cascade to every account's membership, so it is only allowed while the institution is empty. */
  async execute(id: string): Promise<void> {
    if (await this.institutions.hasMembers(id)) {
      throw new InstitutionNotEmptyException();
    }
    if (!(await this.institutions.delete(id))) {
      throw new InstitutionNotFoundException();
    }
  }
}
