import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = (msg: string) => {
  console.log(`[Feishu] ${msg}`);
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API 路由：提交到飞书
  app.post('/api/submit-to-feishu', async (req, res) => {
    try {
      const { onionId, images, timestamp } = req.body;
      const env = process.env;

      if (!onionId || !images || !Array.isArray(images)) {
        return res.status(400).json({ error: "参数不完整" });
      }

      log(`[Submit] 接收到提交请求: ID=${onionId}`);

      // 获取 Token
      const authRes = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: env.FEISHU_APP_ID,
          app_secret: env.FEISHU_APP_SECRET,
        }),
      });
      const authData = await authRes.json() as any;
      const accessToken = authData.tenant_access_token;

      // 上传图片
      const fileTokens: any[] = [];
      for (let i = 0; i < images.length; i++) {
        const base64Data = images[i];
        const base64Content = base64Data.split(",")[1] || base64Data;
        const buffer = Buffer.from(base64Content, 'base64');
        const blob = new Blob([buffer], { type: "image/png" });

        const formData = new FormData();
        formData.append('file_name', `sc_${onionId}_${i}.png`);
        formData.append('parent_type', 'bitable');
        formData.append('parent_node', env.FEISHU_BITABLE_APP_TOKEN!);
        formData.append('size', buffer.length.toString());
        formData.append('file', blob);

        const uploadRes = await fetch("https://open.feishu.cn/open-apis/drive/v1/files/upload_all", {
          method: "POST",
          headers: { "Authorization": `Bearer ${accessToken}` },
          body: formData,
        });
        const uploadData = await uploadRes.json() as any;
        fileTokens.push({ file_token: uploadData.data.file_token });
      }

      // 写入记录
      const recordRes = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BITABLE_TABLE_ID}/records`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            "洋葱ID": onionId,
            "提交时间": timestamp,
            "分享截图": fileTokens,
            "审核状态": "待核验"
          }
        }),
      });

      const recordData = await recordRes.json() as any;
      res.json({ success: true, record_id: recordData.data.record.record_id });
    } catch (error: any) {
      log(`[Submit] 错误: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/check-status', async (req, res) => {
    try {
      const { onionId } = req.body;
      const env = process.env;

      log(`[StatusCheck] 开始查询 ID: [${onionId}]`);

      if (!onionId) {
        return res.json({ success: true, results: {}, sequence: [] });
      }

      const authRes = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: env.FEISHU_APP_ID,
          app_secret: env.FEISHU_APP_SECRET,
        }),
      });
      const authData = await authRes.json() as any;
      const accessToken = authData.tenant_access_token;

      const filterString = `CurrentValue.[洋葱ID]=="${String(onionId).trim()}"`;
      const filter = encodeURIComponent(filterString);
      let url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BITABLE_TABLE_ID}/records?filter=${filter}`;

      log(`[StatusCheck] 尝试过滤查询: ${filterString}`);

      let recordRes = await fetch(url, {
        method: "GET",
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      let recordData = await recordRes.json() as any;

      // 如果过滤查询报错，启动“全量拉取”兜底策略
      if (recordData.code !== 0) {
        log(`[StatusCheck] 过滤查询失败(${recordData.msg})，启动兜底策略：全量拉取最近100条记录`);
        url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BITABLE_TABLE_ID}/records?page_size=100`;
        recordRes = await fetch(url, {
          method: "GET",
          headers: { "Authorization": `Bearer ${accessToken}` },
        });
        recordData = await recordRes.json() as any;
      }

      const results: any = {};
      const sequence: any[] = [];

      if (recordData.data && recordData.data.items) {
        // 如果是全量拉取模式，我们需要手动在内存中过滤 onionId
        const rawItems = recordData.data.items;
        const filteredItems = rawItems.filter((item: any) => {
          const fid = item.fields["洋葱ID"];
          // 这里的匹配比较宽泛，防止空格等问题
          return String(fid).trim() === String(onionId).trim();
        });

        log(`[StatusCheck] 处理后的匹配记录数: ${filteredItems.length} (总回传数: ${rawItems.length})`);
        
        if (filteredItems.length > 0) {
          log(`[StatusCheck] 匹配到记录，第一条状态: ${JSON.stringify(filteredItems[0].fields['审核状态'] || filteredItems[0].fields['状态'])}`);
        }

        const items = filteredItems.sort((a: any, b: any) => b.record_id.localeCompare(a.record_id));
        items.forEach((item: any) => {
          const fields = item.fields;
          
          const getVal = (keywords: string[]) => {
            const key = Object.keys(fields).find(k => keywords.some(kw => k.includes(kw)));
            return key ? fields[key] : null;
          };

          const status = getVal(['审核状态', '状态', '结果', '核验']) || "待核验";
          let feedback = getVal(['运营评语', '修改意见', '评论', '反馈', '建议']) || "";
          
          if (Array.isArray(feedback)) feedback = feedback.map((t: any) => t.text || "").join("");

          const result = {
            recordId: item.record_id,
            status: String(status),
            feedback: String(feedback).trim()
          };
          results[item.record_id] = result;
          sequence.push(result);
        });
      }

      res.json({ success: true, results, sequence });
    } catch (error: any) {
      log(`[StatusCheck] 致命错误: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Vite 中间件
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
