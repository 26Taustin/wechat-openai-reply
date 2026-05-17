import express from "express";
import crypto from "crypto";
import OpenAI from "openai";

const app = express();
app.use(express.text({ type: ["text/xml", "application/xml", "*/xml", "text/plain"] }));
app.use(express.json());

// ====================== 配置区 ======================
// 管理员密码（用于访问 /admin/* 接口）
const ADMIN_SECRET = "SBKLion2026Admin";

// 学习费用菜单要发的图片 media_id（先留空，第一次跑代码后再填）
const STUDY_FEE_IMAGE_MEDIA_ID = "VGzikU3bsWf4C9BDqhkWj5ryfj7jF1fdHRYUMmjl4VXk2XWuRJ6619TD-Hs6_bBH";
// ===================================================

// 兼容两种环境变量名
const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("[启动警告] 没有检测到 DEEPSEEK_API_KEY 或 OPENAI_API_KEY 环境变量");
}

const openai = new OpenAI({
  apiKey: apiKey,
  baseURL: "https://api.deepseek.com/v1"
});

const WECHAT_TOKEN = process.env.WECHAT_TOKEN;

const userHistory = new Map();
const msgIdCache = new Map();

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
建立个人档案,获得个性化指导,并提供完整的催眠专业资料,帮助学员真正掌握和驾驭催眠技术。
一次付费终身适用，学费是捆绑网站终身VIP后的优惠价格：6888元。
其他问题可通过微信联系：15543495430（SBK 助理）。每次回复不超过200个汉字。`;

// 菜单按钮的 KEY（点击事件用这个识别用户点了哪个按钮）
const MENU_KEY_OFFICIAL_SITE = "OFFICIAL_SITE";
const MENU_KEY_LEARN_HYPNOSIS = "LEARN_HYPNOSIS";
const MENU_KEY_STUDY_FEE = "STUDY_FEE";

// 各菜单按钮的回复内容
const REPLY_OFFICIAL_SITE = `不要在微信里直接点进去！

请复制网址后，在电脑或者自带浏览器（safari、Edge、Google Chrome）中打开

【抱歉： 如使用国产品牌笔记本、手机或国产浏览器例如360、华为、oppo等设备，则有可能无法打开网站 ！手机端仅可用支付宝付款 ！】

https://www点sbk26t点com/`;

const REPLY_LEARN_HYPNOSIS = `【SBK催眠术的介绍】我是催眠师北堂冬海，学习SBK催眠术你需要了解以下几点：

一、你将获得什么：我会发给你一整套我花15年收集整理的系统催眠资料，涵盖传统催眠、隐蔽催眠、舞台催眠、NLP、魔术心理学、实战脚本、AI催眠术等，内容完整强效，通过夸克网盘一键打包。还会寄给你一份我亲手书写的纸质催眠脚本和两瓶精油，脚本照读即可实操催眠全过程，并结合配套音频训练表达节奏。此外，你将通过"真实催眠日记"官网观看全球催眠案例拆解，并能提交自己的作品一起成长。

二、教学方式：我不会批量教学，而是根据你的目标、声音、气质、理解力等为你定制计划。你可以用微信语音和我交流，不用长篇打字，我会逐条听并给出实用方案。每一步训练目标明确，还会教你从搭讪、引导到完成一次完整催眠，包括隐蔽催眠术、催眠师形象打造（站姿、穿搭、说话节奏等）。

三、报名费用与流程：一次性收费6888元（赠送官网26tea点cn终身VIP会员价值5888元），终身有效一对一长期辅导。付款后你将成为正式学员，随时解答指导，可线上线下同步训练。

四、最终目标：不是"知道"催眠，而是"成为"催眠师。我能做到的，也能教你做到。催眠不是玄学，是结构+技术+思维，你一步步做，我全程带你走完！别观望了，你想学，我就能带你成。催眠不是玄学，是技术和思维的组合。跟着我，少走弯路，直接拿结果!愿你成为她心中的灯塔！ Shining Be King - 闪耀成王。`;

