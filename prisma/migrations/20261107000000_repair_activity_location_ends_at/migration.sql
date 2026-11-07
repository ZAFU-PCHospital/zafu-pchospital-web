-- issue #362：维修活动新增独立「地点」与「结束时间」。
-- 两列都可空：历史活动没有这两项，不回填、不编造；前端缺字段时不渲染该行。
-- 结束时间缺失时的「已结束」判定回退活动日次日 00:00（上海），见 deriveRepairActivityStatus。

ALTER TABLE `repair_activities`
  ADD COLUMN `location` VARCHAR(120) NULL,
  ADD COLUMN `ends_at` DATETIME(3) NULL;
