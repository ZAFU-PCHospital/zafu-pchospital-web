import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionHead } from "@/components/ui/SectionHead";
import { SectionTitle } from "@/components/ui/SectionTitle";

/**
 * PageHead —— 内页页面头
 *
 * 内页（/about、/join、/tools）共用同一套头部：章节头 + H1 + 引导语。
 * 结构来自首页的 `.sec-head` + `.sec-title` + `.lead`，不引入新的视觉语言。
 */

export type PageHeadProps = {
  /** 标题元素 id，同时用于 aria-labelledby */
  id: string;
  /** 两位编号，与导航配置中的序号保持一致 */
  index: string;
  /** 英文标签 */
  label: string;
  title: string;
  lead?: string;
};

export function PageHead({ id, index, label, title, lead }: PageHeadProps) {
  return (
    <Section variant="page-head" labelledBy={id}>
      <SectionHead index={index} label={label} />
      <SectionTitle id={id} as="h1" index={1}>
        {title}
      </SectionTitle>
      {lead ? (
        <Reveal as="p" className="lead" index={2}>
          {lead}
        </Reveal>
      ) : null}
    </Section>
  );
}
