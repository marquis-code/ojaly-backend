import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentBusiness, CurrentUser, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { BookingsService } from './bookings.service';
import { PaymentsService } from '../payments/payments.service';
import { AvailabilityService } from './availability.service';
import {
  AvailabilityQueryDto, BookingMetricsQueryDto, BookingQueryDto, BookingStatusDto, CancelBookingDto,
  CreateBookingDto, CreateRecurringBookingDto, RefundBookingDto, RescheduleBookingDto,
} from './booking.dto';

@ApiTags('Bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly availability: AvailabilityService,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  list(@CurrentBusiness() businessId: string, @Query() query: BookingQueryDto) {
    return this.bookings.list(businessId, query);
  }

  @Get('metrics')
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  metrics(@CurrentBusiness() businessId: string, @Query() query: BookingMetricsQueryDto) {
    return this.bookings.metrics(businessId, query);
  }

  @Get('calendar-feed')
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  calendarFeed(@CurrentBusiness() businessId: string) {
    return this.bookings.calendarFeedLink(businessId);
  }

  @Get('availability')
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  slots(@CurrentBusiness() businessId: string, @Query() query: AvailabilityQueryDto) {
    return this.availability.forService(businessId, query.serviceId, query.date, query.providerId, query.durationMinutes);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  one(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.bookings.findOne(businessId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Body() dto: CreateBookingDto,
  ) {
    return this.bookings.create(user.id, businessId, dto);
  }

  @Post('recurring')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  recurring(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Body() dto: CreateRecurringBookingDto,
  ) {
    return this.bookings.createRecurring(user.id, businessId, dto);
  }

  @Patch(':id/status')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  status(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('id') id: string,
    @Body() dto: BookingStatusDto,
  ) {
    return this.bookings.updateStatus(user.id, businessId, id, dto.status, dto.reason, {
      workerCount: dto.workerCount,
      secondProviderId: dto.secondProviderId,
    });
  }

  @Get(':id/roster')
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  roster(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.bookings.roster(businessId, id);
  }

  @Post(':id/refund')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  refund(
    @CurrentBusiness() businessId: string,
    @Param('id') id: string,
    @Body() dto: RefundBookingDto,
  ) {
    return this.payments.refundBooking(businessId, id, dto.amountKobo);
  }

  @Post(':id/cancel')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.bookings.cancel(user.id, businessId, id, dto);
  }

  @Post(':id/reschedule')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('id') id: string,
    @Body() dto: RescheduleBookingDto,
  ) {
    return this.bookings.reschedule(user.id, businessId, id, dto);
  }
}
