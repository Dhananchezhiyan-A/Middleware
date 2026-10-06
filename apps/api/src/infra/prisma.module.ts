import { Global, Module, type OnModuleDestroy } from "@nestjs/common";
import { disconnectPrisma, getPrisma, type Database } from "@middleware/database";

export const PRISMA = "PRISMA";

/**
 * Global Prisma provider. `getPrisma()` validates the connection string
 * (middleware-database safety guard) before the first connection.
 */
@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      useFactory: (): Database => getPrisma(),
    },
    {
      provide: "PrismaDisposer",
      useFactory: () => ({
        onModuleDestroy: async () => disconnectPrisma(),
      }),
    },
  ],
  exports: [PRISMA],
})
export class PrismaModule implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await disconnectPrisma();
  }
}
