const express = require('express');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const service115 = require('./service115');

const app = express();
const PORT = 3000;

// 生产环境请修改此密钥
const JWT_SECRET = 'your_super_secret_key_115_master';

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// 1. 路径配置
const DATA_ROOT = path.resolve(__dirname, '../data');
const USERS_FILE = path.join(DATA_ROOT, 'users.json');

console.log(`[System] 启动中... 数据目录: ${DATA_ROOT}`);

// 2. 确保数据根目录存在
if (!fs.existsSync(DATA_ROOT)) {
    try {
        fs.mkdirSync(DATA_ROOT, { recursive: true });
        console.log("[System] 已创建数据目录");
    } catch(e) {
        console.error("[System] ❌ 无法创建数据目录 (权限错误):", e.message);
    }
}

// 缓存变量
let tasksCache = {};
let cronJobs = {};
let usersCache = []; // 用于存储用户信息和 cookie

// 辅助函数：获取今天的日期字符串 (YYYY-MM-DD)
function getTodayDateStr() { 
    return new Date().toISOString().split('T')[0]; 
}

// 获取用户目录（如果不存在则创建）
const getUserDir = (uid) => {
    const dir = path.join(DATA_ROOT, String(uid));
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`[System] 为用户 ${uid} 创建了数据文件夹`);
        } catch (e) {
            console.error(`[System] 创建用户目录失败: ${e.message}`);
        }
    }
    return dir;
};

// 初始化：恢复之前的 Cron 任务
function initSystem() {
    if (fs.existsSync(USERS_FILE)) {
        try {
            usersCache = JSON.parse(fs.readFileSync(USERS_FILE));
            console.log(`[System] 发现 ${usersCache.length} 个注册用户`);
            
            usersCache.forEach(u => {
                const taskFile = path.join(getUserDir(u.id), 'tasks.json');
                const configFile = path.join(getUserDir(u.id), 'config.json');

                // 尝试加载 Cookie (用于 processTask)
                if (fs.existsSync(configFile)) {
                    u.cookie = JSON.parse(fs.readFileSync(configFile)).cookie;
                } else {
                    u.cookie = null;
                }

                if (fs.existsSync(taskFile)) {
                    const tasks = JSON.parse(fs.readFileSync(taskFile));
                    // 确保任务结构包含新的监控字段
                    tasksCache[u.id] = tasks.map(t => ({
                        ...t,
                        lastShareHash: t.lastShareHash || null,
                        lastSuccessDate: t.lastSuccessDate || null,
                    }));
                    
                    let count = 0;
                    tasksCache[u.id].forEach(t => {
                        if (t.cronExpression && t.status !== 'stopped') {
                            startCronJob(u.id, t);
                            count++;
                        }
                    });
                    if(count > 0) console.log(` - 用户 [${u.username}] 恢复了 ${count} 个定时任务`);
                } else {
                    tasksCache[u.id] = [];
                }
            });
        } catch (e) {
            console.error("[System] 初始化数据读取失败:", e);
        }
    }
}

// 中间件：JWT 验证
const authenticate = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, msg: "未登录" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, msg: "Token 无效" });
        req.user = user;
        
        // 更新 usersCache 中的 cookie (确保最新)
        const configFile = path.join(getUserDir(user.id), 'config.json');
        if (fs.existsSync(configFile)) {
            const config = JSON.parse(fs.readFileSync(configFile));
            const cachedUser = usersCache.find(u => u.id === user.id);
            if (cachedUser) {
                cachedUser.cookie = config.cookie;
            }
        }
        
        next();
    });
};

// --- Auth API ---

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, msg: "缺少参数" });
    
    let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : [];
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ success: false, msg: "用户名已存在" });
    }
    
    const newUser = { id: Date.now(), username, password };
    users.push(newUser);
    usersCache.push(newUser);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    getUserDir(newUser.id); 
    
    res.json({ success: true, msg: "注册成功" });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : [];
    const user = users.find(u => u.username === username && u.password === password);
    
    if (user) {
        getUserDir(user.id);
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, username: user.username });
    } else {
        res.status(401).json({ success: false, msg: "用户名或密码错误" });
    }
});

// --- Config API ---

