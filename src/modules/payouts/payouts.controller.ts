import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CurrentBusiness, CurrentUser, PlatformRoles } from '../../common/decorators/auth.decorators';
import { SkipTenant } from '../../common/decorators/skip-tenant.decorator';
import { PayoutsService } from './payouts.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';

class RequestWithdrawalDto {
  @IsInt() @Min(10000) amountKobo: number;
  @IsString() @IsOptional() @MaxLength(500) note?: string;
}
class UpdateWithdrawalDto {
  @IsIn(['approved', 'paid', 'rejected']) status: 'approved' | 'paid' | 'rejected';
  @IsString() @IsOptional() @MaxLength(1000) adminNote?: string;
  @IsString() @IsOptional() @MaxLength(120) reference?: string;
}

@ApiTags('Vendor payouts')
@ApiBearerAuth()
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}
  @Get() summary(@CurrentBusiness() businessId: string) { return this.payouts.summary(businessId); }
  @Post('request') request(@CurrentBusiness() businessId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: RequestWithdrawalDto) { return this.payouts.request(businessId, user.id, dto.amountKobo, dto.note); }
}

@ApiTags('Admin withdrawals')
@ApiBearerAuth()
@SkipTenant()
@PlatformRoles('super_admin')
@Controller('admin/withdrawals')
export class AdminPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}
  @Get() list() { return this.payouts.adminList(); }
  @Patch(':id') update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateWithdrawalDto) { return this.payouts.adminUpdate(user.id, id, dto.status, dto.adminNote, dto.reference); }
}
