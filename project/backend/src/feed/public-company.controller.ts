import { Controller, Get, Param } from '@nestjs/common';
import { PublicCompanyService } from './public-company.service';

@Controller('public/companies')
export class PublicCompanyController {
  constructor(private readonly svc: PublicCompanyService) {}

  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.svc.bySlug(slug);
  }
}
