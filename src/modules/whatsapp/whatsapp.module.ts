import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappSettingsController } from './whatsapp-settings.controller';
import { PasteChatController } from './paste-chat.controller';
import { BotService } from './bot.service';
import { ChatParserService } from './chat-parser.service';
import { WhatsappClientService } from './whatsapp-client.service';
import { LlmParserService } from './llm-parser.service';
import { WhatsappOtp, WhatsappOtpSchema } from './whatsapp-otp.schema';
import { WhatsappContact, WhatsappContactSchema } from './whatsapp-contact.schema';
import { WhatsappMessage, WhatsappMessageSchema } from './whatsapp-message.schema';
import { Product, ProductSchema } from '../products/product.schema';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Membership, MembershipSchema } from '../memberships/membership.schema';
import { Booking, BookingSchema } from '../bookings/booking.schema';
import { SalesModule } from '../sales/sales.module';
import { DebtsModule } from '../debts/debts.module';
import { ProductsModule } from '../products/products.module';
import { StockModule } from '../stock/stock.module';
import { SummariesModule } from '../summaries/summaries.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { OrdersModule } from '../orders/orders.module';
import { ExpensesModule } from '../expenses/expenses.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WhatsappOtp.name, schema: WhatsappOtpSchema },
      { name: WhatsappContact.name, schema: WhatsappContactSchema },
      { name: WhatsappMessage.name, schema: WhatsappMessageSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
    SalesModule,
    DebtsModule,
    ProductsModule,
    StockModule,
    SummariesModule,
    ReceiptsModule,
    OrdersModule,
    ExpensesModule,
  ],
  controllers: [WhatsappWebhookController, WhatsappSettingsController, PasteChatController],
  providers: [BotService, ChatParserService, LlmParserService],
  exports: [ChatParserService],
})
export class WhatsappModule {}
