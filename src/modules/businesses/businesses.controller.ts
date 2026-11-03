import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BusinessesService } from './businesses.service';
import { CurrentBusiness, CurrentUser, Permissions, Roles } from '../../common/decorators/auth.decorators';
import { Public } from '../../common/decorators/public.decorator';
import { PERMISSIONS } from '../../common/constants/permissions';
import { BUSINESS_CATEGORIES } from './business.constants';
import {
  AddSettlementAccountDto,
  CustomDomainDto,
  InviteStaffDto,
  UpdateBusinessDto,
  UpdateStaffDto,
} from './dto/business.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';

@ApiTags('Businesses')
@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  @Public()
  @Get('categories')
  categories() {
    return BUSINESS_CATEGORIES;
  }

  @ApiBearerAuth()
  @Get('current')
  current(@CurrentBusiness() businessId: string) {
    return this.businesses.current(businessId);
  }

  @ApiBearerAuth()
  @Roles('owner')
  @Get('current/settlement-banks')
  settlementBanks() {
    return this.businesses.settlementBanks();
  }

  @ApiBearerAuth()
  @Roles('owner')
  @Post('current/settlement-accounts/resolve')
  resolveSettlementAccount(@Body() dto: AddSettlementAccountDto) {
    return this.businesses.resolveSettlementAccount(dto);
  }

  @ApiBearerAuth()
  @Roles('owner')
  @Post('current/settlement-accounts')
  addSettlementAccount(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Body() dto: AddSettlementAccountDto,
  ) {
    return this.businesses.addSettlementAccount(user, businessId, dto);
  }

  @ApiBearerAuth()
  @Roles('owner')
  @Patch('current/settlement-accounts/:accountId/primary')
  setPrimarySettlementAccount(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('accountId') accountId: string,
  ) {
    return this.businesses.setPrimarySettlementAccount(user, businessId, accountId);
  }

  @ApiBearerAuth()
  @Roles('owner')
  @Delete('current/settlement-accounts/:accountId')
  removeSettlementAccount(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('accountId') accountId: string,
  ) {
    return this.businesses.removeSettlementAccount(user, businessId, accountId);
  }

  @ApiBearerAuth()
  @Roles('owner')
  @Patch('current')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Body() dto: UpdateBusinessDto,
  ) {
    return this.businesses.update(user, businessId, dto);
  }

  @ApiBearerAuth()
  @Get('current/onboarding')
  onboarding(@CurrentBusiness() businessId: string) {
    return this.businesses.onboarding(businessId);
  }

  @ApiBearerAuth()
  @Post('current/onboarding/:step')
  markStep(@CurrentBusiness() businessId: string, @Param('step') step: string) {
    return this.businesses.markOnboardingStep(businessId, step);
  }

  @ApiBearerAuth()
  @Get('current/staff')
  @Permissions(PERMISSIONS.STAFF_MANAGE)
  staff(@CurrentBusiness() businessId: string) {
    return this.businesses.staff(businessId);
  }

  @ApiBearerAuth()
  @Roles('owner')
  @Post('current/staff')
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Body() dto: InviteStaffDto,
  ) {
    return this.businesses.inviteStaff(user, businessId, dto);
  }

  @ApiBearerAuth()
  @Roles('owner')
  @Patch('current/staff/:membershipId')
  updateStaff(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.businesses.updateStaff(user, businessId, membershipId, dto);
  }

  @ApiBearerAuth()
  @Roles('owner')
  @Delete('current/staff/:membershipId')
  removeStaff(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('membershipId') membershipId: string,
  ) {
    return this.businesses.removeStaff(user, businessId, membershipId);
  }

  @ApiBearerAuth()
  @Roles('owner')
  @Post('current/custom-domain')
  setDomain(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Body() dto: CustomDomainDto,
  ) {
    return this.businesses.setCustomDomain(user, businessId, dto);
  }

  @ApiBearerAuth()
  @Roles('owner')
  @Post('current/custom-domain/verify')
  verifyDomain(@CurrentBusiness() businessId: string) {
    return this.businesses.verifyCustomDomain(businessId);
  }

  @ApiBearerAuth()
  @Roles('owner')
  @Delete('current/custom-domain')
  removeDomain(@CurrentUser() user: AuthenticatedUser, @CurrentBusiness() businessId: string) {
    return this.businesses.removeCustomDomain(user, businessId);
  }
}
