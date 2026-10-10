import { normalizeEmail } from '../../domain/entities/user.entity.js';
import { InvalidCredentialsException } from '../../domain/exceptions/identity.exceptions.js';
import type { PasswordHasher } from '../../domain/ports/password-hasher.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';
import type { AuthSession } from '../auth-session.js';
import type { SessionIssuer } from '../services/session-issuer.js';

export interface LoginWithPasswordInput {
  email: string;
  password: string;
}

export class LoginWithPasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(input: LoginWithPasswordInput): Promise<AuthSession> {
    const user = await this.users.findByEmail(normalizeEmail(input.email));
    // Always run the hash comparison so unknown emails take as long as wrong passwords
    const passwordMatches = await this.hasher.verify(input.password, user?.passwordHash ?? null);
    if (!user || !passwordMatches) {
      throw new InvalidCredentialsException();
    }
    return this.sessions.issueFor(user);
  }
}
