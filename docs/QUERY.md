# 描述检索（本地 Chinese-CLIP）

这是 WebUI 的独立“上传视频 + 自然语言描述 → 本地判定”通道。它**不替代** VADTree 的固定类别异常分数：VADTree 回答“这段视频有多异常”，描述检索回答“这段视频里是否出现了你描述的这件事”。

## 模型与边界

默认后端是 **Chinese-CLIP ViT-B/16**（OFA-Sys/chinese-clip-vit-base-patch16）：

- 完全本地推理，不调用云端。
- 中文文本 + 视频帧的图文语义匹配，不是 LLM 推理，没有思维链。
- 输出的是“描述与画面的匹配程度”的启发式校准值，**不是统计学校准概率**。
- 对物体、场景、简单动作较敏感；对“有人翻越围栏后逃跑”这类需要时序/因果推理的复杂事件，可靠性有限。

## 流程

~~~text
视频上传
  → ffprobe 读取时长/分辨率
  → ffmpeg 按窗口抽帧（默认 8s 窗口、4s 步长、6 帧）
  → 每个窗口计算 3 条正向提示 vs 4 条中性提示
  → 取正向最高分与负向最高分的差值，温度缩放 sigmoid
  → 每个窗口取最匹配帧；视频级取最高窗口
  → 时间轴定位 + 证据卡
~~~

- 视频与帧保存在 uploads/<upload-id>/，任务日志在 runs/<job-id>/，不写 result/。
- 结果 JSON 写入 uploads/<upload-id>/query.json，模型逐窗口写入，前端可轮询进度。
- 视频级可信值 = 所有窗口中最高分；同时返回平均分、最佳窗口、覆盖区间。

## 安装后端

完整模型不放进主 .venv。单独安装：

~~~bash
bash scripts/setup_vlm.sh
~~~

它会创建 .venv-vlm、安装 CUDA 版 PyTorch/transformers，并下载
Chinese-CLIP 到 models/chinese-clip-vit-base-patch16（约 753MB）。

如果已有模型目录，可设置：

~~~bash
export VADTREE_VLM_MODEL=/path/to/chinese-clip-vit-base-patch16
~~~

重启控制台后打开 /query。模型以 float32 加载约 1.5GB 显存；16GB 显卡足够，CPU 也能运行但更慢。

## 参数与限制

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| 窗口长度 | 8s | 每个窗口送给 CLIP 的时长 |
| 步长 | 4s | 相邻窗口重叠，避免事件跨边界被漏掉 |
| 最多窗口 | 12 | 长视频会均匀抽样窗口，避免无限调用 |
| 每窗帧数 | 6 | 帧越多越稳，但耗时上升 |
| 上传大小 | 1GB | 后端硬限制 |

窗口分数取最大值作为视频级可信值；同时返回平均分、最佳窗口、覆盖区间。
高概率窗口按概率排序展示证据帧。

## API

~~~text
GET  /api/query/status                 # CLIP 环境/模型是否就绪
POST /api/uploads                      # 原始视频 body + X-Filename header
GET  /api/uploads/<id>                 # 上传元数据
GET  /api/uploads/<id>/preview.jpg     # 预览帧
GET  /api/uploads/<id>/frames/<name>   # 证据帧
POST /api/jobs {kind:"query", params:{upload_id, description, ...}}
GET  /api/jobs/<id>                    # 日志 + 最终 query.json
~~~

## 结果解释

- score: 所有窗口中最高匹配分（0–100）。
- verdict: ≥70 疑似出现；45–69 不确定；<45 未发现。
- coverage: 分数 ≥50 的窗口。
- 每个窗口包含 start/end、probability、evidence、evidence_frames、thumb。

### 重要限制

- 分数是图文相似度的启发式校准，不能当作司法、安防或医学结论。
- 低分辨率、远距离、夜间、遮挡、快速运动都会降低可靠性。
- 窗口判定是“至少一个窗口包含”的近似，长视频可能漏掉极短事件。
- 复杂事件、否定句、多人互动、因果/时序描述可能被 CLIP 误判；需要更强推理时再升级到 VLM 后端。
- 当前实现没有做人脸/车牌识别，也不保存云端副本。
- 该通道与 VADTree 的 ROC/PR 指标不是同一评测协议；不要把它和 0.8474 之类的固定类别指标直接比较。
