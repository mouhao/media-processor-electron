# 🎵 小灯塔音视频处理工具 by huanggh

一款基于Electron开发的跨平台音视频处理桌面应用，专注于MP3压缩和视频HLS转换功能，提供直观易用的图形界面和强大的批量处理能力。

![应用截图](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![Node.js](https://img.shields.io/badge/Node.js-16.0.0%2B-green)
![Electron](https://img.shields.io/badge/Electron-28.0.0-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ 核心功能

### 🎵 MP3智能压缩

- **批量处理**: 一次性处理整个文件夹的MP3文件
- **智能过滤**: 自动跳过已经是低比特率的文件，避免重复压缩
- **灵活配置**: 支持32-128kbps目标比特率，ABR/CBR编码模式
- **结构保持**: 可选择保持原有文件夹层级结构
- **强制模式**: 可强制处理所有文件，忽略比特率阈值

### 🎬 视频HLS转换

- **标准化重命名**: 自动重命名为`part01`, `part02`等标准格式
- **HLS流媒体**: 转换为m3u8播放列表 + ts视频片段
- **多分辨率支持**: 720p/1080p输出，自动缩放保持宽高比
- **质量控制**: 可调节视频比特率(1000k-5000k)和HLS片段时长
- **课程组织**: 按课程名称自动创建文件夹结构

### 🖥️ 用户界面

- **现代化设计**: Material Design风格，响应式布局
- **实时反馈**: 处理进度条、详细日志、文件信息预览
- **便捷操作**: 文件列表多选、全选、批量移除
- **可调列宽**: 文件名列宽度可拖拽调整
- **状态监控**: FFmpeg状态检测，处理命令日志

## 🚀 快速开始

### 系统要求

- **操作系统**: Windows 10+, macOS 10.14+
- **Node.js**: 16.0.0 或更高版本
- **FFmpeg**: ✅ **已内置**，无需单独安装！

> 🎉 **好消息**: 本应用已经内置了FFmpeg可执行文件（Windows和macOS版本），开箱即用，无需复杂的环境配置！

### 运行应用

```bash
# 克隆项目
git clone <repository-url>
cd media-processor

# 安装依赖
npm install

# 开发模式运行
npm run dev

# 或直接启动
npm start
```

### 构建发布版本

```bash
# 构建所有平台
npm run build

# 构建特定平台
npm run dist-win    # Windows安装包
npm run dist-mac    # macOS DMG包
```

## 📖 使用指南

### MP3压缩流程

1. **选择源文件夹**: 点击"📂 选择文件夹"，选择包含MP3文件的目录
2. **查看文件列表**: 切换到"🎵 MP3文件"标签，查看扫描到的音频文件
3. **配置压缩参数**:
   - **目标比特率**: 推荐64kbps（移动设备友好）
   - **编码模式**: ABR（平均）或CBR（恒定）
   - **比特率阈值**: 只处理高于此值的文件
   - **强制处理**: 忽略阈值，处理所有文件
4. **选择文件**: 勾选要处理的文件或使用全选
5. **开始处理**: 点击"🚀 开始处理"，查看实时进度

### 视频转换流程

1. **选择视频文件夹**: 选择包含视频文件的目录
2. **切换到视频标签**: 点击"🎬 视频文件"查看视频列表
3. **配置转换参数**:
   - **课程名称**: 如"lesson2"，用于文件夹组织
   - **输出分辨率**: 720p或1080p
   - **视频比特率**: 2000k推荐（质量与大小平衡）
   - **HLS片段时长**: 10秒标准设置
4. **处理文件**: 选择文件并开始转换

### 输出结构示例

```
选择的文件夹/
├── 原始MP3和视频文件...
└── output/
    ├── 压缩后的MP3文件/（保持原结构）
    │   ├── 子文件夹1/
    │   │   └── compressed_audio.mp3
    │   └── compressed_audio2.mp3
    └── video_output/
        └── lesson2/
            ├── part01/
            │   ├── index.m3u8
            │   ├── index_001.ts
            │   └── index_002.ts
            └── part02/
                ├── index.m3u8
                └── ...
```

## 🏗️ 技术架构

### 项目结构

```
media-processor/
├── main.js                          # Electron主进程入口
├── package.json                     # 项目配置和依赖
├── src/
│   ├── index.html                   # 主界面HTML
│   ├── css/
│   │   └── style.css               # 界面样式
│   ├── js/
│   │   ├── renderer.js             # 渲染进程主逻辑
│   │   └── processors/             # 处理器模块
│   │       ├── common-processor.js # 公共功能（FFmpeg检测、文件扫描）
│   │       ├── mp3-processor.js    # MP3压缩处理
│   │       └── video-processor.js  # 视频转换处理
│   └── assets/
│       └── icons/
│           └── media.ico           # 应用图标
├── bin/                            # FFmpeg可执行文件（打包用）
├── QUICK_START.md                  # 快速开始指南
└── README.md                       # 项目说明
```

### 核心技术栈

- **Electron 28.0.0**: 跨平台桌面应用框架
- **FFmpeg**: 音视频处理引擎
- **Node.js**: 后端逻辑和文件系统操作
- **HTML5/CSS3**: 现代化用户界面
- **IPC通信**: 主进程与渲染进程数据交换

### 关键特性实现

#### MP3处理特性

- **智能比特率检测**: 使用ffprobe获取音频元数据
- **批量并行处理**: 异步处理多个文件，实时进度反馈
- **编码优化**: libmp3lame编码器，支持ABR/CBR模式
- **文件结构保持**: 递归扫描，保持原有目录层级

#### 视频处理特性

- **H.264编码**: Baseline profile，最佳兼容性
- **自适应缩放**: 保持宽高比，自动填充黑边
- **HLS分片**: 可配置片段时长，生成标准m3u8播放列表
- **标准化命名**: 自动重命名为课程标准格式

#### 界面交互特性

- **响应式设计**: 适配不同屏幕尺寸
- **实时状态更新**: WebSocket风格的进度和日志推送
- **可调节列宽**: 拖拽调整文件名列宽度
- **批量操作**: 全选、多选、批量移除

## 🔧 开发指南

### 开发环境设置

```bash
# 安装开发依赖
npm install

# 启动开发模式（带调试工具）
npm run dev

# 代码格式化和检查
npm run lint
```

### 构建配置

应用使用electron-builder进行打包，支持：

- **Windows**: NSIS安装包，支持x64架构
- **macOS**: DMG磁盘映像，支持Intel和Apple Silicon
- **Linux**: AppImage便携版本

### 添加新功能

1. **处理器模块**: 在`src/js/processors/`添加新的处理器
2. **界面组件**: 在`src/index.html`和`src/css/style.css`中添加UI
3. **IPC通信**: 在`main.js`中添加新的IPC处理器
4. **渲染逻辑**: 在`src/js/renderer.js`中添加前端逻辑

## 🐛 故障排除

### 常见问题

#### FFmpeg状态检查

- 应用已内置FFmpeg，无需单独安装
- 如果状态检查失败，请检查应用文件是否完整
- 在macOS上，可能需要给FFmpeg文件添加执行权限：

```bash
chmod +x bin/mac/ffmpeg
chmod +x bin/mac/ffprobe
```

**Q: 处理速度很慢**

- 大文件处理需要时间，这是正常现象
- 可以降低视频比特率加快处理速度
- 建议分批处理大量文件

**Q: 某些文件处理失败**

- 检查文件是否损坏或格式不支持
- 查看日志面板中的详细错误信息
- 确保有足够的磁盘空间

**Q: 界面显示异常**

- 尝试重启应用
- 检查是否有杀毒软件干扰
- 清除应用缓存数据

### 支持的文件格式

**音频格式**: MP3 (主要支持)
**视频格式**: MP4, AVI, MOV, MKV, WMV, FLV, WebM

### 性能优化建议

- 对于大批量文件，建议分组处理
- 处理高分辨率视频时确保有足够内存
- SSD硬盘可显著提升处理速度

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

## 🤝 贡献

欢迎提交Issue和Pull Request！

### 贡献指南

1. Fork本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启Pull Request

### 开发者

- **作者**: huanggh
- **邮箱**: <mouhao1986@gmail.com>

---

🎉 **开始使用吧！** 选择一个包含音视频文件的文件夹，体验强大的批量处理功能。
