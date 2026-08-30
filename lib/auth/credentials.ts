import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .email("请输入有效的邮箱地址。")
  .max(254);

export const passwordSchema = z
  .string()
  .min(8, "密码至少需要 8 个字符。")
  .max(72, "密码不能超过 72 个字符。");

export const authCredentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export function authErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials"))
    return "邮箱或密码错误。";
  if (normalized.includes("email not confirmed"))
    return "请先打开确认邮件完成邮箱验证。";
  if (normalized.includes("rate limit")) return "请求过于频繁，请稍后再试。";
  if (normalized.includes("password")) return "密码不符合安全要求。";
  return "认证请求失败，请稍后重试。";
}
