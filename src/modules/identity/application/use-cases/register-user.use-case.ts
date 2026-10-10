import { normalizeEmail } from '../../domain/entities/user.entity.js';
import { EmailAlreadyRegisteredException } from '../../domain/exceptions/identity.exceptions.js';
import type { PasswordHasher } from '../../domain/ports/password-hasher.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';
import type { AuthSession } from '../auth-session.js';
import type { SessionIssuer } from '../services/session-issuer.js';

export interface RegisterUserInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(input: RegisterUserInput): Promise<AuthSession> {
    const email = normalizeEmail(input.email);
    if (await this.users.findByEmail(email)) {
      throw new EmailAlreadyRegisteredException();
    }
    const user = await this.users.create({
      email,
      passwordHash: await this.hasher.hash(input.password),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      avatarUrl: null,
      emailVerified: false,
    });
    return this.sessions.issueFor(user);
  }
}
