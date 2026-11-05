import type { Metadata } from "next";

import { MemberRepairActivityBoard } from "@/components/repair-activities/MemberRepairActivityBoard";
import { Section } from "@/components/ui/Section";
import { memberRepairActivitiesCopy } from "@/config/repair-activities";
import { requireActiveMemberPage } from "@/lib/auth/member-page";

export const metadata: Metadata = { title: memberRepairActivitiesCopy.board.title };

export default async function MemberRepairActivityBoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireActiveMemberPage();
  const { id } = await params;
  return (
    <Section
      variant="page-head"
      className="member-workspace member-activity-workspace member-activity-board-workspace"
      labelledBy="member-activity-board-title"
    >
      <MemberRepairActivityBoard activityId={id} />
    </Section>
  );
}
