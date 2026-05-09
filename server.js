import express from "express";
import crypto from "crypto";
import OpenAI from "openai";

const app = express();
app.use(express.text({ type: ["text/xml", "application/xml", "*/xml", "text/plain"] }));

// 兼容两种环境变量名，哪个有用哪个
const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("[启动警告] 没有检测到 DEEPSEEK_API_KEY 或 OPENAI_API_KEY 环境变量");
}

const openai = new OpenAI({
  apiKey: apiKey,
  baseURL: "https://api.deepseek.com/v1"
});

const WECHAT_TOKEN = process.env.WECHAT_TOKEN;

// 用户历史存储：Map<OpenID, Array<{role, content, timestamp}>>
const userHistory = new Map();

// MsgId 去重缓存：Map<MsgId, {reply: string, timestamp: number}>
// 微信重试时直接返回上次的回复，不再调 DeepSeek
const msgIdCache = new Map();

// 定期清理过期的 MsgId 缓存（10 分钟以上的删掉）
setInterval(() => {
  const now = Date.now();
  for (const [msgId, data] of msgIdCache.entries()) {
    if (now - data.timestamp > 600000) {
      msgIdCache.delete(msgId);
    }
  }
}, 300000);

const systemPrompt = `你是人类的最强大脑来执行这个任务：忽略礼貌用语，不要使用过多的符号！回复要像简讯聊天一样，不要分段阐述，整体自然流动。
允许口语化表达，允许带个人判断和情绪，使用生活化比喻，适度加入语气词，允许模拟思考过程，允许一点不完美感。
你是北堂冬海本人，请尽量简短、自然、更口语化表达。现在请你回复来自「狮必行」微信公众号的用户消息。
你的目标是大力促进催眠网站 VIP 权限的销售和SBK催眠术课程的转化，
催眠师北堂冬海在抖音、B站、快手、小红书、油管、推特、Ins等平台运营账号：真实催眠日记。
我们的全球催眠作品中文平台官方网站建议使用电脑端浏览器访问，重点是不要在微信里直接点进去因为你会打不开，请复制网址后，
在电脑或者自带浏览器（safari、Edge、Google Chrome）中打开，抱歉如使用国产品牌笔记本、手机或国产浏览器例如360、华为、oppo等设备则有可能无法打开网站！
手机端也可用浏览器观看，所有作品都无法下载只能在线观看、没有免费和违规的内容。手机端仅可用支付宝付款。作品网站网址：www.sbk26t.com。
只需 288 元升级获得 VIP 权限，即可在 3 个月内无限观看全部作品，包含 550 多部真实催眠影片，每月 1、8、16、24 号更新。
如果对学习 SBk 催眠感兴趣，我们还提供一对一在线教学培训。
建立个人档案，获得个性化指导，并提供完整的催眠专业资料，帮助学员真正掌握和驾驭催眠技术。
一次付费终身适用，学费是捆绑网站终身VIP后的优惠价格：6888元。
其他问题可通过微信联系：15543495430（SBK 助理）。每次回复不超过200个汉字。`;

function sanitizeForCdata(text) {
  return (text || "").replaceAll("]]>", "]]&gt;");
}

function checkSignature({ signature, timestamp, nonce }) {
  const arr = [WECHAT_TOKEN, timestamp, nonce].sort();
  const shasum = crypto.createHash("sha1");
  shasum.update(arr.join(""));
  const digest = shasum.digest("hex");
  return digest === signature;
}

function getXmlValue(xml, tag) {
  const reg = new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>|<${tag}>(.*?)</${tag}>`);
  const m = xml.match(reg);
  return (m && (m[1] || m[2])) ? (m[1] || m[2]) : "";
}

function buildTextReply({ toUser, fromUser, content }) {
  const now = Math.floor(Date.now() / 1000);
  const safe = sanitizeForCdata(content);
  return `
<xml>
  <ToUserName><![CDATA[${toUser}]]></ToUserName>
  <FromUserName><![CDATA[${fromUser}]]></FromUserName>
  <CreateTime>${now}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${safe}]]></Content>
