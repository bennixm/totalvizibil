import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthPrincipal } from '../../auth/auth.types';
import { WebsiteBuilderService } from './website-builder.service';
import { PutPagesDto } from './dto/put-pages.dto';
import { AddSectionDto } from './dto/add-section.dto';
import { PatchSectionDto } from './dto/patch-section.dto';
import { MoveSectionDto } from './dto/move-section.dto';
import { PatchThemeDto } from './dto/patch-theme.dto';
import { BuilderAddAssetDto } from './dto/add-asset.dto';
import { AiPlanDto } from './dto/ai-plan.dto';
import { AiSectionDto } from './dto/ai-section.dto';

@UseGuards(AuthGuard)
@Controller('companies/:companyId/website-builder')
export class WebsiteBuilderController {
  constructor(private readonly builder: WebsiteBuilderService) {}

  @Get()
  get(@CurrentUser() user: AuthPrincipal, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.builder.get(user.id, companyId);
  }

  /** Pay the one-time advanced-builder unlock fee and seed the starter site. */
  @Post('unlock')
  unlock(@CurrentUser() user: AuthPrincipal, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.builder.unlock(user.id, companyId);
  }

  /** Add / remove / rename / reorder pages, set home, toggle nav (max 6). */
  @Put('pages')
  putPages(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: PutPagesDto,
  ) {
    return this.builder.putPages(user.id, companyId, dto);
  }

  @Post('pages/:pageId/sections')
  addSection(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('pageId') pageId: string,
    @Body() dto: AddSectionDto,
  ) {
    return this.builder.addSection(user.id, companyId, pageId, dto);
  }

  @Patch('sections/:sectionId')
  patchSection(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: PatchSectionDto,
  ) {
    return this.builder.patchSection(user.id, companyId, sectionId, dto);
  }

  @Post('sections/:sectionId/move')
  moveSection(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: MoveSectionDto,
  ) {
    return this.builder.moveSection(user.id, companyId, sectionId, dto);
  }

  @Delete('sections/:sectionId')
  deleteSection(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('sectionId') sectionId: string,
  ) {
    return this.builder.deleteSection(user.id, companyId, sectionId);
  }

  @Patch('theme')
  patchTheme(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: PatchThemeDto,
  ) {
    return this.builder.patchTheme(user.id, companyId, dto);
  }

  @Post('assets')
  addAsset(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: BuilderAddAssetDto,
  ) {
    return this.builder.addAsset(user.id, companyId, dto);
  }

  /** Generate the whole site from a free-text brief (keeps an undo snapshot). */
  @Post('ai/plan')
  aiPlan(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: AiPlanDto,
  ) {
    return this.builder.aiPlan(user.id, companyId, dto);
  }

  @Post('ai/undo')
  aiUndo(@CurrentUser() user: AuthPrincipal, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.builder.aiUndo(user.id, companyId);
  }

  @Post('ai/section/:sectionId')
  aiSection(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: AiSectionDto,
  ) {
    return this.builder.aiSection(user.id, companyId, sectionId, dto);
  }
}
