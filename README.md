# 音视频处理工具

基于Electron的跨平台音视频处理桌面应用，实现MP3压缩和视频HLS转换功能。

## 功能特性

### 🎵 MP3压缩
- 批量处理MP3文件
- 可设置目标比特率（32-128kbps）
- 智能比特率阈值过滤
- 保持文件夹结构选项
- 支持多种音频格式（MP3、WAV、FLAC、AAC、M4A）

### 🎬 视频处理
- 批量重命名视频文件为标准格式
- 转换为HLS格式（m3u8 + ts文件）
- 支持720p/1080p输出分辨率
- 可调节视频比特率和HLS片段时长
- 支持多种视频格式（MP4、AVI、MOV、MKV、WMV、FLV、M4V、WebM）

### 📱 界面特性
- 现代化Material Design风格界面
- 文件拖拽支持
- 实时处理进度显示
- 详细的处理日志
- 响应式布局设计

## 系统要求

- **操作系统**: Windows 10+, macOS 10.14+, Linux (Ubuntu 18.04+)
- **Node.js**: 16.0.0+
- **FFmpeg**: 必须安装并添加到系统PATH

## 安装方法

### 1. 安装FFmpeg

#### Windows
```bash
# 使用Chocolatey
choco install ffmpeg

# 或下载预编译版本
# https://ffmpeg.org/download.html#build-windows
```

#### macOS
```bash
# 使用Homebrew
brew install ffmpeg
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install ffmpeg
```

### 2. 安装应用依赖

```bash
# 克隆或下载项目
cd media-processor

# 安装依赖
npm install

# 启动开发模式
npm run dev

# 构建应用
npm run build
```

## 使用方法

### MP3压缩处理

1. 点击"选择文件夹"按钮，选择包含MP3文件的文件夹
2. 切换到"MP3文件"标签查看扫描到的音频文件
3. 在右侧设置面板中配置压缩参数：
   - **目标比特率**: 设置压缩后的音质（推荐64kbps）
   - **比特率阈值**: 只处理高于此比特率的文件
   - **保持文件夹结构**: 在输出目录中保持原有的文件夹层级
4. 选择要处理的文件，点击"开始处理"

### 视频HLS转换

1. 选择包含视频文件的文件夹
2. 切换到"视频文件"标签查看扫描到的视频文件
3. 配置视频处理参数：
   - **课程名称**: 用于重命名文件的课程标识
   - **输出分辨率**: 选择720p或1080p
   - **视频比特率**: 控制视频质量和文件大小
   - **HLS片段时长**: 每个ts文件的时长（5-30秒）
   - **重命名为标准格式**: 是否使用physics_{lesson}_video{n}_{timestamp}格式
4. 选择要处理的视频文件，开始转换

### 输出结果

处理完成的文件会保存在源文件夹的`output`子目录中：

```
选择的文件夹/
├── 原始文件...
└── output/
    ├── MP3文件/ (保持原结构)
    └── 视频文件夹/
        ├── video1.m3u8
        ├── video1_001.ts
        ├── video1_002.ts
        └── ...
```

## 开发说明

### 项目结构

```
media-processor/
├── main.js                 # Electron主进程
├── package.json            # 项目配置
├── src/
│   ├── index.html          # 主界面
│   ├── css/
│   │   └── style.css       # 样式文件
│   ├── js/
│   │   ├── media-processor.js  # 核心处理逻辑
│   │   └── renderer.js     # 渲染进程逻辑
│   └── assets/
│       └── icons/
│           └── media.ico   # 应用图标
└── README.md
```

### 核心技术

- **Electron**: 跨平台桌面应用框架
- **fluent-ffmpeg**: FFmpeg的Node.js封装
- **music-metadata**: 音频元数据读取
- **HTML5 + CSS3**: 现代化界面设计

### 编译打包

```bash
# 开发模式
npm run dev

# 构建所有平台
npm run build

# 构建特定平台
npm run dist-win    # Windows
npm run dist-mac    # macOS
```

## 技术特性

### MP3处理特性
- 使用FFmpeg libmp3lame编码器
- 智能比特率检测和过滤
- 批量并行处理
- 保持原始文件的标签信息

### 视频处理特性
- H.264 Baseline编码，最佳兼容性
- 自动分辨率缩放和填充
- CRF质量控制
- HLS分片优化
- 色彩空间保持

### 界面特性
- Material Design风格
- 实时进度反馈
- 响应式布局
- 拖拽文件支持
- 详细日志记录

## 常见问题

### Q: 提示"FFmpeg未安装"怎么办？
A: 请确保已正确安装FFmpeg并添加到系统PATH环境变量中。

### Q: 处理大文件时很慢？
A: 这是正常现象，FFmpeg需要时间进行音视频编码。可以在日志中查看详细进度。

### Q: 支持哪些文件格式？
A: 
- 音频：MP3, WAV, FLAC, AAC, M4A
- 视频：MP4, AVI, MOV, MKV, WMV, FLV, M4V, WebM

### Q: 输出的视频质量如何调节？
A: 可以通过调节视频比特率来控制质量，数值越高质量越好但文件越大。

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request来改进这个项目。 