const { ipcRenderer } = require('electron');

class MediaProcessorApp {
    constructor() {
        this.currentFolder = null;
        this.mediaFiles = { mp3: [], video: [] };
        this.selectedFiles = [];
        this.currentFileType = 'mp3';
        this.isProcessing = false;
        
        this.initializeElements();
        this.bindEvents();
        this.checkFFmpegStatus();
        
        // 初始化配置面板
        this.updateConfigPanel(this.currentFileType);
        
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
        this.logContent = document.getElementById('log-content');
        this.ffmpegStatus = document.getElementById('ffmpeg-status');
        
        // 标签页和配置
        this.fileTabs = document.querySelectorAll('.file-tab');
        this.tabContents = document.querySelectorAll('.tab-content');
        this.configTitle = document.getElementById('config-title');

        // MP3 设置元素
        this.mp3ForceProcessRadios = document.querySelectorAll('input[name="force-process"]');
        this.mp3ThresholdGroup = document.getElementById('mp3-threshold-group');
    }

    bindEvents() {
        // 文件夹选择
        this.selectFolderBtn.addEventListener('click', () => this.selectFolder());
        
        // 输出文件夹选择
        this.selectOutputBtn.addEventListener('click', () => this.selectOutputFolder());
        
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
            this.updateProgress(progress);
        });

        // 监听MP3强制处理单选框变化
        this.mp3ForceProcessRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.mp3ThresholdGroup.style.display = (e.target.value === 'yes') ? 'none' : '';
            });
        });

        // 同步表头和文件列表的水平滚动
        this.fileList.addEventListener('scroll', () => {
            const header = document.querySelector('.file-list-header');
            if (header) {
                header.scrollLeft = this.fileList.scrollLeft;
            }
        });
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
                this.addLog('info', `📂 选择文件夹: ${result.path}`);
                
                // 设置默认输出路径为源文件夹下的output文件夹
                const defaultOutputPath = await ipcRenderer.invoke('get-default-output-path', result.path);
                if (defaultOutputPath.success) {
                    this.outputFolder.value = defaultOutputPath.path;
                    this.addLog('info', `📁 默认输出路径: ${defaultOutputPath.path}`);
                }
                
                await this.scanMediaFiles();
            }
        } catch (error) {
            this.addLog('error', `选择文件夹失败: ${error.message}`);
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

    async scanMediaFiles() {
        if (!this.currentFolder) return;
        
        try {
            this.addLog('info', '🔍 正在扫描媒体文件...');
            const result = await ipcRenderer.invoke('scan-media-files', this.currentFolder);
            
            if (result.success) {
                this.mediaFiles = result.files;
                this.updateFileList();
                this.addLog('success', `✅ 扫描完成: 找到 ${this.mediaFiles.mp3.length} 个MP3文件, ${this.mediaFiles.video.length} 个视频文件`);
            } else {
                this.addLog('error', `扫描失败: ${result.error}`);
            }
        } catch (error) {
            this.addLog('error', `扫描文件时出错: ${error.message}`);
        }
    }

    switchFileTab(type) {
        this.currentFileType = type;
        
        // 更新标签页状态
        this.fileTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.type === type);
        });
        
        // 更新配置面板
        this.updateConfigPanel(type);
        
        // 检查是否需要获取详细信息
        const files = this.mediaFiles[type] || [];
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
        }
        
        // 更新配置内容
        this.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${type}-settings`);
        });
    }

    updateFileList() {
        this.renderFileList(true); // 首次渲染需要获取详细信息
    }

    renderFileList(loadDetails = false) {
        const files = this.mediaFiles[this.currentFileType] || [];
        this.selectedFiles = [];
        
        if (files.length === 0) {
            this.fileList.innerHTML = `
                <div class="empty-state">
                    <p>未找到${this.currentFileType === 'mp3' ? 'MP3' : '视频'}文件</p>
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
                <div class="file-item ${this.currentFileType}" data-index="${index}">
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
        });
        
        this.updateFileCount();
        this.updateSelectAllCheckbox();
        
        // 检查是否需要水平滚动
        this.checkHorizontalScroll();
        
        // 只在需要时获取文件详细信息
        if (loadDetails) {
            this.loadFileDetails(files);
        }
    }

    async loadFileDetails(files) {
        // 延迟1秒开始获取，避免界面卡顿
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                const result = await ipcRenderer.invoke('get-file-details', {
                    filePath: file.path,
                    fileType: this.currentFileType
                });
                
                if (result.success) {
                    // 更新文件信息显示
                    const infoElement = this.fileList.querySelector(`[data-file-index="${i}"]`);
                    if (infoElement) {
                        infoElement.innerHTML = result.details.info;
                    }
                    
                    // 更新内存中的文件信息
                    this.mediaFiles[this.currentFileType][i].info = result.details.info;
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
        const files = this.mediaFiles[this.currentFileType] || [];
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
        const fileType = this.currentFileType;
        
        // 从mediaFiles中移除选中的文件
        this.selectedFiles.forEach(selectedFile => {
            const index = this.mediaFiles[fileType].findIndex(file => file.path === selectedFile.path);
            if (index > -1) {
                this.mediaFiles[fileType].splice(index, 1);
            }
        });
        
        // 清空选中列表
        this.selectedFiles = [];
        
        // 重新渲染文件列表（不重新获取文件信息）
        this.renderFileList(false);
        
        // 记录日志
        this.addLog('info', `🗑️ 已移除 ${removedCount} 个${fileType === 'mp3' ? 'MP3' : '视频'}文件`);
    }

    updateSelectAllCheckbox() {
        const files = this.mediaFiles[this.currentFileType] || [];
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
        const totalCount = this.mediaFiles[this.currentFileType]?.length || 0;
        
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
        this.processBtn.disabled = true;
        this.removeSelectedBtn.disabled = true;
        this.processBtn.textContent = '⏳ 处理中...';
        
        try {
            if (this.currentFileType === 'mp3') {
                await this.processMp3Files();
            } else if (this.currentFileType === 'video') {
                await this.processVideoFiles();
            }
        } catch (error) {
            this.addLog('error', `处理失败: ${error.message}`);
        } finally {
            this.isProcessing = false;
            this.processBtn.textContent = '🚀 开始处理';
            this.updateFileCount(); // 恢复按钮状态
            this.updateProgress({ type: this.currentFileType, current: 0, total: 0, status: 'complete' });
        }
    }

    async processMp3Files() {
        const options = {
            bitrate: parseInt(document.getElementById('mp3-bitrate').value),
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
        const options = {
            lessonName: document.getElementById('lesson-name').value || 'lesson',
            resolution: document.getElementById('video-resolution').value,
            bitrate: parseInt(document.getElementById('video-bitrate').value),
            segmentDuration: parseInt(document.getElementById('segment-duration').value),
            rename: document.getElementById('video-rename').checked
        };

        this.addLog('info', `🎬 开始处理 ${this.selectedFiles.length} 个视频文件`);
        this.addLog('info', `⚙️ 课程: ${options.lessonName}, 分辨率: ${options.resolution}, 比特率: ${options.bitrate}k`);

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

    updateProgress(progress) {
        const { type, current, total, file, status } = progress;
        
        if (total > 0) {
            const percentage = Math.round((current / total) * 100);
            this.progressFill.style.width = `${percentage}%`;
            
            if (status === 'processing') {
                this.progressText.textContent = `正在处理 (${current}/${total}): ${file}`;
            } else if (status === 'complete') {
                this.progressText.textContent = `处理完成`;
                this.progressFill.style.width = '100%';
            }
        }
    }

    addLog(type, message) {
        const logEntry = document.createElement('p');
        logEntry.className = `log-entry ${type}`;
        logEntry.textContent = `${new Date().toLocaleTimeString()} ${message}`;
        
        this.logContent.appendChild(logEntry);
        this.logContent.scrollTop = this.logContent.scrollHeight;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new MediaProcessorApp();
}); 