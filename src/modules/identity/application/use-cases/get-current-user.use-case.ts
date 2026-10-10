import { UserNotFoundException } from '../../domain/exceptions/identity.exceptions.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';
import type { AuthUserView } from '../auth-session.js';
import type { SessionIssuer } from '../services/session-issuer.js';

export class GetCurrentUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(userId: string): Promise<AuthUserView> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UserNotFoundException();
    }
    return this.sessions.describe(user);
  }
}
