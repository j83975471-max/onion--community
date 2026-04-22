export async function onRequestPost(context) {
  const { request, env } = context;
  
  // 1. 设置跨域头（虽然同域不需要，但为了严谨加上）
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // 处理预检请求
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const { onionId, images, timestamp } = body;

    if (!onionId || !images || !Array.isArray(images)) {
      return new Response(JSON.stringify({ error: "参数不完整" }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // 2. 获取飞书 Tenant Access Token
    const authRes = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: env.FEISHU_APP_ID,
        app_secret: env.FEISHU_APP_SECRET,
      }),
    });
    
    const authData = await authRes.json();
    if (authData.code !== 0) throw new Error(`飞书鉴权失败: ${authData.msg}`);
    const accessToken = authData.tenant_access_token;

    // 3. 上传图片到飞书
    const fileTokens = [];
    for (let i = 0; i < images.length; i++) {
      const base64Data = images[i];
      const base64Content = base64Data.split(",")[1] || base64Data;
      
      // 在 Worker 环境中处理二进制数据
      const byteCharacters = atob(base64Content);
      const byteNumbers = new Array(byteCharacters.length);
      for (let j = 0; j < byteCharacters.length; j++) {
        byteNumbers[j] = byteCharacters.charCodeAt(j);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "image/png" });

      const formData = new FormData();
      formData.append('file_name', `sc_${onionId}_${i}.png`);
      formData.append('parent_type', 'bitable');
      formData.append('parent_node', env.FEISHU_BITABLE_APP_TOKEN);
      formData.append('size', blob.size.toString());
      formData.append('file', blob);

      const uploadRes = await fetch("https://open.feishu.cn/open-apis/drive/v1/files/upload_all", {
        method: "POST",
        headers: { "Authorization": `Bearer ${accessToken}` },
        body: formData,
      });
      
      const uploadData = await uploadRes.json();
      if (uploadData.code !== 0) throw new Error(`图片上传失败: ${uploadData.msg}`);
      fileTokens.push({ file_token: uploadData.data.file_token });
    }

    // 4. 写入多维表格记录
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

    const recordData = await recordRes.json();
    if (recordData.code !== 0) throw new Error(`写入记录失败: ${recordData.msg}`);

    return new Response(JSON.stringify({ 
      success: true, 
      record_id: recordData.data.record.record_id 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
}
