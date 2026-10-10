import { normalizeEmail, UserStatus } from '../../domain/entities/user.entity.js';
import type { PasswordHasher } from '../../domain/ports/password-hasher.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';

export interface PlatformAdminCredentials {
  email: string;
  password: string;
}

export class EnsurePlatformAdminUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  /**
   * Creates the first Platform Admin if no account has that email. Never
   * changes an existing account, so it is safe to run on every start.
   * Resolves to true when it created the account.
   */
  async execute(credentials: PlatformAdminCredentials): Promise<boolean> {
    const email = normalizeEmail(credentials.email);
    if (await this.users.findByEmail(email)) {
      return false;
    }
    await this.users.create({
      email,
      passwordHash: await this.hasher.hash(credentials.password),
      firstName: 'Platform',
      lastName: 'Admin',
      avatarUrl: null,
      emailVerified: true,
      status: UserStatus.ACTIVE,
      isPlatformAdmin: true,
    });
    return true;
  }
}
