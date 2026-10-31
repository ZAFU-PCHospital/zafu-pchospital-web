import { unstable_noStore as noStore } from "next/cache";

import {
  ActivityTicketCard,
  type ActivityTicketCopy,
} from "@/components/repair-activities/ActivityTicketCard";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionHead } from "@/components/ui/SectionHead";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { homeActivityPreview } from "@/config/home";
import {
  repairActivityService,
  type RepairActivityPublicView,
} from "@/features/repair-activities/repair-activity-service";

const copy = homeActivityPreview;

const TICKET_COPY: ActivityTicketCopy = {
  activityAt: copy.activityAt,
  capacity: copy.capacity,
  remainingShort: copy.remainingShort,
  endedHint: copy.endedHint,
  detailCta: copy.detailCta,
};

/**
 * 首页近场活动预览（UX R3 / R7，issue #317）
 *
 * 优先取未结束活动（报名开放中优先，其次 UPCOMING / FULL / CLOSED），
 * 没有未结束活动时展示最近 3 场已结束活动。已结束卡与公开列表一致，
 * 详情接口对已结束活动不可用，因此不提供详情入口。两类活动都没有时整块不渲染。
 */
export async function HomeActivityPreview() {
  noStore();
  let items: RepairActivityPublicView[] = [];
  try {
    items = await repairActivityService.listPublicForHomePreview(3);
    if (items.length === 0) {
      items = await repairActivityService.listPublicEndedForHomePreview(3);
    }
  } catch {
    return null;
  }
  if (items.length === 0) return null;

  return (
    <Section id="upcoming-activities" labelledBy="home-activities-title">
      <SectionHead index={copy.index} label={copy.label} />
      <div className="sec-titlebar">
        <SectionTitle id="home-activities-title">{copy.title}</SectionTitle>
        <Reveal className="ml-auto" index={1}>
          <Button href={copy.viewAllHref} trailingIcon="chevronRight">
            {copy.viewAll}
          </Button>
        </Reveal>
      </div>

      <ul className="activity-list activity-list--home-preview activity-list--ticket">
        {items.map((item, i) => (
          <Reveal as="li" index={i} key={item.id}>
            <ActivityTicketCard activity={item} copy={TICKET_COPY} showDetailCta />
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}
