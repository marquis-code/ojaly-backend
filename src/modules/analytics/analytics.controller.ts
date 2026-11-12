import { Body, Controller, Get, Headers, Ip, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentBusiness, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { AnalyticsService } from './analytics.service';
import { StorefrontAnalyticsQueryDto, TrackStorefrontVisitDto } from './analytics.dto';

@ApiTags('Website analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}
  @Get('storefront')
  @Permissions(PERMISSIONS.WEBSITE_MANAGE)
  storefront(@CurrentBusiness() businessId: string, @Query() query: StorefrontAnalyticsQueryDto) {
    return this.analytics.storefront(businessId, query.range);
  }
}

@ApiTags('Public storefront analytics')
@Controller('public/storefront-visits')
export class PublicAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Post(':businessId')
  track(@Param('businessId') businessId: string, @Body() dto: TrackStorefrontVisitDto, @Headers('user-agent') userAgent = '', @Ip() ip = '') {
    return this.analytics.track(businessId, dto, userAgent, ip);
  }
}