app.get('/api/config', authenticate, (req, res) => {
    const configFile = path.join(getUserDir(req.user.id), 'config.json');
    if (fs.existsSync(configFile)) {
        res.json(JSON.parse(fs.readFileSync(configFile)));
    } else {
        res.json({ cookie: "" });
    }
});

app.post('/api/config', authenticate, async (req, res) => {
    const { cookie } = req.body;
    try {
        const info = await service115.getUserInfo(cookie);
        const configFile = path.join(getUserDir(req.user.id), 'config.json');
        fs.writeFileSync(configFile, JSON.stringify({ cookie, name: info.name }, null, 2));
        
        // 更新内存缓存中的 cookie
        const cachedUser = usersCache.find(u => u.id === req.user.id);
        if (cachedUser) {
            cachedUser.cookie = cookie;
        }

        res.json({ success: true, name: info.name });
    } catch (e) {
        res.status(400).json({ success: false, msg: e.message });
    }
});

app.get('/api/folders', authenticate, async (req, res) => {
    const cachedUser = usersCache.find(u => u.id === req.user.id);
    if (!cachedUser || !cachedUser.cookie) return res.status(400).json({ success: false, msg: "请先配置 Cookie" });
    
    try {
        const data = await service115.getFolderList(cachedUser.cookie, req.query.cid || "0");
        res.json({ success: true, data });
    } catch (e) {
        res.status(500).json({ success: false, msg: "获取目录失败: " + e.message });
    }
});

// --- Task API ---

app.get('/api/tasks', authenticate, (req, res) => {
    // 确保任务结构包含新的监控字段
    const tasks = (tasksCache[req.user.id] || []).map(t => ({
        ...t,
        lastShareHash: t.lastShareHash || null,
        lastSuccessDate: t.lastSuccessDate || null,
    }));
    tasksCache[req.user.id] = tasks;
    res.json(tasks);
});

app.post('/api/task', authenticate, async (req, res) => {
    const { taskName, shareUrl, password, targetCid, targetName, cronExpression } = req.body;
    const userId = req.user.id;

    const cachedUser = usersCache.find(u => u.id === userId);
    if (!cachedUser || !cachedUser.cookie) return res.status(400).json({ success: false, msg: "未配置 Cookie" });
    const cookie = cachedUser.cookie;

    try {
        const urlInfo = extractShareCode(shareUrl);
        const pass = password || urlInfo.password;

        // 1. 获取分享信息，包括文件ID列表（已排序）和标题
        const shareInfo = await service115.getShareInfo(cookie, urlInfo.code, pass);

        // 2. 决定最终的任务名和目标目录
        let finalTaskName = taskName;
        let finalTargetCid = targetCid || "0";
        let finalTargetName = targetName || "根目录";
        
        // 【R1-修改】如果任务名称为空，则使用分享标题作为任务名称，不再自动创建文件夹。
        if (!finalTaskName || finalTaskName.trim() === "") {
            finalTaskName = shareInfo.shareTitle; 
        }

        // 3. 创建任务对象
        const newTask = {
            id: Date.now(),
            taskName: finalTaskName,
            shareUrl: shareUrl,
            shareCode: urlInfo.code,
            receiveCode: pass,
            targetCid: finalTargetCid,
            targetName: finalTargetName,
            cronExpression: cronExpression,
            status: 'pending',
            log: '任务已初始化',
            // 【新增监控字段】
            lastShareHash: shareInfo.fileIds.join(','), // 首次运行时计算哈希
            lastSuccessDate: null, 
            historyCount: 0,
            createTime: Date.now(),
        };

        // 4. 保存并执行
        if (!tasksCache[userId]) tasksCache[userId] = [];
        tasksCache[userId].unshift(newTask);
        saveUserTasks(userId);

        // 【R2-修改】创建后立即执行一次转存（即首次保存任务）
        processTask(userId, newTask, false);

        // 如果有 cron 表达式，加入调度器
        if (cronExpression && cronExpression.trim().length > 0) {
            startCronJob(userId, newTask);
            // 状态应该在 processTask 中更新为 success/scheduled
        }

        res.json({ success: true, msg: "任务创建成功" });

    } catch (e) {
        console.error(e);
        res.status(400).json({ success: false, msg: e.message });
    }
});

