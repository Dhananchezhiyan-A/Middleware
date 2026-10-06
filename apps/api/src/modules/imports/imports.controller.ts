import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { errors } from "@middleware/shared";
import type { RequestActor } from "@middleware/types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import { SkipTransform } from "../../common/interceptors/response-transform.interceptor";
import { ImportListQueryDto, importUploadSchema, type UploadedCsvFile } from "./imports.dtos";
import { ImportsService } from "./imports.service";

/**
 * NOTE on storage: multer 2.x keeps uploads IN MEMORY when neither `dest` nor
 * `storage` is set (its default is `memoryStorage()`). It cannot be imported
 * directly here — multer is only a transitive dependency of
 * @nestjs/platform-express and pnpm's isolated node_modules would make a
 * runtime `require("multer")` fail.
 */
@ApiTags("imports")
@Controller("imports")
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post()
  @RequirePermission("imports:write")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 50 * 1024 * 1024 } }))
  @ApiOperation({ summary: "Upload a CSV file and queue it for import" })
  async upload(
    @CurrentUser() actor: RequestActor,
    @UploadedFile() file: UploadedCsvFile | undefined,
    @Body() body: Record<string, unknown> | undefined,
  ) {
    // Multipart text fields are not piped through DTOs — parse manually.
    const parsed = importUploadSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw errors.validation(
        "Invalid multipart body.",
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    return this.imports.createImport(actor, file, parsed.data.sourceId);
  }

  @Get()
  @RequirePermission("imports:read")
  @ApiOperation({ summary: "List import jobs (cursor paginated)" })
  async list(@CurrentUser() actor: RequestActor, @Query() query: ImportListQueryDto) {
    return this.imports.listImports(actor, query);
  }

  @Get(":id")
  @RequirePermission("imports:read")
  @ApiOperation({ summary: "Get a single import job (full row)" })
  async get(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.imports.getImport(actor, id);
  }

  @Get(":id/errors")
  @RequirePermission("imports:read")
  @SkipTransform()
  @Header("content-type", "text/csv; charset=utf-8")
  @ApiOperation({ summary: "Download the CSV error report for an import job" })
  async downloadErrors(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.imports.downloadErrors(actor, id);
  }
}
