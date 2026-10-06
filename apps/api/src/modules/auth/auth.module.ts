import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { getEnv } from "@middleware/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

const env = getEnv();

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { issuer: env.JWT_ISSUER },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