app.put('/api/task/:id', authenticate, async (req, res) => {
    const userId = req.user.id;
    const taskId = parseInt(req.params.id);
    const { taskName, shareUrl, password, targetCid, targetName, cronExpression } = req.body;
    
    const userTasks = tasksCache[userId] || [];
    const task = userTasks.find(t => t.id === taskId);
    if (!task) return res.status(404).json({ success: false, msg: "任务不存在" });
    
    if (cronJobs[taskId]) {
        cronJobs[taskId].stop();
        delete cronJobs[taskId];
    }

    try {
        // 更新字段
        if (taskName) task.taskName = taskName;
        if (targetCid) task.targetCid = targetCid;
        if (targetName) task.targetName = targetName;
        
        // 如果更新了链接，重新解析 shareCode/receiveCode
        if (shareUrl && shareUrl !== task.shareUrl) {
            const urlInfo = extractShareCode(shareUrl);
            task.shareUrl = shareUrl;
            task.shareCode = urlInfo.code;
            task.receiveCode = password || urlInfo.password;
            task.lastShareHash = null; // 链接变了，重置哈希
        } else if (password) {
            task.receiveCode = password; // 只更新了密码
        } else if (shareUrl) {
            task.shareUrl = shareUrl; // 确保 URL 也是最新的 (即使内容不变)
        }

        // 更新定时策略
        task.cronExpression = cronExpression;

        // 如果有新的有效 Cron，重新启动定时器
        if (cronExpression && cronExpression.trim() !== "" && cron.validate(cronExpression)) {
            task.status = 'scheduled';
            startCronJob(userId, task);
        } else {
            // 【修正】当定时器关闭时，状态为 pending，日志提示等待手动执行
            task.status = 'pending';
            task.log = '▶️ 定时已关闭，等待手动执行';
        }

        saveUserTasks(userId);
        res.json({ success: true, msg: "任务已更新" });

    } catch (e) {
        res.status(400).json({ success: false, msg: "更新失败: " + e.message });
    }
});

app.delete('/api/task/:id', authenticate, (req, res) => {
    const userId = req.user.id;
    const taskId = parseInt(req.params.id);
    
    if (cronJobs[taskId]) {
        cronJobs[taskId].stop();
        delete cronJobs[taskId];
    }
    
    if (tasksCache[userId]) {
        tasksCache[userId] = tasksCache[userId].filter(t => t.id !== taskId);
        saveUserTasks(userId);
    }
    res.json({ success: true });
});

// 【新增接口】手动执行任务
app.put('/api/task/:id/run', authenticate, (req, res) => {
    const userId = req.user.id;
    const taskId = parseInt(req.params.id);
    
    const userTasks = tasksCache[userId] || [];
    const task = userTasks.find(t => t.id === taskId);
    
    if (!task) return res.status(404).json({ success: false, msg: "任务不存在" });
    
    // 手动执行时不进行 "当日成功锁定" 检查 (isCron=false)
    // 强制执行时，应将任务状态切换为 running
    updateTaskStatus(userId, task, 'running', `[${formatTime()}] 收到手动执行指令，开始运行...`);
    
    // 使用 setTimeout 确保 API 响应能快速返回，任务在后台异步执行
    setTimeout(() => {
        processTask(userId, task, false); 
    }, 100); 

    res.json({ success: true, msg: "任务已启动" });
});

// --- 内部功能函数 ---

function startCronJob(userId, task) {
    if (cronJobs[task.id]) {
        cronJobs[task.id].stop();
        delete cronJobs[task.id];
    }

    if (!task.cronExpression || !cron.validate(task.cronExpression)) {
        return;
    }

    console.log(`[Cron] 启动/重启任务 ${task.taskName}: ${task.cronExpression}`);
    
    cronJobs[task.id] = cron.schedule(task.cronExpression, () => {
        processTask(userId, task, true);
    });
}

