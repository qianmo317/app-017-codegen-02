# 盲文点字排版与打印 · Braille Typesetting Studio

> 类型：前端 Web 应用（纯前端）｜难度：★★★｜技术栈：**React 18 + TypeScript + Vite**（手写 CSS；不引入 UI 库与排版库，见 README §九提示词统一约定）

## 1. 一句话简介
把一段汉字/拼音/数字转成规范的盲文点字，按盲文纸的 32 方 × 25 行分页排版，直接送到盲文打字机或普通打印机（含凸点高度与间距参数）。

## 2. 真实场景与痛点
- 特殊教育学校与盲协常要给盲人学生做教材与通知，但会盲文的人少，会排版的人更少，全靠手写盲文板一个字一个字扎。
- 汉语盲文的标点、数字、字母有独立符号和**换行规则**：一个词不能跨行拆开、数字与字母要加前置符号，排错就读不懂。
- 打印到普通纸上的「点字」看得见摸不着，要能输出可打印的**点阵图**或用盲文打字机（如 Index Everest）输出 BRF 文件。
- 现有工具多是命令行或老软件，界面不友好，老师难以上手。

## 3. 目标用户
- 特殊教育学校教师、盲协/图书馆无障碍服务人员。
- 家长（给视障孩子做练习材料）。
- 志愿者团体（制作盲文说明卡）。

## 4. 核心功能（MVP）
1. **富文本输入**：支持汉字、拼音、数字、英文、标点混合输入；自动识别语种并套用对应盲文规则（中文按现行汉语盲文，英文按 UEB/GB 英文盲文，数字用数符前置）。
2. **盲文转换**：按规则表逐字转换（汉字 → 盲文点字，含同音字消歧提示）；**多音字必须给候选并让用户确认**，不要静默选择。
3. **分页排版**：
   - 盲文纸规格（32 方 × 25 行、28 方 × 20 行等，可自定义）；
   - **禁止把词拆到两行**（按分词边界换行），数字/字母序列不得跨行；
   - 段落缩进、空行、页码（盲文数字）。
4. **预览与编辑**：左右对照视图（原文 ↔ 盲文点阵），逐方可点击编辑；错误位置高亮（未识别字符、跨行违规）。
5. **输出**：
   - 盲文点阵图（SVG/PNG，按标准点距 2.5mm、点径 1.5mm 等比例出图，可打印）；
   - **BRF 文件**（盲文打字机通用格式）下载；
   - 双面/单面、页边距配置。
6. **模板库**：通知、课本页、练习卡、菜单等常用模板（本地内置示例）。

## 5. 进阶功能
- 反向转换（盲文点字 → 汉字）：用于校对，**要标注不确定项**。
- 词语表管理与自定义发音/缩写规则。
- 批量转换（粘贴多段文本，导出多页）。
- 打印校准页（用于验证打印机水平/垂直点距），这是真实使用中的刚需。

## 6. 页面结构
```
/                  新建/最近文档
/editor/:id        主编辑器（左：原文  中：分页预览  右：规则与页面设置）
/editor/:id/print  打印视图（点阵图分页 + 校准页）
/library           模板与词语表
/settings          盲文规则与打印机参数
```

## 7. 数据模型
```ts
type BrailleCell = { dots: number[]; source?: string; kind: 'hanzi'|'letter'|'digit'|'punct'|'space'|'prefix'; uncertain?: boolean };
type PageSetup   = { cellsPerLine: number; linesPerPage: number; doubleSided: boolean;
                     marginMm: { top: number; left: number; right: number } };
type Doc = { id: string; title: string; raw: string; cells: BrailleCell[]; setup: PageSetup;
             ruleProfile: 'zh-current'|'ueb'|'gb-english'; updatedAt: number };
type DictEntry = { word: string; readingOverride?: string; abbreviation?: string };
```

