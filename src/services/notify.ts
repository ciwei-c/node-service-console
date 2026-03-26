/**
 * 通知告警服务
 *
 * 支持两种渠道：
 *   1. Webhook — 向任意 URL 发送 JSON POST 请求（可对接飞书、企业微信、Slack 等）
 *   2. Telegram Bot — 通过 Bot API 发送消息
 *
 * 防抖：同一服务同一事件在 5 分钟内只发送一次，避免重复告警。
 */
import { readLocalSettings, writeLocalSettings } from '../store';
import type { NotifyConfig, NotifyChannel } from '../types';

/* ═══════════════════════════════════════════
   配置读写
   ═══════════════════════════════════════════ */

const defaultConfig: NotifyConfig = {
  enabled: false,
  channels: [],
  events: {
    containerCrash: true,
    publishFail: true,
    publishSuccess: false,
  },
};

export function getNotifyConfig(): NotifyConfig {
  const settings = readLocalSettings();
  return settings.notify || { ...defaultConfig };
}

export function saveNotifyConfig(config: NotifyConfig): void {
  const settings = readLocalSettings();
  settings.notify = config;
  writeLocalSettings(settings);
}

/* ═══════════════════════════════════════════
   防抖（同一 key 在 interval 内只触发一次）
   ═══════════════════════════════════════════ */

const recentAlerts = new Map<string, number>();
const DEBOUNCE_MS = 5 * 60 * 1000; // 5 分钟

function shouldThrottle(key: string): boolean {
  const now = Date.now();
  const last = recentAlerts.get(key);
  if (last && now - last < DEBOUNCE_MS) return true;
  recentAlerts.set(key, now);
  // 定期清理过期记录
  if (recentAlerts.size > 200) {
    for (const [k, t] of recentAlerts) {
      if (now - t > DEBOUNCE_MS) recentAlerts.delete(k);
    }
  }
  return false;
}

/* ═══════════════════════════════════════════
   发送逻辑
   ═══════════════════════════════════════════ */

interface AlertPayload {
  event: 'container_crash' | 'publish_fail' | 'publish_success';
  title: string;
  message: string;
  service: string;
  timestamp: string;
}

async function sendWebhook(channel: NotifyChannel, payload: AlertPayload): Promise<void> {
  if (!channel.webhookUrl) return;
  try {
    await fetch(channel.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 通用格式（兼容大多数 Webhook 接收端）
        text: `${payload.title}\n${payload.message}`,
        // 结构化字段
        ...payload,
      }),
    });
  } catch (err: any) {
    console.error(`[notify] Webhook(${channel.name}) 发送失败:`, err.message);
  }
}

async function sendTelegram(channel: NotifyChannel, payload: AlertPayload): Promise<void> {
  if (!channel.telegramBotToken || !channel.telegramChatId) return;
  const text = `🔔 *${escapeMarkdown(payload.title)}*\n\n${escapeMarkdown(payload.message)}\n\n🕐 ${payload.timestamp}`;
  try {
    await fetch(`https://api.telegram.org/bot${channel.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: channel.telegramChatId,
        text,
        parse_mode: 'MarkdownV2',
      }),
    });
  } catch (err: any) {
    console.error(`[notify] Telegram(${channel.name}) 发送失败:`, err.message);
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function sendToChannel(channel: NotifyChannel, payload: AlertPayload): Promise<boolean> {
  try {
    if (channel.type === 'webhook') {
      await sendWebhook(channel, payload);
    } else if (channel.type === 'telegram') {
      await sendTelegram(channel, payload);
    }
    return true;
  } catch {
    return false;
  }
}

/* ═══════════════════════════════════════════
   对外接口
   ═══════════════════════════════════════════ */

/**
 * 发送告警（内部自动检查配置和防抖）
 */
export async function sendAlert(
  event: AlertPayload['event'],
  serviceName: string,
  detail: string,
): Promise<void> {
  const config = getNotifyConfig();
  if (!config.enabled) return;

  // 检查事件是否启用
  const eventMap: Record<string, keyof NotifyConfig['events']> = {
    container_crash: 'containerCrash',
    publish_fail: 'publishFail',
    publish_success: 'publishSuccess',
  };
  const eventKey = eventMap[event];
  if (!eventKey || !config.events[eventKey]) return;

  // 防抖
  const throttleKey = `${event}:${serviceName}`;
  if (shouldThrottle(throttleKey)) {
    console.log(`[notify] 告警被防抖跳过: ${throttleKey}`);
    return;
  }

  const titleMap: Record<string, string> = {
    container_crash: `⚠️ 容器崩溃: ${serviceName}`,
    publish_fail: `❌ 发布失败: ${serviceName}`,
    publish_success: `✅ 发布成功: ${serviceName}`,
  };

  const payload: AlertPayload = {
    event,
    title: titleMap[event] || event,
    message: detail,
    service: serviceName,
    timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
  };

  const enabledChannels = config.channels.filter((c) => c.enabled);
  if (enabledChannels.length === 0) return;

  console.log(`[notify] 发送告警: ${payload.title} → ${enabledChannels.length} 个渠道`);

  await Promise.allSettled(
    enabledChannels.map((ch) => sendToChannel(ch, payload)),
  );
}

/**
 * 测试指定渠道是否可用
 */
export async function testChannel(channel: NotifyChannel): Promise<{ ok: boolean; error?: string }> {
  const payload: AlertPayload = {
    event: 'publish_success',
    title: '🔔 测试通知',
    message: '这是一条来自 Node Service Console 的测试通知，如果你看到了说明配置正确！',
    service: 'test',
    timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
  };
  try {
    await sendToChannel(channel, payload);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
