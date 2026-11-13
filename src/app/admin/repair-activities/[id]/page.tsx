import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RepairActivityWorkspace } from "@/components/admin/RepairActivityWorkspace";
import { Section } from "@/components/ui/Section";
import { adminCopy } from "@/config/admin";
import { repairActivityService } from "@/features/repair-activities/repair-activity-service";
import { requireActivityPage } from "@/lib/auth/activity-page";
import { AppError } from "@/lib/api/errors";

export const metadata: Metadata = { title: adminCopy.activityWorkspace.title };

export default async function ActivityObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requireActivityPage();
  const { id } = await params;
  const activity = await repairActivityService
    .getWorkspace(id, {
      actorType: "USER",
      userId: principal.userId,
      userStatus: "ACTIVE",
      permissions: principal.permissions,
      requestId: crypto.randomUUID(),
    })
    .catch((error: unknown) => {
      if (error instanceof AppError && error.code === "ACTIVITY_NOT_FOUND") notFound();
      throw error;
    });
  return (
    <Section
      variant="page-head"
      className="admin-workspace admin-activity-workspace"
      labelledBy="activity-object-title"
    >
      <RepairActivityWorkspace
        key={activity.id}
        activity={activity}
        canAdmin={principal.permissions.includes("activity:admin")}
      />
    </Section>
  );
}
