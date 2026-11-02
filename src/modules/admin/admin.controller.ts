import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, PlatformRoles, RawResponse } from '../../common/decorators/auth.decorators';
import { SkipTenant } from '../../common/decorators/skip-tenant.decorator';
import { AdminService } from './admin.service';
import { AdminExportsService } from './admin-exports.service';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { AdminNoteTargetQueryDto, CreateAdminNoteDto, UpdateAdminNoteDto } from './admin-notes.dto';
import { AdminPayoutQueryDto, AdminUpdatePayoutDto } from '../affiliates/dto/affiliate.dto';
import {
  AdminBusinessQueryDto,
  AdminPaymentQueryDto,
  AdminUpdateUserDto,
  AdminUserQueryDto,
  AuditQueryDto,
  ChangePlanDto,
  CreateCouponDto,
  CreatePlanDto,
  ExtendTrialDto,
  SuspendBusinessDto,
  UpdatePlanDto,
  UpdateServiceChargeDto,
} from './dto/admin.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';

@ApiTags('Platform admin')
@ApiBearerAuth()
@SkipTenant()
@PlatformRoles('super_admin', 'support')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly exports: AdminExportsService,
    private readonly affiliates: AffiliatesService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('users')
  users(@Query() query: AdminUserQueryDto) {
    return this.admin.listUsers(query);
  }

  @Get('users/:id')
  userDetail(@Param('id') id: string) {
    return this.admin.userDetail(id);
  }

  @PlatformRoles('super_admin')
  @Patch('users/:id')
  updateUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.admin.updateUser(user.id, id, dto);
  }

  @Get('businesses')
  businesses(@Query() query: AdminBusinessQueryDto) {
    return this.admin.listBusinesses(query);
  }

  @Get('businesses/:id')
  businessDetail(@Param('id') id: string) {
    return this.admin.businessDetail(id);
  }

  @PlatformRoles('super_admin')
  @Patch('businesses/:id/plan')
  changePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangePlanDto,
  ) {
    return this.admin.changePlan(user.id, id, dto);
  }

  @PlatformRoles('super_admin')
  @Post('businesses/:id/extend-trial')
  extendTrial(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ExtendTrialDto,
  ) {
    return this.admin.extendTrial(user.id, id, dto);
  }

  @PlatformRoles('super_admin')
  @Patch('businesses/:id/suspend')
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SuspendBusinessDto,
  ) {
    return this.admin.suspendBusiness(user.id, id, dto);
  }

  @PlatformRoles('super_admin', 'support')
  @Patch('businesses/:id/service-charge')
  updateServiceCharge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateServiceChargeDto,
  ) {
    return this.admin.updateServiceCharge(user.id, id, dto);
  }

  @Get('plans')
  plans() {
    return this.admin.listPlans();
  }

  @PlatformRoles('super_admin')
  @Post('plans')
  createPlan(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePlanDto) {
    return this.admin.createPlan(user.id, dto);
  }

  @PlatformRoles('super_admin')
  @Patch('plans/:key')
  updatePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.admin.updatePlan(user.id, key, dto);
  }

  @Get('coupons')
  coupons() {
    return this.admin.listCoupons();
  }

  @PlatformRoles('super_admin')
  @Post('coupons')
  createCoupon(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCouponDto) {
    return this.admin.createCoupon(user.id, dto);
  }

  @PlatformRoles('super_admin')
  @Delete('coupons/:id')
  revokeCoupon(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.admin.revokeCoupon(user.id, id);
  }

  @Get('payments')
  payments(@Query() query: AdminPaymentQueryDto) {
    return this.admin.listPayments(query);
  }

  @Get('whatsapp')
  whatsapp() {
    return this.admin.whatsappHealth();
  }

  @Get('webhooks')
  webhooks() {
    return this.admin.listWebhooks();
  }

  @PlatformRoles('super_admin')
  @Post('webhooks/retry')
  retryWebhooks() {
    return this.admin.retryWebhooks();
  }

  @PlatformRoles('super_admin')
  @Post('businesses/:id/impersonate')
  impersonate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.admin.impersonateBusiness(user.id, id);
  }

  @Get('affiliates')
  affiliateOverview() {
    return this.affiliates.adminOverview();
  }

  @Get('affiliate-payouts')
  affiliatePayouts(@Query() query: AdminPayoutQueryDto) {
    return this.affiliates.adminListPayouts(query);
  }

  @PlatformRoles('super_admin')
  @Patch('affiliate-payouts/:id')
  updateAffiliatePayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminUpdatePayoutDto,
  ) {
    return this.affiliates.adminUpdatePayout(user.id, id, dto);
  }

  @Get('notes')
  notes(@Query() query: AdminNoteTargetQueryDto) {
    return this.admin.notes(query);
  }

  @PlatformRoles('super_admin')
  @Post('notes')
  createNote(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAdminNoteDto) {
    return this.admin.createNote(user.id, dto);
  }

  @PlatformRoles('super_admin')
  @Patch('notes/:id')
  updateNote(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateAdminNoteDto) {
    return this.admin.updateNote(user.id, id, dto);
  }

  @PlatformRoles('super_admin')
  @Delete('notes/:id')
  deleteNote(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.admin.deleteNote(user.id, id);
  }

  @RawResponse()
  @Get('exports/:resource')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param('resource') resource: string,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const file = await this.exports.export(resource, user.id, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('X-Export-Rows', String(file.rows));
    res.send(file.csv);
  }

  @Get('audit-logs')
  auditLogs(@Query() query: AuditQueryDto) {
    return this.admin.auditLogList(query);
  }
}
