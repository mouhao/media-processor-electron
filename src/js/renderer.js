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
    }

    initializeElements() {
        // 按钮和输入元素
        this.selectFolderBtn = document.getElementById('select-folder-btn');
        this.processBtn = document.getElementById('processBtn');
        this.selectAllCheckbox = document.getElementById('selectAllCheckbox');
        
        // 显示元素
        this.folderPath = document.getElementById('folder-path');
        this.fileList = document.getElementById('fileList');
        this.fileCountText = document.getElementById('file-count-text');
        this.progressFill = document.getElementById('progress-fill');
        this.progressText = document.getElementById('progress-text');
        this.logContent = document.getElementById('log-content');
        this.ffmpegStatus = document.getElementById('ffmpeg-status');
        
        // 标签页
        this.fileTabs = document.querySelectorAll('.file-tab');
        this.processTabs = document.querySelectorAll('.process-tab');
        this.tabContents = document.querySelectorAll('.tab-content');
    }

    bindEvents() {
        // 文件夹选择
        this.selectFolderBtn.addEventListener('click', () => this.selectFolder());
        
        // 处理按钮
        this.processBtn.addEventListener('click', () => this.startProcessing());
        
        // 全选复选框
        this.selectAllCheckbox.addEventListener('change', (e) => this.selectAllFiles(e.target.checked));
        
        // 文件类型标签页
        this.fileTabs.forEach(tab => {
            tab.addEventListener('click', (e) => this.switchFileTab(e.target.dataset.type));
        });
        
        // 处理类型标签页
        this.processTabs.forEach(tab => {
            tab.addEventListener('click', (e) => this.switchProcessTab(e.target.dataset.type));
        });
        
        // 监听处理进度
        ipcRenderer.on('processing-progress', (event, progress) => {
            this.updateProgress(progress);
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
                
                await this.scanMediaFiles();
            }
        } catch (error) {
            this.addLog('error', `选择文件夹失败: ${error.message}`);
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
        
        this.updateFileList();
    }

    switchProcessTab(type) {
        // 更新标签页状态
        this.processTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.type === type);
        });
        
        // 更新内容面板
        this.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${type}-settings`);
        });
        
        // 如果切换到不同的处理类型，也切换文件列表
        if (type !== this.currentFileType) {
            this.switchFileTab(type);
        }
    }

    updateFileList() {
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
            const fileSize = this.formatFileSize(file.size);
            const fileInfo = file.info || '';
            
            return `
                <div class="file-item ${this.currentFileType}" data-index="${index}">
                    <div class="file-select">
                        <input type="checkbox" data-index="${index}">
                    </div>
                    <div class="file-name" title="${fileName}">${fileName}</div>
                    <div class="file-info">${fileInfo}</div>
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
        } else {
            this.fileCountText.textContent = `已选择 ${selectedCount} / ${totalCount} 个文件`;
            this.processBtn.disabled = false;
        }
    }

    async startProcessing() {
        if (this.isProcessing || this.selectedFiles.length === 0) return;
        
        this.isProcessing = true;
        this.processBtn.disabled = true;
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
            this.processBtn.disabled = false;
            this.processBtn.textContent = '🚀 开始处理';
            this.updateProgress({ type: this.currentFileType, current: 0, total: 0, status: 'complete' });
        }
    }

    async processMp3Files() {
        const options = {
            targetBitrate: parseInt(document.getElementById('mp3-bitrate').value),
            bitrateThreshold: parseInt(document.getElementById('mp3-threshold').value),
            keepStructure: document.getElementById('mp3-keep-structure').checked
        };

        this.addLog('info', `🎵 开始处理 ${this.selectedFiles.length} 个MP3文件`);
        this.addLog('info', `⚙️ 目标比特率: ${options.targetBitrate}kbps, 阈值: ${options.bitrateThreshold}kbps`);

        const result = await ipcRenderer.invoke('process-mp3-files', {
            folderPath: this.currentFolder,
            files: this.selectedFiles,
            options
        });

        if (result.success) {
            const { processed, skipped, failed } = result.result;
            this.addLog('success', `✅ MP3处理完成: 成功 ${processed}, 跳过 ${skipped}, 失败 ${failed}`);
        } else {
            this.addLog('error', `MP3处理失败: ${result.error}`);
        }
    }

    async processVideoFiles() {
        const options = {
            lessonName: document.getElementById('lesson-name').value || 'lesson',
            resolution: document.getElementById('video-resolution').value,
            videoBitrate: parseInt(document.getElementById('video-bitrate').value),
            segmentDuration: parseInt(document.getElementById('segment-duration').value),
            renameFiles: document.getElementById('video-rename').checked
        };

        this.addLog('info', `🎬 开始处理 ${this.selectedFiles.length} 个视频文件`);
        this.addLog('info', `⚙️ 课程: ${options.lessonName}, 分辨率: ${options.resolution}, 比特率: ${options.videoBitrate}k`);

        const result = await ipcRenderer.invoke('process-video-files', {
            folderPath: this.currentFolder,
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