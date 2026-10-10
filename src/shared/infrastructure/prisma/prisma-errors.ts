import { Logger } from '@nestjs/common';
import { DomainException, PersistenceException } from '../../domain/domain.exception.js';
import { Prisma } from './generated/client.js';

export const PrismaErrorCode = {
  UNIQUE_VIOLATION: 'P2002',
  FOREIGN_KEY_VIOLATION: 'P2003',
  RECORD_NOT_FOUND: 'P2025',
} as const;

type PrismaErrorCode = (typeof PrismaErrorCode)[keyof typeof PrismaErrorCode];

export type PrismaErrorMap = Partial<Record<PrismaErrorCode, () => DomainException>>;

export function isPrismaError(error: unknown, code: PrismaErrorCode): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/**
 * Runs a query and converts any database failure into a Domain Exception, so
 * driver errors never reach the client. `known` maps expected Prisma error
 * codes to business errors; anything else is logged and becomes a generic failure.
 */
export async function runQuery<T>(
  logger: Logger,
  operation: () => Promise<T>,
  known: PrismaErrorMap = {},
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DomainException) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const translate = known[error.code as PrismaErrorCode];
      if (translate) {
        throw translate();
      }
    }
    logger.error(error instanceof Error ? error.stack : String(error));
    throw new PersistenceException();
  }
}