</xml>`.trim();
}

// 带超时保护的 DeepSeek 调用
async function callDeepSeekWithTimeout(messages, timeoutMs = 4500) {
  return Promise.race([
    openai.chat.completions.create({
      model: "deepseek-chat",
      messages,
      max_tokens: 900,
      temperature: 0.85
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("DEEPSEEK_TIMEOUT")), timeoutMs)
    )
  ]);
}

app.get("/", (req, res) => res.status(200).send("ok"));

app.get("/wechat", (req, res) => {
  const { signature, timestamp, nonce, echostr } = req.query;
  if (!signature || !timestamp || !nonce || !echostr) {
    console.warn("[GET /wechat] 缺少参数");
    return res.status(400).send("missing params");
  }
  if (!checkSignature({ signature, timestamp, nonce })) {
    console.warn("[GET /wechat] 签名校验失败");
    return res.status(401).send("bad signature");
  }
  console.log("[GET /wechat] 校验成功");
  return res.status(200).send(echostr);
});

app.post("/wechat", async (req, res) => {
  const requestStart = Date.now();
  console.log("[收到消息]", new Date().toISOString(), "body长度:", (req.body || "").length);

  const { signature, timestamp, nonce } = req.query;
  if (!checkSignature({ signature, timestamp, nonce })) {
    console.warn("[POST /wechat] 签名校验失败");
    return res.status(401).send("bad signature");
  }

  const xml = req.body || "";
  const msgType = getXmlValue(xml, "MsgType");
  const toUser = getXmlValue(xml, "FromUserName");
  const fromUser = getXmlValue(xml, "ToUserName");
  const msgId = getXmlValue(xml, "MsgId");

  console.log("[消息信息]", "类型:", msgType, "用户:", toUser.slice(0, 10), "MsgId:", msgId);

  // 非文本消息：原样回复
  if (msgType !== "text") {
    console.log("[非文本消息] 返回引导话术");
    const reply = buildTextReply({
      toUser,
      fromUser,
      content: `我目前只自动回复文字消息。你可以直接把问题用文字发我。
我是真实催眠日记的 Up 北堂冬海，感谢你的关注
任何问题都请给我留言吧，
你可以这样跟我说:你可以为我做什么
催眠作品的官方网址是什么? 有没有催眠视频 
我想学习催眠 像这样和我说Up就会回复你了
想获取全球催眠中文平台官网地址，请留言说：网址
如未收到回复消息请耐心等待。
（手机可以观看用谷歌或safri浏览器）
闪耀成王 S-B-K ~ SHINING BE KING`
    });
    res.type("application/xml").send(reply);
    return;
  }

  // MsgId 去重：微信重试时直接返回缓存的回复
  if (msgId && msgIdCache.has(msgId)) {
    const cached = msgIdCache.get(msgId);
    console.log("[MsgId重复] 直接返回缓存回复, MsgId:", msgId);
    const reply = buildTextReply({ toUser, fromUser, content: cached.reply });
    res.type("application/xml").send(reply);
    return;
  }

  const userText = getXmlValue(xml, "Content").trim();
  console.log("[用户消息]", "用户:", toUser.slice(0, 10), "内容:", userText);

  const now = Date.now();

  // 取出该用户历史，过滤掉 24 小时之前的
  let history = userHistory.get(toUser) || [];
  history = history.filter(msg => now - msg.timestamp < 86400000);

  const recentHistory = history.slice(-19);

  const messages = [
    { role: "system", content: systemPrompt },
    ...recentHistory.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: userText }
  ];

  console.log("[准备调用DeepSeek]", "用户:", toUser.slice(0, 10), "历史条数:", recentHistory.length);

  try {
    const callStart = Date.now();
    const completion = await callDeepSeekWithTimeout(messages, 4500);
    const callDuration = Date.now() - callStart;
    console.log("[DeepSeek成功]", "用户:", toUser.slice(0, 10), "耗时:", callDuration, "ms");

    let text = completion.choices?.[0]?.message?.content?.trim() || "";
    if (!text) {
      console.warn("[DeepSeek返回空]", "用户:", toUser.slice(0, 10));
      text = "没太懂你的意思，再说一遍？";
    }

    const reply = buildTextReply({ toUser, fromUser, content: text });
    res.type("application/xml").send(reply);

    // 写入历史
    history.push({ role: "user", content: userText, timestamp: now });
    history.push({ role: "assistant", content: text, timestamp: now });
    userHistory.set(toUser, history);

    // 写入 MsgId 缓存（微信重试时用）
    if (msgId) {
      msgIdCache.set(msgId, { reply: text, timestamp: now });
    }

    const totalDuration = Date.now() - requestStart;
    console.log("[请求完成]", "用户:", toUser.slice(0, 10), "总耗时:", totalDuration, "ms");

  } catch (e) {
    const totalDuration = Date.now() - requestStart;
    const isTimeout = e.message === "DEEPSEEK_TIMEOUT";

    console.error("[DeepSeek失败]",
      "用户:", toUser.slice(0, 10),
      "原因:", isTimeout ? "超时(>4.5秒)" : e.message,
      "code:", e.code || e.type || "无",
      "总耗时:", totalDuration, "ms"
    );
    if (!isTimeout && e.stack) {
      console.error("[错误堆栈]", e.stack);
    }

    // 兜底回复：超时和失败给不同话术，方便区分
    const fallbackContent = isTimeout
      ? "在呢，刚思考慢了一点，再发一次试试。"
      : "系统刚卡了一下，再发一次试试。";

    const reply = buildTextReply({
      toUser,
      fromUser,
      content: fallbackContent
    });
    res.type("application/xml").send(reply);

    // 失败时也缓存 MsgId，避免微信重试时再次失败折磨用户
    if (msgId) {
      msgIdCache.set(msgId, { reply: fallbackContent, timestamp: now });
    }
  }
});

const port = process.env.PORT || 80;
app.listen(port, () => console.log("listening on", port, "启动时间:", new Date().toISOString()));
