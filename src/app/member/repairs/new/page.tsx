import type { Metadata } from "next";
import { MemberPageHead } from "@/components/member/MemberPageHead";
import { CreateRepairForm } from "@/components/repairs/CreateRepairForm";
import { Section } from "@/components/ui/Section";
import { repairCopy } from "@/config/repairs";
import { uploadLimits } from "@/features/repairs/repair-photo-storage";
import { requireActiveMemberPage } from "@/lib/auth/member-page";
export const metadata: Metadata = { title: "新建维修记录" };
export default async function NewRepairPage({
  searchParams,
}: {
  searchParams: Promise<{ activityId?: string; registrationId?: string }>;
}) {
  await requireActiveMemberPage();
  const params = await searchParams;
  // 活动接待「继续填写」：两个参数成对出现才进入补单模式。
  const serveContext =
    params.activityId && params.registrationId
      ? { activityId: params.activityId, registrationId: params.registrationId }
      : undefined;
  return (
    <div className="repair-page">
      <Section variant="page-head" labelledBy="new-repair-title">
        <MemberPageHead
          id="new-repair-title"
          label={repairCopy.create.label}
          title={serveContext ? repairCopy.create.serveTitle : repairCopy.create.title}
        />
      </Section>
      <Section labelledBy="new-repair-panel">
        <h2 className="sr-only" id="new-repair-panel">
          维修记录表单
        </h2>
        <CreateRepairForm serveContext={serveContext} photoLimits={uploadLimits()} />
      </Section>
    </div>
  );
}
