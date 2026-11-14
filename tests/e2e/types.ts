export type E2ESeed = {
  runId: string;
  admin: { userId: string; qq: string; password: string };
  member: { userId: string; profileId: string; qq: string; password: string };
  activity: { id: string; title: string };
  customer: { name: string; phone: string };
  /** 成员列表分页夹具的姓名前缀，21 条都以此开头。 */
  listPrefix: string;
};