const REPLY_SUBSCRIBE_WELCOME = `我目前只自动回复文字消息。你可以直接把问题用文字发我。
我是真实催眠日记的 Up 北堂冬海，感谢你的关注
任何问题都请给我留言吧，
你可以这样跟我说:你可以为我做什么
催眠作品的官方网址是什么? 有没有催眠视频 
我想学习催眠 像这样和我说Up就会回复你了
想获取全球催眠中文平台官网地址，请留言说：网址
如未收到回复消息请耐心等待。
（手机可以观看用谷歌或safri浏览器）
闪耀成王 S-B-K ~ SHINING BE KING`;

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

function buildImageReply({ toUser, fromUser, mediaId }) {
  const now = Math.floor(Date.now() / 1000);
  return `
<xml>
  <ToUserName><![CDATA[${toUser}]]></ToUserName>
  <FromUserName><![CDATA[${fromUser}]]></FromUserName>
  <CreateTime>${now}</CreateTime>
  <MsgType><![CDATA[image]]></MsgType>
  <Image>
    <MediaId><![CDATA[${mediaId}]]></MediaId>
  </Image>
</xml>`.trim();
}

async function callDeepSeekWithTimeout(messages, timeoutMs = 4500) {
  return Promise.race([
    openai.chat.completions.create({
      model: "deepseek-v4-pro",
      messages,
      max_tokens: 900,
      temperature: 0.85
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("DEEPSEEK_TIMEOUT")), timeoutMs)
    )
  ]);
}

// 调用微信开放接口（云托管免鉴权方式：使用 http、不带 access_token）
async function callWechatApi(path, body) {
  const url = `http://api.weixin.qq.com${path}`;
  console.log("[调用微信API]", path);
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  console.log("[微信API返回]", path, JSON.stringify(data));
  return data;
}

async function callWechatApiGet(path) {
  const url = `http://api.weixin.qq.com${path}`;
  console.log("[调用微信API GET]", path);
  const resp = await fetch(url);
  const data = await resp.json();
  console.log("[微信API返回]", path, JSON.stringify(data));
  return data;
}

app.get("/", (req, res) => res.status(200).send("ok"));

// ============== 微信接入校验 ==============
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

// ============== 微信消息 / 事件 推送 ==============
app.post("/wechat", async (req, res) => {
  const requestStart = Date.now();
  console.log("[收到推送]", new Date().toISOString(), "body长度:", (req.body || "").length);

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

  // ============== 处理微信事件：关注、菜单点击等 ==============
  if (msgType === "event") {
    const event = getXmlValue(xml, "Event");
    const eventKey = getXmlValue(xml, "EventKey");
    console.log("[事件]", "Event:", event, "EventKey:", eventKey);

    // 关注公众号后自动发送欢迎语
    if (event === "subscribe") {
      const replyXml = buildTextReply({
        toUser,
        fromUser,
        content: REPLY_SUBSCRIBE_WELCOME
      });

      res.type("application/xml").send(replyXml);
      return;
    }

    // 点击自定义菜单
    if (event === "CLICK") {
      let replyXml = "";

      if (eventKey === MENU_KEY_OFFICIAL_SITE) {
        replyXml = buildTextReply({ toUser, fromUser, content: REPLY_OFFICIAL_SITE });
      } else if (eventKey === MENU_KEY_LEARN_HYPNOSIS) {
        replyXml = buildTextReply({ toUser, fromUser, content: REPLY_LEARN_HYPNOSIS });
      } else if (eventKey === MENU_KEY_STUDY_FEE) {
        if (STUDY_FEE_IMAGE_MEDIA_ID) {
          replyXml = buildImageReply({ toUser, fromUser, mediaId: STUDY_FEE_IMAGE_MEDIA_ID });
        } else {
          replyXml = buildTextReply({
            toUser,
            fromUser,
            content: "学习费用：6888元（赠送官网终身VIP会员价值5888元），终身有效一对一长期辅导。咨询微信：15543495430"
          });
        }
      } else {
        replyXml = buildTextReply({
          toUser,
          fromUser,
          content: REPLY_SUBSCRIBE_WELCOME
        });
      }

      res.type("application/xml").send(replyXml);
      return;
    }

    // 取消关注不要回复；其他事件保持空回复
    res.type("application/xml").send("");
    return;
  }

  // ============== 非文本消息 ==============
  if (msgType !== "text") {
    console.log("[非文本消息] 返回引导话术");
    const reply = buildTextReply({
      toUser,
      fromUser,
      content: REPLY_SUBSCRIBE_WELCOME
    });
    res.type("application/xml").send(reply);
    return;
  }

  // MsgId 去重
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

    history.push({ role: "user", content: userText, timestamp: now });
    history.push({ role: "assistant", content: text, timestamp: now });
    userHistory.set(toUser, history);

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

    const fallbackContent = isTimeout
      ? "在呢，刚思考慢了一点，再发一次试试。"
      : "系统刚卡了一下，再发一次试试。";

    const reply = buildTextReply({ toUser, fromUser, content: fallbackContent });
    res.type("application/xml").send(reply);

    if (msgId) {
      msgIdCache.set(msgId, { reply: fallbackContent, timestamp: now });
    }
  }
});

