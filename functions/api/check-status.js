export async function onRequestPost(context) {
  const { request, env } = context;
  
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { onionId } = await request.json();
    if (!onionId) {
      return new Response(JSON.stringify({ success: true, results: {} }), { headers: corsHeaders });
    }

    // 1. 获取 Feishu Token
    const authRes = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: env.FEISHU_APP_ID,
        app_secret: env.FEISHU_APP_SECRET,
      }),
    });
    const authData = await authRes.json();
    const accessToken = authData.tenant_access_token;

    // 2. 获取数据
    const filterString = `CurrentValue.[洋葱ID]=="${String(onionId).trim()}"`;
    const filter = encodeURIComponent(filterString);
    let url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BITABLE_TABLE_ID}/records?filter=${filter}`;

    let recordRes = await fetch(url, {
      method: "GET",
      headers: { "Authorization": `Bearer ${accessToken}` },
    });
    let recordData = await recordRes.json();

    // 如果过滤查询报错，启动“全量拉取”兜底策略
    if (recordData.code !== 0) {
      url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BITABLE_TABLE_ID}/records?page_size=100`;
      recordRes = await fetch(url, {
        method: "GET",
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      recordData = await recordRes.json();
    }

    // 3. 整理结果
    const results = {};
    const sequence = [];

    if (recordData.data && recordData.data.items) {
      // 内存手动过滤（全员适配模式）
      const rawItems = recordData.data.items;
      const filteredItems = rawItems.filter(item => {
        const fid = item.fields["洋葱ID"];
        return String(fid).trim() === String(onionId).trim();
      });

      // 排序（从新到旧）
      const items = filteredItems.sort((a, b) => b.record_id.localeCompare(a.record_id));
      
      items.forEach(item => {
        const fields = item.fields;
        
        // 模糊枚举：支持各种可能的列名
        const getVal = (keywords) => {
          const key = Object.keys(fields).find(k => keywords.some(kw => k.includes(kw)));
          return key ? fields[key] : null;
        };

        const status = getVal(['审核状态', '状态', '结果', '核验']) || "待核验";
        let feedback = getVal(['运营评语', '修改意见', '评论', '反馈', '建议']) || "";
        
        if (Array.isArray(feedback)) feedback = feedback.map(t => t.text || "").join("");

        const res = {
          recordId: item.record_id,
          status: String(status),
          feedback: String(feedback).trim()
        };
        results[item.record_id] = res;
        sequence.push(res);
      });
    }

    return new Response(JSON.stringify({ success: true, results, sequence }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    // 确保即便出错，也返回合法的 JSON 格式，防止 Unexpected end of JSON 报错
    return new Response(JSON.stringify({ success: false, error: error.message }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
}
