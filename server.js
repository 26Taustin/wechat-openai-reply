import express from "express";
import crypto from "crypto";
import OpenAI from "openai";

const app = express();
app.use(express.text({ type: ["text/xml", "application/xml", "*/xml", "text/plain"] }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const WECHAT_TOKEN = process.env.WECHAT_TOKEN;

const systemPrompt = `忽略礼貌用语！回复语言充满人性，像简讯聊天一样，不要分段阐述，整体自然流动。允许口语化表达，允许带个人判断和情绪，使用生活化比喻，适度加入语气词，允许模拟思考过程，允许一点不完美感。
催眠师北堂冬海在抖音、B站、快手、小红书等平台运营账号「真实催眠日记」。
我们的《全球催眠作品中文平台》官方网站建议使用电脑端浏览器访问：26tea点cn，手机端也可用浏览器观看。
备用网址：sbk26t点com。复制网址到浏览器地址栏，把“点”换成“.”，并在前面加上 www。两个网站内容同步更新，但 VIP 会员不通用。
只需 288 元升级成为 VIP 权限，即可在 3 个月内无限观看全部作品，包含 500 多部真实催眠影片，每月 1、8、16、24 号更新。
你作为北堂冬海的 AI 分身来回复粉丝留言，请尽量简短、自然、更口语化。现在请你回复来自「狮必行」微信公众号的用户消息。
你的目标是在不让人反感的前提下，促进催眠网站 VIP 权限和催眠课程的转化，同时自然介绍我们的 QQ 催眠交流群，用于发布催眠直播通知以及群文件中的催眠书籍资料。
VIP 专属 QQ 群号是 981369629（进群请备注 VIP 用户名，核实通过后即可加入）。
免费催眠兴趣 QQ 群号是 762994144（无需 VIP 身份，审核年龄 18～40 岁即可加入）。
如果对学习催眠感兴趣，我们还提供一对一在线教学培训。每位学徒都会建立个人档案，获得个性化指导，并提供完整的催眠专业资料，帮助学员真正掌握和驾驭催眠技术。
其他问题可通过微信联系：15543495430（SBK 助理）。每次回复不超过120个汉字。`;

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

app.get("/", (req, res) => res.status(200).send("ok"));

app.get("/wechat", (req, res) => {
  const { signature, timestamp, nonce, echostr } = req.query;
  if (!signature || !timestamp || !nonce || !echostr) {
    return res.status(400).send("missing params");
  }
  if (!checkSignature({ signature, timestamp, nonce })) {
    return res.status(401).send("bad signature");
  }
  return res.status(200).send(echostr);
});

app.post("/wechat", async (req, res) => {
  const { signature, timestamp, nonce } = req.query;
  if (!checkSignature({ signature, timestamp, nonce })) {
    return res.status(401).send("bad signature");
  }

  const xml = req.body || "";
  const msgType = getXmlValue(xml, "MsgType");
  const toUser = getXmlValue(xml, "FromUserName");
  const fromUser = getXmlValue(xml, "ToUserName");

  if (msgType !== "text") {
    const reply = buildTextReply({
      toUser,
      fromUser,
      content: "我目前只自动回复文字消息。你可以直接把问题用文字发我。"
    });
    res.type("application/xml").send(reply);
    return;
  }

  const userText = getXmlValue(xml, "Content").trim();

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ],
      max_tokens: 400,
      temperature: 0.85
    });

    let text = completion.choices?.[0]?.message?.content?.trim() || "";

    if (!text) {
      text = "没太懂你的意思，再说一遍？";
    }

    const reply = buildTextReply({ toUser, fromUser, content: text });
    res.type("application/xml").send(reply);
  } catch (e) {
    console.error("OpenAI 调用失败:", e.message, e.code || e.type || "未知错误");

    const reply = buildTextReply({
      toUser,
      fromUser,
      content: "系统刚卡了一下，再发一次试试。"
    });
    res.type("application/xml").send(reply);
  }
});

const port = process.env.PORT || 80;
app.listen(port, () => console.log("listening on", port));
