const { ipcRenderer } = require('electron');
const path = require('path');

// 防御性编程：确保全局拖拽事件变量不会导致错误
if (typeof window !== 'undefined' && !window.dragEvent) {
    window.dragEvent = null;
}

class MediaProcessorApp {
    constructor() {
        this.currentFolder = null;
        // 每个tab独立的文件管理
        this.tabFiles = {
            'mp3': [],
            'video': [],
            'compose': [],
            'intro-outro': [],
            'logo-watermark': []
        };
        this.selectedFiles = [];
        this.currentFileType = 'mp3';
        this.isProcessing = false;
        this.currentFFmpegProcess = null;
        this.shouldStopProcessing = false;
        
        // 文件信息加载状态
        this.isLoadingFileDetails = false;
        this.dragDropEnabled = false;
        
        this.initializeElements();
        this.bindEvents();
        this.checkFFmpegStatus();
        
        // 初始化配置面板
        this.updateConfigPanel(this.currentFileType);
        
        // 初始化按钮可用性
        this.updateButtonAvailability(this.currentFileType);
        
        // 初始化列宽调整功能
        this.initializeColumnResizer();
    }

    initializeColumnResizer() {
        const resizer = document.querySelector('.column-resizer');
        const nameColumn = document.querySelector('.header-name');
        const container = document.querySelector('.left-panel');
        
        if (!resizer || !nameColumn || !container) return;
        
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        
        window.addEventListener('resize', () => {
            this.checkHorizontalScroll();
        });
        
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = nameColumn.offsetWidth;
            
            resizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            
            // 创建遮罩层防止鼠标离开
            const overlay = document.createElement('div');
            overlay.id = 'resize-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                cursor: col-resize;
                z-index: 9999;
            `;
            document.body.appendChild(overlay);
            
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const deltaX = e.clientX - startX;
            const newWidth = Math.max(200, Math.min(startWidth + deltaX, container.offsetWidth * 0.7));
            
            // 更新CSS变量
            document.documentElement.style.setProperty('--name-column-width', `${newWidth}px`);
            
            // 实时检查水平滚动状态
            this.checkHorizontalScroll();
            
            e.preventDefault();
        });
        
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                
                // 移除遮罩层
                const overlay = document.getElementById('resize-overlay');
                if (overlay) {
                    overlay.remove();
                }
                
                // 保存设置到localStorage
                const currentWidth = document.documentElement.style.getPropertyValue('--name-column-width');
                if (currentWidth) {
                    localStorage.setItem('nameColumnWidth', currentWidth);
                }
            }
        });
        
        // 恢复保存的列宽设置
        const savedWidth = localStorage.getItem('nameColumnWidth');
        if (savedWidth) {
            document.documentElement.style.setProperty('--name-column-width', savedWidth);
        } else {
            document.documentElement.style.setProperty('--name-column-width', '350px');
        }
    }

    initializeElements() {
        // 按钮和输入元素
        this.selectFolderBtn = document.getElementById('select-folder-btn');
        this.selectFilesBtn = document.getElementById('select-files-btn');
        this.processBtn = document.getElementById('processBtn');
        this.removeSelectedBtn = document.getElementById('removeSelectedBtn');
        this.selectAllCheckbox = document.getElementById('selectAllCheckbox');
        this.selectOutputBtn = document.getElementById('select-output-btn');
        this.outputFolder = document.getElementById('output-folder');
        
        // 显示元素
        this.folderPath = document.getElementById('folder-path');
        this.fileList = document.getElementById('fileList');
        this.fileCountText = document.getElementById('file-count-text');
        this.progressFill = document.getElementById('progress-fill');
        this.progressText = document.getElementById('progress-text');
        this.progressSpinner = document.getElementById('progress-spinner');
        this.clearLogBtn = document.getElementById('clear-log-btn');
        this.stopProcessBtn = document.getElementById('stop-process-btn');
        
        // 进度条动画相关属性
        this.simulatedProgress = 0;
        this.progressAnimationId = null;
        this.isRealProgress = false;
        this.lastRealProgress = 0;
        this.progressSpeed = 0.1; // 每100ms增加的百分比
        this.logContent = document.getElementById('log-content');
        this.ffmpegStatus = document.getElementById('ffmpeg-status');
        
        // 标签页和配置
        this.fileTabs = document.querySelectorAll('.file-tab');
        this.tabContents = document.querySelectorAll('.tab-content');
        this.configTitle = document.getElementById('config-title');
        this.composeTip = document.querySelector('.compose-tip');

        // MP3 设置元素
        this.mp3ForceProcessRadios = document.querySelectorAll('input[name="force-process"]');
        this.mp3ThresholdGroup = document.getElementById('mp3-threshold-group');
        
        // 视频处理设置元素
        this.videoResolutionSelect = document.getElementById('video-resolution');
        this.videoCustomResolutionGroup = document.getElementById('video-custom-resolution-group');
        this.videoCustomWidthInput = document.getElementById('video-custom-width');
        this.videoCustomHeightInput = document.getElementById('video-custom-height');
        this.videoQualitySelect = document.getElementById('video-quality');
        this.videoCustomQualityGroup = document.getElementById('video-custom-quality-group');
        
        // 新增高级优化选项元素
        this.videoScalingStrategySelect = document.getElementById('video-scaling-strategy');
        this.colorEnhancementCheckbox = document.getElementById('color-enhancement');
        this.bitrateControlModeSelect = document.getElementById('bitrate-control-mode');
        this.mobileOptimizationCheckbox = document.getElementById('mobile-optimization');
        
        // 视频合成设置元素
        this.composeTypeSelect = document.getElementById('compose-type');
        this.composeResolutionSelect = document.getElementById('compose-resolution');
        this.composeAspectSelect = document.getElementById('compose-aspect');
        this.composeQualitySelect = document.getElementById('compose-quality');
        this.backgroundColorGroup = document.getElementById('background-color-group');
        this.customResolutionGroup = document.getElementById('custom-resolution-group');
        this.customQualityGroup = document.getElementById('custom-quality-group');
        this.customWidthInput = document.getElementById('custom-width');
        this.customHeightInput = document.getElementById('custom-height');
        this.concatSettings = document.getElementById('concat-settings');
        this.multiVideoSettings = document.getElementById('multi-video-settings');
        this.pipPositionGroup = document.getElementById('pip-position');
        this.pipSizeGroup = document.getElementById('pip-size');
        
        // 片头片尾处理设置元素
        this.replaceIntroRadios = document.querySelectorAll('input[name="replace-intro"]');
        this.replaceOutroRadios = document.querySelectorAll('input[name="replace-outro"]');
        this.introTrimGroup = document.getElementById('intro-trim-group');
        this.outroTrimGroup = document.getElementById('outro-trim-group');
        this.introFileGroup = document.getElementById('intro-file-group');
        this.outroFileGroup = document.getElementById('outro-file-group');
        this.introFileInput = document.getElementById('intro-file');
        this.outroFileInput = document.getElementById('outro-file');
        this.selectIntroBtn = document.getElementById('select-intro-btn');
        this.selectOutroBtn = document.getElementById('select-outro-btn');
        
        // LOGO水印设置元素
        this.addLogoRadios = document.querySelectorAll('input[name="add-logo"]');
        this.addWatermarkRadios = document.querySelectorAll('input[name="add-watermark"]');
        this.selectLogoBtn = document.getElementById('select-logo-btn');
        this.selectWatermarkBtn = document.getElementById('select-watermark-btn');
        this.clearLogoBtn = document.getElementById('clear-logo-btn');
        this.clearWatermarkBtn = document.getElementById('clear-watermark-btn');
        this.logoFileInput = document.getElementById('logo-file');
        this.watermarkFileInput = document.getElementById('watermark-file');
        this.logoFileGroup = document.getElementById('logo-file-group');
        this.watermarkFileGroup = document.getElementById('watermark-file-group');
        this.logoOpacityGroup = document.getElementById('logo-opacity-group');
        this.watermarkOpacityGroup = document.getElementById('watermark-opacity-group');
        this.logoTimeGroup = document.getElementById('logo-time-group');
        this.watermarkTimeGroup = document.getElementById('watermark-time-group');
        this.logoPositionSettings = document.getElementById('logo-position-settings');
        this.watermarkPositionSettings = document.getElementById('watermark-position-settings');
        this.logoOpacity = document.getElementById('logo-opacity');
        this.watermarkOpacity = document.getElementById('watermark-opacity');
        this.logoOpacityValue = document.getElementById('logo-opacity-value');
        this.watermarkOpacityValue = document.getElementById('watermark-opacity-value');
        this.logoTimeModeRadios = document.querySelectorAll('input[name="logo-time-mode"]');
        this.watermarkTimeModeRadios = document.querySelectorAll('input[name="watermark-time-mode"]');
        this.logoTimeInputs = document.getElementById('logo-time-inputs');
        this.watermarkTimeInputs = document.getElementById('watermark-time-inputs');
        
        // 视频预览器元素
        this.videoPreviewContainer = document.getElementById('video-preview-container');
        this.videoPreviewPlayer = document.getElementById('video-preview-player');
        this.previewPlayPause = document.getElementById('preview-play-pause');
        this.previewTime = document.getElementById('preview-time');
        this.videoOverlay = document.getElementById('video-overlay');
        this.logoOverlay = document.getElementById('logo-overlay');
        this.watermarkOverlay = document.getElementById('watermark-overlay');
        this.logoPreviewImg = document.getElementById('logo-preview-img');
        this.watermarkPreviewImg = document.getElementById('watermark-preview-img');
        this.videoInfo = document.getElementById('video-info');
        this.videoDisplayIndicator = document.getElementById('video-display-indicator');
        
        // 位置控制输入框
        this.logoXInput = document.getElementById('logo-x');
        this.logoYInput = document.getElementById('logo-y');
        this.logoWidthInput = document.getElementById('logo-width');
        this.logoHeightInput = document.getElementById('logo-height');
        this.watermarkXInput = document.getElementById('watermark-x');
        this.watermarkYInput = document.getElementById('watermark-y');
        this.watermarkWidthInput = document.getElementById('watermark-width');
        this.watermarkHeightInput = document.getElementById('watermark-height');
        
        // 拖拽状态
        this.isDragging = false;
        this.isResizing = false;
        this.dragElement = null;
        this.dragStartPos = { x: 0, y: 0 };
        this.elementStartPos = { x: 0, y: 0 };
        this.resizeHandle = null;
        this.resizeStartSize = { width: 0, height: 0 };
        
        // 视频尺寸和坐标转换
        this.videoRealSize = { width: 0, height: 0 }; // 视频真实分辨率
        this.videoDisplaySize = { width: 0, height: 0 }; // 视频在播放器中的实际显示尺寸
        this.videoDisplayOffset = { x: 0, y: 0 }; // 视频在播放器中的偏移位置
    }

    bindEvents() {
        // 文件夹选择
        this.selectFolderBtn.addEventListener('click', () => this.selectFolder());
        
        // 文件选择
        this.selectFilesBtn.addEventListener('click', () => this.selectFiles());
        
        // 输出文件夹选择
        this.selectOutputBtn.addEventListener('click', () => this.selectOutputFolder());
        
        // 清除日志按钮
        this.clearLogBtn.addEventListener('click', () => this.clearLog());
        
        // 停止处理按钮
        this.stopProcessBtn.addEventListener('click', () => this.stopProcessing());
        
        // 处理按钮
        this.processBtn.addEventListener('click', () => this.startProcessing());
        
        // 移除选中按钮
        this.removeSelectedBtn.addEventListener('click', () => this.removeSelectedFiles());
        
        // 全选复选框
        this.selectAllCheckbox.addEventListener('change', (e) => this.selectAllFiles(e.target.checked));
        
        // 文件类型标签页
        this.fileTabs.forEach(tab => {
            tab.addEventListener('click', (e) => this.switchFileTab(e.target.dataset.type));
        });
        
        // 监听处理进度
        ipcRenderer.on('processing-progress', (event, progress) => {
            this.handleProgressUpdate(progress);
        });

        // 监听处理日志
        ipcRenderer.on('processing-log', (event, log) => {
            this.addLog(log.type, log.message);
        });

        // 监听MP3强制处理单选框变化
        this.mp3ForceProcessRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.mp3ThresholdGroup.style.display = (e.target.value === 'yes') ? 'none' : '';
            });
        });

        // 监听视频合成类型变化
        if (this.composeTypeSelect) {
            this.composeTypeSelect.addEventListener('change', (e) => {
                this.updateComposeSettings(e.target.value);
            });
        }

        // 监听视频处理分辨率选择变化
        if (this.videoResolutionSelect) {
            this.videoResolutionSelect.addEventListener('change', (e) => {
                this.updateVideoResolutionSettings(e.target.value);
            });
        }

        // 监听视频处理质量预设变化
        if (this.videoQualitySelect) {
            this.videoQualitySelect.addEventListener('change', (e) => {
                this.updateVideoQualitySettings(e.target.value);
            });
        }

        // 监听视频合成分辨率选择变化
        if (this.composeResolutionSelect) {
            this.composeResolutionSelect.addEventListener('change', (e) => {
                this.updateResolutionSettings(e.target.value);
            });
        }

        // 监听宽高比处理变化
        if (this.composeAspectSelect) {
            this.composeAspectSelect.addEventListener('change', (e) => {
                this.updateAspectRatioSettings(e.target.value);
            });
        }

        // 监听质量预设变化
        if (this.composeQualitySelect) {
            this.composeQualitySelect.addEventListener('change', (e) => {
                this.updateQualitySettings(e.target.value);
            });
        }

        // 监听片头替换选项变化
        this.replaceIntroRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.updateIntroSettings(e.target.value === 'yes');
            });
        });

        // 监听片尾替换选项变化  
        this.replaceOutroRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.updateOutroSettings(e.target.value === 'yes');
            });
        });

        // 片头文件选择
        if (this.selectIntroBtn) {
            this.selectIntroBtn.addEventListener('click', () => this.selectIntroFile());
        }

        // 片尾文件选择
        if (this.selectOutroBtn) {
            this.selectOutroBtn.addEventListener('click', () => this.selectOutroFile());
        }
        
        // LOGO水印相关事件
        if (this.selectLogoBtn) {
            this.selectLogoBtn.addEventListener('click', () => this.selectLogoFile());
        }
        if (this.selectWatermarkBtn) {
            this.selectWatermarkBtn.addEventListener('click', () => this.selectWatermarkFile());
        }
        if (this.clearLogoBtn) {
            this.clearLogoBtn.addEventListener('click', () => this.clearLogoFile());
        }
        if (this.clearWatermarkBtn) {
            this.clearWatermarkBtn.addEventListener('click', () => this.clearWatermarkFile());
        }
        
        // LOGO设置切换
        this.addLogoRadios.forEach(radio => {
            radio.addEventListener('change', (e) => this.toggleLogoSettings(e.target.value === 'yes'));
        });
        
        // 水印设置切换
        this.addWatermarkRadios.forEach(radio => {
            radio.addEventListener('change', (e) => this.toggleWatermarkSettings(e.target.value === 'yes'));
        });
        
        // 透明度滑块
        if (this.logoOpacity) {
            this.logoOpacity.addEventListener('input', (e) => {
                this.logoOpacityValue.textContent = Math.round(e.target.value * 100) + '%';
            });
        }
        if (this.watermarkOpacity) {
            this.watermarkOpacity.addEventListener('input', (e) => {
                this.watermarkOpacityValue.textContent = Math.round(e.target.value * 100) + '%';
            });
        }
        
        // 时间模式切换
        this.logoTimeModeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => this.toggleLogoTimeInputs(e.target.value === 'custom'));
        });
        this.watermarkTimeModeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => this.toggleWatermarkTimeInputs(e.target.value === 'custom'));
        });
        
        // 视频预览器事件
        if (this.previewPlayPause) {
            this.previewPlayPause.addEventListener('click', () => this.toggleVideoPlayback());
        }
        if (this.videoPreviewPlayer) {
            this.videoPreviewPlayer.addEventListener('timeupdate', () => this.updateVideoTime());
            this.videoPreviewPlayer.addEventListener('loadedmetadata', () => this.onVideoLoaded());
        }
        
        // 拖拽和缩放事件
        this.initializeDragAndResize();
        
        // 位置输入框变化事件
        if (this.logoXInput) this.logoXInput.addEventListener('input', () => this.updateOverlayFromInputs('logo'));
        if (this.logoYInput) this.logoYInput.addEventListener('input', () => this.updateOverlayFromInputs('logo'));
        if (this.logoWidthInput) this.logoWidthInput.addEventListener('input', () => this.updateOverlayFromInputs('logo'));
        if (this.logoHeightInput) this.logoHeightInput.addEventListener('input', () => this.updateOverlayFromInputs('logo'));
        if (this.watermarkXInput) this.watermarkXInput.addEventListener('input', () => this.updateOverlayFromInputs('watermark'));
        if (this.watermarkYInput) this.watermarkYInput.addEventListener('input', () => this.updateOverlayFromInputs('watermark'));
        if (this.watermarkWidthInput) this.watermarkWidthInput.addEventListener('input', () => this.updateOverlayFromInputs('watermark'));
        if (this.watermarkHeightInput) this.watermarkHeightInput.addEventListener('input', () => this.updateOverlayFromInputs('watermark'));

        // 监听片头片尾时长输入变化
        const introTrimInput = document.getElementById('intro-trim-seconds');
        const outroTrimInput = document.getElementById('outro-trim-seconds');
        const qualitySelect = document.getElementById('intro-outro-quality');
        
        if (introTrimInput) {
            introTrimInput.addEventListener('input', () => this.updateTrimSummary());
        }
        
        if (outroTrimInput) {
            outroTrimInput.addEventListener('input', () => this.updateTrimSummary());
        }
        
        if (qualitySelect) {
            qualitySelect.addEventListener('change', () => this.updateTrimSummary());
        }

        // 同步表头和文件列表的水平滚动
        this.fileList.addEventListener('scroll', () => {
            const header = document.querySelector('.file-list-header');
            if (header) {
                header.scrollLeft = this.fileList.scrollLeft;
            }
        });
        
        // 初始化裁剪汇总显示
        setTimeout(() => {
            this.updateTrimSummary();
        }, 100);
    }

    async checkFFmpegStatus() {
        try {
            const result = await ipcRenderer.invoke('check-ffmpeg');
            const indicator = this.ffmpegStatus.querySelector('.status-indicator');
            const text = this.ffmpegStatus.querySelector('span:last-child');
            
            if (result.success && result.available) {
                indicator.textContent = '✅';
                text.textContent = 'FFmpeg已就绪';
            } else {
                indicator.textContent = '❌';
                text.textContent = 'FFmpeg未安装或不可用';
                this.addLog('error', '❌ FFmpeg未安装，请先安装FFmpeg才能使用音视频处理功能');
            }
        } catch (error) {
            this.addLog('error', `检查FFmpeg状态失败: ${error.message}`);
        }
    }

    async selectFolder() {
        try {
            const result = await ipcRenderer.invoke('select-folder');
            if (result.success && result.path) {
                this.currentFolder = result.path;
                this.folderPath.textContent = `当前文件夹: ${result.path}`;
                this.addLog('info', `📂 选择文件夹扫描到 ${this.getFileTypeName()} 标签: ${result.path}`);
                
                // 设置默认输出路径为源文件夹下的output文件夹
                const defaultOutputPath = await ipcRenderer.invoke('get-default-output-path', result.path);
                if (defaultOutputPath.success) {
                    this.outputFolder.value = defaultOutputPath.path;
                    this.addLog('info', `📁 默认输出路径: ${defaultOutputPath.path}`);
                }
                
                // 重置当前tab的文件列表，然后扫描文件夹
                this.tabFiles[this.currentFileType] = [];
                await this.scanMediaFilesForCurrentTab();
            }
        } catch (error) {
            this.addLog('error', `选择文件夹失败: ${error.message}`);
        }
    }

    async selectFiles() {
        try {
            // 根据当前tab类型决定文件类型过滤
            let filters = [];
            if (this.currentFileType === 'mp3') {
                filters = [
                    { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a'] },
                    { name: 'MP3文件', extensions: ['mp3'] },
                    { name: '所有文件', extensions: ['*'] }
                ];
            } else if (['video', 'compose', 'intro-outro', 'logo-watermark'].includes(this.currentFileType)) {
                filters = [
                    { name: '视频文件', extensions: ['mp4', 'avi', 'mov', 'wmv', 'mkv', 'flv', 'webm'] },
                    { name: '所有文件', extensions: ['*'] }
                ];
            } else {
                // 默认支持所有媒体文件
                filters = [
                    { name: '媒体文件', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'mp4', 'avi', 'mov', 'wmv', 'mkv', 'flv', 'webm'] },
                    { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a'] },
                    { name: '视频文件', extensions: ['mp4', 'avi', 'mov', 'wmv', 'mkv', 'flv', 'webm'] },
                    { name: '所有文件', extensions: ['*'] }
                ];
            }

            // 对于LOGO水印功能，使用单文件选择；其他功能支持多文件选择
            const useMultiSelect = this.currentFileType !== 'logo-watermark';
            const result = await ipcRenderer.invoke(useMultiSelect ? 'select-files-with-filter' : 'select-single-file-with-filter', filters);
            
            if (result.success && ((useMultiSelect && result.files && result.files.length > 0) || (!useMultiSelect && result.file))) {
                const files = useMultiSelect ? result.files : [result.file];
                this.addLog('info', `📄 选择了 ${files.length} 个文件到 ${this.getFileTypeName()} 标签`);
                
                // 更新当前文件夹为第一个文件的目录
                const firstFilePath = files[0];
                this.currentFolder = path.dirname(firstFilePath);
                
                // 对于LOGO水印模式，每次选择新文件时都更新输出路径
                // 对于其他模式，只在没有设置输出路径时设置默认路径
                if (this.currentFileType === 'logo-watermark' || !this.outputFolder.value) {
                    const defaultOutputPath = await ipcRenderer.invoke('get-default-output-path', this.currentFolder);
                    if (defaultOutputPath.success) {
                        this.outputFolder.value = defaultOutputPath.path;
                        this.addLog('info', `📁 输出路径已更新: ${defaultOutputPath.path}`);
                    }
                }
                
                // LOGO水印功能：清空列表并添加新文件；其他功能：追加到列表
                if (this.currentFileType === 'logo-watermark') {
                    await this.replaceFilesInCurrentTab(files);
                } else {
                    await this.addSelectedFilesToCurrentTab(files);
                }
                
                // 更新文件夹路径显示
                const totalFiles = this.tabFiles[this.currentFileType].length;
                if (totalFiles > 0) {
                    this.folderPath.textContent = `${this.getFileTypeName()}文件列表: ${totalFiles} 个文件`;
                }
            }
        } catch (error) {
            this.addLog('error', `选择文件失败: ${error.message}`);
        }
    }

    async selectOutputFolder() {
        try {
            const result = await ipcRenderer.invoke('select-folder');
            if (result.success && result.path) {
                this.outputFolder.value = result.path;
                this.addLog('info', `📁 输出文件夹: ${result.path}`);
            }
        } catch (error) {
            this.addLog('error', `选择输出文件夹失败: ${error.message}`);
        }
    }

    async processSelectedFiles(filePaths) {
        try {
            this.addLog('info', '🔍 正在处理选中的文件...');
            const result = await ipcRenderer.invoke('process-selected-files', filePaths);
            
            if (result.success) {
                // 兼容旧的processSelectedFiles调用，将文件分配给对应的tab
                this.tabFiles['mp3'] = result.files.mp3;
                this.tabFiles['video'] = result.files.video;
                this.tabFiles['compose'] = result.files.video;
                this.tabFiles['intro-outro'] = result.files.video;
                this.tabFiles['logo-watermark'] = result.files.video;
                
                this.updateFileList();
                this.addLog('success', `✅ 处理完成: 找到 ${result.files.mp3.length} 个MP3文件, ${result.files.video.length} 个视频文件`);
            } else {
                this.addLog('error', `处理文件失败: ${result.error}`);
            }
        } catch (error) {
            this.addLog('error', `处理选中文件时出错: ${error.message}`);
        }
    }

    async addSelectedFilesToCurrentTab(filePaths) {
        try {
            this.addLog('info', '🔍 正在添加选中的文件...');
            const result = await ipcRenderer.invoke('process-selected-files', filePaths);
            
            if (result.success) {
                const newFiles = result.files;
                let addedCount = 0;
                let duplicateCount = 0;
                
                // 根据当前tab类型决定要添加的文件类型
                let targetFiles = [];
                if (this.currentFileType === 'mp3') {
                    targetFiles = newFiles.mp3;
                } else if (['video', 'compose', 'intro-outro', 'logo-watermark'].includes(this.currentFileType)) {
                    targetFiles = newFiles.video;
                }
                
                // 添加文件（避免重复）
                for (const newFile of targetFiles) {
                    const exists = this.tabFiles[this.currentFileType].some(existing => existing.path === newFile.path);
                    if (!exists) {
                        this.tabFiles[this.currentFileType].push(newFile);
                        addedCount++;
                    } else {
                        duplicateCount++;
                    }
                }
                
                this.updateFileList();
                
                // 报告结果
                if (addedCount > 0) {
                    this.addLog('success', `✅ 添加完成: 新增 ${addedCount} 个文件到 ${this.getFileTypeName()} 标签`);
                }
                if (duplicateCount > 0) {
                    this.addLog('warning', `⚠️ 跳过 ${duplicateCount} 个重复文件`);
                }
                if (addedCount === 0 && duplicateCount === 0) {
                    this.addLog('info', `📄 未找到可添加的${this.getFileTypeName()}文件`);
                }
            } else {
                this.addLog('error', `添加文件失败: ${result.error}`);
            }
        } catch (error) {
            this.addLog('error', `添加选中文件时出错: ${error.message}`);
        }
    }

    async replaceFilesInCurrentTab(filePaths) {
        try {
            this.addLog('info', '🔍 正在设置选中的文件...');
            const result = await ipcRenderer.invoke('process-selected-files', filePaths);
            
            if (result.success) {
                const newFiles = result.files;
                
                // 根据当前tab类型决定要设置的文件类型
                let targetFiles = [];
                if (this.currentFileType === 'mp3') {
                    targetFiles = newFiles.mp3;
                } else if (['video', 'compose', 'intro-outro', 'logo-watermark'].includes(this.currentFileType)) {
                    targetFiles = newFiles.video;
                }
                
                // 清空当前tab的文件列表，然后设置新文件
                this.tabFiles[this.currentFileType] = [...targetFiles];
                
                // 在LOGO水印模式下，先清空选中状态，让renderFileList自动选中第一个文件
                if (this.currentFileType === 'logo-watermark') {
                    this.selectedFiles = [];
                }
                
                this.updateFileList();
                
                // 如果是LOGO水印模式且有文件，自动加载到视频预览器
                if (this.currentFileType === 'logo-watermark' && targetFiles.length > 0) {
                    this.loadVideoPreview(targetFiles[0]);
                    
                    // 更新输出路径为当前文件的同级目录
                    const currentFilePath = targetFiles[0];
                    const currentFolder = path.dirname(currentFilePath);
                    this.currentFolder = currentFolder;
                    
                    const defaultOutputPath = await ipcRenderer.invoke('get-default-output-path', currentFolder);
                    if (defaultOutputPath.success) {
                        this.outputFolder.value = defaultOutputPath.path;
                        this.addLog('info', `📁 输出路径已更新为当前文件目录: ${defaultOutputPath.path}`);
                    }
                }
                
                // 报告结果
                if (targetFiles.length > 0) {
                    this.addLog('success', `✅ 设置完成: ${targetFiles.length} 个${this.getFileTypeName()}文件`);
                } else {
                    this.addLog('info', `📄 未找到可设置的${this.getFileTypeName()}文件`);
                }
            } else {
                this.addLog('error', `设置文件失败: ${result.error}`);
            }
        } catch (error) {
            this.addLog('error', `设置选中文件时出错: ${error.message}`);
        }
    }

    async scanMediaFilesForCurrentTab() {
        if (!this.currentFolder) return;
        
        try {
            this.addLog('info', `🔍 正在扫描${this.getFileTypeName()}文件...`);
            const result = await ipcRenderer.invoke('scan-media-files', this.currentFolder);
            
            if (result.success) {
                // 根据当前tab类型选择对应的文件
                if (this.currentFileType === 'mp3') {
                    this.tabFiles[this.currentFileType] = result.files.mp3;
                } else if (['video', 'compose', 'intro-outro', 'logo-watermark'].includes(this.currentFileType)) {
                    this.tabFiles[this.currentFileType] = result.files.video;
                }
                
                this.updateFileList();
                const fileCount = this.tabFiles[this.currentFileType].length;
                this.addLog('success', `✅ 扫描完成: 找到 ${fileCount} 个${this.getFileTypeName()}文件`);
            } else {
                this.addLog('error', `扫描失败: ${result.error}`);
            }
        } catch (error) {
            this.addLog('error', `扫描文件时出错: ${error.message}`);
        }
    }



    async scanMediaFiles() {
        if (!this.currentFolder) return;
        
        try {
            this.addLog('info', '🔍 正在扫描媒体文件...');
            const result = await ipcRenderer.invoke('scan-media-files', this.currentFolder);
            
            if (result.success) {
                // 兼容旧的全局扫描，将所有文件类型分配给对应的tab
                this.tabFiles['mp3'] = result.files.mp3;
                this.tabFiles['video'] = result.files.video;
                this.tabFiles['compose'] = result.files.video;
                this.tabFiles['intro-outro'] = result.files.video;
                this.tabFiles['logo-watermark'] = result.files.video;
                
                this.updateFileList();
                this.addLog('success', `✅ 扫描完成: 找到 ${result.files.mp3.length} 个MP3文件, ${result.files.video.length} 个视频文件`);
            } else {
                this.addLog('error', `扫描失败: ${result.error}`);
            }
        } catch (error) {
            this.addLog('error', `扫描文件时出错: ${error.message}`);
        }
    }

    switchFileTab(type) {
        this.currentFileType = type;
        
        // 更新left-panel的data属性，便于CSS样式控制
        const leftPanel = document.querySelector('.left-panel');
        if (leftPanel) {
            leftPanel.setAttribute('data-current-type', type);
        }
        
        // 更新标签页状态
        this.fileTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.type === type);
        });
        
        // 更新配置面板
        this.updateConfigPanel(type);
        
        // 根据tab类型控制按钮可用性
        this.updateButtonAvailability(type);
        
        // 如果是视频处理标签页，初始化视频处理设置显示状态
        if (type === 'video') {
            if (this.videoResolutionSelect) {
                this.updateVideoResolutionSettings(this.videoResolutionSelect.value);
            }
            if (this.videoQualitySelect) {
                this.updateVideoQualitySettings(this.videoQualitySelect.value);
            }
        }
        
        // 如果是合成视频标签页，初始化合成设置显示状态
        if (type === 'compose') {
            if (this.composeTypeSelect) {
                this.updateComposeSettings(this.composeTypeSelect.value);
            }
            if (this.composeResolutionSelect) {
                this.updateResolutionSettings(this.composeResolutionSelect.value);
            }
            if (this.composeAspectSelect) {
                this.updateAspectRatioSettings(this.composeAspectSelect.value);
            }
            if (this.composeQualitySelect) {
                this.updateQualitySettings(this.composeQualitySelect.value);
            }
        }
        
        // 如果是片头片尾处理标签页，初始化裁剪汇总显示
        if (type === 'intro-outro') {
            // 延迟调用以确保DOM元素已经加载
            setTimeout(() => {
                this.updateTrimSummary();
            }, 100);
        }
        
        // 控制拖拽提示显示（只在合成模式下显示）
        if (this.composeTip) {
            if (type === 'compose') {
                this.composeTip.style.display = 'block';
            } else {
                this.composeTip.style.display = 'none';
            }
        }
        
        // 控制视频预览器显示（只在LOGO水印模式下显示）
        if (type === 'logo-watermark') {
            this.showVideoPreview();
            // 如果有选中的视频文件，自动加载到预览器
            const files = this.tabFiles[type] || [];
            if (files.length > 0) {
                this.loadVideoPreview(files[0]);
                // 注意：自动选中逻辑将在renderFileList之后执行
            }
        } else {
            this.hideVideoPreview();
        }
        
        // 控制序号列显示（只在合成模式下显示）
        const headerOrder = document.querySelector('.header-order');
        if (headerOrder) {
            if (type === 'compose') {
                headerOrder.style.display = 'flex';
            } else {
                headerOrder.style.display = 'none';
            }
        }
        
        // 控制file-list-header和file-list显示（在LOGO水印模式下隐藏）
        const fileListHeader = document.querySelector('.file-list-header');
        const fileListElement = document.querySelector('.file-list');
        if (type === 'logo-watermark') {
            if (fileListHeader) fileListHeader.style.display = 'none';
            if (fileListElement) fileListElement.style.display = 'none';
        } else {
            if (fileListHeader) fileListHeader.style.display = 'flex';
            if (fileListElement) fileListElement.style.display = 'block';
        }
        
        // 检查是否需要获取详细信息
        const files = this.tabFiles[type] || [];
        const needsDetails = files.some(file => 
            !file.info || file.info === '点击处理时获取详情'
        );
        
        this.renderFileList(needsDetails);
    }

    updateConfigPanel(type) {
        // 更新配置标题
        if (type === 'mp3') {
            this.configTitle.textContent = 'MP3压缩配置';
        } else if (type === 'video') {
            this.configTitle.textContent = '视频处理配置';
        } else if (type === 'compose') {
            this.configTitle.textContent = '视频合成配置';
        } else if (type === 'intro-outro') {
            this.configTitle.textContent = '视频片头片尾处理配置';
        } else if (type === 'logo-watermark') {
            this.configTitle.textContent = 'LOGO水印配置';
        }
        
        // 更新配置内容
        this.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${type}-settings`);
        });
    }

    updateButtonAvailability(type) {
        // LOGO水印tab只能使用"选择文件"，其他tab两个按钮都可用
        if (type === 'logo-watermark') {
            this.selectFolderBtn.disabled = true;
            this.selectFolderBtn.title = '此功能不支持文件夹扫描，请使用"选择文件"';
            this.selectFilesBtn.disabled = false;
            this.selectFilesBtn.title = '选择单个视频文件（每次选择会清空列表）';
        } else {
            this.selectFolderBtn.disabled = false;
            this.selectFolderBtn.title = '选择文件夹扫描媒体文件（追加到列表）';
            this.selectFilesBtn.disabled = false;
            this.selectFilesBtn.title = '选择文件（追加到列表）';
        }
    }

    updateFileList() {
        this.renderFileList(true); // 首次渲染需要获取详细信息
    }

    renderFileList(loadDetails = false) {
        // 使用当前tab的独立文件列表
        const files = this.tabFiles[this.currentFileType] || [];
        
        // 在LOGO水印模式下，如果有文件且当前没有选中文件，自动选中第一个
        if (this.currentFileType === 'logo-watermark' && files.length > 0 && this.selectedFiles.length === 0) {
            this.selectedFiles = [files[0]];
        } else if (this.currentFileType !== 'logo-watermark') {
            // 其他模式清空选中状态
            this.selectedFiles = [];
        }
        
        if (files.length === 0) {
            this.fileList.innerHTML = `
                <div class="empty-state">
                    <p>未找到${this.getFileTypeName()}文件</p>
                </div>
            `;
            this.updateFileCount();
            return;
        }

        const fileItems = files.map((file, index) => {
            const fileName = file.name;
            const filePath = file.path;
            const fileSize = this.formatFileSize(file.size);
            const fileInfo = file.info || '';
            
            // 使用绝对路径显示
            const displayPath = filePath;
            
            // 如果已经有信息，直接使用；否则显示加载状态
            const infoDisplay = fileInfo && fileInfo !== '点击处理时获取详情' 
                ? fileInfo 
                : (loadDetails ? '<span class="loading-spinner"></span>正在获取信息...' : '点击处理时获取详情');
            
            return `
                <div class="file-item ${this.currentFileType}" data-index="${index}" data-type="${this.currentFileType}" ${this.currentFileType === 'compose' ? 'draggable="true"' : ''}>
                    ${this.currentFileType === 'compose' ? '<div class="drag-handle" title="拖拽排序">⋮⋮</div>' : ''}
                    <div class="file-order" style="display: ${this.currentFileType === 'compose' ? 'flex' : 'none'};">
                        <span class="order-number">${index + 1}</span>
                    </div>
                    <div class="file-select">
                        <input type="checkbox" data-index="${index}">
                    </div>
                    <div class="file-name" title="${filePath}">
                        <div class="file-name-text">${fileName}</div>
                        <div class="file-path-text">${displayPath}</div>
                    </div>
                    <div class="file-info" data-file-index="${index}">
                        ${infoDisplay}
                    </div>
                    <div class="file-size">${fileSize}</div>
                </div>
            `;
        }).join('');

        this.fileList.innerHTML = fileItems;
        
        // 绑定复选框事件
        this.fileList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.index);
                if (e.target.checked) {
                    this.selectedFiles.push(files[index]);
                } else {
                    const fileIndex = this.selectedFiles.findIndex(f => f.path === files[index].path);
                    if (fileIndex > -1) {
                        this.selectedFiles.splice(fileIndex, 1);
                    }
                }
                this.updateFileCount();
                this.updateSelectAllCheckbox();
            });
            
            // 在logo-watermark模式下，如果文件在selectedFiles中，设置为选中状态
            if (this.currentFileType === 'logo-watermark') {
                const index = parseInt(checkbox.dataset.index);
                const file = files[index];
                const isSelected = this.selectedFiles.some(f => f.path === file.path);
                checkbox.checked = isSelected;
            }
        });
        
        // 为视频合成模式添加拖拽排序功能（仅在非加载状态时启用）
        if (this.currentFileType === 'compose') {
            this.setupDragAndDrop();
        }
        
        this.updateFileCount();
        this.updateSelectAllCheckbox();
        
        // 检查是否需要水平滚动
        this.checkHorizontalScroll();
        
        // 只在需要时获取文件详细信息
        if (loadDetails) {
            this.loadFileDetails(files);
        } else {
            // 如果不需要加载详细信息，立即启用拖拽功能
            this.isLoadingFileDetails = false;
            this.updateDragDropState();
        }
    }

    async loadFileDetails(files) {
        // 设置加载状态
        this.isLoadingFileDetails = true;
        this.updateDragDropState();
        
        // 延迟1秒开始获取，避免界面卡顿
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 使用当前tab的文件类型
        const fileType = this.currentFileType === 'mp3' ? 'mp3' : 'video';
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                const result = await ipcRenderer.invoke('get-file-details', {
                    filePath: file.path,
                    fileType: fileType
                });
                
                if (result.success) {
                    // 更新文件信息显示
                    const infoElement = this.fileList.querySelector(`[data-file-index="${i}"]`);
                    if (infoElement) {
                        infoElement.innerHTML = result.details.info;
                    }
                    
                    // 更新内存中的文件信息，使用当前tab的数组
                    if (this.tabFiles[this.currentFileType] && this.tabFiles[this.currentFileType][i]) {
                        this.tabFiles[this.currentFileType][i].info = result.details.info;
                    }
                }
            } catch (error) {
                console.error(`获取文件 ${file.name} 信息失败:`, error);
                const infoElement = this.fileList.querySelector(`[data-file-index="${i}"]`);
                if (infoElement) {
                    infoElement.innerHTML = '获取信息失败';
                }
            }
            
            // 每个文件之间间隔200ms，避免过度占用资源
            if (i < files.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        
        // 完成加载，启用拖拽功能
        this.isLoadingFileDetails = false;
        this.updateDragDropState();
    }

    updateDragDropState() {
        if (this.currentFileType !== 'compose') {
            return; // 只有合成模式才需要拖拽功能
        }
        
        const fileItems = this.fileList.querySelectorAll('.file-item');
        const composeTip = document.querySelector('.compose-tip');
        
        console.log('updateDragDropState called:', {
            isLoadingFileDetails: this.isLoadingFileDetails,
            fileItemsCount: fileItems.length,
            currentFileType: this.currentFileType
        });
        
        if (this.isLoadingFileDetails) {
            // 禁用拖拽功能
            this.dragDropEnabled = false;
            fileItems.forEach(item => {
                item.draggable = false;
                item.classList.add('loading-disabled');
            });
            
            // 更新提示文字
            if (composeTip) {
                composeTip.innerHTML = `
                    <div class="compose-tip-content">
                        <span class="loading-spinner"></span>
                        <span>正在加载视频信息，请稍候...</span>
                    </div>
                `;
            }
        } else {
            // 启用拖拽功能
            this.dragDropEnabled = true;
            let enabledCount = 0;
            fileItems.forEach(item => {
                console.log('Processing item:', {
                    datasetType: item.dataset.type,
                    classList: item.classList.toString(),
                    draggable: item.draggable
                });
                if (item.dataset.type === 'compose') {
                    item.draggable = true;
                    item.classList.remove('loading-disabled');
                    enabledCount++;
                }
            });
            console.log('Enabled drag for', enabledCount, 'items');
            
            // 恢复提示文字
            if (composeTip) {
                composeTip.innerHTML = `
                    <div class="compose-tip-content">
                        <span class="compose-tip-icon">⋮⋮</span>
                        <span>拖拽视频文件可调整合成顺序</span>
                    </div>
                `;
            }
        }
    }

    checkHorizontalScroll() {
        setTimeout(() => {
            const fileList = this.fileList;
            const hasScroll = fileList.scrollWidth > fileList.clientWidth;
            
            if (hasScroll) {
                fileList.classList.add('has-horizontal-scroll');
            } else {
                fileList.classList.remove('has-horizontal-scroll');
            }
        }, 100);
    }

    selectAllFiles(checked) {
        // 使用当前tab的文件列表
        const files = this.tabFiles[this.currentFileType] || [];
        const checkboxes = this.fileList.querySelectorAll('input[type="checkbox"]');
        
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
        });
        
        this.selectedFiles = checked ? [...files] : [];
        this.updateFileCount();
    }

    removeSelectedFiles() {
        if (this.selectedFiles.length === 0) return;
        
        const removedCount = this.selectedFiles.length;
        
        // 从当前tab的文件列表中移除选中的文件
        this.selectedFiles.forEach(selectedFile => {
            const index = this.tabFiles[this.currentFileType].findIndex(file => file.path === selectedFile.path);
            if (index > -1) {
                this.tabFiles[this.currentFileType].splice(index, 1);
            }
        });
        
        // 清空选中列表
        this.selectedFiles = [];
        
        // 在LOGO水印模式下，如果移除后没有文件了，清空视频预览器
        if (this.currentFileType === 'logo-watermark') {
            const remainingFiles = this.tabFiles[this.currentFileType] || [];
            if (remainingFiles.length === 0) {
                // 清空视频预览器
                if (this.videoPreviewPlayer) {
                    this.videoPreviewPlayer.src = '';
                    this.videoPreviewPlayer.load();
                }
                if (this.videoInfo) {
                    this.videoInfo.textContent = '请选择视频文件进行预览';
                }
                // 隐藏LOGO和水印覆盖层
                if (this.logoOverlay) this.logoOverlay.style.display = 'none';
                if (this.watermarkOverlay) this.watermarkOverlay.style.display = 'none';
                if (this.videoDisplayIndicator) this.videoDisplayIndicator.style.display = 'none';
                
                // 清空LOGO和水印相关设置
                this.clearAllLogoWatermarkSettings();
            } else {
                // 如果还有剩余文件，加载第一个文件到预览器并选中
                this.loadVideoPreview(remainingFiles[0]);
                this.selectedFiles = [remainingFiles[0]];
            }
        }
        
        // 重新渲染文件列表（不重新获取文件信息）
        this.renderFileList(false);
        
        // 记录日志
        const fileTypeName = this.getFileTypeName();
        this.addLog('info', `🗑️ 已移除 ${removedCount} 个${fileTypeName}文件`);
    }

    updateSelectAllCheckbox() {
        // 使用当前tab的文件列表
        const files = this.tabFiles[this.currentFileType] || [];
        const checkedCount = this.selectedFiles.length;
        
        if (checkedCount === 0) {
            this.selectAllCheckbox.checked = false;
            this.selectAllCheckbox.indeterminate = false;
        } else if (checkedCount === files.length) {
            this.selectAllCheckbox.checked = true;
            this.selectAllCheckbox.indeterminate = false;
        } else {
            this.selectAllCheckbox.checked = false;
            this.selectAllCheckbox.indeterminate = true;
        }
    }

    updateFileCount() {
        const selectedCount = this.selectedFiles.length;
        // 使用当前tab的文件列表
        const totalCount = this.tabFiles[this.currentFileType]?.length || 0;
        
        if (selectedCount === 0) {
            this.fileCountText.textContent = `共 ${totalCount} 个文件`;
            this.processBtn.disabled = true;
            this.removeSelectedBtn.disabled = true;
        } else {
            this.fileCountText.textContent = `已选择 ${selectedCount} / ${totalCount} 个文件`;
            this.processBtn.disabled = false;
            this.removeSelectedBtn.disabled = false;
        }
    }

    async startProcessing() {
        if (this.isProcessing || this.selectedFiles.length === 0) return;

        // 检查是否设置了输出路径
        if (!this.outputFolder.value) {
            this.addLog('error', '❌ 请先设置输出文件夹');
            return;
        }
        
        this.isProcessing = true;
        this.shouldStopProcessing = false;
        this.processBtn.disabled = true;
        this.removeSelectedBtn.disabled = true;
        this.stopProcessBtn.disabled = false;
        this.processBtn.textContent = '⏳ 处理中...';
        
        // 重置主进程的停止标志
        try {
            await ipcRenderer.invoke('reset-stop-flag');
        } catch (error) {
            console.error('重置停止标志失败:', error);
        }
        
        // 启动模拟进度
        this.startSimulatedProgress('analyzing', '正在分析文件...');
        
        try {
            if (this.currentFileType === 'mp3') {
                await this.processMp3Files();
            } else if (this.currentFileType === 'video') {
                await this.processVideoFiles();
            } else if (this.currentFileType === 'compose') {
                await this.composeVideos();
            } else if (this.currentFileType === 'intro-outro') {
                await this.processIntroOutroVideos();
            } else if (this.currentFileType === 'logo-watermark') {
                await this.processLogoWatermarkVideos();
            }
        } catch (error) {
            if (this.shouldStopProcessing) {
                this.addLog('warning', '⏹️ 处理已被用户停止');
            } else {
                this.addLog('error', `处理失败: ${error.message}`);
            }
        } finally {
            this.isProcessing = false;
            this.currentFFmpegProcess = null;
            this.shouldStopProcessing = false;
            this.processBtn.textContent = '🚀 开始处理';
            this.stopProcessBtn.disabled = true;
            this.updateFileCount(); // 恢复按钮状态
            
            // 显示完成状态，然后重置
            this.updateProgress({ type: this.currentFileType, current: 1, total: 1, status: 'complete' });
            setTimeout(() => {
                this.updateProgress({ type: this.currentFileType, current: 0, total: 0, status: 'idle' });
            }, 2000);
        }
    }

    async stopProcessing() {
        if (!this.isProcessing) return;
        
        this.addLog('warning', '⏹️ 正在停止处理...');
        this.shouldStopProcessing = true;
        
        try {
            // 通知主进程停止处理
            await ipcRenderer.invoke('stop-processing');
            this.addLog('info', '✅ 已发送停止信号，等待处理完成...');
        } catch (error) {
            this.addLog('error', `❌ 发送停止信号失败: ${error.message}`);
        }
    }

    async processMp3Files() {
        const options = {
            bitrate: parseInt(document.getElementById('mp3-bitrate').value),
            encodingMode: document.querySelector('input[name="encoding-mode"]:checked').value,
            threshold: parseInt(document.getElementById('mp3-threshold').value),
            keepStructure: document.getElementById('mp3-keep-structure').checked,
            forceProcess: document.querySelector('input[name="force-process"]:checked').value === 'yes'
        };

        this.addLog('info', `🎵 开始处理 ${this.selectedFiles.length} 个MP3文件`);
        this.addLog('info', `⚙️ 目标比特率: ${options.bitrate}kbps, 阈值: ${options.threshold}kbps`);
        if (options.forceProcess) {
            this.addLog('info', `💪 强制处理模式：将处理所有文件，忽略比特率阈值`);
        }

        const result = await ipcRenderer.invoke('process-mp3-files', {
            folderPath: this.currentFolder,
            outputPath: this.outputFolder.value,
            files: this.selectedFiles,
            options
        });

        if (result.success) {
            const { processed, skipped, failed, details } = result.result;
            this.addLog('success', `✅ MP3处理完成: 成功 ${processed}, 跳过 ${skipped}, 失败 ${failed}`);
            
            // 显示详细的处理结果
            details.forEach(detail => {
                if (detail.status === 'skipped') {
                    this.addLog('warning', `⏭️ ${detail.file}: ${detail.message}`);
                } else if (detail.status === 'error') {
                    this.addLog('error', `❌ ${detail.file}: ${detail.message}`);
                } else if (detail.status === 'success') {
                    this.addLog('info', `✅ ${detail.file}: ${detail.message}`);
                }
            });
        } else {
            this.addLog('error', `MP3处理失败: ${result.error}`);
        }
    }

    async processVideoFiles() {
        const resolution = document.getElementById('video-resolution').value;
        const quality = document.getElementById('video-quality').value;
        
        const options = {
            resolution: resolution,
            quality: quality,
            segmentDuration: parseInt(document.getElementById('segment-duration').value),
            rename: document.getElementById('video-rename').checked,
            // 新增高级优化选项
            scalingStrategy: document.getElementById('video-scaling-strategy').value,
            colorEnhancement: document.getElementById('color-enhancement').checked,
            bitrateControlMode: document.getElementById('bitrate-control-mode').value,
            mobileOptimization: document.getElementById('mobile-optimization').checked
        };

        // 如果是自定义分辨率，添加自定义宽高
        if (resolution === 'custom') {
            options.customWidth = parseInt(document.getElementById('video-custom-width').value) || 1920;
            options.customHeight = parseInt(document.getElementById('video-custom-height').value) || 1080;
        }

        // 如果是自定义质量，添加自定义质量参数
        if (quality === 'custom') {
            options.customProfile = document.getElementById('video-profile-m3u8').value;
            options.customBitrate = parseInt(document.getElementById('video-bitrate-m3u8').value);
            options.customFramerate = parseInt(document.getElementById('video-framerate-m3u8').value);
            options.customAudioBitrate = parseInt(document.getElementById('audio-bitrate-m3u8').value);
            options.customAudioSamplerate = parseInt(document.getElementById('audio-samplerate-m3u8').value);
            options.customPreset = document.getElementById('encode-preset-m3u8').value;
        }

        this.addLog('info', `🎬 开始处理 ${this.selectedFiles.length} 个视频文件`);
        
        let resolutionText = resolution;
        if (resolution === 'custom') {
            resolutionText = `自定义 ${options.customWidth}x${options.customHeight}`;
        } else if (resolution === 'auto') {
            resolutionText = '自动（保持原分辨率）';
        }
        
        let qualityText = quality;
        if (quality === 'custom') {
            qualityText = `自定义 (${options.customBitrate}kbps, ${options.customPreset})`;
        }
        
        this.addLog('info', `⚙️ 分辨率: ${resolutionText}, 质量: ${qualityText}`);

        const result = await ipcRenderer.invoke('process-video-files', {
            folderPath: this.currentFolder,
            outputPath: this.outputFolder.value,
            files: this.selectedFiles,
            options
        });

        if (result.success) {
            const { processed, failed } = result.result;
            this.addLog('success', `✅ 视频处理完成: 成功 ${processed}, 失败 ${failed}`);
        } else {
            this.addLog('error', `视频处理失败: ${result.error}`);
        }
    }

    // 启动模拟进度动画
    startSimulatedProgress(status = 'processing', message = '正在处理...') {
        this.stopSimulatedProgress();
        
        // 设置不同阶段的速度
        const speedConfig = {
            'analyzing': { speed: 0.3, maxProgress: 15, label: '正在分析' },
            'preprocessing': { speed: 0.2, maxProgress: 85, label: '预处理中' },
            'processing': { speed: 0.1, maxProgress: 95, label: '正在处理' },
            'composing': { speed: 0.15, maxProgress: 90, label: '正在合成' }
        };
        
        const config = speedConfig[status] || speedConfig.processing;
        this.progressSpeed = config.speed;
        this.maxSimulatedProgress = config.maxProgress;
        this.currentStatusLabel = config.label;
        
        this.isRealProgress = false;
        
        // 设置类名和显示
        this.progressFill.className = 'progress-fill';
        this.progressText.className = 'progress-text';
        this.progressSpinner.className = 'progress-spinner';
        
        if (status === 'preprocessing') {
            this.progressFill.classList.add('preprocessing');
            this.progressText.classList.add('preprocessing');
            this.progressSpinner.classList.add('visible', 'preprocessing');
        } else {
            this.progressFill.classList.add('processing');
            this.progressText.classList.add('processing');
            this.progressSpinner.classList.add('visible');
        }
        
        this.progressText.textContent = message;
        
        // 启动动画
        this.progressAnimationId = setInterval(() => {
            this.animateProgress();
        }, 100);
    }
    
    // 停止模拟进度
    stopSimulatedProgress() {
        if (this.progressAnimationId) {
            clearInterval(this.progressAnimationId);
            this.progressAnimationId = null;
        }
    }
    
    // 进度动画函数
    animateProgress() {
        if (this.isRealProgress) return;
        
        // 缓慢增加进度，但不超过最大值
        if (this.simulatedProgress < this.maxSimulatedProgress) {
            // 进度越高速度越慢（模拟真实情况）
            const slowdownFactor = Math.max(0.1, 1 - (this.simulatedProgress / this.maxSimulatedProgress) * 0.8);
            this.simulatedProgress += this.progressSpeed * slowdownFactor;
            
            this.progressFill.style.width = `${Math.min(this.simulatedProgress, this.maxSimulatedProgress)}%`;
        }
    }
    
    // 处理进度更新
    handleProgressUpdate(progress) {
        const { type, current, total, file, status, currentTime, totalDuration } = progress;
        
        // 如果是初始状态更新（analyzing、preprocessing开始、composing开始）
        if ((total <= 1 && current === 0) || (status === 'analyzing' || (status === 'preprocessing' && !currentTime) || (status === 'composing' && !currentTime))) {
            const statusMessages = {
                'analyzing': '正在分析视频信息...',
                'preprocessing': '正在预处理视频...',
                'composing': '正在合成视频...'
            };
            
            const message = statusMessages[status] || file || '正在处理...';
            this.startSimulatedProgress(status, message);
        } else if (total === 100 && current >= 0) {
            // FFmpeg真实进度（百分比）
            this.updateProgress(progress);
        } else {
            // 其他进度情况（如文件计数）
            this.updateProgress(progress);
        }
    }
    
    updateProgress(progress) {
        const { type, current, total, file, status } = progress;
        
        if (total > 0) {
            const realPercentage = Math.round((current / total) * 100);
            
            // 切换到真实进度
            this.isRealProgress = true;
            this.stopSimulatedProgress();
            
            // 确保进度不倒退
            const finalPercentage = Math.max(realPercentage, this.lastRealProgress);
            this.lastRealProgress = finalPercentage;
            
            this.progressFill.style.width = `${finalPercentage}%`;
            
            // 清除所有状态类
            this.progressFill.className = 'progress-fill';
            this.progressText.className = 'progress-text';
            this.progressSpinner.className = 'progress-spinner';
            
            if (status === 'processing') {
                this.progressFill.classList.add('processing');
                this.progressText.classList.add('processing');
                this.progressSpinner.classList.add('visible');
                this.progressText.textContent = `正在处理 (${current}/${total}): ${file}`;
                
            } else if (status === 'preprocessing') {
                this.progressFill.classList.add('preprocessing');
                this.progressText.classList.add('preprocessing');
                this.progressSpinner.classList.add('visible', 'preprocessing');
                this.progressText.textContent = `预处理中 (${current}/${total}): ${file}`;
                
            } else if (status === 'converting') {
                this.progressFill.classList.add('converting');
                this.progressText.classList.add('converting');
                this.progressSpinner.classList.add('visible', 'converting');
                this.progressText.textContent = `TS转换中 (${current}/${total}): ${file}`;
                
            } else if (status === 'complete') {
                this.stopSimulatedProgress();
                this.progressText.classList.add('complete');
                this.progressText.textContent = `处理完成`;
                this.progressFill.style.width = '100%';
                
                setTimeout(() => {
                    this.progressSpinner.classList.remove('visible');
                }, 1000);
            }
        } else {
            // 重置状态
            this.stopSimulatedProgress();
            this.simulatedProgress = 0;
            this.lastRealProgress = 0;
            this.isRealProgress = false;
            
            this.progressFill.className = 'progress-fill';
            this.progressText.className = 'progress-text';
            this.progressSpinner.className = 'progress-spinner';
            
            this.progressFill.style.width = '0%';
            this.progressText.textContent = '准备就绪';
            this.progressSpinner.classList.remove('visible');
        }
    }

    addLog(type, message) {
        const logEntry = document.createElement('p');
        logEntry.className = `log-entry ${type}`;
        logEntry.textContent = `${new Date().toLocaleTimeString()} ${message}`;
        
        this.logContent.appendChild(logEntry);
        this.logContent.scrollTop = this.logContent.scrollHeight;
    }

    clearLog() {
        this.logContent.innerHTML = '';
        this.addLog('info', '🧹 日志已清除');
    }

    async composeVideos() {
        // 验证选择的视频数量
        const composeType = document.getElementById('compose-type').value;
        if ((composeType === 'sidebyside' || composeType === 'pip') && this.selectedFiles.length !== 2) {
            this.addLog('error', `❌ ${composeType === 'sidebyside' ? '并排显示' : '画中画'}模式需要选择恰好2个视频文件`);
            return;
        }
        
        if (composeType === 'concat' && this.selectedFiles.length < 2) {
            this.addLog('error', '❌ 顺序拼接模式至少需要选择2个视频文件');
            return;
        }

        // 获取分辨率设置
        const resolutionSetting = document.getElementById('compose-resolution').value;
        let resolution = resolutionSetting;
        
        // 如果选择了自定义分辨率，获取自定义宽高值
        if (resolutionSetting === 'custom') {
            const customWidth = parseInt(document.getElementById('custom-width').value);
            const customHeight = parseInt(document.getElementById('custom-height').value);
            
            // 验证自定义分辨率输入
            if (!customWidth || !customHeight || customWidth < 320 || customHeight < 240) {
                this.addLog('error', '❌ 请输入有效的自定义分辨率（宽度≥320，高度≥240）');
                return;
            }
            
            resolution = {
                type: 'custom',
                width: customWidth,
                height: customHeight
            };
        }

        // 获取质量设置
        const qualityPreset = document.getElementById('compose-quality').value;
        let qualitySettings = { preset: qualityPreset };
        
        // 如果选择了自定义质量，获取详细参数
        if (qualityPreset === 'custom') {
            qualitySettings = {
                preset: 'custom',
                videoProfile: document.getElementById('video-profile').value,
                videoBitrate: parseInt(document.getElementById('video-bitrate-custom').value),
                videoFramerate: parseInt(document.getElementById('video-framerate-custom').value),
                audioBitrate: parseInt(document.getElementById('audio-bitrate-custom').value),
                audioSamplerate: parseInt(document.getElementById('audio-samplerate').value),
                encodePreset: document.getElementById('encode-preset').value
            };
        }

        // 获取用户设置的选项
        const options = {
            composeType: composeType,
            format: document.getElementById('compose-format').value,
            quality: qualitySettings,
            resolution: resolution,
            aspectRatio: document.getElementById('compose-aspect').value,
            background: document.getElementById('compose-background').value
        };

        // 根据合成类型获取特定选项
        if (composeType === 'concat') {
            options.transition = document.getElementById('compose-transition').value;
            options.audioMode = document.getElementById('compose-audio-concat').value;
        } else {
            options.audioMode = document.getElementById('compose-audio-multi').value;
            if (composeType === 'pip') {
                options.pipPosition = document.getElementById('compose-pip-position').value;
                options.pipSize = document.getElementById('compose-pip-size').value;
            }
        }

        this.addLog('info', `🎭 开始合成 ${this.selectedFiles.length} 个视频文件`);
        
        // 显示质量信息
        let qualityInfo;
        if (options.quality.preset === 'custom') {
            qualityInfo = `自定义 (${options.quality.videoBitrate}k, ${options.quality.videoFramerate}fps, ${options.quality.encodePreset})`;
        } else {
            const qualityNames = {
                'high': '高质量',
                'medium': '平衡',
                'fast': '快速'
            };
            qualityInfo = qualityNames[options.quality.preset] || options.quality.preset;
        }
        
        this.addLog('info', `⚙️ 合成类型: ${this.getComposeTypeName(options.composeType)}, 质量: ${qualityInfo}`);
        
        // 显示分辨率信息
        let resolutionInfo;
        if (typeof options.resolution === 'object' && options.resolution.type === 'custom') {
            resolutionInfo = `${options.resolution.width}x${options.resolution.height} (自定义)`;
        } else {
            const resolutionNames = {
                'auto': '自动',
                '4k': '4K (3840x2160)',
                '2k': '2K (2560x1440)', 
                '1080p': '1080p (1920x1080)',
                '720p': '720p (1280x720)',
                '480p': '480p (854x480)'
            };
            resolutionInfo = resolutionNames[options.resolution] || options.resolution;
        }
        
        this.addLog('info', `📐 分辨率: ${resolutionInfo}, 格式: ${options.format.toUpperCase()}`);
        this.addLog('info', `📝 输出文件: ${options.filename}.${options.format}`);

        const result = await ipcRenderer.invoke('compose-videos', {
            outputPath: this.outputFolder.value,
            files: this.selectedFiles,
            options
        });

        if (result.success) {
            const { processed, failed } = result.result;
            this.addLog('success', `✅ 视频合成完成: 成功 ${processed}, 失败 ${failed}`);
        } else {
            this.addLog('error', `视频合成失败: ${result.error}`);
        }
    }

    async processIntroOutroVideos() {
        // 获取片头片尾处理设置
        const replaceIntro = document.querySelector('input[name="replace-intro"]:checked').value === 'yes';
        const replaceOutro = document.querySelector('input[name="replace-outro"]:checked').value === 'yes';
        const introTrimSeconds = parseFloat(document.getElementById('intro-trim-seconds').value) || 0;
        const outroTrimSeconds = parseFloat(document.getElementById('outro-trim-seconds').value) || 0;
        const introFile = document.getElementById('intro-file').value;
        const outroFile = document.getElementById('outro-file').value;
        // 移除自定义文件名，将在处理器中自动生成文件夹名
        const quality = document.getElementById('intro-outro-quality').value || 'medium';

        // 验证设置
        if (replaceIntro && !introFile) {
            this.addLog('error', '❌ 请选择片头视频文件');
            return;
        }
        
        if (replaceOutro && !outroFile) {
            this.addLog('error', '❌ 请选择片尾视频文件');
            return;
        }

        if (!replaceIntro && !replaceOutro && introTrimSeconds === 0 && outroTrimSeconds === 0) {
            this.addLog('error', '❌ 请至少启用一种处理选项（替换片头/片尾或裁剪时长）');
            return;
        }

        const options = {
            replaceIntro,
            replaceOutro,
            introFile,
            outroFile,
            introTrimSeconds,
            outroTrimSeconds,
            quality
        };

        this.addLog('info', `🎬 开始处理 ${this.selectedFiles.length} 个视频文件`);
        this.addLog('info', `⚙️ 处理选项: 替换片头=${replaceIntro}, 替换片尾=${replaceOutro}, 质量=${quality}`);
        
        if (introTrimSeconds > 0) {
            this.addLog('info', `✂️ 裁剪片头: ${introTrimSeconds}秒`);
        }
        if (outroTrimSeconds > 0) {
            this.addLog('info', `✂️ 裁剪片尾: ${outroTrimSeconds}秒`);
        }
        if (replaceIntro && introFile) {
            this.addLog('info', `🎬 新片头: ${path.basename(introFile)}`);
        }
        if (replaceOutro && outroFile) {
            this.addLog('info', `🎭 新片尾: ${path.basename(outroFile)}`);
        }

        const result = await ipcRenderer.invoke('process-intro-outro', {
            outputPath: this.outputFolder.value,
            files: this.selectedFiles,
            options
        });

        if (result.success) {
            this.addLog('success', `✅ 视频片头片尾处理完成`);
        } else {
            this.addLog('error', `视频片头片尾处理失败: ${result.error}`);
        }
    }

    async processLogoWatermarkVideos() {
        // 获取LOGO水印设置
        const addLogo = document.querySelector('input[name="add-logo"]:checked').value === 'yes';
        const addWatermark = document.querySelector('input[name="add-watermark"]:checked').value === 'yes';
        
        // 验证设置
        if (!addLogo && !addWatermark) {
            this.addLog('error', '❌ 请至少选择添加LOGO或水印');
            return;
        }

        let logoFile = '';
        let logoOpacity = 1;
        let logoStartTime = 0;
        let logoEndTime = 0;
        let logoTimeMode = 'full';
        let logoX = 50;
        let logoY = 50;
        let logoWidth = 100;
        let logoHeight = 100;

        if (addLogo) {
            logoFile = document.getElementById('logo-file').value;
            if (!logoFile) {
                this.addLog('error', '❌ 请选择LOGO图片文件');
                return;
            }
            logoOpacity = parseFloat(document.getElementById('logo-opacity').value) || 1;
            logoTimeMode = document.querySelector('input[name="logo-time-mode"]:checked').value;
            if (logoTimeMode === 'custom') {
                logoStartTime = parseFloat(document.getElementById('logo-start-time').value) || 0;
                logoEndTime = parseFloat(document.getElementById('logo-end-time').value) || 10;
            }
            // 从输入框获取坐标（这些已经是基于视频真实分辨率的坐标）
            // 特别处理0值，避免被默认值覆盖
            const logoXInput = document.getElementById('logo-x');
            const logoYInput = document.getElementById('logo-y');
            logoX = logoXInput?.value === '' ? 50 : (parseInt(logoXInput?.value) || 0);
            logoY = logoYInput?.value === '' ? 50 : (parseInt(logoYInput?.value) || 0);
            logoWidth = parseInt(document.getElementById('logo-width').value) || 100;
            logoHeight = parseInt(document.getElementById('logo-height').value) || 100;
        }

        let watermarkFile = '';
        let watermarkOpacity = 0.7;
        let watermarkStartTime = 0;
        let watermarkEndTime = 0;
        let watermarkTimeMode = 'full';
        let watermarkX = 50;
        let watermarkY = 200;
        let watermarkWidth = 80;
        let watermarkHeight = 80;

        if (addWatermark) {
            watermarkFile = document.getElementById('watermark-file').value;
            if (!watermarkFile) {
                this.addLog('error', '❌ 请选择水印图片文件');
                return;
            }
            watermarkOpacity = parseFloat(document.getElementById('watermark-opacity').value) || 0.7;
            watermarkTimeMode = document.querySelector('input[name="watermark-time-mode"]:checked').value;
            if (watermarkTimeMode === 'custom') {
                watermarkStartTime = parseFloat(document.getElementById('watermark-start-time').value) || 0;
                watermarkEndTime = parseFloat(document.getElementById('watermark-end-time').value) || 10;
            }
            // 从输入框获取坐标（这些已经是基于视频真实分辨率的坐标）
            // 特别处理0值，避免被默认值覆盖
            const watermarkXInput = document.getElementById('watermark-x');
            const watermarkYInput = document.getElementById('watermark-y');
            watermarkX = watermarkXInput?.value === '' ? 50 : (parseInt(watermarkXInput?.value) || 0);
            watermarkY = watermarkYInput?.value === '' ? 200 : (parseInt(watermarkYInput?.value) || 0);
            watermarkWidth = parseInt(document.getElementById('watermark-width').value) || 80;
            watermarkHeight = parseInt(document.getElementById('watermark-height').value) || 80;
        }

        const quality = document.getElementById('logo-watermark-quality').value || 'source-match';

        const options = {
            addLogo,
            addWatermark,
            logoFile,
            logoOpacity,
            logoTimeMode,
            logoStartTime,
            logoEndTime,
            logoX,
            logoY,
            logoWidth,
            logoHeight,
            watermarkFile,
            watermarkOpacity,
            watermarkTimeMode,
            watermarkStartTime,
            watermarkEndTime,
            watermarkX,
            watermarkY,
            watermarkWidth,
            watermarkHeight,
            quality
        };

        this.addLog('info', `🏷️ 开始处理 ${this.selectedFiles.length} 个视频文件`);
        this.addLog('info', `⚙️ 处理选项: 添加LOGO=${addLogo}, 添加水印=${addWatermark}, 质量=${quality}`);
        
        if (addLogo) {
            this.addLog('info', `🎨 LOGO设置: 文件=${logoFile}, 透明度=${logoOpacity}, 位置=(${logoX},${logoY}), 大小=${logoWidth}x${logoHeight}`);
        }
        if (addWatermark) {
            this.addLog('info', `🌊 水印设置: 文件=${watermarkFile}, 透明度=${watermarkOpacity}, 位置=(${watermarkX},${watermarkY}), 大小=${watermarkWidth}x${watermarkHeight}`);
        }

        const result = await ipcRenderer.invoke('process-logo-watermark-videos', {
            outputPath: this.outputFolder.value,
            files: this.selectedFiles,
            options
        });

        if (result.success) {
            this.addLog('success', `✅ 视频LOGO水印处理完成`);
        } else {
            this.addLog('error', `视频LOGO水印处理失败: ${result.error}`);
        }
    }

    getComposeTypeName(type) {
        const typeNames = {
            'concat': '顺序拼接',
            'sidebyside': '并排显示',
            'pip': '画中画'
        };
        return typeNames[type] || type;
    }

    getFileTypeName() {
        const typeNames = {
            'mp3': 'MP3',
            'video': '视频',
            'compose': '视频',
            'intro-outro': '视频',
            'logo-watermark': '视频'
        };
        return typeNames[this.currentFileType] || '文件';
    }

    updateComposeSettings(composeType) {
        if (!this.concatSettings || !this.multiVideoSettings) return;
        
        if (composeType === 'concat') {
            // 顺序拼接：显示拼接设置，隐藏多视频设置
            this.concatSettings.style.display = 'block';
            this.multiVideoSettings.style.display = 'none';
        } else {
            // 并排显示或画中画：显示多视频设置，隐藏拼接设置
            this.concatSettings.style.display = 'none';
            this.multiVideoSettings.style.display = 'block';
            
            // 画中画需要额外显示位置和大小设置
            if (composeType === 'pip') {
                if (this.pipPositionGroup) this.pipPositionGroup.style.display = 'block';
                if (this.pipSizeGroup) this.pipSizeGroup.style.display = 'block';
            } else {
                if (this.pipPositionGroup) this.pipPositionGroup.style.display = 'none';
                if (this.pipSizeGroup) this.pipSizeGroup.style.display = 'none';
            }
        }
    }

    updateVideoResolutionSettings(resolution) {
        if (!this.videoCustomResolutionGroup) return;
        
        if (resolution === 'custom') {
            // 显示自定义分辨率输入框
            this.videoCustomResolutionGroup.style.display = 'block';
        } else {
            // 隐藏自定义分辨率输入框
            this.videoCustomResolutionGroup.style.display = 'none';
        }
    }

    updateVideoQualitySettings(quality) {
        if (!this.videoCustomQualityGroup) return;
        
        if (quality === 'custom') {
            // 显示自定义质量设置输入框
            this.videoCustomQualityGroup.style.display = 'block';
        } else {
            // 隐藏自定义质量设置输入框
            this.videoCustomQualityGroup.style.display = 'none';
        }
    }

    updateResolutionSettings(resolution) {
        if (!this.customResolutionGroup) return;
        
        if (resolution === 'custom') {
            // 显示自定义分辨率输入框
            this.customResolutionGroup.style.display = 'block';
        } else {
            // 隐藏自定义分辨率输入框
            this.customResolutionGroup.style.display = 'none';
        }
    }

    updateAspectRatioSettings(aspectRatio) {
        if (!this.backgroundColorGroup) return;
        
        if (aspectRatio === 'pad') {
            // 保持比例，黑边填充 - 显示背景颜色选项
            this.backgroundColorGroup.style.display = 'block';
        } else {
            // 裁剪或拉伸 - 隐藏背景颜色选项
            this.backgroundColorGroup.style.display = 'none';
        }
    }

    updateQualitySettings(quality) {
        if (!this.customQualityGroup) return;
        
        if (quality === 'custom') {
            // 自定义质量 - 显示详细参数设置
            this.customQualityGroup.style.display = 'block';
        } else {
            // 预设质量 - 隐藏详细参数设置
            this.customQualityGroup.style.display = 'none';
        }
    }

    setupDragAndDrop() {
        let draggedElement = null;
        let draggedIndex = null;
        
        // 选择所有compose类型的文件项，而不仅仅是当前可拖拽的
        const fileItems = this.fileList.querySelectorAll('.file-item.compose');
        
        fileItems.forEach((item, index) => {
            // 拖拽开始
            item.addEventListener('dragstart', (e) => {
                // 如果拖拽功能被禁用，阻止拖拽
                if (!this.dragDropEnabled) {
                    e.preventDefault();
                    return false;
                }
                
                draggedElement = item;
                draggedIndex = parseInt(item.dataset.index);
                item.classList.add('dragging');
                
                // 设置拖拽数据
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', item.outerHTML);
                
                // 创建自定义拖拽图像
                const dragImage = item.cloneNode(true);
                dragImage.style.transform = 'rotate(3deg)';
                dragImage.style.opacity = '0.8';
                document.body.appendChild(dragImage);
                e.dataTransfer.setDragImage(dragImage, 0, 0);
                setTimeout(() => document.body.removeChild(dragImage), 0);
            });
            
            // 拖拽结束
            item.addEventListener('dragend', (e) => {
                item.classList.remove('dragging');
                this.fileList.querySelectorAll('.file-item').forEach(el => {
                    el.classList.remove('drag-over-top', 'drag-over-bottom');
                });
                draggedElement = null;
                draggedIndex = null;
            });
            
            // 拖拽悬停
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                
                if (draggedElement && draggedElement !== item) {
                    const rect = item.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    
                    // 清除之前的拖拽样式
                    item.classList.remove('drag-over-top', 'drag-over-bottom');
                    
                    // 根据鼠标位置决定插入位置
                    if (e.clientY < midpoint) {
                        item.classList.add('drag-over-top');
                    } else {
                        item.classList.add('drag-over-bottom');
                    }
                }
            });
            
            // 离开拖拽区域
            item.addEventListener('dragleave', (e) => {
                // 只有当真正离开元素时才移除样式
                if (!item.contains(e.relatedTarget)) {
                    item.classList.remove('drag-over-top', 'drag-over-bottom');
                }
            });
            
            // 放置
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                
                if (draggedElement && draggedElement !== item) {
                    const targetIndex = parseInt(item.dataset.index);
                    const rect = item.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    
                    // 确定插入位置
                    let insertIndex = targetIndex;
                    if (e.clientY >= midpoint) {
                        insertIndex = targetIndex + 1;
                    }
                    
                    // 调整索引（如果拖拽元素在目标之前）
                    if (draggedIndex < insertIndex) {
                        insertIndex--;
                    }
                    
                    // 执行重排序
                    this.reorderFiles(draggedIndex, insertIndex);
                }
                
                // 清除拖拽样式
                this.fileList.querySelectorAll('.file-item').forEach(el => {
                    el.classList.remove('drag-over-top', 'drag-over-bottom');
                });
            });
        });
    }
    
    reorderFiles(fromIndex, toIndex) {
        // 只有合成模式支持拖拽排序
        if (this.currentFileType !== 'compose') {
            return;
        }
        
        // 获取当前文件数组
        const files = this.tabFiles[this.currentFileType] || [];
        
        if (fromIndex < 0 || fromIndex >= files.length || 
            toIndex < 0 || toIndex > files.length || 
            fromIndex === toIndex) {
            return;
        }
        
        // 移动文件
        const [movedFile] = files.splice(fromIndex, 1);
        files.splice(toIndex, 0, movedFile);
        
        // 更新选中文件数组中的引用
        this.selectedFiles = this.selectedFiles.map(selectedFile => {
            const newIndex = files.findIndex(f => f.path === selectedFile.path);
            return newIndex !== -1 ? files[newIndex] : selectedFile;
        });
        
        // 重新渲染文件列表
        this.renderFileList(false);
        
        // 更新序号显示
        this.updateOrderNumbers();
        
        // 显示排序提示
        if (this.addLog) {
            this.addLog('info', `📋 视频顺序已调整: ${movedFile.name} 移动到位置 ${toIndex + 1}`);
        }
    }
    
    updateOrderNumbers() {
        // 只在合成模式下更新序号
        if (this.currentFileType !== 'compose') return;
        
        const orderNumbers = this.fileList.querySelectorAll('.order-number');
        orderNumbers.forEach((orderElement, index) => {
            orderElement.textContent = index + 1;
            
            // 添加一个简单的动画效果
            orderElement.style.transform = 'scale(1.2)';
            setTimeout(() => {
                orderElement.style.transform = 'scale(1)';
            }, 200);
        });
    }

    // 更新片头设置显示状态
    updateIntroSettings(replaceIntro) {
        if (this.introFileGroup) {
            this.introFileGroup.style.display = replaceIntro ? '' : 'none';
        }
    }

    // 更新片尾设置显示状态
    updateOutroSettings(replaceOutro) {
        if (this.outroFileGroup) {
            this.outroFileGroup.style.display = replaceOutro ? '' : 'none';
        }
    }

    // 选择片头文件
    async selectIntroFile() {
        try {
            const result = await ipcRenderer.invoke('select-intro-file');
            if (result.success && result.filePath) {
                this.introFileInput.value = result.filePath;
            }
        } catch (error) {
            console.error('选择片头文件失败:', error);
            this.addLog('error', '选择片头文件失败: ' + error.message);
        }
    }

    // 选择片尾文件
    async selectOutroFile() {
        try {
            const result = await ipcRenderer.invoke('select-outro-file');
            if (result.success && result.filePath) {
                this.outroFileInput.value = result.filePath;
            }
        } catch (error) {
            console.error('选择片尾文件失败:', error);
            this.addLog('error', '选择片尾文件失败: ' + error.message);
        }
    }

    // 更新裁剪汇总显示
    updateTrimSummary() {
        const introTrimInput = document.getElementById('intro-trim-seconds');
        const outroTrimInput = document.getElementById('outro-trim-seconds');
        const introTrimDisplay = document.getElementById('intro-trim-display');
        const outroTrimDisplay = document.getElementById('outro-trim-display');
        const totalTrimDisplay = document.getElementById('total-trim-display');
        const qualitySelect = document.getElementById('intro-outro-quality');
        const precisionWarning = document.getElementById('precision-warning');
        
        if (!introTrimInput || !outroTrimInput || !introTrimDisplay || !outroTrimDisplay || !totalTrimDisplay) {
            return;
        }
        
        const introTrim = parseFloat(introTrimInput.value) || 0;
        const outroTrim = parseFloat(outroTrimInput.value) || 0;
        const totalTrim = introTrim + outroTrim;
        const quality = qualitySelect ? qualitySelect.value : 'copy';
        
        // 更新显示
        introTrimDisplay.textContent = introTrim > 0 ? `${introTrim}秒` : '0秒';
        outroTrimDisplay.textContent = outroTrim > 0 ? `${outroTrim}秒` : '0秒';
        totalTrimDisplay.textContent = totalTrim > 0 ? `${totalTrim}秒` : '0秒';
        
        // 如果总计大于0，高亮显示
        const totalItem = totalTrimDisplay.closest('.summary-item');
        if (totalItem) {
            if (totalTrim > 0) {
                totalItem.style.backgroundColor = '#fff3cd';
                totalItem.style.borderColor = '#ffeaa7';
                totalTrimDisplay.style.color = '#856404';
            } else {
                totalItem.style.backgroundColor = '';
                totalItem.style.borderColor = '';
                totalTrimDisplay.style.color = '';
            }
        }
        
        // 显示/隐藏精度警告（只有快速模式需要警告）
        if (precisionWarning) {
            if (totalTrim > 0 && quality === 'copy') {
                precisionWarning.style.display = 'flex';
            } else {
                precisionWarning.style.display = 'none';
            }
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    // LOGO水印功能相关方法
    async selectLogoFile() {
        try {
            const result = await ipcRenderer.invoke('select-logo-file');
            if (result.success && result.filePath) {
                this.logoFileInput.value = result.filePath;
                this.addLog('info', `🎨 选择LOGO: ${path.basename(result.filePath)}`);
                
                // 更新LOGO预览
                this.updateLogoPreview(result.filePath);
                
                // 显示LOGO位置设置
                if (this.logoPositionSettings) {
                    this.logoPositionSettings.style.display = 'block';
                }
                
                // 显示清除按钮
                if (this.clearLogoBtn) {
                    this.clearLogoBtn.style.display = 'inline-block';
                }
            }
        } catch (error) {
            this.addLog('error', '选择LOGO文件失败: ' + error.message);
        }
    }

    async selectWatermarkFile() {
        try {
            const result = await ipcRenderer.invoke('select-watermark-file');
            if (result.success && result.filePath) {
                this.watermarkFileInput.value = result.filePath;
                this.addLog('info', `🌊 选择水印: ${path.basename(result.filePath)}`);
                
                // 更新水印预览
                this.updateWatermarkPreview(result.filePath);
                
                // 显示水印位置设置
                if (this.watermarkPositionSettings) {
                    this.watermarkPositionSettings.style.display = 'block';
                }
                
                // 显示清除按钮
                if (this.clearWatermarkBtn) {
                    this.clearWatermarkBtn.style.display = 'inline-block';
                }
            }
        } catch (error) {
            this.addLog('error', '选择水印文件失败: ' + error.message);
        }
    }

    clearLogoFile() {
        // 清除文件路径
        if (this.logoFileInput) {
            this.logoFileInput.value = '';
        }
        
        // 隐藏LOGO预览
        if (this.logoOverlay) {
            this.logoOverlay.style.display = 'none';
        }
        
        // 隐藏位置设置
        if (this.logoPositionSettings) {
            this.logoPositionSettings.style.display = 'none';
        }
        
        // 隐藏清除按钮
        if (this.clearLogoBtn) {
            this.clearLogoBtn.style.display = 'none';
        }
        
        // 清除预览图片
        if (this.logoPreviewImg) {
            this.logoPreviewImg.src = '';
        }
        
        // 重置位置输入框
        this.resetLogoPosition();
        
        // 更新视频显示区域指示器样式
        this.updateVideoDisplayIndicator();
        
        this.addLog('info', '🗑️ 已清除LOGO图片');
    }

    clearWatermarkFile() {
        // 清除文件路径
        if (this.watermarkFileInput) {
            this.watermarkFileInput.value = '';
        }
        
        // 隐藏水印预览
        if (this.watermarkOverlay) {
            this.watermarkOverlay.style.display = 'none';
        }
        
        // 隐藏位置设置
        if (this.watermarkPositionSettings) {
            this.watermarkPositionSettings.style.display = 'none';
        }
        
        // 隐藏清除按钮
        if (this.clearWatermarkBtn) {
            this.clearWatermarkBtn.style.display = 'none';
        }
        
        // 清除预览图片
        if (this.watermarkPreviewImg) {
            this.watermarkPreviewImg.src = '';
        }
        
        // 重置位置输入框
        this.resetWatermarkPosition();
        
        // 更新视频显示区域指示器样式
        this.updateVideoDisplayIndicator();
        
        this.addLog('info', '🗑️ 已清除水印图片');
    }

    resetLogoPosition() {
        if (this.logoXInput) this.logoXInput.value = '';
        if (this.logoYInput) this.logoYInput.value = '';
        if (this.logoWidthInput) this.logoWidthInput.value = '';
        if (this.logoHeightInput) this.logoHeightInput.value = '';
    }

    resetWatermarkPosition() {
        if (this.watermarkXInput) this.watermarkXInput.value = '';
        if (this.watermarkYInput) this.watermarkYInput.value = '';
        if (this.watermarkWidthInput) this.watermarkWidthInput.value = '';
        if (this.watermarkHeightInput) this.watermarkHeightInput.value = '';
    }

    clearAllLogoWatermarkSettings() {
        // 重置LOGO选项为"否"
        const logoNoRadio = document.querySelector('input[name="add-logo"][value="no"]');
        if (logoNoRadio) {
            logoNoRadio.checked = true;
            this.toggleLogoSettings(false);
        }
        
        // 重置水印选项为"否"
        const watermarkNoRadio = document.querySelector('input[name="add-watermark"][value="no"]');
        if (watermarkNoRadio) {
            watermarkNoRadio.checked = true;
            this.toggleWatermarkSettings(false);
        }
        
        // 清除LOGO文件
        this.clearLogoFile();
        
        // 清除水印文件
        this.clearWatermarkFile();
        
        // 重置透明度
        if (this.logoOpacity) {
            this.logoOpacity.value = 1;
            if (this.logoOpacityValue) this.logoOpacityValue.textContent = '100%';
        }
        if (this.watermarkOpacity) {
            this.watermarkOpacity.value = 0.7;
            if (this.watermarkOpacityValue) this.watermarkOpacityValue.textContent = '70%';
        }
        
        // 重置时间模式为"全程显示"
        const logoFullTimeRadio = document.querySelector('input[name="logo-time-mode"][value="full"]');
        if (logoFullTimeRadio) logoFullTimeRadio.checked = true;
        
        const watermarkFullTimeRadio = document.querySelector('input[name="watermark-time-mode"][value="full"]');
        if (watermarkFullTimeRadio) watermarkFullTimeRadio.checked = true;
        
        this.addLog('info', '🗑️ 已清空所有LOGO和水印设置');
    }

    toggleLogoSettings(enabled) {
        if (this.logoFileGroup) {
            this.logoFileGroup.style.display = enabled ? 'block' : 'none';
        }
        if (this.logoOpacityGroup) {
            this.logoOpacityGroup.style.display = enabled ? 'block' : 'none';
        }
        if (this.logoTimeGroup) {
            this.logoTimeGroup.style.display = enabled ? 'block' : 'none';
        }
        if (this.logoPositionSettings) {
            // 只在启用且已选择文件时显示位置设置
            const hasLogoFile = this.logoFileInput && this.logoFileInput.value;
            this.logoPositionSettings.style.display = (enabled && hasLogoFile) ? 'block' : 'none';
        }
        
        // 控制LOGO预览显示
        if (this.logoOverlay) {
            this.logoOverlay.style.display = enabled ? 'block' : 'none';
        }
        
        // 更新视频显示区域指示器样式
        this.updateVideoDisplayIndicator();
    }

    toggleWatermarkSettings(enabled) {
        if (this.watermarkFileGroup) {
            this.watermarkFileGroup.style.display = enabled ? 'block' : 'none';
        }
        if (this.watermarkOpacityGroup) {
            this.watermarkOpacityGroup.style.display = enabled ? 'block' : 'none';
        }
        if (this.watermarkTimeGroup) {
            this.watermarkTimeGroup.style.display = enabled ? 'block' : 'none';
        }
        if (this.watermarkPositionSettings) {
            // 只在启用且已选择文件时显示位置设置
            const hasWatermarkFile = this.watermarkFileInput && this.watermarkFileInput.value;
            this.watermarkPositionSettings.style.display = (enabled && hasWatermarkFile) ? 'block' : 'none';
        }
        
        // 控制水印预览显示
        if (this.watermarkOverlay) {
            this.watermarkOverlay.style.display = enabled ? 'block' : 'none';
        }
        
        // 更新视频显示区域指示器样式
        this.updateVideoDisplayIndicator();
    }

    toggleLogoTimeInputs(enabled) {
        if (this.logoTimeInputs) {
            this.logoTimeInputs.style.display = enabled ? 'block' : 'none';
        }
    }

    toggleWatermarkTimeInputs(enabled) {
        if (this.watermarkTimeInputs) {
            this.watermarkTimeInputs.style.display = enabled ? 'block' : 'none';
        }
    }

    // ================================
    // 视频预览器功能
    // ================================

    // 显示/隐藏视频预览器
    showVideoPreview() {
        if (this.videoPreviewContainer) {
            this.videoPreviewContainer.style.display = 'block';
        }
    }

    hideVideoPreview() {
        if (this.videoPreviewContainer) {
            this.videoPreviewContainer.style.display = 'none';
        }
        if (this.videoDisplayIndicator) {
            this.videoDisplayIndicator.style.display = 'none';
        }
    }

    // 加载视频到预览器
    async loadVideoPreview(videoFile) {
        if (!this.videoPreviewPlayer || !videoFile) return;
        
        // 创建blob URL用于预览
        const videoUrl = URL.createObjectURL(new File([videoFile.path], videoFile.name, { type: 'video/mp4' }));
        
        // 尝试直接使用文件路径（在Electron环境中）
        this.videoPreviewPlayer.src = `file://${videoFile.path}`;
        
        // 显示基本信息
        this.videoInfo.innerHTML = `
            <div style="color: #333; font-weight: 500; margin-bottom: 4px;">${videoFile.name}</div>
            <div style="color: #666; font-size: 0.92em;">
                ${this.formatFileSize(videoFile.size)}, 正在获取详细信息...
            </div>
        `;
        
        // 确保视频加载
        this.videoPreviewPlayer.load();
        
        // 获取详细信息并更新显示
        try {
            const result = await ipcRenderer.invoke('get-file-details', {
                filePath: videoFile.path,
                fileType: 'video'
            });
            
            if (result.success && result.details.info) {
                // 格式化详细信息：将换行符、竖线等分隔符都替换为逗号
                let detailInfo = result.details.info
                    .replace(/\n+/g, ', ')           // 换行符替换为逗号
                    .replace(/\s*\|\s*/g, ', ')      // 竖线替换为逗号  
                    .replace(/,\s*,+/g, ', ')        // 去除重复逗号
                    .replace(/^,\s*|,\s*$/g, '')     // 去除开头和结尾的逗号
                    .replace(/\s+/g, ' ')            // 多个空格替换为单个空格
                    .trim();
                
                this.videoInfo.innerHTML = `
                    <div style="color: #333; font-weight: 500; margin-bottom: 4px;">${videoFile.name}</div>
                    <div style="color: #666; font-size: 0.92em;">
                        ${this.formatFileSize(videoFile.size)}, ${detailInfo}
                    </div>
                `;
            } else {
                this.videoInfo.innerHTML = `
                    <div style="color: #333; font-weight: 500; margin-bottom: 4px;">${videoFile.name}</div>
                    <div style="color: #666; font-size: 0.92em;">
                        ${this.formatFileSize(videoFile.size)}, 无法获取详细信息
                    </div>
                `;
            }
        } catch (error) {
            console.error('获取视频详细信息失败:', error);
            this.videoInfo.innerHTML = `
                <div style="color: #333; font-weight: 500; margin-bottom: 4px;">${videoFile.name}</div>
                <div style="color: #666; font-size: 0.92em;">
                    ${this.formatFileSize(videoFile.size)}, 获取信息失败
                </div>
            `;
        }
    }

    // 切换视频播放/暂停
    toggleVideoPlayback() {
        if (!this.videoPreviewPlayer) return;
        
        if (this.videoPreviewPlayer.paused) {
            this.videoPreviewPlayer.play();
            this.previewPlayPause.textContent = '⏸️';
        } else {
            this.videoPreviewPlayer.pause();
            this.previewPlayPause.textContent = '▶️';
        }
    }

    // 更新视频时间显示
    updateVideoTime() {
        if (!this.videoPreviewPlayer || !this.previewTime) return;
        
        const current = this.videoPreviewPlayer.currentTime;
        const duration = this.videoPreviewPlayer.duration || 0;
        
        const currentStr = this.formatTime(current);
        const durationStr = this.formatTime(duration);
        
        this.previewTime.textContent = `${currentStr} / ${durationStr}`;
    }

    // 视频加载完成事件
    onVideoLoaded() {
        this.updateVideoTime();
        this.calculateVideoDisplayInfo();
        this.addLog('info', '📹 视频预览加载完成');
    }

    // 计算视频在播放器中的实际显示信息
    calculateVideoDisplayInfo() {
        if (!this.videoPreviewPlayer) return;
        
        // 获取视频真实分辨率
        this.videoRealSize.width = this.videoPreviewPlayer.videoWidth;
        this.videoRealSize.height = this.videoPreviewPlayer.videoHeight;
        
        // 获取播放器容器尺寸
        const playerRect = this.videoPreviewPlayer.getBoundingClientRect();
        const containerWidth = playerRect.width;
        const containerHeight = playerRect.height;
        
        // 计算视频在容器中的实际显示尺寸（object-fit: contain 的效果）
        const videoAspectRatio = this.videoRealSize.width / this.videoRealSize.height;
        const containerAspectRatio = containerWidth / containerHeight;
        
        if (videoAspectRatio > containerAspectRatio) {
            // 视频更宽，以宽度为准
            this.videoDisplaySize.width = containerWidth;
            this.videoDisplaySize.height = containerWidth / videoAspectRatio;
            this.videoDisplayOffset.x = 0;
            this.videoDisplayOffset.y = (containerHeight - this.videoDisplaySize.height) / 2;
        } else {
            // 视频更高，以高度为准
            this.videoDisplaySize.width = containerHeight * videoAspectRatio;
            this.videoDisplaySize.height = containerHeight;
            this.videoDisplayOffset.x = (containerWidth - this.videoDisplaySize.width) / 2;
            this.videoDisplayOffset.y = 0;
        }
        
        // 更新视频信息显示
        const resolutionInfo = `${this.videoRealSize.width}×${this.videoRealSize.height}`;
        const currentInfo = this.videoInfo.textContent;
        if (currentInfo && !currentInfo.includes('×')) {
            this.videoInfo.textContent = `${currentInfo} - ${resolutionInfo}`;
        }
        
        // 更新视频显示区域指示器
        this.updateVideoDisplayIndicator();
        
        // 重新调整现有的LOGO和水印位置
        this.adjustOverlaysToVideoArea();
        
        this.addLog('info', `📐 视频分辨率: ${resolutionInfo}, 显示区域: ${Math.round(this.videoDisplaySize.width)}×${Math.round(this.videoDisplaySize.height)}`);
    }

    // 更新视频显示区域指示器
    updateVideoDisplayIndicator() {
        if (!this.videoDisplayIndicator) return;
        
        // 设置指示器的位置和大小以匹配视频实际显示区域
        this.videoDisplayIndicator.style.left = this.videoDisplayOffset.x + 'px';
        this.videoDisplayIndicator.style.top = this.videoDisplayOffset.y + 'px';
        this.videoDisplayIndicator.style.width = this.videoDisplaySize.width + 'px';
        this.videoDisplayIndicator.style.height = this.videoDisplaySize.height + 'px';
        this.videoDisplayIndicator.style.display = 'block';
        
        // 当有LOGO或水印时，添加样式标识
        const hasOverlays = (this.logoOverlay && this.logoOverlay.style.display !== 'none') ||
                          (this.watermarkOverlay && this.watermarkOverlay.style.display !== 'none');
        
        if (hasOverlays) {
            this.videoOverlay.classList.add('has-overlays');
        } else {
            this.videoOverlay.classList.remove('has-overlays');
        }
    }

    // 调整覆盖层元素到视频显示区域
    adjustOverlaysToVideoArea() {
        if (this.logoOverlay && this.logoOverlay.style.display !== 'none') {
            this.moveOverlayToVideoArea('logo');
        }
        if (this.watermarkOverlay && this.watermarkOverlay.style.display !== 'none') {
            this.moveOverlayToVideoArea('watermark');
        }
    }

    // 将覆盖层元素移动到视频显示区域内
    moveOverlayToVideoArea(type) {
        const element = type === 'logo' ? this.logoOverlay : this.watermarkOverlay;
        if (!element) return;
        
        // 获取当前位置和大小
        const currentLeft = parseInt(element.style.left) || 0;
        const currentTop = parseInt(element.style.top) || 0;
        const currentWidth = parseInt(element.style.width) || 100;
        const currentHeight = parseInt(element.style.height) || 100;
        
        // 限制在视频显示区域内
        const maxLeft = this.videoDisplayOffset.x + this.videoDisplaySize.width - currentWidth;
        const maxTop = this.videoDisplayOffset.y + this.videoDisplaySize.height - currentHeight;
        
        const constrainedLeft = Math.max(this.videoDisplayOffset.x, Math.min(currentLeft, maxLeft));
        const constrainedTop = Math.max(this.videoDisplayOffset.y, Math.min(currentTop, maxTop));
        
        // 应用新位置
        element.style.left = constrainedLeft + 'px';
        element.style.top = constrainedTop + 'px';
        
        // 更新输入框
        this.updateInputsFromOverlay(type);
    }

    // 格式化时间显示
    formatTime(seconds) {
        if (isNaN(seconds)) return '00:00';
        
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // ================================
    // 坐标转换功能（播放器坐标 ↔ 视频比例坐标）
    // ================================

    // 将播放器坐标转换为相对于视频真实尺寸的坐标
    playerCoordsToVideoCoords(playerX, playerY, playerWidth, playerHeight) {
        if (this.videoRealSize.width === 0 || this.videoRealSize.height === 0) {
            return { x: 0, y: 0, width: 100, height: 100 };
        }

        // 转换为相对于视频显示区域的坐标
        const relativeX = playerX - this.videoDisplayOffset.x;
        const relativeY = playerY - this.videoDisplayOffset.y;

        // 计算在视频真实尺寸中的坐标
        const scaleX = this.videoRealSize.width / this.videoDisplaySize.width;
        const scaleY = this.videoRealSize.height / this.videoDisplaySize.height;

        // 确保左上角坐标为0，避免舍入误差导致的偏移
        const videoX = relativeX <= 1 ? 0 : Math.round(relativeX * scaleX);
        const videoY = relativeY <= 1 ? 0 : Math.round(relativeY * scaleY);

        return {
            x: Math.max(0, videoX),
            y: Math.max(0, videoY),
            width: Math.round(playerWidth * scaleX),
            height: Math.round(playerHeight * scaleY)
        };
    }

    // 将视频真实坐标转换为播放器坐标
    videoCoordsToPlayerCoords(videoX, videoY, videoWidth, videoHeight) {
        if (this.videoRealSize.width === 0 || this.videoRealSize.height === 0) {
            return { x: 50, y: 50, width: 100, height: 100 };
        }

        // 计算缩放比例
        const scaleX = this.videoDisplaySize.width / this.videoRealSize.width;
        const scaleY = this.videoDisplaySize.height / this.videoRealSize.height;

        // 转换为播放器坐标
        const playerX = this.videoDisplayOffset.x + (videoX * scaleX);
        const playerY = this.videoDisplayOffset.y + (videoY * scaleY);

        return {
            x: Math.round(playerX),
            y: Math.round(playerY),
            width: Math.round(videoWidth * scaleX),
            height: Math.round(videoHeight * scaleY)
        };
    }

    // 获取当前LOGO/水印在视频真实坐标系中的位置和大小
    getOverlayVideoCoords(type) {
        const element = type === 'logo' ? this.logoOverlay : this.watermarkOverlay;
        if (!element || element.style.display === 'none') {
            return null;
        }

        const playerX = parseInt(element.style.left) || 0;
        const playerY = parseInt(element.style.top) || 0;
        const playerWidth = parseInt(element.style.width) || 100;
        const playerHeight = parseInt(element.style.height) || 100;

        return this.playerCoordsToVideoCoords(playerX, playerY, playerWidth, playerHeight);
    }

    // ================================
    // LOGO和水印预览功能
    // ================================

    // 更新LOGO预览
    updateLogoPreview(imagePath) {
        if (!this.logoPreviewImg || !imagePath) return;
        
        this.logoPreviewImg.src = `file://${imagePath}`;
        this.logoOverlay.style.display = 'block';
        
        // 等待图片加载完成后再设置初始位置
        this.logoPreviewImg.onload = () => {
            this.setOverlayInitialPosition('logo');
            this.updateInputsFromOverlay('logo');
        };
        
        // 如果图片已经加载过（缓存），立即设置位置
        if (this.logoPreviewImg.complete) {
            this.setOverlayInitialPosition('logo');
            this.updateInputsFromOverlay('logo');
        }
        
        // 更新视频显示区域指示器样式
        this.updateVideoDisplayIndicator();
        
        this.addLog('info', '🎨 LOGO预览已更新');
    }

    // 更新水印预览
    updateWatermarkPreview(imagePath) {
        if (!this.watermarkPreviewImg || !imagePath) return;
        
        this.watermarkPreviewImg.src = `file://${imagePath}`;
        this.watermarkOverlay.style.display = 'block';
        
        // 等待图片加载完成后再设置初始位置
        this.watermarkPreviewImg.onload = () => {
            this.setOverlayInitialPosition('watermark');
            this.updateInputsFromOverlay('watermark');
        };
        
        // 如果图片已经加载过（缓存），立即设置位置
        if (this.watermarkPreviewImg.complete) {
            this.setOverlayInitialPosition('watermark');
            this.updateInputsFromOverlay('watermark');
        }
        
        // 更新视频显示区域指示器样式
        this.updateVideoDisplayIndicator();
        
        this.addLog('info', '🌊 水印预览已更新');
    }

    // 设置覆盖层元素的初始位置（智能定位到视频区域内）
    setOverlayInitialPosition(type) {
        const element = type === 'logo' ? this.logoOverlay : this.watermarkOverlay;
        if (!element) return;
        
        // 获取图片元素
        const imgElement = element.querySelector('img');
        if (!imgElement || !imgElement.src) return;
        
        // 计算合适的初始大小，保持图片原始宽高比
        const initialSize = Math.min(this.videoDisplaySize.width, this.videoDisplaySize.height) * 0.15; // 15%的视频尺寸
        const minSize = 40; // 最小尺寸
        let width = Math.max(minSize, initialSize);
        let height = Math.max(minSize, initialSize);
        
        // 如果图片已加载，根据真实宽高比计算尺寸
        if (imgElement.naturalWidth && imgElement.naturalHeight) {
            const aspectRatio = imgElement.naturalWidth / imgElement.naturalHeight;
            
            // 计算适合的显示尺寸，保持宽高比
            if (aspectRatio > 1) {
                // 宽图，以宽度为基准
                width = Math.max(minSize, initialSize);
                height = width / aspectRatio;
            } else {
                // 高图，以高度为基准
                height = Math.max(minSize, initialSize);
                width = height * aspectRatio;
            }
            
            // 确保不超过视频显示区域的30%
            const maxWidth = this.videoDisplaySize.width * 0.3;
            const maxHeight = this.videoDisplaySize.height * 0.3;
            
            if (width > maxWidth) {
                width = maxWidth;
                height = width / aspectRatio;
            }
            if (height > maxHeight) {
                height = maxHeight;
                width = height * aspectRatio;
            }
        }
        
        // 计算初始位置
        let x, y;
        if (type === 'logo') {
            // LOGO默认放在左上角（真正的边界，无边距）
            x = this.videoDisplayOffset.x;
            y = this.videoDisplayOffset.y;
        } else {
            // 水印默认放在固定位置 (50, 200)，与处理逻辑保持一致
            // 将视频坐标转换为播放器坐标
            if (this.videoRealSize.width > 0 && this.videoRealSize.height > 0) {
                const defaultPlayerCoords = this.videoCoordsToPlayerCoords(50, 200, width, height);
                x = defaultPlayerCoords.x;
                y = defaultPlayerCoords.y;
            } else {
                // 如果视频尺寸还没准备好，使用相对位置作为后备方案
                x = this.videoDisplayOffset.x + 50;
                y = this.videoDisplayOffset.y + 200;
            }
        }
        
        // 确保在视频显示区域内
        x = Math.max(this.videoDisplayOffset.x, Math.min(x, this.videoDisplayOffset.x + this.videoDisplaySize.width - width));
        y = Math.max(this.videoDisplayOffset.y, Math.min(y, this.videoDisplayOffset.y + this.videoDisplaySize.height - height));
        
        // 设置位置和大小
        element.style.left = x + 'px';
        element.style.top = y + 'px';
        element.style.width = width + 'px';
        element.style.height = height + 'px';
    }

    // 设置覆盖层元素的位置和大小
    setOverlayPosition(type, x, y, width, height) {
        const element = type === 'logo' ? this.logoOverlay : this.watermarkOverlay;
        if (!element) return;
        
        // 获取图片元素以保持宽高比
        const imgElement = element.querySelector('img');
        if (imgElement && imgElement.naturalWidth && imgElement.naturalHeight) {
            const aspectRatio = imgElement.naturalWidth / imgElement.naturalHeight;
            
            // 根据拖拽方向调整尺寸以保持宽高比
            if (width > height) {
                // 水平拖拽，以高度为基准
                height = width / aspectRatio;
            } else {
                // 垂直拖拽，以宽度为基准
                width = height * aspectRatio;
            }
        }
        
        element.style.left = x + 'px';
        element.style.top = y + 'px';
        element.style.width = width + 'px';
        element.style.height = height + 'px';
    }

    // 从输入框更新覆盖层位置（输入框中的值是基于视频真实分辨率的）
    updateOverlayFromInputs(type) {
        const prefix = type === 'logo' ? 'logo' : 'watermark';
        
        // 确保获取正确的数值，特别处理0值
        const videoX = this[`${prefix}XInput`]?.value === '' ? 0 : (parseInt(this[`${prefix}XInput`]?.value) || 0);
        const videoY = this[`${prefix}YInput`]?.value === '' ? 0 : (parseInt(this[`${prefix}YInput`]?.value) || 0);
        const videoWidth = parseInt(this[`${prefix}WidthInput`]?.value) || 100;
        const videoHeight = parseInt(this[`${prefix}HeightInput`]?.value) || 100;
        
        // 将视频坐标转换为播放器坐标
        const playerCoords = this.videoCoordsToPlayerCoords(videoX, videoY, videoWidth, videoHeight);
        
        // 限制在视频显示区域内，确保可以精确到达边界
        const minX = this.videoDisplayOffset.x;
        const minY = this.videoDisplayOffset.y;
        const maxX = this.videoDisplayOffset.x + this.videoDisplaySize.width - playerCoords.width;
        const maxY = this.videoDisplayOffset.y + this.videoDisplaySize.height - playerCoords.height;
        
        let constrainedX = Math.max(minX, Math.min(playerCoords.x, maxX));
        let constrainedY = Math.max(minY, Math.min(playerCoords.y, maxY));
        
        // 确保0坐标能够精确映射到边界
        if (videoX === 0) constrainedX = minX;
        if (videoY === 0) constrainedY = minY;
        
        this.setOverlayPosition(type, constrainedX, constrainedY, playerCoords.width, playerCoords.height);
    }

    // 从覆盖层更新输入框（输入框显示基于视频真实分辨率的坐标）
    updateInputsFromOverlay(type) {
        const element = type === 'logo' ? this.logoOverlay : this.watermarkOverlay;
        const prefix = type === 'logo' ? 'logo' : 'watermark';
        
        if (!element) return;
        
        // 获取播放器坐标
        const playerX = parseInt(element.style.left) || 0;
        const playerY = parseInt(element.style.top) || 0;
        const playerWidth = parseInt(element.style.width) || 100;
        const playerHeight = parseInt(element.style.height) || 100;
        
        // 转换为视频真实坐标
        const videoCoords = this.playerCoordsToVideoCoords(playerX, playerY, playerWidth, playerHeight);
        
        // 更新输入框（显示视频真实坐标）
        if (this[`${prefix}XInput`]) this[`${prefix}XInput`].value = videoCoords.x;
        if (this[`${prefix}YInput`]) this[`${prefix}YInput`].value = videoCoords.y;
        if (this[`${prefix}WidthInput`]) this[`${prefix}WidthInput`].value = videoCoords.width;
        if (this[`${prefix}HeightInput`]) this[`${prefix}HeightInput`].value = videoCoords.height;
    }

    // ================================
    // 拖拽和缩放功能
    // ================================

    initializeDragAndResize() {
        // 为覆盖层元素添加拖拽事件
        [this.logoOverlay, this.watermarkOverlay].forEach(element => {
            if (!element) return;
            
            // 鼠标按下事件
            element.addEventListener('mousedown', (e) => this.startDrag(e, element));
            
            // 缩放手柄事件
            const resizeHandles = element.querySelectorAll('.resize-handle');
            resizeHandles.forEach(handle => {
                handle.addEventListener('mousedown', (e) => this.startResize(e, element, handle));
            });
        });
        
        // 全局鼠标事件
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('mouseup', (e) => this.onMouseUp(e));
    }

    startDrag(e, element) {
        if (e.target.classList.contains('resize-handle')) return;
        
        e.preventDefault();
        this.isDragging = true;
        this.dragElement = element;
        
        this.dragStartPos = { x: e.clientX, y: e.clientY };
        this.elementStartPos = {
            x: parseInt(element.style.left) || 0,
            y: parseInt(element.style.top) || 0
        };
        
        element.classList.add('dragging');
        element.classList.add('selected');
        
        // 移除其他元素的选中状态
        [this.logoOverlay, this.watermarkOverlay].forEach(el => {
            if (el && el !== element) {
                el.classList.remove('selected');
            }
        });
    }

    startResize(e, element, handle) {
        e.preventDefault();
        e.stopPropagation();
        
        this.isResizing = true;
        this.dragElement = element;
        this.resizeHandle = handle;
        
        this.dragStartPos = { x: e.clientX, y: e.clientY };
        this.elementStartPos = {
            x: parseInt(element.style.left) || 0,
            y: parseInt(element.style.top) || 0
        };
        this.resizeStartSize = {
            width: element.offsetWidth,
            height: element.offsetHeight
        };
        
        element.classList.add('resizing');
        element.classList.add('selected');
    }

    onMouseMove(e) {
        if (!this.isDragging && !this.isResizing) return;
        
        e.preventDefault();
        
        const deltaX = e.clientX - this.dragStartPos.x;
        const deltaY = e.clientY - this.dragStartPos.y;
        
        if (this.isDragging) {
            this.handleDrag(deltaX, deltaY);
        } else if (this.isResizing) {
            this.handleResize(deltaX, deltaY);
        }
    }

    handleDrag(deltaX, deltaY) {
        if (!this.dragElement) return;
        
        const newX = this.elementStartPos.x + deltaX;
        const newY = this.elementStartPos.y + deltaY;
        const elementWidth = this.dragElement.offsetWidth;
        const elementHeight = this.dragElement.offsetHeight;
        
        // 限制在视频显示区域内，确保可以精确到达边界
        const minX = this.videoDisplayOffset.x;
        const minY = this.videoDisplayOffset.y;
        const maxX = this.videoDisplayOffset.x + this.videoDisplaySize.width - elementWidth;
        const maxY = this.videoDisplayOffset.y + this.videoDisplaySize.height - elementHeight;
        
        // 使用更精确的边界约束，允许贴边显示
        let constrainedX = Math.max(minX, Math.min(newX, maxX));
        let constrainedY = Math.max(minY, Math.min(newY, maxY));
        
        // 如果非常接近边界（1像素内），直接贴边
        if (Math.abs(constrainedX - minX) <= 1) constrainedX = minX;
        if (Math.abs(constrainedY - minY) <= 1) constrainedY = minY;
        if (Math.abs(constrainedX - maxX) <= 1) constrainedX = maxX;
        if (Math.abs(constrainedY - maxY) <= 1) constrainedY = maxY;
        
        this.dragElement.style.left = constrainedX + 'px';
        this.dragElement.style.top = constrainedY + 'px';
        
        // 更新输入框
        const type = this.dragElement === this.logoOverlay ? 'logo' : 'watermark';
        this.updateInputsFromOverlay(type);
    }

    handleResize(deltaX, deltaY) {
        if (!this.dragElement || !this.resizeHandle) return;
        
        const handle = this.resizeHandle;
        const element = this.dragElement;
        const imgElement = element.querySelector('img');
        
        // 如果没有图片或图片尺寸信息，使用简单缩放
        if (!imgElement || !imgElement.naturalWidth || !imgElement.naturalHeight) {
            this.handleSimpleResize(deltaX, deltaY);
            return;
        }
        
        const aspectRatio = imgElement.naturalWidth / imgElement.naturalHeight;
        const minSize = 20;
        const maxSize = Math.min(this.videoDisplaySize.width, this.videoDisplaySize.height) * 0.8;
        
        // 计算基础变化量（使用较大的变化值作为主导）
        let primaryDelta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
        
        // 根据手柄类型调整方向
        if (handle.classList.contains('sw') || handle.classList.contains('nw')) {
            primaryDelta = -primaryDelta; // 左侧手柄，方向相反
        }
        if (handle.classList.contains('nw') || handle.classList.contains('ne')) {
            if (Math.abs(deltaY) > Math.abs(deltaX)) {
                primaryDelta = -deltaY; // 上方手柄，Y方向相反
            }
        }
        
        // 计算新的宽度（基于主要变化量）
        let newWidth = this.resizeStartSize.width + primaryDelta;
        newWidth = Math.max(minSize, Math.min(newWidth, maxSize));
        
        // 根据宽高比计算新的高度
        let newHeight = newWidth / aspectRatio;
        
        // 如果高度超限，以高度为基准重新计算
        if (newHeight > maxSize) {
            newHeight = maxSize;
            newWidth = newHeight * aspectRatio;
        } else if (newHeight < minSize) {
            newHeight = minSize;
            newWidth = newHeight * aspectRatio;
        }
        
        // 计算新位置
        let newX = this.elementStartPos.x;
        let newY = this.elementStartPos.y;
        
        // 根据手柄类型调整位置
        if (handle.classList.contains('se')) {
            // 右下角：位置不变
            // newX = this.elementStartPos.x;
            // newY = this.elementStartPos.y;
        } else if (handle.classList.contains('sw')) {
            // 左下角：右边固定，左边移动
            newX = this.elementStartPos.x + this.resizeStartSize.width - newWidth;
        } else if (handle.classList.contains('ne')) {
            // 右上角：下边固定，上边移动
            newY = this.elementStartPos.y + this.resizeStartSize.height - newHeight;
        } else if (handle.classList.contains('nw')) {
            // 左上角：右下角固定，左上角移动
            newX = this.elementStartPos.x + this.resizeStartSize.width - newWidth;
            newY = this.elementStartPos.y + this.resizeStartSize.height - newHeight;
        }
        
        // 确保在视频显示区域内
        const videoLeft = this.videoDisplayOffset.x;
        const videoTop = this.videoDisplayOffset.y;
        const videoRight = videoLeft + this.videoDisplaySize.width;
        const videoBottom = videoTop + this.videoDisplaySize.height;
        
        // 调整位置以保持在视频区域内
        if (newX < videoLeft) {
            newX = videoLeft;
        } else if (newX + newWidth > videoRight) {
            newX = videoRight - newWidth;
        }
        
        if (newY < videoTop) {
            newY = videoTop;
        } else if (newY + newHeight > videoBottom) {
            newY = videoBottom - newHeight;
        }
        
        // 应用新的尺寸和位置
        element.style.left = newX + 'px';
        element.style.top = newY + 'px';
        element.style.width = newWidth + 'px';
        element.style.height = newHeight + 'px';
        
        // 更新输入框
        const type = element === this.logoOverlay ? 'logo' : 'watermark';
        this.updateInputsFromOverlay(type);
    }
    
    // 简单缩放处理（当图片信息不可用时）
    handleSimpleResize(deltaX, deltaY) {
        const handle = this.resizeHandle;
        const element = this.dragElement;
        
        let newWidth = this.resizeStartSize.width;
        let newHeight = this.resizeStartSize.height;
        let newX = this.elementStartPos.x;
        let newY = this.elementStartPos.y;
        
        // 根据手柄类型计算新的尺寸和位置
        if (handle.classList.contains('se')) {
            newWidth = this.resizeStartSize.width + deltaX;
            newHeight = this.resizeStartSize.height + deltaY;
        } else if (handle.classList.contains('sw')) {
            newWidth = this.resizeStartSize.width - deltaX;
            newHeight = this.resizeStartSize.height + deltaY;
            newX = this.elementStartPos.x + deltaX;
        } else if (handle.classList.contains('ne')) {
            newWidth = this.resizeStartSize.width + deltaX;
            newHeight = this.resizeStartSize.height - deltaY;
            newY = this.elementStartPos.y + deltaY;
        } else if (handle.classList.contains('nw')) {
            newWidth = this.resizeStartSize.width - deltaX;
            newHeight = this.resizeStartSize.height - deltaY;
            newX = this.elementStartPos.x + deltaX;
            newY = this.elementStartPos.y + deltaY;
        }
        
        // 限制最小尺寸
        newWidth = Math.max(20, newWidth);
        newHeight = Math.max(20, newHeight);
        
        // 限制在视频显示区域内
        const videoLeft = this.videoDisplayOffset.x;
        const videoTop = this.videoDisplayOffset.y;
        const videoRight = videoLeft + this.videoDisplaySize.width;
        const videoBottom = videoTop + this.videoDisplaySize.height;
        
        newX = Math.max(videoLeft, Math.min(newX, videoRight - newWidth));
        newY = Math.max(videoTop, Math.min(newY, videoBottom - newHeight));
        
        // 应用新的尺寸和位置
        element.style.left = newX + 'px';
        element.style.top = newY + 'px';
        element.style.width = newWidth + 'px';
        element.style.height = newHeight + 'px';
        
        // 更新输入框
        const type = element === this.logoOverlay ? 'logo' : 'watermark';
        this.updateInputsFromOverlay(type);
    }

    onMouseUp(e) {
        if (this.isDragging || this.isResizing) {
            // 清理拖拽状态
            if (this.dragElement) {
                this.dragElement.classList.remove('dragging', 'resizing');
            }
            
            this.isDragging = false;
            this.isResizing = false;
            this.dragElement = null;
            this.resizeHandle = null;
        }
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new MediaProcessorApp();
}); 