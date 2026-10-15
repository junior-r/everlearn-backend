import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated/client.js';
import { runQuery } from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import { LabKey } from '../domain/lab-catalog.js';
import type { ExerciseData, LanguageExercise, LanguageLabKey } from '../domain/language-exercise.js';
import type {
  BuiltInExercise,
  LanguageExerciseRepository,
  NewExercise,
} from '../domain/ports/lab.ports.js';

type ExerciseRow = Prisma.LanguageExerciseGetPayload<object>;

const toLanguageLab = (labKey: string): LanguageLabKey =>
  labKey === LabKey.DEFINITIONS ? LabKey.DEFINITIONS : LabKey.COMPLETIONS;

function toExercise(row: ExerciseRow): LanguageExercise {
  return {
    id: row.id,
    labKey: toLanguageLab(row.labKey),
    authorId: row.authorId,
    institutionId: row.institutionId,
    prompt: row.prompt,
    answers: row.answers,
    hint: row.hint,
    archived: row.archivedAt !== null,
  };
}

const oldestFirst = [{ createdAt: 'asc' }, { id: 'asc' }] satisfies Prisma.LanguageExerciseOrderByWithRelationInput[];

@Injectable()
export class PrismaLanguageExerciseRepository implements LanguageExerciseRepository {
  private readonly logger = new Logger(PrismaLanguageExerciseRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listBuiltIn(labKey: LanguageLabKey): Promise<LanguageExercise[]> {
    return runQuery(this.logger, async () =>
      (
        await this.prisma.languageExercise.findMany({
          where: { labKey, institutionId: null, authorId: null, archivedAt: null },
          orderBy: oldestFirst,
        })
      ).map(toExercise),
    );
  }

  listAuthored(institutionId: string, authorId: string, labKey: LanguageLabKey): Promise<LanguageExercise[]> {
    return runQuery(this.logger, async () =>
      (
        await this.prisma.languageExercise.findMany({
          where: { labKey, institutionId, authorId, archivedAt: null },
          orderBy: oldestFirst,
        })
      ).map(toExercise),
    );
  }

  findMany(ids: readonly string[]): Promise<LanguageExercise[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return runQuery(this.logger, async () =>
      (await this.prisma.languageExercise.findMany({ where: { id: { in: [...ids] } } })).map(toExercise),
    );
  }

  create(data: NewExercise): Promise<LanguageExercise> {
    return runQuery(this.logger, async () =>
      toExercise(
        await this.prisma.languageExercise.create({
          data: {
            labKey: data.labKey,
            institutionId: data.institutionId,
            authorId: data.authorId,
            prompt: data.prompt,
            answers: data.answers,
            hint: data.hint,
          },
        }),
      ),
    );
  }

  update(id: string, data: ExerciseData): Promise<LanguageExercise> {
    return runQuery(this.logger, async () =>
      toExercise(
        await this.prisma.languageExercise.update({
          where: { id },
          data: { prompt: data.prompt, answers: data.answers, hint: data.hint },
        }),
      ),
    );
  }

  async archive(id: string): Promise<void> {
    await runQuery(this.logger, () =>
      this.prisma.languageExercise.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: new Date() } }),
    );
  }

  async syncBuiltIn(bank: readonly BuiltInExercise[]): Promise<void> {
    await runQuery(this.logger, () =>
      this.prisma.$transaction([
        ...bank.map(({ id, labKey, prompt, answers, hint }) =>
          this.prisma.languageExercise.upsert({
            where: { id },
            create: { id, labKey, prompt, answers, hint },
            update: { labKey, prompt, answers, hint, archivedAt: null },
          }),
        ),
        this.prisma.languageExercise.updateMany({
          where: { institutionId: null, authorId: null, archivedAt: null, id: { notIn: bank.map(({ id }) => id) } },
          data: { archivedAt: new Date() },
        }),
      ]),
    );
  }
}
