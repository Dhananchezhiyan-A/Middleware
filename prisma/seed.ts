import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@middleware/database";
import { ROLE_TEMPLATES, SYSTEM_ROLES } from "@middleware/types";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/middleware",
    max: 10,
  }),
});

const DEMO_EMAIL = "owner@demo.dev";
const DEMO_PASSWORD = "Str0ngP@ssw0rd!2026";
const DEMO_TENANT_SLUG = "demo";

async function ensureRole(name: keyof typeof ROLE_TEMPLATES) {
  const template = ROLE_TEMPLATES[name];

  return prisma.role.upsert({
    where: { name },
    update: {
      description: template.description,
      permissions: template.permissions,
      isSystem: true,
    },
    create: {
      name,
      description: template.description,
      permissions: template.permissions,
      isSystem: true,
    },
  });
}

async function main(): Promise<void> {
  await prisma.tenant.upsert({
    where: { slug: DEMO_TENANT_SLUG },
    update: { name: "Demo Workspace" },
    create: {
      name: "Demo Workspace",
      slug: DEMO_TENANT_SLUG,
    },
  });

  const adminRole = await ensureRole(SYSTEM_ROLES.ADMIN);
  await ensureRole(SYSTEM_ROLES.MANAGER);
  await ensureRole(SYSTEM_ROLES.DEVELOPER);
  await ensureRole(SYSTEM_ROLES.VIEWER);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {
      name: "Owner",
      passwordHash,
      roleId: adminRole.id,
      status: "ACTIVE",
    },
    create: {
      email: DEMO_EMAIL,
      name: "Owner",
      passwordHash,
      roleId: adminRole.id,
      status: "ACTIVE",
    },
  });

  console.log(`Seeded demo tenant, system roles, and user ${user.email}.`);
  console.log(`Login with: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
