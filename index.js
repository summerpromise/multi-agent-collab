/**
 * 多智能体协作系统 v5.3 — Black & Gold Edition
 *
 * @module multi_agent_collab
 * @version 5.3.0
 * @description
 *   本模块为 SillyTavern 扩展，实现了一个基于 LLM 的多智能体协作 RPG 游戏框架。
 *   系统支持两种 LLM 交互模式：OpenAI Function Calling（FC）和 ReAct 文本推理。
 *   包含完整的游戏引擎、数据驱动的战斗系统、GM（游戏主持人）Agent、
 *   全屏仪表盘 UI、浮动 HUD、酒馆聊天注入、自动评估测试等功能。
 *
 * 架构概览（按 PART 划分）：
 *   0 常量 · SVG图标 · FC工具定义
 *   1 场景模板（RPG 世界数据 —— 地点、物品、敌人、Agent）
 *   2 状态管理 & 配置持久层（全局状态 G、extensionSettings、localStorage 存档）
 *   3 游戏引擎（数据驱动战斗 —— 重置、模糊ID匹配、伤害计算、工具执行）
 *   4 LLM 层（FC + ReAct + AbortController + 友好错误 + JSON修复）
 *   5 Agent 执行引擎（规则意图、自然语言解析、回退动作、FC/ReAct 回合循环）
 *   6 协调层（游戏循环 —— 初始化/开始/暂停/停止、主循环：用户→NPC→GM）
 *   7 评估系统（性能指标收集、自动化测试）
 *   8 UI（全屏仪表盘 7 页 + 浮动HUD + 酒馆聊天注入 + 消息渲染 + 事件绑定）
 *   9 启动（MutationObserver 探测 DOM 就绪 + SillyTavern 事件钩子）
 */
