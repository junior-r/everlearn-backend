import { Module } from '@nestjs/common';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import {
  CreateInstitutionUseCase,
  DeleteInstitutionUseCase,
  ListInstitutionsUseCase,
  UpdateInstitutionUseCase,
} from './application/use-cases/institution.use-cases.js';
import { INSTITUTION_REPOSITORY } from './domain/ports/institution.repository.js';
import { PrismaInstitutionRepository } from './infrastructure/repositories/prisma-institution.repository.js';
import { InstitutionsController } from './presentation/controllers/institutions.controller.js';

@Module({
  controllers: [InstitutionsController],
  providers: [
    { provide: INSTITUTION_REPOSITORY, useClass: PrismaInstitutionRepository },
    useCaseProvider(CreateInstitutionUseCase, [INSTITUTION_REPOSITORY]),
    useCaseProvider(ListInstitutionsUseCase, [INSTITUTION_REPOSITORY]),
    useCaseProvider(UpdateInstitutionUseCase, [INSTITUTION_REPOSITORY]),
    useCaseProvider(DeleteInstitutionUseCase, [INSTITUTION_REPOSITORY]),
  ],
})
export class InstitutionsModule {}
