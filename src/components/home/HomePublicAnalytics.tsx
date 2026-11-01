import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { homePublicAnalytics as copy } from "@/config/home";
import { formatRepairDurationHours, homeYearLabel } from "@/lib/home-analytics";
import type { PublicHomeAnalytics } from "@/types/contracts";

type Metric = { label: string; value: string; unit?: string };

/** 首屏后的独立区块；只接收已按公开策略裁剪的 DTO。 */
export function HomePublicAnalytics({ data }: { data: PublicHomeAnalytics }) {
  if (!data.repairStats && !data.rankings) return null;
  const metrics: Metric[] = [];
  if (data.repairStats) {
    metrics.push({
      label: copy.total,
      value: data.repairStats.totalApprovedCount.toLocaleString("zh-CN"),
      unit: copy.countUnit,
    });
    if (data.repairStats.details) {
      const { yearApprovedCount, totalApprovedDurationMinutes } = data.repairStats.details;
      metrics.push(
        {
          label: homeYearLabel(copy.year, data),
          value: yearApprovedCount.toLocaleString("zh-CN"),
          unit: copy.countUnit,
        },
        {
          label: copy.duration,
          value: formatRepairDurationHours(totalApprovedDurationMinutes),
          unit: copy.durationUnit,
        },
      );
    }
  }
  const rankingMessage = data.rankings?.items.length === 0 ? copy.rankingEmpty : undefined;

  return (
    <Section id="public-statistics" labelledBy="home-statistics-title" className="home-analytics">
      <Reveal as="header" className="sec-head">
        <span className="sec-head__en">{copy.label}</span>
        <span className="sec-head__rule" aria-hidden="true" />
      </Reveal>
      <SectionTitle id="home-statistics-title">{copy.title}</SectionTitle>
      {data.repairStats ? (
        <dl className="home-analytics__metrics" aria-label={copy.statsTitle}>
          {metrics.map((metric) => (
            <div className="home-analytics__metric" key={metric.label}>
              <dt>{metric.label}</dt>
              <dd>
                <span>{metric.value}</span>
                {metric.unit ? (
                  <>
                    {" "}
                    <span className="home-analytics__unit">{metric.unit}</span>
                  </>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {data.rankings ? (
        <table className="home-analytics__table">
          <caption>
            <div className="home-analytics__caption">
              <h3>{homeYearLabel(copy.rankingTitle, data)}</h3>
              <span className="home-analytics__tag">{copy.rankingTag}</span>
            </div>
          </caption>
          <thead>
            <tr>
              <th scope="col">{copy.rankColumn}</th>
              <th scope="col">{copy.memberColumn}</th>
              <th scope="col">{copy.countColumn}</th>
            </tr>
          </thead>
          <tbody>
            {rankingMessage ? (
              <tr>
                <td colSpan={3} className="home-analytics__empty">
                  {rankingMessage}
                </td>
              </tr>
            ) : (
              data.rankings.items.map((item, index) => (
                <tr key={index}>
                  <td className={item.rank === 1 ? "is-accent" : undefined}>
                    <span aria-label={copy.rankLabel.replace("{rank}", String(item.rank))}>
                      {String(item.rank).padStart(2, "0")}
                    </span>
                  </td>
                  <th scope="row">{item.displayName}</th>
                  <td>
                    {item.approvedCount.toLocaleString("zh-CN")} {copy.rankingUnit}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      ) : null}
      <p className="home-analytics__note">
        {homeYearLabel(data.repairStats ? copy.note : copy.rankingNote, data)}
      </p>
    </Section>
  );
}
