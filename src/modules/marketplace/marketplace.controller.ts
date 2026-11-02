import { Controller, Get, Param, Patch, Post, Body, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentBusiness, PlatformRoles } from '../../common/decorators/auth.decorators';
import { SkipTenant } from '../../common/decorators/skip-tenant.decorator';
import { MarketplaceService } from './marketplace.service';

class MarketplaceQueryDto {
  @IsOptional() @IsString() campus?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() q?: string;
}

@ApiTags('Campus marketplace')
@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Public()
  @Get('featured')
  featured() {
    return this.marketplace.featuredBusinesses();
  }

  @Get('demo')
  demo() {
    return this.marketplace.featuredBusinesses();
  }

  @Public()
  @Get()
  search(@Query() query: MarketplaceQueryDto) {
    return this.marketplace.search(query);
  }

  @ApiBearerAuth()
  @Get('mine')
  mine(@CurrentBusiness() businessId: string) {
    return this.marketplace.mine(businessId);
  }

  @ApiBearerAuth()
  @Post('request-verification')
  requestVerification(@CurrentBusiness() businessId: string) {
    return this.marketplace.requestVerification(businessId);
  }
}

class VerifyBusinessDto {
  @IsBoolean() verified: boolean;
}

@ApiTags('Campus marketplace admin')
@ApiBearerAuth()
@SkipTenant()
@PlatformRoles('super_admin', 'support')
@Controller('admin/marketplace')
export class MarketplaceAdminController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get('dashboard')
  dashboard() {
    return this.marketplace.adminDashboard();
  }

  @Get('businesses')
  businesses(@Query('campus') campus?: string) {
    return this.marketplace.adminBusinesses(campus);
  }

  @Patch('businesses/:id/verify')
  verify(@Param('id') id: string, @Body() dto: VerifyBusinessDto) {
    return this.marketplace.setVerified(id, dto.verified);
  }
}
