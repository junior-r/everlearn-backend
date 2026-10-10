import { Injectable } from '@nestjs/common';
import bcrypt from 'bcrypt';
import type { PasswordHasher } from '../../domain/ports/password-hasher.js';

const COST = 12;

@Injectable()
export class BcryptPasswordHasher implements PasswordHasher {
  // Compared against when a user has no password, to keep response times uniform
  private readonly decoyHash = bcrypt.hash('decoy-password', COST);

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, COST);
  }

  async verify(plain: string, hash: string | null): Promise<boolean> {
    const matches = await bcrypt.compare(plain, hash ?? (await this.decoyHash));
    return hash !== null && matches;
  }
}
