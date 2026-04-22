import React, { useState, useEffect } from 'react';
import { 
  Trophy, 
   Clock, 
  Camera, 
  AlertCircle,
  History,
  X,
  Check,
  CheckCircle2,
  Loader2,
  HelpCircle,
  Smartphone,
  ArrowRight,
  ArrowDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Constants ---
const FIXED_DEADLINE = new Date('2026-04-24T12:00:00+08:00').getTime();
const USER_DURATION = 48 * 60 * 60 * 1000; // 48 hours

const STORAGE_KEYS = {
  FIRST_VISIT: 'onion_highlighter_first_visit',
  SUBMIT_COUNT: 'onion_highlighter_submit_count',
  SUBMIT_HISTORY: 'onion_highlighter_submit_history',
  USER_ID: 'onion_highlighter_user_id'
};

export default function App() {
  // --- State ---
  const [timeLeft, setTimeLeft] = useState<{ total: number; h: number; m: number; s: number } | null>(null);
  const [isExpired, setIsExpired] = useState(false);
  const [deadlineStr, setDeadlineStr] = useState('');
  
  const [onionId, setOnionId] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  
  // Modals
  const [showHistory, setShowHistory] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // --- Logic: Countdown & Deadlines ---
  useEffect(() => {
    // 检测是否需要重置数据 (专门用于预览调试)
    if (typeof window !== 'undefined' && window.location.search.includes('reset=true')) {
      Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
      window.location.href = window.location.pathname; // 重定向回原路径，去除参数
      return;
    }

    let firstVisit = localStorage.getItem(STORAGE_KEYS.FIRST_VISIT);
    if (!firstVisit) {
      firstVisit = Date.now().toString();
      localStorage.setItem(STORAGE_KEYS.FIRST_VISIT, firstVisit);
    }
    
    const timeA = parseInt(firstVisit) + USER_DURATION;
    const finalDeadline = Math.min(timeA, FIXED_DEADLINE);
    
    const deadlineDate = new Date(finalDeadline);
    setDeadlineStr(`${deadlineDate.getMonth() + 1}月${deadlineDate.getDate()}日 ${deadlineDate.getHours().toString().padStart(2, '0')}:${deadlineDate.getMinutes().toString().padStart(2, '0')}`);

    const timer = setInterval(() => {
      const now = Date.now();
      const distance = finalDeadline - now;
      
      if (distance <= 0) {
        clearInterval(timer);
        setIsExpired(true);
        setTimeLeft({ total: 0, h: 0, m: 0, s: 0 });
      } else {
        const h = Math.floor(distance / (1000 * 60 * 60));
        const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((distance % (1000 * 60)) / 1000);
        setTimeLeft({ total: distance, h, m, s });
      }
    }, 1000);

    // Sync other user data
    setSubmitCount(parseInt(localStorage.getItem(STORAGE_KEYS.SUBMIT_COUNT) || '0'));
    setOnionId(localStorage.getItem(STORAGE_KEYS.USER_ID) || '');
    setHistory(JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBMIT_HISTORY) || '[]'));

    return () => clearInterval(timer);
  }, []);

  const refreshHistoryStatuses = async () => {
    // 获取最新的 onionId，防止 state 还没同步
    const currentOnionId = onionId || localStorage.getItem(STORAGE_KEYS.USER_ID) || '';
    if (history.length === 0 || !currentOnionId) return;

    setIsRefreshing(true);
    try {
      const res = await fetch('/api/check-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          recordIds: history.filter(item => item.recordId).map(item => item.recordId),
          onionId: currentOnionId
        })
      });
      
      let data;
      try {
        const responseText = await res.text();
        if (!responseText) throw new Error("Empty response from server");
        data = JSON.parse(responseText);
        
        if (data?.success) {
          const feishuList = data.sequence || [];
          const updatedHistory = history.map((item, index) => {
            // 1. 新记录精准对齐 (通过 ID)
            if (item.recordId && data.results?.[item.recordId]) {
              const remoteResult = data.results[item.recordId];
              return { ...item, status: remoteResult.status, feedback: remoteResult.feedback };
            }
            
            // 2. 老记录物理对位 (按顺序)
            const matchedByOrder = feishuList[index];
            if (matchedByOrder) {
              return {
                ...item,
                recordId: matchedByOrder.recordId,
                status: matchedByOrder.status,
                feedback: matchedByOrder.feedback
              };
            }
            return item;
          });

          if (JSON.stringify(updatedHistory) !== JSON.stringify(history)) {
            setHistory(updatedHistory);
            localStorage.setItem(STORAGE_KEYS.SUBMIT_HISTORY, JSON.stringify(updatedHistory));
          }
        }
      } catch (e) {
        console.error('解析状态数据失败:', e);
      }
    } catch (err) {
      console.error('刷新状态失败:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (showHistory && history.length > 0) {
      refreshHistoryStatuses();
    }
  }, [showHistory]);

  // --- Form Handlers ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (images.length + files.length > 2) {
      alert('一次最多只能提交 2 张截图哦～想要更多请分次提交！');
      return;
    }

    files.forEach((file: File) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImages(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onionId) return alert('请输入洋葱ID');
    if (images.length === 0) return alert('请上传分享截图');
    if (isExpired) return alert('活动已截止');

    setIsSubmitting(true);
    
    try {
      const now = new Date().toLocaleString();
      const response = await fetch('/api/submit-to-feishu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onionId,
          timestamp: now,
          images,
          count: images.length
        })
      });

      let result;
      try {
        result = await response.json();
      } catch (e) {
        throw new Error('服务器返回格式错误，请检查网络或配置');
      }

      if (!response.ok) {
        throw new Error(result?.details || result?.error || '同步飞书失败');
      }
      
      const newCount = submitCount + 1;
      const newEntry = {
        id: Date.now(),
        recordId: result?.record_id,
        time: now,
        imageCount: images.length,
        status: '待核验',
        feedback: ''
      };
      const newHistory = [newEntry, ...history];
      
      localStorage.setItem(STORAGE_KEYS.SUBMIT_COUNT, newCount.toString());
      localStorage.setItem(STORAGE_KEYS.SUBMIT_HISTORY, JSON.stringify(newHistory));
      localStorage.setItem(STORAGE_KEYS.USER_ID, onionId);
      
      setSubmitCount(newCount);
      setHistory(newHistory);
      setShowSuccess(true);
      setImages([]);
    } catch (err) {
      console.error(err);
      alert('网络异常，提交失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen text-ink font-sans selection:bg-orange-100 pb-12 overflow-x-hidden">
      
      <div className="relative overflow-hidden pb-8 pt-4">
        <button 
          onClick={() => window.close()}
          className="absolute top-[88px] left-6 z-[150] p-2 bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/20 rounded-full text-white transition-all active:scale-95 group"
          title="关闭页面"
        >
          <X className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
        </button>
        <div className="px-5 flex items-center justify-center max-w-6xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 bg-black/80 px-4 py-2 rounded-full"
          >
            <Clock className="w-4 h-4 text-accent animate-pulse" />
            <span className="text-white text-sm font-bold whitespace-nowrap flex items-center gap-1">
              {isExpired ? '活动已失效' : (
                <>
                  <span>专属福利掉落，抢位倒计时中！</span>
                  <span className="text-accent ml-1">
                    {timeLeft ? `${timeLeft.h.toString().padStart(2, '0')}:${timeLeft.m.toString().padStart(2, '0')}:${timeLeft.s.toString().padStart(2, '0')}` : '00:00:00'}
                  </span>
                </>
              )}
            </span>
          </motion.div>
        </div>

        <div className="mt-3 flex justify-center">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="bg-white/10 backdrop-blur-md border border-white/20 px-4 py-1.5 rounded-xl text-white/90 text-xs font-black uppercase tracking-widest"
          >
            统一截榜时间：2026年4月24日 12:00
          </motion.div>
        </div>

        <div className="mt-6 px-6 text-center text-white">
          <motion.h1 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-4xl md:text-5xl font-black italic tracking-tighter drop-shadow-[0_4px_0_#C64400]"
          >
            🌟 洋葱高光创作官 · 专属福利任务
          </motion.h1>
          <motion.div 
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mt-2 text-sm font-bold opacity-90"
          >
            燃爆社区，优秀的作品值得被更多人看见！
          </motion.div>

            <motion.button
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              onClick={() => setShowGuide(true)}
              className="mt-4 bg-white/20 hover:bg-white/30 text-white backdrop-blur-md border border-white/30 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 mx-auto transition-all active:scale-95"
            >
              ⚠️ <span className="underline underline-offset-2">参与须知</span>
            </motion.button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-5">
        {!isExpired ? (
          <div className="grid md:grid-cols-2 gap-6 items-start">
            <div className="space-y-6">
              <section className="brutal-card">
                <div className="flex items-center gap-2 mb-6">
                  <Trophy className="w-6 h-6 text-primary" />
                  <h2 className="text-xl font-black text-primary uppercase">阶梯奖励 · 先到先得</h2>
                </div>
                
                <div className="grid grid-cols-1 gap-4">
                  <RewardCard 
                    rank="🎁"
                    title="独家实物奖励"
                    limit="100% 包邮必得"
                    desc="活动期内累积达成 10 次有效分享，100% 包邮必得洋葱定制中性笔一支！"
                    color="bg-red-50 border-red-200"
                  />
                  <RewardCard 
                    rank="🥇"
                    title="产出学习内容研究员拥有内容置顶福利"
                    limit="全网限量 9 席（各学段 3 席）！"
                    desc="满 3 次有效分享即可触发。按达标时间先后，解锁专属【全站置顶 24 小时】黄金档期！"
                    color="bg-bg-light border-primary"
                  />
                  <RewardCard 
                    rank="👑"
                    title="产出非学习内容研究员拥有非学习类圈主福利"
                    limit="限量 8 席！"
                    desc="满 3 次有效分享即可锁定。按达标时间先后，解锁【最高流量时段-周五至周末】的【高光圈主】轮值权！"
                    color="bg-purple-50 border-purple-200"
                  />
                </div>
              </section>

              <section className="brutal-card">
                <div className="flex items-center gap-2 mb-6">
                  <HelpCircle className="w-6 h-6 text-primary" />
                  <h2 className="text-xl font-black text-primary uppercase">如何参与活动</h2>
                </div>
                <div className="space-y-0 mt-2">
                  <StepItem 
                    number="第一步" 
                    title="找到你想分享的帖子" 
                    desc="在社区内找到想要安利给小伙伴的帖子（自己的也可以！），点击右上角生成分享图片，或直接选择分享平台" 
                  />
                  <div className="flex justify-center py-2">
                    <ArrowDown className="w-5 h-5 text-primary/30 animate-bounce" />
                  </div>
                  <StepItem 
                    number="第二步" 
                    title="多平台进行分享" 
                    desc="将帖子分享给QQ或微信或其他社交平台好友/群聊，或朋友圈、QQ空间等公开社交平台" 
                  />
                   <div className="flex justify-center py-2">
                    <ArrowDown className="w-5 h-5 text-primary/30 animate-bounce" />
                  </div>
                  <StepItem 
                    number="第三步" 
                    title="保存全屏截图" 
                    desc="分享完成后，在对应分享页面进行截图（如分享给好友就截图聊天框，分享至朋友圈就截图朋友圈内容）～" 
                  />
                   <div className="flex justify-center py-2">
                    <ArrowDown className="w-5 h-5 text-primary/30 animate-bounce" />
                  </div>
                  <StepItem 
                    number="第四步" 
                    title="上传截图提交审核" 
                    desc="在本页面底部“立即提交核验”处输入洋葱ID并上传截图，点击提交成功即可！🎊" 
                    isLast 
                  />
                </div>
              </section>

              <section className="brutal-card">
                <h3 className="text-lg font-black text-primary flex items-center gap-2 mb-4 uppercase">
                  <Smartphone className="w-5 h-5" /> 有效分享“避坑必看”
                </h3>
                <ul className="space-y-4">
                  <RuleItem icon="📱" text={<span><b>必须是全屏原图！</b> 截图要把手机顶部的【电量和时间】都截进去哦，千万别裁剪、打马赛克或 P 图，不然葱葱看不清就不算啦～</span>} />
                  <RuleItem icon="👀" text={<span><b>要真实发出去哦！</b> 分享的内容绝对不能“仅自己可见”哦～</span>} />
                  <RuleItem icon="🚫" text={<span><b>不要拿同一张图糊弄！</b> 每次截图分享的好友/群聊/平台必须不同，禁止同一张截图反复上传。</span>} />
                </ul>
                <div className="mt-4 p-3 bg-accent/20 rounded-xl text-xs text-ink/80 leading-relaxed font-bold border-l-4 border-accent">
                  💡 1 张不重复的有效截图 = 1 次有效分享，支持连交2张。想冲大奖？请分多次提交哦！
                </div>
              </section>
            </div>

            <div className="space-y-6">
              <section className="brutal-card">
                <div className="flex items-center gap-2 mb-6">
                  <Loader2 className="w-6 h-6 text-primary" />
                  <h2 className="text-xl font-black text-primary uppercase">立即提交核验</h2>
                </div>

                <div className="mb-6 flex flex-col gap-2">
                  <div className="flex justify-between items-end">
                    <span className="text-sm font-black text-ink">当前提交进度：<b className="text-lg">{submitCount}</b>/10</span>
                  </div>
                  <div className="h-4 bg-gray-100 rounded-full overflow-hidden border-2 border-ink shadow-inner">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min((submitCount / 10) * 100, 100)}%` }}
                      className="h-full bg-gradient-to-r from-accent to-primary"
                    />
                  </div>
                  <p className="text-xs text-red-600 font-bold mt-1">⚠️ 提示：此处仅记录表单提交次数，不代表最终有效。战绩以结算核验为准。</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-sm font-black text-ink flex items-center gap-1">洋葱 ID</label>
                    <input 
                      type="text" 
                      value={onionId}
                      onChange={(e) => setOnionId(e.target.value)}
                      placeholder="请输入您的洋葱ID"
                      className="input-brutal text-base"
                    />
                    <p className="text-xs text-gray-400 font-normal">不知道 ID？在 App - 我的 - 点击头像查看</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-black text-ink">上传分享截图 <span className="font-normal text-gray-400">(单次限2张)</span></label>
                    <div className="grid grid-cols-2 gap-4">
                      {images.map((img, idx) => (
                        <div key={idx} className="relative aspect-square rounded-2xl overflow-hidden border-2 border-ink shadow-md">
                          <img src={img} className="w-full h-full object-cover" />
                          <button 
                            type="button"
                            onClick={() => removeImage(idx)}
                            className="absolute top-2 right-2 bg-black/70 p-1.5 rounded-full text-white shadow-lg"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      
                      {images.length < 2 && (
                        <label className="aspect-square flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-2xl bg-gray-50 cursor-pointer hover:bg-orange-50 hover:border-primary active:scale-95 transition-all group">
                          <Camera className="w-8 h-8 text-gray-300 group-hover:text-primary mb-1 transition-colors" />
                          <span className="text-xs font-black text-gray-400 group-hover:text-primary">添加截图</span>
                          <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                        </label>
                      )}
                    </div>
                  </div>

                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="brutal-btn w-full py-4 text-xl"
                  >
                    {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : '提交核验，冲刺大奖！'}
                  </button>
                </form>

                <button 
                  onClick={() => setShowHistory(true)}
                  className="mt-6 w-full text-primary hover:underline transition-all text-sm font-black italic flex items-center justify-center gap-2"
                >
                  👀 查看我的提交记录
                </button>
              </section>
            </div>
          </div>
        ) : (
          <div className="max-w-md mx-auto">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="p-10 bg-white border-4 border-ink rounded-[40px] flex flex-col items-center text-center shadow-[0_12px_0_rgba(0,0,0,0.1)]">
              <div className="text-7xl mb-6">⏰</div>
              <h1 className="text-3xl font-black mb-4">哎呀，你错过了本次限时活动！</h1>
              <p className="text-gray-500 text-base leading-relaxed">本次分享任务通道已正式关闭。请继续生产优质作品，等待下次被选中的高光机会哦~</p>
              <button onClick={() => window.close()} className="brutal-btn mt-10 px-10 py-4 w-auto text-xl">关闭页面</button>
            </motion.div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showSuccess && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSuccess(false)} className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-[340px] bg-white border-4 border-ink rounded-[40px] p-8 text-center shadow-2xl">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-green-200"><Check className="w-10 h-10 text-green-500" /></div>
              <h3 className="text-xl font-black text-ink mb-4 leading-tight">🎊提交成功！</h3>
              <p className="text-sm text-gray-500 font-bold mb-8 leading-relaxed">继续去其他阵地进行分享，冲刺大奖吧！</p>
              <button onClick={() => setShowSuccess(false)} className="brutal-btn w-full py-4 text-lg bg-primary text-white">我知道了</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHistory && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowHistory(false)} className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="relative w-full max-w-md bg-white border-4 border-ink rounded-[32px] overflow-hidden flex flex-col max-h-[80vh] shadow-2xl">
              <div className="p-6 flex justify-between items-center bg-white border-b-2 border-ink">
                <div className="flex items-center gap-2 uppercase">
                  我的提交记录
                  {isRefreshing && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                </div>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X className="w-6 h-6" /></button>
              </div>
              <div className="p-6 overflow-y-auto">
                <div className="bg-bg-light p-4 rounded-xl border-2 border-primary/20 text-xs text-primary font-black mb-6 flex justify-between items-center">
                  <span>💡 进度已成功提交！葱葱将于8h内进行审核，给出审核结果和修改意见哦～请稍后再来看看吧！</span>
                  {isRefreshing && <Loader2 className="w-4 h-4 animate-spin" />}
                </div>
                <div className="space-y-4">
                  {history.length === 0 ? <p className="text-center text-gray-300 py-10 font-bold">还没有提交记录，快去分享吧~</p> : history.map(item => (
                    <div key={item.id} className="p-4 border-2 border-gray-100 rounded-2xl flex flex-col gap-2 bg-gray-50 hover:border-primary/30 transition-all">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="text-xs font-black text-ink">提交记录 ({item.imageCount}张截图)</div>
                          <div className="text-[10px] text-gray-400 mt-1">{item.time}</div>
                        </div>
                        <div className={`text-[10px] font-black px-2 py-1 rounded uppercase flex items-center gap-1 ${
                          item.status.includes('通过') ? 'bg-green-100 text-green-600' : 
                          item.status.includes('不合格') ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'
                        }`}>
                          {item.status.includes('通过') ? <CheckCircle2 className="w-3 h-3" /> : (item.status.includes('不合格') ? <AlertCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />)}
                          {item.status}
                        </div>
                      </div>
                      {(item.feedback || item.status.includes('不合格')) && (
                        <div className={`mt-2 p-3 border rounded-xl text-[10px] font-bold flex gap-2 items-start ${
                          item.status.includes('通过') ? 'bg-green-50 border-green-100 text-green-700' :
                          item.status.includes('不合格') ? 'bg-red-50 border-red-100 text-red-700' :
                          'bg-orange-50 border-orange-100 text-orange-700'
                        }`}>
                          {item.status.includes('通过') ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                          <div className="flex-1">
                            <div className="uppercase mb-0.5 opacity-60">
                              {item.status.includes('不合格') ? '审核反馈/修改建议：' : '运营评语：'}
                            </div>
                            <div className="leading-relaxed">
                              {item.feedback || (item.status.includes('不合格') ? '暂无具体修改建议，请确保截图为全屏原图且包含时间电量。' : '正在核验中...')}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showGuide && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowGuide(false)} className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="relative w-full max-w-[360px] bg-white border-[3px] border-ink rounded-[32px] p-6 max-h-[80vh] flex flex-col shadow-2xl">
              <h2 className="text-xl font-black text-primary mb-4 flex items-center gap-2">⚠️ 任务注意事项</h2>
              <div className="overflow-y-auto flex-1 space-y-6 pr-1 custom-scrollbar">
                <div>
                  <h3 className="text-lg font-black text-ink mb-3 border-l-4 border-primary pl-3">关于 48 小时限时任务</h3>
                  <div className="space-y-3 text-sm text-gray-600 font-bold leading-relaxed">
                    <div className="flex gap-2"><span className="text-primary">1.</span><p>你的专属 <code className="bg-orange-50 px-1 rounded text-primary">48</code> 小时倒计时从首次打开任务页时开始计算。</p></div>
                    <div className="flex gap-2"><span className="text-primary">2.</span><p>本活动同时受个人时限与活动截榜时间约。 </p></div>
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-black text-ink mb-3 border-l-4 border-primary pl-3">关于有效分享</h3>
                  <div className="space-y-3 text-sm text-gray-600 font-bold leading-relaxed">
                    <div className="flex gap-2"><span className="text-primary">1.</span><p><code className="bg-gray-100 px-1 rounded text-ink">1 张不重复截图 = 1 次有效分享</code>。</p></div>
                    <div className="flex gap-2"><span className="text-primary">2.</span><p>分享对象需为真实可见场景，不支持“仅自己可见”。</p></div>
                  </div>
                </div>
                <div className="h-4" />
              </div>
              <button onClick={() => setShowGuide(false)} className="brutal-btn mt-6 py-4 text-lg">我知道了，火速开冲</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RewardCard({ rank, title, limit, desc, color }: any) {
  return (
    <div className={`p-4 rounded-xl border-2 border-ink ${color} flex gap-4 items-start transition-all hover:scale-[1.02] shadow-[4px_4px_0_var(--color-ink)]`}>
      <span className="text-3xl mt-1">{rank}</span>
      <div className="text-left">
        <div className="flex flex-wrap items-center gap-1 mb-1">
          <span className="font-black text-ink text-base">{title}</span>
          <span className="text-[10px] font-black px-1.5 py-0.5 bg-white border border-ink/10 rounded">{limit}</span>
        </div>
        <p className="text-xs text-gray-500 font-bold leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function RuleItem({ icon, text }: { icon: string; text: any }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="text-xl shrink-0">{icon}</span>
      <span className="text-sm font-bold text-gray-600 leading-normal">{text}</span>
    </li>
  );
}

function StepItem({ number, title, desc, isLast }: { number: string; title: string; desc: string; isLast?: boolean }) {
  return (
    <div className="flex gap-4 items-center relative bg-gray-50 p-4 rounded-2xl border-2 border-ink/5 group hover:border-primary/20 transition-all">
      <div className="flex-shrink-0 px-3 py-1 rounded-lg bg-primary text-white flex items-center justify-center font-black italic shadow-[3px_3px_0_var(--color-ink)] z-10 text-xs whitespace-nowrap">{number}</div>
      <div className="flex-1">
        <h4 className="text-sm md:text-base font-black text-ink mb-0.5">{title}</h4>
        <p className="text-xs text-gray-400 font-bold leading-tight">{desc}</p>
      </div>
    </div>
  );
}
