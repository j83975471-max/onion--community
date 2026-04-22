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

    // 2. 构造查询条件
    let url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BITABLE_TABLE_ID}/records`;
    
    // 如果有 onionId，我们按用户 ID 查全量记录，这样能覆盖旧数据
    if (onionId) {
      // 飞书语法加固：使用更通用的 [字段名]="值" 格式，并确保 onionId 存在
      const safeOnionId = String(onionId).trim();
      const filter = encodeURIComponent(`[洋葱ID]="${safeOnionId}"`);
      url += `?filter=${filter}&page_size=100`;
    } else if (recordIds && recordIds.length > 0) {
      const queryParams = new URLSearchParams();
      recordIds.forEach(id => queryParams.append('record_ids', id));
      url += `?${queryParams.toString()}`;
    } else {
      return new Response(JSON.stringify({ success: true, results: {} }), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const recordRes = await fetch(url, {
      method: "GET",
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    const recordData = await recordRes.json();
    if (recordData.code !== 0) throw new Error(`查询记录失败: ${recordData.msg}`);

    // 3. 解析结果
    const results = {};
    const timeToStatus = {}; // 用于按时间匹配旧记录

    recordData.data.items.forEach(item => {
      const fields = item.fields;
      let feedbackText = fields["运营评语"] || "";
      if (Array.isArray(feedbackText)) {
        feedbackText = feedbackText.map(t => t.text || t.text_content || "").join("");
      } else if (typeof feedbackText === 'object') {
        feedbackText = feedbackText.text || JSON.stringify(feedbackText);
      }

      const res = {
        recordId: item.record_id,
        status: fields["审核状态"] || "待核验",
        feedback: feedbackText
      };

      results[item.record_id] = res;
      // 记录时间映射，方便没 ID 的旧数据匹配 (飞书时间通常是 "2024/4/22 14:00:00")
      if (fields["提交时间"]) {
        timeToStatus[fields["提交时间"]] = res;
      }
    });

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