// ============== 管理员接口：列出图片素材 ==============
app.get("/admin/list-images", async (req, res) => {
  if (req.query.secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: "wrong secret" });
  }

  try {
    const data = await callWechatApi("/cgi-bin/material/batchget_material", {
      type: "image",
      offset: 0,
      count: 20
    });

    if (data.errcode) {
      return res.status(500).json({ error: "wechat error", detail: data });
    }

    // 简化输出，只返回 media_id、文件名、更新时间
    const items = (data.item || []).map(it => ({
      media_id: it.media_id,
      name: it.name,
      update_time: new Date(it.update_time * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
      url: it.url
    }));

    res.json({
      total_count: data.total_count,
      item_count: data.item_count,
      items: items,
      hint: "找到目标图片后，复制 media_id 填到 server.js 的 STUDY_FEE_IMAGE_MEDIA_ID，然后重新部署"
    });
  } catch (e) {
    console.error("[list-images 错误]", e);
    res.status(500).json({ error: e.message });
  }
});

// ============== 管理员接口：创建菜单 ==============
app.get("/admin/create-menu", async (req, res) => {
  if (req.query.secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: "wrong secret" });
  }

  const menu = {
    button: [
      {
        type: "click",
        name: "官方网站",
        key: MENU_KEY_OFFICIAL_SITE
      },
      {
        name: "业务咨询",
        sub_button: [
          {
            type: "click",
            name: "学催眠",
            key: MENU_KEY_LEARN_HYPNOSIS
          },
          {
            type: "click",
            name: "学习费用",
            key: MENU_KEY_STUDY_FEE
          }
        ]
      }
    ]
  };

  try {
    const data = await callWechatApi("/cgi-bin/menu/create", menu);
    if (data.errcode === 0) {
      res.json({ success: true, message: "菜单创建成功！请等待几分钟后在微信中查看（可能需要重新关注公众号或重启微信才能看到）" });
    } else {
      res.status(500).json({ error: "wechat error", detail: data });
    }
  } catch (e) {
    console.error("[create-menu 错误]", e);
    res.status(500).json({ error: e.message });
  }
});

// ============== 管理员接口：删除菜单 ==============
app.get("/admin/delete-menu", async (req, res) => {
  if (req.query.secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: "wrong secret" });
  }

  try {
    const data = await callWechatApiGet("/cgi-bin/menu/delete");
    res.json({ result: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT || 80;
app.listen(port, () => console.log("listening on", port, "启动时间:", new Date().toISOString()));
