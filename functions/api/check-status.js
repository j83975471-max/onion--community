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

    // 2. 获取数据 (使用标准的 Filter，最稳)
    const filter = encodeURIComponent(`CurrentValue.[洋葱ID]=="${String(onionId).trim()}"`);
    // 强制按创建时间倒序拉取，保证顺序对位匹配的准确性
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BITABLE_TABLE_ID}/records?filter=${filter}&page_size=100`;

    const recordRes = await fetch(url, {
      method: "GET",
      headers: { "Authorization": `Bearer ${accessToken}` },
    });
    const recordData = await recordRes.json();

    // 3. 整理结果
    const results = {};
    const sequence = [];

    if (recordData.data && recordData.data.items) {
      // 飞书默认返回可能不是绝对倒序，我们在代码里手动按记录生成顺序排一下 (从新到旧)
      const items = recordData.data.items.sort((a, b) => b.record_id.localeCompare(a.record_id));
      
      items.forEach(item => {
        const fields = item.fields;
        let feedback = fields["运营评语"] || fields["修改意见"] || "";
        if (Array.isArray(feedback)) feedback = feedback.map(t => t.text || "").join("");

        const res = {
          recordId: item.record_id,
          status: fields["审核状态"] || "待核验",
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
