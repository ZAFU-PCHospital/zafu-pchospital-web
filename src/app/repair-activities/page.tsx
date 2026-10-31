import type { Metadata } from "next";

import { RepairActivityList } from "@/components/repair-activities/RepairActivityList";
import { RepairActivityPreparation } from "@/components/repair-activities/RepairActivityPreparation";
import { PageHead } from "@/components/layout/PageHead";
import { Section } from "@/components/ui/Section";
import { SectionHead } from "@/components/ui/SectionHead";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { repairActivitiesPage } from "@/config/repair-activities";

export const metadata: Metadata = {
  title: repairActivitiesPage.title,
  description: repairActivitiesPage.lead,
};

export default function RepairActivitiesPage() {
  return (
    <div className="repair-page">
      <PageHead
        id="repair-activities-page-title"
        index="02"
        label={repairActivitiesPage.label}
        title={repairActivitiesPage.title}
        lead={repairActivitiesPage.lead}
      />
      <Section labelledBy="repair-activities-page-title">
        <RepairActivityList />
      </Section>
      <Section
        id="preparation"
        className="repair-preparation"
        labelledBy="repair-preparation-title"
      >
        <SectionHead
          index={repairActivitiesPage.preparationSection.index}
          label={repairActivitiesPage.preparationSection.label}
        />
        <div className="sec-titlebar">
          <SectionTitle id="repair-preparation-title">
            {repairActivitiesPage.detail.precautionsTitle}
          </SectionTitle>
        </div>
        <RepairActivityPreparation layout="grid" />
        <p className="sec-note">{repairActivitiesPage.detail.serviceHint}</p>
      </Section>
    </div>
  );
}
