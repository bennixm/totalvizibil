import { INestApplication } from '@nestjs/common';
import { CompaniesService } from 'src/companies/companies.service';
import { CreateCompanyDto } from 'src/companies/dto/create-company.dto';

/**
 * Test fixture: a bare company owned by `user`. The public `POST /companies`
 * route is gone (real businesses are only ever created from an onboarding
 * draft, which also charges the additional-business fee), so fixtures go
 * through the service directly. Returns `{ body }` so call sites read like
 * the old supertest response.
 */
export async function createCompany(
  app: INestApplication,
  user: { id: string },
  dto: CreateCompanyDto,
): Promise<{ body: Awaited<ReturnType<CompaniesService['create']>> }> {
  const body = await app.get(CompaniesService).create(user.id, dto);
  return { body };
}