// 【核心监控逻辑】
async function processTask(userId, task, isCron = false) {
    const cachedUser = usersCache.find(u => u.id === userId);
    if (!cachedUser || !cachedUser.cookie) {
        updateTaskStatus(userId, task, isCron ? 'scheduled' : 'error', `[${formatTime()}] Cookie配置缺失或失效`);
        return;
    }
    const cookie = cachedUser.cookie;
    const todayStr = getTodayDateStr();

    // --- 1. 每日成功锁定检查 ---
    // 【R2-修改】后续 Cron 任务才检查，手动任务不检查
    if (isCron && task.status === 'scheduled' && task.lastSuccessDate === todayStr) {
        console.log(`[Cron Skip] 任务 ${task.id} (${task.taskName}) 今日已成功执行，跳过`);
        updateTaskStatus(userId, task, 'scheduled', `[${formatTime()}] 今日已成功转存，跳过本次执行`);
        return; 
    }
    
    updateTaskStatus(userId, task, 'running', `[${formatTime()}] 正在检查更新...`);
    
    // --- 2. 检查分享内容更新 (通过哈希文件列表) ---
    try {
        // 注意：此处已移除自动创建文件夹的逻辑。转存将直接在 targetCid 下进行。
        const shareInfo = await service115.getShareInfo(cookie, task.shareCode, task.receiveCode);
        const fileIds = shareInfo.fileIds;
        
        if (!fileIds || fileIds.length === 0) {
            const finalStatus = isCron ? 'scheduled' : 'failed';
            updateTaskStatus(userId, task, finalStatus, `[${formatTime()}] 分享链接内无文件`);
            return; 
        }

        const currentShareHash = fileIds.join(',');

        // 【R2-修改】如果是 Cron 任务，且内容无变化，则跳过转存
        if (isCron && task.lastShareHash && task.lastShareHash === currentShareHash) {
            console.log(`[Skip] 任务 ${task.id} (${task.taskName}) 内容无更新，跳过转存`);
            updateTaskStatus(userId, task, 'scheduled', `[${formatTime()}] 内容无更新，跳过转存`);
            return; 
        }
        
        // 首次运行或内容已更新，记录新哈希值（用于下次对比）
        task.lastShareHash = currentShareHash; 
        
        // --- 3. 执行转存 ---
        const saveResult = await service115.saveFiles(cookie, task.targetCid, task.shareCode, task.receiveCode, fileIds);

        // --- 4. 成功后更新状态和日期 ---
        if (saveResult.success) {
            const finalStatus = isCron ? 'scheduled' : 'success';
            // 【新增】成功后记录日期
            task.lastSuccessDate = todayStr;
            updateTaskStatus(userId, task, finalStatus, `[${formatTime()}] 成功转存 ${saveResult.count} 个文件`);
        } else {
            const finalStatus = isCron ? 'scheduled' : 'failed'; 
            updateTaskStatus(userId, task, finalStatus, `转存失败: ${saveResult.msg}`);
        }

    } catch (e) {
        const finalStatus = isCron ? 'scheduled' : 'error';
        updateTaskStatus(userId, task, finalStatus, `错误: ${e.message}`);
    }
}

function updateTaskStatus(userId, task, status, log) {
    task.status = status;
    task.log = log;
    // 更新内存缓存
    if (tasksCache[userId]) {
        const t = tasksCache[userId].find(i => i.id === task.id);
        if (t) {
            t.status = status;
            t.log = log;
            t.lastShareHash = task.lastShareHash;
            t.lastSuccessDate = task.lastSuccessDate;
        }
    }
    saveUserTasks(userId);
}

function saveUserTasks(userId) {
    const file = path.join(getUserDir(userId), 'tasks.json');
    try { 
        fs.writeFileSync(file, JSON.stringify(tasksCache[userId] || [], null, 2)); 
    } catch (e) { 
        console.error("保存任务失败:", e); 
    }
}

function extractShareCode(url) {
    if (!url) throw new Error("链接不能为空");
    const codeMatch = url.match(/\/s\/([a-z0-9]+)/i);
    if (!codeMatch) throw new Error("无法识别链接格式");
    
    const pwdMatch = url.match(/[?&]password=([^&#]+)/);
    return { 
        code: codeMatch[1], 
        password: pwdMatch ? pwdMatch[1] : "" 
    };
}

function formatTime() {
    const d = new Date();
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

initSystem();
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
