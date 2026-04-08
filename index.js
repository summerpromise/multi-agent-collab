/**
 * 多智能体协作系统 v4.0 - SillyTavern UI Extension
 *
 * 五层架构：
 *  层一 数据持久层  —— extensionSettings 配置 + localStorage 存档
 *  层二 游戏引擎层  —— 世界状态、工具执行、胜负判定
 *  层三 执行引擎层  —— ReAct 循环（逐步）、Prompt 构建、LLM 调用、目标检测、失败降级、超时熔断
 *  层四 Agent协调层 —— Round-Robin 调度、消息队列、事件广播、环境回合
 *  层五 前端交互层  —— 悬浮 HUD、聊天气泡注入、扩展面板、按钮事件
 */

(function () {
    'use strict';

    const MODULE  = 'multi_agent_collab';
    const SAVE_KEY = 'mac_game_save';

    // ──────────────────────────────────────────────────────────
    //  全局常量：世界模板 & Agent 模板
    // ──────────────────────────────────────────────────────────

    const WORLD_TPL = {
        locations: {
            village:          { name: '村庄',     desc: '宁静的小村庄，有旅馆和补给。', conn: ['forest', 'dungeon_entrance'], items: ['healing_potion', 'bread'],             enemies: [] },
            forest:           { name: '迷雾森林', desc: '茂密森林，草药与陷阱并存。',   conn: ['village', 'cave'],            items: ['herbs', 'arrows'],                enemies: ['wolf', 'goblin'] },
            dungeon_entrance: { name: '地牢入口', desc: '阴冷入口，骷髅把守。',          conn: ['village', 'dungeon_hall'],    items: [],                                 enemies: ['skeleton'] },
            dungeon_hall:     { name: '地牢大厅', desc: '终点大厅，魔剑与恶魔在此。',   conn: ['dungeon_entrance'],           items: ['magic_sword', 'gold_coin'],       enemies: ['demon', 'vampire'] },
            cave:             { name: '神秘山洞', desc: '法力充沛，魔法威力翻倍。',      conn: ['forest'],                     items: ['magic_crystal', 'ancient_scroll'], enemies: ['cave_troll'] }
        },
        items: {
            healing_potion: { name: '治疗药水', effect: 'heal',     val: 30 },
            bread:          { name: '面包',     effect: 'heal',     val: 10 },
            herbs:          { name: '草药',     effect: 'heal',     val: 15 },
            arrows:         { name: '箭矢',     effect: 'weapon',   val: 5  },
            magic_sword:    { name: '魔法剑',   effect: 'weapon',   val: 25 },
            gold_coin:      { name: '金币',     effect: 'currency', val: 10 },
            magic_crystal:  { name: '魔法水晶', effect: 'magic',    val: 20 },
            ancient_scroll: { name: '古老卷轴', effect: 'magic',    val: 30 }
        },
        enemies: {
            wolf:       { name: '灰狼',     hp: 30, maxHp: 30, dmg: 15, reward: 5  },
            goblin:     { name: '哥布林',   hp: 25, maxHp: 25, dmg: 10, reward: 8  },
            skeleton:   { name: '骷髅',     hp: 40, maxHp: 40, dmg: 18, reward: 12 },
            demon:      { name: '恶魔',     hp: 60, maxHp: 60, dmg: 25, reward: 20 },
            vampire:    { name: '吸血鬼',   hp: 50, maxHp: 50, dmg: 22, reward: 18 },
            cave_troll: { name: '山洞巨魔', hp: 70, maxHp: 70, dmg: 30, reward: 25 }
        }
    };

    const ENEMY_HOME = {
        wolf: 'forest', goblin: 'forest',
        skeleton: 'dungeon_entrance',
        cave_troll: 'cave'
    };

    const AGENTS_TPL = [
        {
            id: 'warrior', name: '战士阿强', icon: '⚔️', role: '战士',
            hp: 100, maxHp: 100, location: 'village', inventory: ['bread'], gold: 10, priority: 1,
            prompt: '你是战士阿强，勇猛善战，擅长近战与保护队友。你的目标是探索地牢、击败恶魔，保护法师小慧的安全。物理攻击伤害30，持有魔法剑额外+25，战士减伤5点。'
        },
        {
            id: 'mage', name: '法师小慧', icon: '🔮', role: '法师',
            hp: 70, maxHp: 70, location: 'village', inventory: ['ancient_scroll'], gold: 15, priority: 2,
            prompt: '你是法师小慧，智慧过人，擅长搜索隐藏物品与魔法攻击。你的目标是收集魔法材料，协助战士阿强击败敌人。魔法攻击伤害20，在神秘山洞内额外+20。'
        }
    ];

    const DEFAULT_PROMPT_TEMPLATES = {
        systemPrompt: '你是文字RPG中的自由Agent。THOUGHT 表达你的真实想法与推理；ACTION 可以是自然语言（说话、叙述、反应）或JSON格式的游戏操作。根据人设自由表达，不必拘泥于固定指令。',
        worldTpl: JSON.stringify(WORLD_TPL, null, 2),
        toolsDesc: `【可参考的游戏操作】（名称可用中文，如"面包"、"地牢入口"、"骷髅"）
- move: 移动。params: {"destination":"地点名或ID"}
- search: 搜索当前地点。params: {}
- pickup_item: 拾取物品。params: {"target":"物品名或ID"}
- attack: 攻击敌人。params: {"target":"敌人名或ID"}
- speak: 对某人说话（自然语言）。params: {"to":"对象名或ID","message":"内容"}
- narrate: 叙述/反应/内心独白（纯自然语言）。params: {"text":"内容"}
- inspect: 查看详情。params: {"target":"名或ID"}
- use_item: 使用物品。params: {"item":"物品名或ID"}
- rest: 休息。params: {}
- complete_turn: 结束本回合。params: {"summary":"总结"}

【自由表达】若只想说话、观察、反应，可直接用 speak 或 narrate；也可在 ACTION 中写自然语言，系统会理解意图。`,
        outputFormat: 'THOUGHT: [你的真实想法、推理、感受，自由表达]\nACTION: [JSON格式如 {"tool":"move","params":{"destination":"地牢入口"}} 或 自然语言如 "对玩家说：小心前面！"]',
        initRouteA: '村庄 → 迷雾森林 → 神秘山洞',
        initRouteB: '村庄 → 地牢入口 → 地牢大厅（终点）',
        initGoal: '击败地牢大厅的恶魔&吸血鬼，取得魔法宝剑！',
        envNarrations: [
            '🌧️ 暴雨倾盆，迷雾森林的能见度大幅降低，行动需谨慎。',
            '🌟 神秘光芒笼罩大地，冒险者们感到精神振奋。',
            '💨 地牢深处传来恶魔的嘶吼，令人不寒而栗。',
            '🌙 夜幕降临，不死生物的力量悄然增强。',
            '☀️ 晨光破晓，冒险者们精神饱满，状态绝佳。',
            '🍃 山风吹过，草药的香气让人恢复一丝活力。',
            '🔥 远处天边出现异象，似乎有强大的魔法波动。',
            '❄️ 寒气从地牢入口涌出，骸骨的碰撞声隐约可闻。'
        ].join('\n'),
        goalSuccess: '地牢大厅已清空，任务完成！',
        goalFail: 'HP为0，无法继续',
        envTurnLabel: '环境变化',
        envCalm: '风平浪静，无明显变化。',
        roundHistoryLabel: '其他Agent近期行动',
        observationLabel: '本回合已执行历史（Observation）',
        teammateMsgLabel: '队友来信（请优先回应）',
        teammateLabel: '队友',
        userLabel: '玩家（主角，你需协助）',
        userActionLabel: '玩家行动',
        userIntentPrompt: '意图理解：理解用户自然语言，输出JSON。攻击目标可为敌人或同地点NPC。支持模糊表达。',
        waitForUserHint: '输入你的行动（自然语言）'
    };

    // ──────────────────────────────────────────────────────────
    //  运行状态（全局 G）
    // ──────────────────────────────────────────────────────────

    let G = {
        running: false, paused: false, stopReq: false,
        round: 0, curIdx: 0,
        agents: [], userAgent: null, world: null, inited: false,
        msgQueue: [], actionsHistory: [],
        waitingForUser: false, userActionResolve: null
    };

    let LOG = [];

    function addLog(msg, level = 'info') {
        const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        LOG.push({ ts, level, msg: String(msg) });
        if (LOG.length > 400) LOG.splice(0, LOG.length - 400);
        renderLog();
    }

    function renderLog() {
        const el = document.getElementById('mac-log-box');
        if (!el) return;
        el.innerHTML = LOG.slice(-100).map(e =>
            `<div class="mac-log-line mac-log-${e.level}">[${e.ts}] ${escHtml(e.msg)}</div>`
        ).join('');
        el.scrollTop = el.scrollHeight;
    }

    // ══════════════════════════════════════════════════════════
    //  层一：数据持久层
    // ══════════════════════════════════════════════════════════

    function cfg() {
        const { extensionSettings } = SillyTavern.getContext();
        if (!extensionSettings[MODULE]) {
            extensionSettings[MODULE] = {
                apiUrl: '', apiKey: '', apiModel: 'gpt-4o-mini',
                maxRounds: 10, stepDelay: 1000, maxSteps: 5,
                llmTimeout: 60000, worldInfo: '',
                agents: JSON.parse(JSON.stringify(AGENTS_TPL))
            };
        }
        const s = extensionSettings[MODULE];
        if (!s.agents)     s.agents     = JSON.parse(JSON.stringify(AGENTS_TPL));
        if (!s.userName)   s.userName   = '玩家';
        if (!s.userIcon)   s.userIcon   = '👤';
        if (!s.maxSteps)   s.maxSteps   = 5;
        if (!s.stepDelay)  s.stepDelay  = 1000;
        if (!s.llmTimeout) s.llmTimeout = 60000;
        if (s.worldInfo === undefined) s.worldInfo = '';
        if (!s.worldInfoSelected) s.worldInfoSelected = [];
        if (!s.promptTemplates) s.promptTemplates = { ...DEFAULT_PROMPT_TEMPLATES };
        else {
            Object.keys(DEFAULT_PROMPT_TEMPLATES).forEach(k => {
                if (s.promptTemplates[k] === undefined) s.promptTemplates[k] = DEFAULT_PROMPT_TEMPLATES[k];
            });
        }
        return s;
    }

    function getWorldTpl() {
        const pt = cfg().promptTemplates || {};
        try {
            const parsed = JSON.parse(pt.worldTpl || '{}');
            if (parsed.locations && parsed.items && parsed.enemies) return parsed;
        } catch (_) {}
        return JSON.parse(JSON.stringify(WORLD_TPL));
    }

    function pt(key) {
        const v = (cfg().promptTemplates || {})[key];
        return v !== undefined ? v : (DEFAULT_PROMPT_TEMPLATES[key] ?? '');
    }

    function saveCfg() { SillyTavern.getContext().saveSettingsDebounced(); }

    function escHtml(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }

    function getSTCharacters() {
        try { return SillyTavern.getContext().characters || []; }
        catch (e) { addLog(`获取ST角色列表失败: ${e.message}`, 'warn'); return []; }
    }

    async function getSTWorldInfoNames() {
        try {
            const { getRequestHeaders } = SillyTavern.getContext();
            const resp = await fetch('/api/settings/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({}) });
            if (!resp.ok) throw new Error(`API ${resp.status}`);
            return (await resp.json()).world_names || [];
        } catch (e) { addLog(`获取 World Info 列表失败: ${e.message}`, 'warn'); return []; }
    }

    async function loadSTWorldInfoFile(name) {
        if (!name || !name.trim()) return null;
        try {
            const { getRequestHeaders } = SillyTavern.getContext();
            const resp = await fetch('/api/worldinfo/get', {
                method: 'POST', headers: getRequestHeaders(),
                body: JSON.stringify({ name: name.trim() })
            });
            if (!resp.ok) throw new Error(`API ${resp.status}`);
            const data = await resp.json();
            const entries = data.entries || data;
            const items = typeof entries === 'object' ? Object.values(entries) : [];
            return items.map(e => e.content || '').filter(Boolean).join('\n');
        } catch (e) { addLog(`加载 World Info "${name}" 失败: ${e.message}`, 'warn'); return null; }
    }

    function saveGame(slot) {
        if (!G.world) { addLog('游戏未初始化', 'warn'); return; }
        const data = { round: G.round, agents: G.agents, userAgent: G.userAgent, world: G.world, ts: new Date().toLocaleString('zh-CN') };
        localStorage.setItem(`${SAVE_KEY}_${slot}`, JSON.stringify(data));
        addLog(`存档成功（槽位 ${slot}）`, 'info');
        postSystemMsg(`💾 游戏已存档（槽位 ${slot}，第 ${G.round} 轮）`);
        [1, 2, 3].forEach(i => { const el = document.getElementById(`mac-save-info-${i}`); if (el) el.textContent = getSaveInfo(i); });
    }

    function loadGame(slot) {
        const raw = localStorage.getItem(`${SAVE_KEY}_${slot}`);
        if (!raw) { addLog(`槽位 ${slot} 无存档`, 'warn'); return; }
        try {
            const data = JSON.parse(raw);
            G.round = data.round || 0; G.agents = data.agents || []; G.userAgent = data.userAgent || null;
            G.world = data.world; G.inited = true;
            updateHUD();
            postSystemMsg(`📂 存档已读取（槽位 ${slot}，第 ${G.round} 轮，${data.ts}）`);
            postSystemMsg(`角色: ${G.agents.map(a => `${a.icon}${a.name} HP:${a.hp}/${a.maxHp}`).join('、')}`);
            addLog(`读档成功（槽位 ${slot}）`, 'info');
        } catch (e) { addLog(`读档失败: ${e.message}`, 'error'); }
    }

    function getSaveInfo(slot) {
        const raw = localStorage.getItem(`${SAVE_KEY}_${slot}`);
        if (!raw) return '空';
        try { const d = JSON.parse(raw); return `第${d.round}轮 ${d.ts || ''}`; } catch (_) { return '损坏'; }
    }

    function getChatEl() {
        return document.getElementById('chat') || document.querySelector('.chat');
    }

    // ══════════════════════════════════════════════════════════
    //  层二：游戏引擎层
    // ══════════════════════════════════════════════════════════

    function resetGame() {
        const s = cfg();
        const wt = getWorldTpl();
        G.world = JSON.parse(JSON.stringify(wt));
        G.agents = s.agents.map(a => ({
            ...JSON.parse(JSON.stringify(a)),
            hp: a.maxHp || a.hp || 100, maxHp: a.maxHp || 100,
            location: a.location || 'village', inventory: [...(a.inventory || [])], gold: a.gold || 0
        }));
        G.userAgent = {
            id: 'user', name: s.userName || '玩家', icon: s.userIcon || '👤',
            role: '主角', hp: 100, maxHp: 100, location: 'village',
            inventory: ['healing_potion'], gold: 20
        };
        G.round = 0; G.curIdx = 0; G.actionsHistory = [];
        G.running = false; G.paused = false; G.stopReq = false; G.inited = true;
        G.waitingForUser = false; G.userActionResolve = null;
    }

    function doInit() {
        const s = cfg();
        s.userName = document.getElementById('mac-cfg-username')?.value?.trim() || s.userName || '玩家';
        s.userIcon = document.getElementById('mac-cfg-usericon')?.value?.trim() || s.userIcon || '👤';
        saveCfg();
        resetGame();
        updateHUD();
        postSystemMsg('═══ 🎮 游戏世界已初始化 ═══');
        postSystemMsg(`🎮 你是主角！${G.userAgent.icon}${G.userAgent.name} | NPC配角: ${G.agents.map(a => `${a.icon}${a.name}`).join('、')}`);
        postSystemMsg(`📍 路线A: ${pt('initRouteA')}`);
        postSystemMsg(`📍 路线B: ${pt('initRouteB')}`);
        postSystemMsg(`🎯 目标: ${pt('initGoal')}`);
        addLog('游戏世界已初始化', 'info');
        const startBtn = document.getElementById('mac-ext-start') || document.getElementById('mac-hud-start');
        if (startBtn) startBtn.disabled = false;
    }

    function resolveId(W, type, name) {
        if (!name || !W) return null;
        const n = String(name).trim().toLowerCase();
        if (type === 'location') {
            for (const [id, loc] of Object.entries(W.locations || {})) {
                if (id === n || (loc.name && loc.name.toLowerCase().includes(n))) return id;
            }
        }
        if (type === 'item') {
            for (const [id, it] of Object.entries(W.items || {})) {
                if (id === n || (it.name && it.name.toLowerCase().includes(n))) return id;
            }
        }
        if (type === 'enemy') {
            for (const [id, en] of Object.entries(W.enemies || {})) {
                if (id === n || (en.name && en.name.toLowerCase().includes(n))) return id;
            }
        }
        if (type === 'agent') {
            const all = [...(G.userAgent ? [G.userAgent] : []), ...G.agents];
            for (const a of all) {
                if (a.id === n || (a.name && a.name.includes(name)) || (a.name && a.name.toLowerCase().includes(n))) return a.id;
            }
        }
        return null;
    }

    function resolveParams(W, tool, params) {
        const p = { ...params };
        if (tool === 'move' && p.destination) p.destination = resolveId(W, 'location', p.destination) || p.destination;
        if (tool === 'attack' && p.target) p.target = resolveId(W, 'enemy', p.target) || resolveId(W, 'agent', p.target) || p.target;
        if ((tool === 'pickup_item' || tool === 'pickup' || tool === 'take') && p.target) p.target = resolveId(W, 'item', p.target) || p.target;
        if (tool === 'use_item' && p.item) p.item = resolveId(W, 'item', p.item) || p.item;
        if ((tool === 'speak' || tool === 'interact') && p.to) p.to = resolveId(W, 'agent', p.to) || p.to;
        if ((tool === 'speak' || tool === 'interact') && p.agent) p.agent = resolveId(W, 'agent', p.agent) || p.agent;
        if (tool === 'inspect' && p.target) p.target = resolveId(W, 'item', p.target) || resolveId(W, 'location', p.target) || resolveId(W, 'enemy', p.target) || p.target;
        return p;
    }

    function executeTool(agent, tool, params) {
        const W = G.world;
        const loc = W.locations[agent.location];

        switch (tool) {
            case 'move': {
                let dest = params.destination;
                if (dest && !W.locations[dest]) dest = resolveId(W, 'location', dest) || dest;
                if (!W.locations[dest]) return `未知地点"${params.destination}"。可前往: ${loc.conn.map(c => `${W.locations[c].name}(${c})`).join(', ')}`;
                if (!loc.conn.includes(dest)) return `不能从【${loc.name}】直接到达【${W.locations[dest].name}】。可前往: ${loc.conn.map(c => `${W.locations[c].name}(${c})`).join(', ')}`;
                agent.location = dest;
                const nl = W.locations[dest];
                let r = `移动至【${nl.name}】。${nl.desc}`;
                if (nl.enemies.length) r += ` ⚠️ 遭遇: ${nl.enemies.map(e => W.enemies[e].name).join('、')}！`;
                if (nl.items.length)   r += ` 💎 地面有: ${nl.items.map(i => W.items[i].name).join('、')}`;
                return r;
            }
            case 'search': {
                if (!loc.items.length) return `在【${loc.name}】没找到任何物品。`;
                const id = loc.items.shift();
                agent.inventory.push(id);
                return `在【${loc.name}】发现【${W.items[id].name}】，已加入背包！`;
            }
            case 'pickup_item': case 'pickup': case 'take': {
                let tid = params.target || params.item;
                if (tid && !W.items[tid]) tid = resolveId(W, 'item', tid) || tid;
                if (!tid) return `请指定物品。地面: ${loc.items.map(i => `${W.items[i]?.name}(${i})`).join('、') || '无'}`;
                if (!W.items[tid]) return `"${params.target || params.item}"不是有效物品。`;
                const idx = loc.items.indexOf(tid);
                if (idx === -1) return `【${loc.name}】地面没有"${tid}"。`;
                loc.items.splice(idx, 1);
                agent.inventory.push(tid);
                return `拾取【${W.items[tid].name}】，已加入背包！`;
            }
            case 'attack': {
                let tid = params.target;
                if (tid && !loc.enemies.includes(tid)) tid = resolveId(W, 'enemy', tid) || tid;
                if (loc.enemies.includes(tid)) {
                    const en = W.enemies[tid];
                    let dmg = agent.role === '战士' ? 30 : (agent.role === '法师' ? 20 : 25);
                    if (agent.inventory.includes('magic_sword')) dmg += 25;
                    if (agent.role === '法师' && agent.location === 'cave') dmg += 20;
                    en.hp -= dmg;
                    if (en.hp <= 0) {
                        loc.enemies = loc.enemies.filter(e => e !== tid);
                        agent.gold += en.reward;
                        W.enemies[tid].hp = en.maxHp;
                        return `对【${en.name}】造成${dmg}伤害，将其击败！获得${en.reward}金币。💰总计:${agent.gold}`;
                    }
                    const taken = Math.max(0, en.dmg - (agent.role === '战士' ? 5 : 0));
                    agent.hp = Math.max(0, agent.hp - taken);
                    W.enemies[tid].hp = en.hp;
                    return `对【${en.name}】造成${dmg}伤害(剩余HP:${en.hp})。反击受到${taken}伤害，当前HP:${agent.hp}/${agent.maxHp}`;
                }
                const allActors = [...(G.userAgent ? [G.userAgent] : []), ...G.agents];
                let tgtAgent = allActors.find(a => a && (a.id === tid || a.name === tid));
                if (!tgtAgent && tid) tgtAgent = allActors.find(a => a && resolveId(null, 'agent', tid) === a.id);
                if (tgtAgent && tgtAgent.id !== agent.id && tgtAgent.location === agent.location && tgtAgent.hp > 0) {
                    const dmg = agent.role === '战士' ? 25 : 20;
                    tgtAgent.hp = Math.max(0, tgtAgent.hp - dmg);
                    broadcastEvent(agent, tgtAgent.id, `（${agent.name}攻击了你，造成${dmg}伤害）`);
                    return `对【${tgtAgent.name}】造成${dmg}伤害。${tgtAgent.name}剩余HP:${tgtAgent.hp}/${tgtAgent.maxHp}`;
                }
                return `【${loc.name}】没有"${params.target}"。`;
            }
            case 'interact': case 'speak': {
                const allActors = [...(G.userAgent ? [G.userAgent] : []), ...G.agents];
                const agentParam = params.agent || params.to;
                let tgt = allActors.find(a => a && (a.id === agentParam || a.name === agentParam));
                if (!tgt && agentParam) tgt = allActors.find(a => a && resolveId(null, 'agent', agentParam) === a.id);
                if (!tgt) return `找不到"${agentParam}"。可用: ${allActors.map(a => `${a.name}(${a.id})`).join(', ')}`;
                const msg = params.message || params.text || '';
                if (msg) broadcastEvent(agent, tgt.id, msg);
                return `对${tgt.icon}${tgt.name}说："${msg}"`;
            }
            case 'narrate': {
                const text = params.text || params.message || '';
                return text ? `【${agent.name}】${text}` : '（无叙述内容）';
            }
            case 'inspect': {
                let t = params.target;
                if (t && !W.items[t] && !W.locations[t] && !W.enemies[t]) t = resolveId(W, 'item', t) || resolveId(W, 'location', t) || resolveId(W, 'enemy', t) || t;
                if (W.items[t])     return `【${W.items[t].name}】: 效果=${W.items[t].effect}, 价值=${W.items[t].val}`;
                if (W.locations[t]) return `【${W.locations[t].name}】: ${W.locations[t].desc}`;
                if (W.enemies[t])   return `【${W.enemies[t].name}】: HP=${W.enemies[t].hp}/${W.enemies[t].maxHp}`;
                return `"${t}"没有详细信息。`;
            }
            case 'use_item': {
                let iid = params.item;
                if (iid && !agent.inventory.includes(iid)) iid = resolveId(W, 'item', iid) || iid;
                if (!agent.inventory.includes(iid)) return `背包没有"${iid}"。`;
                const item = W.items[iid];
                if (item.effect === 'heal') {
                    const h = Math.min(item.val, agent.maxHp - agent.hp);
                    agent.hp += h;
                    agent.inventory = agent.inventory.filter(i => i !== iid);
                    return `使用【${item.name}】，恢复${h}HP (当前:${agent.hp}/${agent.maxHp})`;
                }
                return `使用【${item.name}】，${item.effect}效果已激活`;
            }
            case 'rest': {
                const h = Math.min(20, agent.maxHp - agent.hp);
                agent.hp += h;
                return `在【${loc.name}】休息，恢复${h}HP (当前:${agent.hp}/${agent.maxHp})`;
            }
            case 'complete_turn':
                return `结束回合。总结：${params.summary || '完成行动'}`;
            default: {
                const unknownTool = String(tool).toLowerCase();
                const speakKeywords = ['insult', 'curse', 'scold', 'apologize', 'greet', 'taunt', 'chat', 'ask', 'say', 'talk', 'yell', 'shout', 'whisper', 'mock', 'praise', 'threaten'];
                if (speakKeywords.some(k => unknownTool.includes(k))) {
                    const allActors2 = [...(G.userAgent ? [G.userAgent] : []), ...G.agents];
                    const agentParam2 = params.to || params.agent || params.target;
                    let tgt2 = agentParam2 ? allActors2.find(a => a && (a.id === agentParam2 || a.name === agentParam2)) : null;
                    if (!tgt2 && agentParam2) tgt2 = allActors2.find(a => a && resolveId(null, 'agent', agentParam2) === a.id);
                    const msg2 = params.message || params.text || params.content || `（${tool}）`;
                    if (tgt2) { broadcastEvent(agent, tgt2.id, msg2); return `对${tgt2.icon}${tgt2.name}说："${msg2}"`; }
                    return `【${agent.name}】${msg2}`;
                }
                const moveKeywords = ['go', 'walk', 'run', 'travel', 'enter', 'exit', 'flee', 'escape'];
                if (moveKeywords.some(k => unknownTool.includes(k))) {
                    const dest2 = params.destination || params.target || params.to;
                    if (dest2) return executeTool(agent, 'move', { destination: dest2 });
                }
                const attackKeywords = ['hit', 'fight', 'strike', 'slash', 'punch', 'kick', 'stab', 'shoot'];
                if (attackKeywords.some(k => unknownTool.includes(k))) {
                    const tgt3 = params.target || params.enemy || params.to;
                    if (tgt3) return executeTool(agent, 'attack', { target: tgt3 });
                }
                return `【${agent.name}】${params.text || params.message || `做了某事（${tool}）`}`;
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    //  层三：执行引擎层
    // ══════════════════════════════════════════════════════════

    async function callLLM(systemPrompt, userPrompt) {
        const s = cfg();
        addLog(`→ API model=${s.apiModel} promptLen=${userPrompt.length}`, 'debug');
        if (s.apiUrl && s.apiUrl.trim()) {
            const resp = await fetch(s.apiUrl.trim(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(s.apiKey ? { 'Authorization': `Bearer ${s.apiKey}` } : {}) },
                body: JSON.stringify({ model: s.apiModel || 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], temperature: 0.75, max_tokens: 400 })
            });
            if (!resp.ok) throw new Error(`API Error ${resp.status}: ${await resp.text()}`);
            const data = await resp.json();
            const result = data.choices?.[0]?.message?.content || '';
            addLog(`← 响应 ${result.length}字`, 'debug');
            return result;
        }
        const { generateRaw } = SillyTavern.getContext();
        return await generateRaw({ systemPrompt, prompt: userPrompt });
    }

    async function callLLMWithTimeout(sys, prompt) {
        const timeoutMs = cfg().llmTimeout || 60000;
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => { if (settled) return; settled = true; const e = new Error(`LLM响应超时（${timeoutMs / 1000}s）`); e.name = 'TimeoutError'; reject(e); }, timeoutMs);
            callLLM(sys, prompt).then(r => { if (settled) return; settled = true; clearTimeout(timer); resolve(r); }).catch(e => { if (settled) return; settled = true; clearTimeout(timer); reject(e); });
        });
    }

    /**
     * 规则式兜底：对常见中文模式做快速匹配，不依赖 LLM。
     * 当 LLM 不可用或返回 narrate 时，确保「前往地牢」「攻击战士阿强」等能正确解析。
     */
    function ruleBasedParseIntent(userMessage, W) {
        const msg = String(userMessage || '').trim();
        if (!msg || !W) return null;

        // 移动：前往/去/到/进入 + 地点名（优先匹配长关键词）
        const moveKw = ['前往', '去往', '赶往', '走向', '去', '到', '进入'];
        for (const kw of moveKw) {
            if (msg === kw) continue;
            if (msg.startsWith(kw)) {
                const rest = msg.slice(kw.length).trim();
                if (!rest) continue;
                const id = resolveId(W, 'location', rest);
                if (id) return { tool: 'move', params: { destination: id } };
            }
        }

        // 攻击：攻击/打/揍 + 目标
        const attackKw = ['攻击', '打', '揍', '砍', '劈', '袭击'];
        for (const kw of attackKw) {
            if (msg.startsWith(kw)) {
                let rest = msg.slice(kw.length).replace(/^[了着一下]\s*/, '').trim();
                if (!rest) continue;
                const id = resolveId(W, 'enemy', rest) || resolveId(W, 'agent', rest);
                if (id) return { tool: 'attack', params: { target: id } };
            }
        }

        // 拾取：拾取/拿/捡 + 物品名
        const pickupKw = ['拾取', '拿', '捡', '捡起', '拾起', '拿走'];
        for (const kw of pickupKw) {
            if (msg.startsWith(kw)) {
                const rest = msg.slice(kw.length).trim();
                if (rest) {
                    const id = resolveId(W, 'item', rest);
                    if (id) return { tool: 'pickup_item', params: { target: id } };
                }
            }
        }

        // 使用物品：使用/用/吃/喝 + 物品名
        const useKw = ['使用', '用', '吃', '喝'];
        for (const kw of useKw) {
            if (msg.startsWith(kw)) {
                const rest = msg.slice(kw.length).replace(/^[了着]\s*/, '').trim();
                if (rest) {
                    const id = resolveId(W, 'item', rest);
                    if (id) return { tool: 'use_item', params: { item: id } };
                }
            }
        }

        // 说话：对X说/和X说/跟X说
        const speakMatch = msg.match(/^(?:对|和|跟|向)(.+?)(?:说|道|讲)(?:[:：]?\s*)?(.*)$/);
        if (speakMatch) {
            const who = speakMatch[1].trim();
            const content = (speakMatch[2] || '').trim();
            const id = resolveId(W, 'agent', who);
            if (id) return { tool: 'speak', params: { to: id, message: content || '（打了个招呼）' } };
        }

        // 搜索/休息
        if (/^(搜索|搜|找找|查找|探索)/.test(msg)) return { tool: 'search', params: {} };
        if (/^(休息|歇|歇一歇|回血|恢复)/.test(msg)) return { tool: 'rest', params: {} };

        return null;
    }

    /**
     * 意图理解 Agent（核心层）：
     * 将用户任意自然语言解析为可执行的游戏指令。
     * - 先尝试规则式兜底（确保常见模式必中）
     * - 再通过 LLM 理解复杂意图
     * - 永远不返回 null：兜底为 narrate
     */
    async function parseUserIntent(userMessage) {
        const u = G.userAgent;
        const W = G.world;
        if (!u || !W) return { tool: 'narrate', params: { text: userMessage } };

        // ① 规则式兜底优先：常见「前往X」「攻击X」「对X说」必中
        const ruleResult = ruleBasedParseIntent(userMessage, W);
        if (ruleResult) {
            addLog(`意图理解(规则): "${userMessage}" → ${ruleResult.tool}`, 'debug');
            return ruleResult;
        }

        const loc = W.locations[u.location];
        const allActors = [...(G.userAgent ? [G.userAgent] : []), ...G.agents];

        const locList = Object.entries(W.locations).map(([id, l]) => `${l.name}→"${id}"`).join(', ');
        const itemList = Object.entries(W.items).map(([id, it]) => `${it.name}→"${id}"`).join(', ');
        const enemyList = Object.entries(W.enemies).map(([id, en]) => `${en.name}→"${id}"`).join(', ');
        const actorList = allActors.map(a => `${a.name}→"${a.id}"`).join(', ');

        const actorsHere = allActors.filter(a => a.hp > 0 && a.location === u.location && a.id !== u.id).map(a => `${a.name}(id="${a.id}")`).join('、') || '无';
        const enemiesHere = (loc?.enemies || []).map(e => `${W.enemies[e]?.name}(id="${e}")`).join('、') || '无';
        const reachable = loc?.conn?.map(c => `${W.locations[c]?.name}(id="${c}")`).join('、') || '无';
        const invList = (u.inventory || []).map(i => `${W.items?.[i]?.name}(id="${i}")`).join('、') || '空';

        const sys = `你是游戏意图理解Agent。无论用户说什么，都必须理解其意图并映射到最合适的游戏操作。

【可用工具】
- move: 移动到某地点。params: {"destination":"地点ID"}
- attack: 攻击敌人或NPC。params: {"target":"敌人ID或角色ID"}
- speak: 对某人说话/交流/辱骂/道歉/任何语言互动。params: {"to":"角色ID","message":"说的内容"}
- narrate: 叙述行为/心理/动作。params: {"text":"内容"}
- pickup_item: 拾取物品。params: {"target":"物品ID"}
- use_item: 使用背包物品。params: {"item":"物品ID"}
- search: 搜索当前地点。params: {}
- inspect: 查看详情。params: {"target":"ID"}
- rest: 休息。params: {}
- complete_turn: 结束本回合。params: {"summary":"总结"}

【重要规则】
1. params 中的 ID 必须使用下方列出的游戏内 ID，不能填中文名
2. 任何语言互动（骂人、道歉、聊天、嘲讽、询问等）都用 speak
3. 无法归类的行为用 narrate 记录
4. 必须输出 JSON，不能说"无法理解"

【全部合法ID】
地点: ${locList}
物品: ${itemList}
敌人: ${enemyList}
角色: ${actorList}

只输出JSON，格式：{"tool":"工具名","params":{}}`;

        const prompt = `用户说：「${userMessage}」

当前状态：
- 位置: ${loc?.name}(id="${u.location}") | HP: ${u.hp}/${u.maxHp} | 背包: ${invList}
- 同地点角色: ${actorsHere}
- 同地点敌人: ${enemiesHere}
- 可前往: ${reachable}

输出JSON：`;

        try {
            const raw = await callLLMWithTimeout(sys, prompt);
            addLog(`意图理解原始响应: ${(raw || '').substring(0, 200)}`, 'debug');
            const m = (raw || '').match(/\{[\s\S]*?\}/);
            if (m) {
                const o = JSON.parse(m[0]);
                if (o.tool) return { tool: o.tool, params: resolveParams(W, o.tool, o.params || {}) };
            }
        } catch (e) { addLog(`意图理解失败: ${e.message}`, 'warn'); }
        return { tool: 'narrate', params: { text: userMessage } };
    }

    function checkGoal(agent) {
        const W = G.world;
        const hallEnemies = W.locations.dungeon_hall?.enemies || [];
        if (agent.location === 'dungeon_hall' && hallEnemies.length === 0) return { done: true, reason: pt('goalSuccess') || '地牢大厅已清空！' };
        if (agent.hp <= 0) return { done: true, reason: pt('goalFail') || 'HP为0' };
        return { done: false, reason: '' };
    }

    function broadcastEvent(from, toId, msg) {
        G.msgQueue.push({ from: from.id, fromName: from.name, to: toId, msg, round: G.round });
    }

    function buildReActPrompt(agent, step, hist) {
        const W = G.world;
        const loc = W.locations[agent.location];
        const others = G.agents.filter(a => a.id !== agent.id);
        const othStr = [...(G.userAgent ? [`${G.userAgent.icon}${G.userAgent.name}(${G.userAgent.id}) HP:${G.userAgent.hp}/${G.userAgent.maxHp} 位置:${W.locations[G.userAgent.location]?.name || G.userAgent.location}`] : []),
            ...others.map(o => `${o.icon}${o.name}(${o.id}) HP:${o.hp}/${o.maxHp} 位置:${W.locations[o.location]?.name || o.location}`)].join('\n  ');

        const msgs = G.msgQueue.filter(m => m.to === agent.id && m.round >= G.round - 1);
        const msgStr = msgs.length > 0 ? msgs.map(m => `${m.fromName}: ${m.msg}`).join('\n  ') : '无';

        const roundHistory = G.actionsHistory.filter(h => h.agentId !== agent.id && h.round >= G.round - 1)
            .map(h => `[R${h.round}] ${h.agentName}: ${h.tool} → ${(h.observation || '').substring(0, 80)}`).join('\n  ') || '无';

        const toolsDesc = pt('toolsDesc').replace('{{OTHER_AGENT_IDS}}', others.map(o => o.id).join(', '));

        return `【角色人设】${agent.prompt}
【世界信息】${cfg().worldInfo || '（未加载世界书）'}
【当前状态】
  位置: ${loc.name}(${agent.location}) — ${loc.desc}
  HP: ${agent.hp}/${agent.maxHp} | 金币: ${agent.gold}
  背包: [${agent.inventory.map(i => W.items[i]?.name || i).join('、') || '空'}]
  地面物品: [${loc.items.map(i => W.items[i]?.name || i).join('、') || '无'}]
  敌人: [${loc.enemies.map(e => `${W.enemies[e]?.name}(HP:${W.enemies[e]?.hp})`).join('、') || '无'}]
  可前往: ${loc.conn.map(c => `${W.locations[c]?.name}(${c})`).join('、')}
【${pt('teammateLabel')}】
  ${othStr}
【${pt('teammateMsgLabel')}】
  ${msgStr}
【${pt('roundHistoryLabel')}】
  ${roundHistory}
【可用工具】
${toolsDesc}
【${pt('observationLabel')}】
${hist.map(h => `  步${h.step}: ${h.tool}(${JSON.stringify(h.params)}) → ${h.obs.substring(0, 60)}`).join('\n') || '  （首步）'}

步骤 ${step}，请输出：
${pt('outputFormat')}`;
    }

    function parseReActOutput(raw) {
        const thought = (raw.match(/THOUGHT:\s*([\s\S]*?)(?=\nACTION:|$)/i) || [])[1]?.trim() || '';
        const actionRaw = (raw.match(/ACTION:\s*([\s\S]*)/i) || [])[1]?.trim() || '';
        let tool = null, params = {}, rawAction = '';
        const jsonMatch = actionRaw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const obj = JSON.parse(jsonMatch[0]);
                tool = obj.tool; params = obj.params || {};
            } catch (_) {}
        }
        if (!tool) rawAction = actionRaw;
        return { thought, tool, params, rawAction };
    }

    async function interpretNaturalAction(agent, naturalText) {
        const W = G.world;
        const loc = W?.locations?.[agent?.location];
        const allActors = [...(G.userAgent ? [G.userAgent] : []), ...G.agents];
        const locList = Object.entries(W.locations).map(([id, l]) => `${l.name}→"${id}"`).join(', ');
        const itemList = Object.entries(W.items).map(([id, it]) => `${it.name}→"${id}"`).join(', ');
        const enemyList = Object.entries(W.enemies).map(([id, en]) => `${en.name}→"${id}"`).join(', ');
        const actorList = allActors.map(a => `${a.name}→"${a.id}"`).join(', ');
        const actorsHere = allActors.filter(a => a.hp > 0 && a.location === agent.location && a.id !== agent.id).map(a => `${a.name}(id="${a.id}")`).join('、') || '无';
        const enemiesHere = (loc?.enemies || []).map(e => `${W.enemies[e]?.name}(id="${e}")`).join('、') || '无';
        const reachable = loc?.conn?.map(c => `${W.locations[c]?.name}(id="${c}")`).join('、') || '无';

        const sys = `你是游戏意图理解Agent。将Agent的自然语言行动解析为游戏指令。
【可用工具】move/attack/speak/narrate/pickup_item/use_item/search/inspect/rest/complete_turn
【规则】params中ID必须用下方列出的游戏内ID，任何语言互动用speak，无法归类用narrate，必须输出JSON
【全部合法ID】地点: ${locList} | 物品: ${itemList} | 敌人: ${enemyList} | 角色: ${actorList}
只输出JSON：{"tool":"工具名","params":{}}`;

        const prompt = `Agent(${agent.name})说/做：${naturalText}
当前状态：位置=${loc?.name}(id="${agent.location}") | 同地点角色: ${actorsHere} | 同地点敌人: ${enemiesHere} | 可前往: ${reachable}
输出JSON：`;

        try {
            const raw = await callLLMWithTimeout(sys, prompt);
            const m = (raw || '').match(/\{[\s\S]*?\}/);
            if (m) { const o = JSON.parse(m[0]); if (o.tool) return { tool: o.tool, params: resolveParams(W, o.tool, o.params || {}) }; }
        } catch (_) {}
        return { tool: 'narrate', params: { text: naturalText } };
    }

    function extractFirstJson(str) {
        const start = str.indexOf('{');
        if (start === -1) return null;
        let depth = 0, inStr = false, escape = false;
        for (let i = start; i < str.length; i++) {
            const c = str[i];
            if (escape) { escape = false; continue; }
            if (c === '\\' && inStr) { escape = true; continue; }
            if (c === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return str.slice(start, i + 1); }
        }
        return null;
    }

    function runFallbackDialogue(agent) {
        addLog(`⚠️ ${agent.name} 连续解析失败，已降级为对话模式`, 'warn');
        postSystemMsg(`⚠️ ${agent.name} 暂时无法规划行动，进入休整状态`, 'warn');
        postAgentMsg(agent, '-', '暂时无法规划行动，先休整等待...', 'complete_turn', '降级：跳过本回合', cfg().maxSteps || 5);
    }

    /**
     * 当 LLM 返回空响应时，根据 Agent 当前状态生成合理的兜底行为。
     * 优先级：有未读消息→回应 / 受伤且有药→治疗 / 有敌人→攻击 / 默认→观察环境
     */
    function generateFallbackAction(agent) {
        const W = G.world;
        const loc = W.locations[agent.location];
        const msgs = G.msgQueue.filter(m => m.to === agent.id && m.round >= G.round - 1);

        // 有未读消息 → 回应最近一条
        if (msgs.length > 0) {
            const last = msgs[msgs.length - 1];
            return {
                thought: `${last.fromName}对我说了什么，我需要回应。`,
                tool: 'speak',
                params: { to: last.from, message: `……（${agent.name}思考了一会儿，但没能组织好语言）` }
            };
        }

        // 受伤且背包有治疗物品 → 使用
        if (agent.hp < agent.maxHp * 0.7) {
            const healItem = (agent.inventory || []).find(i => W.items[i]?.effect === 'heal');
            if (healItem) {
                return {
                    thought: '我受伤了，应该先治疗一下。',
                    tool: 'use_item',
                    params: { item: healItem }
                };
            }
        }

        // 当前位置有敌人 → 攻击
        if (loc.enemies.length > 0) {
            return {
                thought: `这里有敌人，我必须应战！`,
                tool: 'attack',
                params: { target: loc.enemies[0] }
            };
        }

        // 默认 → 观察环境
        return {
            thought: `${agent.name}环顾四周，观察当前局势。`,
            tool: 'narrate',
            params: { text: `${agent.name}环顾四周，保持警惕。` }
        };
    }

    async function runTurn(agent) {
        const maxSteps = cfg().maxSteps || 5;
        const hist = [];
        let failStreak = 0;

        for (let step = 1; step <= maxSteps; step++) {
            if (G.paused) await waitResume();
            if (G.stopReq || !G.running) break;

            const goal = checkGoal(agent);
            if (goal.done) { postSystemMsg(`✅ ${agent.name}：${goal.reason}`); break; }

            const thinkId = `mac-thinking-${Date.now()}`;
            postThinkingMsg(agent, step, maxSteps, thinkId);

            let parsed = null;
            try {
                const prompt = buildReActPrompt(agent, step, hist);
                const raw = await callLLMWithTimeout(pt('systemPrompt'), prompt);
                addLog(`${agent.name} 步${step} 原始: ${raw.substring(0, 120)}`, 'debug');
                parsed = parseReActOutput(raw);
            } catch (e) {
                removeThinkingMsg(thinkId);
                if (e.name === 'TimeoutError') { postSystemMsg(`⏱️ ${agent.name} 步骤${step}超时，跳过`, 'warn'); break; }
                postSystemMsg(`⚠️ LLM调用失败: ${e.message}`, 'error');
                failStreak++;
                if (failStreak >= 3) { runFallbackDialogue(agent); break; }
                continue;
            }

            if (!parsed || (!parsed.tool && !parsed.rawAction && !parsed.thought)) {
                removeThinkingMsg(thinkId);
                failStreak++;
                if (failStreak >= 3) { runFallbackDialogue(agent); break; }
                // 空响应不再静默跳过：根据当前状态自动做合理的兜底行为
                const fallback = generateFallbackAction(agent);
                const fbObs = executeTool(agent, fallback.tool, fallback.params);
                hist.push({ step, tool: fallback.tool, params: fallback.params, obs: fbObs });
                G.actionsHistory.push({ round: G.round, agentId: agent.id, agentName: agent.name, tool: fallback.tool, observation: fbObs });
                G.actionsHistory = G.actionsHistory.filter(h => h.round >= G.round - 2);
                postAgentMsg(agent, step, fallback.thought, fallback.tool, fbObs, maxSteps);
                updateHUD();
                addLog(`${agent.name} 步${step} 空响应，兜底: ${fallback.tool}`, 'warn');
                if (agent.hp <= 0) { postSystemMsg(`💀 ${agent.name}倒下`, 'error'); break; }
                await sleep(cfg().stepDelay || 1000);
                continue;
            }

            failStreak = 0;
            let tool = parsed.tool, params = parsed.params;
            if (!tool && parsed.rawAction) {
                const interpreted = await interpretNaturalAction(agent, parsed.rawAction);
                tool = interpreted.tool; params = interpreted.params;
            }
            if (!tool && parsed.thought && !parsed.rawAction) {
                // 只有 THOUGHT 没有 ACTION 时，把想法转为叙述
                tool = 'narrate'; params = { text: parsed.thought };
            }

            const observation = executeTool(agent, tool || 'rest', params || {});
            hist.push({ step, tool: tool || 'rest', params: params || {}, obs: observation });
            G.actionsHistory.push({ round: G.round, agentId: agent.id, agentName: agent.name, tool: tool || 'rest', observation });
            const maxHistoryRounds = 2;
            G.actionsHistory = G.actionsHistory.filter(h => h.round >= G.round - maxHistoryRounds);

            removeThinkingMsg(thinkId);
            postAgentMsg(agent, step, parsed.thought, tool || 'rest', observation, maxSteps);
            updateHUD();

            if (tool === 'complete_turn') break;
            if (agent.hp <= 0) { postSystemMsg(`💀 ${agent.name}倒下`, 'error'); break; }

            await sleep(cfg().stepDelay || 1000);
        }
    }

    // ══════════════════════════════════════════════════════════
    //  层四：Agent协调层
    // ══════════════════════════════════════════════════════════

    function runEnvironmentTurn() {
        const W = G.world;
        const events = [];
        const allActors = [...(G.userAgent ? [G.userAgent] : []), ...G.agents];
        allActors.forEach(a => {
            if (!a || a.hp <= 0) return;
            if (a.location === 'village' && a.hp < a.maxHp) {
                const heal = 15; a.hp = Math.min(a.maxHp, a.hp + heal);
                events.push(`🏠 ${a.name} 在村庄休整，恢复 ${heal}HP（当前: ${a.hp}/${a.maxHp}）`);
            }
        });
        allActors.forEach(a => {
            if (!a || a.hp <= 0) return;
            const loc = W.locations[a.location];
            if (loc.enemies.length > 0 && a.location !== 'village') {
                a.hp = Math.max(0, a.hp - 5);
                events.push(`⚡ ${a.name} 在【${loc.name}】受到环境威胁，损失 5HP（当前: ${a.hp}/${a.maxHp}）`);
            }
        });
        Object.entries(ENEMY_HOME).forEach(([enemyId, locId]) => {
            const loc = W.locations[locId];
            if (!loc.enemies.includes(enemyId) && Math.random() < 0.3) {
                loc.enemies.push(enemyId); W.enemies[enemyId].hp = W.enemies[enemyId].maxHp;
                events.push(`👹 【${W.locations[locId].name}】重新出现了 ${W.enemies[enemyId].name}！`);
            }
        });
        const narrations = (pt('envNarrations') || '').split('\n').filter(Boolean);
        if (narrations.length > 0 && Math.random() < 0.4) events.push(narrations[Math.floor(Math.random() * narrations.length)]);
        postSystemMsg(`🌍 ── ${pt('envTurnLabel')} ──`, 'env');
        if (events.length > 0) events.forEach(e => postSystemMsg(e, 'env'));
        else postSystemMsg(pt('envCalm') || '风平浪静，无明显变化。', 'env');
        updateHUD();
    }

    async function gameLoop() {
        const s = cfg();
        postSystemMsg(`🚀 ═══ 多智能体协作游戏开始 ═══`);
        postSystemMsg(`🎮 你是主角！${G.userAgent?.icon || '👤'}${G.userAgent?.name || '玩家'} | NPC: ${G.agents.map(a => `${a.icon}${a.name}`).join('、')}`);
        postSystemMsg(`每轮：你先行动（自然语言）→ NPC 思考响应 → 环境变化`);
        const sorted = [...G.agents].sort((a, b) => a.priority - b.priority);

        while (G.running && G.round < s.maxRounds) {
            G.round++;
            postSystemMsg(`\n══ 第 ${G.round} / ${s.maxRounds} 轮 ══`);
            updateHUD();

            if (G.paused) await waitResume();
            if (G.stopReq || !G.running) break;
            const userInput = await waitForUserAction();
            if (G.stopReq || !G.running) break;

            const parsed = await parseUserIntent(userInput);
            const toolToUse = parsed.tool;
            const paramsToUse = parsed.params;
            addLog(`意图理解: "${userInput}" → tool=${toolToUse} params=${JSON.stringify(paramsToUse)}`, 'debug');

            const userResult = G.userAgent ? executeTool(G.userAgent, toolToUse, paramsToUse) : '';
            if (G.userAgent) {
                G.actionsHistory.push({ round: G.round, agentId: G.userAgent.id, agentName: G.userAgent.name, tool: toolToUse, observation: userResult });
                G.actionsHistory = G.actionsHistory.filter(h => h.round >= G.round - 2);
            }
            postUserMsg(G.userAgent, userInput, toolToUse, userResult);
            addLog(`玩家: "${userInput}" → ${toolToUse} → ${userResult.substring(0, 80)}`);
            updateHUD();

            if (G.userAgent?.hp <= 0) { postSystemMsg(`💀 玩家倒下，游戏结束`, 'error'); break; }

            for (let i = 0; i < sorted.length; i++) {
                if (G.stopReq || !G.running) break;
                if (G.paused) await waitResume();
                G.curIdx = G.agents.indexOf(sorted[i]);
                updateHUD();
                const agent = sorted[i];
                if (agent.hp <= 0) { postSystemMsg(`💀 ${agent.name}已倒下，跳过`, 'warn'); continue; }
                await runTurn(agent);
                updateHUD();
            }

            runEnvironmentTurn();

            const hallEnemies = G.world.locations.dungeon_hall?.enemies || [];
            if (hallEnemies.length === 0 && G.round > 0) {
                postSystemMsg(`🏆 ═══ 胜利！${pt('goalSuccess')} ═══`);
                addLog('胜利！', 'info'); break;
            }
            const allDead = G.agents.every(a => a.hp <= 0) && (!G.userAgent || G.userAgent.hp <= 0);
            if (allDead) { postSystemMsg(`💀 游戏结束`, 'error'); break; }
        }

        if (G.round >= s.maxRounds) postSystemMsg(`🎬 游戏结束，共 ${G.round} 轮`);
        G.running = false; updateHUD();
    }

    function doStart() {
        if (!G.inited) { addLog('请先初始化', 'warn'); return; }
        if (G.running) { addLog('已在运行', 'warn'); return; }
        if (G.userAgent) {
            const s = cfg();
            G.userAgent.name = s.userName || G.userAgent.name;
            G.userAgent.icon = s.userIcon || G.userAgent.icon;
        }
        G.running = true; G.stopReq = false; G.paused = false;
        updateHUD(); gameLoop();
    }

    function doPause() {
        G.paused = !G.paused; updateHUD();
        postSystemMsg(G.paused ? '⏸ 游戏已暂停' : '▶ 游戏继续');
    }

    function doStop() {
        G.stopReq = true; G.running = false;
        G.waitingForUser = false;
        const bar = document.getElementById('mac-chat-input-bar');
        if (bar) bar.style.display = 'none';
        const section = document.getElementById('mac-hud-user-action');
        if (section) section.style.display = 'none';
        if (G.userActionResolve) { G.userActionResolve('休息'); G.userActionResolve = null; }
        updateHUD();
        postSystemMsg('⏹ 游戏已停止');
        addLog('游戏已停止', 'info');
    }

    // ══════════════════════════════════════════════════════════
    //  层五：前端交互层
    // ══════════════════════════════════════════════════════════

    const toolLabels = { move: '移动', search: '搜索', pickup_item: '拾取', attack: '攻击', interact: '交流', inspect: '查看', use_item: '使用', rest: '休息', complete_turn: '结束', speak: '说话', narrate: '叙述' };
    const toolColors = { move: '#3b82f6', search: '#a78bfa', pickup_item: '#34d399', attack: '#f87171', interact: '#fbbf24', inspect: '#60a5fa', use_item: '#2dd4bf', rest: '#818cf8', complete_turn: '#6b7280', speak: '#fbbf24', narrate: '#94a3b8' };

    function postUserMsg(userAgent, text, tool, result) {
        const chat = getChatEl(); if (!chat) return;
        const label = toolLabels[tool] || tool;
        const color = toolColors[tool] || '#6b7280';
        const div = document.createElement('div');
        div.className = 'mac-user-bubble';
        div.innerHTML = `<div class="mac-bubble-head mac-user-head">
          <span class="mac-bubble-icon">${userAgent?.icon || '👤'}</span>
          <span class="mac-bubble-name">${userAgent?.name || '玩家'}</span>
          <span class="mac-bubble-role">主角</span>
          <span class="mac-bubble-round">R${G.round}</span>
        </div>
        <div class="mac-bubble-action">
          <span class="mac-action-tag" style="color:${color};border-color:${color}">${label}</span>
          <span class="mac-action-result">${escHtml(result)}</span>
        </div>
        <div class="mac-user-raw">💬 "${escHtml(text)}"</div>`;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    }

    function postAgentMsg(agent, step, thought, tool, result, totalSteps) {
        const chat = getChatEl(); if (!chat) return;
        const label = toolLabels[tool] || tool;
        const color = toolColors[tool] || '#6b7280';
        const div = document.createElement('div');
        div.className = 'mac-agent-bubble';
        div.innerHTML = `<div class="mac-bubble-head">
          <span class="mac-bubble-icon">${agent.icon}</span>
          <span class="mac-bubble-name">${agent.name}</span>
          <span class="mac-bubble-role">${agent.role}</span>
          <span class="mac-bubble-step">步${step}/${totalSteps}</span>
          <span class="mac-bubble-round">R${G.round}</span>
        </div>
        ${thought ? `<div class="mac-bubble-thought">💭 ${escHtml(thought)}</div>` : ''}
        <div class="mac-bubble-action">
          <span class="mac-action-tag" style="color:${color};border-color:${color}">${label}</span>
          <span class="mac-action-result">${escHtml(result)}</span>
        </div>`;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    }

    function postSystemMsg(text, type = 'system') {
        const chat = getChatEl(); if (!chat) return;
        const div = document.createElement('div');
        div.className = `mac-system-msg mac-sys-${type}`;
        div.textContent = text;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    }

    function postThinkingMsg(agent, step, maxSteps, id) {
        const chat = getChatEl(); if (!chat) return;
        const div = document.createElement('div');
        div.id = id; div.className = 'mac-thinking-msg';
        div.innerHTML = `${agent.icon}${agent.name} 思考中（步${step}/${maxSteps}）<span class="mac-dots">...</span>`;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    }

    function removeThinkingMsg(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    // ── HUD ──────────────────────────────────────────────────

    function createHUD() {
        if (document.getElementById('mac-hud')) return;
        const hud = document.createElement('div');
        hud.id = 'mac-hud';
        hud.innerHTML = `
<div id="mac-hud-drag">
  <span id="mac-hud-title">🤖 多智能体</span>
  <span id="mac-hud-round">第0轮</span>
  <button id="mac-hud-toggle" title="收起/展开">−</button>
</div>
<div id="mac-hud-body">
  <div id="mac-hud-agents"></div>
  <div id="mac-hud-user-action" class="mac-hud-user-section" style="display:none">
    <div class="mac-chat-input-wrap">
      <input id="mac-hud-user-input" type="text" class="mac-chat-input" placeholder="输入你的行动（自然语言）">
      <button id="mac-hud-user-submit" class="mac-chat-send" title="发送">➤</button>
    </div>
  </div>
  <div id="mac-hud-status">未初始化</div>
  <div id="mac-hud-btns">
    <button class="mac-hud-btn" id="mac-hud-init" title="初始化">🔄</button>
    <button class="mac-hud-btn mac-hud-start" id="mac-hud-start" disabled title="开始">▶</button>
    <button class="mac-hud-btn mac-hud-pause" id="mac-hud-pause" disabled title="暂停">⏸</button>
    <button class="mac-hud-btn mac-hud-stop" id="mac-hud-stop" disabled title="停止">⏹</button>
  </div>
</div>`;
        document.body.appendChild(hud);
        makeDraggable(hud, document.getElementById('mac-hud-drag'));
        document.getElementById('mac-hud-toggle').addEventListener('click', () => {
            const body = document.getElementById('mac-hud-body');
            const btn = document.getElementById('mac-hud-toggle');
            const hidden = body.style.display === 'none';
            body.style.display = hidden ? '' : 'none';
            btn.textContent = hidden ? '−' : '+';
        });
        document.getElementById('mac-hud-init').addEventListener('click', doInit);
        document.getElementById('mac-hud-start').addEventListener('click', doStart);
        document.getElementById('mac-hud-pause').addEventListener('click', doPause);
        document.getElementById('mac-hud-stop').addEventListener('click', doStop);
        document.getElementById('mac-hud-user-submit').addEventListener('click', submitUserAction);
        document.getElementById('mac-hud-user-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitUserAction(); });
        updateHUD();
    }

    function makeDraggable(el, handle) {
        let drag = false, ox = 0, oy = 0;
        handle.style.cursor = 'grab';
        handle.addEventListener('mousedown', e => { if (e.target.tagName === 'BUTTON') return; drag = true; ox = e.clientX - el.offsetLeft; oy = e.clientY - el.offsetTop; handle.style.cursor = 'grabbing'; e.preventDefault(); });
        document.addEventListener('mousemove', e => { if (!drag) return; el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, e.clientX - ox)) + 'px'; el.style.top = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, e.clientY - oy)) + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'; });
        document.addEventListener('mouseup', () => { drag = false; handle.style.cursor = 'grab'; });
    }

    function waitForUserAction() {
        return new Promise(resolve => {
            G.waitingForUser = true; G.userActionResolve = resolve;
            const section = document.getElementById('mac-hud-user-action');
            const body = document.getElementById('mac-hud-body');
            if (body && body.style.display === 'none') { body.style.display = ''; document.getElementById('mac-hud-toggle').textContent = '−'; }
            if (section) section.style.display = '';
            ensureChatInputInChat();
            const input = document.getElementById('mac-hud-user-input') || document.getElementById('mac-chat-user-input');
            if (input) { input.value = ''; input.focus(); }
            updateHUD();
        });
    }

    function ensureChatInputInChat() {
        let bar = document.getElementById('mac-chat-input-bar');
        const chat = getChatEl();
        if (!bar && chat) {
            bar = document.createElement('div');
            bar.id = 'mac-chat-input-bar'; bar.className = 'mac-chat-input-bar';
            bar.innerHTML = `<div class="mac-chat-input-wrap"><input id="mac-chat-user-input" type="text" class="mac-chat-input" placeholder="输入你的行动（自然语言）"><button id="mac-chat-send-btn" class="mac-chat-send" title="发送">➤</button></div>`;
            chat.parentElement?.appendChild(bar);
            bar.querySelector('#mac-chat-send-btn').addEventListener('click', submitUserAction);
            bar.querySelector('#mac-chat-user-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitUserAction(); });
        }
        if (bar) bar.style.display = G.waitingForUser ? '' : 'none';
    }

    function submitUserAction() {
        if (!G.waitingForUser || !G.userActionResolve) return;
        const input = document.getElementById('mac-hud-user-input') || document.getElementById('mac-chat-user-input');
        const text = (input?.value || '').trim();
        const section = document.getElementById('mac-hud-user-action');
        const bar = document.getElementById('mac-chat-input-bar');
        if (section) section.style.display = 'none';
        if (bar) bar.style.display = 'none';
        G.waitingForUser = false;
        const resolve = G.userActionResolve;
        G.userActionResolve = null;
        resolve(text || '休息');
    }

    function updateHUD() {
        const roundEl = document.getElementById('mac-hud-round');
        if (roundEl) roundEl.textContent = `第${G.round}轮`;
        const agentsEl = document.getElementById('mac-hud-agents');
        if (agentsEl) {
            const all = [...(G.userAgent ? [G.userAgent] : []), ...G.agents];
            agentsEl.innerHTML = all.map((a, i) => {
                const isUser = a.id === 'user';
                const hpPct = a.maxHp > 0 ? Math.round(a.hp / a.maxHp * 100) : 0;
                const loc = G.world?.locations?.[a.location]?.name || a.location || '?';
                return `<div class="hud-agent${isUser ? ' hud-user' : ''}${!isUser && G.running && i - 1 === G.curIdx ? ' hud-active' : ''}">
                    <span class="hud-icon">${a.icon}</span>
                    <span class="hud-name">${a.name}</span>
                    <span class="hud-hp">${a.hp}/${a.maxHp}</span>
                    <div class="hud-bar"><div class="hud-bar-fill" style="width:${hpPct}%;background:${hpPct > 50 ? '#34d399' : hpPct > 25 ? '#fbbf24' : '#f87171'}"></div></div>
                    <span class="hud-loc">${loc}</span>
                </div>`;
            }).join('');
        }
        const statusEl = document.getElementById('mac-hud-status');
        if (statusEl) {
            statusEl.textContent = !G.inited ? '未初始化' : !G.running ? '已停止' : G.waitingForUser ? '等待你的行动…' : G.paused ? '已暂停' : `运行中 R${G.round}`;
        }
        const runLabel = document.getElementById('mac-ext-runlabel');
        if (runLabel) runLabel.textContent = !G.inited ? '未运行' : !G.running ? '已停止' : G.paused ? '已暂停' : `运行中 R${G.round}`;

        ['mac-ext-start', 'mac-hud-start'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !G.inited || G.running; });
        ['mac-ext-pause', 'mac-hud-pause'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !G.running; });
        ['mac-ext-stop', 'mac-hud-stop'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !G.running; });
    }

    // ── Settings Panel ──────────────────────────────────────

    function getExtensionsSettingsMount() {
        return document.getElementById('extensions_settings') || document.getElementById('extensions2') || document.querySelector('[data-extensions-settings]');
    }

    function renderAgentList() {
        const el = document.getElementById('mac-agents-list'); if (!el) return;
        const s = cfg();
        el.innerHTML = s.agents.map((a, i) => `<div class="mac-agent-cfg">
  <div class="mac-agentcfg-head">
    <input class="mac-input mac-input-tiny mac-agent-icon" value="${escAttr(a.icon)}" data-idx="${i}">
    <input class="mac-input mac-agent-name" value="${escAttr(a.name)}" placeholder="名称" data-idx="${i}">
    <input class="mac-input mac-agent-role" value="${escAttr(a.role)}" placeholder="角色" data-idx="${i}" style="width:80px">
    <button class="mac-btn-icon mac-agent-del" data-idx="${i}" title="删除">🗑️</button>
  </div>
  <textarea class="mac-textarea mac-agent-prompt" rows="3" data-idx="${i}" placeholder="角色提示词…">${escHtml(a.prompt)}</textarea>
</div>`).join('');
        el.querySelectorAll('.mac-agent-del').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                if (s.agents.length <= 1) { alert('至少保留一个角色！'); return; }
                if (confirm(`确定删除角色"${s.agents[idx].name}"？`)) { s.agents.splice(idx, 1); saveCfg(); renderAgentList(); }
            });
        });
    }

    function createSettingsPanel() {
        if (document.getElementById('mac-ext-wrap')) return;
        const s = cfg();

        const saveSlotsHtml = [1, 2, 3].map(slot => `<div class="mac-save-slot"><span class="mac-save-label">槽位${slot}</span><span id="mac-save-info-${slot}" class="mac-save-info">${getSaveInfo(slot)}</span><button class="mac-btn mac-btn-sm mac-btn-sec" id="mac-save-btn-${slot}">💾 存</button><button class="mac-btn mac-btn-sm mac-btn-sec" id="mac-load-btn-${slot}">📂 取</button></div>`).join('');

        const html = `
<div id="mac-ext-wrap" class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header" id="mac-ext-header">
    <b>🤖 多智能体协作系统</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content" id="mac-ext-content">
    <div class="mac-ext-statusbar">
      <span id="mac-ext-runlabel" class="mac-ext-runlabel">未运行</span>
      <button id="mac-ext-hud-toggle" class="mac-ext-link-btn">显示/隐藏HUD</button>
    </div>

    <div class="mac-ext-section">
      <div class="mac-ext-sec-hd" data-target="mac-sec-api">🔌 API 设置 <span class="mac-sec-arrow">▶</span></div>
      <div id="mac-sec-api" class="mac-ext-sec-body" style="display:none">
        <div class="mac-form-row"><label>API地址 <span class="mac-hint">（留空=使用酒馆当前API）</span></label><input id="mac-cfg-apiurl" type="text" class="mac-input" placeholder="https://api.openai.com/v1/chat/completions" value="${escAttr(s.apiUrl)}"></div>
        <div class="mac-form-row"><label>API Key</label><input id="mac-cfg-apikey" type="password" class="mac-input" placeholder="sk-..." value="${escAttr(s.apiKey)}"></div>
        <div class="mac-form-row"><label>模型名称</label><input id="mac-cfg-model" type="text" class="mac-input" placeholder="gpt-4o-mini" value="${escAttr(s.apiModel)}"></div>
        <div class="mac-form-row mac-form-inline" style="flex-wrap:wrap;gap:8px">
          <button id="mac-cfg-api-save" class="mac-btn mac-btn-sm">💾 保存</button>
          <button id="mac-cfg-api-test" class="mac-btn mac-btn-sm mac-btn-sec">🔗 测试链接</button>
        </div>
        <div id="mac-api-result" class="mac-api-result" style="display:none"></div>
      </div>
    </div>

    <div class="mac-ext-section">
      <div class="mac-ext-sec-hd" data-target="mac-sec-agents">⚔️ 角色配置 <span class="mac-sec-arrow">▶</span></div>
      <div id="mac-sec-agents" class="mac-ext-sec-body" style="display:none">
        <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
          <button id="mac-agent-add" class="mac-btn mac-btn-sm">➕ 添加角色</button>
          <button id="mac-cfg-agents-save" class="mac-btn mac-btn-sm">💾 保存</button>
        </div>
        <div id="mac-agents-list"></div>
      </div>
    </div>

    <div class="mac-ext-section">
      <div class="mac-ext-sec-hd" data-target="mac-sec-worldinfo">📚 World Info <span class="mac-sec-arrow">▶</span></div>
      <div id="mac-sec-worldinfo" class="mac-ext-sec-body" style="display:none">
        <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
          <button id="mac-wi-refresh" class="mac-btn mac-btn-sm mac-btn-sec">🔄 刷新列表</button>
          <button id="mac-wi-enable" class="mac-btn mac-btn-sm">✓ 启用选中</button>
          <button id="mac-wi-clear" class="mac-btn mac-btn-sm mac-btn-sec">🗑️ 清除</button>
        </div>
        <div id="mac-wi-list" class="mac-wi-list"></div>
        <div id="mac-wi-display" class="mac-worldinfo-box" style="margin-top:8px">暂无启用的 World Info 内容。</div>
      </div>
    </div>

    <div class="mac-ext-section">
      <div class="mac-ext-sec-hd" data-target="mac-sec-user">👤 玩家设置 <span class="mac-sec-arrow">▶</span></div>
      <div id="mac-sec-user" class="mac-ext-sec-body" style="display:none">
        <div class="mac-form-row mac-form-inline"><label>玩家名</label><input id="mac-cfg-username" type="text" class="mac-input" value="${escAttr(s.userName || '玩家')}" style="width:120px"></div>
        <div class="mac-form-row mac-form-inline"><label>头像</label><input id="mac-cfg-usericon" type="text" class="mac-input mac-input-tiny" value="${escAttr(s.userIcon || '👤')}"></div>
      </div>
    </div>

    <div class="mac-ext-section">
      <div class="mac-ext-sec-hd" data-target="mac-sec-game">⚙️ 游戏参数 <span class="mac-sec-arrow">▶</span></div>
      <div id="mac-sec-game" class="mac-ext-sec-body" style="display:none">
        <div class="mac-form-row mac-form-inline"><label>最大轮数</label><input id="mac-cfg-rounds" type="number" class="mac-input mac-input-num" value="${s.maxRounds}" min="1" max="50"></div>
        <div class="mac-form-row mac-form-inline"><label>步骤延迟 (ms)</label><input id="mac-cfg-delay" type="number" class="mac-input mac-input-num" value="${s.stepDelay}" min="200" max="10000" step="200"></div>
        <div class="mac-form-row mac-form-inline"><label>每Agent最多步数</label><input id="mac-cfg-maxsteps" type="number" class="mac-input mac-input-num" value="${s.maxSteps || 5}" min="1" max="10"></div>
        <div class="mac-form-row mac-form-inline"><label>LLM超时 (ms)</label><input id="mac-cfg-timeout" type="number" class="mac-input mac-input-num" value="${s.llmTimeout || 60000}" min="5000" max="300000" step="5000"></div>
      </div>
    </div>

    <div class="mac-ext-section">
      <div class="mac-ext-sec-hd" data-target="mac-sec-prompts">📝 Prompt / 世界模板 <span class="mac-sec-arrow">▶</span></div>
      <div id="mac-sec-prompts" class="mac-ext-sec-body" style="display:none">
        <div class="mac-form-row"><label>系统提示词 (systemPrompt)</label><textarea id="mac-cfg-systemprompt" class="mac-textarea mac-prompt-ta" rows="3">${escHtml(pt('systemPrompt'))}</textarea></div>
        <div class="mac-form-row"><label>世界模板 JSON (worldTpl) <span class="mac-hint">保持JSON格式</span></label><textarea id="mac-cfg-worldtpl" class="mac-textarea mac-prompt-ta" rows="6">${escHtml(pt('worldTpl'))}</textarea></div>
        <div class="mac-form-row"><label>工具描述 (toolsDesc)</label><textarea id="mac-cfg-toolsdesc" class="mac-textarea mac-prompt-ta" rows="5">${escHtml(pt('toolsDesc'))}</textarea></div>
        <div class="mac-form-row"><label>输出格式 (outputFormat)</label><textarea id="mac-cfg-outputformat" class="mac-textarea mac-prompt-ta" rows="2">${escHtml(pt('outputFormat'))}</textarea></div>
        <div class="mac-form-row mac-form-inline"><label>路线A</label><input id="mac-cfg-initroutea" type="text" class="mac-input" value="${escAttr(pt('initRouteA'))}"></div>
        <div class="mac-form-row mac-form-inline"><label>路线B</label><input id="mac-cfg-initrouteb" type="text" class="mac-input" value="${escAttr(pt('initRouteB'))}"></div>
        <div class="mac-form-row mac-form-inline"><label>目标</label><input id="mac-cfg-initgoal" type="text" class="mac-input" value="${escAttr(pt('initGoal'))}"></div>
        <div class="mac-form-row"><label>环境叙述 (每行一条)</label><textarea id="mac-cfg-envnarrations" class="mac-textarea mac-prompt-ta" rows="4">${escHtml(pt('envNarrations'))}</textarea></div>
        <div class="mac-form-row mac-form-inline"><label>胜利文案</label><input id="mac-cfg-goalsuccess" type="text" class="mac-input" value="${escAttr(pt('goalSuccess'))}"></div>
        <div class="mac-form-row mac-form-inline"><label>失败文案</label><input id="mac-cfg-goalfail" type="text" class="mac-input" value="${escAttr(pt('goalFail'))}"></div>
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <button id="mac-cfg-prompts-save" class="mac-btn mac-btn-sm mac-btn-pri">💾 保存模板</button>
          <button id="mac-cfg-prompts-reset" class="mac-btn mac-btn-sm mac-btn-warn">🔄 恢复默认</button>
        </div>
      </div>
    </div>

    <div class="mac-ext-section">
      <div class="mac-ext-sec-hd" data-target="mac-sec-save">💾 存档管理 <span class="mac-sec-arrow">▶</span></div>
      <div id="mac-sec-save" class="mac-ext-sec-body" style="display:none">${saveSlotsHtml}</div>
    </div>

    <div class="mac-ext-section">
      <div class="mac-ext-sec-hd" data-target="mac-sec-log">📋 运行日志 <span class="mac-sec-arrow">▶</span></div>
      <div id="mac-sec-log" class="mac-ext-sec-body" style="display:none">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span class="mac-hint">最近100条</span><button id="mac-log-clear" class="mac-btn mac-btn-sm mac-btn-sec" style="margin-left:auto">🗑️ 清空</button></div>
        <div id="mac-log-box" class="mac-log-box"></div>
      </div>
    </div>

    <div class="mac-ext-ctrl">
      <button id="mac-ext-init" class="mac-btn mac-btn-sec">🔄 初始化游戏</button>
      <button id="mac-ext-start" class="mac-btn mac-btn-pri" disabled>▶ 开始运行</button>
      <button id="mac-ext-pause" class="mac-btn mac-btn-warn" disabled>⏸ 暂停</button>
      <button id="mac-ext-stop" class="mac-btn mac-btn-dng" disabled>⏹ 停止</button>
    </div>
  </div>
</div>`;

        const target = getExtensionsSettingsMount();
        if (target) target.insertAdjacentHTML('beforeend', html);
        else document.body.insertAdjacentHTML('beforeend', `<div id="mac-ext-fallback-root" style="position:fixed;top:64px;right:12px;z-index:99999;background:#1a1a2e;border:1px solid rgba(59,130,246,0.4);border-radius:8px;padding:0;max-width:min(420px,92vw);max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5)">${html}</div>`);

        bindSettingsEvents();
        renderAgentList();
        renderWorldInfoList();
    }

    async function renderWorldInfoList() {
        const listEl = document.getElementById('mac-wi-list'); if (!listEl) return;
        listEl.innerHTML = '<span class="mac-hint">正在加载…</span>';
        const names = await getSTWorldInfoNames();
        if (!names.length) { listEl.innerHTML = '<span class="mac-hint">未找到 World Info 文件。</span>'; return; }
        const selected = cfg().worldInfoSelected || [];
        listEl.innerHTML = names.map(name => {
            const checked = selected.includes(name) ? ' checked' : '';
            return `<label class="mac-wi-item"><input type="checkbox" class="mac-wi-check" value="${escAttr(name)}"${checked}> ${escHtml(name)}</label>`;
        }).join('');
    }

    function bindSettingsEvents() {
        document.querySelectorAll('.mac-ext-sec-hd').forEach(hd => {
            hd.addEventListener('click', () => {
                const t = document.getElementById(hd.dataset.target);
                const arrow = hd.querySelector('.mac-sec-arrow');
                if (!t) return;
                const open = t.style.display !== 'none';
                t.style.display = open ? 'none' : 'block';
                if (arrow) arrow.textContent = open ? '▶' : '▼';
            });
        });

        document.getElementById('mac-ext-hud-toggle')?.addEventListener('click', () => {
            const hud = document.getElementById('mac-hud');
            if (hud) hud.style.display = hud.style.display === 'none' ? '' : 'none';
        });

        document.getElementById('mac-cfg-api-save')?.addEventListener('click', () => {
            const s = cfg();
            s.apiUrl = document.getElementById('mac-cfg-apiurl').value.trim();
            s.apiKey = document.getElementById('mac-cfg-apikey').value.trim();
            s.apiModel = document.getElementById('mac-cfg-model').value.trim() || 'gpt-4o-mini';
            saveCfg(); addLog(`API设置已保存`, 'info');
        });

        document.getElementById('mac-cfg-api-test')?.addEventListener('click', async () => {
            const url = document.getElementById('mac-cfg-apiurl').value.trim();
            const key = document.getElementById('mac-cfg-apikey').value.trim();
            const model = document.getElementById('mac-cfg-model').value.trim() || 'gpt-4o-mini';
            const resEl = document.getElementById('mac-api-result');
            if (!url) { showApiResult(resEl, '请先填写 API 地址', 'error'); return; }
            showApiResult(resEl, '⏳ 正在测试...', 'info');
            try {
                const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Authorization': `Bearer ${key}` } : {}) }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 }) });
                showApiResult(resEl, resp.ok ? '✅ 连接成功！' : `❌ ${resp.status}`, resp.ok ? 'success' : 'error');
            } catch (e) { showApiResult(resEl, `❌ ${e.message}`, 'error'); }
        });

        document.getElementById('mac-cfg-agents-save')?.addEventListener('click', () => {
            const s = cfg();
            document.querySelectorAll('.mac-agent-icon').forEach((el, i) => {
                if (!s.agents[i]) return;
                s.agents[i].icon = el.value.trim() || '🤖';
                s.agents[i].name = document.querySelectorAll('.mac-agent-name')[i]?.value.trim() || `角色${i + 1}`;
                s.agents[i].role = document.querySelectorAll('.mac-agent-role')[i]?.value.trim() || '冒险者';
                s.agents[i].prompt = document.querySelectorAll('.mac-agent-prompt')[i]?.value.trim() || '';
                s.agents[i].id = s.agents[i].id || s.agents[i].name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                s.agents[i].maxHp = s.agents[i].maxHp || 100;
                s.agents[i].priority = i + 1;
            });
            saveCfg(); addLog(`角色配置已保存`, 'info');
        });

        document.getElementById('mac-agent-add')?.addEventListener('click', () => {
            const s = cfg();
            s.agents.push({ id: `agent_${Date.now()}`, name: `角色${s.agents.length + 1}`, icon: '🤖', role: '冒险者', hp: 100, maxHp: 100, location: 'village', inventory: [], gold: 0, priority: s.agents.length + 1, prompt: '' });
            saveCfg(); renderAgentList();
        });

        document.getElementById('mac-wi-refresh')?.addEventListener('click', renderWorldInfoList);

        document.getElementById('mac-wi-enable')?.addEventListener('click', async () => {
            const checked = [...document.querySelectorAll('.mac-wi-check:checked')].map(el => el.value);
            if (!checked.length) { addLog('未选择任何 World Info 文件', 'warn'); return; }
            const s = cfg(); s.worldInfoSelected = checked;
            const texts = [];
            for (const name of checked) { const t = await loadSTWorldInfoFile(name); if (t) texts.push(t); }
            s.worldInfo = texts.join('\n---\n').substring(0, 2000);
            saveCfg();
            const disp = document.getElementById('mac-wi-display');
            if (disp) disp.textContent = s.worldInfo.substring(0, 500) + (s.worldInfo.length > 500 ? '…' : '');
            addLog(`已启用 ${checked.length} 个 World Info 文件`, 'info');
        });

        document.getElementById('mac-wi-clear')?.addEventListener('click', () => {
            const s = cfg(); s.worldInfo = ''; s.worldInfoSelected = []; saveCfg();
            document.querySelectorAll('.mac-wi-check').forEach(el => el.checked = false);
            const disp = document.getElementById('mac-wi-display');
            if (disp) disp.textContent = '暂无启用的 World Info 内容。';
        });

        document.getElementById('mac-cfg-rounds')?.addEventListener('change', function () { cfg().maxRounds = parseInt(this.value) || 10; saveCfg(); });
        document.getElementById('mac-cfg-delay')?.addEventListener('change', function () { cfg().stepDelay = parseInt(this.value) || 1000; saveCfg(); });
        document.getElementById('mac-cfg-maxsteps')?.addEventListener('change', function () { cfg().maxSteps = parseInt(this.value) || 5; saveCfg(); });
        document.getElementById('mac-cfg-timeout')?.addEventListener('change', function () { cfg().llmTimeout = parseInt(this.value) || 60000; saveCfg(); });

        [1, 2, 3].forEach(slot => {
            document.getElementById(`mac-save-btn-${slot}`)?.addEventListener('click', () => saveGame(slot));
            document.getElementById(`mac-load-btn-${slot}`)?.addEventListener('click', () => loadGame(slot));
        });

        document.getElementById('mac-cfg-prompts-save')?.addEventListener('click', () => {
            const s = cfg();
            const t = s.promptTemplates;
            t.systemPrompt  = document.getElementById('mac-cfg-systemprompt')?.value || t.systemPrompt;
            t.worldTpl      = document.getElementById('mac-cfg-worldtpl')?.value || t.worldTpl;
            t.toolsDesc     = document.getElementById('mac-cfg-toolsdesc')?.value || t.toolsDesc;
            t.outputFormat  = document.getElementById('mac-cfg-outputformat')?.value || t.outputFormat;
            t.initRouteA    = document.getElementById('mac-cfg-initroutea')?.value || t.initRouteA;
            t.initRouteB    = document.getElementById('mac-cfg-initrouteb')?.value || t.initRouteB;
            t.initGoal      = document.getElementById('mac-cfg-initgoal')?.value || t.initGoal;
            t.envNarrations = document.getElementById('mac-cfg-envnarrations')?.value || t.envNarrations;
            t.goalSuccess   = document.getElementById('mac-cfg-goalsuccess')?.value || t.goalSuccess;
            t.goalFail      = document.getElementById('mac-cfg-goalfail')?.value || t.goalFail;
            saveCfg();
            addLog('Prompt模板已保存', 'info');
        });

        document.getElementById('mac-cfg-prompts-reset')?.addEventListener('click', () => {
            if (!confirm('确定恢复所有Prompt模板为默认值？')) return;
            cfg().promptTemplates = { ...DEFAULT_PROMPT_TEMPLATES };
            saveCfg();
            fillPromptTemplateFields();
            addLog('Prompt模板已恢复默认', 'info');
        });

        document.getElementById('mac-log-clear')?.addEventListener('click', () => { LOG = []; renderLog(); });
        document.getElementById('mac-ext-init')?.addEventListener('click', doInit);
        document.getElementById('mac-ext-start')?.addEventListener('click', doStart);
        document.getElementById('mac-ext-pause')?.addEventListener('click', doPause);
        document.getElementById('mac-ext-stop')?.addEventListener('click', doStop);
    }

    function fillPromptTemplateFields() {
        const setVal = (id, key) => { const el = document.getElementById(id); if (el) el.value = pt(key); };
        setVal('mac-cfg-systemprompt', 'systemPrompt');
        setVal('mac-cfg-worldtpl', 'worldTpl');
        setVal('mac-cfg-toolsdesc', 'toolsDesc');
        setVal('mac-cfg-outputformat', 'outputFormat');
        setVal('mac-cfg-initroutea', 'initRouteA');
        setVal('mac-cfg-initrouteb', 'initRouteB');
        setVal('mac-cfg-initgoal', 'initGoal');
        setVal('mac-cfg-envnarrations', 'envNarrations');
        setVal('mac-cfg-goalsuccess', 'goalSuccess');
        setVal('mac-cfg-goalfail', 'goalFail');
    }

    function showApiResult(el, text, type) {
        if (!el) return;
        el.textContent = text;
        el.className = 'mac-api-result mac-api-' + (type || 'info');
        el.style.display = 'block';
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function waitResume() { return new Promise(r => { const id = setInterval(() => { if (!G.paused || !G.running) { clearInterval(id); r(); } }, 200); }); }

    // ══════════════════════════════════════════════════════════
    //  启动入口（防竞态：多次重试，兼容 APP_READY 已错过的情况）
    // ══════════════════════════════════════════════════════════

    let macInitDone = false;

    function initMacPluginOnce() {
        const hasPanel = !!document.getElementById('mac-ext-wrap');
        const hasHud = !!document.getElementById('mac-hud');
        if (macInitDone && hasPanel && hasHud) return;
        if (hasPanel && hasHud) { macInitDone = true; return; }
        try {
            if (!hasPanel) createSettingsPanel();
            if (!document.getElementById('mac-hud')) createHUD();
            macInitDone = !!(document.getElementById('mac-ext-wrap') && document.getElementById('mac-hud'));
            if (macInitDone) {
                addLog('插件 v4.0 初始化完成（五层架构 + ReAct逐步循环）', 'info');
                console.log('[MultiAgent v4] 初始化完成 ✓');
            }
        } catch (e) {
            console.error('[MultiAgent] 初始化失败:', e);
        }
    }

    function boot() {
        console.log('[MultiAgent v4] 插件脚本已执行…');
        try {
            const ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
            if (ctx && ctx.eventSource) {
                const et = ctx.event_types || {};
                const initSoon = () => setTimeout(initMacPluginOnce, 0);
                ctx.eventSource.on(et.APP_READY || 'app_ready', initSoon);
                if (et.APP_INITIALIZED) ctx.eventSource.on(et.APP_INITIALIZED, initSoon);
                if (et.EXTENSION_SETTINGS_LOADED) ctx.eventSource.on(et.EXTENSION_SETTINGS_LOADED, initSoon);
            }
        } catch (e) { console.error('[MultiAgent] 注册事件失败:', e); }
        setTimeout(initMacPluginOnce, 0);
        setTimeout(initMacPluginOnce, 300);
        setTimeout(initMacPluginOnce, 1200);
        setTimeout(initMacPluginOnce, 3000);
    }

    boot();
})();
