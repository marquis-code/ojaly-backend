import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentBusiness, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { StorefrontService } from './storefront.service';
import { StorefrontContactDto, StorefrontOrderDto, StorefrontProductQueryDto } from './dto/storefront.dto';
import { AvailabilityQueryDto, CreatePublicBookingDto } from '../bookings/booking.dto';
import { CreateWaitlistDto } from '../waitlist/waitlist.dto';
import { PackageCheckoutDto } from '../packages/package.dto';

@ApiTags('Storefront')
@Public()
@Controller('storefront')
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get('domain/:domain')
  byDomain(@Param('domain') domain: string) {
    return this.storefront.byDomain(domain);
  }

  @Public()
  @Get('sitemap')
  sitemap() {
    return this.storefront.sitemap();
  }

  @Get(':slug')
  home(@Param('slug') slug: string) {
    return this.storefront.home(slug);
  }

  @Get(':slug/products')
  products(@Param('slug') slug: string, @Query() query: StorefrontProductQueryDto) {
    return this.storefront.productsList(slug, query);
  }

  @Get(':slug/products/:id')
  product(@Param('slug') slug: string, @Param('id') id: string) {
    return this.storefront.product(slug, id);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post(':slug/orders')
  order(@Param('slug') slug: string, @Body() dto: StorefrontOrderDto) {
    return this.storefront.placeOrder(slug, dto);
  }

  @Get(':slug/services')
  services(@Param('slug') slug: string) {
    return this.storefront.servicesList(slug);
  }

  @Get(':slug/services/:id')
  service(@Param('slug') slug: string, @Param('id') id: string) {
    return this.storefront.serviceDetail(slug, id);
  }

  @Get(':slug/availability')
  availability(@Param('slug') slug: string, @Query() query: AvailabilityQueryDto) {
    return this.storefront.availabilityForService(slug, query);
  }

  @Get(':slug/packages')
  packages(@Param('slug') slug: string) {
    return this.storefront.packagesList(slug);
  }

  @Post(':slug/packages/:id/checkout')
  packageCheckout(@Param('slug') slug: string, @Param('id') id: string, @Body() dto: PackageCheckoutDto) {
    return this.storefront.packageCheckout(slug, id, dto);
  }

  @Post(':slug/waitlist')
  waitlist(@Param('slug') slug: string, @Body() dto: CreateWaitlistDto) {
    return this.storefront.joinWaitlist(slug, dto);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post(':slug/bookings')
  booking(@Param('slug') slug: string, @Body() dto: CreatePublicBookingDto) {
    return this.storefront.placeBooking(slug, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':slug/contact')
  contact(@Param('slug') slug: string, @Body() dto: StorefrontContactDto) {
    return this.storefront.contact(slug, dto);
  }
}

@ApiTags('Storefront')
@Controller('storefront-messages')
export class StorefrontInboxController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get()
  @Permissions(PERMISSIONS.WEBSITE_MANAGE)
  list(@CurrentBusiness() businessId: string) {
    return this.storefront.messages(businessId);
  }
}
