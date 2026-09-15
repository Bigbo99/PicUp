const messages: Array<[RegExp, string]> = [
  [/invalid email or password/i, '邮箱或密码不正确，请检查后重试。'],
  [/email is already registered/i, '这个邮箱已注册，请使用密码登录。'],
  [/invalid email or account is not active|user is disabled|user is not active/i, '此账户暂时无法登录，请联系管理员。'],
  [/verification code is invalid or expired/i, '验证码不正确或已过期，请检查验证码，或重新获取。'],
  [/too many verification attempts/i, '验证码尝试次数过多，请重新获取验证码。'],
  [/password.*(?:8|eight)|password must be longer/i, '密码至少需要 8 个字符，请补充后重试。'],
  [/email must be an email/i, '邮箱格式不正确，请填写完整的邮箱地址。'],
  [/authentication required|unauthorized|jwt expired/i, '登录已失效，请重新登录后继续。'],
  [/email delivery/i, '验证码暂时发送失败，请稍后重试，或使用微信登录。'],
  [/wechat login session is invalid or expired/i, '二维码已过期，请重新获取后扫码。'],
  [/wechat|wxmid/i, '微信登录暂时不可用，请稍后重试，或使用密码登录。'],
  [/not a supported image|only jpg|unsupported.*image|无法识别图片内容/i, '无法识别这张图片，请将原图导出为 JPG、PNG 或 WebP 后重新上传。'],
  [/image cannot exceed|file too large|payload too large/i, '图片超过大小限制，请压缩至 10MB 以内后上传。'],
  [/please choose an image/i, '请先选择一张图片。'],
  [/image upload failed/i, '图片上传失败，请检查网络后重新上传。'],
  [/image not found/i, '这张图片已不可用，请重新上传或选择其他图片。'],
  [/failed to fetch|networkerror|network request failed|load failed/i, '网络连接中断，请检查网络后重试。'],
  [/timeout|timed out/i, '处理时间较长，请稍后重试。'],
  [/insufficient.*credit/i, '积分不足，请充值或选择单次付费。'],
  [/rate limit|too many requests/i, '操作有些频繁，请稍等片刻再试。'],
  [/content policy|moderation|safety.*blocked/i, '这次内容未能通过审核，请调整描述或更换参考图后重试。'],
  [/provider_unavailable|provider.*unavailable|output download failed|grsai output download failed/i, '图片服务返回结果时暂时不可用，任务已结束并退回积分，请稍后重试。']
];

export function userMessage(value: unknown, status?: number): string {
  const raw = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  for (const [pattern, message] of messages) if (pattern.test(raw)) return message;
  if (status === 401) return '登录已失效，请重新登录后继续。';
  if (status === 403) return '当前账户无法执行此操作，请检查账户状态。';
  if (status === 404) return '内容暂时无法找到，请刷新后重试。';
  if (status === 413) return '文件过大，请压缩后重新上传。';
  if (status === 429) return '操作有些频繁，请稍等片刻再试。';
  if (status && status >= 500) return '服务暂时繁忙，请稍后重试。';
  // Preserve concise product copy, but never expose server HTML or diagnostic output.
  if (/[\u4e00-\u9fff]/.test(raw) && raw.length <= 240 && !/<[^>]+>|stack|exception|SQL|prisma|https?:\/\//i.test(raw)) return raw;
  return '暂时无法完成此操作，请稍后重试。';
}

export function fieldValidationMessage(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  if (field.validity.valueMissing) return field instanceof HTMLInputElement && field.type === 'checkbox' ? '请先阅读并同意后继续。' : '请填写此项后继续。';
  if (field.validity.typeMismatch && field instanceof HTMLInputElement && field.type === 'email') return '请填写完整的邮箱地址，例如 name@example.com。';
  if (field.validity.tooShort && 'minLength' in field) return `请至少输入 ${field.minLength} 个字符。`;
  if (field.validity.rangeUnderflow || field.validity.rangeOverflow) return '请填写允许范围内的数值。';
  if (field.validity.patternMismatch) return '填写格式不正确，请检查后重试。';
  return '请检查此项内容后重试。';
}