(function () {
    'use strict';

    // ══════════════════════════════════════════════════════════════
    //  PART 0 — 常量 · SVG图标 · FC工具定义
    //
    //  本部分定义了模块标识符、版本号、持久化键名、SVG 图标集合、
    //  OpenAI Function Calling 工具 schema（玩家工具 + GM 工具）、
    //  工具名称翻译表、工具颜色映射表以及 HTTP 错误码友好提示。
    // ══════════════════════════════════════════════════════════════

    /** @constant {string} MODULE - 模块标识符，用于 SillyTavern extensionSettings 的命名空间 */
    /** @constant {string} VERSION - 当前版本号 */
    /** @constant {string} SAVE_KEY - localStorage 存档键前缀 */
    /** @constant {string} HUD_KEY - localStorage 中 HUD 状态持久化的键名 */
    const MODULE = 'multi_agent_collab', VERSION = '5.3.0', SAVE_KEY = 'mac_game_save', HUD_KEY = 'mac_hud_state';

    /**
     * @constant {Object.<string, string>} IC
     * @description SVG 图标集合，用于 UI 界面中的侧边栏导航、按钮、HUD 等组件的图标显示。
     *   每个属性值是一段内联 SVG 标记字符串。
     * @property {string} logo   - 系统 Logo（六边形网络图）
     * @property {string} dash   - 仪表盘图标（四宫格）
     * @property {string} game   - 游戏页图标（播放按钮）
     * @property {string} agents - 智能体页图标（双人头像）
     * @property {string} world  - 世界页图标（地球）
     * @property {string} eval   - 评估页图标（柱状图）
     * @property {string} settings - 设置页图标（齿轮）
     * @property {string} logs   - 日志页图标（横线列表）
     */
    const IC = {
        logo: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2"><polygon points="14,3 25,9 25,19 14,25 3,19 3,9"/><circle cx="14" cy="14" r="2.5" fill="currentColor" stroke="none" opacity=".5"/><circle cx="14" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="22" cy="11" r="1.5" fill="currentColor" stroke="none"/><circle cx="22" cy="17" r="1.5" fill="currentColor" stroke="none"/><circle cx="14" cy="22" r="1.5" fill="currentColor" stroke="none"/><circle cx="6" cy="17" r="1.5" fill="currentColor" stroke="none"/><circle cx="6" cy="11" r="1.5" fill="currentColor" stroke="none"/></svg>',
        dash: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="6.5" height="6.5" rx="2"/><rect x="11.5" y="2" width="6.5" height="6.5" rx="2"/><rect x="2" y="11.5" width="6.5" height="6.5" rx="2"/><rect x="11.5" y="11.5" width="6.5" height="6.5" rx="2"/></svg>',
        game: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="10" cy="10" r="8"/><polygon points="8,5.5 8,14.5 15,10" fill="currentColor" stroke="none" opacity=".7"/></svg>',
        agents: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7.5" cy="6.5" r="2.5"/><path d="M2.5 16c0-2.8 2.2-5 5-5s5 2.2 5 5"/><circle cx="14" cy="5.5" r="2"/><path d="M14 9.5c2.2 0 4 1.8 4 4v2.5"/></svg>',
        world: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="10" cy="10" r="8"/><ellipse cx="10" cy="10" rx="3.5" ry="8"/><path d="M2 10h16"/></svg>',
        eval: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="11" width="3.5" height="6.5" rx="1"/><rect x="8.25" y="6" width="3.5" height="11.5" rx="1"/><rect x="14" y="2.5" width="3.5" height="15" rx="1"/></svg>',
        settings: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="10" cy="10" r="2.5"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3M4.2 4.2l2.1 2.1M13.7 13.7l2.1 2.1M4.2 15.8l2.1-2.1M13.7 6.3l2.1-2.1"/></svg>',
        logs: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 5.5h12M4 10h12M4 14.5h8"/></svg>',
    };

    /**
     * @constant {Array<Object>} FC_TOOLS
     * @description OpenAI Function Calling 工具定义数组（玩家可用工具）。
     *   每个元素遵循 OpenAI tool schema 格式：{ type: 'function', function: { name, description, parameters } }。
     *   包含的工具：move（移动）、attack（攻击）、speak（说话）、search（搜索）、
     *   pickup_item（拾取）、use_item（使用物品）、inspect（查看）、rest（休息）、
     *   narrate（叙述/内心独白）、complete_turn（结束回合）。
     */
    const FC_TOOLS = [
        { type: 'function', function: { name: 'move', description: '移动到指定地点', parameters: { type: 'object', properties: { destination: { type: 'string', description: '目标地点ID' } }, required: ['destination'] } } },
        { type: 'function', function: { name: 'attack', description: '攻击敌人或角色', parameters: { type: 'object', properties: { target: { type: 'string', description: '目标ID' } }, required: ['target'] } } },
        { type: 'function', function: { name: 'speak', description: '对某人说话', parameters: { type: 'object', properties: { to: { type: 'string', description: '对象ID' }, message: { type: 'string', description: '内容' } }, required: ['to', 'message'] } } },
        { type: 'function', function: { name: 'search', description: '搜索当前地点', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'pickup_item', description: '拾取物品', parameters: { type: 'object', properties: { target: { type: 'string', description: '物品ID' } }, required: ['target'] } } },
        { type: 'function', function: { name: 'use_item', description: '使用背包物品', parameters: { type: 'object', properties: { item: { type: 'string', description: '物品ID' } }, required: ['item'] } } },
        { type: 'function', function: { name: 'inspect', description: '查看详情', parameters: { type: 'object', properties: { target: { type: 'string', description: '目标ID' } }, required: ['target'] } } },
        { type: 'function', function: { name: 'rest', description: '休息恢复HP', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'narrate', description: '叙述/内心独白', parameters: { type: 'object', properties: { text: { type: 'string', description: '叙述内容' } }, required: ['text'] } } },
        { type: 'function', function: { name: 'complete_turn', description: '结束本回合', parameters: { type: 'object', properties: { summary: { type: 'string', description: '回合总结' } } } } },
    ];

    /**
     * @constant {Array<Object>} GM_FC_TOOLS
     * @description GM（游戏主持人）专用的 Function Calling 工具定义数组。
     *   包含：narrate_event（叙述剧情事件）、spawn_enemy（生成敌人）、
     *   heal_character（治疗角色）、damage_character（环境伤害）。
     */
    const GM_FC_TOOLS = [
        { type: 'function', function: { name: 'narrate_event', description: '叙述环境/剧情事件', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
        { type: 'function', function: { name: 'spawn_enemy', description: '在地点生成敌人', parameters: { type: 'object', properties: { enemy_id: { type: 'string' }, location: { type: 'string' } }, required: ['enemy_id', 'location'] } } },
        { type: 'function', function: { name: 'heal_character', description: '治疗角色', parameters: { type: 'object', properties: { target: { type: 'string' }, amount: { type: 'number' } }, required: ['target', 'amount'] } } },
        { type: 'function', function: { name: 'damage_character', description: '环境伤害', parameters: { type: 'object', properties: { target: { type: 'string' }, amount: { type: 'number' }, reason: { type: 'string' } }, required: ['target', 'amount'] } } },
    ];

    /**
     * @constant {Object.<string, string>} TL
     * @description 工具名称到中文标签的翻译映射表，用于 UI 中展示友好的工具名称。
     */
    const TL = { move:'移动',search:'搜索',pickup_item:'拾取',attack:'攻击',speak:'说话',narrate:'叙述',inspect:'查看',use_item:'使用',rest:'休息',complete_turn:'结束',interact:'交流',narrate_event:'GM叙述',spawn_enemy:'GM生成',heal_character:'GM治疗',damage_character:'GM伤害' };

    /**
     * @constant {Object.<string, string>} TC
     * @description 工具名称到 CSS 颜色值的映射表，用于 UI 消息标签的颜色区分。
     */
    const TC = { move:'#c9a24d',search:'#b08ee6',pickup_item:'#7ec89a',attack:'#d47070',speak:'#dbb866',narrate:'#a09486',inspect:'#8ab4f8',use_item:'#5ec6c6',rest:'#8b8cf8',complete_turn:'#6a6258',interact:'#dbb866',narrate_event:'#b08ee6',spawn_enemy:'#d47070',heal_character:'#7ec89a',damage_character:'#d47070' };

    /**
     * @constant {Object.<number, string>} ERR_HINTS
     * @description HTTP 状态码到中文友好错误提示的映射表，用于 LLM API 调用失败时的用户反馈。
     */
    const ERR_HINTS = {
        401: '认证失败：请检查 API Key 是否正确。',
        403: '权限不足：当前 Key 无权访问此模型。',
        404: '接口不存在：请检查 API 地址是否正确。',
        429: '请求过多：已触发速率限制，请稍后再试。',
        500: '服务器内部错误，请稍后重试。',
        502: '网关错误：API 服务可能暂时不可用。',
        503: '服务不可用：API 正在维护中。',
    };

    // ══════════════════════════════════════════════════════════════
    //  PART 1 — 场景模板
    //
    //  本部分定义了游戏可选的场景（SCENARIOS）和默认提示词模板。
    //  每个场景包含完整的世界数据（地点图、物品表、敌人表）、
    //  预设的 Agent 角色、敌人初始位置映射以及胜利/失败判定函数。
    //  当前内置两个场景：rpg（地牢冒险）和 lostcity（失落之城）。
    // ══════════════════════════════════════════════════════════════

    /**
     * @constant {Object.<string, Object>} SCENARIOS
     * @description 场景模板字典。键为场景 ID，值为完整的场景定义对象。
     *
     * 每个场景对象结构：
     * @property {string} name - 场景显示名称
     * @property {string} icon - 场景图标（Emoji）
     * @property {string} desc - 场景简短描述
     * @property {Object} world - 世界数据，包含 locations（地点图）、items（物品表）、enemies（敌人表）
     * @property {Array<Object>} agents - 预设 NPC Agent 列表，每个含 id/name/icon/role/hp/atk/def/location/inventory/gold/priority/prompt/bonuses
     * @property {Object} enemyHome - 敌人 ID → 初始地点 ID 的映射，用于 GM 回合中敌人重生
     * @property {function} checkGoal - 胜利/失败条件判定函数，返回 {done: boolean, reason: string}
     */
    const SCENARIOS = {
        rpg: {
            name:'地牢冒险',icon:'⚔️',desc:'经典RPG冒险，探索地牢击败恶魔',
            world:{locations:{village:{name:'村庄',desc:'宁静的小村庄，有旅馆和补给。',conn:['forest','dungeon_entrance'],items:['healing_potion','bread'],enemies:[]},forest:{name:'迷雾森林',desc:'茂密森林，草药与陷阱并存。',conn:['village','cave'],items:['herbs','arrows'],enemies:['wolf','goblin']},dungeon_entrance:{name:'地牢入口',desc:'阴冷入口，骷髅把守。',conn:['village','dungeon_hall'],items:[],enemies:['skeleton']},dungeon_hall:{name:'地牢大厅',desc:'终点大厅，魔剑与恶魔在此。',conn:['dungeon_entrance'],items:['magic_sword','gold_coin'],enemies:['demon','vampire']},cave:{name:'神秘山洞',desc:'法力充沛，魔法威力翻倍。',conn:['forest'],items:['magic_crystal','ancient_scroll'],enemies:['cave_troll']}},items:{healing_potion:{name:'治疗药水',effect:'heal',val:30},bread:{name:'面包',effect:'heal',val:10},herbs:{name:'草药',effect:'heal',val:15},arrows:{name:'箭矢',effect:'weapon',val:5},magic_sword:{name:'魔法剑',effect:'weapon',val:25},gold_coin:{name:'金币',effect:'currency',val:10},magic_crystal:{name:'魔法水晶',effect:'magic',val:20},ancient_scroll:{name:'古老卷轴',effect:'magic',val:30}},enemies:{wolf:{name:'灰狼',hp:30,maxHp:30,dmg:15,reward:5},goblin:{name:'哥布林',hp:25,maxHp:25,dmg:10,reward:8},skeleton:{name:'骷髅',hp:40,maxHp:40,dmg:18,reward:12},demon:{name:'恶魔',hp:60,maxHp:60,dmg:25,reward:20},vampire:{name:'吸血鬼',hp:50,maxHp:50,dmg:22,reward:18},cave_troll:{name:'山洞巨魔',hp:70,maxHp:70,dmg:30,reward:25}}},
            agents:[{id:'warrior',name:'战士阿强',icon:'⚔️',role:'战士',hp:100,maxHp:100,atk:30,def:5,location:'village',inventory:['bread'],gold:10,priority:1,prompt:'你是战士阿强，勇猛善战。目标：探索地牢、击败恶魔。',bonuses:{magic_sword:25,cave:0}},{id:'mage',name:'法师小慧',icon:'🔮',role:'法师',hp:70,maxHp:70,atk:20,def:0,location:'village',inventory:['ancient_scroll'],gold:15,priority:2,prompt:'你是法师小慧，擅长搜索与魔法攻击。目标：收集魔法材料，协助击败敌人。',bonuses:{magic_sword:0,cave:20}}],
            enemyHome:{wolf:'forest',goblin:'forest',skeleton:'dungeon_entrance',cave_troll:'cave'},
            checkGoal(a,W){if(a.location==='dungeon_hall'&&!(W.locations.dungeon_hall?.enemies||[]).length)return{done:true,reason:'地牢大厅已清空，任务完成！'};if(a.hp<=0)return{done:true,reason:'HP归零'};return{done:false}},
        },
        lostcity: {
            name:'失落之城',icon:'🏛️',desc:'探索远古遗迹，击败巨龙夺取宝藏',
            world:{locations:{ruins_gate:{name:'废墟大门',desc:'残破的巨型石门。',conn:['shadow_hall','watchtower'],items:['torch','ancient_map'],enemies:['stone_golem']},shadow_hall:{name:'暗影长廊',desc:'幽暗的走廊。',conn:['ruins_gate','trap_room','treasure_room'],items:['rope'],enemies:['shadow_bat']},trap_room:{name:'机关密室',desc:'布满陷阱。',conn:['shadow_hall'],items:['gem'],enemies:['mech_guard']},treasure_room:{name:'宝藏室',desc:'金光闪闪的宝藏室。',conn:['shadow_hall','dragon_lair'],items:['life_spring','dragon_gem'],enemies:[]},dragon_lair:{name:'龙之巢穴',desc:'炙热的巢穴。',conn:['treasure_room'],items:['dragon_scale'],enemies:['ancient_dragon']},watchtower:{name:'瞭望塔',desc:'可俯瞰全城遗迹。',conn:['ruins_gate'],items:['eagle_eye'],enemies:[]}},items:{torch:{name:'火炬',effect:'weapon',val:5},ancient_map:{name:'古代地图',effect:'info',val:0},rope:{name:'绳索',effect:'tool',val:0},gem:{name:'宝石',effect:'currency',val:20},life_spring:{name:'生命源泉',effect:'heal',val:50},dragon_gem:{name:'龙之宝石',effect:'magic',val:40},dragon_scale:{name:'龙鳞甲',effect:'armor',val:15},eagle_eye:{name:'鹰眼望远镜',effect:'info',val:0}},enemies:{stone_golem:{name:'石像怪',hp:50,maxHp:50,dmg:20,reward:15},shadow_bat:{name:'暗影蝙蝠',hp:20,maxHp:20,dmg:10,reward:5},mech_guard:{name:'机械守卫',hp:60,maxHp:60,dmg:25,reward:20},ancient_dragon:{name:'远古巨龙',hp:120,maxHp:120,dmg:40,reward:60}}},
            agents:[{id:'thief',name:'盗贼小李',icon:'🗡️',role:'盗贼',hp:80,maxHp:80,atk:25,def:0,location:'ruins_gate',inventory:['rope'],gold:5,priority:1,prompt:'你是盗贼小李，身手敏捷。目标：探索遗迹、协助击败巨龙。',bonuses:{sneak:15}},{id:'scholar',name:'学者老王',icon:'📖',role:'学者',hp:60,maxHp:60,atk:15,def:0,location:'ruins_gate',inventory:['ancient_map'],gold:20,priority:2,prompt:'你是学者老王，博学多才。目标：解读古文、支援战斗。',bonuses:{}}],
            enemyHome:{stone_golem:'ruins_gate',shadow_bat:'shadow_hall',mech_guard:'trap_room'},
            checkGoal(a,W){if(a.location==='dragon_lair'&&!(W.locations.dragon_lair?.enemies||[]).length)return{done:true,reason:'远古巨龙已被击败！'};if(a.hp<=0)return{done:true,reason:'HP归零'};return{done:false}},
        },
    };

    /**
     * @constant {Object} DEFAULT_PROMPTS
     * @description 默认提示词模板集合，用于 ReAct 模式下构建 Agent 的系统提示词。
     * @property {string} systemPrompt  - Agent 系统角色提示词
     * @property {string} toolsDesc     - 可用工具列表描述
     * @property {string} outputFormat  - Agent 输出格式要求（THOUGHT + ACTION）
     * @property {string} envNarrations - 环境叙述候选文本（换行分隔，GM 回退时随机选取）
     */
    const DEFAULT_PROMPTS={systemPrompt:'你是文字RPG中的自由Agent。THOUGHT表达想法，ACTION可以是自然语言或JSON格式游戏操作。',toolsDesc:'【可用操作】move/search/pickup_item/attack/speak/narrate/inspect/use_item/rest/complete_turn',outputFormat:'THOUGHT: [想法]\nACTION: [JSON或自然语言]',envNarrations:'🌧️ 暴雨倾盆。\n🌟 神秘光芒笼罩。\n💨 深处传来怒吼。\n🌙 夜幕降临。\n☀️ 晨光破晓。'};

    // ══════════════════════════════════════════════════════════════
    //  PART 2 — 状态 & 配置
    //
    //  本部分管理系统的全局运行时状态（G 对象）、性能指标（METRICS）、
    //  日志系统（LOG + addLog）、配置读写（通过 SillyTavern extensionSettings 持久化）、
    //  游戏存档/读档（localStorage）、HUD 状态持久化、以及一系列工具函数。
    // ══════════════════════════════════════════════════════════════

    /**
     * @description 全局运行时状态对象，保存游戏循环的所有关键数据。
     * @type {Object}
     * @property {boolean} running        - 游戏是否正在运行
     * @property {boolean} paused         - 游戏是否处于暂停状态
     * @property {boolean} stopReq        - 是否收到停止请求
     * @property {number}  round          - 当前回合数
     * @property {number}  curIdx         - 当前执行中的 NPC Agent 索引
     * @property {Array}   agents         - NPC Agent 实例列表
     * @property {Object|null} userAgent  - 玩家角色实例
     * @property {Object|null} world      - 当前世界状态（locations/items/enemies 的可变副本）
     * @property {boolean} inited         - 游戏是否已初始化
     * @property {Array}   msgQueue       - Agent 间消息队列
     * @property {Array}   actionsHistory - 行动历史记录（用于上下文构建和 UI 展示）
     * @property {boolean} waitingForUser - 是否正在等待玩家输入
     * @property {function|null} userActionResolve - 玩家输入 Promise 的 resolve 回调
     * @property {string}  currentPage    - 当前显示的仪表盘页面 ID
     * @property {boolean} gmEnabled      - GM Agent 是否启用
     */
    let G={running:false,paused:false,stopReq:false,round:0,curIdx:0,agents:[],userAgent:null,world:null,inited:false,msgQueue:[],actionsHistory:[],waitingForUser:false,userActionResolve:null,currentPage:'dashboard',gmEnabled:true};

    /**
     * @description 日志缓冲数组，存储系统运行时的详细日志条目
     * @type {Array<{ts: string, level: string, msg: string}>}
     */
    let LOG=[];

    /**
     * @description 性能指标收集对象，用于评估页面展示和自动测试。
     * @type {Object}
     * @property {number} llmCalls      - LLM 调用总次数
     * @property {number} toolCalls     - 游戏工具执行总次数
     * @property {number} fcCalls       - Function Calling 模式的 LLM 调用次数
     * @property {number} textCalls     - ReAct 文本模式的 LLM 调用次数
     * @property {number} turns         - Agent 回合总数
     * @property {number} rounds        - 游戏轮次总数
     * @property {number} errors        - 错误发生次数
     * @property {number} totalResponseMs - LLM 响应总耗时（毫秒）
     * @property {number} successes     - 成功事件计数（如击败敌人、完成目标）
     * @property {number} failures      - 失败事件计数（如全员阵亡）
     */
    let METRICS={llmCalls:0,toolCalls:0,fcCalls:0,textCalls:0,turns:0,rounds:0,errors:0,totalResponseMs:0,successes:0,failures:0};

    /** @type {AbortController|null} activeAbort - 当前活动的 AbortController，用于取消进行中的 LLM 请求 */
    let activeAbort = null;

    /** @type {number|null} logTimer - 日志渲染节流定时器 ID */
    let logTimer = null;

    /**
     * @description 添加一条日志到缓冲区。使用 150ms 节流定时器延迟渲染，避免高频刷新。
     *   当日志超过 2000 条时自动裁剪前 500 条。
     * @param {string} m - 日志消息文本
     * @param {string} [l='info'] - 日志级别（'info' | 'warn' | 'error'）
     * @returns {void}
     */
    function addLog(m,l='info'){
        const t=new Date().toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
        const ms=String(Date.now()%1000).padStart(3,'0');
        LOG.push({ts:`${t}.${ms}`,level:l,msg:String(m)});
        if(LOG.length>2000)LOG.splice(0,500);
        if(!logTimer) logTimer = setTimeout(()=>{logTimer=null;renderLogs();}, 150);
    }

    /**
     * @description 获取并确保当前模块的配置对象存在于 SillyTavern extensionSettings 中。
     *   首次调用时会用默认值填充缺失字段。返回配置对象的引用（可直接修改）。
     * @returns {Object} 当前模块的配置对象，包含 apiUrl/apiKey/apiModel/maxRounds/scenario 等字段
     */
    function cfg(){
        const{extensionSettings:e}=SillyTavern.getContext();
        if(!e[MODULE])e[MODULE]={apiUrl:'',apiKey:'',apiModel:'gpt-4o-mini',maxRounds:10,stepDelay:1000,maxSteps:5,llmTimeout:60000,worldInfo:'',worldInfoSelected:[],scenario:'rpg',useFunctionCalling:true,gmEnabled:true,userName:'玩家',userIcon:'👤',agents:null,promptTemplates:null,msgChannel:'both'};
        const s=e[MODULE];
        if(!s.scenario)s.scenario='rpg';
        if(s.useFunctionCalling===undefined)s.useFunctionCalling=true;
        if(s.gmEnabled===undefined)s.gmEnabled=true;
        if(!s.maxSteps)s.maxSteps=5;
        if(!s.stepDelay)s.stepDelay=1000;
        if(!s.llmTimeout)s.llmTimeout=60000;
        if(!s.userName)s.userName='玩家';
        if(!s.userIcon)s.userIcon='👤';
        if(!s.msgChannel)s.msgChannel='both';
        const sc=SCENARIOS[s.scenario]||SCENARIOS.rpg;
        if(!s.agents)s.agents=JSON.parse(JSON.stringify(sc.agents));
        if(!s.promptTemplates)s.promptTemplates={...DEFAULT_PROMPTS};
        return s;
    }

    /**
     * @description 获取指定键名的提示词模板内容，优先从用户自定义模板获取，回退到默认值。
     * @param {string} k - 提示词模板键名（如 'systemPrompt'、'toolsDesc' 等）
     * @returns {string} 对应的提示词模板文本
     */
    function pt(k){return(cfg().promptTemplates||{})[k]??(DEFAULT_PROMPTS[k]??'');}

    /**
     * @description 调用 SillyTavern 的防抖保存函数，将当前配置持久化到服务器。
     * @returns {void}
     */
    function saveCfg(){SillyTavern.getContext().saveSettingsDebounced();}

    /**
     * @description HTML 实体转义函数，防止 XSS 注入。转义 &、<、>、" 四种字符。
     * @param {*} s - 待转义的值（会先转为字符串）
     * @returns {string} 转义后的安全 HTML 字符串
     */
    function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

    /**
     * @description HTML 属性值转义函数，仅转义双引号。用于 DOM 属性中嵌入用户文本。
     * @param {*} s - 待转义的值
     * @returns {string} 转义后的字符串
     */
    function escA(s){return String(s||'').replace(/"/g,'&quot;');}

    /**
     * @description 异步休眠函数，返回一个指定毫秒后 resolve 的 Promise。
     * @param {number} ms - 休眠时长（毫秒）
     * @returns {Promise<void>}
     */
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

    /**
     * @description 等待暂停恢复。每 200ms 轮询检查 G.paused 状态，
     *   直到取消暂停或游戏停止运行时 resolve。
     * @returns {Promise<void>}
     */
    function waitResume(){return new Promise(r=>{const id=setInterval(()=>{if(!G.paused||!G.running){clearInterval(id);r();}},200);});}

    /**
     * @description 获取当前配置中选定的场景模板对象。
     * @returns {Object} 场景模板对象（SCENARIOS 中的某个值）
     */
    function getScenario(){return SCENARIOS[cfg().scenario]||SCENARIOS.rpg;}

    /**
     * @description 获取当前世界模板数据。优先使用用户自定义的 worldTpl JSON，
     *   若解析失败或不完整则回退到当前场景的默认世界数据（深拷贝）。
     * @returns {Object} 世界模板对象，包含 locations、items、enemies
     */
    function getWorldTpl(){
        const t=cfg().promptTemplates||{};
        try{const p=JSON.parse(t.worldTpl||'{}');if(p.locations&&p.items&&p.enemies)return p;}catch(_){}
        return JSON.parse(JSON.stringify(getScenario().world));
    }

    /**
     * @description 从 SillyTavern 服务端获取所有 World Info 文件名列表。
     * @returns {Promise<string[]>} World Info 文件名数组，获取失败时返回空数组
     */
    async function getSTWorldInfoNames(){try{const{getRequestHeaders:h}=SillyTavern.getContext();const r=await fetch('/api/settings/get',{method:'POST',headers:h(),body:JSON.stringify({})});if(!r.ok)throw new Error(r.status);return(await r.json()).world_names||[];}catch(e){addLog(`WI列表失败:${e.message}`,'warn');return[];}}

    /**
     * @description 加载指定名称的 SillyTavern World Info 文件，将其中所有条目的 content 合并为单个字符串。
     * @param {string} n - World Info 文件名称
     * @returns {Promise<string|null>} 合并后的内容字符串，失败时返回 null
     */
    async function loadSTWorldInfoFile(n){if(!n?.trim())return null;try{const{getRequestHeaders:h}=SillyTavern.getContext();const r=await fetch('/api/worldinfo/get',{method:'POST',headers:h(),body:JSON.stringify({name:n.trim()})});if(!r.ok)throw new Error(r.status);const d=await r.json();const entries=d.entries||d;return(typeof entries==='object'?Object.values(entries):[]).map(e=>e.content||'').filter(Boolean).join('\n');}catch(_){return null;}}

    /**
     * @description 将当前游戏状态保存到 localStorage 的指定槽位。
     *   保存内容包括：回合数、所有角色状态、世界状态、指标、近期历史和消息队列。
     *   会截取 actionsHistory 最后 20 条和 msgQueue 最后 30 条以控制存档大小。
     * @param {number} slot - 存档槽位编号（1-3）
     * @returns {void}
     */
    function saveGame(slot){
        if(!G.world){addLog('SAVE FAIL: world not initialized','error');postSystemMsg('❌ 存档失败：请先初始化世界','error');return;}
        try{
            const compact={
                round:G.round, agents:G.agents, userAgent:G.userAgent, world:G.world,
                metrics:{...METRICS},
                actionsHistory:G.actionsHistory.slice(-20),
                msgQueue:G.msgQueue.slice(-30),
                gmEnabled:G.gmEnabled,
                ts:new Date().toLocaleString('zh-CN')
            };
            const json=JSON.stringify(compact);
            addLog(`SAVE slot=${slot} round=${G.round} size=${(json.length/1024).toFixed(1)}KB`);
            localStorage.setItem(`${SAVE_KEY}_${slot}`,json);
            updateSaveInfo();
            addLog(`  → OK`);
            postSystemMsg(`💾 已存档（槽位${slot}，第${G.round}轮，${(json.length/1024).toFixed(0)}KB）`);
        }catch(e){
            addLog(`SAVE ERROR: ${e.message}`,'error');
            postSystemMsg(`❌ 存档失败: ${e.name==='QuotaExceededError'?'存储空间不足，请清理旧存档':e.message}`,'error');
        }
    }

    /**
     * @description 从 localStorage 的指定槽位读取并恢复游戏状态。
     *   恢复后游戏处于停止状态，需手动点击"开始"继续。
     *   若读取的槽位为空或 JSON 损坏则给出相应提示。
     * @param {number} slot - 存档槽位编号（1-3）
     * @returns {void}
     */
    function loadGame(slot){
        const raw=localStorage.getItem(`${SAVE_KEY}_${slot}`);
        if(!raw){addLog(`LOAD slot=${slot}: empty`,'warn');postSystemMsg(`⚠️ 槽位${slot}无存档`,'warn');return;}
        try{
            addLog(`LOAD slot=${slot} size=${(raw.length/1024).toFixed(1)}KB`);
            if(G.running)doStop();
            const d=JSON.parse(raw);
            G.round=d.round||0;
            G.agents=d.agents||[];
            G.userAgent=d.userAgent||null;
            G.world=d.world;
            G.inited=true;
            G.running=false;G.paused=false;G.stopReq=false;G.waitingForUser=false;G.userActionResolve=null;
            G.actionsHistory=d.actionsHistory||[];
            G.msgQueue=d.msgQueue||[];
            G.gmEnabled=d.gmEnabled!==undefined?d.gmEnabled:true;
            if(d.metrics)Object.assign(METRICS,d.metrics);
            const chatEl=document.getElementById('mac-game-chat');
            if(chatEl)chatEl.innerHTML='';
            updateAll();
            const W=G.world,all=[...(G.userAgent?[G.userAgent]:[]),...G.agents];
            const summary=all.map(a=>`${a.icon}${a.name} HP:${a.hp}/${a.maxHp} @${W?.locations?.[a.location]?.name||a.location}`).join(' | ');
            postSystemMsg(`📂 读档成功（槽位${slot}，第${d.round}轮）`);
            postSystemMsg(`👥 ${summary}`);
            postSystemMsg('▶ 点击"开始"继续游戏');
            addLog(`  → OK round=${d.round} agents=${G.agents.length}`);
            navigateTo('game');
        }catch(e){
            addLog(`LOAD ERROR: ${e.message}`,'error');
            postSystemMsg(`❌ 读档失败: ${e.message}`,'error');
        }
    }

    /**
     * @description 获取指定存档槽位的摘要信息字符串（用于 UI 显示）。
     * @param {number} i - 存档槽位编号
     * @returns {string} 摘要信息，如 "第5轮 2024/1/1 12:00:00"，空槽返回 "空"
     */
    function getSaveInfo(i){const r=localStorage.getItem(`${SAVE_KEY}_${i}`);if(!r)return'空';try{const d=JSON.parse(r);return`第${d.round}轮 ${d.ts||''}`;}catch(_){return'损坏';}}

    /**
     * @description 更新 UI 上三个存档槽位的信息显示。
     * @returns {void}
     */
    function updateSaveInfo(){[1,2,3].forEach(i=>{const e=document.getElementById(`mac-si-${i}`);if(e)e.textContent=getSaveInfo(i);});}

    /**
     * @description 保存 HUD 状态补丁到 localStorage（合并更新），用于持久化 HUD 位置和折叠状态。
     * @param {Object} patch - 要合并的状态补丁，如 { left, top, collapsed }
     * @returns {void}
     */
    function saveHudState(patch){
        try{const cur=JSON.parse(localStorage.getItem(HUD_KEY)||'{}');Object.assign(cur,patch);localStorage.setItem(HUD_KEY,JSON.stringify(cur));}catch(_){}
    }

    /**
     * @description 从 localStorage 加载已保存的 HUD 状态。
     * @returns {Object} HUD 状态对象，可能包含 left/top/collapsed 等字段
     */
    function loadHudState(){try{return JSON.parse(localStorage.getItem(HUD_KEY)||'{}');}catch(_){return{};}}

    // ══════════════════════════════════════════════════════════════
    //  PART 3 — 游戏引擎（数据驱动战斗）
    //
    //  本部分实现了游戏核心逻辑：
    //  - resetGame: 根据配置和场景模板重置整个游戏世界和角色状态
    //  - resolveId: 模糊 ID 匹配（支持按名称子串查找地点/物品/敌人/角色）
    //  - resolveParams: 批量解析工具调用参数中的 ID 引用
    //  - calcDamage: 数据驱动的伤害计算（基础攻击力 + 装备/地点/技能加成）
    //  - executeTool: 执行 10+ 种玩家工具的核心分发函数
    //  - executeGMTool: 执行 GM 专用工具
    //  - broadcastEvent: 向目标角色及同地点旁观者广播事件消息
    // ══════════════════════════════════════════════════════════════

    /**
     * @description 重置游戏到初始状态。根据当前配置的场景模板深拷贝世界数据，
     *   创建所有 NPC Agent 实例和玩家角色实例，重置回合数和各项状态标志。
     * @returns {void}
     */
    function resetGame(){
        const s=cfg();
        const worldData = getWorldTpl();
        G.world=JSON.parse(JSON.stringify(worldData));
        G.agents=s.agents.map(a=>{
            const base=JSON.parse(JSON.stringify(a));
            return{...base,hp:base.maxHp||100,maxHp:base.maxHp||100,atk:base.atk||20,def:base.def||0,bonuses:base.bonuses||{},location:base.location||Object.keys(worldData.locations)[0],inventory:[...(base.inventory||[])],gold:base.gold||0};
        });
        G.userAgent={id:'user',name:s.userName,icon:s.userIcon,role:'主角',hp:100,maxHp:100,atk:20,def:0,bonuses:{},location:Object.keys(worldData.locations)[0],inventory:[Object.keys(worldData.items)[0]],gold:20};
        G.round=0;G.curIdx=0;G.actionsHistory=[];G.running=false;G.paused=false;G.stopReq=false;G.inited=true;G.waitingForUser=false;G.userActionResolve=null;G.gmEnabled=s.gmEnabled;
    }

    /**
     * @description 模糊 ID 解析函数。在指定类型（location/item/enemy/agent）的数据中
     *   查找匹配的实体 ID，支持精确 ID 匹配和名称子串模糊匹配。
     * @param {Object} W - 世界状态对象
     * @param {string} type - 实体类型：'location' | 'item' | 'enemy' | 'agent'
     * @param {string} name - 用户输入的名称或 ID（会转小写后匹配）
     * @returns {string|null} 匹配到的实体 ID，未找到返回 null
     */
    function resolveId(W,type,name){if(!name||!W)return null;const n=String(name).trim().toLowerCase();const maps={location:W.locations,item:W.items,enemy:W.enemies};const m=maps[type];if(m)for(const[id,o]of Object.entries(m))if(id===n||(o.name&&o.name.toLowerCase().includes(n)))return id;if(type==='agent')for(const a of[...(G.userAgent?[G.userAgent]:[]),...G.agents])if(a.id===n||(a.name&&a.name.toLowerCase().includes(n)))return a.id;return null;}

    /**
     * @description 批量解析工具调用参数中的实体 ID 引用。根据工具类型将参数中的
     *   destination/target/to/item 等字段通过 resolveId 进行模糊匹配替换。
     * @param {Object} W - 世界状态对象
     * @param {string} tool - 工具名称
     * @param {Object} params - 原始参数对象
     * @returns {Object} 解析后的参数对象（新对象，不修改原始参数）
     */
    function resolveParams(W,tool,params){const p={...params};if(tool==='move'&&p.destination)p.destination=resolveId(W,'location',p.destination)||p.destination;if(tool==='attack'&&p.target)p.target=resolveId(W,'enemy',p.target)||resolveId(W,'agent',p.target)||p.target;if(['pickup_item','pickup','take'].includes(tool)&&p.target)p.target=resolveId(W,'item',p.target)||p.target;if(tool==='use_item'&&p.item)p.item=resolveId(W,'item',p.item)||p.item;if(['speak','interact'].includes(tool)){if(p.to)p.to=resolveId(W,'agent',p.to)||p.to;if(p.agent)p.agent=resolveId(W,'agent',p.agent)||p.agent;}if(tool==='inspect'&&p.target)p.target=resolveId(W,'item',p.target)||resolveId(W,'location',p.target)||resolveId(W,'enemy',p.target)||p.target;return p;}

    /**
     * @description 数据驱动的伤害计算函数。基础伤害为 agent.atk，
     *   再累加 bonuses 中与当前持有物品、所在地点或特殊技能匹配的加成值。
     * @param {Object} agent - 执行攻击的角色对象
     * @returns {number} 计算后的总伤害值
     */
    function calcDamage(agent){
        let dmg = agent.atk || 20;
        const bon = agent.bonuses || {};
        for(const[key,val] of Object.entries(bon)){
            if(agent.inventory.includes(key)) dmg += val;
            if(agent.location === key) dmg += val;
            if(key === 'sneak') dmg += val;
        }
        return dmg;
    }

    /**
     * @description 核心工具执行分发函数。根据工具名称执行对应的游戏逻辑并返回结果文本。
     *   支持的工具：move（移动）、search（搜索）、pickup_item（拾取）、attack（攻击，
     *   支持攻击敌人和攻击其他角色）、speak/interact（对话并广播消息）、narrate（叙述）、
     *   inspect（查看详情）、use_item（使用物品，支持 heal 效果）、rest（休息恢复 HP）、
     *   complete_turn（结束回合）。default 分支尝试将未知工具名映射到已知工具。
     * @param {Object} agent - 执行工具的角色对象
     * @param {string} tool - 工具名称
     * @param {Object} params - 工具参数
     * @returns {string} 执行结果的描述文本
     */
    function executeTool(agent,tool,params){
        const W=G.world,loc=W.locations[agent.location];
        switch(tool){
        case'move':{let d=params.destination;if(d&&!W.locations[d])d=resolveId(W,'location',d)||d;if(!W.locations[d])return`未知地点"${params.destination}"。可前往: ${loc.conn.map(c=>`${W.locations[c].name}(${c})`).join(', ')}`;if(!loc.conn.includes(d))return`不能从【${loc.name}】到【${W.locations[d].name}】`;agent.location=d;const nl=W.locations[d];let r=`移动至【${nl.name}】。${nl.desc}`;if(nl.enemies.length)r+=` ⚠️ 遭遇: ${nl.enemies.map(e=>W.enemies[e]?.name||e).join('、')}！`;if(nl.items.length)r+=` 💎 地面: ${nl.items.map(i=>W.items[i]?.name||i).join('、')}`;return r;}
        case'search':{if(!loc.items.length)return`在【${loc.name}】没找到物品。`;const id=loc.items.shift();agent.inventory.push(id);return`发现【${W.items[id]?.name||id}】！`;}
        case'pickup_item':case'pickup':case'take':{let t=params.target||params.item;if(t&&!W.items[t])t=resolveId(W,'item',t)||t;if(!t||!W.items[t])return'无效物品。';const idx=loc.items.indexOf(t);if(idx===-1)return`地面没有"${t}"。`;loc.items.splice(idx,1);agent.inventory.push(t);return`拾取【${W.items[t].name}】！`;}
        case'attack':{
            let t=params.target;if(t&&!loc.enemies.includes(t))t=resolveId(W,'enemy',t)||t;
            if(loc.enemies.includes(t)){
                const en=W.enemies[t];
                const dmg=calcDamage(agent);
                en.hp-=dmg;
                if(en.hp<=0){loc.enemies=loc.enemies.filter(e=>e!==t);agent.gold+=en.reward;W.enemies[t].hp=en.maxHp;METRICS.successes++;return`对【${en.name}】造成${dmg}伤害，击败！+${en.reward}金币 💰${agent.gold}`;}
                const taken=Math.max(0,en.dmg-(agent.def||0));agent.hp=Math.max(0,agent.hp-taken);W.enemies[t].hp=en.hp;
                return`对【${en.name}】造成${dmg}伤害(HP:${en.hp})。反击${taken}伤害，HP:${agent.hp}/${agent.maxHp}`;
            }
            const all=[...(G.userAgent?[G.userAgent]:[]),...G.agents];
            const tgt=all.find(a=>a&&a.hp>0&&a.location===agent.location&&a.id!==agent.id&&(a.id===t||a.name===t));
            if(tgt){const dmg=calcDamage(agent);tgt.hp=Math.max(0,tgt.hp-dmg);broadcastEvent(agent,tgt.id,`（${agent.name}攻击了你，${dmg}伤害）`);return`对【${tgt.name}】造成${dmg}伤害。HP:${tgt.hp}/${tgt.maxHp}`;}
            return`没有"${params.target}"。`;
        }
        case'interact':case'speak':{const all=[...(G.userAgent?[G.userAgent]:[]),...G.agents];const who=params.agent||params.to;let tgt=all.find(a=>a&&(a.id===who||a.name===who));if(!tgt&&who)tgt=all.find(a=>a&&resolveId(null,'agent',who)===a.id);if(!tgt)return`找不到"${who}"。`;const msg=params.message||params.text||'';if(msg)broadcastEvent(agent,tgt.id,msg);return`对${tgt.icon}${tgt.name}说："${msg}"`;}
        case'narrate':return params.text?`【${agent.name}】${params.text}`:'（无叙述）';
        case'inspect':{let t=params.target;if(t&&!W.items[t]&&!W.locations[t]&&!W.enemies[t])t=resolveId(W,'item',t)||resolveId(W,'location',t)||resolveId(W,'enemy',t)||t;if(W.items[t])return`【${W.items[t].name}】: ${W.items[t].effect},值=${W.items[t].val}`;if(W.locations[t])return`【${W.locations[t].name}】: ${W.locations[t].desc}`;if(W.enemies[t])return`【${W.enemies[t].name}】: HP=${W.enemies[t].hp}/${W.enemies[t].maxHp}`;return`"${t}"无详细信息。`;}
        case'use_item':{let iid=params.item;if(iid&&!agent.inventory.includes(iid))iid=resolveId(W,'item',iid)||iid;if(!agent.inventory.includes(iid))return`背包没有"${iid}"。`;const item=W.items[iid];if(!item)return'无效物品。';if(item.effect==='heal'){const h=Math.min(item.val,agent.maxHp-agent.hp);agent.hp+=h;agent.inventory=agent.inventory.filter(i=>i!==iid);return`使用【${item.name}】，+${h}HP (${agent.hp}/${agent.maxHp})`;}return`使用【${item.name}】`;}
        case'rest':{const h=Math.min(20,agent.maxHp-agent.hp);agent.hp+=h;return`休息，+${h}HP (${agent.hp}/${agent.maxHp})`;}
        case'complete_turn':return`结束回合。${params.summary||''}`;
        default:{const u=String(tool).toLowerCase();if(['insult','curse','greet','say','talk','yell'].some(k=>u.includes(k)))return`【${agent.name}】${params.message||params.text||tool}`;if(['go','walk','run','enter','flee'].some(k=>u.includes(k))&&(params.destination||params.target))return executeTool(agent,'move',{destination:params.destination||params.target});if(['hit','fight','strike','slash'].some(k=>u.includes(k))&&params.target)return executeTool(agent,'attack',{target:params.target});return`【${agent.name}】${params.text||params.message||tool}`;}}
    }

    /**
     * @description 执行 GM（游戏主持人）专用工具。
     *   支持：narrate_event（叙述事件）、spawn_enemy（在指定地点生成敌人并回满 HP）、
     *   heal_character（治疗角色）、damage_character（对角色造成环境伤害）。
     * @param {string} tool - GM 工具名称
     * @param {Object} params - GM 工具参数
     * @returns {string} 执行结果的描述文本
     */
    function executeGMTool(tool,params){const W=G.world,all=[...(G.userAgent?[G.userAgent]:[]),...G.agents];switch(tool){case'narrate_event':return params.text||'';case'spawn_enemy':{const loc=W.locations[params.location];if(!loc||!W.enemies[params.enemy_id])return'无效';if(!loc.enemies.includes(params.enemy_id)){loc.enemies.push(params.enemy_id);W.enemies[params.enemy_id].hp=W.enemies[params.enemy_id].maxHp;}return`👹【${loc.name}】出现了${W.enemies[params.enemy_id].name}！`;}case'heal_character':{const a=all.find(x=>x.id===params.target||x.name===params.target);if(!a)return'找不到角色';const h=Math.min(params.amount||10,a.maxHp-a.hp);a.hp+=h;return`🩹 ${a.name}+${h}HP (${a.hp}/${a.maxHp})`;}case'damage_character':{const a=all.find(x=>x.id===params.target||x.name===params.target);if(!a)return'找不到角色';a.hp=Math.max(0,a.hp-(params.amount||5));return`⚡ ${a.name}-${params.amount||5}HP${params.reason?`（${params.reason}）`:''} → ${a.hp}/${a.maxHp}`;}default:return params.text||tool;}}

    /**
     * @description 向目标角色广播事件消息，同时通知同地点的旁观者（目击者收到间接消息）。
     *   消息会被推入全局消息队列 G.msgQueue，供 Agent 在构建状态提示词时读取。
     * @param {Object} from - 发送消息的角色对象
     * @param {string} toId - 目标角色 ID
     * @param {string} msg - 消息内容
     * @returns {void}
     */
    function broadcastEvent(from,toId,msg){
        G.msgQueue.push({from:from.id,fromName:from.name,to:toId,msg,round:G.round});
        const all=[...(G.userAgent?[G.userAgent]:[]),...G.agents];
        all.forEach(a=>{
            if(!a||a.id===from.id||a.id===toId||a.hp<=0)return;
            if(a.location===from.location){
                G.msgQueue.push({from:from.id,fromName:from.name,to:a.id,msg:`（你目击：${from.name}对${all.find(x=>x.id===toId)?.name||toId}：${msg}）`,round:G.round});
            }
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  PART 4 — LLM 层 (AbortController + 友好错误 + JSON修复)
    //
    //  本部分封装了与 LLM 的全部交互逻辑：
    //  - friendlyError: 将 HTTP 状态码转换为用户友好的中文错误信息
    //  - tryFixJSON: 尝试修复 LLM 返回的格式不规范的 JSON（容错解析）
    //  - makeAbort: 创建/替换 AbortController 用于请求取消
    //  - callLLM: 文本模式调用（自定义 API 或 SillyTavern generateRaw 两种通道）
    //  - callLLMFC: Function Calling 模式调用（仅支持自定义 API）
    //  - callTO: 超时包装器，为 LLM 调用添加可配置的超时限制
    //  - buildSysPrompt: 为 Agent 构建系统提示词（含合法 ID 列表和行为规则）
    //  - buildStatePrompt: 为 Agent 构建当前状态提示词（位置/HP/背包/敌人/队友/消息/历史）
    //  - buildReActPrompt: 为 ReAct 模式构建完整的单步推理提示词
    //  - parseReAct: 解析 ReAct 模式 LLM 返回的 THOUGHT/ACTION 文本
    // ══════════════════════════════════════════════════════════════

    /**
     * @description 将 HTTP 状态码转换为用户友好的中文错误提示信息。
     * @param {number} status - HTTP 状态码
     * @param {string} [fallbackMsg] - 当状态码不在映射表中时使用的回退消息
     * @returns {string} 友好的错误提示文本
     */
    function friendlyError(status, fallbackMsg){
        return ERR_HINTS[status] || fallbackMsg || `API 错误 ${status}`;
    }

    /**
     * @description 尝试修复并解析 LLM 返回的可能格式不规范的 JSON 字符串。
     *   修复策略：1) 提取第一个 {...} 子串；2) 直接解析；
     *   3) 将单引号替换为双引号、去除尾部逗号、为无引号键名加引号后重试。
     * @param {string} raw - LLM 返回的原始文本
     * @returns {Object|null} 解析成功返回 JSON 对象，失败返回 null
     */
    function tryFixJSON(raw){
        let s = (raw||'').trim();
        const m = s.match(/\{[\s\S]*\}/);
        if(!m) return null;
        s = m[0];
        try{return JSON.parse(s);}catch(_){}
        s = s.replace(/'/g,'"').replace(/,\s*}/g,'}').replace(/,\s*]/g,']');
        s = s.replace(/([{,]\s*)(\w+)\s*:/g,'$1"$2":');
        try{return JSON.parse(s);}catch(_){return null;}
    }

    /**
     * @description 创建新的 AbortController 并取消上一个活动请求。
     *   每次 LLM 调用前调用此函数，确保同一时刻只有一个活跃请求。
     * @returns {AbortSignal} 新创建的 AbortSignal，可传递给 fetch
     */
    function makeAbort(){
        if(activeAbort){try{activeAbort.abort();}catch(_){}}
        activeAbort = new AbortController();
        return activeAbort.signal;
    }

    /**
     * @description 文本模式的 LLM 调用函数。支持两种通道：
     *   1) 配置了自定义 API 地址时：直接通过 fetch 调用 OpenAI 兼容接口
     *   2) 未配置 API 地址时：使用 SillyTavern 内置的 generateRaw 函数
     *   自动记录调用日志、统计 token 用量和响应时间。
     * @param {string} sys - 系统提示词（system message content）
     * @param {string} prompt - 用户提示词（user message content）
     * @returns {Promise<string>} LLM 返回的文本内容
     * @throws {Error} API 请求失败时抛出包含友好错误信息的 Error
     */
    async function callLLM(sys,prompt){
        const s=cfg();METRICS.llmCalls++;const t0=Date.now();
        const model=s.apiModel||'gpt-4o-mini';
        addLog(`LLM #${METRICS.llmCalls} [TextMode] model=${model} sys=${sys.substring(0,80)}… prompt=${prompt.substring(0,120)}…`);
        if(s.apiUrl?.trim()){
            const signal=makeAbort();
            const body={model,messages:[{role:'system',content:sys},{role:'user',content:prompt}],temperature:.75,max_tokens:600};
            addLog(`  → POST ${s.apiUrl} body=${JSON.stringify(body).substring(0,200)}…`);
            const r=await fetch(s.apiUrl.trim(),{method:'POST',signal,headers:{'Content-Type':'application/json',...(s.apiKey?{Authorization:`Bearer ${s.apiKey}`}:{})},body:JSON.stringify(body)});
            const ms=Date.now()-t0;
            if(!r.ok){addLog(`  ← HTTP ${r.status} (${ms}ms)`,'error');throw new Error(friendlyError(r.status));}
            const d=await r.json();METRICS.totalResponseMs+=ms;
            const tok=d.usage;const content=d.choices?.[0]?.message?.content||'';
            addLog(`  ← ${r.status} OK ${ms}ms${tok?` tokens(in:${tok.prompt_tokens} out:${tok.completion_tokens})`:''} resp=${content.substring(0,150)}…`);
            return content;
        }
        addLog(`  → SillyTavern generateRaw`);
        const{generateRaw}=SillyTavern.getContext();const res=await generateRaw({systemPrompt:sys,prompt});
        const ms2=Date.now()-t0;METRICS.totalResponseMs+=ms2;
        addLog(`  ← generateRaw ${ms2}ms resp=${(res||'').substring(0,150)}…`);
        return res;
    }

    /**
     * @description Function Calling 模式的 LLM 调用函数（仅支持自定义 API）。
     *   发送多轮对话 messages 和 tools schema，返回 assistant 消息对象
     *   （可能包含 content 和/或 tool_calls）。
     * @param {Array<Object>} messages - OpenAI 格式的消息数组
     * @param {Array<Object>} tools - OpenAI 格式的工具定义数组
     * @returns {Promise<Object>} LLM 返回的 assistant message 对象，含 content 和 tool_calls
     * @throws {Error} 未配置 API 地址或请求失败时抛出错误
     */
    async function callLLMFC(messages,tools){
        const s=cfg();METRICS.llmCalls++;METRICS.fcCalls++;const t0=Date.now();
        const model=s.apiModel||'gpt-4o-mini';
        if(!s.apiUrl?.trim())throw new Error('Function Calling 需要自定义 API 地址');
        const signal=makeAbort();
        const lastUser=messages.filter(m=>m.role==='user').pop();
        addLog(`LLM #${METRICS.llmCalls} [FC] model=${model} msgs=${messages.length} tools=${tools.length} lastUser=${(lastUser?.content||'').substring(0,120)}…`);
        const body={model,messages,tools,tool_choice:'auto',temperature:.75,max_tokens:800};
        addLog(`  → POST ${s.apiUrl} bodySize=${JSON.stringify(body).length}B`);
        const r=await fetch(s.apiUrl.trim(),{method:'POST',signal,headers:{'Content-Type':'application/json',...(s.apiKey?{Authorization:`Bearer ${s.apiKey}`}:{})},body:JSON.stringify(body)});
        const ms=Date.now()-t0;
        if(!r.ok){addLog(`  ← HTTP ${r.status} (${ms}ms)`,'error');throw new Error(friendlyError(r.status));}
        const raw=await r.json();METRICS.totalResponseMs+=ms;
        const msg=raw.choices?.[0]?.message||{};const tok=raw.usage;
        const tcNames=(msg.tool_calls||[]).map(tc=>`${tc.function.name}(${tc.function.arguments?.substring(0,60)})`).join(', ');
        addLog(`  ← ${r.status} OK ${ms}ms${tok?` tokens(in:${tok.prompt_tokens} out:${tok.completion_tokens})`:''} content=${(msg.content||'null').substring(0,80)} tools=[${tcNames}]`);
        return msg;
    }

    /**
     * @description LLM 调用超时包装器。将传入的异步函数包装为一个带超时限制的 Promise，
     *   超时时间从配置 cfg().llmTimeout 读取（默认 60 秒）。
     *   超时后抛出 TimeoutError，并在错误消息中包含超时时长提示。
     * @param {function(): Promise} fn - 待包装的异步函数（通常是 callLLM 或 callLLMFC 的调用）
     * @returns {Promise<*>} 原函数的返回值
     * @throws {Error} 超时时抛出 name='TimeoutError' 的 Error
     */
    function callTO(fn){
        const ms=cfg().llmTimeout||60000;
        return new Promise((ok,no)=>{
            let d=false;
            const t=setTimeout(()=>{if(d)return;d=true;const e=new Error(`LLM 响应超时（${ms/1000}秒），请检查网络或增大超时设置`);e.name='TimeoutError';no(e);},ms);
            fn().then(r=>{if(d)return;d=true;clearTimeout(t);ok(r);}).catch(e=>{if(d)return;d=true;clearTimeout(t);no(e);});
        });
    }

    /**
     * @description 为指定 Agent 构建 FC 模式的系统提示词。包含角色设定、World Info、
     *   所有合法 ID 列表（地点/物品/敌人/角色）以及行为规则（要求 Agent 在工具调用前
     *   输出内心想法，并参考上轮事件做出连贯反应）。
     * @param {Object} a - Agent 角色对象
     * @returns {string} 完整的系统提示词文本
     */
    function buildSysPrompt(a){const W=G.world,o=G.agents.filter(x=>x.id!==a.id),ids=[...(G.userAgent?[`${G.userAgent.name}(${G.userAgent.id})`]:[]),...o.map(x=>`${x.name}(${x.id})`)].join(', '),lids=Object.entries(W.locations).map(([id,l])=>`${l.name}→${id}`).join(', '),iids=Object.entries(W.items).map(([id,it])=>`${it.name}→${id}`).join(', '),eids=Object.entries(W.enemies).map(([id,en])=>`${en.name}→${id}`).join(', ');return`${a.prompt}\n${cfg().worldInfo?`【世界信息】${cfg().worldInfo}\n`:''}【合法ID】地点:${lids} 物品:${iids} 敌人:${eids} 角色:${ids}\n【重要规则】每次行动前，你必须在 content 中用1-2句话写出你的内心想法和决策理由，然后再调用工具。你必须参考"上轮事件回顾"的内容来做出连贯的反应，不能无视之前发生的事情。`;}

    /**
     * @description 为指定 Agent 构建当前游戏状态提示词。包含：
     *   回合数、当前位置及描述、HP/ATK/DEF/金币、背包物品、地面物品、
     *   当前位置敌人、可前往地点、队友状态、收到的消息、自身近期行动、他人近期行动。
     * @param {Object} a - Agent 角色对象
     * @returns {string} 状态提示词文本
     */
    function buildStatePrompt(a){
        const W=G.world,loc=W.locations[a.location],o=G.agents.filter(x=>x.id!==a.id);
        const msgs=G.msgQueue.filter(m=>m.to===a.id&&m.round>=G.round-2);
        const hist=G.actionsHistory.filter(h=>h.round>=G.round-2).slice(-12);
        const ownHist=hist.filter(h=>h.agentId===a.id);
        const otherHist=hist.filter(h=>h.agentId!==a.id);
        let s=`R${G.round} | ${loc.name}(${a.location}) HP:${a.hp}/${a.maxHp} ATK:${a.atk||20} DEF:${a.def||0} 💰${a.gold}\n背包:[${a.inventory.map(i=>W.items[i]?.name||i).join('、')||'空'}] 地面:[${loc.items.map(i=>W.items[i]?.name||i).join('、')||'无'}]\n敌人:[${loc.enemies.map(e=>`${W.enemies[e]?.name}(HP:${W.enemies[e]?.hp})`).join('、')||'无'}] 可前往:${loc.conn.map(c=>`${W.locations[c]?.name}(${c})`).join('、')}\n队友:${[...(G.userAgent?[`${G.userAgent.icon}${G.userAgent.name} HP:${G.userAgent.hp} @${W.locations[G.userAgent.location]?.name}`]:[]),...o.map(x=>`${x.icon}${x.name} HP:${x.hp} @${W.locations[x.location]?.name}`)].join(' | ')}`;
        if(msgs.length) s+=`\n收到消息:${msgs.map(m=>`${m.fromName}:"${m.msg}"`).join(' | ')}`;
        if(ownHist.length) s+=`\n你的近期行动:${ownHist.map(h=>`[R${h.round}]${TL[h.tool]||h.tool}→${(h.observation||'').substring(0,60)}`).join(' | ')}`;
        if(otherHist.length) s+=`\n上轮事件回顾:${otherHist.map(h=>`[R${h.round}]${h.agentName}${TL[h.tool]||h.tool}→${(h.observation||'').substring(0,60)}`).join(' | ')}`;
        return s.trim();
    }

    /**
     * @description 为 ReAct 模式构建完整的单步推理提示词。组合角色设定、World Info、
     *   当前状态、可用工具描述、已执行步骤历史和输出格式要求。
     * @param {Object} a - Agent 角色对象
     * @param {number} step - 当前步骤编号
     * @param {Array<Object>} hist - 本回合已执行的步骤历史 [{step, tool, obs}, ...]
     * @returns {string} 完整的 ReAct 提示词文本
     */
    function buildReActPrompt(a,step,hist){return`【角色】${a.prompt}\n${cfg().worldInfo?`【世界】${cfg().worldInfo}\n`:''}${buildStatePrompt(a)}\n${pt('toolsDesc')}\n${hist.length?`【已执行】${hist.map(h=>`步${h.step}:${h.tool}→${h.obs.substring(0,50)}`).join(' | ')}`:''}步骤${step}：\n${pt('outputFormat')}`;}

    /**
     * @description 解析 ReAct 模式 LLM 返回的文本，提取 THOUGHT 和 ACTION 部分。
     *   ACTION 部分尝试通过 tryFixJSON 解析为 {tool, params} 结构，
     *   若解析失败则保留原始文本供后续 interpretNatural 处理。
     * @param {string} raw - LLM 返回的原始文本
     * @returns {{thought: string, tool: string|null, params: Object, rawAction: string}}
     *   解析结果，tool 为 null 时检查 rawAction 是否有自然语言动作
     */
    function parseReAct(raw){
        const thought=(raw.match(/THOUGHT:\s*([\s\S]*?)(?=\nACTION:|$)/i)||[])[1]?.trim()||'';
        const ar=(raw.match(/ACTION:\s*([\s\S]*)/i)||[])[1]?.trim()||'';
        let tool=null,params={};
        const fixed = tryFixJSON(ar);
        if(fixed && fixed.tool){tool=fixed.tool;params=fixed.params||{};}
        return{thought,tool,params,rawAction:tool?'':ar};
    }

    // ══════════════════════════════════════════════════════════════
    //  PART 5 — Agent 执行
    //
    //  本部分实现了 Agent 的完整执行流程：
    //  - ruleIntent: 基于正则和关键词的规则引擎，快速解析用户中文自然语言指令
    //  - parseUserIntent: 先尝试规则匹配，失败后调用 LLM 解析用户意图
    //  - interpretNatural: 将 Agent 的自然语言动作文本通过 LLM 转换为游戏指令
    //  - fallbackAction: 当 LLM 调用失败时的智能回退策略（回消息→治疗→应战→观察）
    //  - buildRoundSummary: 构建近 3 轮的行动摘要（用于 FC 模式的上下文注入）
    //  - runTurnFC: Function Calling 模式的 Agent 回合循环（最多 maxSteps 步）
    //  - runTurnReAct: ReAct 文本模式的 Agent 回合循环
    //  - runTurn: 根据配置自动选择 FC 或 ReAct 模式执行回合
    //  - runGMTurn: GM Agent 的回合执行（FC/文本两种模式，失败回退到 runEnvFallback）
    //  - runEnvFallback: 无 LLM 的纯规则环境事件（村庄回血、威胁扣血、敌人重生、随机叙述）
    // ══════════════════════════════════════════════════════════════

    /**
     * @description 基于规则的中文自然语言意图识别函数。通过关键词前缀匹配将用户输入
     *   直接映射为游戏工具调用，无需 LLM。支持的模式：
     *   "前往/去/到/进入" → move，"攻击/打/揍/砍" → attack，"拾取/拿/捡" → pickup_item，
     *   "使用/用/吃/喝" → use_item，"对...说/道/讲" → speak，"搜索/探索" → search，
     *   "休息/歇/回血" → rest。
     * @param {string} msg - 用户输入的自然语言文本
     * @param {Object} W - 世界状态对象（用于 resolveId 查找实体）
     * @returns {{tool: string, params: Object}|null} 识别到的意图，未匹配返回 null
     */
    function ruleIntent(msg,W){const s=String(msg||'').trim();if(!s||!W)return null;for(const k of['前往','去往','去','到','进入']){if(s.startsWith(k)&&s.length>k.length){const id=resolveId(W,'location',s.slice(k.length).trim());if(id)return{tool:'move',params:{destination:id}};}}for(const k of['攻击','打','揍','砍']){if(s.startsWith(k)){const rest=s.slice(k.length).replace(/^[了着一下]\s*/,'').trim();const id=resolveId(W,'enemy',rest)||resolveId(W,'agent',rest);if(id)return{tool:'attack',params:{target:id}};}}for(const k of['拾取','拿','捡']){if(s.startsWith(k)){const id=resolveId(W,'item',s.slice(k.length).trim());if(id)return{tool:'pickup_item',params:{target:id}};}}for(const k of['使用','用','吃','喝']){if(s.startsWith(k)){const id=resolveId(W,'item',s.slice(k.length).replace(/^[了着]\s*/,'').trim());if(id)return{tool:'use_item',params:{item:id}};}}const sm=s.match(/^(?:对|和|跟|向)(.+?)(?:说|道|讲)(?:[:：]?\s*)?(.*)$/);if(sm){const id=resolveId(W,'agent',sm[1].trim());if(id)return{tool:'speak',params:{to:id,message:sm[2]?.trim()||'…'}};}if(/^(搜索|搜|探索)/.test(s))return{tool:'search',params:{}};if(/^(休息|歇|回血)/.test(s))return{tool:'rest',params:{}};return null;}

    /**
     * @description 解析玩家的自然语言输入为游戏指令。先尝试 ruleIntent 规则匹配，
     *   失败后调用 LLM 进行语义理解，最终回退为 narrate 叙述。
     * @param {string} msg - 玩家输入的文本
     * @returns {Promise<{tool: string, params: Object}>} 解析后的工具调用意图
     */
    async function parseUserIntent(msg){const u=G.userAgent,W=G.world;if(!u||!W)return{tool:'narrate',params:{text:msg}};const r=ruleIntent(msg,W);if(r)return r;const all=[...(G.userAgent?[G.userAgent]:[]),...G.agents],loc=W.locations[u.location];try{const raw=await callTO(()=>callLLM('将用户自然语言映射为游戏操作。只输出JSON{"tool":"","params":{}}',`用户:${msg}\n位置:${loc?.name}(${u.location}) 角色:${all.map(a=>`${a.name}→${a.id}`).join(',')}\n敌人:${(loc?.enemies||[]).map(e=>`${W.enemies[e]?.name}(${e})`).join(',')||'无'}\n地点:${Object.entries(W.locations).map(([id,l])=>`${l.name}→${id}`).join(',')}`));const fixed=tryFixJSON(raw);if(fixed&&fixed.tool)return{tool:fixed.tool,params:resolveParams(W,fixed.tool,fixed.params||{})};}catch(_){}return{tool:'narrate',params:{text:msg}};}

    /**
     * @description 将 NPC Agent 输出的自然语言动作文本通过 LLM 转换为结构化游戏指令。
     *   用于 ReAct 模式中 Agent 输出非 JSON 格式 ACTION 时的二次解析。
     * @param {Object} agent - 执行动作的 Agent 对象
     * @param {string} text - Agent 输出的自然语言动作文本
     * @returns {Promise<{tool: string, params: Object}>} 解析后的工具调用，失败回退为 narrate
     */
    async function interpretNatural(agent,text){const W=G.world,all=[...(G.userAgent?[G.userAgent]:[]),...G.agents];try{const raw=await callTO(()=>callLLM('将Agent自然语言解析为游戏指令。只输出JSON{"tool":"","params":{}}',`Agent(${agent.name}):${text}\n角色:${all.map(a=>`${a.name}→${a.id}`).join(',')}`));const fixed=tryFixJSON(raw);if(fixed&&fixed.tool)return{tool:fixed.tool,params:resolveParams(W,fixed.tool,fixed.params||{})};}catch(_){}return{tool:'narrate',params:{text}};}

    /**
     * @description LLM 调用失败时的智能回退动作选择。按优先级依次判断：
     *   1) 有未读消息 → 回复消息（speak）
     *   2) HP 低于 70% 且有治疗物品 → 使用治疗物品（use_item）
     *   3) 当前位置有敌人 → 攻击第一个敌人（attack）
     *   4) 以上都不满足 → 叙述保持警惕（narrate）
     * @param {Object} a - Agent 角色对象
     * @returns {{thought: string, tool: string, params: Object}} 回退动作的描述和工具参数
     */
    function fallbackAction(a){const W=G.world,loc=W.locations[a.location],msgs=G.msgQueue.filter(m=>m.to===a.id&&m.round>=G.round-1);if(msgs.length)return{thought:'回应消息。',tool:'speak',params:{to:msgs[msgs.length-1].from,message:'…'}};if(a.hp<a.maxHp*.7){const hi=a.inventory.find(i=>W.items[i]?.effect==='heal');if(hi)return{thought:'治疗。',tool:'use_item',params:{item:hi}};}if(loc.enemies.length)return{thought:'应战！',tool:'attack',params:{target:loc.enemies[0]}};return{thought:'观察。',tool:'narrate',params:{text:`${a.name}保持警惕。`}};}

    /**
     * @description 构建近 3 轮的行动回顾摘要，用于 FC 模式中注入历史上下文，
     *   帮助 Agent 做出更连贯的决策。
     * @param {Object} agent - 当前 Agent 对象（未直接使用，保留用于未来扩展）
     * @returns {string} 格式化的回顾摘要文本，无历史时返回空字符串
     */
    function buildRoundSummary(agent){
        const prev=G.actionsHistory.filter(h=>h.round<G.round&&h.round>=G.round-3);
        if(!prev.length)return '';
        const byRound={};
        prev.forEach(h=>{if(!byRound[h.round])byRound[h.round]=[];byRound[h.round].push(h);});
        return Object.entries(byRound).map(([r,acts])=>`【第${r}轮回顾】${acts.map(h=>`${h.agentName}${TL[h.tool]||h.tool}→${(h.observation||'').substring(0,80)}`).join('；')}`).join('\n');
    }

    /**
     * @description Function Calling 模式的 Agent 回合执行循环。
     *   在最多 maxSteps 步内循环调用 LLM，每步处理 tool_calls 并执行对应游戏工具。
     *   自动处理暂停/停止请求、目标达成判定、HP 归零判定、超时/中断错误、
     *   以及 LLM 无 tool_calls 返回时的处理。失败时自动执行 fallbackAction。
     * @param {Object} agent - 要执行回合的 Agent 对象
     * @returns {Promise<void>}
     */
    async function runTurnFC(agent){
        const mx=cfg().maxSteps||5;
        const roundCtx=buildRoundSummary(agent);
        const stateText=buildStatePrompt(agent);
        addLog(`──── TURN FC: ${agent.name}(${agent.id}) R${G.round} steps≤${mx} HP:${agent.hp}/${agent.maxHp} @${agent.location} ────`);
        const msgs=[
            {role:'system',content:buildSysPrompt(agent)},
            ...(roundCtx?[{role:'user',content:roundCtx}]:[]),
            {role:'user',content:stateText}
        ];
        addLog(`  prompt: sysLen=${msgs[0].content.length} ctxMsgs=${msgs.length} stateLen=${stateText.length}`);
        for(let s=1;s<=mx;s++){
            if(G.paused)await waitResume();
            if(G.stopReq||!G.running)break;
            const sc=getScenario(),gl=sc.checkGoal(agent,G.world);
            if(gl.done){addLog(`  GOAL reached: ${gl.reason}`);postSystemMsg(`✅ ${agent.name}：${gl.reason}`);break;}
            const tid=postThinking(agent,s,mx);
            try{
                const resp=await callTO(()=>callLLMFC(msgs,FC_TOOLS));
                removeThinking(tid);
                let thought=resp.content||null;
                if(resp.tool_calls?.length){
                    if(!thought){
                        const toolNames=resp.tool_calls.map(tc=>`${TL[tc.function.name]||tc.function.name}`).join('、');
                        thought=`（${agent.name}决定：${toolNames}）`;
                    }
                    msgs.push({role:'assistant',content:thought,tool_calls:resp.tool_calls});
                    for(const tc of resp.tool_calls){
                        let args;try{args=JSON.parse(tc.function.arguments||'{}');}catch(_){args=tryFixJSON(tc.function.arguments)||{};}
                        const rA=resolveParams(G.world,tc.function.name,args);
                        addLog(`  TOOL ${agent.name}.${tc.function.name}(${JSON.stringify(rA).substring(0,100)})`);
                        const res=executeTool(agent,tc.function.name,rA);
                        addLog(`    → ${res.substring(0,120)}`);
                        msgs.push({role:'tool',tool_call_id:tc.id,content:res});
                        METRICS.toolCalls++;
                        G.actionsHistory.push({round:G.round,agentId:agent.id,agentName:agent.name,tool:tc.function.name,params:{...rA},observation:res});
                        postAgentMsg(agent,s,thought,tc.function.name,res,mx,true);
                    }
                    trimHist();updateAll();
                    if(agent.hp<=0){addLog(`  ${agent.name} DEAD`,'warn');postSystemMsg(`💀 ${agent.name}倒下`,'error');break;}
                    if(resp.tool_calls.some(tc=>tc.function.name==='complete_turn'))break;
                    await sleep(cfg().stepDelay);
                }else{
                    addLog(`  no tool_calls, content only`);
                    if(thought)postAgentMsg(agent,s,thought,'narrate',thought,mx,true);
                    break;
                }
            }catch(e){
                removeThinking(tid);METRICS.errors++;
                if(e.name==='AbortError'){addLog(`  ABORTED`,'warn');break;}
                if(e.name==='TimeoutError'){addLog(`  TIMEOUT: ${e.message}`,'error');postSystemMsg(`⏱️ ${agent.name}：${e.message}`,'warn');break;}
                addLog(`  FC ERROR: ${e.message}`,'error');
                const fb=fallbackAction(agent);
                const fbRes=executeTool(agent,fb.tool,fb.params);
                addLog(`  FALLBACK ${fb.tool} → ${fbRes.substring(0,80)}`);
                postAgentMsg(agent,s,fb.thought,fb.tool,fbRes,mx,false);break;
            }
        }
        addLog(`──── END TURN: ${agent.name} HP:${agent.hp} ────`);
    }

    /**
     * @description ReAct 文本模式的 Agent 回合执行循环。
     *   在最多 maxSteps 步内循环：构建 ReAct 提示词 → 调用 LLM → 解析 THOUGHT/ACTION →
     *   执行工具 → 记录历史。支持自然语言 ACTION 的二次 LLM 解析（interpretNatural），
     *   连续失败 3 次后自动回退。
     * @param {Object} agent - 要执行回合的 Agent 对象
     * @returns {Promise<void>}
     */
    async function runTurnReAct(agent){const mx=cfg().maxSteps||5;const hist=[];let fails=0;for(let s=1;s<=mx;s++){if(G.paused)await waitResume();if(G.stopReq||!G.running)break;const sc=getScenario(),gl=sc.checkGoal(agent,G.world);if(gl.done){postSystemMsg(`✅ ${agent.name}：${gl.reason}`);break;}const tid=postThinking(agent,s,mx);let parsed=null;try{const raw=await callTO(()=>callLLM(pt('systemPrompt'),buildReActPrompt(agent,s,hist)));METRICS.textCalls++;parsed=parseReAct(raw);}catch(e){removeThinking(tid);METRICS.errors++;if(e.name==='AbortError')break;if(e.name==='TimeoutError'){postSystemMsg(`⏱️ ${agent.name}：${e.message}`,'warn');break;}addLog(`ReAct错误: ${e.message}`,'error');fails++;if(fails>=3)break;continue;}if(!parsed||(!parsed.tool&&!parsed.rawAction&&!parsed.thought)){removeThinking(tid);fails++;if(fails>=3)break;const fb=fallbackAction(agent);const obs=executeTool(agent,fb.tool,fb.params);hist.push({step:s,tool:fb.tool,params:fb.params,obs});METRICS.toolCalls++;G.actionsHistory.push({round:G.round,agentId:agent.id,agentName:agent.name,tool:fb.tool,params:{...fb.params},observation:obs});postAgentMsg(agent,s,fb.thought,fb.tool,obs,mx,false);updateAll();await sleep(cfg().stepDelay);continue;}fails=0;let tool=parsed.tool,params=parsed.params;if(!tool&&parsed.rawAction){const i=await interpretNatural(agent,parsed.rawAction);tool=i.tool;params=i.params;}if(!tool&&parsed.thought){tool='narrate';params={text:parsed.thought};}const obs=executeTool(agent,tool||'rest',params||{});hist.push({step:s,tool:tool||'rest',params:params||{},obs});METRICS.toolCalls++;G.actionsHistory.push({round:G.round,agentId:agent.id,agentName:agent.name,tool:tool||'rest',params:{...(params||{})},observation:obs});trimHist();removeThinking(tid);postAgentMsg(agent,s,parsed.thought,tool||'rest',obs,mx,false);updateAll();if(tool==='complete_turn')break;if(agent.hp<=0){postSystemMsg(`💀 ${agent.name}倒下`,'error');break;}await sleep(cfg().stepDelay);}}

    /**
     * @description Agent 回合执行入口函数。根据当前配置自动选择 FC 或 ReAct 模式。
     *   配置了自定义 API 地址且启用了 Function Calling 时使用 FC 模式，否则使用 ReAct。
     * @param {Object} agent - 要执行回合的 Agent 对象
     * @returns {Promise<void>}
     */
    async function runTurn(agent){METRICS.turns++;if(cfg().useFunctionCalling&&cfg().apiUrl?.trim())await runTurnFC(agent);else await runTurnReAct(agent);}

    /**
     * @description GM（游戏主持人）Agent 的回合执行函数。GM 负责推进剧情、制造紧张感、
     *   维持游戏平衡。支持 FC 模式（使用 GM_FC_TOOLS）和文本叙述模式，
     *   LLM 调用失败时回退到 runEnvFallback 纯规则模式。
     * @returns {Promise<void>}
     */
    async function runGMTurn(){if(!G.gmEnabled){runEnvFallback();return;}const useFC=cfg().useFunctionCalling&&cfg().apiUrl?.trim(),W=G.world,all=[...(G.userAgent?[G.userAgent]:[]),...G.agents];const st=all.map(a=>`${a.name}(${a.id}) HP:${a.hp}/${a.maxHp} @${W.locations[a.location]?.name}`).join('\n');const ls=Object.entries(W.locations).map(([id,l])=>`${l.name}(${id}): 敌[${l.enemies.map(e=>W.enemies[e]?.name).join(',')||'无'}]`).join('\n');const gmSys='你是GM。推进剧情、制造紧张感、维持平衡。每回合1-2个动作。';const gmP=`R${G.round}:\n${st}\n\n${ls}\n敌人ID:${Object.keys(W.enemies).join(',')} 地点ID:${Object.keys(W.locations).join(',')}`;postSystemMsg('🌍 ── GM 回合 ──','env');if(useFC){try{const resp=await callTO(()=>callLLMFC([{role:'system',content:gmSys},{role:'user',content:gmP}],GM_FC_TOOLS));if(resp.tool_calls?.length)for(const tc of resp.tool_calls){let args;try{args=JSON.parse(tc.function.arguments||'{}');}catch(_){args=tryFixJSON(tc.function.arguments)||{};}postSystemMsg(executeGMTool(tc.function.name,args),'env');}else if(resp.content)postSystemMsg(resp.content,'env');}catch(_){runEnvFallback();}}else{try{const raw=await callTO(()=>callLLM(gmSys,gmP+'\n叙述本回合环境事件（1-2句）。'));if(raw)postSystemMsg(raw.trim(),'env');else runEnvFallback();}catch(_){runEnvFallback();}}updateAll();}

    /**
     * @description 无 LLM 的纯规则环境事件回退函数。当 GM Agent 调用失败时执行。
     *   规则包括：
     *   1) 在起始地点（如村庄）的角色自动回血 +15 HP
     *   2) 在有敌人的非起始地点的角色受威胁 -5 HP
     *   3) 已击败的敌人有 30% 概率在原始地点重生
     *   4) 40% 概率从环境叙述池中随机选取一条氛围文本
     * @returns {void}
     */
    function runEnvFallback(){const W=G.world,sc=getScenario(),all=[...(G.userAgent?[G.userAgent]:[]),...G.agents],evs=[];const s0=Object.keys(sc.world.locations)[0];all.forEach(a=>{if(!a||a.hp<=0)return;if(a.location===s0&&a.hp<a.maxHp){const h=15;a.hp=Math.min(a.maxHp,a.hp+h);evs.push(`🏠 ${a.name}休整+${h}HP (${a.hp}/${a.maxHp})`);}});all.forEach(a=>{if(!a||a.hp<=0)return;const loc=W.locations[a.location];if(loc.enemies.length&&a.location!==s0){a.hp=Math.max(0,a.hp-5);evs.push(`⚡ ${a.name}受威胁-5HP (${a.hp}/${a.maxHp})`);}});Object.entries(sc.enemyHome||{}).forEach(([eid,lid])=>{const loc=W.locations[lid];if(loc&&!loc.enemies.includes(eid)&&Math.random()<.3){loc.enemies.push(eid);W.enemies[eid].hp=W.enemies[eid].maxHp;evs.push(`👹【${W.locations[lid].name}】出现${W.enemies[eid].name}！`);}});const narrs=(pt('envNarrations')||'').split('\n').filter(Boolean);if(narrs.length&&Math.random()<.4)evs.push(narrs[Math.floor(Math.random()*narrs.length)]);if(evs.length)evs.forEach(e=>postSystemMsg(e,'env'));else postSystemMsg('风平浪静。','env');}

    /**
     * @description 裁剪行动历史记录，只保留最近 3 轮的数据，防止内存无限增长。
     * @returns {void}
     */
    function trimHist(){G.actionsHistory=G.actionsHistory.filter(h=>h.round>=G.round-3);}

    // ══════════════════════════════════════════════════════════════
    //  PART 6 — 协调层
    //
    //  本部分实现了游戏的顶层协调逻辑：
    //  - doInit: 初始化游戏（读取配置、重置世界、清空指标、切换到游戏页）
    //  - doStart: 启动游戏循环
    //  - doPause: 切换暂停状态
    //  - doStop: 停止游戏（取消请求、释放 Promise、禁用输入）
    //  - gameLoop: 主循环（用户输入 → NPC 轮转 → GM 回合 → 胜负判定）
    //  - waitForUserAction / submitUserAction: 用户输入的 Promise 机制
    //  - setInputEnabled: 统一控制所有输入框和按钮的启用/禁用状态
    // ══════════════════════════════════════════════════════════════

    /**
     * @description 初始化游戏。从 UI 读取玩家名称和图标设置，调用 resetGame 重置世界，
     *   清空性能指标，更新 UI，记录详细初始化日志，并自动切换到游戏页面。
     * @returns {void}
     */
    function doInit(){
        const s=cfg();s.userName=document.getElementById('mac-s-uname')?.value?.trim()||s.userName;s.userIcon=document.getElementById('mac-s-uicon')?.value?.trim()||s.userIcon;saveCfg();resetGame();METRICS={llmCalls:0,toolCalls:0,fcCalls:0,textCalls:0,turns:0,rounds:0,errors:0,totalResponseMs:0,successes:0,failures:0};updateAll();
        const sc=getScenario();
        addLog(`═══ INIT scenario=${s.scenario} mode=${s.useFunctionCalling&&s.apiUrl?'FC':'ReAct'} model=${s.apiModel} apiUrl=${s.apiUrl||'SillyTavern'} ═══`);
        addLog(`  agents: ${G.agents.map(a=>`${a.name}(${a.id}) ATK:${a.atk} DEF:${a.def} HP:${a.hp}`).join(', ')}`);
        addLog(`  world: ${Object.keys(G.world.locations).length} locations, ${Object.keys(G.world.items).length} items, ${Object.keys(G.world.enemies).length} enemies`);
        addLog(`  config: maxRounds=${s.maxRounds} maxSteps=${s.maxSteps} delay=${s.stepDelay}ms timeout=${s.llmTimeout}ms channel=${s.msgChannel} GM=${G.gmEnabled}`);
        postSystemMsg(`═══ ${sc.name}世界已初始化 ═══`);postSystemMsg(`${G.userAgent.icon}${G.userAgent.name}(主角) + NPC: ${G.agents.map(a=>`${a.icon}${a.name}`).join('、')}`);postSystemMsg(`模式: ${cfg().useFunctionCalling&&cfg().apiUrl?'Function Calling':'ReAct文本'} | GM: ${G.gmEnabled?'ON':'OFF'} | 通道: ${cfg().msgChannel}`);
        navigateTo('game');
    }

    /**
     * @description 启动游戏循环。要求游戏已初始化且当前未运行。设置运行标志后进入 gameLoop。
     * @returns {void}
     */
    function doStart(){if(!G.inited||G.running)return;G.running=true;G.stopReq=false;G.paused=false;updateAll();gameLoop();}

    /**
     * @description 切换游戏暂停/继续状态，并发送系统消息通知。
     * @returns {void}
     */
    function doPause(){G.paused=!G.paused;updateAll();postSystemMsg(G.paused?'⏸ 已暂停':'▶ 继续');}

    /**
     * @description 停止游戏运行。取消活动的 LLM 请求，释放用户输入 Promise，
     *   禁用所有输入控件，发送停止系统消息。
     * @returns {void}
     */
    function doStop(){
        G.stopReq=true;G.running=false;G.waitingForUser=false;
        if(activeAbort){try{activeAbort.abort();}catch(_){}}
        activeAbort=null;
        if(G.userActionResolve){G.userActionResolve('休息');G.userActionResolve=null;}
        setInputEnabled(false);updateAll();postSystemMsg('⏹ 游戏已停止');
    }

    /**
     * @description 游戏主循环。按回合制流程运行：
     *   每轮依次执行：等待用户输入 → 解析并执行玩家动作 → NPC Agent 按优先级轮转 →
     *   GM 回合 → 检查胜利条件和全员存活。
     *   循环在达到最大轮数、胜利、全员阵亡或手动停止时结束。
     * @returns {Promise<void>}
     */
    async function gameLoop(){
        const s=cfg(),sc=getScenario();
        addLog(`═══ GAME LOOP START maxRounds=${s.maxRounds} ═══`);
        postSystemMsg('🚀 游戏开始（你先行动 → NPC → GM）');
        const sorted=[...G.agents].sort((a,b)=>a.priority-b.priority);
        while(G.running&&G.round<s.maxRounds){
            G.round++;METRICS.rounds++;
            addLog(`══ ROUND ${G.round}/${s.maxRounds} ══`);
            postSystemMsg(`\n══ 第 ${G.round}/${s.maxRounds} 轮 ══`);updateAll();
            if(G.paused)await waitResume();if(G.stopReq||!G.running)break;
            addLog(`  waiting for user input…`);
            const ui=await waitForUserAction();
            if(G.stopReq||!G.running)break;
            addLog(`  USER INPUT: "${ui}"`);
            const parsed=await parseUserIntent(ui);
            addLog(`  PARSED: tool=${parsed.tool} params=${JSON.stringify(parsed.params).substring(0,100)}`);
            const ur=G.userAgent?executeTool(G.userAgent,parsed.tool,parsed.params):'';
            addLog(`  USER EXEC: ${parsed.tool} → ${ur.substring(0,100)}`);
            if(G.userAgent){METRICS.toolCalls++;G.actionsHistory.push({round:G.round,agentId:'user',agentName:G.userAgent.name,tool:parsed.tool,params:{...parsed.params},observation:ur});trimHist();}
            postUserMsg(G.userAgent,ui,parsed.tool,ur);updateAll();
            if(G.userAgent?.hp<=0){addLog(`  USER DEAD`,'error');postSystemMsg('💀 玩家倒下','error');METRICS.failures++;break;}
            for(let i=0;i<sorted.length;i++){
                if(G.stopReq||!G.running)break;if(G.paused)await waitResume();
                G.curIdx=G.agents.indexOf(sorted[i]);updateAll();
                if(sorted[i].hp<=0){addLog(`  SKIP ${sorted[i].name} (dead)`);continue;}
                await runTurn(sorted[i]);updateAll();
            }
            addLog(`  GM TURN`);
            await runGMTurn();
            const gl=sc.checkGoal(G.userAgent||G.agents[0],G.world);
            if(gl.done&&(gl.reason.includes('完成')||gl.reason.includes('击败'))){addLog(`  VICTORY: ${gl.reason}`);postSystemMsg(`🏆 胜利！${gl.reason}`);METRICS.successes++;break;}
            if(G.agents.every(a=>a.hp<=0)&&(!G.userAgent||G.userAgent.hp<=0)){addLog(`  TOTAL WIPE`,'error');postSystemMsg('💀 全员阵亡','error');METRICS.failures++;break;}
            addLog(`  ROUND ${G.round} DONE — metrics: LLM=${METRICS.llmCalls} tools=${METRICS.toolCalls} errors=${METRICS.errors}`);
        }
        if(G.round>=cfg().maxRounds&&G.running)postSystemMsg(`🎬 结束，共${G.round}轮`);
        addLog(`═══ GAME LOOP END rounds=${G.round} LLM=${METRICS.llmCalls} tools=${METRICS.toolCalls} errors=${METRICS.errors} ═══`);
        G.running=false;setInputEnabled(false);updateAll();
    }

    /**
     * @description 等待用户输入的异步函数。返回一个 Promise，在用户提交行动文本后 resolve。
     *   同时启用所有输入框并聚焦，设置等待标志以更新 UI 状态。
     * @returns {Promise<string>} 用户输入的行动文本
     */
    function waitForUserAction(){return new Promise(r=>{G.waitingForUser=true;G.userActionResolve=r;setInputEnabled(true);['mac-g-input','mac-hud-input','mac-chat-input'].forEach(id=>{const e=document.getElementById(id);if(e){e.value='';e.focus();}});updateAll();});}

    /**
     * @description 提交用户行动。从多个输入框中取第一个非空值，
     *   resolve 等待中的 Promise 以恢复游戏循环。无输入时默认为 "休息"。
     * @returns {void}
     */
    function submitUserAction(){if(!G.waitingForUser||!G.userActionResolve)return;let text='';for(const id of['mac-g-input','mac-hud-input','mac-chat-input']){const e=document.getElementById(id);if(e&&e.value.trim()){text=e.value.trim();break;}}setInputEnabled(false);G.waitingForUser=false;const r=G.userActionResolve;G.userActionResolve=null;r(text||'休息');}

    /**
     * @description 统一控制所有用户输入控件（游戏页、HUD、酒馆聊天栏）的启用/禁用状态。
     * @param {boolean} on - true 启用输入，false 禁用输入
     * @returns {void}
     */
    function setInputEnabled(on){['mac-g-input','mac-hud-input','mac-chat-input'].forEach(id=>{const e=document.getElementById(id);if(e){e.disabled=!on;e.placeholder=on?'输入你的行动…':'等待中…';}});['mac-g-send','mac-hud-send'].forEach(id=>{const e=document.getElementById(id);if(e)e.disabled=!on;});const bar=document.getElementById('mac-chat-bar');if(bar)bar.style.display=on?'':'none';const sec=document.getElementById('mac-hud-user-sec');if(sec)sec.style.display=on?'':'none';}

    // ══════════════════════════════════════════════════════════════
    //  PART 7 — 评估
    //
    //  本部分实现了系统的性能评估功能：
    //  - getMetrics: 获取当前性能指标的计算快照（含均响应时间和 FC 率）
    //  - resetMetrics: 重置所有性能指标为零
    //  - runAutoTest: 自动化测试，使用简单规则代替用户输入运行指定轮数，
    //    收集 LLM 调用量、工具使用量、错误率等指标
    // ══════════════════════════════════════════════════════════════

    /**
     * @description 获取当前性能指标的计算快照，额外计算平均响应时间和 FC 调用比率。
     * @returns {Object} 包含所有 METRICS 字段及 avgMs（平均响应毫秒）、fcRate（FC 百分比）
     */
    function getMetrics(){return{...METRICS,avgMs:METRICS.llmCalls?Math.round(METRICS.totalResponseMs/METRICS.llmCalls):0,fcRate:METRICS.llmCalls?Math.round(METRICS.fcCalls/METRICS.llmCalls*100):0};}

    /**
     * @description 重置所有性能指标计数器为零，并刷新评估页 UI。
     * @returns {void}
     */
    function resetMetrics(){METRICS={llmCalls:0,toolCalls:0,fcCalls:0,textCalls:0,turns:0,rounds:0,errors:0,totalResponseMs:0,successes:0,failures:0};updateEval();}

    /**
     * @description 运行自动化测试。重置游戏后以简单策略（有敌人则攻击、有物品则搜索、
     *   否则随机移动、最后休息）代替玩家输入，自动执行指定轮数的游戏循环，
     *   最终将收集到的性能指标展示在评估页面。
     * @param {number} [rounds=5] - 要运行的测试轮数
     * @returns {Promise<void>}
     */
    async function runAutoTest(rounds){const sEl=document.getElementById('mac-e-status'),rEl=document.getElementById('mac-e-results');if(sEl)sEl.textContent='运行中…';resetMetrics();resetGame();G.running=true;const sc=getScenario(),sorted=[...G.agents].sort((a,b)=>a.priority-b.priority);for(let r=1;r<=(rounds||5)&&G.running;r++){G.round=r;METRICS.rounds++;const u=G.userAgent;if(u){const loc=G.world.locations[u.location];let act;if(loc.enemies.length)act={tool:'attack',params:{target:loc.enemies[0]}};else if(loc.items.length)act={tool:'search',params:{}};else if(loc.conn.length)act={tool:'move',params:{destination:loc.conn[Math.floor(Math.random()*loc.conn.length)]}};else act={tool:'rest',params:{}};executeTool(u,act.tool,act.params);METRICS.toolCalls++;}for(const a of sorted){if(a.hp<=0)continue;await runTurn(a);}runEnvFallback();const gl=sc.checkGoal(G.userAgent||G.agents[0],G.world);if(gl.done){gl.reason.includes('完成')||gl.reason.includes('击败')?METRICS.successes++:METRICS.failures++;break;}if(G.agents.every(a=>a.hp<=0)&&(!G.userAgent||G.userAgent.hp<=0)){METRICS.failures++;break;}}G.running=false;if(sEl)sEl.textContent='完成';if(rEl)rEl.innerHTML=`<pre style="color:var(--txt2);font-size:12px">${JSON.stringify(getMetrics(),null,2)}</pre>`;updateEval();}

    // ══════════════════════════════════════════════════════════════
    //  PART 8 — UI: 全屏仪表盘 + 浮动HUD + 酒馆聊天注入 + 消息通道
    //
    //  本部分实现了完整的 UI 层，包括：
    //  - 消息通道选择（双显/仅全屏/仅酒馆）
    //  - 消息 HTML 构建与渲染（postUserMsg/postAgentMsg/postSystemMsg/postThinking）
    //  - 全屏仪表盘应用（7 页：仪表盘/游戏/智能体/世界/评估/设置/日志）
    //  - 浮动 HUD（可拖拽、可折叠、状态持久化）
    //  - 酒馆聊天栏注入（在 SillyTavern 聊天框下方添加输入栏）
    //  - 仪表盘数据更新（updateDashboard/updateHUD/updateAll）
    //  - 页面导航（navigateTo）、应用显隐切换（toggleApp）
    //  - 智能体配置编辑器、场景选择器、日志查看器、评估指标面板
    //  - World Info 加载与选择
    //  - 所有事件绑定（bindAllEvents）
    // ══════════════════════════════════════════════════════════════

    /**
     * @constant {string[]} ST_CHAT_SELS
     * @description SillyTavern 聊天容器的 CSS 选择器候选列表，用于查找酒馆聊天 DOM 元素。
     */
    const ST_CHAT_SELS = ['#chat','.chat','#sheld','.sheld','#chat_container .chat'];

    /**
     * @description 查找 SillyTavern 聊天容器 DOM 元素。按候选选择器列表依次尝试。
     * @returns {HTMLElement|null} 找到的聊天容器元素，未找到返回 null
     */
    function getSTChat(){for(const s of ST_CHAT_SELS){const e=document.querySelector(s);if(e)return e;}return null;}

    /**
     * @description 判断当前配置是否应在全屏仪表盘中显示消息。
     * @returns {boolean}
     */
    function shouldFS(){const ch=cfg().msgChannel;return ch==='both'||ch==='fullscreen';}

    /**
     * @description 判断当前配置是否应在 SillyTavern 聊天中显示消息。
     * @returns {boolean}
     */
    function shouldST(){const ch=cfg().msgChannel;return ch==='both'||ch==='tavern';}

    /**
     * @description 构建消息气泡的 HTML 内容。包含头部（图标/名称/角色/FC标记/步数/回合数）、
     *   思考内容（thought）、动作标签及结果（tool + result）、原始输入文本（rawText）。
     * @param {string} ico - 角色图标（Emoji）
     * @param {string} name - 角色名称
     * @param {string} role - 角色职业/类型
     * @param {number} step - 当前步数（0 表示不显示）
     * @param {number} total - 总步数上限
     * @param {string} thought - Agent 思考/想法文本
     * @param {string} tool - 工具名称
     * @param {string} result - 工具执行结果
     * @param {string} rawText - 原始输入文本（玩家消息时使用）
     * @param {boolean} isFC - 是否为 Function Calling 模式
     * @returns {string} 消息气泡的 innerHTML
     */
    function buildMsgHTML(ico,name,role,step,total,thought,tool,result,rawText,isFC){
        const c=TC[tool]||'#6a6258';
        return `<div class="mac-msg-hd"><span class="mac-msg-ico">${ico}</span><span class="mac-msg-nm">${name}</span><span class="mac-msg-rl">${role}</span>${isFC?'<span class="mac-badge mac-badge-g" style="font-size:10px">FC</span>':''}${step?`<span class="mac-msg-st">步${step}/${total}</span>`:''}<span class="mac-msg-rd">R${G.round}</span></div>${thought?`<div class="mac-msg-thought">💭 ${esc(thought)}</div>`:''}<div class="mac-msg-act"><span class="mac-msg-tag" style="color:${c};border-color:${c}">${TL[tool]||tool}</span><span class="mac-msg-res">${esc(result)}</span></div>${rawText?`<div class="mac-msg-raw">💬 "${esc(rawText)}"</div>`:''}`;
    }

    /**
     * @description 发送玩家消息到 UI。根据消息通道配置分别写入全屏聊天和酒馆聊天。
     * @param {Object} ua - 玩家角色对象
     * @param {string} text - 玩家输入的原始文本
     * @param {string} tool - 解析出的工具名称
     * @param {string} result - 工具执行结果
     * @returns {void}
     */
    function postUserMsg(ua,text,tool,result){
        const html=buildMsgHTML(ua?.icon||'👤',ua?.name||'玩家','主角',0,0,'',tool,result,text,false);
        if(shouldFS())appendChat('mac-msg mac-msg-user',html);
        if(shouldST())appendSTChat('mac-st-bubble mac-st-user',html);
    }

    /**
     * @description 发送 NPC Agent 消息到 UI。
     * @param {Object} agent - Agent 角色对象
     * @param {number} step - 当前步数
     * @param {string} thought - Agent 思考文本
     * @param {string} tool - 工具名称
     * @param {string} result - 工具执行结果
     * @param {number} total - 总步数上限
     * @param {boolean} isFC - 是否为 FC 模式
     * @returns {void}
     */
    function postAgentMsg(agent,step,thought,tool,result,total,isFC){
        const html=buildMsgHTML(agent.icon,agent.name,agent.role,step,total,thought,tool,result,'',isFC);
        if(shouldFS())appendChat(`mac-msg${isFC?' mac-msg-fc':''}`,html);
        if(shouldST())appendSTChat(`mac-st-bubble${isFC?' mac-st-fc':''}`,html);
    }

    /**
     * @description 发送系统消息到 UI（如回合标记、胜利/失败通知、GM 叙述等）。
     * @param {string} text - 消息文本
     * @param {string} [type='system'] - 消息类型：'system' | 'env' | 'error' | 'warn'
     * @returns {void}
     */
    function postSystemMsg(text,type='system'){
        const cls={system:'mac-msg-sys',env:'mac-msg-env mac-msg-sys',error:'mac-msg-err mac-msg-sys',warn:'mac-msg-wrn mac-msg-sys'};
        const stcls={system:'mac-st-sys',env:'mac-st-sys mac-st-env',error:'mac-st-sys mac-st-error',warn:'mac-st-sys mac-st-warn'};
        if(shouldFS())appendChat(`mac-msg ${cls[type]||'mac-msg-sys'}`,text,true);
        if(shouldST())appendSTChat(stcls[type]||'mac-st-sys',text,true);
    }

    /**
     * @description 在聊天区域显示 Agent "思考中" 动画气泡。返回唯一 ID 用于后续移除。
     * @param {Object} agent - 正在思考的 Agent 对象
     * @param {number} step - 当前步数
     * @param {number} total - 总步数上限
     * @returns {string} 思考气泡的 DOM 元素 ID
     */
    function postThinking(agent,step,total){
        const id=`mac-tk-${Date.now()}`;
        const html=`${agent.icon} ${agent.name} 思考中（步${step}/${total}）<span class="mac-dots">...</span>`;
        if(shouldFS()){const fs=document.getElementById('mac-game-chat');if(fs){const d=document.createElement('div');d.id=id;d.className='mac-msg mac-msg-think';d.innerHTML=html;fs.appendChild(d);fs.scrollTop=fs.scrollHeight;}}
        if(shouldST()){const st=getSTChat();if(st){const d=document.createElement('div');d.id=`st-${id}`;d.className='mac-st-think';d.innerHTML=html;st.appendChild(d);st.scrollTop=st.scrollHeight;}}
        return id;
    }

    /**
     * @description 移除指定 ID 的"思考中"气泡（同时移除全屏和酒馆两侧的副本）。
     * @param {string} id - 思考气泡的 DOM 元素 ID
     * @returns {void}
     */
    function removeThinking(id){if(!id)return;document.getElementById(id)?.remove();document.getElementById(`st-${id}`)?.remove();}

    /**
     * @description 向全屏仪表盘的游戏聊天区域追加一条消息并自动滚动到底部。
     * @param {string} cls - CSS 类名
     * @param {string} html - 消息内容（HTML 或纯文本）
     * @param {boolean} [isText=false] - true 时使用 textContent（纯文本），false 时使用 innerHTML
     * @returns {void}
     */
    function appendChat(cls,html,isText){const el=document.getElementById('mac-game-chat');if(!el)return;const d=document.createElement('div');d.className=cls;if(isText)d.textContent=html;else d.innerHTML=html;el.appendChild(d);el.scrollTop=el.scrollHeight;notifyGame();}

    /**
     * @description 向 SillyTavern 聊天容器追加一条消息并自动滚动到底部。
     * @param {string} cls - CSS 类名
     * @param {string} html - 消息内容（HTML 或纯文本）
     * @param {boolean} [isText=false] - true 时使用 textContent，false 时使用 innerHTML
     * @returns {void}
     */
    function appendSTChat(cls,html,isText){const el=getSTChat();if(!el)return;const d=document.createElement('div');d.className=cls;if(isText)d.textContent=html;else d.innerHTML=html;el.appendChild(d);el.scrollTop=el.scrollHeight;}

    /**
     * @description 当游戏页不可见时，在导航栏游戏按钮上显示未读标记。
     * @returns {void}
     */
    function notifyGame(){if(G.currentPage!=='game'){const b=document.querySelector('.mac-nav[data-page="game"] .mac-nav-badge');if(b)b.style.display='block';}}

    // ── Full-screen app ──

    /**
     * @description 创建并挂载全屏仪表盘应用到 document.body。
     *   构建侧边栏导航（7 页）、顶部标题栏、以及各页面内容：
     *   仪表盘页（统计卡片 + 控制按钮 + 角色状态 + 近期行动）、
     *   游戏页（聊天区 + 输入栏）、智能体配置页、世界编辑页（场景选择 + JSON 编辑 + World Info）、
     *   评估页（指标面板 + 自动测试）、设置页（API/游戏参数/玩家/提示词/存档）、日志页。
     *   同时创建最小化 HUD 气泡，绑定所有事件，渲染初始数据。
     * @returns {void}
     */
    function createFullScreenApp(){
        if(document.getElementById('mac-app'))return;
        const s=cfg();
        const navs=[{p:'dashboard',ic:IC.dash,t:'仪表盘'},{p:'game',ic:IC.game,t:'游戏'},{p:'agents',ic:IC.agents,t:'智能体'},{p:'world',ic:IC.world,t:'世界'},{p:'eval',ic:IC.eval,t:'评估'},{p:'settings',ic:IC.settings,t:'设置'},{p:'logs',ic:IC.logs,t:'日志'}];
        const sb=`<div id="mac-sidebar"><div id="mac-sidebar-logo">${IC.logo}</div>${navs.map(n=>`<button class="mac-nav${n.p==='dashboard'?' active':''}" data-page="${n.p}" data-tip="${n.t}">${n.ic}<span class="mac-nav-badge"></span></button>`).join('')}<span id="mac-sidebar-ver">v${VERSION}</span></div>`;
        const hd=`<div id="mac-header"><span id="mac-header-title">仪表盘</span><button class="mac-hbtn" id="mac-minimize" title="最小化">─</button><button class="mac-hbtn" id="mac-close" title="关闭">✕</button></div>`;
        const dp=`<div class="mac-page active" id="mac-page-dashboard"><div class="mac-stats"><div class="mac-stat"><div class="mac-stat-ico">${IC.game} 回合</div><span class="mac-stat-val" id="mac-d-rounds">0</span></div><div class="mac-stat"><div class="mac-stat-ico">${IC.agents} LLM</div><span class="mac-stat-val" id="mac-d-llm">0</span></div><div class="mac-stat"><div class="mac-stat-ico">${IC.settings} 工具</div><span class="mac-stat-val" id="mac-d-tools">0</span></div><div class="mac-stat"><div class="mac-stat-ico">${IC.eval} FC率</div><span class="mac-stat-val" id="mac-d-fc">—</span></div></div><div class="mac-ctrl-bar"><button class="mac-btn mac-btn-s" id="mac-d-init">初始化</button><button class="mac-btn mac-btn-p" id="mac-d-start" disabled>开始</button><button class="mac-btn mac-btn-w" id="mac-d-pause" disabled>暂停</button><button class="mac-btn mac-btn-d" id="mac-d-stop" disabled>停止</button><span class="mac-badge mac-badge-b" id="mac-d-status">未初始化</span></div><div class="mac-card"><div class="mac-card-t">角色状态</div><div class="mac-agents-grid" id="mac-d-agents"></div></div><div class="mac-card"><div class="mac-card-t">近期行动</div><div id="mac-d-recent" style="max-height:200px;overflow-y:auto;font-size:13px;color:var(--txt2)">暂无</div></div></div>`;
        const gp=`<div class="mac-page" id="mac-page-game"><div id="mac-game-chat"></div><div class="mac-ginput"><input type="text" class="mac-ginput-txt" id="mac-g-input" placeholder="等待初始化…" disabled><button class="mac-ginput-btn" id="mac-g-send" disabled>➤</button></div></div>`;
        const ap=`<div class="mac-page" id="mac-page-agents"><div style="display:flex;gap:8px;margin-bottom:16px"><button class="mac-btn mac-btn-sm mac-btn-s" id="mac-a-add">➕ 添加</button><button class="mac-btn mac-btn-sm mac-btn-p" id="mac-a-save">💾 保存</button></div><div id="mac-a-list"></div></div>`;
        const wp=`<div class="mac-page" id="mac-page-world"><div class="mac-card"><div class="mac-card-t">选择场景</div><div class="mac-scn-grid" id="mac-w-scn"></div></div><div class="mac-sec"><div class="mac-sec-hd" data-t="mac-w-tpl-body">世界模板 JSON <span class="mac-sec-arr">▶</span></div><div id="mac-w-tpl-body" class="mac-sec-bd" style="display:none"><textarea class="mac-ta" id="mac-w-tpl" rows="12"></textarea><div style="margin-top:8px;display:flex;gap:6px"><button class="mac-btn mac-btn-sm mac-btn-p" id="mac-w-save">💾 保存</button><button class="mac-btn mac-btn-sm mac-btn-w" id="mac-w-reset">🔄 重置</button></div></div></div><div class="mac-sec"><div class="mac-sec-hd" data-t="mac-w-wi-body">World Info <span class="mac-sec-arr">▶</span></div><div id="mac-w-wi-body" class="mac-sec-bd" style="display:none"><div style="display:flex;gap:6px;margin-bottom:8px"><button class="mac-btn mac-btn-sm mac-btn-s" id="mac-wi-ref">🔄</button><button class="mac-btn mac-btn-sm mac-btn-p" id="mac-wi-en">✓ 启用</button><button class="mac-btn mac-btn-sm mac-btn-s" id="mac-wi-clr">🗑️</button></div><div class="mac-wi-list" id="mac-wi-list"></div><div class="mac-wi-disp" id="mac-wi-disp" style="margin-top:8px">暂无</div></div></div></div>`;
        const ep=`<div class="mac-page" id="mac-page-eval"><div class="mac-metrics" id="mac-e-met"></div><div class="mac-card"><div class="mac-card-t">自动测试</div><div style="display:flex;gap:8px;align-items:center"><label style="font-size:12px;color:var(--txt2)">轮数</label><input type="number" class="mac-input mac-input-sm" id="mac-e-rounds" value="5" min="1" max="30"><button class="mac-btn mac-btn-sm mac-btn-ok" id="mac-e-run">▶ 运行</button><button class="mac-btn mac-btn-sm mac-btn-s" id="mac-e-reset">🔄</button><span id="mac-e-status" style="font-size:12px;color:var(--txt3)">就绪</span></div></div><div class="mac-card"><div class="mac-card-t">测试结果</div><div id="mac-e-results" style="font-size:13px;color:var(--txt2)">暂无</div></div></div>`;
        const curCh=s.msgChannel||'both';
        const chHTML=`<div class="mac-fr"><label>消息通道</label><div class="mac-ch-sel" id="mac-s-ch">${[{v:'both',l:'双显'},{v:'fullscreen',l:'仅全屏'},{v:'tavern',l:'仅酒馆'}].map(c=>`<button data-ch="${c.v}"${c.v===curCh?' class="active"':''}>${c.l}</button>`).join('')}</div></div>`;
        const sp=`<div class="mac-page" id="mac-page-settings"><div class="mac-sec"><div class="mac-sec-hd" data-t="mac-s-api-body">API 设置 <span class="mac-sec-arr">▼</span></div><div id="mac-s-api-body" class="mac-sec-bd"><div class="mac-fg"><label class="mac-fl">API 地址 <span class="mac-fh">留空=酒馆API</span></label><input class="mac-input" id="mac-s-url" placeholder="https://..." value="${escA(s.apiUrl)}"></div><div class="mac-fg"><label class="mac-fl">API Key</label><input class="mac-input" id="mac-s-key" type="password" value="${escA(s.apiKey)}"></div><div class="mac-fg"><label class="mac-fl">模型</label><input class="mac-input" id="mac-s-model" value="${escA(s.apiModel)}"></div><div class="mac-fr"><label>Function Calling</label><label class="mac-tog"><input type="checkbox" id="mac-s-fc"${s.useFunctionCalling?' checked':''}><span class="mac-tog-s"></span></label></div><div class="mac-fr"><label>GM Agent</label><label class="mac-tog"><input type="checkbox" id="mac-s-gm"${s.gmEnabled?' checked':''}><span class="mac-tog-s"></span></label></div>${chHTML}<div style="display:flex;gap:6px"><button class="mac-btn mac-btn-sm mac-btn-p" id="mac-s-api-save">💾 保存</button><button class="mac-btn mac-btn-sm mac-btn-s" id="mac-s-api-test">🔗 测试</button></div><div class="mac-apir" id="mac-s-api-res"></div></div></div><div class="mac-sec"><div class="mac-sec-hd" data-t="mac-s-game-body">游戏参数 <span class="mac-sec-arr">▶</span></div><div id="mac-s-game-body" class="mac-sec-bd" style="display:none"><div class="mac-fr"><label>最大轮数</label><input class="mac-input mac-input-sm" id="mac-s-rounds" type="number" value="${s.maxRounds}"></div><div class="mac-fr"><label>延迟(ms)</label><input class="mac-input mac-input-sm" id="mac-s-delay" type="number" value="${s.stepDelay}"></div><div class="mac-fr"><label>Agent步数</label><input class="mac-input mac-input-sm" id="mac-s-steps" type="number" value="${s.maxSteps}"></div><div class="mac-fr"><label>LLM超时</label><input class="mac-input mac-input-sm" id="mac-s-timeout" type="number" value="${s.llmTimeout}"></div></div></div><div class="mac-sec"><div class="mac-sec-hd" data-t="mac-s-player-body">玩家设置 <span class="mac-sec-arr">▶</span></div><div id="mac-s-player-body" class="mac-sec-bd" style="display:none"><div class="mac-fr"><label>名称</label><input class="mac-input" id="mac-s-uname" value="${escA(s.userName)}" style="width:150px"></div><div class="mac-fr"><label>头像</label><input class="mac-input mac-input-xs" id="mac-s-uicon" value="${escA(s.userIcon)}"></div></div></div><div class="mac-sec"><div class="mac-sec-hd" data-t="mac-s-prompt-body">Prompt 模板 <span class="mac-sec-arr">▶</span></div><div id="mac-s-prompt-body" class="mac-sec-bd" style="display:none"><div class="mac-fg"><label class="mac-fl">系统提示词</label><textarea class="mac-ta" id="mac-s-sysprompt" rows="3">${esc(pt('systemPrompt'))}</textarea></div><div class="mac-fg"><label class="mac-fl">工具描述</label><textarea class="mac-ta" id="mac-s-toolsdesc" rows="5">${esc(pt('toolsDesc'))}</textarea></div><div class="mac-fg"><label class="mac-fl">输出格式</label><textarea class="mac-ta" id="mac-s-outfmt" rows="2">${esc(pt('outputFormat'))}</textarea></div><div class="mac-fg"><label class="mac-fl">环境叙述</label><textarea class="mac-ta" id="mac-s-envnarr" rows="4">${esc(pt('envNarrations'))}</textarea></div><div style="display:flex;gap:6px"><button class="mac-btn mac-btn-sm mac-btn-p" id="mac-s-pt-save">💾 保存</button><button class="mac-btn mac-btn-sm mac-btn-w" id="mac-s-pt-reset">🔄 默认</button></div></div></div><div class="mac-sec"><div class="mac-sec-hd" data-t="mac-s-save-body">存档管理 <span class="mac-sec-arr">▶</span></div><div id="mac-s-save-body" class="mac-sec-bd" style="display:none">${[1,2,3].map(i=>`<div class="mac-save"><span class="mac-save-l">槽位${i}</span><span class="mac-save-i" id="mac-si-${i}">${getSaveInfo(i)}</span><button class="mac-btn mac-btn-sm mac-btn-s mac-sv" data-slot="${i}">💾</button><button class="mac-btn mac-btn-sm mac-btn-s mac-ld" data-slot="${i}">📂</button></div>`).join('')}</div></div></div>`;
        const lp=`<div class="mac-page" id="mac-page-logs"><div style="display:flex;align-items:center;gap:6px;margin-bottom:8px"><span style="font-size:12px;color:var(--txt3)">底层运行日志（API调用 · 工具执行 · 状态变更）</span><button class="mac-btn mac-btn-sm mac-btn-s" id="mac-l-clear" style="margin-left:auto">🗑️</button></div><div class="mac-logbox" id="mac-l-box"></div></div>`;
        const app=document.createElement('div');app.id='mac-app';app.innerHTML=`${sb}<div id="mac-main">${hd}<div id="mac-content">${dp}${gp}${ap}${wp}${ep}${sp}${lp}</div></div>`;document.body.appendChild(app);
        const mini=document.createElement('div');mini.id='mac-mini-hud';mini.innerHTML=`<span class="mini-dot" id="mac-mini-dot"></span><span id="mac-mini-text">Multi-Agent v${VERSION}</span>`;document.body.appendChild(mini);
        bindAllEvents();renderAgentConfigs();renderScenarios();updateAll();renderLogs();updateEval();
    }

    // ── Floating HUD (with persistence) ──

    /**
     * @description 创建并挂载浮动 HUD 到 document.body。
     *   HUD 显示角色状态摘要、控制按钮和用户输入栏。
     *   支持拖拽移动和折叠/展开，状态通过 localStorage 持久化。
     * @returns {void}
     */
    function createHUD(){
        if(document.getElementById('mac-hud'))return;
        const h=document.createElement('div');h.id='mac-hud';
        h.innerHTML=`<div id="mac-hud-drag"><span id="mac-hud-title">${IC.logo} Multi-Agent</span><span id="mac-hud-round">R0</span><button id="mac-hud-toggle" title="收起">−</button></div><div id="mac-hud-body"><div id="mac-hud-agents"></div><div id="mac-hud-user-sec" class="mac-hud-user-section" style="display:none"><div class="mac-hud-input-wrap"><input id="mac-hud-input" type="text" class="mac-hud-input" placeholder="等待中…" disabled><button id="mac-hud-send" class="mac-hud-send" disabled>➤</button></div></div><div id="mac-hud-status">未初始化</div><div id="mac-hud-btns"><button class="mac-hud-btn" id="mac-hud-init" title="初始化">⟳</button><button class="mac-hud-btn" id="mac-hud-start" disabled title="开始">▶</button><button class="mac-hud-btn" id="mac-hud-pause" disabled title="暂停">⏸</button><button class="mac-hud-btn" id="mac-hud-stop" disabled title="停止">⏹</button></div></div>`;
        document.body.appendChild(h);

        const saved=loadHudState();
        if(saved.left!==undefined){h.style.left=saved.left+'px';h.style.top=saved.top+'px';h.style.right='auto';h.style.bottom='auto';}
        if(saved.collapsed){const b=document.getElementById('mac-hud-body');if(b)b.style.display='none';const btn=document.getElementById('mac-hud-toggle');if(btn)btn.textContent='+';}

        makeDraggable(h,document.getElementById('mac-hud-drag'));
        document.getElementById('mac-hud-toggle').addEventListener('click',()=>{const b=document.getElementById('mac-hud-body');const btn=document.getElementById('mac-hud-toggle');const v=b.style.display==='none';b.style.display=v?'':'none';btn.textContent=v?'−':'+';saveHudState({collapsed:!v});});
        document.getElementById('mac-hud-init').addEventListener('click',doInit);
        document.getElementById('mac-hud-start').addEventListener('click',doStart);
        document.getElementById('mac-hud-pause').addEventListener('click',doPause);
        document.getElementById('mac-hud-stop').addEventListener('click',doStop);
        document.getElementById('mac-hud-send').addEventListener('click',submitUserAction);
        document.getElementById('mac-hud-input').addEventListener('keydown',e=>{if(e.key==='Enter')submitUserAction();});
    }

    /**
     * @description 使 DOM 元素可拖拽。通过 mousedown/mousemove/mouseup 事件实现，
     *   拖拽结束后将位置持久化到 localStorage。
     * @param {HTMLElement} el - 要拖拽的目标元素
     * @param {HTMLElement} handle - 拖拽手柄元素（鼠标按下的区域）
     * @returns {void}
     */
    function makeDraggable(el,handle){
        let drag=false,ox=0,oy=0;handle.style.cursor='grab';
        handle.addEventListener('mousedown',e=>{if(e.target.tagName==='BUTTON')return;drag=true;ox=e.clientX-el.offsetLeft;oy=e.clientY-el.offsetTop;handle.style.cursor='grabbing';e.preventDefault();});
        document.addEventListener('mousemove',e=>{if(!drag)return;const nx=Math.max(0,Math.min(window.innerWidth-el.offsetWidth,e.clientX-ox));const ny=Math.max(0,Math.min(window.innerHeight-el.offsetHeight,e.clientY-oy));el.style.left=nx+'px';el.style.top=ny+'px';el.style.right='auto';el.style.bottom='auto';});
        document.addEventListener('mouseup',()=>{if(!drag)return;drag=false;handle.style.cursor='grab';saveHudState({left:el.offsetLeft,top:el.offsetTop});});
    }

    /**
     * @description 在 SillyTavern 聊天容器下方注入游戏输入栏（若尚未注入）。
     *   输入栏包含文本框和发送按钮，绑定 Enter 和 click 事件提交用户行动。
     * @returns {void}
     */
    function ensureChatBar(){
        if(document.getElementById('mac-chat-bar'))return;
        const st=getSTChat();if(!st)return;
        const bar=document.createElement('div');bar.id='mac-chat-bar';bar.style.display='none';
        bar.innerHTML='<div class="mac-hud-input-wrap"><input id="mac-chat-input" type="text" class="mac-hud-input" placeholder="等待中…" disabled style="font-size:14px;padding:8px 12px"><button class="mac-hud-send" onclick="return false" id="mac-chat-send" disabled>➤</button></div>';
        st.parentElement?.appendChild(bar);
        document.getElementById('mac-chat-send')?.addEventListener('click',submitUserAction);
        document.getElementById('mac-chat-input')?.addEventListener('keydown',e=>{if(e.key==='Enter')submitUserAction();});
    }

    /**
     * @description 更新浮动 HUD 的所有动态内容：回合数、角色状态列表（HP 条 + 位置）、
     *   运行状态文本、以及控制按钮的启用/禁用状态。
     * @returns {void}
     */
    function updateHUD(){
        const rEl=document.getElementById('mac-hud-round');if(rEl)rEl.textContent=`R${G.round}`;
        const aEl=document.getElementById('mac-hud-agents');
        if(aEl){const all=[...(G.userAgent?[G.userAgent]:[]),...G.agents];aEl.innerHTML=all.map((a,i)=>{const isU=a.id==='user';const pct=a.maxHp>0?Math.round(a.hp/a.maxHp*100):0;const loc=G.world?.locations?.[a.location]?.name||a.location||'?';const bg=pct>50?'#7ec89a':pct>25?'#dbb866':'#d47070';return`<div class="hud-agent${isU?' hud-user':''}${!isU&&G.running&&i-1===G.curIdx?' hud-active':''}"><span class="hud-icon">${a.icon}</span><span class="hud-name">${a.name}</span><span class="hud-hp">${a.hp}/${a.maxHp}</span><div class="hud-bar"><div class="hud-bar-fill" style="width:${pct}%;background:${bg}"></div></div><span class="hud-loc">${loc}</span></div>`;}).join('');}
        const sEl=document.getElementById('mac-hud-status');if(sEl)sEl.textContent=!G.inited?'未初始化':!G.running?'已停止':G.waitingForUser?'等待行动…':G.paused?'已暂停':`运行中 R${G.round}`;
        ['mac-hud-start'].forEach(id=>{const e=document.getElementById(id);if(e)e.disabled=!G.inited||G.running;});
        ['mac-hud-pause'].forEach(id=>{const e=document.getElementById(id);if(e)e.disabled=!G.running;});
        ['mac-hud-stop'].forEach(id=>{const e=document.getElementById(id);if(e)e.disabled=!G.running;});
    }

    /**
     * @description 统一更新所有 UI 组件：仪表盘、HUD、酒馆聊天栏注入、最小化气泡状态。
     * @returns {void}
     */
    function updateAll(){updateDashboard();updateHUD();ensureChatBar();
        const md=document.getElementById('mac-mini-dot'),mt=document.getElementById('mac-mini-text');
        if(md)md.className=`mini-dot${G.running?' on':''}`;if(mt)mt.textContent=G.running?`R${G.round} ${G.waitingForUser?'等待行动':'运行中'}`:`Multi-Agent v${VERSION}`;
    }

    /**
     * @description 更新仪表盘页面的所有数据：统计卡片（回合/LLM/工具/FC率）、
     *   运行状态徽章、控制按钮启用状态、角色状态卡片网格、近期行动列表。
     * @returns {void}
     */
    function updateDashboard(){
        const m=getMetrics(),set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
        set('mac-d-rounds',G.round);set('mac-d-llm',m.llmCalls);set('mac-d-tools',m.toolCalls);set('mac-d-fc',m.fcRate>0?m.fcRate+'%':'—');
        set('mac-d-status',!G.inited?'未初始化':!G.running?'已停止':G.waitingForUser?'等待行动':G.paused?'已暂停':'运行中');
        const sEl=document.getElementById('mac-d-status');if(sEl)sEl.className='mac-badge '+(!G.inited?'mac-badge-r':!G.running?'mac-badge-y':G.waitingForUser?'mac-badge-b':G.paused?'mac-badge-y':'mac-badge-g');
        ['mac-d-init'].forEach(id=>{const e=document.getElementById(id);if(e)e.disabled=G.running;});
        ['mac-d-start'].forEach(id=>{const e=document.getElementById(id);if(e)e.disabled=!G.inited||G.running;});
        ['mac-d-pause'].forEach(id=>{const e=document.getElementById(id);if(e)e.disabled=!G.running;});
        ['mac-d-stop'].forEach(id=>{const e=document.getElementById(id);if(e)e.disabled=!G.running;});
        const agEl=document.getElementById('mac-d-agents');
        if(agEl){const all=[...(G.userAgent?[G.userAgent]:[]),...G.agents];agEl.innerHTML=all.map(a=>{const pct=a.maxHp>0?Math.round(a.hp/a.maxHp*100):0;const loc=G.world?.locations?.[a.location]?.name||a.location||'?';const bg=pct>50?'#7ec89a':pct>25?'#dbb866':'#d47070';return`<div class="mac-ag-card"><div class="mac-ag-head"><span class="mac-ag-icon">${a.icon}</span><span class="mac-ag-name">${a.name}</span><span class="mac-ag-role">${a.role}</span></div><div class="mac-hp"><div class="mac-hp-fill" style="width:${pct}%;background:${bg}"></div></div><div class="mac-ag-info">${loc} · HP ${a.hp}/${a.maxHp} · ATK ${a.atk||20} · 💰${a.gold}</div></div>`;}).join('');}
        const rEl=document.getElementById('mac-d-recent');if(rEl){const rec=G.actionsHistory.slice(-10).reverse();rEl.innerHTML=rec.length?rec.map(h=>`<div style="padding:3px 0;border-bottom:1px solid rgba(195,155,60,.06)">[R${h.round}] ${h.agentName}: <span style="color:${TC[h.tool]||'#6a6258'}">${TL[h.tool]||h.tool}</span> → ${esc((h.observation||'').substring(0,80))}</div>`).join(''):'暂无';}
    }

    /**
     * @description 导航到仪表盘的指定页面。切换页面显示/隐藏、导航按钮激活状态、
     *   页面标题，并在进入特定页面时执行数据刷新。
     * @param {string} page - 目标页面 ID（dashboard/game/agents/world/eval/settings/logs）
     * @returns {void}
     */
    function navigateTo(page){G.currentPage=page;document.querySelectorAll('.mac-page').forEach(e=>e.classList.remove('active'));document.querySelectorAll('.mac-nav').forEach(e=>e.classList.remove('active'));const pEl=document.getElementById(`mac-page-${page}`),nEl=document.querySelector(`.mac-nav[data-page="${page}"]`);if(pEl)pEl.classList.add('active');if(nEl){nEl.classList.add('active');const b=nEl.querySelector('.mac-nav-badge');if(b)b.style.display='none';}const titles={dashboard:'仪表盘',game:'游戏',agents:'智能体配置',world:'世界编辑',eval:'评估系统',settings:'设置',logs:'系统日志'};const tEl=document.getElementById('mac-header-title');if(tEl)tEl.textContent=titles[page]||page;if(page==='game'){const c=document.getElementById('mac-game-chat');if(c)c.scrollTop=c.scrollHeight;}if(page==='eval')updateEval();if(page==='logs')renderLogs();}

    /**
     * @description 切换全屏仪表盘应用的显示/隐藏状态。同时联动最小化 HUD 气泡和顶栏按钮。
     * @returns {void}
     */
    function toggleApp(){const a=document.getElementById('mac-app'),m=document.getElementById('mac-mini-hud');if(!a)return;const show=!a.classList.contains('visible');a.classList.toggle('visible',show);if(m)m.style.display=show?'none':'flex';const b=document.getElementById('mac-topbar-btn');if(b)b.classList.toggle('active',show);}

    /**
     * @description 渲染智能体配置编辑器页面。根据当前配置生成每个 Agent 的编辑表单
     *   （图标、名称、角色、ATK、DEF、提示词），并绑定删除按钮事件。
     * @returns {void}
     */
    function renderAgentConfigs(){const el=document.getElementById('mac-a-list');if(!el)return;const s=cfg();el.innerHTML=s.agents.map((a,i)=>`<div class="mac-acfg"><div class="mac-acfg-hd"><input class="mac-input mac-input-xs mac-ai" value="${escA(a.icon)}" data-i="${i}"><input class="mac-input mac-an" value="${escA(a.name)}" placeholder="名称" data-i="${i}" style="flex:1"><input class="mac-input mac-ar" value="${escA(a.role)}" placeholder="角色" data-i="${i}" style="width:80px"><button class="mac-btn-ico mac-adel" data-i="${i}">🗑️</button></div><div style="display:flex;gap:6px;margin-bottom:6px"><label style="font-size:11px;color:var(--txt3)">ATK</label><input class="mac-input mac-input-xs mac-aatk" value="${a.atk||20}" data-i="${i}"><label style="font-size:11px;color:var(--txt3)">DEF</label><input class="mac-input mac-input-xs mac-adef" value="${a.def||0}" data-i="${i}"></div><textarea class="mac-ta mac-ap" rows="3" data-i="${i}" placeholder="角色提示词…">${esc(a.prompt)}</textarea></div>`).join('');el.querySelectorAll('.mac-adel').forEach(b=>b.addEventListener('click',()=>{const i=parseInt(b.dataset.i);if(s.agents.length<=1)return;if(confirm(`删除"${s.agents[i].name}"？`)){s.agents.splice(i,1);saveCfg();renderAgentConfigs();}}));}

    /**
     * @description 渲染场景选择器。列出所有可用场景卡片，点击后切换场景、
     *   更新 Agent 列表和世界模板，持久化配置。
     * @returns {void}
     */
    function renderScenarios(){const el=document.getElementById('mac-w-scn');if(!el)return;const cur=cfg().scenario||'rpg';el.innerHTML=Object.entries(SCENARIOS).map(([id,sc])=>`<div class="mac-scn${id===cur?' sel':''}" data-sc="${id}"><div class="mac-scn-ico">${sc.icon}</div><div class="mac-scn-nm">${sc.name}</div><div class="mac-scn-ds">${sc.desc}</div></div>`).join('');el.querySelectorAll('.mac-scn').forEach(c=>c.addEventListener('click',()=>{const s=cfg();s.scenario=c.dataset.sc;s.agents=JSON.parse(JSON.stringify(SCENARIOS[s.scenario].agents));s.promptTemplates=s.promptTemplates||{};s.promptTemplates.worldTpl=JSON.stringify(SCENARIOS[s.scenario].world,null,2);saveCfg();renderScenarios();renderAgentConfigs();const t=document.getElementById('mac-w-tpl');if(t)t.value=s.promptTemplates.worldTpl;}));const t=document.getElementById('mac-w-tpl');if(t)t.value=cfg().promptTemplates?.worldTpl||JSON.stringify(getScenario().world,null,2);}

    /**
     * @description 渲染系统日志页面。显示最近 500 条日志，每条含时间戳、级别颜色和消息内容。
     * @returns {void}
     */
    function renderLogs(){const el=document.getElementById('mac-l-box');if(!el)return;el.innerHTML=LOG.slice(-500).map(e=>`<div class="mac-log-e mac-log-${e.level}"><span class="mac-log-ts">${e.ts}</span> ${esc(e.msg)}</div>`).join('');el.scrollTop=el.scrollHeight;}

    /**
     * @description 更新评估页面的性能指标面板（回合/LLM/工具/FC/文本/FC率/均响应/错误/胜/败）。
     * @returns {void}
     */
    function updateEval(){const el=document.getElementById('mac-e-met');if(!el)return;const m=getMetrics();el.innerHTML=[{l:'回合',v:m.rounds,c:'var(--txt)'},{l:'LLM',v:m.llmCalls,c:'var(--gold-l)'},{l:'工具',v:m.toolCalls,c:'var(--ok)'},{l:'FC',v:m.fcCalls,c:'#b08ee6'},{l:'文本',v:m.textCalls,c:'var(--warn)'},{l:'FC率',v:m.fcRate+'%',c:'var(--ok)'},{l:'均响应',v:m.avgMs+'ms',c:'var(--gold-l)'},{l:'错误',v:m.errors,c:'var(--err)'},{l:'胜',v:m.successes,c:'var(--ok)'},{l:'败',v:m.failures,c:'var(--err)'}].map(x=>`<div class="mac-metric"><div class="mac-metric-v" style="color:${x.c}">${x.v}</div><div class="mac-metric-l">${x.l}</div></div>`).join('');}

    /**
     * @description 异步渲染 World Info 文件选择列表。从 SillyTavern 获取所有 WI 文件名，
     *   生成复选框列表，已选中的 WI 文件保持勾选状态。
     * @returns {Promise<void>}
     */
    async function renderWIList(){const el=document.getElementById('mac-wi-list');if(!el)return;el.innerHTML='<span style="font-size:12px;color:var(--txt3)">加载中…</span>';const names=await getSTWorldInfoNames();if(!names.length){el.innerHTML='<span style="font-size:12px;color:var(--txt3)">无</span>';return;}const sel=cfg().worldInfoSelected||[];el.innerHTML=names.map(n=>`<label class="mac-wi-item"><input type="checkbox" class="mac-wic" value="${escA(n)}"${sel.includes(n)?' checked':''}> ${esc(n)}</label>`).join('');}

    // ── Event Binding ──

    /**
     * @description 绑定全屏仪表盘应用中的所有 UI 事件。包括：
     *   - 侧边栏导航点击
     *   - 窗口最小化/关闭按钮
     *   - 仪表盘控制按钮（初始化/开始/暂停/停止）
     *   - 游戏页输入框发送（Enter 键和按钮点击）
     *   - 智能体配置的添加/保存
     *   - 世界模板的保存/重置
     *   - World Info 的刷新/启用/清除
     *   - API 设置的保存/测试连接
     *   - 消息通道切换
     *   - 游戏参数变更（最大轮数/延迟/步数/超时）
     *   - 提示词模板的保存/重置
     *   - 存档的保存/读取
     *   - 评估页的运行/重置
     *   - 日志清除
     *   - 设置页折叠面板的展开/收起
     *   - Escape 键关闭全屏应用
     * @returns {void}
     */
    function bindAllEvents(){
        document.querySelectorAll('.mac-nav').forEach(b=>b.addEventListener('click',()=>navigateTo(b.dataset.page)));
        document.getElementById('mac-minimize')?.addEventListener('click',toggleApp);
        document.getElementById('mac-close')?.addEventListener('click',toggleApp);
        document.getElementById('mac-mini-hud')?.addEventListener('click',toggleApp);
        document.getElementById('mac-d-init')?.addEventListener('click',doInit);
        document.getElementById('mac-d-start')?.addEventListener('click',doStart);
        document.getElementById('mac-d-pause')?.addEventListener('click',doPause);
        document.getElementById('mac-d-stop')?.addEventListener('click',doStop);
        document.getElementById('mac-g-send')?.addEventListener('click',submitUserAction);
        document.getElementById('mac-g-input')?.addEventListener('keydown',e=>{if(e.key==='Enter')submitUserAction();});
        document.getElementById('mac-a-add')?.addEventListener('click',()=>{const s=cfg();s.agents.push({id:`agent_${Date.now()}`,name:`角色${s.agents.length+1}`,icon:'🤖',role:'冒险者',hp:100,maxHp:100,atk:20,def:0,bonuses:{},location:Object.keys(getScenario().world.locations)[0],inventory:[],gold:0,priority:s.agents.length+1,prompt:''});saveCfg();renderAgentConfigs();});
        document.getElementById('mac-a-save')?.addEventListener('click',()=>{const s=cfg();document.querySelectorAll('.mac-ai').forEach((el,i)=>{if(!s.agents[i])return;s.agents[i].icon=el.value.trim()||'🤖';s.agents[i].name=document.querySelectorAll('.mac-an')[i]?.value.trim()||`角色${i+1}`;s.agents[i].role=document.querySelectorAll('.mac-ar')[i]?.value.trim()||'冒险者';s.agents[i].atk=parseInt(document.querySelectorAll('.mac-aatk')[i]?.value)||20;s.agents[i].def=parseInt(document.querySelectorAll('.mac-adef')[i]?.value)||0;s.agents[i].prompt=document.querySelectorAll('.mac-ap')[i]?.value.trim()||'';s.agents[i].id=s.agents[i].id||'a_'+i;s.agents[i].maxHp=s.agents[i].maxHp||100;s.agents[i].priority=i+1;});saveCfg();addLog('角色已保存');});
        document.getElementById('mac-w-save')?.addEventListener('click',()=>{const s=cfg();s.promptTemplates=s.promptTemplates||{};s.promptTemplates.worldTpl=document.getElementById('mac-w-tpl')?.value||'';saveCfg();addLog('世界模板已保存（下次初始化生效）');});
        document.getElementById('mac-w-reset')?.addEventListener('click',()=>{const t=JSON.stringify(getScenario().world,null,2);const e=document.getElementById('mac-w-tpl');if(e)e.value=t;const s=cfg();s.promptTemplates=s.promptTemplates||{};s.promptTemplates.worldTpl=t;saveCfg();});
        document.getElementById('mac-wi-ref')?.addEventListener('click',renderWIList);
        document.getElementById('mac-wi-en')?.addEventListener('click',async()=>{const ch=[...document.querySelectorAll('.mac-wic:checked')].map(e=>e.value);if(!ch.length)return;const s=cfg();s.worldInfoSelected=ch;const ts=[];for(const n of ch){const t=await loadSTWorldInfoFile(n);if(t)ts.push(t);}s.worldInfo=ts.join('\n---\n').substring(0,2000);saveCfg();const d=document.getElementById('mac-wi-disp');if(d)d.textContent=s.worldInfo.substring(0,500);});
        document.getElementById('mac-wi-clr')?.addEventListener('click',()=>{const s=cfg();s.worldInfo='';s.worldInfoSelected=[];saveCfg();document.querySelectorAll('.mac-wic').forEach(e=>e.checked=false);const d=document.getElementById('mac-wi-disp');if(d)d.textContent='暂无';});
        document.getElementById('mac-s-api-save')?.addEventListener('click',()=>{const s=cfg();s.apiUrl=document.getElementById('mac-s-url')?.value.trim()||'';s.apiKey=document.getElementById('mac-s-key')?.value.trim()||'';s.apiModel=document.getElementById('mac-s-model')?.value.trim()||'gpt-4o-mini';s.useFunctionCalling=document.getElementById('mac-s-fc')?.checked??true;s.gmEnabled=document.getElementById('mac-s-gm')?.checked??true;G.gmEnabled=s.gmEnabled;saveCfg();addLog('API 设置已保存');});
        document.getElementById('mac-s-api-test')?.addEventListener('click',async()=>{const url=document.getElementById('mac-s-url')?.value.trim(),key=document.getElementById('mac-s-key')?.value.trim(),model=document.getElementById('mac-s-model')?.value.trim()||'gpt-4o-mini',res=document.getElementById('mac-s-api-res');if(!url){showApi(res,'请填写API地址','err');return;}showApi(res,'⏳ 测试中…','info');try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({model,messages:[{role:'user',content:'Hi'}],max_tokens:5})});showApi(res,r.ok?'✅ 连接成功！':friendlyError(r.status),r.ok?'ok':'err');}catch(e){showApi(res,e.name==='TypeError'?'❌ 网络错误：无法连接到该地址，请检查URL':`❌ ${e.message}`,'err');}});
        document.getElementById('mac-s-ch')?.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('#mac-s-ch button').forEach(x=>x.classList.remove('active'));b.classList.add('active');const s=cfg();s.msgChannel=b.dataset.ch;saveCfg();addLog(`消息通道: ${b.textContent}`);}));
        ['mac-s-rounds','mac-s-delay','mac-s-steps','mac-s-timeout'].forEach(id=>{document.getElementById(id)?.addEventListener('change',function(){const s=cfg(),mp={'mac-s-rounds':'maxRounds','mac-s-delay':'stepDelay','mac-s-steps':'maxSteps','mac-s-timeout':'llmTimeout'};s[mp[id]]=parseInt(this.value)||s[mp[id]];saveCfg();});});
        document.getElementById('mac-s-pt-save')?.addEventListener('click',()=>{const s=cfg(),t=s.promptTemplates||{};t.systemPrompt=document.getElementById('mac-s-sysprompt')?.value||t.systemPrompt;t.toolsDesc=document.getElementById('mac-s-toolsdesc')?.value||t.toolsDesc;t.outputFormat=document.getElementById('mac-s-outfmt')?.value||t.outputFormat;t.envNarrations=document.getElementById('mac-s-envnarr')?.value||t.envNarrations;s.promptTemplates=t;saveCfg();});
        document.getElementById('mac-s-pt-reset')?.addEventListener('click',()=>{if(!confirm('恢复默认？'))return;cfg().promptTemplates={...DEFAULT_PROMPTS};saveCfg();const sv=(id,k)=>{const e=document.getElementById(id);if(e)e.value=pt(k);};sv('mac-s-sysprompt','systemPrompt');sv('mac-s-toolsdesc','toolsDesc');sv('mac-s-outfmt','outputFormat');sv('mac-s-envnarr','envNarrations');});
        document.querySelectorAll('.mac-sv').forEach(b=>b.addEventListener('click',()=>saveGame(parseInt(b.dataset.slot))));
        document.querySelectorAll('.mac-ld').forEach(b=>b.addEventListener('click',()=>loadGame(parseInt(b.dataset.slot))));
        document.getElementById('mac-e-run')?.addEventListener('click',()=>runAutoTest(parseInt(document.getElementById('mac-e-rounds')?.value)||5));
        document.getElementById('mac-e-reset')?.addEventListener('click',resetMetrics);
        document.getElementById('mac-l-clear')?.addEventListener('click',()=>{LOG=[];renderLogs();});
        document.querySelectorAll('.mac-sec-hd').forEach(hd=>{hd.addEventListener('click',()=>{const t=document.getElementById(hd.dataset.t);const a=hd.querySelector('.mac-sec-arr');if(!t)return;const o=t.style.display!=='none';t.style.display=o?'none':'block';if(a)a.textContent=o?'▶':'▼';});});
        document.addEventListener('keydown',e=>{if(e.key==='Escape'){const a=document.getElementById('mac-app');if(a&&a.classList.contains('visible'))toggleApp();}});
    }

    /**
     * @description 在 API 测试结果区域显示反馈信息。
     * @param {HTMLElement|null} el - 结果显示容器元素
     * @param {string} text - 要显示的文本
     * @param {string} type - 消息类型（'ok' | 'err' | 'info'），影响 CSS 样式
     * @returns {void}
     */
    function showApi(el,text,type){if(!el)return;el.textContent=text;el.className=`mac-apir mac-apir-${type}`;el.style.display='block';}

    // ══════════════════════════════════════════════════════════════
    //  PART 9 — 启动（MutationObserver）
    //
    //  本部分实现了扩展的自启动逻辑：
    //  - injectTopBar: 在 SillyTavern 顶栏注入系统入口按钮
    //  - initOnce: 一次性初始化（创建全屏应用 + HUD + 顶栏按钮）
    //  - boot: 启动入口，通过三种策略确保初始化成功：
    //    1) 监听 SillyTavern 事件（APP_READY / APP_INITIALIZED / EXTENSION_SETTINGS_LOADED）
    //    2) MutationObserver 监听 DOM 变化，探测顶栏元素出现
    //    3) 兜底 setTimeout（500ms + 2000ms）
    // ══════════════════════════════════════════════════════════════

    /** @type {boolean} initDone - 初始化是否已完成（确保 initOnce 只执行一次） */
    let initDone=false;

    /**
     * @description 尝试在 SillyTavern 顶栏注入系统入口按钮。
     *   按候选选择器列表查找顶栏容器，找到后插入带 SVG Logo 的按钮。
     * @returns {boolean} 是否成功注入（true=已注入或之前已存在）
     */
    function injectTopBar(){if(document.getElementById('mac-topbar-btn'))return true;const sels=['#top-settings-holder','#topBar','#top-bar','.drag-grabber'];let c=null;for(const s of sels){c=document.querySelector(s);if(c)break;}if(!c)return false;const b=document.createElement('div');b.id='mac-topbar-btn';b.title='多智能体协作系统';b.innerHTML=IC.logo;b.addEventListener('click',toggleApp);c.appendChild(b);return true;}

    /**
     * @description 一次性初始化函数。创建全屏仪表盘应用、浮动 HUD、注入顶栏按钮。
     *   通过 initDone 标志确保只执行一次，失败时静默记录错误到控制台。
     * @returns {void}
     */
    function initOnce(){
        if(initDone)return;
        try{
            if(!document.getElementById('mac-app'))createFullScreenApp();
            if(!document.getElementById('mac-hud'))createHUD();
            injectTopBar();
            initDone=true;
            addLog(`v${VERSION} 初始化完成`);
            console.log(`[MultiAgent v${VERSION}] ready`);
        }catch(e){console.error('[MultiAgent]',e);}
    }

    /**
     * @description 模块启动入口函数。采用三重策略确保初始化成功：
     *   1) 监听 SillyTavern 生命周期事件（APP_READY 等）
     *   2) 使用 MutationObserver 监听 body DOM 变化，检测顶栏元素出现后初始化
     *   3) 设置 500ms 和 2000ms 两个兜底定时器
     *   三种策略中最先触发的会执行 initOnce，后续触发自动跳过。
     * @returns {void}
     */
    function boot(){
        console.log(`[MultiAgent v${VERSION}] loading…`);
        try{
            const ctx=typeof SillyTavern!=='undefined'&&SillyTavern.getContext?SillyTavern.getContext():null;
            if(ctx?.eventSource){
                const et=ctx.event_types||{};
                const go=()=>setTimeout(initOnce,0);
                ctx.eventSource.on(et.APP_READY||'app_ready',go);
                if(et.APP_INITIALIZED)ctx.eventSource.on(et.APP_INITIALIZED,go);
                if(et.EXTENSION_SETTINGS_LOADED)ctx.eventSource.on(et.EXTENSION_SETTINGS_LOADED,go);
            }
        }catch(e){console.error('[MultiAgent] events:',e);}

        const obs = new MutationObserver(()=>{
            if(initDone){obs.disconnect();return;}
            if(document.getElementById('top-settings-holder')||document.getElementById('topBar')||document.querySelector('.drag-grabber')){
                obs.disconnect();
                initOnce();
            }
        });
        obs.observe(document.body,{childList:true,subtree:true});

        setTimeout(initOnce,500);
        setTimeout(initOnce,2000);
    }
    boot();
})();
