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
    const { recordIds, onionId } = await request.json();

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
    if (authData.code !== 0) throw new Error("飞书鉴权失败");
    const accessToken = authData.tenant_access_token;

    // 2. 构造查询 (回归最兼容的 GET 模式)
    const baseUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BITABLE_TABLE_ID}/records`;
    
    // 使用 CurrentValue 语法，这是多维表格过滤器最标准的写法
    const filter = encodeURIComponent(`CurrentValue.[洋葱ID]=="${String(onionId).trim()}"`);
    const url = `${baseUrl}?filter=${filter}&page_size=100`;

    const recordRes = await fetch(url, {
      method: "GET",
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    const recordData = await recordRes.json();
    if (recordData.code !== 0) throw new Error(`查询记录失败: ${recordData.msg}`);

    // 3. 解析结果 (增强字段容错)
    const results = {};
    const timeToStatus = {}; 

    if (recordData.data && recordData.data.items) {
      recordData.data.items.forEach(item => {
        const fields = item.fields;
        
        // 尝试匹配不同的评语列名
        let feedbackText = fields["运营评语"] || fields["修改意见"] || fields["反馈"] || "";
        
        if (Array.isArray(feedbackText)) {
          feedbackText = feedbackText.map(t => t.text || t.text_content || "").join("");
        } else if (typeof feedbackText === 'object') {
          feedbackText = feedbackText.text || JSON.stringify(feedbackText);
        }

        const res = {
          recordId: item.record_id,
          status: fields["审核状态"] || fields["状态"] || "待核验",
          feedback: String(feedbackText).trim()
        };

        results[item.record_id] = res;
        if (fields["提交时间"]) {
          timeToStatus[String(fields["提交时间"])] = res;
        }
      });
    }

    return new Response(JSON.stringify({ success: true, results, timeToStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
}
