# VADTree Console — Design Review

日期：2026-10-24
范围：本地证据控制台（Overview / Runs / Evidence / Pipeline / Archive）
方法来源：docs/DESIGN_BRIEF.md + skills/vadtree-console-design/SKILL.md

## 评审方式

- 真实运行环境：本地 HTTP 服务 + 真实 result/ 数据，无占位曲线。
- 截图：Playwright Chromium，1440×900 与 390×844，全页截图。
- 语言：界面文案为中文；VADTree、ROC/PR、GT、CoT、文件名与命令行保持技术原文。
- 评审：本轮为**自查**，没有使用独立子代理；评审维度包括构图、层级、字体、色彩、数据可读性、窄屏。
- 证据：docs/screenshots/overview.png、runs.png、evidence.png、pipeline.png、archive.png、overview-mobile.png、evidence-mobile.png。

## 第一轮发现与修正

| 问题 | 表现 | 修正 |
| --- | --- | --- |
| Evidence 标题与分数重叠 | 1440 宽下三栏过挤，视频名压到右侧分数 | 证据网格改为 210 / 自适应 / 320；标题字号 clamp；分数保持独立列 |
| 移动端横向溢出 | 390px 视口实际渲染 417px，Run 下拉框撑破页面 | field/select 增加 min-width:0 与 width:100%；复测 390/390 |
| Runs 表格被截断 | VIDEOS 与箭头列超出可视区，路径不换行 | 表格 fixed 布局、列宽固定、路径省略；详情路径限制 2 行 |
| Archive 误报缺失 | 完整 CoT 工作区把 step4-scores 显示为 0/9，step6-7 为 6/17 | presence 视图接受 stripped bundle 的 full-CoT 变体；最终 96/96 |
| Archive 指标为空 | reproduction 行的 published/reproduced 显示 “—” | 同时读取 dataset_metric 的 all.roc_auc 与顶层 roc_auc |
| 移动端时间轴不可点 | 点击依赖 hover 坐标 | 点击直接按 clientX 计算时间并选中 coarse/fine 节点 |

另有一次过程问题：在追加 CSS 时读取上限截断了后段，导致 Runs/Evidence 样式丢失、媒体查询未闭合。已恢复并验证括号平衡与真实截图。

## 第二轮结果

- Evidence：标题与分数分离（titleRight 941 / scoreLeft 957），时间轴、GT 斜线、coarse/fine 节点带、caption 与 CoT 同屏；1:18 节点选中态清晰。
- Mobile：Overview 与 Evidence 均无横向溢出；导航折叠为横向滚动/换行，主路径仍可完成。
- Archive：96/96 文件、Full-CoT 变体标注、published → reproduced 数值可见；XD 两条 warning 保留具体 delta。
- 视觉：暖纸、墨色、朱红批注与 Fraunces/IBM Plex 的组合与“证据桌” brief 一致；没有使用霓虹渐变、玻璃拟态或无意义发光。
- 中文排版：正文回退 Noto Sans CJK SC，标题回退 Noto Serif CJK SC；中文标题不使用合成斜体，强调仅用朱红与字重。

## 功能验证（Playwright）

| 检查 | 结果 |
| --- | --- |
| Overview 条带 → Evidence | pass |
| Evidence 标题/分数不重叠 | pass |
| FINE tab 自动选中节点 | pass |
| ⌘K 搜索 Explosion022 → Enter 导航 | pass |
| Runs 行选择更新详情 | pass |
| Pipeline 显示 7 个阶段 | pass |
| Archive 96/96 | pass |
| 桌面 1440 无横向溢出（五个页面） | pass |
| 移动 390 无横向溢出（Desk / Evidence） | pass |
| 浏览器控制台错误 | 0 |
| 从 Pipeline UI 发起 UCF step 2 任务 | pass（COMPLETED，日志与 report 显示 1 passed） |

## 仍未验证

- 独立设计评审（本轮为自查），因此不宣称达到某个客观审美分数。
- 对比度数值、屏幕阅读器、键盘全链路（已实现 focus ring 与键盘可点的行/节点，但未做自动化 a11y 审计）。
- 800 视频列表的长时间滚动性能未做 profiling；当前使用普通渲染 + 搜索过滤。
- Steps 1/3/4/5 的真实重跑仍需视频与模型权重；UI 明确显示 blocked，而不是伪造通过。
- Pipeline UI 只实测了 step 2；step 6/7 的 API 复现与脚本已验证，但未从 UI 逐个点击。

## 判断

方向成立：它看起来像一册可追溯的调查档案，而不是通用 AI 仪表盘；主要操作（找视频 → 看时间轴 → 读节点/CoT）在桌面与移动端都能完成。后续若继续精修，优先处理 Evidence 页时间轴以下的留白与 800 视频列表的虚拟化，而不是增加装饰。
