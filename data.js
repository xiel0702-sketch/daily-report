// 投研日报数据
const REPORT_DATA = [
  {
    "date": "2026-07-02",
    "coverage": "2026-07-01",
    "sections": {
      "ai": {
        "label": "AI 技术-资本信号",
        "badge": "ai",
        "items": [
          {"title":"OpenAI 论文揭示 GPT-5.6 三个 Pro 变体，打破单一顶级策略","body":"OpenAI 不再追求单一最强模型，而是推出多个专业化 Pro 变体。这标志着大模型竞争从「参数军备竞赛」转向「场景化模型矩阵」，对一级市场而言，投资单一基座模型的风险上升。","link":"https://aihot.virxact.com/items/cmr1wzzsm02uosl8zop6s0sly","badge":"模型格局"},
          {"title":"Meta 效仿 SpaceX，将过剩 AI 算力变现","body":"Meta 开始将闲置的 AI 训练/推理算力对外出租。验证了 AI 算力从「稀缺资源」向「可交易商品」的转变，利好算力调度与交易平台类项目。","link":"https://aihot.virxact.com/items/cmr259c3104wjsl8z81g6p5op","badge":"算力变现"},
          {"title":"Cloudflare 推出 AI 流量管理选项，区分搜索、智能体与训练爬虫","body":"Cloudflare 为网站提供区分 AI 爬虫的流量管理工具。AI Agent 流量正在成为互联网主流流量类型，将催生新的网络基础设施需求。","link":"https://aihot.virxact.com/items/cmr25x2x2051tsl8ze3nntrkd","badge":"基础设施"},
          {"title":"Anthropic 在 Claude Code 中植入隐写术代码识别中国用户","body":"Anthropic 通过技术手段主动识别并可能限制中国用户使用其开发者工具。强化了国产 AI 开发工具和 IDE 的替代逻辑。","link":"https://aihot.virxact.com/items/cmr1bxokg01eoslnlem278yfq","badge":"地缘风险"}
        ]
      },
      "semi": {
        "label": "半导体周期-供需信号",
        "badge": "semi",
        "items": [
          {"title":"SOX 费城半导体指数：13353 点，日涨跌 -6.3%","body":"指数单日暴跌超 6%，反映市场对半导体短期需求或地缘风险的极度悲观情绪，需警惕一级市场半导体项目估值回调压力。","link":"","badge":"index","signal":"指数"},
          {"title":"半导体涨价潮蔓延至先进封装，日月光 CEO：正全力以赴扩大产能","body":"先进封装产能供不应求，涨价趋势明确。对国内先进封装设备与材料供应商构成直接利好，关注上游设备国产化替代机会。","link":"https://www.cls.cn/detail/2414349","badge":"price","signal":"涨价"},
          {"title":"台积电面板级封装 2029 年量产，半导体设备长周期景气确认","body":"台积电将面板级封装量产时间定于 2029 年，相关设备将迎来 5 年以上景气周期，适合布局早期设备公司。","link":"https://m.sohu.com/a/1044065989_121157270","badge":"expand","signal":"扩产"}
        ]
      },
      "robot": {
        "label": "机器人资本-落地信号",
        "badge": "robot",
        "items": [
          {"title":"跨维智能获 10 亿元融资，拟冲刺「具身引擎」港股第一股","body":"跨维智能完成新一轮 10 亿元融资，明确计划港股上市。验证了具身智能赛道头部项目的资本化能力。","link":"https://m.21jingji.com/article/20260701/herald/9fe9057bb76e19dfff0e8c99b3fcdc80_zaker.html","badge":"融资"},
          {"title":"具身智能资本扎堆，投资老兵拆解赛道分水岭","body":"行业进入分化期，投资逻辑从「讲故事」转向「交付能力」。硬件可靠性、工程化体系、数据闭环成为核心指标。","link":"https://www.nbd.com.cn/articles/2026-07-01/4444045.html","badge":"行业判断"},
          {"title":"智驾人才跨界具身智能，是降维打击还是会水土不服？","body":"大量自动驾驶人才涌入具身智能领域，带来算法优势但面临硬件、实时性等新挑战。需关注跨界团队在「仿真-真实」迁移能力上的短板。","link":"https://www.eet-china.com/mp/a506514.html","badge":"人才趋势"}
        ]
      }
    }
  }
];