## 8. 关键实现点
- **规则表驱动**：汉字 → 盲文的映射、标点表、数符/字母前置符号表都放 JSON 配置（`rules/*.json`），不要写死在代码里；规则文件随包发布，可覆盖。
- **分词决定换行合法性**：用轻量中文分词（自实现的最大匹配 + 词典，不要引入重型 NLP 库）得到词边界；换行时只在词边界或标点后断开；**数字/字母串视为不可分割单元**。
- **多音字/未收录字**：转换结果标记 `uncertain`，右侧列出候选，用户确认后写回覆盖（**绝不允许静默猜测**，盲文错了学生学错）。
- **点阵渲染**：按「方」为单位绘制 6 点（3 行 × 2 列），点距与方距按 mm 换算成 SVG 用户单位，保证打印为真实尺寸；用 SVG（矢量）而不是 Canvas，避免打印缩放失真。
- **BRF 输出**：BRF 是 ASCII 盲文文本（每方一个字符），按行宽与换行符规范生成，并在页尾插入换页符；**行尾不要留多余空格**（打字机会输出多余的空白方）。
- **性能**：1 万字文档转换 < 300ms；点阵预览分页渲染（只渲染可见页），100 页文档滚动不卡。
- **可访问性**：编辑器自身要能被屏幕阅读器使用（语义化标签 + aria-live 提示转换错误）。

## 9. 交互与视觉要点
- 高对比度主题（很多使用者是低视力），字号可放大到 200%。
- 点阵用实心圆点，背景纯白；编辑态与预览态用色区分但**不依赖颜色单独传达信息**。
- 键盘流：`Tab` 在原文与候选列表间切换，`Ctrl+Enter` 触发转换；全程可不用鼠标。
- 打印预览必须显示真实尺寸比例与校准说明（「打印时请选择实际大小/100%」）。

## 10. 验收标准
- 转换正确率：用 200 条标准汉语盲文对照用例（含标点、数字、英文混排）测试，与规范 100% 一致。
- 换行：构造 30 组用例，验证词不跨行、数字不拆分；违规用例必须被标出而不是静默通过。
- 多音字：所有未确定项 100% 出现在候选列表中，未确认前不允许导出。
- 打印：A4 实际打印后点距为 2.5mm ±0.2mm；BRF 文件可被盲文打字机正常读取（提供 BRF 结构校验脚本）。
- 1 万字文档转换 < 300ms；100 页预览滚动流畅。
- 屏幕阅读器可完成「输入 → 转换 → 导出」全流程。

## 11. 边界（刻意不做）
不做在线课程与教材商城、不做社交/社区、不做 OCR 图片转盲文（后续可扩展但不属于 MVP）、不做语音合成朗读——核心只做**转换 + 排版 + 输出**，避开黑名单中的博客 CMS、电商订单、音乐播放器方向。

## 12. 容器化与构建（Docker）

本项目交付**必须能通过 Docker 构建与运行**，验收以容器内运行结果为准。

- **Dockerfile（多阶段）**：`node:20-alpine` + `npm ci && npm run build` → `nginx:1.27-alpine`，只拷 `dist/` 与 `nginx.conf`
- **docker-compose.yml**：服务名 `app-017`，端口 **`8097:80`**，`restart: unless-stopped`；`HEALTHCHECK` 请求 `/healthz`
- **nginx.conf**：SPA 回退 `try_files $uri $uri/ /index.html`；带哈希资源 `immutable`；`index.html` no-cache；gzip（js/css/json/svg）
- 无后端依赖：转换、排版、导出全在浏览器内完成，**断网可用**
- 盲文规则 JSON 随包发布，**不要 ignore**；中文字体本地打包，禁止外网 CDN

```bash
cd frontend/app-017
docker compose up -d --build
curl http://localhost:8097/healthz
docker compose down
```

- **验收**：`http://localhost:8097` 完成「输入 → 转换 → 分页预览 → 导出点阵图与 BRF」；镜像 < 60MB；刷新后文档仍在（IndexedDB / localStorage）。

### 忽略文件（.dockerignore / .gitignore）

- **`.dockerignore`**：
  ```
  node_modules
  dist
  .git
  .gitignore
  .env
  .env.*
  *.log
  coverage
  .vscode
  .idea
  Dockerfile
  nginx.conf
  README.md
  ```
  - `node_modules` 必须排除（否则上下文 300MB+）；**保留** `package-lock.json` 与 `src/rules/*.json`
  - 仅忽略本地原始素材草稿（`design-src/`、`*.psd`）
- **`.gitignore`**：`node_modules/`、`dist/`、`.env`、`.env.local`、`*.log`、`coverage/`、`.DS_Store`、`.vscode/`、`.idea/`，另排 `design-src/`、`*.psd`，以及**用户导入的原文与导出文件**（`imports/`、`exports/`）
- **自检**：构建上下文 < 5MB；`git status` 不出现 `.env`、构建产物与用户原文
