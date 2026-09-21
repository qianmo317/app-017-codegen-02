# 盲文点字排版与打印工作室（app-017）

纯前端离线应用：将汉字文本转换为符合国家标准的现行盲文（点字），提供逐方可编辑的分页预览与可触摸打印的点阵图导出。数据仅保存在本机浏览器，不上传任何信息。

- 规则依据：**GB/T 15720-1995《中国盲文》** 与 **GF 0019-2018《国家通用盲文方案》**
- 需求文档：见 [braille-typesetting-studio.md](./braille-typesetting-studio.md)

## 功能特性

| 模块 | 说明 |
| --- | --- |
| 文本转换 | 中文分词（词典最长匹配）→ 拼音标注 → 声母/韵母/标点/数字/字母 → 点字方（Unicode 盲文点位） |
| 多音字处理 | 全部读音候选面板；未确认的多音字会**锁定导出**，确认后解锁 |
| 拼音直输 | 原文可直接书写拼音（`ma1`、`zhi4`，0=轻声），自动识别中文/拼音混合输入 |
| 自定义读音 | 词语表（优先于单字读音，如 `长城 chang2 cheng2`）与逐方指定读音 |
| 分页排版 | 每行 32 方、每页 25 行；段首缩进 2 方；**词不跨行**、标点不落行首；页码右对齐独占首行；超长词强制拆分并生成违规报告 |
| 声调省写 | 实现 GF 0019-2018 §10.2 全部省写规则（10.2.1–10.2.7），支持「全部标调 / 省写（默认）/ 全部省略」三种模式 |
| 打印导出 | SVG 点阵图（mm 精度）、300 DPI PNG、BRF 盲文文件（含结构校验）；附可选打印校准页 |
| 版本对比 | 两份文档逐字比对：新增/删除/换读音逐条列出并标注「第几页第几行第几方」；整段移动、段落拆分/合并自动识别不计改动；改动可逐条勾选搬到另一版（生成新文档）并自动复比；对不上号时区分「疑似错位」与「真改」 |
| 反向转换 | 点字 → 汉语（用于核对转换正确性） |
| 无障碍 | 全键盘操作（Ctrl+Enter 转换）、aria-live 播报、跳转链接、高对比度模式、字号缩放 |
| 持久化 | 文档存 IndexedDB（`braille-studio`/`docs`），应用设置存 localStorage（`app-017:settings`），刷新后全部保留 |

## 技术栈与约束

- React 18 + TypeScript 5 + Vite 5
- **运行时零第三方依赖**（仅 react/react-dom；`pinyin-pro` 仅在构建期生成数据，不进入运行时）
- 纯静态 SPA，无后端；nginx 仅做静态服务与 SPA 回退
- 大文档虚拟渲染：`content-visibility: auto`，万字级文本（100+ 页）滚动流畅

## 快速开始

```bash
npm install
npm run gen:data   # 可选：重新生成 src/rules/ 数据（需要联网拉取分词词典）
npm run dev        # 开发模式（Vite 默认端口）
npm run build      # 产物输出 dist/
npm run preview    # 本地预览生产构建
```

## 测试

```bash
npm test           # 单元测试（vitest）：转换/换行/BRF 校验/性能，280 条
npm run test:watch # 监听模式
npm run e2e        # Playwright e2e：9 条用例，自动 build + preview（独占端口 4317）
E2E_BASE_URL=http://localhost:8097 npm run e2e   # e2e 直接打容器，验证生产镜像
```

- 单元测试覆盖：200+ 条转换用例、30 组换行/分页用例、BRF 结构校验、1 万字 < 300ms 性能
- e2e 覆盖：全流程（输入→转换→多音字确认→导出解锁→BRF 下载）、键盘流、刷新持久化、逐方编辑、违规报告、100+ 页长文滚动、模板、词语表、设置持久化

## Docker 部署

```bash
docker compose up -d --build
curl http://localhost:8097/healthz   # → ok
```

- 多阶段构建：`node:20-alpine` 构建 → `nginx:1.27-alpine-slim` 运行
- 端口映射 **8097:80**；镜像约 **23.5MB**（目标 < 60MB）
- `/healthz` 健康检查；带哈希资源永久缓存；SPA 回退支持深链接（`/editor/:id`、`/settings` 等）

## 目录结构

```
├── braille-typesetting-studio.md   # 需求文档
├── Dockerfile / nginx.conf / docker-compose.yml
├── scripts/gen-data.mjs            # 构建期数据生成（汉字读音表 + jieba 分词词典）
├── src/
│   ├── lib/                        # 核心引擎（纯函数，可独立测试）
│   │   ├── segment.ts              #   中文分词 + 输入流切分（中文/拼音/数字/字母/标点）
│   │   ├── pinyin.ts               #   音节解析（ma1 格式）、拼音串切分（DFS）
│   │   ├── convert.ts              #   点字转换（声调省写、多音字、overrides/confirmed）
│   │   ├── layout.ts               #   分页排版（词不跨行、缩进、页码、违规报告）
│   │   ├── brf.ts                  #   BRF 导出与结构校验（页终止符 \f\n）
│   │   ├── svg.ts / png.ts         #   打印点阵图 / 300 DPI 位图 / 校准页
│   │   ├── reverse.ts              #   反向转换（点字 → 汉语）
│   │   ├── diff.ts                 #   版本对比（分层对齐：段落移动/拆分识别 + 逐字比对 + 改动应用）
│   │   ├── settings.ts             #   设置（localStorage，app-017:settings）
│   │   └── storage.ts              #   文档存储（IndexedDB）
│   ├── rules/                      # 盲文规则数据（随包发布）
│   │   ├── zh-initials.json        #   21 声母（含自成音节 zhi/chi/shi/ri/zi/ci/si）
│   │   ├── zh-finals.json          #   34 韵母
│   │   ├── zh-pinyin.json          #   汉字 → 全部读音（多音字按常用度排序）
│   │   ├── zh-digits.json / zh-letters.json / zh-punct.json
│   │   └── segment-dict.json       #   分词词典（约 12 万词条，源自 jieba 主词典）
│   ├── pages/                      # 首页 / 编辑器 / 打印 / 模板与词语表 / 设置
│   └── components/                 # 点阵方（SVG）、分页预览、多音字面板
├── tests/                          # 单元测试（vitest）
└── e2e/                            # 端到端测试（Playwright）
```

## 盲文排版规格速查

- 几何参数（可在设置中调整）：方宽 6.2mm、行高 10mm、点距 2.5mm、点径 1.5mm
- 数字、小数点、声调符号等前置符号规则遵循 GB/T 15720-1995
- 声调点：阴平=第 1 点、阳平=第 2 点、上声=第 3 点、去声=第 2、3 点
- 拼音输入约定：`ma1`/`zhi4`（数字 1–4 表四声，0 表轻声）

## 已知设计决策

- 分词词典最大匹配 + 声调省写均在转换期一次完成，编辑器与打印页共用同一转换结果，保证「所见即所得」
- 文档的读音确认记录（confirmed）与覆盖（overrides）随文档保存，打印页不会重新出现未确认项
- e2e 使用独占端口 4317，避免与本机其他项目的 preview 服务（如 4173）冲突
