/**
 * 密码长度策略（**唯一来源**）。
 *
 * 为什么单独一个文件：这条规则同时被三处使用 —— 表单的原生约束（`minLength`）、
 * 服务端的入参校验、`hashPassword` 自己的兜底。分头写数字的下场是两边不一致，
 * 而实测踩到的是最难受的一种：登录表单上写了 `minLength={12}`，于是一个短口令账号
 * **在前端就被拦住、根本提交不出去**。登录是「校验密码」，不是「设置密码」，
 * 本来就不该套设置密码的规则 —— 所以登录表单现在只保留 `required` 与上限。
 *
 * 6 位下限是产品决定（第十一轮验收时从 12 位下调）：验收 / 本地环境需要一个
 * 能口头传达的短口令。安全上的补偿是登录节流 —— 同一个 QQ + IP 在 15 分钟内
 * 失败 5 次即锁定（见 `AuthService.login` 的 `THROTTLE_*`）。
 */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;

/** 长度是否合规。三处校验都走它，避免各写各的边界。 */
export function isPasswordLengthValid(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

/** 不合规时的统一提示（服务端返回给前端的原话）。 */
export function passwordLengthMessage(): string {
  return `密码长度必须为 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 个字符`;
}
