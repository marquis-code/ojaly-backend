import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CurrentBusiness, CurrentUser, Permissions } from '../../common/decorators/auth.decorators';
import { Public } from '../../common/decorators/public.decorator';
import { PERMISSIONS } from '../../common/constants/permissions';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentLinkDto,
  PublicDebtPaymentDto,
  SubscriptionCheckoutDto,
} from './dto/payment.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';

class PaymentQueryDto {
  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

class PublicInvoicePaymentDto {
  @IsOptional()
  @IsString()
  email?: string;
}

@ApiTags('Payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Get('payments/config')
  config() {
    return this.payments.getPaymentConfig();
  }

  @ApiBearerAuth()
  @Get('payments')
  @Permissions(PERMISSIONS.PAYMENTS_MANAGE)
  list(@CurrentBusiness() businessId: string, @Query() query: PaymentQueryDto) {
    return this.payments.list(businessId, query);
  }

  @ApiBearerAuth()
  @Post('payments/links/order/:orderId')
  @Permissions(PERMISSIONS.PAYMENTS_MANAGE)
  orderLink(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('orderId') orderId: string,
    @Body() dto: CreatePaymentLinkDto,
  ) {
    return this.payments.createOrderLink(user.id, businessId, orderId, dto);
  }

  @ApiBearerAuth()
  @Post('payments/links/debt/:debtId')
  @Permissions(PERMISSIONS.PAYMENTS_MANAGE)
  debtLink(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('debtId') debtId: string,
    @Body() dto: CreatePaymentLinkDto,
  ) {
    return this.payments.createDebtLink(user.id, businessId, debtId, dto);
  }

  @ApiBearerAuth()
  @Post('payments/links/invoice/:invoiceId')
  @Permissions(PERMISSIONS.PAYMENTS_MANAGE)
  invoiceLink(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: CreatePaymentLinkDto,
  ) {
    return this.payments.createInvoiceLink(user.id, businessId, invoiceId, dto);
  }

  @ApiBearerAuth()
  @Post('payments/links/booking/:bookingId')
  @Permissions(PERMISSIONS.PAYMENTS_MANAGE)
  bookingLink(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: CreatePaymentLinkDto,
  ) {
    return this.payments.createBookingDepositLink(user.id, businessId, bookingId, dto);
  }

  @ApiBearerAuth()
  @Post('payments/checkout/subscription')
  @Permissions(PERMISSIONS.SETTINGS_MANAGE)
  subscription(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Body() dto: SubscriptionCheckoutDto,
  ) {
    return this.payments.subscriptionCheckout(user.id, businessId, dto);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get('payments/verify/:reference')
  verify(@Param('reference') reference: string) {
    return this.payments.verifyAndSettle(reference);
  }

  @Public()
  @Get('public/payments/debt/:token')
  publicDebt(@Param('token') token: string) {
    return this.payments.publicDebtContext(token);
  }

  @Public()
  @Post('public/payments/debt/:token')
  publicDebtPay(@Param('token') token: string, @Body() dto: PublicDebtPaymentDto) {
    return this.payments.publicDebtLink(token, dto.email);
  }

  @Public()
  @Post('public/payments/order/:token')
  publicOrderPay(@Param('token') token: string, @Body() dto: PublicInvoicePaymentDto) {
    return this.payments.publicOrderLink(token, dto.email);
  }

  @Public()
  @Post('public/payments/package/:token')
  publicPackagePay(@Param('token') token: string, @Body() dto: PublicInvoicePaymentDto) {
    return this.payments.publicPackagePurchaseLink(token, dto.email);
  }

  @Public()
  @Post('public/payments/booking/:token')
  publicBookingPay(@Param('token') token: string, @Body() dto: PublicInvoicePaymentDto) {
    return this.payments.publicBookingDepositLink(token, dto.email);
  }

  @Public()
  @Post('public/payments/invoice/:token')
  publicInvoicePay(@Param('token') token: string, @Body() dto: PublicInvoicePaymentDto) {
    return this.payments.publicInvoiceLink(token, dto.email);
  }

  @Public()
  @Post('payments/webhook')
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.payments.handleWebhook(req.rawBody, signature, body);
  }
}
