import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Product, ProductSchema } from '../products/product.schema';
import { Service, ServiceSchema } from '../services/service.schema';
import { Membership, MembershipSchema } from '../memberships/membership.schema';
import { User, UserSchema } from '../users/user.schema';
import { MailModule } from '../mail/mail.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { StorefrontConversation, StorefrontConversationSchema, StorefrontChatMessage, StorefrontChatMessageSchema } from './storefront-chat.schema';
import { PublicStorefrontChatController, StorefrontChatController } from './storefront-chat.controller';
import { StorefrontChatService } from './storefront-chat.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StorefrontConversation.name, schema: StorefrontConversationSchema },
      { name: StorefrontChatMessage.name, schema: StorefrontChatMessageSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: User.name, schema: UserSchema },
    ]),
    MailModule,
    WhatsappModule,
  ],
  controllers: [StorefrontChatController, PublicStorefrontChatController],
  providers: [StorefrontChatService],
})
export class StorefrontChatModule {}
